import Phaser from 'phaser';
import { SplitMix64 } from '../splitMix64';
import { loadSave } from '../localSave';

interface TierSpec {
  share: number;
  size: number;
  brightSize: number;
  brightChance: number;
  dimColor: number;
  dimAlpha: number;
  brightColor: number;
  brightAlpha: number;
  driftRange: number;
  driftDuration: number;
}

const TIERS: TierSpec[] = [
  {
    share: 0.5,
    size: 1,
    brightSize: 1,
    brightChance: 0.1,
    dimColor: 0x2c3640,
    dimAlpha: 0.45,
    brightColor: 0x4a6a74,
    brightAlpha: 0.6,
    driftRange: 3,
    driftDuration: 14000,
  },
  {
    share: 0.32,
    size: 1.4,
    brightSize: 1.4,
    brightChance: 0.18,
    dimColor: 0x3a4650,
    dimAlpha: 0.6,
    brightColor: 0x6fc4d4,
    brightAlpha: 0.75,
    driftRange: 6,
    driftDuration: 10000,
  },
  {
    share: 0.18,
    size: 1.6,
    brightSize: 2.2,
    brightChance: 0.3,
    dimColor: 0x4a5660,
    dimAlpha: 0.7,
    brightColor: 0x7fe7ff,
    brightAlpha: 0.9,
    driftRange: 10,
    driftDuration: 7000,
  },
];

const MOON_LIT = 0x8a929c;
const MOON_SHADOW = 0x3a3f46;
const MOON_CRATER = 0x2c3036;

function drawTier(
  scene: Phaser.Scene,
  width: number,
  height: number,
  count: number,
  rng: SplitMix64,
  tier: TierSpec,
  reducedMotion: boolean,
): void {
  const g = scene.add.graphics();
  for (let i = 0; i < count; i += 1) {
    const x = rng.integer(width);
    const y = rng.integer(height);
    const bright = rng.integer(100) < tier.brightChance * 100;
    const size = bright ? tier.brightSize : tier.size;
    g.fillStyle(bright ? tier.brightColor : tier.dimColor, bright ? tier.brightAlpha : tier.dimAlpha);
    g.fillRect(x, y, size, size);
  }
  if (!reducedMotion) {
    const dx = (rng.integer(100) / 100 - 0.5) * 2 * tier.driftRange;
    const dy = (rng.integer(100) / 100 - 0.5) * 2 * tier.driftRange;
    scene.tweens.add({
      targets: g,
      x: dx,
      y: dy,
      duration: tier.driftDuration,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }
}

function drawMoon(scene: Phaser.Scene, width: number, height: number, rng: SplitMix64): void {
  const cx = width - width * 0.12;
  const cy = height * 0.16;
  const r = width * 0.045;

  const moon = scene.add.graphics();
  moon.fillStyle(MOON_SHADOW, 1);
  moon.fillCircle(cx, cy, r);
  moon.fillStyle(MOON_LIT, 1);
  moon.beginPath();
  moon.moveTo(cx, cy);
  moon.arc(cx, cy, r, Phaser.Math.DegToRad(135), Phaser.Math.DegToRad(315), false);
  moon.closePath();
  moon.fillPath();

  for (let i = 0; i < 3; i += 1) {
    const angle = Phaser.Math.DegToRad(160 + rng.integer(140));
    const dist = r * (0.25 + (rng.integer(100) / 100) * 0.5);
    const cratR = r * (0.08 + (rng.integer(100) / 100) * 0.08);
    moon.fillStyle(MOON_CRATER, 0.5);
    moon.fillCircle(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, cratR);
  }
}

export function drawStarfield(
  scene: Phaser.Scene,
  width: number,
  height: number,
  count = 140,
  seed = 1337,
): void {
  const rng = new SplitMix64(seed);
  const reducedMotion = loadSave().settings.reducedMotion;

  for (const tier of TIERS) {
    drawTier(scene, width, height, Math.round(count * tier.share), rng, tier, reducedMotion);
  }

  drawMoon(scene, width, height, rng);
}
