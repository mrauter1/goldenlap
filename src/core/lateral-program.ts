import {
  numericArray,
  type NumericArray,
  type CompactLateralProgram,
  type Track
} from './model';

export interface CompactLateralSample {
  value: number;
  firstDerivative: number;
  secondDerivative: number;
}

export interface CompactLateralGeometry {
  lateral: number;
  curvature: number;
  q: number;
  headingOffsetRadians: number;
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function wrappedTrackS(track: Track, progress: number): number {
  return ((progress % track.len) + track.len) % track.len;
}

function writeIdealOffsetSample(
  track: Track,
  sampleIndex: number,
  out: CompactLateralSample
): CompactLateralSample {
  const base = track.idealPath;
  if (!base) throw new Error(`Track ${track.def.id} has no ideal path`);
  const index = cyclicIndex(track, sampleIndex);
  const previous = (index - 1 + track.n) % track.n;
  const next = (index + 1) % track.n;
  out.value = base.off[index]!;
  out.firstDerivative =
    (base.off[next]! - base.off[previous]!) / (2 * track.step);
  out.secondDerivative =
    (base.off[next]! - 2 * base.off[index]! + base.off[previous]!) /
      (track.step * track.step);
  return out;
}

function writeQuinticHermiteSegment(
  from: CompactLateralSample,
  to: CompactLateralSample,
  span: number,
  u: number,
  out: CompactLateralSample
): CompactLateralSample {
  const safeSpan = Math.max(Number.EPSILON, span);
  const t = Math.max(0, Math.min(1, u));
  const a0 = from.value;
  const a1 = from.firstDerivative * safeSpan;
  const a2 = from.secondDerivative * safeSpan * safeSpan / 2;
  const valueRemainder = to.value - a0 - a1 - a2;
  const slopeRemainder = to.firstDerivative * safeSpan - a1 - 2 * a2;
  const curvatureRemainder =
    to.secondDerivative * safeSpan * safeSpan - 2 * a2;
  const a3 =
    10 * valueRemainder -
    4 * slopeRemainder +
    curvatureRemainder / 2;
  const a4 =
    -15 * valueRemainder +
    7 * slopeRemainder -
    curvatureRemainder;
  const a5 =
    6 * valueRemainder -
    3 * slopeRemainder +
    curvatureRemainder / 2;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  out.value =
    a0 + a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5;
  out.firstDerivative = (
    a1 + 2 * a2 * t + 3 * a3 * t2 + 4 * a4 * t3 + 5 * a5 * t4
  ) / safeSpan;
  out.secondDerivative = (
    2 * a2 + 6 * a3 * t + 12 * a4 * t2 + 20 * a5 * t3
  ) / (safeSpan * safeSpan);
  return out;
}

const idealFromScratch: CompactLateralSample = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};
const idealToScratch: CompactLateralSample = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};
const compactSampleScratch: CompactLateralSample = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};
const idealReferenceScratch: CompactLateralSample = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};

interface IdealLateralCoefficients {
  c0: NumericArray;
  c1: NumericArray;
  c2: NumericArray;
  c3: NumericArray;
  c4: NumericArray;
  c5: NumericArray;
}

const idealLateralCoefficientsByTrack =
  new WeakMap<Track, IdealLateralCoefficients>();

function idealLateralCoefficients(
  track: Track
): IdealLateralCoefficients {
  const cached = idealLateralCoefficientsByTrack.get(track);
  if (cached) return cached;
  const value: IdealLateralCoefficients = {
    c0: numericArray(track.n),
    c1: numericArray(track.n),
    c2: numericArray(track.n),
    c3: numericArray(track.n),
    c4: numericArray(track.n),
    c5: numericArray(track.n)
  };
  const span = Math.max(Number.EPSILON, track.step);
  for (let index = 0; index < track.n; index++) {
    const from = writeIdealOffsetSample(
      track,
      index,
      idealFromScratch
    );
    const to = writeIdealOffsetSample(
      track,
      index + 1,
      idealToScratch
    );
    const c0 = from.value;
    const c1 = from.firstDerivative * span;
    const c2 = from.secondDerivative * span * span / 2;
    const valueRemainder = to.value - c0 - c1 - c2;
    const slopeRemainder =
      to.firstDerivative * span - c1 - 2 * c2;
    const curvatureRemainder =
      to.secondDerivative * span * span - 2 * c2;
    value.c0[index] = c0;
    value.c1[index] = c1;
    value.c2[index] = c2;
    value.c3[index] =
      10 * valueRemainder -
      4 * slopeRemainder +
      curvatureRemainder / 2;
    value.c4[index] =
      -15 * valueRemainder +
      7 * slopeRemainder -
      curvatureRemainder;
    value.c5[index] =
      6 * valueRemainder -
      3 * slopeRemainder +
      curvatureRemainder / 2;
  }
  idealLateralCoefficientsByTrack.set(track, value);
  return value;
}

/** Shared periodic C2 ideal-line geometry in physical progress units. */
export function writeTrackIdealLateralAnalytic(
  track: Track,
  progress: number,
  out: CompactLateralSample
): CompactLateralSample {
  const sample = wrappedTrackS(track, progress) / track.step;
  const fromIndex = Math.floor(sample) % track.n;
  const coefficients = idealLateralCoefficients(track);
  const u = sample - Math.floor(sample);
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const u5 = u4 * u;
  const c1 = coefficients.c1[fromIndex]!;
  const c2 = coefficients.c2[fromIndex]!;
  const c3 = coefficients.c3[fromIndex]!;
  const c4 = coefficients.c4[fromIndex]!;
  const c5 = coefficients.c5[fromIndex]!;
  out.value = coefficients.c0[fromIndex]! +
    c1 * u + c2 * u2 + c3 * u3 + c4 * u4 + c5 * u5;
  out.firstDerivative = (
    c1 + 2 * c2 * u + 3 * c3 * u2 + 4 * c4 * u3 + 5 * c5 * u4
  ) / track.step;
  out.secondDerivative = (
    2 * c2 + 6 * c3 * u + 12 * c4 * u2 + 20 * c5 * u3
  ) / (track.step * track.step);
  return out;
}

export function sampleTrackIdealLateralAnalytic(
  track: Track,
  progress: number
): CompactLateralSample {
  return writeTrackIdealLateralAnalytic(track, progress, {
    value: 0,
    firstDerivative: 0,
    secondDerivative: 0
  });
}

function writeProvidedOrTrackIdeal(
  track: Track,
  progress: number,
  out: CompactLateralSample,
  provided?: CompactLateralSample
): CompactLateralSample {
  if (!provided)
    return writeTrackIdealLateralAnalytic(track, progress, out);
  out.value = provided.value;
  out.firstDerivative = provided.firstDerivative;
  out.secondDerivative = provided.secondDerivative;
  return out;
}

function lateralProgramSegmentIndexAt(
  program: CompactLateralProgram,
  progress: number
): number {
  let low = 0;
  let high = program.segmentCount - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (progress > program.segmentEndProgress[middle]!)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}

/** Evaluate owned lateral segments without consulting a plan or lane buffer. */
export function writeSampleCompactLateralProgram(
  track: Track,
  program: CompactLateralProgram,
  progress: number,
  out: CompactLateralSample,
  idealAtProgress?: CompactLateralSample
): CompactLateralSample {
  if (program.segmentCount === 0)
    return writeProvidedOrTrackIdeal(
      track,
      progress,
      out,
      idealAtProgress
    );
  if (Math.abs(progress - program.startProgress) <= Number.EPSILON) {
    out.value = program.originLateral;
    out.firstDerivative = program.originFirstDerivative;
    out.secondDerivative = program.originSecondDerivative;
    return out;
  }
  if (progress > program.endProgress + Number.EPSILON) {
    writeProvidedOrTrackIdeal(track, progress, out, idealAtProgress);
    if (program.terminal !== 'ideal')
      out.value += program.terminalEta;
    return out;
  }
  const at = Math.max(program.startProgress, progress);
  const index = lateralProgramSegmentIndexAt(program, at);
  const span = program.segmentEndProgress[index]! -
    program.segmentStartProgress[index]!;
  const u = (Math.min(
    program.segmentEndProgress[index]!,
    at
  ) - program.segmentStartProgress[index]!) /
    Math.max(Number.EPSILON, span);
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const u5 = u4 * u;
  out.value =
    program.c0[index]! +
    program.c1[index]! * u +
    program.c2[index]! * u2 +
    program.c3[index]! * u3 +
    program.c4[index]! * u4 +
    program.c5[index]! * u5;
  out.firstDerivative = (
    program.c1[index]! +
    2 * program.c2[index]! * u +
    3 * program.c3[index]! * u2 +
    4 * program.c4[index]! * u3 +
    5 * program.c5[index]! * u4
  ) / Math.max(Number.EPSILON, span);
  out.secondDerivative = (
    2 * program.c2[index]! +
    6 * program.c3[index]! * u +
    12 * program.c4[index]! * u2 +
    20 * program.c5[index]! * u3
  ) / Math.max(Number.EPSILON, span * span);
  if (program.reference[index] === 0) return out;
  if (idealAtProgress && at === progress) {
    idealReferenceScratch.value = idealAtProgress.value;
    idealReferenceScratch.firstDerivative =
      idealAtProgress.firstDerivative;
    idealReferenceScratch.secondDerivative =
      idealAtProgress.secondDerivative;
  } else {
    writeTrackIdealLateralAnalytic(track, at, idealReferenceScratch);
  }
  out.value += idealReferenceScratch.value;
  out.firstDerivative += idealReferenceScratch.firstDerivative;
  out.secondDerivative += idealReferenceScratch.secondDerivative;
  return out;
}

export function sampleCompactLateralProgram(
  track: Track,
  program: CompactLateralProgram,
  progress: number
): CompactLateralSample {
  return writeSampleCompactLateralProgram(track, program, progress, {
    value: 0,
    firstDerivative: 0,
    secondDerivative: 0
  });
}

/**
 * Exact Frenet geometry of one compact lateral authority. This is the shared
 * representation used by evaluator prediction, publication, and control.
 */
function writeCompactLateralGeometryInternal(
  track: Track,
  program: CompactLateralProgram,
  progress: number,
  out: CompactLateralGeometry,
  idealAtProgress: CompactLateralSample | undefined,
  includeHeading: boolean
): CompactLateralGeometry {
  const offset = writeSampleCompactLateralProgram(
    track,
    program,
    progress,
    compactSampleScratch,
    idealAtProgress
  );
  const index = cyclicIndex(track, progress / track.step);
  const previous = (index - 1 + track.n) % track.n;
  const next = (index + 1) % track.n;
  const baseCurvature = track.kSm[index]!;
  const baseCurvatureDerivative =
    (track.kSm[next]! - track.kSm[previous]!) / (2 * track.step);
  const longitudinalScale = 1 - baseCurvature * offset.value;
  const q = Math.max(
    Number.EPSILON,
    Math.sqrt(
      longitudinalScale * longitudinalScale +
      offset.firstDerivative * offset.firstDerivative
    )
  );
  const numerator =
    longitudinalScale * offset.secondDerivative +
    baseCurvature * longitudinalScale * longitudinalScale +
    baseCurvatureDerivative * offset.value * offset.firstDerivative +
    2 * baseCurvature *
      offset.firstDerivative * offset.firstDerivative;
  out.lateral = offset.value;
  out.curvature = numerator / (q * q * q);
  out.q = q;
  if (includeHeading)
    out.headingOffsetRadians = Math.atan2(
      offset.firstDerivative,
      longitudinalScale
    );
  return out;
}

export function writeCompactLateralGeometryAtProgress(
  track: Track,
  program: CompactLateralProgram,
  progress: number,
  out: CompactLateralGeometry,
  idealAtProgress?: CompactLateralSample
): CompactLateralGeometry {
  return writeCompactLateralGeometryInternal(
    track,
    program,
    progress,
    out,
    idealAtProgress,
    true
  );
}

/** Fixed-grid speed/feasibility form; the caller does not consume heading. */
export function writeCompactLateralKinematicsAtProgress(
  track: Track,
  program: CompactLateralProgram,
  progress: number,
  out: CompactLateralGeometry,
  idealAtProgress?: CompactLateralSample
): CompactLateralGeometry {
  return writeCompactLateralGeometryInternal(
    track,
    program,
    progress,
    out,
    idealAtProgress,
    false
  );
}

export function compactLateralGeometryAtProgress(
  track: Track,
  program: CompactLateralProgram,
  progress: number
): CompactLateralGeometry {
  return writeCompactLateralGeometryAtProgress(
    track,
    program,
    progress,
    {
      lateral: 0,
      curvature: 0,
      q: 0,
      headingOffsetRadians: 0
    }
  );
}

export function writeCompactLateralPoseAtProgress(
  track: Track,
  program: CompactLateralProgram,
  progress: number,
  out: {
    lateralMetres: number;
    headingOffsetRadians: number;
  }
): {
  lateralMetres: number;
  headingOffsetRadians: number;
} {
  const offset = writeSampleCompactLateralProgram(
    track,
    program,
    progress,
    compactSampleScratch
  );
  const index = cyclicIndex(track, progress / track.step);
  const longitudinalScale =
    1 - track.kSm[index]! * offset.value;
  out.lateralMetres = offset.value;
  out.headingOffsetRadians = Math.atan2(
    offset.firstDerivative,
    longitudinalScale
  );
  return out;
}

export function compactLateralPoseAtProgress(
  track: Track,
  program: CompactLateralProgram,
  progress: number
): {
  lateralMetres: number;
  headingOffsetRadians: number;
} {
  return writeCompactLateralPoseAtProgress(
    track,
    program,
    progress,
    {
      lateralMetres: 0,
      headingOffsetRadians: 0
    }
  );
}
