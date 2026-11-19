import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.cameras.main.setBackgroundColor('#11151a');
    this.add
      .text(484, 383, 'LOADING VULTURE SYSTEMS...', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#7fe7ff',
      })
      .setOrigin(0.5);

    this.load.svg('miner', 'sprites/miner.svg');
    this.load.svg('quartz', 'sprites/quartz.svg');
    this.load.svg('helium3', 'sprites/helium-3.svg');
    this.load.svg('darkMatter', 'sprites/dark-matter.svg');
    this.load.svg('base', 'sprites/base.svg');
    this.load.svg('launchZone', 'sprites/launch-zone.svg');
    this.load.svg('teslaSentinel', 'sprites/tesla-sentinel.svg');
    this.load.svg('mechSentinel', 'sprites/mech-sentinel.svg');
    this.load.svg('thermalVent', 'sprites/thermal-vent.svg');
    this.load.svg('radiationPocket', 'sprites/radiation-pocket.svg');
    this.load.svg('rocket', 'sprites/rocket.svg', { width: 24, height: 40 });
  }

  create(): void {
    const dot = this.make.graphics({ x: 0, y: 0 }, false);
    dot.fillStyle(0xffffff, 1);
    dot.fillCircle(4, 4, 4);
    dot.generateTexture('dot', 8, 8);
    dot.destroy();

    this.scene.start('menu');
  }
}
