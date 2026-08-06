import Phaser from 'phaser';
import { ShipVisuals } from '@jogo/shared';

export class ShipTextureFactory {
  /**
   * Generates or updates a WebGL/Canvas texture in Phaser from SVG path data
   */
  static createShipTexture(
    scene: Phaser.Scene,
    textureKey: string,
    visuals: ShipVisuals
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const svgContent = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="256" height="256">
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#glow)">
              ${visuals.svg_path_data}
            </g>
          </svg>
        `.trim();

        const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            if (scene.textures.exists(textureKey)) {
              scene.textures.remove(textureKey);
            }
            scene.textures.addCanvas(textureKey, canvas);
          }
          URL.revokeObjectURL(url);
          resolve(textureKey);
        };

        img.onerror = (err) => {
          URL.revokeObjectURL(url);
          console.error('[ShipTextureFactory] Failed to rasterize SVG:', err);
          // Fallback simple triangle texture
          this.createFallbackTexture(scene, textureKey, visuals.primary_color);
          resolve(textureKey);
        };

        img.src = url;
      } catch (err) {
        console.error('[ShipTextureFactory] Exception creating texture:', err);
        this.createFallbackTexture(scene, textureKey, visuals.primary_color);
        resolve(textureKey);
      }
    });
  }

  static createFallbackTexture(scene: Phaser.Scene, textureKey: string, primaryColor: string): void {
    if (scene.textures.exists(textureKey)) return;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = primaryColor || '#00f3ff';
      ctx.beginPath();
      ctx.moveTo(64, 16);
      ctx.lineTo(112, 104);
      ctx.lineTo(64, 88);
      ctx.lineTo(16, 104);
      ctx.closePath();
      ctx.fill();
    }
    scene.textures.addCanvas(textureKey, canvas);
  }
}
