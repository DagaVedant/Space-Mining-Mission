import { describe, expect, it } from 'vitest';
import { PIRATE_TYPES, hitsShield, pickPirate, rollElite } from '../src/enemies';
import { Streak, damageAfterArmor, entryAngle, rollKind, streakBonus } from '../src/rocks';

describe('special rocks', () => {
  it('keeps the first sector plain unless an objective asks for them', () => {
    expect(rollKind('L', 0, false, () => 0)).toBe('plain');
    expect(rollKind('L', 0, true, () => 0)).toBe('volatile');
    expect(rollKind('S', 5, true, () => 0)).toBe('plain');
  });

  it('lets a dense core shrug off light hits but not stop them', () => {
    expect(damageAfterArmor('dense', 10)).toBe(2);
    expect(damageAfterArmor('dense', 40)).toBe(32);
    expect(damageAfterArmor('plain', 10)).toBe(10);
  });

  it('finds where a shot went in from a point already inside the rim', () => {
    // flying right, so it entered on the left, a little above the middle
    const angle = entryAngle(-20, -10, 500, 0, 30);
    expect(Math.sin(angle)).toBeCloseTo(-1 / 3);
    expect(Math.cos(angle)).toBeLessThan(0);
  });

  it('builds a streak that pays more and lapses', () => {
    const streak = new Streak();
    for (let i = 0; i < 5; i++) streak.hit(3);
    expect(streakBonus(streak.count)).toBe(1);
    expect(streakBonus(500)).toBe(3);
    streak.update(2.9);
    expect(streak.count).toBe(5);
    streak.update(0.2);
    expect(streak.count).toBe(0);
  });
});

describe('pirates', () => {
  it('opens the roster as threat rises', () => {
    expect(pickPirate(0, () => 0.999)).toBe('raider');
    expect(pickPirate(3, () => 0.999)).toBe('minelayer');
  });

  it('shields only the front of a gunship', () => {
    // ship faces right: a shot flying left meets its nose
    expect(hitsShield(0, Math.PI)).toBe(true);
    expect(hitsShield(0, 0)).toBe(false);
  });

  it('holds elites back early and never gives a silent ship a volley', () => {
    expect(rollElite('raider', 1, false, () => 0)).toBeNull();
    for (let i = 0; i < 20; i++) {
      const values = [0, i / 20];
      expect(rollElite('minelayer', 6, true, () => values.shift() ?? 0)).not.toBe('volley');
    }
    expect(PIRATE_TYPES.minelayer.range).toBe(0);
  });
});
