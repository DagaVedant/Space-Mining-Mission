import Phaser from 'phaser';
import { sfx } from '../audio';
import { AST_R, VARIANTS, buildTextures, type Sz } from '../art';
import { ORE_IDS, SHIP_SKINS, type WeaponId } from '../data';
import {
  authenticate,
  currentAccount,
  fetchPvpLeaderboard,
  fetchPvpStats,
  restoreCloudSave,
  signOut,
  syncCloudSave,
} from '../cloud';
import { buyCompanyUpgrade, collectOutposts } from '../company';
import { claimDailyQuest, clearSave, loadSave, newSave, persist, setCloudSyncHandler } from '../progress';
import { resetSession, session } from '../session';
import { applyGameSettings, closeOverlay, showMenu, type MenuActions } from '../ui';
import { loadSettings } from '../settings';
import type { VoyageMode } from '../voyage';

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
  /** outpost income banked on this visit, shown until the menu is left */
  private away = 0;
  private shipPreview!: Phaser.GameObjects.Image;

  constructor() {
    super('Menu');
  }

  preload(): void {
    for (const skin of SHIP_SKINS) {
      const key = `ship_${skin.id}`;
      if (!this.textures.exists(key)) {
        this.load.svg(key, `${import.meta.env.BASE_URL}assets/ships/${skin.id}.svg`);
      }
    }
  }

  create(): void {
    this.activeMenu = true;
    buildTextures(this);
    applyGameSettings(loadSettings());
    this.cameras.main.setBackgroundColor(0x07090c);
    this.cameras.main.fadeIn(400, 0, 0, 0);
    this.drifters = [];
    this.scrollX = 0;
    this.stars = ['stars1', 'stars2', 'stars3'].map((k) => this.add.tileSprite(0, 0, 1280, 720, k).setOrigin(0));
    const sizes: Sz[] = ['L', 'M', 'S'];
    // a few, starting clear of the menu panel on the left
    for (let i = 0; i < 6; i++) {
      const sz = sizes[i % sizes.length];
      const ore = ORE_IDS[i % ORE_IDS.length];
      const img = this.add
        .image(620 + i * 130, 70 + ((i * 263) % 580), `ast_${ore}_${sz}_${Math.floor(Math.random() * VARIANTS)}`)
        .setScale(0.9 + AST_R[sz] / 120)
        .setAlpha(0.55);
      this.drifters.push({ img, vx: -(5 + Math.random() * 7), vy: (Math.random() - 0.5) * 3, spin: (Math.random() - 0.5) * 8 });
    }
    this.shipPreview = this.add.image(980, 470, 'ship_industrial').setScale(2.2).setRotation(-0.3);
    this.tweens.add({ targets: this.shipPreview, y: 490, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    setCloudSyncHandler(syncCloudSave);
    this.away = 0;
    const account = currentAccount();
    const local = loadSave();
    // signed in, wait for the cloud save first: writing the local one now could overwrite it
    if (!account) this.collectAway(local);
    this.showHome(local);
    if (account) {
      const epoch = this.menuEpoch;
      void restoreCloudSave(loadSave())
        .then((save) => {
          if (!this.activeMenu || epoch !== this.menuEpoch) return;
          this.collectAway(save);
          this.showHome(save);
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

  private collectAway(save: ReturnType<typeof newSave> | null): void {
    if (!save) return;
    const earned = collectOutposts(save.company);
    if (earned <= 0) return;
    this.away = earned;
    persist(save);
  }

  private showHome(save: ReturnType<typeof newSave> | null, notice = ''): void {
    this.menuEpoch++;
    this.shipPreview?.setTexture(`ship_${save?.selectedSkin ?? 'industrial'}`);
    const actions: MenuActions = {
      playAi: () => this.begin(save ?? newSave()),
      expedition: () => {
        if (save) this.begin(save, 'expedition');
      },
      newGame: () => {
        clearSave();
        const fresh = newSave();
        // the company and any expedition under way outlive the campaign
        if (save) {
          fresh.company = save.company;
          fresh.run = save.run;
        }
        persist(fresh);
        this.begin(fresh);
      },
      pvp: (ranked) => {
        if (!currentAccount()) {
          this.showHome(save, 'Sign in to join online PvP.');
          return;
        }
        this.menuEpoch++;
        resetSession(save ?? newSave());
        session.pvpRanked = ranked;
        closeOverlay();
        this.scene.start('PvP');
      },
      authenticate: async (username, password, register) => {
        await authenticate(username, password, register);
        setCloudSyncHandler(syncCloudSave);
        const cloudSave = await restoreCloudSave(loadSave());
        this.collectAway(cloudSave);
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
      selectWeapon: (weapon: WeaponId) => {
        if (!save) return;
        save.selectedWeapon = weapon;
        persist(save);
        this.showHome(save);
      },
      buyCompany: (id) => {
        if (!save || !buyCompanyUpgrade(save.company, id)) return;
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
    const account = currentAccount();
    showMenu(save, account, actions, notice, this.away);
    if (account) {
      const epoch = this.menuEpoch;
      void fetchPvpStats().then((stats) => {
        if (!this.activeMenu || epoch !== this.menuEpoch) return;
        const node = document.getElementById('pvp-stats');
        if (node) node.textContent = `PvP ${stats.wins}W-${stats.losses}L · Season ${stats.season} #${stats.seasonRating} · Career #${stats.rating}`;
        void fetchPvpLeaderboard().then((leaderboard) => {
          if (!this.activeMenu || epoch !== this.menuEpoch) return;
          const currentNode = document.getElementById('pvp-stats');
          if (!currentNode) return;
          const leaders = leaderboard.players.slice(0, 3)
            .map((player) => `${player.rank}. ${player.username} ${player.rating}`)
            .join(' | ');
          currentNode.textContent +=
            (leaders ? ` · Top: ${leaders}` : ' · No ranked pilots yet');
        }).catch(() => {
          if (!this.activeMenu || epoch !== this.menuEpoch) return;
          const currentNode = document.getElementById('pvp-stats');
          if (currentNode) currentNode.textContent += ' · Leaderboard unavailable';
        });
      }).catch((error: unknown) => {
        if (!this.activeMenu || epoch !== this.menuEpoch) return;
        const node = document.getElementById('pvp-stats');
        if (node) node.textContent = error instanceof Error ? `PvP record unavailable: ${error.message}` : 'PvP record unavailable.';
      });
    }
  }

  private begin(save: ReturnType<typeof newSave>, mode: VoyageMode = 'campaign'): void {
    this.menuEpoch++;
    sfx.init();
    resetSession(save, mode);
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
