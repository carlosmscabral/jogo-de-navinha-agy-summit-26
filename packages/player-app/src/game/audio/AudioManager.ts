/**
 * Retro Arcade Web Audio Synthesizer & Synthwave Music Engine
 */
export class AudioManager {
  private ctx?: AudioContext;
  private isUnlocked = false;
  private isMuted = false;

  // Music loop state
  private musicInterval?: number;
  private musicStep = 0;
  private isBossMode = false;

  // Scale frequencies (A Minor: A2, C3, D3, E3, G3, A3, C4, D4, E4)
  private readonly bassline = [
    110.00, 110.00, 220.00, 110.00, // A2
    87.31, 87.31, 174.61, 87.31,    // F2
    130.81, 130.81, 261.63, 130.81, // C3
    98.00, 98.00, 196.00, 98.00     // G2
  ];

  private readonly leadMelody = [
    440.00, 0, 523.25, 0, 659.25, 587.33, 523.25, 440.00,
    349.23, 0, 440.00, 0, 523.25, 440.00, 392.00, 349.23,
    523.25, 0, 659.25, 0, 783.99, 659.25, 587.33, 523.25,
    392.00, 0, 493.88, 0, 587.33, 523.25, 440.00, 392.00
  ];

  constructor() {
    // Lazy init
  }

  unlockAudio(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.isUnlocked = true;
    if (!this.musicInterval && !this.isMuted) {
      this.startMusic();
    }
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopMusic();
    } else {
      this.startMusic();
    }
    return this.isMuted;
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  setBossMode(active: boolean): void {
    this.isBossMode = active;
    if (this.musicInterval) {
      this.stopMusic();
      this.startMusic();
    }
  }

  startMusic(): void {
    if (this.musicInterval || this.isMuted || !this.ctx) return;

    const tempoMs = this.isBossMode ? 105 : 125; // 120-142 BPM 16th notes
    this.musicStep = 0;

    this.musicInterval = window.setInterval(() => {
      if (!this.ctx || this.isMuted) return;
      this.playMusicStep(this.musicStep);
      this.musicStep = (this.musicStep + 1) % 32;
    }, tempoMs);
  }

  stopMusic(): void {
    if (this.musicInterval) {
      window.clearInterval(this.musicInterval);
      this.musicInterval = undefined;
    }
  }

  private playMusicStep(step: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Kick Drum (Beats 0, 4, 8, 12, 16, 20, 24, 28)
    if (step % 4 === 0) {
      this.synthesizeKick(now);
    }

    // 2. Snare / Clack (Beats 4, 12, 20, 28)
    if (step % 8 === 4) {
      this.synthesizeSnare(now);
    }

    // 3. Hi-Hat (Every 2nd step)
    if (step % 2 === 1) {
      this.synthesizeHiHat(now);
    }

    // 4. Synthwave Bassline Arpeggio
    const bassNote = this.bassline[step % this.bassline.length];
    if (bassNote) {
      this.synthesizeBass(bassNote, now);
    }

    // 5. Synth Lead Melody
    const leadNote = this.leadMelody[step % this.leadMelody.length];
    if (leadNote > 0 && (step % 2 === 0 || this.isBossMode)) {
      this.synthesizeLead(leadNote, now);
    }
  }

  private synthesizeKick(time: number): void {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(35, time + 0.08);

      gain.gain.setValueAtTime(0.35, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.09);
    } catch {
      // Ignored
    }
  }

  private synthesizeSnare(time: number): void {
    if (!this.ctx) return;
    try {
      // White noise buffer
      const bufferSize = this.ctx.sampleRate * 0.06;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1000;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.18, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(time);
      noise.stop(time + 0.06);
    } catch {
      // Ignored
    }
  }

  private synthesizeHiHat(time: number): void {
    if (!this.ctx) return;
    try {
      const bufferSize = this.ctx.sampleRate * 0.02;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 6000;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.06, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(time);
      noise.stop(time + 0.02);
    } catch {
      // Ignored
    }
  }

  private synthesizeBass(freq: number, time: number): void {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, time);
      filter.frequency.exponentialRampToValueAtTime(200, time + 0.1);

      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.1);
    } catch {
      // Ignored
    }
  }

  private synthesizeLead(freq: number, time: number): void {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.08, time);
      gain.gain.exponentialRampToValueAtTime(0.005, time + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(time);
      osc.stop(time + 0.12);
    } catch {
      // Ignored
    }
  }

  // --- Sound Effects (SFX) ---

  playLaser(type: 'laser' | 'plasma' | 'vulcan' = 'plasma'): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      if (type === 'laser') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(950, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.05);
      } else if (type === 'vulcan') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(500, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.06);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(700, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.09);
        gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.09);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.09);
      }

      osc.connect(gain);
      gain.connect(this.ctx.destination);
    } catch {
      // Ignored
    }
  }

  playSecondary(type: 'missile' | 'emp' | 'drone'): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      if (type === 'emp') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.4);
      } else {
        // Missile whoosh
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(850, this.ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
      }

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      // Confirmado por playtest (2026-08-16): o tom por si só se perde durante o boss, onde
      // bumbo/hit/explosão já tocam a cada ~100ms. Aumentar o ganho do tom competiria com o
      // resto na mesma faixa grave; um transiente curto de ruído agudo (mesma técnica do
      // hi-hat/snare acima) corta pela textura por timbre, não por volume.
      const clickBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.03, this.ctx.sampleRate);
      const clickData = clickBuffer.getChannelData(0);
      for (let i = 0; i < clickData.length; i++) {
        clickData[i] = Math.random() * 2 - 1;
      }
      const click = this.ctx.createBufferSource();
      click.buffer = clickBuffer;
      const clickFilter = this.ctx.createBiquadFilter();
      clickFilter.type = 'highpass';
      clickFilter.frequency.value = 4000;
      const clickGain = this.ctx.createGain();
      clickGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);
      click.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(this.ctx.destination);
      click.start();
      click.stop(this.ctx.currentTime + 0.03);
    } catch {
      // Ignored
    }
  }

  playExplosion(isMajor = false): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(isMajor ? 180 : 130, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + (isMajor ? 0.6 : 0.25));

      gain.gain.setValueAtTime(isMajor ? 0.45 : 0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (isMajor ? 0.6 : 0.25));

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + (isMajor ? 0.6 : 0.25));
    } catch {
      // Ignored
    }
  }

  playHit(): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(70, this.ctx.currentTime + 0.07);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.07);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.07);
    } catch {
      // Ignored
    }
  }

  playBossWarning(): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      osc.frequency.setValueAtTime(440, this.ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(880, this.ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.45);
    } catch {
      // Ignored
    }
  }

  playVictoryJingle(): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted) return;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, index) => {
      try {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        const time = this.ctx!.currentTime + index * 0.12;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);

        gain.gain.setValueAtTime(0.2, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(time);
        osc.stop(time + 0.25);
      } catch {
        // Ignored
      }
    });
  }
}

export const audioManager = new AudioManager();
