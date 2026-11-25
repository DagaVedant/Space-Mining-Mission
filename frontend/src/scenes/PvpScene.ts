import Phaser from 'phaser';
import { buildTextures } from '../art';
import { accountToken, websocketUrl } from '../cloud';
import { SHIP_SKINS } from '../data';
import { loadSettings, type GameSettings } from '../settings';
import { session } from '../session';
import { mountTouchControls, type TouchControls } from '../touch';

interface RemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  hp: number;
}

interface RemoteProjectile {
  x: number;
  y: number;
}

interface PvPMessage {
  type: string;
  message?: string;
  username?: string;
  matchId?: string;
  playerId?: string;
  opponent?: string;
  world?: { width: number; height: number };
  players?: RemotePlayer[];
  projectiles?: RemoteProjectile[];
  reason?: string;
  winner?: string;
  ranked?: boolean;
  ratingChange?: number;
  rating?: number;
  opponentRating?: number;
  season?: string;
  sentAt?: number;
}

interface ShipView {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
}

export class PvpScene extends Phaser.Scene {
  private socket: WebSocket | null = null;
  private status!: Phaser.GameObjects.Text;
  private connection!: Phaser.GameObjects.Text;
  private ships = new Map<string, ShipView>();
  private shots!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private localId = '';
  private opponent = '';
  private world = { width: 1500, height: 900 };
  private sendTick = 0;
  private ended = false;
  private settings!: GameSettings;
  private touch!: TouchControls;
  private queueTimeout: Phaser.Time.TimerEvent | null = null;
  private pingTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('PvP');
  }

  create(): void {
    this.settings = loadSettings();
    buildTextures(this);
    this.cameras.main.setBackgroundColor(0x07090c);
    this.physics.world.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
    this.cameras.main.centerOn(this.world.width / 2, this.world.height / 2);
    this.drawArena();
    this.shots = this.add.graphics().setDepth(6);
    this.status = this.add
      .text(640, 24, 'Connecting to the battle network...', {
        fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
        fontSize: '22px',
        color: '#ffffff',
        stroke: '#07090c',
        strokeThickness: 5,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20);
    this.connection = this.add
      .text(1260, 24, 'Connecting...', {
        fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
        fontSize: '13px',
        color: '#dedede',
        stroke: '#07090c',
        strokeThickness: 4,
        align: 'right',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(20);
    this.add
      .text(640, 690, 'Move | Mouse aim | Click / configured fire to shoot | Esc leave | R rematch', {
        fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
        fontSize: '16px',
        color: '#c6c6c6',
        stroke: '#07090c',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20);
    const bindingKeys = Object.values(this.settings.bindings);
    this.keys = this.input.keyboard!.addKeys(
      [...new Set([...bindingKeys, 'UP', 'LEFT', 'DOWN', 'RIGHT', 'SPACE', 'ENTER', 'ESC', 'R'])].join(','),
    ) as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.keys[this.settings.bindings.pause]?.on('down', this.leave, this);
    this.touch = mountTouchControls();
    const dockButton = document.querySelector<HTMLElement>('#touch-controls [data-touch="interact"]');
    if (dockButton) dockButton.style.display = 'none';
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.connect();
  }

  private drawArena(): void {
    const grid = this.add.graphics().setDepth(-1);
    grid.lineStyle(1, 0x182028, 0.8);
    for (let x = 0; x <= this.world.width; x += 100) grid.lineBetween(x, 0, x, this.world.height);
    for (let y = 0; y <= this.world.height; y += 100) grid.lineBetween(0, y, this.world.width, y);
    grid.lineStyle(8, 0x5a2a24, 1);
    grid.strokeRect(0, 0, this.world.width, this.world.height);
    grid.lineStyle(2, 0xe8832a, 0.35);
    grid.strokeCircle(this.world.width / 2, this.world.height / 2, 180);
    for (let i = 0; i < 80; i++) {
      const x = (i * 197 + 41) % this.world.width;
      const y = (i * 113 + 73) % this.world.height;
      grid.fillStyle(i % 5 === 0 ? 0x95623a : 0x47515b, 0.8);
      grid.fillCircle(x, y, 4 + (i % 5) * 2);
    }
  }

  private connect(): void {
    const token = accountToken();
    if (!token) {
      this.fail('Sign in from the home screen before joining PvP.');
      return;
    }
    try {
      this.socket = new WebSocket(websocketUrl());
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Unable to open the PvP connection.');
      return;
    }
    this.socket.addEventListener('open', () => {
      this.connection.setText('Connected · measuring ping').setColor('#80cf88');
      this.send({ type: 'authenticate', token });
      this.pingTimer = this.time.addEvent({
        delay: 2000,
        loop: true,
        callback: () => this.send({ type: 'ping', sentAt: performance.now() }),
      });
    });
    this.socket.addEventListener('message', (event) => this.onMessage(String(event.data)));
    this.socket.addEventListener('error', () => this.fail('PvP connection failed. Check that the backend is online.'));
    this.socket.addEventListener('close', (event) => {
      if (!this.ended && event.code !== 1000) this.fail('Disconnected from the PvP server.');
    });
  }

  private onMessage(raw: string): void {
    let message: PvPMessage;
    try {
      message = JSON.parse(raw) as PvPMessage;
    } catch {
      this.fail('The PvP server sent an invalid response.');
      return;
    }
    if (message.type === 'authenticated') {
      this.status.setText(`Signed in as ${message.username ?? 'pilot'} · finding an opponent...`);
      this.send({ type: 'queue', ranked: session.pvpRanked });
    } else if (message.type === 'queued') {
      this.status.setText(
        message.ranked
          ? `Ranked search · ${message.season ?? 'current season'} · rating ${message.rating ?? 1000} · Esc cancels`
          : 'Casual search · looking for a pilot · Esc cancels',
      );
      this.queueTimeout?.remove(false);
      this.queueTimeout = this.time.delayedCall(45_000, () => {
        if (this.localId || this.ended) return;
        this.send({ type: 'leave-queue' });
        this.ended = true;
        this.status.setText('Queue timed out · Press Enter or Esc to return.');
        this.keys.ENTER.once('down', this.leave, this);
      });
    } else if (message.type === 'match-found') {
      this.queueTimeout?.remove(false);
      this.queueTimeout = null;
      this.ended = false;
      this.localId = message.playerId ?? '';
      this.opponent = message.opponent ?? 'Rival pilot';
      this.world = message.world ?? this.world;
      this.cameras.main.setBounds(0, 0, this.world.width, this.world.height);
      this.status.setText(
        `${message.ranked ? 'RANKED DOGFIGHT' : 'DOGFIGHT'} · You vs ${this.opponent}` +
          (message.ranked && message.opponentRating !== undefined ? ` · Rating ${message.rating ?? 1000} vs ${message.opponentRating}` : ''),
      );
      this.add
        .text(640, 62, 'Destroy the rival ship to win the match.', {
          fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
          fontSize: '17px',
          color: '#e8a44b',
          stroke: '#07090c',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(20);
    } else if (message.type === 'snapshot') {
      this.renderSnapshot(message.players ?? [], message.projectiles ?? []);
    } else if (message.type === 'match-ended') {
      this.ended = true;
      const won = message.winner === this.localId;
      const rating = message.ranked
        ? ` · Rating ${message.ratingChange !== undefined && message.ratingChange > 0 ? '+' : ''}${message.ratingChange ?? 0}`
        : '';
      this.status.setText(
        `${message.reason === 'opponent-disconnected' ? 'Rival disconnected - you win.' : won ? 'VICTORY' : 'DEFEAT'}${rating} · Enter: menu | R: rematch`,
      );
      this.keys.ENTER.once('down', this.leave, this);
      this.keys.R.once('down', this.rematch, this);
    } else if (message.type === 'error') {
      this.fail(message.message ?? 'PvP server rejected the request.');
    } else if (message.type === 'pong' && typeof message.sentAt === 'number') {
      const rtt = Math.max(0, Math.round(performance.now() - message.sentAt));
      const quality = rtt < 120 ? 'Good' : rtt < 250 ? 'Fair' : 'Poor';
      this.connection
        .setText(`${quality} connection · ${rtt} ms`)
        .setColor(rtt < 120 ? '#80cf88' : rtt < 250 ? '#f0ce72' : '#ff8277');
    }
  }

  private renderSnapshot(players: RemotePlayer[], projectiles: RemoteProjectile[]): void {
    for (const player of players) {
      let view = this.ships.get(player.id);
      if (!view) {
        const tint = player.id === this.localId
          ? SHIP_SKINS.find((skin) => skin.id === session.save.selectedSkin)?.tint ?? 0xffffff
          : 0xff6b58;
        const sprite = this.add.image(player.x, player.y, 'ship').setTint(tint).setDepth(5).setScale(1.15);
        const label = this.add
          .text(player.x, player.y - 42, player.name, {
            fontFamily: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
            fontSize: '15px',
            color: '#ffffff',
            stroke: '#07090c',
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(8);
        const bar = this.add.rectangle(player.x, player.y - 28, 54, 6, 0x55b13a).setOrigin(0.5).setDepth(8);
        view = { sprite, label, bar };
        this.ships.set(player.id, view);
      }
      view.sprite.setPosition(player.x, player.y).setRotation(player.rotation);
      view.label.setPosition(player.x, player.y - 42).setText(player.name);
      view.bar.setPosition(player.x, player.y - 28).setScale(Math.max(0, player.hp / 100), 1);
      view.bar.setFillStyle(player.hp > 35 ? 0x55b13a : 0xc24848);
    }
    this.shots.clear();
    this.shots.fillStyle(0xffd074, 1);
    for (const projectile of projectiles) this.shots.fillCircle(projectile.x, projectile.y, 4);
  }

  update(_time: number, delta: number): void {
    if (this.ended || !this.localId || this.socket?.readyState !== WebSocket.OPEN) return;
    this.sendTick += delta;
    if (this.sendTick < 50) return;
    this.sendTick = 0;
    const keys = this.keys;
    let ax = Number(this.actionDown('right') || keys.RIGHT.isDown) - Number(this.actionDown('left') || keys.LEFT.isDown);
    let ay = Number(this.actionDown('down') || keys.DOWN.isDown) - Number(this.actionDown('up') || keys.UP.isDown);
    ax += this.touch.state.moveX;
    ay += this.touch.state.moveY;
    const magnitude = Math.hypot(ax, ay);
    if (magnitude > 1) {
      ax /= magnitude;
      ay /= magnitude;
    }
    const ship = this.ships.get(this.localId)?.sprite;
    const pointer = this.input.activePointer;
    let aim = ship?.rotation ?? 0;
    if (ship) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      aim = Math.atan2(worldPoint.y - ship.y, worldPoint.x - ship.x);
    }
    if (this.touch.state.aim !== null) aim = this.touch.state.aim;
    this.send({
      type: 'input',
      ax,
      ay,
      aim,
      fire: pointer.leftButtonDown() || this.actionDown('fire') || this.touch.state.firing,
      boost: this.actionDown('boost') || this.touch.state.boosting,
    });
  }

  private actionDown(action: 'up' | 'down' | 'left' | 'right' | 'fire' | 'boost'): boolean {
    return this.keys[this.settings.bindings[action]]?.isDown ?? false;
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private fail(message: string): void {
    this.connection?.setText('Connection lost').setColor('#ff8277');
    this.status?.setText(`${message} · Press Enter or Esc to return.`);
    this.keys?.ENTER.once('down', this.leave, this);
  }

  private leave(): void {
    this.ended = true;
    this.send({ type: 'leave-queue' });
    this.socket?.close(1000, 'leaving');
    this.scene.start('Menu');
  }

  private rematch(): void {
    if (!this.ended) return;
    this.ended = false;
    this.localId = '';
    this.opponent = '';
    for (const view of this.ships.values()) {
      view.sprite.destroy();
      view.label.destroy();
      view.bar.destroy();
    }
    this.ships.clear();
    this.status.setText('Searching for a pilot...');
    this.send({ type: 'queue', ranked: session.pvpRanked });
  }

  private shutdown(): void {
    this.keys?.[this.settings?.bindings.pause]?.off('down', this.leave, this);
    this.queueTimeout?.remove(false);
    this.queueTimeout = null;
    this.pingTimer?.remove(false);
    this.pingTimer = null;
    this.socket?.close(1000, 'scene-shutdown');
    this.socket = null;
    this.touch?.destroy();
    this.ships.clear();
  }
}
