import { describe, expect, it } from 'vitest';
import { BALANCE } from '../frontend/src/balance';
import { createMiner } from '../frontend/src/miner';
import {
  applySentinelCollision,
  createSentinel,
  getActiveSentinelTypes,
  getSentinelStep,
  stunSentinel,
  tickSentinel,
} from '../frontend/src/sentinels';

describe('Sentinel activation and movement', () => {
  it('activates Tesla at 75 heat and Mech at 100 heat', () => {
    expect(getActiveSentinelTypes(74)).toEqual([]);
    expect(getActiveSentinelTypes(75)).toEqual(['TESLA']);
    expect(getActiveSentinelTypes(100)).toEqual(['TESLA', 'MECH']);
  });

  it('pursues on the dominant axis', () => {
    const sentinel = createSentinel('TESLA', 10, 10);
    expect(getSentinelStep(sentinel, 14, 12, 0)).toEqual({ dx: 1, dy: 0 });
  });

  it('cannot move or collide while stunned', () => {
    const sentinel = createSentinel('MECH', 10, 10);
    const miner = createMiner('alpha-1');
    stunSentinel(sentinel, 35);

    expect(getSentinelStep(sentinel, 12, 10, 0)).toEqual({ dx: 0, dy: 0 });
    expect(applySentinelCollision(sentinel, miner)).toBe(100);

    for (let i = 0; i < 36; i += 1) tickSentinel(sentinel);
    sentinel.active = true;
    expect(applySentinelCollision(sentinel, miner)).toBe(82);
  });

  it('uses configured Tesla and Mech damage', () => {
    expect(BALANCE.teslaDamage).toBe(10);
    expect(BALANCE.mechDamage).toBe(18);
  });
});
