import { BALANCE } from './balance';
import type { MinerState, OreType, UpgradeId } from './types';
import { normalizeCallsign } from './callsign';

export function createMiner(callsign?: string): MinerState {
  return {
    callsign: normalizeCallsign(callsign),
    x: 0,
    y: 0,
    health: 100,
    maxHealth: 100,
    heat: 0,
    peakHeat: 0,
    drillLevel: 1,
    cargoCapacity: 300,
    cargoBillions: 0,
    savedBillions: 0,
    pillsDelivered: 0,
    shipmentsLaunched: 0,
    adrianaSafe: false,
    empEnergy: 100,
    empCooldownTicks: 0,
    empStunTicksRemaining: 0,
    collisionInvulnerabilityTicks: 0,
    activeUpgrades: [],
  };
}

export function mineOre(
  miner: MinerState,
  oreType: OreType,
  heatCostOverride?: number,
): number {
  const ore = BALANCE.ore[oreType];
  const value = ore.baseValueBillions * miner.drillLevel;
  const available = miner.cargoCapacity - miner.cargoBillions;
  const minedValue = Math.max(0, Math.min(value, available));

  miner.cargoBillions += minedValue;
  const heatCost = heatCostOverride ?? ore.heatPercent;
  miner.heat = Math.min(100, miner.heat + heatCost);
  miner.peakHeat = Math.max(miner.peakHeat, miner.heat);

  return minedValue;
}

export function takeDamage(miner: MinerState, amount: number): number {
  if (miner.collisionInvulnerabilityTicks > 0) {
    return miner.health;
  }

  miner.health = Math.max(0, miner.health - Math.max(0, amount));
  miner.collisionInvulnerabilityTicks = BALANCE.collisionInvulnerabilityTicks;
  return miner.health;
}

export function updateSuit(
  miner: MinerState,
  atBase: boolean,
  inThermalVent = false,
): void {
  if (atBase) {
    miner.health = Math.min(miner.maxHealth, miner.health + BALANCE.baseRepairPerTick);
    miner.heat = Math.max(0, miner.heat - BALANCE.baseCoolingPerTick);
  } else if (inThermalVent) {
    miner.heat = Math.max(0, miner.heat - BALANCE.thermalVentCoolingPerTick);
  } else {
    miner.heat = Math.max(0, miner.heat - BALANCE.explorationCoolingPerTick);
  }

  miner.empCooldownTicks = Math.max(0, miner.empCooldownTicks - 1);
  miner.empStunTicksRemaining = Math.max(0, miner.empStunTicksRemaining - 1);
  miner.collisionInvulnerabilityTicks = Math.max(
    0,
    miner.collisionInvulnerabilityTicks - 1,
  );
}

export function applyUpgrade(
  miner: MinerState,
  upgrade: UpgradeId,
): void {
  if (miner.activeUpgrades.includes(upgrade)) {
    return;
  }

  miner.activeUpgrades.push(upgrade);

  switch (upgrade) {
    case 'vultureDrillCore':
      miner.drillLevel += 1;
      break;
    case 'reinforcedSuit':
      miner.maxHealth = 150;
      miner.health = Math.min(150, miner.health + 50);
      break;
    case 'cargoModule':
      miner.cargoCapacity += 100;
      break;
    case 'landingThrusters':
    case 'thermalRegulator':
    case 'empCapacitor':
    case 'navigationModule':
      break;
  }
}
