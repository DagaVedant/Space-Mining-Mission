import Phaser from 'phaser';
import { SplitMix64 } from '../splitMix64';

export function drawStarfield(
  scene: Phaser.Scene,
  width: number,
  height: number,
  count = 140,
  seed = 1337,
): Phaser.GameObjects.Graphics {
  const rng = new SplitMix64(seed);
  const g = scene.add.graphics();
  for (let i = 0; i < count; i += 1) {
    const x = rng.integer(width);
    const y = rng.integer(height);
    const r = rng.integer(100) < 85 ? 1 : 1.6;
    const bright = rng.integer(100) < 20;
    g.fillStyle(bright ? 0x7fe7ff : 0x3a4650, bright ? 0.8 : 0.6);
    g.fillRect(x, y, r, r);
  }
  return g;
}
