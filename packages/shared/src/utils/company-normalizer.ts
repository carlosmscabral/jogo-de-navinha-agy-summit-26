/**
 * Proactive Company Normalizer & Fuzzy Matcher.
 * Normalizes variations (e.g. "Google Brasil", "nu bank", "Itau Unibanco S.A.")
 * into canonical corporate entities using suffix stripping and Levenshtein similarity.
 */

// Corporate suffixes and geographic qualifiers to strip during matching
const CORPORATE_SUFFIX_REGEX = /\b(ltda|s\.?a\.?|inc|corp|corporation|brasil|brazil|group|grupo|me|eireli|servicos|tecnologia|tech|solutions|solucoes|banco|bank|unibanco|seguros|sistemas)\b/gi;

/**
 * Calculates Levenshtein edit distance between two strings
 */
export function calculateLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Returns a normalized similarity score from 0.0 (completely different) to 1.0 (exact match)
 */
export function calculateSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const maxLen = Math.max(s1.length, s2.length);
  const distance = calculateLevenshteinDistance(s1, s2);
  return Math.max(0, 1.0 - distance / maxLen);
}

/**
 * Strips corporate legal suffixes and cleans whitespaces
 */
export function cleanCompanyName(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents for comparison
    .replace(CORPORATE_SUFFIX_REGEX, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Piso de tamanho do TERMO DO CATÁLOGO procurado como substring no passo 3, contado em letras e
 * dígitos. Mesma ideia do `CONTAINMENT_MIN_LENGTH` de `moderation.ts`, e pela mesma razão: termo
 * curto demais cabe dentro de qualquer coisa.
 *
 * O piso é 3, e não 4, porque o catálogo do evento é feito de sigla brasileira de três letras --
 * TIM, SAP, GOL, CVC, MRV, CSN, UOL, OLX, FGV, PRF. Medido sobre 1287 linhas de um CRM real:
 * exigir 4 letras tirava 73 entradas do passo 3 e custava 49 linhas para economizar 3.
 *
 * Contar LETRAS, e não caracteres, é o que fecha o caso patológico. `cleanCompanyName` come o
 * sufixo "tech" e transforma "J&F Tech" em "j f" -- três caracteres, duas letras -- que casava
 * dentro de "N J F INDUSTRIA E COMERCIO DE MOVEIS". Pior: transforma "Brasil Tecnologia" em
 * string VAZIA, e `''` é substring de tudo, então aquela entrada casava com TODA empresa.
 */
const CONTAINMENT_MIN_WORD_CHARS = 3;

function countWordChars(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) || []).length;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Containment que só vale quando o termo cai alinhado às duas bordas de uma palavra do texto.
 * É a mesma regra que a issue #33 trouxe para a moderação (`containsAtWordBoundary` em
 * `moderation.ts`), aqui aplicada a string crua em vez da forma leet densa: sem ela, o catálogo
 * tem "Cora" e "Três Corações Alimentos" vira Cora.
 *
 * `\p{L}` e não `[a-z]`: com a classe ASCII, o "ç" de "Corações" conta como separador e o
 * alinhamento passa a valer justamente onde não deveria.
 */
function includesAtWordBoundary(haystack: string, needle: string): boolean {
  if (!needle) return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const until = at + needle.length;
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[until])) return true;
  }
  return false;
}

export interface CompanyResolutionResult {
  raw: string;
  canonical: string;
  confidence: number;
  matchedBy: 'exact' | 'suffix_strip' | 'fuzzy' | 'fallback';
}

/**
 * Firestore document-ID rules (used by `company_canonical` as the doc ID of
 * `company_rankings/{company_canonical}` in `packages/cloud-api`): no `/`, not exactly
 * `.` or `..`, must not match `__.*__`, and capped at 1500 bytes UTF-8. A visitor can
 * type anything into the "company" field — this is the shared check both the fallback
 * sanitizer below and `packages/cloud-api/src/ingest.ts`'s `validate()` use, so the two
 * never drift on what counts as "safe enough to become a document ID".
 */
export function isValidFirestoreDocId(id: string): boolean {
  if (!id) return false;
  if (id === '.' || id === '..') return false;
  if (id.includes('/')) return false;
  if (/^__.*__$/.test(id)) return false;
  if (new TextEncoder().encode(id).length > 1500) return false;
  return true;
}

/** Well under Firestore's 1500-byte cap — no legitimate typed company name gets close. */
const MAX_FALLBACK_NAME_LENGTH = 200;

/** Used when sanitization strips a fallback name down to nothing usable. */
const UNSANITIZABLE_COMPANY_PLACEHOLDER = 'Empresa Nao Identificada';

/**
 * Sanitizes a formatted fallback company name so it is always safe to use as a
 * Firestore document ID (see `isValidFirestoreDocId` above). Only the fallback branch
 * of `resolveCompanyFromCatalog` needs this: exact/suffix/fuzzy matches all resolve to
 * a name from the curated catalog, which is trusted; the fallback is the one path where
 * the visitor's raw keystrokes flow through almost unfiltered.
 */
function sanitizeCompanyNameForDocId(formatted: string): string {
  let s = formatted
    .replace(/[^\p{L}\p{N} .&-]/gu, '') // keep letters/numbers/spaces plus a small punctuation set
    .replace(/\s+/g, ' ')
    .trim();

  if (s.length > MAX_FALLBACK_NAME_LENGTH) {
    s = s.slice(0, MAX_FALLBACK_NAME_LENGTH).trim();
  }

  return isValidFirestoreDocId(s) ? s : UNSANITIZABLE_COMPANY_PLACEHOLDER;
}

/**
 * Proactively matches a raw company input against a canonical catalog
 */
export function resolveCompanyFromCatalog(
  rawInput: string,
  canonicalCatalog: string[],
  similarityThreshold = 0.80
): CompanyResolutionResult {
  const rawTrimmed = (rawInput || '').trim();
  if (!rawTrimmed) {
    return {
      raw: '',
      canonical: 'Independente',
      confidence: 0,          // não há o que inferir de uma string vazia
      matchedBy: 'fallback'
    };
  }

  const rawLower = rawTrimmed.toLowerCase();

  // 1. Exact match (case-insensitive)
  for (const canon of canonicalCatalog) {
    if (canon.toLowerCase() === rawLower) {
      return {
        raw: rawTrimmed,
        canonical: canon,
        confidence: 1.0,
        matchedBy: 'exact'
      };
    }
  }

  // 2. Suffix-Stripped Match (e.g. "Google Brasil" -> "Google", "Itaú Unibanco S.A." -> "Itaú")
  const cleanedInput = cleanCompanyName(rawTrimmed);
  for (const canon of canonicalCatalog) {
    const cleanedCanon = cleanCompanyName(canon);
    if (cleanedCanon && cleanedInput === cleanedCanon) {
      return {
        raw: rawTrimmed,
        canonical: canon,
        confidence: 0.95,
        matchedBy: 'suffix_strip'
      };
    }
  }

  // 3. Substring Containment (e.g. "Mercado Livre Brasil" contains "Mercado Livre")
  //
  // Junta TODOS os candidatos contidos e fica com o MAIS ESPECÍFICO -- o de termo mais longo --
  // em vez de devolver o primeiro que aparecer. Devolver o primeiro fazia a ORDEM DO CATÁLOGO
  // escolher o vencedor em silêncio, e essa ordem não é decisão de ninguém: `getCanonicalList()`
  // em `packages/daemon/src/services/sqlite-buffer.ts` a tira de um `ORDER BY name ASC`. Contra
  // o catálogo do evento, só reordenar a lista mexia em dezenas de linhas do resultado.
  //
  // Isto importa mais do que parece porque 0.90 está ACIMA do corte de revisão
  // (`needsCompanyReview` usa `< 0.80`): um casamento errado aqui não passa pela fila do
  // operador -- vai direto para o telão e para `company_rankings`.
  //
  // Empate de termo -- "Unimed" e "Seguros Unimed" limpam os dois para "unimed" -- fica com o
  // nome cru mais curto, que é o que o telão lê melhor.
  let best: string | null = null;
  let bestTermLength = -1;
  let bestNameLength = Infinity;

  for (const canon of canonicalCatalog) {
    const cLower = canon.toLowerCase();
    const cleanedCanon = cleanCompanyName(canon);

    const rawHit =
      countWordChars(cLower) >= CONTAINMENT_MIN_WORD_CHARS && includesAtWordBoundary(rawLower, cLower);
    const cleanedHit =
      countWordChars(cleanedCanon) >= CONTAINMENT_MIN_WORD_CHARS &&
      includesAtWordBoundary(cleanedInput, cleanedCanon);
    if (!rawHit && !cleanedHit) continue;

    const termLength = Math.max(rawHit ? cLower.length : 0, cleanedHit ? cleanedCanon.length : 0);
    if (termLength > bestTermLength || (termLength === bestTermLength && canon.length < bestNameLength)) {
      best = canon;
      bestTermLength = termLength;
      bestNameLength = canon.length;
    }
  }

  if (best) {
    return {
      raw: rawTrimmed,
      canonical: best,
      confidence: 0.90,
      matchedBy: 'suffix_strip'
    };
  }

  // 4. Fuzzy Levenshtein Match against catalog
  let bestMatch = '';
  let highestScore = 0;

  for (const canon of canonicalCatalog) {
    // Compare both directly and cleaned
    const directScore = calculateSimilarity(rawLower, canon.toLowerCase());
    const cleanedScore = calculateSimilarity(cleanedInput, cleanCompanyName(canon));
    const score = Math.max(directScore, cleanedScore);

    if (score > highestScore) {
      highestScore = score;
      bestMatch = canon;
    }
  }

  if (highestScore >= similarityThreshold && bestMatch) {
    return {
      raw: rawTrimmed,
      canonical: bestMatch,
      confidence: Math.round(highestScore * 100) / 100,
      matchedBy: 'fuzzy'
    };
  }

  // 5. Fallback: Formatted Capitalized Name
  const formatted = rawTrimmed
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return {
    raw: rawTrimmed,
    canonical: sanitizeCompanyNameForDocId(formatted),
    confidence: 0.50,
    matchedBy: 'fallback'
  };
}
