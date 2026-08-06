import Phaser from 'phaser';
import { ShipVisuals } from '@jogo/shared';

export class ShipTextureFactory {
  /**
   * Generates a high-resolution 256x256 neon canvas texture synchronously
   */
  static createShipTexture(
    scene: Phaser.Scene,
    textureKey: string,
    visuals: ShipVisuals
  ): string {
    if (scene.textures.exists(textureKey)) {
      scene.textures.remove(textureKey);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);

      // Neon Glow effect
      ctx.shadowColor = visuals.primary_color || '#00f3ff';
      ctx.shadowBlur = 12;

      ctx.fillStyle = visuals.primary_color || '#00f3ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;

      const styleName = (visuals.style_name || '').toLowerCase();

      if (styleName.includes('interceptor')) {
        // Fast sleek needle
        ctx.beginPath();
        ctx.moveTo(64, 12);
        ctx.lineTo(88, 96);
        ctx.lineTo(74, 86);
        ctx.lineTo(64, 104);
        ctx.lineTo(54, 86);
        ctx.lineTo(40, 96);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner hull
        ctx.fillStyle = '#0066aa';
        ctx.beginPath();
        ctx.moveTo(64, 28);
        ctx.lineTo(76, 80);
        ctx.lineTo(64, 92);
        ctx.lineTo(52, 80);
        ctx.closePath();
        ctx.fill();

        // Cockpit
        ctx.fillStyle = visuals.secondary_color || '#ff0055';
        ctx.beginPath();
        ctx.arc(64, 50, 7, 0, Math.PI * 2);
        ctx.fill();
      } else if (styleName.includes('dreadnought') || styleName.includes('vanguard')) {
        // Heavy armored triangle fortress
        ctx.beginPath();
        ctx.moveTo(64, 16);
        ctx.lineTo(104, 72);
        ctx.lineTo(88, 104);
        ctx.lineTo(64, 88);
        ctx.lineTo(40, 104);
        ctx.lineTo(24, 72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner hull
        ctx.fillStyle = '#aa7700';
        ctx.beginPath();
        ctx.moveTo(64, 30);
        ctx.lineTo(84, 68);
        ctx.lineTo(64, 80);
        ctx.lineTo(44, 68);
        ctx.closePath();
        ctx.fill();

        // Cockpit
        ctx.fillStyle = visuals.secondary_color || '#ff6600';
        ctx.beginPath();
        ctx.arc(64, 52, 9, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Striker / Void Stealth
        ctx.beginPath();
        ctx.moveTo(64, 8);
        ctx.lineTo(96, 84);
        ctx.lineTo(80, 78);
        ctx.lineTo(64, 112);
        ctx.lineTo(48, 78);
        ctx.lineTo(32, 84);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner hull
        ctx.fillStyle = '#440088';
        ctx.beginPath();
        ctx.moveTo(64, 24);
        ctx.lineTo(80, 72);
        ctx.lineTo(64, 84);
        ctx.lineTo(48, 72);
        ctx.closePath();
        ctx.fill();

        // Cockpit
        ctx.fillStyle = visuals.secondary_color || '#00ffcc';
        ctx.beginPath();
        ctx.arc(64, 48, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    scene.textures.addCanvas(textureKey, canvas);
    return textureKey;
  }
}
