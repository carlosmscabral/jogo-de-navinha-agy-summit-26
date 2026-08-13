import Phaser from 'phaser';
import { ShipVisuals } from '@jogo/shared';

/** Lado do canvas de destino, em pixels. O contrato do agente é um viewBox 0 0 128 128. */
const TEXTURE_SIZE = 128;
const VIEWBOX_SIZE = 128;
/** Tolerância além do viewBox antes de recusar o desenho. */
const EXTENT_SLACK = 20;

const SAFE_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\-+\s]+$/;

/**
 * O path vem de um LLM e vira conteúdo de canvas. Path2D não executa script,
 * mas um path com caracteres estranhos é sinal de que a saída do agente
 * degenerou — nesse caso é melhor a nave paramétrica que um casco corrompido.
 */
export function isSafePathData(d: string): boolean {
  if (typeof d !== 'string' || d.trim().length < 10) return false;
  return SAFE_PATH.test(d);
}

export function pathExtent(d: string): { min: number; max: number } {
  const numbers = (d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/**
 * Rasteriza o casco desenhado pelo agente em uma textura Phaser.
 * Devolve false quando recusa — o chamador então usa ShipTextureFactory.
 */
export function renderSvgShipTexture(scene: Phaser.Scene, key: string, visuals: ShipVisuals): boolean {
  const d = visuals.svg_path_data;
  if (!isSafePathData(d)) {
    console.warn('[SvgShipRenderer] svg_path_data recusado: caracteres fora do contrato.');
    return false;
  }

  const { min, max } = pathExtent(d);
  if (min < -EXTENT_SLACK || max > VIEWBOX_SIZE + EXTENT_SLACK) {
    console.warn(`[SvgShipRenderer] svg_path_data fora do viewBox 0..${VIEWBOX_SIZE} (extensão ${min}..${max}).`);
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
