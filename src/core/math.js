(function(){
  function clamp(v, min, max){
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t){
    return a + (b - a) * t;
  }

  function collide(a, b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function removeDeadInPlace(list){
    let write = 0;
    for(let read = 0; read < list.length; read++){
      const item = list[read];
      if(!item.dead) list[write++] = item;
    }
    list.length = write;
  }

  window.CoreMath = {
    clamp,
    lerp,
    collide,
    removeDeadInPlace
  };
})();
