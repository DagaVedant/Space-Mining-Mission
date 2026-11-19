import Phaser from 'phaser';
import type { MinerState } from '../types';
import { submitRun } from '../client';
import { recordRun, loadSave } from '../localSave';
import type { RunSummary } from '../types';
import { audio } from '../audio';
import { drawStarfield } from '../ui/starfield';
import { drawIcon } from '../ui/icons';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('result');
  }

  create(data: {
    victory: boolean;
    miner: MinerState;
    seed: number;
    reason: string;
    elapsedSeconds: number;
  }): void {
    this.cameras.main.setBackgroundColor('#11151a');
    drawStarfield(this, 968, 766, 140, data.seed % 100000);

    const accent = data.victory ? 0x64dd9b : 0xff5d68;
    const accentHex = data.victory ? '#64dd9b' : '#ff5d68';

    this.add.rectangle(484, 90, 968, 180, accent, 0.06);
    this.add.rectangle(484, 180, 968, 1, accent, 0.4);

    this.add
      .text(484, 120, data.victory ? 'MISSION COMPLETE' : 'MISSION FAILED', {
        fontFamily: 'monospace',
        fontSize: '36px',
        fontStyle: 'bold',
        color: accentHex,
      })
      .setOrigin(0.5);

    const reasonLabel = data.victory
      ? 'ADRIANA STATION RESUPPLIED — $1T SAVED'
      : data.reason === 'HULL'
        ? 'SUIT HULL FAILURE'
        : 'ORBITAL CANNON TIMER EXPIRED';
    this.add
      .text(484, 158, reasonLabel, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#b5c1c8',
      })
      .setOrigin(0.5);

    const panel = this.add
      .rectangle(484, 360, 520, 260, 0x182027)
      .setStrokeStyle(1, 0x33404a);
    void panel;

    const stats: Array<[import('../ui/icons').IconType, string, string]> = [
      ['savings', 'SAVINGS', `$${data.miner.savedBillions}B / $1T`],
      ['shipment', 'SHIPMENTS LAUNCHED', `${data.miner.shipmentsLaunched}`],
      ['medicine', 'MEDICAL SHIPMENTS', `${data.miner.pillsDelivered}`],
      ['heat', 'PEAK HEAT', `${Math.round(data.miner.peakHeat)}%`],
      ['hull', 'FINAL HULL', `${Math.round(data.miner.health)}%`],
      ['drill', 'DRILL LEVEL', `${data.miner.drillLevel}`],
    ];

    const startY = 270;
    stats.forEach(([icon, label, value], index) => {
      const row = startY + index * 30;
      drawIcon(this, icon, 290, row, 16, 0x7fe7ff);
      this.add.text(310, row, label, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#8696a0',
      }).setOrigin(0, 0.5);
      this.add.text(670, row, value, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#eef4f7',
      }).setOrigin(1, 0.5);
    });

    this.add
      .text(484, startY + stats.length * 30 + 10, `RUN SEED ${data.seed}  •  DURATION ${Math.floor(data.elapsedSeconds)}s`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#8696a0',
      })
      .setOrigin(0.5);

    this.add
      .text(484, 530, 'PRESS R TO RETURN TO MENU', {
        fontFamily: 'monospace',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#7fe7ff',
      })
      .setOrigin(0.5);

    const summary: RunSummary = {
      seed: data.seed,
      callsign: data.miner.callsign,
      durationSeconds: Math.floor(data.elapsedSeconds),
      finalSavingsBillions: data.miner.savedBillions,
      cargoBillions: data.miner.cargoBillions,
      shipmentsLaunched: data.miner.shipmentsLaunched,
      pillsDelivered: data.miner.pillsDelivered,
      peakHeat: data.miner.peakHeat,
      finalHealth: data.miner.health,
      completionStatus: data.victory ? 'VICTORY' : 'GAME_OVER',
      lossReason: data.victory
        ? 'NONE'
        : data.reason === 'HULL'
          ? 'HULL'
          : 'CANNON',
      selectedUpgrades: data.miner.activeUpgrades,
    };

    recordRun(summary);
    audio.play(data.victory ? 'victory' : 'defeat');

    const submissionText = this.add
      .text(484, 560, 'SUBMISSION: CHECKING API...', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#8696a0',
      })
      .setOrigin(0.5);

    void submitRun(summary).then((result) => {
      submissionText.setText(
        result ? 'RUN SUBMITTED TO LEADERBOARD' : 'OFFLINE — RUN SAVED LOCALLY ONLY',
      );
      submissionText.setColor(result ? '#64dd9b' : '#f0a23a');
    });

    if (loadSave().bestRun?.finalSavingsBillions === summary.finalSavingsBillions) {
      this.add
        .text(484, 582, 'NEW BEST RUN', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#ffd35a',
        })
        .setOrigin(0.5);
    }

    this.input.keyboard?.once('keydown-R', () => {
      audio.play('click');
      this.scene.start('menu');
    });
  }
}
