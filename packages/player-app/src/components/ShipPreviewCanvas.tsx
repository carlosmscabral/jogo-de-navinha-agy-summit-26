import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import {
  BALANCE,
  NEUTRAL_HULL_PATH,
  ShipAttributes,
  ShipVisuals,
  ShipWeapons,
  VIEWBOX_SIZE
} from '@jogo/shared';
import { renderSvgShipTexture } from '../game/factories/SvgShipRenderer.js';
import { ShipTextureFactory } from '../game/factories/ShipTextureFactory.js';
import {
  PreviewMode,
  acquirePreviewSlot,
  previewFireIntervalMs,
  previewShotAngles,
  releasePreviewSlot,
  usesForgedHull
} from './ship-preview-core.js';

/**
 * Mini-canvas com a nave real, parada no centro, disparando a primária no ritmo e no leque que ela
 * vai ter na partida. Usa o mesmo renderizador de casco que o jogo — `SvgShipRenderer` quando a IA
 * já desenhou o `svg_path_data`, `ShipTextureFactory` antes disso — para que o visitante nunca veja
 * um desenho que não corresponde ao que vai pilotar.
 *
 * Degrada de duas formas, porque o estande pode ser Chromebook: se já existe um preview vivo (teto
 * de uma instância) ou se o Phaser não sobe, cai numa silhueta SVG estática. O preview é enfeite —
 * ele jamais pode derrubar a tela.
 */

/** Altura de referência da partida; escala a velocidade dos projéteis para o mini-canvas. */
const MATCH_HEIGHT = 800;

export interface ShipPreviewCanvasProps {
  attributes: ShipAttributes;
  weapons: ShipWeapons;
  visuals?: ShipVisuals;
  mode: PreviewMode;
  /** Lado do canvas, em pixels. */
  size: number;
  className?: string;
}

/** Nave de exemplo do briefing: não é a nave de ninguém, é só a ilustração do que vai acontecer. */
const DEMO_VISUALS: ShipVisuals = {
  style_name: 'interceptor',
  primary_color: '#38bdf8',
  secondary_color: '#a78bfa',
  engine_trail_color: '#ff9e0b',
  svg_path_data: ''
};

interface PreviewBullet {
  rect: Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
}

class ShipPreviewScene extends Phaser.Scene {
  private readonly props: ShipPreviewCanvasProps;
  private ship?: Phaser.GameObjects.Image;
  private shield?: Phaser.GameObjects.Arc;
  private bullets: PreviewBullet[] = [];
  private lastShotAt = 0;
  private baseY = 0;

  constructor(props: ShipPreviewCanvasProps) {
    super({ key: `ship-preview-${props.mode}` });
    this.props = props;
  }

  create(): void {
    const { size, visuals, attributes, mode } = this.props;
    const key = `preview-hull-${mode}`;

    if (this.textures.exists(key)) this.textures.remove(key);

    // A ordem é a mesma da partida: casco forjado quando dá, paramétrico quando não dá.
    const hull = visuals ?? DEMO_VISUALS;
    if (!(usesForgedHull(mode, visuals) && renderSvgShipTexture(this, key, hull))) {
      ShipTextureFactory.createShipTexture(this, key, hull);
    }

    this.baseY = size * 0.62;
    this.ship = this.add.image(size / 2, this.baseY, key);
    this.ship.setDisplaySize(size * 0.42, size * 0.42);

    // O escudo só aparece quando a build realmente tem escudo — é a mesma aura da partida.
    if (attributes.shield_capacity > 0) {
      this.shield = this.add
        .circle(size / 2, this.baseY, size * 0.28, Phaser.Display.Color.HexStringToColor(hull.secondary_color).color, 0.12)
        .setStrokeStyle(1, Phaser.Display.Color.HexStringToColor(hull.engine_trail_color).color, 0.5);
    }
  }

  update(time: number, delta: number): void {
    const { size, weapons, attributes } = this.props;

    // Flutuação de repouso: mais rápida quanto mais veloz for a nave.
    const speedRange = BALANCE.ranges['attributes.speed_px_s'];
    const agility =
      (attributes.speed_px_s - speedRange.min) / Math.max(1, speedRange.max - speedRange.min);
    const bob = Math.sin(time / (520 - agility * 260)) * size * 0.02;
    if (this.ship) this.ship.y = this.baseY + bob;
    if (this.shield) this.shield.y = this.baseY + bob;

    const interval = previewFireIntervalMs(weapons.primary.fire_rate);
    if (time - this.lastShotAt >= interval) {
      this.lastShotAt = time;
      this.fire();
    }

    const step = delta / 1000;
    for (const b of this.bullets) {
      b.rect.x += b.vx * step;
      b.rect.y += b.vy * step;
    }
    this.bullets = this.bullets.filter((b) => {
      if (b.rect.y > -size * 0.1) return true;
      b.rect.destroy();
      return false;
    });
  }

  private fire(): void {
    const { size, weapons, visuals } = this.props;
    const hull = visuals ?? DEMO_VISUALS;
    const color = Phaser.Display.Color.HexStringToColor(hull.primary_color).color;
    // A partida usa 800px de altura; aqui o canvas é menor, então a velocidade acompanha a escala
    // para o tiro levar o mesmo tempo de tela que leva no jogo.
    const speed = (weapons.primary.bullet_speed || BALANCE.weapons.primary.default_bullet_speed) *
      (size / MATCH_HEIGHT);

    for (const deg of previewShotAngles(weapons)) {
      const rad = Phaser.Math.DegToRad(deg);
      const rect = this.add.rectangle(size / 2, this.baseY - size * 0.14, 3, size * 0.05, color);
      rect.setAngle(deg);
      this.bullets.push({ rect, vx: Math.sin(rad) * speed, vy: -Math.cos(rad) * speed });
    }
  }
}

export function ShipPreviewCanvas(props: ShipPreviewCanvasProps) {
  const { size, visuals, mode, className } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [degraded, setDegraded] = useState(false);
  // Guardado numa ref para que a identidade do dono sobreviva às re-renderizações do React.
  const ownerRef = useRef<symbol>();
  if (!ownerRef.current) ownerRef.current = Symbol('ship-preview');

  // Só o que a cena lê é dependência: mudar a cor não deve recriar o jogo, mudar a arma deve.
  const signature = JSON.stringify([mode, size, props.attributes, props.weapons, visuals ?? null]);

  useEffect(() => {
    const container = containerRef.current;
    const owner = ownerRef.current!;
    if (!container) return;

    if (!acquirePreviewSlot(owner)) {
      setDegraded(true);
      return;
    }

    let game: Phaser.Game | undefined;
    try {
      game = new Phaser.Game({
        type: Phaser.AUTO, // cai em CANVAS onde não houver WebGL (Chromebook)
        parent: container,
        width: size,
        height: size,
        transparent: true,
        banner: false,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [new ShipPreviewScene(props)]
      });
      setDegraded(false);
    } catch (err) {
      console.warn('[ShipPreviewCanvas] Phaser não subiu; usando silhueta estática.', err);
      releasePreviewSlot(owner);
      setDegraded(true);
      return;
    }

    return () => {
      game?.destroy(true);
      releasePreviewSlot(owner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (degraded) {
    return <StaticShipSilhouette {...props} className={className} />;
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/**
 * Degradação: a mesma nave, parada, em SVG puro. Desenha o casco forjado quando ele é desenhável e
 * uma silhueta neutra quando não é — exatamente a mesma escolha que a engine faz.
 */
function StaticShipSilhouette({
  visuals,
  mode,
  size,
  className
}: ShipPreviewCanvasProps & { className?: string }) {
  const hull = visuals ?? DEMO_VISUALS;
  const d = usesForgedHull(mode, visuals) ? hull.svg_path_data : NEUTRAL_HULL_PATH;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path d={d} fill={hull.primary_color} stroke={hull.secondary_color} strokeWidth={2} />
    </svg>
  );
}
