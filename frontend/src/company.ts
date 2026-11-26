// The company is what carries over between expeditions: Claims, permanent upgrades,
// outposts that earn while you are away, and one-off milestones.
import { claimsFor, type RunEnd, type RunState } from './run';

export type CompanyUpgradeId = 'stake' | 'broker' | 'hull' | 'rerolls' | 'outpost';

export interface CompanyUpgradeDef {
  id: CompanyUpgradeId;
  name: string;
  desc: string;
  baseCost: number;
  growth: number;
}

export const STAKE_PER_LEVEL = 150;
export const BROKER_PER_LEVEL = 0.03;
export const HULL_PER_LEVEL = 10;
export const OUTPOST_PER_HOUR = 6;
export const OUTPOST_CAP_HOURS = 8;

export const COMPANY_UPGRADES: CompanyUpgradeDef[] = [
  { id: 'stake', name: 'Seed Capital', desc: `+${STAKE_PER_LEVEL} credits at the start of every expedition.`, baseCost: 20, growth: 1.5 },
  { id: 'broker', name: 'Trade Charter', desc: '+3% sale price on expeditions.', baseCost: 30, growth: 1.55 },
  { id: 'hull', name: 'Yard Contract', desc: `+${HULL_PER_LEVEL} starting hull on expeditions.`, baseCost: 25, growth: 1.5 },
  { id: 'rerolls', name: 'Fixer', desc: '+1 perk reroll per expedition.', baseCost: 60, growth: 2 },
  { id: 'outpost', name: 'Outpost', desc: `+${OUTPOST_PER_HOUR} Claims an hour while you are away (up to ${OUTPOST_CAP_HOURS} hours).`, baseCost: 50, growth: 1.6 },
];

export type StatId = 'runs' | 'extracts' | 'bestDepth' | 'volatile' | 'elites' | 'bestStreak' | 'bosses';
export const STAT_IDS: StatId[] = ['runs', 'extracts', 'bestDepth', 'volatile', 'elites', 'bestStreak', 'bosses'];

export interface MilestoneDef {
  id: string;
  name: string;
  stat: StatId;
  target: number;
  reward: number;
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'first-extract', name: 'Bring a run home', stat: 'extracts', target: 1, reward: 25 },
  { id: 'depth-3', name: 'Reach depth 3', stat: 'bestDepth', target: 3, reward: 40 },
  { id: 'streak-12', name: 'Break 12 rocks in one streak', stat: 'bestStreak', target: 12, reward: 50 },
  { id: 'volatile-50', name: 'Set off 50 volatile rocks', stat: 'volatile', target: 50, reward: 80 },
  { id: 'elites-10', name: 'Take down 10 elite pirates', stat: 'elites', target: 10, reward: 100 },
  { id: 'depth-6', name: 'Reach depth 6', stat: 'bestDepth', target: 6, reward: 120 },
  { id: 'boss-1', name: 'Destroy a Dreadnought on an expedition', stat: 'bosses', target: 1, reward: 150 },
  { id: 'depth-10', name: 'Reach depth 10', stat: 'bestDepth', target: 10, reward: 300 },
  { id: 'extracts-10', name: 'Bring 10 runs home', stat: 'extracts', target: 10, reward: 250 },
  { id: 'depth-15', name: 'Reach depth 15', stat: 'bestDepth', target: 15, reward: 600 },
];

export interface CompanyState {
  claims: number;
  upgrades: Record<CompanyUpgradeId, number>;
  stats: Record<StatId, number>;
  milestones: string[];
  /** when outpost income was last banked */
  outpostAt: number;
}

export function newCompany(now = Date.now()): CompanyState {
  return {
    claims: 0,
    upgrades: { stake: 0, broker: 0, hull: 0, rerolls: 0, outpost: 0 },
    stats: { runs: 0, extracts: 0, bestDepth: 0, volatile: 0, elites: 0, bestStreak: 0, bosses: 0 },
    milestones: [],
    outpostAt: now,
  };
}

const count = (value: unknown, max = 1e12): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function normalizeCompany(value: unknown, now = Date.now()): CompanyState {
  const data = record(value);
  const company = newCompany(now);
  company.claims = count(data.claims);
  const upgrades = record(data.upgrades);
  for (const upgrade of COMPANY_UPGRADES) company.upgrades[upgrade.id] = count(upgrades[upgrade.id], 200);
  const stats = record(data.stats);
  for (const id of STAT_IDS) company.stats[id] = count(stats[id]);
  const milestones = Array.isArray(data.milestones) ? data.milestones : [];
  company.milestones = MILESTONES.filter((m) => milestones.includes(m.id)).map((m) => m.id);
  const at = count(data.outpostAt, 1e15);
  // a clock set forwards and back again must not leave the outposts stuck in the future
  company.outpostAt = at > 0 && at <= now ? at : now;
  return company;
}

export function companyCost(id: CompanyUpgradeId, level: number): number {
  const upgrade = COMPANY_UPGRADES.find((u) => u.id === id);
  if (!upgrade) throw new Error(`unknown company upgrade ${id}`);
  return Math.round(upgrade.baseCost * Math.pow(upgrade.growth, level));
}

export function buyCompanyUpgrade(company: CompanyState, id: CompanyUpgradeId, now = Date.now()): boolean {
  const cost = companyCost(id, company.upgrades[id]);
  if (company.claims < cost) return false;
  // bank what the old outpost level earned before the rate changes
  if (id === 'outpost') {
    collectOutposts(company, now);
    company.outpostAt = now;
  }
  company.claims -= cost;
  company.upgrades[id] += 1;
  return true;
}

/** Banks outpost income since the last visit and returns it. */
export function collectOutposts(company: CompanyState, now = Date.now()): number {
  const perHour = company.upgrades.outpost * OUTPOST_PER_HOUR;
  if (perHour <= 0) {
    company.outpostAt = now;
    return 0;
  }
  const hours = Math.max(0, now - company.outpostAt) / 3_600_000;
  const earned = Math.floor(Math.min(hours, OUTPOST_CAP_HOURS) * perHour);
  if (earned <= 0) return 0;
  // keep the unpaid fraction, unless the cap threw time away
  company.outpostAt = hours >= OUTPOST_CAP_HOURS ? now : company.outpostAt + (earned / perHour) * 3_600_000;
  company.claims += earned;
  return earned;
}

/** Pays out any milestone newly reached and returns them. */
export function claimMilestones(company: CompanyState): MilestoneDef[] {
  const reached = MILESTONES.filter((m) => !company.milestones.includes(m.id) && company.stats[m.stat] >= m.target);
  for (const m of reached) {
    company.milestones.push(m.id);
    company.claims += m.reward;
  }
  return reached;
}

export interface RunReport {
  claims: number;
  milestones: MilestoneDef[];
}

/** Closes an expedition: pays its Claims, records it and pays any milestone it reached. */
export function bankRun(company: CompanyState, run: RunState, end: RunEnd): RunReport {
  const claims = claimsFor(run, end);
  company.claims += claims;
  company.stats.runs += 1;
  if (end === 'extract') company.stats.extracts += 1;
  company.stats.bestDepth = Math.max(company.stats.bestDepth, run.depth);
  return { claims, milestones: claimMilestones(company) };
}
