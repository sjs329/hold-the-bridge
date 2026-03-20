export const VIEWPORT_PADDING = 10;
export const LANDSCAPE_ASPECT = 4 / 3;
export const PORTRAIT_ASPECT = 3 / 4;

// Central controls. `intensity` is still the single high-level knob.
export const GAME_TUNING = {
  intensity: 1.12,
  player: {
    startingLives: 3,
    maxLives: 6
  },
  gun: {
    maxMultiUpgradesPerLevel: 1,
    multiShotChance: 0.35,
    shootDelayBoost: 0.025
  },
  leftLane: {
    gunChanceBase: 0.22,
    gunChancePerLevel: 0.05,
    gunChanceMax: 0.55,
    empDuration: 3.2,
    empSlowMultiplier: 0.60
  },
  transition: {
    duration: 1.25,
    wallRestoreFraction: 0.25,
    clearEnemiesOnTransition: false
  },
  endless: {
    spawnDropPerLevel: 0.12,
    maxActivePerLevel: 1,
    burstChancePerLevel: 0.03,
    speedPerLevel: 0.35,
    healthBonusEveryLevels: 2,
    eliteChancePerLevel: 0.02,
    attackDropPerLevel: 0.04,
    powerupLockPerLevels: 3,
    powerupIntervalDropPerLevel: 0.04,
    wallHealthDropPerLevel: 1,
    gunCapRaiseEveryLevels: 2,
    gunFloorDropPerLevel: 0.003,
    gunFloorMin: 0.10
  }
};

// Explicit level data. Tune these values to craft levels directly.
export const LEVEL_DEFS = [
  {
    level: 1,
    enemyQuota: 125,
    enemy: { spawnInterval: 1.15, maxActive: 24, burstChance: 0.75, speedMin: 24.0, speedMax: 32.0, healthBonus: 2, eliteChance: 0.30, attackMin: 1.05, attackMax: 1.55 },
    powerups: { intervalMin: 4.2, intervalMax: 5.8, lockBase: 4, lockRange: 2 },
    gun: { maxMultiShot: 3, shootDelayFloor: 0.16 },
    wall: { maxHealth: 40 }
  },
  {
    level: 2,
    enemyQuota: 160,
    enemy: { spawnInterval: 1.0, maxActive: 27, burstChance: 0.82, speedMin: 26.0, speedMax: 35.0, healthBonus: 2, eliteChance: 0.36, attackMin: 0.92, attackMax: 1.42 },
    powerups: { intervalMin: 3.9, intervalMax: 5.4, lockBase: 4, lockRange: 3 },
    gun: { maxMultiShot: 3, shootDelayFloor: 0.15 },
    wall: { maxHealth: 38 }
  },
  {
    level: 3,
    enemyQuota: 200,
    enemy: { spawnInterval: 0.9, maxActive: 30, burstChance: 0.88, speedMin: 28.0, speedMax: 38.0, healthBonus: 3, eliteChance: 0.42, attackMin: 0.82, attackMax: 1.30 },
    powerups: { intervalMin: 3.5, intervalMax: 5.0, lockBase: 5, lockRange: 3 },
    gun: { maxMultiShot: 4, shootDelayFloor: 0.14 },
    wall: { maxHealth: 36 }
  },
  {
    level: 4,
    enemyQuota: 245,
    enemy: { spawnInterval: 0.8, maxActive: 34, burstChance: 0.94, speedMin: 30.0, speedMax: 41.0, healthBonus: 3, eliteChance: 0.48, attackMin: 0.74, attackMax: 1.18 },
    powerups: { intervalMin: 3.2, intervalMax: 4.6, lockBase: 5, lockRange: 4 },
    gun: { maxMultiShot: 4, shootDelayFloor: 0.13 },
    wall: { maxHealth: 34 }
  },
  {
    level: 5,
    enemyQuota: 300,
    enemy: { spawnInterval: 0.74, maxActive: 38, burstChance: 0.96, speedMin: 32.0, speedMax: 44.0, healthBonus: 4, eliteChance: 0.54, attackMin: 0.68, attackMax: 1.08 },
    powerups: { intervalMin: 3.0, intervalMax: 4.3, lockBase: 6, lockRange: 4 },
    gun: { maxMultiShot: 5, shootDelayFloor: 0.12 },
    wall: { maxHealth: 32 }
  },
  {
    level: 6,
    enemyQuota: 360,
    enemy: { spawnInterval: 0.68, maxActive: 42, burstChance: 0.97, speedMin: 34.0, speedMax: 47.0, healthBonus: 4, eliteChance: 0.60, attackMin: 0.62, attackMax: 1.00 },
    powerups: { intervalMin: 2.8, intervalMax: 4.0, lockBase: 6, lockRange: 5 },
    gun: { maxMultiShot: 5, shootDelayFloor: 0.11 },
    wall: { maxHealth: 30 }
  }
];
