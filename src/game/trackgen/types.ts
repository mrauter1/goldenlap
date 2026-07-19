import type { TrackPalette, TrackWidthKey } from '../../shared/types';

export type TrackArchetype = 'power' | 'balanced' | 'technical';
export type TrackCornerClass = 'hairpin' | 'slow' | 'medium' | 'fast' | 'kink';
export type TrackDirection = 'left' | 'right';
export type TrackComplexKind = 's' | 'chicane' | 'double-apex' | 'sweeper-chain';
export type TrackWinding = 'clockwise' | 'counter-clockwise';
export type RhythmGroupKind = 'nominal-straight' | 'corner' | 'complex' | 'transition';
export type TrackMotifId =
  | 'true-straight'
  | 'shallow-bow'
  | 'shallow-s'
  | 'single-apex'
  | 'early-apex'
  | 'late-apex'
  | 'increasing-radius'
  | 'decreasing-radius'
  | 'double-apex'
  | 'long-sweeper'
  | 'sweeper-chain'
  | 's'
  | 'chicane'
  | 'custom-compound';

export type NumericRange = readonly [minimum: number, maximum: number];

export interface StraightRhythmToken {
  kind: 'straight';
  length: NumericRange;
  flex?: boolean;
}

export interface CornerRhythmToken {
  kind: 'corner';
  class: TrackCornerClass;
  direction: TrackDirection;
  angleDegrees: NumericRange;
}

export interface ComplexRhythmToken {
  kind: 'complex';
  complex: TrackComplexKind;
  direction: TrackDirection;
  length: NumericRange;
}

export type RhythmToken = StraightRhythmToken | CornerRhythmToken | ComplexRhythmToken;

export interface RhythmSignature {
  schemaVersion: 1;
  id: string;
  name: string;
  archetype: TrackArchetype;
  tokens: readonly RhythmToken[];
}

export interface ShapeKnotSpec {
  at: NumericRange;
  curvatureWeight: NumericRange;
}

export interface TurnLobeSpec {
  firstKnot: number;
  lastKnot: number;
  angleDegrees: NumericRange;
}

export interface ClosureLobeFlexSpec {
  lobe: number;
  angleDeltaDegrees: NumericRange;
}

export interface ClosureFlexSpec {
  lengthDeltaMetres?: NumericRange;
  lobes?: readonly ClosureLobeFlexSpec[];
  shallowBendBiasDelta?: NumericRange;
}

export interface RhythmGroupSpec {
  id: string;
  kind: RhythmGroupKind;
  motif: TrackMotifId;
  lengthMetres: NumericRange;
  knots?: readonly ShapeKnotSpec[];
  lobes: readonly TurnLobeSpec[];
  radiusClass?: TrackCornerClass;
  movable: boolean;
  role?: 'grid-pit' | 'landmark';
  flex?: ClosureFlexSpec;
}

export interface RhythmSignatureV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  archetype: TrackArchetype;
  winding: TrackWinding;
  groups: readonly RhythmGroupSpec[];
}

export type RhythmSignatureInput = RhythmSignature | RhythmSignatureV2;

export interface ResolvedStraightToken {
  kind: 'straight';
  length: number;
  flex: boolean;
}

export interface ResolvedCornerToken {
  kind: 'corner';
  class: TrackCornerClass;
  direction: TrackDirection;
  angleDegrees: number;
}

export interface ResolvedComplexToken {
  kind: 'complex';
  complex: TrackComplexKind;
  direction: TrackDirection;
  length: number;
}

export type ResolvedRhythmToken =
  | ResolvedStraightToken
  | ResolvedCornerToken
  | ResolvedComplexToken;

export interface RhythmPlan {
  seed: number;
  signatureId: string;
  archetype: TrackArchetype;
  tokens: readonly ResolvedRhythmToken[];
}

export interface ResolvedShapeKnot {
  at: number;
  s: number;
  curvatureWeight: number;
}

export interface ResolvedTurnLobe {
  firstKnot: number;
  lastKnot: number;
  angleDegrees: number;
}

export interface ResolvedClosureFlex {
  lengthDeltaMetres?: NumericRange;
  lobes: readonly ClosureLobeFlexSpec[];
  shallowBendBiasDelta?: NumericRange;
}

export interface ResolvedShapeGroup {
  id: string;
  kind: RhythmGroupKind;
  motif: TrackMotifId;
  lengthMetres: number;
  knots: readonly ResolvedShapeKnot[];
  lobes: readonly ResolvedTurnLobe[];
  radiusClass?: TrackCornerClass;
  movable: boolean;
  role?: 'grid-pit' | 'landmark';
  flex?: ResolvedClosureFlex;
}

export interface RhythmPlanV2 {
  schemaVersion: 2;
  seed: number;
  signatureId: string;
  archetype: TrackArchetype;
  winding: TrackWinding;
  groups: readonly ResolvedShapeGroup[];
}

export interface TrackgenArchetypePolicy {
  lengthMetres: NumericRange;
  averageSpeedKmh: NumericRange;
  targetLengthMetres: number;
  halfExtentMetres: number;
  upperHeightMetres: number;
  cornerAmplitudeScale: number;
}

export interface TrackgenPreset {
  signature: RhythmSignature;
  policy: TrackgenArchetypePolicy;
  palette: TrackPalette;
}

export interface TrackgenPresetV2 {
  signature: RhythmSignatureV2;
  policy: TrackgenArchetypePolicy;
  palette: TrackPalette;
}

export interface TrackgenPoint {
  readonly x: number;
  readonly y: number;
}

export type TrackgenWidthKey = TrackWidthKey;

export interface TrackgenPose {
  x: number;
  y: number;
  heading: number;
}

export interface RealizedShapeKnot {
  groupId: string;
  knotIndex: number;
  s: number;
  kappa: number;
  pose: TrackgenPose;
}

export interface RealizedTurnLobe {
  firstKnot: number;
  lastKnot: number;
  targetAngleDegrees: number;
  realizedAngleDegrees: number;
  targetCharacteristicRadiusMetres: number;
  realizedCharacteristicRadiusMetres: number;
  realizedMinimumRadiusMetres: number;
}

export interface RealizedGroupSpan {
  groupId: string;
  groupIndex: number;
  kind: RhythmGroupKind;
  motif: TrackMotifId;
  role?: 'grid-pit' | 'landmark';
  pointStart: number;
  pointEnd: number;
  sStart: number;
  sEnd: number;
  targetLengthMetres: number;
  realizedLengthMetres: number;
  entryPose: TrackgenPose;
  exitPose: TrackgenPose;
  knots: readonly RealizedShapeKnot[];
  lobes: readonly RealizedTurnLobe[];
}

export type ClosureVariableKind = 'length' | 'lobe-angle' | 'shallow-bend-bias';

export interface ClosureVariableDelta {
  groupId: string;
  kind: ClosureVariableKind;
  lobe?: number;
  minimum: number;
  maximum: number;
  initial: number;
  value: number;
  delta: number;
}

export interface ClosureResidual {
  xMetres: number;
  yMetres: number;
  positionMetres: number;
  headingRadians: number;
}

export interface ClosureSolveIteration {
  iteration: number;
  residual: ClosureResidual;
  damping: number;
  acceptedStepScale: number;
}

export interface ClosureSolveReport {
  converged: boolean;
  iterations: number;
  residualBefore: ClosureResidual;
  residualAfter: ClosureResidual;
  variables: readonly ClosureVariableDelta[];
  largestRelativeGroupDistortion: number;
  history: readonly ClosureSolveIteration[];
}

export interface RealizedTrackGeometry {
  points: readonly TrackgenPoint[];
  widthProfile: readonly TrackgenWidthKey[];
  startPose: TrackgenPose;
  endPose: TrackgenPose;
  groups: readonly RealizedGroupSpan[];
  closure: ClosureSolveReport;
  closureIterations: number;
  closureResidualBeforeMetres: number;
  plannedCornerClasses: Readonly<Record<TrackCornerClass, number>>;
  linkedComplexes: number;
}

export type TrackgenGateStatus = 'pass' | 'fail';

export interface TrackgenGateResult {
  id: string;
  status: TrackgenGateStatus;
  value: number;
  minimum?: number;
  maximum?: number;
  unit: string;
}

export interface TrackgenCornerHistogram {
  hairpin: number;
  slow: number;
  medium: number;
  fast: number;
  kink: number;
  left: number;
  right: number;
}

export interface TrackgenPlanFidelityMetrics {
  maximumLengthDistortionFraction: number;
  maximumLobeAngleErrorDegrees: number;
  lobeSignMismatchCount: number;
  apexCountMismatchCount: number;
  radiusClassMismatchCount: number;
  flexBoundViolationCount: number;
  maximumBoundaryCurvatureJump: number;
  eligibleShallowStraights: number;
  measurableShallowStraights: number;
  measurableShallowStraightFraction: number;
}

export interface TrackgenTopologySummary {
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

export interface Tier0Metrics {
  lengthMetres: number;
  averageSpeedKmh: number;
  estimatedLapSeconds: number;
  longestStraightSeconds: number;
  longestStraightMetres: number;
  closureErrorMetres: number;
  closureHeadingErrorRadians: number;
  maximumCurvatureRate: number;
  nonFiniteValueCount: number;
  duplicateSegmentCount: number;
  selfIntersectionCount: number;
  selfIntersectionMarginMetres: number;
  closestSeparationGroups: string;
  gridPitFitMetres: number;
  pitLossFraction: number;
  cornerHistogram: TrackgenCornerHistogram;
  linkedComplexes: number;
  planFidelity: TrackgenPlanFidelityMetrics;
  topology: TrackgenTopologySummary;
}

export interface Tier0Evaluation {
  accepted: boolean;
  metrics: Tier0Metrics;
  gates: readonly TrackgenGateResult[];
}

export interface TrackgenCandidate {
  schemaVersion: 2;
  seed: number;
  archetype: TrackArchetype;
  signatureId: string;
  plan: RhythmPlanV2;
  geometry: RealizedTrackGeometry;
  tier0: Tier0Evaluation;
}
