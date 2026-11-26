// Pirate ships, elite modifiers and who shows up where. No Phaser here, so it can be tested.

export type PirateKind = 'raider' | 'interceptor' | 'bomber' | 'gunship' | 'minelayer' | 'scavenger';

export interface PirateDef {
  name: string;
  texture: string;
  hp: number;
  speed: number;
  accel: number;
  turn: number;
  /** distance it tries to hold from its target */
  keep: number;
  shotDamage: number;
  shotSpeed: number;
  fireDelay: number;
  /** 0 means it never shoots */
  range: number;
  radius: number;
}

export const PIRATE_TYPES: Record<PirateKind, PirateDef> = {
  raider: { name: 'Raider', texture: 'pirate', hp: 1, speed: 240, accel: 1, turn: 4.5, keep: 190, shotDamage: 6, shotSpeed: 380, fireDelay: 1.5, range: 580, radius: 16 },
  interceptor: { name: 'Interceptor', texture: 'pirate_interceptor', hp: 0.72, speed: 360, accel: 1.28, turn: 5.5, keep: 190, shotDamage: 5, shotSpeed: 430, fireDelay: 1.05, range: 620, radius: 14 },
  bomber: { name: 'Bomber', texture: 'pirate_bomber', hp: 1.65, speed: 180, accel: 0.72, turn: 3.5, keep: 260, shotDamage: 11, shotSpeed: 310, fireDelay: 2.2, range: 760, radius: 20 },
  // slow to turn, so you can get round behind its shield
  gunship: { name: 'Gunship', texture: 'pirate_gunship', hp: 2.1, speed: 165, accel: 0.65, turn: 1.4, keep: 260, shotDamage: 9, shotSpeed: 360, fireDelay: 1.7, range: 640, radius: 21 },
  minelayer: { name: 'Mine layer', texture: 'pirate_minelayer', hp: 1.2, speed: 230, accel: 0.95, turn: 3.5, keep: 380, shotDamage: 0, shotSpeed: 0, fireDelay: 2.6, range: 0, radius: 18 },
  scavenger: { name: 'Scavenger', texture: 'pirate_scavenger', hp: 0.8, speed: 310, accel: 1.35, turn: 6, keep: 0, shotDamage: 0, shotSpeed: 0, fireDelay: 9, range: 0, radius: 14 },
};

/** half-angle of the gunship's front shield */
export const SHIELD_ARC = 1.15;
/** how much loose ore a scavenger takes before it runs */
export const SCAVENGER_LOAD = 6;
export const MINE_LIFE = 18;
export const MAX_MINES = 12;

/** True when a shot flying along `shotAngle` meets the shield of a ship facing `facing`. */
export function hitsShield(facing: number, shotAngle: number): boolean {
  const from = shotAngle + Math.PI;
  const off = Math.atan2(Math.sin(from - facing), Math.cos(from - facing));
  return Math.abs(off) < SHIELD_ARC;
}

const ROSTER: { kind: PirateKind; from: number; weight: number }[] = [
  { kind: 'raider', from: 0, weight: 40 },
  { kind: 'interceptor', from: 1, weight: 25 },
  { kind: 'bomber', from: 1, weight: 18 },
  { kind: 'scavenger', from: 2, weight: 14 },
  { kind: 'gunship', from: 2, weight: 14 },
  { kind: 'minelayer', from: 3, weight: 12 },
];

export function pickPirate(threat: number, random: () => number): PirateKind {
  const open = ROSTER.filter((entry) => threat >= entry.from);
  let roll = random() * open.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of open) {
    roll -= entry.weight;
    if (roll < 0) return entry.kind;
  }
  return 'raider';
}

export type EliteMod = 'armored' | 'swift' | 'volley' | 'mending';

export const ELITES: Record<EliteMod, { name: string; color: number }> = {
  armored: { name: 'Armored', color: 0xcfd6dd },
  swift: { name: 'Swift', color: 0x6ee7ff },
  volley: { name: 'Volley', color: 0xffb03a },
  mending: { name: 'Mending', color: 0x7ee07a },
};

/** Elites start two steps in; `wanted` makes sure an elite objective can be finished. */
export function rollElite(kind: PirateKind, threat: number, wanted: boolean, random: () => number): EliteMod | null {
  if (threat < 2 && !wanted) return null;
  const chance = wanted ? 0.6 : Math.min(0.35, 0.07 * (threat - 1));
  if (random() >= chance) return null;
  // a ship that never shoots cannot have a volley
  const mods: EliteMod[] = PIRATE_TYPES[kind].range > 0 ? ['armored', 'swift', 'volley', 'mending'] : ['armored', 'swift', 'mending'];
  return mods[Math.floor(random() * mods.length)];
}
