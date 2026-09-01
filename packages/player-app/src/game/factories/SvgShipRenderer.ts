import Phaser from 'phaser';
import { ShipVisuals, VIEWBOX_SIZE, isDrawablePathData, pathExtent } from '@jogo/shared';

/** Lado do canvas de destino, em pixels. O contrato do agente é um viewBox 0 0 128 128. */
const TEXTURE_SIZE = 128;

/**
 * As três funções puras de validação de path moravam aqui e agora vivem em
 * `@jogo/shared` (`game/ship-card-svg.ts`), porque o cartão SVG gerado no Cloud Run precisa
 * exatamente das mesmas regras e não pode importar Phaser. A reexportação mantém os call-sites
 * deste pacote (`ship-preview-core.ts`) inalterados — e, mais importante, garante que só existe
 * UMA definição de "este casco é desenhável" nos dois lados.
 */
export { isSafePathData, pathExtent, isDrawablePathData } from '@jogo/shared';

/**
 * Rasteriza o casco desenhado pelo agente em uma textura Phaser.
 * Devolve false quando recusa — o chamador então usa ShipTextureFactory.
 */
export function renderSvgShipTexture(scene: Phaser.Scene, key: string, visuals: ShipVisuals): boolean {
  const d = visuals.svg_path_data;
  if (!isDrawablePathData(d)) {
    const { min, max } = pathExtent(typeof d === 'string' ? d : '');
    console.warn(
      `[SvgShipRenderer] svg_path_data recusado (caracteres fora do contrato ou extensão ${min}..${max} fora do viewBox 0..${VIEWBOX_SIZE}).`
    );
    return false;
  }

  const canvasTexture = scene.textures.createCanvas(key, TEXTURE_SIZE, TEXTURE_SIZE);
  if (!canvasTexture) return false;
  const ctx = canvasTexture.getContext();
  const scale = TEXTURE_SIZE / VIEWBOX_SIZE;

  try {
    const path = new Path2D(d);
    ctx.save();
    ctx.scale(scale, scale);

    ctx.fillStyle = visuals.primary_color;
    ctx.fill(path);

    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = visuals.secondary_color;
    ctx.stroke(path);

    // Brilho do motor, para a nave não sair chapada contra o fundo escuro.
    ctx.shadowColor = visuals.engine_trail_color;
    ctx.shadowBlur = 12 / scale;
    ctx.stroke(path);

    ctx.restore();
  } catch (err) {
    console.warn('[SvgShipRenderer] Path2D recusou o desenho:', err);
    scene.textures.remove(key);
    return false;
  }

  canvasTexture.refresh();
  return true;
}
