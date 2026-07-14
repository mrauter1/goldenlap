import type { Car, LapEvent, LapTracker, Track } from './model';

export function makeLap(): LapTracker {
  return { started: false, nextCp: 0, missed: false, resetUsed: false, num: 0 };
}

function segCross(
  ax: number, ay: number, bx: number, by: number,
  px: number, py: number, qx: number, qy: number
): boolean {
  const d1x = bx - ax, d1y = by - ay;
  const d2x = qx - px, d2y = qy - py;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((px - ax) * d2y - (py - ay) * d2x) / den;
  const u = ((px - ax) * d1y - (py - ay) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// One physics tick of race logic. px,py = car position before the step.
// Returns null | {type:'start'} | {type:'lap', valid:boolean}
export function raceTick(track: Track, lap: LapTracker, car: Car, px: number, py: number): LapEvent | null {
  const L = track.line;
  const fwd = (car.x - px) * L.tx + (car.y - py) * L.ty;
  if (fwd > 0 && segCross(L.ax, L.ay, L.bx, L.by, px, py, car.x, car.y)){
    let ev: LapEvent;
    if (!lap.started){
      lap.started = true;
      ev = { type: 'start' };
    } else {
      const valid = lap.nextCp === track.cps.length && !lap.missed && !lap.resetUsed;
      ev = { type: 'lap', valid };
    }
    lap.nextCp = 0; lap.missed = false; lap.resetUsed = false; lap.num++;
    return ev;
  }
  if (lap.started && lap.nextCp < track.cps.length){
    const R2 = track.cpR * track.cpR;
    for (let k = 0; k < 3; k++){
      const ci = lap.nextCp + k;
      if (ci >= track.cps.length) break;
      const c = track.cps[ci]!;
      const dx = car.x - c.x, dy = car.y - c.y;
      if (dx * dx + dy * dy < R2){
        if (k > 0) lap.missed = true;
        lap.nextCp = ci + 1;
        break;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- autopilot (tests / attract)
