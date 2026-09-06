/**
 * A alternância entre as duas visões do telão — placar e painel institucional do Antigravity —
 * isolada do React para poder ser testada.
 *
 * POR QUE UM REDUCER PURO. A regra tem quatro entradas que se atropelam (o relógio, as setas do
 * apresentador, uma tecla qualquer, e um recorde chegando da nuvem) e uma exigência que não é
 * óbvia: a retenção manual precisa expirar sozinha. Escrita a `setTimeout` dentro do componente,
 * essa combinação vira um emaranhado de timers que só se testa com o telão ligado. Aqui o tempo
 * entra como evento (`TICK`), então o ciclo inteiro de 2m30 se verifica em milissegundos.
 *
 * Mesma convenção de `celebration-queue.ts`: o `leaderboard-app` roda o vitest com
 * `environment: 'node'`, sem jsdom e sem testing-library, então lógica que precisa de teste não
 * pode morar dentro de um componente.
 */

export type ViewId = 'scoreboard' | 'antigravity';

export interface RotationConfig {
  /** Quanto o placar fica no ar antes de virar para a visão educativa. */
  scoreboardMs: number;
  /** Quanto cada seção da visão educativa fica no ar em modo automático. */
  sectionMs: number;
  /** Quantas seções a visão educativa tem. */
  sectionCount: number;
  /**
   * Retenção manual concedida a CADA interação do operador. É também o tempo de inatividade que
   * devolve o telão ao fluxo automático: enquanto alguém mexe, o contador reinicia; quando param
   * de mexer, ele escoa e o placar volta sozinho, sem depender de um segundo comando.
   */
  holdMs: number;
}

export interface RotationState {
  view: ViewId;
  /** Índice da seção da visão educativa. Irrelevante enquanto `view === 'scoreboard'`. */
  section: number;
  /** Quanto falta do tempo da visão (placar) ou da seção (educativa) atual. */
  remainingMs: number;
  /** `> 0` significa retenção manual ativa: o avanço automático das seções está congelado. */
  holdMs: number;
}

export type RotationEvent =
  | { type: 'TICK'; deltaMs: number }
  /** Seta para a frente: convoca a educativa (do placar) ou avança uma seção. */
  | { type: 'OPERATOR_NEXT' }
  | { type: 'OPERATOR_PREV' }
  /** Qualquer outra tecla: só renova a retenção, e só se a educativa já estiver no ar. */
  | { type: 'OPERATOR_ACTIVITY' }
  /** Um recorde de pódio chegou. Vence a retenção manual. */
  | { type: 'FORCE_SCOREBOARD' };

export const DEFAULT_ROTATION_CONFIG: RotationConfig = {
  scoreboardMs: 90_000,
  sectionMs: 20_000,
  sectionCount: 3,
  holdMs: 90_000
};

export function initialRotationState(cfg: RotationConfig = DEFAULT_ROTATION_CONFIG): RotationState {
  return { view: 'scoreboard', section: 0, remainingMs: cfg.scoreboardMs, holdMs: 0 };
}

/**
 * Invariante: `holdMs` nunca sobrevive a uma volta ao placar. A retenção é uma propriedade da
 * visão educativa; carregá-la de volta faria a próxima ida à educativa já nascer congelada.
 */
function toScoreboard(cfg: RotationConfig): RotationState {
  return { view: 'scoreboard', section: 0, remainingMs: cfg.scoreboardMs, holdMs: 0 };
}

export function rotationReducer(
  state: RotationState,
  event: RotationEvent,
  cfg: RotationConfig = DEFAULT_ROTATION_CONFIG
): RotationState {
  // Sem seções não há para onde virar. Guarda contra um `ANTIGRAVITY_SECTIONS` esvaziado numa
  // edição de conteúdo: o telão degrada para "só placar" em vez de piscar numa visão vazia.
  if (cfg.sectionCount <= 0) {
    return state.view === 'scoreboard' ? state : toScoreboard(cfg);
  }

  switch (event.type) {
    case 'TICK': {
      if (state.view === 'scoreboard') {
        const remainingMs = state.remainingMs - event.deltaMs;
        if (remainingMs > 0) return { ...state, remainingMs };
        return { view: 'antigravity', section: 0, remainingMs: cfg.sectionMs, holdMs: 0 };
      }

      if (state.holdMs > 0) {
        const holdMs = state.holdMs - event.deltaMs;
        if (holdMs > 0) return { ...state, holdMs };
        // A retenção escoou. A seção corrente recomeça do zero em vez de saltar: o operador
        // acabou de parar de falar sobre ela, cortar no meio da frase seria pior do que dar mais
        // 20 s antes de retomar o ciclo.
        return { ...state, holdMs: 0, remainingMs: cfg.sectionMs };
      }

      const remainingMs = state.remainingMs - event.deltaMs;
      if (remainingMs > 0) return { ...state, remainingMs };

      const next = state.section + 1;
      if (next >= cfg.sectionCount) return toScoreboard(cfg);
      return { ...state, section: next, remainingMs: cfg.sectionMs };
    }

    case 'OPERATOR_NEXT':
    case 'OPERATOR_PREV': {
      if (state.view === 'scoreboard') {
        // Do placar, qualquer seta convoca a educativa pela primeira seção — voltar "para trás"
        // para a última seção de um ciclo que nem começou não significa nada para quem apresenta.
        return { view: 'antigravity', section: 0, remainingMs: cfg.sectionMs, holdMs: cfg.holdMs };
      }
      const delta = event.type === 'OPERATOR_NEXT' ? 1 : -1;
      const section = (state.section + delta + cfg.sectionCount) % cfg.sectionCount;
      return { view: 'antigravity', section, remainingMs: cfg.sectionMs, holdMs: cfg.holdMs };
    }

    case 'OPERATOR_ACTIVITY':
      // Deliberadamente inerte no placar: uma tecla esbarrada, um apresentador guardando o
      // controle, o teclado limpo por alguém — nada disso pode sequestrar o placar. Sair dele
      // exige a intenção explícita de uma seta.
      if (state.view !== 'antigravity') return state;
      return { ...state, holdMs: cfg.holdMs };

    case 'FORCE_SCOREBOARD':
      // Também reinicia o cronômetro quando já se está no placar: o recorde acabou de acontecer,
      // e virar para a educativa dois segundos depois desperdiçaria o momento.
      return toScoreboard(cfg);
  }
}
