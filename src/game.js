(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const hudEl = document.getElementById('hud');
  const pauseButton = document.getElementById('pause-button');
  const statusEl = document.getElementById('status');
  const gameContainer = document.getElementById('game-container');

  const VIEWPORT_PADDING = 10;
  const LANDSCAPE_ASPECT = 4 / 3;
  const PORTRAIT_ASPECT = 3 / 4;

  let W = 800, H = 600;
  function resize(){
    const viewportW = Math.max(320, window.innerWidth - VIEWPORT_PADDING*2);
    const viewportH = Math.max(360, window.innerHeight - VIEWPORT_PADDING*2);
    const targetAspect = viewportH > viewportW ? PORTRAIT_ASPECT : LANDSCAPE_ASPECT;

    let nextW = viewportW;
    let nextH = nextW / targetAspect;
    if(nextH > viewportH){
      nextH = viewportH;
      nextW = nextH * targetAspect;
    }

    W = Math.round(nextW);
    H = Math.round(nextH);

    gameContainer.style.width = `${W}px`;
    gameContainer.style.height = `${H}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // Central controls. `intensity` is still the single high-level knob.
  const GAME_TUNING = {
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
  const LEVEL_DEFS = [
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

  // Input
  const keys = {};
  let pointerActive = false;
  let pointerX = W/2;

  function toCanvasX(clientX){
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (W / Math.max(1, rect.width));
    return clamp(x, 0, W);
  }

  function updatePauseButton(){
    pauseButton.disabled = !running;
    pauseButton.textContent = paused ? '>' : 'II';
    pauseButton.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
  }

  // Start game on any key; Space toggles pause while running.
  window.addEventListener('keydown', e=>{
    if(e.code==='Space' && running){
      e.preventDefault();
      togglePause();
      return;
    }
    keys[e.code]=true;
    if(!running && !['F5','F12','Tab','Shift','Control','Alt','Meta','CapsLock','Escape'].includes(e.code)) startGame();
  });
  window.addEventListener('keyup', e=>{ keys[e.code]=false; });

  canvas.addEventListener('pointerdown', e=>{
    if(e.button !== undefined && e.button !== 0) return;
    pointerActive = true;
    pointerX = toCanvasX(e.clientX);
    if(!running) startGame();
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', e=>{
    if(!pointerActive) return;
    pointerX = toCanvasX(e.clientX);
    e.preventDefault();
  });

  function releasePointer(){
    pointerActive = false;
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', releasePointer);

  pauseButton.addEventListener('click', e=>{
    e.preventDefault();
    e.stopPropagation();
    if(!running) return;
    togglePause();
  });

  // Entities
  class Player{
    constructor(){
      this.w=40; this.h=28; this.x=W/2-this.w/2; this.y=H-80; this.speed=280; this.lives=GAME_TUNING.player.startingLives;
      this.shootDelay=0.25; this.shootTimer=0;
      this.multiShot=1; // number of bullets per shot
      this.bank=0; // steering roll for left/right motion
    }
    update(dt){
      this.y = H - 80;

      let moveX = 0;
      let keyboardMove = 0;
      if(keys['ArrowLeft']||keys['KeyA']) keyboardMove -= 1;
      if(keys['ArrowRight']||keys['KeyD']) keyboardMove += 1;

      if(keyboardMove !== 0){
        this.x += keyboardMove * this.speed * dt;
        moveX = keyboardMove;
      } else if(pointerActive){
        const targetLeft = pointerX - this.w/2;
        const delta = targetLeft - this.x;
        this.x = targetLeft;
        if(Math.abs(delta) > 0.01) moveX = delta > 0 ? 1 : -1;
      }

      // Keep the player on the bridge deck (inside side walls).
      const clampBounds = getPlayerRoadClamp(this.y + this.h, this.w);
      this.x = clamp(this.x, clampBounds.minX, clampBounds.maxX);

      const targetBank = moveX * 0.30;
      this.bank += (targetBank - this.bank) * Math.min(1, dt*10);

      this.shootTimer -= dt;
      if(this.shootTimer<=0){ this.shoot(); this.shootTimer=this.shootDelay; }
    }
    shoot(){
      // Multi-shot: shoot multiple bullets in a spread
      const center = this.x+this.w/2;
      const spread = 32;
      if(this.multiShot===1){
        bullets.push(new Bullet(center, this.y));
      } else {
        for(let i=0;i<this.multiShot;i++){
          // Spread bullets horizontally
          const offset = (i-(this.multiShot-1)/2)*spread/(this.multiShot-1||1);
          bullets.push(new Bullet(center+offset, this.y));
        }
      }
    }
    draw(){
      const cx = this.x + this.w/2;
      const road = getRoadBounds(this.y + this.h);
      const scale = 0.9 + 0.35*road.depthT;
      const w = this.w * scale;
      const h = this.h * scale;
      const x = cx - w/2;
      const y = this.y + (this.h - h);

      ctx.save();
      // Steering roll while keeping heading up-road.
      const pivotY = y + h*0.62;
      ctx.translate(cx, pivotY);
      ctx.rotate(this.bank);
      ctx.translate(-cx, -pivotY);

      // Contact shadow anchors the ship to the bridge surface.
      ctx.fillStyle='rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(cx, y + h + 4, w*0.42, h*0.20, 0, 0, Math.PI*2);
      ctx.fill();

      // Lower body
      ctx.fillStyle='#4fa7d8';
      ctx.beginPath();
      ctx.moveTo(x + w*0.06, y + h*0.92);
      ctx.lineTo(x + w*0.94, y + h*0.92);
      ctx.lineTo(x + w*0.72, y + h*0.48);
      ctx.lineTo(x + w*0.28, y + h*0.48);
      ctx.closePath();
      ctx.fill();

      // Nose / upper hull
      ctx.fillStyle='#8fe6ff';
      ctx.beginPath();
      ctx.moveTo(cx, y - h*0.12);
      ctx.lineTo(x + w*0.72, y + h*0.50);
      ctx.lineTo(x + w*0.28, y + h*0.50);
      ctx.closePath();
      ctx.fill();

      // Canopy
      ctx.fillStyle='#173145';
      ctx.beginPath();
      ctx.moveTo(cx, y + h*0.06);
      ctx.lineTo(x + w*0.60, y + h*0.46);
      ctx.lineTo(x + w*0.40, y + h*0.46);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Draw health/lives indicator above player
      for(let i=0;i<this.lives;i++){
        ctx.save();
        ctx.font='20px Arial';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#f44';
        ctx.fillText('❤', this.x+this.w/2 + (i-((this.lives-1)/2))*22, this.y-18);
        ctx.restore();
      }
    }
    bounds(){ return {x:this.x,y:this.y,w:this.w,h:this.h} }
  }

  class Bullet{
    constructor(x,y){
      this.y = y-6;
      this.r = 4;
      this.speed = 520;
      this.dead = false;

      // Store horizontal position in road-space so trajectory follows perspective lines.
      const road = getRoadBounds(this.y, true);
      const roadW = Math.max(1, road.right - road.left);
      this.roadT = clamp((x - road.left) / roadW, 0, 1);
      this.x = lerp(road.left, road.right, this.roadT);
    }
    update(dt){
      const roadNow = getRoadBounds(this.y, true);
      const speedMult = getPerspectiveSpeedMultiplier(clamp(roadNow.depthT, 0, 1));
      this.y -= this.speed * speedMult * dt;

      const g = getRoadGeometry();
      if(this.y < g.topY - 120){
        this.dead = true;
        return;
      }

      const road = getRoadBounds(this.y, true);
      this.x = lerp(road.left, road.right, this.roadT);

      // Shrink as the bullet moves toward the horizon.
      this.r = clamp(2 + 3*road.depthT, 0.7, 5.2);
    }
    draw(){ ctx.fillStyle='#ffd'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill() }
    bounds(){ return {x:this.x-this.r,y:this.y-this.r,w:this.r*2,h:this.r*2} }
  }

  class Enemy{
    constructor(laneT, y, s, health, attackMin, attackMax){
      this.laneT = laneT; // 0-1 position in lane
      this.y = y;
      this.speed = s||12;
      this.dead = false;
      this.maxHealthValue = Math.max(1, health||1);
      this.health = this.maxHealthValue;
      this.baseW = 36; this.baseH = 28;
      this.attackMin = attackMin || 1.2;
      this.attackMax = attackMax || 2.0;
      this.damageSeed = Math.random() * 1000;
      this.hitFlash = 0;
      this.resetAttackTimer();
    }
    resetAttackTimer(){ this.attackTimer = this.attackMin + Math.random()*(this.attackMax-this.attackMin); }
    getPerspective(){
      // Right lane perspective
      const g = getRoadGeometry();
      // Interpolate lane edge
      const frac = clamp((this.y-g.topY)/(g.bottomY-g.topY), 0, 1);
      const laneLeft = g.centerX + g.wallWidthTop/2 + frac*(g.centerX + g.wallWidthBottom/2 - (g.centerX + g.wallWidthTop/2));
      const laneRight = g.centerX + g.roadWidthTop/2 + frac*(g.centerX + g.roadWidthBottom/2 - (g.centerX + g.roadWidthTop/2));
      // Scale for perspective
      const perspectiveScale = 0.5 + 0.7*frac;
      const healthScale = clamp(1 + (this.maxHealth() - 1) * 0.22, 1, 1.8);
      const scale = perspectiveScale * healthScale;
      const w = this.baseW*scale;
      const h = this.baseH*scale;
      const laneWidth = Math.max(1, laneRight - laneLeft);
      const usableLane = Math.max(0, laneWidth - w);
      const x = laneLeft + clamp(this.laneT, 0, 1)*usableLane;
      return {x, y: this.y, w, h, scale};
    }
    update(dt){
      // Move with perspective-aware speed: slower at distance, faster up close.
      const depth = getRoadBounds(this.y).depthT;
      this.y += this.speed * getEnemySlowMultiplier() * getPerspectiveSpeedMultiplier(depth) * dt;
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      if(this.y>H+50) this.dead=true;
    }
    hit(){ this.health--; this.hitFlash = 1; if(this.health<=0) this.dead=true; }
    draw(){
      const p = this.getPerspective();
      const cx = p.x + p.w/2;
      const hpRatio = clamp(this.health / this.maxHealth(), 0, 1);
      const damageRatio = 1 - hpRatio;
      const flash = this.hitFlash;
      ctx.save();

      // Contact shadow on the bridge
      ctx.fillStyle='rgba(0,0,0,0.30)';
      ctx.beginPath();
      ctx.ellipse(cx, p.y + p.h, p.w*0.42, p.h*0.18, 0, 0, Math.PI*2);
      ctx.fill();

      const legW = p.w*0.22;
      const legH = p.h*0.34;
      const legY = p.y + p.h - legH;
      const legLight = Math.round(24 + hpRatio*12 + flash*10);
      ctx.fillStyle=`hsl(8, 38%, ${legLight}%)`;
      ctx.fillRect(cx - legW - p.w*0.05, legY, legW, legH);
      ctx.fillRect(cx + p.w*0.05, legY, legW, legH);

      const torsoW = p.w*0.58;
      const torsoH = p.h*0.52;
      const torsoX = cx - torsoW/2;
      const torsoY = legY - torsoH + 1;

      const torsoSat = Math.round(58 - damageRatio*26);
      const torsoLight = Math.round(55 - damageRatio*20 + flash*10);
      ctx.fillStyle=`hsl(2, ${torsoSat}%, ${torsoLight}%)`;
      ctx.beginPath();
      ctx.moveTo(torsoX + torsoW*0.10, torsoY + torsoH);
      ctx.lineTo(torsoX + torsoW*0.90, torsoY + torsoH);
      ctx.lineTo(torsoX + torsoW*0.72, torsoY);
      ctx.lineTo(torsoX + torsoW*0.28, torsoY);
      ctx.closePath();
      ctx.fill();

      // Integrated damage: chips/cracks appear directly on the body as HP drops.
      const chipCount = Math.floor(damageRatio * 5);
      if(chipCount > 0){
        ctx.fillStyle='rgba(20,8,8,0.62)';
        for(let i=0;i<chipCount;i++){
          const chipX = cx + Math.sin(this.damageSeed + i*1.9) * torsoW * 0.24;
          const chipY = torsoY + torsoH * (0.20 + i*0.17);
          const chipR = Math.max(1.1, p.scale*(1.7 + i*0.25));
          ctx.beginPath();
          ctx.arc(chipX, chipY, chipR, 0, Math.PI*2);
          ctx.fill();
        }
      }

      const crackCount = Math.floor(damageRatio * 3);
      if(crackCount > 0){
        ctx.strokeStyle='rgba(28,10,10,0.68)';
        ctx.lineWidth=Math.max(1, p.scale*1.1);
        for(let i=0;i<crackCount;i++){
          const startX = cx + Math.sin(this.damageSeed*1.7 + i*2.1) * torsoW * 0.16;
          const startY = torsoY + torsoH * (0.16 + i*0.24);
          const dir = i%2===0 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(startX + torsoW*0.18*dir, startY + torsoH*0.14);
          ctx.lineTo(startX + torsoW*0.05, startY + torsoH*0.30);
          ctx.stroke();
        }
      }

      const headR = Math.max(2, p.w*0.16);
      const headSat = Math.round(48 - damageRatio*18);
      const headLight = Math.round(46 - damageRatio*14 + flash*8);
      ctx.fillStyle=`hsl(3, ${headSat}%, ${headLight}%)`;
      ctx.beginPath();
      ctx.arc(cx, torsoY - headR*0.35, headR, 0, Math.PI*2);
      ctx.fill();

      const eyeHue = Math.round(6 + hpRatio*88);
      const eyeLight = Math.round(46 + hpRatio*16 + flash*18);
      ctx.fillStyle=`hsl(${eyeHue}, 90%, ${eyeLight}%)`;
      ctx.fillRect(cx - headR*0.45, torsoY - headR*0.48, headR*0.22, headR*0.14);
      ctx.fillRect(cx + headR*0.23, torsoY - headR*0.48, headR*0.22, headR*0.14);

      if(flash > 0.02){
        ctx.strokeStyle = `rgba(255, 240, 210, ${0.18 + flash*0.22})`;
        ctx.lineWidth = Math.max(1.2, p.scale*1.4);
        ctx.stroke();
      }
      ctx.restore();
    }
    maxHealth(){ return this.maxHealthValue; }
    bounds(){
      const p = this.getPerspective();
      return {x:p.x, y:p.y, w:p.w, h:p.h};
    }
  }

  class PowerUp{
    constructor(laneT, y, type, shots){
      this.laneT = laneT; // 0-1 position in lane
      this.y = y;
      this.type = type;
      this.speed = 90;
      this.dead = false;
      this.locked = true;
      this.shots = shots||2;
      this.maxShots = this.shots;
      this.baseW = 32; this.baseH = 32;
    }
    getPerspective(){
      // Left lane perspective
      const g = getRoadGeometry();
      const frac = clamp((this.y-g.topY)/(g.bottomY-g.topY), 0, 1);
      const laneLeft = g.centerX - g.roadWidthTop/2 + frac*(g.centerX - g.roadWidthBottom/2 - (g.centerX - g.roadWidthTop/2));
      const laneRight = g.centerX - g.wallWidthTop/2 + frac*(g.centerX - g.wallWidthBottom/2 - (g.centerX - g.wallWidthTop/2));
      const scale = 0.5 + 0.7*frac;
      const w = this.baseW*scale;
      const h = this.baseH*scale;
      const laneWidth = Math.max(1, laneRight - laneLeft);
      const usableLane = Math.max(0, laneWidth - w);
      const x = laneLeft + clamp(this.laneT, 0, 1)*usableLane;
      return {x, y: this.y, w, h, scale};
    }
    update(dt){
      const depth = getRoadBounds(this.y).depthT;
      this.y += this.speed * getPerspectiveSpeedMultiplier(depth) * dt;
      if(this.y>H+50) this.dead=true;
    }
    hit(){ if(this.locked){ this.shots--; if(this.shots<=0){ this.locked=false; } } }
    draw(){
      const p = this.getPerspective();
      ctx.save();
      ctx.globalAlpha = this.locked ? 0.7 : 1.0;
      ctx.fillStyle = this.type==='gun' ? '#ff0' : '#7de9ff';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      // Left-lane event icon
      ctx.fillStyle = '#222';
      ctx.font = `${Math.floor(18*p.scale)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.type==='gun' ? '🔫' : '⚡', p.x+p.w/2, p.y+p.h/2);
      if(this.locked){
        ctx.strokeStyle='#f00'; ctx.lineWidth=3*p.scale;
        ctx.strokeRect(p.x+3*p.scale, p.y+3*p.scale, p.w-6*p.scale, p.h-6*p.scale);
        ctx.fillStyle='#fff'; ctx.font=`bold ${Math.floor(16*p.scale)}px Arial`;
        ctx.fillText(this.shots, p.x+p.w/2, p.y+p.h-8*p.scale);
      }
      ctx.restore();
    }
    bounds(){
      const p = this.getPerspective();
      return {x:p.x, y:p.y, w:p.w, h:p.h};
    }
  }

  // Helpers
  function collide(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y }

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t){ return a + (b-a)*t; }

  function getRoadGeometry(){
    const roadWidthTop = clamp(W * 0.23, 150, 240);
    const roadWidthBottom = clamp(W * 0.68, 300, 700);
    const wallWidthTop = clamp(W * 0.015, 8, 16);
    const wallWidthBottom = clamp(W * 0.04, 18, 36);

    return {
      // Extend beyond viewport so the road has no visible hard start/stop.
      topY: -Math.round(H * 0.12),
      bottomY: H + Math.round(H * 0.15),
      roadWidthTop,
      roadWidthBottom,
      wallWidthTop,
      wallWidthBottom,
      centerX: W/2
    };
  }

  function getRoadBounds(y, extrapolate){
    const g = getRoadGeometry();
    const rawDepth = (y - g.topY) / (g.bottomY - g.topY);
    const depthT = extrapolate ? clamp(rawDepth, -0.35, 1.1) : clamp(rawDepth, 0, 1);
    const left = lerp(g.centerX - g.roadWidthTop/2, g.centerX - g.roadWidthBottom/2, depthT);
    const right = lerp(g.centerX + g.roadWidthTop/2, g.centerX + g.roadWidthBottom/2, depthT);
    return { left, right, depthT };
  }

  function getPlayerRoadClamp(y, playerW){
    const road = getRoadBounds(y);
    const sideInset = 16;
    const minX = road.left + sideInset;
    const maxX = road.right - sideInset - playerW;
    return { minX, maxX: Math.max(minX, maxX) };
  }

  function getPerspectiveSpeedMultiplier(depthT){
    // Average around 1.0x across depth while still selling perspective.
    return 0.4 + 1.2*clamp(depthT, 0, 1);
  }

  function getLeftLaneGunChance(currentLevel){
    const lane = GAME_TUNING.leftLane;
    return clamp(lane.gunChanceBase + (Math.max(1, currentLevel) - 1) * lane.gunChancePerLevel, lane.gunChanceBase, lane.gunChanceMax);
  }

  function getEnemySlowMultiplier(){
    return empTimer > 0 ? GAME_TUNING.leftLane.empSlowMultiplier : 1;
  }

  function getEnemyLaneBounds(y){
    const g = getRoadGeometry();
    const t = clamp((y - g.topY) / (g.bottomY - g.topY), 0, 1);
    const left = lerp(g.centerX + g.wallWidthTop/2, g.centerX + g.wallWidthBottom/2, t);
    const right = lerp(g.centerX + g.roadWidthTop/2, g.centerX + g.roadWidthBottom/2, t);
    return { left, right };
  }

  function getWallRect(){
    // Wall sits slightly up-road from the player and spans the full enemy lane.
    const y = player ? player.y - 14 : H - 94;
    const lane = getEnemyLaneBounds(y + 8);
    const pad = 2;
    return { x: lane.left + pad, y, w: Math.max(24, lane.right - lane.left - pad*2), h: 16 };
  }

  function getLevelDef(currentLevel){
    const lvl = Math.max(1, currentLevel);
    const direct = LEVEL_DEFS.find(def => def.level === lvl);
    if(direct) return direct;

    // Endless fallback after authored levels.
    const last = LEVEL_DEFS[LEVEL_DEFS.length - 1];
    const overflow = lvl - last.level;
    const e = GAME_TUNING.endless;

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
        attackMax: Math.max(0.90, last.enemy.attackMax - overflow * e.attackDropPerLevel)
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
    const def = getLevelDef(currentLevel);
    const intensity = GAME_TUNING.intensity;
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

    return {
      spawnInterval,
      maxActive,
      burstChance,
      speedMin,
      speedMax,
      healthBonus,
      eliteChance,
      attackMin,
      attackMax,
      powerupIntervalMin: powerups.intervalMin,
      powerupIntervalMax: powerups.intervalMax,
      lockBase: powerups.lockBase,
      lockRange: powerups.lockRange,
      enemyQuota: Math.max(10, Math.round(def.enemyQuota)),
      gunMaxMultiShot: Math.max(1, Math.round(gun.maxMultiShot)),
      gunMaxMultiUpgradesPerLevel: Math.max(0, Math.round(GAME_TUNING.gun.maxMultiUpgradesPerLevel)),
      gunShootDelayFloor: Math.max(0.08, gun.shootDelayFloor),
      gunMultiShotChance: GAME_TUNING.gun.multiShotChance,
      gunShootDelayBoost: GAME_TUNING.gun.shootDelayBoost,
      wallMaxHealth: Math.max(10, Math.round(def.wall.maxHealth))
    };
  }

  function startLevelTransition(newLevel){
    const cfg = GAME_TUNING.transition;
    levelTransitionTimer = cfg.duration;
    levelTransitionLabel = `Level ${newLevel}`;

    if(cfg.clearEnemiesOnTransition){
      enemies = [];
      bullets = [];
    }

    // Give a little breathing room each time a new level starts.
    const wallRestore = Math.max(0, Math.round(wallMax * cfg.wallRestoreFraction));
    wallHealth = Math.min(wallMax, wallHealth + wallRestore);
    if(wallHealth > 0) wallBroken = false;
  }

  function syncLevel(){
    const difficulty = getDifficultyForLevel(level);
    const levelComplete = levelSpawned >= difficulty.enemyQuota && enemies.length === 0;
    if(levelComplete){
      const wallRatio = wallBroken ? 0 : wallHealth / Math.max(1, wallMax);
      level++;
      levelSpawned = 0;
      levelMultiShotUpgrades = 0;
      empTimer = 0;
      const nextDifficulty = getDifficultyForLevel(level);
      wallMax = nextDifficulty.wallMaxHealth;
      wallHealth = wallBroken ? 0 : Math.max(1, Math.round(wallMax * wallRatio));
      spawnTimer = 0;
      startLevelTransition(level);
      updateUI();
    }
  }

  let player, bullets, enemies, powerups, lastTime, accum=0, spawnTimer=0, powerupTimer=0, running=false, paused=false;
  let level = 1;
  let levelSpawned = 0;
  let levelMultiShotUpgrades = 0;
  let empTimer = 0;
  let notifPopup = null, notifPopupTimer = 0;
  let levelTransitionTimer = 0, levelTransitionLabel = '';
  let wallHealth = LEVEL_DEFS[0].wall.maxHealth, wallMax = LEVEL_DEFS[0].wall.maxHealth, wallBroken = false;

  function reset(){
    player=new Player(); bullets=[]; enemies=[]; powerups=[];
    lastTime=performance.now(); spawnTimer=0; powerupTimer=0;
    level = 1;
    levelSpawned = 0;
    levelMultiShotUpgrades = 0;
    empTimer = 0;
    const openingDifficulty = getDifficultyForLevel(level);
    wallMax = openingDifficulty.wallMaxHealth;
    wallHealth = wallMax;
    wallBroken = false;
    notifPopup = null; notifPopupTimer = 0;
    levelTransitionTimer = 0; levelTransitionLabel = '';
    updateUI();
  }

  function spawnWave(dt){
    const difficulty = getDifficultyForLevel(level);
    const g = getRoadGeometry();
    spawnTimer -= dt;
    if(spawnTimer<=0){
      spawnTimer = difficulty.spawnInterval;
      const remainingForLevel = Math.max(0, difficulty.enemyQuota - levelSpawned);
      if(enemies.length < difficulty.maxActive && remainingForLevel > 0){
        const slots = Math.min(difficulty.maxActive - enemies.length, remainingForLevel);
        // Spawn in chunky bursts so waves feel like a rushing horde.
        let burst = 3;
        if(Math.random() < difficulty.burstChance) burst++;
        if(Math.random() < difficulty.burstChance * 0.85) burst++;
        if(Math.random() < difficulty.burstChance * 0.65) burst++;
        if(Math.random() < difficulty.burstChance * 0.40) burst++;
        burst = Math.min(slots, burst);
        for(let i=0;i<burst;i++){
          // Keep some clustering for horde feel without overwhelming density.
          const tBase = Math.random()*0.78 + 0.11;
          const t = tBase + (Math.random()-0.5)*0.10;
          const y = g.topY + 10 - Math.random()*26;
          const health = 1 + difficulty.healthBonus + (Math.random() < difficulty.eliteChance ? 1 : 0);
          const speed = difficulty.speedMin + Math.random()*(difficulty.speedMax - difficulty.speedMin);
          const enemy = new Enemy(clamp(t, 0, 1), y, speed, health, difficulty.attackMin, difficulty.attackMax);
          enemies.push(enemy);
          levelSpawned++;
        }
      }
    }
    // Left lane events: gun crates plus EMP crates.
    powerupTimer -= dt;
    if(powerupTimer<=0){
      powerupTimer = difficulty.powerupIntervalMin + Math.random()*(difficulty.powerupIntervalMax - difficulty.powerupIntervalMin);
      const t = Math.random();
      const y = g.topY + 8;
      const gunChance = getLeftLaneGunChance(level);
      const type = Math.random() < gunChance ? 'gun' : 'emp';
      const baseShots = difficulty.lockBase + Math.floor(Math.random()*(difficulty.lockRange + 1));
      const shots = type==='gun' ? baseShots : Math.max(2, baseShots - 1);
      powerups.push(new PowerUp(t, y, type, shots));
    }
  }

  function update(dt){
    accum += dt;

    if(empTimer > 0){
      const prevEmp = empTimer;
      empTimer = Math.max(0, empTimer - dt);
      if(prevEmp > 0 && empTimer === 0) updateUI();
    }

    if(levelTransitionTimer > 0){
      levelTransitionTimer -= dt;
      if(levelTransitionTimer <= 0){
        levelTransitionTimer = 0;
        levelTransitionLabel = '';
      }
      return;
    }

    player.update(dt);
    bullets.forEach(b=>b.update(dt)); bullets = bullets.filter(b=>!b.dead);
    enemies.forEach(e=>e.update(dt));
    powerups.forEach(p=>p.update(dt));

    // Bullet collisions: enemies (right lane)
    bullets.forEach(b=>{
      enemies.forEach(e=>{
        if(!e.dead && collide(b.bounds(), e.bounds())){
          e.hit();
          b.dead=true;
          if(e.dead) updateUI();
        }
      })
    });
    // Bullet collisions: powerups (left lane)
    bullets.forEach(b=>{
      powerups.forEach(p=>{
        if(collide(b.bounds(), p.bounds())){
          if(p.locked){
            p.hit(); b.dead=true;
          } else {
            // Grant powerup immediately on shot
            p.dead=true; b.dead=true;
            // Visual feedback on all unlock pickups
            canvas.style.boxShadow = '0 0 32px 8px #0ff';
            setTimeout(()=>{canvas.style.boxShadow='';}, 300);
            if(p.type==='gun'){
              const gunCap = getDifficultyForLevel(level);
              const canGainMulti = player.multiShot < gunCap.gunMaxMultiShot;
              const canGainMultiThisLevel = levelMultiShotUpgrades < gunCap.gunMaxMultiUpgradesPerLevel;
              const canGainRate = player.shootDelay > gunCap.gunShootDelayFloor + 0.001;
              if(canGainMulti && canGainMultiThisLevel && Math.random() < gunCap.gunMultiShotChance){
                player.multiShot++;
                levelMultiShotUpgrades++;
                statusEl.textContent = `Multi-Shot! Now shooting ${player.multiShot}!`;
                notifPopup = 'Multi-Shot';
              } else if(canGainRate) {
                player.shootDelay = Math.max(gunCap.gunShootDelayFloor, player.shootDelay-gunCap.gunShootDelayBoost);
                statusEl.textContent = 'Gun Power-Up! Faster shooting!';
                notifPopup = 'Gun Boost';
              } else if(canGainMulti && canGainMultiThisLevel){
                player.multiShot++;
                levelMultiShotUpgrades++;
                statusEl.textContent = `Multi-Shot! Now shooting ${player.multiShot}!`;
                notifPopup = 'Multi-Shot';
              } else if(canGainMulti && !canGainMultiThisLevel){
                statusEl.textContent = 'Multi-Shot Upgrade Used This Level';
                notifPopup = 'Level Limit';
              } else {
                statusEl.textContent = 'Gun Maxed For This Level';
                notifPopup = 'Maxed';
              }
            } else {
              empTimer = Math.max(empTimer, GAME_TUNING.leftLane.empDuration);
              statusEl.textContent = 'EMP Pulse! Horde Slowed';
              notifPopup = 'EMP';
            }
            notifPopupTimer = 1.2;
            setTimeout(()=>{statusEl.textContent='';}, 1200);
            updateUI();
          }
        }
      })
    });

    // Enemies -> wall first, then player if wall is broken
    const wallRect = getWallRect();
    for(const e of enemies){
      if(!wallBroken && collide(e.bounds(), wallRect)){
        // Keep the enemy pinned to the barrier and let it chip wall HP over time.
        const b = e.bounds();
        const overlap = (b.y + b.h) - wallRect.y;
        if(overlap > 0) e.y -= overlap;

        e.attackTimer -= dt;
        if(e.attackTimer <= 0){
          e.resetAttackTimer();
          wallHealth = Math.max(0, wallHealth - 1);
          if(wallHealth<=0){
            wallBroken = true;
            statusEl.textContent = 'Wall Broken!';
            setTimeout(()=>{ if(running) statusEl.textContent = ''; }, 900);
          }
          updateUI();
        }
        continue;
      }
      if(collide(e.bounds(), player.bounds())){
        e.dead=true; player.lives--; updateUI(); if(player.lives<=0) endGame(); break;
      }
    }
    // Powerups -> player (left lane)
    for(const p of powerups){
      if(collide(p.bounds(), player.bounds())){
        if(p.locked){
          p.dead=true; player.lives--; updateUI(); if(player.lives<=0) endGame();
        }
        // If not locked, do nothing (already handled by bullet)
      }
    }

    enemies = enemies.filter(e=>!e.dead);
    powerups = powerups.filter(p=>!p.dead);
    syncLevel();

    if(levelTransitionTimer <= 0) spawnWave(dt);
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    // Perspective road geometry
    const g = getRoadGeometry();
    const roadTopY = g.topY;
    const roadBottomY = g.bottomY;
    const roadWidthTop = g.roadWidthTop;
    const roadWidthBottom = g.roadWidthBottom;
    const roadCenterX = g.centerX;
    const wallWidthTop = g.wallWidthTop;
    const wallWidthBottom = g.wallWidthBottom;
    const sideTop = 18;
    const sideBottom = 44;
    const riverTop = Math.round(H * 0.31);
    const riverBottom = Math.round(H * 0.74);

    // Land background
    const landGrad = ctx.createLinearGradient(0, 0, 0, H);
    landGrad.addColorStop(0, '#23442f');
    landGrad.addColorStop(1, '#1f3828');
    ctx.fillStyle = landGrad;
    ctx.fillRect(0,0,W,H);

    // Horizontal river band
    const riverGrad = ctx.createLinearGradient(0, riverTop, W, riverTop);
    riverGrad.addColorStop(0.00, '#0b3d58');
    riverGrad.addColorStop(0.25, '#0f4c6b');
    riverGrad.addColorStop(0.50, '#0a4461');
    riverGrad.addColorStop(0.75, '#0f4c6b');
    riverGrad.addColorStop(1.00, '#0b3d58');
    ctx.fillStyle = riverGrad;
    ctx.fillRect(0, riverTop, W, riverBottom-riverTop);

    // Horizontal river flow streaks (left-right motion)
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = '#8fd3f2';
    ctx.lineWidth = 2;
    const riverH = riverBottom-riverTop;
    for(let i=0;i<10;i++){
      const y = riverTop + 16 + i*(riverH-32)/9 + Math.sin(accum*1.5 + i*0.8)*5;
      const drift = ((accum*170 + i*95) % (W + 360)) - 180;
      ctx.beginPath();
      ctx.moveTo(drift-220, y);
      ctx.bezierCurveTo(drift-60, y-8, drift+140, y+8, drift+320, y-2);
      ctx.stroke();
    }
    ctx.restore();

    // Shores (top and bottom banks)
    ctx.save();
    const topBankWobble = Math.sin(accum*0.8)*3;
    const botBankWobble = Math.cos(accum*0.7)*3;

    ctx.fillStyle = '#3b6847';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, riverTop + topBankWobble + 5);
    ctx.bezierCurveTo(W*0.70, riverTop+14, W*0.30, riverTop-9, 0, riverTop + topBankWobble + 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#335c3f';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(W, H);
    ctx.lineTo(W, riverBottom + botBankWobble - 5);
    ctx.bezierCurveTo(W*0.72, riverBottom-14, W*0.28, riverBottom+10, 0, riverBottom + botBankWobble - 2);
    ctx.closePath();
    ctx.fill();

    // Sandy lips where land meets water
    ctx.strokeStyle = 'rgba(221, 193, 136, 0.72)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, riverTop + topBankWobble + 6);
    ctx.bezierCurveTo(W*0.30, riverTop-5, W*0.70, riverTop+16, W, riverTop + topBankWobble + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, riverBottom + botBankWobble - 6);
    ctx.bezierCurveTo(W*0.28, riverBottom+7, W*0.72, riverBottom-17, W, riverBottom + botBankWobble - 8);
    ctx.stroke();

    // Vegetation patches on upper/lower banks
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = '#1f3b29';
    for(let i=0;i<13;i++){
      const x = (i*97 + 43) % W;
      const w = 18 + (i%4)*8;
      const h = 6 + (i%3)*4;
      const yTop = riverTop - 28 - ((i*17)%18);
      const yBot = riverBottom + 14 + ((i*23)%20);
      ctx.fillRect(x, yTop, w, h);
      ctx.fillRect((x+W*0.37)%W, yBot, w*0.9, h);
    }
    ctx.globalAlpha = 1;

    // Soft ripples close to banks
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#a9dbef';
    ctx.lineWidth = 1.2;
    for(let i=0;i<7;i++){
      const drift = ((accum*90 + i*140) % (W + 240)) - 120;
      const yA = riverTop + 14 + i*3;
      const yB = riverBottom - 14 - i*3;
      ctx.beginPath();
      ctx.moveTo(drift-90, yA);
      ctx.quadraticCurveTo(drift+20, yA-5, drift+130, yA);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(drift-90, yB);
      ctx.quadraticCurveTo(drift+20, yB+5, drift+130, yB);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Shore foam
    ctx.strokeStyle = 'rgba(206, 237, 247, 0.48)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, riverTop + topBankWobble + 2);
    ctx.bezierCurveTo(W*0.30, riverTop-9, W*0.70, riverTop+14, W, riverTop + topBankWobble + 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, riverBottom + botBankWobble - 2);
    ctx.bezierCurveTo(W*0.28, riverBottom+10, W*0.72, riverBottom-14, W, riverBottom + botBankWobble - 5);
    ctx.stroke();
    ctx.restore();

    // Road polygon points (trapezoid)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(roadCenterX - roadWidthTop/2, roadTopY);
    ctx.lineTo(roadCenterX + roadWidthTop/2, roadTopY);
    ctx.lineTo(roadCenterX + roadWidthBottom/2, roadBottomY);
    ctx.lineTo(roadCenterX - roadWidthBottom/2, roadBottomY);
    ctx.closePath();
    ctx.fillStyle = '#222a33';
    ctx.fill();

    // Bridge parapets only where the deck spans over water.
    const topRoad = getRoadBounds(riverTop);
    const botRoad = getRoadBounds(riverBottom);
    const tTop = clamp((riverTop - roadTopY)/(roadBottomY-roadTopY), 0, 1);
    const tBot = clamp((riverBottom - roadTopY)/(roadBottomY-roadTopY), 0, 1);
    const sideAtTop = lerp(sideTop, sideBottom, tTop);
    const sideAtBot = lerp(sideTop, sideBottom, tBot);
    const lerpPoint = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
    const fillQuad = (a, b, c, d, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    };

    const leftWallOuterTop = { x: topRoad.left - sideAtTop, y: riverTop };
    const leftWallInnerTop = { x: topRoad.left, y: riverTop };
    const leftWallOuterBottom = { x: botRoad.left - sideAtBot, y: riverBottom };
    const leftWallInnerBottom = { x: botRoad.left, y: riverBottom };
    const rightWallInnerTop = { x: topRoad.right, y: riverTop };
    const rightWallOuterTop = { x: topRoad.right + sideAtTop, y: riverTop };
    const rightWallInnerBottom = { x: botRoad.right, y: riverBottom };
    const rightWallOuterBottom = { x: botRoad.right + sideAtBot, y: riverBottom };
    const wallLiftTop = Math.max(2.5, sideAtTop * 0.22);
    const wallLiftBot = Math.max(6.2, sideAtBot * 0.28);
    // Inset cap points stay inside the wall footprint to avoid open-looking seams.
    const leftCapOuterTop = { x: leftWallOuterTop.x + sideAtTop * 0.12, y: leftWallOuterTop.y - wallLiftTop };
    const leftCapInnerTop = { x: leftWallInnerTop.x - sideAtTop * 0.10, y: leftWallInnerTop.y - wallLiftTop * 0.9 };
    const leftCapOuterBottom = { x: leftWallOuterBottom.x + sideAtBot * 0.12, y: leftWallOuterBottom.y - wallLiftBot };
    const leftCapInnerBottom = { x: leftWallInnerBottom.x - sideAtBot * 0.10, y: leftWallInnerBottom.y - wallLiftBot * 0.9 };
    const rightCapOuterTop = { x: rightWallOuterTop.x - sideAtTop * 0.12, y: rightWallOuterTop.y - wallLiftTop };
    const rightCapInnerTop = { x: rightWallInnerTop.x + sideAtTop * 0.10, y: rightWallInnerTop.y - wallLiftTop * 0.9 };
    const rightCapOuterBottom = { x: rightWallOuterBottom.x - sideAtBot * 0.12, y: rightWallOuterBottom.y - wallLiftBot };
    const rightCapInnerBottom = { x: rightWallInnerBottom.x + sideAtBot * 0.10, y: rightWallInnerBottom.y - wallLiftBot * 0.9 };

    // Side parapets are extruded into top caps plus vertical faces for a stronger 3D read.
    fillQuad(leftWallOuterTop, leftCapOuterTop, leftCapOuterBottom, leftWallOuterBottom, 'rgba(84, 91, 100, 0.95)');
    fillQuad(leftCapOuterTop, leftCapInnerTop, leftCapInnerBottom, leftCapOuterBottom, '#a6adb6');
    fillQuad(leftCapInnerTop, leftWallInnerTop, leftWallInnerBottom, leftCapInnerBottom, 'rgba(136, 145, 155, 0.90)');

    fillQuad(rightWallInnerTop, rightCapInnerTop, rightCapInnerBottom, rightWallInnerBottom, 'rgba(112, 121, 130, 0.90)');
    fillQuad(rightCapInnerTop, rightCapOuterTop, rightCapOuterBottom, rightCapInnerBottom, '#aeb5be');
    fillQuad(rightCapOuterTop, rightWallOuterTop, rightWallOuterBottom, rightCapOuterBottom, 'rgba(195, 202, 211, 0.88)');

    // Explicit closure faces avoid hollow-looking ends at the near/far shoreline joins.
    fillQuad(leftWallOuterTop, leftWallInnerTop, leftCapInnerTop, leftCapOuterTop, 'rgba(112, 121, 131, 0.72)');
    fillQuad(leftWallOuterBottom, leftCapOuterBottom, leftCapInnerBottom, leftWallInnerBottom, 'rgba(86, 94, 103, 0.72)');
    fillQuad(rightWallInnerTop, rightWallOuterTop, rightCapOuterTop, rightCapInnerTop, 'rgba(115, 124, 133, 0.72)');
    fillQuad(rightWallInnerBottom, rightCapInnerBottom, rightCapOuterBottom, rightWallOuterBottom, 'rgba(90, 98, 107, 0.72)');

    // Bridge abutments at each shoreline edge
    const abutDepth = 14;
    const topRoadIn = getRoadBounds(riverTop + abutDepth);
    const botRoadIn = getRoadBounds(riverBottom - abutDepth);
    const sideTopIn = lerp(sideTop, sideBottom, clamp((riverTop + abutDepth - roadTopY)/(roadBottomY-roadTopY), 0, 1));
    const sideBotIn = lerp(sideTop, sideBottom, clamp((riverBottom - abutDepth - roadTopY)/(roadBottomY-roadTopY), 0, 1));

    ctx.fillStyle = '#8d939b';
    ctx.beginPath();
    ctx.moveTo(topRoad.left - sideAtTop - 1, riverTop);
    ctx.lineTo(topRoad.right + sideAtTop + 1, riverTop);
    ctx.lineTo(topRoadIn.right + sideTopIn + 1, riverTop + abutDepth);
    ctx.lineTo(topRoadIn.left - sideTopIn - 1, riverTop + abutDepth);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(botRoadIn.left - sideBotIn - 1, riverBottom - abutDepth);
    ctx.lineTo(botRoadIn.right + sideBotIn + 1, riverBottom - abutDepth);
    ctx.lineTo(botRoad.right + sideAtBot + 1, riverBottom);
    ctx.lineTo(botRoad.left - sideAtBot - 1, riverBottom);
    ctx.closePath();
    ctx.fill();

    // Parapet caps, joints, and highlights.
    ctx.strokeStyle = 'rgba(236, 241, 245, 0.74)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(lerp(leftCapOuterTop.x, leftCapInnerTop.x, 0.56), lerp(leftCapOuterTop.y, leftCapInnerTop.y, 0.56));
    ctx.lineTo(lerp(leftCapOuterBottom.x, leftCapInnerBottom.x, 0.56), lerp(leftCapOuterBottom.y, leftCapInnerBottom.y, 0.56));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(lerp(rightCapOuterTop.x, rightCapInnerTop.x, 0.44), lerp(rightCapOuterTop.y, rightCapInnerTop.y, 0.44));
    ctx.lineTo(lerp(rightCapOuterBottom.x, rightCapInnerBottom.x, 0.44), lerp(rightCapOuterBottom.y, rightCapInnerBottom.y, 0.44));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(82, 88, 96, 0.38)';
    ctx.lineWidth = 1.05;
    for(let i=1;i<=5;i++){
      const wallT = i / 6;
      const leftOuter = lerpPoint(leftCapOuterTop, leftCapOuterBottom, wallT);
      const leftInner = lerpPoint(leftCapInnerTop, leftCapInnerBottom, wallT);
      const rightOuter = lerpPoint(rightCapOuterTop, rightCapOuterBottom, wallT);
      const rightInner = lerpPoint(rightCapInnerTop, rightCapInnerBottom, wallT);
      ctx.beginPath();
      ctx.moveTo(leftOuter.x, leftOuter.y);
      ctx.lineTo(leftInner.x, leftInner.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightOuter.x, rightOuter.y);
      ctx.lineTo(rightInner.x, rightInner.y);
      ctx.stroke();
    }

    // Left lane
    ctx.beginPath();
    ctx.moveTo(roadCenterX - roadWidthTop/2, roadTopY);
    ctx.lineTo(roadCenterX - wallWidthTop/2, roadTopY);
    ctx.lineTo(roadCenterX - wallWidthBottom/2, roadBottomY);
    ctx.lineTo(roadCenterX - roadWidthBottom/2, roadBottomY);
    ctx.closePath();
    ctx.fillStyle = '#2e3d4f';
    ctx.fill();

    // Right lane
    ctx.beginPath();
    ctx.moveTo(roadCenterX + wallWidthTop/2, roadTopY);
    ctx.lineTo(roadCenterX + roadWidthTop/2, roadTopY);
    ctx.lineTo(roadCenterX + roadWidthBottom/2, roadBottomY);
    ctx.lineTo(roadCenterX + wallWidthBottom/2, roadBottomY);
    ctx.closePath();
    ctx.fillStyle = '#2e3d4f';
    ctx.fill();

    // Open the near deck so the player doesn't appear to drive through the divider.
    const dividerEndY = Math.min(H - 150, player ? player.y - 92 : H - 150);
    const dividerEndT = clamp((dividerEndY - roadTopY)/(roadBottomY-roadTopY), 0, 1);
    const dividerHalfTop = wallWidthTop/2;
    const dividerHalfEnd = lerp(wallWidthTop/2, wallWidthBottom/2, dividerEndT);

    ctx.beginPath();
    ctx.moveTo(roadCenterX - dividerHalfEnd, dividerEndY);
    ctx.lineTo(roadCenterX + dividerHalfEnd, dividerEndY);
    ctx.lineTo(roadCenterX + wallWidthBottom/2, roadBottomY);
    ctx.lineTo(roadCenterX - wallWidthBottom/2, roadBottomY);
    ctx.closePath();
    ctx.fillStyle = '#31404f';
    ctx.fill();

    const dividerTopLeft = { x: roadCenterX - dividerHalfTop, y: roadTopY };
    const dividerTopRight = { x: roadCenterX + dividerHalfTop, y: roadTopY };
    const dividerBottomLeft = { x: roadCenterX - dividerHalfEnd, y: dividerEndY };
    const dividerBottomRight = { x: roadCenterX + dividerHalfEnd, y: dividerEndY };
    const dividerRidgeTopLeft = { x: roadCenterX - wallWidthTop*0.18, y: roadTopY };
    const dividerRidgeTopRight = { x: roadCenterX + wallWidthTop*0.18, y: roadTopY };
    const dividerRidgeBottomLeft = { x: roadCenterX - dividerHalfEnd*0.16, y: dividerEndY };
    const dividerRidgeBottomRight = { x: roadCenterX + dividerHalfEnd*0.16, y: dividerEndY };

    ctx.fillStyle = '#9aa1a8';
    ctx.beginPath();
    ctx.moveTo(dividerTopLeft.x, dividerTopLeft.y);
    ctx.lineTo(dividerTopRight.x, dividerTopRight.y);
    ctx.lineTo(dividerBottomRight.x, dividerBottomRight.y);
    ctx.lineTo(dividerBottomLeft.x, dividerBottomLeft.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(124, 132, 141, 0.75)';
    ctx.beginPath();
    ctx.moveTo(dividerTopLeft.x, dividerTopLeft.y);
    ctx.lineTo(dividerRidgeTopLeft.x, dividerRidgeTopLeft.y);
    ctx.lineTo(dividerRidgeBottomLeft.x, dividerRidgeBottomLeft.y);
    ctx.lineTo(dividerBottomLeft.x, dividerBottomLeft.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(222, 226, 231, 0.72)';
    ctx.beginPath();
    ctx.moveTo(dividerRidgeTopRight.x, dividerRidgeTopRight.y);
    ctx.lineTo(dividerTopRight.x, dividerTopRight.y);
    ctx.lineTo(dividerBottomRight.x, dividerBottomRight.y);
    ctx.lineTo(dividerRidgeBottomRight.x, dividerRidgeBottomRight.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(244, 247, 250, 0.72)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(roadCenterX, roadTopY);
    ctx.lineTo(roadCenterX, dividerEndY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(95, 102, 111, 0.42)';
    ctx.lineWidth = 1;
    for(let i=0;i<7;i++){
      const seamT = 0.08 + i*0.12;
      const seamLeft = lerpPoint(dividerTopLeft, dividerBottomLeft, seamT);
      const seamRight = lerpPoint(dividerTopRight, dividerBottomRight, seamT);
      ctx.beginPath();
      ctx.moveTo(seamLeft.x, seamLeft.y);
      ctx.lineTo(seamRight.x, seamRight.y);
      ctx.stroke();
    }

    const dividerCapDepth = 11;
    ctx.fillStyle = '#868d96';
    ctx.beginPath();
    ctx.moveTo(dividerBottomLeft.x, dividerBottomLeft.y);
    ctx.lineTo(dividerBottomRight.x, dividerBottomRight.y);
    ctx.lineTo(roadCenterX + dividerHalfEnd*0.78, dividerEndY + dividerCapDepth);
    ctx.lineTo(roadCenterX - dividerHalfEnd*0.78, dividerEndY + dividerCapDepth);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(228, 208, 108, 0.82)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(roadCenterX - 5, dividerEndY + 12);
    ctx.lineTo(roadCenterX - 5, roadBottomY - 26);
    ctx.moveTo(roadCenterX + 5, dividerEndY + 12);
    ctx.lineTo(roadCenterX + 5, roadBottomY - 26);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Draw enemies back-to-front so closer ones naturally occlude farther ones.
    const enemiesByDepth = [...enemies].sort((a, b) => a.y - b.y);
    enemiesByDepth.forEach(e=>e.draw());
    powerups.forEach(p=>p.draw());

    // Bottom defense wall in front of enemies and behind player
    const wallRect = getWallRect();
    ctx.save();
    if(!wallBroken){
      const wallRatio = clamp(wallHealth / Math.max(1, wallMax), 0, 1);
      const wallDamage = 1 - wallRatio;
      const wallSat = Math.round(2 + wallDamage * 24);
      const wallLight = Math.round(80 - wallDamage * 28);
      const barrierCapInset = Math.max(8, wallRect.w * 0.08);
      const barrierCapLift = 5;
      const barrierCapDepth = 4;

      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(wallRect.x + 2, wallRect.y + wallRect.h - 2, wallRect.w - 4, 3);

      ctx.fillStyle = `hsl(10, ${Math.max(0, wallSat - 4)}%, ${Math.max(36, wallLight - 12)}%)`;
      ctx.beginPath();
      ctx.moveTo(wallRect.x + barrierCapInset, wallRect.y - barrierCapLift);
      ctx.lineTo(wallRect.x + wallRect.w - barrierCapInset, wallRect.y - barrierCapLift);
      ctx.lineTo(wallRect.x + wallRect.w - barrierCapInset*0.55, wallRect.y - barrierCapDepth);
      ctx.lineTo(wallRect.x + barrierCapInset*0.55, wallRect.y - barrierCapDepth);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = `hsl(10, ${wallSat}%, ${wallLight}%)`;
      ctx.fillRect(wallRect.x, wallRect.y, wallRect.w, wallRect.h);
      ctx.strokeStyle = wallDamage > 0.5 ? '#6a2d2d' : '#4b4b4b';
      ctx.lineWidth = 2;
      ctx.strokeRect(wallRect.x, wallRect.y, wallRect.w, wallRect.h);

      ctx.strokeStyle = 'rgba(240, 243, 245, 0.46)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(wallRect.x + barrierCapInset*0.75, wallRect.y - barrierCapDepth + 0.5);
      ctx.lineTo(wallRect.x + wallRect.w - barrierCapInset*0.75, wallRect.y - barrierCapDepth + 0.5);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(86, 64, 58, 0.34)';
      ctx.lineWidth = 1;
      for(let i=0;i<Math.max(2, Math.floor(wallRect.w / 48));i++){
        const seamX = wallRect.x + 18 + i*((wallRect.w - 36) / Math.max(1, Math.floor(wallRect.w / 48) - 1 || 1));
        ctx.beginPath();
        ctx.moveTo(seamX, wallRect.y + 1);
        ctx.lineTo(seamX, wallRect.y + wallRect.h - 2);
        ctx.stroke();
      }

      // Integrated damage marks on the wall replace a separate health bar.
      const chipCount = Math.floor(wallDamage * 7);
      if(chipCount > 0){
        ctx.fillStyle = 'rgba(48, 26, 26, 0.50)';
        for(let i=0;i<chipCount;i++){
          const chipW = 4 + (i%3)*2;
          const chipX = wallRect.x + 4 + ((i*29) % Math.max(6, wallRect.w - chipW - 8));
          const chipY = wallRect.y + ((i*11) % Math.max(3, wallRect.h - 5));
          ctx.fillRect(chipX, chipY, chipW, 2 + (i%2));
        }
      }

      const crackCount = Math.floor(wallDamage * 8);
      if(crackCount > 0){
        ctx.strokeStyle = 'rgba(66, 25, 25, 0.74)';
        ctx.lineWidth = 1.2;
        for(let i=0;i<crackCount;i++){
          const startX = wallRect.x + 6 + ((i*31) % Math.max(8, wallRect.w - 12));
          const startY = wallRect.y + 2 + ((i*7) % 5);
          const bend = (i%2===0 ? -1 : 1) * (2 + (i%3));
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(startX + bend, startY + 5);
          ctx.lineTo(startX - bend*0.5, startY + 10);
          ctx.stroke();
        }
      }
    } else {
      ctx.strokeStyle = '#f44';
      ctx.lineWidth = 3;
      ctx.setLineDash([8,6]);
      ctx.strokeRect(wallRect.x, wallRect.y, wallRect.w, wallRect.h);
      ctx.setLineDash([]);
    }
    ctx.restore();

    // Foreground
    player.draw();
    bullets.forEach(b=>b.draw());
    // Draw a compact event popup for power-up feedback.
    if(notifPopup && notifPopupTimer>0){
      ctx.save();
      ctx.font = 'bold 28px Arial';
      ctx.fillStyle = '#0ff';
      ctx.textAlign = 'left';
      ctx.globalAlpha = Math.max(0, Math.min(1, notifPopupTimer));
      ctx.fillText(notifPopup, 30, 60 + (1-notifPopupTimer)*30);
      ctx.restore();
    }

    if(levelTransitionTimer > 0){
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0,0,W,H);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 54px Arial';
      ctx.fillText(levelTransitionLabel || `Level ${level}`, W/2, H/2 - 10);
      ctx.font = '20px Arial';
      ctx.fillText('Incoming wave', W/2, H/2 + 32);
      ctx.restore();
    }
  }

  function loop(now){
    if(!running) return;
    const dt = Math.min(0.05, (now - lastTime)/1000);
    lastTime = now;
    if(!paused){
      update(dt);
      if(notifPopupTimer>0){
        notifPopupTimer -= dt;
        if(notifPopupTimer<=0){ notifPopup = null; notifPopupTimer = 0; }
      }
    }
    draw();
    requestAnimationFrame(loop);
  }

  function togglePause(){
    if(!running) return;
    paused = !paused;
    releasePointer();
    updatePauseButton();
    if(paused){
      statusEl.style.display='block';
      statusEl.textContent = 'Paused — Press Space or tap the pause button to resume';
    } else {
      statusEl.style.display='none';
      lastTime = performance.now();
    }
  }

  function startGame(){ if(running) return; running=true; paused=false; statusEl.style.display='none'; reset(); updatePauseButton(); lastTime=performance.now(); requestAnimationFrame(loop); }
  function endGame(){ running=false; paused=false; releasePointer(); updatePauseButton(); statusEl.style.display='block'; statusEl.textContent = 'Game Over — Press any key or tap to Restart'; }

  function updateUI(){
    const difficulty = getDifficultyForLevel(level);
    const waveRemaining = Math.max(0, (difficulty.enemyQuota - levelSpawned) + enemies.length);
    const wallText = wallBroken ? 'Broken' : `${wallHealth}/${wallMax}`;
    const laneText = empTimer > 0 ? ' | Lane: EMP' : '';
    hudEl.textContent = `Lvl: ${level} | Wave Left: ${waveRemaining} | HP: ${player ? player.lives : GAME_TUNING.player.startingLives}/${GAME_TUNING.player.maxLives} | Wall: ${wallText}${laneText}`;
  }

  // initial
  reset(); updatePauseButton(); statusEl.style.display='block'; statusEl.textContent='Press any key or tap to start';
  // expose quick debug on window
  window._game = { start: startGame, stop: endGame, pause: togglePause, tuning: GAME_TUNING, levels: LEVEL_DEFS };
})();