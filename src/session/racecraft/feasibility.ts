import {
  availableDeceleration,
  cornerSpeedForGrip,
  PHYS
} from '../../core/physics';
import type { PathMode, Track } from '../../core/model';
import {
  emergencyLateralIsLegal,
  normalLateralIsLegal,
  surfaceExposureAtLateral
} from '../../core/surface';
import { normAng } from '../../shared/math';
import type {
  Entry,
  ManeuverCandidateDiagnostic,
  ManeuverConstraint,
  PathPlan,
  Session
} from '../model';
import {
  entryDownforceScale,
  entryDynamicMuAt,
  entryMu,
  TRAF_DT
} from '../strategy';
import {
  racecraftCalibration,
  racecraftResolution
} from './config';

/**
 * The prediction deliberately stays simpler than the production physics. It
 * is a conservative, fixed-cost Frenet interval check used to reject an
 * obviously unsafe intent; it is not a second vehicle model or controller.
 */
export const MANEUVER_PREDICTION = Object.freeze({
  get horizonSeconds(): number {
    return racecraftCalibration().predictionHorizonSeconds;
  },
  get samples(): number {
    return racecraftResolution().stationSamples;
  }
});

/**
 * Point-trajectory grid with an exact next-observation sample and the
 * remaining resolution spread over the declared horizon.
 */
export function maneuverPredictionStationTime(sample: number): number {
  const count = MANEUVER_PREDICTION.samples;
  if (!Number.isInteger(sample) || sample < 0 || sample > count)
    throw new RangeError(`prediction sample ${sample} outside 0..${count}`);
  if (sample === 0) return 0;
  const horizon = MANEUVER_PREDICTION.horizonSeconds;
  if (count === 1) return horizon;
  return TRAF_DT +
    (horizon - TRAF_DT) * (sample - 1) / (count - 1);
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function indexAt(track: Track, s: number): number {
  return cyclicIndex(track, s / track.step);
}

function addRejection(
  rejections: ManeuverConstraint[],
  rejection: ManeuverConstraint
): void {
  if (!rejections.includes(rejection)) rejections.push(rejection);
}

/** Reset one bounded candidate record so planner updates do not allocate diagnostics. */
export function prepareManeuverCandidateDiagnostic(
  plan: PathPlan,
  scratch?: ManeuverCandidateDiagnostic
): ManeuverCandidateDiagnostic {
  const diagnostic = scratch ?? {
    id: plan.key,
    mode: plan.mode,
    topology: null,
    surfaceAuthorization: null,
    feasible: true,
    rejections: [],
    conflictingReservation: null,
    controllerDemand: 0,
    roadExposure: 0,
    curbExposure: 0,
    grassExposure: 0
  };
  diagnostic.id = plan.key;
  diagnostic.mode = plan.mode;
  diagnostic.topology =
    plan.mode !== 'ideal' && plan.mode !== 'pit'
      ? plan.topology ?? null
      : null;
  diagnostic.surfaceAuthorization =
    plan.mode !== 'ideal' && plan.mode !== 'pit'
      ? plan.surfaceAuthorization ?? null
      : null;
  diagnostic.feasible = true;
  diagnostic.rejections.length = 0;
  diagnostic.conflictingReservation = null;
  diagnostic.controllerDemand = 0;
  diagnostic.roadExposure = 0;
  diagnostic.curbExposure = 0;
  diagnostic.grassExposure = 0;
  return diagnostic;
}

function emergencyPlanAuthorized(plan: PathPlan): boolean {
  return plan.mode !== 'ideal' && plan.mode !== 'pit' &&
    plan.surfaceAuthorization === 'emergency' &&
    plan.emergencyReason === 'collision-avoidance';
}

function lateralAuthorized(track: Track, plan: PathPlan, index: number, lateral: number): boolean {
  if (plan.mode !== 'ideal' && plan.mode !== 'pit' &&
      plan.surfaceAuthorization === 'emergency')
    return emergencyPlanAuthorized(plan) && emergencyLateralIsLegal(track, index, lateral);
  return normalLateralIsLegal(track, index, lateral);
}

function pitReservationCheck(
  session: Session,
  entry: Entry,
  plan: PathPlan,
  diagnostic: ManeuverCandidateDiagnostic
): void {
  if (plan.mode !== 'pit' || entry.pitW == null) return;
  for (const reservation of session.pitReservations?.values() ?? []) {
    if (reservation.owner === entry || reservation.expiresAt < session.t) continue;
    const lower = reservation.minimumW - PHYS.carLen;
    const upper = reservation.maximumW + PHYS.carLen;
    if (entry.pitW >= lower && entry.pitW <= upper) {
      // A reservation conflict is resolved by waiting on the already-valid
      // pit path. planPitMotion is the single progress authority; feasibility
      // records the owner without creating a second zero-speed state machine.
      diagnostic.conflictingReservation = reservation.key;
      return;
    }
  }
}

export interface ManeuverPlanSampler<Context> {
  lateralAt(context: Context, index: number): number;
  curvatureAt:
    ((context: Context, index: number) => number) | null;
  /**
   * Optional owned physical sample. Analytic callers use it to avoid
   * recomputing the same surface/grip state after geometry sampling.
   */
  writePhysicalSample?: (
    context: Context,
    index: number,
    out: ManeuverPhysicalSample
  ) => ManeuverPhysicalSample;
}

export interface ManeuverPhysicalSample {
  lateral: number;
  curvature: number;
  capabilitySpeed: number;
  dynamicMu: number;
  road: number;
  curb: number;
  grass: number;
  mu: number;
}

const maneuverPhysicalScratch: ManeuverPhysicalSample = {
  lateral: 0,
  curvature: 0,
  capabilitySpeed: 0,
  dynamicMu: 0,
  road: 0,
  curb: 0,
  grass: 0,
  mu: 0
};

interface GeometrySample {
  x: number;
  y: number;
  distance: number;
  heading: number;
  rawCurvature: number;
}

interface ManeuverGeometryScratch {
  track: Track;
  sampler: ManeuverPlanSampler<unknown>;
  samplerContext: unknown;
  byIndex: Map<number, GeometrySample>;
  pool: GeometrySample[];
  used: number;
}

function geometryPoint(
  scratch: ManeuverGeometryScratch,
  index: number
): GeometrySample {
  const track = scratch.track;
  const sample = cyclicIndex(track, index);
  const cached = scratch.byIndex.get(sample);
  if (cached) return cached;
  let value = scratch.pool[scratch.used];
  if (!value) {
    value = {
      x: 0,
      y: 0,
      distance: NaN,
      heading: NaN,
      rawCurvature: NaN
    };
    scratch.pool.push(value);
  }
  scratch.used++;
  const lateral = scratch.sampler.lateralAt(
    scratch.samplerContext,
    sample
  );
  value.x = track.x[sample]! + track.nx[sample]! * lateral;
  value.y = track.y[sample]! + track.ny[sample]! * lateral;
  value.distance = NaN;
  value.heading = NaN;
  value.rawCurvature = NaN;
  scratch.byIndex.set(sample, value);
  return value;
}

function geometryDistanceAt(
  scratch: ManeuverGeometryScratch,
  index: number
): number {
  const sample = cyclicIndex(scratch.track, index);
  const from = geometryPoint(scratch, sample);
  if (Number.isFinite(from.distance)) return from.distance;
  const to = geometryPoint(scratch, index + 1);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  from.distance = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
  return from.distance;
}

function geometryHeadingAt(
  scratch: ManeuverGeometryScratch,
  index: number
): number {
  const sample = cyclicIndex(scratch.track, index);
  const current = geometryPoint(scratch, sample);
  if (Number.isFinite(current.heading)) return current.heading;
  const previous = geometryPoint(scratch, index - 1);
  const next = geometryPoint(scratch, index + 1);
  current.heading = Math.atan2(
    next.y - previous.y,
    next.x - previous.x
  );
  return current.heading;
}

function geometryRawCurvatureAt(
  scratch: ManeuverGeometryScratch,
  index: number
): number {
  const sample = cyclicIndex(scratch.track, index);
  const current = geometryPoint(scratch, sample);
  if (Number.isFinite(current.rawCurvature))
    return current.rawCurvature;
  current.rawCurvature = normAng(
    geometryHeadingAt(scratch, index + 1) -
    geometryHeadingAt(scratch, index - 1)
  ) / Math.max(
    0.2,
    geometryDistanceAt(scratch, index - 1) +
      geometryDistanceAt(scratch, index)
  );
  return current.rawCurvature;
}

function geometryCurvatureAt(
  scratch: ManeuverGeometryScratch,
  index: number
): number {
  let sum = 0;
  for (let delta = -3; delta <= 3; delta++)
    sum += geometryRawCurvatureAt(scratch, index + delta);
  return sum / 7;
}

function authoredPlanDistance(
  plan: PathPlan,
  originProgress: number
): number {
  if (plan.mode === 'ideal') return 0;
  let maximum = 0;
  for (const anchor of plan.anchors)
    maximum = Math.max(
      maximum,
      Math.max(0, (anchor.s ?? originProgress) - originProgress)
    );
  return maximum;
}

const PIT_SURFACE_EXPOSURE = {
  road: 1,
  curb: 0,
  grass: 0,
  mu: 1
} as const;

/**
 * Fixed-cost feasibility for candidate search. The caller supplies the pure
 * compact-plan sampler; no full-track SampledPath is allocated here.
 */
export function evaluateManeuverPlanCompactWithSampler<Context>(
  session: Session,
  entry: Entry,
  plan: PathPlan,
  sampler: ManeuverPlanSampler<Context>,
  samplerContext: Context,
  staticPlanAlreadyValidated = false,
  scratch?: ManeuverCandidateDiagnostic
): ManeuverCandidateDiagnostic {
  const track = session.trk;
  const diagnostic = prepareManeuverCandidateDiagnostic(plan, scratch);
  if (!entry.car) {
    addRejection(diagnostic.rejections, 'non-finite');
    diagnostic.feasible = false;
    return diagnostic;
  }
  if (!staticPlanAlreadyValidated) {
    const startS = entry.car.s;
    const speed = Math.max(8, entry.spd || entry.car.spd);
    const scratchEntry = entry as Entry & {
      _maneuverGeometryScratch?: ManeuverGeometryScratch;
    };
    const geometry = scratchEntry._maneuverGeometryScratch ??
      (scratchEntry._maneuverGeometryScratch = {
        track,
        sampler: sampler as ManeuverPlanSampler<unknown>,
        samplerContext,
        byIndex: new Map(),
        pool: [],
        used: 0
      });
    geometry.track = track;
    geometry.sampler = sampler as ManeuverPlanSampler<unknown>;
    geometry.samplerContext = samplerContext;
    geometry.byIndex.clear();
    geometry.used = 0;
    const authoredDistance = authoredPlanDistance(plan, entry.prog);
    const evaluatedDistance = Math.max(
      speed * MANEUVER_PREDICTION.horizonSeconds,
      authoredDistance
    );
    const surfaceSamples = Math.max(
      1,
      Math.ceil(evaluatedDistance / track.step)
    );
    const downforceScale = entryDownforceScale(entry);
    for (let sample = 0; sample <= surfaceSamples; sample++) {
      const distance = evaluatedDistance * sample / surfaceSamples;
      const index = indexAt(track, startS + distance);
      const physical = sampler.writePhysicalSample?.(
        samplerContext,
        index,
        maneuverPhysicalScratch
      );
      const lateral = physical?.lateral ??
        sampler.lateralAt(samplerContext, index);
      if (!Number.isFinite(lateral)) {
        addRejection(diagnostic.rejections, 'non-finite');
        continue;
      }
      if (plan.mode !== 'pit' && !lateralAuthorized(track, plan, index, lateral))
        addRejection(diagnostic.rejections, 'road-bound');
      const exposure = plan.mode === 'pit'
        ? PIT_SURFACE_EXPOSURE
        : physical ?? surfaceExposureAtLateral(track, index, lateral);
      diagnostic.roadExposure += exposure.road;
      diagnostic.curbExposure += exposure.curb;
      diagnostic.grassExposure += exposure.grass;
      const curvature = Math.abs(physical?.curvature ?? (
        sampler.curvatureAt
          ? sampler.curvatureAt(samplerContext, index)
          : geometryCurvatureAt(geometry, index)
      ));
      const referenceSpeed = track.idealPath.v[index] ?? PHYS.vTop;
      const dynamicMu = physical?.dynamicMu ??
        entryDynamicMuAt(
          entry,
          session,
          referenceSpeed,
          curvature
        ) * exposure.mu;
      const pathSpeed = physical?.capabilitySpeed ??
        Math.min(
          referenceSpeed,
          cornerSpeedForGrip(
            curvature,
            dynamicMu,
            downforceScale
          )
        );
      const lateralAcceleration = curvature * pathSpeed * pathSpeed;
      const available = availableDeceleration(
        pathSpeed,
        dynamicMu,
        downforceScale
      );
      diagnostic.controllerDemand = Math.max(
        diagnostic.controllerDemand,
        available > 0 ? lateralAcceleration / available : Infinity
      );
    }
  }
  if (!staticPlanAlreadyValidated) {
    const authoredDistance = authoredPlanDistance(plan, entry.prog);
    const exposureSamples = Math.max(
      1,
      Math.ceil(Math.max(
        Math.max(8, entry.spd || entry.car?.spd || 0) *
          MANEUVER_PREDICTION.horizonSeconds,
        authoredDistance
      ) / track.step)
    ) + 1;
    diagnostic.roadExposure /= exposureSamples;
    diagnostic.curbExposure /= exposureSamples;
    diagnostic.grassExposure /= exposureSamples;
    if (plan.mode !== 'ideal' && plan.mode !== 'pit') {
      if (plan.surfaceAuthorization === 'emergency' && !emergencyPlanAuthorized(plan))
        addRejection(diagnostic.rejections, 'surface-authorization');
      if (plan.surfaceAuthorization !== 'emergency' && diagnostic.grassExposure > 1e-8)
        addRejection(diagnostic.rejections, 'surface-authorization');
    }
    if (!Number.isFinite(diagnostic.controllerDemand))
      addRejection(diagnostic.rejections, 'non-finite');
  }

  pitReservationCheck(session, entry, plan, diagnostic);
  diagnostic.feasible = diagnostic.rejections.length === 0;
  return diagnostic;
}

interface CallbackSamplerContext {
  lateralAt: (index: number) => number;
  curvatureAt: ((index: number) => number) | null;
}

const CALLBACK_MANEUVER_PLAN_SAMPLER:
  ManeuverPlanSampler<CallbackSamplerContext> = {
    lateralAt(context, index) {
      return context.lateralAt(index);
    },
    curvatureAt(context, index) {
      return context.curvatureAt!(index);
    }
  };
const CALLBACK_MANEUVER_PLAN_SAMPLER_WITHOUT_CURVATURE:
  ManeuverPlanSampler<CallbackSamplerContext> = {
    lateralAt(context, index) {
      return context.lateralAt(index);
    },
    curvatureAt: null
  };

/** Convenience surface retained for cold tools and focused unit fixtures. */
export function evaluateManeuverPlanCompact(
  session: Session,
  entry: Entry,
  plan: PathPlan,
  sampleAtIndex: (index: number) => number,
  sampleCurvatureAtIndex: ((index: number) => number) | null,
  staticPlanAlreadyValidated = false,
  scratch?: ManeuverCandidateDiagnostic
): ManeuverCandidateDiagnostic {
  const callbacks = {
    lateralAt: sampleAtIndex,
    curvatureAt: sampleCurvatureAtIndex
  };
  const sampler = sampleCurvatureAtIndex
    ? CALLBACK_MANEUVER_PLAN_SAMPLER
    : CALLBACK_MANEUVER_PLAN_SAMPLER_WITHOUT_CURVATURE;
  return evaluateManeuverPlanCompactWithSampler(
    session,
    entry,
    plan,
    sampler,
    callbacks,
    staticPlanAlreadyValidated,
    scratch
  );
}
