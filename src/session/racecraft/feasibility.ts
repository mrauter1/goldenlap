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
    feasible: true,
    rejections: [],
    controllerDemand: 0,
    roadExposure: 0,
    curbExposure: 0,
    grassExposure: 0
  };
  diagnostic.id = plan.key;
  diagnostic.mode = plan.mode;
  if (plan.mode !== 'ideal' && plan.mode !== 'pit' && plan.topology)
    diagnostic.topology = plan.topology;
  else delete diagnostic.topology;
  if (plan.mode !== 'ideal' && plan.mode !== 'pit' && plan.surfaceAuthorization)
    diagnostic.surfaceAuthorization = plan.surfaceAuthorization;
  else delete diagnostic.surfaceAuthorization;
  diagnostic.feasible = true;
  diagnostic.rejections.length = 0;
  delete diagnostic.conflictingReservation;
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

/**
 * Fixed-cost feasibility for candidate search. The caller supplies the pure
 * compact-plan sampler; no full-track SampledPath is allocated here.
 */
export function evaluateManeuverPlanCompact(
  session: Session,
  entry: Entry,
  plan: PathPlan,
  sampleAtIndex: (index: number) => number,
  sampleCurvatureAtIndex: ((index: number) => number) | null,
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
    interface GeometrySample {
      x: number;
      y: number;
      distance?: number;
      heading?: number;
      rawCurvature?: number;
    }
    const scratchEntry = entry as Entry & {
      _maneuverGeometryScratch?: Map<number, GeometrySample>;
    };
    const geometry = scratchEntry._maneuverGeometryScratch ??
      (scratchEntry._maneuverGeometryScratch = new Map<number, GeometrySample>());
    geometry.clear();
    const point = (index: number): GeometrySample => {
      const sample = cyclicIndex(track, index);
      const cached = geometry.get(sample);
      if (cached) return cached;
      const lateral = sampleAtIndex(sample);
      const value = {
        x: track.x[sample]! + track.nx[sample]! * lateral,
        y: track.y[sample]! + track.ny[sample]! * lateral
      };
      geometry.set(sample, value);
      return value;
    };
    const distanceAt = (index: number): number => {
      const sample = cyclicIndex(track, index);
      const from = point(sample);
      if (from.distance !== undefined) return from.distance;
      const to = point(index + 1);
      from.distance = Math.max(0.1, Math.hypot(to.x - from.x, to.y - from.y));
      return from.distance;
    };
    const headingAt = (index: number): number => {
      const sample = cyclicIndex(track, index);
      const current = point(sample);
      if (current.heading !== undefined) return current.heading;
      const previous = point(index - 1);
      const next = point(index + 1);
      current.heading = Math.atan2(next.y - previous.y, next.x - previous.x);
      return current.heading;
    };
    const rawCurvatureAt = (index: number): number => {
      const sample = cyclicIndex(track, index);
      const current = point(sample);
      if (current.rawCurvature !== undefined) return current.rawCurvature;
      current.rawCurvature = normAng(headingAt(index + 1) - headingAt(index - 1)) /
        Math.max(0.2, distanceAt(index - 1) + distanceAt(index));
      return current.rawCurvature;
    };
    const curvatureAt = (index: number): number => {
      let sum = 0;
      for (let delta = -3; delta <= 3; delta++) sum += rawCurvatureAt(index + delta);
      return sum / 7;
    };
    const authoredDistance = plan.mode === 'ideal'
      ? 0
      : plan.anchors.reduce(
          (maximum, anchor) =>
            Math.max(maximum, Math.max(0, (anchor.s ?? entry.prog) - entry.prog)),
          0
        );
    const evaluatedDistance = Math.max(
      speed * MANEUVER_PREDICTION.horizonSeconds,
      authoredDistance
    );
    const surfaceSamples = Math.max(
      1,
      Math.ceil(evaluatedDistance / track.step)
    );
    for (let sample = 0; sample <= surfaceSamples; sample++) {
      const distance = evaluatedDistance * sample / surfaceSamples;
      const index = indexAt(track, startS + distance);
      const lateral = sampleAtIndex(index);
      if (!Number.isFinite(lateral)) {
        addRejection(diagnostic.rejections, 'non-finite');
        continue;
      }
      if (plan.mode !== 'pit' && !lateralAuthorized(track, plan, index, lateral))
        addRejection(diagnostic.rejections, 'road-bound');
      const exposure = plan.mode === 'pit'
        ? { road: 1, curb: 0, grass: 0, mu: 1 }
        : surfaceExposureAtLateral(track, index, lateral);
      diagnostic.roadExposure += exposure.road;
      diagnostic.curbExposure += exposure.curb;
      diagnostic.grassExposure += exposure.grass;
      const curvature = Math.abs(
        sampleCurvatureAtIndex ? sampleCurvatureAtIndex(index) : curvatureAt(index)
      );
      const referenceSpeed = track.idealPath.v[index] ?? PHYS.vTop;
      const dynamicMu = entryDynamicMuAt(
        entry,
        session,
        referenceSpeed,
        curvature
      ) * exposure.mu;
      const pathSpeed = Math.min(
        referenceSpeed,
        cornerSpeedForGrip(
          curvature,
          dynamicMu,
          entryDownforceScale(entry)
        )
      );
      const lateralAcceleration = curvature * pathSpeed * pathSpeed;
      const available = availableDeceleration(
        pathSpeed,
        dynamicMu,
        entryDownforceScale(entry)
      );
      diagnostic.controllerDemand = Math.max(
        diagnostic.controllerDemand,
        available > 0 ? lateralAcceleration / available : Infinity
      );
    }
  }
  if (!staticPlanAlreadyValidated) {
    const authoredDistance = plan.mode === 'ideal'
      ? 0
      : plan.anchors.reduce(
          (maximum, anchor) =>
            Math.max(maximum, Math.max(0, (anchor.s ?? entry.prog) - entry.prog)),
          0
        );
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
