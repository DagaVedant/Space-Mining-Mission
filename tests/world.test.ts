import { describe, expect, it } from 'vitest';
import {
  generateCrater,
  isWorldValid,
  floodReachable,
} from '../frontend/src/generator';

describe('seeded crater generation', () => {
  it('is deterministic', () => {
    expect(generateCrater(123456)).toEqual(generateCrater(123456));
  });

  it('creates the required structures and ore', () => {
    const world = generateCrater(987654);

    expect(world.ores.filter((ore) => ore.active).length).toBeGreaterThanOrEqual(14);
    expect(isWorldValid(world)).toBe(true);
  });

  it('keeps base and launch zone reachable', () => {
    const world = generateCrater(42);
    const reachable = floodReachable(world, world.playerSpawn);

    expect(reachable.has(`${world.base.x},${world.base.y}`)).toBe(true);
    expect(reachable.has(`${world.launchZone.x},${world.launchZone.y}`)).toBe(true);
  });

  it('passes 1000 seeded maps', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const world = generateCrater(seed);
      expect(isWorldValid(world), `seed ${seed}`).toBe(true);
    }
  }, 120_000);
});
