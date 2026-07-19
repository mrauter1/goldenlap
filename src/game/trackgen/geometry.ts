import { clamp, normAng } from '../../shared/math';
import { mulberry32 } from '../../shared/rng';
import { presetFor } from './presets';
import type {
  RealizedTrackGeometry,
  ResolvedRhythmToken,
  RhythmPlan,
  TrackCornerClass,
  TrackgenPoint,
  TrackgenWidthKey
} from './types';

export interface SampledTrackgenGeometry {
  points: readonly TrackgenPoint[];
  headings: readonly number[];
  curvature: readonly number[];
  segmentLengths: readonly number[];
  cumulative: readonly number[];
  length: number;
  step: number;
}

const CORNER_AMPLITUDE: Readonly<Record<TrackCornerClass, number>> = {
  hairpin: 210,
  slow: 145,
  medium: 94,
  fast: 52,
  kink: 32
};

function smootherstep(value: number): number {
  const u = clamp(value, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function smoothstep(value: number): number {
  const u = clamp(value, 0, 1);
  return u * u * (3 - 2 * u);
}

function appendUnique(points: TrackgenPoint[], point: TrackgenPoint): void {
  const previous = points[points.length - 1];
  if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-8)
    points.push(point);
}

function smoothClosedControls(source: readonly TrackgenPoint[]): TrackgenPoint[] {
  const smoothed: TrackgenPoint[] = [];
  for (let index = 0; index < source.length; index++) {
    const current = source[index]!;
    const next = source[(index + 1) % source.length]!;
    smoothed.push(
      { x: current.x * 0.75 + next.x * 0.25, y: current.y * 0.75 + next.y * 0.25 },
      { x: current.x * 0.25 + next.x * 0.75, y: current.y * 0.25 + next.y * 0.75 }
    );
  }
  let start = 0;
  let closest = Infinity;
  for (let index = 0; index < smoothed.length; index++) {
    const point = smoothed[index]!;
    const distance = point.x * point.x + point.y * point.y;
    if (distance < closest) {
      closest = distance;
      start = index;
    }
  }
  const ordered = [...smoothed.slice(start), ...smoothed.slice(0, start)];
  const origin = ordered[0]!;
  return ordered.map(point => ({ x: point.x - origin.x, y: point.y - origin.y }));
}

function resampleClosedControls(
  source: readonly TrackgenPoint[],
  targetSpacing: number
): TrackgenPoint[] {
  const cumulative = new Array<number>(source.length + 1).fill(0);
  for (let index = 0; index < source.length; index++) {
    const current = source[index]!;
    const next = source[(index + 1) % source.length]!;
    cumulative[index + 1] = cumulative[index]! + Math.hypot(
      next.x - current.x,
      next.y - current.y
    );
  }
  const length = cumulative[source.length]!;
  const count = Math.max(16, Math.round(length / targetSpacing));
  const points: TrackgenPoint[] = [];
  let segment = 0;
  for (let index = 0; index < count; index++) {
    const distance = index / count * length;
    while (segment < source.length - 1 && cumulative[segment + 1]! < distance) segment++;
    const current = source[segment]!;
    const next = source[(segment + 1) % source.length]!;
    const span = Math.max(1e-9, cumulative[segment + 1]! - cumulative[segment]!);
    const fraction = (distance - cumulative[segment]!) / span;
    points.push({
      x: current.x + (next.x - current.x) * fraction,
      y: current.y + (next.y - current.y) * fraction
    });
  }
  const origin = points[0]!;
  return points.map(point => ({ x: point.x - origin.x, y: point.y - origin.y }));
}

function clampCurvatureRateByConstruction(
  source: readonly TrackgenPoint[]
): TrackgenPoint[] {
  let points = [...source];
  for (let iteration = 0; iteration < 2; iteration++) {
    points = points.map((point, index) => {
      const previous = points[(index - 1 + points.length) % points.length]!;
      const next = points[(index + 1) % points.length]!;
      return {
        x: previous.x * 0.2 + point.x * 0.6 + next.x * 0.2,
        y: previous.y * 0.2 + point.y * 0.6 + next.y * 0.2
      };
    });
  }
  const origin = points[0]!;
  return points.map(point => ({ x: point.x - origin.x, y: point.y - origin.y }));
}

function catmullPoint(
  p0: TrackgenPoint,
  p1: TrackgenPoint,
  p2: TrackgenPoint,
  p3: TrackgenPoint,
  t: number
): TrackgenPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}

/** Lightweight periodic spline sampler used by Tier 0, not the production build. */
export function sampleTrackgenSpline(
  controlPoints: readonly TrackgenPoint[],
  samplesPerControl = 3
): SampledTrackgenGeometry {
  if (controlPoints.length < 4) throw new Error('A generated track needs at least four points');
  if (!Number.isInteger(samplesPerControl) || samplesPerControl < 1)
    throw new Error('samplesPerControl must be a positive integer');
  const points: TrackgenPoint[] = [];
  const count = controlPoints.length;
  for (let index = 0; index < count; index++) {
    const p0 = controlPoints[(index - 1 + count) % count]!;
    const p1 = controlPoints[index]!;
    const p2 = controlPoints[(index + 1) % count]!;
    const p3 = controlPoints[(index + 2) % count]!;
    for (let sample = 0; sample < samplesPerControl; sample++)
      points.push(catmullPoint(p0, p1, p2, p3, sample / samplesPerControl));
  }
  const sampledCount = points.length;
  const segmentLengths = new Array<number>(sampledCount);
  const cumulative = new Array<number>(sampledCount + 1).fill(0);
  const headings = new Array<number>(sampledCount);
  for (let index = 0; index < sampledCount; index++) {
    const previous = points[(index - 1 + sampledCount) % sampledCount]!;
    const current = points[index]!;
    const next = points[(index + 1) % sampledCount]!;
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    segmentLengths[index] = length;
    cumulative[index + 1] = cumulative[index]! + length;
    headings[index] = Math.atan2(next.y - previous.y, next.x - previous.x);
  }
  const length = cumulative[sampledCount]!;
  const curvature = new Array<number>(sampledCount);
  for (let index = 0; index < sampledCount; index++) {
    const previous = (index - 1 + sampledCount) % sampledCount;
    curvature[index] = normAng(headings[(index + 1) % sampledCount]! - headings[previous]!) /
      Math.max(0.2, segmentLengths[previous]! + segmentLengths[index]!);
  }
  return {
    points,
    headings,
    curvature,
    segmentLengths,
    cumulative,
    length,
    step: length / sampledCount
  };
}

function tokenWeight(token: ResolvedRhythmToken): number {
  if (token.kind === 'straight' || token.kind === 'complex') return token.length;
  const radius = token.class === 'hairpin' ? 28 :
    token.class === 'slow' ? 48 : token.class === 'medium' ? 88 :
      token.class === 'fast' ? 170 : 320;
  return radius * token.angleDegrees * Math.PI / 180;
}

interface TokenSpan {
  token: ResolvedRhythmToken;
  start: number;
  end: number;
  sigma: number;
  amplitudeJitter: number;
}

function tokenSpans(plan: RhythmPlan, random: () => number): TokenSpan[] {
  const weights = plan.tokens.map(tokenWeight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const minimumSigma = plan.archetype === 'power' ? 0.045 :
    plan.archetype === 'balanced' ? 0.090 : 0.055;
  let cursor = 0.17;
  return plan.tokens.map((token, index) => {
    const span = weights[index]! / Math.max(1e-9, total) * 0.66;
    const result = {
      token,
      start: cursor,
      end: cursor + span,
      sigma: Math.max(minimumSigma, span / 2.8),
      amplitudeJitter: 0.9 + random() * 0.2
    };
    cursor += span;
    return result;
  });
}

function tokenWave(span: TokenSpan, u: number, amplitudeScale: number): number {
  if (span.token.kind === 'straight') return 0;
  const z = (u - (span.start + span.end) / 2) / span.sigma;
  if (Math.abs(z) >= 4) return 0;
  const sign = span.token.direction === 'left' ? 1 : -1;
  const gaussian = Math.exp(-0.5 * z * z);
  if (span.token.kind === 'corner') {
    const angleScale = Math.sqrt(span.token.angleDegrees / 90);
    return sign * CORNER_AMPLITUDE[span.token.class] * angleScale *
      amplitudeScale * span.amplitudeJitter * gaussian;
  }
  const base = span.token.complex === 'chicane' ? 76 :
    span.token.complex === 's' ? 92 : span.token.complex === 'double-apex' ? 108 : 70;
  const shape = span.token.complex === 'double-apex'
    ? (1 - z * z) * gaussian
    : span.token.complex === 'sweeper-chain'
      ? Math.sin(1.35 * z) * Math.exp(-0.28 * z * z)
      : z * Math.exp(0.5 * (1 - z * z));
  return sign * base * amplitudeScale * span.amplitudeJitter *
    shape;
}

function classCounts(plan: RhythmPlan): Record<TrackCornerClass, number> {
  const counts: Record<TrackCornerClass, number> = {
    hairpin: 2,
    slow: 0,
    medium: 0,
    fast: 0,
    kink: 0
  };
  for (const token of plan.tokens)
    if (token.kind === 'corner') counts[token.class]++;
  return counts;
}

function widthProfile(baseWidth: number): readonly TrackgenWidthKey[] {
  return [
    { at: 0, width: 15 },
    { at: 0.08, width: 15 },
    { at: 0.14, width: baseWidth },
    { at: 0.43, width: baseWidth + 0.7 },
    { at: 0.50, width: 14.5 },
    { at: 0.57, width: baseWidth + 0.4 },
    { at: 0.86, width: baseWidth },
    { at: 0.93, width: 15 }
  ];
}

function generateControlPoints(plan: RhythmPlan): {
  points: TrackgenPoint[];
  closureResidualBeforeMetres: number;
} {
  const preset = presetFor(plan.archetype);
  const random = mulberry32((plan.seed ^ 0xA511E9B3) >>> 0);
  const extent = preset.policy.halfExtentMetres * (0.975 + random() * 0.05);
  const upperHeight = preset.policy.upperHeightMetres * (0.94 + random() * 0.12);
  const hairpinRadius = 26.3 + random() * 2.1;
  const hairpinCenter = extent - hairpinRadius;
  const points: TrackgenPoint[] = [{ x: 0, y: 0 }];
  const longStraightEnd = Math.max(0, hairpinCenter - 180);
  const bottomSegments = Math.max(5, Math.ceil(longStraightEnd / 175));
  for (let index = 1; index <= bottomSegments; index++)
    appendUnique(points, { x: longStraightEnd * index / bottomSegments, y: 0 });
  for (const distance of [115, 68, 34, 14, 0])
    appendUnique(points, { x: hairpinCenter - distance, y: 0 });

  const arcSegments = 12;
  for (let index = 1; index <= arcSegments; index++) {
    const angle = -Math.PI / 2 + Math.PI * index / arcSegments;
    appendUnique(points, {
      x: hairpinCenter + Math.cos(angle) * hairpinRadius,
      y: hairpinRadius + Math.sin(angle) * hairpinRadius
    });
  }

  const spans = tokenSpans(plan, random);
  const signedAngle = plan.tokens.reduce((sum, token) =>
    token.kind === 'corner'
      ? sum + (token.direction === 'left' ? 1 : -1) * token.angleDegrees
      : sum, 0);
  const rawClosureDrift = clamp(signedAngle / 360, -1, 1) * (8 + random() * 8);
  const upperSamples = Math.max(72, Math.ceil(hairpinCenter * 2 / 34));
  for (let index = 1; index <= upperSamples; index++) {
    const u = index / upperSamples;
    const rise = smootherstep(u / 0.15);
    const fall = smootherstep((1 - u) / 0.15);
    const plateau = rise * fall;
    const baseline = hairpinRadius * 2 + (upperHeight - hairpinRadius * 2) * plateau;
    let wave = 0;
    for (const span of spans)
      wave += tokenWave(span, u, preset.policy.cornerAmplitudeScale);
    // The raw chain carries a small seeded endpoint residual. A cubic flex
    // correction shares it across the designated connectors; both bases have
    // zero endpoint slope, so the one-step solve closes position and heading.
    const rawDrift = rawClosureDrift * smootherstep(u);
    const solvedDrift = rawDrift - rawClosureDrift * smoothstep(u);
    appendUnique(points, {
      x: hairpinCenter * (1 - 2 * u),
      y: baseline + wave + solvedDrift
    });
  }

  for (let index = 1; index <= arcSegments; index++) {
    const angle = Math.PI / 2 + Math.PI * index / arcSegments;
    appendUnique(points, {
      x: -hairpinCenter + Math.cos(angle) * hairpinRadius,
      y: hairpinRadius + Math.sin(angle) * hairpinRadius
    });
  }
  for (const distance of [14, 34, 68, 115, 180])
    appendUnique(points, { x: -hairpinCenter + distance, y: 0 });
  for (let index = 1; index < bottomSegments; index++)
    appendUnique(points, { x: -longStraightEnd * (1 - index / bottomSegments), y: 0 });
  return {
    points: clampCurvatureRateByConstruction(
      resampleClosedControls(smoothClosedControls(points), 80)
    ),
    closureResidualBeforeMetres: Math.abs(rawClosureDrift)
  };
}

export function realizeRhythmPlan(plan: RhythmPlan): RealizedTrackGeometry {
  const generated = generateControlPoints(plan);
  const initial = sampleTrackgenSpline(generated.points, 3);
  const random = mulberry32((plan.seed ^ 0x6C8E9CF5) >>> 0);
  const target = presetFor(plan.archetype).policy.targetLengthMetres * (0.975 + random() * 0.05);
  const scale = target / initial.length;
  const points = generated.points.map(point => ({ x: point.x * scale, y: point.y * scale }));
  return {
    points,
    widthProfile: widthProfile(11.2 + random() * 0.8),
    startPose: { x: 0, y: 0, heading: 0 },
    endPose: { x: 0, y: 0, heading: 0 },
    groups: [],
    closure: {
      converged: true,
      iterations: 1,
      residualBefore: {
        xMetres: 0,
        yMetres: generated.closureResidualBeforeMetres * scale,
        positionMetres: generated.closureResidualBeforeMetres * scale,
        headingRadians: 0
      },
      residualAfter: {
        xMetres: 0,
        yMetres: 0,
        positionMetres: 0,
        headingRadians: 0
      },
      variables: [],
      largestRelativeGroupDistortion: 0,
      history: []
    },
    closureIterations: 1,
    closureResidualBeforeMetres: generated.closureResidualBeforeMetres * scale,
    plannedCornerClasses: classCounts(plan),
    linkedComplexes: plan.tokens.filter(token => token.kind === 'complex').length
  };
}
