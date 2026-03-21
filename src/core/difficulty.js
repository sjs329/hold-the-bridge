(function(){
  const { clamp } = window.CoreMath;

  function createDifficultySystem(levelDefs, tuning){
    const levelDefsByLevel = new Map(levelDefs.map(def => [def.level, def]));
    const difficultyCache = new Map();

    function getLevelDef(currentLevel){
      const lvl = Math.max(1, currentLevel);
      const direct = levelDefsByLevel.get(lvl) || levelDefs.find(def => def.level === lvl);
      if(direct){
        levelDefsByLevel.set(lvl, direct);
        return direct;
      }

      // Endless fallback after authored levels.
      const last = levelDefs[levelDefs.length - 1];
      const overflow = lvl - last.level;
      const e = tuning.endless;

      return {
        level: lvl,
        enemyQuota: last.enemyQuota + overflow * 55,
        enemy: {
          spawnInterval: Math.max(0.65, last.enemy.spawnInterval - overflow * e.spawnDropPerLevel),
          maxActive: Math.min(48, last.enemy.maxActive + overflow * e.maxActivePerLevel),
          burstChance: clamp(last.enemy.burstChance + overflow * e.burstChancePerLevel, 0.10, 0.97),
          speedMin: last.enemy.speedMin + overflow * e.speedPerLevel,
          speedMax: last.enemy.speedMax + overflow * e.speedPerLevel,
          healthBonus: last.enemy.healthBonus + Math.floor(overflow / e.healthBonusEveryLevels),
          eliteChance: clamp(last.enemy.eliteChance + overflow * e.eliteChancePerLevel, 0.10, 0.85),
          attackMin: Math.max(0.60, last.enemy.attackMin - overflow * e.attackDropPerLevel),
          attackMax: Math.max(0.90, last.enemy.attackMax - overflow * e.attackDropPerLevel),
          giantChance: clamp(last.enemy.giantChance + overflow * e.giantChancePerLevel, 0, 0.45),
          smallChance: clamp(last.enemy.smallChance - overflow * e.smallChanceDropPerLevel, 0.05, 0.40),
          bossChance: clamp((last.enemy.bossChance || 0) + overflow * e.bossChancePerLevel, 0, 0.30)
        },
        powerups: {
          intervalMin: Math.max(1.8, last.powerups.intervalMin - overflow * e.powerupIntervalDropPerLevel),
          intervalMax: Math.max(2.4, last.powerups.intervalMax - overflow * e.powerupIntervalDropPerLevel),
          lockBase: last.powerups.lockBase + Math.floor(overflow / e.powerupLockPerLevels),
          lockRange: last.powerups.lockRange + Math.floor(overflow / (e.powerupLockPerLevels + 1))
        },
        gun: {
          maxMultiShot: Math.min(6, last.gun.maxMultiShot + Math.floor(overflow / e.gunCapRaiseEveryLevels)),
          shootDelayFloor: Math.max(e.gunFloorMin, last.gun.shootDelayFloor - overflow * e.gunFloorDropPerLevel)
        },
        wall: {
          maxHealth: Math.max(24, last.wall.maxHealth - overflow * e.wallHealthDropPerLevel)
        }
      };
    }

    function getDifficultyForLevel(currentLevel){
      const lvl = Math.max(1, currentLevel);
      const cached = difficultyCache.get(lvl);
      if(cached) return cached;

      const def = getLevelDef(lvl);
      const intensity = tuning.intensity;
      const enemy = def.enemy;
      const powerups = def.powerups;
      const gun = def.gun;

      const spawnInterval = Math.max(0.55, enemy.spawnInterval / intensity);
      const maxActive = Math.max(1, Math.round(enemy.maxActive * (0.88 + 0.20 * intensity)));
      const burstChance = clamp(enemy.burstChance * (0.90 + 0.20 * intensity), 0.05, 0.97);
      const speedMin = enemy.speedMin * intensity;
      const speedMax = enemy.speedMax * intensity;
      const healthBonus = enemy.healthBonus + (intensity >= 1.35 ? 1 : 0);
      const eliteChance = clamp(enemy.eliteChance * (0.90 + 0.20 * intensity), 0.05, 0.95);
      const attackMin = Math.max(0.45, enemy.attackMin / intensity);
      const attackMax = Math.max(0.75, enemy.attackMax / intensity);
      const giantChance = enemy.giantChance;
      const smallChance = enemy.smallChance;
      const bossChance = enemy.bossChance || 0;

      const difficulty = {
        spawnInterval,
        maxActive,
        burstChance,
        speedMin,
        speedMax,
        healthBonus,
        eliteChance,
        attackMin,
        attackMax,
        giantChance,
        smallChance,
        bossChance,
        powerupIntervalMin: powerups.intervalMin,
        powerupIntervalMax: powerups.intervalMax,
        lockBase: powerups.lockBase,
        lockRange: powerups.lockRange,
        enemyQuota: Math.max(10, Math.round(def.enemyQuota)),
        gunMaxMultiShot: Math.max(1, Math.round(gun.maxMultiShot)),
        gunMaxMultiUpgradesPerLevel: Math.max(0, Math.round(tuning.gun.maxMultiUpgradesPerLevel)),
        gunShootDelayFloor: Math.max(0.08, gun.shootDelayFloor),
        gunMultiShotChance: tuning.gun.multiShotChance,
        gunShootDelayBoost: tuning.gun.shootDelayBoost,
        wallMaxHealth: Math.max(10, Math.round(def.wall.maxHealth))
      };

      difficultyCache.set(lvl, difficulty);
      return difficulty;
    }

    function clearCaches(){
      difficultyCache.clear();
    }

    return {
      getLevelDef,
      getDifficultyForLevel,
      clearCaches
    };
  }

  window.CoreDifficulty = {
    createDifficultySystem
  };
})();
