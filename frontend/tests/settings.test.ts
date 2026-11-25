import { describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../src/settings';

describe('settings', () => {
  it('fills missing values with accessible defaults', () => {
    expect(normalizeSettings({ reducedMotion: true }).reducedMotion).toBe(true);
    expect(normalizeSettings({ reducedMotion: true }).bindings.up).toBe('W');
    expect(normalizeSettings({ showTutorial: false }).showTutorial).toBe(false);
  });

  it('clamps numeric options and ignores malformed key bindings', () => {
    const settings = normalizeSettings({
      aimSensitivity: 9,
      volume: -1,
      hudScale: 0,
      bindings: { up: '<script>', fire: 'SPACE' },
    });
    expect(settings.aimSensitivity).toBe(2);
    expect(settings.volume).toBe(0);
    expect(settings.hudScale).toBe(0.75);
    expect(settings.bindings.up).toBe(defaultSettings().bindings.up);
    expect(settings.bindings.fire).toBe('SPACE');
  });
});
