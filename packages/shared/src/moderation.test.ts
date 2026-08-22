import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateCallsign } from './utils/moderation.js';
import {
  calculateSimilarity,
  cleanCompanyName,
  resolveCompanyFromCatalog
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

  it('should reject repetitive keyboard mash', () => {
    const r1 = validateCallsign('AAAAAAA');
    assert.strictEqual(r1.isValid, false);
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
});
