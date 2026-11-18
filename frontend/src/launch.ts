import { BALANCE } from './balance';
import type { MinerState } from './types';

export interface LaunchResult {
  launched: boolean;
  reason?: 'INSUFFICIENT_CARGO';
  netCargoValue?: number;
}

export function launchCargo(
  miner: MinerState,
  cannonSeconds: number,
): { result: LaunchResult; cannonSeconds: number } {
  if (miner.cargoBillions < BALANCE.minimumLaunchBillions) {
    return {
      result: { launched: false, reason: 'INSUFFICIENT_CARGO' },
      cannonSeconds,
    };
  }

  const netCargoValue =
    miner.cargoBillions - BALANCE.medicineCostBillions;
  miner.savedBillions += netCargoValue;
  miner.cargoBillions = 0;
  miner.shipmentsLaunched += 1;
  miner.pillsDelivered += 1;
  miner.adrianaSafe = true;

  return {
    result: { launched: true, netCargoValue },
    cannonSeconds: Math.min(
      BALANCE.cannonTimerCapSeconds,
      cannonSeconds + BALANCE.launchCannonBonusSeconds,
    ),
  };
}
