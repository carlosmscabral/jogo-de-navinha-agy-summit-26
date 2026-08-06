import Phaser from 'phaser';
import { ShipVisuals } from '@jogo/shared';

export class ShipTextureFactory {
  /**
   * Generates crisp, modern 256x256 retina vector textures for player and enemy ships
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

      const styleName = (visuals.style_name || '').toLowerCase();
      const pColor = visuals.primary_color || '#00f3ff';
      const sColor = visuals.secondary_color || '#ff0055';
      const eColor = visuals.engine_trail_color || '#00f3ff';

      ctx.save();
      ctx.shadowColor = pColor;
      ctx.shadowBlur = 10;

      if (styleName.includes('interceptor')) {
        // --- Interceptor: Sleek Aerodynamic Needle ---
        // Outer Armor Wings
        ctx.fillStyle = pColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(64, 10);
        ctx.lineTo(92, 85);
        ctx.lineTo(82, 98);
        ctx.lineTo(64, 88);
        ctx.lineTo(46, 98);
        ctx.lineTo(36, 85);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner Carbon Plating
        ctx.fillStyle = '#0f1f38';
        ctx.beginPath();
        ctx.moveTo(64, 25);
        ctx.lineTo(78, 80);
        ctx.lineTo(64, 86);
        ctx.lineTo(50, 80);
        ctx.closePath();
        ctx.fill();

        // Wingtip Energy Conduits
        ctx.strokeStyle = sColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(86, 75);
        ctx.lineTo(80, 92);
        ctx.moveTo(42, 75);
        ctx.lineTo(48, 92);
        ctx.stroke();

        // Glass Cockpit Core
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = sColor;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.ellipse(64, 52, 5, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        // Engine Thruster Nozzles
        ctx.fillStyle = eColor;
        ctx.fillRect(52, 94, 8, 4);
        ctx.fillRect(68, 94, 8, 4);

      } else if (styleName.includes('dreadnought') || styleName.includes('vanguard')) {
        // --- Vanguard: Armored Heavy Fortress ---
        ctx.fillStyle = pColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(64, 14);
        ctx.lineTo(108, 68);
        ctx.lineTo(92, 104);
        ctx.lineTo(76, 92);
        ctx.lineTo(64, 102);
        ctx.lineTo(52, 92);
        ctx.lineTo(36, 104);
        ctx.lineTo(20, 68);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Heavy Reinforced Center Plate
        ctx.fillStyle = '#2a1a00';
        ctx.beginPath();
        ctx.moveTo(64, 30);
        ctx.lineTo(84, 65);
        ctx.lineTo(64, 82);
        ctx.lineTo(44, 65);
        ctx.closePath();
        ctx.fill();

        // Heavy Cockpit Core
        ctx.fillStyle = sColor;
        ctx.shadowColor = sColor;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(64, 52, 9, 0, Math.PI * 2);
        ctx.fill();

        // 3 Engine Thruster Nozzles
        ctx.fillStyle = eColor;
        ctx.fillRect(44, 98, 8, 4);
        ctx.fillRect(60, 98, 8, 4);
        ctx.fillRect(76, 98, 8, 4);

      } else {
        // --- Striker / Void Stealth: Aggressive Dual-Prong ---
        ctx.fillStyle = pColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(64, 8);
        ctx.lineTo(100, 80);
        ctx.lineTo(86, 100);
        ctx.lineTo(64, 86);
        ctx.lineTo(42, 100);
        ctx.lineTo(28, 80);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Stealth Inset
        ctx.fillStyle = '#1c082e';
        ctx.beginPath();
        ctx.moveTo(64, 22);
        ctx.lineTo(82, 72);
        ctx.lineTo(64, 82);
        ctx.lineTo(46, 72);
        ctx.closePath();
        ctx.fill();

        // Plasma Conduit Lines
        ctx.strokeStyle = sColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(64, 35);
        ctx.lineTo(64, 75);
        ctx.stroke();

        // Cockpit
        ctx.fillStyle = sColor;
        ctx.shadowColor = sColor;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.ellipse(64, 48, 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Engine Nozzles
        ctx.fillStyle = eColor;
        ctx.fillRect(48, 94, 10, 4);
        ctx.fillRect(70, 94, 10, 4);
      }

      ctx.restore();
    }

    scene.textures.addCanvas(textureKey, canvas);
    return textureKey;
  }

  static createEnemyDroneTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists('drone_tex')) return;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.shadowColor = '#ff0055';
      ctx.shadowBlur = 8;

      // Alien Raider V-Shape
      ctx.fillStyle = '#ff0055';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(32, 54);
      ctx.lineTo(56, 14);
      ctx.lineTo(42, 22);
      ctx.lineTo(32, 16);
      ctx.lineTo(22, 22);
      ctx.lineTo(8, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Glowing Eye Core
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#00f3ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(32, 36, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    scene.textures.addCanvas('drone_tex', canvas);
  }
}
