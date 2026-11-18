import { BALANCE } from './balance';
import type { MinerState } from './types';

export function activateEmp(miner: MinerState): boolean {
  if (miner.empCooldownTicks > 0) {
    return false;
  }

  miner.empCooldownTicks = BALANCE.empCooldownTicks;
  miner.empStunTicksRemaining = BALANCE.empStunTicks;
  return true;
}

export function isInEmpRadius(
  playerX: number,
  playerY: number,
  targetX: number,
  targetY: number,
): boolean {
  const distance =
    Math.abs(playerX - targetX) + Math.abs(playerY - targetY);
  return distance <= BALANCE.empRadiusTiles;
}
