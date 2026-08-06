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

        // Glowing Cockpit Canopy
        ctx.fillStyle = sColor;
        ctx.beginPath();
        ctx.arc(64, 52, 6, 0, Math.PI * 2);
        ctx.fill();

      } else if (styleName.includes('fortress') || styleName.includes('vanguard')) {
        // --- Vanguard Fortress: Heavy Armored Stealth Tank ---
        // Heavy Armor Plates
        ctx.fillStyle = pColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(64, 18);
        ctx.lineTo(105, 55);
        ctx.lineTo(95, 95);
        ctx.lineTo(75, 88);
        ctx.lineTo(64, 98);
        ctx.lineTo(53, 88);
        ctx.lineTo(33, 95);
        ctx.lineTo(23, 55);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Dual Armor Slabs
        ctx.fillStyle = '#141a29';
        ctx.fillRect(42, 45, 16, 40);
        ctx.fillRect(70, 45, 16, 40);

        // Core Reactor Shield
        ctx.fillStyle = sColor;
        ctx.beginPath();
        ctx.arc(64, 60, 8, 0, Math.PI * 2);
        ctx.fill();

      } else {
        // --- Plasma Striker / Custom SVG / Balanced Ace ---
        // Forward Swept Wing Silhouette
        ctx.fillStyle = pColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(64, 12);
        ctx.lineTo(98, 48);
        ctx.lineTo(108, 88);
        ctx.lineTo(84, 82);
        ctx.lineTo(64, 95);
        ctx.lineTo(44, 82);
        ctx.lineTo(20, 88);
        ctx.lineTo(30, 48);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Mid-wing Inset
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.moveTo(64, 28);
        ctx.lineTo(80, 70);
        ctx.lineTo(64, 78);
        ctx.lineTo(48, 70);
        ctx.closePath();
        ctx.fill();

        // Energy Crystal Core
        ctx.fillStyle = sColor;
        ctx.beginPath();
        ctx.arc(64, 50, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Thruster Jets
      ctx.fillStyle = eColor;
      ctx.shadowColor = eColor;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(64, 95, 5, 0, Math.PI * 2);
      ctx.fill();

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

  static createBossTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists('boss_overlord_dreadnought')) {
      scene.textures.remove('boss_overlord_dreadnought');
    }

    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 170;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 340, 170);

      // 1. Heavy Titanium Outer Wings (Angular Stealth Silhouette)
      ctx.fillStyle = '#0a0d16';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 12;

      ctx.beginPath();
      // Nose tip
      ctx.moveTo(170, 160);
      // Right wing sweep
      ctx.lineTo(240, 110);
      ctx.lineTo(330, 85);
      ctx.lineTo(315, 30);
      ctx.lineTo(260, 45);
      ctx.lineTo(220, 20);
      ctx.lineTo(170, 40);
      // Left wing sweep
      ctx.lineTo(120, 20);
      ctx.lineTo(80, 45);
      ctx.lineTo(25, 30);
      ctx.lineTo(10, 85);
      ctx.lineTo(100, 110);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 2. Armor Plating Plates (Dark Slate Layer)
      ctx.fillStyle = '#141a29';
      ctx.strokeStyle = '#ff9e0b';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ff9e0b';
      ctx.shadowBlur = 14;

      ctx.beginPath();
      ctx.moveTo(170, 140);
      ctx.lineTo(225, 95);
      ctx.lineTo(285, 75);
      ctx.lineTo(250, 45);
      ctx.lineTo(170, 60);
      ctx.lineTo(90, 45);
      ctx.lineTo(55, 75);
      ctx.lineTo(115, 95);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 3. Quad Heavy Plasma Cannon Barrels
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      // Far left & right pods
      ctx.fillRect(40, 65, 18, 45);
      ctx.strokeRect(40, 65, 18, 45);
      ctx.fillRect(282, 65, 18, 45);
      ctx.strokeRect(282, 65, 18, 45);
      // Inner dual heavy cannons
      ctx.fillRect(115, 85, 20, 50);
      ctx.strokeRect(115, 85, 20, 50);
      ctx.fillRect(205, 85, 20, 50);
      ctx.strokeRect(205, 85, 20, 50);

      // Muzzle Glow Tips
      ctx.fillStyle = '#ff9e0b';
      ctx.fillRect(42, 105, 14, 6);
      ctx.fillRect(284, 105, 14, 6);
      ctx.fillRect(117, 130, 16, 6);
      ctx.fillRect(207, 130, 16, 6);

      // 4. Central Hexagonal Cyber Reactor Core
      ctx.shadowColor = '#ff9e0b';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#ff9e0b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      const cX = 170;
      const cY = 82;
      const r = 22;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const x = cX + r * Math.cos(angle);
        const y = cY + (r * 0.85) * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner Reactor Heart
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cX, cY, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    scene.textures.addCanvas('boss_overlord_dreadnought', canvas);
  }
}
