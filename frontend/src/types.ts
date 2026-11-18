export type OreType = 'quartz' | 'helium3' | 'darkMatter';

export type UpgradeId =
  | 'vultureDrillCore'
  | 'reinforcedSuit'
  | 'cargoModule'
  | 'landingThrusters'
  | 'thermalRegulator'
  | 'empCapacitor'
  | 'navigationModule';

export interface MinerState {
  callsign: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  heat: number;
  peakHeat: number;
  drillLevel: number;
  cargoCapacity: number;
  cargoBillions: number;
  savedBillions: number;
  pillsDelivered: number;
  shipmentsLaunched: number;
  adrianaSafe: boolean;
  empEnergy: number;
  empCooldownTicks: number;
  empStunTicksRemaining: number;
  collisionInvulnerabilityTicks: number;
  activeUpgrades: UpgradeId[];
}

export interface RunSummary {
  seed: number;
  callsign: string;
  durationSeconds: number;
  finalSavingsBillions: number;
  cargoBillions: number;
  shipmentsLaunched: number;
  pillsDelivered: number;
  peakHeat: number;
  finalHealth: number;
  completionStatus: 'VICTORY' | 'GAME_OVER';
  lossReason: 'NONE' | 'HULL' | 'CANNON';
  selectedUpgrades: UpgradeId[];
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface OreDeposit extends WorldPoint {
  id: string;
  type: OreType;
  active: boolean;
}

export interface CraterWorld {
  seed: number;
  width: number;
  height: number;
  tileSize: number;
  walls: boolean[][];
  ores: OreDeposit[];
  thermalVents: WorldPoint[];
  radiationPockets: WorldPoint[];
  enemySpawnPoints: WorldPoint[];
  base: WorldPoint;
  launchZone: WorldPoint;
  playerSpawn: WorldPoint;
}
