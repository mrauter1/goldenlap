import type { Car, Track } from '../../core/model';
import { cornerSpeedForGrip } from '../../core/physics';
import { surfaceExposureAtLateral } from '../../core/surface';
import { clamp } from '../../shared/math';
import type {
  Entry,
  PathPlan,
  Session
} from '../model';
import {
  dynamicMuAtSample,
  entryDownforceScale,
  entryDirtyAirGripLoss,
  entryMargin,
  entryMu,
  flowOff
} from '../strategy';
import { sampleCompactPathPlanOffsetAnalytic } from './compact-path';

export type RacecraftFamilyEntry = Entry & { car: Car };

export interface RacecraftFamilyState {
  lateral: number;
  curvature: number;
  q: number;
  /** Authored body tangent relative to the local track tangent. */
  headingOffsetRadians: number;
  targetSpeed: number;
  dynamicMu: number;
  surfaceDrag: number;
}

export interface RacecraftFamilyGeometry {
  lateral: number;
  curvature: number;
  q: number;
  /** Authored body tangent relative to the local track tangent. */
  headingOffsetRadians: number;
}

interface CachedFamilyDynamics {
  session: Session;
  at: number;
  baseMu: number;
  dirtyAirGripLoss: number;
  downforceScale: number;
  margin: number;
}

const familyDynamicsCache = new WeakMap<Entry, CachedFamilyDynamics>();

interface CachedFamilyStates {
  session: Session;
  entry: Entry;
  at: number;
  byProgress: Map<number, RacecraftFamilyState>;
}

const familyStateCache = new WeakMap<PathPlan, CachedFamilyStates>();

function familyDynamics(
  session: Session,
  entry: RacecraftFamilyEntry
): CachedFamilyDynamics {
  const cached = familyDynamicsCache.get(entry);
  if (Number.isFinite(session.t) &&
      cached?.session === session &&
      cached.at === session.t)
    return cached;
  const downforceScale = entryDownforceScale(entry);
  const value = {
    session,
    at: session.t,
    baseMu: entryMu(entry, session.wet),
    dirtyAirGripLoss: entryDirtyAirGripLoss(entry, session),
    downforceScale,
    margin: clamp(
      entryMargin(entry, session, session.config.tuneBonus, session.wet) +
        flowOff(entry, session),
      0.85,
      0.985
    )
  };
  if (Number.isFinite(session.t)) familyDynamicsCache.set(entry, value);
  return value;
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

export function racecraftFamilyIndexAtProgress(
  track: Track,
  entry: RacecraftFamilyEntry,
  progress: number
): number {
  return cyclicIndex(
    track,
    entry.car.progIdx + (progress - entry.prog) / track.step
  );
}

/**
 * Exact Frenet geometry of the compact authority. Evaluator prediction and
 * the 30 Hz controller span both consume this conversion.
 */
export function racecraftFamilyGeometryAt(
  track: Track,
  entry: RacecraftFamilyEntry,
  progress: number,
  plan: PathPlan
): RacecraftFamilyGeometry {
  const index = racecraftFamilyIndexAtProgress(track, entry, progress);
  const previous = (index - 1 + track.n) % track.n;
  const next = (index + 1) % track.n;
  const offset = sampleCompactPathPlanOffsetAnalytic(
    track,
    plan,
    index,
    progress
  );
  const baseCurvature = track.kSm[index]!;
  const baseCurvatureDerivative =
    (track.kSm[next]! - track.kSm[previous]!) / (2 * track.step);
  const totalOffset = offset.value;
  const lateralSlope = offset.firstDerivative;
  const lateralSecond = offset.secondDerivative;
  const longitudinalScale = 1 - baseCurvature * totalOffset;
  const q = Math.max(
    Number.EPSILON,
    Math.sqrt(
      longitudinalScale * longitudinalScale +
      lateralSlope * lateralSlope
    )
  );
  const numerator = longitudinalScale * lateralSecond +
    baseCurvature * longitudinalScale * longitudinalScale +
    baseCurvatureDerivative * totalOffset * lateralSlope +
    2 * baseCurvature * lateralSlope * lateralSlope;
  return {
    lateral: totalOffset,
    curvature: numerator / (q * q * q),
    q,
    headingOffsetRadians: Math.atan2(
      lateralSlope,
      longitudinalScale
    )
  };
}

/**
 * Analytic Frenet state shared by evaluator scoring and rederived claims.
 * Acquisition/straight members use the compact plan's exact polynomial
 * derivatives; corner members use the cached G2 spline's exact derivatives.
 */
export function racecraftFamilyStateAt(
  session: Session,
  entry: RacecraftFamilyEntry,
  progress: number,
  plan: PathPlan
): RacecraftFamilyState {
  let cached = familyStateCache.get(plan);
  if (!Number.isFinite(session.t) ||
      cached?.session !== session ||
      cached.entry !== entry ||
      cached.at !== session.t) {
    cached = {
      session,
      entry,
      at: session.t,
      byProgress: new Map()
    };
    if (Number.isFinite(session.t)) familyStateCache.set(plan, cached);
  } else {
    const state = cached.byProgress.get(progress);
    if (state) return state;
  }
  const track = session.trk;
  const index = racecraftFamilyIndexAtProgress(track, entry, progress);
  const geometry = racecraftFamilyGeometryAt(
    track,
    entry,
    progress,
    plan
  );
  const {
    lateral,
    curvature,
    q,
    headingOffsetRadians
  } = geometry;
  const exposure = surfaceExposureAtLateral(track, index, lateral);
  const reference = track.idealPath.v[index]!;
  const dynamics = familyDynamics(session, entry);
  const dynamicMu = dynamicMuAtSample(
    dynamics.baseMu,
    dynamics.dirtyAirGripLoss,
    reference,
    curvature,
    dynamics.downforceScale
  ) * exposure.mu;
  const state = {
    lateral,
    curvature,
    q,
    headingOffsetRadians,
    dynamicMu,
    surfaceDrag: exposure.drag,
    targetSpeed: Math.max(0, Math.min(
      reference,
      cornerSpeedForGrip(
        curvature,
        dynamicMu,
        dynamics.downforceScale
      )
    ) * dynamics.margin)
  };
  if (Number.isFinite(session.t)) cached.byProgress.set(progress, state);
  return state;
}
