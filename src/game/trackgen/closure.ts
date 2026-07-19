import { normAng } from '../../shared/math';
import {
  integrateRhythmPlan,
  routeResidual,
  type AppliedGroupAdjustment,
  type IntegratedRhythmRoute,
  type RouteAdjustments
} from './curvature';
import type {
  ClosureResidual,
  ClosureSolveIteration,
  ClosureSolveReport,
  ClosureVariableDelta,
  ClosureVariableKind,
  RealizedTrackGeometry,
  RhythmPlanV2,
  TrackgenWidthKey
} from './types';

const MAXIMUM_CLOSURE_ITERATIONS = 28;
const POSITION_TOLERANCE_METRES = 5e-8;
const HEADING_TOLERANCE_RADIANS = 1e-9;
const COARSE_JACOBIAN_STEP = 1e-4;
const FINE_JACOBIAN_STEP = 1e-4;

interface ClosureVariable {
  groupId: string;
  kind: ClosureVariableKind;
  lobe?: number;
  minimum: number;
  maximum: number;
  initial: number;
}

interface ClosureState {
  route: IntegratedRhythmRoute;
  residual: ClosureResidual;
  vector: readonly [number, number, number];
  score: number;
}

function canonical(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function closureVariables(plan: RhythmPlanV2): ClosureVariable[] {
  const result: ClosureVariable[] = [];
  for (const group of plan.groups) {
    const flex = group.flex;
    if (!flex) continue;
    if (flex.lengthDeltaMetres) result.push({
      groupId: group.id,
      kind: 'length',
      minimum: flex.lengthDeltaMetres[0],
      maximum: flex.lengthDeltaMetres[1],
      initial: 0
    });
    for (const lobe of flex.lobes) result.push({
      groupId: group.id,
      kind: 'lobe-angle',
      lobe: lobe.lobe,
      minimum: lobe.angleDeltaDegrees[0],
      maximum: lobe.angleDeltaDegrees[1],
      initial: 0
    });
    if (flex.shallowBendBiasDelta) result.push({
      groupId: group.id,
      kind: 'shallow-bend-bias',
      minimum: flex.shallowBendBiasDelta[0],
      maximum: flex.shallowBendBiasDelta[1],
      initial: 0
    });
  }
  return result;
}

function valueFromUnit(variable: ClosureVariable, unit: number): number {
  return variable.minimum + (variable.maximum - variable.minimum) * unit;
}

function initialUnit(variable: ClosureVariable): number {
  return (variable.initial - variable.minimum) /
    Math.max(1e-12, variable.maximum - variable.minimum);
}

function adjustmentsFor(
  variables: readonly ClosureVariable[],
  units: readonly number[]
): RouteAdjustments {
  const mutable = new Map<string, {
    lengthDeltaMetres: number;
    lobeAngleDeltaDegrees: number[];
    shallowBendBias: number;
  }>();
  variables.forEach((variable, index) => {
    let adjustment = mutable.get(variable.groupId);
    if (!adjustment) {
      adjustment = {
        lengthDeltaMetres: 0,
        lobeAngleDeltaDegrees: [],
        shallowBendBias: 0
      };
      mutable.set(variable.groupId, adjustment);
    }
    const value = valueFromUnit(variable, units[index]!);
    if (variable.kind === 'length') adjustment.lengthDeltaMetres = value;
    else if (variable.kind === 'shallow-bend-bias') adjustment.shallowBendBias = value;
    else adjustment.lobeAngleDeltaDegrees[variable.lobe!] = value;
  });
  return mutable as ReadonlyMap<string, AppliedGroupAdjustment>;
}

function evaluateState(
  plan: RhythmPlanV2,
  variables: readonly ClosureVariable[],
  units: readonly number[],
  positionScale: number
): ClosureState {
  const route = integrateRhythmPlan(plan, adjustmentsFor(variables, units));
  const residual = routeResidual(route);
  const vector = [
    residual.xMetres / positionScale,
    residual.yMetres / positionScale,
    residual.headingRadians * 100
  ] as const;
  return {
    route,
    residual,
    vector,
    score: Math.hypot(...vector)
  };
}

function solveThreeByThree(
  source: readonly (readonly number[])[],
  rhs: readonly number[]
): readonly [number, number, number] | null {
  const matrix = source.map((row, index) => [
    row[0]!, row[1]!, row[2]!, rhs[index]!
  ]);
  for (let pivot = 0; pivot < 3; pivot++) {
    let selected = pivot;
    for (let row = pivot + 1; row < 3; row++)
      if (Math.abs(matrix[row]![pivot]!) > Math.abs(matrix[selected]![pivot]!))
        selected = row;
    if (Math.abs(matrix[selected]![pivot]!) <= 1e-14) return null;
    [matrix[pivot], matrix[selected]] = [matrix[selected]!, matrix[pivot]!];
    const divisor = matrix[pivot]![pivot]!;
    for (let column = pivot; column < 4; column++)
      matrix[pivot]![column] = matrix[pivot]![column]! / divisor;
    for (let row = 0; row < 3; row++) {
      if (row === pivot) continue;
      const factor = matrix[row]![pivot]!;
      for (let column = pivot; column < 4; column++)
        matrix[row]![column] = matrix[row]![column]! -
          factor * matrix[pivot]![column]!;
    }
  }
  return [matrix[0]![3]!, matrix[1]![3]!, matrix[2]![3]!];
}

function jacobian(
  plan: RhythmPlanV2,
  variables: readonly ClosureVariable[],
  units: readonly number[],
  positionScale: number,
  step: number
): number[][] {
  const result = Array.from({ length: 3 }, () => new Array<number>(variables.length).fill(0));
  for (let column = 0; column < variables.length; column++) {
    const below = Math.max(0, units[column]! - step);
    const above = Math.min(1, units[column]! + step);
    if (above - below <= 1e-12) continue;
    const lowerUnits = [...units];
    const upperUnits = [...units];
    lowerUnits[column] = below;
    upperUnits[column] = above;
    const lower = evaluateState(plan, variables, lowerUnits, positionScale);
    const upper = evaluateState(plan, variables, upperUnits, positionScale);
    for (let row = 0; row < 3; row++)
      result[row]![column] = (upper.vector[row]! - lower.vector[row]!) / (above - below);
  }
  return result;
}

function dampedStep(
  jacobianMatrix: readonly (readonly number[])[],
  residual: readonly number[],
  damping: number
): number[] | null {
  const normal = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) => {
      let value = row === column ? damping : 0;
      for (let index = 0; index < jacobianMatrix[row]!.length; index++)
        value += jacobianMatrix[row]![index]! * jacobianMatrix[column]![index]!;
      return value;
    })
  );
  const solved = solveThreeByThree(normal, residual);
  if (!solved) return null;
  const result = new Array<number>(jacobianMatrix[0]!.length).fill(0);
  for (let column = 0; column < result.length; column++) {
    for (let row = 0; row < 3; row++)
      result[column] = result[column]! -
        jacobianMatrix[row]![column]! * solved[row]!;
  }
  const maximum = Math.max(0, ...result.map(value => Math.abs(value)));
  if (maximum > 0.35)
    for (let index = 0; index < result.length; index++)
      result[index] = result[index]! * 0.35 / maximum;
  return result.every(Number.isFinite) ? result : null;
}

function positionNewtonStep(
  jacobianMatrix: readonly (readonly number[])[],
  residual: readonly number[],
  variables: readonly ClosureVariable[]
): number[] | null {
  const lengthColumns = variables.flatMap((variable, index) =>
    variable.kind === 'length' ? [index] : []
  );
  let selected: readonly [number, number] | null = null;
  let bestDeterminant = 0;
  for (let left = 0; left < lengthColumns.length - 1; left++) {
    for (let right = left + 1; right < lengthColumns.length; right++) {
      const first = lengthColumns[left]!;
      const second = lengthColumns[right]!;
      const determinant = jacobianMatrix[0]![first]! * jacobianMatrix[1]![second]! -
        jacobianMatrix[0]![second]! * jacobianMatrix[1]![first]!;
      if (Math.abs(determinant) <= Math.abs(bestDeterminant)) continue;
      bestDeterminant = determinant;
      selected = [first, second];
    }
  }
  if (!selected || Math.abs(bestDeterminant) <= 1e-12) return null;
  const [first, second] = selected;
  const a = jacobianMatrix[0]![first]!;
  const b = jacobianMatrix[0]![second]!;
  const c = jacobianMatrix[1]![first]!;
  const d = jacobianMatrix[1]![second]!;
  const result = new Array<number>(variables.length).fill(0);
  result[first] = (-residual[0]! * d + b * residual[1]!) / bestDeterminant;
  result[second] = (-a * residual[1]! + residual[0]! * c) / bestDeterminant;
  const maximum = Math.max(Math.abs(result[first]!), Math.abs(result[second]!));
  if (maximum > 0.1) {
    result[first] = result[first]! * 0.1 / maximum;
    result[second] = result[second]! * 0.1 / maximum;
  }
  return result.every(Number.isFinite) ? result : null;
}

function converged(residual: ClosureResidual): boolean {
  return residual.positionMetres <= POSITION_TOLERANCE_METRES &&
    Math.abs(residual.headingRadians) <= HEADING_TOLERANCE_RADIANS;
}

function closureReport(
  plan: RhythmPlanV2,
  variables: readonly ClosureVariable[],
  units: readonly number[],
  before: ClosureResidual,
  state: ClosureState,
  history: readonly ClosureSolveIteration[]
): ClosureSolveReport {
  const deltas: ClosureVariableDelta[] = variables.map((variable, index) => {
    const value = valueFromUnit(variable, units[index]!);
    return {
      groupId: variable.groupId,
      kind: variable.kind,
      ...(variable.lobe === undefined ? {} : { lobe: variable.lobe }),
      minimum: variable.minimum,
      maximum: variable.maximum,
      initial: variable.initial,
      value,
      delta: value - variable.initial
    };
  });
  let largestRelativeGroupDistortion = 0;
  for (const delta of deltas) {
    const group = plan.groups.find(item => item.id === delta.groupId)!;
    const denominator = delta.kind === 'length'
      ? group.lengthMetres
      : delta.kind === 'lobe-angle'
        ? Math.max(1, Math.abs(group.lobes[delta.lobe!]?.angleDegrees ?? 1))
        : 1;
    largestRelativeGroupDistortion = Math.max(
      largestRelativeGroupDistortion,
      Math.abs(delta.delta) / denominator
    );
  }
  return {
    converged: converged(state.residual),
    iterations: history.length,
    residualBefore: before,
    residualAfter: state.residual,
    variables: deltas,
    largestRelativeGroupDistortion,
    history
  };
}

export function solveRhythmClosure(plan: RhythmPlanV2): {
  route: IntegratedRhythmRoute;
  report: ClosureSolveReport;
} {
  const variables = closureVariables(plan);
  const units = variables.map(initialUnit);
  const positionScale = 1;
  let state = evaluateState(plan, variables, units, positionScale);
  const before = state.residual;
  const history: ClosureSolveIteration[] = [];
  let damping = 1e-6;
  let wasFine = false;
  for (let iteration = 0;
    iteration < MAXIMUM_CLOSURE_ITERATIONS && !converged(state.residual);
    iteration++
  ) {
    const fine = state.score < 1e-3;
    if (fine && !wasFine) damping = Math.min(damping, 1e-8);
    wasFine = fine;
    const matrix = jacobian(
      plan,
      variables,
      units,
      positionScale,
      fine ? FINE_JACOBIAN_STEP : COARSE_JACOBIAN_STEP
    );
    const step = fine && Math.abs(state.residual.headingRadians) <= HEADING_TOLERANCE_RADIANS
      ? positionNewtonStep(matrix, state.vector, variables)
      : dampedStep(matrix, state.vector, damping);
    let acceptedScale = 0;
    if (step) {
      for (const scale of [1, 0.5, 0.25, 0.125, 0.0625]) {
        const proposed = units.map((value, index) =>
          Math.max(0, Math.min(1, value + step[index]! * scale))
        );
        const next = evaluateState(plan, variables, proposed, positionScale);
        if (next.score >= state.score - 1e-18) continue;
        for (let index = 0; index < units.length; index++) units[index] = proposed[index]!;
        state = next;
        acceptedScale = scale;
        break;
      }
    }
    damping = acceptedScale > 0
      ? Math.max(1e-10, damping * 0.35)
      : Math.min(1e6, damping * 10);
    history.push({
      iteration: iteration + 1,
      residual: state.residual,
      damping,
      acceptedStepScale: acceptedScale
    });
    if (acceptedScale === 0 && damping >= 1e5) break;
  }
  return {
    route: state.route,
    report: closureReport(plan, variables, units, before, state, history)
  };
}

function widthProfile(route: IntegratedRhythmRoute, plan: RhythmPlanV2): readonly TrackgenWidthKey[] {
  const base = 11.2 + ((plan.seed ^ 0x6C8E9CF5) >>> 0) % 801 / 1_000;
  const pit = route.groups.find(group =>
    plan.groups[group.groupIndex]?.role === 'grid-pit'
  );
  const pitExit = Math.max(0.08, Math.min(0.28,
    (pit?.sEnd ?? route.totalLengthMetres * 0.12) / route.totalLengthMetres
  ));
  const pitEntry = Math.max(0.72, 1 - pitExit * 0.55);
  return [
    { at: 0, width: 15 },
    { at: pitExit * 0.72, width: 15 },
    { at: pitExit, width: base },
    { at: Math.max(pitExit + 0.04, 0.43), width: base + 0.7 },
    { at: Math.max(pitExit + 0.08, 0.57), width: base + 0.4 },
    { at: pitEntry, width: base },
    { at: Math.min(0.94, pitEntry + (1 - pitEntry) * 0.45), width: 15 }
  ];
}

export function realizeRhythmPlanV2(plan: RhythmPlanV2): RealizedTrackGeometry {
  const solved = solveRhythmClosure(plan);
  const points = solved.route.points.slice(0, -1).map(point => ({
    x: canonical(point.x),
    y: canonical(point.y)
  }));
  return {
    points,
    widthProfile: widthProfile(solved.route, plan),
    startPose: {
      x: canonical(solved.route.startPose.x),
      y: canonical(solved.route.startPose.y),
      heading: canonical(solved.route.startPose.heading)
    },
    endPose: {
      x: canonical(solved.route.endPose.x),
      y: canonical(solved.route.endPose.y),
      heading: canonical(normAng(solved.route.endPose.heading))
    },
    groups: solved.route.groups,
    closure: solved.report,
    closureIterations: solved.report.iterations,
    closureResidualBeforeMetres: solved.report.residualBefore.positionMetres,
    plannedCornerClasses: solved.route.plannedCornerClasses,
    linkedComplexes: solved.route.linkedComplexes
  };
}

export const TRACKGEN_CLOSURE_POSITION_TOLERANCE_METRES = POSITION_TOLERANCE_METRES;
export const TRACKGEN_CLOSURE_HEADING_TOLERANCE_RADIANS = HEADING_TOLERANCE_RADIANS;
