import Phaser from 'phaser';
import { ORES, ORE_IDS, type OreId } from './data';
import { mulberry32 } from './rng';

type P = [number, number];

export const AST_R = { L: 58, M: 34, S: 19 } as const;
export type Sz = keyof typeof AST_R;
export const SIZES: Sz[] = ['L', 'M', 'S'];
export const VARIANTS = 3;

const TAU = Math.PI * 2;

export function shade(c: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function newG(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  return scene.make.graphics({}, false);
}

// Textures are baked from smooth vector drawing, then snapped to a chunky pixel grid:
// average down to a small bitmap, give it a hard on/off edge, scale back up unsmoothed.
function pixelate(scene: Phaser.Scene, key: string, w: number, h: number): void {
  const px = Math.max(1, Math.min(8, Math.round(Math.max(w, h) / 11)));
  if (px < 2) return;
  const src = scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
  if (!(src instanceof HTMLCanvasElement)) return;
  const sw = Math.ceil(w / px);
  const sh = Math.ceil(h / px);
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d');
  const ctx = src.getContext('2d');
  if (!sctx || !ctx) return;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, sw, sh);
  const data = sctx.getImageData(0, 0, sw, sh);
  for (let i = 3; i < data.data.length; i += 4) data.data[i] = data.data[i] > 110 ? 255 : 0;
  sctx.putImageData(data, 0, 0);
  ctx.clearRect(0, 0, src.width, src.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, sw * px, sh * px);
  (scene.textures.get(key) as Phaser.Textures.CanvasTexture).refresh?.();
}

function bake(g: Phaser.GameObjects.Graphics, key: string, w: number, h: number, pixel = true): void {
  const scene = g.scene;
  g.generateTexture(key, w, h);
  g.destroy();
  if (pixel) pixelate(scene, key, w, h);
}

function vec(pts: P[]): Phaser.Math.Vector2[] {
  return pts.map(([x, y]) => new Phaser.Math.Vector2(x, y));
}

function fill(g: Phaser.GameObjects.Graphics, pts: P[], color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillPoints(vec(pts), true);
}

function outline(g: Phaser.GameObjects.Graphics, pts: P[], color: number, w = 1.5, alpha = 1): void {
  g.lineStyle(w, color, alpha);
  g.strokePoints(vec(pts), true);
}

function lerpP(a: P, b: P, t: number): P {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function makeRock(scene: Phaser.Scene, key: string, radius: number, ore: OreId, seed: number): void {
  const rng = mulberry32(seed);
  const size = Math.ceil(radius * 2 + 8);
  const c = size / 2;
  const g = newG(scene);
  const n = 10 + Math.floor(rng() * 4);
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rng() - 0.5) * 0.35;
    const r = radius * (0.8 + rng() * 0.2);
    pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  const oreColor = ORES[ore].color;
  const base = mix(0x7d746a, oreColor, 0.1);
  const lx = -0.62;
  const ly = -0.78;
  const cen: P = [c + (rng() - 0.5) * radius * 0.2, c + (rng() - 0.5) * radius * 0.2];
  const facing: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2 - c;
    const my = (a[1] + b[1]) / 2 - c;
    const len = Math.hypot(mx, my) || 1;
    const f = (mx / len) * lx + (my / len) * ly;
    facing.push(f);
    fill(g, [cen, a, b], shade(base, 0.72 + 0.3 * f + (rng() - 0.5) * 0.08));
  }
  // inner ridge facets for depth
  for (let i = 0; i < n; i++) {
    if (rng() < 0.45) continue;
    const a = lerpP(cen, pts[i], 0.55);
    const b = lerpP(cen, pts[(i + 1) % n], 0.55);
    fill(g, [cen, a, b], shade(base, 0.8 + 0.28 * facing[i]), 0.55);
  }
  // ore veins
  const veins = 3 + Math.floor(rng() * 3);
  for (let v = 0; v < veins; v++) {
    const i = Math.floor(rng() * n);
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const t0 = 0.15 + rng() * 0.3;
    const t1 = t0 + 0.2 + rng() * 0.25;
    const r0 = 0.5 + rng() * 0.15;
    const r1 = 0.78 + rng() * 0.12;
    const quad: P[] = [
      lerpP(cen, lerpP(a, b, t0), r0),
      lerpP(cen, lerpP(a, b, t1), r0 + 0.05),
      lerpP(cen, lerpP(a, b, t1), r1),
      lerpP(cen, lerpP(a, b, t0), r1 - 0.05),
    ];
    fill(g, quad, shade(oreColor, 0.8 + 0.35 * facing[i]));
    outline(g, quad, shade(oreColor, 0.45), 1, 0.8);
    if (ore === 'platinum' || ore === 'voidstone') {
      g.fillStyle(0xffffff, 0.85);
      const q = lerpP(quad[0], quad[2], 0.5);
      g.fillCircle(q[0], q[1], 1.3);
    }
  }
  if (radius > 30) {
    for (let k = 0; k < 2; k++) {
      const a = rng() * TAU;
      const d = radius * (0.2 + rng() * 0.35);
      const cx = c + Math.cos(a) * d;
      const cy = c + Math.sin(a) * d;
      const cr = radius * (0.09 + rng() * 0.07);
      g.fillStyle(shade(base, 0.5), 0.75);
      g.fillCircle(cx, cy, cr);
      g.fillStyle(shade(base, 1.2), 0.5);
      g.fillCircle(cx - cr * 0.35, cy - cr * 0.35, cr * 0.45);
    }
  }
  outline(g, pts, 0x17140f, 2);
  for (let i = 0; i < n; i++) {
    if (facing[i] > 0.35) {
      g.lineStyle(1.5, shade(base, 1.45), 0.7);
      g.lineBetween(pts[i][0], pts[i][1], pts[(i + 1) % n][0], pts[(i + 1) % n][1]);
    }
  }
  bake(g, key, size, size);
}

function makeDebris(scene: Phaser.Scene, key: string, seed: number): void {
  const rng = mulberry32(seed);
  const radius = 20;
  const size = radius * 2 + 8;
  const c = size / 2;
  const g = newG(scene);
  const n = 7;
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rng() - 0.5) * 0.5;
    const r = radius * (0.7 + rng() * 0.3);
    pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2 - c;
    const my = (a[1] + b[1]) / 2 - c;
    const len = Math.hypot(mx, my) || 1;
    const f = (mx / len) * -0.62 + (my / len) * -0.78;
    fill(g, [[c, c], a, b], shade(0x5a544e, 0.75 + 0.3 * f));
  }
  outline(g, pts, 0x120f0c, 2);
  g.fillStyle(0xe5483a, 0.9);
  g.fillCircle(c + 3, c - 2, 2);
  bake(g, key, size, size);
}

function makeShip(scene: Phaser.Scene): void {
  const g = newG(scene);
  const dark = 0x15181c;
  // engine block
  fill(g, [[2, 18], [8, 16], [8, 32], [2, 30]], 0x3a3f46);
  // wings
  fill(g, [[26, 14], [12, 2], [6, 12], [14, 15]], 0xe8832a);
  fill(g, [[26, 34], [12, 46], [6, 36], [14, 33]], 0xb8621a);
  outline(g, [[26, 14], [12, 2], [6, 12], [14, 15]], dark, 1.5);
  outline(g, [[26, 34], [12, 46], [6, 36], [14, 33]], dark, 1.5);
  // hull, lit half / shadow half
  fill(g, [[45, 24], [32, 13], [11, 11], [4, 17], [4, 24]], 0xe6e9ec);
  fill(g, [[45, 24], [32, 35], [11, 37], [4, 31], [4, 24]], 0xa3a9b1);
  outline(g, [[45, 24], [32, 13], [11, 11], [4, 17], [4, 31], [11, 37], [32, 35]], dark, 2);
  g.lineStyle(1, 0x6b727b, 0.9);
  g.lineBetween(10, 24, 40, 24);
  g.lineBetween(18, 12, 18, 36);
  // mining cannon
  g.fillStyle(0x4b5058, 1);
  g.fillRect(34, 21, 11, 6);
  g.lineStyle(1.5, dark, 1);
  g.strokeRect(34, 21, 11, 6);
  g.fillStyle(0xe8832a, 1);
  g.fillRect(43, 22, 2, 4);
  // cockpit
  g.fillStyle(0x23607c, 1);
  g.fillEllipse(26, 24, 12, 8);
  g.fillStyle(0x8fd9f2, 1);
  g.fillEllipse(24, 22.5, 6, 3);
  g.lineStyle(1.5, dark, 1);
  g.strokeEllipse(26, 24, 12, 8);
  bake(g, 'ship', 48, 48);

  const f = newG(scene);
  fill(f, [[26, 0], [26, 14], [0, 7]], 0xf2a03d);
  fill(f, [[26, 3], [26, 11], [9, 7]], 0xfff1b8);
  bake(f, 'flame', 26, 14);
}

function makePirate(scene: Phaser.Scene): void {
  const g = newG(scene);
  const dark = 0x14100e;
  fill(g, [[43, 22], [28, 8], [10, 4], [2, 13], [8, 22], [2, 31], [10, 40], [28, 36]], 0x8f3b2e);
  fill(g, [[43, 22], [28, 8], [10, 4], [2, 13], [8, 22]], 0xb4503f);
  outline(g, [[43, 22], [28, 8], [10, 4], [2, 13], [8, 22], [2, 31], [10, 40], [28, 36]], dark, 2);
  fill(g, [[30, 8], [38, 2], [34, 12]], 0x5c6068);
  fill(g, [[30, 36], [38, 42], [34, 32]], 0x4a4d54);
  g.lineStyle(1, 0x4a1c14, 1);
  g.lineBetween(10, 22, 36, 22);
  g.fillStyle(0xffcc33, 1);
  g.fillRect(27, 19, 9, 3);
  g.fillStyle(0x2b0f0b, 1);
  g.fillRect(27, 22, 9, 3);
  g.fillStyle(0xe8832a, 1);
  g.fillRect(2, 18, 4, 3);
  g.fillRect(2, 23, 4, 3);
  bake(g, 'pirate', 46, 44);
}

function makeDrone(scene: Phaser.Scene): void {
  const g = newG(scene);
  const dark = 0x14181c;
  fill(g, [[6, 4], [14, 8], [10, 12]], 0x4d5660);
  fill(g, [[6, 24], [14, 20], [10, 16]], 0x3a424a);
  g.fillStyle(0x76828e, 1);
  g.fillCircle(13, 14, 8);
  g.fillStyle(0x9aa6b2, 1);
  g.fillCircle(11, 12, 4);
  g.lineStyle(1.5, dark, 1);
  g.strokeCircle(13, 14, 8);
  g.fillStyle(0x4d5660, 1);
  g.fillRect(19, 12, 7, 4);
  g.fillStyle(0xe8832a, 1);
  g.fillCircle(14, 14, 2);
  bake(g, 'drone', 28, 28);
}

function makeStation(scene: Phaser.Scene): void {
  const size = 280;
  const c = size / 2;
  const g = newG(scene);
  // ring body
  g.lineStyle(26, 0x2e353d, 1);
  g.strokeCircle(c, c, 112);
  g.lineStyle(6, 0x4b5560, 1);
  g.strokeCircle(c, c, 124);
  g.lineStyle(4, 0x14181c, 1);
  g.strokeCircle(c, c, 99);
  g.strokeCircle(c, c, 126);
  // hazard stripes on the rim
  const segs = 36;
  for (let i = 0; i < segs; i++) {
    g.lineStyle(5, i % 2 ? 0xe8832a : 0x14181c, 1);
    g.beginPath();
    g.arc(c, c, 118, (i / segs) * TAU, ((i + 0.9) / segs) * TAU);
    g.strokePath();
  }
  // spokes
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    g.lineStyle(14, 0x3a424b, 1);
    g.lineBetween(c + Math.cos(a) * 40, c + Math.sin(a) * 40, c + Math.cos(a) * 100, c + Math.sin(a) * 100);
    g.lineStyle(2, 0x14181c, 1);
    g.lineBetween(c + Math.cos(a) * 40, c + Math.sin(a) * 40, c + Math.cos(a) * 100, c + Math.sin(a) * 100);
  }
  // hub
  g.fillStyle(0x3b444e, 1);
  g.fillCircle(c, c, 46);
  g.fillStyle(0x56616d, 1);
  g.beginPath();
  g.arc(c, c, 46, Math.PI * 0.9, Math.PI * 1.75);
  g.closePath();
  g.fillPath();
  g.lineStyle(3, 0x14181c, 1);
  g.strokeCircle(c, c, 46);
  g.fillStyle(0x23282e, 1);
  g.fillCircle(c, c, 26);
  g.lineStyle(2, 0xe8832a, 1);
  g.strokeCircle(c, c, 26);
  g.fillStyle(0xe8832a, 1);
  g.fillCircle(c, c, 8);
  // windows along the ring
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    g.fillStyle(i % 3 === 0 ? 0xffd27a : 0x6c7782, 1);
    g.fillRect(c + Math.cos(a) * 106 - 2, c + Math.sin(a) * 106 - 2, 4, 4);
  }
  bake(g, 'station', size, size);

  const t = newG(scene);
  t.fillStyle(0x5b6672, 1);
  t.fillRect(14, 7, 24, 8);
  t.lineStyle(1.5, 0x14181c, 1);
  t.strokeRect(14, 7, 24, 8);
  t.fillStyle(0xe8832a, 1);
  t.fillRect(34, 8, 4, 6);
  t.fillStyle(0x7d8895, 1);
  t.fillCircle(11, 11, 9);
  t.lineStyle(2, 0x14181c, 1);
  t.strokeCircle(11, 11, 9);
  bake(t, 'turret', 40, 22);
}

function makeGate(scene: Phaser.Scene): void {
  const size = 240;
  const c = size / 2;
  const g = newG(scene);
  g.lineStyle(20, 0x59616b, 1);
  g.strokeCircle(c, c, 98);
  g.lineStyle(3, 0x14181c, 1);
  g.strokeCircle(c, c, 108);
  g.strokeCircle(c, c, 88);
  g.lineStyle(3, 0xe8832a, 1);
  g.strokeCircle(c, c, 80);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.fillStyle(0xe8832a, 1);
    g.fillCircle(c + Math.cos(a) * 98, c + Math.sin(a) * 98, 6);
    g.lineStyle(2, 0x14181c, 1);
    g.strokeCircle(c + Math.cos(a) * 98, c + Math.sin(a) * 98, 6);
  }
  bake(g, 'gate', size, size);

  const s = newG(scene);
  s.fillStyle(0xe8832a, 1);
  s.fillCircle(c, c, 78);
  bake(s, 'gateglow', size, size);
}

function makeDread(scene: Phaser.Scene): void {
  const g = newG(scene);
  const dark = 0x100e0d;
  const hull: P[] = [[300, 110], [250, 60], [190, 40], [90, 28], [24, 46], [8, 80], [8, 140], [24, 174], [90, 192], [190, 180], [250, 160]];
  fill(g, hull, 0x4a4e57);
  fill(g, [[300, 110], [250, 60], [190, 40], [90, 28], [24, 46], [8, 80], [8, 110]], 0x6a707b);
  outline(g, hull, dark, 3);
  fill(g, [[170, 46], [250, 64], [230, 110], [150, 110]], 0x5a606b);
  fill(g, [[170, 174], [250, 156], [230, 110], [150, 110]], 0x3c4048);
  g.lineStyle(2, dark, 0.9);
  g.lineBetween(30, 110, 296, 110);
  g.lineBetween(100, 34, 100, 186);
  g.lineBetween(180, 40, 180, 180);
  // red stripe
  fill(g, [[60, 96], [220, 96], [220, 106], [60, 106]], 0xb33a2e);
  // gun turrets
  for (const [x, y] of [[210, 56], [210, 164], [120, 40], [120, 180]] as P[]) {
    g.fillStyle(0x2f3339, 1);
    g.fillCircle(x, y, 14);
    g.lineStyle(2.5, dark, 1);
    g.strokeCircle(x, y, 14);
    g.fillStyle(0x15171a, 1);
    g.fillRect(x, y - 3, 22, 6);
    g.fillStyle(0xe5483a, 1);
    g.fillCircle(x, y, 4);
  }
  // bridge
  g.fillStyle(0x23607c, 1);
  g.fillEllipse(262, 110, 30, 16);
  g.fillStyle(0xe5483a, 1);
  g.fillEllipse(262, 110, 12, 6);
  // engines
  for (const y of [70, 110, 150]) {
    g.fillStyle(0x23272c, 1);
    g.fillRect(0, y - 9, 14, 18);
    g.fillStyle(0xe8832a, 1);
    g.fillRect(0, y - 5, 5, 10);
  }
  bake(g, 'dread', 308, 220);
}

function makeSmall(scene: Phaser.Scene): void {
  const b = newG(scene);
  b.fillStyle(0xffc247, 1);
  b.fillRoundedRect(0, 0, 18, 6, 3);
  b.fillStyle(0xfff6d0, 1);
  b.fillRoundedRect(3, 2, 12, 2, 1);
  bake(b, 'bullet', 18, 6);

  const t = newG(scene);
  t.fillStyle(0x5fd0ff, 1);
  t.fillRoundedRect(0, 0, 18, 6, 3);
  t.fillStyle(0xe6f8ff, 1);
  t.fillRoundedRect(3, 2, 12, 2, 1);
  bake(t, 'tbullet', 18, 6);

  const e = newG(scene);
  e.fillStyle(0xe5483a, 1);
  e.fillCircle(7, 7, 6);
  e.fillStyle(0xffd2c8, 1);
  e.fillCircle(7, 7, 2.5);
  bake(e, 'ebullet', 14, 14);

  const s = newG(scene);
  s.fillStyle(0xffffff, 1);
  s.fillRect(0, 0, 6, 6);
  bake(s, 'spark', 6, 6);

  const m = newG(scene);
  m.fillStyle(0xffffff, 1);
  m.fillCircle(6, 6, 6);
  bake(m, 'smoke', 12, 12);

  for (const id of ORE_IDS) {
    const col = ORES[id].color;
    const g = newG(scene);
    const pts: P[] = [[8, 1], [15, 8], [8, 15], [1, 8]];
    fill(g, pts, shade(col, 0.8));
    fill(g, [[8, 1], [15, 8], [8, 8]], shade(col, 1.25));
    fill(g, [[8, 1], [1, 8], [8, 8]], shade(col, 1.05));
    outline(g, pts, 0x12100d, 1.5);
    bake(g, `chunk_${id}`, 16, 16);
  }
}

function makeStars(scene: Phaser.Scene): void {
  const layers = [
    { key: 'stars1', count: 110, size: 1, alpha: 0.5 },
    { key: 'stars2', count: 55, size: 1.6, alpha: 0.7 },
    { key: 'stars3', count: 22, size: 2.4, alpha: 0.95 },
  ];
  layers.forEach((l, li) => {
    const rng = mulberry32(100 + li);
    const g = newG(scene);
    for (let i = 0; i < l.count; i++) {
      const warm = rng() < 0.25;
      g.fillStyle(warm ? 0xffd9a8 : 0xcfe0f5, l.alpha * (0.5 + rng() * 0.5));
      g.fillRect(Math.floor(rng() * 512), Math.floor(rng() * 512), l.size, l.size);
    }
    bake(g, l.key, 512, 512, false);
  });
}

export function buildTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('ship')) return;
  makeShip(scene);
  makePirate(scene);
  makeDrone(scene);
  makeStation(scene);
  makeGate(scene);
  makeDread(scene);
  makeSmall(scene);
  makeStars(scene);
  let seed = 1;
  for (const ore of ORE_IDS) {
    for (const sz of SIZES) {
      for (let v = 0; v < VARIANTS; v++) makeRock(scene, `ast_${ore}_${sz}_${v}`, AST_R[sz], ore, seed++ * 7919);
    }
  }
  for (let v = 0; v < 3; v++) makeDebris(scene, `debris_${v}`, 900 + v);
}
