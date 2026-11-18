import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSave, loadSave, saveLocal } from '../frontend/src/localSave';
import { getDailyCrater, submitRun } from '../frontend/src/client';

describe('local save', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it('returns a safe default', () => {
    expect(loadSave()).toEqual(defaultSave());
  });

  it('persists and loads versioned settings', () => {
    const save = defaultSave();
    save.settings.muted = true;
    expect(saveLocal(save)).toBe(true);
    expect(loadSave().settings.muted).toBe(true);
  });
});

describe('API fallback', () => {
  it('returns null when daily seed fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await getDailyCrater()).toBeNull();
  });

  it('returns null when run submission fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const summary = {
      seed: 1,
      callsign: 'ALPHA-01',
      durationSeconds: 100,
      finalSavingsBillions: 100,
      cargoBillions: 0,
      shipmentsLaunched: 1,
      pillsDelivered: 1,
      peakHeat: 50,
      finalHealth: 100,
      completionStatus: 'GAME_OVER' as const,
      lossReason: 'CANNON' as const,
      selectedUpgrades: [],
    };
    expect(await submitRun(summary)).toBeNull();
  });
});
