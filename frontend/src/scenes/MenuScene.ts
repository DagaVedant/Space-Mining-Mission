import Phaser from 'phaser';
import { getDailyCrater } from '../client';
import { loadSave } from '../localSave';
import { normalizeCallsign } from '../callsign';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#11151a');
    this.add.rectangle(484, 383, 968, 766, 0x11151a);

    this.add.text(484, 260, 'VULTURE', {
      fontFamily: 'monospace',
      fontSize: '44px',
      color: '#eef4f7',
    }).setOrigin(0.5);
    this.add.text(484, 310, 'LUNAR MINING MISSION', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#7fe7ff',
    }).setOrigin(0.5);

    const seed = String(Date.now() % 1_000_000);
    let selectedSeed = Number(seed);
    void getDailyCrater().then((daily) => {
      if (daily) {
        selectedSeed = daily.seed;
      }
    });

    const save = loadSave();
    const callsignPanel = this.add.dom(484, 370).createFromHTML(`
      <label style="display:block;font-family:monospace;color:#eef4f7;text-align:center">
        CALLSIGN
        <input id="callsign" maxlength="32" value="VULTURE-07"
          style="display:block;margin-top:8px;width:260px;padding:10px;font-family:monospace;text-transform:uppercase;background:#182027;color:#eef4f7;border:2px solid #33404a" />
      </label>
    `);

    if (save.settings.reducedMotion) {
      this.add.text(484, 520, 'REDUCED MOTION ENABLED', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#64dd9b',
      }).setOrigin(0.5);
    }

    const startButton = this.add.rectangle(484, 430, 260, 54, 0x1e6e54)
      .setStrokeStyle(2, 0x64dd9b)
      .setInteractive({ useHandCursor: true });
    this.add.text(484, 430, 'START MISSION', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5);

    startButton.on('pointerdown', () => {
      const input = callsignPanel.getChildByID('callsign') as HTMLInputElement | null;
      this.scene.start('play', {
        seed: selectedSeed,
        callsign: normalizeCallsign(input?.value),
      });
    });

    this.input.keyboard?.once('keydown-ENTER', () => {
      const input = callsignPanel.getChildByID('callsign') as HTMLInputElement | null;
      this.scene.start('play', {
        seed: selectedSeed,
        callsign: normalizeCallsign(input?.value),
      });
    });

    this.add.text(484, 490, 'ENTER / CLICK TO START', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#b5c1c8',
    }).setOrigin(0.5);
  }
}
