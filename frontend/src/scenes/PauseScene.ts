import Phaser from 'phaser';
import { audio } from '../audio';
import { loadSave } from '../localSave';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super('pause');
  }

  create(): void {
    this.add.rectangle(484, 383, 968, 766, 0x11151a, 0.88);
    const panel = this.add
      .rectangle(484, 383, 420, 260, 0x182027)
      .setStrokeStyle(1, 0x33404a);
    void panel;

    this.add
      .text(484, 300, 'MISSION PAUSED', {
        fontFamily: 'monospace',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#eef4f7',
      })
      .setOrigin(0.5);

    const lines = [
      'WASD / ARROWS   MOVE',
      'SPACE           MINE ORE',
      'F               LOAD AND LAUNCH CARGO',
      'Q               EMP SHOCKWAVE',
      'ESC             RESUME',
    ];
    this.add.text(340, 345, lines.join('\n'), {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#b5c1c8',
      lineSpacing: 10,
    });

    const muted = loadSave().settings.muted;
    const soundText = this.add
      .text(484, 460, `SOUND: ${muted ? 'OFF' : 'ON'}  (M TO TOGGLE)`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#7fe7ff',
      })
      .setOrigin(0.5);

    this.add
      .text(484, 485, 'PRESS ESC TO RESUME', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#64dd9b',
      })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ESC', () => {
      audio.play('click');
      this.scene.stop();
      this.scene.resume('play');
    });

    this.input.keyboard?.on('keydown-M', () => {
      const nowMuted = audio.toggleMuted();
      soundText.setText(`SOUND: ${nowMuted ? 'OFF' : 'ON'}  (M TO TOGGLE)`);
      if (!nowMuted) {
        audio.play('click');
      }
    });
  }
}
