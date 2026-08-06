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
  sanitized: string;
}

export function validateCallsign(rawCallsign: string): CallsignValidationResult {
  const trimmed = (rawCallsign || '').trim();

  if (!trimmed) {
    return {
      isValid: false,
      reason: 'O Callsign não pode estar em branco.',
      sanitized: 'PILOTO_001'
    };
  }

  if (trimmed.length < 3) {
    return {
      isValid: false,
      reason: 'O Callsign deve ter pelo menos 3 caracteres.',
      sanitized: trimmed.toUpperCase()
    };
  }

  if (trimmed.length > 15) {
    return {
      isValid: false,
      reason: 'O Callsign deve ter no máximo 15 caracteres.',
      sanitized: trimmed.slice(0, 15).toUpperCase()
    };
  }

  // Check allowed characters: letters, numbers, hyphens, underscores and spaces
  const allowedPattern = /^[A-Za-z0-9 _-]+$/;
  if (!allowedPattern.test(trimmed)) {
    return {
      isValid: false,
      reason: 'Caracteres especiais não permitidos (use apenas letras, números e traço).',
      sanitized: trimmed.replace(/[^A-Za-z0-9 _-]/g, '').toUpperCase().slice(0, 15) || 'PILOTO_001'
    };
  }

  // Check for obvious keyboard mash (e.g., "AAAAAA", "XXXXXX")
  const isRepetitive = /^(.)\1{4,}$/.test(trimmed);
  if (isRepetitive) {
    return {
      isValid: false,
      reason: 'Por favor, escolha um codinome identificável para o telão.',
      sanitized: trimmed.toUpperCase()
    };
  }

  // Check profanity against raw words and leet-speak normalized forms
  const denseLeet = normalizeLeetSpeak(trimmed);
  const words = trimmed.toLowerCase().split(/[\s_-]+/);

  for (const blocked of BLOCKED_WORDS) {
    // Exact word match
    if (words.includes(blocked)) {
      return {
        isValid: false,
        reason: 'Termo impróprio ou não permitido no evento.',
        sanitized: `PILOTO_${Math.floor(100 + Math.random() * 900)}`
      };
    }

    // Leet speak containment match (for blocked words with length >= 4)
    if (blocked.length >= 4 && denseLeet.includes(blocked)) {
      return {
        isValid: false,
        reason: 'Termo impróprio ou não permitido no evento.',
        sanitized: `PILOTO_${Math.floor(100 + Math.random() * 900)}`
      };
    }
  }

  return {
    isValid: true,
    sanitized: trimmed.toUpperCase()
  };
}
