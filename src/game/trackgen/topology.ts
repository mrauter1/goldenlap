import { stableFingerprint } from '../../shared/stable-json';
import type { TrackgenPoint } from './types';

const TOPOLOGY_SAMPLE_COUNT = 64;
const HEADING_BIN_COUNT = 12;
const CURVATURE_SIGN_EPSILON = 1e-4;
const PROJECTION_DERIVATIVE_EPSILON = 1e-5;
const RETURN_DISTANCE_FRACTION = 0.12;
const RETURN_MINIMUM_INDEX_GAP = 6;
const RETURN_PARALLEL_COSINE = Math.cos(15 * Math.PI / 180);

export interface TrackgenTopologyMetrics {
  convexHullFill: number;
  aspectRatio: number;
  primaryAxisReversals: number;
  secondaryAxisReversals: number;
  headingCoverage: number;
  curvatureSignRuns: number;
  returnSectionPairs: number;
  compactness: number;
  structuralFingerprint: string;
}

function distance(left: TrackgenPoint, right: TrackgenPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function resampleClosed(
  source: readonly TrackgenPoint[],
  count = TOPOLOGY_SAMPLE_COUNT
): TrackgenPoint[] {
  if (source.length < 3) throw new Error('Topology measurement needs at least three points');
  const cumulative = new Array<number>(source.length + 1).fill(0);
  for (let index = 0; index < source.length; index++)
    cumulative[index + 1] = cumulative[index]! +
      distance(source[index]!, source[(index + 1) % source.length]!);
  const length = cumulative[source.length]!;
  if (!Number.isFinite(length) || length <= 1e-9)
    throw new Error('Topology measurement needs a finite non-zero route');

  const result: TrackgenPoint[] = [];
  let segment = 0;
  for (let index = 0; index < count; index++) {
    const target = index / count * length;
    while (segment < source.length - 1 && cumulative[segment + 1]! < target) segment++;
    const start = source[segment]!;
    const end = source[(segment + 1) % source.length]!;
    const span = Math.max(1e-9, cumulative[segment + 1]! - cumulative[segment]!);
    const fraction = (target - cumulative[segment]!) / span;
    result.push({
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction
    });
  }
  return result;
}

function signedArea(points: readonly TrackgenPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - current.y * next.x;
  }
  return twiceArea / 2;
}

function cross(origin: TrackgenPoint, left: TrackgenPoint, right: TrackgenPoint): number {
  return (left.x - origin.x) * (right.y - origin.y) -
    (left.y - origin.y) * (right.x - origin.x);
}

function convexHull(points: readonly TrackgenPoint[]): TrackgenPoint[] {
  const sorted = [...points].sort((left, right) =>
    left.x === right.x ? left.y - right.y : left.x - right.x);
  if (sorted.length <= 3) return sorted;
  const lower: TrackgenPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0)
      lower.pop();
    lower.push(point);
  }
  const upper: TrackgenPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]!;
    while (upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0)
      upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

interface PrincipalFrame {
  points: TrackgenPoint[];
  primarySpread: number;
  secondarySpread: number;
}

function principalFrame(source: readonly TrackgenPoint[]): PrincipalFrame {
  const meanX = source.reduce((sum, point) => sum + point.x, 0) / source.length;
  const meanY = source.reduce((sum, point) => sum + point.y, 0) / source.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of source) {
    const x = point.x - meanX;
    const y = point.y - meanY;
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const points = source.map(point => {
    const x = point.x - meanX;
    const y = point.y - meanY;
    return {
      x: x * cosine + y * sine,
      y: -x * sine + y * cosine
    };
  });
  const primary = points.map(point => point.x);
  const secondary = points.map(point => point.y);
  return {
    points,
    primarySpread: Math.max(...primary) - Math.min(...primary),
    secondarySpread: Math.max(...secondary) - Math.min(...secondary)
  };
}

function directionReversals(values: readonly number[], scale: number): number {
  let previous = 0;
  let reversals = 0;
  for (let index = 0; index < values.length; index++) {
    const delta = values[(index + 1) % values.length]! - values[index]!;
    const sign = Math.abs(delta) <= scale * PROJECTION_DERIVATIVE_EPSILON
      ? 0
      : Math.sign(delta);
    if (sign === 0) continue;
    if (previous !== 0 && sign !== previous) reversals++;
    previous = sign;
  }
  return reversals;
}

function routeHeadings(points: readonly TrackgenPoint[]): number[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return Math.atan2(next.y - point.y, next.x - point.x);
  });
}

function normalizedAngle(value: number): number {
  const wrapped = value % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}

function curvatureSigns(headings: readonly number[]): number[] {
  const signs: number[] = [];
  for (let index = 0; index < headings.length; index++) {
    let delta = headings[(index + 1) % headings.length]! - headings[index]!;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    signs.push(Math.abs(delta) <= CURVATURE_SIGN_EPSILON ? 0 : Math.sign(delta));
  }
  return signs;
}

function signRuns(signs: readonly number[]): number {
  const nonZero = signs.filter(sign => sign !== 0);
  if (!nonZero.length) return 0;
  let runs = 0;
  for (let index = 0; index < nonZero.length; index++)
    if (nonZero[index] !== nonZero[(index - 1 + nonZero.length) % nonZero.length]) runs++;
  return Math.max(1, runs);
}

function returnSectionPairs(points: readonly TrackgenPoint[], headings: readonly number[]): number {
  const frame = principalFrame(points);
  const diagonal = Math.hypot(frame.primarySpread, frame.secondarySpread);
  const maximumDistance = diagonal * RETURN_DISTANCE_FRACTION;
  let pairs = 0;
  for (let left = 0; left < points.length; left++) {
    for (let right = left + RETURN_MINIMUM_INDEX_GAP; right < points.length; right++) {
      const cyclicGap = Math.min(right - left, points.length - (right - left));
      if (cyclicGap < RETURN_MINIMUM_INDEX_GAP) continue;
      if (distance(points[left]!, points[right]!) > maximumDistance) continue;
      const alignment = Math.abs(Math.cos(headings[left]! - headings[right]!));
      if (alignment >= RETURN_PARALLEL_COSINE) pairs++;
    }
  }
  return pairs;
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function measureTrackTopology(
  source: readonly TrackgenPoint[]
): TrackgenTopologyMetrics {
  const points = resampleClosed(source);
  const frame = principalFrame(points);
  const area = Math.abs(signedArea(points));
  const hullArea = Math.abs(signedArea(convexHull(points)));
  const length = points.reduce((sum, point, index) =>
    sum + distance(point, points[(index + 1) % points.length]!), 0);
  const headings = routeHeadings(points);
  const bins = new Set(headings.map(heading =>
    Math.floor(normalizedAngle(heading) / (Math.PI * 2) * HEADING_BIN_COUNT) %
      HEADING_BIN_COUNT));
  const signs = curvatureSigns(headings);
  const primaryAxisReversals = directionReversals(
    frame.points.map(point => point.x),
    frame.primarySpread
  );
  const secondaryAxisReversals = directionReversals(
    frame.points.map(point => point.y),
    frame.secondarySpread
  );
  const convexHullFill = hullArea <= 1e-9 ? 0 : area / hullArea;
  const aspectRatio = frame.secondarySpread <= 1e-9
    ? Infinity
    : frame.primarySpread / frame.secondarySpread;
  const headingCoverage = bins.size / HEADING_BIN_COUNT;
  const curvatureSignRuns = signRuns(signs);
  const returns = returnSectionPairs(points, headings);
  const compactness = length <= 1e-9 ? 0 : 4 * Math.PI * area / (length * length);
  const structuralFingerprint = stableFingerprint({
    convexHullFill: quantize(convexHullFill, 0.05),
    aspectRatio: quantize(Math.min(10, aspectRatio), 0.25),
    primaryAxisReversals,
    secondaryAxisReversals,
    headingCoverage: quantize(headingCoverage, 1 / HEADING_BIN_COUNT),
    curvatureSignRuns,
    returnSectionPairs: Math.min(20, returns),
    curvatureSignSequence: signs.filter((_, index) => index % 4 === 0)
  });
  return {
    convexHullFill,
    aspectRatio,
    primaryAxisReversals,
    secondaryAxisReversals,
    headingCoverage,
    curvatureSignRuns,
    returnSectionPairs: returns,
    compactness,
    structuralFingerprint
  };
}

function normalizeRoute(source: readonly TrackgenPoint[]): TrackgenPoint[] {
  const points = resampleClosed(source);
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const centered = points.map(point => ({ x: point.x - meanX, y: point.y - meanY }));
  const scale = Math.sqrt(centered.reduce(
    (sum, point) => sum + point.x * point.x + point.y * point.y,
    0
  ) / centered.length);
  return centered.map(point => ({ x: point.x / scale, y: point.y / scale }));
}

/** Translation/rotation/scale-normalized RMS route distance at the canonical start. */
export function normalizedRouteDistance(
  leftSource: readonly TrackgenPoint[],
  rightSource: readonly TrackgenPoint[]
): number {
  const left = normalizeRoute(leftSource);
  const right = normalizeRoute(rightSource);
  let dot = 0;
  let crossSum = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index]!.x * right[index]!.x + left[index]!.y * right[index]!.y;
    crossSum += left[index]!.x * right[index]!.y - left[index]!.y * right[index]!.x;
  }
  const angle = Math.atan2(crossSum, dot);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  let squared = 0;
  for (let index = 0; index < left.length; index++) {
    const point = right[index]!;
    const x = point.x * cosine + point.y * sine;
    const y = -point.x * sine + point.y * cosine;
    squared += (left[index]!.x - x) ** 2 + (left[index]!.y - y) ** 2;
  }
  return Math.sqrt(squared / left.length);
}
