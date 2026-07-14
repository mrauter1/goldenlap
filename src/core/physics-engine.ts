import { clamp, lerp, normAng } from '../shared/math';
import { PHYS, SURF } from './physics';
import { hashNearest } from './track';
import type { Car, CarInput, CarModifiers, SurfaceState, Track } from './model';

export function makeCar(x: number, y: number, h: number): Car {
  return {
    x, y, h, vx: 0, vy: 0, r: 0, steer: 0,
    rev: false, revT: 0,
    progIdx: -1, s: 0, offCourse: false,
    slipF: 0, slipR: 0, spd: 0, driveSat: 0
  };
}

export function trackSense(track: Track, car: Car): SurfaceState {
  const N = track.n;
  let bi = -1, bd = Infinity;
  if (car.progIdx >= 0){
    for (let k = -12; k <= 55; k++){
      const i = (car.progIdx + k + N) % N;
      const dx = track.x[i]! - car.x, dy = track.y[i]! - car.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd){ bd = d2; bi = i; }
    }
  }
  if (bi < 0 || bd > 784 /* 28^2 */){
    const g = hashNearest(track, car.x, car.y, 8);
    if (g.i >= 0 && g.d2 < bd){ bd = g.d2; bi = g.i; }
  }
  if (bi < 0){
    car.offCourse = true;
    return { zone: 'grass', mu: SURF.grass.mu, drag: SURF.grass.drag, lat: 999 };
  }
  car.progIdx = bi;
  const dx = car.x - track.x[bi]!, dy = car.y - track.y[bi]!;
  const along = dx * track.tx[bi]! + dy * track.ty[bi]!;
  const lat = dx * track.nx[bi]! + dy * track.ny[bi]!;
  car.s = ((bi * track.step + along) % track.len + track.len) % track.len;
  car.offCourse = bd > 784;
  const al = Math.abs(lat), hw = track.hw;
  let zone: keyof typeof SURF;
  if (al < hw - 1.0) zone = 'road';
  else if (al < hw + 1.3) zone = 'curb';
  else zone = 'grass';
  const su = SURF[zone];
  return { zone, mu: su.mu, drag: su.drag, lat };
}

export function stepCar(
  c: Car,
  inp: CarInput,
  surf: SurfaceState,
  dt: number,
  mods?: CarModifiers
): void {
  const P = PHYS;
  const mPw = mods ? mods.pw : 1, mMu = mods ? mods.mu : 1, mDr = mods ? mods.dr : 1;
  const spd = Math.hypot(c.vx, c.vy);
  // steering: speed sensitive + rate limited
  const dMax = P.steerMax / (1 + Math.abs(c.vx) / P.steerFade);
  const target = clamp(inp.steer, -1, 1) * dMax;
  c.steer += (target - c.steer) * Math.min(1, dt * P.steerLerp);

  // reverse latch (hold brake at standstill)
  if (!c.rev){
    if (inp.brake > 0.4 && c.vx < 0.4 && inp.throttle < 0.05){
      c.revT += dt;
      if (c.revT > 0.22){ c.rev = true; c.revT = 0; }
    } else c.revT = 0;
  } else if (inp.throttle > 0.05 || c.vx > 0.6){
    c.rev = false; c.revT = 0;
  }

  const muS = surf.mu;
  const df = Math.min(P.kDf * c.vx * c.vx, P.dfMax);
  const FzF = P.m * P.g * P.b / P.L + df * P.dfFront;
  const FzR = P.m * P.g * P.a / P.L + df * (1 - P.dfFront);
  const muF = P.mu * muS * mMu;
  let muR = P.mu * P.muRearBonus * muS * mMu;
  const hb = inp.hand ? 1 : 0;
  if (hb) muR *= 0.38;

  const dirv = c.vx >= 0 ? 1 : -1;
  let drive = 0, bF = 0, bR = 0;
  if (c.rev){
    drive = -inp.brake * P.revForce;
    if (c.vx < -11) drive = 0;
  } else {
    drive = hb ? 0 : inp.throttle * Math.min(P.Fmax * mPw, P.power * mPw / Math.max(spd, 4));
    drive = Math.min(drive, muR * FzR * P.tc);
    bF = Math.min(inp.brake * P.brakeForce * P.brakeBias, muF * FzF);
    bR = Math.min(inp.brake * P.brakeForce * (1 - P.brakeBias), muR * FzR);
  }
  let FxF = -dirv * bF;
  let FxR = hb ? (-dirv * muR * FzR * 0.9)
              : clamp(drive - dirv * bR, -muR * FzR, muR * FzR);

  // slip angles (|vx| clamped away from zero)
  const avx = Math.max(Math.abs(c.vx), 1.2);
  const aF = Math.atan2(c.vy + P.a * c.r, avx) - c.steer;
  const aR = Math.atan2(c.vy - P.b * c.r, avx);
  const latRamp = clamp(spd / 2.5, 0, 1);
  const capF = muF * FzF, capR = muR * FzR;
  const cFx = P.circK * FxF, cRx = P.circK * FxR;
  const FyFmax = Math.sqrt(Math.max(0, capF * capF - cFx * cFx));
  const FyRmax = Math.sqrt(Math.max(0, capR * capR - cRx * cRx));
  const FyF = -FyFmax * Math.tanh(P.slipSharp * aF / P.slipPeakF) * latRamp;
  const FyR = -FyRmax * Math.tanh(P.slipSharp * aR / P.slipPeakR) * latRamp;

  // drag + rolling
  let Fdx = -P.kDrag * mDr * c.vx * Math.abs(c.vx) - c.vx * surf.drag;
  if (Math.abs(c.vx) > 0.3) Fdx -= dirv * P.kRoll;
  const Fdy = -P.kDragLat * c.vy * Math.abs(c.vy);

  const cs = Math.cos(c.steer), sn = Math.sin(c.steer);
  const Fx = FxR + FxF * cs - FyF * sn + Fdx;
  const Fy = FyR + FyF * cs + FxF * sn + Fdy;
  const Mz = P.a * (FyF * cs + FxF * sn) - P.b * FyR - P.yawDamp * c.r;

  const prevVx = c.vx;
  c.vx += (Fx / P.m + c.r * c.vy) * dt;
  c.vy += (Fy / P.m - c.r * c.vx) * dt;
  c.r += (Mz / P.Iz) * dt;

  // braking must not push through zero
  if (!c.rev && inp.brake > 0.1 && drive <= 0 && prevVx * c.vx < 0) c.vx = 0;

  // low-speed kinematic blend + lateral bleed
  const wLow = clamp(1 - spd / 5, 0, 1);
  if (wLow > 0){
    const rKin = (c.vx / P.L) * Math.tan(c.steer);
    c.r = lerp(c.r, rKin, wLow * Math.min(1, dt * 10));
    c.vy *= 1 / (1 + dt * 8 * wLow);
  }
  // full stop clamp
  if (!c.rev && inp.throttle < 0.02 && Math.abs(c.vx) < 0.25 && spd < 0.4){
    c.vx *= 0.6; c.vy *= 0.6; c.r *= 0.6;
  }

  c.r = clamp(c.r, -6, 6);
  c.vy = clamp(c.vy, -60, 60);
  c.h = normAng(c.h + c.r * dt);
  const ch = Math.cos(c.h), sh = Math.sin(c.h);
  c.x += (c.vx * ch - c.vy * sh) * dt;
  c.y += (c.vx * sh + c.vy * ch) * dt;

  c.slipF = aF; c.slipR = aR; c.spd = spd;
  c.driveSat = (!c.rev && drive > 0 && drive >= capR * P.tc - 1) ? 1 : 0;
}

// ---------------------------------------------------------------- lap logic
