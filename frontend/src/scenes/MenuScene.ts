import Phaser from 'phaser';
import { sfx } from '../audio';
import { AST_R, VARIANTS, buildTextures, type Sz } from '../art';
import { ORE_IDS } from '../data';
import { clearSave, loadSave, newSave, persist } from '../progress';
import { resetSession } from '../session';
import { closeOverlay, showMenu } from '../ui';

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

  constructor() {
    super('Menu');
  }

  create(): void {
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

    const save = loadSave();
    showMenu(
      save,
      () => {
        if (!save) return;
        this.begin(save);
      },
      () => {
        clearSave();
        const fresh = newSave();
        persist(fresh);
        this.begin(fresh);
      },
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => closeOverlay());
  }

  private begin(save: ReturnType<typeof newSave>): void {
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
