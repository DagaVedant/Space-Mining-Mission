import type { RunSummary } from './types';

export interface LocalSave {
  version: 1;
  bestRun: RunSummary | null;
  settings: {
    muted: boolean;
    volume: number;
    reducedMotion: boolean;
  };
  submissionStatus: 'IDLE' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED';
}

const SAVE_KEY = 'vulture-lunar-mining-save';

export function defaultSave(): LocalSave {
  return {
    version: 1,
    bestRun: null,
    settings: {
      muted: false,
      volume: 0.7,
      reducedMotion: false,
    },
    submissionStatus: 'IDLE',
  };
}

export function loadSave(): LocalSave {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<LocalSave>;
    if (parsed.version !== 1) return defaultSave();
    return {
      ...defaultSave(),
      ...parsed,
    };
  } catch {
    return defaultSave();
  }
}

export function saveLocal(data: LocalSave): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function recordRun(summary: RunSummary): LocalSave {
  const save = loadSave();
  if (
    !save.bestRun ||
    summary.finalSavingsBillions > save.bestRun.finalSavingsBillions
  ) {
    save.bestRun = summary;
  }
  save.submissionStatus = 'IDLE';
  saveLocal(save);
  return save;
}
