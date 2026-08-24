/**
 * Moderation and profanity filter for Summit Callsigns and Public Display Names.
 * Protects the public Leaderboard TV from inappropriate words, leet-speak insults, and spam.
 */

// Normalized dictionary of offensive terms (PT-BR and EN)
const BLOCKED_WORDS = [
  // PT-BR
  'porra', 'caralho', 'puta', 'puto', 'foda', 'foder', 'fodase', 'fudeu',
  'merda', 'bosta', 'viado', 'bicha', 'cuzão', 'cuzao', 'cusao', 'arrombado',
  'buceta', 'piroca', 'pica', 'pau', 'chupeta', 'otario', 'babaca', 'escroto',
  'vagabundo', 'vadia', 'corno', 'desgracado', 'nazista', 'hitler', 'racista',
  'estupro', 'pedofilo', 'cacete', 'fela', 'filhadaputa', 'fdp', 'krl', 'pqp',
  'toba', 'tomanocu', 'tomanocool', 'tomarnocu', 'vtnc', 'vsf',

  // EN
  'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'asshole', 'bastard', 'cunt',
  'dick', 'cock', 'pussy', 'nigger', 'nigga', 'faggot', 'nazi', 'whore',
  'slut', 'retard', 'terrorist', 'kill', 'murder', 'suicide'
];

/**
 * Minimum length a blocked term needs before it is also searched as a *substring* of the dense
 * leet-normalized form. See the containment check in `validateCallsign` for why this is 5 and
 * not 4.
 */
const CONTAINMENT_MIN_LENGTH = 5;

/**
 * The safe-by-construction stand-in for a callsign that cannot go on the TV. Exported because
 * layer 2 (the Vertex check in `packages/daemon/src/index.ts`) reaches the same outcome by a
 * different route and must produce the same shape of name -- a visitor whose veiled insult the
 * model caught should be indistinguishable, on the leaderboard, from one whose plain profanity
 * the local dictionary caught.
 */
export function placeholderCallsign(): string {
  return `PILOTO_${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * Normalizes leet-speak (e.g., "p0rr4" -> "porra", "f*ck" -> "fck", "b!ch@" -> "bicha")
 */
function normalizeLeetSpeak(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/!/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/@/g, 'a')
    .replace(/5/g, 's')
    .replace(/\$/g, 's')
    .replace(/7/g, 't')
    .replace(/\+/g, 't')
    .replace(/8/g, 'b')
    .replace(/[^a-z0-9]/g, ''); // Keep only alphanumeric for dense match
}

export interface CallsignValidationResult {
  isValid: boolean;
  reason?: string;
  reasonCode?: 'empty' | 'too_short' | 'too_long' | 'invalid_chars' | 'repetitive' | 'profanity';
  sanitized: string;
}

export function validateCallsign(rawCallsign: string): CallsignValidationResult {
  const trimmed = (rawCallsign || '').trim();

  if (!trimmed) {
    return {
      isValid: false,
      reason: 'O Callsign não pode estar em branco.',
      reasonCode: 'empty',
      sanitized: 'PILOTO_001'
    };
  }

  if (trimmed.length < 3) {
    return {
      isValid: false,
      reason: 'O Callsign deve ter pelo menos 3 caracteres.',
      reasonCode: 'too_short',
      sanitized: trimmed.toUpperCase()
    };
  }

  if (trimmed.length > 15) {
    return {
      isValid: false,
      reason: 'O Callsign deve ter no máximo 15 caracteres.',
      reasonCode: 'too_long',
      sanitized: trimmed.slice(0, 15).toUpperCase()
    };
  }

  // Check allowed characters: letters, numbers, hyphens, underscores and spaces
  const allowedPattern = /^[A-Za-z0-9 _-]+$/;
  if (!allowedPattern.test(trimmed)) {
    return {
      isValid: false,
      reason: 'Caracteres especiais não permitidos (use apenas letras, números e traço).',
      reasonCode: 'invalid_chars',
      sanitized: trimmed.replace(/[^A-Za-z0-9 _-]/g, '').toUpperCase().slice(0, 15) || 'PILOTO_001'
    };
  }

  // Check for obvious keyboard mash (e.g., "AAAAAA", "XXXXXX")
  const isRepetitive = /^(.)\1{4,}$/.test(trimmed);
  if (isRepetitive) {
    return {
      isValid: false,
      reason: 'Por favor, escolha um codinome identificável para o telão.',
      reasonCode: 'repetitive',
      sanitized: trimmed.toUpperCase()
    };
  }

  // Check profanity against raw words and leet-speak normalized forms
  const denseLeet = normalizeLeetSpeak(trimmed);
  const words = trimmed.toLowerCase().split(/[\s_-]+/);
  // Per-word leet normalization keeps evasions like "p0rr4" or "sh1t" caught by exact match, so
  // the substring pass below no longer has to reach down to 4-letter terms to stay useful.
  const leetWords = words.map(normalizeLeetSpeak);

  for (const blocked of BLOCKED_WORDS) {
    // Exact word match, raw or leet-normalized
    if (words.includes(blocked) || leetWords.includes(blocked)) {
      return {
        isValid: false,
        reason: 'Termo impróprio ou não permitido no evento.',
        reasonCode: 'profanity',
        sanitized: placeholderCallsign()
      };
    }

    // Substring search on the dense form catches profanity concatenated into a single token
    // ("porraloka"), but it cannot tell a deliberate evasion from an innocent word that merely
    // contains the term. At length 4 it blocked SKILLER, SKILL, KILLJOY (kill), COCKPIT (cock)
    // and PICANHA (pica) -- all plausible callsigns (Spec 06, "o casamento por containment
    // super-bloqueia"; confirmed live in Gate M3). Raising the floor to 5 drops exactly those
    // false positives: the 4-letter terms stay covered by the exact-match pass above, and
    // anything concatenated that still slips through is layer 2's job.
    if (blocked.length >= CONTAINMENT_MIN_LENGTH && denseLeet.includes(blocked)) {
      return {
        isValid: false,
        reason: 'Termo impróprio ou não permitido no evento.',
        reasonCode: 'profanity',
        sanitized: placeholderCallsign()
      };
    }
  }

  return {
    isValid: true,
    sanitized: trimmed.toUpperCase()
  };
}
