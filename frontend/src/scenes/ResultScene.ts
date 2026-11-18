import Phaser from 'phaser';
import type { MinerState } from '../types';
import { submitRun } from '../client';
import { recordRun } from '../localSave';
import type { RunSummary } from '../types';

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
    this.add.rectangle(484, 383, 968, 766, 0x11151a);

    this.add.text(484, 280, data.victory ? 'MISSION COMPLETE' : 'MISSION FAILED', {
      fontFamily: 'monospace',
      fontSize: '34px',
      color: data.victory ? '#64dd9b' : '#ff5d68',
    }).setOrigin(0.5);

    this.add.text(484, 350,
      `SAVINGS $${data.miner.savedBillions}B\nSHIPMENTS ${data.miner.shipmentsLaunched}\nPEAK HEAT ${data.miner.peakHeat}%\nSEED ${data.seed}\n${data.reason}`,
      {
        fontFamily: 'monospace',
        fontSize: '16px',
        align: 'center',
        color: '#eef4f7',
        lineSpacing: 10,
      }).setOrigin(0.5);

    this.add.text(484, 500, 'PRESS R TO RESTART', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#7fe7ff',
    }).setOrigin(0.5);

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
    const submissionText = this.add.text(484, 535, 'SUBMISSION: CHECKING API...', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#b5c1c8',
    }).setOrigin(0.5);

    void submitRun(summary).then((result) => {
      submissionText.setText(
        result ? 'SUBMISSION: SUBMITTED' : 'SUBMISSION: FAILED — RETRY OFFLINE',
      );
      submissionText.setColor(result ? '#64dd9b' : '#ffa63a');
    });

    this.input.keyboard?.once('keydown-R', () => {
      this.scene.start('menu');
    });
  }
}
