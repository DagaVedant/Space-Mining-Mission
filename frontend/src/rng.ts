export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted<T extends string>(weights: Record<T, number>, rng: Rng): T {
  const keys = Object.keys(weights) as T[];
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let r = rng() * total;
  for (const k of keys) {
    if (weights[k] <= 0) continue;
    r -= weights[k];
    if (r <= 0) return k;
  }
  return keys.filter((k) => weights[k] > 0)[0];
}
