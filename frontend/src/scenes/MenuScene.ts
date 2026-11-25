import Phaser from 'phaser';
import { sfx } from '../audio';
import { AST_R, VARIANTS, buildTextures, type Sz } from '../art';
import { ORE_IDS } from '../data';
import { authenticate, currentAccount, restoreCloudSave, signOut, syncCloudSave } from '../cloud';
import { claimDailyQuest, clearSave, loadSave, newSave, persist, setCloudSyncHandler } from '../progress';
import { resetSession } from '../session';
import { closeOverlay, showMenu, type MenuActions } from '../ui';

interface Drifter {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  spin: number;
}

export class MenuScene extends Phaser.Scene {
  private drifters: Drifter[] = [];
  private stars: Phaser.GameObjects.TileSprite[] = [];
  private scrollX = 0;
  private menuEpoch = 0;
  private activeMenu = false;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.activeMenu = true;
    buildTextures(this);
    this.cameras.main.setBackgroundColor(0x07090c);
    this.cameras.main.fadeIn(400, 0, 0, 0);
    this.drifters = [];
    this.scrollX = 0;
    this.stars = ['stars1', 'stars2', 'stars3'].map((k) => this.add.tileSprite(0, 0, 1280, 720, k).setOrigin(0));
    const sizes: Sz[] = ['L', 'L', 'M', 'M', 'S'];
    for (let i = 0; i < 16; i++) {
      const sz = sizes[i % sizes.length];
      const ore = ORE_IDS[i % ORE_IDS.length];
      const img = this.add
        .image(Math.random() * 1500 - 100, Math.random() * 720, `ast_${ore}_${sz}_${Math.floor(Math.random() * VARIANTS)}`)
        .setScale(0.9 + AST_R[sz] / 120)
        .setAlpha(0.9);
      this.drifters.push({ img, vx: -(8 + Math.random() * 22), vy: (Math.random() - 0.5) * 6, spin: (Math.random() - 0.5) * 12 });
    }
    const ship = this.add.image(980, 470, 'ship').setScale(2.2).setRotation(-0.3);
    this.tweens.add({ targets: ship, y: 490, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    setCloudSyncHandler(syncCloudSave);
    this.showHome(loadSave());
    const account = currentAccount();
    if (account) {
      const epoch = this.menuEpoch;
      void restoreCloudSave(loadSave())
        .then((save) => {
          if (this.activeMenu && epoch === this.menuEpoch) this.showHome(save);
        })
        .catch((error: unknown) => {
          if (this.activeMenu && epoch === this.menuEpoch) {
            this.showHome(loadSave(), error instanceof Error ? error.message : 'Cloud save unavailable.');
          }
        });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.activeMenu = false;
      this.menuEpoch++;
      closeOverlay();
    });
  }

  private showHome(save: ReturnType<typeof newSave> | null, notice = ''): void {
    this.menuEpoch++;
    const actions: MenuActions = {
      playAi: () => this.begin(save ?? newSave()),
      newGame: () => {
        clearSave();
        const fresh = newSave();
        persist(fresh);
        this.begin(fresh);
      },
      pvp: () => {
        if (!currentAccount()) {
          this.showHome(save, 'Sign in to join online PvP.');
          return;
        }
        this.menuEpoch++;
        resetSession(save ?? newSave());
        closeOverlay();
        this.scene.start('PvP');
      },
      authenticate: async (username, password, register) => {
        await authenticate(username, password, register);
        setCloudSyncHandler(syncCloudSave);
        const cloudSave = await restoreCloudSave(loadSave());
        this.showHome(cloudSave);
      },
      signOut: async () => {
        await signOut();
        setCloudSyncHandler(null);
        this.showHome(loadSave());
      },
      selectPilot: (pilot) => {
        if (!save || !save.unlockedPilots.includes(pilot)) return;
        save.selectedPilot = pilot;
        persist(save);
        this.showHome(save);
      },
      selectSkin: (skin) => {
        if (!save || !save.unlockedSkins.includes(skin)) return;
        save.selectedSkin = skin;
        persist(save);
        this.showHome(save);
      },
      claimDaily: (id) => {
        if (!save) return;
        if (!claimDailyQuest(save, id)) {
          this.showHome(save, 'Complete the daily objective before claiming its reward.');
          return;
        }
        persist(save);
        this.showHome(save);
      },
    };
    showMenu(save, currentAccount(), actions, notice);
  }

  private begin(save: ReturnType<typeof newSave>): void {
    this.menuEpoch++;
    sfx.init();
    resetSession(save);
    closeOverlay();
    this.scene.start('Play');
  }

  update(_t: number, delta: number): void {
    const dt = delta / 1000;
    this.scrollX += dt * 14;
    this.stars[0].tilePositionX = this.scrollX * 0.3;
    this.stars[1].tilePositionX = this.scrollX * 0.7;
    this.stars[2].tilePositionX = this.scrollX * 1.4;
    for (const d of this.drifters) {
      d.img.x += d.vx * dt;
      d.img.y += d.vy * dt;
      d.img.angle += d.spin * dt;
      if (d.img.x < -120) {
        d.img.x = 1400;
        d.img.y = Math.random() * 720;
      }
    }
  }
}
