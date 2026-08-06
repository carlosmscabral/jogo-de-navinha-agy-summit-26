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

export interface CompanyResolutionResult {
  raw: string;
  canonical: string;
  confidence: number;
  matchedBy: 'exact' | 'suffix_strip' | 'fuzzy' | 'fallback';
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
      canonical: 'Google',
      confidence: 1.0,
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
  for (const canon of canonicalCatalog) {
    const cLower = canon.toLowerCase();
    if (rawLower.includes(cLower) || (cleanedInput.length >= 4 && cleanedInput.includes(cleanCompanyName(canon)))) {
      return {
        raw: rawTrimmed,
        canonical: canon,
        confidence: 0.90,
        matchedBy: 'suffix_strip'
      };
    }
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
    canonical: formatted,
    confidence: 0.50,
    matchedBy: 'fallback'
  };
}
