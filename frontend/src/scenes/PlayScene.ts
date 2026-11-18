import Phaser from 'phaser';
import { BALANCE } from '../balance';
import { activateEmp } from '../emp';
import { getLossReason, isVictory } from '../gameState';
import { launchCargo } from '../launch';
import { createMiner, mineOre, updateSuit } from '../miner';
import { moveOnGrid } from '../movement';
import {
  applySentinelCollision,
  createSentinel,
  getActiveSentinelTypes,
  getSentinelStep,
  stunSentinel,
  tickSentinel,
  type SentinelState,
} from '../sentinels';
import { generateCrater } from '../generator';
import type { CraterWorld } from '../types';

export class PlayScene extends Phaser.Scene {
  private miner = createMiner();
  private world!: CraterWorld;
  private player!: Phaser.GameObjects.Image;
  private hudTexts: Phaser.GameObjects.Text[] = [];
  private cannonSeconds = 120;
  private tickAccumulator = 0;
  private moveAccumulator = 0;
  private enemyAccumulator = 0;
  private elapsedSeconds = 0;
  private empRing: Phaser.GameObjects.Graphics | null = null;
  private empRingRadius = 0;
  private sentinels: SentinelState[] = [];
  private sentinelSprites = new Map<SentinelState, Phaser.GameObjects.Image>();

  constructor() {
    super('play');
  }

  init(data: { seed: number; callsign: string }): void {
    this.miner = createMiner(data.callsign);
    this.world = generateCrater(data.seed);
    this.miner.x = this.world.playerSpawn.x;
    this.miner.y = this.world.playerSpawn.y;
    this.cannonSeconds = 120;
    this.elapsedSeconds = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#11151a');
    this.drawFrame();
    this.drawWorld();

    const playerX = (this.miner.x + 0.5) * WORLD_TILE;
    const playerY = (this.miner.y + 0.5) * WORLD_TILE;
    this.player = this.add.image(playerX, playerY, 'miner');

    this.cameras.main.setBounds(
      0,
      0,
      this.world.width * WORLD_TILE,
      this.world.height * WORLD_TILE,
    );
    this.cameras.main.setViewport(176, 88, 616, 616);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.createHud();
  }

  update(_time: number, delta: number): void {
    if (this.scene.isPaused('play')) {
      return;
    }

    this.tickAccumulator += delta;
    this.moveAccumulator += delta;
    this.enemyAccumulator += delta;
    this.elapsedSeconds += delta / 1000;

    if (this.tickAccumulator >= 100) {
      this.tickAccumulator -= 100;
      this.cannonSeconds = Math.max(0, this.cannonSeconds - 0.1);
      const atBase =
        this.miner.x === this.world.base.x &&
        this.miner.y === this.world.base.y;
      const inVent = this.world.thermalVents.some(
        (vent) => vent.x === this.miner.x && vent.y === this.miner.y,
      );
      updateSuit(this.miner, atBase, inVent);
      this.ensureSentinels();
      this.updateHud();
    }

    if (this.moveAccumulator >= 90) {
      this.moveAccumulator -= 90;
      this.handleMovement();
    }

    if (this.enemyAccumulator >= 300) {
      this.enemyAccumulator -= 300;
      this.updateSentinels();
    }

    this.handleActions();
    this.updateEmpRing(delta);
    this.checkTerminalState();
  }

  private drawFrame(): void {
    this.add.rectangle(484, 44, 968, 88, 0x182027);
    this.add.rectangle(484, 735, 968, 62, 0x182027);
    this.add.rectangle(484, 383, 616, 616, 0x11151a)
      .setStrokeStyle(2, 0x4a5964);
  }

  private drawWorld(): void {
    const graphics = this.add.graphics();

    for (let y = 0; y < this.world.height; y += 1) {
      for (let x = 0; x < this.world.width; x += 1) {
        const px = x * WORLD_TILE;
        const py = y * WORLD_TILE;
        graphics.fillStyle(this.world.walls[y][x] ? 0x4a5964 : 0x242c32, 1);
        graphics.fillRect(px, py, WORLD_TILE, WORLD_TILE);

        if (!this.world.walls[y][x] && (x + y) % 7 === 0) {
          graphics.fillStyle(0x303a40, 1);
          graphics.fillRect(px + 5, py + 5, 3, 3);
        }
      }
    }

    graphics.fillStyle(0x3975d4, 1);
    graphics.fillRect(
      this.world.base.x * WORLD_TILE + 4,
      this.world.base.y * WORLD_TILE + 4,
      WORLD_TILE - 8,
      WORLD_TILE - 8,
    );
    graphics.fillStyle(0x64dd9b, 1);
    graphics.fillRect(
      this.world.launchZone.x * WORLD_TILE + 4,
      this.world.launchZone.y * WORLD_TILE + 4,
      WORLD_TILE - 8,
      WORLD_TILE - 8,
    );

    for (const vent of this.world.thermalVents) {
      graphics.fillStyle(0xf0a23a, 1);
      graphics.fillCircle(
        (vent.x + 0.5) * WORLD_TILE,
        (vent.y + 0.5) * WORLD_TILE,
        8,
      );
    }

    for (const ore of this.world.ores) {
      if (!ore.active) {
        continue;
      }
      const color =
        ore.type === 'quartz'
          ? 0xffd35a
          : ore.type === 'helium3'
            ? 0x7fe7ff
            : 0xd66cff;
      graphics.fillStyle(color, 1);
      graphics.fillTriangle(
        (ore.x + 0.5) * WORLD_TILE,
        ore.y * WORLD_TILE + 5,
        ore.x * WORLD_TILE + 5,
        (ore.y + 1) * WORLD_TILE - 5,
        (ore.x + 1) * WORLD_TILE - 5,
        (ore.y + 1) * WORLD_TILE - 5,
      );
    }
  }

  private createHud(): void {
    this.hudTexts = [
      this.add.text(20, 18, '', { fontFamily: 'monospace', fontSize: '12px', color: '#eef4f7' }),
      this.add.text(20, 46, '', { fontFamily: 'monospace', fontSize: '12px', color: '#eef4f7' }),
      this.add.text(650, 18, '', { fontFamily: 'monospace', fontSize: '12px', color: '#eef4f7' }),
      this.add.text(650, 46, '', { fontFamily: 'monospace', fontSize: '12px', color: '#eef4f7' }),
      this.add.text(484, 720, '', { fontFamily: 'monospace', fontSize: '12px', color: '#b5c1c8' }).setOrigin(0.5),
      this.add.text(484, 745, 'WASD MOVE  SPACE MINE  F LAUNCH  Q EMP  ESC PAUSE', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#b5c1c8',
      }).setOrigin(0.5),
    ];
    this.updateHud();
  }

  private updateHud(): void {
    this.hudTexts[0]?.setText(
      `CALLSIGN ${this.miner.callsign}  SAVINGS $${this.miner.savedBillions}B / $1T`,
    );
    this.hudTexts[1]?.setText(
      `CARGO $${this.miner.cargoBillions}B / $${this.miner.cargoCapacity}B  DRILL ${this.miner.drillLevel}`,
    );
    this.hudTexts[2]?.setText(
      `HEAT ${Math.round(this.miner.heat)}%  HULL ${this.miner.health}%`,
    );
    this.hudTexts[3]?.setText(
      `CANNON ${Math.ceil(this.cannonSeconds)}s  SHIPMENTS ${this.miner.shipmentsLaunched}`,
    );
    this.hudTexts[4]?.setText(
      `EMP ${this.miner.empCooldownTicks > 0 ? `${this.miner.empCooldownTicks / 10}s` : 'READY'}  OBJECTIVE ${
        this.miner.savedBillions >= BALANCE.victorySavingsBillions
          ? 'MEDICAL + $1T REACHED'
          : 'MINE AND LAUNCH CARGO'
      }`,
    );
  }

  private handleMovement(): void {
    const cursors = this.input.keyboard?.createCursorKeys();
    const keys = this.input.keyboard?.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    let dx = 0;
    let dy = 0;

    if (keys?.A?.isDown || cursors?.left.isDown) dx -= 1;
    if (keys?.D?.isDown || cursors?.right.isDown) dx += 1;
    if (keys?.W?.isDown || cursors?.up.isDown) dy -= 1;
    if (keys?.S?.isDown || cursors?.down.isDown) dy += 1;

    if (dx === 0 && dy === 0) {
      return;
    }

    const next = moveOnGrid(
      this.miner.x,
      this.miner.y,
      dx,
      dy,
      this.world.walls,
    );
    this.miner.x = next.x;
    this.miner.y = next.y;
    this.player.setPosition(
      (this.miner.x + 0.5) * WORLD_TILE,
      (this.miner.y + 0.5) * WORLD_TILE,
    );
  }

  private handleActions(): void {
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard?.addKey('SPACE') as Phaser.Input.Keyboard.Key)) {
      this.mineAtMiner();
    }
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard?.addKey('F') as Phaser.Input.Keyboard.Key)) {
      if (
        this.miner.x === this.world.launchZone.x &&
        this.miner.y === this.world.launchZone.y
      ) {
        const launch = launchCargo(this.miner, this.cannonSeconds);
        this.cannonSeconds = launch.cannonSeconds;
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard?.addKey('Q') as Phaser.Input.Keyboard.Key)) {
      if (activateEmp(this.miner)) {
        this.empRing = this.add.graphics();
        this.empRingRadius = 0;
        for (const sentinel of this.sentinels) {
          const distance =
            Math.abs(sentinel.x - this.miner.x) +
            Math.abs(sentinel.y - this.miner.y);
          if (distance <= BALANCE.empRadiusTiles) {
            stunSentinel(sentinel, BALANCE.empStunTicks);
          }
        }
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard?.addKey('ESC') as Phaser.Input.Keyboard.Key)) {
      this.scene.launch('pause');
      this.scene.pause();
    }
  }

  private ensureSentinels(): void {
    const activeTypes = getActiveSentinelTypes(this.miner.heat);

    for (const type of activeTypes) {
      if (this.sentinels.some((sentinel) => sentinel.type === type)) {
        continue;
      }

      const spawn = this.world.enemySpawnPoints[
        type === 'TESLA' ? 0 : 1
      ];
      const sentinel = createSentinel(type, spawn.x, spawn.y);
      this.sentinels.push(sentinel);

      const sprite = this.add.image(
        (spawn.x + 0.5) * WORLD_TILE,
        (spawn.y + 0.5) * WORLD_TILE,
        type === 'TESLA' ? 'teslaSentinel' : 'mechSentinel',
      );
      this.sentinelSprites.set(sentinel, sprite);
    }

    for (const sentinel of [...this.sentinels]) {
      if (!activeTypes.includes(sentinel.type)) {
        const sprite = this.sentinelSprites.get(sentinel);
        sprite?.destroy();
        this.sentinelSprites.delete(sentinel);
        this.sentinels = this.sentinels.filter((entry) => entry !== sentinel);
      }
    }
  }

  private updateSentinels(): void {
    for (const sentinel of this.sentinels) {
      tickSentinel(sentinel);
      const step = getSentinelStep(
        sentinel,
        this.miner.x,
        this.miner.y,
        Math.random(),
      );
      if (step.dx !== 0 || step.dy !== 0) {
        const next = moveOnGrid(
          sentinel.x,
          sentinel.y,
          step.dx,
          step.dy,
          this.world.walls,
        );
        sentinel.x = next.x;
        sentinel.y = next.y;
        this.sentinelSprites.get(sentinel)?.setPosition(
          (sentinel.x + 0.5) * WORLD_TILE,
          (sentinel.y + 0.5) * WORLD_TILE,
        );
      }

      if (
        sentinel.x === this.miner.x &&
        sentinel.y === this.miner.y
      ) {
        applySentinelCollision(sentinel, this.miner);
      }
    }
  }

  private mineAtMiner(): void {
    const ore = this.world.ores.find(
      (deposit) =>
        deposit.active &&
        deposit.x === this.miner.x &&
        deposit.y === this.miner.y,
    );
    if (ore) {
      const mined = mineOre(this.miner, ore.type);
      if (mined > 0) {
        ore.active = false;
      }
      this.drawWorld();
    }
  }

  private updateEmpRing(delta: number): void {
    if (!this.empRing) {
      return;
    }
    this.empRingRadius += delta * 0.08;
    this.empRing.clear();
    this.empRing.lineStyle(4, 0x7fe7ff, 1);
    this.empRing.strokeCircle(
      (this.miner.x + 0.5) * WORLD_TILE,
      (this.miner.y + 0.5) * WORLD_TILE,
      this.empRingRadius,
    );
    if (this.empRingRadius >= 160) {
      this.empRing.destroy();
      this.empRing = null;
    }
  }

  private checkTerminalState(): void {
    if (isVictory(this.miner)) {
      this.scene.start('result', {
        victory: true,
        miner: this.miner,
        seed: this.world.seed,
        reason: 'VICTORY',
        elapsedSeconds: this.elapsedSeconds,
      });
      return;
    }

    const lossReason = getLossReason(this.miner, this.cannonSeconds);
    if (lossReason !== 'NONE') {
      this.scene.start('result', {
        victory: false,
        miner: this.miner,
        seed: this.world.seed,
        reason: lossReason,
        elapsedSeconds: this.elapsedSeconds,
      });
    }
  }
}

const WORLD_TILE = 32;
