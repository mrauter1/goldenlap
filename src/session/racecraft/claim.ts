import {
  numericArray,
  type Track
} from '../../core/model';
import {
  writeCompactLateralPoseAtProgress,
  writeSampleCompactLateralProgram
} from
  '../../core/lateral-program';
import { cloneCompactLateralProgram } from './compact-path';
import { normAng } from '../../shared/math';
import type {
  RacecraftClaim,
  RacecraftLateralProgram,
  RacecraftTrajectoryProgram
} from '../model';

export interface RacecraftTrajectoryPointInput {
  readonly timeSeconds: number;
  readonly sMetres: number;
  readonly lateralMetres: number;
  readonly speedMetresPerSecond: number;
  readonly headingOffsetRadians: number;
}

export interface RacecraftTrajectorySegmentInput {
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number;
  readonly startProgressMetres: number;
  readonly endProgressMetres: number;
  readonly startSpeedMetresPerSecond: number;
  readonly endSpeedMetresPerSecond: number;
  readonly startLateralMetres: number;
  readonly endLateralMetres: number;
  readonly startHeadingOffsetRadians: number;
  readonly endHeadingOffsetRadians: number;
}

export function createRacecraftTrajectoryProgram(
  capacity: number,
  originProgress: number,
  originTrackS: number,
  lateralProgram: RacecraftLateralProgram | null
): RacecraftTrajectoryProgram {
  return {
    originProgress,
    originTrackS,
    segmentCount: capacity,
    segmentStartTime: numericArray(capacity),
    segmentEndTime: numericArray(capacity),
    progressAtStart: numericArray(capacity),
    progressC1: numericArray(capacity),
    progressC2: numericArray(capacity),
    progressC3: numericArray(capacity),
    fallbackLateralAtStart: numericArray(capacity),
    fallbackLateralRate: numericArray(capacity),
    fallbackHeadingAtStart: numericArray(capacity),
    fallbackHeadingRate: numericArray(capacity),
    lateralProgram
  };
}

/** Write one owned Hermite motion segment into construction buffers. */
export function writeRacecraftTrajectorySegment(
  program: RacecraftTrajectoryProgram,
  index: number,
  input: RacecraftTrajectorySegmentInput
): void {
  if (index < 0 || index >= program.segmentCount)
    throw new RangeError('Trajectory segment index is outside its capacity');
  const seconds = input.endTimeSeconds - input.startTimeSeconds;
  if (!(seconds > 0) || !Number.isFinite(seconds))
    throw new RangeError('Trajectory segment requires positive finite time');
  const distance =
    input.endProgressMetres - input.startProgressMetres;
  const startSpeed = Math.max(0, input.startSpeedMetresPerSecond);
  const endSpeed = Math.max(0, input.endSpeedMetresPerSecond);
  program.segmentStartTime[index] = input.startTimeSeconds;
  program.segmentEndTime[index] = input.endTimeSeconds;
  program.progressAtStart[index] = input.startProgressMetres;
  program.progressC1[index] = startSpeed;
  program.progressC2[index] =
    3 * distance / (seconds * seconds) -
    (2 * startSpeed + endSpeed) / seconds;
  program.progressC3[index] =
    -2 * distance / (seconds * seconds * seconds) +
    (startSpeed + endSpeed) / (seconds * seconds);
  program.fallbackLateralAtStart[index] =
    input.startLateralMetres;
  program.fallbackLateralRate[index] =
    (input.endLateralMetres - input.startLateralMetres) / seconds;
  program.fallbackHeadingAtStart[index] =
    input.startHeadingOffsetRadians;
  program.fallbackHeadingRate[index] = normAng(
    input.endHeadingOffsetRadians -
    input.startHeadingOffsetRadians
  ) / seconds;
}

function cyclicProgress(track: Track, progress: number): number {
  return ((progress % track.len) + track.len) % track.len;
}

function signedTrackDistance(track: Track, from: number, to: number): number {
  let distance = (
    (to - from) % track.len + track.len
  ) % track.len;
  if (distance > track.len / 2) distance -= track.len;
  return distance;
}

/**
 * Test/fixture constructor for direct trajectory segments. Production authors
 * segments from the installed lateral and longitudinal programs directly.
 */
export function racecraftTrajectoryProgramFromRows(
  track: Track,
  origin: RacecraftTrajectoryPointInput,
  rows: readonly RacecraftTrajectoryPointInput[],
  originProgress = 0
): RacecraftTrajectoryProgram {
  const program = createRacecraftTrajectoryProgram(
    rows.length,
    originProgress,
    origin.sMetres,
    null
  );
  let previous = origin;
  let progress = originProgress;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const nextProgress = progress +
      signedTrackDistance(track, previous.sMetres, row.sMetres);
    writeRacecraftTrajectorySegment(program, index, {
      startTimeSeconds: previous.timeSeconds,
      endTimeSeconds: row.timeSeconds,
      startProgressMetres: progress,
      endProgressMetres: nextProgress,
      startSpeedMetresPerSecond: previous.speedMetresPerSecond,
      endSpeedMetresPerSecond: row.speedMetresPerSecond,
      startLateralMetres: previous.lateralMetres,
      endLateralMetres: row.lateralMetres,
      startHeadingOffsetRadians: previous.headingOffsetRadians,
      endHeadingOffsetRadians: row.headingOffsetRadians
    });
    previous = row;
    progress = nextProgress;
  }
  return program;
}

export interface RacecraftEvaluationClaim {
  /** Immutable publication advanced mathematically to the evaluation epoch. */
  claim: RacecraftClaim;
}

export interface RacecraftClaimState {
  progressMetres: number;
  s: number;
  lateral: number;
  speed: number;
  headingOffsetRadians: number;
}

export interface RacecraftClaimTowState {
  s: number;
  lateral: number;
}

const trajectoryLateralPoseScratch = {
  lateralMetres: 0,
  headingOffsetRadians: 0
};
const trajectoryTowLateralScratch = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};

function trajectorySegmentIndexAt(
  program: RacecraftTrajectoryProgram,
  seconds: number
): number {
  let low = 0;
  let high = program.segmentCount - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (seconds > program.segmentEndTime[middle]!)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}

/** Allocation-free longitudinal-only trajectory query for progress roots. */
export function racecraftTrajectoryProgressAtTime(
  program: RacecraftTrajectoryProgram,
  seconds: number
): number {
  if (program.segmentCount === 0)
    return program.originProgress + Math.max(0, seconds) * 0;
  const target = Math.max(0, seconds);
  const horizon =
    program.segmentEndTime[program.segmentCount - 1]!;
  const index = target <= horizon
    ? trajectorySegmentIndexAt(program, target)
    : program.segmentCount - 1;
  const startTime = program.segmentStartTime[index]!;
  const endTime = program.segmentEndTime[index]!;
  const local = Math.max(
    0,
    Math.min(endTime, target) - startTime
  );
  const c1 = program.progressC1[index]!;
  const c2 = program.progressC2[index]!;
  const c3 = program.progressC3[index]!;
  let progress =
    program.progressAtStart[index]! +
    c1 * local +
    c2 * local * local +
    c3 * local * local * local;
  if (target > horizon) {
    const speed = Math.max(
      0,
      c1 + 2 * c2 * local + 3 * c3 * local * local
    );
    progress += speed * (target - horizon);
  }
  return progress;
}

export function writeRacecraftTrajectoryStateAtTime(
  track: Track,
  program: RacecraftTrajectoryProgram,
  seconds: number,
  out: RacecraftClaimState
): RacecraftClaimState {
  if (program.segmentCount === 0) {
    out.progressMetres =
      program.originProgress + Math.max(0, seconds) * 0;
    out.s = program.originTrackS;
    out.lateral = 0;
    out.speed = 0;
    out.headingOffsetRadians = 0;
    return out;
  }
  const target = Math.max(0, seconds);
  const horizon =
    program.segmentEndTime[program.segmentCount - 1]!;
  const index = target <= horizon
    ? trajectorySegmentIndexAt(program, target)
    : program.segmentCount - 1;
  const startTime = program.segmentStartTime[index]!;
  const endTime = program.segmentEndTime[index]!;
  const local = Math.max(
    0,
    Math.min(endTime, target) - startTime
  );
  const c1 = program.progressC1[index]!;
  const c2 = program.progressC2[index]!;
  const c3 = program.progressC3[index]!;
  let progress =
    program.progressAtStart[index]! +
    c1 * local +
    c2 * local * local +
    c3 * local * local * local;
  let speed = Math.max(
    0,
    c1 + 2 * c2 * local + 3 * c3 * local * local
  );
  let fallbackLocal = local;
  if (target > horizon) {
    const elapsed = target - horizon;
    progress += speed * elapsed;
    fallbackLocal += elapsed;
  }
  out.progressMetres = progress;
  out.s = cyclicProgress(
    track,
    program.originTrackS + progress - program.originProgress
  );
  if (program.lateralProgram) {
    const lateral = writeCompactLateralPoseAtProgress(
      track,
      program.lateralProgram,
      progress,
      trajectoryLateralPoseScratch
    );
    out.lateral = lateral.lateralMetres;
    out.headingOffsetRadians = lateral.headingOffsetRadians;
  } else {
    out.lateral =
      program.fallbackLateralAtStart[index]! +
      program.fallbackLateralRate[index]! * fallbackLocal;
    out.headingOffsetRadians = normAng(
      program.fallbackHeadingAtStart[index]! +
      program.fallbackHeadingRate[index]! * fallbackLocal
    );
  }
  out.speed = speed;
  return out;
}

export function racecraftTrajectoryStateAtTime(
  track: Track,
  program: RacecraftTrajectoryProgram,
  seconds: number
): RacecraftClaimState {
  return writeRacecraftTrajectoryStateAtTime(
    track,
    program,
    seconds,
    {
      progressMetres: 0,
      s: 0,
      lateral: 0,
      speed: 0,
      headingOffsetRadians: 0
    }
  );
}

export function racecraftTrajectoryHorizonSeconds(
  program: RacecraftTrajectoryProgram
): number {
  return program.segmentCount > 0
    ? program.segmentEndTime[program.segmentCount - 1]!
    : 0;
}

/**
 * Installed and published trajectory values own their buffers. Defensive
 * lineage clones the selected program once so later construction scratch can
 * never expand the authorized envelope.
 */
export function cloneRacecraftTrajectoryProgram(
  program: RacecraftTrajectoryProgram
): RacecraftTrajectoryProgram {
  const clone = createRacecraftTrajectoryProgram(
    program.segmentCount,
    program.originProgress,
    program.originTrackS,
    program.lateralProgram
      ? cloneCompactLateralProgram(program.lateralProgram)
      : null
  );
  clone.segmentStartTime.set(program.segmentStartTime);
  clone.segmentEndTime.set(program.segmentEndTime);
  clone.progressAtStart.set(program.progressAtStart);
  clone.progressC1.set(program.progressC1);
  clone.progressC2.set(program.progressC2);
  clone.progressC3.set(program.progressC3);
  clone.fallbackLateralAtStart.set(
    program.fallbackLateralAtStart
  );
  clone.fallbackLateralRate.set(program.fallbackLateralRate);
  clone.fallbackHeadingAtStart.set(
    program.fallbackHeadingAtStart
  );
  clone.fallbackHeadingRate.set(program.fallbackHeadingRate);
  return clone;
}

export function racecraftClaimHorizonSeconds(
  claim: RacecraftClaim
): number {
  return racecraftTrajectoryHorizonSeconds(claim.trajectory);
}

export function racecraftClaimSegmentCount(
  claim: RacecraftClaim
): number {
  return claim.trajectory.segmentCount;
}

export function racecraftClaimSegmentEndTime(
  claim: RacecraftClaim,
  index: number
): number {
  return claim.trajectory.segmentEndTime[index]!;
}

/** Write continuous state on the immutable publication into caller scratch. */
export function writeRacecraftClaimStateAtTime(
  track: Track,
  claim: RacecraftClaim,
  time: number,
  out: RacecraftClaimState
): RacecraftClaimState {
  return writeRacecraftTrajectoryStateAtTime(
    track,
    claim.trajectory,
    claim.trajectoryTimeOffsetSeconds + Math.max(0, time),
    out
  );
}

/** Write only the immutable publication coordinates consumed by wake lookup. */
export function writeRacecraftClaimTowStateAtTime(
  track: Track,
  claim: RacecraftClaim,
  time: number,
  out: RacecraftClaimTowState
): RacecraftClaimTowState {
  const program = claim.trajectory;
  if (program.segmentCount === 0) {
    out.s = program.originTrackS;
    out.lateral = 0;
    return out;
  }
  const target = Math.max(
    0,
    claim.trajectoryTimeOffsetSeconds + Math.max(0, time)
  );
  const horizon =
    program.segmentEndTime[program.segmentCount - 1]!;
  const index = target <= horizon
    ? trajectorySegmentIndexAt(program, target)
    : program.segmentCount - 1;
  const startTime = program.segmentStartTime[index]!;
  const endTime = program.segmentEndTime[index]!;
  const local = Math.max(
    0,
    Math.min(endTime, target) - startTime
  );
  const c1 = program.progressC1[index]!;
  const c2 = program.progressC2[index]!;
  const c3 = program.progressC3[index]!;
  let progress =
    program.progressAtStart[index]! +
    c1 * local +
    c2 * local * local +
    c3 * local * local * local;
  let fallbackLocal = local;
  if (target > horizon) {
    const speed = Math.max(
      0,
      c1 + 2 * c2 * local + 3 * c3 * local * local
    );
    const elapsed = target - horizon;
    progress += speed * elapsed;
    fallbackLocal += elapsed;
  }
  out.s = cyclicProgress(
    track,
    program.originTrackS + progress - program.originProgress
  );
  out.lateral = program.lateralProgram
    ? writeSampleCompactLateralProgram(
        track,
        program.lateralProgram,
        progress,
        trajectoryTowLateralScratch
      ).value
    : program.fallbackLateralAtStart[index]! +
      program.fallbackLateralRate[index]! * fallbackLocal;
  return out;
}

/** Allocating convenience API for cold callers and diagnostics. */
export function racecraftClaimStateAtTime(
  track: Track,
  claim: RacecraftClaim,
  time: number
): RacecraftClaimState {
  return writeRacecraftClaimStateAtTime(track, claim, time, {
    progressMetres: 0,
    s: 0,
    lateral: 0,
    speed: 0,
    headingOffsetRadians: 0
  });
}

interface EvaluationEpochCache {
  publishedAt: number;
  publicationRevision: number;
  predictionKey: string;
  byTrack: WeakMap<Track, Map<number, RacecraftEvaluationClaim>>;
}

const evaluationEpochCache =
  new WeakMap<RacecraftClaim, EvaluationEpochCache>();

/**
 * Advance an immutable publication to one common evaluation epoch. The owned
 * segment buffers are retained without copying or mutation; the consumer view
 * carries only a mathematical time offset and current origin.
 */
export function racecraftClaimAtEvaluationEpoch(
  track: Track,
  claim: RacecraftClaim,
  evaluationAt: number
): RacecraftEvaluationClaim {
  let cached = evaluationEpochCache.get(claim);
  if (!cached ||
      cached.publishedAt !== claim.publishedAt ||
      cached.publicationRevision !== claim.publicationRevision ||
      cached.predictionKey !== claim.predictionKey) {
    cached = {
      publishedAt: claim.publishedAt,
      publicationRevision: claim.publicationRevision,
      predictionKey: claim.predictionKey,
      byTrack: new WeakMap()
    };
    evaluationEpochCache.set(claim, cached);
  }
  let byTime = cached.byTrack.get(track);
  if (!byTime) {
    byTime = new Map();
    cached.byTrack.set(track, byTime);
  }
  const cachedView = byTime.get(evaluationAt);
  if (cachedView) return cachedView;
  const age = Math.max(0, evaluationAt - claim.publishedAt);
  if (age <= Number.EPSILON) {
    const view = { claim };
    byTime.set(evaluationAt, view);
    return view;
  }
  const origin = racecraftClaimStateAtTime(track, claim, age);
  const view: RacecraftEvaluationClaim = {
    claim: {
      ...claim,
      publishedAt: evaluationAt,
      originS: origin.s,
      originCentre: origin.lateral,
      originSpeed: origin.speed,
      originHeadingOffsetRadians: origin.headingOffsetRadians,
      trajectoryTimeOffsetSeconds:
        claim.trajectoryTimeOffsetSeconds + age
    }
  };
  byTime.set(evaluationAt, view);
  return view;
}
