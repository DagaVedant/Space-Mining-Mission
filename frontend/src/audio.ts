import { loadSave, saveLocal } from './localSave';

export type SfxName =
  | 'mine'
  | 'heatBeep'
  | 'sentinelAlert'
  | 'emp'
  | 'launch'
  | 'victory'
  | 'defeat'
  | 'click'
  | 'damage';

type ToneStep = { freq: number; start: number; duration: number; type?: OscillatorType; gain?: number };

const SFX: Record<SfxName, ToneStep[]> = {
  click: [{ freq: 520, start: 0, duration: 0.05, type: 'square', gain: 0.5 }],
  mine: [
    { freq: 180, start: 0, duration: 0.07, type: 'square', gain: 0.6 },
    { freq: 120, start: 0.03, duration: 0.08, type: 'triangle', gain: 0.4 },
  ],
  heatBeep: [{ freq: 880, start: 0, duration: 0.09, type: 'square', gain: 0.35 }],
  sentinelAlert: [
    { freq: 660, start: 0, duration: 0.12, type: 'sawtooth', gain: 0.4 },
    { freq: 440, start: 0.14, duration: 0.14, type: 'sawtooth', gain: 0.4 },
  ],
  emp: [
    { freq: 1400, start: 0, duration: 0.3, type: 'sawtooth', gain: 0.35 },
    { freq: 200, start: 0, duration: 0.35, type: 'sine', gain: 0.3 },
  ],
  launch: [
    { freq: 90, start: 0, duration: 0.8, type: 'sawtooth', gain: 0.5 },
    { freq: 140, start: 0.1, duration: 0.6, type: 'square', gain: 0.25 },
  ],
  victory: [
    { freq: 523, start: 0, duration: 0.16, type: 'triangle', gain: 0.5 },
    { freq: 659, start: 0.16, duration: 0.16, type: 'triangle', gain: 0.5 },
    { freq: 784, start: 0.32, duration: 0.3, type: 'triangle', gain: 0.5 },
  ],
  defeat: [
    { freq: 300, start: 0, duration: 0.25, type: 'sawtooth', gain: 0.45 },
    { freq: 220, start: 0.2, duration: 0.25, type: 'sawtooth', gain: 0.4 },
    { freq: 140, start: 0.4, duration: 0.4, type: 'sawtooth', gain: 0.4 },
  ],
  damage: [{ freq: 110, start: 0, duration: 0.12, type: 'square', gain: 0.5 }],
};

class AudioManager {
  private ctx: AudioContext | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        return null;
      }
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  unlock(): void {
    this.ensureContext();
  }

  play(name: SfxName): void {
    const save = loadSave();
    if (save.settings.muted) {
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    const volume = save.settings.volume;
    const steps = SFX[name];
    const now = ctx.currentTime;

    for (const step of steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type ?? 'sine';
      osc.frequency.setValueAtTime(step.freq, now + step.start);
      const peak = (step.gain ?? 0.4) * volume;
      gain.gain.setValueAtTime(0.0001, now + step.start);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), now + step.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + step.start + step.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + step.start);
      osc.stop(now + step.start + step.duration + 0.02);
    }
  }

  isMuted(): boolean {
    return loadSave().settings.muted;
  }

  getVolume(): number {
    return loadSave().settings.volume;
  }

  setMuted(muted: boolean): void {
    const save = loadSave();
    save.settings.muted = muted;
    saveLocal(save);
  }

  setVolume(volume: number): void {
    const save = loadSave();
    save.settings.volume = Math.min(1, Math.max(0, volume));
    saveLocal(save);
  }

  toggleMuted(): boolean {
    const next = !this.isMuted();
    this.setMuted(next);
    return next;
  }
}

export const audio = new AudioManager();
