import { sampleCornerLineEtaAnalytic } from '../../core/corner-lines';
import type { Track } from '../../core/model';
import type { PathPlan, PathPlanAnchor } from '../model';
import {
  type CubicInterpolationSample,
  sampleQuinticHermiteSegment,
  sampleSmootherstepSegment
} from './interpolation';

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
  const ideals = anchors.map(anchor =>
    idealOffsetSample(track, anchor.index));
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

/**
 * Sample the compact geometry authority directly. Derivatives are exact for
 * its C2 acquisition/transition and cached analytic G2 corner member.
 */
export function sampleCompactPathPlanOffsetAnalytic(
  track: Track,
  plan: PathPlan,
  sampleIndex: number,
  sampleProgress?: number
): CubicInterpolationSample {
  const context = prepareCompactSampling(track, plan);
  return samplePreparedCompactPathPlanOffsetAnalytic(
    track,
    plan,
    sampleIndex,
    context,
    sampleProgress
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
