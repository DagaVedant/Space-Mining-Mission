import type { MinerState } from './types';

export type SentinelType = 'TESLA' | 'MECH';

export interface SentinelState {
  type: SentinelType;
  x: number;
  y: number;
  stunTicks: number;
  active: boolean;
  warningTicks: number;
}

export function getActiveSentinelTypes(heat: number): SentinelType[] {
  if (heat >= 100) {
    return ['TESLA', 'MECH'];
  }
  if (heat >= 75) {
    return ['TESLA'];
  }
  return [];
}

export function createSentinel(
  type: SentinelType,
  x: number,
  y: number,
): SentinelState {
  return {
    type,
    x,
    y,
    stunTicks: 0,
    active: type === 'TESLA',
    warningTicks: type === 'MECH' ? 100 : 0,
  };
}

export function stunSentinel(
  sentinel: SentinelState,
  ticks: number,
): void {
  sentinel.stunTicks = Math.max(sentinel.stunTicks, ticks);
}

export function tickSentinel(sentinel: SentinelState): void {
  sentinel.stunTicks = Math.max(0, sentinel.stunTicks - 1);
  sentinel.warningTicks = Math.max(0, sentinel.warningTicks - 1);
  if (sentinel.type === 'MECH' && sentinel.warningTicks === 0) {
    sentinel.active = true;
  }
}

export function getSentinelStep(
  sentinel: SentinelState,
  playerX: number,
  playerY: number,
  roll: number,
): { dx: number; dy: number } {
  if (
    sentinel.stunTicks > 0 ||
    !sentinel.active ||
    (sentinel.type === 'TESLA' && roll >= 0.75) ||
    (sentinel.type === 'MECH' && roll >= 0.45)
  ) {
    return { dx: 0, dy: 0 };
  }

  const dx = playerX - sentinel.x;
  const dy = playerY - sentinel.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return { dx: Math.sign(dx), dy: 0 };
  }
  if (dy !== 0) {
    return { dx: 0, dy: Math.sign(dy) };
  }
  return { dx: 0, dy: 0 };
}

export function applySentinelCollision(
  sentinel: SentinelState,
  miner: MinerState,
): number {
  if (
    sentinel.stunTicks > 0 ||
    !sentinel.active ||
    miner.collisionInvulnerabilityTicks > 0
  ) {
    return miner.health;
  }

  const damage = sentinel.type === 'TESLA' ? 10 : 18;
  miner.health = Math.max(0, miner.health - damage);
  miner.collisionInvulnerabilityTicks = 45;
  return miner.health;
}
