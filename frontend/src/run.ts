// Expedition rules: how each depth is built, which perks are offered and what a run pays out.
// No Phaser here, so all of it can be tested.
import { SECTORS, UPGRADES, type CampaignObjective, type ObjectiveMetric, type SectorDef } from './data';
import type { Cargo, Levels, ShipStats } from './progress';
import { mulberry32 } from './rng';

export type PerkId =
  | 'pierce'
  | 'chain'
  | 'escort'
  | 'magpulse'
  | 'desperate'
  | 'overdrive'
  | 'heavy'
  | 'plating'
  | 'leech'
  | 'collector'
  | 'broker'
  | 'hold'
  | 'twin'
  | 'bulwark'
  | 'pulsecore'
  | 'momentum'
  | 'afterburner'
  | 'insurance'
  | 'bounty'
  | 'critical';

export interface PerkDef {
  id: PerkId;
  name: string;
  desc: string;
}

export const PERKS: PerkDef[] = [
  { id: 'pierce', name: 'Tungsten Rounds', desc: 'Shots punch through one more target.' },
  { id: 'chain', name: 'Seismic Charges', desc: 'Breaking a rock damages the rocks around it.' },
  { id: 'escort', name: 'Gun Drone', desc: 'A drone flies with you and shoots pirates.' },
  { id: 'magpulse', name: 'Salvage Beacon', desc: 'Killing a pirate pulls all nearby ore to you.' },
  { id: 'desperate', name: 'Desperate Yield', desc: 'Rocks drop double ore while hull is below 40%.' },
  { id: 'overdrive', name: 'Overdrive', desc: 'Fire 30% faster.' },
  { id: 'heavy', name: 'Heavy Slugs', desc: 'Shots hit 35% harder.' },
  { id: 'plating', name: 'Bulk Plating', desc: '+50 hull, and repairs 50 now.' },
  { id: 'leech', name: 'Scrap Welder', desc: 'Each pirate kill repairs 15 hull.' },
  { id: 'collector', name: 'Wide Magnet', desc: 'Ore magnet reaches twice as far.' },
  { id: 'broker', name: 'Broker Contact', desc: 'Ore sells for 25% more.' },
  { id: 'hold', name: 'Folded Hold', desc: 'Carry 50% more ore.' },
  { id: 'twin', name: 'Twin Barrel', desc: 'Fire one extra shot.' },
  { id: 'bulwark', name: 'Bulwark Cell', desc: '+40 shield.' },
  { id: 'pulsecore', name: 'Pulse Capacitor', desc: 'Pulse recharges twice as fast.' },
  { id: 'momentum', name: 'Momentum', desc: 'Break streaks last 5 seconds instead of 3.' },
  { id: 'afterburner', name: 'Afterburner', desc: '15% faster, and boost uses half the fuel.' },
  { id: 'insurance', name: 'Hull Insurance', desc: 'A lost ship still banks 70% instead of 40%.' },
  { id: 'bounty', name: 'Bounty License', desc: 'Pirate bounties are doubled.' },
  { id: 'critical', name: 'Fault Finder', desc: 'One shot in six deals triple damage.' },
];

export interface RunState {
  seed: number;
  /** Depths cleared so far, which is also the index of the depth being played. */
  depth: number;
  money: number;
  levels: Levels;
  depthEarned: number;
  earned: number;
  progress: number;
  perks: PerkId[];
  rerolls: number;
  hull: number | null;
  cargo: Cargo;
  /** Flying, picking a perk after a cleared depth, or deciding whether to push on. */
  phase: RunPhase;
  /** rerolls used on the current offer */
  rerolled: number;
  bossDown: boolean;
}

export type RunPhase = 'fly' | 'perk' | 'gate';

export type BossKind = 'none' | 'mid' | 'dread';

export function bossFor(depth: number): BossKind {
  const n = depth + 1;
  return n % 6 === 0 ? 'dread' : n % 3 === 0 ? 'mid' : 'none';
}

/** The sector for a depth: the hand-made ones first, then the same curve carried on. */
export function depthSector(depth: number): SectorDef {
  const template = SECTORS[Math.min(depth, SECTORS.length - 1)];
  const past = Math.max(0, depth - (SECTORS.length - 1));
  return {
    ...template,
    name: `Depth ${depth + 1}`,
    goal: Math.round((900 * Math.pow(1.55, depth)) / 50) * 50,
    asteroids: Math.min(240, template.asteroids + past * 6),
    weights: { ...template.weights, voidstone: template.weights.voidstone + past * 0.6 },
    pirateEvery: Math.max(16, template.pirateEvery - past * 1.5),
    maxPirates: Math.min(9, template.maxPirates + Math.floor(past / 2)),
    flareEvery: template.flareEvery && Math.max(28, template.flareEvery - past * 2),
    stormEvery: template.stormEvery && Math.max(34, template.stormEvery - past * 2),
    wells: Math.min(8, template.wells + Math.floor(past / 3)),
    planets: template.planets,
    boss: false,
  };
}

export function depthObjective(seed: number, depth: number): CampaignObjective {
  const options: ObjectiveMetric[] = ['ore', 'pirates', 'special', 'streak'];
  if (depth >= 2) options.push('elite');
  if (depth >= 1) options.push('storm');
  // the first depth is always the plain one
  const rng = mulberry32((seed ^ Math.imul(depth + 1, 0x9e3779b1)) >>> 0);
  const metric: ObjectiveMetric = depth === 0 ? 'ore' : options[Math.floor(rng() * options.length)];
  const target: Record<ObjectiveMetric, number> = {
    ore: Math.min(60, 8 + 4 * depth),
    pirates: Math.min(14, 2 + Math.floor(depth * 0.8)),
    special: Math.min(10, 3 + Math.floor(depth / 2)),
    streak: Math.min(12, 5 + Math.floor(depth / 2)),
    elite: Math.min(4, 1 + Math.floor(depth / 4)),
    storm: 1,
  };
  const n = target[metric];
  const description: Record<ObjectiveMetric, string> = {
    ore: `Recover ${n} ore chunks`,
    pirates: `Defeat ${n} pirate ships`,
    special: `Break ${n} special rocks`,
    streak: `Reach a ${n} rock break streak`,
    elite: `Take down ${n} elite pirate${n > 1 ? 's' : ''}`,
    storm: 'Survive a debris storm',
  };
  return { metric, target: n, description: description[metric], reward: Math.round(150 * Math.pow(1.45, depth)) };
}

/** Three different perks the run does not have yet. The same inputs give the same offer. */
export function perkOffer(seed: number, depth: number, rerolled: number, owned: PerkId[]): PerkDef[] {
  const rng = mulberry32((seed + Math.imul(depth, 7919) + Math.imul(rerolled, 104729)) >>> 0);
  const pool = PERKS.filter((perk) => !owned.includes(perk.id));
  const offer: PerkDef[] = [];
  while (offer.length < 3 && pool.length) offer.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  return offer;
}

export function applyPerks(stats: ShipStats, perks: PerkId[]): ShipStats {
  const s = { ...stats };
  const has = (id: PerkId): boolean => perks.includes(id);
  if (has('overdrive')) s.fireDelay /= 1.3;
  if (has('heavy')) s.damage *= 1.35;
  if (has('plating')) s.hullMax += 50;
  if (has('collector')) s.magnet *= 2;
  if (has('broker')) s.saleMultiplier += 0.25;
  if (has('hold')) s.cargoMax = Math.round(s.cargoMax * 1.5);
  if (has('bulwark')) s.shieldMax += 40;
  if (has('afterburner')) {
    s.maxSpeed *= 1.15;
    s.accel *= 1.15;
    s.sprintEfficiency *= 0.5;
  }
  return s;
}

export function emptyLevels(): Levels {
  const levels = {} as Levels;
  for (const u of UPGRADES) levels[u.id] = 0;
  return levels;
}

export function newRun(seed: number, startMoney: number, rerolls: number): RunState {
  return {
    seed: seed >>> 0,
    depth: 0,
    money: startMoney,
    levels: emptyLevels(),
    depthEarned: 0,
    earned: 0,
    progress: 0,
    perks: [],
    rerolls,
    hull: null,
    cargo: { ferrite: 0, cobalt: 0, platinum: 0, voidstone: 0 },
    phase: 'fly',
    rerolled: 0,
    bossDown: false,
  };
}

export type RunEnd = 'extract' | 'death';

export function claimsFor(run: Pick<RunState, 'earned' | 'depth' | 'perks'>, end: RunEnd): number {
  const share = end === 'extract' ? 1 : run.perks.includes('insurance') ? 0.7 : 0.4;
  return Math.floor((run.earned / 100 + run.depth * 10) * share);
}

const count = (value: unknown, max = 1e12): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;

/** Reads a stored run, or returns null if there is no usable one. */
export function normalizeRun(value: unknown): RunState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.seed !== 'number' || !Number.isFinite(data.seed)) return null;
  const run = newRun(data.seed, count(data.money), Math.floor(count(data.rerolls, 99)));
  const levels = (data.levels ?? {}) as Record<string, unknown>;
  for (const u of UPGRADES) run.levels[u.id] = Math.floor(count(levels[u.id], u.max));
  const cargo = (data.cargo ?? {}) as Record<string, unknown>;
  for (const ore of Object.keys(run.cargo) as (keyof Cargo)[]) run.cargo[ore] = Math.floor(count(cargo[ore], 999));
  run.depth = Math.floor(count(data.depth, 999));
  run.depthEarned = count(data.depthEarned);
  run.earned = count(data.earned);
  run.progress = Math.floor(count(data.progress, 9999));
  const owned: unknown[] = Array.isArray(data.perks) ? data.perks : [];
  run.perks = PERKS.filter((perk) => owned.includes(perk.id)).map((perk) => perk.id);
  run.hull = typeof data.hull === 'number' && Number.isFinite(data.hull) && data.hull > 0 ? data.hull : null;
  run.phase = data.phase === 'perk' || data.phase === 'gate' ? data.phase : 'fly';
  run.rerolled = Math.floor(count(data.rerolled, 99));
  run.bossDown = data.bossDown === true;
  return run;
}
