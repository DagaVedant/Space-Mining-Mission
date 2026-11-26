// A black hole as looping pixel-art frames: a tilted accretion disk that passes in front of the
// event horizon, the far side of the disk bent up over the top and under the bottom, and a thin
// photon ring. Worked out pixel by pixel once, so drawing one in play is a single image.
import type Phaser from 'phaser';

export const HOLE_FRAMES = 16;
/** world pixels per texture pixel */
export const HOLE_SCALE = 3;

const W = 112;
const H = 80;
/** event horizon radius in texture pixels */
const R = 14;
const TILT = 0.3;
const INNER = R * 1.35;
const OUTER = R * 3.8;

// coolest to hottest
const HEAT = [
  [92, 28, 56],
  [160, 44, 30],
  [226, 92, 24],
  [255, 150, 34],
  [255, 205, 80],
  [255, 241, 190],
  [255, 255, 255],
];
// 2x2 ordered dither, so the bands between heat steps break up like pixel art
const DITHER = [0, 0.5, 0.75, 0.25];

const clamp = (v: number): number => Math.max(0, Math.min(1, v));

/** Brightness 0..1 of the disk at radius `r` and angle `a`, for a loop position 0..1. */
function swirl(r: number, a: number, loop: number): number {
  const turn = loop * Math.PI * 2;
  const arms = Math.sin(3 * a + r * 0.42 - turn) * 0.5 + 0.5;
  const fine = Math.sin(7 * a + r * 1.1 - turn * 2) * 0.5 + 0.5;
  return 0.55 + 0.3 * arms + 0.15 * fine;
}

function paint(data: Uint8ClampedArray, loop: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2;
      const dy = y + 0.5 - H / 2;
      const d = Math.hypot(dx, dy);
      const jitter = DITHER[(y & 1) * 2 + (x & 1)] - 0.375;

      // the disk itself, seen almost edge on
      const rr = Math.hypot(dx, dy / TILT);
      let disk = 0;
      if (rr > INNER && rr < OUTER) {
        const out = (rr - INNER) / (OUTER - INNER);
        // the side turning towards us is brighter
        const beam = 1 - 0.22 * (dx / OUTER);
        disk = clamp((1 - out) ** 0.7 * swirl(rr, Math.atan2(dy / TILT, dx), loop) * beam * 1.25);
      }

      // light from the far side, bent around the horizon: strong above, faint below
      let halo = 0;
      if (d > R && d < R * 1.9) {
        const out = (d - R) / (R * 0.9);
        const side = dy < 0 ? 1 : 0.5;
        halo = clamp((1 - out) ** 1.3 * swirl(d * 2.4, Math.atan2(dy, dx), loop) * side * 1.2);
      }

      let heat = 0;
      let alpha = 0;
      if (d <= R) alpha = 1;
      if (halo > 0.06) {
        heat = halo;
        alpha = clamp(halo * 2.2);
      }
      // a thin bright ring hugging the horizon
      if (d > R && d <= R + 1.4) {
        heat = 0.92;
        alpha = 1;
      }
      // the near half of the disk covers the horizon; the far half hides behind it
      const front = dy > 0;
      if (disk > 0.04 && (front || d > R) && (front ? disk > 0.12 || disk > heat : disk > heat)) {
        heat = disk;
        alpha = clamp(disk * 2.4);
      }

      const i = (y * W + x) * 4;
      if (alpha <= 0) continue;
      const step = heat <= 0 ? null : HEAT[Math.round(clamp(heat + jitter * 0.14) * (HEAT.length - 1))];
      data[i] = step ? step[0] : 0;
      data[i + 1] = step ? step[1] : 0;
      data[i + 2] = step ? step[2] : 0;
      data[i + 3] = Math.round((step ? Math.round(alpha * 4) / 4 : 1) * 255);
    }
  }
}

export const holeKey = (frame: number): string => `hole${frame}`;

export function buildBlackHole(scene: Phaser.Scene): void {
  if (scene.textures.exists(holeKey(0))) return;
  for (let f = 0; f < HOLE_FRAMES; f++) {
    const texture = scene.textures.createCanvas(holeKey(f), W, H);
    if (!texture) return;
    const image = texture.context.createImageData(W, H);
    paint(image.data, f / HOLE_FRAMES);
    texture.context.putImageData(image, 0, 0);
    texture.refresh();
  }
}
