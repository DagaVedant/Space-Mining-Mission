import {
  ORES,
  ORE_IDS,
  PILOTS,
  SECTORS,
  SHIP_SKINS,
  CAMPAIGN_OBJECTIVES,
  DISCOVERY_SITES,
  DISCOVERY_SKIN_UNLOCK_AT,
  UPGRADES,
  type OreId,
  type PilotId,
  type ShipSkinId,
  type WeaponId,
  type UpgradeId,
} from './data';
import { mulberry32, type Rng } from './rng';

export type Levels = Record<UpgradeId, number>;
export type Cargo = Record<OreId, number>;

export interface SaveData {
  v: 4;
  money: number;
  lifetime: number;
  sector: number;
  sectorEarned: number;
  levels: Levels;
  won: boolean;
  selectedPilot: PilotId;
  selectedSkin: ShipSkinId;
  selectedWeapon: WeaponId;
  unlockedPilots: PilotId[];
  unlockedSkins: ShipSkinId[];
  dailyQuestDate: string;
  dailyProgress: Record<DailyMetric, number>;
  claimedDaily: string[];
  objectiveProgress: number[];
  completedObjectives: number[];
  discoveries: string[];
  updatedAt: number;
}

export type DailyMetric = 'ore' | 'pirates' | 'credits';

export interface DailyQuest {
  id: string;
  description: string;
  metric: DailyMetric;
  target: number;
  reward: number;
}

const DAILY_QUEST_TEMPLATES: Omit<DailyQuest, 'id'>[] = [
  { description: 'Collect 20 ore chunks.', metric: 'ore', target: 20, reward: 350 },
  { description: 'Collect 35 ore chunks.', metric: 'ore', target: 35, reward: 600 },
  { description: 'Defeat 3 pirate ships.', metric: 'pirates', target: 3, reward: 450 },
  { description: 'Defeat 5 pirate ships.', metric: 'pirates', target: 5, reward: 750 },
  { description: 'Earn 1,500 credits.', metric: 'credits', target: 1500, reward: 500 },
  { description: 'Earn 3,000 credits.', metric: 'credits', target: 3000, reward: 900 },
  { description: 'Collect 50 ore chunks.', metric: 'ore', target: 50, reward: 900 },
  { description: 'Defeat 8 pirate ships.', metric: 'pirates', target: 8, reward: 1200 },
];

export function utcDate(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function dailyQuestsFor(date: string): DailyQuest[] {
  let seed = 0;
  for (const char of date) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const rng = mulberry32(seed);
  const options = DAILY_QUEST_TEMPLATES.map((quest) => ({ ...quest }));
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options.slice(0, 3).map((quest) => ({ ...quest, id: `${date}-${quest.metric}-${quest.target}` }));
}

export function emptyCargo(): Cargo {
  return { ferrite: 0, cobalt: 0, platinum: 0, voidstone: 0 };
}

export function cargoTotal(c: Cargo): number {
  return ORE_IDS.reduce((s, o) => s + c[o], 0);
}

export function newSave(): SaveData {
  const levels = {} as Levels;
  for (const u of UPGRADES) levels[u.id] = 0;
  const date = utcDate();
  const save: SaveData = {
    v: 4,
    money: 60,
    lifetime: 0,
    sector: 0,
    sectorEarned: 0,
    levels,
    won: false,
    selectedPilot: 'prospector',
    selectedSkin: 'industrial',
    selectedWeapon: 'miner',
    unlockedPilots: ['prospector'],
    unlockedSkins: ['industrial'],
    dailyQuestDate: date,
    dailyProgress: { ore: 0, pirates: 0, credits: 0 },
    claimedDaily: [],
    objectiveProgress: Array.from({ length: SECTORS.length }, () => 0),
    completedObjectives: [],
    discoveries: [],
    updatedAt: Date.now(),
  };
  refreshUnlocks(save);
  return save;
}

export interface ShipStats {
  damage: number;
  fireDelay: number;
  hullMax: number;
  hullRegen: number;
  cargoMax: number;
  accel: number;
  maxSpeed: number;
  fuelMax: number;
  sprintRegen: number;
  sprintEfficiency: number;
  magnet: number;
  shieldMax: number;
  saleMultiplier: number;
  drones: number;
  droneDamage: number;
  turretDamage: number;
  turretDelay: number;
}

export function statsFor(l: Levels, pilotId: PilotId = 'prospector'): ShipStats {
  const pilot = PILOTS.find((x) => x.id === pilotId) ?? PILOTS[0];
  return {
    damage: 10 + 5 * l.cannon,
    fireDelay: 280 - 30 * l.rate,
    hullMax: 100 + 30 * l.hull + pilot.hullBonus,
    hullRegen: 0.4 * l.repair,
    cargoMax: 64 + 16 * l.cargo,
    accel: 520 + 70 * l.thrust + pilot.thrustBonus,
    maxSpeed: 340 + 35 * l.thrust + pilot.thrustBonus * 0.1,
    fuelMax: 100 + 25 * l.tank + 15 * l.sprint,
    sprintRegen: 1.2 * l.sprint,
    sprintEfficiency: 1 - 0.08 * l.sprint,
    magnet: 90 + 30 * l.magnet + 22 * l.scanner,
    shieldMax: 20 * l.shield,
    saleMultiplier: 1 + 0.08 * l.refinery + pilot.saleBonus,
    drones: l.drones,
    droneDamage: 8 + 4 * l.yield,
    turretDamage: 8 + 5 * l.turret,
    turretDelay: 1100 - 120 * l.turret,
  };
}

export function upgradeCost(id: UpgradeId, level: number): number {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) throw new Error(`unknown upgrade ${id}`);
  return Math.round((u.baseCost * Math.pow(u.growth, level)) / 5) * 5;
}

export function canBuyUpgrade(save: SaveData, id: UpgradeId): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return false;
  const lvl = save.levels[id];
  return lvl < u.max && save.money >= upgradeCost(id, lvl);
}

export function buyUpgrade(save: SaveData, id: UpgradeId): boolean {
  if (!canBuyUpgrade(save, id)) return false;
  save.money -= upgradeCost(id, save.levels[id]);
  save.levels[id] += 1;
  return true;
}

export function droneUpkeepPerSecond(drones: number): number {
  return drones * 0.05;
}

export function repairCost(missing: number, sector: number): number {
  return Math.ceil(missing * (0.8 + 0.4 * sector));
}

export function refuelCost(missing: number, sector: number): number {
  return Math.ceil(missing * (0.4 + 0.2 * sector));
}

export function addEarnings(save: SaveData, amount: number): void {
  save.money += amount;
  save.lifetime += amount;
  save.sectorEarned += amount;
  recordDailyProgress(save, 'credits', amount);
  refreshUnlocks(save);
}

export function sectorGoalReached(save: SaveData): boolean {
  return save.sectorEarned >= SECTORS[save.sector].goal;
}

export function objectiveProgress(save: SaveData): number {
  return Math.min(CAMPAIGN_OBJECTIVES[save.sector].target, save.objectiveProgress[save.sector] ?? 0);
}

export function campaignObjectiveComplete(save: SaveData): boolean {
  return save.completedObjectives.includes(save.sector);
}

export function campaignRequirementsMet(save: SaveData): boolean {
  return sectorGoalReached(save) && campaignObjectiveComplete(save);
}

export function recordCampaignProgress(save: SaveData, metric: 'ore' | 'pirates', amount = 1): boolean {
  const objective = CAMPAIGN_OBJECTIVES[save.sector];
  if (objective.metric !== metric || !Number.isFinite(amount) || amount <= 0 || campaignObjectiveComplete(save)) return false;
  save.objectiveProgress[save.sector] = (save.objectiveProgress[save.sector] ?? 0) + amount;
  if (save.objectiveProgress[save.sector] < objective.target) return false;
  save.objectiveProgress[save.sector] = objective.target;
  save.completedObjectives.push(save.sector);
  return true;
}

export function recordDiscovery(save: SaveData, id: string): boolean {
  if (!DISCOVERY_SITES.some((site) => site.id === id) || save.discoveries.includes(id)) return false;
  save.discoveries.push(id);
  refreshUnlocks(save);
  return true;
}

export function ensureDailyQuests(save: SaveData, date = utcDate()): DailyQuest[] {
  if (save.dailyQuestDate !== date) {
    save.dailyQuestDate = date;
    save.dailyProgress = { ore: 0, pirates: 0, credits: 0 };
    save.claimedDaily = [];
  }
  return dailyQuestsFor(date);
}

export function recordDailyProgress(save: SaveData, metric: DailyMetric, amount: number): void {
  ensureDailyQuests(save);
  if (Number.isFinite(amount) && amount > 0) save.dailyProgress[metric] += amount;
}

export function claimDailyQuest(save: SaveData, id: string): boolean {
  const quests = ensureDailyQuests(save);
  const quest = quests.find((candidate) => candidate.id === id);
  if (!quest || save.claimedDaily.includes(id) || save.dailyProgress[quest.metric] < quest.target) return false;
  save.claimedDaily.push(id);
  save.money += quest.reward;
  save.lifetime += quest.reward;
  save.sectorEarned += quest.reward;
  refreshUnlocks(save);
  if (quests.every((candidate) => save.claimedDaily.includes(candidate.id))) {
    const skin = SHIP_SKINS.find((candidate) => !save.unlockedSkins.includes(candidate.id));
    if (skin) save.unlockedSkins.push(skin.id);
  }
  return true;
}

export function refreshUnlocks(save: SaveData): void {
  const pilotByLifetime: Record<PilotId, number> = { prospector: 0, vanguard: 8000, scout: 22000 };
  for (const pilot of PILOTS) {
    if (save.lifetime >= pilotByLifetime[pilot.id] && !save.unlockedPilots.includes(pilot.id)) {
      save.unlockedPilots.push(pilot.id);
    }
  }
  const skinAtSector: Record<ShipSkinId, number> = { industrial: 0, cobalt: 1, ember: 2, void: 4 };
  for (const skin of SHIP_SKINS) {
    const discoveryUnlock = skin.id === 'void' && save.discoveries.length >= DISCOVERY_SKIN_UNLOCK_AT;
    if ((save.sector >= skinAtSector[skin.id] || discoveryUnlock) && !save.unlockedSkins.includes(skin.id)) {
      save.unlockedSkins.push(skin.id);
    }
  }
}

export interface Contract {
  id: number;
  ore: OreId;
  qty: number;
  reward: number;
  deadline: number;
}

let nextContractId = 1;

export function makeContract(sector: number, now: number, rng: Rng): Contract {
  const weights = SECTORS[sector].weights;
  const options = ORE_IDS.filter((o) => weights[o] > 0);
  const ore = options[Math.floor(rng() * options.length)];
  const qty = 6 + Math.floor(rng() * (6 + sector * 4));
  const reward = Math.round(qty * ORES[ore].base * (1.15 + rng() * 0.25));
  return { id: nextContractId++, ore, qty, reward, deadline: now + 240 + rng() * 120 };
}

export interface FulfillResult {
  cargo: Cargo;
  done: Contract[];
  expired: Contract[];
  remaining: Contract[];
  payout: number;
}

export function resolveContracts(cargo: Cargo, active: Contract[], now: number): FulfillResult {
  const left = { ...cargo };
  const done: Contract[] = [];
  const expired: Contract[] = [];
  const remaining: Contract[] = [];
  let payout = 0;
  for (const c of active) {
    if (left[c.ore] >= c.qty) {
      left[c.ore] -= c.qty;
      payout += c.reward;
      done.push(c);
    } else if (c.deadline <= now) {
      expired.push(c);
    } else {
      remaining.push(c);
    }
  }
  return { cargo: left, done, expired, remaining, payout };
}

const KEY = 'rockbreaker-save-v2';
const LEGACY_KEY = 'rockbreaker-save-v1';
let cloudSync: ((save: SaveData) => Promise<void>) | null = null;

export function setCloudSyncHandler(handler: ((save: SaveData) => Promise<void>) | null): void {
  cloudSync = handler;
}

export function normalizeSave(value: unknown): SaveData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const version = data.v;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) return null;
  const base = newSave();
  const sector = typeof data.sector === 'number' && Number.isInteger(data.sector)
    ? Math.min(SECTORS.length - 1, Math.max(0, data.sector))
    : 0;
  const levels = { ...base.levels };
  if (data.levels && typeof data.levels === 'object') {
    const rawLevels = data.levels as Record<string, unknown>;
    for (const upgrade of UPGRADES) {
      const level = rawLevels[upgrade.id];
      if (typeof level === 'number' && Number.isFinite(level)) levels[upgrade.id] = Math.min(upgrade.max, Math.max(0, Math.floor(level)));
    }
  }
  const rawUnlockedPilots = data.unlockedPilots;
  const unlockedPilots = Array.isArray(rawUnlockedPilots)
    ? PILOTS.filter((pilot) => rawUnlockedPilots.includes(pilot.id)).map((pilot) => pilot.id)
    : base.unlockedPilots;
  const rawUnlockedSkins = data.unlockedSkins;
  const unlockedSkins = Array.isArray(rawUnlockedSkins)
    ? SHIP_SKINS.filter((skin) => rawUnlockedSkins.includes(skin.id)).map((skin) => skin.id)
    : base.unlockedSkins;
  const selectedPilot = PILOTS.find((pilot) => pilot.id === data.selectedPilot && unlockedPilots.includes(pilot.id))?.id
    ?? 'prospector';
  const selectedSkin = SHIP_SKINS.find((skin) => skin.id === data.selectedSkin && unlockedSkins.includes(skin.id))?.id
    ?? 'industrial';
  const selectedWeapon = data.selectedWeapon === 'scatter' || data.selectedWeapon === 'lance' ? data.selectedWeapon : 'miner';
  const rawObjectiveProgress = Array.isArray(data.objectiveProgress) ? data.objectiveProgress : [];
  const objectiveProgressBySector = Array.from({ length: SECTORS.length }, (_, i) => {
    const objective = CAMPAIGN_OBJECTIVES[i];
    const value = rawObjectiveProgress[i];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(objective.target, Math.max(0, Math.floor(value))) : 0;
  });
  const completedObjectives = Array.isArray(data.completedObjectives)
    ? [...new Set(data.completedObjectives.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < SECTORS.length))]
    : [];
  if (version < 3) {
    for (let index = 0; index < sector; index++) completedObjectives.push(index);
    const earned = typeof data.sectorEarned === 'number' && Number.isFinite(data.sectorEarned) ? data.sectorEarned : 0;
    if (earned >= SECTORS[sector].goal) completedObjectives.push(sector);
  }
  const uniqueCompletedObjectives = [...new Set(completedObjectives)].sort((a, b) => a - b);
  for (const index of uniqueCompletedObjectives) objectiveProgressBySector[index] = CAMPAIGN_OBJECTIVES[index].target;
  const rawProgress = data.dailyProgress;
  const progress = rawProgress && typeof rawProgress === 'object' && !Array.isArray(rawProgress)
    ? rawProgress as Record<string, unknown>
    : {};
  const claimedDaily = Array.isArray(data.claimedDaily)
    ? data.claimedDaily.filter((id): id is string => typeof id === 'string')
    : [];
  const knownDiscoveryIds = new Set(DISCOVERY_SITES.map((site) => site.id));
  const discoveries = Array.isArray(data.discoveries)
    ? [...new Set(data.discoveries.filter((id): id is string => typeof id === 'string' && knownDiscoveryIds.has(id)))]
    : [];
  const save: SaveData = {
    ...base,
    money: typeof data.money === 'number' && Number.isFinite(data.money) ? Math.max(0, data.money) : base.money,
    lifetime: typeof data.lifetime === 'number' && Number.isFinite(data.lifetime) ? Math.max(0, data.lifetime) : base.lifetime,
    sector,
    sectorEarned: typeof data.sectorEarned === 'number' && Number.isFinite(data.sectorEarned) ? Math.max(0, data.sectorEarned) : 0,
    levels,
    won: data.won === true,
    selectedPilot,
    selectedSkin,
    selectedWeapon,
    unlockedPilots: [...new Set(['prospector' as PilotId, ...unlockedPilots])],
    unlockedSkins: [...new Set(['industrial' as ShipSkinId, ...unlockedSkins])],
    dailyQuestDate: typeof data.dailyQuestDate === 'string' ? data.dailyQuestDate : base.dailyQuestDate,
    dailyProgress: {
      ore: typeof progress.ore === 'number' && Number.isFinite(progress.ore) ? Math.max(0, progress.ore) : 0,
      pirates: typeof progress.pirates === 'number' && Number.isFinite(progress.pirates) ? Math.max(0, progress.pirates) : 0,
      credits: typeof progress.credits === 'number' && Number.isFinite(progress.credits) ? Math.max(0, progress.credits) : 0,
    },
    claimedDaily,
    objectiveProgress: objectiveProgressBySector,
    completedObjectives: uniqueCompletedObjectives,
    discoveries,
    updatedAt: version >= 2 && typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : 0,
    v: 4,
  };
  refreshUnlocks(save);
  return save;
}

export function loadSave(): SaveData | null {
  try {
    const currentRaw = localStorage.getItem(KEY);
    const raw = currentRaw ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const save = normalizeSave(JSON.parse(raw) as unknown);
    if (save && !currentRaw) {
      localStorage.setItem(KEY, JSON.stringify(save));
      localStorage.removeItem(LEGACY_KEY);
    }
    return save;
  } catch (error) {
    console.warn('Unable to load local campaign save.', error);
    return null;
  }
}

export function persist(save: SaveData, sync = true, touch = true): void {
  try {
    save.v = 4;
    if (touch) save.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(save));
    localStorage.removeItem(LEGACY_KEY);
  } catch (error) {
    console.warn('Unable to persist campaign save in localStorage.', error);
  }
  if (sync && cloudSync) {
    void cloudSync(save).catch((error: unknown) => {
      console.error('Cloud save sync failed; the local save is still available.', error);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rockbreaker-cloud-save-error'));
    });
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch (error) {
    console.warn('Unable to clear local campaign save.', error);
  }
}
