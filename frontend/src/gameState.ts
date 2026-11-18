import { BALANCE } from './balance';
import type { MinerState } from './types';

export type LossReason = 'NONE' | 'HULL' | 'CANNON';

export function getLossReason(
  miner: MinerState,
  cannonSeconds: number,
): LossReason {
  if (miner.health <= 0) {
    return 'HULL';
  }
  if (cannonSeconds <= 0) {
    return 'CANNON';
  }
  return 'NONE';
}

export function isVictory(miner: MinerState): boolean {
  return (
    miner.savedBillions >= BALANCE.victorySavingsBillions &&
    miner.pillsDelivered >= 1
  );
}
