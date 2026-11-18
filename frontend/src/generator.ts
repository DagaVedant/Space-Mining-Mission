import type { OreType } from './types';
import { SplitMix64 } from './splitMix64';
import type { CraterWorld, OreDeposit, WorldPoint } from './types';

export const WORLD_WIDTH = 48;
export const WORLD_HEIGHT = 48;
export const WORLD_TILE_SIZE = 32;

function key(point: WorldPoint): string {
  return `${point.x},${point.y}`;
}

export function generateCrater(seed: number): CraterWorld {
  const rng = new SplitMix64(seed);
  const walls = Array.from({ length: WORLD_HEIGHT }, () =>
    Array.from({ length: WORLD_WIDTH }, () => false),
  );

  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      if (x === 0 || y === 0 || x === WORLD_WIDTH - 1 || y === WORLD_HEIGHT - 1) {
        walls[y][x] = true;
      }
    }
  }

  const base = { x: 6, y: 6 };
  const launchZone = { x: 41, y: 41 };
  const playerSpawn = { x: 7, y: 7 };
  const reserved = new Set([
    key(base),
    key(launchZone),
    key(playerSpawn),
  ]);

  for (let cluster = 0; cluster < 90; cluster += 1) {
    const cx = 3 + rng.integer(WORLD_WIDTH - 6);
    const cy = 3 + rng.integer(WORLD_HEIGHT - 6);
    const radius = 1 + rng.integer(3);

    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > radius + 1) {
          continue;
        }
        const x = cx + dx;
        const y = cy + dy;
        const point = { x, y };
        if (
          x > 1 &&
          y > 1 &&
          x < WORLD_WIDTH - 2 &&
          y < WORLD_HEIGHT - 2 &&
          !reserved.has(key(point))
        ) {
          walls[y][x] = rng.integer(100) < 58;
        }
      }
    }
  }

  for (const point of [base, launchZone, playerSpawn]) {
    walls[point.y][point.x] = false;
  }

  const oreTypes: OreType[] = ['quartz', 'helium3', 'darkMatter'];
  const ores: OreDeposit[] = [];
  let id = 0;

  while (ores.length < 14) {
    const x = 2 + rng.integer(WORLD_WIDTH - 4);
    const y = 2 + rng.integer(WORLD_HEIGHT - 4);
    const point = { x, y };
    if (
      walls[y][x] ||
      reserved.has(key(point)) ||
      ores.some((ore) => ore.x === x && ore.y === y)
    ) {
      continue;
    }

    ores.push({
      id: `ore-${id}`,
      x,
      y,
      type: oreTypes[id % oreTypes.length],
      active: true,
    });
    id += 1;
  }

  const thermalVents: WorldPoint[] = [];
  const radiationPockets: WorldPoint[] = [];
  const enemySpawnPoints: WorldPoint[] = [];

  for (let i = 0; i < 8; i += 1) {
    let point = findOpenPoint(rng, walls);
    thermalVents.push(point);

    point = findOpenPoint(rng, walls);
    radiationPockets.push(point);

    point = findOpenPoint(rng, walls);
    enemySpawnPoints.push(point);
  }

  const world: CraterWorld = {
    seed,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tileSize: WORLD_TILE_SIZE,
    walls,
    ores,
    thermalVents,
    radiationPockets,
    enemySpawnPoints,
    base,
    launchZone,
    playerSpawn,
  };

  if (!isWorldValid(world)) {
    return generateCrater(seed + 0x9e3779b9);
  }

  return world;
}

function findOpenPoint(rng: SplitMix64, walls: boolean[][]): WorldPoint {
  for (let attempts = 0; attempts < 500; attempts += 1) {
    const x = 2 + rng.integer(WORLD_WIDTH - 4);
    const y = 2 + rng.integer(WORLD_HEIGHT - 4);
    if (!walls[y][x]) {
      return { x, y };
    }
  }
  return { x: 8, y: 8 };
}

export function floodReachable(
  world: CraterWorld,
  start: WorldPoint,
): Set<string> {
  const reachable = new Set<string>();
  const queue: WorldPoint[] = [start];

  while (queue.length > 0) {
    const point = queue.shift();
    if (!point) {
      break;
    }
    const pointKey = key(point);
    if (reachable.has(pointKey)) {
      continue;
    }
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= world.width ||
      point.y >= world.height ||
      world.walls[point.y][point.x]
    ) {
      continue;
    }

    reachable.add(pointKey);
    queue.push(
      { x: point.x + 1, y: point.y },
      { x: point.x - 1, y: point.y },
      { x: point.x, y: point.y + 1 },
      { x: point.x, y: point.y - 1 },
    );
  }

  return reachable;
}

export function isWorldValid(world: CraterWorld): boolean {
  const reachable = floodReachable(world, world.playerSpawn);
  if (!reachable.has(key(world.base)) || !reachable.has(key(world.launchZone))) {
    return false;
  }
  if (world.ores.filter((ore) => ore.active).length < 14) {
    return false;
  }
  if (world.ores.some((ore) => !reachable.has(key(ore)))) {
    return false;
  }
  if (world.enemySpawnPoints.some((point) => {
    const distance =
      Math.abs(point.x - world.playerSpawn.x) +
      Math.abs(point.y - world.playerSpawn.y);
    return distance < 8 || !reachable.has(key(point));
  })) {
    return false;
  }
  return true;
}
