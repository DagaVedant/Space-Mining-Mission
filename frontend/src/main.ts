import Phaser from 'phaser';
import './style.css';
import { MenuScene } from './scenes/MenuScene';
import { PlayScene } from './scenes/PlayScene';
import { PvpScene } from './scenes/PvpScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: 1280,
  height: 720,
  backgroundColor: '#07090c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
  scene: [MenuScene, PlayScene, PvpScene],
  // powerPreference asks laptops with two GPUs for the faster one
  render: { pixelArt: true, antialias: false, roundPixels: true, powerPreference: 'high-performance' },
});
