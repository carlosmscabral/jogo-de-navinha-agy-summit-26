import { BALANCE, ShipVisuals, ShipWeapons } from '@jogo/shared';
import { isDrawablePathData } from '../game/factories/SvgShipRenderer.js';

/**
 * A parte do `ShipPreviewCanvas` que não precisa de DOM nem de Phaser: o teto de instâncias, a
 * escolha do casco e o padrão de tiro. Separada do componente para poder ser testada no
 * ambiente `node` do vitest deste workspace, que não tem jsdom.
 */

/**
 * `demo`   — nave de exemplo, na tela de briefing;
 * `build`  — projeção da linha de base, enquanto o visitante mexe nos sliders;
 * `forged` — a nave que a IA acabou de desenhar, no pré-voo.
 *
 * Só `forged` tenta desenhar o `svg_path_data`; nos outros dois ele nem existe ainda.
 */
export type PreviewMode = 'demo' | 'build' | 'forged';

/**
 * Um único `Phaser.Game` de preview vivo por vez, fora da partida.
 *
 * O hardware do estande pode ser Chromebook, e cada instância de Phaser é um contexto de canvas
 * (WebGL quando existe) mais um laço de render próprio. Duas telas da jornada mostram preview e
 * a transição entre elas desmonta uma e monta a outra: sem um porteiro, um atraso de desmontagem
 * do React basta para as duas coexistirem por alguns quadros. O segundo a chegar não quebra —
 * ele desenha o SVG estático, que é a mesma degradação usada quando o Phaser não sobe.
 *
 * `symbol` como dono para que o `release` de um componente nunca libere o slot de outro.
 */
let slotOwner: symbol | null = null;

export function acquirePreviewSlot(owner: symbol): boolean {
  if (slotOwner !== null && slotOwner !== owner) return false;
  slotOwner = owner;
  return true;
}

export function releasePreviewSlot(owner: symbol): void {
  if (slotOwner === owner) slotOwner = null;
}

export function previewSlotTaken(): boolean {
  return slotOwner !== null;
}

/**
 * `true` quando o casco forjado pela IA pode mesmo ser desenhado. Fora do modo `forged` a
 * resposta é sempre `false`: nas telas anteriores não existe `svg_path_data` nenhum, e inventar
 * um seria a mesma classe de mentira que a Tarefa 3 removeu.
 */
export function usesForgedHull(mode: PreviewMode, visuals: ShipVisuals | undefined): boolean {
  if (mode !== 'forged' || !visuals) return false;
  return isDrawablePathData(visuals.svg_path_data);
}

/**
 * Intervalo entre disparos, em ms — a mesma conta de `WeaponSystem.firePrimary`
 * (`1000 / fire_rate`). Uma cadência ausente ou absurda cai no piso do schema em vez de
 * dividir por zero e travar o laço de preview.
 */
export function previewFireIntervalMs(fireRate: number | undefined): number {
  const min = BALANCE.ranges['weapons.primary.fire_rate'].min;
  const max = BALANCE.ranges['weapons.primary.fire_rate'].max;
  const rate = Number.isFinite(fireRate) && (fireRate as number) > 0 ? (fireRate as number) : min;
  return 1000 / Math.min(max, Math.max(min, rate));
}

/**
 * Os ângulos (em graus, 0 = para cima) em que a primária cospe a cada disparo.
 *
 * Espelha `WeaponSystem.firePrimary`: `vulcan_spread` sai em leque de três, o resto sai reto. O
 * preview existe para mostrar a arma que o visitante realmente vai usar — se ele escolheu Vulcan,
 * tem que ver três projéteis.
 */
export function previewShotAngles(weapons: ShipWeapons | undefined): number[] {
  if (weapons?.primary?.type !== 'vulcan_spread') return [0];

  const raw = weapons.primary.spread_angle;
  // Mesmo destrave de unidade do WeaponSystem: um valor abaixo de 1 veio em radianos.
  const deg =
    raw && raw < 1.0 && raw > 0
      ? (raw * 180) / Math.PI
      : raw || BALANCE.weapons.primary.default_spread_deg;

  return [-deg, 0, deg];
}
