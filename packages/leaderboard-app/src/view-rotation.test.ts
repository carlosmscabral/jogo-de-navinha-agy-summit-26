import { describe, it, expect } from 'vitest';
import {
  rotationReducer,
  initialRotationState,
  DEFAULT_ROTATION_CONFIG,
  type RotationConfig,
  type RotationEvent,
  type RotationState
} from './view-rotation.js';

/** Config enxuta: 6 s de placar e 2 s por seção deixam um ciclo inteiro legível na asserção. */
const CFG: RotationConfig = { scoreboardMs: 6_000, sectionMs: 2_000, sectionCount: 3, holdMs: 10_000 };

/** Avança o relógio em passos de 1 s, como o `setInterval` do `App.tsx` faz. */
function tick(state: RotationState, ms: number, cfg: RotationConfig = CFG): RotationState {
  let s = state;
  for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
    s = rotationReducer(s, { type: 'TICK', deltaMs: 1_000 }, cfg);
  }
  return s;
}

function dispatch(state: RotationState, event: RotationEvent, cfg: RotationConfig = CFG): RotationState {
  return rotationReducer(state, event, cfg);
}

describe('ciclo automático', () => {
  it('começa no placar', () => {
    const s = initialRotationState(CFG);
    expect(s.view).toBe('scoreboard');
    expect(s.holdMs).toBe(0);
  });

  it('vira para a educativa quando o tempo do placar acaba', () => {
    let s = initialRotationState(CFG);
    s = tick(s, 5_000);
    expect(s.view).toBe('scoreboard');

    s = tick(s, 1_000);
    expect(s.view).toBe('antigravity');
    expect(s.section).toBe(0);
    expect(s.remainingMs).toBe(CFG.sectionMs);
  });

  it('passa pelas três seções e volta sozinho ao placar', () => {
    let s = tick(initialRotationState(CFG), 6_000);
    expect(s.section).toBe(0);

    s = tick(s, 2_000);
    expect(s.section).toBe(1);

    s = tick(s, 2_000);
    expect(s.section).toBe(2);

    s = tick(s, 2_000);
    expect(s.view).toBe('scoreboard');
    expect(s.remainingMs).toBe(CFG.scoreboardMs);
  });

  it('o ciclo completo com os tempos reais é 1m30 de placar e 1m de educativa', () => {
    const cfg = DEFAULT_ROTATION_CONFIG;
    let s = initialRotationState(cfg);

    s = tick(s, 89_000, cfg);
    expect(s.view).toBe('scoreboard');
    s = tick(s, 1_000, cfg);
    expect(s.view).toBe('antigravity');

    s = tick(s, 59_000, cfg);
    expect(s.view).toBe('antigravity');
    expect(s.section).toBe(2);
    s = tick(s, 1_000, cfg);
    expect(s.view).toBe('scoreboard');
  });
});

describe('retenção manual do operador', () => {
  it('uma seta no placar convoca a educativa já retida', () => {
    const s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_NEXT' });
    expect(s.view).toBe('antigravity');
    expect(s.section).toBe(0);
    expect(s.holdMs).toBe(CFG.holdMs);
  });

  it('a seta para trás no placar também entra pela primeira seção', () => {
    const s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_PREV' });
    expect(s.view).toBe('antigravity');
    expect(s.section).toBe(0);
  });

  it('congela o avanço automático das seções', () => {
    let s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_NEXT' });
    expect(s.section).toBe(0);

    // Tempo muito maior que os 2 s de uma seção: sem a retenção, teria virado o ciclo inteiro.
    s = tick(s, 8_000);
    expect(s.view).toBe('antigravity');
    expect(s.section).toBe(0);
    expect(s.holdMs).toBe(2_000);
  });

  it('quando a retenção escoa, a seção corrente recomeça inteira antes de o ciclo seguir', () => {
    let s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_NEXT' });
    s = dispatch(s, { type: 'OPERATOR_NEXT' });
    expect(s.section).toBe(1);

    s = tick(s, 10_000);
    expect(s.holdMs).toBe(0);
    expect(s.section).toBe(1);
    expect(s.remainingMs).toBe(CFG.sectionMs);

    s = tick(s, 2_000);
    expect(s.section).toBe(2);
  });

  it('volta sozinha ao placar depois da inatividade, sem nenhum comando novo', () => {
    let s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_NEXT' });
    // 10 s de retenção + 2 s da seção 0 reiniciada + 2 s de cada seção restante.
    s = tick(s, 10_000 + 2_000 + 2_000 + 2_000);
    expect(s.view).toBe('scoreboard');
    expect(s.holdMs).toBe(0);
  });

  it('cada interação renova a retenção do zero', () => {
    let s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_NEXT' });
    s = tick(s, 9_000);
    expect(s.holdMs).toBe(1_000);

    s = dispatch(s, { type: 'OPERATOR_ACTIVITY' });
    expect(s.holdMs).toBe(CFG.holdMs);
  });

  it('as seções dão a volta nos dois sentidos', () => {
    let s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_PREV' });
    expect(s.section).toBe(0);

    s = dispatch(s, { type: 'OPERATOR_PREV' });
    expect(s.section).toBe(2);

    s = dispatch(s, { type: 'OPERATOR_NEXT' });
    expect(s.section).toBe(0);
  });

  it('uma tecla qualquer NÃO tira o telão do placar', () => {
    const inicial = initialRotationState(CFG);
    const s = dispatch(inicial, { type: 'OPERATOR_ACTIVITY' });
    expect(s).toBe(inicial);
  });
});

describe('recorde de pódio', () => {
  it('corta para o placar mesmo com a retenção manual ativa', () => {
    let s = dispatch(initialRotationState(CFG), { type: 'OPERATOR_NEXT' });
    expect(s.holdMs).toBe(CFG.holdMs);

    s = dispatch(s, { type: 'FORCE_SCOREBOARD' });
    expect(s.view).toBe('scoreboard');
    expect(s.holdMs).toBe(0);
    expect(s.remainingMs).toBe(CFG.scoreboardMs);
  });

  it('reinicia o tempo do placar quando ele já estava no ar', () => {
    let s = tick(initialRotationState(CFG), 5_000);
    expect(s.remainingMs).toBe(1_000);

    s = dispatch(s, { type: 'FORCE_SCOREBOARD' });
    expect(s.remainingMs).toBe(CFG.scoreboardMs);
  });
});

describe('degradação sem conteúdo', () => {
  it('sem seções, o telão fica no placar', () => {
    const cfg: RotationConfig = { ...CFG, sectionCount: 0 };
    let s = tick(initialRotationState(cfg), 20_000, cfg);
    expect(s.view).toBe('scoreboard');

    s = dispatch(s, { type: 'OPERATOR_NEXT' }, cfg);
    expect(s.view).toBe('scoreboard');
  });
});
