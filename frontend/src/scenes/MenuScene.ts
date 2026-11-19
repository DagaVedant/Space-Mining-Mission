import Phaser from 'phaser';
import { getDailyCrater } from '../client';
import { loadSave, saveLocal } from '../localSave';
import { normalizeCallsign } from '../callsign';
import { audio } from '../audio';
import { drawStarfield } from '../ui/starfield';

const PANEL_BG = 0x182027;
const PANEL_BORDER = 0x33404a;
const TEXT_LIGHT = '#eef4f7';
const TEXT_MUTED = '#8696a0';
const ACCENT = '#7fe7ff';
const GREEN = '#64dd9b';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#11151a');
    drawStarfield(this, 968, 766, 160, 42);

    this.add.rectangle(484, 90, 968, 1, PANEL_BORDER).setAlpha(0.5);

    this.add
      .text(484, 108, 'VULTURE', {
        fontFamily: 'monospace',
        fontSize: '52px',
        fontStyle: 'bold',
        color: TEXT_LIGHT,
      })
      .setOrigin(0.5);
    this.add
      .text(484, 160, 'LUNAR MINING MISSION', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: ACCENT,
      })
      .setOrigin(0.5)
      .setLetterSpacing(2);
    this.add
      .text(484, 190, 'Adriana Station is out of medicine. The craters are not forgiving.', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: TEXT_MUTED,
      })
      .setOrigin(0.5);

    const panel = this.add.rectangle(484, 400, 480, 300, PANEL_BG).setStrokeStyle(1, PANEL_BORDER);
    void panel;

    this.add
      .text(484, 288, 'MISSION SETUP', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: TEXT_MUTED,
      })
      .setOrigin(0.5);

    this.add
      .text(484, 320, 'CALLSIGN', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: TEXT_MUTED,
      })
      .setOrigin(0.5);

    const save = loadSave();
    const seed = String(Date.now() % 1_000_000);
    let selectedSeed = Number(seed);
    let seedLabel = 'LOCAL SEED';
    const seedText = this.add
      .text(857, 30, `${seedLabel} ${selectedSeed}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: TEXT_MUTED,
      })
      .setOrigin(1, 0);
    void getDailyCrater().then((daily) => {
      if (daily) {
        selectedSeed = daily.seed;
        seedLabel = 'DAILY CRATER';
        seedText.setText(`${seedLabel} ${selectedSeed}`);
        seedText.setColor(ACCENT);
      }
    });

    const callsignPanel = this.add.dom(484, 352).createFromHTML(`
      <input id="callsign" maxlength="32" value="VULTURE-07"
        style="display:block;width:280px;padding:10px 12px;font-family:monospace;font-size:15px;
        letter-spacing:1px;text-transform:uppercase;text-align:center;
        background:#11151a;color:#eef4f7;border:1px solid #3a4650;outline:none" />
    `);

    const startButton = this.add
      .rectangle(484, 420, 280, 50, 0x1e6e54)
      .setStrokeStyle(1, 0x64dd9b)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(484, 420, 'START MISSION', {
        fontFamily: 'monospace',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    startButton.on('pointerover', () => startButton.setFillStyle(0x25855f));
    startButton.on('pointerout', () => startButton.setFillStyle(0x1e6e54));

    const beginMission = (): void => {
      audio.unlock();
      audio.play('click');
      const input = callsignPanel.getChildByID('callsign') as HTMLInputElement | null;
      this.scene.start('play', {
        seed: selectedSeed,
        callsign: normalizeCallsign(input?.value),
      });
    };

    startButton.on('pointerdown', beginMission);
    this.input.keyboard?.once('keydown-ENTER', beginMission);

    this.add
      .text(484, 462, 'ENTER OR CLICK TO LAUNCH   |   WASD MOVE   SPACE MINE   F LAUNCH   Q EMP', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: TEXT_MUTED,
      })
      .setOrigin(0.5);

    if (save.bestRun) {
      this.add
        .text(
          484,
          510,
          `BEST RUN  $${save.bestRun.finalSavingsBillions}B SAVED  ${save.bestRun.shipmentsLaunched} SHIPMENTS  ${save.bestRun.completionStatus}`,
          { fontFamily: 'monospace', fontSize: '11px', color: GREEN },
        )
        .setOrigin(0.5);
    }

    this.buildToggle(360, 560, 'SOUND', !save.settings.muted, (enabled) => {
      audio.setMuted(!enabled);
    });
    this.buildToggle(608, 560, 'REDUCED MOTION', save.settings.reducedMotion, (enabled) => {
      const current = loadSave();
      current.settings.reducedMotion = enabled;
      saveLocal(current);
    });

    this.add
      .text(484, 620, 'VULTURE AEROSPACE  //  LUNAR RESOURCE AUTHORITY CONTRACT', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: TEXT_MUTED,
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
  }

  private buildToggle(
    x: number,
    y: number,
    label: string,
    initial: boolean,
    onChange: (enabled: boolean) => void,
  ): void {
    let enabled = initial;
    const box = this.add
      .rectangle(x, y, 220, 36, PANEL_BG)
      .setStrokeStyle(1, PANEL_BORDER)
      .setInteractive({ useHandCursor: true });
    const dot = this.add.circle(x - 95, y, 5, enabled ? 0x64dd9b : 0x4a5964);
    const text = this.add
      .text(x - 80, y, `${label}: ${enabled ? 'ON' : 'OFF'}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: enabled ? TEXT_LIGHT : TEXT_MUTED,
      })
      .setOrigin(0, 0.5);

    box.on('pointerdown', () => {
      enabled = !enabled;
      dot.setFillStyle(enabled ? 0x64dd9b : 0x4a5964);
      text.setText(`${label}: ${enabled ? 'ON' : 'OFF'}`);
      text.setColor(enabled ? TEXT_LIGHT : TEXT_MUTED);
      onChange(enabled);
      audio.play('click');
    });
  }
}
