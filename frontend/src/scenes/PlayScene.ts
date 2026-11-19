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
import type { CraterWorld, OreDeposit, OreType } from '../types';
import { audio } from '../audio';
import { createStatBar, heatColor, heatLabel, toCssColor, type StatBar } from '../ui/bar';
import { drawIcon, type IconType } from '../ui/icons';
import { loadSave } from '../localSave';

const WORLD_TILE = 32;
const CANVAS_W = 968;
const CANVAS_H = 766;
const HEADER_H = 88;
const FOOTER_H = 62;
const VIEWPORT = 616;
const MARGIN = (CANVAS_W - VIEWPORT) / 2;
const VIEW_CENTER_X = MARGIN + VIEWPORT / 2;
const VIEW_CENTER_Y = HEADER_H + VIEWPORT / 2;

const ORE_TEXTURE: Record<OreType, string> = {
  quartz: 'quartz',
  helium3: 'helium3',
  darkMatter: 'darkMatter',
};

const ORE_GLOW: Record<OreType, number> = {
  quartz: 0xffd35a,
  helium3: 0x7fe7ff,
  darkMatter: 0xd66cff,
};

export class PlayScene extends Phaser.Scene {
  private miner = createMiner();
  private world!: CraterWorld;
  private player!: Phaser.GameObjects.Image;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private worldLayer!: Phaser.GameObjects.Container;
  private hudLayer!: Phaser.GameObjects.Container;

  private cannonSeconds = 120;
  private tickAccumulator = 0;
  private moveAccumulator = 0;
  private enemyAccumulator = 0;
  private heatBeepAccumulator = 0;
  private elapsedSeconds = 0;

  private empRing: Phaser.GameObjects.Graphics | null = null;
  private empRingRadius = 0;

  private sentinels: SentinelState[] = [];
  private sentinelSprites = new Map<SentinelState, Phaser.GameObjects.Image>();
  private sentinelGlows = new Map<SentinelState, Phaser.GameObjects.Arc>();
  private sentinelWarnings = new Map<SentinelState, Phaser.GameObjects.Text>();
  private sentinelShadows = new Map<SentinelState, Phaser.GameObjects.Ellipse>();

  private oreSprites = new Map<string, Phaser.GameObjects.Image>();
  private oreGlows = new Map<string, Phaser.GameObjects.Arc>();
  private oreShadows = new Map<string, Phaser.GameObjects.Ellipse>();

  private dustEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private rocketSprite?: Phaser.GameObjects.Image;
  private rocketBaseY = 0;
  private playerShadow!: Phaser.GameObjects.Ellipse;

  private reducedMotion = false;

  private savingsBar!: StatBar;
  private cargoBar!: StatBar;
  private heatBar!: StatBar;
  private hullBar!: StatBar;
  private cannonBar!: StatBar;
  private empBar!: StatBar;
  private hudTexts: Record<string, Phaser.GameObjects.Text> = {};

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

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
    this.sentinels = [];
    this.sentinelSprites.clear();
    this.sentinelGlows.clear();
    this.sentinelWarnings.clear();
    this.sentinelShadows.clear();
    this.oreSprites.clear();
    this.oreGlows.clear();
    this.oreShadows.clear();
    this.reducedMotion = loadSave().settings.reducedMotion;
  }

  create(): void {
    this.worldLayer = this.add.container(0, 0);
    this.hudLayer = this.add.container(0, 0);

    this.cameras.main.setBackgroundColor('#0c1115');
    this.cameras.main.setViewport(MARGIN, HEADER_H, VIEWPORT, VIEWPORT);
    this.cameras.main.setBounds(0, 0, this.world.width * WORLD_TILE, this.world.height * WORLD_TILE);
    this.cameras.main.setZoom(1.05);

    this.uiCamera = this.cameras.add(0, 0, CANVAS_W, CANVAS_H);
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.ignore(this.worldLayer);
    this.cameras.main.ignore(this.hudLayer);

    this.drawWorld();
    this.createPlayer();

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.createFrame();
    this.createHud();

    this.keys = this.input.keyboard?.addKeys('W,A,S,D,SPACE,F,Q,ESC') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
  }

  update(_time: number, delta: number): void {
    if (this.scene.isPaused('play')) {
      return;
    }

    this.tickAccumulator += delta;
    this.moveAccumulator += delta;
    this.enemyAccumulator += delta;
    this.elapsedSeconds += delta / 1000;
    this.heatBeepAccumulator += delta;

    if (this.tickAccumulator >= 100) {
      this.tickAccumulator -= 100;
      this.cannonSeconds = Math.max(0, this.cannonSeconds - 0.1);
      const atBase = this.miner.x === this.world.base.x && this.miner.y === this.world.base.y;
      const inVent = this.world.thermalVents.some(
        (vent) => vent.x === this.miner.x && vent.y === this.miner.y,
      );
      updateSuit(this.miner, atBase, inVent);
      this.ensureSentinels();
      this.updateHud();
    }

    if (this.miner.heat >= BALANCE.heatWarningPercent) {
      const interval = this.miner.heat >= 100 ? 350 : this.miner.heat >= 75 ? 600 : 1000;
      if (this.heatBeepAccumulator >= interval) {
        this.heatBeepAccumulator = 0;
        audio.play('heatBeep');
      }
    } else {
      this.heatBeepAccumulator = 0;
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

  private wl<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.worldLayer.add(obj);
    return obj;
  }

  private hl<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.hudLayer.add(obj);
    return obj;
  }

  // Contact shadows are positioned at the sprite's feet (y + drop), not its center,
  // so moving entities must apply the same `drop` when repositioning their shadow.
  private addShadow(x: number, y: number, rx = 10, ry = 5, drop = 9): Phaser.GameObjects.Ellipse {
    const shadow = this.add.ellipse(x, y + drop, rx * 2, ry * 2, 0x060809, 0.4);
    this.wl(shadow);
    return shadow;
  }

  private drawWorld(): void {
    const graphics = this.add.graphics();
    this.wl(graphics);

    // Light direction convention: single source, upper-left ~45deg.
    // Lit edges (top/left) get a lightened tint, shadowed edges (bottom/right)
    // get a darkened tint, applied consistently across all terrain and sprites.
    const floorA = 0x242c32;
    const floorB = 0x272f36;
    const floorPebbleLit = 0x3c474f;
    const floorPebbleShadow = 0x1b2227;
    const craterRim = 0x3a444c;
    const craterShadow = 0x1a2024;
    const wallBase = 0x3c4a54;
    const wallTop = 0x57666f;
    const wallLeftLit = 0x4c5c67;
    const wallShadow = 0x283137;
    const wallRightShadow = 0x323e47;

    for (let y = 0; y < this.world.height; y += 1) {
      for (let x = 0; x < this.world.width; x += 1) {
        const px = x * WORLD_TILE;
        const py = y * WORLD_TILE;

        if (this.world.walls[y][x]) {
          graphics.fillStyle(wallBase, 1);
          graphics.fillRect(px, py, WORLD_TILE, WORLD_TILE);
          graphics.fillStyle(wallTop, 1);
          graphics.fillRect(px, py, WORLD_TILE, 7);
          graphics.fillStyle(wallLeftLit, 1);
          graphics.fillRect(px, py, 3, WORLD_TILE);
          graphics.fillStyle(wallRightShadow, 1);
          graphics.fillRect(px + WORLD_TILE - 3, py, 3, WORLD_TILE);
          graphics.fillStyle(wallShadow, 1);
          graphics.fillRect(px, py + WORLD_TILE - 4, WORLD_TILE, 4);
        } else {
          const tone = (x * 31 + y * 17) % 5 === 0 ? floorB : floorA;
          graphics.fillStyle(tone, 1);
          graphics.fillRect(px, py, WORLD_TILE, WORLD_TILE);
          if ((x + y * 7) % 11 === 0) {
            graphics.fillStyle(floorPebbleLit, 1);
            graphics.fillRect(px + 6, py + 6, 2, 2);
            graphics.fillStyle(floorPebbleShadow, 1);
            graphics.fillRect(px + 7, py + 7, 2, 2);
            graphics.fillStyle(floorPebbleLit, 1);
            graphics.fillRect(px + 21, py + 18, 2, 2);
            graphics.fillStyle(floorPebbleShadow, 1);
            graphics.fillRect(px + 22, py + 19, 2, 2);
          }
          if ((x * 13 + y * 29) % 40 === 0) {
            graphics.fillStyle(craterShadow, 1);
            graphics.fillCircle(px + 16, py + 17, 7);
            graphics.fillStyle(craterRim, 1);
            graphics.fillCircle(px + 15, py + 15, 6);
            graphics.fillStyle(tone, 1);
            graphics.fillCircle(px + 15, py + 15, 4);
          }
        }
      }
    }

    const baseX = (this.world.base.x + 0.5) * WORLD_TILE;
    const baseY = (this.world.base.y + 0.5) * WORLD_TILE;
    this.addShadow(baseX, baseY, 15, 8);
    const base = this.add.image(baseX, baseY, 'base');
    this.wl(base);

    const launchX = (this.world.launchZone.x + 0.5) * WORLD_TILE;
    const launchY = (this.world.launchZone.y + 0.5) * WORLD_TILE;
    this.addShadow(launchX, launchY, 15, 8);
    const launch = this.add.image(launchX, launchY, 'launchZone');
    this.wl(launch);

    this.addShadow(launch.x, launch.y, 7, 4);
    this.rocketSprite = this.add
      .image(launch.x, launch.y - 4, 'rocket')
      .setOrigin(0.5, 1)
      .setDepth(5);
    this.rocketBaseY = this.rocketSprite.y;
    this.wl(this.rocketSprite);

    for (const vent of this.world.thermalVents) {
      this.addShadow((vent.x + 0.5) * WORLD_TILE, (vent.y + 0.5) * WORLD_TILE, 9, 5);
      const img = this.add.image((vent.x + 0.5) * WORLD_TILE, (vent.y + 0.5) * WORLD_TILE, 'thermalVent');
      this.wl(img);
      if (!this.reducedMotion) {
        this.tweens.add({
          targets: img,
          alpha: { from: 0.8, to: 1 },
          scaleX: { from: 0.95, to: 1.05 },
          scaleY: { from: 0.95, to: 1.05 },
          duration: 650,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    for (const pocket of this.world.radiationPockets) {
      this.addShadow((pocket.x + 0.5) * WORLD_TILE, (pocket.y + 0.5) * WORLD_TILE, 9, 5);
      const img = this.add.image(
        (pocket.x + 0.5) * WORLD_TILE,
        (pocket.y + 0.5) * WORLD_TILE,
        'radiationPocket',
      );
      this.wl(img);
    }

    for (const ore of this.world.ores) {
      this.createOreSprite(ore);
    }
  }

  private createOreSprite(ore: OreDeposit): void {
    if (!ore.active) {
      return;
    }
    const cx = (ore.x + 0.5) * WORLD_TILE;
    const cy = (ore.y + 0.5) * WORLD_TILE;

    const shadow = this.addShadow(cx, cy, 8, 4);
    const glow = this.add.circle(cx, cy, 12, ORE_GLOW[ore.type], 0.16);
    this.wl(glow);
    const sprite = this.add.image(cx, cy, ORE_TEXTURE[ore.type]);
    this.wl(sprite);

    this.oreShadows.set(ore.id, shadow);
    this.oreGlows.set(ore.id, glow);
    this.oreSprites.set(ore.id, sprite);

    if (!this.reducedMotion) {
      this.tweens.add({
        targets: [sprite, glow],
        y: '-=3',
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.1, to: 0.28 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private createPlayer(): void {
    const px = (this.miner.x + 0.5) * WORLD_TILE;
    const py = (this.miner.y + 0.5) * WORLD_TILE;
    this.playerShadow = this.addShadow(px, py, 8, 4);
    this.player = this.add.image(px, py, 'miner').setDepth(10);
    this.wl(this.player);

    if (!this.reducedMotion) {
      this.dustEmitter = this.add.particles(0, 0, 'dot', {
        speed: { min: 4, max: 18 },
        lifespan: 300,
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.3, end: 0 },
        tint: 0x8a97a0,
        frequency: 90,
        emitting: false,
      });
      this.dustEmitter.startFollow(this.player, 0, 10);
      this.wl(this.dustEmitter);
    }
  }

  private createFrame(): void {
    this.hl(this.add.rectangle(CANVAS_W / 2, HEADER_H / 2, CANVAS_W, HEADER_H, 0x161d23));
    this.hl(
      this.add.rectangle(CANVAS_W / 2, HEADER_H + VIEWPORT + FOOTER_H / 2, CANVAS_W, FOOTER_H, 0x161d23),
    );
    this.hl(this.add.rectangle(MARGIN / 2, HEADER_H + VIEWPORT / 2, MARGIN, VIEWPORT, 0x12171c));
    this.hl(
      this.add.rectangle(CANVAS_W - MARGIN / 2, HEADER_H + VIEWPORT / 2, MARGIN, VIEWPORT, 0x12171c),
    );
    this.hl(
      this.add
        .rectangle(VIEW_CENTER_X, VIEW_CENTER_Y, VIEWPORT, VIEWPORT)
        .setStrokeStyle(2, 0x3a4650),
    );
    this.hl(this.add.rectangle(CANVAS_W / 2, HEADER_H, CANVAS_W, 1, 0x2a343c));
    this.hl(this.add.rectangle(CANVAS_W / 2, HEADER_H + VIEWPORT, CANVAS_W, 1, 0x2a343c));
  }

  private makeStatBlock(
    x: number,
    y: number,
    width: number,
    icon: IconType,
    label: string,
    barColor: number,
  ): { bar: StatBar; value: Phaser.GameObjects.Text } {
    this.hl(drawIcon(this, icon, x + 7, y, 14, 0x8696a0));
    this.hl(
      this.add
        .text(x + 18, y, label, { fontFamily: 'monospace', fontSize: '10px', color: '#8696a0' })
        .setOrigin(0, 0.5),
    );
    const bar = createStatBar(this, x, y + 14, width, 10);
    bar.setRatio(0, barColor);
    this.hl(bar.container);
    const value = this.add.text(x, y + 30, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#eef4f7',
    });
    this.hl(value);
    return { bar, value };
  }

  private createHud(): void {
    this.hl(
      this.add.text(24, 26, this.miner.callsign, {
        fontFamily: 'monospace',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#eef4f7',
      }),
    );
    this.hudTexts.objective = this.hl(
      this.add.text(24, 54, '', { fontFamily: 'monospace', fontSize: '11px', color: '#7fe7ff' }),
    );
    this.hudTexts.medical = this.hl(
      this.add
        .text(944, 26, '', { fontFamily: 'monospace', fontSize: '11px', color: '#b5c1c8' })
        .setOrigin(1, 0),
    );
    this.hl(
      this.add
        .text(944, 54, `SEED ${this.world.seed}`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#5c6b74',
        })
        .setOrigin(1, 0),
    );

    const LX = 24;
    const BAR_W = 128;

    const savings = this.makeStatBlock(LX, 136, BAR_W, 'savings', 'SAVINGS TO $1T', 0x64dd9b);
    this.savingsBar = savings.bar;
    this.hudTexts.savings = savings.value;

    const cargo = this.makeStatBlock(LX, 216, BAR_W, 'cargo', 'CARGO HOLD', 0xffd35a);
    this.cargoBar = cargo.bar;
    this.hudTexts.cargo = cargo.value;

    this.hl(drawIcon(this, 'drill', LX + 7, 286, 14, 0x8696a0));
    this.hudTexts.drill = this.hl(
      this.add
        .text(LX + 18, 286, '', { fontFamily: 'monospace', fontSize: '11px', color: '#eef4f7' })
        .setOrigin(0, 0.5),
    );

    const hull = this.makeStatBlock(LX, 340, BAR_W, 'hull', 'SUIT HULL', 0x64dd9b);
    this.hullBar = hull.bar;
    this.hudTexts.hull = hull.value;

    const RX = CANVAS_W - MARGIN + 24;

    const heat = this.makeStatBlock(RX, 136, BAR_W, 'heat', 'THERMAL SIGNATURE', 0x7fe7ff);
    this.heatBar = heat.bar;
    this.hudTexts.heat = heat.value;

    const cannon = this.makeStatBlock(RX, 216, BAR_W, 'cannon', 'CANNON TIMER', 0xff9d6c);
    this.cannonBar = cannon.bar;
    this.hudTexts.cannon = cannon.value;

    const emp = this.makeStatBlock(RX, 296, BAR_W, 'emp', 'EMP CHARGE', 0x3fd0ff);
    this.empBar = emp.bar;
    this.hudTexts.emp = emp.value;

    this.hl(drawIcon(this, 'shipment', RX + 7, 366, 14, 0x8696a0));
    this.hudTexts.shipments = this.hl(
      this.add
        .text(RX + 18, 366, '', { fontFamily: 'monospace', fontSize: '11px', color: '#eef4f7' })
        .setOrigin(0, 0.5),
    );

    this.hl(
      this.add
        .text(
          VIEW_CENTER_X,
          HEADER_H + VIEWPORT + FOOTER_H / 2,
          'WASD MOVE   SPACE MINE   F LAUNCH   Q EMP   ESC PAUSE',
          { fontFamily: 'monospace', fontSize: '12px', color: '#8696a0' },
        )
        .setOrigin(0.5),
    );

    this.updateHud();
  }

  private updateHud(): void {
    this.savingsBar.setRatio(this.miner.savedBillions / BALANCE.victorySavingsBillions, 0x64dd9b);
    this.hudTexts.savings.setText(`$${this.miner.savedBillions}B / $1T`);

    this.cargoBar.setRatio(this.miner.cargoBillions / this.miner.cargoCapacity, 0xffd35a);
    this.hudTexts.cargo.setText(`$${this.miner.cargoBillions}B / $${this.miner.cargoCapacity}B`);

    this.hudTexts.drill.setText(`DRILL LEVEL ${this.miner.drillLevel}`);

    const hullColor = this.miner.health < 35 ? 0xff5d68 : 0x64dd9b;
    this.hullBar.setRatio(this.miner.health / this.miner.maxHealth, hullColor);
    this.hudTexts.hull.setText(`${Math.round(this.miner.health)}% / ${this.miner.maxHealth}%`);
    this.hudTexts.hull.setColor(toCssColor(hullColor));

    const hColor = heatColor(this.miner.heat);
    this.heatBar.setRatio(this.miner.heat / 100, hColor);
    this.hudTexts.heat.setText(`${Math.round(this.miner.heat)}%  ${heatLabel(this.miner.heat)}`);
    this.hudTexts.heat.setColor(toCssColor(hColor));

    const cannonColor = this.cannonSeconds < 20 ? 0xff5d68 : 0xff9d6c;
    this.cannonBar.setRatio(this.cannonSeconds / BALANCE.cannonTimerCapSeconds, cannonColor);
    this.hudTexts.cannon.setText(`${Math.ceil(this.cannonSeconds)}s`);
    this.hudTexts.cannon.setColor(toCssColor(cannonColor));

    const empReady = this.miner.empCooldownTicks <= 0;
    this.empBar.setRatio(
      empReady ? 1 : 1 - this.miner.empCooldownTicks / BALANCE.empCooldownTicks,
      empReady ? 0x64dd9b : 0x3fd0ff,
    );
    this.hudTexts.emp.setText(empReady ? 'READY (Q)' : `${(this.miner.empCooldownTicks / 10).toFixed(1)}s`);
    this.hudTexts.emp.setColor(empReady ? toCssColor(0x64dd9b) : '#eef4f7');

    this.hudTexts.shipments.setText(`SHIPMENTS ${this.miner.shipmentsLaunched}`);

    this.hudTexts.medical.setText(
      this.miner.adrianaSafe ? 'ADRIANA STATION: SUPPLIED' : 'ADRIANA STATION: AWAITING MEDICINE',
    );
    this.hudTexts.medical.setColor(this.miner.adrianaSafe ? '#64dd9b' : '#f0a23a');

    this.hudTexts.objective.setText(
      this.miner.savedBillions >= BALANCE.victorySavingsBillions
        ? 'RETURN TO LAUNCH ZONE — MISSION COMPLETE'
        : this.miner.cargoBillions >= BALANCE.minimumLaunchBillions
          ? 'LAUNCH ZONE READY — PRESS F TO LAUNCH CARGO'
          : 'MINE ORE AND MANAGE HEAT',
    );
  }

  private handleMovement(): void {
    let dx = 0;
    let dy = 0;

    if (this.keys.A?.isDown) dx -= 1;
    if (this.keys.D?.isDown) dx += 1;
    if (this.keys.W?.isDown) dy -= 1;
    if (this.keys.S?.isDown) dy += 1;

    if (dx === 0 && dy === 0) {
      this.dustEmitter?.stop();
      return;
    }

    if (dx !== 0) {
      this.player.setFlipX(dx < 0);
    }

    const next = moveOnGrid(this.miner.x, this.miner.y, dx, dy, this.world.walls);
    const moved = next.x !== this.miner.x || next.y !== this.miner.y;
    this.miner.x = next.x;
    this.miner.y = next.y;
    this.player.setPosition((this.miner.x + 0.5) * WORLD_TILE, (this.miner.y + 0.5) * WORLD_TILE);
    this.playerShadow.setPosition((this.miner.x + 0.5) * WORLD_TILE, (this.miner.y + 0.5) * WORLD_TILE + 9);

    if (moved) {
      this.dustEmitter?.start();
    } else {
      this.dustEmitter?.stop();
    }
  }

  private handleActions(): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.mineAtMiner();
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) {
      if (this.miner.x === this.world.launchZone.x && this.miner.y === this.world.launchZone.y) {
        const launch = launchCargo(this.miner, this.cannonSeconds);
        this.cannonSeconds = launch.cannonSeconds;
        if (launch.result.launched) {
          audio.play('launch');
          this.triggerLaunchVisual();
          this.updateHud();
        }
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) {
      if (activateEmp(this.miner)) {
        audio.play('emp');
        this.empRing = this.add.graphics();
        this.wl(this.empRing);
        this.empRingRadius = 0;
        for (const sentinel of this.sentinels) {
          const distance = Math.abs(sentinel.x - this.miner.x) + Math.abs(sentinel.y - this.miner.y);
          if (distance <= BALANCE.empRadiusTiles) {
            stunSentinel(sentinel, BALANCE.empStunTicks);
          }
        }
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      audio.play('click');
      this.scene.launch('pause');
      this.scene.pause();
    }
  }

  private triggerLaunchVisual(): void {
    if (!this.rocketSprite) {
      return;
    }
    this.spawnBurst(this.rocketSprite.x, this.rocketBaseY + 14, 0xf0a23a);
    if (this.reducedMotion) {
      return;
    }
    this.rocketSprite.setAlpha(1).setY(this.rocketBaseY);
    this.tweens.add({
      targets: this.rocketSprite,
      y: this.rocketBaseY - 110,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.rocketSprite?.setY(this.rocketBaseY).setAlpha(1);
      },
    });
  }

  private spawnBurst(x: number, y: number, color: number): void {
    if (this.reducedMotion) {
      return;
    }
    const emitter = this.add.particles(x, y, 'dot', {
      speed: { min: 40, max: 95 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      lifespan: 350,
      quantity: 10,
      tint: color,
      emitting: false,
    });
    this.wl(emitter);
    emitter.explode(10);
    this.time.delayedCall(420, () => emitter.destroy());
  }

  private ensureSentinels(): void {
    const activeTypes = getActiveSentinelTypes(this.miner.heat);

    for (const type of activeTypes) {
      if (this.sentinels.some((sentinel) => sentinel.type === type)) {
        continue;
      }

      const spawn = this.world.enemySpawnPoints[type === 'TESLA' ? 0 : 1];
      const sentinel = createSentinel(type, spawn.x, spawn.y);
      this.sentinels.push(sentinel);

      const shadow = this.addShadow((spawn.x + 0.5) * WORLD_TILE, (spawn.y + 0.5) * WORLD_TILE, 8, 4);
      this.sentinelShadows.set(sentinel, shadow);

      const sprite = this.add
        .image((spawn.x + 0.5) * WORLD_TILE, (spawn.y + 0.5) * WORLD_TILE, type === 'TESLA' ? 'teslaSentinel' : 'mechSentinel')
        .setDepth(8);
      this.wl(sprite);
      this.sentinelSprites.set(sentinel, sprite);

      const glow = this.add.circle(sprite.x, sprite.y, 14, type === 'TESLA' ? 0x3fd0ff : 0xff5d68, 0);
      this.wl(glow);
      this.sentinelGlows.set(sentinel, glow);

      if (type === 'MECH') {
        sprite.setAlpha(0.35);
        const warn = this.add
          .text(sprite.x, sprite.y - 24, 'MECH INBOUND', {
            fontFamily: 'monospace',
            fontSize: '10px',
            fontStyle: 'bold',
            color: '#ff5d68',
          })
          .setOrigin(0.5);
        this.wl(warn);
        this.sentinelWarnings.set(sentinel, warn);
        if (!this.reducedMotion) {
          this.tweens.add({ targets: warn, alpha: { from: 1, to: 0.2 }, duration: 380, yoyo: true, repeat: -1 });
        }
      } else {
        audio.play('sentinelAlert');
        if (!this.reducedMotion) {
          this.tweens.add({
            targets: glow,
            alpha: { from: 0.12, to: 0.32 },
            radius: { from: 12, to: 17 },
            duration: 650,
            yoyo: true,
            repeat: -1,
          });
        } else {
          glow.setAlpha(0.2);
        }
      }
    }

    for (const sentinel of [...this.sentinels]) {
      if (!activeTypes.includes(sentinel.type)) {
        this.sentinelSprites.get(sentinel)?.destroy();
        this.sentinelGlows.get(sentinel)?.destroy();
        this.sentinelWarnings.get(sentinel)?.destroy();
        this.sentinelShadows.get(sentinel)?.destroy();
        this.sentinelSprites.delete(sentinel);
        this.sentinelGlows.delete(sentinel);
        this.sentinelWarnings.delete(sentinel);
        this.sentinelShadows.delete(sentinel);
        this.sentinels = this.sentinels.filter((entry) => entry !== sentinel);
      }
    }
  }

  private updateSentinels(): void {
    for (const sentinel of this.sentinels) {
      const wasActive = sentinel.active;
      tickSentinel(sentinel);

      if (!wasActive && sentinel.active) {
        const sprite = this.sentinelSprites.get(sentinel);
        sprite?.setAlpha(1);
        this.sentinelWarnings.get(sentinel)?.destroy();
        this.sentinelWarnings.delete(sentinel);
        const glow = this.sentinelGlows.get(sentinel);
        if (glow) {
          if (!this.reducedMotion) {
            this.tweens.add({
              targets: glow,
              alpha: { from: 0.14, to: 0.34 },
              radius: { from: 14, to: 20 },
              duration: 750,
              yoyo: true,
              repeat: -1,
            });
          } else {
            glow.setAlpha(0.22);
          }
        }
        audio.play('sentinelAlert');
      }

      const step = getSentinelStep(sentinel, this.miner.x, this.miner.y, Math.random());
      if (step.dx !== 0 || step.dy !== 0) {
        const next = moveOnGrid(sentinel.x, sentinel.y, step.dx, step.dy, this.world.walls);
        sentinel.x = next.x;
        sentinel.y = next.y;
        const sprite = this.sentinelSprites.get(sentinel);
        const nx = (sentinel.x + 0.5) * WORLD_TILE;
        const ny = (sentinel.y + 0.5) * WORLD_TILE;
        sprite?.setPosition(nx, ny);
        if (step.dx !== 0) {
          sprite?.setFlipX(step.dx < 0);
        }
        this.sentinelGlows.get(sentinel)?.setPosition(nx, ny);
        this.sentinelWarnings.get(sentinel)?.setPosition(nx, ny - 24);
        this.sentinelShadows.get(sentinel)?.setPosition(nx, ny + 9);
      }

      const sprite = this.sentinelSprites.get(sentinel);
      if (sprite && sentinel.stunTicks > 0) {
        sprite.setAlpha(sprite.alpha > 0.6 ? 0.4 : 0.9);
      } else if (sprite && sentinel.active) {
        sprite.setAlpha(1);
      }

      if (sentinel.x === this.miner.x && sentinel.y === this.miner.y) {
        const before = this.miner.health;
        applySentinelCollision(sentinel, this.miner);
        if (this.miner.health < before) {
          audio.play('damage');
          if (!this.reducedMotion) {
            this.cameras.main.shake(120, 0.004);
          }
        }
      }
    }
  }

  private mineAtMiner(): void {
    const ore = this.world.ores.find(
      (deposit) => deposit.active && deposit.x === this.miner.x && deposit.y === this.miner.y,
    );
    if (!ore) {
      return;
    }

    const mined = mineOre(this.miner, ore.type);
    if (mined > 0) {
      ore.active = false;
      audio.play('mine');
      this.spawnBurst((ore.x + 0.5) * WORLD_TILE, (ore.y + 0.5) * WORLD_TILE, ORE_GLOW[ore.type]);

      const sprite = this.oreSprites.get(ore.id);
      const glow = this.oreGlows.get(ore.id);
      const shadow = this.oreShadows.get(ore.id);
      const targets = [sprite, glow].filter(Boolean) as Phaser.GameObjects.GameObject[];
      if (targets.length > 0) {
        this.tweens.add({
          targets,
          alpha: 0,
          scale: 0.3,
          duration: 200,
          onComplete: () => {
            sprite?.destroy();
            glow?.destroy();
          },
        });
      }
      if (shadow) {
        this.tweens.add({ targets: shadow, alpha: 0, duration: 200, onComplete: () => shadow.destroy() });
      }
      this.oreSprites.delete(ore.id);
      this.oreGlows.delete(ore.id);
      this.oreShadows.delete(ore.id);
      this.updateHud();
    }
  }

  private updateEmpRing(delta: number): void {
    if (!this.empRing) {
      return;
    }
    this.empRingRadius += delta * (this.reducedMotion ? 0.16 : 0.1);
    const alpha = Math.max(0, 1 - this.empRingRadius / 170);
    this.empRing.clear();
    this.empRing.lineStyle(4, 0x7fe7ff, alpha);
    this.empRing.strokeCircle(
      (this.miner.x + 0.5) * WORLD_TILE,
      (this.miner.y + 0.5) * WORLD_TILE,
      this.empRingRadius,
    );
    if (this.empRingRadius >= 170) {
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
