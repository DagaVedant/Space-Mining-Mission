import { describe, expect, it } from 'vitest';
import {
  bankRun,
  buyCompanyUpgrade,
  claimMilestones,
  OUTPOST_CAP_HOURS,
  OUTPOST_PER_HOUR,
  collectOutposts,
  companyCost,
  newCompany,
  normalizeCompany,
} from '../src/company';
import { newSave, normalizeSave, statsFor } from '../src/progress';
import {
  PERKS,
  applyPerks,
  bossFor,
  claimsFor,
  depthObjective,
  depthSector,
  newRun,
  normalizeRun,
  perkOffer,
} from '../src/run';

const HOUR = 3_600_000;

describe('depths', () => {
  it('only gets harder, far past the hand-made sectors', () => {
    for (let d = 1; d < 40; d++) {
      const a = depthSector(d - 1);
      const b = depthSector(d);
      expect(b.goal).toBeGreaterThan(a.goal);
      expect(b.maxPirates).toBeGreaterThanOrEqual(a.maxPirates);
      expect(b.pirateEvery).toBeLessThanOrEqual(a.pirateEvery);
      expect(b.size).toBeGreaterThanOrEqual(a.size);
    }
    expect(depthSector(500).pirateEvery).toBeGreaterThan(0);
    expect(depthSector(500).maxPirates).toBeLessThan(20);
  });
  it('places a mid boss every third depth and a dreadnought every sixth', () => {
    expect([0, 1, 2, 3, 4, 5].map(bossFor)).toEqual(['none', 'none', 'mid', 'none', 'none', 'dread']);
    expect(bossFor(11)).toBe('dread');
  });
  it('picks objectives that can be done at that depth, the same way every time', () => {
    expect(depthObjective(5, 0).metric).toBe('ore');
    for (let seed = 0; seed < 200; seed++) {
      expect(depthObjective(seed, 1).metric).not.toBe('elite');
      expect(depthObjective(seed, 4)).toEqual(depthObjective(seed, 4));
      expect(depthObjective(seed, 9).target).toBeGreaterThan(0);
    }
  });
});

describe('perks', () => {
  it('offers three different unowned perks', () => {
    for (let seed = 0; seed < 100; seed++) {
      const offer = perkOffer(seed, 3, 0, ['pierce', 'chain']).map((p) => p.id);
      expect(new Set(offer).size).toBe(3);
      expect(offer).not.toContain('pierce');
      expect(offer).not.toContain('chain');
    }
  });
  it('is stable for a given reroll and changes with a new one', () => {
    expect(perkOffer(42, 1, 0, [])).toEqual(perkOffer(42, 1, 0, []));
    expect(perkOffer(42, 1, 1, [])).not.toEqual(perkOffer(42, 1, 0, []));
  });
  it('runs out gracefully', () => {
    const all = PERKS.map((p) => p.id);
    expect(perkOffer(1, 30, 0, all)).toEqual([]);
    expect(perkOffer(1, 30, 0, all.slice(1))).toHaveLength(1);
  });
  it('changes stats without touching the input', () => {
    const base = statsFor(newSave().levels);
    const copy = { ...base };
    const boosted = applyPerks(base, ['heavy', 'hold', 'plating']);
    expect(boosted.damage).toBeGreaterThan(base.damage);
    expect(boosted.cargoMax).toBeGreaterThan(base.cargoMax);
    expect(boosted.hullMax).toBe(base.hullMax + 50);
    expect(base).toEqual(copy);
  });
});

describe('payouts', () => {
  const run = { ...newRun(1, 0, 0), earned: 10_000, depth: 3 };
  it('banks everything on extract and less on death', () => {
    expect(claimsFor(run, 'extract')).toBe(130);
    expect(claimsFor(run, 'death')).toBe(52);
    expect(claimsFor({ ...run, perks: ['insurance'] }, 'death')).toBe(91);
  });
  it('updates company records and pays each milestone once', () => {
    const company = newCompany(0);
    const report = bankRun(company, run, 'extract');
    expect(report.milestones.map((m) => m.id)).toEqual(['first-extract', 'depth-3']);
    expect(company.claims).toBe(130 + 25 + 40);
    expect(company.stats).toMatchObject({ runs: 1, extracts: 1, bestDepth: 3 });
    expect(claimMilestones(company)).toEqual([]);
  });
});

describe('company', () => {
  it('charges rising prices', () => {
    const company = newCompany(0);
    company.claims = companyCost('hull', 0);
    expect(buyCompanyUpgrade(company, 'hull', 0)).toBe(true);
    expect(company.claims).toBe(0);
    expect(buyCompanyUpgrade(company, 'hull', 0)).toBe(false);
    expect(companyCost('hull', 8)).toBeGreaterThan(companyCost('hull', 1));
  });
  it('pays outposts for time away, capped at eight hours', () => {
    const company = newCompany(0);
    expect(collectOutposts(company, 100 * HOUR)).toBe(0);
    company.upgrades.outpost = 2;
    company.outpostAt = 0;
    expect(collectOutposts(company, 2 * HOUR)).toBe(4 * OUTPOST_PER_HOUR);
    expect(collectOutposts(company, 500 * HOUR)).toBe(2 * OUTPOST_CAP_HOURS * OUTPOST_PER_HOUR);
  });
  it('does not lose part-earned claims to frequent visits', () => {
    const company = newCompany(0);
    company.upgrades.outpost = 1; // one claim every ten minutes
    for (let minute = 1; minute <= 60; minute++) collectOutposts(company, minute * 60_000);
    expect(company.claims).toBe(OUTPOST_PER_HOUR);
  });
  it('repairs damaged data', () => {
    const company = normalizeCompany({ claims: -5, upgrades: { hull: 1e9 }, milestones: ['nope'], outpostAt: 9e14 }, 1000);
    expect(company.claims).toBe(0);
    expect(company.upgrades.hull).toBe(200);
    expect(company.milestones).toEqual([]);
    expect(company.outpostAt).toBe(1000);
  });
});

describe('save v5', () => {
  it('upgrades a v4 save without losing the campaign', () => {
    const save = normalizeSave({ v: 4, money: 777, sector: 3, levels: { cannon: 4 } });
    expect(save?.v).toBe(5);
    expect(save?.money).toBe(777);
    expect(save?.sector).toBe(3);
    expect(save?.levels.cannon).toBe(4);
    expect(save?.run).toBeNull();
    expect(save?.company.claims).toBe(0);
  });
  it('round-trips a run in progress', () => {
    const save = newSave();
    save.run = { ...newRun(9, 300, 2), depth: 4, perks: ['pierce'], hull: 55, phase: 'gate', bossDown: true };
    expect(normalizeSave(JSON.parse(JSON.stringify(save)))?.run).toEqual(save.run);
  });
  it('drops an unusable run', () => {
    expect(normalizeRun({ depth: 3 })).toBeNull();
    expect(normalizeRun({ seed: 1, perks: ['fake'], money: -1 })).toMatchObject({ perks: [], money: 0 });
  });
});
