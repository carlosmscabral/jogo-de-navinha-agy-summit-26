/**
 * Lease distribuído para a varredura de canonicalização.
 *
 * O PROBLEMA. `runCanonicalizationSweep` é disparada sem `await` no fim de cada `ingestBatch`
 * que marcou alguma partida (`ingest.ts`). Com um estande isso era raro; com dois, duas
 * ingestões concorrentes leem os MESMOS ≤50 documentos marcados e chamam o Vertex em
 * duplicidade — disputando quota exatamente com a moderação L2, que é BLOQUEANTE e está no
 * caminho crítico do visitante (cauda medida de 47-78 s). Não corrompe nada: `correctMatchCompany`
 * relê a flag dentro da transação, então a segunda passada é um no-op. Gasta em dobro, e o que
 * ela gasta é a coisa que o visitante está esperando.
 *
 * POR QUE UM LEASE COM TTL, e não um booleano `running` no Firestore. Uma instância do Cloud Run
 * que morra segurando o lease (deploy, OOM, escala para zero) deixaria o booleano preso em
 * `true` para sempre e a canonicalização morreria em silêncio pelo resto do evento. Com TTL, a
 * próxima ingestão depois de `expires_at` readquire e a vida segue. É por isso que este arquivo
 * existe em vez de um `set({running: true})`.
 *
 * O QUE O LEASE NÃO É. Não é o mecanismo de correção. Uma varredura que estoure o TTL faz duas
 * rodarem em paralelo, e o que impede estrago aí continua sendo a idempotência de
 * `correctMatchCompany` — a rede de verdade. O lease é economia, não segurança; ninguém deve
 * passar a depender dele para garantir exclusão mútua.
 */
import { randomUUID } from 'node:crypto';
import { type Firestore } from 'firebase-admin/firestore';

/**
 * 120 s. A cauda medida de uma chamada ao Vertex chegou a 78 s, e uma varredura faz uma chamada
 * de resolução mais até 50 transações de correção. Curto demais e duas varreduras rodam de novo
 * (que é o estado de hoje, sem lease); longo demais e um crash bloqueia a canonicalização por
 * tempo visível no evento. Dois minutos é o meio que cobre a cauda com folga.
 */
export const DEFAULT_LEASE_TTL_MS = 120_000;

export const LEASE_COLLECTION = 'system';
export const CANONICALIZATION_LEASE_DOC = 'canonicalization_lease';

/**
 * Identidade DESTE processo. Gerada uma vez no import, não por chamada: é o que permite a mesma
 * instância renovar/liberar o próprio lease e, principalmente, o que faz `releaseLease` recusar
 * apagar um lease que já foi tomado por outra instância depois de expirar.
 */
export const PROCESS_HOLDER_ID = randomUUID();

export interface LeaseDocument {
  holder: string;
  acquired_at: string;
  expires_at: string;
}

export interface LeaseOptions {
  ttlMs?: number;
  now?: () => number;
  holderId?: string;
  docId?: string;
}

function leaseRef(db: Firestore, docId: string) {
  return db.collection(LEASE_COLLECTION).doc(docId);
}

/**
 * Tenta tomar o lease. `true` = tomou, `false` = outra instância está com ele e ainda não venceu.
 *
 * Transacional: a leitura do `expires_at` e a escrita do novo dono acontecem no mesmo commit, ou
 * duas instâncias que chegassem juntas leriam "vencido" e as duas se declarariam donas — que é
 * precisamente o cenário que o lease existe para evitar.
 */
export async function acquireLease(db: Firestore, opts: LeaseOptions = {}): Promise<boolean> {
  const ttlMs = opts.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const now = opts.now ?? Date.now;
  const holder = opts.holderId ?? PROCESS_HOLDER_ID;
  const ref = leaseRef(db, opts.docId ?? CANONICALIZATION_LEASE_DOC);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const nowMs = now();

    if (snap.exists) {
      const current = snap.data() as LeaseDocument;
      const expiresAt = Date.parse(current?.expires_at ?? '');
      // `expires_at` ilegível (documento truncado, escrita antiga, alguém editando à mão no
      // console) é tratado como VENCIDO. O contrário — tratar como válido — travaria a
      // canonicalização para sempre, e sem ninguém para liberar.
      if (Number.isFinite(expiresAt) && expiresAt > nowMs && current.holder !== holder) return false;
    }

    tx.set(ref, {
      holder,
      acquired_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + ttlMs).toISOString()
    } satisfies LeaseDocument);
    return true;
  });
}

/**
 * Libera o lease, se ainda for nosso. Uma instância lenta que só termina depois do TTL não pode
 * apagar o lease de quem já tomou o lugar dela — seria uma terceira varredura entrando no meio.
 */
export async function releaseLease(db: Firestore, opts: LeaseOptions = {}): Promise<void> {
  const holder = opts.holderId ?? PROCESS_HOLDER_ID;
  const ref = leaseRef(db, opts.docId ?? CANONICALIZATION_LEASE_DOC);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if ((snap.data() as LeaseDocument).holder !== holder) return;
    tx.delete(ref);
  });
}

/**
 * Roda `fn` com o lease na mão; se outra instância estiver com ele, devolve `null` sem rodar.
 *
 * O `finally` é o ponto do exercício: uma varredura que lança precisa devolver o lease na hora,
 * senão a próxima ingestão espera o TTL inteiro por um trabalho que já acabou.
 */
export async function withLease<T>(db: Firestore, fn: () => Promise<T>, opts: LeaseOptions = {}): Promise<T | null> {
  if (!(await acquireLease(db, opts))) return null;
  try {
    return await fn();
  } finally {
    await releaseLease(db, opts).catch((err) => {
      // Não relança: o trabalho já foi feito, e transformar uma falha na devolução do lease em
      // falha da varredura só trocaria "vamos esperar o TTL" por um erro no log do operador.
      console.error('[cloud-api] falha ao liberar o lease de canonicalização:', err);
    });
  }
}
