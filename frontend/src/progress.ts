import { ORES, ORE_IDS, SECTORS, UPGRADES, type OreId, type UpgradeId } from './data';
import type { Rng } from './rng';

export type Levels = Record<UpgradeId, number>;
export type Cargo = Record<OreId, number>;

export interface SaveData {
  v: 1;
  money: number;
  lifetime: number;
  sector: number;
  sectorEarned: number;
  levels: Levels;
  won: boolean;
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
  return { v: 1, money: 60, lifetime: 0, sector: 0, sectorEarned: 0, levels, won: false };
}

export interface ShipStats {
  damage: number;
  fireDelay: number;
  hullMax: number;
  cargoMax: number;
  accel: number;
  maxSpeed: number;
  fuelMax: number;
  magnet: number;
  drones: number;
  droneDamage: number;
  turretDamage: number;
  turretDelay: number;
}

export function statsFor(l: Levels): ShipStats {
  return {
    damage: 10 + 5 * l.cannon,
    fireDelay: 280 - 30 * l.rate,
    hullMax: 100 + 30 * l.hull,
    cargoMax: 30 + 12 * l.cargo,
    accel: 520 + 70 * l.thrust,
    maxSpeed: 340 + 35 * l.thrust,
    fuelMax: 100 + 25 * l.tank,
    magnet: 90 + 30 * l.magnet,
    drones: l.drones,
    droneDamage: 5 + 3 * l.yield,
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
}

export function sectorGoalReached(save: SaveData): boolean {
  return save.sectorEarned >= SECTORS[save.sector].goal;
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

const KEY = 'rockbreaker-save-v1';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1) return null;
    const base = newSave();
    return { ...base, ...d, levels: { ...base.levels, ...d.levels } };
  } catch {
    return null;
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // storage unavailable: progress is simply not saved
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
