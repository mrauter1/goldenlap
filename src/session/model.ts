import type {
  Car, CarInput, CornerLineKind, CornerLineTerminal, LaneSampleBuffer, LapTracker, LegacyCorner,
  PathMode, SampledPath, SpeedProfile, Track, TrafficSlowPoint
} from '../core/model';

export type EntryState = 'none' | 'box' | 'grid' | 'run' | 'pitIn' | 'pit' | 'pitOut' | 'fin' | 'dnf';
export type SessionMode = 'quali' | 'race';
export type SessionPhase = 'count' | 'run' | 'end';
export type QualifyingLapPhase = 'out' | 'flying' | 'in';
export type PitPhase =
  | 'travel'
  | 'decelerate'
  | 'ingress'
  | 'stopped-box'
  | 'queued'
  | 'egress'
  | 'merge';
export type PitReservationKind = 'ingress' | 'egress';
export type PitWaitReason =
  | 'travel-lane'
  | 'lane-conflict'
  | 'physical-crossing'
  | 'box-occupied'
  | 'same-team-queue'
  | 'ingress-reservation'
  | 'egress-reservation';
export type TyreCompound = 'S' | 'H' | 'W';
export type PaceMode = 0 | 1 | 2;
export type PartKey = 'e' | 'h' | 'c';
export type MessageKind = 'info' | 'bad' | 'gold' | '';
export type SessionAudioWave = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface TeamRef {
  id: string;
  name: string;
  body: string;
  accent: string;
}

export interface LineupEntry {
  team: TeamRef;
  name: string;
  code: string;
  isPlayer: boolean;
  ci: number;
  margin: number;
  focus: number;
  trait: string;
  pw?: number;
  dr?: number;
  hMu?: number;
}

export interface EntryModifiers { pw: number; dr: number; hMu: number }
export interface EntryStyle { body: string; accent: string; wing: string; helmet: string }
export interface TyreState { c: TyreCompound; wear: number; fit: number }
export interface PartValues { e: number; h: number; c: number }
export interface PitArm { comp: TyreCompound; fix: boolean }
export interface QualifyingRunPlan { at: number; hot: number }

export interface LanePoint { s: number; eta: number }
export interface LaneProgram {
  points: LanePoint[];
  reason: string;
  /** Live authority identity; null only for the zero-state racing line. */
  binding: string | null;
  bias: number;
  /** Emergency is carried only by a priced collision-avoidance program. */
  surfaceAuthorization?: SurfaceAuthorization;
}

export interface EntryTrafficSlowPoint extends TrafficSlowPoint {
  ownerCode: string;
  reason: string;
  /** Absolute track position of the compact longitudinal constraint. */
  stationS: number;
  /** Publication time, used only to account for one-epoch staleness. */
  publishedAt: number;
}

/**
 * The selected candidate's complete spatial speed authority. Progress is
 * unwrapped, so the program remains ordered across the start/finish line.
 */
export interface RacecraftLongitudinalProgram {
  progress: number[];
  speed: number[];
  /** Candidate-selected braking utilization used to author this speed law. */
  brakingEffort: number;
  slowPointOwnerCode: string | null;
  /** Diagnostic provenance only; the full arrays are the authority. */
  bindingSlowPoint: EntryTrafficSlowPoint | null;
}

export interface PathPlanAnchor {
  index: number;
  offset: number;
  /** Native lane-program value; absent only for legacy absolute-offset edits. */
  eta?: number | null;
  /** Authored d(eta)/ds at this knot, when continuity survives reauthoring. */
  etaFirstDerivative?: number | null;
  /** Authored d2(eta)/ds2 at this knot, when continuity survives reauthoring. */
  etaSecondDerivative?: number | null;
  /** Exact unwrapped progress for native tow anchors; avoids index quantization. */
  s?: number | null;
}
export type ManeuverTopology = 'hold' | 'left' | 'right' | 'brake';
export type SurfaceAuthorization = 'normal' | 'emergency';
export type EmergencyAuthorizationReason = 'collision-avoidance';
export type DynamicPathMode = Exclude<PathMode, 'ideal' | 'pit'>;
export type PathPlan =
  | { mode: 'ideal'; key: 'ideal' }
  | { mode: 'pit'; key: string; anchors: PathPlanAnchor[] }
  | {
      mode: DynamicPathMode;
      key: string;
      anchors: PathPlanAnchor[];
      /** First anchor is the measured car position, not a future command. */
      pinnedFirst?: boolean;
      cornerId?: string;
      complexId?: string | null;
      terminal?: 'ideal-rejoin';
      topology?: ManeuverTopology;
      surfaceAuthorization?: SurfaceAuthorization;
      obstacleCode?: string;
      emergencyReason?: EmergencyAuthorizationReason;
      /** Attack-line provenance and the physical no-departure boundary. */
      lineKind?: CornerLineKind;
      /** Offline grid member selected inside the same tactical slot. */
      lineTerminal?: CornerLineTerminal;
      /** Analytic member of the ideal-to-alternate corner-line family. */
      lineBlend?: number | null;
      launchProgress?: number;
      brakeIndex?: number;
      leaderCode?: string | null;
    };

export type ManeuverConstraint =
  | 'non-finite'
  | 'road-bound'
  | 'controller-demand'
  | 'predicted-hard-contact'
  | 'protected-corridor'
  | 'pit-reservation'
  | 'surface-authorization'
  | 'rejoin-occupied';

export interface ManeuverCandidateDiagnostic {
  id: string;
  mode: PathMode;
  topology: ManeuverTopology | null;
  surfaceAuthorization: SurfaceAuthorization | null;
  feasible: boolean;
  rejections: ManeuverConstraint[];
  conflictingReservation: string | null;
  controllerDemand: number;
  roadExposure: number;
  curbExposure: number;
  grassExposure: number;
}

export type RacecraftCandidateKind =
  | 'hold'
  | 'ideal'
  | 'recenter'
  | 'corner-inside'
  | 'corner-outside'
  | 'brake-behind';
export type RacecraftDirection = 'left' | 'hold' | 'right';
export type RacecraftSpeedClass = 'free' | 'brake';

export interface RacecraftCandidateSeed {
  kind: RacecraftCandidateKind;
  plan: PathPlan;
  /** The one optional rival-derived terminal constraint. */
  slowPointOwnerCode: string | null;
}

export interface RacecraftCandidateEvaluation {
  kind: RacecraftCandidateKind;
  plan: PathPlan;
  /** Interned runtime identity; strings remain diagnostic labels only. */
  planNumericId: number;
  familyNumericId: number;
  feasible: boolean;
  vetoes: string[];
  targetLateral: number;
  slowPointOwnerCode: string | null;
  /** Binding station already selected by the candidate's backward sweep. */
  slowPoint: EntryTrafficSlowPoint | null;
  interactionCause: RacecraftInteractionCause;
  /** Exact objective decomposition, all in seconds. */
  ownTimeSeconds: number;
  billSeconds: number;
  recourseSeconds: number;
  proximitySeconds: number;
  positionValueSeconds: number;
  attemptLossSeconds: number;
  battleSpendSeconds: number;
  effortRiskSeconds: number;
  /** True when the authored side family reverses centre order by its rejoin. */
  positionGain: boolean;
  /** Minimum signed four-circle body clearance over screened rival sweeps. */
  minimumPlannedClearanceMetres: number | null;
  tieBandSeconds: number;
  hazardCount: number;
  switchChanged: boolean;
  /** Candidate-selected braking utilization; side/attack families use capability. */
  brakingEffort: number;
  gripUtilization: number;
  direction: RacecraftDirection;
  speedClass: RacecraftSpeedClass;
  cost: number;
}

export type RacecraftDecisionCertificateBreakReason =
  | 'bootstrap'
  | 'neighbor-set'
  | 'claim-revision'
  | 'authority'
  | 'expiry';
export type RacecraftClaimRevisionReason =
  | 'prediction-source'
  | 'prediction-family'
  | 'point-divergence';

/**
 * Proof that the standing argmin remains usable until one exact input changes.
 * The selected-family identity is semantic: it excludes path object identity,
 * current progress, sampled indices, and the measured acquisition anchor.
 */
export interface RacecraftDecisionCertificate {
  selectedFamilyNumericId: number | null;
  /** Diagnostic label for the interned identity above. */
  selectedFamilyId: string | null;
  neighborCodes: string[];
  claimRevisions: Record<string, number>;
  authorityKey: string;
  validUntil: number;
  zeroHazardIdeal: boolean;
}

export interface RacecraftDecisionEconomics {
  rivalCode: string;
  role: 'attack' | 'defense';
  opportunityPresent: boolean;
  paceDifferentialSecondsPerLap: number;
  reopportunitySeconds: number;
  positionValueSeconds: number;
}

export interface RacecraftDecision {
  at: number;
  selectedKind: RacecraftCandidateKind | null;
  selectedPlanNumericId: number | null;
  selectedPlanKey: string | null;
  candidateCount: number;
  targetLateral: number;
  interactionCause: RacecraftInteractionCause | null;
  chosenUtilization: number;
  selectedLongitudinalProgram: RacecraftLongitudinalProgram | null;
  economics: RacecraftDecisionEconomics[];
  certificate: RacecraftDecisionCertificate;
  candidates: RacecraftCandidateEvaluation[];
}

/** Bounded work counters for Tier-1 micro-attribution. */
export interface RacecraftEvaluatorWorkDiagnostics {
  decisionCalls: number;
  candidateFamilyBuilds: number;
  candidateSeedsBuilt: number;
  seedEvaluations: number;
  speedLawSamples: number;
  terminalContinuationCalls: number;
  terminalContinuationSteps: number;
  hazardsBuilt: number;
  boundScreenCalls: number;
  boundScreenClears: number;
  boundScreenHits: number;
  viabilityCalls: number;
  viabilityHazards: number;
  deterministicSweeps: number;
  arrivalFamilyBuilds: number;
  arrivalFamilyCacheHits: number;
  tieBandHazardEvaluations: number;
  rivalStateBuilds: number;
  rivalStateCacheHits: number;
  rivalSweepBuilds: number;
  rivalSweepCacheHits: number;
  rivalContinuationBuilds: number;
  rivalContinuationCacheHits: number;
}

export interface RacecraftClaimStations {
  length: number;
  time: Float64Array;
  s: Float64Array;
  y: Float64Array;
  v: Float64Array;
  /** Predicted body orientation relative to the local track tangent. */
  heading: Float64Array;
}

export type RacecraftPredictionSource =
  | 'published'
  | 'rederived'
  | 'ballistic';

export interface RacecraftTrackingErrorScale {
  /** Measured lateral scale used for publication detection and β. */
  lateralThresholdMetres: number;
  /** Measured longitudinal scale used only for publication detection. */
  longitudinalThresholdMetres: number;
}

export interface RacecraftPublicationDetectionState {
  /** Actual installed authority generations, never decision epochs. */
  lateralAuthorityRevision: number;
  longitudinalAuthorityRevision: number;
  /** Detection scale frozen for this authority generation. */
  scale: RacecraftTrackingErrorScale;
  /** A contradicted publication cannot become true again in this generation. */
  rejected: boolean;
}

export interface RacecraftClaim {
  code: string;
  source: RacecraftPredictionSource;
  /** Stable selected-program identity for one publication epoch. */
  predictionKey: string;
  /** Exact installed lateral authority; -1 for a derived/ballistic source. */
  lateralAuthorityRevision: number;
  /** Exact installed speed authority; -1 for a derived/ballistic source. */
  longitudinalAuthorityRevision: number;
  /**
   * Advances only when re-publication diverges detectably from the
   * predecessor's aged point trajectory.
   */
  publicationRevision: number;
  publishedAt: number;
  originS: number;
  originCentre: number;
  originSpeed: number;
  /** Measured body orientation relative to the local track tangent. */
  originHeadingOffsetRadians: number;
  trusted: boolean;
  /** ε: measured tracking error, legal only for detection and β. */
  lateralTrackingErrorThresholdMetres: number;
  longitudinalTrackingErrorThresholdMetres: number;
  trackingErrorMetres: number;
  stations: RacecraftClaimStations;
}

export interface RacecraftSideAgreement {
  /** Side occupied by the lexicographically first code in the pair key. */
  side: -1 | 1;
  /** Acquired separator in ideal-line-relative lateral coordinates. */
  separatorEta: number;
  /** Required centre separation from sporting body geometry. */
  centreClearance: number;
  /** Proven normal-surface family authority for the active track context. */
  familyCertificate: RacecraftSideAgreementFamilyCertificate;
  /** Acquisition time; release occurs when the physical bodies are clear. */
  since: number;
}

export interface RacecraftSideAgreementFamilyCertificate {
  contextKey: string;
  originS: number;
  spanMetres: number;
  lowerFamilyKey: string;
  upperFamilyKey: string;
}

export type RacecraftInteractionCause =
  | 'ordinary'
  | 'draft'
  | 'blue-flag'
  | 'qualifying'
  | 'damage';

export interface RacecraftDecisionLogCandidate {
  kind: RacecraftCandidateKind;
  planNumericId: number;
  familyNumericId: number;
  planKey: string;
  stableFamilyId: string;
  feasible: boolean;
  vetoes: string[];
  direction: RacecraftDirection;
  speedClass: RacecraftSpeedClass;
  ownTimeSeconds: number;
  billSeconds: number;
  recourseSeconds: number;
  proximitySeconds: number;
  positionValueSeconds: number;
  attemptLossSeconds: number;
  battleSpendSeconds: number;
  effortRiskSeconds: number;
  positionGain: boolean;
  minimumPlannedClearanceMetres: number | null;
  tieBandSeconds: number;
  hazardCount: number;
  switchChanged: boolean;
  cost: number;
}

export interface RacecraftDecisionLogEntry {
  at: number;
  code: string;
  laneProgramReason: string;
  laneProgramBinding: string | null;
  selectedKind: RacecraftCandidateKind | null;
  selectedPlanNumericId: number | null;
  selectedPlanKey: string | null;
  economics: RacecraftDecisionEconomics[];
  candidates: RacecraftDecisionLogCandidate[];
}

export interface UnexplainedStallRecord {
  code: string;
  at: number;
  duration: number;
  progress: number;
  speed: number;
  pathMode: PathMode;
}

export interface SideBySidePair {
  t0: number;
  contact: boolean;
  seen: number;
  a: string;
  b: string;
}

export interface SideBySideEpisode { t: number; contact: boolean; reason: string }
export interface AttackEpisode {
  key: string;
  attacker: string;
  target: string;
  startedAt: number;
  expiresAt: number;
  cornerId: string;
  /** Pair pace evidence frozen at initiation for outcome correlation only. */
  paceDifferentialSecondsPerLap: number | null;
}

export interface AttackPaceOutcomeMoments {
  samples: number;
  sumPace: number;
  sumOutcome: number;
  sumPaceSquared: number;
  sumOutcomeSquared: number;
  sumProduct: number;
}

export interface CornerPassCount { attempts: number; passes: number }
export interface StationGapDistribution {
  samples: number;
  sumMetres: number;
  squaredSumMetres: number;
  minimumMetres: number;
  maximumMetres: number;
}
export interface RacecraftCornerDecisionCount {
  inline: number;
  offset: number;
}
export interface LegacyRoomPair {
  seen?: number;
  cornerApex?: number;
  contactSeed?: boolean;
  room?: number;
}

export interface HitPairMetric {
  n: number;
  hard: number;
  side: number;
  room: number;
  max: number;
  sumImp: number;
  sumSep: number;
  sumDs: number;
  /** Duration of the current run of collision-producing physics steps. */
  continuousContactSeconds: number;
  /** Longest collision-producing run observed for this pair. */
  maximumContinuousContactSeconds: number;
  /** Session-local collision invocation that most recently produced contact. */
  lastContactStep: number;
  /** Number of disjoint contact runs for this pair. */
  contactEpisodes: number;
}

export interface HitSample {
  t: number;
  imp: number;
  a: string;
  b: string;
  stateA: EntryState;
  stateB: EntryState;
  pitWA: number;
  pitWB: number;
  dAB: number;
  ds: number;
  sep: number;
  spdA: number;
  spdB: number;
  latA: number;
  latB: number;
  tgtA: number;
  tgtB: number;
  dh: number;
  rA: number;
  rB: number;
  yawA: number;
  yawB: number;
  slipA: number;
  slipB: number;
  brakeA: number;
  brakeB: number;
  liftA: number;
  liftB: number;
  recA: number;
  recB: number;
  failA: boolean;
  failB: boolean;
  prevA: number;
  prevB: number;
  k: number;
  room: boolean;
  off: boolean;
  atk: boolean;
}

export interface Entry {
  lu: LineupEntry;
  name: string;
  code: string;
  isPlayer: boolean;
  ci: number;
  ti: number;
  mods: EntryModifiers;
  style: EntryStyle;
  car: Car | null;
  tyre: TyreState;
  fuel: number;
  stress: number;
  pace: PaceMode;
  rel: PartValues;
  wearAcc: PartValues;
  hFail: boolean;
  cFail: boolean;
  cross: number;
  prog: number;
  spd: number;
  latNow: number;
  lineT: number;
  lastLap: number;
  best: number;
  state: EntryState;
  pitArm: PitArm | null;
  boxArm: boolean;
  pitT: number;
  pitW: number | null;
  stops: number;
  lat: number;
  gridLat: number;
  trafficSlowPoint: EntryTrafficSlowPoint | null;
  racecraftLongitudinalProgram: RacecraftLongitudinalProgram | null;
  liftT: number;
  tow: number;
  dirtyT: number;
  pressureT: number;
  underPressure: boolean;
  brakingEffort: number;
  brakingPrudenceOffset: number;
  recT: number;
  avoidT: number;
  _avoidWith: string;
  _avoidSide: number;
  _alongsideWith: string;
  mistT: number;
  battle: boolean;
  _battleLapSeconds: number;
  _recentCleanLap: number;
  focusNow: number;
  flow: number[] | null;
  lineBiasByCorner: Record<string, number> | null;
  lapLive: boolean;
  lapPhase?: QualifyingLapPhase;
  hotLeft: number;
  plan: QualifyingRunPlan[] | null;
  synth: boolean;
  rlap: LapTracker;
  notes: string[];
  finPos: number;
  finT: number;
  finLaps: number;
  gridP: number;
  inp: CarInput;
  botTick: number;
  laneProgram: LaneProgram;
  laneBuffer?: LaneSampleBuffer;
  path?: SampledPath;
  pathMode?: 'ideal' | 'pit';
  pathPlan?: Extract<PathPlan, { mode: 'pit' }>;
  /** Exact evaluator-selected analytic authority executed at traffic cadence. */
  racecraftPathPlan?: Exclude<
    PathPlan,
    { mode: 'ideal' } | { mode: 'pit' }
  >;
  pathBuildN?: number;
  pathMaxSlew?: number;
  laneTargetDiscontinuityMetres?: number;
  laneTargetDiscontinuities?: number;
  laneTargetNonManeuverDiscontinuities?: number;
  laneDiscontinuityReasons?: Record<string, number>;
  laneEdits?: number;
  laneEditReasons?: Record<string, number>;
  _laneBufferRevision?: number;
  _laneTargetAbsolute?: number;
  laneMaximumPinError?: number;
  laneUnpinnedEdits?: number;
  racecraftDecision?: RacecraftDecision;
  /**
   * Winning family held between deliberations while publication is re-derived.
   * Stations are never cached: each claim re-anchors this family to measurement.
   */
  _racecraftRederivedProgram?: {
    kind: RacecraftCandidateKind;
    plan: PathPlan;
    slowPointOwnerCode: string | null;
    absorbedDecisionAt: number;
  };
  _racecraftLoggedAt?: number;
  _racecraftAppliedKind?: RacecraftCandidateKind;
  _racecraftAppliedAt?: number;
  _racecraftLateralAuthorityRevision?: number;
  _racecraftLongitudinalAuthorityRevision?: number;
  _racecraftPublicationDetection?: RacecraftPublicationDetectionState;
  racecraftClaim?: RacecraftClaim;
  _racecraftClaimWrite?: RacecraftClaim;
  _racecraftLastPublicationRevision?: number;
  claimLateralTrackingErrorThresholdMetres?: number;
  claimLongitudinalTrackingErrorThresholdMetres?: number;
  claimTrackingErrorMetres?: number;
  claimTrackingErrorScaleBySource?: Partial<
    Record<RacecraftPredictionSource, RacecraftTrackingErrorScale>
  >;
  stationarySince?: number;
  stationaryDuration?: number;
  stationaryCause?: string | null;
  unexplainedStallAt?: number;
  _mishap?: boolean;
  pitPhase?: PitPhase;
  pitReservationKey?: string;
  pitQueueW?: number | null;
  pitQueueOff?: number | null;
  pitWaitOwner?: string | null;
  pitProgressW?: number;
  pitProgressAt?: number;
  pitProgressPhase?: PitPhase;
  pitDeadlockAt?: number;
  _prw?: [number, number] | null;
  _defMoveKey?: string;
  _defenseCanaryLaneEdits?: number;
  _defSeenKey?: string;
  _defSeenAttackers?: Record<string, boolean>;
  _defendingAgainst?: string;
  _previousTrafficLateral?: number;
  _trafficLateralVelocity?: number;
  _previousTrafficIndex?: number;
  _trafficIndex?: number;
  _trafficRoadHeading?: number;
  _trafficProjectedHalfExtent?: number;
  _trafficProjectedHalfExtentIndex?: number;
  _trafficProjectedHalfExtentHeading?: number;
  _pairKeys?: Record<string, string>;
  _closingWith?: string;
  _closingDistance?: number;
  _trafficClosingVelocity?: number;
  _hitT?: number;
  _bestCps?: number[] | undefined;
  _curCps?: number[];
  _cpSeen?: number;
  _dLive?: number | null;
  pitWaitReason?: PitWaitReason | null;
  pitTrafficLeader?: string | null;
}

export interface SessionConfig {
  playerWearRate: number;
  engineerPrecision: number;
  pitSkill: number;
  pitFocus: number;
  tuneBonus: number;
  tuningPoints: number;
}

export type SessionEvent =
  | { type: 'toast'; message: string; kind: MessageKind }
  | { type: 'banner'; tone: MessageKind; title: string; subtitle: string }
  | {
      type: 'audio';
      cue: 'beep';
      frequency: number;
      duration: number;
      wave: SessionAudioWave;
      gain: number;
    }
  | { type: 'audio'; cue: 'chime'; kind: 'up' | 'down' }
  | { type: 'audio'; cue: 'thud'; strength: number }
  | { type: 'audio'; cue: 'fanfare' }
  | {
      type: 'effect';
      kind: 'skid';
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      alpha: number;
    }
  | {
      type: 'effect';
      kind: 'dust';
      x: number;
      y: number;
      vx: number;
      vy: number;
      big: boolean;
    }
  | { type: 'effect'; kind: 'confetti' }
  | { type: 'hud-dirty'; carIndex?: number; tuningDelta?: 1 }
  | { type: 'camera-candidate'; entryIndex: number; kind: 'incident' | 'pit' | 'battle' }
  | { type: 'session-complete'; kind: 'qualifying' | 'race' };

interface SessionBase {
  trk: Track & { idealPath: SampledPath; corners: LegacyCorner[] };
  prof: SpeedProfile;
  entries: Entry[];
  config: SessionConfig;
  events: SessionEvent[];
  t: number;
  scale: number;
  prevScale: number;
  wet: number;
  evo: number;
  phase: SessionPhase;
  uiT: number;
  trafT: number;
  goT: number;
  camI: number;
  hitN?: number;
  hitHard?: number;
  hitOpenHard?: number;
  hitRear?: number;
  hitSide?: number;
  hitHardRear?: number;
  hitHardSide?: number;
  hitHardRoom?: number;
  hitHardCorner?: number;
  hitMax?: number;
  hitPairs?: Record<string, HitPairMetric>;
  _contactStep?: number;
  hitSamples?: HitSample[];
  sbsT?: number;
  sbsPairs?: Record<string, SideBySidePair>;
  sbsEpisodes?: SideBySideEpisode[];
  _sbsStamp?: number;
  roomPairs?: Record<string, LegacyRoomPair>;
  _roomStamp?: number;
  utilizationMistakes?: number;
  defMoveN?: number;
  defRepeatN?: number;
  defBlockedN?: number;
  switchbackN?: number;
  switchbackCompletions?: number;
  brakeWhileAlongsideN?: number;
  rearLossStraightN?: number;
  defenseMoveInBrakingN?: number;
  defenseMirrorN?: number;
  cornerPassCounts?: Record<string, CornerPassCount>;
  racecraftCornerDecisions?: Record<string, RacecraftCornerDecisionCount>;
  battleLapDeltaSum?: number;
  battleLapReferenceSum?: number;
  battleLapSamples?: number;
  stationGapDistribution?: StationGapDistribution;
  attackInitiations?: number;
  attackCompletions?: number;
  attackEpisodes?: Map<string, AttackEpisode>;
  attackPaceOutcomeMoments?: AttackPaceOutcomeMoments;
  pitReservations?: Map<string, PitReservation>;
  pitDeadlocks?: PitDeadlockRecord[];
  pitForeignFalseLeaders?: number;
  pitUnintendedWait?: number;
  racecraftRejectedCandidates?: number;
  racecraftRejectedByConstraint?: Record<string, number>;
  racecraftCandidatesEvaluated?: number;
  racecraftMaximumCandidates?: number;
  racecraftPathsMaterialized?: number;
  racecraftDecisionLogging?: boolean;
  racecraftDecisionLog?: RacecraftDecisionLogEntry[];
  racecraftDecisionLogCursor?: number;
  racecraftDecisionLogDropped?: number;
  racecraftDecisionTick?: number;
  racecraftDecisionSamples?: number;
  racecraftDecisionSwitches?: number;
  racecraftTier0Checks?: number;
  racecraftTier0Accepted?: number;
  racecraftTier0IdealDominance?: number;
  racecraftTier0BetaRechecks?: number;
  racecraftTier0BetaAccepts?: number;
  racecraftTier0BetaBreaks?: number;
  racecraftTier1Deliberations?: number;
  racecraftOffHorizonContests?: number;
  racecraftOffHorizonMaximumContactTimeSeconds?: number;
  racecraftEvaluatorWork?: RacecraftEvaluatorWorkDiagnostics;
  racecraftCertificateBreaks?: Partial<
    Record<RacecraftDecisionCertificateBreakReason, number>
  >;
  racecraftClaimRevisionReasons?: Partial<
    Record<RacecraftClaimRevisionReason, number>
  >;
  racecraftClaims?: ReadonlyMap<string, RacecraftClaim>;
  _racecraftClaimMapWrite?: Map<string, RacecraftClaim>;
  sideAgreements?: Map<string, RacecraftSideAgreement>;
  racecraftClaimTick?: number;
  racecraftAgreementGeometryViolations?: number;
  racecraftAgreementFamilyCertificateFailures?: number;
  racecraftAgreementFamilyCertificateFailuresByContext?: Record<string, number>;
  racecraftAgreementFamilyRepositions?: number;
  racecraftAgreementDaylightMetresSum?: number;
  racecraftAgreementDaylightSamples?: number;
  racecraftAgreementDaylightMinimumMetres?: number;
  _racecraftAgreementCertificateFailureContexts?: Map<string, string>;
  racecraftClaimUntrustedSamples?: number;
  racecraftReactionEvents?: number;
  racecraftEmergencyLifts?: number;
  racecraftInteractionSamples?: Partial<Record<RacecraftInteractionCause, number>>;
  racecraftLiftSamples?: Partial<Record<RacecraftInteractionCause, number>>;
  racecraftBlueForcedSpanSamples?: number;
  racecraftBlueForcedLiftSamples?: number;
  racecraftBlueLiftOutsideForcedSpan?: number;
  racecraftExpiredPrograms?: number;
  racecraftWanderingSeconds?: number;
  _racecraftDefensePairs?: Set<string>;
  _trafficActiveEntries?: Entry[];
  unexplainedStalls?: UnexplainedStallRecord[];
  completionQueued?: boolean;
  pendingTuningLearn?: number;
}

export interface QualifyingSession extends SessionBase {
  mode: 'quali';
  phase: 'run';
  done: boolean;
  over: boolean;
  tEnd: number;
  mile: Record<number, number>;
}

export interface RaceSession extends SessionBase {
  mode: 'race';
  phase: SessionPhase;
  countT: number;
  _lt: number;
  laps: number;
  chequered: boolean;
  finCount: number;
  winT: number;
  endT: number;
  raining: boolean;
  rainAt: number;
  rainEnd: number;
}

export type Session = QualifyingSession | RaceSession;

export interface PitReservation {
  key: string;
  kind: PitReservationKind;
  owner: Entry;
  ownerCode: string;
  crossingW: number;
  minimumW: number;
  maximumW: number;
  acquiredAt: number;
  expiresAt: number;
}

export interface PitDeadlockRecord {
  code: string;
  time: number;
  pitW: number;
  phase: PitPhase;
  reason: PitWaitReason | null;
  owner: string | null;
}

export interface EntryStepCallbacks { onLine(entry: Entry, session: Session, valid: boolean): void }
