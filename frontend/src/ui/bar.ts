import Phaser from 'phaser';

export interface StatBar {
  container: Phaser.GameObjects.Container;
  setRatio(ratio: number, color?: number): void;
}

export function createStatBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor = 0x1c252b,
  borderColor = 0x3a4650,
): StatBar {
  const container = scene.add.container(x, y);
  const bg = scene.add.rectangle(0, 0, width, height, bgColor).setOrigin(0, 0.5);
  const fill = scene.add.rectangle(1, 0, Math.max(0, width - 2), height - 2, 0x7fe7ff).setOrigin(0, 0.5);
  const border = scene.add.rectangle(0, 0, width, height).setOrigin(0, 0.5).setStrokeStyle(1, borderColor);
  container.add([bg, fill, border]);

  return {
    container,
    setRatio(ratio: number, color?: number): void {
      const clamped = Math.min(1, Math.max(0, ratio));
      fill.width = Math.max(0, (width - 2) * clamped);
      if (color !== undefined) {
        fill.setFillStyle(color);
      }
    },
  };
}

export function heatColor(heatPercent: number): number {
  if (heatPercent >= 100) return 0xff5d68;
  if (heatPercent >= 75) return 0xf0a23a;
  if (heatPercent >= 50) return 0xffd35a;
  return 0x7fe7ff;
}

export function heatLabel(heatPercent: number): string {
  if (heatPercent >= 100) return 'CRITICAL';
  if (heatPercent >= 75) return 'PATROL ALERT';
  if (heatPercent >= 50) return 'WARNING';
  return 'STEALTH';
}

export function toCssColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
