import { beforeEach, describe, expect, it } from 'vitest';
import { ORE_IDS, SECTORS, UPGRADES } from '../src/data';
import { createMarket, stepMarket } from '../src/market';
import {
  addEarnings,
  buyUpgrade,
  campaignObjectiveComplete,
  campaignRequirementsMet,
  canBuyUpgrade,
  claimDailyQuest,
  cargoTotal,
  clearSave,
  dailyQuestsFor,
  emptyCargo,
  ensureDailyQuests,
  loadSave,
  makeContract,
  newSave,
  normalizeSave,
  persist,
  resolveContracts,
  recordCampaignProgress,
  sectorGoalReached,
  statsFor,
  utcDate,
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
  it('adds working shield, scanner and refinery stats', () => {
    const s = newSave();
    const base = statsFor(s.levels);
    s.money = 100000;
    expect(buyUpgrade(s, 'shield')).toBe(true);
    expect(buyUpgrade(s, 'scanner')).toBe(true);
    expect(buyUpgrade(s, 'refinery')).toBe(true);
    const upgraded = statsFor(s.levels);
    expect(upgraded.shieldMax).toBeGreaterThan(base.shieldMax);
    expect(upgraded.magnet).toBeGreaterThan(base.magnet);
    expect(upgraded.saleMultiplier).toBeGreaterThan(base.saleMultiplier);
  });
  it('adds hull regeneration and sprint recharge upgrades', () => {
    const save = newSave();
    const base = statsFor(save.levels);
    save.money = 100000;
    expect(buyUpgrade(save, 'repair')).toBe(true);
    expect(buyUpgrade(save, 'sprint')).toBe(true);
    const upgraded = statsFor(save.levels);
    expect(upgraded.hullRegen).toBeGreaterThan(base.hullRegen);
    expect(upgraded.sprintRegen).toBeGreaterThan(base.sprintRegen);
    expect(upgraded.fuelMax).toBeGreaterThan(base.fuelMax);
    expect(upgraded.sprintEfficiency).toBeLessThan(base.sprintEfficiency);
  });
});

describe('daily quests', () => {
  it('rotates deterministically and resets progress at UTC day boundaries', () => {
    const first = dailyQuestsFor('2026-11-25');
    expect(dailyQuestsFor('2026-11-25')).toEqual(first);
    expect(dailyQuestsFor('2026-11-26')).not.toEqual(first);
    const save = newSave();
    save.dailyQuestDate = '2026-11-24';
    save.dailyProgress.ore = 9;
    expect(ensureDailyQuests(save, '2026-11-25')).toEqual(first);
    expect(save.dailyProgress).toEqual({ ore: 0, pirates: 0, credits: 0 });
    expect(save.claimedDaily).toEqual([]);
  });
  it('awards a completed daily quest once', () => {
    const save = newSave();
    const quest = dailyQuestsFor(utcDate())[0];
    save.dailyProgress[quest.metric] = quest.target;
    const cash = save.money;
    expect(claimDailyQuest(save, quest.id)).toBe(true);
    expect(save.money).toBe(cash + quest.reward);
    expect(claimDailyQuest(save, quest.id)).toBe(false);
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
  it('requires quota and the sector objective before opening the gate', () => {
    const save = newSave();
    addEarnings(save, SECTORS[0].goal);
    expect(campaignRequirementsMet(save)).toBe(false);
    expect(recordCampaignProgress(save, 'ore', 7)).toBe(false);
    expect(recordCampaignProgress(save, 'ore', 1)).toBe(true);
    expect(campaignObjectiveComplete(save)).toBe(true);
    expect(campaignRequirementsMet(save)).toBe(true);
    expect(recordCampaignProgress(save, 'ore', 1)).toBe(false);
  });
  it('normalizes campaign objectives and weapon choice from older saves', () => {
    const save = normalizeSave({
      v: 2,
      sector: 2,
      objectiveProgress: [999, 1, 50],
      completedObjectives: [2, 2, -1, 99],
      selectedWeapon: 'lance',
    });
    expect(save?.objectiveProgress[0]).toBe(8);
    expect(save?.objectiveProgress[2]).toBe(24);
    expect(save?.completedObjectives).toEqual([0, 1, 2]);
    expect(save?.selectedWeapon).toBe('lance');
  });
});

describe('save', () => {
  let localStore: Map<string, string>;
  beforeEach(() => {
    localStore = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => void localStore.set(k, v),
      removeItem: (k: string) => void localStore.delete(k),
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
  it('migrates existing v1 localStorage saves without losing progress', () => {
    localStore.set('rockbreaker-save-v1', JSON.stringify({
      v: 1,
      money: 999,
      lifetime: 1200,
      sector: 0,
      sectorEarned: 700,
      levels: { cannon: 2 },
      won: false,
    }));
    const save = loadSave();
    expect(save?.v).toBe(3);
    expect(save?.money).toBe(999);
    expect(save?.levels.cannon).toBe(2);
    expect(save?.selectedPilot).toBe('prospector');
    expect(save?.objectiveProgress[0]).toBe(0);
    expect(localStore.has('rockbreaker-save-v2')).toBe(true);
    expect(localStore.has('rockbreaker-save-v1')).toBe(false);
  });
});
