/**
 * Worker de sincronização do buffer local com a nuvem — Tarefa C5 (Spec 05 §5).
 *
 * `SQLiteBufferService.getPendingMatches()`/`markMatchSynced()` (Tarefa C0) existem desde o
 * início, mas nada os chamava: o buffer offline só é um buffer de verdade se algo o drena. Este
 * arquivo é esse "algo" — consome `POST /v1/matches` da Tarefa C3 (`packages/cloud-api`) como um
 * contrato HTTP puro, sem importar código de lá.
 *
 * `auth_failed` merece destaque porque não é um estado a mais por completude: um 401/403 diz que
 * o token de escopo único expirou ou foi rotacionado, e nenhum retry vai resolver isso. As duas
 * falhas possíveis exigem ações opostas do staff — "sem rede" é esperar, "token inválido" é trocar
 * o token no Secret Manager — e um único estado "falhou" as tornaria indistinguíveis exatamente
 * quando distingui-las importa (achado análogo em `duboc/gemini-com-pe`). Por isso `auth_failed`
 * (a) trava o backoff no teto, porque tentativas rápidas não ajudam nesse caso, e (b) NÃO desliga
 * o worker, para a fila drenar sozinha assim que o token voltar a valer. É também por isso que
 * `token` é uma função e não uma string — uma string capturada no construtor congelaria o token
 * expirado para sempre.
 *
 * Precisão sobre o "sem reiniciar", medida no Gate M3 (2026-08-24): isso vale para o lado da
 * NUVEM. Rotacionar o segredo no Secret Manager para casar com o token que o daemon já tem faz
 * este worker sair de `auth_failed` sozinho, em no máximo 5 minutos, sem tocar no estande — que é
 * o caminho realista durante o evento, com o kiosk em tela cheia na frente de um visitante.
 * Corrigir o `packages/daemon/.env` do lado do ESTANDE, ao contrário, exige reiniciar o daemon:
 * `getCloudApiToken` lê `process.env`, e o `--env-file-if-exists` do `npm start` carrega o
 * arquivo uma única vez, na subida do processo. Nada muta `process.env` em runtime.
 */

/** Estado observável de `status()`, consumido por `GET /api/sync/status` (self_test.sh / painel do operador). */
export type SyncState = 'ok' | 'retrying' | 'auth_failed' | 'disabled';

export interface SyncOutcome {
  status: 'ok' | 'failed' | 'auth_failed' | 'disabled';
  accepted?: string[];
  rejected?: Array<{ match_id: string; reason: string }>;
}

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastAttempt: string | null;
  lastSuccess: string | null;
  consecutiveFailures: number;
}

/**
 * Contrato mínimo que `CloudSyncService` precisa do buffer local — deliberadamente menor que
 * `MatchRecord` (Tarefa C0): o worker só olha `match_id` para decidir o que marcar sincronizado;
 * o resto do objeto viaja intacto (via `JSON.stringify`) até `POST /v1/matches`, sem que este
 * arquivo precise conhecer sua forma completa.
 */
export interface PendingMatch {
  match_id: string;
}

export interface SyncBuffer {
  getPendingMatches(): PendingMatch[];
  markMatchSynced(matchId: string): void;
  countPending(): number;
}

export interface CloudSyncOptions {
  /** `null` = nenhuma nuvem configurada — o modo em que todo desenvolvimento local roda hoje. */
  base: string | null;
  /**
   * Função, não string: uma string capturada aqui congelaria um token expirado para sempre. O
   * operador troca o token no Secret Manager e o daemon precisa reler o valor atual a cada
   * tentativa, sem reiniciar o processo.
   */
  token: string | null | (() => string | null);
  fetchImpl?: typeof fetch;
  /** Injetável para que testes de backoff sejam determinísticos. Default: `Math.random`. */
  jitter?: () => number;
}

/** Teto do lote de `POST /v1/matches`, o mesmo `MAX_BATCH_SIZE` de `packages/cloud-api/src/index.ts` (Spec 05 §5). */
const BATCH_SIZE = 50;

export class CloudSyncService {
  static readonly MAX_BACKOFF_MS = 5 * 60_000;
  private static readonly BASE_BACKOFF_MS = 2_000;

  private readonly buffer: SyncBuffer;
  private readonly base: string | null;
  private readonly tokenOpt: string | null | (() => string | null);
  private readonly fetchImpl: typeof fetch;
  private readonly jitter: () => number;

  private state: SyncState;
  private lastAttempt: string | null = null;
  private lastSuccess: string | null = null;
  private consecutiveFailures = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(buffer: SyncBuffer, options: CloudSyncOptions) {
    this.buffer = buffer;
    this.base = options.base;
    this.tokenOpt = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.jitter = options.jitter ?? Math.random;
    this.state = this.base && this.resolveToken() ? 'ok' : 'disabled';
  }

  private resolveToken(): string | null {
    return typeof this.tokenOpt === 'function' ? this.tokenOpt() : this.tokenOpt;
  }

  /**
   * Exponencial com jitter. O jitter evita que várias estações reconectem em uníssono.
   * O clamp final (ausente na fórmula de referência) garante que o retorno nunca ultrapasse
   * `MAX_BACKOFF_MS` mesmo no pior sorteio de jitter (+20%) — sem ele, o "teto de 5 minutos"
   * prometido no nome do método deixa de ser garantido perto da fronteira de saturação.
   */
  backoffMsFor(consecutiveFailures: number): number {
    const raw = CloudSyncService.BASE_BACKOFF_MS * 2 ** Math.min(consecutiveFailures - 1, 10);
    const capped = Math.min(raw, CloudSyncService.MAX_BACKOFF_MS);
    const jittered = Math.round(capped * (0.8 + this.jitter() * 0.4));
    return Math.min(jittered, CloudSyncService.MAX_BACKOFF_MS);
  }

  private classify(res: Response | null, error: unknown): SyncState {
    if (error) return 'retrying';                     // rede, DNS, timeout: transitório
    if (res!.status === 401 || res!.status === 403) return 'auth_failed';
    if (res!.ok) return 'ok';
    return 'retrying';                                 // 5xx e o resto: o servidor volta
  }

  async syncNow(): Promise<SyncOutcome> {
    const base = this.base;
    const token = this.resolveToken();

    if (!base || !token) {
      this.state = 'disabled';
      return { status: 'disabled' };
    }

    // A leitura do buffer local pode lançar de forma síncrona -- o caso real é
    // SQLiteBufferService.getPendingMatches() rodando JSON.parse em telemetry_json/ship_spec_json
    // de uma linha corrompida. Sem este try/catch, essa exceção vira uma rejeição da Promise
    // devolvida por syncNow(), e os dois pontos que chamam syncNow() em modo fire-and-forget
    // (`void cloudSync.syncNow()` em index.ts, e `void this.syncNow().finally(...)` em start()
    // logo abaixo -- `.finally()` não suprime rejeição) não têm `.catch()`. Uma promise rejeitada
    // sem handler é um unhandledRejection, que em Node >= 15 derruba o processo inteiro por
    // padrão -- trocando "o buffer não drena" por "o daemon do estande caiu", exatamente o oposto
    // do que este worker existe para resolver. Tratado aqui como uma falha transitória igual a
    // uma falha de rede: um problema de dado numa linha não significa que a nuvem não vai aceitar
    // as outras no próximo ciclo.
    let pending: PendingMatch[];
    try {
      pending = this.buffer.getPendingMatches();
    } catch {
      this.lastAttempt = new Date().toISOString();
      this.state = 'retrying';
      this.consecutiveFailures += 1;
      return { status: 'failed' };
    }
    this.lastAttempt = new Date().toISOString();

    if (pending.length === 0) {
      this.state = 'ok';
      this.consecutiveFailures = 0;
      this.lastSuccess = this.lastAttempt;
      return { status: 'ok', accepted: [], rejected: [] };
    }

    // Corte de lote no worker, não só na query do buffer: getPendingMatches() de um buffer real
    // (SQLite) já limita a 50 linhas, mas este contrato não pode depender desse detalhe de
    // implementação para respeitar o teto de POST /v1/matches (Spec 05 §5).
    const batch = pending.slice(0, BATCH_SIZE);

    console.log(
      `[CloudSync] Sync attempt starting -- ${batch.length}/${pending.length} pending match(es) in this batch.`
    );

    let res: Response | null = null;
    let error: unknown = null;
    try {
      res = await this.fetchImpl(`${base.replace(/\/+$/, '')}/v1/matches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ matches: batch })
      });
    } catch (e) {
      error = e;
    }

    const classification = this.classify(res, error);

    // Log only on the transition, not on every attempt: auth_failed keeps retrying every 5
    // minutes by design (see class doc comment), so logging every attempt would just spam the
    // console for as long as the token stays wrong.
    if (classification === 'auth_failed' && this.state !== 'auth_failed') {
      console.warn(
        '[CloudSync] Cloud API rejected the ingest token (401/403) -- backing off to the ' +
        `${CloudSyncService.MAX_BACKOFF_MS / 60_000}-minute ceiling until BOOTH_INGEST_TOKEN is rotated. ` +
        'This is not a network problem; retries alone will not fix it.'
      );
    } else if (this.state === 'auth_failed' && classification === 'ok') {
      console.log('[CloudSync] Ingest token accepted again -- resuming normal sync, no restart needed.');
    } else if (classification === 'retrying') {
      // Not gated on a state transition like auth_failed above: a plain network/5xx failure is
      // exactly the kind of attempt the operator needs to see happening in real time, every time,
      // while it's happening -- unlike auth_failed, this doesn't repeat on a 5-minute ceiling, it
      // repeats on the growing backoff computed below, and each attempt is a distinct data point
      // (server back up yet? still down?).
      console.warn(
        `[CloudSync] Sync attempt failed (${res ? `HTTP ${res.status}` : 'network error, no response'}) -- ` +
        `${this.consecutiveFailures + 1} consecutive failure(s) so far.`
      );
    }
    this.state = classification;

    if (classification !== 'ok') {
      this.consecutiveFailures += 1;
      return { status: classification === 'auth_failed' ? 'auth_failed' : 'failed' };
    }

    this.consecutiveFailures = 0;
    this.lastSuccess = this.lastAttempt;

    let body: { accepted?: unknown; rejected?: unknown } = {};
    try {
      body = await res!.json();
    } catch {
      // 2xx sem corpo JSON válido não pode travar o worker: trata como "nada aceito ainda".
      body = {};
    }
    const accepted = Array.isArray(body.accepted) ? (body.accepted as string[]) : [];
    const rejected = Array.isArray(body.rejected)
      ? (body.rejected as Array<{ match_id: string; reason: string }>)
      : [];

    console.log(
      `[CloudSync] Sync attempt ok -- ${accepted.length} accepted, ${rejected.length} rejected.`
    );

    for (const matchId of accepted) {
      try {
        this.buffer.markMatchSynced(matchId);
      } catch {
        // Mesma lógica de proteção contra unhandledRejection acima, aplicada ao outro lado do
        // buffer: a nuvem já aceitou o lote (a rede funcionou -- isto não é um 'retrying'), então
        // uma falha ao GRAVAR o bit local de "sincronizado" não pode derrubar o worker nem
        // desclassificar um sync que teve sucesso. Pior caso: esta partida específica continua
        // pendente e é reenviada no próximo ciclo -- inofensivo, porque `POST /v1/matches` (Tarefa
        // C3) é idempotente por match_id.
      }
    }

    return { status: 'ok', accepted, rejected };
  }

  status(): SyncStatus {
    return {
      state: this.state,
      pending: this.buffer.countPending(),
      lastAttempt: this.lastAttempt,
      lastSuccess: this.lastSuccess,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * Laço que se reagenda sozinho em vez de `setInterval` fixo: em operação normal, roda a cada
   * `intervalMs` (30s no bootstrap real). Depois de uma falha, a próxima tentativa usa
   * `backoffMsFor` em vez do intervalo fixo — e em `auth_failed` especificamente, pula direto
   * para `MAX_BACKOFF_MS`: tentativas rápidas não resolvem um token inválido, mas o worker
   * continua vivo porque o token pode ser corrigido a qualquer momento sem reiniciar nada.
   */
  start(intervalMs = 30_000): void {
    if (this.timer) return;

    const tick = (): void => {
      void this.syncNow().finally(() => {
        const delay = this.state === 'auth_failed'
          ? CloudSyncService.MAX_BACKOFF_MS
          : this.consecutiveFailures > 0
            ? this.backoffMsFor(this.consecutiveFailures)
            : intervalMs;
        // Only worth announcing when it deviates from the steady-state 30s heartbeat -- that's
        // exactly the number an operator can't otherwise get without asking someone to compute
        // backoffMsFor(consecutiveFailures) by hand mid-outage.
        if (this.state !== 'ok') {
          console.log(
            `[CloudSync] Next sync attempt in ${Math.round(delay / 1000)}s ` +
            `(state=${this.state}, consecutiveFailures=${this.consecutiveFailures}).`
          );
        }
        this.timer = setTimeout(tick, delay);
      });
    };

    this.timer = setTimeout(tick, 0);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
