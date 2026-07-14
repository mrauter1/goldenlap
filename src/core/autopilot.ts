import { clamp, normAng } from '../shared/math';
import { PHYS } from './physics';
import type {
  BotParameters, Car, CarInput, PathFollowerTuning, SpeedProfile, Track
} from './model';

export const PATH_FOLLOWER_TUNING: Readonly<PathFollowerTuning> = {
  lookaheadBase: 1,
  lookaheadSpeed: 0.36,
  lookaheadMinimum: 5,
  lookaheadMaximum: 28,
  pursuitGain: 3.7,
  feedForwardGain: 0.2,
  crossTrackGain: 0.9,
  lateralVelocityGain: 0.55,
  crossTrackBase: 30,
  crossTrackSpeedSquared: 0.05
};

export function botStep(
  track: Track,
  prof: SpeedProfile,
  car: Car,
  prm?: BotParameters
): CarInput {
  const P = PHYS, N = track.n;
  const margin = prm && prm.margin !== undefined ? prm.margin : 0.965;
  const muS = prm && prm.muScale !== undefined ? prm.muScale : 1;
  const latT = prm ? (prm.lat || 0) : 0;
  const vCap = prm && prm.vCap !== undefined ? prm.vCap : Infinity;
  const path = prm && prm.path;
  const pathOff = path && path.off ? path.off : null;
  const pathK = path && path.k ? path.k : track.kSm;
  const pathV = path?.v ?? prof.v;
  const pathDs = path && path.ds ? path.ds : null;
  const pathTuning = prm?.pathTuning ?? PATH_FOLLOWER_TUNING;
  const offAt = (q: number): number => (pathOff ? pathOff[q]! : 0) + latT;
  const speedAt = (q: number): number => pathV[q]! * Math.sqrt(clamp(1 - pathK[q]! * latT, 0.75, 1.05));
  const gripV = Math.sqrt(muS);
  const v = Math.hypot(car.vx, car.vy);
  const i = car.progIdx < 0 ? 0 : car.progIdx;
  const Ld = pathOff
    ? clamp(
        pathTuning.lookaheadBase + v * pathTuning.lookaheadSpeed,
        pathTuning.lookaheadMinimum,
        pathTuning.lookaheadMaximum
      )
    : clamp(4 + v * 0.5, 8, 42);
  const ti = (i + Math.max(2, Math.round(Ld / track.step))) % N;
  // pursue the offset path itself (racing line shifted by latT), so large
  // offsets — pit lanes, side-by-side running — track cleanly from any speed
  const latE = (car.x - track.x[i]!) * track.nx[i]! +
    (car.y - track.y[i]!) * track.ny[i]! - offAt(i);
  const tpx = track.x[ti]! + track.nx[ti]! * offAt(ti);
  const tpy = track.y[ti]! + track.ny[ti]! * offAt(ti);
  const err = normAng(Math.atan2(tpy - car.y, tpx - car.x) - car.h);
  const dMax = P.steerMax / (1 + Math.abs(car.vx) / P.steerFade);
  const ch = Math.cos(car.h), sh = Math.sin(car.h);
  const latV = (car.vx * ch - car.vy * sh) * track.nx[i]! +
    (car.vx * sh + car.vy * ch) * track.ny[i]!;
  const dCte = pathOff
    ? (pathTuning.crossTrackGain * latE + pathTuning.lateralVelocityGain * latV) /
      (pathTuning.crossTrackBase + pathTuning.crossTrackSpeedSquared * v * v)
    : (0.9 * latE + 0.55 * latV) / (30 + 0.05 * v * v);
  const feedForward = pathOff
    ? Math.atan(P.L * pathK[ti]!) * pathTuning.feedForwardGain
    : 0;
  const pursuitGain = pathOff ? pathTuning.pursuitGain : 2;
  const delta = Math.atan2(pursuitGain * Math.sin(err) * P.L, Ld) - dCte + feedForward;
  let steer = clamp(delta / Math.max(dMax, 1e-4), -1, 1);
  // anticipatory target speed: brake early enough for everything ahead
  let vt = Math.min(speedAt(i) * margin * gripV, vCap);
  let sAcc = 0;
  const horizon = Math.min(N - 2, Math.ceil(240 / track.step));
  for (let j = 1; j <= horizon; j++){
    sAcc += pathDs ? pathDs[(i + j - 1) % N]! : track.step;
    const jj = (i + j) % N;
    const vj = speedAt(jj) * margin * gripV;
    if (vj >= vt) continue;
    const ge = P.profMu * P.mu * muS * (P.g + Math.min(P.kDf * vj * vj, P.dfMax) / P.m);
    const aLatJ = vj * vj * Math.abs(pathK[jj]!);
    const room = Math.sqrt(Math.max(0.25, ge * ge - aLatJ * aLatJ));
    const allow = Math.sqrt(vj * vj + 2 * 0.82 * room * sAcc);
    if (allow < vt) vt = allow;
  }
  const brake = clamp((v - vt) * 0.8, 0, 1);
  let throttle = brake > 0.04 ? 0 : clamp((vt - v) * 0.6, 0, 1);
  // never accelerate while an axle is saturated (above walking pace — at a
  // standstill the slip angle is just steering lock, not wheelspin)
  if (v > 4 && (Math.abs(car.slipF) > 0.11 || Math.abs(car.slipR) > 0.11)) throttle = 0;
  return { steer, throttle, brake, hand: false };
}
// car-vs-car collisions; returns impacts [{i, j, imp}] for game-layer effects
