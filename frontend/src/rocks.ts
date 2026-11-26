// Rock sizes, the special kinds and the break streak. No Phaser here, so it can be tested.
import type { Sz } from './art';

export type RockKind = 'plain' | 'volatile' | 'crystal' | 'dense' | 'comet';
export type SpecialKind = Exclude<RockKind, 'plain'>;

export const AST: Record<Sz, { hp: number; mass: number; drop: number; next: Sz | null; hit: number }> = {
  L: { hp: 70, mass: 8, drop: 2, next: 'M', hit: 1.2 },
  M: { hp: 34, mass: 3, drop: 1, next: 'S', hit: 0.9 },
  S: { hp: 16, mass: 1, drop: 2, next: null, hit: 0.55 },
};

/** Special rocks never split, so `drop` is everything they give. */
export const SPECIALS: Record<SpecialKind, { hp: number; drop: Record<Sz, number> }> = {
  volatile: { hp: 0.6, drop: { L: 4, M: 3, S: 2 } },
  crystal: { hp: 1.3, drop: { L: 5, M: 3, S: 2 } },
  dense: { hp: 2.2, drop: { L: 12, M: 8, S: 4 } },
  comet: { hp: 1.1, drop: { L: 14, M: 10, S: 8 } },
};

export const BLAST_RADIUS = 170;
export const BLAST_DAMAGE = 60;
/** what a volatile blast does to the ship */
export const BLAST_HULL_DAMAGE = 14;

/** A dense core takes this much off every hit, so light shots barely scratch it. */
export const DENSE_ARMOR = 8;
/** how far off the glowing spot, in radians, still counts */
export const WEAK_ARC = 0.55;
export const WEAK_MULTIPLIER = 2.5;
/** most extra ore one crystal gives up to weak point hits */
export const WEAK_BONUS_MAX = 3;

export const COMET_EVERY = 50;

/**
 * Where on a rock's rim a shot went in, as an angle from the rock's centre. The shot is at
 * (x, y) relative to that centre, possibly already a few pixels inside, flying along (vx, vy).
 */
export function entryAngle(x: number, y: number, vx: number, vy: number, radius: number): number {
  const speed = Math.hypot(vx, vy) || 1;
  const dx = vx / speed;
  const dy = vy / speed;
  const along = x * dx + y * dy;
  const back = along + Math.sqrt(Math.max(0, along * along - x * x - y * y + radius * radius));
  return Math.atan2(y - dy * back, x - dx * back);
}

export function rockHp(sz: Sz, kind: RockKind, threat: number): number {
  return AST[sz].hp * (kind === 'plain' ? 1 : SPECIALS[kind].hp) * (1 + 0.15 * threat);
}

export function damageAfterArmor(kind: RockKind, damage: number): number {
  return kind === 'dense' ? Math.max(damage * 0.2, damage - DENSE_ARMOR) : damage;
}

/**
 * Which kind a newly placed rock is. The first sector stays plain while you learn to fly;
 * `wanted` raises the odds when the objective needs special rocks.
 */
export function rollKind(sz: Sz, threat: number, wanted: boolean, random: () => number): RockKind {
  if (sz === 'S' || (threat < 1 && !wanted)) return 'plain';
  const chance = wanted ? 0.34 : Math.min(0.2, 0.07 + 0.02 * threat);
  if (random() >= chance) return 'plain';
  const roll = random();
  return roll < 0.45 ? 'volatile' : roll < 0.75 ? 'crystal' : 'dense';
}

export const STREAK_WINDOW = 3;
export const MOMENTUM_WINDOW = 5;
const STREAK_STEP = 5;
const STREAK_BONUS_MAX = 3;

/** Extra ore each break gives while the streak holds. */
export function streakBonus(count: number): number {
  return Math.min(STREAK_BONUS_MAX, Math.floor(count / STREAK_STEP));
}

export class Streak {
  count = 0;
  private left = 0;

  /** A rock broke. Returns the streak including this one. */
  hit(window: number): number {
    this.left = window;
    return ++this.count;
  }

  update(dt: number): void {
    if (this.count === 0) return;
    this.left -= dt;
    if (this.left <= 0) this.count = 0;
  }
}
