import type { Car, CompactLateralProgram, Track } from '../../core/model';
import {
  compactLateralGeometryAtProgress,
  writeCompactLateralGeometryAtProgress,
  writeCompactLateralKinematicsAtProgress,
  type CompactLateralSample
} from
  '../../core/lateral-program';
import { cornerSpeedForGrip } from '../../core/physics';
import {
  writeSurfaceExposureAtLateral
} from '../../core/surface';
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
  entryMods,
  entryMu,
  flowOff
} from '../strategy';
import { compileCompactLateralProgram } from './compact-path';
import { racecraftCalibration } from './config';

export type RacecraftFamilyEntry = Entry & { car: Car };

export interface RacecraftFamilyState {
  lateral: number;
  curvature: number;
  q: number;
  /** Authored body tangent relative to the local track tangent. */
  headingOffsetRadians: number;
  /** Unmargined grip-limited speed used by static feasibility. */
  capabilitySpeed: number;
  targetSpeed: number;
  dynamicMu: number;
  surfaceRoad: number;
  surfaceCurb: number;
  surfaceGrass: number;
  surfaceMu: number;
  surfaceDrag: number;
}

export interface RacecraftFamilyGeometry {
  lateral: number;
  curvature: number;
  q: number;
  /** Authored body tangent relative to the local track tangent. */
  headingOffsetRadians: number;
}

export interface RacecraftFamilyDynamics {
  session: Session;
  at: number;
  baseMu: number;
  dirtyAirGripLoss: number;
  downforceScale: number;
  modifiers: ReturnType<typeof entryMods>;
  untowedDragScale: number;
  towDragReduction: number;
  margin: number;
}

const familyDynamicsCache = new WeakMap<Entry, RacecraftFamilyDynamics>();

interface CachedEntryFamilyStates {
  session: Session;
  at: number;
  byPlan: WeakMap<PathPlan, Map<number, RacecraftFamilyState>>;
}

const familyStateCache = new WeakMap<Entry, CachedEntryFamilyStates>();
const familyGeometryScratch: RacecraftFamilyGeometry = {
  lateral: 0,
  curvature: 0,
  q: 0,
  headingOffsetRadians: 0
};
const familySurfaceScratch = {
  road: 0,
  curb: 0,
  grass: 0,
  mu: 0,
  drag: 0
};

export function racecraftFamilyDynamics(
  session: Session,
  entry: RacecraftFamilyEntry
): RacecraftFamilyDynamics {
  const cached = familyDynamicsCache.get(entry);
  if (Number.isFinite(session.t) &&
      cached?.session === session &&
      cached.at === session.t)
    return cached;
  const downforceScale = entryDownforceScale(entry);
  const baseMu = entryMu(entry, session.wet);
  const modifiers = entryMods(entry, session.wet, baseMu);
  const towDragReduction = racecraftCalibration().towDragReduction;
  const value = {
    session,
    at: session.t,
    baseMu,
    dirtyAirGripLoss: entryDirtyAirGripLoss(entry, session),
    downforceScale,
    modifiers,
    untowedDragScale: modifiers.dr / Math.max(
      Number.EPSILON,
      1 - towDragReduction * clamp(entry.tow || 0, 0, 1)
    ),
    towDragReduction,
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
  if (plan.mode === 'pit')
    throw new Error('Sampled pit paths have no compact family geometry');
  const geometry = compactLateralGeometryAtProgress(
    track,
    entry.racecraftPathPlan === plan && entry.racecraftLateralProgram
      ? entry.racecraftLateralProgram
      : compileCompactLateralProgram(track, plan),
    progress
  );
  return {
    lateral: geometry.lateral,
    curvature: geometry.curvature,
    q: geometry.q,
    headingOffsetRadians: geometry.headingOffsetRadians
  };
}

/** Allocation-free form of the shared compact-family state primitive. */
export function writeRacecraftFamilyStateAt(
  session: Session,
  entry: RacecraftFamilyEntry,
  progress: number,
  plan: Exclude<PathPlan, { mode: 'pit' }>,
  out: RacecraftFamilyState,
  idealAtProgress?: CompactLateralSample
): RacecraftFamilyState {
  const track = session.trk;
  const index = racecraftFamilyIndexAtProgress(track, entry, progress);
  const program = entry.racecraftPathPlan === plan &&
      entry.racecraftLateralProgram
    ? entry.racecraftLateralProgram
    : compileCompactLateralProgram(track, plan);
  return writePreparedRacecraftFamilyStateAt(
    track,
    progress,
    index,
    program,
    racecraftFamilyDynamics(session, entry),
    out,
    idealAtProgress
  );
}

/**
 * Fixed-grid evaluator form. The caller owns the immutable program/dynamics
 * tuple and exact track index, so a candidate rollout does not repeat cache
 * and plan-resolution work at every station.
 */
function writePreparedRacecraftFamilyStateInternal(
  track: Track,
  progress: number,
  index: number,
  program: CompactLateralProgram,
  dynamics: RacecraftFamilyDynamics,
  out: RacecraftFamilyState,
  idealAtProgress: CompactLateralSample | undefined,
  includeHeading: boolean
): RacecraftFamilyState {
  const geometry = includeHeading
    ? writeCompactLateralGeometryAtProgress(
        track,
        program,
        progress,
        familyGeometryScratch,
        idealAtProgress
      )
    : writeCompactLateralKinematicsAtProgress(
        track,
        program,
        progress,
        familyGeometryScratch,
        idealAtProgress
      );
  writeSurfaceExposureAtLateral(
    track,
    index,
    geometry.lateral,
    familySurfaceScratch
  );
  const reference = track.idealPath!.v[index]!;
  const dynamicMu = dynamicMuAtSample(
    dynamics.baseMu,
    dynamics.dirtyAirGripLoss,
    reference,
    geometry.curvature,
    dynamics.downforceScale
  ) * familySurfaceScratch.mu;
  out.lateral = geometry.lateral;
  out.curvature = geometry.curvature;
  out.q = geometry.q;
  if (includeHeading)
    out.headingOffsetRadians = geometry.headingOffsetRadians;
  out.dynamicMu = dynamicMu;
  out.surfaceRoad = familySurfaceScratch.road;
  out.surfaceCurb = familySurfaceScratch.curb;
  out.surfaceGrass = familySurfaceScratch.grass;
  out.surfaceMu = familySurfaceScratch.mu;
  out.surfaceDrag = familySurfaceScratch.drag;
  out.capabilitySpeed = Math.min(
    reference,
    cornerSpeedForGrip(
      geometry.curvature,
      dynamicMu,
      dynamics.downforceScale
    )
  );
  out.targetSpeed = Math.max(0, out.capabilitySpeed * dynamics.margin);
  return out;
}

export function writePreparedRacecraftFamilyStateAt(
  track: Track,
  progress: number,
  index: number,
  program: CompactLateralProgram,
  dynamics: RacecraftFamilyDynamics,
  out: RacecraftFamilyState,
  idealAtProgress?: CompactLateralSample
): RacecraftFamilyState {
  return writePreparedRacecraftFamilyStateInternal(
    track,
    progress,
    index,
    program,
    dynamics,
    out,
    idealAtProgress,
    true
  );
}

/** Candidate-grid form whose consumers use lateral, curvature and grip only. */
export function writePreparedRacecraftFamilyKinematicsAt(
  track: Track,
  progress: number,
  index: number,
  program: CompactLateralProgram,
  dynamics: RacecraftFamilyDynamics,
  out: RacecraftFamilyState,
  idealAtProgress?: CompactLateralSample
): RacecraftFamilyState {
  return writePreparedRacecraftFamilyStateInternal(
    track,
    progress,
    index,
    program,
    dynamics,
    out,
    idealAtProgress,
    false
  );
}

/**
 * Analytic Frenet state shared by evaluator scoring and publications.
 * Acquisition/straight members use the compact plan's exact polynomial
 * derivatives; corner members use the cached G2 spline's exact derivatives.
 */
export function racecraftFamilyStateAt(
  session: Session,
  entry: RacecraftFamilyEntry,
  progress: number,
  plan: PathPlan
): RacecraftFamilyState {
  let cached = familyStateCache.get(entry);
  if (!Number.isFinite(session.t) ||
      cached?.session !== session ||
      cached.at !== session.t) {
    cached = {
      session,
      at: session.t,
      byPlan: new WeakMap()
    };
    if (Number.isFinite(session.t)) familyStateCache.set(entry, cached);
  }
  let byProgress = cached.byPlan.get(plan);
  if (!byProgress) {
    byProgress = new Map();
    cached.byPlan.set(plan, byProgress);
  } else {
    const state = byProgress.get(progress);
    if (state) return state;
  }
  if (plan.mode === 'pit')
    throw new Error('Sampled pit paths have no compact family state');
  const state = writeRacecraftFamilyStateAt(
    session,
    entry,
    progress,
    plan,
    {
      lateral: 0,
      curvature: 0,
      q: 0,
      headingOffsetRadians: 0,
      capabilitySpeed: 0,
      dynamicMu: 0,
      surfaceRoad: 0,
      surfaceCurb: 0,
      surfaceGrass: 0,
      surfaceMu: 0,
      surfaceDrag: 0,
      targetSpeed: 0
    }
  );
  if (Number.isFinite(session.t)) byProgress.set(progress, state);
  return state;
}
