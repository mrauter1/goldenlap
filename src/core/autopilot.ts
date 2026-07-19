import { clamp, normAng } from '../shared/math';
import {
  longitudinalAccelerationHeadroom,
  PHYS
} from './physics';
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

/** Road distance reserved after a lateral path transition for the controller to settle. */
export const PATH_FOLLOWER_SETTLE_DISTANCE =
  PATH_FOLLOWER_TUNING.lookaheadMaximum + PHYS.carLen;

/** Furthest path sample considered by the anticipatory brake controller. */
export const BOT_BRAKING_HORIZON_METRES = 240;
export const BOT_BRAKING_EFFORT_MINIMUM = 0.65;
export const BOT_BRAKING_EFFORT_MAXIMUM = 0.96;

/**
 * One backward-induction step from the next sample's installed speed. Grip
 * belongs to this sample; using only the target sample would invent braking
 * room through intermediate corners.
 */
export function backwardInducedSpeedLimit(
  nextSpeed: number,
  localSpeedLimit: number,
  distance: number,
  curvature: number,
  muScale: number,
  downforceScale: number,
  brakingEffort: number,
  passiveDeceleration = 0
): number {
  const localLimit = Math.max(0, localSpeedLimit);
  const next = Math.max(0, nextSpeed);
  const headroom = longitudinalAccelerationHeadroom(
    localLimit,
    curvature,
    muScale,
    downforceScale
  );
  const effort = clamp(
    brakingEffort,
    BOT_BRAKING_EFFORT_MINIMUM,
    BOT_BRAKING_EFFORT_MAXIMUM
  );
  return Math.min(
    localLimit,
    Math.sqrt(
      next * next +
      2 * (
        effort * headroom + Math.max(0, passiveDeceleration)
      ) * Math.max(0, distance)
    )
  );
}

export function botStep(
  track: Track,
  prof: SpeedProfile,
  car: Car,
  prm?: BotParameters
): CarInput {
  const P = PHYS, N = track.n;
  const margin = prm && prm.margin !== undefined ? prm.margin : 0.965;
  const muS = prm && prm.muScale !== undefined ? prm.muScale : 1;
  const downforceScale = Math.max(0, prm?.downforceScale ?? 1);
  const brakingEffort = clamp(
    prm?.brakingEffort ?? 0.82,
    BOT_BRAKING_EFFORT_MINIMUM,
    BOT_BRAKING_EFFORT_MAXIMUM
  );
  const latT = prm ? (prm.lat || 0) : 0;
  const vCap = prm && prm.vCap !== undefined ? prm.vCap : Infinity;
  const path = prm && prm.path;
  const lane = prm?.lane;
  const pathOff = path && path.off ? path.off : null;
  const pathK = path && path.k ? path.k : track.kSm;
  const pathV = path?.v ?? prof.v;
  const pathDs = path && path.ds ? path.ds : null;
  const uniformLaneBias = lane?.uniformBias ?? null;
  const pathTuning = prm?.pathTuning ?? PATH_FOLLOWER_TUNING;
  const activeLane = !!lane && lane.count > 0;
  const ownsPath = !!lane || !!pathOff;
  const v = Math.hypot(car.vx, car.vy);
  const i = car.progIdx < 0 ? 0 : car.progIdx;
  const currentLaneDelta = activeLane
    ? (i - lane.startIndex + N) % N
    : -1;
  const currentLaneSlot = currentLaneDelta >= 0 && currentLaneDelta < lane!.count
    ? currentLaneDelta
    : -1;
  const fallbackBias = uniformLaneBias ?? latT;
  const currentOffset = currentLaneSlot >= 0
    ? lane!.off[currentLaneSlot]!
    : (pathOff ? pathOff[i]! : 0) + fallbackBias;
  const Ld = ownsPath
    ? clamp(
        pathTuning.lookaheadBase + v * pathTuning.lookaheadSpeed,
        pathTuning.lookaheadMinimum,
        pathTuning.lookaheadMaximum
      )
    : clamp(4 + v * 0.5, 8, 42);
  const ti = (i + Math.max(2, Math.round(Ld / track.step))) % N;
  const targetLaneDelta = activeLane
    ? (ti - lane.startIndex + N) % N
    : -1;
  const targetLaneSlot = targetLaneDelta >= 0 && targetLaneDelta < lane!.count
    ? targetLaneDelta
    : -1;
  const targetOffset = targetLaneSlot >= 0
    ? lane!.off[targetLaneSlot]!
    : (pathOff ? pathOff[ti]! : 0) + fallbackBias;
  const targetCurvature = targetLaneSlot >= 0
    ? lane!.k[targetLaneSlot]!
    : pathK[ti]!;
  // pursue the offset path itself (racing line shifted by latT), so large
  // offsets — pit lanes, side-by-side running — track cleanly from any speed
  const latE = (car.x - track.x[i]!) * track.nx[i]! +
    (car.y - track.y[i]!) * track.ny[i]! - currentOffset;
  const tpx = track.x[ti]! + track.nx[ti]! * targetOffset;
  const tpy = track.y[ti]! + track.ny[ti]! * targetOffset;
  const err = normAng(Math.atan2(tpy - car.y, tpx - car.x) - car.h);
  const dMax = P.steerMax / (1 + Math.abs(car.vx) / P.steerFade);
  const ch = Math.cos(car.h), sh = Math.sin(car.h);
  const latV = (car.vx * ch - car.vy * sh) * track.nx[i]! +
    (car.vx * sh + car.vy * ch) * track.ny[i]!;
  const dCte = ownsPath
    ? (pathTuning.crossTrackGain * latE + pathTuning.lateralVelocityGain * latV) /
      (pathTuning.crossTrackBase + pathTuning.crossTrackSpeedSquared * v * v)
    : (0.9 * latE + 0.55 * latV) / (30 + 0.05 * v * v);
  const feedForward = ownsPath
    ? Math.atan(P.L * targetCurvature) * pathTuning.feedForwardGain
    : 0;
  const pursuitGain = ownsPath ? pathTuning.pursuitGain : 2;
  const delta = Math.atan2(pursuitGain * Math.sin(err) * P.L, Ld) - dCte + feedForward;
  let steer = clamp(delta / Math.max(dMax, 1e-4), -1, 1);
  // A race lane is already one composed speed law. Static profile/pit paths
  // still need their own backward induction because they are raw profiles.
  let inducedSpeed = currentLaneSlot >= 0
    ? Math.max(0, lane!.v[currentLaneSlot]!)
    : Infinity;
  if (currentLaneSlot < 0) {
    const horizon = Math.min(
      N - 2,
      Math.ceil(BOT_BRAKING_HORIZON_METRES / track.step)
    );
    for (let offset = horizon; offset >= 0; offset--) {
      const index = (i + offset) % N;
      const sampleSpeed = pathV[index]! * margin;
      if (!Number.isFinite(inducedSpeed)) {
        inducedSpeed = Math.max(0, sampleSpeed);
        continue;
      }
      const distance = pathDs ? pathDs[index]! : track.step;
      inducedSpeed = backwardInducedSpeedLimit(
        inducedSpeed,
        sampleSpeed,
        distance,
        pathK[index]!,
        muS,
        downforceScale,
        brakingEffort
      );
    }
  }
  const vt = Math.min(inducedSpeed, vCap);
  // Speed induction already prices combined-grip headroom. The physics
  // engine owns the actual tyre-force circle; capping input here a second
  // time can make an overspeed car unable to shed speed.
  const brake = clamp((v - vt) * 0.8, 0, 1);
  let throttle = brake > 0.04 ? 0 : clamp((vt - v) * 0.6, 0, 1);
  // never accelerate while an axle is saturated (above walking pace — at a
  // standstill the slip angle is just steering lock, not wheelspin)
  if (v > 4 && (Math.abs(car.slipF) > 0.11 || Math.abs(car.slipR) > 0.11)) throttle = 0;
  return { steer, throttle, brake, hand: false };
}
// car-vs-car collisions; returns impacts [{i, j, imp}] for game-layer effects
