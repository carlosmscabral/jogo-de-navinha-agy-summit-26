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
 * leet-normalized form. See the containment check in `containsProfanity` for why this is 5 and
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

/**
 * Roda o dicionário (palavra exata, forma leet e containment) contra um texto qualquer.
 *
 * Extraída do corpo de `validateCallsign` em 2026-09-13 para fechar a issue #9. O corpo antigo só
 * chegava a esta checagem depois de passar por tamanho, caracteres e repetição -- e cada uma
 * dessas recusas devolvia em `sanitized` um pedaço do texto do próprio visitante, SEM nunca ter
 * sido comparado ao dicionário. Um palavrão de 16 caracteres saía por `too_long` carregando os 15
 * primeiros, e um palavrão pontuado saía por `invalid_chars` com a pontuação removida.
 *
 * EXPORTADA em 2026-09-14 pela issue #26. Quem precisa moderar um texto que NÃO é um callsign --
 * o nome de empresa, em `SQLiteBufferService.resolveCompany` -- tem que chamar isto, e não
 * `validateCallsign`. O campo empresa não tem teto de 15 caracteres nem alfabeto restrito, então
 * rodar o validador de callsign nele fazia `reasonCode` sair como `too_long` ANTES de o dicionário
 * ser consultado: "Porra Consultoria Ltda" passava inteiro para o telão. É o mesmo defeito da #9,
 * no outro campo -- lá a correção foi tornar `sanitized` seguro; aqui, quem chama só quer o
 * veredito do dicionário e não tem uso para `sanitized` nenhum.
 */
export function containsProfanity(text: string): boolean {
  const words = text.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  // Per-word leet normalization keeps evasions like "p0rr4" or "sh1t" caught by exact match, so
  // the substring pass below no longer has to reach down to 4-letter terms to stay useful.
  const leetWords = words.map(normalizeLeetSpeak).filter(Boolean);
  const dense = denseForm(leetWords);

  for (const blocked of BLOCKED_WORDS) {
    // Exact word match, raw or leet-normalized
    if (words.includes(blocked) || leetWords.includes(blocked)) {
      return true;
    }

    // Substring search on the dense form catches profanity concatenated into a single token
    // ("porraloka"), but it cannot tell a deliberate evasion from an innocent word that merely
    // contains the term. At length 4 it blocked SKILLER, SKILL, KILLJOY (kill), COCKPIT (cock)
    // and PICANHA (pica) -- all plausible callsigns (Spec 06, "o casamento por containment
    // super-bloqueia"; confirmed live in Gate M3). Raising the floor to 5 drops exactly those
    // false positives: the 4-letter terms stay covered by the exact-match pass above, and
    // anything concatenated that still slips through is layer 2's job. Onde o casamento pode
    // cair dentro da forma densa é assunto de `containsAtWordBoundary` (issue #33).
    if (blocked.length >= CONTAINMENT_MIN_LENGTH && containsAtWordBoundary(dense, blocked)) {
      return true;
    }
  }

  return false;
}

interface DenseForm {
  /** As palavras já normalizadas, concatenadas -- a forma em que a busca por containment roda. */
  text: string;
  /** Onde cada palavra começa e termina dentro de `text`. */
  spans: Array<{ start: number; end: number }>;
  starts: Set<number>;
  ends: Set<number>;
}

function denseForm(leetWords: string[]): DenseForm {
  const spans: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const word of leetWords) {
    spans.push({ start: cursor, end: cursor + word.length });
    cursor += word.length;
  }
  return {
    text: leetWords.join(''),
    spans,
    starts: new Set(spans.map((s) => s.start)),
    ends: new Set(spans.map((s) => s.end))
  };
}

/**
 * Containment na forma densa, mas só onde ele quer dizer alguma coisa.
 *
 * `normalizeLeetSpeak` apaga os separadores, e é isso que dá ao containment o poder de pegar o
 * palavrão escrito com espaço no meio. O preço, até 2026-09-14, era casar TAMBÉM através da
 * fronteira entre duas palavras, em pedaços que não existem em nenhuma delas: "TURBO STAR" virava
 * `turbostar` e reprovava por "bosta", "NOVA DIAG" por "vadia", "VAPOR RAPIDO" por "porra". No
 * campo callsign o visitante levava "Termo impróprio" na cara sem entender por quê; no campo
 * empresa, depois da issue #26 estender o dicionário aos nomes longos, "Nova Diagnósticos" virava
 * `Independente` no telão (issue #33).
 *
 * O que separa a evasão do acaso é o ALINHAMENTO. Um casamento vale quando:
 *
 *  (a) cabe inteiro dentro de UMA palavra -- é a concatenação deliberada, "porraloka"; ou
 *  (b) consome um número inteiro de palavras, começando no início de uma e terminando no fim de
 *      outra -- é a evasão por separador, "P O R R A Ltda" e "Po rra Consultoria".
 *
 * O que sobra -- entrar pela metade de uma palavra e sair pela metade de outra -- nunca é evasão,
 * porque quem quer burlar o filtro não tem motivo para enterrar letras de sobra nas duas pontas.
 * É só acaso, e é exatamente o acaso que reprovava nomes legítimos.
 */
function containsAtWordBoundary(dense: DenseForm, blocked: string): boolean {
  for (let at = dense.text.indexOf(blocked); at !== -1; at = dense.text.indexOf(blocked, at + 1)) {
    const until = at + blocked.length;
    const dentroDeUmaPalavra = dense.spans.some((s) => s.start <= at && until <= s.end);
    if (dentroDeUmaPalavra || (dense.starts.has(at) && dense.ends.has(until))) {
      return true;
    }
  }
  return false;
}

/**
 * A INVARIANTE desta função: `sanitized` é sempre um nome que pode ir ao telão, qualquer que
 * tenha sido o motivo da recusa. `packages/daemon/src/services/pending-moderation.ts` depende
 * disto por escrito para pular a camada 2 quando a camada 1 já reprovou -- se um dia um caminho
 * de recusa voltar a devolver texto cru do visitante, aquele atalho vira um buraco, porque as
 * duas camadas são contornadas de uma vez só (issue #9).
 */
function safeSanitized(candidate: string): string {
  return containsProfanity(candidate) ? placeholderCallsign() : candidate;
}

export interface CallsignValidationResult {
  isValid: boolean;
  reason?: string;
  reasonCode?: 'empty' | 'too_short' | 'too_long' | 'invalid_chars' | 'repetitive' | 'profanity';
  /**
   * Nome seguro para exibição, SEMPRE -- inclusive quando `isValid` é false. Ver `safeSanitized`.
   */
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
      sanitized: safeSanitized(trimmed.toUpperCase())
    };
  }

  if (trimmed.length > 15) {
    return {
      isValid: false,
      reason: 'O Callsign deve ter no máximo 15 caracteres.',
      reasonCode: 'too_long',
      sanitized: safeSanitized(trimmed.slice(0, 15).toUpperCase())
    };
  }

  // Check allowed characters: letters, numbers, hyphens, underscores and spaces
  const allowedPattern = /^[A-Za-z0-9 _-]+$/;
  if (!allowedPattern.test(trimmed)) {
    return {
      isValid: false,
      reason: 'Caracteres especiais não permitidos (use apenas letras, números e traço).',
      reasonCode: 'invalid_chars',
      sanitized: safeSanitized(
        trimmed.replace(/[^A-Za-z0-9 _-]/g, '').toUpperCase().slice(0, 15) || 'PILOTO_001'
      )
    };
  }

  // Check for obvious keyboard mash (e.g., "AAAAAA", "XXXXXX")
  const isRepetitive = /^(.)\1{4,}$/.test(trimmed);
  if (isRepetitive) {
    return {
      isValid: false,
      reason: 'Por favor, escolha um codinome identificável para o telão.',
      reasonCode: 'repetitive',
      sanitized: safeSanitized(trimmed.toUpperCase())
    };
  }

  // Check profanity against raw words and leet-speak normalized forms
  if (containsProfanity(trimmed)) {
    return {
      isValid: false,
      reason: 'Termo impróprio ou não permitido no evento.',
      reasonCode: 'profanity',
      sanitized: placeholderCallsign()
    };
  }

  return {
    isValid: true,
    sanitized: trimmed.toUpperCase()
  };
}
