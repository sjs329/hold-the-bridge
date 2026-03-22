(function(){
  const { VIEWPORT_PADDING, LANDSCAPE_ASPECT, PORTRAIT_ASPECT, GAME_TUNING, LEVEL_DEFS } = window.CoreConfig;
  const { clamp, lerp, collide, removeDeadInPlace } = window.CoreMath;
  const { createGeometrySystem, getPerspectiveSpeedMultiplier } = window.CoreGeometry;
  const { createDifficultySystem } = window.CoreDifficulty;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const hudEl = document.getElementById('hud');
  const hudLevelEl = document.getElementById('hud-level');
  const hudWaveEl = document.getElementById('hud-wave');
  const pauseButton = document.getElementById('pause-button');
  const statusEl = document.getElementById('status');
  const gameContainer = document.getElementById('game-container');
  const FIELD_EFFECT_NAME = 'Slowing Field';
  const REBUFF_PUSH_VELOCITY = -300;
  const REBUFF_RANGE = 70; // pixels above the wall that the shockwave/slow-field covers
  const MAX_ENEMY_LANE_T = 0.9;
  // Fraction of overlap to resolve each frame for enemy-enemy collisions.
  // < 1 allows enemies to remain slightly overlapping (dense clusters) while
  // still preventing them from fully passing through one another.
  const ENEMY_COLLISION_RESOLVE_FRACTION = 0.5;

  let W = 800, H = 600;
  const geometry = createGeometrySystem(W, H);
  const {
    getRoadGeometry,
    getRoadBounds,
    getLanePerspectiveRect,
    getPlayerRoadClamp,
    getEnemyLaneBounds,
    getWallRect: getWallRectForPlayer,
    setSize: setGeometrySize,
    clearCaches: clearGeometryCaches
  } = geometry;
  const { getDifficultyForLevel, clearCaches: clearDifficultyCaches } = createDifficultySystem(LEVEL_DEFS, GAME_TUNING);

  function getWallRect(){
    return getWallRectForPlayer(player);
  }

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
    setGeometrySize(W, H);

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

  // Audio
  let audioCtx = null;
  function getAudioContext(){
    if(!audioCtx){
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ audioCtx = null; }
    }
    return audioCtx;
  }
  function resumeAudio(){
    const ac = getAudioContext();
    if(ac && ac.state === 'suspended') ac.resume();
  }

  function playTone(frequency, type, gainPeak, attackTime, decayTime, startTime){
    const ac = getAudioContext();
    if(!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + attackTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + attackTime + decayTime);
    osc.start(startTime);
    osc.stop(startTime + attackTime + decayTime + 0.05);
  }

  function playFreqSweep(freqStart, freqEnd, type, gainPeak, duration, startTime){
    const ac = getAudioContext();
    if(!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration);
    gain.gain.setValueAtTime(gainPeak, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  function sfxPowerupUnlock(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    playTone(880, 'sine', 0.18, 0.01, 0.18, t);
    playTone(1100, 'sine', 0.12, 0.01, 0.15, t + 0.06);
  }

  function sfxMultiShotPickup(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Three-note ascending arpeggio
    playTone(523, 'triangle', 0.20, 0.01, 0.12, t);
    playTone(659, 'triangle', 0.20, 0.01, 0.12, t + 0.08);
    playTone(784, 'triangle', 0.22, 0.01, 0.20, t + 0.16);
  }

  function sfxRateBoostPickup(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Rising frequency sweep (zip/whoosh feel)
    playFreqSweep(300, 1200, 'sawtooth', 0.10, 0.18, t);
    playTone(1200, 'sine', 0.14, 0.01, 0.14, t + 0.12);
  }

  function sfxFieldPickup(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Low resonant thrum
    playTone(110, 'sine', 0.22, 0.03, 0.35, t);
    playTone(220, 'sine', 0.12, 0.03, 0.28, t + 0.04);
    playTone(440, 'sine', 0.08, 0.02, 0.20, t + 0.10);
  }

  function sfxShoot(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Quick pew: short downward sawtooth sweep
    playFreqSweep(520, 180, 'sawtooth', 0.04, 0.07, t);
  }

  function sfxEnemyHit(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Brief impact thud
    playFreqSweep(200, 80, 'square', 0.06, 0.08, t);
  }

  function sfxEnemyDeath(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Short crunch/explosion: descending sweep
    playFreqSweep(300, 40, 'sawtooth', 0.14, 0.22, t);
    playTone(120, 'sine', 0.08, 0.01, 0.18, t + 0.03);
  }

  function sfxWallHit(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Deep thud when enemy chips wall HP
    playTone(80, 'sine', 0.18, 0.005, 0.18, t);
    playFreqSweep(180, 60, 'sawtooth', 0.08, 0.14, t);
  }

  function sfxWallBroken(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Alarm: descending tritone cluster then low rumble
    playTone(740, 'sawtooth', 0.18, 0.01, 0.18, t);
    playTone(523, 'sawtooth', 0.18, 0.01, 0.18, t + 0.14);
    playTone(370, 'sawtooth', 0.20, 0.01, 0.28, t + 0.28);
    playTone(60, 'sine', 0.22, 0.02, 0.55, t + 0.30);
  }

  function sfxPlayerHit(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Heavy impact + descending hit tone
    playFreqSweep(440, 80, 'sawtooth', 0.20, 0.30, t);
    playTone(150, 'sine', 0.14, 0.01, 0.30, t + 0.05);
  }

  function sfxGameOver(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Three descending notes
    playTone(494, 'triangle', 0.22, 0.01, 0.25, t);
    playTone(370, 'triangle', 0.22, 0.01, 0.25, t + 0.22);
    playTone(247, 'triangle', 0.24, 0.01, 0.55, t + 0.44);
  }

  function sfxLevelUp(){
    const ac = getAudioContext();
    if(!ac) return;
    const t = ac.currentTime;
    // Four-note ascending fanfare
    playTone(523, 'triangle', 0.18, 0.01, 0.14, t);
    playTone(659, 'triangle', 0.18, 0.01, 0.14, t + 0.12);
    playTone(784, 'triangle', 0.18, 0.01, 0.14, t + 0.24);
    playTone(1047, 'triangle', 0.22, 0.01, 0.35, t + 0.36);
  }

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
    resumeAudio();
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
    resumeAudio();
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
      sfxShoot();
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
      ctx.save();
      ctx.font='20px Arial';
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#f44';
      for(let i=0;i<this.lives;i++){
        ctx.fillText('❤', this.x+this.w/2 + (i-((this.lives-1)/2))*22, this.y-18);
      }
      ctx.restore();
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
    constructor(laneT, y, s, health, attackMin, attackMax, sizeClass){
      this.laneT = laneT; // 0-1 position in lane
      this.y = y;
      this.speed = s||12;
      this.dead = false;
      this.sizeClass = sizeClass || 'medium';
      this.maxHealthValue = Math.max(1, health||1);
      this.health = this.maxHealthValue;
      if(this.sizeClass === 'small'){
        this.baseW = 22; this.baseH = 17;
      } else if(this.sizeClass === 'giant'){
        this.baseW = 72; this.baseH = 56;
      } else if(this.sizeClass === 'boss'){
        this.baseW = 100; this.baseH = 78;
      } else {
        this.baseW = 40; this.baseH = 31;
      }
      this.attackMin = attackMin || 1.2;
      this.attackMax = attackMax || 2.0;
      this.damageSeed = Math.random() * 1000;
      this.hitFlash = 0;
      this.lateralVel = 0;
      this.rebuffVelY = 0;
      this.resetAttackTimer();
    }
    resetAttackTimer(){ this.attackTimer = this.attackMin + Math.random()*(this.attackMax-this.attackMin); }
    getPerspective(){
      // Size is fully determined by sizeClass (baseW/baseH); no additional health scaling needed.
      return getLanePerspectiveRect(this.y, 'right', this.laneT, this.baseW, this.baseH, 1);
    }
    update(dt){
      // Move with perspective-aware speed: slower at distance, faster up close.
      const depth = getRoadBounds(this.y).depthT;
      this.y += this.speed * getEnemySlowMultiplier() * getPerspectiveSpeedMultiplier(depth) * dt;
      // Apply shockwave push velocity (smooth backward motion instead of instant teleport).
      if(this.rebuffVelY !== 0){
        this.y += this.rebuffVelY * dt;
        this.rebuffVelY *= Math.max(0, 1 - dt * 6);
        if(Math.abs(this.rebuffVelY) < 0.1) this.rebuffVelY = 0;
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      if(this.y>H+50) this.dead=true;
      // Apply lateral steering so enemies can slide around each other.
      // Cap at MAX_ENEMY_LANE_T to keep enemies within the player's shooting range.
      if(this.lateralVel !== 0){
        this.laneT = clamp(this.laneT + this.lateralVel * dt, 0, MAX_ENEMY_LANE_T);
        this.lateralVel *= Math.max(0, 1 - dt * 2.5);
        if(Math.abs(this.lateralVel) < 0.005) this.lateralVel = 0;
      }
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

      if(this.sizeClass === 'boss'){
        // Boss: towering armored commander with crown and gold pauldrons
        const legW = p.w*0.28;
        const legH = p.h*0.28;
        const legY = p.y + p.h - legH;
        const legLight = Math.round(16 + hpRatio*6 + flash*10);
        ctx.fillStyle=`hsl(270, 28%, ${legLight}%)`;
        ctx.fillRect(cx - legW - p.w*0.08, legY, legW, legH);
        ctx.fillRect(cx + p.w*0.08, legY, legW, legH);

        const torsoW = p.w*0.78;
        const torsoH = p.h*0.50;
        const torsoX = cx - torsoW/2;
        const torsoY = legY - torsoH + 2;
        const torsoSat = Math.round(38 - damageRatio*14);
        const torsoLight = Math.round(22 - damageRatio*10 + flash*14);
        ctx.fillStyle=`hsl(270, ${torsoSat}%, ${torsoLight}%)`;
        ctx.fillRect(torsoX, torsoY, torsoW, torsoH);

        // Gold shoulder pauldrons
        const pauldronLight = Math.round(42 + flash*22);
        ctx.fillStyle=`hsl(44, 80%, ${pauldronLight}%)`;
        ctx.fillRect(torsoX - p.w*0.08, torsoY, p.w*0.20, torsoH*0.55);
        ctx.fillRect(torsoX + torsoW - p.w*0.12, torsoY, p.w*0.20, torsoH*0.55);

        // Gold armor trim stripes
        ctx.fillStyle=`hsl(44, 65%, ${Math.round(36 + flash*14)}%)`;
        ctx.fillRect(torsoX + torsoW*0.28, torsoY + torsoH*0.18, torsoW*0.44, torsoH*0.08);
        ctx.fillRect(torsoX + torsoW*0.28, torsoY + torsoH*0.48, torsoW*0.44, torsoH*0.08);

        const chipCount = Math.floor(damageRatio * 9);
        if(chipCount > 0){
          ctx.fillStyle='rgba(5,0,10,0.75)';
          for(let i=0;i<chipCount;i++){
            const chipX = cx + Math.sin(this.damageSeed + i*1.9) * torsoW * 0.28;
            const chipY = torsoY + torsoH * (0.12 + i*0.09);
            const chipR = Math.max(1.5, p.scale*(2.5 + i*0.28));
            ctx.beginPath();
            ctx.arc(chipX, chipY, chipR, 0, Math.PI*2);
            ctx.fill();
          }
        }

        const crackCount = Math.floor(damageRatio * 5);
        if(crackCount > 0){
          ctx.strokeStyle='rgba(8,0,16,0.74)';
          ctx.lineWidth=Math.max(1.5, p.scale*1.5);
          for(let i=0;i<crackCount;i++){
            const startX = cx + Math.sin(this.damageSeed*1.7 + i*2.1) * torsoW * 0.22;
            const startY = torsoY + torsoH * (0.10 + i*0.18);
            const dir = i%2===0 ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(startX + torsoW*0.22*dir, startY + torsoH*0.16);
            ctx.lineTo(startX + torsoW*0.06, startY + torsoH*0.32);
            ctx.stroke();
          }
        }

        const headR = Math.max(4, p.w*0.22);
        const headSat = Math.round(30 - damageRatio*12);
        const headLight = Math.round(20 - damageRatio*8 + flash*12);
        ctx.fillStyle=`hsl(270, ${headSat}%, ${headLight}%)`;
        ctx.beginPath();
        ctx.arc(cx, torsoY - headR*0.25, headR, 0, Math.PI*2);
        ctx.fill();

        // Gold crown with three spikes
        const crownGold = Math.round(46 + flash*20);
        ctx.fillStyle=`hsl(44, 85%, ${crownGold}%)`;
        const crownBaseY = torsoY - headR*0.25 - headR;
        const crownW = headR*1.9;
        const spikeH = headR*0.72;
        ctx.beginPath();
        ctx.moveTo(cx - crownW*0.44, crownBaseY + spikeH*0.30);
        ctx.lineTo(cx - crownW*0.34, crownBaseY - spikeH*0.42);
        ctx.lineTo(cx - crownW*0.20, crownBaseY + spikeH*0.30);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - crownW*0.10, crownBaseY + spikeH*0.08);
        ctx.lineTo(cx, crownBaseY - spikeH*0.82);
        ctx.lineTo(cx + crownW*0.10, crownBaseY + spikeH*0.08);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + crownW*0.20, crownBaseY + spikeH*0.30);
        ctx.lineTo(cx + crownW*0.34, crownBaseY - spikeH*0.42);
        ctx.lineTo(cx + crownW*0.44, crownBaseY + spikeH*0.30);
        ctx.closePath();
        ctx.fill();

        // Glowing yellow eyes
        ctx.fillStyle=`hsl(50, 100%, ${Math.round(55 + flash*30)}%)`;
        ctx.fillRect(cx - headR*0.52, torsoY - headR*0.52, headR*0.28, headR*0.20);
        ctx.fillRect(cx + headR*0.24, torsoY - headR*0.52, headR*0.28, headR*0.20);

      } else if(this.sizeClass === 'giant'){
        // Giant enemy: dark armored brute with blocky proportions
        const legW = p.w*0.28;
        const legH = p.h*0.32;
        const legY = p.y + p.h - legH;
        const legLight = Math.round(18 + hpRatio*8 + flash*10);
        ctx.fillStyle=`hsl(120, 12%, ${legLight}%)`;
        ctx.fillRect(cx - legW - p.w*0.06, legY, legW, legH);
        ctx.fillRect(cx + p.w*0.06, legY, legW, legH);

        const torsoW = p.w*0.72;
        const torsoH = p.h*0.54;
        const torsoX = cx - torsoW/2;
        const torsoY = legY - torsoH + 2;
        const torsoSat = Math.round(15 - damageRatio*8);
        const torsoLight = Math.round(28 - damageRatio*14 + flash*12);
        ctx.fillStyle=`hsl(120, ${torsoSat}%, ${torsoLight}%)`;
        ctx.fillRect(torsoX, torsoY, torsoW, torsoH);

        // Armor ridges
        ctx.fillStyle=`hsl(120, 10%, ${Math.round(20 + flash*8)}%)`;
        ctx.fillRect(torsoX + torsoW*0.10, torsoY + torsoH*0.20, torsoW*0.80, torsoH*0.09);
        ctx.fillRect(torsoX + torsoW*0.10, torsoY + torsoH*0.50, torsoW*0.80, torsoH*0.09);

        const chipCount = Math.floor(damageRatio * 7);
        if(chipCount > 0){
          ctx.fillStyle='rgba(8,18,8,0.70)';
          for(let i=0;i<chipCount;i++){
            const chipX = cx + Math.sin(this.damageSeed + i*1.9) * torsoW * 0.28;
            const chipY = torsoY + torsoH * (0.15 + i*0.12);
            const chipR = Math.max(1.5, p.scale*(2.2 + i*0.30));
            ctx.beginPath();
            ctx.arc(chipX, chipY, chipR, 0, Math.PI*2);
            ctx.fill();
          }
        }

        const crackCount = Math.floor(damageRatio * 4);
        if(crackCount > 0){
          ctx.strokeStyle='rgba(10,22,10,0.72)';
          ctx.lineWidth=Math.max(1.5, p.scale*1.5);
          for(let i=0;i<crackCount;i++){
            const startX = cx + Math.sin(this.damageSeed*1.7 + i*2.1) * torsoW * 0.20;
            const startY = torsoY + torsoH * (0.12 + i*0.22);
            const dir = i%2===0 ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(startX + torsoW*0.22*dir, startY + torsoH*0.16);
            ctx.lineTo(startX + torsoW*0.06, startY + torsoH*0.32);
            ctx.stroke();
          }
        }

        const headR = Math.max(3, p.w*0.19);
        const headSat = Math.round(12 - damageRatio*8);
        const headLight = Math.round(26 - damageRatio*10 + flash*10);
        ctx.fillStyle=`hsl(120, ${headSat}%, ${headLight}%)`;
        ctx.beginPath();
        ctx.arc(cx, torsoY - headR*0.30, headR, 0, Math.PI*2);
        ctx.fill();

        // Glowing red eyes
        ctx.fillStyle=`hsl(0, 95%, ${Math.round(42 + flash*25)}%)`;
        ctx.fillRect(cx - headR*0.50, torsoY - headR*0.52, headR*0.26, headR*0.18);
        ctx.fillRect(cx + headR*0.24, torsoY - headR*0.52, headR*0.26, headR*0.18);

      } else if(this.sizeClass === 'small'){
        // Small enemy: quick, lighter-colored scout
        const legW = p.w*0.20;
        const legH = p.h*0.38;
        const legY = p.y + p.h - legH;
        const legLight = Math.round(32 + hpRatio*12 + flash*10);
        ctx.fillStyle=`hsl(22, 52%, ${legLight}%)`;
        ctx.fillRect(cx - legW - p.w*0.04, legY, legW, legH);
        ctx.fillRect(cx + p.w*0.04, legY, legW, legH);

        const torsoW = p.w*0.52;
        const torsoH = p.h*0.46;
        const torsoX = cx - torsoW/2;
        const torsoY = legY - torsoH + 1;
        const torsoSat = Math.round(62 - damageRatio*26);
        const torsoLight = Math.round(60 - damageRatio*20 + flash*10);
        ctx.fillStyle=`hsl(22, ${torsoSat}%, ${torsoLight}%)`;
        ctx.beginPath();
        ctx.moveTo(torsoX + torsoW*0.12, torsoY + torsoH);
        ctx.lineTo(torsoX + torsoW*0.88, torsoY + torsoH);
        ctx.lineTo(torsoX + torsoW*0.68, torsoY);
        ctx.lineTo(torsoX + torsoW*0.32, torsoY);
        ctx.closePath();
        ctx.fill();

        const chipCount = Math.floor(damageRatio * 3);
        if(chipCount > 0){
          ctx.fillStyle='rgba(20,10,5,0.62)';
          for(let i=0;i<chipCount;i++){
            const chipX = cx + Math.sin(this.damageSeed + i*1.9) * torsoW * 0.22;
            const chipY = torsoY + torsoH * (0.25 + i*0.22);
            const chipR = Math.max(1.0, p.scale*(1.4 + i*0.20));
            ctx.beginPath();
            ctx.arc(chipX, chipY, chipR, 0, Math.PI*2);
            ctx.fill();
          }
        }

        const headR = Math.max(1.5, p.w*0.15);
        const headSat = Math.round(52 - damageRatio*18);
        const headLight = Math.round(50 - damageRatio*14 + flash*8);
        ctx.fillStyle=`hsl(20, ${headSat}%, ${headLight}%)`;
        ctx.beginPath();
        ctx.arc(cx, torsoY - headR*0.30, headR, 0, Math.PI*2);
        ctx.fill();

        const eyeHue = Math.round(30 + hpRatio*60);
        const eyeLight = Math.round(52 + hpRatio*18 + flash*18);
        ctx.fillStyle=`hsl(${eyeHue}, 90%, ${eyeLight}%)`;
        ctx.fillRect(cx - headR*0.42, torsoY - headR*0.44, headR*0.22, headR*0.14);
        ctx.fillRect(cx + headR*0.20, torsoY - headR*0.44, headR*0.22, headR*0.14);

      } else {
        // Medium enemy: standard soldier
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
      }

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
    constructor(laneT, y, type, shots, subtype){
      this.laneT = laneT; // 0-1 position in lane
      this.y = y;
      this.type = type;
      // For 'gun' type: 'multishot' or 'rate'
      this.subtype = subtype || (type === 'gun' ? 'rate' : null);
      this.speed = 90;
      this.dead = false;
      this.locked = true;
      this.shots = shots||2;
      this.maxShots = this.shots;
      this.baseW = 32; this.baseH = 32;
    }
    getPerspective(){
      return getLanePerspectiveRect(this.y, 'left', this.laneT, this.baseW, this.baseH, 1);
    }
    update(dt){
      const depth = getRoadBounds(this.y).depthT;
      this.y += this.speed * getPerspectiveSpeedMultiplier(depth) * dt;
      if(this.y>H+50) this.dead=true;
    }
    hit(){ if(this.locked){ this.shots--; if(this.shots<=0){ this.locked=false; sfxPowerupUnlock(); } } }
    draw(){
      const p = this.getPerspective();
      const cx = p.x + p.w/2;
      const cy = p.y + p.h/2;
      const r = Math.min(p.w, p.h) * 0.48;
      const lockedAlpha = this.locked ? 0.72 : 1.0;
      ctx.save();
      ctx.globalAlpha = lockedAlpha;

      if(this.type === 'gun' && this.subtype === 'multishot'){
        // Hexagonal amber gem — multi-bullet fan icon.
        // Outer glow
        const glow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.7);
        glow.addColorStop(0, 'rgba(255,180,0,0.50)');
        glow.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
        ctx.fill();

        // Hex gem body
        const gemGrad = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.2, 0, cx, cy, r);
        gemGrad.addColorStop(0, '#ffe870');
        gemGrad.addColorStop(0.5, '#ff9800');
        gemGrad.addColorStop(1, '#b04a00');
        ctx.fillStyle = gemGrad;
        ctx.beginPath();
        for(let i = 0; i < 6; i++){
          const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
          const hx = cx + Math.cos(a) * r;
          const hy = cy + Math.sin(a) * r;
          i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fill();

        // Gem highlight
        ctx.fillStyle = 'rgba(255,255,200,0.38)';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.18, cy - r * 0.28, r * 0.32, r * 0.15, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        // Three-bullet fan icon
        const bh = r * 0.46;
        const bw = r * 0.20;
        const angles = [-0.32, 0, 0.32];
        ctx.fillStyle = 'rgba(255,242,200,0.92)';
        for(let k = 0; k < 3; k++){
          const ang = angles[k];
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(0, -bh);
          ctx.bezierCurveTo(bw, -bh * 0.3, bw, bh * 0.45, 0, bh * 0.6);
          ctx.bezierCurveTo(-bw, bh * 0.45, -bw, -bh * 0.3, 0, -bh);
          ctx.fill();
          ctx.restore();
        }

      } else if(this.type === 'gun' && this.subtype === 'rate'){
        // Diamond (rotated square) lime-green gem — lightning bolt icon.
        // Outer glow
        const glow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.7);
        glow.addColorStop(0, 'rgba(100,255,80,0.55)');
        glow.addColorStop(1, 'rgba(0,180,60,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
        ctx.fill();

        // Diamond gem body
        const gemGrad = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.2, 0, cx, cy, r);
        gemGrad.addColorStop(0, '#e8ffb0');
        gemGrad.addColorStop(0.45, '#66ff44');
        gemGrad.addColorStop(1, '#1a7a00');
        ctx.fillStyle = gemGrad;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);      // top
        ctx.lineTo(cx + r, cy);      // right
        ctx.lineTo(cx, cy + r);      // bottom
        ctx.lineTo(cx - r, cy);      // left
        ctx.closePath();
        ctx.fill();

        // Diamond highlight
        ctx.fillStyle = 'rgba(220,255,200,0.40)';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.18, cy - r * 0.28, r * 0.30, r * 0.13, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        // Lightning bolt icon
        ctx.fillStyle = 'rgba(230,255,180,0.95)';
        ctx.beginPath();
        const lx = cx, ly = cy;
        const ls = r * 0.52;
        ctx.moveTo(lx + ls * 0.18, ly - ls);
        ctx.lineTo(lx - ls * 0.10, ly + ls * 0.08);
        ctx.lineTo(lx + ls * 0.14, ly + ls * 0.08);
        ctx.lineTo(lx - ls * 0.18, ly + ls);
        ctx.lineTo(lx + ls * 0.10, ly - ls * 0.08);
        ctx.lineTo(lx - ls * 0.14, ly - ls * 0.08);
        ctx.closePath();
        ctx.fill();

      } else {
        // Circular cyan orb with a slow-field arc pattern.
        // Outer glow
        const glow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.7);
        glow.addColorStop(0, 'rgba(0,230,210,0.50)');
        glow.addColorStop(1, 'rgba(0,100,200,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
        ctx.fill();

        // Orb body
        const orbGrad = ctx.createRadialGradient(cx - r * 0.18, cy - r * 0.22, 0, cx, cy, r);
        orbGrad.addColorStop(0, '#d8fff8');
        orbGrad.addColorStop(0.4, '#28e8d0');
        orbGrad.addColorStop(1, '#006c96');
        ctx.fillStyle = orbGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Orb highlight
        ctx.fillStyle = 'rgba(255,255,255,0.40)';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.22, cy - r * 0.30, r * 0.30, r * 0.14, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        // Slow-field icon: three concentric upward arcs (like a signal / slow-wave)
        const arcBase = cy + r * 0.12;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1, p.scale * 1.5);
        for(let ring = 0; ring < 3; ring++){
          const sr = r * (0.20 + ring * 0.21);
          ctx.globalAlpha = lockedAlpha * (0.92 - ring * 0.22);
          ctx.strokeStyle = 'rgba(255,255,255,0.90)';
          ctx.beginPath();
          ctx.arc(cx, arcBase, sr, -Math.PI * 0.78, -Math.PI * 0.22);
          ctx.stroke();
        }
        ctx.globalAlpha = lockedAlpha;
        // Center dot
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.beginPath();
        ctx.arc(cx, arcBase, r * 0.10, 0, Math.PI * 2);
        ctx.fill();
      }

      // Locked indicator: dashed ring + shot count
      if(this.locked){
        ctx.globalAlpha = 0.88;
        ctx.strokeStyle = '#ff3333';
        ctx.lineWidth = Math.max(1.5, p.scale * 2.2);
        ctx.setLineDash([Math.max(2, p.scale * 3.5), Math.max(1.5, p.scale * 2)]);
        ctx.beginPath();
        if(this.type === 'gun' && this.subtype === 'multishot'){
          // Hex outline
          for(let i = 0; i < 6; i++){
            const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
            const hx = cx + Math.cos(a) * (r + Math.max(2, p.scale * 3));
            const hy = cy + Math.sin(a) * (r + Math.max(2, p.scale * 3));
            i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
          }
          ctx.closePath();
        } else if(this.type === 'gun' && this.subtype === 'rate'){
          // Diamond outline
          const rd = r + Math.max(2, p.scale * 3);
          ctx.moveTo(cx, cy - rd);
          ctx.lineTo(cx + rd, cy);
          ctx.lineTo(cx, cy + rd);
          ctx.lineTo(cx - rd, cy);
          ctx.closePath();
        } else {
          ctx.arc(cx, cy, r + Math.max(2, p.scale * 3), 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Shot count label
        ctx.globalAlpha = 1.0;
        const fontSize = Math.floor(Math.max(8, 13 * p.scale));
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.70)';
        ctx.lineWidth = Math.max(2, p.scale * 2.5);
        ctx.strokeText(this.shots, cx, cy + r * 0.50);
        ctx.fillStyle = '#fff';
        ctx.fillText(this.shots, cx, cy + r * 0.50);
      }
      ctx.restore();
    }
    bounds(){
      const p = this.getPerspective();
      return {x:p.x, y:p.y, w:p.w, h:p.h};
    }
  }

  // Helpers
  function getLeftLaneGunChance(currentLevel){
    const lane = GAME_TUNING.leftLane;
    return clamp(lane.gunChanceBase + (Math.max(1, currentLevel) - 1) * lane.gunChancePerLevel, lane.gunChanceBase, lane.gunChanceMax);
  }

  function getFieldProjectorAnchor(){
    const wall = getWallRectForPlayer(player);
    return {
      // Centered in lane and tucked just behind the wall (enemy side).
      x: wall.x + wall.w * 0.5,
      y: wall.y - 11
    };
  }

  function queueFieldChargeTransfer(sourceX, sourceY){
    const anchor = getFieldProjectorAnchor();
    fieldChargeTransfers.push({
      sx: sourceX,
      sy: sourceY,
      tx: anchor.x,
      ty: anchor.y,
      age: 0,
      duration: 0.34 + Math.random() * 0.16,
      wobble: Math.random() * Math.PI * 2
    });
  }

  function getEnemySlowMultiplier(){
    return slowFieldTimer > 0 ? GAME_TUNING.leftLane.fieldSlowMultiplier : 1;
  }

  function clearRuntimeCaches(){
    clearDifficultyCaches();
    clearGeometryCaches();
  }

  function startLevelTransition(newLevel){
    const cfg = GAME_TUNING.transition;
    levelTransitionTimer = cfg.duration;
    levelTransitionLabel = `Level ${newLevel}`;
    sfxLevelUp();

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
      bossesSpawnedThisLevel = 0;
      levelMultiShotUpgrades = 0;
      slowFieldTimer = 0;
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
  let bossesSpawnedThisLevel = 0;
  let levelMultiShotUpgrades = 0;
  let slowFieldTimer = 0;
  let fieldProjectorCharge = 0;
  let fieldChargeTransfers = [];
  let notifPopup = null, notifPopupTimer = 0;
  let transientStatusTimer = 0;
  let pickupFlashTimer = 0;
  let levelTransitionTimer = 0, levelTransitionLabel = '';
  let wallHealth = LEVEL_DEFS[0].wall.maxHealth, wallMax = LEVEL_DEFS[0].wall.maxHealth, wallBroken = false;
  let wallRebuffEffects = [];
  let wallContactIntensity = 0;

  function showTransientStatus(text, duration){
    statusEl.textContent = text;
    transientStatusTimer = Math.max(transientStatusTimer, duration || 1.2);
  }

  function triggerPickupFlash(duration){
    pickupFlashTimer = Math.max(pickupFlashTimer, duration || 0.3);
    canvas.style.boxShadow = '0 0 32px 8px #0ff';
  }

  function tickTransientEffects(dt){
    if(pickupFlashTimer > 0){
      pickupFlashTimer = Math.max(0, pickupFlashTimer - dt);
      if(pickupFlashTimer === 0) canvas.style.boxShadow = '';
    }

    if(slowFieldTimer > 0){
      // Keep a baseline glow while the slowing field remains online.
      fieldProjectorCharge = Math.min(1, fieldProjectorCharge + dt * 0.22);
    }
    fieldProjectorCharge = Math.max(0, fieldProjectorCharge - dt * 0.42);

    for(let i = fieldChargeTransfers.length - 1; i >= 0; i--){
      const transfer = fieldChargeTransfers[i];
      transfer.age += dt;
      if(transfer.age >= transfer.duration){
        fieldProjectorCharge = Math.min(1, fieldProjectorCharge + 0.36);
        fieldChargeTransfers.splice(i, 1);
      }
    }

    // Advance wall-rebuff shockwave rings.
    for(let i = wallRebuffEffects.length - 1; i >= 0; i--){
      wallRebuffEffects[i].age += dt;
      if(wallRebuffEffects[i].age >= wallRebuffEffects[i].maxAge){
        wallRebuffEffects.splice(i, 1);
      }
    }
    // Decay wall impact glow.
    wallContactIntensity = Math.max(0, wallContactIntensity - dt * 2.5);

    if(transientStatusTimer > 0){
      transientStatusTimer = Math.max(0, transientStatusTimer - dt);
      if(transientStatusTimer === 0 && running && !paused && statusEl.style.display === 'none'){
        statusEl.textContent = '';
      }
    }
  }

  function applyGunPowerup(gunCap, subtype){
    const canGainMulti = player.multiShot < gunCap.gunMaxMultiShot;
    const canGainMultiThisLevel = levelMultiShotUpgrades < gunCap.gunMaxMultiUpgradesPerLevel;
    const canGainRate = player.shootDelay > gunCap.gunShootDelayFloor + 0.001;

    if(subtype === 'multishot'){
      if(canGainMulti && canGainMultiThisLevel){
        player.multiShot++;
        levelMultiShotUpgrades++;
        showTransientStatus(`Multi-Shot! Now shooting ${player.multiShot}!`, 1.2);
        notifPopup = 'Multi-Shot';
        sfxMultiShotPickup();
        return;
      }
      // Fall back to rate boost if multi-shot is maxed
      if(canGainRate){
        player.shootDelay = Math.max(gunCap.gunShootDelayFloor, player.shootDelay - gunCap.gunShootDelayBoost);
        showTransientStatus('Gun Power-Up! Faster shooting!', 1.2);
        notifPopup = 'Gun Boost';
        sfxRateBoostPickup();
        return;
      }
    } else {
      // subtype === 'rate': prioritise rate boost, fall back to multi-shot
      if(canGainRate){
        player.shootDelay = Math.max(gunCap.gunShootDelayFloor, player.shootDelay - gunCap.gunShootDelayBoost);
        showTransientStatus('Gun Power-Up! Faster shooting!', 1.2);
        notifPopup = 'Gun Boost';
        sfxRateBoostPickup();
        return;
      }
      if(canGainMulti && canGainMultiThisLevel){
        player.multiShot++;
        levelMultiShotUpgrades++;
        showTransientStatus(`Multi-Shot! Now shooting ${player.multiShot}!`, 1.2);
        notifPopup = 'Multi-Shot';
        sfxMultiShotPickup();
        return;
      }
    }

    if(canGainMulti && !canGainMultiThisLevel){
      showTransientStatus('Multi-Shot Upgrade Used This Level', 1.2);
      notifPopup = 'Level Limit';
      return;
    }

    showTransientStatus('Gun Maxed For This Level', 1.2);
    notifPopup = 'Maxed';
  }

  function applyUnlockedPowerup(type, subtype, gunCap, sourcePoint){
    triggerPickupFlash(0.3);
    if(type === 'gun'){
      applyGunPowerup(gunCap, subtype);
    } else {
      slowFieldTimer = Math.max(slowFieldTimer, GAME_TUNING.leftLane.fieldDuration);
      if(sourcePoint) queueFieldChargeTransfer(sourcePoint.x, sourcePoint.y);
      fieldProjectorCharge = Math.min(1, fieldProjectorCharge + 0.45);
      rebuffEnemiesAtWall();
      showTransientStatus(`${FIELD_EFFECT_NAME} Active! Horde Slowed`, 1.2);
      notifPopup = 'Field Online';
      sfxFieldPickup();
    }
    notifPopupTimer = 1.2;
    updateUI();
  }

  function updateEntities(dt){
    player.update(dt);

    for(let i=0;i<bullets.length;i++) bullets[i].update(dt);
    for(let i=0;i<enemies.length;i++) enemies[i].update(dt);
    for(let i=0;i<powerups.length;i++) powerups[i].update(dt);

    removeDeadInPlace(bullets);

    for(let i=0;i<enemies.length;i++) enemies[i]._bounds = enemies[i].bounds();
    for(let i=0;i<powerups.length;i++) powerups[i]._bounds = powerups[i].bounds();
  }

  function resolveBulletCollisions(gunCap){
    let needsUIRefresh = false;

    for(let i=0;i<bullets.length;i++){
      const bullet = bullets[i];
      if(bullet.dead) continue;

      const bulletBounds = bullet.bounds();

      for(let j=0;j<enemies.length;j++){
        const enemy = enemies[j];
        if(enemy.dead) continue;
        if(!collide(bulletBounds, enemy._bounds)) continue;

        enemy.hit();
        bullet.dead = true;
        if(enemy.dead){ sfxEnemyDeath(); needsUIRefresh = true; }
        else { sfxEnemyHit(); }
        break;
      }

      if(bullet.dead) continue;

      for(let j=0;j<powerups.length;j++){
        const powerup = powerups[j];
        if(powerup.dead) continue;
        if(!collide(bulletBounds, powerup._bounds)) continue;

        bullet.dead = true;
        if(powerup.locked){
          powerup.hit();
        } else {
          powerup.dead = true;
          const pickupPoint = {
            x: powerup._bounds.x + powerup._bounds.w * 0.5,
            y: powerup._bounds.y + powerup._bounds.h * 0.5
          };
          applyUnlockedPowerup(powerup.type, powerup.subtype, gunCap, pickupPoint);
        }
        break;
      }
    }

    if(needsUIRefresh) updateUI();
  }

  function resolveEnemyContacts(dt){
    const wallRect = getWallRect();
    const playerBounds = player.bounds();
    let needsUIRefresh = false;

    for(let i=0;i<enemies.length;i++){
      const enemy = enemies[i];
      if(enemy.dead) continue;
      const enemyBounds = enemy._bounds;

      if(!wallBroken && collide(enemyBounds, wallRect)){
        // Keep the enemy pinned to the barrier and let it chip wall HP over time.
        const overlap = (enemyBounds.y + enemyBounds.h) - wallRect.y;
        if(overlap > 0){
          enemy.y -= overlap;
          enemyBounds.y -= overlap;
        }

        // Build up the impact glow while enemies press against the wall.
        wallContactIntensity = Math.min(1, wallContactIntensity + dt * 4);

        enemy.attackTimer -= dt;
        if(enemy.attackTimer <= 0){
          enemy.resetAttackTimer();
          wallHealth = Math.max(0, wallHealth - 1);
          if(wallHealth <= 0){
            wallBroken = true;
            showTransientStatus('Wall Broken!', 0.9);
            sfxWallBroken();
          } else {
            sfxWallHit();
          }
          needsUIRefresh = true;
        }
        continue;
      }

      if(collide(enemyBounds, playerBounds)){
        enemy.dead = true;
        player.lives--;
        needsUIRefresh = true;
        sfxPlayerHit();
        if(player.lives <= 0){
          endGame();
          break;
        }
      }
    }

    if(needsUIRefresh) updateUI();
  }

  function rebuffEnemiesAtWall(){
    const wallRect = getWallRect();
    // Extend the rebuff zone upward so enemies approaching the wall also get pushed.
    const rebuffZone = { x: wallRect.x, y: wallRect.y - REBUFF_RANGE, w: wallRect.w, h: wallRect.h + REBUFF_RANGE };
    const rebuffDist = 50;
    let anyAffected = false;
    for(let i=0;i<enemies.length;i++){
      const enemy = enemies[i];
      if(enemy.dead) continue;
      const b = enemy._bounds || enemy.bounds();
      if(collide(b, rebuffZone)){
        enemy.rebuffVelY = REBUFF_PUSH_VELOCITY;
        anyAffected = true;
      }
    }
    // Spawn a shockwave ring at the wall face whenever the rebuff fires on at least one enemy.
    if(anyAffected){
      wallRebuffEffects.push({
        cx: wallRect.x + wallRect.w / 2,
        cy: wallRect.y,
        maxRadius: REBUFF_RANGE + rebuffDist,
        age: 0,
        maxAge: 0.55
      });
    }
  }

  function resolveEnemyEnemyCollisions(){
    for(let i=0;i<enemies.length;i++){
      const a = enemies[i];
      if(a.dead) continue;
      const ba = a._bounds;
      for(let j=i+1;j<enemies.length;j++){
        const b = enemies[j];
        if(b.dead) continue;
        const bb = b._bounds;
        if(!collide(ba, bb)) continue;

        const overlapX = Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x);
        const overlapY = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y);
        if(overlapX <= 0 || overlapY <= 0) continue;

        // Compute lane width at average depth for laneT ↔ pixel conversion.
        const avgY = (a.y + b.y) / 2;
        const lane = getEnemyLaneBounds(avgY);
        const laneWidth = Math.max(1, lane.right - lane.left);

        if(overlapX <= overlapY){
          // Enemies are mostly side-by-side: push apart laterally.
          const half = overlapX * ENEMY_COLLISION_RESOLVE_FRACTION / 2;
          if(ba.x < bb.x){
            a.laneT = clamp(a.laneT - half / laneWidth, 0, MAX_ENEMY_LANE_T);
            b.laneT = clamp(b.laneT + half / laneWidth, 0, MAX_ENEMY_LANE_T);
            ba.x -= half; bb.x += half;
          } else {
            a.laneT = clamp(a.laneT + half / laneWidth, 0, MAX_ENEMY_LANE_T);
            b.laneT = clamp(b.laneT - half / laneWidth, 0, MAX_ENEMY_LANE_T);
            ba.x += half; bb.x -= half;
          }
        } else {
          // Enemies are mostly front-back: allow them to stack in 3D depth order
          // (back-to-front draw sorting handles occlusion). Only give a gentle
          // lateral nudge so they naturally spread out when sharing the same column.
          const aCenterX = ba.x + ba.w / 2;
          const bCenterX = bb.x + bb.w / 2;
          if(ba.y <= bb.y){
            const nudgeDir = aCenterX < bCenterX ? -1 : aCenterX > bCenterX ? 1 : (Math.random() < 0.5 ? -1 : 1);
            a.lateralVel = clamp(a.lateralVel + nudgeDir * 0.5, -1, 1);
          } else {
            const nudgeDir = bCenterX < aCenterX ? -1 : bCenterX > aCenterX ? 1 : (Math.random() < 0.5 ? -1 : 1);
            b.lateralVel = clamp(b.lateralVel + nudgeDir * 0.5, -1, 1);
          }
        }
      }
    }
  }

  function resolvePowerupContacts(){
    const playerBounds = player.bounds();
    let needsUIRefresh = false;

    for(let i=0;i<powerups.length;i++){
      const powerup = powerups[i];
      if(powerup.dead || !powerup.locked) continue;

      if(collide(powerup._bounds, playerBounds)){
        powerup.dead = true;
        player.lives--;
        needsUIRefresh = true;
        if(player.lives <= 0){
          endGame();
          break;
        }
      }
    }

    if(needsUIRefresh) updateUI();
  }

  function reset(){
    player=new Player(); bullets=[]; enemies=[]; powerups=[];
    lastTime=performance.now(); spawnTimer=0; powerupTimer=0;
    level = 1;
    levelSpawned = 0;
    bossesSpawnedThisLevel = 0;
    levelMultiShotUpgrades = 0;
    slowFieldTimer = 0;
    fieldProjectorCharge = 0;
    fieldChargeTransfers = [];
    const openingDifficulty = getDifficultyForLevel(level);
    wallMax = openingDifficulty.wallMaxHealth;
    wallHealth = wallMax;
    wallBroken = false;
    wallRebuffEffects = [];
    wallContactIntensity = 0;
    notifPopup = null; notifPopupTimer = 0;
    transientStatusTimer = 0;
    pickupFlashTimer = 0;
    canvas.style.boxShadow = '';
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
        // Determine if the last 25% of the wave has started.
        const progressRatio = difficulty.enemyQuota > 0 ? levelSpawned / difficulty.enemyQuota : 0;
        const isEndOfWave = progressRatio >= GAME_TUNING.boss.waveThreshold;
        const maxBosses = difficulty.maxBossesPerLevel || 0;
        for(let i=0;i<burst;i++){
          // Keep some clustering for horde feel without overwhelming density.
          const tBase = Math.random()*0.78 + 0.11;
          const t = tBase + (Math.random()-0.5)*0.10;
          const y = g.topY + 10 - Math.random()*26;

          // Determine size class from per-level spawn probabilities.
          let sizeClass;
          if(isEndOfWave && bossesSpawnedThisLevel < maxBosses) {
            // Force boss(es) first in the last quarter of the wave, one per burst slot until quota reached.
            sizeClass = 'boss';
            bossesSpawnedThisLevel++;
          } else if(isEndOfWave) {
            // After bosses are placed, flood with small enemies that swarm around them.
            sizeClass = 'small';
          } else {
            const sizeRoll = Math.random();
            if(sizeRoll < difficulty.giantChance){
              sizeClass = 'giant';
            } else if(sizeRoll < difficulty.giantChance + difficulty.smallChance){
              sizeClass = 'small';
            } else {
              sizeClass = 'medium';
            }
          }

          // Health, speed, and attack rate differ meaningfully by size class.
          let health, speedMult, attackMult;
          if(sizeClass === 'small'){
            health = 1;
            speedMult = 1.35;
            attackMult = 1.4;
          } else if(sizeClass === 'giant'){
            health = 8 + difficulty.healthBonus + (Math.random() < difficulty.eliteChance ? 2 : 0);
            speedMult = 0.50;
            attackMult = 0.65;
          } else if(sizeClass === 'boss'){
            health = 50 + difficulty.healthBonus * 2 + (Math.random() < difficulty.eliteChance ? 5 : 0);
            speedMult = 0.65;
            attackMult = 0.45;
          } else {
            health = 1 + difficulty.healthBonus + (Math.random() < difficulty.eliteChance ? 1 : 0);
            speedMult = 1.0;
            attackMult = 1.0;
          }

          const speed = (difficulty.speedMin + Math.random()*(difficulty.speedMax - difficulty.speedMin)) * speedMult;
          const attackMin = difficulty.attackMin * attackMult;
          const attackMax = difficulty.attackMax * attackMult;
          const enemy = new Enemy(clamp(t, 0, MAX_ENEMY_LANE_T), y, speed, health, attackMin, attackMax, sizeClass);
          enemies.push(enemy);
          levelSpawned++;
        }
      }
    }
    // Left lane events: gun crates plus slowing-field activator crates.
    powerupTimer -= dt;
    if(powerupTimer<=0){
      powerupTimer = difficulty.powerupIntervalMin + Math.random()*(difficulty.powerupIntervalMax - difficulty.powerupIntervalMin);
      const t = Math.random();
      const y = g.topY + 8;
      const gunChance = getLeftLaneGunChance(level);
      const type = Math.random() < gunChance ? 'gun' : 'field';
      const baseShots = difficulty.lockBase + Math.floor(Math.random()*(difficulty.lockRange + 1));
      const shots = type==='gun' ? baseShots : Math.max(2, baseShots - 1);
      const subtype = type === 'gun' ? (Math.random() < difficulty.gunMultiShotChance ? 'multishot' : 'rate') : null;
      powerups.push(new PowerUp(t, y, type, shots, subtype));
    }
  }

  function update(dt){
    accum += dt;
    tickTransientEffects(dt);

    if(slowFieldTimer > 0){
      slowFieldTimer = Math.max(0, slowFieldTimer - dt);
    }

    if(levelTransitionTimer > 0){
      levelTransitionTimer -= dt;
      if(levelTransitionTimer <= 0){
        levelTransitionTimer = 0;
        levelTransitionLabel = '';
      }
      updateUI();
      return;
    }

    const gunCap = getDifficultyForLevel(level);
    updateEntities(dt);
    resolveBulletCollisions(gunCap);
    resolveEnemyContacts(dt);
    resolveEnemyEnemyCollisions();
    if(!running) return;
    resolvePowerupContacts();

    removeDeadInPlace(bullets);
    removeDeadInPlace(enemies);
    removeDeadInPlace(powerups);
    syncLevel();

    if(levelTransitionTimer <= 0) spawnWave(dt);
    updateUI();
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

    const laneTopLeft = { x: roadCenterX + wallWidthTop/2, y: roadTopY };
    const laneTopRight = { x: roadCenterX + roadWidthTop/2, y: roadTopY };
    const laneBottomLeft = { x: roadCenterX + wallWidthBottom/2, y: roadBottomY };
    const laneBottomRight = { x: roadCenterX + roadWidthBottom/2, y: roadBottomY };

    // Right lane
    ctx.beginPath();
    ctx.moveTo(laneTopLeft.x, laneTopLeft.y);
    ctx.lineTo(laneTopRight.x, laneTopRight.y);
    ctx.lineTo(laneBottomRight.x, laneBottomRight.y);
    ctx.lineTo(laneBottomLeft.x, laneBottomLeft.y);
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

    const projector = getFieldProjectorAnchor();

    if(fieldChargeTransfers.length > 0){
      ctx.save();
      for(let i=0;i<fieldChargeTransfers.length;i++){
        const transfer = fieldChargeTransfers[i];
        const t = clamp(transfer.age / Math.max(0.001, transfer.duration), 0, 1);
        const hx = lerp(transfer.sx, transfer.tx, t);
        const hy = lerp(transfer.sy, transfer.ty, t);
        const arcLift = 22 + 10 * Math.sin((accum * 9.2) + transfer.wobble);
        const cx = (transfer.sx + transfer.tx) * 0.5 + Math.sin((accum * 7.1) + transfer.wobble) * 14;
        const cy = Math.min(transfer.sy, transfer.ty) - arcLift;

        ctx.strokeStyle = 'rgba(136, 255, 243, 0.66)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(transfer.sx, transfer.sy);
        ctx.quadraticCurveTo(cx, cy, hx, hy);
        ctx.stroke();

        ctx.fillStyle = 'rgba(210, 255, 248, 0.92)';
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const projectorPulse = 0.5 + 0.5 * Math.sin(accum * 8.4);
    const projectorEnergy = clamp(fieldProjectorCharge + (slowFieldTimer > 0 ? 0.45 : 0), 0, 1);

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(projector.x, projector.y + 14, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#6e7a86';
    ctx.fillRect(projector.x - 10, projector.y + 2, 20, 9);
    ctx.fillStyle = '#8e9aa6';
    ctx.fillRect(projector.x - 8, projector.y - 7, 16, 12);
    ctx.strokeStyle = 'rgba(31, 37, 43, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(projector.x - 8, projector.y - 7, 16, 12);

    if(projectorEnergy > 0.01){
      const glow = ctx.createRadialGradient(projector.x, projector.y - 1, 1, projector.x, projector.y - 1, 20 + projectorEnergy * 8);
      glow.addColorStop(0, `rgba(185, 255, 246, ${0.42 + projectorEnergy * 0.28})`);
      glow.addColorStop(1, 'rgba(86, 220, 205, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(projector.x, projector.y - 1, 20 + projectorEnergy * 8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(202, 255, 249, ${0.45 + projectorEnergy * 0.48 + projectorPulse * 0.06})`;
    ctx.beginPath();
    ctx.arc(projector.x, projector.y - 1, 4.4 + projectorEnergy * 1.9, 0, Math.PI * 2);
    ctx.fill();

    if(slowFieldTimer > 0){
      const activeRatio = clamp(slowFieldTimer / Math.max(0.001, GAME_TUNING.leftLane.fieldDuration), 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(accum * 10.5);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(laneTopLeft.x, laneTopLeft.y);
      ctx.lineTo(laneTopRight.x, laneTopRight.y);
      ctx.lineTo(laneBottomRight.x, laneBottomRight.y);
      ctx.lineTo(laneBottomLeft.x, laneBottomLeft.y);
      ctx.closePath();
      ctx.clip();

      const laneGlow = ctx.createLinearGradient(laneTopLeft.x, roadTopY, laneBottomRight.x, roadBottomY);
      laneGlow.addColorStop(0, `rgba(66, 236, 215, ${0.26 + activeRatio * 0.20})`);
      laneGlow.addColorStop(1, `rgba(40, 112, 142, ${0.16 + activeRatio * 0.10})`);
      ctx.fillStyle = laneGlow;
      ctx.fillRect(laneTopLeft.x - 12, roadTopY, laneBottomRight.x - laneTopLeft.x + 24, roadBottomY - roadTopY);

      ctx.globalAlpha = Math.min(0.85, 0.26 + activeRatio * 0.38 + pulse * 0.15);
      ctx.strokeStyle = '#97fff4';
      ctx.lineWidth = 1.5;
      for(let i=0;i<11;i++){
        const scanT = 1 - ((accum * 0.9 + i / 11) % 1);
        const y = lerp(roadTopY, roadBottomY, scanT);
        const leftX = lerp(laneTopLeft.x, laneBottomLeft.x, scanT);
        const rightX = lerp(laneTopRight.x, laneBottomRight.x, scanT);
        const skew = -Math.sin((accum * 7.8) + i * 0.7) * 4;
        ctx.beginPath();
        ctx.moveTo(leftX + 2 + skew, y);
        ctx.lineTo(rightX - 2 + skew, y);
        ctx.stroke();
      }

      ctx.globalAlpha = Math.min(0.92, 0.56 + pulse * 0.24);
      ctx.strokeStyle = 'rgba(163, 255, 246, 0.94)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(laneTopLeft.x, laneTopLeft.y);
      ctx.lineTo(laneBottomLeft.x, laneBottomLeft.y);
      ctx.moveTo(laneTopRight.x, laneTopRight.y);
      ctx.lineTo(laneBottomRight.x, laneBottomRight.y);
      ctx.stroke();

      // Emission rays from projector in an even semi-circle, reaching only
      // as far as the rebuff field boundary (REBUFF_RANGE pixels).
      ctx.globalAlpha = Math.min(0.78, 0.36 + pulse * 0.22);
      ctx.strokeStyle = 'rgba(134, 255, 244, 0.90)';
      ctx.lineWidth = 1.4;
      const numRays = 7;
      for(let i = 0; i < numRays; i++){
        // Fan evenly from left (-π) through straight-up (-π/2) to right (0).
        const angle = -Math.PI + (Math.PI / (numRays - 1)) * i;
        // Subtle per-ray length pulse so lines breathe slightly out of phase.
        const rayLen = REBUFF_RANGE * (0.82 + 0.18 * Math.sin(accum * 3.5 + i * 0.9));
        const tx = projector.x + Math.cos(angle) * rayLen;
        const ty = (projector.y - 1) + Math.sin(angle) * rayLen;
        ctx.beginPath();
        ctx.moveTo(projector.x, projector.y - 1);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();

    // Draw enemies back-to-front so closer ones naturally occlude farther ones.
    // Bosses are drawn in a second pass so they always appear on top of other enemies.
    enemies.sort((a, b) => a.y - b.y);
    const bossDraw = [];
    for(let i=0;i<enemies.length;i++){
      if(enemies[i].sizeClass === 'boss') bossDraw.push(enemies[i]);
      else enemies[i].draw();
    }
    for(let i=0;i<bossDraw.length;i++) bossDraw[i].draw();
    for(let i=0;i<powerups.length;i++) powerups[i].draw();

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

      // Impact glow: flares up while enemies are pressing against the wall.
      if(wallContactIntensity > 0){
        const glowAlpha = wallContactIntensity * 0.55;
        ctx.save();
        ctx.globalAlpha = glowAlpha;
        ctx.shadowColor = '#ff6622';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = '#ffaa55';
        ctx.lineWidth = 3;
        ctx.strokeRect(wallRect.x - 1, wallRect.y - 1, wallRect.w + 2, wallRect.h + 2);
        ctx.restore();
      }
    } else {
      ctx.strokeStyle = '#f44';
      ctx.lineWidth = 3;
      ctx.setLineDash([8,6]);
      ctx.strokeRect(wallRect.x, wallRect.y, wallRect.w, wallRect.h);
      ctx.setLineDash([]);
    }
    ctx.restore();

    // Wall-rebuff shockwave rings: expanding arcs that fade as they travel outward.
    if(wallRebuffEffects.length > 0){
      ctx.save();
      for(const fx of wallRebuffEffects){
        const progress = fx.age / fx.maxAge;
        const radius = fx.maxRadius * progress;
        const alpha = 0.75 * (1 - progress);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#66ddff';
        ctx.lineWidth = Math.max(1, 3.5 * (1 - progress * 0.6));
        ctx.shadowColor = '#44aaff';
        ctx.shadowBlur = 8;
        // Draw a half-ellipse opening upward from the wall face to show the push wave.
        ctx.beginPath();
        ctx.ellipse(fx.cx, fx.cy, radius * 1.1, radius * 0.55, 0, Math.PI, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Foreground
    player.draw();
    for(let i=0;i<bullets.length;i++) bullets[i].draw();
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

  function startGame(){
    if(running) return;
    running = true;
    paused = false;
    statusEl.style.display = 'none';
    reset();
    updatePauseButton();
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function endGame(){
    running = false;
    paused = false;
    transientStatusTimer = 0;
    pickupFlashTimer = 0;
    canvas.style.boxShadow = '';
    releasePointer();
    updatePauseButton();
    statusEl.style.display = 'block';
    statusEl.textContent = 'Game Over — Press any key or tap to Restart';
    sfxGameOver();
  }

  function updateUI(){
    const difficulty = getDifficultyForLevel(level);
    const waveRemaining = Math.max(0, (difficulty.enemyQuota - levelSpawned) + enemies.length);

    if(hudLevelEl && hudWaveEl){
      hudLevelEl.textContent = `Lvl ${level}`;
      hudWaveEl.textContent = `Wave ${waveRemaining}`;
      return;
    }

    // Fallback string for older markup, still without player/wall HP text.
    hudEl.textContent = `Lvl: ${level} | Wave Left: ${waveRemaining}`;
  }

  // initial
  reset(); updatePauseButton(); statusEl.style.display='block'; statusEl.textContent='Press any key or tap to start';
  // expose quick debug on window
  window._game = {
    start: startGame,
    stop: endGame,
    pause: togglePause,
    clearCaches: clearRuntimeCaches,
    tuning: GAME_TUNING,
    levels: LEVEL_DEFS,
    get slowFieldTimer(){ return slowFieldTimer; },
    set slowFieldTimer(v){ slowFieldTimer = v; },
    get fieldProjectorCharge(){ return fieldProjectorCharge; },
    set fieldProjectorCharge(v){ fieldProjectorCharge = v; },
    get level(){ return level; },
    set level(v){ level = v; },
    get levelSpawned(){ return levelSpawned; },
    set levelSpawned(v){ levelSpawned = v; },
    get bossesSpawnedThisLevel(){ return bossesSpawnedThisLevel; },
    set bossesSpawnedThisLevel(v){ bossesSpawnedThisLevel = v; }
  };
})();