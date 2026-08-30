/**
 * Catálogo visual: os três estilos de casco e as seis cores de destaque que o Fast-Grill-Me
 * oferece ao visitante.
 *
 * Antes disto a paleta do jogo só existia como prosa. O `AGENTS.md` gerado citava as seis cores
 * num parêntese ("Opcional: cite uma cor..."), sem hex nenhum, e proibia que a escolha fosse
 * gravada na spec; a paleta "padrão" de cada tema nunca foi escrita em lugar algum, então o
 * modelo inventava três hexes novos a cada sessão e duas naves do mesmo tema não se pareciam.
 * Os únicos hexes de tema já validados no repositório estavam nos presets de emergência
 * (`fallback-presets.ts`), que só rodam quando a forja falha — ou seja, o caminho de exceção era
 * o único com paleta definida.
 *
 * Aqui os dois catálogos são dados: o gerador de prompt monta o menu a partir deles (nada de
 * opção digitada à mão que o schema depois rejeita), o `aesthetic-designer` recebe os hexes em
 * vez de inventá-los, e os presets de emergência passam a consumir a mesma paleta — um preset e
 * seu tema não podem mais divergir.
 *
 * Os rótulos das armas NÃO moram aqui: `PRIMARY_WEAPON_LABELS` e `SECONDARY_WEAPON_LABELS` já
 * existem em `mcp-catalog.ts` e continuam sendo a única fonte deles.
 */

import type { FastGrillMeVisualTheme } from '../types/ship.js';

export type AccentColorName =
  | 'rosa_choque'
  | 'ciano_eletrico'
  | 'verde_acido'
  | 'vermelho_sangue'
  | 'dourado_royal'
  | 'branco_gelido';

export interface AccentColorEntry {
  /** Rótulo em português — é o que o visitante lê no menu. */
  label: string;
  /** `#rrggbb`, no mesmo formato que o schema valida em `visuals.*_color`. */
  hex: string;
}

/**
 * As seis cores curadas. Onde há sobreposição com um hex que o jogo já usava, o valor foi
 * copiado dele (`ciano_eletrico` e `dourado_royal` vêm dos presets de emergência); as outras
 * quatro são novas, escolhidas para se lerem à distância num monitor de estande.
 */
export const ACCENT_COLORS: Record<AccentColorName, AccentColorEntry> = {
  rosa_choque: { label: 'Rosa Choque', hex: '#ff2d95' },
  ciano_eletrico: { label: 'Ciano Elétrico', hex: '#00f3ff' },
  verde_acido: { label: 'Verde Ácido', hex: '#a3ff12' },
  vermelho_sangue: { label: 'Vermelho Sangue', hex: '#e01b24' },
  dourado_royal: { label: 'Dourado Royal', hex: '#ffd700' },
  branco_gelido: { label: 'Branco Gélido', hex: '#e8f4ff' }
};

export interface ThemePalette {
  primary_color: string;
  secondary_color: string;
  engine_trail_color: string;
}

export interface ThemeEntry {
  /** Rótulo em português — é o que o visitante lê no menu. */
  label: string;
  /** Uma frase sobre a GEOMETRIA do casco. Nada de cor aqui: a cor é o outro eixo da escolha. */
  blurb: string;
  /** Paleta base do tema, entregue em hex ao `aesthetic-designer`. */
  palette: ThemePalette;
  /**
   * Cor usada quando o agente omite `accent_color`. Existe para que uma spec ligeiramente fora
   * de conformidade seja completada em vez de rejeitada — `accent_color` é puramente cosmético
   * e não vale um ciclo de correção dentro do SLA da jornada.
   */
  signature_accent: AccentColorName;
}

/**
 * Os três estilos. As paletas são exatamente as dos presets de emergência, que eram os únicos
 * hexes de tema já validados em partida.
 */
export const VISUAL_THEMES: Record<FastGrillMeVisualTheme, ThemeEntry> = {
  synthwave_80s: {
    label: 'Synthwave 80s',
    blurb: 'Fuselagem delta afilada, asas retas e linhas de grade retrô.',
    palette: {
      primary_color: '#00f3ff',
      secondary_color: '#ff0055',
      engine_trail_color: '#00f3ff'
    },
    signature_accent: 'rosa_choque'
  },
  dark_void_stealth: {
    label: 'Dark Void Stealth',
    blurb: 'Silhueta facetada e angular, quase sem superfície reflexiva.',
    palette: {
      primary_color: '#8b00ff',
      secondary_color: '#00ffcc',
      engine_trail_color: '#00ffcc'
    },
    signature_accent: 'ciano_eletrico'
  },
  cyberpunk_gold: {
    label: 'Cyberpunk Gold',
    blurb: 'Casco largo e blindado, com placas sobrepostas e nervuras grossas.',
    palette: {
      primary_color: '#ffd700',
      secondary_color: '#ff6600',
      engine_trail_color: '#ff6600'
    },
    signature_accent: 'dourado_royal'
  }
};

/** Ordem estável dos temas no menu do Fast-Grill-Me. O índice + 1 é o número que o piloto digita. */
export const VISUAL_THEME_ORDER: FastGrillMeVisualTheme[] = [
  'synthwave_80s',
  'dark_void_stealth',
  'cyberpunk_gold'
];

/** Ordem estável das cores no menu do Fast-Grill-Me. O índice + 1 é o número que o piloto digita. */
export const ACCENT_COLOR_ORDER: AccentColorName[] = [
  'rosa_choque',
  'ciano_eletrico',
  'verde_acido',
  'vermelho_sangue',
  'dourado_royal',
  'branco_gelido'
];
