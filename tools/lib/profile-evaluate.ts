import {
  derivePathGeometry,
  materializeTrackProfile,
  speedProfile
} from '../../src/core/racing-line';
import {
  normalLateralIsLegal,
  pathSurfaceExposure,
  roadLateralEnvelopeAt
} from '../../src/core/surface';
import type {
  BuiltTrack, SampledPath, TrackProfile, TrackProfileAnchor
} from '../../src/core/model';
import { PIT_TEAMS } from '../../src/data/tracks';
import { trackProfileFingerprints } from '../../src/game/tracks';
import { stableFingerprint } from '../../src/shared/stable-json';
import { empiricalQuantile } from './statistics';
import { runSingleCar, type SingleCarSummary } from './headless-sim';

export interface AnalyticalEvaluation {
  id: string;
  profile: TrackProfile;
  valid: boolean;
  rejection: string | null;
  path: SampledPath | null;
  predictedLapTime: number;
  smoothness: number;
  trackingDemand: number;
  maximumHeadingStep: number;
  curbMetres: number;
  grassMetres: number;
  maximumCurbFraction: number;
  maximumGrassFraction: number;
}

export interface FinalistEvaluation {
  analytical: AnalyticalEvaluation;
  valid: boolean;
  rejection: string | null;
  measuredLapTime: number;
  robustLapTime: number;
  maximumTrackingError: number;
  offCourseSeconds: number;
  robustnessScore: number;
  measuredLaps: number[];
}

export const PROFILE_MARKER_ERROR_NORMAL_METRES = 0.75;
export const PROFILE_MARKER_ERROR_ABSOLUTE_METRES = 2.2;
export const PROFILE_LAP_TIME_RATIO_ACCEPTABLE = 1.01;
export const PROFILE_LAP_TIME_RATIO_ABSOLUTE = 1.03;

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

export function heuristicProfileAnchors(built: BuiltTrack): TrackProfileAnchor[] {
  const track = built.tr;
  const indices = new Set<number>();
  const atDistance = (distance: number): number =>
    ((Math.round(distance / track.step) % track.n) + track.n) % track.n;
  const pitStart = ((track.pit.sEntry - 80) % track.len + track.len) % track.len;
  for (const distance of [pitStart, track.pit.sExit + 30, track.len - 25, 25])
    indices.add(atDistance(distance));
  for (const corner of track.corners) {
    if (corner.planRole === 'complex-secondary') continue;
    indices.add(corner.turnInI);
    indices.add(corner.apexI);
    indices.add(corner.trackOutI);
  }
  return [...indices].sort((left, right) => left - right).map(index => ({
    sFraction: round(index / track.n),
    lateral: round(track.idealPath.off[index]!)
  }));
}

export function makeHeuristicProfile(built: BuiltTrack, seed: number): TrackProfile {
  return {
    schemaVersion: 1,
    trackId: built.def.id,
    ...trackProfileFingerprints(built.def, PIT_TEAMS),
    optimizerVersion: 'semantic-surface-baseline-2',
    status: 'acceptable',
    anchors: heuristicProfileAnchors(built),
    metrics: {
      estimatedLapTime: round(built.tr.idealTiming.lapTime),
      verifiedLapTime: Infinity,
      maximumTrackingError: Infinity,
      offCourseSeconds: Infinity,
      robustnessScore: 0
    },
    provenance: {
      seed,
      budgetSeconds: 0,
      evaluations: 0,
      search: 'deterministic-semantic-safe-incumbent'
    }
  };
}

function pathDemand(built: BuiltTrack, path: SampledPath): {
  smoothness: number;
  trackingDemand: number;
  maximumHeadingStep: number;
} {
  const geometry = derivePathGeometry(built.tr, path);
  let sumSquared = 0;
  let maximumSecond = 0;
  let maximumHeadingStep = 0;
  for (let index = 0; index < built.tr.n; index++) {
    const previous = (index - 1 + built.tr.n) % built.tr.n;
    const next = (index + 1) % built.tr.n;
    const second = Math.abs(
      path.off[next]! - 2 * path.off[index]! + path.off[previous]!
    ) / (built.tr.step * built.tr.step);
    maximumSecond = Math.max(maximumSecond, second);
    sumSquared += second * second;
    const heading = Math.atan2(geometry.ty[index]!, geometry.tx[index]!);
    const nextHeading = Math.atan2(geometry.ty[next]!, geometry.tx[next]!);
    let delta = nextHeading - heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    maximumHeadingStep = Math.max(maximumHeadingStep, Math.abs(delta));
  }
  return {
    smoothness: Math.sqrt(sumSquared / built.tr.n),
    trackingDemand: maximumSecond,
    maximumHeadingStep
  };
}

export function evaluateProfileAnalytically(
  built: BuiltTrack,
  profile: TrackProfile
): AnalyticalEvaluation {
  const id = stableFingerprint(profile.anchors);
  try {
    const path = materializeTrackProfile(built.tr, profile);
    const timing = speedProfile(built.tr, path);
    const demand = pathDemand(built, path);
    const surface = pathSurfaceExposure(built.tr, path);
    if (!Number.isFinite(timing.lapTime)) throw new Error('non-finite analytical lap time');
    if (demand.maximumHeadingStep > 0.18) throw new Error('heading-step invariant');
    const normalizedCornerOffset = (
      index: number,
      side: -1 | 1,
      lateral: number
    ): number => {
      const envelope = roadLateralEnvelopeAt(built.tr, index);
      const signed = side * lateral;
      const extent = signed >= 0
        ? (side > 0 ? envelope.maximum : -envelope.minimum)
        : (side > 0 ? -envelope.minimum : envelope.maximum);
      if (!(extent > 0)) throw new Error('empty semantic lateral envelope');
      return signed / extent;
    };
    for (const corner of built.tr.corners) {
      if (corner.planRole === 'complex-secondary') continue;
      const entry = normalizedCornerOffset(
        corner.turnInI, corner.side, path.off[corner.turnInI]!
      );
      const apex = normalizedCornerOffset(
        corner.apexI, corner.side, path.off[corner.apexI]!
      );
      const exit = normalizedCornerOffset(
        corner.trackOutI, corner.side, path.off[corner.trackOutI]!
      );
      if (entry > -0.18 + 1e-9 || apex < 0.3 - 1e-9 || exit > -0.15 + 1e-9)
        throw new Error(`semantic outside-apex-outside boundary at ${corner.id}`);
    }
    for (let index = 0; index < built.tr.n; index++) {
      if (!Number.isFinite(path.off[index]!) || !Number.isFinite(path.k[index]!) ||
          !Number.isFinite(path.ds[index]!) || !Number.isFinite(path.v[index]!))
        throw new Error('non-finite materialized path');
      if (!normalLateralIsLegal(built.tr, index, path.off[index]!))
        throw new Error('materialized path leaves normal road/curb envelope');
    }
    if (surface.maximumGrassFraction > 1e-8 || surface.grassMetres > 1e-7)
      throw new Error('clean-air profile exposes the car footprint to grass');
    return {
      id,
      profile,
      valid: true,
      rejection: null,
      path,
      predictedLapTime: timing.lapTime,
      smoothness: demand.smoothness,
      trackingDemand: demand.trackingDemand,
      maximumHeadingStep: demand.maximumHeadingStep,
      curbMetres: surface.curbMetres,
      grassMetres: surface.grassMetres,
      maximumCurbFraction: surface.maximumCurbFraction,
      maximumGrassFraction: surface.maximumGrassFraction
    };
  } catch (error) {
    return {
      id,
      profile,
      valid: false,
      rejection: error instanceof Error ? error.message : String(error),
      path: null,
      predictedLapTime: Infinity,
      smoothness: Infinity,
      trackingDemand: Infinity,
      maximumHeadingStep: Infinity,
      curbMetres: Infinity,
      grassMetres: Infinity,
      maximumCurbFraction: Infinity,
      maximumGrassFraction: Infinity
    };
  }
}

function validRun(summary: SingleCarSummary, expectedLaps: number): boolean {
  return summary.reason === 'complete' && summary.validLaps === expectedLaps &&
    summary.invalidLaps === 0 && summary.offCourseSeconds === 0 && summary.finite;
}

export function validateProfileFinalist(
  built: BuiltTrack,
  analytical: AnalyticalEvaluation,
  options: { seed: number; deadlineAt?: number; now?: () => number }
): FinalistEvaluation {
  if (!analytical.valid || !analytical.path) {
    return {
      analytical,
      valid: false,
      rejection: analytical.rejection ?? 'analytical rejection',
      measuredLapTime: Infinity,
      robustLapTime: Infinity,
      maximumTrackingError: Infinity,
      offCourseSeconds: Infinity,
      robustnessScore: 0,
      measuredLaps: []
    };
  }
  const now = options.now ?? performance.now.bind(performance);
  const remaining = (): number | undefined => options.deadlineAt === undefined
    ? undefined
    : Math.max(0, options.deadlineAt - now());
  const run = (
    seed: number,
    settings: Parameters<typeof runSingleCar>[1]
  ): SingleCarSummary => {
    const deadlineMs = remaining();
    return runSingleCar(built, {
      ...settings,
      seed,
      path: analytical.path!,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  };
  const measured = run(options.seed, { laps: 3 });
  const measuredLaps = measured.lapTimes.slice(1);
  if (!validRun(measured, 3) || measuredLaps.length !== 2) {
    return {
      analytical,
      valid: false,
      rejection: measured.reason === 'deadline' ? 'validation deadline' : 'measured-lap invariant',
      measuredLapTime: Infinity,
      robustLapTime: Infinity,
      maximumTrackingError: measured.maximumPathError,
      offCourseSeconds: measured.offCourseSeconds,
      robustnessScore: 0,
      measuredLaps
    };
  }
  const robustness = [
    run(options.seed + 1, {
      laps: 1, margin: 0.93, muScale: 0.82, initialLateralOffset: 0.7, initialSpeed: 9
    }),
    run(options.seed + 2, {
      laps: 1, margin: 0.94, muScale: 0.9, initialLateralOffset: -0.7, initialSpeed: 15
    }),
    run(options.seed + 3, {
      laps: 1, margin: 0.96, muScale: 1.04, initialLateralOffset: 0.4, initialSpeed: 18
    })
  ];
  const robustnessPasses = robustness.filter(summary => validRun(summary, 1)).length;
  const all = [measured, ...robustness];
  const measuredLapTime = empiricalQuantile(measuredLaps, 0.5);
  const robustTimes = robustness.flatMap(summary => summary.lapTimes);
  const robustLapTime = Math.max(measuredLapTime, ...robustTimes);
  const maximumTrackingError = Math.max(...all.map(summary => summary.maximumMarkerError));
  const offCourseSeconds = all.reduce((sum, summary) => sum + summary.offCourseSeconds, 0);
  const valid = robustnessPasses === robustness.length &&
    maximumTrackingError <= PROFILE_MARKER_ERROR_ABSOLUTE_METRES;
  return {
    analytical,
    valid,
    rejection: valid ? null : 'robustness/controller boundary',
    measuredLapTime,
    robustLapTime,
    maximumTrackingError,
    offCourseSeconds,
    robustnessScore: robustnessPasses / robustness.length,
    measuredLaps
  };
}

export function profileFromFinalist(
  finalist: FinalistEvaluation,
  options: { seed: number; budgetSeconds: number; evaluations: number }
): TrackProfile {
  const status = finalist.valid && finalist.offCourseSeconds === 0 &&
    finalist.maximumTrackingError <= PROFILE_MARKER_ERROR_NORMAL_METRES &&
    finalist.robustnessScore === 1
    ? 'normal'
    : 'acceptable';
  return {
    ...finalist.analytical.profile,
    optimizerVersion: 'bounded-surface-pattern-search-2',
    status,
    metrics: {
      estimatedLapTime: round(finalist.analytical.predictedLapTime),
      verifiedLapTime: round(finalist.measuredLapTime),
      maximumTrackingError: round(finalist.maximumTrackingError),
      offCourseSeconds: round(finalist.offCourseSeconds),
      robustnessScore: round(finalist.robustnessScore)
    },
    provenance: {
      seed: options.seed,
      budgetSeconds: options.budgetSeconds,
      evaluations: options.evaluations,
      search: 'deterministic-coordinate-pattern+seeded-restarts+successive-halving'
    }
  };
}
