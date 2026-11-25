import Phaser from 'phaser';
import { sfx } from '../audio';
import { AST_R, VARIANTS, type Sz } from '../art';
import {
  CAMPAIGN_OBJECTIVES,
  DISCOVERY_SITES,
  ORES,
  ORE_IDS,
  SECTORS,
  UPGRADES,
  WEAPONS,
  type OreId,
  type SectorDef,
  type UpgradeId,
  type DiscoverySite,
} from '../data';
import { createMarket, priceOf, stepMarket, type MarketState } from '../market';
import {
  addEarnings,
  buyUpgrade,
  campaignObjectiveComplete,
  campaignRequirementsMet,
  cargoTotal,
  droneUpkeepPerSecond,
  emptyCargo,
  makeContract,
  persist,
  objectiveProgress,
  recordCampaignProgress,
  recordDiscovery,
  refuelCost,
  recordDailyProgress,
  repairCost,
  refreshUnlocks,
  resolveContracts,
  statsFor,
  type Cargo,
  type Contract,
  type SaveData,
  type ShipStats,
} from '../progress';
import { pickWeighted } from '../rng';
import {
  applyGameSettings,
  closeOverlay,
  closeShop,
  hud,
  money,
  openShop,
  shopOpen,
  showDiscoveryLog,
  showOverlay,
  showSettings,
  type ShopApi,
} from '../ui';
import { loadSettings, saveSettings, type ControlAction, type GameSettings } from '../settings';
import { session } from '../session';
import { mountTouchControls, type TouchControls } from '../touch';

type Spr = Phaser.Physics.Arcade.Sprite;
type Body = Phaser.Physics.Arcade.Body;
type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

interface Rock extends Spr {
  ore: OreId;
  sz: Sz;
  hp: number;
}
interface RuntimeDiscoverySite extends DiscoverySite {
  worldX: number;
  worldY: number;
}
interface DiscoveryView {
  icon: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Arc;
}

interface Planet {
  x: number;
  y: number;
  radius: number;
  gravity: number;
}
interface Chunk extends Spr {
  ore: OreId;
  age: number;
}
interface Bullet extends Spr {
  life: number;
  dmg: number;
}
interface EBullet extends Spr {
  life: number;
  dmg: number;
}
interface Pirate extends Spr {
  kind: PirateKind;
  hp: number;
  mode: 'attack' | 'flee';
  fireCd: number;
  fleeT: number;
  loot: Cargo;
  strafe: number;
  ramCd: number;
}
type PirateKind = 'raider' | 'interceptor' | 'bomber';

const PIRATE_TYPES: Record<
  PirateKind,
  { texture: string; hp: number; speed: number; accel: number; shotDamage: number; shotSpeed: number; fireDelay: number; range: number; radius: number }
> = {
  raider: { texture: 'pirate', hp: 1, speed: 240, accel: 1, shotDamage: 6, shotSpeed: 380, fireDelay: 1.5, range: 580, radius: 16 },
  interceptor: { texture: 'pirate_interceptor', hp: 0.72, speed: 360, accel: 1.28, shotDamage: 5, shotSpeed: 430, fireDelay: 1.05, range: 620, radius: 14 },
  bomber: { texture: 'pirate_bomber', hp: 1.65, speed: 180, accel: 0.72, shotDamage: 11, shotSpeed: 310, fireDelay: 2.2, range: 760, radius: 20 },
};
interface Drone extends Spr {
  hp: number;
  target: Rock | null;
  beam: number;
  shotCd: number;
  idx: number;
}
interface Debris extends Spr {
  hp: number;
}
interface Boss extends Spr {
  hp: number;
  max: number;
  fireCd: number;
  ringCd: number;
  spawnCd: number;
}

const AST: Record<Sz, { hp: number; mass: number; drop: number; next: Sz | null; hit: number }> = {
  L: { hp: 70, mass: 8, drop: 2, next: 'M', hit: 1.2 },
  M: { hp: 34, mass: 3, drop: 1, next: 'S', hit: 0.9 },
  S: { hp: 16, mass: 1, drop: 2, next: null, hit: 0.55 },
};

const SAFE_R = 270;
const DOCK_R = 200;
const GATE_R = 150;
const DISCOVERY_INTERACT_R = 110;
const WELL_R = 460;
const PLANET_GRAVITY_R = 820;
const FONT = 'Bahnschrift, "Segoe UI", system-ui, sans-serif';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class PlayScene extends Phaser.Scene {
  private save!: SaveData;
  private sector!: SectorDef;
  private stats!: ShipStats;
  private S = 3600;
  private cx = 1800;
  private cy = 1800;

  private market!: MarketState;
  private offers: Contract[] = [];
  private active: Contract[] = [];

  private player!: Spr;
  private flame!: Phaser.GameObjects.Image;
  private hull = 100;
  private shield = 0;
  private shieldRecharge = 0;
  private fuel = 100;
  private cargo: Cargo = emptyCargo();

  private rocks!: Phaser.Physics.Arcade.Group;
  private chunks!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private ebullets!: Phaser.Physics.Arcade.Group;
  private pirates!: Phaser.Physics.Arcade.Group;
  private drones!: Phaser.Physics.Arcade.Group;
  private debris!: Phaser.Physics.Arcade.Group;
  private bosses!: Phaser.Physics.Arcade.Group;

  private station!: Phaser.GameObjects.Image;
  private turretSpr!: Phaser.GameObjects.Image;
  private gate!: Phaser.GameObjects.Image;
  private gateGlow!: Phaser.GameObjects.Image;
  private gx = 0;
  private gy = 0;
  private wells: { x: number; y: number }[] = [];
  private planets: Planet[] = [];
  private discoverySites: RuntimeDiscoverySite[] = [];
  private discoveryViews = new Map<string, DiscoveryView>();
  private wellGfx!: Phaser.GameObjects.Graphics;
  private planetGfx!: Phaser.GameObjects.Graphics;
  private beamGfx!: Phaser.GameObjects.Graphics;
  private threatGfx!: Phaser.GameObjects.Graphics;
  private stars: Phaser.GameObjects.TileSprite[] = [];

  private fxRock!: Emitter;
  private fxFire!: Emitter;
  private fxSpark!: Emitter;
  private fxOre!: Emitter;
  private fxRed!: Emitter;
  private exhaust!: Emitter;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private settings!: GameSettings;
  private touch!: TouchControls;
  private mm!: CanvasRenderingContext2D;
  private mmTick = 0;

  private clock = 0;
  private t = 0;
  private docked = false;
  private dead = false;
  private paused = false;
  private warping = false;
  private fireCd = 0;
  private hitCd = 0;
  private pickupMsgCd = 0;
  private marketTick = 0;
  private spawnTick = 0;
  private nextPirate = 60;
  private nextFlare = Infinity;
  private nextStorm = Infinity;
  private flare = { phase: 'idle' as 'idle' | 'warn' | 'active', t: 0, dmgCd: 0 };
  private storm = { phase: 'idle' as 'idle' | 'warn' | 'active', t: 0, dir: 0, spawnCd: 0 };
  private turretCd = 0;
  private boss: Boss | null = null;
  private goalAnnounced = false;
  private objectiveAnnounced = false;
  private touchInteractHeld = false;
  private rocksBroken = 0;
  private piratesDefeated = 0;
  private oreCollected = 0;
  private sectorCredits = 0;
  private damageTaken = 0;
  private hazardWarnings = 0;
  private flashMsg: { text: string; kind: 'warn' | 'danger' | 'good'; t: number } | null = null;
  private deadBanner = false;
  private cloudErrorHandler = (): void => hud.toast('Cloud sync failed; your local save is still available.', 'bad');
  private cloudUpdateHandler = (): void => hud.toast('A newer cloud save was synchronized.', 'info');
  private settingsUpdateHandler = (): void => {
    this.settings = loadSettings();
    applyGameSettings(this.settings);
  };
  private discoveryLogHandler = (): void => {
    if (this.paused || this.docked || this.dead || this.warping) return;
    this.setPaused(true);
    showDiscoveryLog(this.save, () => this.setPaused(false));
  };

  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private blurHandler = (): void => {
    if (!this.paused && !this.docked && !this.dead && !this.warping) this.setPaused(true);
  };

  constructor() {
    super('Play');
  }

  create(): void {
    this.save = session.save;
    this.sector = SECTORS[this.save.sector];
    this.stats = statsFor(this.save.levels, this.save.selectedPilot);
    this.S = this.sector.size;
    this.cx = this.S / 2;
    this.cy = this.S / 2;
    this.gx = this.cx + 720;
    this.gy = this.cy;
    this.discoverySites = DISCOVERY_SITES
      .filter((site) => site.sector === this.save.sector)
      .map((site) => ({ ...site, worldX: site.x * this.S, worldY: site.y * this.S }));
    this.discoveryViews.clear();
    this.clock = 0;
    this.t = 0;
    this.docked = false;
    this.dead = false;
    this.paused = false;
    this.warping = false;
    this.fireCd = 0;
    this.hitCd = 0;
    this.nextPirate = this.sector.pirateEvery * 0.7;
    this.nextFlare = this.sector.flareEvery ? this.sector.flareEvery * rnd(0.6, 1) : Infinity;
    this.nextStorm = this.sector.stormEvery ? this.sector.stormEvery * rnd(0.6, 1) : Infinity;
    this.flare = { phase: 'idle', t: 0, dmgCd: 0 };
    this.storm = { phase: 'idle', t: 0, dir: 0, spawnCd: 0 };
    this.boss = null;
    this.goalAnnounced = campaignRequirementsMet(this.save);
    this.objectiveAnnounced = campaignObjectiveComplete(this.save);
    this.rocksBroken = 0;
    this.piratesDefeated = 0;
    this.oreCollected = 0;
    this.sectorCredits = 0;
    this.damageTaken = 0;
    this.hazardWarnings = 0;
    this.flashMsg = null;
    this.deadBanner = false;
    this.wells = [];
    this.planets = [];
    this.hull = this.stats.hullMax;
    this.shield = this.stats.shieldMax;
    this.shieldRecharge = 0;
    this.fuel = this.stats.fuelMax;
    this.cargo = { ...emptyCargo(), ...session.cargo };
    this.market = createMarket(Math.random);
    this.offers = [0, 1, 2].map(() => makeContract(this.save.sector, 0, Math.random));
    this.active = [];

    this.physics.world.setBounds(0, 0, this.S, this.S);
    this.cameras.main.setBounds(0, 0, this.S, this.S);
    this.cameras.main.setBackgroundColor(0x07090c);
    this.cameras.main.fadeIn(500, 0, 0, 0);
    this.input.mouse?.disableContextMenu();

    this.buildBackground();
    this.buildGroups();
    this.buildStation();
    this.buildDiscoverySites();
    this.buildFx();
    this.spawnWells();
    this.spawnPlanets();
    this.populate();
    this.buildPlayer();
    this.buildColliders();
    this.ensureDrones();

    const kb = this.input.keyboard!;
    const keyNames = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE', 'SHIFT', 'ESC'];
    this.keys = kb.addKeys(keyNames.join(',')) as Record<string, Phaser.Input.Keyboard.Key>;
    this.settings = loadSettings();
    applyGameSettings(this.settings);
    this.touch = mountTouchControls();
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('blur', this.blurHandler);
    window.addEventListener('asteroid-breaker-settings-changed', this.settingsUpdateHandler);
    window.addEventListener('rockbreaker-cloud-save-error', this.cloudErrorHandler);
    window.addEventListener('rockbreaker-cloud-save-updated', this.cloudUpdateHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.keyHandler);
      window.removeEventListener('blur', this.blurHandler);
      window.removeEventListener('asteroid-breaker-settings-changed', this.settingsUpdateHandler);
      window.removeEventListener('rockbreaker-cloud-save-error', this.cloudErrorHandler);
      window.removeEventListener('rockbreaker-cloud-save-updated', this.cloudUpdateHandler);
      document.getElementById('discovery-log')?.removeEventListener('click', this.discoveryLogHandler);
      closeShop();
      closeOverlay();
      this.touch.destroy();
      hud.hide();
      sfx.thrust(0);
    });

    hud.show();
    this.mm = hud.minimap();
    document.getElementById('discovery-log')?.addEventListener('click', this.discoveryLogHandler);
    if (this.settings.showTutorial) this.showFlightSchool();
    hud.toast(`Sector ${this.save.sector + 1}: ${this.sector.name}`, 'info');
    if (this.save.sector === 0 && this.save.lifetime === 0) {
      hud.toast('Shoot rocks, grab the ore, then press E at the station to sell.', 'info');
    }
    if (import.meta.env.DEV) (window as unknown as { __rb: PlayScene }).__rb = this;
  }

  private buildBackground(): void {
    this.stars = ['stars1', 'stars2', 'stars3'].map((k, i) =>
      this.add
        .tileSprite(0, 0, 1280, 720, k)
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(-20 + i),
    );
    const g = this.add.graphics().setDepth(-10);
    g.lineStyle(1, 0x1b222a, 0.55);
    for (let x = 0; x <= this.S; x += 400) g.lineBetween(x, 0, x, this.S);
    for (let y = 0; y <= this.S; y += 400) g.lineBetween(0, y, this.S, y);
    g.lineStyle(10, 0x5a2a24, 1);
    g.strokeRect(0, 0, this.S, this.S);
    g.lineStyle(2, 0xe5483a, 0.7);
    g.strokeRect(-9, -9, this.S + 18, this.S + 18);
    // station safe zone, dashed
    const sz = this.add.graphics().setDepth(-6);
    sz.lineStyle(3, 0xe8832a, 0.35);
    const segs = 60;
    for (let i = 0; i < segs; i += 2) {
      sz.beginPath();
      sz.arc(this.cx, this.cy, SAFE_R, (i / segs) * Math.PI * 2, ((i + 1) / segs) * Math.PI * 2);
      sz.strokePath();
    }
    this.wellGfx = this.add.graphics().setDepth(-5);
    this.planetGfx = this.add.graphics().setDepth(-4);
    this.beamGfx = this.add.graphics().setDepth(7);
    this.threatGfx = this.add.graphics().setDepth(7);
  }

  private buildGroups(): void {
    this.rocks = this.physics.add.group();
    this.chunks = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.ebullets = this.physics.add.group();
    this.pirates = this.physics.add.group();
    this.drones = this.physics.add.group();
    this.debris = this.physics.add.group();
    this.bosses = this.physics.add.group();
  }

  private buildStation(): void {
    this.station = this.add.image(this.cx, this.cy, 'station').setDepth(0);
    this.turretSpr = this.add
      .image(this.cx, this.cy, 'turret')
      .setOrigin(0.275, 0.5)
      .setDepth(1)
      .setVisible(this.save.levels.turret > 0);
    this.gateGlow = this.add.image(this.gx, this.gy, 'gateglow').setDepth(-1).setAlpha(0).setScale(0.9);
    this.gate = this.add.image(this.gx, this.gy, 'gate').setDepth(0);
    if (this.sector.boss) {
      this.gate.setVisible(false);
      this.gateGlow.setVisible(false);
    }
  }

  private buildDiscoverySites(): void {
    for (const site of this.discoverySites) {
      const found = this.save.discoveries.includes(site.id);
      const color = site.kind === 'wreck' ? 0x9ca9ad : site.kind === 'cache' ? 0xe7a849 : 0x64d4d7;
      const ring = this.add.circle(site.worldX, site.worldY, 62, color, 0.06)
        .setStrokeStyle(2, color, found ? 0.28 : 0.8)
        .setDepth(1);
      const icon = this.add
        .image(site.worldX, site.worldY, `discovery_${site.kind}`)
        .setDepth(2)
        .setAlpha(found ? 0.42 : 1)
        .setScale(site.kind === 'wreck' ? 1 : 0.92);
      const label = this.add
        .text(site.worldX, site.worldY + 45, found ? site.name : 'UNKNOWN SIGNAL', {
          fontFamily: FONT,
          fontSize: '13px',
          color: found ? '#d0d0d0' : '#f1d27b',
          stroke: '#07090c',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(3);
      if (!found) {
        this.tweens.add({ targets: ring, alpha: 0.35, yoyo: true, repeat: -1, duration: 900 });
      } else {
        ring.setAlpha(0.3);
      }
      this.discoveryViews.set(site.id, { icon, label, ring });
    }
  }

  private nearDiscovery(x: number, y: number, distance: number): boolean {
    return this.discoverySites.some((site) => Phaser.Math.Distance.Between(x, y, site.worldX, site.worldY) < distance);
  }

  private updatePlanets(dt: number): void {
    for (const planet of this.planets) {
      const pull = (obj: Spr, scale: number): number => {
        const dx = planet.x - obj.x;
        const dy = planet.y - obj.y;
        const distance = Math.hypot(dx, dy);
        if (distance > planet.gravity || distance < 1) return distance;
        const strength = 820 * Math.pow(1 - distance / planet.gravity, 1.2) * scale;
        const body = obj.body as Body;
        body.velocity.x += (dx / distance) * strength * dt;
        body.velocity.y += (dy / distance) * strength * dt;
        return distance;
      };
      if (!this.dead) {
        const distance = pull(this.player, 1);
        if (distance <= planet.radius + 14) {
          hud.toast('Planetary gravity crushed your ship.', 'bad');
          this.hurtPlayer(this.stats.hullMax + this.stats.shieldMax + 1);
        }
      }
      for (const r of this.rocks.getChildren() as Rock[]) pull(r, 0.7);
      for (const pr of this.pirates.getChildren() as Pirate[]) pull(pr, 0.55);
      for (const c of this.chunks.getChildren() as Chunk[]) pull(c, 0.5);
      for (const d of this.drones.getChildren() as Drone[]) pull(d, 0.35);
    }
  }

  private buildFx(): void {
    const mk = (tint: number, speed: number, life: number, scale: number): Emitter =>
      this.add
        .particles(0, 0, 'spark', {
          emitting: false,
          lifespan: { min: life * 0.5, max: life },
          speed: { min: speed * 0.2, max: speed },
          scale: { start: scale, end: 0 },
          rotate: { min: 0, max: 360 },
          tint,
        })
        .setDepth(9);
    this.fxRock = mk(0x9a9288, 230, 800, 1.5);
    this.fxFire = mk(0xffa23a, 260, 600, 1.6);
    this.fxSpark = mk(0xffe08a, 170, 300, 1);
    this.fxOre = mk(0xffffff, 200, 700, 1.4);
    this.fxRed = mk(0xe5483a, 200, 500, 1.3);
    this.exhaust = this.add
      .particles(0, 0, 'smoke', {
        emitting: false,
        lifespan: 380,
        speed: { min: 8, max: 40 },
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.45, end: 0 },
        tint: 0xffc070,
      })
      .setDepth(4);
  }

  private spawnWells(): void {
    for (let n = 0; n < this.sector.wells; n++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = rnd(500, this.S - 500);
        const y = rnd(500, this.S - 500);
        if (Phaser.Math.Distance.Between(x, y, this.cx, this.cy) < 900) continue;
        if (Phaser.Math.Distance.Between(x, y, this.gx, this.gy) < 700) continue;
        if (this.nearDiscovery(x, y, 650)) continue;
        if (this.wells.some((w) => Phaser.Math.Distance.Between(x, y, w.x, w.y) < 1100)) continue;
        this.wells.push({ x, y });
        break;
      }
    }
  }

  private spawnPlanets(): void {
    for (let n = 0; n < this.sector.planets; n++) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const x = rnd(600, this.S - 600);
        const y = rnd(600, this.S - 600);
        const radius = rnd(100, 145);
        if (Phaser.Math.Distance.Between(x, y, this.cx, this.cy) < 1050) continue;
        if (Phaser.Math.Distance.Between(x, y, this.gx, this.gy) < 850) continue;
        if (this.nearDiscovery(x, y, 900)) continue;
        if (this.wells.some((w) => Phaser.Math.Distance.Between(x, y, w.x, w.y) < 1250)) continue;
        if (this.planets.some((p) => Phaser.Math.Distance.Between(x, y, p.x, p.y) < radius + p.radius + 1100)) continue;
        this.planets.push({ x, y, radius, gravity: PLANET_GRAVITY_R });
        const texture = `planet_${Math.floor(Math.random() * 3)}`;
        this.add.image(x, y, texture).setScale((radius * 2) / 256).setDepth(0);
        this.planetGfx.lineStyle(2, 0x86a9c9, 0.15);
        this.planetGfx.strokeCircle(x, y, PLANET_GRAVITY_R);
        this.planetGfx.lineStyle(2, 0x86a9c9, 0.1);
        this.planetGfx.strokeCircle(x, y, radius + 80);
        break;
      }
    }
  }

  private populate(): void {
    const n = this.sector.asteroids;
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      const sz: Sz = roll < 0.5 ? 'L' : roll < 0.82 ? 'M' : 'S';
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = rnd(120, this.S - 120);
        const y = rnd(120, this.S - 120);
        if (Phaser.Math.Distance.Between(x, y, this.cx, this.cy) < 520) continue;
        if (Phaser.Math.Distance.Between(x, y, this.gx, this.gy) < 260) continue;
        if (this.nearDiscovery(x, y, 150)) continue;
        if (this.wells.some((w) => Phaser.Math.Distance.Between(x, y, w.x, w.y) < 160)) continue;
        if (this.planets.some((p) => Phaser.Math.Distance.Between(x, y, p.x, p.y) < p.radius + 100)) continue;
        let clear = true;
        for (const r of this.rocks.getChildren() as Rock[]) {
          if (Phaser.Math.Distance.Between(x, y, r.x, r.y) < 150) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        this.spawnRock(x, y, sz, pickWeighted(this.sector.weights, Math.random));
        break;
      }
    }
  }

  private buildPlayer(): void {
    this.player = this.physics.add.sprite(this.cx + 260, this.cy, `ship_${this.save.selectedSkin}`).setDepth(5);
    const b = this.player.body as Body;
    b.setCircle(14, 10, 10);
    b.setCollideWorldBounds(true);
    b.setBounce(0.4);
    b.setDamping(true);
    b.setDrag(0.42);
    b.mass = 2;
    this.flame = this.add.image(0, 0, 'flame').setOrigin(1, 0.5).setDepth(4).setVisible(false);
    this.cameras.main.startFollow(this.player, true, 0.09, 0.09);
    this.cameras.main.centerOn(this.player.x, this.player.y);
  }

  private buildColliders(): void {
    const ph = this.physics;
    ph.add.collider(this.player, this.rocks, (_p, r) => this.onShipRock(r as Rock));
    ph.add.collider(this.rocks, this.rocks);
    ph.add.collider(this.pirates, this.rocks);
    ph.add.collider(this.pirates, this.pirates);
    ph.add.overlap(this.bullets, this.rocks, (b, r) => this.onBulletRock(b as Bullet, r as Rock));
    ph.add.overlap(this.bullets, this.pirates, (b, p) => this.onBulletPirate(b as Bullet, p as Pirate));
    ph.add.overlap(this.bullets, this.bosses, (b, o) => this.onBulletBoss(b as Bullet, o as Boss));
    ph.add.overlap(this.bullets, this.debris, (b, d) => this.onBulletDebris(b as Bullet, d as Debris));
    ph.add.overlap(this.ebullets, this.player, (_p, e) => this.onEBulletPlayer(e as EBullet));
    ph.add.overlap(this.ebullets, this.drones, (d, e) => this.onEBulletDrone(e as EBullet, d as Drone));
    ph.add.overlap(this.debris, this.player, (_p, d) => this.onDebrisPlayer(d as Debris));
    ph.add.overlap(this.debris, this.drones, (d, x) => this.onDebrisDrone(x as Debris, d as Drone));
    ph.add.overlap(this.debris, this.pirates, (p, x) => this.onDebrisPirate(x as Debris, p as Pirate));
    ph.add.overlap(this.bosses, this.player, () => this.onBossRam());
  }

  private spawnRock(x: number, y: number, sz: Sz, ore: OreId, vx?: number, vy?: number): Rock {
    const v = Math.floor(Math.random() * VARIANTS);
    const r = this.rocks.create(x, y, `ast_${ore}_${sz}_${v}`) as Rock;
    r.ore = ore;
    r.sz = sz;
    r.hp = AST[sz].hp * (1 + 0.15 * this.save.sector);
    r.setDepth(1);
    const rad = AST_R[sz] * 0.84;
    const half = r.width / 2;
    const body = r.body as Body;
    body.setCircle(rad, half - rad, half - rad);
    body.setBounce(0.85);
    body.setCollideWorldBounds(true);
    body.setMaxVelocity(300, 300);
    body.mass = AST[sz].mass;
    if (vx === undefined || vy === undefined) {
      const a = rnd(0, Math.PI * 2);
      const sp = sz === 'L' ? rnd(22, 62) : rnd(36, 92);
      vx = Math.cos(a) * sp;
      vy = Math.sin(a) * sp;
    }
    r.setVelocity(vx, vy);
    r.setAngularVelocity(rnd(-30, 30));
    r.setAngle(rnd(0, 360));
    return r;
  }

  private spawnChunk(x: number, y: number, ore: OreId): void {
    const list = this.chunks.getChildren();
    if (list.length > 150) list[0].destroy();
    const c = this.chunks.create(x, y, `chunk_${ore}`) as Chunk;
    c.ore = ore;
    c.age = 0;
    c.setDepth(2);
    const b = c.body as Body;
    b.setCircle(9, 3, 3);
    b.setCollideWorldBounds(true);
    b.setBounce(0.5);
    b.setDamping(true);
    b.setDrag(0.3);
    b.setMaxVelocity(700, 700);
    const a = rnd(0, Math.PI * 2);
    const sp = rnd(50, 150);
    c.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp);
    c.setAngularVelocity(rnd(-200, 200));
  }

  private spawnPirate(): void {
    const p0 = this.player;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(900, 1150);
      x = Phaser.Math.Clamp(p0.x + Math.cos(a) * d, 80, this.S - 80);
      y = Phaser.Math.Clamp(p0.y + Math.sin(a) * d, 80, this.S - 80);
      if (Phaser.Math.Distance.Between(x, y, p0.x, p0.y) > 700) break;
    }
    const roll = Math.random();
    const kind: PirateKind = this.save.sector < 1 ? 'raider' : roll < 0.34 ? 'interceptor' : roll < 0.58 ? 'bomber' : 'raider';
    const type = PIRATE_TYPES[kind];
    const pr = this.pirates.create(x, y, type.texture) as Pirate;
    pr.kind = kind;
    pr.hp = (40 + 22 * this.save.sector) * type.hp;
    pr.mode = 'attack';
    pr.fireCd = rnd(1.5, 2.5);
    pr.fleeT = 0;
    pr.loot = emptyCargo();
    pr.strafe = Math.random() < 0.5 ? 1 : -1;
    pr.ramCd = 0;
    pr.setDepth(4);
    const b = pr.body as Body;
    b.setCircle(type.radius, pr.width / 2 - type.radius, pr.height / 2 - type.radius);
    b.setCollideWorldBounds(true);
    b.setBounce(0.5);
    b.setDamping(true);
    b.setDrag(0.5);
    b.setMaxVelocity(type.speed + 12 * this.save.sector, type.speed + 12 * this.save.sector);
    b.mass = 2;
    this.warpRing(x, y, 0xe5483a);
    sfx.pirate();
    sfx.alarm();
    hud.toast('Pirates on scope - protect your cargo.', 'bad');
  }

  private spawnDrone(idx: number): void {
    const d = this.drones.create(this.cx + Math.cos(idx) * 120, this.cy + Math.sin(idx) * 120, 'drone') as Drone;
    d.hp = 45;
    d.target = null;
    d.beam = 0;
    d.shotCd = rnd(0, 0.6);
    d.idx = idx;
    d.setDepth(3);
    const b = d.body as Body;
    b.setCircle(9, 5, 5);
    b.setCollideWorldBounds(true);
  }

  private ensureDrones(): void {
    const have = this.drones.getChildren().length;
    for (let i = have; i < this.stats.drones; i++) this.spawnDrone(i);
  }

  private spawnBoss(): void {
    const x = this.cx;
    const y = 360;
    const b = this.bosses.create(x, y, 'dread') as Boss;
    const hp = 1800;
    b.hp = hp;
    b.max = hp;
    b.fireCd = 2.5;
    b.ringCd = 6;
    b.spawnCd = 14;
    b.setDepth(4);
    const body = b.body as Body;
    body.setCircle(96, b.width / 2 - 96 + 20, b.height / 2 - 96);
    body.setCollideWorldBounds(true);
    this.boss = b;
    sfx.boss();
    sfx.alarm();
    this.shake(900, 0.008);
    this.flash('THE DREADNOUGHT HAS ARRIVED', 'danger', 7);
    hud.toast('Boss inbound. Destroy the Dreadnought to clear the Maw.', 'bad');
  }

  private warpRing(x: number, y: number, color: number): void {
    const c = this.add.circle(x, y, 10, color, 0).setStrokeStyle(3, color, 0.9).setDepth(9);
    this.tweens.add({ targets: c, scale: 7, alpha: 0, duration: 600, onComplete: () => c.destroy() });
  }

  private burst(em: Emitter, x: number, y: number, n: number, tint?: number): void {
    if (tint !== undefined) em.setParticleTint(tint);
    em.explode(n, x, y);
  }

  private explosion(x: number, y: number, size: number): void {
    const n = Math.round(10 * size);
    this.burst(this.fxFire, x, y, n);
    this.burst(this.fxRock, x, y, n);
    const c = this.add.circle(x, y, 8, 0xffa23a, 0).setStrokeStyle(3, 0xffd27a, 0.9).setDepth(9);
    this.tweens.add({ targets: c, scale: size * 4, alpha: 0, duration: 420, onComplete: () => c.destroy() });
  }

  private floatText(x: number, y: number, msg: string, color = '#f2b53d'): void {
    const t = this.add
      .text(x, y, msg, { fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color, stroke: '#07090c', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(20);
    this.tweens.add({ targets: t, y: y - 38, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  private flash(text: string, kind: 'warn' | 'danger' | 'good', secs: number): void {
    this.flashMsg = { text, kind, t: secs };
  }

  private earn(amount: number): void {
    addEarnings(this.save, amount);
    this.sectorCredits += amount;
    this.updateCampaignProgress();
  }

  private updateCampaignProgress(): void {
    if (!this.objectiveAnnounced && campaignObjectiveComplete(this.save)) {
      this.objectiveAnnounced = true;
      const reward = CAMPAIGN_OBJECTIVES[this.save.sector].reward;
      hud.toast(`Sector objective complete. Bonus: ${money(reward)}.`, 'good');
      this.earn(reward);
    }
    if (!this.goalAnnounced && campaignRequirementsMet(this.save)) {
      this.goalAnnounced = true;
      if (!this.sector.boss) {
        this.flash('SECTOR OBJECTIVE + QUOTA COMPLETE - WARP GATE OPEN', 'good', 8);
        hud.toast('The warp gate is open. Dock first, then fly to the gate.', 'good');
        sfx.sell();
      }
    }
  }

  private showFlightSchool(): void {
    this.paused = true;
    this.physics.world.pause();
    this.time.paused = true;
    showOverlay(
      'FLIGHT SCHOOL',
      `Move with ${this.settings.bindings.up}/${this.settings.bindings.left}/${this.settings.bindings.down}/${this.settings.bindings.right}; aim and fire with your mouse or configured fire key.<br>
       ${this.settings.bindings.interact} docks at the station. Recover ore, return to sell and upgrade, then complete both the sector quota and mission objective to open the warp gate.<br>
       Planets and gravity wells are dangerous. Touch pilots can use the on-screen controls.`,
      [
        {
          label: 'Launch',
          primary: true,
          onClick: () => {
            try {
              saveSettings({ ...this.settings, showTutorial: false });
              this.settings.showTutorial = false;
            } catch (error) {
              hud.toast(error instanceof Error ? error.message : 'Tutorial preference could not be saved.', 'bad');
            }
            this.setPaused(false);
          },
        },
      ],
    );
  }

  private droneEarn(ore: OreId, units: number, x: number, y: number): void {
    const value = Math.round(units * priceOf(this.market, ore) * (0.7 + 0.12 * this.save.levels.yield));
    if (value <= 0) return;
    this.earn(value);
    this.floatText(x, y - 14, `+${money(value)}`, '#6fd0ff');
  }

  private autoDeliver(): void {
    const r = resolveContracts(this.cargo, this.active, this.clock);
    this.cargo = r.cargo;
    this.active = r.remaining;
    if (r.payout > 0) {
      this.earn(r.payout);
      sfx.sell();
    }
    for (const c of r.done) hud.toast(`Contract complete: ${c.qty} ${ORES[c.ore].name} for ${money(c.reward)}`, 'good');
    for (const c of r.expired) hud.toast(`Contract expired: ${c.qty} ${ORES[c.ore].name}`, 'bad');
  }

  private hurtPlayer(amount: number, silent = false): void {
    if (this.docked || this.dead || this.warping) return;
    this.damageTaken += amount;
    this.shieldRecharge = 4;
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    this.hull -= amount - absorbed;
    if (!silent) {
      sfx.hurt();
      hud.hurt();
      this.shake(140, 0.006);
      this.burst(this.fxRed, this.player.x, this.player.y, 8);
    }
    if (this.hull <= 0) this.die();
  }

  private die(): void {
    this.dead = true;
    this.hull = 0;
    sfx.explode();
    sfx.thrust(0);
    this.explosion(this.player.x, this.player.y, 3);
    this.shake(500, 0.012);
    this.player.disableBody(true, true);
    this.flame.setVisible(false);
    const lost = cargoTotal(this.cargo);
    this.cargo = emptyCargo();
    const fee = Math.min(this.save.money, Math.round(this.save.money * 0.08 + 25));
    this.save.money -= fee;
    this.deadBanner = true;
    hud.toast(`Ship lost. Salvage crew fee ${money(fee)}${lost ? `, ${lost} ore lost` : ''}.`, 'bad');
    this.time.delayedCall(2800, () => this.respawn());
  }

  private respawn(): void {
    this.dead = false;
    this.deadBanner = false;
    this.hull = this.stats.hullMax;
    this.shield = this.stats.shieldMax;
    this.shieldRecharge = 0;
    this.fuel = this.stats.fuelMax;
    this.player.enableBody(true, this.cx + 260, this.cy, true, true);
    this.player.setVelocity(0, 0);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    persist(this.save);
  }

  private damageRock(r: Rock, dmg: number, by: 'player' | 'drone' | 'turret'): void {
    r.hp -= dmg;
    r.setTintFill(0xffffff);
    this.time.delayedCall(45, () => r.active && r.clearTint());
    this.burst(this.fxRock, r.x, r.y, 4);
    if (by === 'player') sfx.rockHit();
    if (r.hp <= 0) this.breakRock(r, by);
  }

  private breakRock(r: Rock, by: 'player' | 'drone' | 'turret'): void {
    const { x, y, sz, ore } = r;
    this.rocksBroken++;
    r.destroy();
    this.explosion(x, y, sz === 'L' ? 1.6 : sz === 'M' ? 1 : 0.6);
    this.burst(this.fxOre, x, y, 6, ORES[ore].color);
    sfx.rockBreak(sz);
    if (sz === 'L') this.shake(90, 0.003);
    const def = AST[sz];
    for (let i = 0; i < def.drop; i++) {
      if (by === 'drone') this.droneEarn(ore, 1, x, y);
      else this.spawnChunk(x + rnd(-8, 8), y + rnd(-8, 8), ore);
    }
    if (def.next) {
      const off = AST_R[def.next] * 0.9;
      const a0 = rnd(0, Math.PI * 2);
      for (let k = 0; k < 2; k++) {
        const a = a0 + k * Math.PI;
        const sp = rnd(45, 90);
        this.spawnRock(x + Math.cos(a) * off, y + Math.sin(a) * off, def.next, ore, Math.cos(a) * sp, Math.sin(a) * sp);
      }
    }
  }

  private killPirate(p: Pirate): void {
    const { x, y } = p;
    this.piratesDefeated++;
    p.destroy();
    this.explosion(x, y, 1.5);
    sfx.explode();
    for (const o of ORE_IDS) for (let i = 0; i < p.loot[o]; i++) this.spawnChunk(x + rnd(-10, 10), y + rnd(-10, 10), o);
    const bounty = 40 + 25 * this.save.sector;
    this.earn(bounty);
    recordDailyProgress(this.save, 'pirates', 1);
    recordCampaignProgress(this.save, 'pirates');
    this.updateCampaignProgress();
    this.floatText(x, y - 20, `Bounty ${money(bounty)}`);
    if (cargoTotal(p.loot) > 0) hud.toast('Pirate down. Your stolen ore dropped - grab it.', 'good');
  }

  private killDrone(d: Drone): void {
    this.explosion(d.x, d.y, 1);
    d.destroy();
    hud.toast('A mining drone was destroyed. Replaced when you next dock.', 'bad');
  }

  private onShipRock(r: Rock): void {
    if (this.hitCd > 0 || this.docked || this.dead) return;
    const b = this.player.body as Body;
    const speed = Math.hypot(b.prev.x - b.position.x, b.prev.y - b.position.y) / Math.max(0.001, this.game.loop.delta / 1000);
    const rock = r.body as Body;
    const rel = Math.max(speed, Math.hypot(rock.velocity.x, rock.velocity.y));
    const dmg = Math.max(0, rel - 110) * 0.075 * AST[r.sz].hit;
    if (dmg < 1.5) return;
    this.hitCd = 0.4;
    this.hurtPlayer(Math.min(30, dmg));
    this.burst(this.fxRock, this.player.x, this.player.y, 6);
  }

  private onBulletRock(b: Bullet, r: Rock): void {
    if (!b.active || !r.active) return;
    const dmg = b.dmg;
    const by = b.texture.key === 'tbullet' ? 'turret' : 'player';
    this.burst(this.fxSpark, b.x, b.y, 3);
    b.destroy();
    this.damageRock(r, dmg, by);
  }

  private onBulletPirate(b: Bullet, p: Pirate): void {
    if (!b.active || !p.active) return;
    p.hp -= b.dmg;
    this.burst(this.fxSpark, b.x, b.y, 4);
    b.destroy();
    p.setTintFill(0xffffff);
    this.time.delayedCall(45, () => p.active && p.clearTint());
    sfx.rockHit();
    if (p.hp <= 0) this.killPirate(p);
  }

  private onBulletBoss(b: Bullet, o: Boss): void {
    if (!b.active || !o.active) return;
    o.hp -= b.dmg;
    this.burst(this.fxSpark, b.x, b.y, 3);
    b.destroy();
    o.setTintFill(0xffffff);
    this.time.delayedCall(40, () => o.active && o.clearTint());
    if (o.hp <= 0) this.killBoss(o);
  }

  private onBulletDebris(b: Bullet, d: Debris): void {
    if (!b.active || !d.active) return;
    d.hp -= b.dmg;
    this.burst(this.fxSpark, b.x, b.y, 3);
    b.destroy();
    if (d.hp <= 0) {
      this.burst(this.fxRock, d.x, d.y, 8);
      sfx.rockHit();
      d.destroy();
    }
  }

  private onEBulletPlayer(e: EBullet): void {
    if (!e.active || this.docked || this.dead) return;
    const dmg = e.dmg;
    this.burst(this.fxRed, e.x, e.y, 5);
    e.destroy();
    this.hurtPlayer(dmg);
  }

  private onEBulletDrone(e: EBullet, d: Drone): void {
    if (!e.active || !d.active) return;
    d.hp -= e.dmg;
    this.burst(this.fxRed, e.x, e.y, 4);
    e.destroy();
    if (d.hp <= 0) this.killDrone(d);
  }

  private onDebrisPlayer(d: Debris): void {
    if (!d.active || this.docked || this.dead) return;
    this.burst(this.fxRock, d.x, d.y, 10);
    d.destroy();
    this.hurtPlayer(10 + 3 * this.save.sector);
  }

  private onDebrisDrone(d: Debris, dr: Drone): void {
    if (!d.active || !dr.active) return;
    this.burst(this.fxRock, d.x, d.y, 8);
    d.destroy();
    dr.hp -= 20;
    if (dr.hp <= 0) this.killDrone(dr);
  }

  private onDebrisPirate(d: Debris, p: Pirate): void {
    if (!d.active || !p.active) return;
    this.burst(this.fxRock, d.x, d.y, 8);
    d.destroy();
    p.hp -= 14;
    if (p.hp <= 0) this.killPirate(p);
  }

  private onBossRam(): void {
    if (this.hitCd > 0 || this.docked || this.dead) return;
    this.hitCd = 0.8;
    this.hurtPlayer(22);
    const b = this.boss;
    if (b) {
      const a = Phaser.Math.Angle.Between(b.x, b.y, this.player.x, this.player.y);
      this.player.setVelocity(Math.cos(a) * 520, Math.sin(a) * 520);
    }
  }

  private killBoss(b: Boss): void {
    const { x, y } = b;
    this.boss = null;
    b.destroy();
    sfx.explode();
    for (let i = 0; i < 9; i++) {
      this.time.delayedCall(i * 160, () => {
        this.explosion(x + rnd(-110, 110), y + rnd(-70, 70), rnd(1.6, 2.8));
        sfx.explode();
        this.shake(200, 0.01);
      });
    }
    this.time.delayedCall(1500, () => {
      for (let i = 0; i < 14; i++) this.spawnChunk(x + rnd(-80, 80), y + rnd(-60, 60), 'voidstone');
      this.earn(5000);
      this.save.won = true;
      persist(this.save);
      showOverlay(
        'THE MAW IS CLEAR',
        `The Dreadnought is wreckage and the belt is yours. Lifetime earnings: ${money(this.save.lifetime)}. You can keep mining in free play, or head back to the menu.`,
        [
          { label: 'Keep mining', primary: true, onClick: () => closeOverlay() },
          { label: 'Main menu', onClick: () => this.toMenu() },
        ],
      );
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    const key = e.code === 'Space' ? 'SPACE' : e.code.startsWith('Shift') ? 'SHIFT' :
      e.code === 'Escape' ? 'ESC' : e.key.toUpperCase();
    if (key === this.settings.bindings.mute) {
      const m = sfx.toggleMute();
      hud.toast(m ? 'Sound off' : 'Sound on', 'info');
    } else if (key === this.settings.bindings.interact) {
      this.interact();
    } else if (key === this.settings.bindings.pause) {
      if (shopOpen()) this.launch();
      else this.setPaused(!this.paused);
    }
  }

  private isActionDown(action: ControlAction): boolean {
    return this.keys[this.settings.bindings[action]]?.isDown ?? false;
  }

  private shake(duration: number, intensity: number): void {
    if (this.settings.screenShake && !this.settings.reducedMotion) this.cameras.main.shake(duration, intensity);
  }

  private setPaused(p: boolean): void {
    if (this.dead && p) return;
    this.paused = p;
    if (p) {
      this.physics.world.pause();
      this.time.paused = true;
      sfx.thrust(0);
      showOverlay('PAUSED', 'Take a breath. The belt will wait.', [
        { label: 'Resume', primary: true, onClick: () => this.setPaused(false) },
        { label: 'Settings', onClick: () => showSettings(() => this.setPaused(true)) },
        { label: 'Main menu', onClick: () => this.toMenu() },
      ]);
    } else {
      closeOverlay();
      if (!this.docked) this.physics.world.resume();
      this.time.paused = false;
    }
  }

  private toMenu(): void {
    persist(this.save);
    closeOverlay();
    this.time.paused = false;
    this.physics.world.resume();
    this.scene.start('Menu');
  }

  private interact(): void {
    if (this.paused || this.dead || this.warping) return;
    if (this.docked) {
      this.launch();
      return;
    }
    const p = this.player;
    if (Phaser.Math.Distance.Between(p.x, p.y, this.cx, this.cy) < DOCK_R) {
      this.dock();
      return;
    }
    if (this.gateOpen() && Phaser.Math.Distance.Between(p.x, p.y, this.gx, this.gy) < GATE_R) {
      this.warp();
      return;
    }
    const site = this.nearestUndiscoveredSite(p.x, p.y);
    if (site && Phaser.Math.Distance.Between(p.x, p.y, site.worldX, site.worldY) < DISCOVERY_INTERACT_R) {
      this.recoverDiscovery(site);
    }
  }

  private nearestUndiscoveredSite(x: number, y: number): RuntimeDiscoverySite | undefined {
    return this.discoverySites
      .filter((site) => !this.save.discoveries.includes(site.id))
      .sort((a, b) =>
        Phaser.Math.Distance.Between(x, y, a.worldX, a.worldY) -
        Phaser.Math.Distance.Between(x, y, b.worldX, b.worldY),
      )[0];
  }

  private recoverDiscovery(site: RuntimeDiscoverySite): void {
    const hadVoidSkin = this.save.unlockedSkins.includes('void');
    if (!recordDiscovery(this.save, site.id)) return;
    this.earn(site.reward);
    persist(this.save);
    const view = this.discoveryViews.get(site.id);
    view?.icon.setAlpha(0.42);
    view?.label.setText(site.name).setColor('#d0d0d0');
    view?.ring.setAlpha(0.3).setStrokeStyle(2, 0x8bc97c, 0.35);
    hud.toast(`${site.name} recovered · ${money(site.reward)} credits.`, 'good');
    if (!hadVoidSkin && this.save.unlockedSkins.includes('void')) {
      hud.toast('Discovery milestone: Voidglass ship skin unlocked.', 'good');
    }
  }

  private gateOpen(): boolean {
    return !this.sector.boss && campaignRequirementsMet(this.save);
  }

  private dock(): void {
    this.docked = true;
    this.physics.world.pause();
    const b = this.player.body as Body;
    b.setVelocity(0, 0);
    b.setAcceleration(0, 0);
    this.flame.setVisible(false);
    sfx.thrust(0);
    sfx.dock();
    hud.flare(0);
    hud.hint(null);
    this.autoDeliver();
    this.ensureDrones();
    persist(this.save);
    openShop(this.shopApi());
  }

  private launch(): void {
    if (!this.docked) return;
    closeShop();
    this.docked = false;
    this.physics.world.resume();
    sfx.undock();
    session.cargo = { ...this.cargo };
    persist(this.save);
  }

  private warp(): void {
    this.warping = true;
    sfx.warp();
    sfx.thrust(0);
    this.cameras.main.fadeOut(1000, 0, 0, 0);
    (this.player.body as Body).setVelocity(0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const completedSector = this.save.sector;
      this.save.sector += 1;
      this.save.sectorEarned = 0;
      refreshUnlocks(this.save);
      session.cargo = { ...this.cargo };
      persist(this.save);
      const objective = CAMPAIGN_OBJECTIVES[completedSector];
      showOverlay(
        'SECTOR DEBRIEF',
        `Sector ${completedSector + 1}: ${this.sector.name}<br>
         Credits earned: ${money(this.sectorCredits)} · Asteroids broken: ${this.rocksBroken}<br>
         Pirates defeated: ${this.piratesDefeated} · Ore recovered: ${this.oreCollected} · Damage absorbed: ${Math.round(this.damageTaken)}<br>
         Hazard warnings: ${this.hazardWarnings} · Hull remaining: ${Math.max(0, Math.round(this.hull))}<br>
         Objective: ${objective.description} — COMPLETE`,
        [
          { label: 'Continue', primary: true, onClick: () => this.scene.restart() },
          { label: 'Main menu', onClick: () => this.toMenu() },
        ],
      );
    });
  }

  private shopApi(): ShopApi {
    const api: ShopApi = {
      save: this.save,
      market: this.market,
      cargo: () => this.cargo,
      hull: () => this.hull,
      fuel: () => this.fuel,
      stats: () => this.stats,
      clock: () => this.clock,
      offers: () => this.offers,
      active: () => this.active,
      gateReady: () => this.gateOpen(),
      sell: (ore) => {
        const list = ore === 'all' ? ORE_IDS : [ore];
        let total = 0;
        for (const o of list) {
          const n = this.cargo[o];
          if (!n) continue;
          const v = Math.round(n * priceOf(this.market, o) * this.stats.saleMultiplier);
          this.cargo[o] = 0;
          total += v;
        }
        if (total > 0) {
          this.earn(total);
          sfx.sell();
          hud.toast(`Sold ore for ${money(total)}`, 'good');
          persist(this.save);
        }
      },
      repair: () => this.service(true, false),
      refuel: () => this.service(false, true),
      service: () => this.service(true, true),
      buy: (id: UpgradeId) => {
        const oldHull = this.stats.hullMax;
        const oldFuel = this.stats.fuelMax;
        const oldShield = this.stats.shieldMax;
        if (!buyUpgrade(this.save, id)) {
          sfx.deny();
          return;
        }
        this.stats = statsFor(this.save.levels, this.save.selectedPilot);
        this.hull += this.stats.hullMax - oldHull;
        this.fuel += this.stats.fuelMax - oldFuel;
        this.shield += this.stats.shieldMax - oldShield;
        this.turretSpr.setVisible(this.save.levels.turret > 0);
        this.ensureDrones();
        sfx.buy();
        const u = UPGRADES.find((x) => x.id === id);
        hud.toast(`Installed: ${u?.name} level ${this.save.levels[id]}`, 'good');
        persist(this.save);
      },
      accept: (id) => {
        if (this.active.length >= 2) return;
        const i = this.offers.findIndex((c) => c.id === id);
        if (i < 0) return;
        const [c] = this.offers.splice(i, 1);
        c.deadline = this.clock + 240 + Math.random() * 120;
        this.active.push(c);
        this.offers.push(makeContract(this.save.sector, this.clock, Math.random));
        sfx.buy();
      },
      deliver: () => this.autoDeliver(),
      refresh: () => {
        this.offers = [0, 1, 2].map(() => makeContract(this.save.sector, this.clock, Math.random));
      },
      launch: () => this.launch(),
    };
    return api;
  }

  private service(repair: boolean, refuel: boolean): void {
    const s = this.save;
    const sec = s.sector;
    if (repair) {
      const missing = Math.ceil(this.stats.hullMax - this.hull);
      if (missing > 0) {
        const cost = repairCost(missing, sec);
        const per = cost / missing;
        const units = cost <= s.money ? missing : Math.floor(s.money / per);
        if (units > 0) {
          this.hull = Math.min(this.stats.hullMax, this.hull + units);
          s.money -= Math.ceil(units * per);
          sfx.buy();
        } else sfx.deny();
      }
    }
    if (refuel) {
      const missing = Math.ceil(this.stats.fuelMax - this.fuel);
      if (missing > 0) {
        const cost = refuelCost(missing, sec);
        const per = cost / missing;
        const units = cost <= s.money ? missing : Math.floor(s.money / per);
        if (units > 0) {
          this.fuel = Math.min(this.stats.fuelMax, this.fuel + units);
          s.money -= Math.ceil(units * per);
          sfx.buy();
        } else sfx.deny();
      }
    }
    persist(s);
  }

  update(_time: number, delta: number): void {
    if (this.paused || this.warping) return;
    const dt = Math.min(delta / 1000, 0.05);
    this.clock += dt;
    this.updateMarket(dt);
    this.updateBg();
    this.threatGfx.clear();
    const touchInteracting = this.touch.state.interacting;
    if (touchInteracting && !this.touchInteractHeld) this.interact();
    this.touchInteractHeld = touchInteracting;
    if (this.docked) {
      this.updateHud();
      return;
    }
    this.t += dt;
    this.hitCd -= dt;
    this.pickupMsgCd -= dt;
    if (this.shield < this.stats.shieldMax) {
      this.shieldRecharge -= dt;
      if (this.shieldRecharge <= 0) this.shield = Math.min(this.stats.shieldMax, this.shield + 18 * dt);
    }
    if (this.hitCd <= 0 && this.hull < this.stats.hullMax) {
      this.hull = Math.min(this.stats.hullMax, this.hull + this.stats.hullRegen * dt);
    }
    if (this.stats.drones > 0 && this.save.money > 0) {
      this.save.money = Math.max(0, this.save.money - droneUpkeepPerSecond(this.stats.drones) * dt);
    }
    this.updatePlayer(dt);
    this.updateBullets(dt);
    this.updateRocks(dt);
    this.updateChunks(dt);
    this.updatePirates(dt);
    this.updateDrones(dt);
    this.updateTurret(dt);
    this.updateBoss(dt);
    this.updateHazards(dt);
    this.updateWells(dt);
    this.updateSpawns(dt);
    this.updateStation(dt);
    this.updateHint();
    this.updateHud();
    this.mmTick = (this.mmTick + 1) % 2;
    if (this.mmTick === 0) this.drawMinimap();
  }

  private updateMarket(dt: number): void {
    const ev = stepMarket(this.market, dt, Math.random);
    if (ev) hud.toast(`Market: ${ev}`, 'market');
    this.marketTick += dt;
    if (this.marketTick >= 1) {
      this.marketTick = 0;
      const gone = this.active.filter((c) => c.deadline <= this.clock);
      if (gone.length) {
        this.active = this.active.filter((c) => c.deadline > this.clock);
        for (const c of gone) hud.toast(`Contract expired: ${c.qty} ${ORES[c.ore].name}`, 'bad');
      }
    }
  }

  private updateBg(): void {
    const cam = this.cameras.main;
    this.stars[0].tilePositionX = cam.scrollX * 0.05;
    this.stars[0].tilePositionY = cam.scrollY * 0.05;
    this.stars[1].tilePositionX = cam.scrollX * 0.12;
    this.stars[1].tilePositionY = cam.scrollY * 0.12;
    this.stars[2].tilePositionX = cam.scrollX * 0.25;
    this.stars[2].tilePositionY = cam.scrollY * 0.25;
  }

  private updatePlayer(dt: number): void {
    if (this.dead) return;
    const p = this.player;
    const body = p.body as Body;
    let ax = Number(this.isActionDown('right')) - Number(this.isActionDown('left')) + this.touch.state.moveX;
    let ay = Number(this.isActionDown('down')) - Number(this.isActionDown('up')) + this.touch.state.moveY;
    const mag = Math.hypot(ax, ay);
    const thrusting = mag > 0;
    if (thrusting) {
      ax /= mag;
      ay /= mag;
    }
    const turbo = (this.isActionDown('boost') || this.touch.state.boosting) && thrusting && this.fuel > 0;
    const boost = turbo ? 1.7 : 1;
    const power = (this.fuel > 0 ? 1 : 0.22) * boost;
    body.setMaxVelocity(this.stats.maxSpeed * (this.fuel > 0 ? 1 : 0.55) * boost);
    body.setAcceleration(ax * this.stats.accel * power, ay * this.stats.accel * power);
    if (thrusting && this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - (turbo ? 7 * this.stats.sprintEfficiency : 2.6) * dt);
      if (this.fuel === 0) hud.toast('Out of fuel - limp back to the station.', 'bad');
    } else if (!thrusting && this.fuel < this.stats.fuelMax) {
      this.fuel = Math.min(this.stats.fuelMax, this.fuel + this.stats.sprintRegen * dt);
    }
    sfx.thrust(thrusting ? 0.5 + (this.fuel > 0 ? 0.5 : 0) : 0);

    const ptr = this.input.activePointer;
    const shooting = ptr.leftButtonDown() || this.isActionDown('fire') || this.touch.state.firing;
    if (this.touch.state.aim !== null) {
      p.rotation = this.touch.state.aim;
    } else if (shooting) {
      const w = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      const aim = Math.atan2(w.y - p.y, w.x - p.x);
      p.rotation = Phaser.Math.Angle.RotateTo(p.rotation, aim, 10 * this.settings.aimSensitivity * dt);
    } else if (thrusting) {
      // otherwise the nose swings toward the direction you are flying
      p.rotation = Phaser.Math.Angle.RotateTo(p.rotation, Math.atan2(ay, ax), 10 * dt);
    }

    if (thrusting) {
      const fx = Math.cos(p.rotation);
      const fy = Math.sin(p.rotation);
      this.flame.setVisible(true);
      this.flame.setRotation(p.rotation);
      this.flame.setPosition(p.x - fx * 14, p.y - fy * 14);
      this.flame.setScale((0.7 + Math.random() * 0.5) * (turbo ? 1.8 : 1), 0.8 + Math.random() * 0.3);
      this.exhaust.emitParticleAt(p.x - fx * 22, p.y - fy * 22, 1);
    } else {
      this.flame.setVisible(false);
    }

    this.fireCd -= dt;
    if (shooting && this.fireCd <= 0) this.fire();
  }

  private fire(): void {
    const p = this.player;
    const pv = (p.body as Body).velocity;
    const weapon = WEAPONS.find((candidate) => candidate.id === this.save.selectedWeapon) ?? WEAPONS[0];
    this.fireCd = this.stats.fireDelay * weapon.fireDelayMultiplier / 1000;
    for (let i = 0; i < weapon.projectiles; i++) {
      const centered = i - (weapon.projectiles - 1) / 2;
      const ang = p.rotation + centered * weapon.spread + rnd(-0.025, 0.025);
      const mx = p.x + Math.cos(ang) * 28;
      const my = p.y + Math.sin(ang) * 28;
      const b = this.bullets.create(mx, my, 'bullet') as Bullet;
      b.life = 0.85;
      b.dmg = this.stats.damage * weapon.damageMultiplier;
      b.setDepth(6);
      b.setRotation(ang);
      (b.body as Body).setCircle(4, 5, -1);
      b.setVelocity(Math.cos(ang) * 900 + pv.x * 0.5, Math.sin(ang) * 900 + pv.y * 0.5);
      this.burst(this.fxSpark, mx, my, 2);
    }
    sfx.shoot();
  }

  private updateBullets(dt: number): void {
    for (const b of [...(this.bullets.getChildren() as Bullet[])]) {
      b.life -= dt;
      if (b.life <= 0) b.destroy();
    }
    for (const e of [...(this.ebullets.getChildren() as EBullet[])]) {
      e.life -= dt;
      if (e.life <= 0) e.destroy();
    }
  }

  private updateRocks(dt: number): void {
    for (const r of this.rocks.getChildren() as Rock[]) {
      const d = Phaser.Math.Distance.Between(r.x, r.y, this.cx, this.cy);
      if (d < 260) {
        const a = Phaser.Math.Angle.Between(this.cx, this.cy, r.x, r.y);
        const b = r.body as Body;
        b.velocity.x += Math.cos(a) * 140 * dt;
        b.velocity.y += Math.sin(a) * 140 * dt;
      }
    }
    // storm debris cleanup
    for (const d of [...(this.debris.getChildren() as Debris[])]) {
      if (d.x < -300 || d.y < -300 || d.x > this.S + 300 || d.y > this.S + 300) d.destroy();
    }
  }

  private updateChunks(dt: number): void {
    const p = this.player;
    const space = this.stats.cargoMax - cargoTotal(this.cargo);
    for (const c of [...(this.chunks.getChildren() as Chunk[])]) {
      c.age += dt;
      if (c.age > 80) {
        c.destroy();
        continue;
      }
      if (c.age > 65) c.setAlpha(Math.floor(c.age * 6) % 2 ? 0.35 : 1);
      if (this.dead) continue;
      const d = Phaser.Math.Distance.Between(c.x, c.y, p.x, p.y);
      const b = c.body as Body;
      const reach = this.stats.magnet + 260;
      if (d < reach && space > 0) {
        // ore homes in on the ship: steer velocity toward it, faster when closer
        const a = Math.atan2(p.y - c.y, p.x - c.x);
        const want = 260 + 520 * (1 - d / reach);
        const k = Math.min(1, 6 * dt);
        b.velocity.x += (Math.cos(a) * want - b.velocity.x) * k;
        b.velocity.y += (Math.sin(a) * want - b.velocity.y) * k;
      }
      if (d < 28) {
        if (space > 0) {
          this.cargo[c.ore] += 1;
          recordDailyProgress(this.save, 'ore', 1);
          this.oreCollected++;
          recordCampaignProgress(this.save, 'ore');
          this.updateCampaignProgress();
          sfx.pickup();
          this.burst(this.fxOre, c.x, c.y, 3, ORES[c.ore].color);
          c.destroy();
          return this.updateChunks(0);
        } else if (this.pickupMsgCd <= 0) {
          this.pickupMsgCd = 2;
          hud.toast('Cargo hold full - dock to sell.', 'bad');
        }
      }
    }
  }

  private updatePirates(dt: number): void {
    const p = this.player;
    const tgtPlayer = !this.dead && !this.docked;
    for (const pr of [...(this.pirates.getChildren() as Pirate[])]) {
      const body = pr.body as Body;
      const type = PIRATE_TYPES[pr.kind];
      pr.fireCd -= dt;
      pr.ramCd -= dt;
      if (pr.mode === 'flee') {
        pr.fleeT -= dt;
        const away = tgtPlayer ? Phaser.Math.Angle.Between(p.x, p.y, pr.x, pr.y) : pr.rotation;
        body.setAcceleration(Math.cos(away) * 520, Math.sin(away) * 520);
        pr.rotation = Phaser.Math.Angle.RotateTo(pr.rotation, away, 6 * dt);
        if (pr.fleeT <= 0) {
          this.warpRing(pr.x, pr.y, 0xe5483a);
          hud.toast('A pirate escaped with your ore.', 'bad');
          pr.destroy();
        }
        continue;
      }
      let tx = 0;
      let ty = 0;
      let has = false;
      let isPlayer = false;
      let best = Infinity;
      if (tgtPlayer) {
        tx = p.x;
        ty = p.y;
        best = Phaser.Math.Distance.Between(pr.x, pr.y, p.x, p.y) * 1.25;
        has = true;
        isPlayer = true;
      }
      for (const d of this.drones.getChildren() as Drone[]) {
        const dd = Phaser.Math.Distance.Between(pr.x, pr.y, d.x, d.y);
        if (dd < best) {
          best = dd;
          tx = d.x;
          ty = d.y;
          has = true;
          isPlayer = false;
        }
      }
      if (!has) {
        body.setAcceleration(0, 0);
        continue;
      }
      const dist = Phaser.Math.Distance.Between(pr.x, pr.y, tx, ty);
      const ang = Math.atan2(ty - pr.y, tx - pr.x);
      pr.rotation = Phaser.Math.Angle.RotateTo(pr.rotation, ang, 4.5 * dt);
      let ax: number;
      let ay: number;
      if (dist > 300) {
        ax = Math.cos(ang) * 460 * type.accel;
        ay = Math.sin(ang) * 460 * type.accel;
      } else {
        const perp = ang + (Math.PI / 2) * pr.strafe;
        const out = dist < 190 ? -1 : 0.2;
        ax = Math.cos(perp) * 330 * type.accel + Math.cos(ang) * 260 * out;
        ay = Math.sin(perp) * 330 * type.accel + Math.sin(ang) * 260 * out;
      }
      body.setAcceleration(ax, ay);
      if (dist < type.range && pr.fireCd <= 0 && Math.abs(Phaser.Math.Angle.Wrap(ang - pr.rotation)) < 0.5) {
        pr.fireCd = Math.max(0.65, type.fireDelay - 0.1 * this.save.sector) + Math.random() * 0.5;
        this.enemyShot(
          pr.x,
          pr.y,
          ang + rnd(-0.07, 0.07),
          type.shotSpeed + 15 * this.save.sector,
          type.shotDamage + 2 * this.save.sector,
        );
      }
      if (isPlayer && dist < type.range && pr.fireCd > 0 && pr.fireCd < 0.28) {
        this.threatGfx.lineStyle(2, 0xff625d, 0.7);
        this.threatGfx.lineBetween(pr.x, pr.y, p.x, p.y);
      }
      if (isPlayer && dist < 42 && cargoTotal(this.cargo) > 0) this.steal(pr);
      else if (isPlayer && dist < 34 && pr.ramCd <= 0) {
        pr.ramCd = 1.2;
        this.hurtPlayer(6);
      }
    }
  }

  private enemyShot(x: number, y: number, ang: number, speed: number, dmg: number): void {
    const e = this.ebullets.create(x + Math.cos(ang) * 24, y + Math.sin(ang) * 24, 'ebullet') as EBullet;
    e.life = 2.4;
    e.dmg = dmg;
    e.setDepth(6);
    (e.body as Body).setCircle(5, 2, 2);
    e.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
  }

  private steal(pr: Pirate): void {
    const total = cargoTotal(this.cargo);
    let rem = Math.max(1, Math.ceil(total * 0.4));
    const taken = rem;
    const order = [...ORE_IDS].sort((a, b) => ORES[b].base - ORES[a].base);
    for (const o of order) {
      const n = Math.min(rem, this.cargo[o]);
      this.cargo[o] -= n;
      pr.loot[o] += n;
      rem -= n;
    }
    pr.mode = 'flee';
    pr.fleeT = 14;
    pr.setTint(0xffd0a0);
    sfx.hurt();
    hud.hurt();
    this.shake(160, 0.007);
    hud.toast(`A pirate stole ${taken} ore! Shoot it before it escapes.`, 'bad');
  }

  private updateDrones(dt: number): void {
    this.beamGfx.clear();
    const list = this.drones.getChildren() as Drone[];
    for (const d of list) {
      const body = d.body as Body;
      d.shotCd -= dt;
      d.beam -= dt;
      if (!d.target || !d.target.active || Phaser.Math.Distance.Between(d.target.x, d.target.y, this.cx, this.cy) > 1300) {
        d.target = this.pickDroneTarget(d);
      }
      let px: number;
      let py: number;
      let face: number;
      const tg = d.target;
      if (tg) {
        const a = Math.atan2(tg.y - d.y, tg.x - d.x);
        const hover = AST_R[tg.sz] + 90;
        px = tg.x - Math.cos(a) * hover;
        py = tg.y - Math.sin(a) * hover;
        face = a;
      } else {
        const a = this.t * 0.35 + d.idx * 1.9;
        px = this.cx + Math.cos(a) * (330 + d.idx * 30);
        py = this.cy + Math.sin(a) * (330 + d.idx * 30);
        face = Math.atan2(py - d.y, px - d.x);
      }
      let dx = px - d.x;
      let dy = py - d.y;
      const len = Math.hypot(dx, dy) || 1;
      const sp = Math.min(260, len * 2.2);
      dx = (dx / len) * sp;
      dy = (dy / len) * sp;
      const k = Math.min(1, 4 * dt);
      body.velocity.x += (dx - body.velocity.x) * k;
      body.velocity.y += (dy - body.velocity.y) * k;
      d.rotation = Phaser.Math.Angle.RotateTo(d.rotation, face, 8 * dt);
      if (tg && Phaser.Math.Distance.Between(d.x, d.y, tg.x, tg.y) < AST_R[tg.sz] + 190 && d.shotCd <= 0) {
        d.shotCd = 0.55;
        d.beam = 0.14;
        this.damageRock(tg, this.stats.droneDamage, 'drone');
      }
      if (d.beam > 0 && tg && tg.active) {
        this.beamGfx.lineStyle(2.5, ORES[tg.ore].color, 0.95);
        this.beamGfx.lineBetween(d.x, d.y, tg.x, tg.y);
      }
    }
  }

  private pickDroneTarget(d: Drone): Rock | null {
    let best: Rock | null = null;
    let bestScore = Infinity;
    for (const r of this.rocks.getChildren() as Rock[]) {
      if (Phaser.Math.Distance.Between(r.x, r.y, this.cx, this.cy) > 1600) continue;
      const score =
        Phaser.Math.Distance.Between(d.x, d.y, r.x, r.y) +
        (r.sz === 'L' ? 220 : 0) -
        ORES[r.ore].base * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  private updateTurret(dt: number): void {
    const lvl = this.save.levels.turret;
    if (lvl <= 0) return;
    this.turretCd -= dt;
    let best: Spr | null = null;
    let bd = 620;
    for (const pr of this.pirates.getChildren() as Pirate[]) {
      const d = Phaser.Math.Distance.Between(pr.x, pr.y, this.cx, this.cy);
      if (d < bd) {
        bd = d;
        best = pr;
      }
    }
    if (this.boss) {
      const d = Phaser.Math.Distance.Between(this.boss.x, this.boss.y, this.cx, this.cy);
      if (d < bd) best = this.boss;
    }
    if (!best) return;
    const a = Math.atan2(best.y - this.cy, best.x - this.cx);
    this.turretSpr.rotation = Phaser.Math.Angle.RotateTo(this.turretSpr.rotation, a, 9 * dt);
    if (this.turretCd <= 0) {
      this.turretCd = this.stats.turretDelay / 1000;
      const b = this.bullets.create(this.cx + Math.cos(a) * 30, this.cy + Math.sin(a) * 30, 'tbullet') as Bullet;
      b.life = 0.95;
      b.dmg = this.stats.turretDamage;
      b.setDepth(6);
      b.setRotation(a);
      (b.body as Body).setCircle(4, 5, -1);
      b.setVelocity(Math.cos(a) * 820, Math.sin(a) * 820);
      sfx.turret();
    }
  }

  private updateBoss(dt: number): void {
    if (this.sector.boss && !this.save.won && !this.boss && campaignRequirementsMet(this.save)) this.spawnBoss();
    const b = this.boss;
    if (!b) return;
    const body = b.body as Body;
    const p = this.player;
    const alive = !this.dead && !this.docked;
    if (alive) {
      const dist = Phaser.Math.Distance.Between(b.x, b.y, p.x, p.y);
      const ang = Math.atan2(p.y - b.y, p.x - b.x);
      b.rotation = Phaser.Math.Angle.RotateTo(b.rotation, ang, 0.9 * dt);
      const want = dist > 520 ? 70 : dist < 340 ? -50 : 0;
      body.setVelocity(Math.cos(ang) * want, Math.sin(ang) * want);
      b.fireCd -= dt;
      b.ringCd -= dt;
      b.spawnCd -= dt;
      const enraged = b.hp < b.max * 0.5;
      if (b.fireCd > 0 && b.fireCd < 0.35) {
        this.threatGfx.lineStyle(4, 0xff4035, 0.8);
        this.threatGfx.lineBetween(b.x, b.y, p.x, p.y);
      }
      if (enraged && b.ringCd > 0 && b.ringCd < 0.9) {
        this.threatGfx.lineStyle(3, 0xffa43a, 0.6);
        this.threatGfx.strokeCircle(b.x, b.y, 240);
      }
      if (b.fireCd <= 0) {
        b.fireCd = enraged ? 1.3 : 1.9;
        for (const off of [-0.2, 0, 0.2]) this.enemyShot(b.x, b.y, ang + off, 340, 11);
        sfx.pirate();
      }
      if (enraged && b.ringCd <= 0) {
        b.ringCd = 4.5;
        for (let i = 0; i < 16; i++) this.enemyShot(b.x, b.y, (i / 16) * Math.PI * 2 + this.t, 260, 9);
        sfx.boss();
      }
      if (enraged && b.spawnCd <= 0 && this.pirates.getChildren().length < 3) {
        b.spawnCd = 13;
        this.spawnPirate();
      }
    } else body.setVelocity(0, 0);
  }

  private updateHazards(dt: number): void {
    // solar flare
    const f = this.flare;
    if (f.phase === 'idle') {
      if (this.t >= this.nextFlare) {
        f.phase = 'warn';
        f.t = 7;
        this.hazardWarnings++;
        sfx.alarm();
      }
    } else if (f.phase === 'warn') {
      f.t -= dt;
      if (f.t <= 0) {
        f.phase = 'active';
        f.t = 6;
        sfx.flare();
      }
    } else {
      f.t -= dt;
      f.dmgCd -= dt;
      hud.flare(0.38 + 0.22 * Math.sin(this.t * 14));
      const inSafe = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.cx, this.cy) < SAFE_R;
      if (!inSafe && !this.dead && f.dmgCd <= 0) {
        f.dmgCd = 0.5;
        this.hurtPlayer(3.5 + this.save.sector, true);
        hud.hurt();
      }
      if (f.t <= 0) {
        f.phase = 'idle';
        hud.flare(0);
        this.nextFlare = this.t + this.sector.flareEvery * rnd(0.8, 1.2);
      }
    }
    // debris storm
    const s = this.storm;
    if (s.phase === 'idle') {
      if (this.t >= this.nextStorm) {
        s.phase = 'warn';
        s.t = 6;
        s.dir = Math.floor(Math.random() * 4);
        this.hazardWarnings++;
        sfx.alarm();
      }
    } else if (s.phase === 'warn') {
      s.t -= dt;
      if (s.t <= 0) {
        s.phase = 'active';
        s.t = 7;
      }
    } else {
      s.t -= dt;
      s.spawnCd -= dt;
      if (s.spawnCd <= 0) {
        s.spawnCd = 0.22;
        this.spawnDebris(s.dir);
      }
      if (s.t <= 0) {
        s.phase = 'idle';
        this.nextStorm = this.t + this.sector.stormEvery * rnd(0.8, 1.2);
      }
    }
    // banner
    let msg: string | null = null;
    let kind: 'warn' | 'danger' | 'good' = 'warn';
    if (this.deadBanner) {
      msg = 'SHIP LOST - RECOVERY IN PROGRESS';
      kind = 'danger';
    } else if (f.phase === 'warn') {
      msg = `SOLAR FLARE IN ${Math.ceil(f.t)} - SHELTER AT THE STATION`;
      kind = 'danger';
    } else if (f.phase === 'active') {
      msg = 'SOLAR FLARE - GET INSIDE THE SAFE ZONE';
      kind = 'danger';
    } else if (s.phase === 'warn') {
      msg = `DEBRIS STORM FROM THE ${['WEST', 'EAST', 'NORTH', 'SOUTH'][s.dir]} IN ${Math.ceil(s.t)}`;
    } else if (this.flashMsg) {
      this.flashMsg.t -= dt;
      msg = this.flashMsg.text;
      kind = this.flashMsg.kind;
      if (this.flashMsg.t <= 0) this.flashMsg = null;
    }
    hud.banner(msg, kind);
  }

  private spawnDebris(dir: number): void {
    const S = this.S;
    let x: number;
    let y: number;
    let vx = 0;
    let vy = 0;
    const sp = rnd(380, 520);
    const along = rnd(0, S);
    if (dir === 0) {
      x = -40;
      y = along;
      vx = sp;
    } else if (dir === 1) {
      x = S + 40;
      y = along;
      vx = -sp;
    } else if (dir === 2) {
      x = along;
      y = -40;
      vy = sp;
    } else {
      x = along;
      y = S + 40;
      vy = -sp;
    }
    vx += rnd(-40, 40);
    vy += rnd(-40, 40);
    const d = this.debris.create(x, y, `debris_${Math.floor(Math.random() * 3)}`) as Debris;
    d.hp = 8;
    d.setDepth(5);
    (d.body as Body).setCircle(17, 7, 7);
    d.setVelocity(vx, vy);
    d.setAngularVelocity(rnd(-200, 200));
  }

  private updateWells(dt: number): void {
    const g = this.wellGfx;
    g.clear();
    for (const w of this.wells) {
      // visuals
      for (let i = 0; i < 4; i++) {
        const r = WELL_R * (0.25 + i * 0.25);
        g.lineStyle(2, 0xb35cf0, 0.12 + i * 0.03);
        for (let s = 0; s < 8; s++) {
          const a0 = this.t * (0.6 - i * 0.12) + (s / 8) * Math.PI * 2;
          g.beginPath();
          g.arc(w.x, w.y, r, a0, a0 + 0.45);
          g.strokePath();
        }
      }
      g.fillStyle(0x050407, 1);
      g.fillCircle(w.x, w.y, 34);
      g.lineStyle(3, 0xb35cf0, 0.9);
      g.strokeCircle(w.x, w.y, 34);
      // physics
      const pull = (obj: Spr, k: number): void => {
        const dx = w.x - obj.x;
        const dy = w.y - obj.y;
        const d = Math.hypot(dx, dy);
        if (d > WELL_R || d < 1) return;
        const strength = 1250 * Math.pow(1 - d / WELL_R, 1.3) * k;
        const b = obj.body as Body;
        b.velocity.x += (dx / d) * strength * dt;
        b.velocity.y += (dy / d) * strength * dt;
      };
      if (!this.dead) {
        pull(this.player, 1);
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, w.x, w.y) < 44) this.wellBurn(dt);
      }
      for (const r of this.rocks.getChildren() as Rock[]) pull(r, 0.75);
      for (const pr of this.pirates.getChildren() as Pirate[]) pull(pr, 0.6);
      for (const c of this.chunks.getChildren() as Chunk[]) pull(c, 0.5);
      for (const d of this.drones.getChildren() as Drone[]) pull(d, 0.35);
    }
    this.updatePlanets(dt);
  }

  private wellCd = 0;
  private wellBurn(dt: number): void {
    this.wellCd -= dt;
    if (this.wellCd <= 0) {
      this.wellCd = 0.3;
      this.hurtPlayer(18);
    }
  }

  private updateSpawns(dt: number): void {
    this.nextPirate -= dt;
    if (this.nextPirate <= 0) {
      this.nextPirate = this.sector.pirateEvery * rnd(0.75, 1.25);
      if (!this.dead && this.pirates.getChildren().length < this.sector.maxPirates) this.spawnPirate();
    }
    this.spawnTick += dt;
    if (this.spawnTick >= 2.5) {
      this.spawnTick = 0;
      const rocks = this.rocks.getChildren().length;
      if (rocks < this.sector.asteroids * 0.75) {
        for (let i = 0; i < 12; i++) {
          const x = rnd(120, this.S - 120);
          const y = rnd(120, this.S - 120);
          if (Phaser.Math.Distance.Between(x, y, this.cx, this.cy) < 520) continue;
          if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 1000) continue;
          if (this.nearDiscovery(x, y, 150)) continue;
          if (this.wells.some((w) => Phaser.Math.Distance.Between(x, y, w.x, w.y) < 160)) continue;
          if (this.planets.some((p) => Phaser.Math.Distance.Between(x, y, p.x, p.y) < p.radius + 100)) continue;
          this.spawnRock(x, y, 'L', pickWeighted(this.sector.weights, Math.random));
          break;
        }
      }
    }
  }

  private updateStation(dt: number): void {
    this.station.rotation += 0.04 * dt;
    const open = this.gateOpen();
    if (!this.sector.boss) {
      this.gate.rotation += (open ? 0.5 : 0.05) * dt;
      this.gate.setTint(open ? 0xffffff : 0x59616b);
      this.gateGlow.setAlpha(open ? 0.22 + 0.1 * Math.sin(this.t * 4) : 0);
    }
  }

  private updateHint(): void {
    if (this.dead) {
      hud.hint(null);
      return;
    }
    const p = this.player;
    const dS = Phaser.Math.Distance.Between(p.x, p.y, this.cx, this.cy);
    const dG = Phaser.Math.Distance.Between(p.x, p.y, this.gx, this.gy);
    if (dS < DOCK_R) hud.hint(`${this.settings.bindings.interact} - Dock at station`);
    else if (!this.sector.boss && dG < GATE_R + 60) {
      if (this.gateOpen()) hud.hint(`${this.settings.bindings.interact} - Warp to ${SECTORS[this.save.sector + 1].name}`);
      else {
        const objective = CAMPAIGN_OBJECTIVES[this.save.sector];
        const requirement = campaignObjectiveComplete(this.save)
          ? `Earn ${money(Math.max(0, this.sector.goal - this.save.sectorEarned))} more`
          : `${objective.description} (${objectiveProgress(this.save)}/${objective.target})`;
        hud.hint(`Gate sealed - ${requirement}`);
      }
    } else {
      const site = this.nearestUndiscoveredSite(p.x, p.y);
      if (site) {
        const distance = Phaser.Math.Distance.Between(p.x, p.y, site.worldX, site.worldY);
        hud.hint(
          distance < DISCOVERY_INTERACT_R + 70
            ? `${this.settings.bindings.interact} - Recover ${site.name} (+${money(site.reward)})`
            : null,
        );
      } else hud.hint(null);
    }
  }

  private updateHud(): void {
    hud.update({
      hull: Math.max(0, this.hull),
      hullMax: this.stats.hullMax,
      shield: Math.max(0, this.shield),
      shieldMax: this.stats.shieldMax,
      fuel: this.fuel,
      fuelMax: this.stats.fuelMax,
      cargo: this.cargo,
      cargoMax: this.stats.cargoMax,
      money: this.save.money,
      sector: this.save.sector,
      earned: this.save.sectorEarned,
      goal: this.sector.goal,
      contracts: this.active,
      clock: this.clock,
      market: this.market,
      boss: this.boss ? { hp: Math.max(0, this.boss.hp), max: this.boss.max } : null,
      mission: {
        description: CAMPAIGN_OBJECTIVES[this.save.sector].description,
        progress: objectiveProgress(this.save),
        target: CAMPAIGN_OBJECTIVES[this.save.sector].target,
        complete: campaignObjectiveComplete(this.save),
      },
      discoveries: this.save.discoveries.length,
      discoveryTotal: DISCOVERY_SITES.length,
    });
  }

  private drawMinimap(): void {
    const c = this.mm;
    const W = 180;
    const k = W / this.S;
    c.clearRect(0, 0, W, W);
    c.fillStyle = 'rgba(10,12,15,0.9)';
    c.fillRect(0, 0, W, W);
    c.strokeStyle = '#3a2a26';
    c.strokeRect(0.5, 0.5, W - 1, W - 1);
    for (const w of this.wells) {
      c.strokeStyle = '#b35cf0';
      c.beginPath();
      c.arc(w.x * k, w.y * k, WELL_R * k * 0.6, 0, Math.PI * 2);
      c.stroke();
    }
    for (const planet of this.planets) {
      c.fillStyle = '#86a9c9';
      c.beginPath();
      c.arc(planet.x * k, planet.y * k, Math.max(2, planet.radius * k), 0, Math.PI * 2);
      c.fill();
    }
    for (const site of this.discoverySites) {
      const found = this.save.discoveries.includes(site.id);
      c.fillStyle = found ? '#8bc97c' : site.kind === 'wreck' ? '#9ca9ad' : site.kind === 'cache' ? '#e7a849' : '#64d4d7';
      c.beginPath();
      c.arc(site.worldX * k, site.worldY * k, found ? 3 : 4, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#6a625a';
    for (const r of this.rocks.getChildren() as Rock[]) {
      const s = r.sz === 'L' ? 3 : r.sz === 'M' ? 2 : 1.2;
      c.fillRect(r.x * k - s / 2, r.y * k - s / 2, s, s);
    }
    c.fillStyle = '#e8832a';
    c.fillRect(this.cx * k - 4, this.cy * k - 4, 8, 8);
    if (!this.sector.boss) {
      c.strokeStyle = this.gateOpen() ? '#e8832a' : '#59616b';
      c.beginPath();
      c.arc(this.gx * k, this.gy * k, 4, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = '#e5483a';
    for (const p of this.pirates.getChildren() as Pirate[]) c.fillRect(p.x * k - 2, p.y * k - 2, 4, 4);
    if (this.boss) c.fillRect(this.boss.x * k - 5, this.boss.y * k - 5, 10, 10);
    c.fillStyle = '#6fd0ff';
    for (const d of this.drones.getChildren() as Drone[]) c.fillRect(d.x * k - 1.5, d.y * k - 1.5, 3, 3);
    const cam = this.cameras.main;
    c.strokeStyle = 'rgba(217,221,226,0.35)';
    c.strokeRect(cam.scrollX * k, cam.scrollY * k, cam.width * k, cam.height * k);
    if (!this.dead) {
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(this.player.x * k, this.player.y * k, 2.6, 0, Math.PI * 2);
      c.fill();
    }
  }
}
