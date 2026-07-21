import { sampleCornerLineEtaAnalytic } from '../../core/corner-lines';
import {
  sampleCompactLateralProgram,
  sampleTrackIdealLateralAnalytic
} from '../../core/lateral-program';
import {
  numericArray,
  type Corner,
  type CornerAlternateLineProfile,
  type Track
} from '../../core/model';
import type {
  PathPlan,
  PathPlanAnchor,
  RacecraftLateralProgram
} from '../model';
import {
  type CubicInterpolationSample,
  sampleQuinticHermiteSegment,
  sampleSmootherstepSegment
} from './interpolation';

export {
  compactLateralPoseAtProgress,
  sampleCompactLateralProgram,
  sampleTrackIdealLateralAnalytic
} from '../../core/lateral-program';

interface CompactSamplingInterval {
  fromOffset: number;
  toOffset: number;
  fromDistance: number;
  toDistance: number;
  span: number;
  fromEta?: CubicInterpolationSample;
  toEta?: CubicInterpolationSample;
}

interface CompactSamplingContext {
  intervals: CompactSamplingInterval[];
  first: PathPlanAnchor | null;
  originTrackS: number;
  anchorDistances: number[];
  tacticalEtaKnots: CubicInterpolationSample[] | null;
}

const compactSamplingContexts = new WeakMap<
  PathPlan,
  { track: Track; context: CompactSamplingContext }
>();
const compactLateralPrograms = new WeakMap<
  PathPlan,
  { track: Track; program: RacecraftLateralProgram }
>();

type AnchoredPathPlan = Exclude<PathPlan, { mode: 'ideal' }>;

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function distanceAhead(track: Track, from: number, to: number): number {
  return ((to - from + track.n) % track.n) * track.step;
}

function wrappedTrackS(track: Track, progress: number): number {
  return ((progress % track.len) + track.len) % track.len;
}

function forwardTrackMetres(
  track: Track,
  from: number,
  to: number
): number {
  return ((to - from) % track.len + track.len) % track.len;
}

function authoredAnchorDistance(
  track: Track,
  first: PathPlanAnchor,
  firstIndex: number,
  originTrackS: number,
  anchor: PathPlanAnchor
): number {
  if (first.s != null && anchor.s != null) return anchor.s - first.s;
  const targetTrackS = anchor.s != null
    ? wrappedTrackS(track, anchor.s)
    : cyclicIndex(track, anchor.index) * track.step;
  if (anchor === first) return 0;
  if (first.s == null && anchor.s == null)
    return distanceAhead(track, firstIndex, cyclicIndex(track, anchor.index));
  return forwardTrackMetres(track, originTrackS, targetTrackS);
}

function prepareCompactSampling(
  track: Track,
  plan: PathPlan
): CompactSamplingContext {
  const cached = compactSamplingContexts.get(plan);
  if (cached?.track === track) return cached.context;
  const base = track.idealPath;
  if (!base) throw new Error(`Track ${track.def.id} has no ideal path`);
  if (plan.mode === 'ideal') {
    const context: CompactSamplingContext = {
      intervals: [],
      first: null,
      originTrackS: 0,
      anchorDistances: [],
      tacticalEtaKnots: null
    };
    compactSamplingContexts.set(plan, { track, context });
    return context;
  }
  if (plan.anchors.length < 2)
    throw new Error(`${plan.mode} path ${plan.key} needs at least two anchors`);
  const first = plan.anchors[0]!;
  const firstIndex = cyclicIndex(track, first.index);
  const originTrackS = first.s != null
    ? wrappedTrackS(track, first.s)
    : firstIndex * track.step;
  const intervals: CompactSamplingInterval[] = [];
  const anchorDistances = plan.anchors.map(anchor =>
    authoredAnchorDistance(
      track,
      first,
      firstIndex,
      originTrackS,
      anchor
    ));
  const tacticalEtaKnots =
    plan.mode !== 'pit' && !plan.cornerId && plan.anchors.length > 2
      ? compileTacticalEtaKnots(track, plan.anchors, anchorDistances)
      : null;
  for (let anchorIndex = 0;
    anchorIndex < plan.anchors.length - 1;
    anchorIndex++) {
    const from = plan.anchors[anchorIndex]!;
    const to = plan.anchors[anchorIndex + 1]!;
    const fromDistance = anchorDistances[anchorIndex]!;
    const toDistance = anchorDistances[anchorIndex + 1]!;
    const span = toDistance - fromDistance;
    if (span <= 0 || span > track.len / 2)
      throw new Error(
        `${plan.mode} path ${plan.key} has a non-forward anchor interval ` +
        `${cyclicIndex(track, from.index)}@${from.s ?? 'wrapped'} -> ` +
        `${cyclicIndex(track, to.index)}@${to.s ?? 'wrapped'}`
      );
    intervals.push({
      fromOffset: from.offset,
      toOffset: to.offset,
      fromDistance,
      toDistance,
      span,
      ...(tacticalEtaKnots
        ? {
            fromEta: tacticalEtaKnots[anchorIndex]!,
            toEta: tacticalEtaKnots[anchorIndex + 1]!
          }
        : {})
    });
  }
  if (plan.mode === 'pit') {
    // Pit is still a full sampled path. Preserve its pre-lane-program
    // materialization exactly by closing the unused cycle behind the car.
    const from = plan.anchors[plan.anchors.length - 1]!;
    const to = plan.anchors[0]!;
    const fromDistance = anchorDistances[anchorDistances.length - 1]!;
    const toDistance = track.len;
    const span = toDistance - fromDistance;
    if (span > 0) {
      intervals.push({
        fromOffset: from.offset,
        toOffset: to.offset,
        fromDistance,
        toDistance,
        span
      });
    }
  }
  const context: CompactSamplingContext = {
    intervals,
    first,
    originTrackS,
    anchorDistances,
    tacticalEtaKnots
  };
  // Plans and anchors are immutable after construction, so retained plans
  // compile once while occupancy checks continue at their own cadence.
  compactSamplingContexts.set(plan, { track, context });
  return context;
}

function anchorEta(
  track: Track,
  anchor: PathPlanAnchor
): number {
  if (anchor.eta != null) return anchor.eta;
  return anchor.offset - idealOffsetSample(track, anchor.index).value;
}

function secant(
  values: readonly number[],
  distances: readonly number[],
  from: number,
  to: number
): number {
  return (values[to]! - values[from]!) /
    Math.max(Number.EPSILON, distances[to]! - distances[from]!);
}

/**
 * Compile one shared value/slope/curvature state per tactical eta knot.
 * Quintic Hermite segments then meet at that same state, so anchor density
 * cannot manufacture the zero-slope scallops of independent smoothersteps.
 */
function compileTacticalEtaKnots(
  track: Track,
  anchors: readonly PathPlanAnchor[],
  distances: readonly number[]
): CubicInterpolationSample[] {
  const originProgress = anchors[0]!.s ??
    cyclicIndex(track, anchors[0]!.index) * track.step;
  const ideals = anchors.map((_, index) =>
    sampleTrackIdealLateralAnalytic(
      track,
      originProgress + distances[index]!
    ));
  const values = anchors.map(anchor => anchorEta(track, anchor));
  const offsets = anchors.map(anchor => anchor.offset);
  const last = anchors.length - 1;
  const isAbsoluteTurningKnot = (index: number): boolean => {
    if (index <= 0 || index >= last) return false;
    const incoming = secant(offsets, distances, index - 1, index);
    const outgoing = secant(offsets, distances, index, index + 1);
    return incoming * outgoing <= 0;
  };
  const slopes = anchors.map((anchor, index) => {
    if (Number.isFinite(anchor.etaFirstDerivative))
      return anchor.etaFirstDerivative!;
    if (index === 0) return secant(values, distances, 0, 1);
    if (index === last) {
      // A zero-eta terminal continues onto the ideal line after the compact
      // authority ends, so its eta slope must match that continuation.
      if (Math.abs(values[index]!) <= Number.EPSILON) return 0;
      return secant(values, distances, index - 1, index);
    }
    // Tactical extrema are authored in absolute road space (for example an
    // acquisition that joins a constant surface edge). Match that tangent,
    // then express it in eta so the interpolated quantity remains Frenet
    // relative to ideal without arching past the authored extremum.
    if (isAbsoluteTurningKnot(index))
      return -ideals[index]!.firstDerivative;
    return secant(values, distances, index - 1, index + 1);
  });
  const curvatures = anchors.map((anchor, index) => {
    if (Number.isFinite(anchor.etaSecondDerivative))
      return anchor.etaSecondDerivative!;
    if (index === last && Math.abs(values[index]!) <= Number.EPSILON)
      return 0;
    if (isAbsoluteTurningKnot(index))
      return -ideals[index]!.secondDerivative;
    if (index === 0)
      return (slopes[1]! - slopes[0]!) /
        Math.max(Number.EPSILON, distances[1]! - distances[0]!);
    if (index === last)
      return (slopes[index]! - slopes[index - 1]!) /
        Math.max(
          Number.EPSILON,
          distances[index]! - distances[index - 1]!
        );
    return (slopes[index + 1]! - slopes[index - 1]!) /
      Math.max(
        Number.EPSILON,
        distances[index + 1]! - distances[index - 1]!
      );
  });
  return values.map((value, index) => ({
    value,
    firstDerivative: slopes[index]!,
    secondDerivative: curvatures[index]!
  }));
}

function idealOffsetSample(
  track: Track,
  sampleIndex: number
): CubicInterpolationSample {
  const base = track.idealPath;
  if (!base) throw new Error(`Track ${track.def.id} has no ideal path`);
  const index = cyclicIndex(track, sampleIndex);
  const previous = (index - 1 + track.n) % track.n;
  const next = (index + 1) % track.n;
  return {
    value: base.off[index]!,
    firstDerivative:
      (base.off[next]! - base.off[previous]!) / (2 * track.step),
    secondDerivative:
      (base.off[next]! - 2 * base.off[index]! + base.off[previous]!) /
        (track.step * track.step)
  };
}

function compactSampleDistance(
  track: Track,
  context: CompactSamplingContext,
  sampleIndex: number,
  sampleProgress?: number
): number {
  if (sampleProgress != null && context.first?.s != null)
    return sampleProgress - context.first.s;
  const sampleTrackS = sampleProgress != null
    ? wrappedTrackS(track, sampleProgress)
    : cyclicIndex(track, sampleIndex) * track.step;
  return forwardTrackMetres(track, context.originTrackS, sampleTrackS);
}

function authoredDistanceForIndex(
  track: Track,
  plan: AnchoredPathPlan,
  context: CompactSamplingContext,
  targetIndex: number
): number {
  const wrapped = cyclicIndex(track, targetIndex);
  for (let anchorIndex = plan.anchors.length - 1;
    anchorIndex >= 0;
    anchorIndex--)
    if (cyclicIndex(track, plan.anchors[anchorIndex]!.index) === wrapped)
      return context.anchorDistances[anchorIndex]!;
  return forwardTrackMetres(
    track,
    context.originTrackS,
    wrapped * track.step
  );
}

function firstAuthoredOffsetSample(
  track: Track,
  context: CompactSamplingContext
): CubicInterpolationSample {
  const first = context.first!;
  const ideal = idealOffsetSample(track, first.index);
  return {
    value: first.offset,
    firstDerivative: Number.isFinite(first.etaFirstDerivative)
      ? ideal.firstDerivative + first.etaFirstDerivative!
      : 0,
    secondDerivative: Number.isFinite(first.etaSecondDerivative)
      ? ideal.secondDerivative + first.etaSecondDerivative!
      : 0
  };
}

function samplePreparedCompactPathPlanOffsetAnalytic(
  track: Track,
  plan: PathPlan,
  sampleIndex: number,
  context: CompactSamplingContext,
  sampleProgress?: number
): CubicInterpolationSample {
  const index = cyclicIndex(track, sampleIndex);
  const ideal = idealOffsetSample(track, index);
  if (plan.mode === 'ideal') return ideal;
  const distanceFromFirst = compactSampleDistance(
    track,
    context,
    sampleIndex,
    sampleProgress
  );
  // The first anchor is measured state. Safety projection begins at the next
  // sample and cannot teleport a body finishing a curb/runoff recovery.
  if (plan.mode !== 'pit' && plan.pinnedFirst &&
      Math.abs(distanceFromFirst) <= Number.EPSILON) {
    const firstEta = context.tacticalEtaKnots?.[0];
    if (firstEta)
      return {
        value: context.first!.offset,
        firstDerivative: ideal.firstDerivative + firstEta.firstDerivative,
        secondDerivative:
          ideal.secondDerivative + firstEta.secondDerivative
      };
    if (plan.cornerId && plan.lineKind)
      return firstAuthoredOffsetSample(track, context);
    // A genuine two-point transition deliberately begins from rest in the
    // lateral polynomial; its historical smootherstep semantics are exact.
    return {
      value: context.first!.offset,
      firstDerivative: 0,
      secondDerivative: 0
    };
  }
  if (plan.mode !== 'pit' && plan.cornerId && plan.lineKind) {
    const corner = track.corners?.find(value => value.id === plan.cornerId);
    const family = corner?.alternateLines?.[plan.lineKind];
    const line = family?.[
      plan.lineTerminal === 'sustained-offset'
        ? 'sustainedOffset'
        : 'idealRejoin'
    ];
    const acquisition = plan.anchors[1];
    if (corner && line && acquisition) {
      const acquisitionSpan = context.anchorDistances[1]!;
      const exitSpan = authoredDistanceForIndex(
        track,
        plan,
        context,
        corner.exitI
      );
      if (distanceFromFirst <= exitSpan ||
          line.terminal === 'sustained-offset') {
        if (acquisitionSpan > 0 && distanceFromFirst <= acquisitionSpan) {
          const endpointEta = sampleCornerLineEtaAnalytic(
            track,
            corner,
            line,
            acquisition.index
          );
          const endpointIdeal = idealOffsetSample(
            track,
            acquisition.index
          );
          const blend = plan.lineBlend ?? 1;
          return sampleQuinticHermiteSegment(
            firstAuthoredOffsetSample(track, context),
            {
              value: endpointIdeal.value + blend * endpointEta.eta,
              firstDerivative:
                endpointIdeal.firstDerivative +
                blend * endpointEta.firstDerivative,
              secondDerivative:
                endpointIdeal.secondDerivative +
                blend * endpointEta.secondDerivative
            },
            acquisitionSpan,
            distanceFromFirst / acquisitionSpan
          );
        }
        const analytic = sampleCornerLineEtaAnalytic(
          track,
          corner,
          line,
          index
        );
        const blend = plan.lineBlend ?? 1;
        return {
          value: ideal.value + blend * analytic.eta,
          firstDerivative:
            ideal.firstDerivative + blend * analytic.firstDerivative,
          secondDerivative:
            ideal.secondDerivative + blend * analytic.secondDerivative
        };
      }
      return ideal;
    }
  }

  for (const interval of context.intervals) {
    if (distanceFromFirst < interval.fromDistance ||
        distanceFromFirst > interval.toDistance)
      continue;
    const delta = distanceFromFirst - interval.fromDistance;
    if (interval.fromEta && interval.toEta) {
      const eta = sampleQuinticHermiteSegment(
        interval.fromEta,
        interval.toEta,
        interval.span,
        delta / interval.span
      );
      return {
        value: ideal.value + eta.value,
        firstDerivative: ideal.firstDerivative + eta.firstDerivative,
        secondDerivative: ideal.secondDerivative + eta.secondDerivative
      };
    }
    return sampleSmootherstepSegment(
      interval.fromOffset,
      interval.toOffset,
      interval.span,
      delta / interval.span
    );
  }
  return ideal;
}

interface LateralSegmentRecord {
  reference: 0 | 1;
  startProgress: number;
  endProgress: number;
  c0: number;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
}

function appendQuinticSegment(
  output: LateralSegmentRecord[],
  reference: 0 | 1,
  startProgress: number,
  endProgress: number,
  from: CubicInterpolationSample,
  to: CubicInterpolationSample
): void {
  const span = endProgress - startProgress;
  if (!(span > Number.EPSILON)) return;
  const a0 = from.value;
  const a1 = from.firstDerivative * span;
  const a2 = from.secondDerivative * span * span / 2;
  const valueRemainder = to.value - a0 - a1 - a2;
  const slopeRemainder = to.firstDerivative * span - a1 - 2 * a2;
  const curvatureRemainder =
    to.secondDerivative * span * span - 2 * a2;
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
  output.push({
    reference,
    startProgress,
    endProgress,
    c0: a0,
    c1: a1,
    c2: a2,
    c3: a3,
    c4: a4,
    c5: a5
  });
}

function zeroDerivativeSample(value: number): CubicInterpolationSample {
  return {
    value,
    firstDerivative: 0,
    secondDerivative: 0
  };
}

function lateralProgramFromRecords(
  records: readonly LateralSegmentRecord[],
  terminal: RacecraftLateralProgram['terminal'],
  terminalEta: number,
  origin: CubicInterpolationSample = zeroDerivativeSample(0)
): RacecraftLateralProgram {
  const count = records.length;
  const reference = new Uint8Array(count);
  const segmentStartProgress = numericArray(count);
  const segmentEndProgress = numericArray(count);
  const c0 = numericArray(count);
  const c1 = numericArray(count);
  const c2 = numericArray(count);
  const c3 = numericArray(count);
  const c4 = numericArray(count);
  const c5 = numericArray(count);
  for (let index = 0; index < count; index++) {
    const segment = records[index]!;
    reference[index] = segment.reference;
    segmentStartProgress[index] = segment.startProgress;
    segmentEndProgress[index] = segment.endProgress;
    c0[index] = segment.c0;
    c1[index] = segment.c1;
    c2[index] = segment.c2;
    c3[index] = segment.c3;
    c4[index] = segment.c4;
    c5[index] = segment.c5;
  }
  return {
    startProgress: records[0]?.startProgress ?? 0,
    endProgress: records.at(-1)?.endProgress ?? 0,
    segmentCount: count,
    originLateral: origin.value,
    originFirstDerivative: origin.firstDerivative,
    originSecondDerivative: origin.secondDerivative,
    reference,
    segmentStartProgress,
    segmentEndProgress,
    c0,
    c1,
    c2,
    c3,
    c4,
    c5,
    terminal,
    terminalEta
  };
}

function absoluteFirstSample(
  track: Track,
  first: PathPlanAnchor,
  firstProgress: number
): CubicInterpolationSample {
  const ideal = sampleTrackIdealLateralAnalytic(track, firstProgress);
  return {
    value: first.offset,
    firstDerivative: Number.isFinite(first.etaFirstDerivative)
      ? ideal.firstDerivative + first.etaFirstDerivative!
      : 0,
    secondDerivative: Number.isFinite(first.etaSecondDerivative)
      ? ideal.secondDerivative + first.etaSecondDerivative!
      : 0
  };
}

function scaledCornerEtaSample(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile,
  progress: number,
  blend: number
): CubicInterpolationSample {
  const sample = sampleCornerLineEtaAnalytic(
    track,
    corner,
    line,
    wrappedTrackS(track, progress) / track.step
  );
  return {
    value: blend * sample.eta,
    firstDerivative: blend * sample.firstDerivative,
    secondDerivative: blend * sample.secondDerivative
  };
}

/**
 * Compile one selected family into owned polynomial segments. The shared
 * ideal line remains a separate analytic base, so tactical authority stays
 * compact even across a long corner.
 */
export function compileCompactLateralProgram(
  track: Track,
  plan: Exclude<PathPlan, { mode: 'pit' }>
): RacecraftLateralProgram {
  const cached = compactLateralPrograms.get(plan);
  if (cached?.track === track) return cached.program;
  if (plan.mode === 'ideal') {
    const program = lateralProgramFromRecords([], 'ideal', 0);
    compactLateralPrograms.set(plan, { track, program });
    return program;
  }

  const context = prepareCompactSampling(track, plan);
  const first = context.first!;
  const firstProgress = first.s ??
    cyclicIndex(track, first.index) * track.step;
  const records: LateralSegmentRecord[] = [];
  let terminal: RacecraftLateralProgram['terminal'] = 'ideal';
  let terminalEta = 0;
  const origin = absoluteFirstSample(track, first, firstProgress);

  if (plan.cornerId && plan.lineKind) {
    const corner = track.corners?.find(value => value.id === plan.cornerId);
    const family = corner?.alternateLines?.[plan.lineKind];
    const line = family?.[
      plan.lineTerminal === 'sustained-offset'
        ? 'sustainedOffset'
        : 'idealRejoin'
    ];
    const acquisition = plan.anchors[1];
    if (corner && line && acquisition) {
      const blend = plan.lineBlend ?? 1;
      const acquisitionDistance = context.anchorDistances[1]!;
      const acquisitionProgress = firstProgress + acquisitionDistance;
      const acquisitionEta = scaledCornerEtaSample(
        track,
        corner,
        line,
        acquisitionProgress,
        blend
      );
      const acquisitionIdeal =
        sampleTrackIdealLateralAnalytic(track, acquisitionProgress);
      appendQuinticSegment(
        records,
        0,
        firstProgress,
        acquisitionProgress,
        origin,
        {
          value: acquisitionIdeal.value + acquisitionEta.value,
          firstDerivative:
            acquisitionIdeal.firstDerivative +
            acquisitionEta.firstDerivative,
          secondDerivative:
            acquisitionIdeal.secondDerivative +
            acquisitionEta.secondDerivative
        }
      );

      const exitDistance = authoredDistanceForIndex(
        track,
        plan,
        context,
        corner.exitI
      );
      const boundaryDistances = [acquisitionDistance];
      for (const point of line.points) {
        const distance = authoredDistanceForIndex(
          track,
          plan,
          context,
          point.index
        );
        if (distance > acquisitionDistance + Number.EPSILON &&
            distance <= exitDistance + Number.EPSILON)
          boundaryDistances.push(distance);
      }
      if (boundaryDistances.at(-1)! <
          exitDistance - Number.EPSILON)
        boundaryDistances.push(exitDistance);
      boundaryDistances.sort((left, right) => left - right);
      let uniqueCount = 1;
      for (let index = 1; index < boundaryDistances.length; index++) {
        if (Math.abs(
          boundaryDistances[index]! -
          boundaryDistances[uniqueCount - 1]!
        ) <= Number.EPSILON) continue;
        boundaryDistances[uniqueCount++] = boundaryDistances[index]!;
      }
      boundaryDistances.length = uniqueCount;
      for (let index = 0; index < boundaryDistances.length - 1; index++) {
        const fromProgress = firstProgress + boundaryDistances[index]!;
        const toProgress = firstProgress + boundaryDistances[index + 1]!;
        appendQuinticSegment(
          records,
          1,
          fromProgress,
          toProgress,
          scaledCornerEtaSample(
            track,
            corner,
            line,
            fromProgress,
            blend
          ),
          scaledCornerEtaSample(
            track,
            corner,
            line,
            toProgress,
            blend
          )
        );
      }
      if (line.terminal === 'sustained-offset') {
        terminal = 'ideal-relative';
        terminalEta = blend * line.points.at(-1)!.eta;
      }
    }
  }

  if (records.length === 0) {
    for (const interval of context.intervals) {
      const start = firstProgress + interval.fromDistance;
      const end = firstProgress + interval.toDistance;
      if (interval.fromEta && interval.toEta)
        appendQuinticSegment(
          records,
          1,
          start,
          end,
          interval.fromEta,
          interval.toEta
        );
      else
        appendQuinticSegment(
          records,
          0,
          start,
          end,
          zeroDerivativeSample(interval.fromOffset),
          zeroDerivativeSample(interval.toOffset)
        );
    }
  }

  const program = lateralProgramFromRecords(
    records,
    terminal,
    terminalEta,
    origin
  );
  compactLateralPrograms.set(plan, { track, program });
  return program;
}

export function cloneCompactLateralProgram(
  program: RacecraftLateralProgram
): RacecraftLateralProgram {
  const clone = <T extends Float64Array | Uint8Array>(value: T): T =>
    value.slice() as T;
  return {
    startProgress: program.startProgress,
    endProgress: program.endProgress,
    segmentCount: program.segmentCount,
    originLateral: program.originLateral,
    originFirstDerivative: program.originFirstDerivative,
    originSecondDerivative: program.originSecondDerivative,
    reference: clone(program.reference),
    segmentStartProgress: clone(program.segmentStartProgress),
    segmentEndProgress: clone(program.segmentEndProgress),
    c0: clone(program.c0),
    c1: clone(program.c1),
    c2: clone(program.c2),
    c3: clone(program.c3),
    c4: clone(program.c4),
    c5: clone(program.c5),
    terminal: program.terminal,
    terminalEta: program.terminalEta
  };
}

/**
 * Sample the compact geometry authority directly. Tactical plans compile once
 * into owned polynomial segments; pit retains its sampled full-path source.
 */
export function sampleCompactPathPlanOffsetAnalytic(
  track: Track,
  plan: PathPlan,
  sampleIndex: number,
  sampleProgress?: number
): CubicInterpolationSample {
  if (plan.mode === 'pit') {
    const context = prepareCompactSampling(track, plan);
    return samplePreparedCompactPathPlanOffsetAnalytic(
      track,
      plan,
      sampleIndex,
      context,
      sampleProgress
    );
  }
  const progress = sampleProgress ??
    cyclicIndex(track, sampleIndex) * track.step;
  return sampleCompactLateralProgram(
    track,
    compileCompactLateralProgram(track, plan),
    progress
  );
}

export function sampleCompactPathPlanOffset(
  track: Track,
  plan: PathPlan,
  sampleIndex: number,
  sampleProgress?: number
): number {
  return sampleCompactPathPlanOffsetAnalytic(
    track,
    plan,
    sampleIndex,
    sampleProgress
  ).value;
}

export function sampleCompactPathPlan(
  track: Track,
  plan: PathPlan,
  indices: readonly number[]
): number[] {
  const context = prepareCompactSampling(track, plan);
  return indices.map(index =>
    samplePreparedCompactPathPlanOffsetAnalytic(
      track,
      plan,
      index,
      context
    ).value);
}
