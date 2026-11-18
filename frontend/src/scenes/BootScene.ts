import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.svg('miner', 'assets/sprites/miner.svg');
    this.load.svg('quartz', 'assets/sprites/quartz.svg');
    this.load.svg('helium3', 'assets/sprites/helium-3.svg');
    this.load.svg('darkMatter', 'assets/sprites/dark-matter.svg');
    this.load.svg('base', 'assets/sprites/base.svg');
    this.load.svg('launchZone', 'assets/sprites/launch-zone.svg');
    this.load.svg('teslaSentinel', 'assets/sprites/tesla-sentinel.svg');
    this.load.svg('mechSentinel', 'assets/sprites/mech-sentinel.svg');
  }

  create(): void {
    this.scene.start('menu');
  }
}
