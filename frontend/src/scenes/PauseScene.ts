import Phaser from 'phaser';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super('pause');
  }

  create(): void {
    this.add.rectangle(484, 383, 968, 766, 0x11151a, 0.92);
    this.add.text(484, 330, 'PAUSED', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#eef4f7',
    }).setOrigin(0.5);
    this.add.text(484, 380, 'WASD MOVE  SPACE MINE  F LAUNCH  Q EMP  ESC RESUME', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#b5c1c8',
    }).setOrigin(0.5);

    this.input.keyboard?.once('keydown-ESC', () => {
      this.scene.stop();
      this.scene.resume('play');
    });
  }
}
