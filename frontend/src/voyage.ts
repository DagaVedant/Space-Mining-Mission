// One trip out: either the campaign sector or one expedition depth. Everything that differs
// between the two lives here, so the flight scene and the station do not have to care.
import {
  CAMPAIGN_OBJECTIVES,
  SECTORS,
  type CampaignObjective,
  type ObjectiveMetric,
  type SectorDef,
} from './data';
import {
  BROKER_PER_LEVEL,
  HULL_PER_LEVEL,
  STAKE_PER_LEVEL,
  bankRun,
  claimMilestones,
  type MilestoneDef,
  type RunReport,
  type StatId,
} from './company';
import {
  addEarnings,
  campaignObjectiveComplete,
  objectiveProgress,
  persist,
  recordCampaignProgress,
  recordDailyProgress,
  statsFor,
  type Cargo,
  type DailyMetric,
  type SaveData,
  type ShipStats,
} from './progress';
import {
  applyPerks,
  bossFor,
  depthObjective,
  depthSector,
  newRun,
  perkOffer,
  type BossKind,
  type PerkDef,
  type PerkId,
  type RunEnd,
  type RunState,
} from './run';

export type VoyageMode = 'campaign' | 'expedition';

/** What the HUD and the station need to know about the current goal. */
export interface VoyageInfo {
  name: string;
  /** difficulty step: the sector index, or the depth */
  threat: number;
  quotaLabel: string;
  goal: number;
  earned: number;
  mission: { description: string; progress: number; target: number; complete: boolean };
  /** set while a boss still stands between the player and the way on */
  bossName: string | null;
  /** false only in the campaign's last sector */
  hasGate: boolean;
}

export const BOSS_NAMES: Record<Exclude<BossKind, 'none'>, string> = {
  mid: 'Marauder',
  dread: 'Dreadnought',
};

export function startRun(home: SaveData, seed = Math.floor(Math.random() * 2 ** 32)): RunState {
  const { upgrades } = home.company;
  home.run = newRun(seed, 60 + STAKE_PER_LEVEL * upgrades.stake, upgrades.rerolls);
  return home.run;
}

export class Voyage {
  /** The campaign save: the only thing ever written to disk. */
  readonly home: SaveData;
  /** What the scene spends and earns: the campaign save itself, or a stand-in filled from the run. */
  readonly save: SaveData;
  readonly run: RunState | null;
  readonly sector: SectorDef;
  readonly objective: CampaignObjective;
  readonly threat: number;
  readonly boss: BossKind;
  /** set once an expedition has been banked, so nothing writes the run back */
  over = false;

  constructor(home: SaveData, mode: VoyageMode) {
    this.home = home;
    const run = mode === 'expedition' ? home.run : null;
    this.run = run;
    if (!run) {
      this.save = home;
      this.threat = home.sector;
      this.sector = SECTORS[home.sector];
      this.objective = CAMPAIGN_OBJECTIVES[home.sector];
      this.boss = this.sector.boss ? 'dread' : 'none';
      return;
    }
    this.threat = run.depth;
    this.objective = depthObjective(run.seed, run.depth);
    const sector = depthSector(run.depth);
    // a storm objective needs storms
    this.sector = this.objective.metric === 'storm' && !sector.stormEvery ? { ...sector, stormEvery: 45 } : sector;
    this.boss = bossFor(run.depth);
    this.save = {
      ...home,
      money: run.money,
      lifetime: run.earned,
      sectorEarned: run.depthEarned,
      levels: run.levels,
      sector: Math.min(run.depth, SECTORS.length - 1),
      won: false,
      dailyProgress: { ...home.dailyProgress },
      claimedDaily: [...home.claimedDaily],
      unlockedPilots: [...home.unlockedPilots],
      unlockedSkins: [...home.unlockedSkins],
      discoveries: [],
    };
  }

  /** Sector table index for things that only know the six hand-made sectors. */
  get tier(): number {
    return Math.min(this.threat, SECTORS.length - 1);
  }

  has(perk: PerkId): boolean {
    return this.run?.perks.includes(perk) ?? false;
  }

  stats(): ShipStats {
    const base = statsFor(this.save.levels, this.home.selectedPilot);
    if (!this.run) return base;
    const stats = applyPerks(base, this.run.perks);
    const { upgrades } = this.home.company;
    stats.saleMultiplier += BROKER_PER_LEVEL * upgrades.broker;
    stats.hullMax += HULL_PER_LEVEL * upgrades.hull;
    return stats;
  }

  progress(): number {
    return this.run ? Math.min(this.objective.target, this.run.progress) : objectiveProgress(this.home);
  }

  objectiveDone(): boolean {
    return this.run ? this.run.progress >= this.objective.target : campaignObjectiveComplete(this.home);
  }

  /** A streak counts its best value; every other metric adds up. */
  record(metric: ObjectiveMetric, amount = 1): void {
    if (!this.run) {
      recordCampaignProgress(this.home, metric, amount);
      return;
    }
    const { target } = this.objective;
    if (metric !== this.objective.metric || amount <= 0 || this.run.progress >= target) return;
    const next = metric === 'streak' ? Math.max(this.run.progress, amount) : this.run.progress + amount;
    this.run.progress = Math.min(target, next);
  }

  requirementsMet(): boolean {
    return this.save.sectorEarned >= this.sector.goal && this.objectiveDone();
  }

  bossDue(): boolean {
    if (this.boss === 'none' || this.over || !this.requirementsMet()) return false;
    return this.run ? !this.run.bossDown : !this.home.won;
  }

  /** The campaign's last sector has no way on; every expedition depth does. */
  get hasGate(): boolean {
    return this.run !== null || !this.sector.boss;
  }

  gateOpen(): boolean {
    if (!this.hasGate || !this.requirementsMet()) return false;
    return !this.run || this.boss === 'none' || this.run.bossDown;
  }

  nextName(): string {
    return this.run ? `Depth ${this.run.depth + 2}` : SECTORS[Math.min(this.home.sector + 1, SECTORS.length - 1)].name;
  }

  info(): VoyageInfo {
    const bossStanding = this.boss !== 'none' && (this.run ? !this.run.bossDown : !this.home.won);
    return {
      name: this.run ? this.sector.name : `Sector ${this.threat + 1}: ${this.sector.name}`,
      threat: this.threat,
      quotaLabel: this.run ? 'Depth quota' : 'Sector quota',
      goal: this.sector.goal,
      earned: this.save.sectorEarned,
      mission: {
        description: this.objective.description,
        progress: this.progress(),
        target: this.objective.target,
        complete: this.objectiveDone(),
      },
      bossName: bossStanding ? BOSS_NAMES[this.boss] : null,
      hasGate: this.hasGate,
    };
  }

  earn(amount: number): void {
    addEarnings(this.save, amount);
    if (this.run) recordDailyProgress(this.home, 'credits', amount);
  }

  daily(metric: DailyMetric, amount = 1): void {
    recordDailyProgress(this.home, metric, amount);
  }

  /** Company records only move on expeditions. Returns any milestone this reached. */
  tally(stat: StatId, amount = 1): MilestoneDef[] {
    if (!this.run || this.over) return [];
    const { stats } = this.home.company;
    stats[stat] = stat === 'bestStreak' ? Math.max(stats[stat], amount) : stats[stat] + amount;
    return claimMilestones(this.home.company);
  }

  private sync(cargo: Cargo, hull: number): void {
    if (!this.run || this.over) return;
    this.run.money = this.save.money;
    this.run.depthEarned = this.save.sectorEarned;
    this.run.earned = this.save.lifetime;
    this.run.cargo = { ...cargo };
    this.run.hull = hull > 0 ? hull : null;
  }

  store(cargo: Cargo, hull: number): void {
    this.sync(cargo, hull);
    persist(this.home);
  }

  bossDown(): void {
    if (this.run) this.run.bossDown = true;
  }

  /** Banks the depth just cleared and moves the run on to the perk choice. */
  clearDepth(cargo: Cargo, hull: number): void {
    const run = this.run;
    if (!run) return;
    this.sync(cargo, hull);
    run.depth += 1;
    this.save.sectorEarned = 0;
    run.depthEarned = 0;
    run.progress = 0;
    run.rerolled = 0;
    run.bossDown = false;
    run.phase = this.offer().length ? 'perk' : 'gate';
    persist(this.home);
  }

  offer(): PerkDef[] {
    const run = this.home.run;
    return run ? perkOffer(run.seed, run.depth, run.rerolled, run.perks) : [];
  }

  reroll(): boolean {
    const run = this.home.run;
    if (!run || run.rerolls <= 0) return false;
    run.rerolls -= 1;
    run.rerolled += 1;
    persist(this.home);
    return true;
  }

  takePerk(id: PerkId): void {
    const run = this.home.run;
    if (!run || run.phase !== 'perk' || run.perks.includes(id)) return;
    run.perks.push(id);
    if (id === 'plating' && run.hull !== null) run.hull = Math.min(this.stats().hullMax, run.hull + 50);
    run.phase = 'gate';
    persist(this.home);
  }

  pushOn(): void {
    if (!this.home.run) return;
    this.home.run.phase = 'fly';
    persist(this.home);
  }

  /** Ends the expedition and pays it into the company. */
  end(how: RunEnd, cargo?: Cargo, hull = 0): RunReport {
    const run = this.run;
    if (!run || this.over) return { claims: 0, milestones: [] };
    if (cargo) this.sync(cargo, hull);
    const report = bankRun(this.home.company, run, how);
    this.home.run = null;
    this.over = true;
    persist(this.home);
    return report;
  }
}
