import type Phaser from 'phaser';

// Graphics.arc / strokeCircle / fillCircle cut every curve into about 100 segments and redo it on
// every frame, however short the arc is. These take only as many segments as the size needs.

function points(x: number, y: number, r: number, from: number, sweep: number, segments: number) {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = from + (sweep * i) / segments;
    return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
  });
}

export function strokeArc(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  from: number,
  sweep: number,
): void {
  // one segment for every ~40px of curve keeps the error under a pixel at these radii
  const segments = Math.max(3, Math.ceil((r * sweep) / 40));
  const path = points(x, y, r, from, sweep, segments);
  g.beginPath();
  g.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
  g.strokePath();
}

export function strokeRing(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  strokeArc(g, x, y, r, 0, Math.PI * 2);
}

export function fillDisc(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  const segments = Math.max(8, Math.min(32, Math.ceil(r)));
  g.fillPoints(points(x, y, r, 0, Math.PI * 2, segments), true);
}
