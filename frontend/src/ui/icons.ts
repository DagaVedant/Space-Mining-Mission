import Phaser from 'phaser';

export type IconType =
  | 'heat'
  | 'hull'
  | 'cargo'
  | 'drill'
  | 'cannon'
  | 'emp'
  | 'shipment'
  | 'medicine'
  | 'savings';

export function drawIcon(
  scene: Phaser.Scene,
  type: IconType,
  x: number,
  y: number,
  size: number,
  color: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const s = size;
  g.lineStyle(Math.max(1, s * 0.12), color, 1);
  g.fillStyle(color, 1);

  switch (type) {
    case 'heat':
      g.beginPath();
      g.moveTo(0, -s * 0.5);
      g.lineTo(s * 0.32, -s * 0.05);
      g.lineTo(s * 0.16, -s * 0.05);
      g.lineTo(s * 0.3, s * 0.5);
      g.lineTo(-s * 0.3, s * 0.5);
      g.lineTo(-s * 0.1, s * 0.1);
      g.lineTo(-s * 0.22, s * 0.1);
      g.closePath();
      g.fillPath();
      break;
    case 'hull':
      g.beginPath();
      g.moveTo(0, -s * 0.5);
      g.lineTo(s * 0.45, -s * 0.28);
      g.lineTo(s * 0.45, s * 0.12);
      g.lineTo(0, s * 0.5);
      g.lineTo(-s * 0.45, s * 0.12);
      g.lineTo(-s * 0.45, -s * 0.28);
      g.closePath();
      g.strokePath();
      break;
    case 'cargo':
      g.strokeRect(-s * 0.45, -s * 0.35, s * 0.9, s * 0.7);
      g.lineBetween(-s * 0.45, -s * 0.05, s * 0.45, -s * 0.05);
      break;
    case 'drill':
      g.beginPath();
      g.moveTo(-s * 0.1, -s * 0.5);
      g.lineTo(s * 0.1, -s * 0.5);
      g.lineTo(s * 0.1, s * 0.1);
      g.lineTo(s * 0.4, s * 0.5);
      g.lineTo(-s * 0.4, s * 0.5);
      g.lineTo(-s * 0.1, s * 0.1);
      g.closePath();
      g.fillPath();
      break;
    case 'cannon':
      g.fillCircle(0, -s * 0.1, s * 0.12);
      g.lineBetween(0, -s * 0.1, 0, s * 0.45);
      g.lineBetween(-s * 0.32, s * 0.45, s * 0.32, s * 0.45);
      g.strokeCircle(0, -s * 0.1, s * 0.3);
      break;
    case 'emp':
      g.strokeCircle(0, 0, s * 0.18);
      g.strokeCircle(0, 0, s * 0.34);
      g.strokeCircle(0, 0, s * 0.5);
      break;
    case 'shipment':
      g.beginPath();
      g.moveTo(0, -s * 0.5);
      g.lineTo(s * 0.26, s * 0.1);
      g.lineTo(s * 0.12, s * 0.5);
      g.lineTo(-s * 0.12, s * 0.5);
      g.lineTo(-s * 0.26, s * 0.1);
      g.closePath();
      g.fillPath();
      break;
    case 'medicine':
      g.fillRect(-s * 0.12, -s * 0.5, s * 0.24, s);
      g.fillRect(-s * 0.5, -s * 0.12, s, s * 0.24);
      break;
    case 'savings':
      g.strokeCircle(0, 0, s * 0.48);
      g.lineBetween(0, -s * 0.28, 0, s * 0.28);
      g.lineBetween(-s * 0.18, -s * 0.12, s * 0.18, -s * 0.12);
      break;
  }

  return g;
}
