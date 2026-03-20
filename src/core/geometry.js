import { clamp, lerp } from './math.js';

export function getPerspectiveSpeedMultiplier(depthT){
  // Average around 1.0x across depth while still selling perspective.
  return 0.4 + 1.2 * clamp(depthT, 0, 1);
}

export function createGeometrySystem(initialW, initialH){
  let W = initialW;
  let H = initialH;
  let roadGeometryCache = null;

  function recomputeRoadGeometry(){
    const roadWidthTop = clamp(W * 0.23, 150, 240);
    const roadWidthBottom = clamp(W * 0.68, 300, 700);
    const wallWidthTop = clamp(W * 0.015, 8, 16);
    const wallWidthBottom = clamp(W * 0.04, 18, 36);

    roadGeometryCache = {
      // Extend beyond viewport so the road has no visible hard start/stop.
      topY: -Math.round(H * 0.12),
      bottomY: H + Math.round(H * 0.15),
      roadWidthTop,
      roadWidthBottom,
      wallWidthTop,
      wallWidthBottom,
      centerX: W / 2
    };
  }

  function setSize(nextW, nextH){
    W = nextW;
    H = nextH;
    recomputeRoadGeometry();
  }

  function getRoadGeometry(){
    if(!roadGeometryCache) recomputeRoadGeometry();
    return roadGeometryCache;
  }

  function getRoadBounds(y, extrapolate){
    const g = getRoadGeometry();
    const rawDepth = (y - g.topY) / (g.bottomY - g.topY);
    const depthT = extrapolate ? clamp(rawDepth, -0.35, 1.1) : clamp(rawDepth, 0, 1);
    const left = lerp(g.centerX - g.roadWidthTop / 2, g.centerX - g.roadWidthBottom / 2, depthT);
    const right = lerp(g.centerX + g.roadWidthTop / 2, g.centerX + g.roadWidthBottom / 2, depthT);
    return { left, right, depthT };
  }

  function getLaneBounds(y, lane){
    const g = getRoadGeometry();
    const depthT = clamp((y - g.topY) / (g.bottomY - g.topY), 0, 1);
    if(lane === 'left'){
      return {
        left: lerp(g.centerX - g.roadWidthTop / 2, g.centerX - g.roadWidthBottom / 2, depthT),
        right: lerp(g.centerX - g.wallWidthTop / 2, g.centerX - g.wallWidthBottom / 2, depthT),
        depthT
      };
    }

    return {
      left: lerp(g.centerX + g.wallWidthTop / 2, g.centerX + g.wallWidthBottom / 2, depthT),
      right: lerp(g.centerX + g.roadWidthTop / 2, g.centerX + g.roadWidthBottom / 2, depthT),
      depthT
    };
  }

  function getLanePerspectiveRect(y, lane, laneT, baseW, baseH, scaleMultiplier){
    const bounds = getLaneBounds(y, lane);
    const scale = (0.5 + 0.7 * bounds.depthT) * (scaleMultiplier || 1);
    const w = baseW * scale;
    const h = baseH * scale;
    const laneWidth = Math.max(1, bounds.right - bounds.left);
    const usableLane = Math.max(0, laneWidth - w);
    const x = bounds.left + clamp(laneT, 0, 1) * usableLane;
    return { x, y, w, h, scale, depthT: bounds.depthT };
  }

  function getPlayerRoadClamp(y, playerW){
    const road = getRoadBounds(y);
    const sideInset = 16;
    const minX = road.left + sideInset;
    const maxX = road.right - sideInset - playerW;
    return { minX, maxX: Math.max(minX, maxX) };
  }

  function getEnemyLaneBounds(y){
    const bounds = getLaneBounds(y, 'right');
    return { left: bounds.left, right: bounds.right };
  }

  function getWallRect(player){
    // Wall sits slightly up-road from the player and spans the full enemy lane.
    const y = player ? player.y - 14 : H - 94;
    const lane = getEnemyLaneBounds(y + 8);
    const pad = 2;
    return { x: lane.left + pad, y, w: Math.max(24, lane.right - lane.left - pad * 2), h: 16 };
  }

  recomputeRoadGeometry();

  return {
    setSize,
    clearCaches: recomputeRoadGeometry,
    getRoadGeometry,
    getRoadBounds,
    getLanePerspectiveRect,
    getPlayerRoadClamp,
    getWallRect
  };
}
