export interface TrackPalette {
  grass: string;
  stripe: string;
  road: string;
  edge: string;
  shadow: string;
  tree: string;
  tree2: string;
  bush: string;
  rock: string;
  dust: string;
}

export interface TrackWidthKey {
  /** Cyclic distance fraction in [0, 1). */
  at: number;
  /** Full paved-road width in metres. */
  width: number;
}

export interface TrackPitHint {
  class: 'club' | 'grand';
}

export interface TrackMetadata {
  archetype: string;
  blurb: string;
  generated?: boolean;
  signature?: string;
  sourceSeed?: number;
}

export interface TrackDefinition {
  id: string;
  no: string;
  name: string;
  country: string;
  width: number;
  widthProfile?: readonly TrackWidthKey[];
  pit?: TrackPitHint;
  seed: number;
  meta: TrackMetadata;
  pal: TrackPalette;
  pts: readonly (readonly [number, number])[];
}

export interface CalendarEventDefinition {
  trk: number;
  name: string;
  rainP: number;
}

export interface TrackProfileAnchor {
  sFraction: number;
  lateral: number;
}

export interface TrackProfileMetrics {
  estimatedLapTime: number;
  verifiedLapTime: number;
  maximumTrackingError: number;
  offCourseSeconds: number;
  robustnessScore: number;
}

export interface TrackProfileProvenance {
  seed: number;
  budgetSeconds: number;
  evaluations: number;
  search: string;
}

export type CornerLineKind = 'inside' | 'outside';
export type CornerLineTerminal = 'ideal-rejoin' | 'sustained-offset';

export interface CornerLinePointProfile {
  /** Stable sampled-track index; guarded by the parent profile fingerprints. */
  index: number;
  /** Lateral displacement from the committed ideal line in metres. */
  eta: number;
}

export interface CornerAlternateLineProfile {
  kind: CornerLineKind;
  terminal: CornerLineTerminal;
  points: readonly CornerLinePointProfile[];
  brakeI: number;
  apexSpeed: number;
  cornerTimeSeconds: number;
  lapTimeLossSeconds: number;
}

export interface CornerLineFamilyProfile {
  idealRejoin: CornerAlternateLineProfile;
  sustainedOffset: CornerAlternateLineProfile;
}

export interface CornerLinePairProfile {
  cornerId: string;
  inside: CornerLineFamilyProfile;
  outside: CornerLineFamilyProfile;
}

export interface CornerLineProvenance {
  evaluations: number;
  search: string;
  controllerValidations?: number;
  backedOffLines?: number;
}

export interface TrackProfile {
  schemaVersion: 1;
  trackId: string;
  trackFingerprint: string;
  physicsFingerprint: string;
  surfaceFingerprint: string;
  optimizerVersion: string;
  status: 'normal' | 'acceptable';
  anchors: readonly TrackProfileAnchor[];
  metrics: TrackProfileMetrics;
  provenance: TrackProfileProvenance;
  /** Added by the offline corner-line optimizer after the ideal line is fixed. */
  cornerLineOptimizerVersion?: string;
  cornerLines?: readonly CornerLinePairProfile[];
  cornerLineProvenance?: CornerLineProvenance;
}

export type TrackProfileRuntimeStatus = 'matched' | 'missing-fallback' | 'stale-fallback';

export interface TrackProfileRuntimeState {
  status: TrackProfileRuntimeStatus;
  trackFingerprint: string;
  physicsFingerprint: string;
  surfaceFingerprint: string;
  warning?: string;
}

export type Exhaustive<T extends never> = T;
