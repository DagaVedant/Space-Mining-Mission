export type ControlAction = 'up' | 'down' | 'left' | 'right' | 'fire' | 'boost' | 'interact' | 'pause' | 'mute' | 'map' | 'pulse';

export interface GameSettings {
  aimSensitivity: number;
  volume: number;
  screenShake: boolean;
  reducedMotion: boolean;
  showTutorial: boolean;
  hudScale: number;
  bindings: Record<ControlAction, string>;
}

const KEY = 'asteroid-breaker-settings-v1';
const DEFAULTS: GameSettings = {
  aimSensitivity: 1,
  volume: 0.55,
  screenShake: true,
  reducedMotion: false,
  showTutorial: true,
  hudScale: 1,
  bindings: {
    up: 'W',
    down: 'S',
    left: 'A',
    right: 'D',
    fire: 'SPACE',
    boost: 'SHIFT',
    interact: 'E',
    pause: 'ESC',
    mute: 'M',
    map: 'N',
    pulse: 'Q',
  },
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function defaultSettings(): GameSettings {
  return { ...DEFAULTS, bindings: { ...DEFAULTS.bindings } };
}

export function normalizeSettings(value: unknown): GameSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const rawBindings = raw.bindings && typeof raw.bindings === 'object' && !Array.isArray(raw.bindings)
    ? raw.bindings as Record<string, unknown>
    : {};
  const bindings = { ...defaults.bindings };
  for (const action of Object.keys(bindings) as ControlAction[]) {
    const key = rawBindings[action];
    if (typeof key === 'string' && /^[A-Z0-9]{1,12}$/.test(key)) bindings[action] = key;
  }
  return {
    aimSensitivity: clamp(raw.aimSensitivity, 0.25, 2, defaults.aimSensitivity),
    volume: clamp(raw.volume, 0, 1, defaults.volume),
    screenShake: typeof raw.screenShake === 'boolean' ? raw.screenShake : defaults.screenShake,
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : defaults.reducedMotion,
    showTutorial: typeof raw.showTutorial === 'boolean' ? raw.showTutorial : defaults.showTutorial,
    hudScale: clamp(raw.hudScale, 0.75, 1.5, defaults.hudScale),
    bindings,
  };
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeSettings(JSON.parse(raw) as unknown) : defaultSettings();
  } catch (error) {
    console.warn('Unable to load game settings.', error);
    return defaultSettings();
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeSettings(settings)));
  } catch (error) {
    console.error('Unable to save game settings.', error);
    throw new Error('Game settings could not be saved in this browser.', { cause: error });
  }
}
