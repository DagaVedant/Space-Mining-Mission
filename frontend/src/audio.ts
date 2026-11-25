// Synthesized sound effects and a quiet ambient bed. No audio files.

type Wave = OscillatorType;

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private thrustGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ambientOn = false;
  private volume = 0.55;
  muted = false;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // looping thruster rumble
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    src.connect(lp).connect(this.thrustGain).connect(this.master);
    src.start();
    this.startAmbient();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.05);
  }

  thrust(level: number): void {
    if (!this.ctx) return;
    this.thrustGain.gain.setTargetAtTime(level * 0.16, this.ctx.currentTime, 0.08);
  }

  shoot(): void {
    this.tone(880, 0.09, 'square', 0.05, 220);
    this.noise(0.05, 0.05, 3000, 800, 'highpass');
  }
  turret(): void {
    this.tone(1200, 0.1, 'sawtooth', 0.04, 400);
  }
  rockHit(): void {
    this.noise(0.06, 0.12, 1800, 500);
  }
  rockBreak(size: 'L' | 'M' | 'S'): void {
    const k = size === 'L' ? 1 : size === 'M' ? 0.7 : 0.45;
    this.noise(0.35 * k + 0.1, 0.35 * k, 1400, 120);
    this.tone(120 * (2 - k), 0.25, 'triangle', 0.18 * k, 40);
  }
  pickup(): void {
    this.tone(760, 0.07, 'triangle', 0.08, 1100);
  }
  sell(): void {
    this.tone(660, 0.08, 'triangle', 0.1);
    this.tone(990, 0.12, 'triangle', 0.1, undefined, 0.07);
    this.tone(1320, 0.16, 'triangle', 0.08, undefined, 0.14);
  }
  buy(): void {
    this.tone(330, 0.09, 'square', 0.07);
    this.tone(495, 0.09, 'square', 0.07, undefined, 0.08);
    this.tone(660, 0.16, 'square', 0.07, undefined, 0.16);
  }
  deny(): void {
    this.tone(150, 0.15, 'sawtooth', 0.08, 90);
  }
  hurt(): void {
    this.noise(0.18, 0.3, 900, 150);
    this.tone(140, 0.16, 'square', 0.1, 60);
  }
  alarm(): void {
    for (let i = 0; i < 3; i++) this.tone(i % 2 ? 520 : 760, 0.16, 'square', 0.07, undefined, i * 0.18);
  }
  dock(): void {
    this.tone(220, 0.25, 'triangle', 0.1, 440);
    this.noise(0.3, 0.08, 600, 200);
  }
  undock(): void {
    this.tone(440, 0.25, 'triangle', 0.1, 220);
  }
  warp(): void {
    this.noise(1.1, 0.3, 200, 5000, 'bandpass');
    this.tone(110, 1.1, 'sawtooth', 0.12, 880);
  }
  explode(): void {
    this.noise(0.8, 0.5, 1800, 60);
    this.tone(90, 0.6, 'sawtooth', 0.2, 30);
  }
  pirate(): void {
    this.tone(300, 0.25, 'sawtooth', 0.09, 180);
    this.tone(220, 0.3, 'sawtooth', 0.09, 120, 0.2);
  }
  boss(): void {
    this.tone(70, 1.4, 'sawtooth', 0.22, 40);
    this.noise(1.4, 0.3, 400, 60);
  }
  flare(): void {
    this.noise(1.2, 0.35, 300, 3000, 'bandpass');
  }

  private startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || this.ambientOn) return;
    this.ambientOn = true;
    const bed = ctx.createGain();
    bed.gain.value = 0.06;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    for (const f of [55, 55.35, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    lp.connect(bed).connect(this.master);
    const notes = [220, 261.63, 293.66, 349.23, 392, 440];
    const pluck = () => {
      if (!this.ctx) return;
      const n = notes[Math.floor(Math.random() * notes.length)];
      this.tone(n, 2.2, 'sine', 0.025);
      this.tone(n * 2, 1.4, 'sine', 0.01, undefined, 0.02);
      window.setTimeout(pluck, 3500 + Math.random() * 5500);
    };
    window.setTimeout(pluck, 2500);
  }
}

export const sfx = new Sfx();
