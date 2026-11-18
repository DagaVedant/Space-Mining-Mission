import type { RunSummary } from './types';

export type SubmissionStatus =
  | 'IDLE'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'FAILED';

export interface SubmissionResult {
  id: string;
  status: 'SUBMITTED';
}

export interface DailyCrater {
  seed: number;
  date: string;
}

function baseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
}

export async function getDailyCrater(): Promise<DailyCrater | null> {
  try {
    const response = await fetch(`${baseUrl()}/api/daily-crater`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function submitRun(summary: RunSummary): Promise<SubmissionResult | null> {
  try {
    const response = await fetch(`${baseUrl()}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callsign: summary.callsign,
        seed: summary.seed,
        durationSeconds: summary.durationSeconds,
        finalSavingsBillions: summary.finalSavingsBillions,
        cargoBillions: summary.cargoBillions,
        shipmentsLaunched: summary.shipmentsLaunched,
        pillsDelivered: summary.pillsDelivered,
        peakHeat: summary.peakHeat,
        finalHealth: summary.finalHealth,
        completionStatus: summary.completionStatus,
        lossReason: summary.lossReason,
        selectedUpgrades: summary.selectedUpgrades,
      }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
