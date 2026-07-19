import type { RandomSource } from '../shared/rng';
import type {
  CornerAlternateLineProfile,
  CornerLineFamilyProfile,
  TrackDefinition,
  TrackProfile,
  TrackProfileRuntimeState
} from '../shared/types';
export type {
  CornerAlternateLineProfile, CornerLineFamilyProfile, CornerLineKind, CornerLinePairProfile,
  CornerLineProvenance, CornerLineTerminal,
  CornerLinePointProfile, TrackDefinition, TrackPalette, TrackProfile, TrackProfileAnchor,
  TrackProfileMetrics, TrackProfileProvenance, TrackProfileRuntimeState,
  TrackProfileRuntimeStatus, TrackWidthKey, TrackPitHint
} from '../shared/types';

export type NumericArray = Float64Array<ArrayBuffer> & { [index: number]: number };
export type IntegerArray = Int32Array<ArrayBuffer> & { [index: number]: number };
export type DenseArray<T> = Array<T> & { [index: number]: T };

export function numericArray(length: number): NumericArray {
  return new Float64Array(length) as NumericArray;
}

export function integerArray(length: number): IntegerArray {
  return new Int32Array(length) as IntegerArray;
}

export function denseArray<T>(): DenseArray<T> {
  return [] as DenseArray<T>;
}

export interface TrackCheckpoint { i: number; x: number; y: number }

export interface StartLine {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
}

export interface GridSlot { x: number; y: number; h: number; i: number }
export interface CurbSegment {
  p: DenseArray<number>;
  red: boolean;
  index: number;
  side: -1 | 1;
}

export interface TrackSurfaceMap {
  schemaVersion: 1;
  roadHalfWidth: number;
  curbInner: number;
  curbOuter: number;
  roadHalfWidthAt: NumericArray;
  curbInnerAt: NumericArray;
  curbOuterAt: NumericArray;
  curbNegative: Uint8Array;
  curbPositive: Uint8Array;
  normalMinimum: NumericArray;
  normalMaximum: NumericArray;
  fingerprint: string;
}

export interface SurfaceExposure {
  road: number;
  curb: number;
  grass: number;
  mu: number;
  drag: number;
  zone: 'road' | 'curb' | 'grass';
}

export type DecorationType = 'tree' | 'bush' | 'rock' | 'bale';
export interface Decoration {
  type: DecorationType;
  x: number;
  y: number;
  r: number;
  solid: boolean;
  rot: number;
  vr: number;
}

export interface PitPoint { x: number; y: number; h: number }
export interface PitGeometry {
  Lp: number;
  rampIn: number;
  rampOut: number;
  laneOff: number;
  boxOff: number;
  limit: number;
  sEntry: number;
  sExit: number;
  off: (w: number) => number;
  wOf: (s: number) => number;
  inLane: (s: number) => boolean;
  boxWAt: (teamIndex: number) => number;
  posAt: (w: number, offset: number) => PitPoint & { i: number };
}

export interface Corner {
  id: string;
  regionStartI: number;
  regionEndI: number;
  approachI: number;
  brakeI: number;
  turnInI: number;
  apexI: number;
  trackOutI: number;
  exitI: number;
  vApex: number;
  passScore: number;
  side: -1 | 1;
  severity: number;
  complexId: string | null;
  isolated: boolean;
  entryTarget: number;
  apexTarget: number;
  exitTarget: number;
  legacyCandidateIndices: DenseArray<number>;
  planRole: 'isolated' | 'complex-primary' | 'complex-secondary';
  compromised: boolean;
  reason: string;
  alternateLines?: {
    inside: CornerLineFamilyProfile;
    outside: CornerLineFamilyProfile;
  };
}

export type LegacyCorner = Corner;

export type PathMode =
  | 'ideal'
  | 'attack'
  | 'defend'
  | 'side-inside'
  | 'side-outside'
  | 'obstacle-avoid'
  | 'tuck'
  | 'pit';

export interface SampledPath {
  mode: PathMode;
  off: NumericArray;
  k: NumericArray;
  ds: NumericArray;
  v: NumericArray;
  cornerId?: string;
  complexId?: string | null;
}

/** Fixed local path span filled by the 30 Hz racecraft lane evaluator. */
export interface LaneSampleBuffer {
  startIndex: number;
  count: number;
  /** Allocation-free empty-program authority; null while samples are deformed. */
  uniformBias: number | null;
  off: NumericArray;
  k: NumericArray;
  ds: NumericArray;
  v: NumericArray;
  mu: NumericArray;
  drag: NumericArray;
}

export interface PathGeometry {
  x: NumericArray;
  y: NumericArray;
  tx: NumericArray;
  ty: NumericArray;
}

export interface PathTiming {
  t: NumericArray;
  lapTime: number;
}

export interface SpeedProfile {
  v: NumericArray;
  t: NumericArray;
  lapTime: number;
  step: number;
  ds: NumericArray | null;
}

export interface Track {
  def: TrackDefinition;
  n: number;
  step: number;
  x: NumericArray;
  y: NumericArray;
  tx: NumericArray;
  ty: NumericArray;
  nx: NumericArray;
  ny: NumericArray;
  k: NumericArray;
  kSm: NumericArray;
  len: number;
  hw: number;
  halfWidth: NumericArray;
  cell: number;
  hash: Map<string, DenseArray<number>>;
  cps: DenseArray<TrackCheckpoint>;
  cpR: number;
  line: StartLine;
  grid: GridSlot;
  curbs: DenseArray<CurbSegment>;
  surface: TrackSurfaceMap;
  minR: number;
  pit: PitGeometry;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  decor: DenseArray<Decoration>;
  idealPath?: SampledPath;
  idealTiming?: PathTiming;
  corners?: DenseArray<LegacyCorner>;
  cornerNext?: IntegerArray;
  /** Derived 0..1 lift-to-full-braking threat at each track sample. */
  brakingThreat?: NumericArray;
  trackProfile?: TrackProfile;
  trackProfileState?: TrackProfileRuntimeState;
}

export interface NearestSample { i: number; d2: number }

export interface Car {
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
  r: number;
  steer: number;
  rev: boolean;
  revT: number;
  progIdx: number;
  s: number;
  offCourse: boolean;
  slipF: number;
  slipR: number;
  spd: number;
  driveSat: number;
}

export interface SurfaceState {
  zone?: 'road' | 'curb' | 'grass';
  mu: number;
  drag: number;
  lat?: number;
}

export interface CarInput {
  steer: number;
  throttle: number;
  brake: number;
  hand: boolean;
}

export interface CarModifiers {
  pw: number;
  mu: number;
  dr: number;
  /** Fraction of nominal aerodynamic load retained by the car. */
  df: number;
}

/** A moving longitudinal constraint consumed by the anticipatory controller. */
export interface TrafficSlowPoint {
  /** Braking room to the published station after physical body clearance. */
  distance: number;
  /** Published speed at that station. */
  speed: number;
}

export interface BotParameters {
  margin?: number;
  muScale?: number;
  downforceScale?: number;
  brakingEffort?: number;
  powerScale?: number;
  controlStepSeconds?: number;
  lat?: number;
  vCap?: number;
  path?: SampledPath;
  lane?: LaneSampleBuffer;
  pathTuning?: PathFollowerTuning;
}

export interface PathFollowerTuning {
  lookaheadBase: number;
  lookaheadSpeed: number;
  lookaheadMinimum: number;
  lookaheadMaximum: number;
  pursuitGain: number;
  feedForwardGain: number;
  crossTrackGain: number;
  lateralVelocityGain: number;
  crossTrackBase: number;
  crossTrackSpeedSquared: number;
}

export interface LapTracker {
  started: boolean;
  nextCp: number;
  missed: boolean;
  resetUsed: boolean;
  num: number;
}

export type LapEvent = { type: 'start' } | { type: 'lap'; valid: boolean };
export interface CollisionImpact { i: number; j: number; imp: number }

export interface BuiltTrack {
  def: TrackDefinition;
  tr: Track & {
    idealPath: SampledPath;
    idealTiming: PathTiming;
    corners: DenseArray<LegacyCorner>;
    cornerNext: IntegerArray;
    brakingThreat: NumericArray;
  };
  prof: SpeedProfile;
}

export interface TrackBuildContext { rng: RandomSource }
