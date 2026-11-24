import { beforeEach, describe, expect, it } from 'vitest';
import { ORE_IDS, SECTORS, UPGRADES } from '../src/data';
import { createMarket, stepMarket } from '../src/market';
import {
  addEarnings,
  buyUpgrade,
  canBuyUpgrade,
  cargoTotal,
  clearSave,
  emptyCargo,
  loadSave,
  makeContract,
  newSave,
  persist,
  resolveContracts,
  sectorGoalReached,
  statsFor,
  upgradeCost,
} from '../src/progress';
import { mulberry32, pickWeighted } from '../src/rng';

describe('market', () => {
  it('keeps prices inside bounds over a long run', () => {
    const rng = mulberry32(7);
    const m = createMarket(rng);
    for (let i = 0; i < 20000; i++) stepMarket(m, 0.5, rng);
    for (const o of ORE_IDS) {
      expect(m.prices[o]).toBeGreaterThan(0);
      expect(Number.isFinite(m.prices[o])).toBe(true);
    }
  });
  it('starts events and expires them', () => {
    const rng = mulberry32(3);
    const m = createMarket(rng);
    let started = 0;
    for (let i = 0; i < 400; i++) if (stepMarket(m, 1, rng)) started++;
    expect(started).toBeGreaterThan(2);
    expect(m.events.length).toBeLessThanOrEqual(3);
  });
});

describe('upgrades', () => {
  it('costs rise per level and stats improve', () => {
    for (const u of UPGRADES) expect(upgradeCost(u.id, 3)).toBeGreaterThan(upgradeCost(u.id, 0));
    const s = newSave();
    const before = statsFor(s.levels);
    s.money = 100000;
    expect(buyUpgrade(s, 'cannon')).toBe(true);
    expect(statsFor(s.levels).damage).toBeGreaterThan(before.damage);
  });
  it('enforces max level and funds', () => {
    const s = newSave();
    expect(canBuyUpgrade(s, 'hull')).toBe(false);
    s.money = 1e9;
    for (let i = 0; i < 10; i++) buyUpgrade(s, 'hull');
    expect(s.levels.hull).toBe(5);
  });
});

describe('contracts', () => {
  it('fulfils, expires and keeps pending', () => {
    const rng = mulberry32(1);
    const a = { ...makeContract(0, 0, rng), ore: 'ferrite' as const, qty: 5, deadline: 100 };
    const b = { ...makeContract(0, 0, rng), ore: 'cobalt' as const, qty: 5, deadline: 10 };
    const c = { ...makeContract(0, 0, rng), ore: 'cobalt' as const, qty: 50, deadline: 500 };
    const cargo = { ...emptyCargo(), ferrite: 8 };
    const r = resolveContracts(cargo, [a, b, c], 20);
    expect(r.done).toEqual([a]);
    expect(r.expired).toEqual([b]);
    expect(r.remaining).toEqual([c]);
    expect(r.cargo.ferrite).toBe(3);
    expect(r.payout).toBe(a.reward);
    expect(cargoTotal(r.cargo)).toBe(3);
  });
  it('only offers ores present in the sector', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 50; i++) expect(['ferrite', 'cobalt']).toContain(makeContract(0, 0, rng).ore);
  });
});

describe('campaign', () => {
  it('tracks the sector goal', () => {
    const s = newSave();
    expect(sectorGoalReached(s)).toBe(false);
    addEarnings(s, SECTORS[0].goal);
    expect(sectorGoalReached(s)).toBe(true);
    expect(s.lifetime).toBe(SECTORS[0].goal);
  });
  it('has escalating sectors and one boss', () => {
    for (let i = 1; i < SECTORS.length; i++) expect(SECTORS[i].goal).toBeGreaterThan(SECTORS[i - 1].goal);
    expect(SECTORS.filter((s) => s.boss)).toHaveLength(1);
  });
  it('picks only weighted ores', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 100; i++) expect(pickWeighted(SECTORS[0].weights, rng)).not.toBe('platinum');
  });
});

describe('save', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
  });
  it('round-trips and clears', () => {
    const s = newSave();
    s.money = 999;
    s.levels.cargo = 3;
    persist(s);
    expect(loadSave()?.money).toBe(999);
    expect(loadSave()?.levels.cargo).toBe(3);
    clearSave();
    expect(loadSave()).toBeNull();
  });
});
