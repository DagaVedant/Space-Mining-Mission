export type OreId = 'ferrite' | 'cobalt' | 'platinum' | 'voidstone';
export const ORE_IDS: OreId[] = ['ferrite', 'cobalt', 'platinum', 'voidstone'];

export interface OreDef {
  id: OreId;
  name: string;
  base: number;
  color: number;
  css: string;
}

export const ORES: Record<OreId, OreDef> = {
  ferrite: { id: 'ferrite', name: 'Ferrite', base: 14, color: 0xc98b5a, css: '#c98b5a' },
  cobalt: { id: 'cobalt', name: 'Cobalt', base: 36, color: 0x4f9bd9, css: '#4f9bd9' },
  platinum: { id: 'platinum', name: 'Platinum', base: 90, color: 0xe8e4d0, css: '#e8e4d0' },
  voidstone: { id: 'voidstone', name: 'Voidstone', base: 210, color: 0xb35cf0, css: '#b35cf0' },
};

export type UpgradeId =
  | 'cannon'
  | 'rate'
  | 'hull'
  | 'cargo'
  | 'thrust'
  | 'tank'
  | 'magnet'
  | 'drones'
  | 'yield'
  | 'turret';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  max: number;
  baseCost: number;
  growth: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'cannon', name: 'Cannon Damage', desc: 'Harder-hitting mining shots.', max: 5, baseCost: 90, growth: 1.75 },
  { id: 'rate', name: 'Fire Rate', desc: 'Shoot faster.', max: 5, baseCost: 80, growth: 1.7 },
  { id: 'hull', name: 'Hull Plating', desc: 'More hull to survive hits.', max: 5, baseCost: 110, growth: 1.7 },
  { id: 'cargo', name: 'Cargo Hold', desc: 'Carry more ore per trip.', max: 5, baseCost: 120, growth: 1.8 },
  { id: 'thrust', name: 'Thrusters', desc: 'Faster acceleration and top speed.', max: 5, baseCost: 100, growth: 1.7 },
  { id: 'tank', name: 'Fuel Tank', desc: 'Bigger tank, longer trips.', max: 5, baseCost: 70, growth: 1.6 },
  { id: 'magnet', name: 'Ore Magnet', desc: 'Pull ore from farther away.', max: 5, baseCost: 85, growth: 1.65 },
  { id: 'drones', name: 'Drone Bay', desc: 'Each level adds an auto-mining drone (upkeep applies).', max: 5, baseCost: 260, growth: 1.9 },
  { id: 'yield', name: 'Drone Yield', desc: 'Drones hit harder and earn more.', max: 5, baseCost: 200, growth: 1.8 },
  { id: 'turret', name: 'Station Turret', desc: 'Defend the station and drones from pirates.', max: 5, baseCost: 150, growth: 1.75 },
];

export interface SectorDef {
  name: string;
  size: number;
  goal: number;
  asteroids: number;
  weights: Record<OreId, number>;
  pirateEvery: number;
  maxPirates: number;
  flareEvery: number;
  stormEvery: number;
  wells: number;
  boss: boolean;
}

export const SECTORS: SectorDef[] = [
  {
    name: 'Kuiper Verge',
    size: 3600,
    goal: 1800,
    asteroids: 70,
    weights: { ferrite: 8, cobalt: 2, platinum: 0, voidstone: 0 },
    pirateEvery: 80,
    maxPirates: 1,
    flareEvery: 0,
    stormEvery: 0,
    wells: 0,
    boss: false,
  },
  {
    name: 'Cinder Belt',
    size: 4200,
    goal: 8000,
    asteroids: 90,
    weights: { ferrite: 5, cobalt: 4, platinum: 1, voidstone: 0 },
    pirateEvery: 60,
    maxPirates: 2,
    flareEvery: 95,
    stormEvery: 120,
    wells: 2,
    boss: false,
  },
  {
    name: 'Gravel Deep',
    size: 4800,
    goal: 22000,
    asteroids: 110,
    weights: { ferrite: 3, cobalt: 4, platinum: 3, voidstone: 0.5 },
    pirateEvery: 48,
    maxPirates: 3,
    flareEvery: 75,
    stormEvery: 90,
    wells: 3,
    boss: false,
  },
  {
    name: 'The Maw',
    size: 5200,
    goal: 50000,
    asteroids: 120,
    weights: { ferrite: 2, cobalt: 3, platinum: 4, voidstone: 2 },
    pirateEvery: 40,
    maxPirates: 4,
    flareEvery: 65,
    stormEvery: 75,
    wells: 4,
    boss: true,
  },
];
