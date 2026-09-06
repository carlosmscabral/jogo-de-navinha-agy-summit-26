/**
 * Catálogo de empresas — uma fonte de verdade, servida com cache.
 *
 * Antes disto havia até quatro catálogos potencialmente divergentes: o `config/companies.json`
 * do disco de cada Mac do estande, a cópia embutida na imagem do container, e o documento
 * `companies/catalog` que o painel de admin edita e que **nenhum código lia**. O editor de
 * empresas do painel era um no-op.
 *
 * Isso deixou de ser um detalhe cosmético quando o evento passou a ter dois estandes contra o
 * mesmo placar. `company_canonical` é o *ID do documento* em `company_rankings`: catálogos
 * divergentes fazem a mesma empresa virar dois documentos, e o pior caso é silencioso — se o
 * Mac A tem "Itaú Unibanco" e o Mac B tem "Itau", os DOIS resolvem com confiança alta, nenhum
 * é marcado com `needs_company_review` (o limiar é 0,80) e a varredura de canonicalização
 * nunca os enxerga. A divergência é permanente.
 *
 * Este módulo faz do documento do Firestore a fonte única, com o arquivo em disco rebaixado a
 * semente e rede de segurança. Ele é consumido pela varredura de canonicalização, pela rota
 * `POST /v1/canonicalize` e por `GET /v1/companies`, que é como o catálogo chega aos estandes.
 *
 * A propriedade que o resto do sistema depende: **`get()` nunca lança e nunca devolve `[]`
 * quando existe uma semente de disco não vazia.** Um catálogo vazio não é um estado neutro —
 * é a instrução, no prompt de canonicalização, de que nenhum nome pode ser casado.
 */
import { type Firestore } from 'firebase-admin/firestore';
import { type CompanyCatalogDocument } from '@jogo/shared';

/**
 * A varredura é disparada sem `await` e ninguém espera por ela; uma leitura a mais por minuto
 * no Firestore é irrelevante perto do custo de servir um catálogo obsoleto às duas estações.
 * Este TTL é também o atraso máximo entre um "Salvar" no painel e o efeito nas instâncias do
 * Cloud Run que não atenderam aquela requisição (a que atendeu invalida o cache na hora).
 */
export const DEFAULT_CATALOG_TTL_MS = 60_000;

const CATALOG_COLLECTION = 'companies';
const CATALOG_DOC_ID = 'catalog';

export interface CompanyCatalogSnapshot {
  companies: string[];
  /**
   * Muda a cada gravação pelo painel. É o que permite ao daemon puxar o catálogo a cada tick e
   * só reaplicar quando algo de fato mudou, em vez de difar o SQLite inteiro toda vez.
   * `0` significa "nunca gravado pelo painel" — o que está valendo é a semente de disco.
   */
  version: number;
  /** De onde este conteúdo veio. Só para observabilidade e para o teste poder afirmar o ramo. */
  source: 'firestore' | 'disk' | 'stale-cache';
}

export interface CompanyCatalogProviderOptions {
  /** Leitura do documento. Injetada para o teste rodar sem emulador. */
  read: () => Promise<CompanyCatalogDocument | null>;
  /** `config/companies.json`, lido uma vez na construção. Semente e último recurso. */
  diskSeed: string[];
  ttlMs?: number;
  now?: () => number;
  /**
   * Chamado quando o documento não existe (ou está vazio) e a semente de disco assumiu.
   * Fire-and-forget: quem passa isto grava o documento para que o painel abra com a lista
   * certa em vez de com uma lista vazia que um "Salvar" descuidado transformaria no catálogo
   * de verdade das duas estações.
   */
  onSeedNeeded?: (seed: string[]) => void;
}

export interface CompanyCatalogProvider {
  get(): Promise<CompanyCatalogSnapshot>;
  /** Chamado logo após uma gravação bem-sucedida, para o próximo `get()` não servir o obsoleto. */
  invalidate(): void;
}

export function createCompanyCatalogProvider(
  opts: CompanyCatalogProviderOptions
): CompanyCatalogProvider {
  const ttlMs = opts.ttlMs ?? DEFAULT_CATALOG_TTL_MS;
  const now = opts.now ?? (() => Date.now());

  let cached: CompanyCatalogSnapshot | null = null;
  let cachedAt = 0;
  /** Evita repetir a semeadura a cada TTL enquanto a gravação de fato não acontece. */
  let seedAnnounced = false;

  const fromDisk = (): CompanyCatalogSnapshot => ({
    companies: opts.diskSeed,
    version: 0,
    source: 'disk'
  });

  return {
    invalidate(): void {
      cached = null;
      cachedAt = 0;
    },

    async get(): Promise<CompanyCatalogSnapshot> {
      if (cached && now() - cachedAt < ttlMs) return cached;

      let doc: CompanyCatalogDocument | null;
      try {
        doc = await opts.read();
      } catch (err) {
        // Firestore fora do ar não pode virar "catálogo vazio". Preferir, nesta ordem: o último
        // conteúdo bom que vimos (mesmo vencido — obsoleto é melhor que ausente), depois o disco.
        console.warn('[company-catalog] leitura falhou, servindo fallback:', err);
        if (cached) return { ...cached, source: 'stale-cache' };
        return fromDisk();
      }

      const companies = Array.isArray(doc?.companies)
        ? doc!.companies.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : [];

      if (companies.length === 0) {
        // Documento ausente ou vazio: o disco assume e pede a semeadura. Deliberado que um
        // documento vazio caia aqui em vez de ser servido como está — ver o cabeçalho.
        if (!seedAnnounced && opts.diskSeed.length > 0 && opts.onSeedNeeded) {
          seedAnnounced = true;
          opts.onSeedNeeded(opts.diskSeed);
        }
        const snapshot = fromDisk();
        cached = snapshot;
        cachedAt = now();
        return snapshot;
      }

      const snapshot: CompanyCatalogSnapshot = {
        companies,
        version: typeof doc?.version === 'number' ? doc.version : 1,
        source: 'firestore'
      };
      cached = snapshot;
      cachedAt = now();
      seedAnnounced = false;
      return snapshot;
    }
  };
}

/** A leitura real, separada da fábrica para o teste não precisar de emulador. */
export function firestoreCatalogReader(db: Firestore): () => Promise<CompanyCatalogDocument | null> {
  return async () => {
    const snap = await db.collection(CATALOG_COLLECTION).doc(CATALOG_DOC_ID).get();
    return snap.exists ? (snap.data() as CompanyCatalogDocument) : null;
  };
}
