import { normAng } from '../../shared/math';
import type {
  RealizedGroupSpan,
  RealizedShapeKnot,
  RealizedTrackGeometry,
  RealizedTurnLobe,
  ResolvedShapeGroup,
  RhythmPlanV2,
  TrackCornerClass,
  TrackgenPoint,
  TrackgenPose
} from './types';

const CONTROL_SPACING_METRES = 12;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
export interface AppliedGroupAdjustment {
  lengthDeltaMetres: number;
  lobeAngleDeltaDegrees: readonly number[];
  shallowBendBias: number;
}

export type RouteAdjustments = ReadonlyMap<string, AppliedGroupAdjustment>;

export interface IntegratedRhythmRoute {
  points: readonly TrackgenPoint[];
  startPose: TrackgenPose;
  endPose: TrackgenPose;
  groups: readonly RealizedGroupSpan[];
  totalLengthMetres: number;
  plannedCornerClasses: Readonly<Record<TrackCornerClass, number>>;
  linkedComplexes: number;
}

interface IntegrationSegment {
  startS: number;
  endS: number;
  midpointS: number;
  length: number;
  lobe: number;
  rawWeight: number;
  kappa: number;
}

function smootherstep(value: number): number {
  const u = Math.max(0, Math.min(1, value));
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function interpolateWeight(
  group: ResolvedShapeGroup,
  adjustedLength: number,
  distance: number
): number {
  const at = distance / adjustedLength;
  let index = 0;
  while (index < group.knots.length - 2 && group.knots[index + 1]!.at < at)
    index++;
  const from = group.knots[index]!;
  const to = group.knots[index + 1]!;
  const progress = (at - from.at) / Math.max(1e-12, to.at - from.at);
  const eased = smootherstep(progress);
  return from.curvatureWeight +
    (to.curvatureWeight - from.curvatureWeight) * eased;
}

function lobeAtDistance(
  group: ResolvedShapeGroup,
  adjustedLength: number,
  distance: number
): number {
  const at = distance / adjustedLength;
  for (let index = 0; index < group.lobes.length; index++) {
    const lobe = group.lobes[index]!;
    const start = group.knots[lobe.firstKnot]!.at;
    const end = group.knots[lobe.lastKnot]!.at;
    if (at >= start - 1e-12 && at <= end + 1e-12) return index;
  }
  return -1;
}

function fallbackLobeWeight(
  group: ResolvedShapeGroup,
  adjustedLength: number,
  distance: number,
  lobeIndex: number
): number {
  const lobe = group.lobes[lobeIndex]!;
  const start = group.knots[lobe.firstKnot]!.at * adjustedLength;
  const end = group.knots[lobe.lastKnot]!.at * adjustedLength;
  const progress = (distance - start) / Math.max(1e-12, end - start);
  return Math.sin(Math.PI * Math.max(0, Math.min(1, progress)));
}

function integrationSegments(
  group: ResolvedShapeGroup,
  adjustedLength: number
): IntegrationSegment[] {
  const result: IntegrationSegment[] = [];
  for (let knotIndex = 0; knotIndex < group.knots.length - 1; knotIndex++) {
    const start = group.knots[knotIndex]!.at * adjustedLength;
    const end = group.knots[knotIndex + 1]!.at * adjustedLength;
    // Closure length flex must not change the discretization topology under
    // the finite-difference Jacobian. The resolved authored length fixes the
    // sample count; flex changes only the physical step represented by it.
    const authoredSpan = (group.knots[knotIndex + 1]!.at -
      group.knots[knotIndex]!.at) * group.lengthMetres;
    const count = Math.max(1, Math.ceil(authoredSpan / CONTROL_SPACING_METRES));
    for (let index = 0; index < count; index++) {
      const startS = start + (end - start) * index / count;
      const endS = start + (end - start) * (index + 1) / count;
      const midpointS = (startS + endS) / 2;
      const lobe = lobeAtDistance(group, adjustedLength, midpointS);
      const interpolatedWeight = lobe < 0
        ? 0
        : Math.abs(interpolateWeight(group, adjustedLength, midpointS));
      const shapeExponent = group.kind === 'nominal-straight' ? 1 :
        group.kind === 'complex'
          ? group.motif === 'sweeper-chain' ? 6 : 5
          :
          group.radiusClass === 'hairpin' ? 1 :
            group.radiusClass === 'slow' ? 2.5 :
            group.radiusClass === 'medium' ? 1.4 :
              group.radiusClass === 'fast' ? 1.5 :
                group.radiusClass === 'kink' ? 0.2 : 2;
      result.push({
        startS,
        endS,
        midpointS,
        length: endS - startS,
        lobe,
        rawWeight: interpolatedWeight ** shapeExponent,
        kappa: 0
      });
    }
  }
  for (let lobeIndex = 0; lobeIndex < group.lobes.length; lobeIndex++) {
    let integral = 0;
    for (const segment of result)
      if (segment.lobe === lobeIndex) integral += segment.rawWeight * segment.length;
    if (integral > 1e-12) continue;
    for (const segment of result) {
      if (segment.lobe !== lobeIndex) continue;
      segment.rawWeight = fallbackLobeWeight(
        group,
        adjustedLength,
        segment.midpointS,
        lobeIndex
      );
    }
  }
  return result;
}

function adjustedLobeAngles(
  group: ResolvedShapeGroup,
  adjustment: AppliedGroupAdjustment | undefined
): number[] {
  const bendScale = group.kind === 'nominal-straight'
    ? 1 + (adjustment?.shallowBendBias ?? 0)
    : 1;
  return group.lobes.map((lobe, index) =>
    (lobe.angleDegrees + (adjustment?.lobeAngleDeltaDegrees[index] ?? 0)) * bendScale
  );
}

function poseAfterConstantCurvature(
  pose: TrackgenPose,
  kappa: number,
  distance: number
): TrackgenPose {
  if (Math.abs(kappa) <= 1e-14) return {
    x: pose.x + Math.cos(pose.heading) * distance,
    y: pose.y + Math.sin(pose.heading) * distance,
    heading: pose.heading
  };
  const heading = pose.heading + kappa * distance;
  return {
    x: pose.x + (Math.sin(heading) - Math.sin(pose.heading)) / kappa,
    y: pose.y + (Math.cos(pose.heading) - Math.cos(heading)) / kappa,
    heading
  };
}

function classCounts(plan: RhythmPlanV2): Record<TrackCornerClass, number> {
  const counts: Record<TrackCornerClass, number> = {
    hairpin: 0,
    slow: 0,
    medium: 0,
    fast: 0,
    kink: 0
  };
  for (const group of plan.groups)
    if (group.radiusClass) counts[group.radiusClass]++;
  return counts;
}

function knotCurvature(
  group: ResolvedShapeGroup,
  adjustedLength: number,
  knotIndex: number,
  segments: readonly IntegrationSegment[],
  anglesDegrees: readonly number[]
): number {
  const knot = group.knots[knotIndex]!;
  if (Math.abs(knot.curvatureWeight) <= 1e-14) return 0;
  const distance = knot.at * adjustedLength;
  const lobeIndex = lobeAtDistance(group, adjustedLength, distance);
  if (lobeIndex < 0) return 0;
  let integral = 0;
  for (const segment of segments)
    if (segment.lobe === lobeIndex) integral += segment.rawWeight * segment.length;
  if (integral <= 1e-12) return 0;
  return Math.sign(anglesDegrees[lobeIndex]!) *
    Math.abs(knot.curvatureWeight) *
    Math.abs(anglesDegrees[lobeIndex]!) * DEGREES_TO_RADIANS / integral;
}

function integrateGroup(
  group: ResolvedShapeGroup,
  groupIndex: number,
  adjustment: AppliedGroupAdjustment | undefined,
  entryPose: TrackgenPose,
  globalS: number,
  pointStart: number,
  points: TrackgenPoint[]
): { pose: TrackgenPose; span: RealizedGroupSpan } {
  const adjustedLength = group.lengthMetres + (adjustment?.lengthDeltaMetres ?? 0);
  if (!Number.isFinite(adjustedLength) || adjustedLength <= 1)
    throw new Error(`Group ${group.id} resolved to an invalid adjusted length`);
  const anglesDegrees = adjustedLobeAngles(group, adjustment);
  const segments = integrationSegments(group, adjustedLength);
  const integrals = group.lobes.map((_, lobeIndex) => segments.reduce(
    (sum, segment) => segment.lobe === lobeIndex
      ? sum + segment.rawWeight * segment.length
      : sum,
    0
  ));
  for (const segment of segments) {
    if (segment.lobe < 0) continue;
    const angleRadians = anglesDegrees[segment.lobe]! * DEGREES_TO_RADIANS;
    segment.kappa = angleRadians * segment.rawWeight /
      Math.max(1e-12, integrals[segment.lobe]!);
  }

  let pose = { ...entryPose };
  const knotPoses = new Map<number, TrackgenPose>([[0, { ...pose }]]);
  for (const segment of segments) {
    pose = poseAfterConstantCurvature(pose, segment.kappa, segment.length);
    points.push({ x: pose.x, y: pose.y });
    for (let knotIndex = 1; knotIndex < group.knots.length; knotIndex++) {
      const knotDistance = group.knots[knotIndex]!.at * adjustedLength;
      if (Math.abs(segment.endS - knotDistance) <= 1e-7)
        knotPoses.set(knotIndex, { ...pose });
    }
  }
  const knots: RealizedShapeKnot[] = group.knots.map((_, knotIndex) => ({
    groupId: group.id,
    knotIndex,
    s: globalS + group.knots[knotIndex]!.at * adjustedLength,
    kappa: knotCurvature(group, adjustedLength, knotIndex, segments, anglesDegrees),
    pose: knotPoses.get(knotIndex) ?? { ...pose }
  }));
  const lobes: RealizedTurnLobe[] = group.lobes.map((lobe, index) => {
    const lobeSegments = segments.filter(segment => segment.lobe === index);
    const realizedRadians = lobeSegments.reduce(
      (sum, segment) => segment.lobe === index
        ? sum + segment.kappa * segment.length
        : sum,
      0
    );
    const lobeLength = lobeSegments.reduce((sum, segment) => sum + segment.length, 0);
    const targetRadians = anglesDegrees[index]! * DEGREES_TO_RADIANS;
    const maximumCurvature = Math.max(0, ...lobeSegments.map(segment =>
      Math.abs(segment.kappa)));
    return {
      firstKnot: lobe.firstKnot,
      lastKnot: lobe.lastKnot,
      targetAngleDegrees: anglesDegrees[index]!,
      realizedAngleDegrees: realizedRadians * RADIANS_TO_DEGREES,
      targetCharacteristicRadiusMetres: Math.abs(targetRadians) <= 1e-12
        ? Infinity
        : lobeLength / Math.abs(targetRadians),
      realizedCharacteristicRadiusMetres: Math.abs(realizedRadians) <= 1e-12
        ? Infinity
        : lobeLength / Math.abs(realizedRadians),
      realizedMinimumRadiusMetres: maximumCurvature <= 1e-12
        ? Infinity
        : 1 / maximumCurvature
    };
  });
  return {
    pose,
    span: {
      groupId: group.id,
      groupIndex,
      kind: group.kind,
      motif: group.motif,
      ...(group.role === undefined ? {} : { role: group.role }),
      pointStart,
      pointEnd: points.length - 1,
      sStart: globalS,
      sEnd: globalS + adjustedLength,
      targetLengthMetres: group.lengthMetres,
      realizedLengthMetres: adjustedLength,
      entryPose: { ...entryPose },
      exitPose: { ...pose },
      knots,
      lobes
    }
  };
}

export function integrateRhythmPlan(
  plan: RhythmPlanV2,
  adjustments: RouteAdjustments = new Map()
): IntegratedRhythmRoute {
  const startPose: TrackgenPose = { x: 0, y: 0, heading: 0 };
  let pose = { ...startPose };
  let distance = 0;
  const points: TrackgenPoint[] = [{ x: startPose.x, y: startPose.y }];
  const groups: RealizedGroupSpan[] = [];
  for (let index = 0; index < plan.groups.length; index++) {
    const group = plan.groups[index]!;
    const integrated = integrateGroup(
      group,
      index,
      adjustments.get(group.id),
      pose,
      distance,
      points.length - 1,
      points
    );
    pose = integrated.pose;
    distance = integrated.span.sEnd;
    groups.push(integrated.span);
  }
  return {
    points,
    startPose,
    endPose: {
      x: pose.x,
      y: pose.y,
      heading: normAng(pose.heading)
    },
    groups,
    totalLengthMetres: distance,
    plannedCornerClasses: classCounts(plan),
    linkedComplexes: plan.groups.filter(group => group.kind === 'complex').length
  };
}

export function routeResidual(route: IntegratedRhythmRoute): {
  xMetres: number;
  yMetres: number;
  positionMetres: number;
  headingRadians: number;
} {
  const xMetres = route.endPose.x - route.startPose.x;
  const yMetres = route.endPose.y - route.startPose.y;
  return {
    xMetres,
    yMetres,
    positionMetres: Math.hypot(xMetres, yMetres),
    headingRadians: normAng(route.endPose.heading - route.startPose.heading)
  };
}

/** The active v2 realizer is exported from closure.ts after bounded solving. */
export type V2RealizedTrackGeometry = RealizedTrackGeometry;
