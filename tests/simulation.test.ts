import { describe, expect, it } from 'vitest';
import { BALANCE } from '../frontend/src/balance';
import { normalizeCallsign } from '../frontend/src/callsign';
import { activateEmp, isInEmpRadius } from '../frontend/src/emp';
import { launchCargo } from '../frontend/src/launch';
import { getLossReason, isVictory } from '../frontend/src/gameState';
import { moveOnGrid } from '../frontend/src/movement';
import {
  applyUpgrade,
  createMiner,
  mineOre,
  takeDamage,
  updateSuit,
} from '../frontend/src/miner';

describe('callsign', () => {
  it('normalizes valid callsigns', () => {
    expect(normalizeCallsign('  scout-12 ')).toBe('SCOUT-12');
  });

  it('falls back for missing or malformed callsigns', () => {
    expect(normalizeCallsign(null)).toBe('VULTURE-07');
    expect(normalizeCallsign('SCOUT')).toBe('VULTURE-07');
  });
});

describe('miner survival', () => {
  it('mines and clamps heat and cargo', () => {
    const miner = createMiner('alpha-1');
    miner.cargoCapacity = 100;

    expect(mineOre(miner, 'darkMatter')).toBe(100);
    expect(miner.cargoBillions).toBe(100);
    expect(miner.heat).toBe(15);
  });

  it('prevents repeated collision damage during invulnerability', () => {
    const miner = createMiner('alpha-1');

    expect(takeDamage(miner, 18)).toBe(82);
    expect(takeDamage(miner, 18)).toBe(82);
  });

  it('repairs and cools faster at base', () => {
    const miner = createMiner('alpha-1');
    miner.health = 90;
    miner.heat = 50;

    updateSuit(miner, true);

    expect(miner.health).toBe(91);
    expect(miner.heat).toBe(48);
  });
});

describe('EMP', () => {
  it('activates once and enforces cooldown', () => {
    const miner = createMiner('alpha-1');

    expect(activateEmp(miner)).toBe(true);
    expect(activateEmp(miner)).toBe(false);
  });

  it('uses Manhattan radius', () => {
    expect(isInEmpRadius(10, 10, 13, 12)).toBe(true);
    expect(isInEmpRadius(10, 10, 16, 11)).toBe(false);
  });
});

describe('launch and progression', () => {
  it('rejects a launch below the minimum', () => {
    const miner = createMiner('alpha-1');
    miner.cargoBillions = 59;

    const { result, cannonSeconds } = launchCargo(miner, 60);

    expect(result.launched).toBe(false);
    expect(cannonSeconds).toBe(60);
  });

  it('deducts medicine, banks net cargo, and caps cannon time', () => {
    const miner = createMiner('alpha-1');
    miner.cargoBillions = 300;

    const { result, cannonSeconds } = launchCargo(miner, 110);

    expect(result.launched).toBe(true);
    expect(miner.savedBillions).toBe(260);
    expect(miner.cargoBillions).toBe(0);
    expect(miner.pillsDelivered).toBe(1);
    expect(cannonSeconds).toBe(BALANCE.cannonTimerCapSeconds);
  });

  it('applies drill and cargo upgrades once', () => {
    const miner = createMiner('alpha-1');

    applyUpgrade(miner, 'vultureDrillCore');
    applyUpgrade(miner, 'cargoModule');
    applyUpgrade(miner, 'cargoModule');

    expect(miner.drillLevel).toBe(2);
    expect(miner.cargoCapacity).toBe(400);
  });

  it('reinforced suit increases maximum hull', () => {
    const miner = createMiner('alpha-1');
    applyUpgrade(miner, 'reinforcedSuit');

    expect(miner.maxHealth).toBe(150);
  });
});

describe('movement and terminal states', () => {
  it('rejects walls and out-of-bounds movement', () => {
    const grid = [
      [false, true],
      [false, false],
    ];

    expect(moveOnGrid(0, 0, 1, 0, grid)).toEqual({ x: 0, y: 0 });
    expect(moveOnGrid(0, 0, 0, 1, grid)).toEqual({ x: 0, y: 1 });
  });

  it('requires savings and a medicine shipment for victory', () => {
    const miner = createMiner('alpha-1');
    miner.savedBillions = BALANCE.victorySavingsBillions;
    expect(isVictory(miner)).toBe(false);

    miner.pillsDelivered = 1;
    expect(isVictory(miner)).toBe(true);
  });

  it('reports the correct loss reason', () => {
    const miner = createMiner('alpha-1');
    miner.health = 0;
    expect(getLossReason(miner, 20)).toBe('HULL');
    expect(getLossReason(createMiner('alpha-1'), 0)).toBe('CANNON');
  });
});
