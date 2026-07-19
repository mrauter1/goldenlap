import { normAng } from '../../shared/math';
import {
  availableDeceleration,
  cornerSpeedForGrip,
  PHYS
} from '../../core/physics';
import { sampleTrackCenterline } from '../../core/track-geometry';
import type { SampledTrackgenGeometry } from './geometry';
import { presetFor } from './presets';
import { measureTrackTopology } from './topology';
import type {
  RealizedTrackGeometry,
  RhythmPlanV2,
  Tier0Evaluation,
  Tier0Metrics,
  TrackgenCornerHistogram,
  TrackgenGateResult,
  TrackgenPoint,
  TrackgenWidthKey
} from './types';

export const TRACKGEN_MAX_CURVATURE_RATE = 0.006;
export const TRACKGEN_MIN_STRAIGHT_SECONDS = 8;
export const TRACKGEN_NORMAL_STRAIGHT_SECONDS = 10;

function interpolateWidth(keys: readonly TrackgenWidthKey[], fraction: number): number {
  const value = ((fraction % 1) + 1) % 1;
  for (let index = 0; index < keys.length; index++) {
    const from = keys[index]!;
    const to = keys[(index + 1) % keys.length]!;
    const end = index + 1 < keys.length ? to.at : to.at + 1;
    const at = value < from.at ? value + 1 : value;
    if (at <= end) {
      const progress = (at - from.at) / Math.max(1e-9, end - from.at);
      return from.width + (to.width - from.width) * progress;
    }
  }
  return keys[0]?.width ?? 12;
}

function orientation(a: TrackgenPoint, b: TrackgenPoint, c: TrackgenPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(
  a: TrackgenPoint,
  b: TrackgenPoint,
  c: TrackgenPoint,
  d: TrackgenPoint
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > 1e-9 && abD < -1e-9) || (abC < -1e-9 && abD > 1e-9)) &&
    ((cdA > 1e-9 && cdB < -1e-9) || (cdA < -1e-9 && cdB > 1e-9));
}

function pointSegmentDistance(
  point: TrackgenPoint,
  start: TrackgenPoint,
  end: TrackgenPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator <= 1e-12 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator
  ));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function segmentDistance(
  a: TrackgenPoint,
  b: TrackgenPoint,
  c: TrackgenPoint,
  d: TrackgenPoint
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b)
  );
}

function separationMetrics(
  sampled: SampledTrackgenGeometry,
  widthKeys: readonly TrackgenWidthKey[]
): { intersections: number; margin: number; left: number; right: number } {
  const points = sampled.points;
  const count = points.length;
  let intersections = 0;
  const maximumRequired = Math.max(...widthKeys.map(key => key.width)) * 4;
  const maximumSegmentLength = Math.max(...sampled.segmentLengths);
  let margin = maximumRequired;
  let closestLeft = -1;
  let closestRight = -1;
  const cellSize = maximumRequired;
  const buckets = new Map<string, number[]>();
  for (let left = 0; left < count; left++) {
    const leftNext = (left + 1) % count;
    const leftWidth = interpolateWidth(widthKeys, left / count);
    const first = points[left]!;
    const second = points[leftNext]!;
    const middleX = (first.x + second.x) / 2;
    const middleY = (first.y + second.y) / 2;
    const segmentLength = sampled.segmentLengths[left]!;
    const reach = Math.ceil((maximumRequired + segmentLength / 2 + maximumSegmentLength / 2) /
      cellSize);
    const cellX = Math.floor(middleX / cellSize);
    const cellY = Math.floor(middleY / cellSize);
    for (let x = cellX - reach; x <= cellX + reach; x++) {
      for (let y = cellY - reach; y <= cellY + reach; y++) {
        for (const right of buckets.get(`${x}:${y}`) ?? []) {
          const rightNext = (right + 1) % count;
          const along = Math.abs(sampled.cumulative[right]! - sampled.cumulative[left]!);
          // A whole corner is one section. Runoff separation starts once two
          // centreline locations are far enough apart along the lap to be
          // independently driven pieces of road.
          if (Math.min(along, sampled.length - along) < 240) continue;
          const third = points[right]!;
          const fourth = points[rightNext]!;
          const required = 4 * Math.max(leftWidth, interpolateWidth(widthKeys, right / count));
          if (Math.max(Math.min(first.x, second.x), Math.min(third.x, fourth.x)) -
              Math.min(Math.max(first.x, second.x), Math.max(third.x, fourth.x)) > required ||
              Math.max(Math.min(first.y, second.y), Math.min(third.y, fourth.y)) -
              Math.min(Math.max(first.y, second.y), Math.max(third.y, fourth.y)) > required)
            continue;
          const distance = segmentDistance(first, second, third, fourth);
          if (distance <= 1e-7) intersections++;
          const candidateMargin = distance - required;
          if (candidateMargin < margin) {
            margin = candidateMargin;
            closestLeft = left;
            closestRight = right;
          }
        }
      }
    }
    const key = `${cellX}:${cellY}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(left);
    buckets.set(key, bucket);
  }
  return { intersections, margin, left: closestLeft, right: closestRight };
}

function productionGeometry(
  geometry: RealizedTrackGeometry,
): SampledTrackgenGeometry {
  const sampled = sampleTrackCenterline(
    geometry.points.map(point => [point.x, point.y] as const)
  );
  const points: TrackgenPoint[] = [];
  const headings: number[] = [];
  const curvature: number[] = [];
  const segmentLengths: number[] = [];
  const cumulative: number[] = [0];
  for (let index = 0; index < sampled.n; index++) {
    points.push({ x: sampled.x[index]!, y: sampled.y[index]! });
    headings.push(sampled.heading[index]!);
    curvature.push(sampled.kSm[index]!);
  }
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    segmentLengths.push(length);
    cumulative.push(cumulative[index]! + length);
  }
  return {
    points,
    headings,
    curvature,
    segmentLengths,
    cumulative,
    length: sampled.len,
    step: sampled.step
  };
}

function downsampleGeometry(
  sampled: SampledTrackgenGeometry,
  stride: number
): SampledTrackgenGeometry {
  const points: TrackgenPoint[] = [];
  const headings: number[] = [];
  const curvature: number[] = [];
  for (let index = 0; index < sampled.points.length; index += stride) {
    points.push(sampled.points[index]!);
    headings.push(sampled.headings[index]!);
    curvature.push(sampled.curvature[index]!);
  }
  const segmentLengths: number[] = [];
  const cumulative: number[] = [0];
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    segmentLengths.push(length);
    cumulative.push(cumulative[index]! + length);
  }
  return {
    points,
    headings,
    curvature,
    segmentLengths,
    cumulative,
    length: cumulative[points.length]!,
    step: sampled.step * stride
  };
}

function maximumCurvatureRate(sampled: SampledTrackgenGeometry, curvature: readonly number[]): number {
  let maximum = 0;
  for (let index = 0; index < curvature.length; index++) {
    const next = (index + 1) % curvature.length;
    maximum = Math.max(maximum,
      Math.abs(curvature[next]! - curvature[index]!) /
        Math.max(0.5, sampled.segmentLengths[index]!)
    );
  }
  return maximum;
}

function estimateSpeed(
  sampled: SampledTrackgenGeometry,
  curvature: readonly number[]
): { averageKmh: number; lapSeconds: number; speed: number[] } {
  const count = curvature.length;
  const speed = new Array<number>(count);
  for (let index = 0; index < count; index++) {
    speed[index] = cornerSpeedForGrip(curvature[index]!);
  }
  const available = (velocity: number): number => availableDeceleration(velocity);
  for (let iteration = 0; iteration < 4; iteration++) {
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count;
      const velocity = speed[index]!;
      const lateral = velocity * velocity * Math.abs(curvature[index]!);
      const room = Math.sqrt(Math.max(0, available(velocity) ** 2 - lateral ** 2));
      const engine = Math.max(0,
        (Math.min(PHYS.Fmax * PHYS.tc, PHYS.power / Math.max(velocity, 4)) -
          (PHYS.kDrag * velocity * velocity + PHYS.kRoll)) / PHYS.m
      );
      speed[next] = Math.min(speed[next]!, Math.sqrt(
        velocity * velocity + 2 * Math.min(engine, room) * sampled.segmentLengths[index]!
      ));
    }
    for (let index = count - 1; index >= 0; index--) {
      const next = (index + 1) % count;
      const velocity = speed[next]!;
      const lateral = velocity * velocity * Math.abs(curvature[next]!);
      const room = Math.sqrt(Math.max(0,
        (available(velocity) * PHYS.brkFrac) ** 2 - lateral ** 2
      ));
      speed[index] = Math.min(speed[index]!, Math.sqrt(
        velocity * velocity + 2 * room * sampled.segmentLengths[index]!
      ));
    }
  }
  let lapSeconds = 0;
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    lapSeconds += sampled.segmentLengths[index]! /
      Math.max(1, (speed[index]! + speed[next]!) / 2);
  }
  return {
    averageKmh: sampled.length / lapSeconds * 3.6,
    lapSeconds,
    speed
  };
}

function straightMetrics(
  sampled: SampledTrackgenGeometry,
  curvature: readonly number[]
): { seconds: number; metres: number } {
  const qualifying = curvature.map(value => Math.abs(value) <= 1 / 420);
  const doubled = [...qualifying, ...qualifying];
  let bestMetres = 0;
  let runMetres = 0;
  let runCount = 0;
  for (let index = 0; index < doubled.length; index++) {
    if (doubled[index]) {
      runMetres += sampled.segmentLengths[index % qualifying.length]!;
      runCount++;
      if (runCount > qualifying.length) {
        runMetres -= sampled.segmentLengths[(index - qualifying.length) % qualifying.length]!;
        runCount--;
      }
      bestMetres = Math.max(bestMetres, runMetres);
    } else {
      runMetres = 0;
      runCount = 0;
    }
  }
  return { seconds: bestMetres / PHYS.vTop, metres: bestMetres };
}

function cornerHistogram(
  sampled: SampledTrackgenGeometry,
  curvature: readonly number[]
): TrackgenCornerHistogram {
  const histogram: TrackgenCornerHistogram = {
    hairpin: 0, slow: 0, medium: 0, fast: 0, kink: 0, left: 0, right: 0
  };
  const count = curvature.length;
  const candidates: Array<{ index: number; magnitude: number }> = [];
  for (let index = 0; index < count; index++) {
    const magnitude = Math.abs(curvature[index]!);
    if (magnitude < 1 / 700) continue;
    let peak = true;
    for (let delta = 1; delta <= 3; delta++) {
      if (Math.abs(curvature[(index - delta + count) % count]!) > magnitude + 1e-9 ||
          Math.abs(curvature[(index + delta) % count]!) > magnitude + 1e-9) {
        peak = false;
        break;
      }
    }
    if (peak) candidates.push({ index, magnitude });
  }
  candidates.sort((left, right) => right.magnitude - left.magnitude);
  const accepted: number[] = [];
  for (const candidate of candidates) {
    const separated = accepted.every(index => {
      const direct = Math.abs(index - candidate.index);
      return Math.min(direct, count - direct) * sampled.step >= 45;
    });
    if (!separated) continue;
    accepted.push(candidate.index);
    const radius = 1 / candidate.magnitude;
    const classification = radius < 30 ? 'hairpin' : radius < 60 ? 'slow' :
      radius < 120 ? 'medium' : radius < 250 ? 'fast' : 'kink';
    histogram[classification]++;
    if (curvature[candidate.index]! >= 0) histogram.left++;
    else histogram.right++;
  }
  return histogram;
}

function gate(
  id: string,
  value: number,
  unit: string,
  bounds: { minimum?: number; maximum?: number }
): TrackgenGateResult {
  const passesMinimum = bounds.minimum === undefined || value >= bounds.minimum - 1e-9;
  const passesMaximum = bounds.maximum === undefined || value <= bounds.maximum + 1e-9;
  return { id, value, unit, ...bounds, status: passesMinimum && passesMaximum ? 'pass' : 'fail' };
}

function portableMetric(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e9) / 1e9 : value;
}

function maximumClassShare(histogram: TrackgenCornerHistogram): number {
  const values = [
    histogram.hairpin, histogram.slow, histogram.medium, histogram.fast, histogram.kink
  ];
  const total = values.reduce((sum, value) => sum + value, 0);
  return total ? Math.max(...values) / total : 1;
}

function finiteValueCount(
  sampled: SampledTrackgenGeometry,
  geometry: RealizedTrackGeometry
): number {
  let invalid = 0;
  const values = [
    geometry.startPose.x,
    geometry.startPose.y,
    geometry.startPose.heading,
    geometry.endPose.x,
    geometry.endPose.y,
    geometry.endPose.heading,
    ...sampled.points.flatMap(point => [point.x, point.y]),
    ...sampled.headings,
    ...sampled.curvature,
    ...sampled.segmentLengths
  ];
  for (const value of values)
    if (!Number.isFinite(value)) invalid++;
  return invalid;
}

function apexCount(values: readonly number[]): number {
  let count = 0;
  for (let index = 1; index < values.length - 1; index++) {
    const value = Math.abs(values[index]!);
    if (value <= 1e-12) continue;
    if (value >= Math.abs(values[index - 1]!) - 1e-12 &&
        value >= Math.abs(values[index + 1]!) - 1e-12 &&
        (value > Math.abs(values[index - 1]!) + 1e-12 ||
          value > Math.abs(values[index + 1]!) + 1e-12))
      count++;
  }
  return count;
}

function radiusMatchesClass(
  radius: number,
  intended: NonNullable<RhythmPlanV2['groups'][number]['radiusClass']>
): boolean {
  // Radius classes describe driving character, not discontinuous millimetre
  // bins. Ten-percent overlaps keep a 30.1 m corner from changing semantic
  // identity while the production histogram retains its exact classification.
  const bounds = {
    hairpin: [0, 33],
    slow: [27, 66],
    medium: [54, 132],
    fast: [108, 275],
    kink: [225, Infinity]
  } as const;
  const [minimum, maximum] = bounds[intended];
  return radius >= minimum && radius <= maximum;
}

function planFidelity(
  plan: RhythmPlanV2,
  geometry: RealizedTrackGeometry
): Tier0Metrics['planFidelity'] {
  let maximumLengthDistortionFraction = 0;
  let maximumLobeAngleErrorDegrees = 0;
  let lobeSignMismatchCount = 0;
  let apexCountMismatchCount = 0;
  let radiusClassMismatchCount = 0;
  let maximumBoundaryCurvatureJump = 0;
  let eligibleShallowStraights = 0;
  let measurableShallowStraights = 0;
  for (const group of geometry.groups) {
    const resolved = plan.groups[group.groupIndex]!;
    maximumLengthDistortionFraction = Math.max(
      maximumLengthDistortionFraction,
      Math.abs(group.realizedLengthMetres - group.targetLengthMetres) /
        Math.max(1, group.targetLengthMetres)
    );
    for (const lobe of group.lobes) {
      maximumLobeAngleErrorDegrees = Math.max(
        maximumLobeAngleErrorDegrees,
        Math.abs(lobe.realizedAngleDegrees - lobe.targetAngleDegrees)
      );
      if (Math.abs(lobe.targetAngleDegrees) > 1e-9 &&
          Math.sign(lobe.realizedAngleDegrees) !== Math.sign(lobe.targetAngleDegrees))
        lobeSignMismatchCount++;
    }
    const expectedApexes = apexCount(resolved.knots.map(knot => knot.curvatureWeight));
    const realizedApexes = apexCount(group.knots.map(knot => knot.kappa));
    if (expectedApexes !== realizedApexes) apexCountMismatchCount++;
    if (resolved.radiusClass) {
      const radius = Math.min(...group.lobes.map(lobe => lobe.realizedMinimumRadiusMetres));
      if (!radiusMatchesClass(radius, resolved.radiusClass)) radiusClassMismatchCount++;
    }
    if (group.kind !== 'nominal-straight' || group.role === 'grid-pit') continue;
    const targetTurn = group.lobes.reduce(
      (sum, lobe) => sum + Math.abs(lobe.targetAngleDegrees),
      0
    );
    if (targetTurn > 0 && targetTurn <= 12) {
      eligibleShallowStraights++;
      if (targetTurn >= 0.5) measurableShallowStraights++;
    }
  }
  for (let index = 0; index < geometry.groups.length; index++) {
    const group = geometry.groups[index]!;
    const next = geometry.groups[(index + 1) % geometry.groups.length]!;
    const exit = group.knots.at(-1)?.kappa ?? 0;
    const entry = next.knots[0]?.kappa ?? 0;
    maximumBoundaryCurvatureJump = Math.max(
      maximumBoundaryCurvatureJump,
      Math.abs(entry - exit)
    );
  }
  const flexBoundViolationCount = geometry.closure.variables.filter(variable =>
    variable.value < variable.minimum - 1e-9 ||
    variable.value > variable.maximum + 1e-9
  ).length;
  return {
    maximumLengthDistortionFraction,
    maximumLobeAngleErrorDegrees,
    lobeSignMismatchCount,
    apexCountMismatchCount,
    radiusClassMismatchCount,
    flexBoundViolationCount,
    maximumBoundaryCurvatureJump,
    eligibleShallowStraights,
    measurableShallowStraights,
    measurableShallowStraightFraction: eligibleShallowStraights
      ? measurableShallowStraights / eligibleShallowStraights
      : 1
  };
}

function groupAtFraction(
  geometry: RealizedTrackGeometry,
  fraction: number
): string {
  const total = geometry.groups.at(-1)?.sEnd ?? 0;
  const distance = fraction * total;
  return geometry.groups.find(group =>
    distance >= group.sStart - 1e-9 && distance <= group.sEnd + 1e-9
  )?.groupId ?? 'unknown';
}

export function evaluateTier0(
  plan: RhythmPlanV2,
  geometry: RealizedTrackGeometry,
  separationStride = 10
): Tier0Evaluation {
  const policy = presetFor(plan.archetype).policy;
  const sampled = productionGeometry(geometry);
  const curvature = sampled.curvature;
  const speed = estimateSpeed(sampled, curvature);
  const straight = straightMetrics(sampled, curvature);
  const separationSample = downsampleGeometry(
    sampled,
    Math.max(1, Math.round(separationStride))
  );
  const separation = separationMetrics(separationSample, geometry.widthProfile);
  const histogram = cornerHistogram(sampled, curvature);
  const closureError = Math.hypot(
    geometry.endPose.x - geometry.startPose.x,
    geometry.endPose.y - geometry.startPose.y
  );
  const closureHeading = Math.abs(normAng(
    geometry.endPose.heading - geometry.startPose.heading
  ));
  const grandPitLength = 284;
  const pitLossFraction = (grandPitLength / 14 - grandPitLength / PHYS.vTop) /
    Math.max(1, speed.lapSeconds);
  const topology = measureTrackTopology(sampled.points);
  const duplicateSegmentCount = sampled.segmentLengths.filter(length => length <= 1e-7).length;
  const closestSeparationGroups = separation.left < 0
    ? 'none'
    : `${groupAtFraction(geometry, separation.left /
      Math.max(1, separationSample.points.length))}:` +
      `${groupAtFraction(geometry, separation.right /
      Math.max(1, separationSample.points.length))}`;
  const metrics: Tier0Metrics = {
    lengthMetres: sampled.length,
    averageSpeedKmh: portableMetric(speed.averageKmh),
    estimatedLapSeconds: portableMetric(speed.lapSeconds),
    longestStraightSeconds: straight.seconds,
    longestStraightMetres: straight.metres,
    closureErrorMetres: closureError,
    closureHeadingErrorRadians: closureHeading,
    maximumCurvatureRate: maximumCurvatureRate(sampled, curvature),
    nonFiniteValueCount: finiteValueCount(sampled, geometry),
    duplicateSegmentCount,
    selfIntersectionCount: separation.intersections,
    selfIntersectionMarginMetres: separation.margin,
    closestSeparationGroups,
    gridPitFitMetres: straight.metres - 560,
    pitLossFraction: portableMetric(pitLossFraction),
    cornerHistogram: histogram,
    linkedComplexes: geometry.linkedComplexes,
    planFidelity: planFidelity(plan, geometry),
    topology
  };
  const coverage = (['hairpin', 'slow', 'medium', 'fast', 'kink'] as const)
    .filter(name => geometry.plannedCornerClasses[name] > 0 && histogram[name] > 0)
    .length;
  const gates: TrackgenGateResult[] = [
    gate('trackgen.length_m', metrics.lengthMetres, 'm', {
      minimum: policy.lengthMetres[0], maximum: policy.lengthMetres[1]
    }),
    gate('trackgen.speed_envelope_kmh', metrics.averageSpeedKmh, 'km/h', {
      minimum: policy.averageSpeedKmh[0], maximum: policy.averageSpeedKmh[1]
    }),
    gate('trackgen.lap_seconds', metrics.estimatedLapSeconds, 's', {
      minimum: 55, maximum: 150
    }),
    gate('trackgen.longest_straight_seconds', metrics.longestStraightSeconds, 's', {
      minimum: TRACKGEN_MIN_STRAIGHT_SECONDS
    }),
    gate('trackgen.corner_class_coverage', coverage, 'classes represented', { minimum: 5 }),
    gate('trackgen.corner_class_max_share', maximumClassShare(histogram), 'fraction', {
      maximum: 0.6
    }),
    gate('trackgen.direction_balance', Math.min(histogram.left, histogram.right), 'corners', {
      minimum: 1
    }),
    gate('trackgen.linked_complexes', metrics.linkedComplexes, 'complexes', { minimum: 1 }),
    gate('trackgen.closure_error_m', metrics.closureErrorMetres, 'm', { maximum: 1e-7 }),
    gate('trackgen.closure_heading_error_rad', metrics.closureHeadingErrorRadians, 'rad', {
      maximum: 1e-7
    }),
    gate('trackgen.closure_solved', geometry.closure.converged ? 1 : 0, 'boolean', {
      minimum: 1
    }),
    gate('trackgen.non_finite_values', metrics.nonFiniteValueCount, 'values', { maximum: 0 }),
    gate('trackgen.duplicate_segments', metrics.duplicateSegmentCount, 'segments', { maximum: 0 }),
    gate('trackgen.curvature_rate', metrics.maximumCurvatureRate, '1/m^2', {
      maximum: TRACKGEN_MAX_CURVATURE_RATE
    }),
    gate('trackgen.self_intersections', metrics.selfIntersectionCount, 'occurrences', {
      maximum: 0
    }),
    gate('trackgen.self_intersection_margin_m', metrics.selfIntersectionMarginMetres, 'm', {
      minimum: 0
    }),
    gate(
      'trackgen.lobe_angle_error_deg',
      metrics.planFidelity.maximumLobeAngleErrorDegrees,
      'degrees',
      { maximum: 1e-7 }
    ),
    gate(
      'trackgen.lobe_sign_mismatches',
      metrics.planFidelity.lobeSignMismatchCount,
      'lobes',
      { maximum: 0 }
    ),
    gate(
      'trackgen.apex_count_mismatches',
      metrics.planFidelity.apexCountMismatchCount,
      'groups',
      { maximum: 0 }
    ),
    gate(
      'trackgen.radius_class_mismatches',
      metrics.planFidelity.radiusClassMismatchCount,
      'groups',
      { maximum: 0 }
    ),
    gate(
      'trackgen.flex_bound_violations',
      metrics.planFidelity.flexBoundViolationCount,
      'variables',
      { maximum: 0 }
    ),
    gate(
      'trackgen.boundary_curvature_jump',
      metrics.planFidelity.maximumBoundaryCurvatureJump,
      '1/m',
      { maximum: 1e-9 }
    ),
    gate(
      'trackgen.shallow_straight_fraction',
      metrics.planFidelity.measurableShallowStraightFraction,
      'fraction',
      { minimum: 0.5 }
    ),
    gate('trackgen.grid_pit_fit_m', metrics.gridPitFitMetres, 'm', { minimum: 0 }),
    gate('trackgen.pit_loss_fraction', metrics.pitLossFraction, 'fraction', {
      minimum: 0.12, maximum: 0.30
    })
  ];
  return { accepted: gates.every(result => result.status === 'pass'), metrics, gates };
}

export function hardInvariantFailures(
  plan: RhythmPlanV2,
  geometry: RealizedTrackGeometry,
  separationStride = 1
): string[] {
  const evaluation = evaluateTier0(plan, geometry, separationStride);
  const hardIds = new Set([
    'trackgen.closure_error_m',
    'trackgen.closure_heading_error_rad',
    'trackgen.closure_solved',
    'trackgen.non_finite_values',
    'trackgen.duplicate_segments',
    'trackgen.curvature_rate',
    'trackgen.self_intersections',
    'trackgen.self_intersection_margin_m'
  ]);
  return evaluation.gates
    .filter(result => hardIds.has(result.id) && result.status === 'fail')
    .map(result => result.id);
}
