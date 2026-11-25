import { ORES, ORE_IDS, type OreId } from './data';
import type { Rng } from './rng';

export interface MarketEvent {
  ore: OreId;
  mult: number;
  endsAt: number;
  label: string;
}

export interface MarketState {
  prices: Record<OreId, number>;
  prev: Record<OreId, number>;
  events: MarketEvent[];
  time: number;
  nextEventAt: number;
  nextSnapshotAt: number;
  nextTickAt: number;
}

const MIN_MULT = 0.45;
const MAX_MULT = 2.6;
// Prices move in discrete steps so they are readable, not a flickering ticker.
const TICK = 5;

function baseline(): Record<OreId, number> {
  return {
    ferrite: ORES.ferrite.base,
    cobalt: ORES.cobalt.base,
    platinum: ORES.platinum.base,
    voidstone: ORES.voidstone.base,
  };
}

export function createMarket(rng: Rng): MarketState {
  const prices = baseline();
  return { prices, prev: { ...prices }, events: [], time: 0, nextEventAt: 25 + rng() * 25, nextSnapshotAt: 20, nextTickAt: TICK };
}

export function targetMult(m: MarketState, ore: OreId): number {
  let mult = 1;
  for (const e of m.events) if (e.ore === ore) mult *= e.mult;
  return mult;
}

const EVENT_TEMPLATES = [
  { mult: 1.7, label: 'Shortage', duration: 50 },
  { mult: 0.6, label: 'Glut', duration: 50 },
  { mult: 2.1, label: 'Boom', duration: 35 },
];

// Advances the market by dt seconds. Returns a label when a new event starts.
export function stepMarket(m: MarketState, dt: number, rng: Rng): string | null {
  m.time += dt;
  m.events = m.events.filter((e) => e.endsAt > m.time);
  let started: string | null = null;
  if (m.time >= m.nextEventAt) {
    const t = EVENT_TEMPLATES[Math.floor(rng() * EVENT_TEMPLATES.length)];
    const ore = ORE_IDS[Math.floor(rng() * ORE_IDS.length)];
    const label = `${t.label}: ${ORES[ore].name}`;
    m.events.push({ ore, mult: t.mult, endsAt: m.time + t.duration, label });
    m.nextEventAt = m.time + 40 + rng() * 40;
    started = label;
  }
  const base = baseline();
  while (m.time >= m.nextTickAt) {
    m.nextTickAt += TICK;
    for (const ore of ORE_IDS) {
      const target = base[ore] * targetMult(m, ore);
      const noise = (rng() - 0.5) * base[ore] * 0.06;
      let p = m.prices[ore] + (target - m.prices[ore]) * 0.12 + noise;
      p = Math.max(base[ore] * MIN_MULT, Math.min(base[ore] * MAX_MULT, p));
      m.prices[ore] = p;
    }
  }
  if (m.time >= m.nextSnapshotAt) {
    m.prev = { ...m.prices };
    m.nextSnapshotAt = m.time + 20;
  }
  return started;
}

export function priceOf(m: MarketState, ore: OreId): number {
  return Math.round(m.prices[ore] * 10) / 10;
}
