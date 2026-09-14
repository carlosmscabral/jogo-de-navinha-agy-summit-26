import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateCallsign, placeholderCallsign, containsProfanity } from './utils/moderation.js';
import {
  resolveCompanyFromCatalog,
  isValidFirestoreDocId
} from './utils/company-normalizer.js';

describe('Moderation & Profanity Filter', () => {
  it('should accept clean valid callsigns', () => {
    const r1 = validateCallsign('CYBER_ACE');
    assert.strictEqual(r1.isValid, true);
    assert.strictEqual(r1.sanitized, 'CYBER_ACE');

    const r2 = validateCallsign('Falcon-99');
    assert.strictEqual(r2.isValid, true);
    assert.strictEqual(r2.sanitized, 'FALCON-99');
  });

  it('should reject empty or too short callsigns', () => {
    const r1 = validateCallsign('');
    assert.strictEqual(r1.isValid, false);

    const r2 = validateCallsign('AB');
    assert.strictEqual(r2.isValid, false);
  });

  it('should reject obvious profanity and leet speak variations', () => {
    const r1 = validateCallsign('PORRA_PILOT');
    assert.strictEqual(r1.isValid, false);

    const r2 = validateCallsign('P0rr4Ace');
    assert.strictEqual(r2.isValid, false);

    const r3 = validateCallsign('f*ck_you');
    assert.strictEqual(r3.isValid, false);
  });

  it('does not block innocent callsigns that merely contain a short blocked term', () => {
    // Spec 06, "o casamento por containment super-bloqueia": substring search at length 4 blocked
    // SKILLER/SKILL/KILLJOY (kill), COCKPIT (cock) and PICANHA (pica). Never fixed until Gate M3
    // caught SKILLER coming back as PILOTO_987 from a live POST /api/session/start.
    for (const callsign of ['SKILLER', 'SKILL', 'KILLJOY', 'COCKPIT', 'PICANHA']) {
      assert.strictEqual(validateCallsign(callsign).isValid, true, callsign);
    }
  });

  it('still catches leet-speak evasion of 4-letter terms after the containment floor moved to 5', () => {
    // These no longer match by containment, so they prove the per-word leet-normalized exact pass
    // carries them -- without it, raising the floor would have quietly opened a hole.
    for (const callsign of ['k1ll', 'sh1t', 'put4', 'f0da']) {
      assert.strictEqual(validateCallsign(callsign).isValid, false, callsign);
    }
  });

  it('should reject repetitive keyboard mash', () => {
    const r1 = validateCallsign('AAAAAAA');
    assert.strictEqual(r1.isValid, false);
  });

  it('placeholderCallsign has the same shape layer 1 produces, so layer 2 is indistinguishable', () => {
    // O daemon chama isto quando a camada 2 (Vertex) reprova (packages/daemon/src/index.ts).
    // Se as duas camadas produzissem formatos diferentes, o telão denunciaria QUAL filtro pegou
    // cada visitante -- e a recusa deixaria de ser silenciosa, que é metade do motivo de
    // sanitizar em vez de devolver 422.
    for (let i = 0; i < 50; i++) {
      assert.match(placeholderCallsign(), /^PILOTO_\d{3}$/);
    }
    assert.match(validateCallsign('PORRA').sanitized, /^PILOTO_\d{3}$/);
  });

  it('exposes a stable reasonCode discriminator, distinct from the free-text reason', () => {
    const profane = validateCallsign('PORRA');
    assert.strictEqual(profane.reasonCode, 'profanity');

    // Um consumidor que precisa agir só sobre palavrão (ex.: SQLiteBufferService.resolveCompany
    // moderando o campo empresa) não pode confundir isto com outros motivos de reprovação —
    // este é o teste que teria pego a lacuna original da Tarefa C0b.
    const tooShort = validateCallsign('AB');
    assert.notStrictEqual(tooShort.reasonCode, 'profanity');
    assert.strictEqual(tooShort.reasonCode, 'too_short');
  });

  // ---------------------------------------------------------------------------------------
  // Issue #9: `sanitized` é seguro em TODO caminho de recusa, não só nos dois que já eram.
  //
  // A ordem das checagens (tamanho, caracteres, repetição, palavrão) fazia com que as três
  // primeiras devolvessem texto do visitante sem nunca ter passado pelo dicionário. Pior: o
  // daemon pula a camada 2 justamente quando a camada 1 reprovou, então as duas camadas eram
  // contornadas de uma vez (packages/daemon/src/services/pending-moderation.ts).
  // ---------------------------------------------------------------------------------------

  it('too_long: o corte em 15 caracteres não pode publicar o palavrão que sobrou', () => {
    // 16 caracteres: sai por tamanho ANTES de o teste de palavrão ser alcançado, e o corte
    // preserva a palavra inteira. Era este o caminho que levava um palavrão ao telão.
    const r = validateCallsign('CARALHO_VOADOR_X');
    assert.strictEqual(r.isValid, false);
    assert.strictEqual(r.reasonCode, 'too_long');
    assert.match(r.sanitized, /^PILOTO_\d{3}$/);
  });

  it('invalid_chars: filtrar a pontuação não pode revelar o palavrão que ela escondia', () => {
    // A pontuação é o que torna o codinome inválido; removê-la é o que monta a palavra.
    const r = validateCallsign('P.O.R.R.A!');
    assert.strictEqual(r.isValid, false);
    assert.strictEqual(r.reasonCode, 'invalid_chars');
    assert.match(r.sanitized, /^PILOTO_\d{3}$/);
  });

  it('recusa inocente continua devolvendo o texto do visitante, não um placeholder', () => {
    // A trava nova não pode virar um "tudo vira PILOTO_xxx": o `sanitized` de uma recusa comum
    // ainda é o que a Tela 1 reexibe para o visitante corrigir.
    assert.strictEqual(validateCallsign('AAAAAAA').sanitized, 'AAAAAAA');
    assert.strictEqual(validateCallsign('AB').sanitized, 'AB');
    assert.strictEqual(validateCallsign('FALCON_NINE_NINE_NINE').sanitized, 'FALCON_NINE_NIN');
    assert.strictEqual(validateCallsign('ÁGUIA').sanitized, 'GUIA');
  });

  it('INVARIANTE: nenhum `sanitized`, de qualquer recusa, reprova no próprio dicionário', () => {
    // É a garantia de que `pending-moderation.ts` cita por escrito para pular a camada 2. Se um
    // caminho de recusa novo aparecer devolvendo texto cru, este teste cai.
    const entradas = [
      '', 'AB', 'PORRA', 'CARALHO_VOADOR_X', 'P.O.R.R.A!', 'AAAAAAA',
      'FUCKING_PILOT_XX', 'F.U.C.K.E.R', 'sh1t_ace_voador_x', 'PILOTO'
    ];
    for (const entrada of entradas) {
      const { sanitized } = validateCallsign(entrada);
      assert.notStrictEqual(
        validateCallsign(sanitized).reasonCode,
        'profanity',
        `sanitized inseguro para a entrada ${JSON.stringify(entrada)}: ${sanitized}`
      );
    }
  });
});

// -----------------------------------------------------------------------------------------
// Issue #26: o dicionário como função própria, para quem modera texto que NÃO é um callsign.
// -----------------------------------------------------------------------------------------

describe('containsProfanity', () => {
  it('não tem teto de tamanho -- é o que separa esta função de validateCallsign', () => {
    // O caso exato da issue #26: 22 caracteres. Pelo validador de callsign isto sai por
    // `too_long`, sem nunca consultar o dicionário; aqui o tamanho não é pergunta nenhuma.
    assert.strictEqual(containsProfanity('Porra Consultoria Ltda'), true);
    assert.strictEqual(containsProfanity('Caralho Tecnologia da Informação S.A.'), true);
    assert.strictEqual(validateCallsign('Porra Consultoria Ltda').reasonCode, 'too_long');
  });

  it('não tem alfabeto restrito: pontuação e acento não escondem o palavrão', () => {
    // Pelo validador de callsign estes saem por `invalid_chars`, também antes do dicionário.
    assert.strictEqual(containsProfanity('P.O.R.R.A Participações'), true);
    assert.strictEqual(containsProfanity('Ítaú'), false);
  });

  it('aprova nome de empresa comum, longo e com sufixo corporativo', () => {
    for (const nome of [
      'Mercado Livre Tecnologia Ltda',
      'Companhia Brasileira de Distribuição',
      'Itaú Unibanco S.A.',
      'Startup do João'
    ]) {
      assert.strictEqual(containsProfanity(nome), false, nome);
    }
  });

  it('mantém o piso de containment em 5: SKILLER e COCKPIT não são palavrão', () => {
    // A mesma decisão da #9 vale aqui, e por um motivo mais forte: um nome de empresa tem
    // muito mais texto em que um termo de 4 letras pode aparecer por acaso.
    for (const nome of ['Skiller Solutions', 'Cockpit Digital', 'Picanha Burger Ltda']) {
      assert.strictEqual(containsProfanity(nome), false, nome);
    }
  });
});

// -----------------------------------------------------------------------------------------
// Issue #33: o containment na forma densa casava ATRAVÉS da fronteira entre palavras.
//
// Os dois primeiros testes são as duas metades da mesma decisão e têm que ser lidos juntos: o
// alinhamento é o que permite liberar o acaso sem liberar a evasão. Quem mexer num tem que
// conferir o outro.
// -----------------------------------------------------------------------------------------

describe('containsProfanity: fronteira entre palavras', () => {
  it('libera o nome legítimo cujo palavrão só existe na emenda de duas palavras', () => {
    // Todos estes eram reprovados na main até 2026-09-14. O pedaço casado nasce da emenda e não
    // existe em nenhuma das duas palavras: turbo|star -> "bosta", nova|diag -> "vadia",
    // vapor|rapido -> "porra", robo|stark -> "bosta", chuva|diagonal -> "vadia".
    for (const texto of [
      'TURBO STAR', 'NOVA DIAG', 'VAPOR RAPIDO', 'ROBO STARK', 'CHUVA DIAGONAL',
      'Nova Diagnósticos', 'Vapor Rápido Logística', 'Turbo Star Ltda'
    ]) {
      assert.strictEqual(containsProfanity(texto), false, texto);
    }
    // E o callsign, que é o campo onde o visitante via a recusa na cara.
    assert.strictEqual(validateCallsign('TURBO STAR').isValid, true);
    assert.strictEqual(validateCallsign('NOVA DIAG').isValid, true);
  });

  it('continua pegando o palavrão partido por separador, que é a razão de a forma densa existir', () => {
    // A evasão consome palavras INTEIRAS -- começa no início de uma e termina no fim de outra.
    // É isso que a distingue do acaso do teste acima, e é a única coisa que o containment na
    // forma densa sempre esteve lá para pegar.
    for (const texto of [
      'P O R R A', 'P O R R A Ltda', 'Po rra Consultoria', 'p-o-r-r-a',
      'C A R A L H O S.A.', 'F O D A S E Ltda', 'Vaga Bundo Ltda'
    ]) {
      assert.strictEqual(containsProfanity(texto), true, texto);
    }
  });

  it('continua pegando o palavrão concatenado dentro de uma palavra só', () => {
    // O outro caso que o containment sempre pegou: nada de separador, tudo num token.
    for (const texto of ['porraloka', 'porraloka consultoria', 'Consultoria Porraloka']) {
      assert.strictEqual(containsProfanity(texto), true, texto);
    }
  });
});

describe('Proactive Company Normalizer & Fuzzy Matcher', () => {
  const seedCatalog = [
    'Google', 'Google Cloud', 'Itaú', 'Bradesco', 'Nubank',
    'Mercado Livre', 'Globo', 'Embraer', 'Petrobras', 'Totvs', 'CI&T'
  ];

  it('should match exact company names', () => {
    const r = resolveCompanyFromCatalog('Google', seedCatalog);
    assert.strictEqual(r.canonical, 'Google');
    assert.strictEqual(r.matchedBy, 'exact');
    assert.strictEqual(r.confidence, 1.0);
  });

  it('should strip corporate suffixes and regional qualifiers', () => {
    const r1 = resolveCompanyFromCatalog('Google Brasil', seedCatalog);
    assert.strictEqual(r1.canonical, 'Google');
    assert.strictEqual(r1.matchedBy, 'suffix_strip');

    const r2 = resolveCompanyFromCatalog('Itau Unibanco S.A.', seedCatalog);
    assert.strictEqual(r2.canonical, 'Itaú');

    const r3 = resolveCompanyFromCatalog('Mercado Livre Tecnologia Ltda', seedCatalog);
    assert.strictEqual(r3.canonical, 'Mercado Livre');
  });

  it('should fuzzy match typos via Levenshtein', () => {
    const r1 = resolveCompanyFromCatalog('gogle', seedCatalog);
    assert.strictEqual(r1.canonical, 'Google');

    const r2 = resolveCompanyFromCatalog('nu bank', seedCatalog);
    assert.strictEqual(r2.canonical, 'Nubank');

    const r3 = resolveCompanyFromCatalog('embraerr', seedCatalog);
    assert.strictEqual(r3.canonical, 'Embraer');
  });

  it('should fallback cleanly to capitalized raw name for unknown companies', () => {
    // Deliberado: um visitante de uma empresa fora do catálogo tem que aparecer com o
    // nome dela, não com um erro. A moderação do texto cru (Tarefa C0b) fica a cargo de
    // quem consome este resultado — SQLiteBufferService.resolveCompany, em
    // packages/daemon/src/services/sqlite-buffer.ts — não desta função pura.
    const r = resolveCompanyFromCatalog('startup do joao', seedCatalog);
    assert.strictEqual(r.canonical, 'Startup Do Joao');
    assert.strictEqual(r.matchedBy, 'fallback');
  });

  it('não devolve Google para entrada vazia, e não finge confiança', () => {
    const r = resolveCompanyFromCatalog('', seedCatalog);
    assert.strictEqual(r.canonical, 'Independente');
    assert.strictEqual(r.matchedBy, 'fallback');
    assert.ok(r.confidence < 1.0, 'entrada vazia não pode ter confiança máxima');
  });

  // Revisão final Fase C — Crítico 1: `company_canonical` vira o ID de documento de
  // `company_rankings/{company_canonical}` em `cloud-api`. Um nome cru de visitante que
  // sobrevive sem filtro até ali pode travar a transação de ingestão inteira.
  it('sanitiza o palpite de fallback para ser um ID de documento Firestore válido', () => {
    const r = resolveCompanyFromCatalog('Ambev/InBev', seedCatalog);
    assert.strictEqual(r.matchedBy, 'fallback');
    assert.ok(isValidFirestoreDocId(r.canonical), `"${r.canonical}" não é um ID de documento válido`);
    assert.ok(!r.canonical.includes('/'), 'a barra não pode sobreviver ao saneamento');
  });

  it('nunca produz "." ou ".." a partir de uma entrada só com pontuação', () => {
    const r = resolveCompanyFromCatalog('??.', seedCatalog);
    assert.notStrictEqual(r.canonical, '.');
    assert.notStrictEqual(r.canonical, '..');
    assert.ok(isValidFirestoreDocId(r.canonical));
  });

  it('corta um nome de fallback absurdamente longo bem abaixo do limite de 1500 bytes do Firestore', () => {
    const r = resolveCompanyFromCatalog('A'.repeat(5000), seedCatalog);
    assert.ok(isValidFirestoreDocId(r.canonical));
    assert.ok(r.canonical.length <= 200);
  });
});

/**
 * O passo 3 (containment) devolve 0.90, e o corte de revisão em
 * `packages/daemon/src/services/sqlite-buffer.ts` é `< 0.80` -- então tudo que este passo erra vai
 * direto ao telão e a `company_rankings`, sem passar pela fila do operador. Cada caso abaixo é uma
 * patologia medida contra o catálogo real do evento (≈1000 nomes) e 1287 linhas de um CRM.
 */
describe('Company Normalizer — containment do passo 3', () => {
  it('escolhe o candidato MAIS ESPECÍFICO, não o primeiro do catálogo', () => {
    const r = resolveCompanyFromCatalog('Distribuidora Gran Coffee do Sul', ['Gran', 'Gran Coffee']);
    assert.strictEqual(r.canonical, 'Gran Coffee');
    assert.strictEqual(r.confidence, 0.9);
  });

  it('não deixa a ORDEM do catálogo decidir o vencedor', () => {
    // `getCanonicalList()` serve o catálogo por `ORDER BY name ASC`; ninguém escolheu essa ordem
    // de propósito, e ela não pode ser o que define a empresa que aparece no telão.
    const entrada = 'Corretora Porto Seguro Vida';
    const crescente = resolveCompanyFromCatalog(entrada, ['Porto', 'Porto Seguro']);
    const decrescente = resolveCompanyFromCatalog(entrada, ['Porto Seguro', 'Porto']);
    assert.strictEqual(crescente.canonical, 'Porto Seguro');
    assert.strictEqual(decrescente.canonical, crescente.canonical);
  });

  it('exige alinhamento de palavra, inclusive quando a borda é uma letra acentuada', () => {
    // Com `[a-z]` no lugar de `\p{L}`, o "ç" conta como separador e "Cora" casa em "Corações".
    const r = resolveCompanyFromCatalog('Três Corações Alimentos', ['Cora']);
    assert.notStrictEqual(r.canonical, 'Cora');
    assert.strictEqual(r.matchedBy, 'fallback');
  });

  it('ignora a entrada cujo nome limpo fica VAZIO, em vez de casá-la com tudo', () => {
    // `cleanCompanyName('Brasil Tecnologia')` é '' -- e '' é substring de qualquer string, então
    // sem o piso essa única entrada do catálogo capturava toda empresa que chegasse ao passo 3.
    const r = resolveCompanyFromCatalog('Petrobras Distribuidora', ['Brasil Tecnologia']);
    assert.notStrictEqual(r.canonical, 'Brasil Tecnologia');
    assert.strictEqual(r.matchedBy, 'fallback');
  });

  it('ignora o termo que sobra com menos de três letras depois da limpeza', () => {
    // `cleanCompanyName('J&F Tech')` é 'j f': três caracteres, duas letras. O piso conta letras.
    const r = resolveCompanyFromCatalog('N J F Industria e Comercio de Moveis Ltda', ['J&F Tech']);
    assert.notStrictEqual(r.canonical, 'J&F Tech');
    assert.strictEqual(r.matchedBy, 'fallback');
  });

  it('continua achando a sigla de três letras, que é metade do catálogo brasileiro', () => {
    for (const [entrada, sigla] of [
      ['TIM Celular Participações', 'TIM'],
      ['GOL Linhas Aéreas Inteligentes', 'GOL'],
      ['CSN Mineração', 'CSN']
    ]) {
      const r = resolveCompanyFromCatalog(entrada, [sigla]);
      assert.strictEqual(r.canonical, sigla, `"${entrada}" deveria achar ${sigla}`);
    }
  });
});

describe('isValidFirestoreDocId', () => {
  it('recusa barra, "." exato, ".." exato e o padrão reservado __*__', () => {
    assert.strictEqual(isValidFirestoreDocId('Ambev/InBev'), false);
    assert.strictEqual(isValidFirestoreDocId('.'), false);
    assert.strictEqual(isValidFirestoreDocId('..'), false);
    assert.strictEqual(isValidFirestoreDocId('__reserved__'), false);
    assert.strictEqual(isValidFirestoreDocId(''), false);
  });

  it('aceita um nome de empresa comum', () => {
    assert.strictEqual(isValidFirestoreDocId('Google'), true);
    assert.strictEqual(isValidFirestoreDocId('Itaú Unibanco'), true);
  });
});
