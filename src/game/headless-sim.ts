import { botStep, PATH_FOLLOWER_SETTLE_DISTANCE } from '../core/autopilot';
import { makeLap, raceTick } from '../core/lap';
import {
  compactLateralGeometryAtProgress,
  sampleCompactLateralProgram
} from '../core/lateral-program';
import type {
  BuiltTrack, Car, CarModifiers, Corner, PathFollowerTuning, SampledPath, SurfaceState, Track,
  TrackDefinition
} from '../core/model';
import { makeCar, stepCar, trackSense } from '../core/physics-engine';
import {
  availableDeceleration,
  cornerSpeedForGrip,
  PHYS,
  wakeEffect
} from '../core/physics';
import {
  normalLateralEnvelope,
  surfaceExposureAtLateral
} from '../core/surface';
import { sampleCornerLineEta } from '../core/corner-lines';
import { derivePathGeometry, nextCorner } from '../core/racing-line';
import { speedEnvelopeAt } from '../core/speed-envelope';
import { TEAM_DEFS } from '../data/teams';
import { PIT_TEAMS, TRACK_DEFS } from '../data/tracks';
import { createEntry, spawnOnTrack } from '../session/entry';
import type {
  Entry, LineupEntry, QualifyingLapPhase, QualifyingSession, RaceSession,
  RacecraftDecisionLogEntry, Session, SessionConfig, SessionEvent, TyreCompound,
  RacecraftEvaluatorWorkDiagnostics,
  RacecraftInteractionCause, PathPlan, RacecraftCandidateEvaluation,
} from '../session/model';
import {
  ATTACK_COMPLETION_WINDOW_SECONDS,
  beginAttackEpisode,
  extendAttackEpisode,
  switchbackCompletionWindow,
  type SwitchbackCompletionWindow
} from '../session/racecraft/feel';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from '../session/racecraft/cadence';
import { racecraftCalibration } from '../session/racecraft/config';
import {
  orderedRacecraftDecisionLog,
  publishedTrajectoriesContestedRegion
} from '../session/racecraft/evaluator';
import {
  clearLaneProgram,
  evaluateLaneEta,
  physicalLateralMoveSeconds
} from '../session/racecraft/lane-program';
import {
  oneIntervalPhysicalDivergence,
  targetAbsLat
} from '../session/racecraft/paths';
import {
  obligationsFor,
  owes
} from '../session/racecraft/relations';
import { resolvePredictiveSafetyIntervalTicks } from
  '../session/racecraft/reactive-safety';
import { stepSession } from '../session/session';
import {
  entryDownforceScale,
  entryDynamicMuAt,
  entryMargin,
  entryMu,
  RACE_PACE_F,
  START_BLEND_END,
  TRAF_DT
} from '../session/strategy';
import { mulberry32, random, withRandomSource } from '../shared/rng';
import { buildTrackDefinition } from './tracks';
import { raceLapsFor, rivalLevel } from './weekend';

export interface SimulationLimits {
  maxSteps: number;
  deadlineMs?: number;
  now?: () => number;
}

export interface SingleCarOptions extends Partial<SimulationLimits> {
  seed?: number;
  laps?: number;
  step?: number;
  margin?: number;
  muScale?: number;
  initialSpeed?: number;
  initialLateralOffset?: number;
  path?: SampledPath;
  pathTuning?: PathFollowerTuning;
  modifiers?: CarModifiers;
}

export type AuditFocusedScenario =
  | 'faster-behind'
  | 'alongside-straight'
  | 'tow-run'
  | 'near-touch-tow'
  | 'side-by-side-corner'
  | 'light-rub'
  | 'defense-legality'
  | 'attack-launch'
  | 'inside-pass'
  | 'outside-pass'
  | 'over-under'
  | 'drag-pass'
  | 'switchback'
  | 'spot-selection'
  | 'train-pressure'
  | 'tucked-follow'
  | 'solo-baseline';

export type FocusedScenario =
  | 'pair'
  | 'pit'
  | 'priority'
  | 'classification'
  | AuditFocusedScenario;

export interface FocusedSessionOptions extends Partial<SimulationLimits> {
  scenario: FocusedScenario;
  seed?: number;
  step?: number;
  simulatedSeconds?: number;
  wet?: number;
  phase?: 'straight' | 'approach' | 'corner';
  side?: -1 | 1;
  closingSpeedMps?: number;
  initialGapM?: number;
  attackerGripScale?: number;
  priorityReason?: 'blue-flag' | 'qualifying';
  qualifyingYieldPhase?: Exclude<QualifyingLapPhase, 'flying'>;
  priorityDisabled?: boolean;
  stopOnPriorityRelease?: boolean;
  pitControl?: boolean;
  traffic?: 'pair' | 'three-car';
  firstTyreWear?: number;
  secondTyreWear?: number;
  firstStress?: number;
  secondStress?: number;
  settlingSeconds?: number;
  stopWhenDecided?: boolean;
  defenseVariant?: 'anticipatory' | 'committed';
  predictiveSafetyHz?: 10 | 30;
}

export interface HeadlessRaceOptions extends Partial<SimulationLimits> {
  seed?: number;
  step?: number;
  laps?: number;
  wet?: number;
  includeClassificationDiagnostics?: boolean;
  includePerformanceDiagnostics?: boolean;
  includeRacecraftDecisionLog?: boolean;
  /** Optional production-grid prefix used by bounded performance probes. */
  gridSize?: number;
  /** Audit-only player-equivalent pit commands; absent in production races. */
  forcedStrategies?: readonly ForcedHeadlessStrategy[];
  /** Tier-2 audit view; keeps the compressed opening lap out of steady-state rates. */
  includeLapStrata?: boolean;
  predictiveSafetyHz?: 10 | 30;
}

export interface ForcedHeadlessStrategy {
  entryIndex: number;
  compounds: readonly TyreCompound[];
  boxLaps: readonly number[];
}

export interface HeadlessStop {
  reason: 'complete' | 'step-limit' | 'deadline';
  steps: number;
  simulatedSeconds: number;
}

export interface SingleCarSummary extends HeadlessStop {
  schemaVersion: 1;
  kind: 'single-car';
  trackId: string;
  seed: number;
  requestedLaps: number;
  completedLaps: number;
  validLaps: number;
  invalidLaps: number;
  lapTimes: number[];
  offCourseSeconds: number;
  grassSeconds: number;
  maximumPathError: number;
  meanPathError: number;
  maximumMarkerError: number;
  finite: boolean;
  final: StableCarState;
  checksum: string;
}

export interface RacecraftSelectedJDecomposition {
  /** Selected records retained by the bounded decision log. */
  samples: number;
  /** Older records overwritten by the bounded decision log. */
  droppedSamples: number;
  /** Arithmetic means over retained selected records, all in seconds. */
  ownTimeSeconds: number;
  billSeconds: number;
  proximitySeconds: number;
  positionValueSeconds: number;
  attemptLossSeconds: number;
  battleSpendSeconds: number;
  effortRiskSeconds: number;
  tieBandSeconds: number;
  totalSeconds: number;
  hazardCount: number;
}

export interface FocusedSessionSummary extends HeadlessStop {
  schemaVersion: 1;
  kind: 'focused-session';
  scenario: FocusedScenario;
  trackId: string;
  seed: number;
  wet: number;
  eventTypes: string[];
  entries: StableEntryState[];
  diagnostics: {
    laneDiscontinuityReasons: Record<string, number>;
    laneEditReasons: Record<string, number>;
    racecraftInteractionSamples:
      Partial<Record<RacecraftInteractionCause, number>>;
    racecraftLiftSamples:
      Partial<Record<RacecraftInteractionCause, number>>;
    racecraftCornerDecisions:
      Record<string, { inline: number; offset: number }>;
    racecraftSelectedJ: RacecraftSelectedJDecomposition;
    racecraftEvaluatorWork: Partial<RacecraftEvaluatorWorkDiagnostics>;
    racecraftDeliberationsByCar: Record<string, number>;
    racecraftPublicationsByCar: Record<string, number>;
    racecraftDirectDecisionProofs: Record<string, number>;
    racecraftOwnershipInvalidationsByReason: Record<string, number>;
    racecraftDefensiveCandidateRejections: Record<string, number>;
    racecraftDefensiveMinimumNoticeSecondsByOutcome:
      Record<string, number>;
    racecraftDefensiveMinimumAlongsideSecondsByOutcome:
      Record<string, number>;
    racecraftSafetyPredicateRuns: Record<string, number>;
  };
  metrics: Record<string, number>;
  audit?: {
    verdict: 'green' | 'red' | 'undecided';
    reason: string;
  };
  checksum: string;
}

export interface HeadlessRaceSummary extends HeadlessStop {
  schemaVersion: 1;
  kind: 'race';
  trackId: string;
  seed: number;
  wetStratum: 'dry' | 'wet';
  laps: number;
  productionLaps: number;
  finite: boolean;
  classificationValid: boolean;
  racecraftDecisionLog?: readonly RacecraftDecisionLogEntry[];
  exposure: {
    raceSeconds: number;
    carSeconds: number;
    carKilometres: number;
    sideBySideSeconds: number;
    offCourseCarSeconds: number;
    curbCarSeconds: number;
    grassCarSeconds: number;
    emergencyAuthorizedGrassCarSeconds: number;
    nonEmergencyGrassCarSeconds: number;
    nonEmergencyGrassCarSecondsByAuthority: Record<
      NonEmergencyGrassAuthority,
      number
    >;
    passAttempts: number;
    obligationEpisodes: number;
    pitStops: number;
  };
  metrics: {
    passes: number;
    contacts: number;
    contactEpisodes: number;
    lightContacts: number;
    hardContacts: number;
    maximumContinuousContactDurationSeconds: number;
    agreementDaylightSamples: number;
    agreementDaylightMeanMetres: number | null;
    agreementDaylightMinimumMetres: number | null;
    emergencySurfaceSelections: number;
    emergencySurfaceAttributionFailures: number;
    straightPullOutSelections: number;
    straightPullOutEnvelopeFractionMinimum: number;
    straightPullOutEnvelopeFractionMean: number;
    straightPullOutEnvelopeFractionMaximum: number;
    straightPullOutSignedOffsetMinimumMetres: number;
    straightPullOutSignedOffsetMaximumMetres: number;
    openingHardContacts: number;
    dnfs: number;
    passSuccesses: number;
    stationGapSamples: number;
    stationGapMeanMetres: number;
    stationGapStdDevMetres: number;
    stationGapMinimumMetres: number;
    stationGapMaximumMetres: number;
    obligationYieldLossSeconds: number;
    obligationYieldLossSecondsPerEpisode: number;
    utilizationMistakes: number;
    attackInitiations: number;
    attackCompletions: number;
    attackPaceOutcomeSamples: number;
    attackCompletionPaceDifferentialCorrelation: number | null;
    sideBySideEpisodes: number;
    sideBySideContactEpisodes: number;
    sideBySideDurations: number[];
    switchbacks: number;
    switchbackCompletions: number;
    brakeWhileAlongside: number;
    rearLossStraight: number;
    battleLapDelta: number;
    battleLapLossFraction: number;
    battleLapSamples: number;
    cornerPassCounts: Record<string, { attempts: number; passes: number }>;
    softContactConcedes: number;
    pathOutOfBoundsRejections: number;
    nonFiniteCandidateRejections: number;
    pitFalseLeaders: number;
    maximumPathSlew: number;
    laneTargetDiscontinuityMetres: number;
    laneTargetDiscontinuities: number;
    laneTargetNonManeuverDiscontinuities: number;
    laneHopMetresPerCarMinute: number;
    laneEdits: number;
    laneMaximumPinError: number;
    laneUnpinnedEdits: number;
    maximumCandidates: number;
    maximumPathsMaterialized: number;
    candidatesEvaluated: number;
    pathsMaterialized: number;
    racecraftDecisionSwitches: number;
    racecraftDeliberations: number;
    racecraftTacticalPublications: number;
    racecraftOffSlotPublicationAttempts: number;
    racecraftSameSlotReopenings: number;
    racecraftNestedResponseEvaluations: number;
    racecraftDirectIdealDecisions: number;
    racecraftDirectFollowDecisions: number;
    racecraftDirectFollowWithoutCertificates: number;
    racecraftStagedCandidatesOpened: number;
    racecraftStagedCandidatesRejected: number;
    racecraftStagedCandidatesSelected: number;
    racecraftStagedCandidatesCleared: number;
    racecraftStagedAcquisitionConstrainedSeconds: number;
    racecraftCommittedAttackViews: number;
    racecraftDefensiveResponses: number;
    racecraftDefensiveMovesCommitted: number;
    racecraftDefensiveMovesContinued: number;
    racecraftDefensiveMovesResetAtExit: number;
    racecraftDefensiveRoomProtectedCovers: number;
    racecraftDefensiveAuthorizedSideClosures: number;
    racecraftDefensiveAuthorizedApproachConflicts: number;
    racecraftDefensivePreConsumptionSafetyInterventions: number;
    racecraftSwitchbackFamilyChanges: number;
    racecraftOwnershipAssertions: number;
    racecraftOwnershipCurrentValidations: number;
    racecraftOwnershipInvalidations: number;
    racecraftDefenderReclaims: number;
    racecraftMaximumSingleFileTrainLength: number;
    racecraftLongestSingleFileTrainSeconds: number;
    racecraftFasterCarBlockedSeconds: number;
    predictiveSafetyHz: 10 | 30;
    predictiveSafetyIntervalTicks: 1 | 3;
    racecraftSafetyPasses: number;
    racecraftSafetyInterventions: number;
    racecraftInteractionSamples: number;
    racecraftLiftSamplesOutsideBlue: number;
    racecraftBlueLiftSamples: number;
    racecraftBlueForcedSpanSamples: number;
    racecraftBlueForcedLiftSamples: number;
    racecraftBlueLiftOutsideForcedSpan: number;
    racecraftReactionEvents: number;
    racecraftReactionRatePerLap: number;
    racecraftEmergencyLifts: number;
    racecraftExpiredPrograms: number;
    racecraftWanderingSeconds: number;
    unexplainedStalls: number;
    pitDeadlocks: number;
  };
  diagnostics: {
    candidateRejections: Record<string, number>;
    laneDiscontinuityReasons: Record<string, number>;
    laneEditReasons: Record<string, number>;
    racecraftInteractionSamples:
      Partial<Record<RacecraftInteractionCause, number>>;
    racecraftLiftSamples:
      Partial<Record<RacecraftInteractionCause, number>>;
    racecraftCornerDecisions:
      Record<string, { inline: number; offset: number }>;
    racecraftSelectedJ: RacecraftSelectedJDecomposition;
    racecraftEvaluatorWork: Partial<RacecraftEvaluatorWorkDiagnostics>;
    racecraftDeliberationsByCar: Record<string, number>;
    racecraftPublicationsByCar: Record<string, number>;
    racecraftDirectDecisionProofs: Record<string, number>;
    racecraftOwnershipInvalidationsByReason: Record<string, number>;
    racecraftDefensiveCandidateRejections: Record<string, number>;
    racecraftDefensiveMinimumNoticeSecondsByOutcome:
      Record<string, number>;
    racecraftDefensiveMinimumAlongsideSecondsByOutcome:
      Record<string, number>;
    racecraftSafetyPredicateRuns: Record<string, number>;
    pitDeadlocks: Array<{
      code: string;
      time: number;
      pitW: number;
      phase: string;
      reason: string | null;
      owner: string | null;
    }>;
    pitStates: Array<{
      code: string;
      state: string;
      pitW: number;
      phase: string;
      waitReason: string | null;
      waitOwner: string | null;
      speed: number;
      lateral: number;
      target: number;
      pathMode: string;
    }>;
    classification?: Array<StableEntryState & {
      carVelocity: [number, number];
      input: [number, number, number];
      targetLateral: number;
      fuel: number;
      failures: [boolean, boolean];
      recovery: [number, number];
      reverse: boolean;
      offCourse: boolean;
      notes: string[];
    }>;
  };
  lapStrata?: {
    openingLap: HeadlessLapStratum;
    steadyState: HeadlessLapStratum;
  };
  checksum: string;
  performance?: {
    retainedPitPaths: number;
    retainedDecisionCandidates: number;
  };
  strategyResults?: Array<{
    entryIndex: number;
    code: string;
    finishPosition: number;
    finishTime: number;
    stops: number;
    finalCompound: TyreCompound;
  }>;
}

export type NonEmergencyGrassAuthority =
  | 'racecraft-side'
  | 'racecraft-other'
  | 'pit'
  | 'recovery'
  | 'ideal'
  | 'other-lane';

function nonEmergencyGrassAuthority(
  entry: Entry
): NonEmergencyGrassAuthority {
  if (entry.recT > 0 || entry.avoidT > 0) return 'recovery';
  const plan = entry.racecraftPathPlan;
  if (plan)
    return plan.mode === 'side-inside' || plan.mode === 'side-outside'
      ? 'racecraft-side'
      : 'racecraft-other';
  if (entry.pathPlan?.mode === 'pit') return 'pit';
  if (entry.laneProgram.points.length > 0 ||
      Math.abs(entry.laneProgram.bias) > Number.EPSILON ||
      entry.laneProgram.binding != null)
    return 'other-lane';
  return 'ideal';
}

export interface HeadlessLapStratum {
  raceSeconds: number;
  carSeconds: number;
  sideBySideSeconds: number;
  passes: number;
  contacts: number;
  hardContacts: number;
  attackInitiations: number;
}

interface StableCarState {
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
  s: number;
  speed: number;
  progressIndex: number;
  offCourse: boolean;
}

interface StableEntryState {
  code: string;
  state: string;
  cross: number;
  finishPosition: number;
  pathMode: string;
  pitPhase: string;
  s: number | null;
  speed: number;
  lateral: number;
}

interface MarkerProbe {
  index: number;
  target: number;
  bestDistance: number;
  error: number;
}

const DEFAULT_CONFIG: SessionConfig = {
  playerWearRate: 0,
  engineerPrecision: 0,
  pitSkill: 3,
  pitFocus: 3,
  tuneBonus: 0,
  tuningPoints: 0,
  predictiveSafetyHz: 10
};

function headlessSessionConfig(
  predictiveSafetyHz: 10 | 30
): SessionConfig {
  return predictiveSafetyHz === DEFAULT_CONFIG.predictiveSafetyHz
    ? DEFAULT_CONFIG
    : { ...DEFAULT_CONFIG, predictiveSafetyHz };
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e9) / 1e9 : value;
}

function stationGapMetrics(session: Session): {
  samples: number;
  mean: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
} {
  const distribution = session.stationGapDistribution;
  const samples = distribution?.samples ?? 0;
  if (samples <= 0 || !distribution)
    return {
      samples: 0,
      mean: 0,
      standardDeviation: 0,
      minimum: 0,
      maximum: 0
    };
  const mean = distribution.sumMetres / samples;
  const variance = Math.max(
    0,
    distribution.squaredSumMetres / samples - mean * mean
  );
  return {
    samples,
    mean,
    standardDeviation: Math.sqrt(variance),
    minimum: distribution.minimumMetres,
    maximum: distribution.maximumMetres
  };
}

function completedCarLaps(session: Session): number {
  return session.entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.cross),
    0
  );
}

function checksum(value: unknown): string {
  const source = JSON.stringify(value);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stableCar(car: Car): StableCarState {
  return {
    x: round(car.x),
    y: round(car.y),
    h: round(car.h),
    vx: round(car.vx),
    vy: round(car.vy),
    s: round(car.s),
    speed: round(car.spd),
    progressIndex: car.progIdx,
    offCourse: car.offCourse
  };
}

function resolveDeadline(limits: Partial<SimulationLimits>): {
  expired: (steps: number) => boolean;
  maximumSteps: number;
} {
  const maximumSteps = limits.maxSteps ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(maximumSteps) || maximumSteps <= 0)
    throw new Error('maxSteps must be a positive integer');
  if (limits.deadlineMs === undefined) return { expired: () => false, maximumSteps };
  if (!Number.isFinite(limits.deadlineMs) || limits.deadlineMs < 0)
    throw new Error('deadlineMs must be a non-negative finite number');
  const now = limits.now ?? Date.now;
  const deadline = now() + limits.deadlineMs;
  return { expired: steps => (steps & 63) === 0 && now() >= deadline, maximumSteps };
}

export function prepareHeadlessTrack(trackId: string): BuiltTrack {
  const definition = TRACK_DEFS.find(track => track.id === trackId);
  if (!definition) throw new Error(`Unknown track ${trackId}`);
  return buildTrackDefinition(definition, PIT_TEAMS);
}

export function prepareHeadlessTrackDefinition(definition: TrackDefinition): BuiltTrack {
  return buildTrackDefinition(definition, PIT_TEAMS, { profile: null, warn: false });
}

function startingCar(
  built: BuiltTrack,
  path: SampledPath,
  initialSpeed: number,
  initialLateralOffset: number
): Car {
  const geometry = derivePathGeometry(built.tr, path);
  const back = Math.max(3, Math.round(12 / built.tr.step));
  const index = (built.tr.n - back) % built.tr.n;
  const car = makeCar(
    geometry.x[index]! + built.tr.nx[index]! * initialLateralOffset,
    geometry.y[index]! + built.tr.ny[index]! * initialLateralOffset,
    Math.atan2(geometry.ty[index]!, geometry.tx[index]!)
  );
  car.vx = initialSpeed;
  car.progIdx = index;
  car.s = index * built.tr.step;
  return car;
}

function finiteCar(car: Car): boolean {
  return [car.x, car.y, car.h, car.vx, car.vy, car.r, car.s, car.spd]
    .every(Number.isFinite);
}

export function runSingleCar(
  built: BuiltTrack,
  options: SingleCarOptions = {}
): SingleCarSummary {
  const seed = options.seed ?? 1;
  const requestedLaps = options.laps ?? 2;
  const fixedStep = options.step ?? 1 / 120;
  if (!Number.isInteger(requestedLaps) || requestedLaps <= 0)
    throw new Error('laps must be a positive integer');
  if (!Number.isFinite(fixedStep) || fixedStep <= 0)
    throw new Error('step must be positive');
  const path = options.path ?? built.tr.idealPath;
  const limits = resolveDeadline({
    maxSteps: options.maxSteps ?? Math.ceil((built.tr.idealTiming.lapTime * (requestedLaps + 1) + 30) / fixedStep),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  return withRandomSource(mulberry32(seed), () => {
    const car = startingCar(
      built,
      path,
      options.initialSpeed ?? 12,
      options.initialLateralOffset ?? 0
    );
    const lap = makeLap();
    const lapTimes: number[] = [];
    const markers: MarkerProbe[] = built.tr.corners.flatMap(corner =>
      [corner.turnInI, corner.apexI, corner.trackOutI].map(index => ({
        index,
        target: path.off[index]!,
        bestDistance: Infinity,
        error: Infinity
      }))
    );
    let steps = 0;
    let lapStartedAt = 0;
    let validLaps = 0;
    let invalidLaps = 0;
    let offCourseSteps = 0;
    let grassSteps = 0;
    let pathErrorSum = 0;
    let pathErrorCount = 0;
    let maximumPathError = 0;
    let finite = true;
    let stop: HeadlessStop['reason'] = 'step-limit';
    while (steps < limits.maximumSteps) {
      if (limits.expired(steps)) {
        stop = 'deadline';
        break;
      }
      const previousX = car.x;
      const previousY = car.y;
      const surface = trackSense(built.tr, car);
      recordSingleCarSample(built, path, car, surface, lap.started, markers, {
        offCourse: () => { offCourseSteps++; },
        grass: () => { grassSteps++; },
        pathError: error => {
          pathErrorSum += error;
          pathErrorCount++;
          maximumPathError = Math.max(maximumPathError, error);
        }
      });
      const input = botStep(built.tr, built.prof, car, {
        margin: options.margin ?? 0.95,
        muScale: options.muScale ?? 1,
        path,
        ...(options.pathTuning === undefined ? {} : { pathTuning: options.pathTuning })
      });
      stepCar(
        car,
        input,
        surface,
        fixedStep,
        options.modifiers ?? { pw: 1, mu: 1, dr: 1, df: 1 }
      );
      steps++;
      finite = finite && finiteCar(car) &&
        [input.steer, input.throttle, input.brake].every(Number.isFinite);
      if (!finite) break;
      const event = raceTick(built.tr, lap, car, previousX, previousY);
      if (event?.type === 'start') lapStartedAt = steps * fixedStep;
      else if (event?.type === 'lap') {
        const time = steps * fixedStep - lapStartedAt;
        lapTimes.push(round(time));
        lapStartedAt = steps * fixedStep;
        if (event.valid) validLaps++;
        else invalidLaps++;
        if (lapTimes.length >= requestedLaps) {
          stop = 'complete';
          break;
        }
      }
    }
    const maximumMarkerError = markers.length
      ? Math.max(...markers.map(marker => marker.error))
      : 0;
    const core = {
      schemaVersion: 1 as const,
      kind: 'single-car' as const,
      trackId: built.def.id,
      seed,
      requestedLaps,
      completedLaps: lapTimes.length,
      validLaps,
      invalidLaps,
      lapTimes,
      offCourseSeconds: round(offCourseSteps * fixedStep),
      grassSeconds: round(grassSteps * fixedStep),
      maximumPathError: round(maximumPathError),
      meanPathError: round(pathErrorSum / Math.max(1, pathErrorCount)),
      maximumMarkerError: round(maximumMarkerError),
      finite,
      reason: stop,
      steps,
      simulatedSeconds: round(steps * fixedStep),
      final: stableCar(car)
    };
    return { ...core, checksum: checksum(core) };
  });
}

function recordSingleCarSample(
  built: BuiltTrack,
  path: SampledPath,
  car: Car,
  surface: SurfaceState,
  lapStarted: boolean,
  markers: MarkerProbe[],
  record: {
    offCourse: () => void;
    grass: () => void;
    pathError: (error: number) => void;
  }
): void {
  if (car.offCourse) record.offCourse();
  if (surface.zone === 'grass') record.grass();
  const index = Math.max(0, car.progIdx) % built.tr.n;
  const lateral = surface.lat ?? 999;
  record.pathError(Math.abs(lateral - path.off[index]!));
  if (!lapStarted) return;
  for (const marker of markers) {
    const forward = ((index - marker.index + built.tr.n) % built.tr.n) * built.tr.step;
    const backward = ((marker.index - index + built.tr.n) % built.tr.n) * built.tr.step;
    const distance = Math.min(forward, backward);
    if (distance >= marker.bestDistance) continue;
    marker.bestDistance = distance;
    marker.error = Math.abs(lateral - marker.target);
  }
}

function lineup(index: number): LineupEntry {
  const team = TEAM_DEFS[index % TEAM_DEFS.length]!;
  const driver = team.drv[index % team.drv.length]!;
  return {
    team,
    name: driver.n,
    code: driver.c,
    isPlayer: false,
    ci: -1,
    margin: 0.95 + index * 0.002,
    focus: 0.75,
    trait: '',
    pw: 1,
    dr: 1,
    hMu: 1
  };
}

function focusedEntries(count: number): Entry[] {
  return Array.from({ length: count }, (_value, index) => createEntry({
    lineup: lineup(index),
    teamIndex: index,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  }));
}

function createFocusedRace(
  built: BuiltTrack,
  wet: number,
  count = 2,
  predictiveSafetyHz: 10 | 30 = 10
): RaceSession {
  const entries = focusedEntries(count);
  const config = headlessSessionConfig(predictiveSafetyHz);
  return {
    mode: 'race',
    trk: built.tr,
    prof: built.prof,
    config,
    events: [],
    entries,
    t: 20,
    scale: 1,
    prevScale: 1,
    wet,
    evo: 0.5,
    phase: 'run',
    countT: 3,
    _lt: 3,
    laps: 3,
    chequered: false,
    finCount: 0,
    goT: 0,
    winT: 0,
    endT: 0,
    uiT: 0,
    trafT: 0,
    racecraftPredictiveSafetyIntervalTicks:
      resolvePredictiveSafetyIntervalTicks(config.predictiveSafetyHz),
    camI: -1,
    raining: false,
    rainAt: -1,
    rainEnd: -1
  };
}

function createFocusedQualifying(
  built: BuiltTrack,
  wet: number,
  count = 2,
  predictiveSafetyHz: 10 | 30 = 10
): QualifyingSession {
  const config = headlessSessionConfig(predictiveSafetyHz);
  return {
    mode: 'quali',
    trk: built.tr,
    prof: built.prof,
    config,
    events: [],
    entries: focusedEntries(count),
    t: 20,
    tEnd: 1200,
    scale: 1,
    prevScale: 1,
    wet,
    evo: 0.5,
    phase: 'run',
    done: false,
    over: false,
    uiT: 0,
    trafT: 0,
    racecraftPredictiveSafetyIntervalTicks:
      resolvePredictiveSafetyIntervalTicks(config.predictiveSafetyHz),
    goT: 0,
    camI: -1,
    mile: {}
  };
}

function fullRaceLineup(): LineupEntry[] {
  const lineup: LineupEntry[] = [];
  for (const team of TEAM_DEFS) {
    const level = rivalLevel(team.tier);
    team.drv.forEach((driver, index) => {
      lineup.push({
        team,
        name: driver.n,
        code: driver.c,
        isPlayer: false,
        ci: -1,
        margin: team.tier + (index === 0 ? 0.0045 : -0.0045) +
          (random() - 0.5) * 0.0025,
        focus: 0.45 + random() * 0.3,
        trait: '',
        pw: 1 + 0.028 * level,
        dr: 1 - 0.045 * level,
        hMu: 1 + 0.010 * level
      });
    });
  }
  return lineup;
}

const MAXIMUM_BENCHMARK_GRID_SIZE = 22;

function performanceRaceLineup(gridSize: number): LineupEntry[] {
  const production = fullRaceLineup();
  if (gridSize <= production.length) return production.slice(0, gridSize);
  return Array.from({ length: gridSize }, (_unused, index) => {
    const source = production[index % production.length]!;
    const generation = Math.floor(index / production.length);
    if (generation === 0) return source;
    return {
      ...source,
      name: `${source.name} ${generation + 1}`,
      code: `${source.code}${generation + 1}`
    };
  });
}

function createHeadlessRace(
  built: BuiltTrack,
  laps: number,
  wet: number,
  gridSize: number,
  predictiveSafetyHz: 10 | 30
): RaceSession {
  const lineup = performanceRaceLineup(gridSize);
  // A bounded deterministic grid perturbation prevents the season sample from
  // simply restating pace order and supplies genuine pass opportunities.
  const gridScore = lineup.map(entry => entry.margin + (random() - 0.5) * 0.018);
  const grid = lineup.map((_entry, index) => index)
    .sort((left, right) => gridScore[right]! - gridScore[left]! || left - right);
  const config = headlessSessionConfig(predictiveSafetyHz);
  const session: RaceSession = {
    mode: 'race',
    trk: built.tr,
    prof: built.prof,
    config,
    events: [],
    entries: lineup.map((item, index) => createEntry({
      lineup: item,
      teamIndex: Math.max(0, TEAM_DEFS.findIndex(team => team.id === item.team.id)),
      modifiers: { pw: item.pw!, dr: item.dr!, hMu: item.hMu! }
    })),
    t: 0,
    scale: 1,
    prevScale: 1,
    wet,
    evo: wet > 0.12 ? 0 : 0.5,
    phase: 'run',
    countT: 3,
    _lt: 3,
    laps,
    chequered: false,
    finCount: 0,
    goT: 0,
    winT: 0,
    endT: 0,
    uiT: 0,
    trafT: 0,
    racecraftPredictiveSafetyIntervalTicks:
      resolvePredictiveSafetyIntervalTicks(config.predictiveSafetyHz),
    camI: -1,
    raining: wet > 0,
    rainAt: wet > 0 ? 0 : -1,
    rainEnd: wet > 0 ? Number.MAX_SAFE_INTEGER : -1,
    hitN: 0,
    hitHard: 0,
    hitOpenHard: 0,
    sbsT: 0,
    sbsPairs: Object.create(null) as RaceSession['sbsPairs'] & object,
    sbsEpisodes: [],
    _sbsStamp: 0
  };
  grid.forEach((lineupIndex, gridIndex) => {
    const entry = session.entries[lineupIndex]!;
    const lateral = gridIndex % 2 === 0 ? 2.55 : -2.55;
    spawnOnTrack(entry, session, 30 + gridIndex * 8.4, lateral, 0);
    entry.state = 'run';
    entry.lat = lateral;
    entry.gridLat = lateral;
    entry.gridP = gridIndex + 1;
    if (wet > 0.3) entry.tyre.c = 'W';
  });
  return session;
}

interface RecentPaceState {
  recentRatio: number;
  slowSeconds: number;
}

function activeOrder(
  session: RaceSession,
  recentPace: ReadonlyMap<string, RecentPaceState>
): string[] {
  return session.entries
    .filter(entry => entry.state === 'run' && entry.car &&
      (recentPace.get(entry.code)?.slowSeconds ?? 0) <= 3)
    .sort((left, right) => right.prog - left.prog)
    .map(entry => entry.code);
}

function countOrderPasses(previous: readonly string[], current: readonly string[]): number {
  let passes = 0;
  for (let index = 0; index < current.length; index++) {
    const previousIndex = previous.indexOf(current[index]!);
    if (previousIndex < 0) continue;
    for (let behind = index + 1; behind < current.length; behind++) {
      const previousBehind = previous.indexOf(current[behind]!);
      if (previousBehind >= 0 && previousBehind < previousIndex) passes++;
    }
  }
  return passes;
}

function completeSideBySideEpisodes(session: RaceSession): Array<{ t: number; contact: boolean }> {
  const episodes = [...(session.sbsEpisodes ?? [])];
  for (const episode of Object.values(session.sbsPairs ?? {}))
    episodes.push({
      t: Math.max(TRAF_DT, session.t - episode.t0),
      contact: episode.contact,
      reason: 'active'
    });
  return episodes;
}

function maximumContinuousContactDurationSeconds(session: Session): number {
  return Object.values(session.hitPairs ?? {}).reduce(
    (maximum, pair) => Math.max(
      maximum,
      pair.maximumContinuousContactSeconds
    ),
    0
  );
}

function contactEpisodeCount(session: Session): number {
  return Object.values(session.hitPairs ?? {}).reduce(
    (sum, pair) => sum + pair.contactEpisodes,
    0
  );
}

function attackPaceOutcomeCorrelation(session: Session): number | null {
  const moments = session.attackPaceOutcomeMoments;
  if (!moments || moments.samples < 2) return null;
  const count = moments.samples;
  const covariance =
    count * moments.sumProduct -
    moments.sumPace * moments.sumOutcome;
  const paceVariance =
    count * moments.sumPaceSquared -
    moments.sumPace * moments.sumPace;
  const outcomeVariance =
    count * moments.sumOutcomeSquared -
    moments.sumOutcome * moments.sumOutcome;
  const denominator = Math.sqrt(
    Math.max(0, paceVariance) * Math.max(0, outcomeVariance)
  );
  return denominator > Number.EPSILON
    ? covariance / denominator
    : null;
}

function selectedRacecraftCandidate(
  entry: Entry
): RacecraftCandidateEvaluation | null {
  const decision = entry.racecraftDecision;
  if (!decision?.selectedPlanKey) return null;
  return decision.candidates.find(candidate =>
    candidate.plan.key === decision.selectedPlanKey) ?? null;
}

function emergencySelectionHasLiveHazardProvenance(
  candidate: RacecraftCandidateEvaluation
): boolean {
  const plan = candidate.plan;
  return plan.mode !== 'ideal' &&
    plan.mode !== 'pit' &&
    plan.surfaceAuthorization === 'emergency' &&
    plan.emergencyReason === 'collision-avoidance' &&
    typeof plan.leaderCode === 'string' &&
    plan.leaderCode.length > 0;
}

interface StraightPullOutUsage {
  envelopeFraction: number;
  signedOffsetMetres: number;
}

/**
 * Observer-only proof that the selected straight member consumed its local
 * normal-surface width. The maximum anchor fraction ignores the measured
 * acquisition pin and ideal rejoin without knowing their ordinal positions.
 */
function straightPullOutUsage(
  track: Track,
  plan: PathPlan
): StraightPullOutUsage | null {
  if (plan.mode === 'ideal' ||
      plan.mode === 'pit' ||
      plan.surfaceAuthorization === 'emergency' ||
      plan.cornerId != null ||
      !plan.key.includes(':straight:'))
    return null;
  let best: StraightPullOutUsage | null = null;
  for (const anchor of plan.anchors) {
    const index = ((anchor.index % track.n) + track.n) % track.n;
    const ideal = track.idealPath!.off[index]!;
    const signedOffsetMetres = anchor.offset - ideal;
    const envelope = normalLateralEnvelope(track, index);
    const available = signedOffsetMetres < 0
      ? ideal - envelope.minimum
      : envelope.maximum - ideal;
    if (available <= Number.EPSILON) continue;
    const envelopeFraction = Math.abs(signedOffsetMetres) / available;
    if (!best || envelopeFraction > best.envelopeFraction)
      best = { envelopeFraction, signedOffsetMetres };
  }
  return best;
}

function selectedJDecomposition(
  session: Session,
  log: readonly RacecraftDecisionLogEntry[]
): RacecraftSelectedJDecomposition {
  if (!session.racecraftDecisionLogging) {
    const value = session.racecraftSelectedJAccumulator;
    const samples = value?.samples ?? 0;
    const divisor = Math.max(1, samples);
    return {
      samples,
      droppedSamples: 0,
      ownTimeSeconds: round((value?.ownTimeSeconds ?? 0) / divisor),
      billSeconds: round((value?.billSeconds ?? 0) / divisor),
      proximitySeconds: round((value?.proximitySeconds ?? 0) / divisor),
      positionValueSeconds: round(
        (value?.positionValueSeconds ?? 0) / divisor
      ),
      attemptLossSeconds: round(
        (value?.attemptLossSeconds ?? 0) / divisor
      ),
      battleSpendSeconds: round(
        (value?.battleSpendSeconds ?? 0) / divisor
      ),
      effortRiskSeconds: round(
        (value?.effortRiskSeconds ?? 0) / divisor
      ),
      tieBandSeconds: round((value?.tieBandSeconds ?? 0) / divisor),
      totalSeconds: round((value?.totalSeconds ?? 0) / divisor),
      hazardCount: round((value?.hazardCount ?? 0) / divisor)
    };
  }
  let samples = 0;
  let ownTimeSeconds = 0;
  let billSeconds = 0;
  let proximitySeconds = 0;
  let positionValueSeconds = 0;
  let attemptLossSeconds = 0;
  let battleSpendSeconds = 0;
  let effortRiskSeconds = 0;
  let tieBandSeconds = 0;
  let totalSeconds = 0;
  let hazardCount = 0;
  for (const record of log) {
    const selected = record.selectedPlanKey == null
      ? undefined
      : record.candidates.find(candidate =>
          candidate.planKey === record.selectedPlanKey &&
          candidate.feasible);
    if (!selected || ![
      selected.ownTimeSeconds,
      selected.billSeconds,
      selected.proximitySeconds,
      selected.positionValueSeconds,
      selected.attemptLossSeconds,
      selected.battleSpendSeconds,
      selected.effortRiskSeconds,
      selected.tieBandSeconds,
      selected.cost
    ].every(Number.isFinite)) continue;
    samples++;
    ownTimeSeconds += selected.ownTimeSeconds;
    billSeconds += selected.billSeconds;
    proximitySeconds += selected.proximitySeconds;
    positionValueSeconds += selected.positionValueSeconds;
    attemptLossSeconds += selected.attemptLossSeconds;
    battleSpendSeconds += selected.battleSpendSeconds;
    effortRiskSeconds += selected.effortRiskSeconds;
    tieBandSeconds += selected.tieBandSeconds;
    totalSeconds += selected.cost;
    hazardCount += selected.hazardCount;
  }
  const divisor = Math.max(1, samples);
  return {
    samples,
    droppedSamples: session.racecraftDecisionLogDropped ?? 0,
    ownTimeSeconds: round(ownTimeSeconds / divisor),
    billSeconds: round(billSeconds / divisor),
    proximitySeconds: round(proximitySeconds / divisor),
    positionValueSeconds: round(positionValueSeconds / divisor),
    attemptLossSeconds: round(attemptLossSeconds / divisor),
    battleSpendSeconds: round(battleSpendSeconds / divisor),
    effortRiskSeconds: round(effortRiskSeconds / divisor),
    tieBandSeconds: round(tieBandSeconds / divisor),
    totalSeconds: round(totalSeconds / divisor),
    hazardCount: round(hazardCount / divisor)
  };
}

function emptyLapStratum(): HeadlessLapStratum {
  return {
    raceSeconds: 0,
    carSeconds: 0,
    sideBySideSeconds: 0,
    passes: 0,
    contacts: 0,
    hardContacts: 0,
    attackInitiations: 0
  };
}

function initializeForcedStrategies(
  session: RaceSession,
  strategies: readonly ForcedHeadlessStrategy[]
): void {
  const claimed = new Set<number>();
  for (const strategy of strategies) {
    if (!Number.isInteger(strategy.entryIndex) || strategy.entryIndex < 0 ||
        strategy.entryIndex >= session.entries.length)
      throw new Error(`Invalid forced-strategy entry index ${strategy.entryIndex}`);
    if (claimed.has(strategy.entryIndex))
      throw new Error(`Duplicate forced strategy for entry ${strategy.entryIndex}`);
    claimed.add(strategy.entryIndex);
    if (!strategy.compounds.length ||
        strategy.compounds.some(compound => !(['S', 'H', 'W'] as const).includes(compound)))
      throw new Error(`Forced strategy ${strategy.entryIndex} has an invalid compound sequence`);
    if (strategy.boxLaps.length !== strategy.compounds.length - 1 ||
        strategy.boxLaps.some((lap, index) => !Number.isInteger(lap) || lap <= 0 ||
          lap >= session.laps || (index > 0 && lap <= strategy.boxLaps[index - 1]!)))
      throw new Error(`Forced strategy ${strategy.entryIndex} has invalid box laps`);
    const entry = session.entries[strategy.entryIndex]!;
    // Player entries already express externally commanded pit intent and are
    // therefore excluded from rivalPitAI without adding an audit branch to it.
    entry.isPlayer = true;
    entry.tyre = { c: strategy.compounds[0]!, wear: 0, fit: 0 };
  }
}

function applyForcedStrategyCommands(
  session: RaceSession,
  strategies: readonly ForcedHeadlessStrategy[]
): void {
  for (const strategy of strategies) {
    const entry = session.entries[strategy.entryIndex]!;
    if (entry.state !== 'run' || entry.pitArm || entry.boxArm) continue;
    const stop = entry.stops;
    const boxLap = strategy.boxLaps[stop];
    const compound = strategy.compounds[stop + 1];
    if (boxLap === undefined || compound === undefined) continue;
    const completedLaps = Math.max(0, entry.cross - 1);
    if (completedLaps >= boxLap) entry.pitArm = { comp: compound, fix: false };
  }
}

/** Run a complete multi-car race without a browser or duplicated simulation. */
export function runHeadlessRace(
  built: BuiltTrack,
  options: HeadlessRaceOptions = {}
): HeadlessRaceSummary {
  const seed = options.seed ?? 1;
  const fixedStep = options.step ?? 1 / 30;
  const laps = options.laps ?? raceLapsFor(built.prof);
  const wet = clampWet(options.wet ?? 0);
  const productionGridSize = TEAM_DEFS.reduce(
    (count, team) => count + team.drv.length,
    0
  );
  const gridSize = options.gridSize ?? productionGridSize;
  if (!Number.isFinite(fixedStep) || fixedStep <= 0) throw new Error('step must be positive');
  if (!Number.isInteger(laps) || laps <= 0) throw new Error('laps must be a positive integer');
  if (!Number.isInteger(gridSize) || gridSize <= 0 ||
      gridSize > MAXIMUM_BENCHMARK_GRID_SIZE)
    throw new Error(`gridSize must be an integer from 1 to ${MAXIMUM_BENCHMARK_GRID_SIZE}`);
  const limits = resolveDeadline({
    maxSteps: options.maxSteps ?? Math.ceil(
      (built.tr.idealTiming.lapTime * laps * 2.2 + 300) / fixedStep
    ),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  return withRandomSource(mulberry32(seed), () => {
    const session = createHeadlessRace(
      built,
      laps,
      wet,
      gridSize,
      options.predictiveSafetyHz ?? 10
    );
    session.racecraftDecisionLogging =
      options.includeRacecraftDecisionLog === true;
    const forcedStrategies = options.forcedStrategies ?? [];
    initializeForcedStrategies(session, forcedStrategies);
    let steps = 0;
    let stop: HeadlessStop['reason'] = 'step-limit';
    let finite = true;
    let passes = 0;
    let previousOrder: string[] | null = null;
    let nextOrderSample = 10;
    const recentPace = new Map<string, RecentPaceState>();
    let carSeconds = 0;
    let carMetres = 0;
    let offCourseCarSeconds = 0;
    let curbCarSeconds = 0;
    let grassCarSeconds = 0;
    let emergencyAuthorizedGrassCarSeconds = 0;
    let nonEmergencyGrassCarSeconds = 0;
    const nonEmergencyGrassCarSecondsByAuthority: Record<
      NonEmergencyGrassAuthority,
      number
    > = {
      'racecraft-side': 0,
      'racecraft-other': 0,
      pit: 0,
      recovery: 0,
      ideal: 0,
      'other-lane': 0
    };
    const observedRacecraftDecisionTimes = new Map<string, number>();
    let emergencySurfaceSelections = 0;
    let emergencySurfaceAttributionFailures = 0;
    let straightPullOutSelections = 0;
    let straightPullOutEnvelopeFractionMinimum = Infinity;
    let straightPullOutEnvelopeFractionSum = 0;
    let straightPullOutEnvelopeFractionMaximum = 0;
    let straightPullOutSignedOffsetMinimumMetres = Infinity;
    let straightPullOutSignedOffsetMaximumMetres = -Infinity;
    let obligationYieldLossSeconds = 0;
    let obligationEpisodes = 0;
    let previousObligations = new Set<string>();
    const lapStrata = options.includeLapStrata
      ? { openingLap: emptyLapStratum(), steadyState: emptyLapStratum() }
      : null;
    let previousSideBySide = 0;
    let previousContacts = 0;
    let previousHardContacts = 0;
    let previousAttackInitiations = 0;
    while (steps < limits.maximumSteps) {
      if (limits.expired(steps)) {
        stop = 'deadline';
        break;
      }
      applyForcedStrategyCommands(session, forcedStrategies);
      stepSession(session, fixedStep);
      steps++;
      const active = session.entries.filter(entry => entry.car &&
        entry.state !== 'pit' && entry.state !== 'dnf' && entry.state !== 'fin');
      const currentObligations = new Set<string>();
      const openingRegime = active.some(entry => entry.cross <= 1);
      const raceStratum = lapStrata
        ? openingRegime ? lapStrata.openingLap : lapStrata.steadyState
        : null;
      if (raceStratum) {
        raceStratum.raceSeconds += fixedStep;
        const sideBySide = session.sbsT ?? 0;
        raceStratum.sideBySideSeconds += Math.max(0, sideBySide - previousSideBySide);
        const contacts = session.hitN ?? 0;
        raceStratum.contacts += Math.max(0, contacts - previousContacts);
        const hardContacts = session.hitHard ?? 0;
        raceStratum.hardContacts += Math.max(0, hardContacts - previousHardContacts);
        const attacks = session.attackInitiations ?? 0;
        raceStratum.attackInitiations += Math.max(0, attacks - previousAttackInitiations);
        previousSideBySide = sideBySide;
        previousContacts = contacts;
        previousHardContacts = hardContacts;
        previousAttackInitiations = attacks;
      }
      carSeconds += active.length * fixedStep;
      for (const entry of active) {
        if (lapStrata) {
          const stratum = entry.cross <= 1 ? lapStrata.openingLap : lapStrata.steadyState;
          stratum.carSeconds += fixedStep;
        }
        carMetres += Math.max(0, entry.spd) * fixedStep;
        if (entry.car?.offCourse) offCourseCarSeconds += fixedStep;
        if (entry.car) {
          const sample = Math.max(0, entry.car.progIdx) % built.tr.n;
          const exposure = surfaceExposureAtLateral(built.tr, sample, entry.latNow);
          curbCarSeconds += exposure.curb * fixedStep;
          grassCarSeconds += exposure.grass * fixedStep;
          if (entry.laneProgram.surfaceAuthorization === 'emergency')
            emergencyAuthorizedGrassCarSeconds += exposure.grass * fixedStep;
          else {
            nonEmergencyGrassCarSeconds += exposure.grass * fixedStep;
            const authority = nonEmergencyGrassAuthority(entry);
            nonEmergencyGrassCarSecondsByAuthority[authority] +=
              exposure.grass * fixedStep;
          }
        }
        const decision = entry.racecraftDecision;
        if (decision &&
            observedRacecraftDecisionTimes.get(entry.code) !== decision.at) {
          observedRacecraftDecisionTimes.set(entry.code, decision.at);
          const selected = selectedRacecraftCandidate(entry);
          if (selected &&
              selected.plan.mode !== 'ideal' &&
              selected.plan.mode !== 'pit' &&
              selected.plan.surfaceAuthorization === 'emergency') {
            emergencySurfaceSelections++;
            if (!emergencySelectionHasLiveHazardProvenance(selected))
              emergencySurfaceAttributionFailures++;
          }
          const pullOut = selected
            ? straightPullOutUsage(built.tr, selected.plan)
            : null;
          if (pullOut) {
            straightPullOutSelections++;
            straightPullOutEnvelopeFractionMinimum = Math.min(
              straightPullOutEnvelopeFractionMinimum,
              pullOut.envelopeFraction
            );
            straightPullOutEnvelopeFractionSum += pullOut.envelopeFraction;
            straightPullOutEnvelopeFractionMaximum = Math.max(
              straightPullOutEnvelopeFractionMaximum,
              pullOut.envelopeFraction
            );
            straightPullOutSignedOffsetMinimumMetres = Math.min(
              straightPullOutSignedOffsetMinimumMetres,
              pullOut.signedOffsetMetres
            );
            straightPullOutSignedOffsetMaximumMetres = Math.max(
              straightPullOutSignedOffsetMaximumMetres,
              pullOut.signedOffsetMetres
            );
          }
        }
        finite = finite && !!entry.car && finiteCar(entry.car) &&
          [entry.spd, entry.latNow]
            .every(value => Number.isFinite(value) || value === Infinity);
        const sample = Math.max(0, entry.car!.progIdx) % built.tr.n;
        const curvature = built.tr.idealPath.k[sample]!;
        const pathReference = built.tr.idealPath.v[sample]!;
        const reference = Math.min(
          pathReference,
          cornerSpeedForGrip(
            curvature,
            entryDynamicMuAt(entry, session, pathReference, curvature),
            entryDownforceScale(entry)
          )
        ) * 0.9;
        const obligations = obligationsFor(session, entry, active);
        for (const obligation of obligations) {
          const key = `${entry.code}:${obligation.beneficiary.code}:` +
            obligation.reason;
          currentObligations.add(key);
          if (!previousObligations.has(key)) obligationEpisodes++;
        }
        if (obligations.length)
          obligationYieldLossSeconds += Math.max(
            0,
            1 - entry.spd / Math.max(8, reference)
          ) * fixedStep;
        const ratio = entry.spd / Math.max(8, reference);
        const pace = recentPace.get(entry.code) ?? {
          recentRatio: Math.max(0.2, ratio),
          slowSeconds: 0
        };
        pace.recentRatio = Math.max(ratio, pace.recentRatio * Math.exp(-fixedStep / 8));
        const materiallySlow = ratio < pace.recentRatio * 0.65 ||
          entry.hFail || !!entry.car?.offCourse;
        pace.slowSeconds = materiallySlow
          ? pace.slowSeconds + fixedStep
          : Math.max(0, pace.slowSeconds - fixedStep * 2);
        recentPace.set(entry.code, pace);
      }
      previousObligations = currentObligations;
      if (session.t >= nextOrderSample) {
        const order = activeOrder(session, recentPace);
        if (previousOrder) {
          const observed = countOrderPasses(previousOrder, order);
          passes += observed;
          if (raceStratum) raceStratum.passes += observed;
        }
        previousOrder = order;
        nextOrderSample += 1;
      }
      if (!finite) break;
      if (session.completionQueued) {
        stop = 'complete';
        break;
      }
    }
    const episodes = completeSideBySideEpisodes(session);
    const finishPositions = session.entries
      .filter(entry => entry.state === 'fin')
      .map(entry => entry.finPos);
    const dnfs = session.entries.filter(entry => entry.state === 'dnf').length;
    const classificationValid = session.completionQueued === true &&
      finishPositions.every(position => Number.isInteger(position) && position > 0) &&
      new Set(finishPositions).size === finishPositions.length &&
      finishPositions.length + dnfs === session.entries.length;
    const passAttempts = session.attackInitiations ?? 0;
    const passSuccesses = session.attackCompletions ?? 0;
    const decisionLog = orderedRacecraftDecisionLog(session);
    const selectedJ = selectedJDecomposition(session, decisionLog);
    const stationGaps = stationGapMetrics(session);
    const maximumPathSlew = session.entries.reduce(
      (maximum, entry) => Math.max(maximum, entry.pathMaxSlew ?? 0),
      0
    );
    const laneTargetDiscontinuityMetres = session.entries.reduce(
      (sum, entry) => sum + (entry.laneTargetDiscontinuityMetres ?? 0),
      0
    );
    const laneTargetDiscontinuities = session.entries.reduce(
      (sum, entry) => sum + (entry.laneTargetDiscontinuities ?? 0),
      0
    );
    const laneTargetNonManeuverDiscontinuities = session.entries.reduce(
      (sum, entry) => sum + (entry.laneTargetNonManeuverDiscontinuities ?? 0),
      0
    );
    const core = {
      schemaVersion: 1 as const,
      kind: 'race' as const,
      trackId: built.def.id,
      seed,
      wetStratum: wet > 0 ? 'wet' as const : 'dry' as const,
      laps,
      productionLaps: raceLapsFor(built.prof),
      finite,
      classificationValid,
      reason: stop,
      steps,
      simulatedSeconds: round(steps * fixedStep),
      exposure: {
        raceSeconds: round(session.t),
        carSeconds: round(carSeconds),
        carKilometres: round(carMetres / 1000),
        sideBySideSeconds: round(session.sbsT ?? 0),
        offCourseCarSeconds: round(offCourseCarSeconds),
        curbCarSeconds: round(curbCarSeconds),
        grassCarSeconds: round(grassCarSeconds),
        emergencyAuthorizedGrassCarSeconds: round(
          emergencyAuthorizedGrassCarSeconds
        ),
        nonEmergencyGrassCarSeconds: round(nonEmergencyGrassCarSeconds),
        nonEmergencyGrassCarSecondsByAuthority: Object.fromEntries(
          Object.entries(nonEmergencyGrassCarSecondsByAuthority).map(
            ([authority, seconds]) => [authority, round(seconds)]
          )
        ) as Record<NonEmergencyGrassAuthority, number>,
        passAttempts,
        obligationEpisodes,
        pitStops: session.entries.reduce((sum, entry) => sum + entry.stops, 0)
      },
      metrics: {
        passes,
        contacts: session.hitN ?? 0,
        contactEpisodes: contactEpisodeCount(session),
        lightContacts: Math.max(0, (session.hitN ?? 0) - (session.hitHard ?? 0)),
        hardContacts: session.hitHard ?? 0,
        maximumContinuousContactDurationSeconds: round(
          maximumContinuousContactDurationSeconds(session)
        ),
        agreementDaylightSamples:
          session.racecraftAgreementDaylightSamples ?? 0,
        agreementDaylightMeanMetres:
          (session.racecraftAgreementDaylightSamples ?? 0) > 0
            ? round(
                (session.racecraftAgreementDaylightMetresSum ?? 0) /
                  session.racecraftAgreementDaylightSamples!
              )
            : null,
        agreementDaylightMinimumMetres:
          session.racecraftAgreementDaylightMinimumMetres == null
            ? null
            : round(session.racecraftAgreementDaylightMinimumMetres),
        emergencySurfaceSelections,
        emergencySurfaceAttributionFailures,
        straightPullOutSelections,
        straightPullOutEnvelopeFractionMinimum:
          straightPullOutSelections
            ? round(straightPullOutEnvelopeFractionMinimum)
            : -1,
        straightPullOutEnvelopeFractionMean:
          straightPullOutSelections
            ? round(
                straightPullOutEnvelopeFractionSum /
                  straightPullOutSelections
              )
            : -1,
        straightPullOutEnvelopeFractionMaximum:
          straightPullOutSelections
            ? round(straightPullOutEnvelopeFractionMaximum)
            : -1,
        straightPullOutSignedOffsetMinimumMetres:
          straightPullOutSelections
            ? round(straightPullOutSignedOffsetMinimumMetres)
            : -1,
        straightPullOutSignedOffsetMaximumMetres:
          straightPullOutSelections
            ? round(straightPullOutSignedOffsetMaximumMetres)
            : -1,
        openingHardContacts: session.hitOpenHard ?? 0,
        dnfs,
        passSuccesses,
        stationGapSamples: stationGaps.samples,
        stationGapMeanMetres: round(stationGaps.mean),
        stationGapStdDevMetres: round(stationGaps.standardDeviation),
        stationGapMinimumMetres: round(stationGaps.minimum),
        stationGapMaximumMetres: round(stationGaps.maximum),
        obligationYieldLossSeconds: round(obligationYieldLossSeconds),
        obligationYieldLossSecondsPerEpisode: round(
          obligationYieldLossSeconds /
            Math.max(1, obligationEpisodes)
        ),
        utilizationMistakes: session.utilizationMistakes ?? 0,
        attackInitiations: session.attackInitiations ?? 0,
        attackCompletions: session.attackCompletions ?? 0,
        attackPaceOutcomeSamples:
          session.attackPaceOutcomeMoments?.samples ?? 0,
        attackCompletionPaceDifferentialCorrelation:
          attackPaceOutcomeCorrelation(session),
        sideBySideEpisodes: episodes.length,
        sideBySideContactEpisodes: episodes.filter(episode => episode.contact).length,
        sideBySideDurations: episodes.map(episode => round(episode.t)),
        switchbacks: session.switchbackN ?? 0,
        switchbackCompletions: session.switchbackCompletions ?? 0,
        brakeWhileAlongside: session.brakeWhileAlongsideN ?? 0,
        rearLossStraight: session.rearLossStraightN ?? 0,
        battleLapDelta: round(session.battleLapDeltaSum ?? 0),
        battleLapLossFraction: round(
          (session.battleLapDeltaSum ?? 0) /
            Math.max(1e-9, session.battleLapReferenceSum ?? 0)
        ),
        battleLapSamples: session.battleLapSamples ?? 0,
        cornerPassCounts: Object.fromEntries(
          Object.entries(session.cornerPassCounts ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([cornerId, count]) => [cornerId, {
              attempts: count.attempts,
              passes: count.passes
            }])
        ),
        softContactConcedes: 0,
        pathOutOfBoundsRejections:
          session.racecraftRejectedByConstraint?.['road-bound'] ?? 0,
        nonFiniteCandidateRejections:
          session.racecraftRejectedByConstraint?.['non-finite'] ?? 0,
        pitFalseLeaders: session.pitForeignFalseLeaders ?? 0,
        maximumPathSlew: round(maximumPathSlew),
        laneTargetDiscontinuityMetres: round(laneTargetDiscontinuityMetres),
        laneTargetDiscontinuities,
        laneTargetNonManeuverDiscontinuities,
        laneHopMetresPerCarMinute: round(
          laneTargetDiscontinuityMetres / Math.max(1e-9, carSeconds / 60)
        ),
        laneEdits: session.entries.reduce(
          (sum, entry) => sum + (entry.laneEdits ?? 0),
          0
        ),
        laneMaximumPinError: round(session.entries.reduce(
          (maximum, entry) => Math.max(maximum, entry.laneMaximumPinError ?? 0),
          0
        )),
        laneUnpinnedEdits: session.entries.reduce(
          (sum, entry) => sum + (entry.laneUnpinnedEdits ?? 0),
          0
        ),
        maximumCandidates: session.racecraftMaximumCandidates ?? 0,
        maximumPathsMaterialized: session.racecraftPathsMaterialized ?? 0,
        candidatesEvaluated: session.racecraftCandidatesEvaluated ?? 0,
        pathsMaterialized: session.racecraftPathsMaterialized ?? 0,
        racecraftDecisionSwitches: session.racecraftDecisionSwitches ?? 0,
        racecraftDeliberations: session.racecraftDeliberations ?? 0,
        racecraftTacticalPublications:
          session.racecraftTacticalPublications ?? 0,
        racecraftOffSlotPublicationAttempts:
          session.racecraftOffSlotPublicationAttempts ?? 0,
        racecraftSameSlotReopenings:
          session.racecraftSameSlotReopenings ?? 0,
        racecraftNestedResponseEvaluations:
          session.racecraftNestedResponseEvaluations ?? 0,
        racecraftDirectIdealDecisions:
          session.racecraftDirectIdealDecisions ?? 0,
        racecraftDirectFollowDecisions:
          session.racecraftDirectFollowDecisions ?? 0,
        racecraftDirectFollowWithoutCertificates:
          session.racecraftDirectFollowWithoutCertificates ?? 0,
        racecraftStagedCandidatesOpened:
          session.racecraftStagedCandidatesOpened ?? 0,
        racecraftStagedCandidatesRejected:
          session.racecraftStagedCandidatesRejected ?? 0,
        racecraftStagedCandidatesSelected:
          session.racecraftStagedCandidatesSelected ?? 0,
        racecraftStagedCandidatesCleared:
          session.racecraftStagedCandidatesCleared ?? 0,
        racecraftStagedAcquisitionConstrainedSeconds: round(
          session.racecraftStagedAcquisitionConstrainedSeconds ?? 0
        ),
        racecraftCommittedAttackViews:
          session.racecraftCommittedAttackViews ?? 0,
        racecraftDefensiveResponses:
          session.racecraftDefensiveResponses ?? 0,
        racecraftDefensiveMovesCommitted:
          session.racecraftDefensiveMovesCommitted ?? 0,
        racecraftDefensiveMovesContinued:
          session.racecraftDefensiveMovesContinued ?? 0,
        racecraftDefensiveMovesResetAtExit:
          session.racecraftDefensiveMovesResetAtExit ?? 0,
        racecraftDefensiveRoomProtectedCovers:
          session.racecraftDefensiveRoomProtectedCovers ?? 0,
        racecraftDefensiveAuthorizedSideClosures:
          session.racecraftDefensiveAuthorizedSideClosures ?? 0,
        racecraftDefensiveAuthorizedApproachConflicts:
          session.racecraftDefensiveAuthorizedApproachConflicts ?? 0,
        racecraftDefensivePreConsumptionSafetyInterventions:
          session.racecraftDefensivePreConsumptionSafetyInterventions ?? 0,
        racecraftSwitchbackFamilyChanges:
          session.racecraftSwitchbackFamilyChanges ?? 0,
        racecraftOwnershipAssertions:
          session.racecraftOwnershipAssertions ?? 0,
        racecraftOwnershipCurrentValidations:
          session.racecraftOwnershipCurrentValidations ?? 0,
        racecraftOwnershipInvalidations:
          session.racecraftOwnershipInvalidations ?? 0,
        racecraftDefenderReclaims:
          session.racecraftDefenderReclaims ?? 0,
        racecraftMaximumSingleFileTrainLength:
          session.racecraftMaximumSingleFileTrainLength ?? 0,
        racecraftLongestSingleFileTrainSeconds: round(
          session.racecraftLongestSingleFileTrainSeconds ?? 0
        ),
        racecraftFasterCarBlockedSeconds: round(
          session.racecraftFasterCarBlockedSeconds ?? 0
        ),
        predictiveSafetyHz: session.config.predictiveSafetyHz,
        predictiveSafetyIntervalTicks:
          session.racecraftPredictiveSafetyIntervalTicks,
        racecraftSafetyPasses: session.racecraftSafetyPasses ?? 0,
        racecraftSafetyInterventions:
          session.racecraftSafetyInterventions ?? 0,
        racecraftInteractionSamples: Object.values(
          session.racecraftInteractionSamples ?? {}
        ).reduce((sum, count) => sum + (count ?? 0), 0),
        racecraftLiftSamplesOutsideBlue: Object.entries(
          session.racecraftLiftSamples ?? {}
        ).reduce((sum, [cause, count]) =>
          sum + (cause === 'blue-flag' ? 0 : count ?? 0), 0),
        racecraftBlueLiftSamples:
          session.racecraftLiftSamples?.['blue-flag'] ?? 0,
        racecraftBlueForcedSpanSamples:
          session.racecraftBlueForcedSpanSamples ?? 0,
        racecraftBlueForcedLiftSamples:
          session.racecraftBlueForcedLiftSamples ?? 0,
        racecraftBlueLiftOutsideForcedSpan:
          session.racecraftBlueLiftOutsideForcedSpan ?? 0,
        racecraftReactionEvents: session.racecraftReactionEvents ?? 0,
        racecraftReactionRatePerLap: round(
          (session.racecraftReactionEvents ?? 0) /
            Math.max(1, completedCarLaps(session))
        ),
        racecraftEmergencyLifts: session.racecraftEmergencyLifts ?? 0,
        racecraftExpiredPrograms: session.racecraftExpiredPrograms ?? 0,
        racecraftWanderingSeconds:
          round(session.racecraftWanderingSeconds ?? 0),
        unexplainedStalls: session.unexplainedStalls?.length ?? 0,
        pitDeadlocks: session.pitDeadlocks?.length ?? 0,
      },
      diagnostics: {
        candidateRejections: Object.fromEntries(
          Object.entries(session.racecraftRejectedByConstraint ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
        ),
        laneDiscontinuityReasons: aggregateLaneDiscontinuityReasons(session.entries),
        laneEditReasons: aggregateLaneEditReasons(session.entries),
        racecraftInteractionSamples: Object.fromEntries(
          Object.entries(session.racecraftInteractionSamples ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
        ),
        racecraftLiftSamples: Object.fromEntries(
          Object.entries(session.racecraftLiftSamples ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
        ),
        racecraftCornerDecisions: Object.fromEntries(
          Object.entries(session.racecraftCornerDecisions ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([cornerId, count]) => [cornerId, { ...count }])
        ),
        racecraftSelectedJ: selectedJ,
        racecraftEvaluatorWork: {
          ...session.racecraftEvaluatorWork
        },
        racecraftDeliberationsByCar: {
          ...session.racecraftDeliberationsByCar
        },
        racecraftPublicationsByCar: {
          ...session.racecraftPublicationsByCar
        },
        racecraftDirectDecisionProofs: {
          ...session.racecraftDirectDecisionProofs
        },
        racecraftOwnershipInvalidationsByReason: {
          ...session.racecraftOwnershipInvalidationsByReason
        },
        racecraftDefensiveCandidateRejections: {
          ...session.racecraftDefensiveCandidateRejections
        },
        racecraftDefensiveMinimumNoticeSecondsByOutcome:
          Object.fromEntries(
            Object.entries(
              session
                .racecraftDefensiveMinimumNoticeSecondsByOutcome ??
                {}
            ).map(([outcome, seconds]) => [
              outcome,
              round(seconds)
            ])
          ),
        racecraftDefensiveMinimumAlongsideSecondsByOutcome:
          Object.fromEntries(
            Object.entries(
              session
                .racecraftDefensiveMinimumAlongsideSecondsByOutcome ??
                {}
            ).map(([outcome, seconds]) => [
              outcome,
              round(seconds)
            ])
          ),
        racecraftSafetyPredicateRuns: {
          ...session.racecraftSafetyPredicateRuns
        },
        pitDeadlocks: (session.pitDeadlocks ?? []).map(record => ({
          ...record,
          time: round(record.time),
          pitW: round(record.pitW)
        })),
        pitStates: session.entries
          .filter(entry => entry.pitW != null && Number.isFinite(entry.pitW))
          .map(entry => ({
            code: entry.code,
            state: entry.state,
            pitW: round(entry.pitW!),
            phase: entry.pitPhase ?? 'none',
            waitReason: entry.pitWaitReason ?? null,
            waitOwner: entry.pitWaitOwner ?? null,
            speed: round(entry.spd),
            lateral: round(entry.latNow),
            target: round(targetAbsLat(session.trk, entry)),
            pathMode: entry.pathMode ?? 'ideal'
          })),
        ...(options.includeClassificationDiagnostics
          ? { classification: session.entries.map(entry =>
              classificationDiagnostic(session.trk, entry)) }
          : {})
      },
      ...(lapStrata ? {
        lapStrata: {
          openingLap: Object.fromEntries(Object.entries(lapStrata.openingLap)
            .map(([key, value]) => [key, round(value)])) as unknown as HeadlessLapStratum,
          steadyState: Object.fromEntries(Object.entries(lapStrata.steadyState)
            .map(([key, value]) => [key, round(value)])) as unknown as HeadlessLapStratum
        }
      } : {})
    };
    return {
      ...core,
      checksum: checksum(core),
      ...(forcedStrategies.length ? {
        strategyResults: forcedStrategies.map(strategy => {
          const entry = session.entries[strategy.entryIndex]!;
          return {
            entryIndex: strategy.entryIndex,
            code: entry.code,
            finishPosition: entry.finPos,
            finishTime: round(entry.finT),
            stops: entry.stops,
            finalCompound: entry.tyre.c
          };
        })
      } : {}),
      ...(options.includePerformanceDiagnostics
        ? { performance: {
            retainedPitPaths: session.entries.filter(entry =>
              entry.pathPlan?.mode === 'pit' && !!entry.path
            ).length,
            retainedDecisionCandidates: session.entries.reduce(
              (count, entry) =>
                count + (entry.racecraftDecision?.candidates.length ?? 0),
              0
            )
          } }
        : {}),
      ...(options.includeRacecraftDecisionLog
        ? { racecraftDecisionLog: decisionLog }
        : {})
    };
  });
}

function clampWet(value: number): number {
  if (!Number.isFinite(value)) throw new Error('wet must be finite');
  return Math.max(0, Math.min(0.95, value));
}

function placeEntry(
  session: Session,
  entry: Entry,
  index: number,
  speed: number,
  lateral: number,
  longitudinal: number,
  cross: number
): void {
  const track = session.trk;
  const wrapped = ((Math.round(index) % track.n) + track.n) % track.n;
  const heading = Math.atan2(track.ty[wrapped]!, track.tx[wrapped]!);
  entry.car = makeCar(
    track.x[wrapped]! + track.nx[wrapped]! * lateral + track.tx[wrapped]! * longitudinal,
    track.y[wrapped]! + track.ny[wrapped]! * lateral + track.ty[wrapped]! * longitudinal,
    heading
  );
  entry.car.vx = speed;
  entry.car.spd = speed;
  entry.car.s = ((wrapped * track.step + longitudinal) % track.len + track.len) % track.len;
  entry.car.progIdx = wrapped;
  entry.state = 'run';
  entry.spd = speed;
  entry.lat = lateral - track.idealPath.off[wrapped]!;
  entry.latNow = lateral;
  entry.cross = cross;
  entry.prog = cross * track.len + entry.car.s;
  clearLaneProgram(entry, 'audit-placement');
  // Focused placement establishes the initial state; it is not a live lane
  // edit. Seed the already-measured residual directly so the first controller
  // sample mirrors an equivalent car that arrived here under its own power.
  entry.laneProgram.bias = entry.lat;
  entry.rlap.started = true;
  entry.rlap.nextCp = track.cps.length;
}

function placeEntryAtProgress(
  session: Session,
  entry: Entry,
  progress: number,
  speed: number,
  lateral: number
): void {
  const track = session.trk;
  const cross = Math.floor(progress / track.len);
  const s = ((progress % track.len) + track.len) % track.len;
  const index = Math.round(s / track.step) % track.n;
  let longitudinal = s - index * track.step;
  if (longitudinal > track.len / 2) longitudinal -= track.len;
  if (longitudinal < -track.len / 2) longitudinal += track.len;
  placeEntry(session, entry, index, speed, lateral, longitudinal, cross);
}

function idealLateralAtProgress(session: Session, progress: number): number {
  const s = ((progress % session.trk.len) + session.trk.len) % session.trk.len;
  const index = Math.round(s / session.trk.step) % session.trk.n;
  return session.trk.idealPath.off[index]!;
}

interface StraightWindow {
  startI: number;
  brakeI: number;
  distance: number;
  corner: Corner;
}

function longestStraight(track: Session['trk']): StraightWindow {
  if (!track.corners.length) throw new Error(`Track ${track.def.id} has no corners`);
  const ordered = [...track.corners].sort((left, right) => left.apexI - right.apexI);
  let best: StraightWindow | null = null;
  for (let index = 0; index < ordered.length; index++) {
    const corner = ordered[index]!;
    const previous = ordered[(index - 1 + ordered.length) % ordered.length]!;
    const startI = (previous.trackOutI + Math.max(2, Math.round(8 / track.step))) % track.n;
    const distance = ((corner.brakeI - startI + track.n) % track.n) * track.step;
    // Overlapping corner descriptors inside a complex can have the next
    // brake marker before the previous track-out. That wrapped distance is
    // not a straight; it is the rest of the lap.
    if (distance >= track.len / 2) continue;
    if (!best || distance > best.distance)
      best = { startI, brakeI: corner.brakeI, distance, corner };
  }
  return best!;
}

function bestPassCorner(track: Session['trk']): Corner {
  const corner = [...track.corners].sort((left, right) =>
    right.passScore - left.passScore || left.approachI - right.approachI)[0];
  if (!corner) throw new Error(`Track ${track.def.id} has no corners`);
  return corner;
}

interface SwitchbackScenario {
  corner: Corner;
  completion: SwitchbackCompletionWindow;
}

function switchbackScenario(track: Session['trk']): SwitchbackScenario {
  const selected = track.corners
    .map(corner => ({
      corner,
      completion: switchbackCompletionWindow(track, corner)
    }))
    .filter((item): item is SwitchbackScenario => item.completion !== null)
    .sort((left, right) =>
      right.corner.passScore - left.corner.passScore ||
      left.corner.approachI - right.corner.approachI)[0];
  if (!selected)
    throw new Error(`Track ${track.def.id} has no physical switchback completion window`);
  return selected;
}

function overUnderScenario(track: Session['trk']): SwitchbackScenario {
  const selected = track.corners
    // A focused pair cannot be initialized straddling start/finish: the
    // production lap tracker correctly owns that discontinuity, while this
    // sub-lap probe owns only the maneuver window.
    .filter(corner => corner.approachI <= corner.trackOutI)
    .map(corner => ({
      corner,
      completion: switchbackCompletionWindow(track, corner)
    }))
    .filter((item): item is SwitchbackScenario => item.completion !== null)
    .sort((left, right) =>
      right.corner.passScore * right.completion.distance -
        left.corner.passScore * left.completion.distance ||
      left.corner.approachI - right.corner.approachI)[0];
  if (!selected)
    throw new Error(`Track ${track.def.id} has no physical over-under completion window`);
  return selected;
}

function signedSampleDistance(track: Session['trk'], from: number, to: number): number {
  let samples = to - from;
  if (samples > track.n / 2) samples -= track.n;
  if (samples < -track.n / 2) samples += track.n;
  return samples;
}

function spotSelectionCorners(track: Session['trk']): { first: Corner; selected: Corner } {
  for (const first of track.corners) {
    const candidates = track.corners
      .filter(candidate => candidate.id !== first.id)
      .map(candidate => ({
        candidate,
        distance: ((candidate.approachI - first.exitI + track.n) % track.n) * track.step
      }))
      .filter(item => item.distance < track.len / 2)
      .sort((left, right) => left.distance - right.distance);
    const second = candidates[0]?.candidate;
    if (second && second.passScore > first.passScore + 1e-9)
      return { first, selected: second };
  }
  const first = track.corners[0];
  if (!first) throw new Error(`Track ${track.def.id} has no corners`);
  return { first, selected: first };
}

function setPitPose(
  session: Session,
  entry: Entry,
  pitW: number,
  speed: number,
  lateral: number
): void {
  const track = session.trk;
  const s = ((track.pit.sEntry + pitW) % track.len + track.len) % track.len;
  const index = Math.round(s / track.step) % track.n;
  placeEntry(session, entry, index, speed, lateral, 0, 1);
  entry.pitW = pitW;
  entry.car!.s = s;
  entry.car!.progIdx = index;
}

function focusedIndex(session: Session, options: FocusedSessionOptions): number {
  const side = options.side;
  const corner = session.trk.corners.find(candidate =>
    (side === undefined || candidate.side === side) && candidate.isolated) ??
    session.trk.corners.find(candidate => side === undefined || candidate.side === side) ??
    session.trk.corners[0];
  if (!corner) throw new Error(`Track ${session.trk.def.id} has no corners`);
  if (options.phase === 'corner') return corner.turnInI;
  if (options.phase === 'straight') {
    let best = 0;
    let bestCurvature = Infinity;
    for (let index = 0; index < session.trk.n; index++) {
      const curvature = Math.abs(session.trk.idealPath.k[index]!);
      const inCorner = session.trk.corners.some(candidate => {
        const span = (candidate.trackOutI - candidate.approachI + session.trk.n) % session.trk.n;
        const offset = (index - candidate.approachI + session.trk.n) % session.trk.n;
        return offset <= span;
      });
      if (!inCorner && curvature < bestCurvature) {
        bestCurvature = curvature;
        best = index;
      }
    }
    return best;
  }
  return corner.approachI;
}

function focusedSpeed(track: Session['trk'], index: number, scale = 0.92): number {
  return Math.max(18, Math.min(PHYS.vTop * 0.88, track.idealPath.v[index]! * scale));
}

function trainPressureWindow(
  track: Session['trk']
): { straight: StraightWindow; speed: number; seconds: number } {
  const straight = longestStraight(track);
  const speed = focusedSpeed(track, straight.startI, 0.86);
  return {
    straight,
    speed,
    seconds: straight.distance / speed
  };
}

function seedFocusedAttack(
  session: Session,
  attacker: Entry,
  target: Entry,
  _corner: Corner | null,
  _side: number,
  duration: number
): void {
  beginAttackEpisode(session, attacker, target);
  extendAttackEpisode(session, attacker, target, duration + TRAF_DT * 2);
}

function applyFocusedCondition(entry: Entry, wear: number | undefined, stress: number | undefined): void {
  if (wear !== undefined) entry.tyre.wear = Math.max(0, Math.min(1.15, wear));
  if (stress !== undefined) entry.stress = Math.max(0, Math.min(1, stress));
}

function setupFocusedScenario(session: Session, options: FocusedSessionOptions): void {
  const scenario = options.scenario;
  const [first, second, third, fourth] = session.entries as [Entry, Entry, Entry?, Entry?];
  applyFocusedCondition(first, options.firstTyreWear, options.firstStress);
  applyFocusedCondition(second, options.secondTyreWear, options.secondStress);
  if (scenario !== 'pit' && scenario !== 'priority' && scenario !== 'classification') {
    session.goT = session.t - START_BLEND_END - 20;
    if (session.mode === 'race') session.laps = Math.max(session.laps, 12);
    first._recentCleanLap = session.trk.idealTiming!.lapTime;
    second._recentCleanLap = session.trk.idealTiming!.lapTime;
  }

  if (scenario === 'faster-behind') {
    const straight = longestStraight(session.trk);
    const speed = focusedSpeed(session.trk, straight.startI, 0.88);
    const gap = options.initialGapM ?? speed * 1.5;
    const frontProgress = 2 * session.trk.len + straight.startI * session.trk.step + gap + 10;
    first.lu.margin = 0.968;
    second.lu.margin = 0.94;
    first.mods.hMu = options.attackerGripScale ?? 1.045;
    placeEntryAtProgress(session, first, frontProgress - gap, speed,
      idealLateralAtProgress(session, frontProgress - gap));
    placeEntryAtProgress(session, second, frontProgress, speed,
      idealLateralAtProgress(session, frontProgress));
    return;
  }
  if (scenario === 'alongside-straight') {
    const straight = longestStraight(session.trk);
    const progress = 2 * session.trk.len + straight.startI * session.trk.step + 20;
    const speed = focusedSpeed(session.trk, straight.startI, 0.9);
    const line = idealLateralAtProgress(session, progress);
    placeEntryAtProgress(session, first, progress - 0.4, speed + 0.8, line - 1.3);
    placeEntryAtProgress(session, second, progress, speed, line + 1.3);
    first.lu.margin = 0.965;
    second.lu.margin = 0.95;
    seedFocusedAttack(session, first, second, null, line - 1.3,
      options.simulatedSeconds ?? 15);
    return;
  }
  if (scenario === 'tow-run') {
    const straight = longestStraight(session.trk);
    const rearDistance = 10;
    const rearProgress = 2 * session.trk.len + straight.startI * session.trk.step + rearDistance;
    const rearIndex = Math.round(
      (((rearProgress % session.trk.len) + session.trk.len) % session.trk.len) /
        session.trk.step
    ) % session.trk.n;
    const speed = Math.max(30, Math.min(40, session.trk.idealPath.v[rearIndex]! * 0.9));
    const gap = options.initialGapM ?? speed;
    const frontProgress = rearProgress + gap;
    first.lu.margin = second.lu.margin = 0.955;
    first.mods.hMu = second.mods.hMu = 1;
    placeEntryAtProgress(session, first, rearProgress, speed,
      idealLateralAtProgress(session, rearProgress));
    placeEntryAtProgress(session, second, frontProgress, speed,
      idealLateralAtProgress(session, frontProgress));
    return;
  }
  if (scenario === 'near-touch-tow') {
    const straight = longestStraight(session.trk);
    const midpoint = (straight.startI +
      Math.round(straight.distance / (2 * session.trk.step))) % session.trk.n;
    const leaderProgress = 2 * session.trk.len +
      straight.startI * session.trk.step + straight.distance / 2;
    const centreGap = PHYS.carLen + NEAR_TOUCH_CLEARANCE_METRES;
    const followerProgress = leaderProgress - centreGap;
    const speed = focusedSpeed(session.trk, midpoint, 0.98);
    first.lu.margin = second.lu.margin = 0.955;
    first.mods.hMu = second.mods.hMu = 1;
    placeEntryAtProgress(session, first, followerProgress, speed,
      idealLateralAtProgress(session, followerProgress));
    placeEntryAtProgress(session, second, leaderProgress, speed,
      idealLateralAtProgress(session, leaderProgress));
    return;
  }
  if (scenario === 'drag-pass') {
    const straight = longestStraight(session.trk);
    const startDistance = Math.min(PHYS.carLen * 2, straight.distance / 4);
    const followerProgress = 2 * session.trk.len +
      straight.startI * session.trk.step + startDistance;
    const leaderProgress = followerProgress + PHYS.carLen + NEAR_TOUCH_CLEARANCE_METRES;
    const index = Math.round(
      (((followerProgress % session.trk.len) + session.trk.len) % session.trk.len) /
        session.trk.step
    ) % session.trk.n;
    const speed = focusedSpeed(session.trk, index, 0.96);
    const calibration = racecraftCalibration();
    const wakeStrength = wakeEffect(
      PHYS.carLen + NEAR_TOUCH_CLEARANCE_METRES,
      0,
      speed,
      {
        characteristicDistance: calibration.towRangeM,
        spreadRate: calibration.wakeSpreadRate
      }
    ).drag;
    const towReduction = calibration.towDragReduction * wakeStrength;
    const towOverspeed = speed *
      (Math.pow(1 / Math.max(0.05, 1 - towReduction), 1 / 3) - 1);
    const line = idealLateralAtProgress(session, followerProgress);
    const freeSide = line >= 0 ? -1 : 1;
    const duration = straight.distance / Math.max(1, speed) +
      ATTACK_COMPLETION_WINDOW_SECONDS;
    first.lu.margin = second.lu.margin = 0.955;
    first.mods.hMu = second.mods.hMu = 1;
    placeEntryAtProgress(session, first, followerProgress,
      Math.min(PHYS.vTop, speed + towOverspeed), line);
    placeEntryAtProgress(session, second, leaderProgress, speed,
      idealLateralAtProgress(session, leaderProgress));
    seedFocusedAttack(
      session,
      first,
      second,
      null,
      line + freeSide * PHYS.carWid,
      duration
    );
    return;
  }
  if (scenario === 'tucked-follow') {
    const straight = longestStraight(session.trk);
    const leaderProgress = 2 * session.trk.len + straight.startI * session.trk.step + 20;
    const speed = focusedSpeed(session.trk, straight.startI, 0.9);
    const centreGap = PHYS.carLen + (options.initialGapM ?? 3);
    first.lu.margin = second.lu.margin = 0.955;
    first.mods.hMu = second.mods.hMu = 1;
    const mistakeFreeWindow = options.simulatedSeconds ??
      session.trk.idealTiming!.lapTime * 1.5 + 20;
    first.mistT = second.mistT = mistakeFreeWindow + 1;
    placeEntryAtProgress(session, first, leaderProgress - centreGap, speed,
      idealLateralAtProgress(session, leaderProgress - centreGap));
    placeEntryAtProgress(session, second, leaderProgress, speed,
      idealLateralAtProgress(session, leaderProgress));
    return;
  }
  if (scenario === 'side-by-side-corner') {
    const corner = bestPassCorner(session.trk);
    const progress = 2 * session.trk.len + corner.approachI * session.trk.step;
    const speed = focusedSpeed(session.trk, corner.approachI, 0.88);
    const line = idealLateralAtProgress(session, progress);
    placeEntryAtProgress(session, first, progress - 0.25, speed, line + corner.side * 1.3);
    placeEntryAtProgress(session, second, progress, speed, line - corner.side * 1.3);
    seedFocusedAttack(session, first, second, corner, corner.side * 2.2,
      options.simulatedSeconds ?? 20);
    return;
  }
  if (scenario === 'light-rub') {
    const straight = longestStraight(session.trk);
    const progress = 2 * session.trk.len + straight.startI * session.trk.step + 20;
    const speed = focusedSpeed(session.trk, straight.startI, 0.82);
    const separation = PHYS.carWid - 0.05;
    const line = idealLateralAtProgress(session, progress);
    placeEntryAtProgress(session, first, progress - 0.15, speed, line - separation / 2);
    placeEntryAtProgress(session, second, progress, speed, line + separation / 2);
    first.car!.vy = 0.3;
    second.car!.vy = -0.3;
    seedFocusedAttack(session, first, second, straight.corner, line - separation / 2,
      options.simulatedSeconds ?? 8);
    return;
  }
  if (scenario === 'defense-legality') {
    const corner = bestPassCorner(session.trk);
    const coverTarget = corner.side * 2.8 * 0.8;
    let leadDistance = PHYS.carLen;
    let startI = corner.brakeI;
    let speed = focusedSpeed(session.trk, startI, 0.88);
    // Put the canary at the first physically settled defense opportunity so
    // its timing remains derived from vehicle capability and track geometry.
    for (let iteration = 0; iteration < 3; iteration++) {
      const leadSamples = Math.max(2, Math.ceil(leadDistance / session.trk.step));
      startI = (corner.brakeI - leadSamples + session.trk.n) % session.trk.n;
      speed = focusedSpeed(session.trk, startI, 0.88);
      const grip = availableDeceleration(
        speed,
        entryMu(second, session.wet),
        entryDownforceScale(second)
      );
      const lateralDemand = speed * speed * Math.abs(session.trk.idealPath.k[startI]!);
      const lateralHeadroom = Math.sqrt(Math.max(
        0,
        grip * grip - lateralDemand * lateralDemand
      ));
      const moveSeconds = physicalLateralMoveSeconds(
        speed,
        coverTarget - session.trk.idealPath.off[startI]!,
        lateralHeadroom
      );
      leadDistance = PATH_FOLLOWER_SETTLE_DISTANCE +
        speed * (moveSeconds + TRAF_DT * 2);
    }
    const frontProgress = 2 * session.trk.len + startI * session.trk.step;
    const committed = options.defenseVariant === 'committed';
    const centreGap = PHYS.carLen * 3;
    const attackerProgress = frontProgress - centreGap;
    const attackerLateral = idealLateralAtProgress(session, attackerProgress) +
      (committed ? corner.side * 1.3 : 0);
    placeEntryAtProgress(
      session,
      first,
      attackerProgress,
      speed + 5,
      attackerLateral
    );
    placeEntryAtProgress(session, second, frontProgress, speed,
      idealLateralAtProgress(session, frontProgress));
    if (committed) {
      first._previousTrafficLateral = first.latNow -
        corner.side * (PHYS.carWid / 2) * TRAF_DT;
      first.car!.vy = corner.side * PHYS.carWid / 2;
    }
    first.lu.focus = second.lu.focus = 1;
    seedFocusedAttack(session, first, second, corner, corner.side * 2.8,
      options.simulatedSeconds ?? 15);
    return;
  }
  if (scenario === 'inside-pass' || scenario === 'outside-pass') {
    const corner = bestPassCorner(session.trk);
    const approachProgress = 2 * session.trk.len +
      corner.approachI * session.trk.step;
    const speed = focusedSpeed(session.trk, corner.approachI, 0.9);
    const centreGap = PHYS.carLen + session.trk.step / 2;
    const duration = ((corner.exitI - corner.approachI + session.trk.n) %
      session.trk.n) * session.trk.step / Math.max(1, speed) +
      ATTACK_COMPLETION_WINDOW_SECONDS;
    const inside = scenario === 'inside-pass';
    first.lu.margin = 0.968;
    second.lu.margin = 0.94;
    first.mods.hMu = options.attackerGripScale ?? 1.06;
    second.mods.hMu = 1;
    placeEntryAtProgress(session, first, approachProgress - centreGap, speed + 3,
      idealLateralAtProgress(session, approachProgress - centreGap));
    placeEntryAtProgress(session, second, approachProgress, speed,
      idealLateralAtProgress(session, approachProgress));
    seedFocusedAttack(
      session,
      first,
      second,
      corner,
      (inside ? corner.side : -corner.side) * PHYS.carWid,
      duration
    );
    return;
  }
  if (scenario === 'attack-launch') {
    first.lu.margin = 0.968;
    second.lu.margin = 0.94;
    first.mods.hMu = options.attackerGripScale ?? 1.045;
    second.mods.hMu = 1;
    const straight = longestStraight(session.trk);
    const corner = straight.corner;
    if (!corner.alternateLines?.inside)
      throw new Error(`Track ${session.trk.def.id} has no inside line for attack-launch`);
    const speed = focusedSpeed(session.trk, straight.startI, 0.9);
    const attackerProgress = 2 * session.trk.len + straight.startI * session.trk.step;
    const leaderProgress = attackerProgress + PHYS.carLen * 2;
    const referenceLapSeconds = session.trk.idealTiming?.lapTime ??
      session.prof.lapTime;
    // This is the faster-behind economic canary. Seed measured prior-lap
    // evidence and a matching physical close; the evaluator must author the
    // attack, while attackEpisodes remains an observation-only consequence.
    first.lastLap = referenceLapSeconds / first.lu.margin;
    second.lastLap = referenceLapSeconds / second.lu.margin;
    placeEntryAtProgress(
      session,
      first,
      attackerProgress,
      speed + (options.closingSpeedMps ?? 3),
      idealLateralAtProgress(session, attackerProgress));
    placeEntryAtProgress(session, second, leaderProgress, speed,
      idealLateralAtProgress(session, leaderProgress));
    return;
  }
  if (scenario === 'switchback' || scenario === 'over-under') {
    const { corner, completion } = scenario === 'over-under'
      ? overUnderScenario(session.trk)
      : switchbackScenario(session.trk);
    const outside = corner.alternateLines?.outside.idealRejoin;
    if (!outside)
      throw new Error(`Track ${session.trk.def.id} has no outside switchback line`);
    const speed = focusedSpeed(session.trk, outside.brakeI, 0.88);
    const grip = availableDeceleration(
      speed,
      entryMu(first, session.wet),
      entryDownforceScale(first)
    );
    const lateralDemand = speed * speed * Math.abs(
      session.trk.idealPath.k[outside.brakeI]!
    );
    const lateralHeadroom = Math.sqrt(Math.max(
      0,
      grip * grip - lateralDemand * lateralDemand
    ));
    const moveSeconds = physicalLateralMoveSeconds(
      speed,
      sampleCornerLineEta(session.trk, corner, outside, outside.brakeI),
      lateralHeadroom
    );
    if (!Number.isFinite(moveSeconds))
      throw new Error(`Track ${session.trk.def.id} has no physical switchback launch`);
    const approachProgress = 2 * session.trk.len + corner.approachI * session.trk.step;
    const brakeProgress = approachProgress +
      signedSampleDistance(session.trk, corner.approachI, outside.brakeI) *
        session.trk.step;
    const attackerProgress = brakeProgress - speed * moveSeconds - PHYS.carLen;
    const leaderProgress = attackerProgress + PHYS.carLen +
      (scenario === 'over-under'
        ? options.initialGapM ?? PHYS.carLen * 2
        : speed * RACECRAFT_DECISION_INTERVAL_SECONDS);
    if (scenario === 'over-under') {
      first.lu.margin = 0.968;
      second.lu.margin = 0.95;
      first.mods.hMu = options.attackerGripScale ?? 1.04;
      second.mods.hMu = 1;
    }
    placeEntryAtProgress(session, first, attackerProgress, speed,
      idealLateralAtProgress(session, attackerProgress));
    placeEntryAtProgress(session, second, leaderProgress, speed,
      idealLateralAtProgress(session, leaderProgress));
    const completionProgress = approachProgress +
      ((completion.endIndex - corner.approachI + session.trk.n) % session.trk.n) *
        session.trk.step;
    const duration = (completionProgress - attackerProgress) / speed +
      RACECRAFT_DECISION_INTERVAL_SECONDS;
    seedFocusedAttack(session, first, second, corner, corner.side * PHYS.carWid,
      options.simulatedSeconds ?? duration);
    return;
  }
  if (scenario === 'spot-selection') {
    const selection = spotSelectionCorners(session.trk);
    const frontProgress = 2 * session.trk.len + selection.first.approachI * session.trk.step;
    const speed = focusedSpeed(session.trk, selection.first.approachI, 0.88);
    placeEntryAtProgress(session, first, frontProgress - 13, speed + 1.8,
      idealLateralAtProgress(session, frontProgress - 13));
    placeEntryAtProgress(session, second, frontProgress, speed,
      idealLateralAtProgress(session, frontProgress));
    first.lu.margin = 0.968;
    second.lu.margin = 0.94;
    first.mods.hMu = options.attackerGripScale ?? 1.04;
    return;
  }
  if (scenario === 'train-pressure') {
    if (!third || !fourth) throw new Error('train-pressure requires four entries');
    const { straight, speed } = trainPressureWindow(session.trk);
    const leaderProgress = 2 * session.trk.len + straight.startI * session.trk.step + 40;
    const train = [first, second, third, fourth];
    train.forEach((entry, index) => {
      entry.lu.margin = 0.955;
      entry.mods.hMu = 1;
      entry._recentCleanLap = session.trk.idealTiming!.lapTime;
      const progress = leaderProgress - (3 - index) * 10;
      placeEntryAtProgress(session, entry, progress,
        index === 3 ? speed * 0.915 : speed, idealLateralAtProgress(session, progress));
    });
    fourth.mods.pw = 0.915;
    return;
  }
  if (scenario === 'solo-baseline') {
    const corner = bestPassCorner(session.trk);
    const progress = 2 * session.trk.len + corner.approachI * session.trk.step;
    placeEntryAtProgress(session, first, progress,
      focusedSpeed(session.trk, corner.approachI, 0.88),
      idealLateralAtProgress(session, progress));
    second.state = 'dnf';
    second.car = null;
    return;
  }
  if (scenario === 'pair') {
    const corner = session.trk.corners.find(candidate =>
      (options.side === undefined || candidate.side === options.side) && candidate.isolated) ??
      session.trk.corners.find(candidate => options.side === undefined || candidate.side === options.side) ??
      session.trk.corners[0];
    if (!corner) throw new Error(`Track ${session.trk.def.id} has no corners`);
    const index = options.phase ? focusedIndex(session, options) : corner.approachI;
    const closing = options.closingSpeedMps ?? 0.5;
    if (options.attackerGripScale !== undefined)
      first.mods.hMu = options.attackerGripScale;
    const gap = options.initialGapM;
    if (gap === undefined) {
      placeEntry(session, first, index, 30.5 + closing, corner.side * 1.1, -1, 2);
      placeEntry(session, second, index, 30.5, -corner.side * 1.1, 1, 2);
    } else {
      const behind = Math.max(1, Math.round((gap + PHYS.carLen) / session.trk.step));
      placeEntry(session, first, index - behind, 30.5 + closing, corner.side * 0.3, 0, 2);
      placeEntry(session, second, index, 30.5, -corner.side * 0.3, 0, 2);
    }
    beginAttackEpisode(session, first, second);
    // This constructed probe owns an explicit execution window. Keep its one
    // attributed episode alive for that window so it measures completion,
    // rather than the production eligibility timeout that the probe bypassed.
    extendAttackEpisode(
      session,
      first,
      second,
      (options.simulatedSeconds ?? 8) + TRAF_DT * 2
    );
    if (third) {
      const behind = Math.max(2, Math.round(8 / session.trk.step));
      placeEntry(session, third, index - behind, 31.5, 0, -1.5, 2);
      beginAttackEpisode(session, third, second);
    }
    return;
  }
  if (scenario === 'pit') {
    const firstBox = session.trk.pit.boxWAt(first.ti);
    const secondBox = session.trk.pit.boxWAt(second.ti);
    setPitPose(session, first, Math.max(8, firstBox - 18), 12, session.trk.pit.laneOff);
    first.state = 'pitIn';
    first.pitPhase = 'ingress';
    first.pitArm = { comp: 'S', fix: false };
    if (options.pitControl) {
      second.state = 'dnf';
      second.car = null;
      return;
    }
    setPitPose(session, second, secondBox, 0, session.trk.pit.boxOff);
    second.state = 'pit';
    second.pitPhase = 'stopped-box';
    second.pitT = 60;
    return;
  }
  if (scenario === 'priority') {
    const index = focusedIndex(session, options);
    const yieldingSpeed = 25;
    const closing = options.closingSpeedMps ?? 9;
    const gap = options.initialGapM ?? 28;
    placeEntry(session, first, index, yieldingSpeed, 0, 0, 1);
    const behind = Math.max(2, Math.round((gap + PHYS.carLen) / session.trk.step));
    placeEntry(session, second, index - behind, yieldingSpeed + closing, 0, 0,
      session.mode === 'race' && !options.priorityDisabled ? 2 : 1);
    if (session.mode === 'quali') {
      first.lapPhase = options.priorityDisabled
        ? 'flying'
        : options.qualifyingYieldPhase ?? 'out';
      first.lapLive = first.lapPhase === 'flying';
      second.lapPhase = 'flying';
      second.lapLive = true;
    }
    return;
  }
  const back = Math.max(3, Math.round(14 / session.trk.step));
  placeEntry(session, first, session.trk.n - back, 25, -1.5, 0, 1);
  placeEntry(session, second, session.trk.n - back - 4, 24, 1.5, 0, 1);
  if (session.mode !== 'race')
    throw new Error('classification focus requires a race session');
  session.laps = 1;
}

function stableEventType(event: SessionEvent): string {
  return event.type === 'session-complete' ? `${event.type}:${event.kind}` : event.type;
}

function stableEntry(entry: Entry): StableEntryState {
  return {
    code: entry.code,
    state: entry.state,
    cross: entry.cross,
    finishPosition: entry.finPos,
    pathMode: entry.pathMode ?? 'ideal',
    pitPhase: entry.pitPhase ?? '',
    s: entry.car ? round(entry.car.s) : null,
    speed: round(entry.spd),
    lateral: round(entry.latNow)
  };
}

function aggregateLaneEditReasons(entries: readonly Entry[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    for (const [reason, count] of Object.entries(entry.laneEditReasons ?? {}))
      totals[reason] = (totals[reason] ?? 0) + count;
  }
  return Object.fromEntries(
    Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))
  );
}

function aggregateLaneDiscontinuityReasons(entries: readonly Entry[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    for (const [reason, count] of Object.entries(entry.laneDiscontinuityReasons ?? {}))
      totals[reason] = (totals[reason] ?? 0) + count;
  }
  return Object.fromEntries(
    Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))
  );
}

function minimumDynamicLaneSpeed(entries: readonly Entry[]): number {
  let minimum = PHYS.vTop;
  for (const entry of entries) {
    if (entry.path)
      for (const speed of entry.path.v) minimum = Math.min(minimum, speed);
    const envelope = entry.racecraftLongitudinalProgram?.envelope;
    if (envelope)
      for (let index = 0; index < envelope.segmentCount; index++) {
        const start = envelope.segmentStartProgress[index]!;
        const end = envelope.segmentEndProgress[index]!;
        minimum = Math.min(
          minimum,
          speedEnvelopeAt(envelope, start),
          speedEnvelopeAt(envelope, end)
        );
      }
    const lane = entry.laneBuffer;
    if (!lane || lane.uniformBias !== null) continue;
    for (let slot = 0; slot < lane.count; slot++)
      minimum = Math.min(minimum, lane.v[slot]!);
  }
  return minimum;
}

function maximumDynamicLaneCurvature(
  track: Track,
  entries: readonly Entry[]
): number {
  let maximum = 0;
  for (const entry of entries) {
    if (entry.path)
      for (const curvature of entry.path.k)
        maximum = Math.max(maximum, Math.abs(curvature));
    const program = entry.racecraftLateralProgram;
    if (program)
      for (let index = 0; index < program.segmentCount; index++) {
        const start = program.segmentStartProgress[index]!;
        const end = program.segmentEndProgress[index]!;
        for (const progress of [start, (start + end) / 2, end])
          maximum = Math.max(
            maximum,
            Math.abs(compactLateralGeometryAtProgress(
              track,
              program,
              progress
            ).curvature)
          );
      }
    const lane = entry.laneBuffer;
    if (!lane || lane.uniformBias !== null) continue;
    for (let slot = 0; slot < lane.count; slot++)
      maximum = Math.max(maximum, Math.abs(lane.k[slot]!));
  }
  return maximum;
}

function classificationDiagnostic(track: Track, entry: Entry) {
  return {
    ...stableEntry(entry),
    carVelocity: [round(entry.car?.vx ?? 0), round(entry.car?.vy ?? 0)] as [number, number],
    input: [
      round(entry.inp.steer), round(entry.inp.throttle), round(entry.inp.brake)
    ] as [number, number, number],
    targetLateral: round(targetAbsLat(track, entry)),
    fuel: round(entry.fuel),
    failures: [entry.hFail, entry.cFail] as [boolean, boolean],
    recovery: [round(entry.recT), round(entry.avoidT)] as [number, number],
    reverse: entry.car?.rev ?? false,
    offCourse: entry.car?.offCourse ?? false,
    notes: [...entry.notes]
  };
}

const AUDIT_FOCUSED_SCENARIOS: readonly AuditFocusedScenario[] = [
  'faster-behind',
  'alongside-straight',
  'tow-run',
  'near-touch-tow',
  'side-by-side-corner',
  'light-rub',
  'defense-legality',
  'attack-launch',
  'inside-pass',
  'outside-pass',
  'over-under',
  'drag-pass',
  'switchback',
  'spot-selection',
  'train-pressure',
  'tucked-follow',
  'solo-baseline'
];

const ALL_FOCUSED_SCENARIOS: readonly FocusedScenario[] = [
  'pair', 'pit', 'priority', 'classification', ...AUDIT_FOCUSED_SCENARIOS
];

/** Acceptance boundary from trajectory-revamp plan §6; audit-only, never a driving law. */
const NEAR_TOUCH_CLEARANCE_METRES = 3;

function isAuditFocusedScenario(scenario: FocusedScenario): scenario is AuditFocusedScenario {
  return (AUDIT_FOCUSED_SCENARIOS as readonly string[]).includes(scenario);
}

interface FocusedAuditState {
  opened: boolean;
  openedAt: number;
  initialFirstProgress: number;
  initialSecondProgress: number;
  initialSignedDistance: number;
  previousFirstS: number;
  previousSecondS: number;
  firstTravelMetres: number;
  secondTravelMetres: number;
  initialContacts: number;
  initialHardContacts: number;
  initialAttackInitiations: number;
  initialAttackCompletions: number;
  initialSwitchbacks: number;
  initialSwitchbackCompletions: number;
  initialDefensiveMovesCommitted: number;
  initialDefensiveAuthorizedSideClosures: number;
  initialBrakeAlongside: number;
  initialRearLoss: number;
  targetProgress: number;
  brakeProgress: number;
  expectedCornerApex: number;
  minimumBodyClearance: number;
  minimumStraightBodyClearance: number;
  brakeBodyClearance: number;
  minimumLateralSeparation: number;
  maximumLateralSeparation: number;
  maximumTow: number;
  contactAt: number;
  contactSeedSeen: boolean;
  agreementSeen: boolean;
  sideBySideSeen: boolean;
  battleSurvivedContact: boolean;
  firstMarkerSeconds: number;
  secondMarkerSeconds: number;
  tuckedAuthoritySeconds: number;
  tuckedAuthorityLost: boolean;
  tuckedMaximumEtaError: number;
  tuckedMaximumCommandEtaError: number;
  tuckedMaximumTrackingError: number;
  tuckedCommandErrorAtSeconds: number;
  tuckedCommandErrorLeaderEta: number;
  tuckedCommandErrorFollowerEta: number;
  tuckedCommandErrorFollowerCommandEta: number;
  tuckedCommandErrorProgressGap: number;
  tuckedCommandErrorFollowerPointSpan: number;
  tuckedCommandErrorLeaderPointSpan: number;
  tuckedFirstLaneSpeedDeficit: number;
  tuckedSecondLaneSpeedDeficit: number;
  tuckedGeometrySeconds: number;
  escapeAvailableSeen: boolean;
  previousAuditAt: number;
  defenseMoveBeforeBrake: boolean;
  defenseMoveAfterBrake: boolean;
  selectedCornerSeen: boolean;
  expectedLineKind: 'inside' | 'outside' | null;
  lineKindSeen: boolean;
  trackOutProgress: number;
  trackOutObserved: boolean;
  behindAtTrackOut: boolean;
  fullClearanceProgress: number;
  firstAheadSeen: boolean;
  firstAttackGap: number;
  hardFailure: string;
  verdict: 'green' | 'red' | null;
  verdictReason: string;
  previousDefenderLateral: number;
  previousDefenderProgress: number;
  decisionTimes: Record<string, number>;
  evaluatorSteerSelections: number;
  evaluatorBrakeSelections: number;
  evaluatorHoldSelections: number;
  straightPullOutSelections: number;
  straightPullOutEnvelopeFractionMinimum: number;
  straightPullOutEnvelopeFractionSum: number;
  straightPullOutEnvelopeFractionMaximum: number;
  straightPullOutSignedOffsetMinimumMetres: number;
  straightPullOutSignedOffsetMaximumMetres: number;
  emergencySurfaceSelections: number;
  emergencySurfaceAttributionFailures: number;
  contestLateralSelections: number;
  contestBrakeSelections: number;
  contestInlineSelections: number;
  sideBySideCornerSpanActive: boolean;
  sideBySideCornerSpanSilent: boolean;
  sideBySideCornerSilentSpans: number;
  sideBySideCornerSilentSeconds: number;
  sideBySideCornerContestedSeconds: number;
  leaderMaximumCommandDeviation: number;
  leaderFollowerBrakeEvents: number;
  leaderFollowerBrakeActive: boolean;
  endingBodyClearance: number;
  derivedFollowBodyFloor: number;
  leaderTrackingErrorThreshold: number;
}

function focusedProgressAtIndex(session: Session, entry: Entry, index: number): number {
  if (!entry.car) return Infinity;
  return entry.prog +
    ((index - Math.max(0, entry.car.progIdx) + session.trk.n) % session.trk.n) *
      session.trk.step;
}

function makeFocusedAuditState(): FocusedAuditState {
  return {
    opened: false,
    openedAt: 0,
    initialFirstProgress: 0,
    initialSecondProgress: 0,
    initialSignedDistance: 0,
    previousFirstS: 0,
    previousSecondS: 0,
    firstTravelMetres: 0,
    secondTravelMetres: 0,
    initialContacts: 0,
    initialHardContacts: 0,
    initialAttackInitiations: 0,
    initialAttackCompletions: 0,
    initialSwitchbacks: 0,
    initialSwitchbackCompletions: 0,
    initialDefensiveMovesCommitted: 0,
    initialDefensiveAuthorizedSideClosures: 0,
    initialBrakeAlongside: 0,
    initialRearLoss: 0,
    targetProgress: Infinity,
    brakeProgress: Infinity,
    expectedCornerApex: -1,
    minimumBodyClearance: Infinity,
    minimumStraightBodyClearance: Infinity,
    brakeBodyClearance: Infinity,
    minimumLateralSeparation: Infinity,
    maximumLateralSeparation: 0,
    maximumTow: 0,
    contactAt: -1,
    contactSeedSeen: false,
    agreementSeen: false,
    sideBySideSeen: false,
    battleSurvivedContact: false,
    firstMarkerSeconds: -1,
    secondMarkerSeconds: -1,
    tuckedAuthoritySeconds: 0,
    tuckedAuthorityLost: false,
    tuckedMaximumEtaError: 0,
    tuckedMaximumCommandEtaError: 0,
    tuckedMaximumTrackingError: 0,
    tuckedCommandErrorAtSeconds: -1,
    tuckedCommandErrorLeaderEta: 0,
    tuckedCommandErrorFollowerEta: 0,
    tuckedCommandErrorFollowerCommandEta: 0,
    tuckedCommandErrorProgressGap: 0,
    tuckedCommandErrorFollowerPointSpan: 0,
    tuckedCommandErrorLeaderPointSpan: 0,
    tuckedFirstLaneSpeedDeficit: 0,
    tuckedSecondLaneSpeedDeficit: 0,
    tuckedGeometrySeconds: 0,
    escapeAvailableSeen: false,
    previousAuditAt: 0,
    defenseMoveBeforeBrake: false,
    defenseMoveAfterBrake: false,
    selectedCornerSeen: false,
    expectedLineKind: null,
    lineKindSeen: false,
    trackOutProgress: Infinity,
    trackOutObserved: false,
    behindAtTrackOut: false,
    fullClearanceProgress: -1,
    firstAheadSeen: false,
    firstAttackGap: -1,
    hardFailure: '',
    verdict: null,
    verdictReason: 'assertion window exhausted',
    previousDefenderLateral: 0,
    previousDefenderProgress: 0,
    decisionTimes: {},
    evaluatorSteerSelections: 0,
    evaluatorBrakeSelections: 0,
    evaluatorHoldSelections: 0,
    straightPullOutSelections: 0,
    straightPullOutEnvelopeFractionMinimum: Infinity,
    straightPullOutEnvelopeFractionSum: 0,
    straightPullOutEnvelopeFractionMaximum: 0,
    straightPullOutSignedOffsetMinimumMetres: Infinity,
    straightPullOutSignedOffsetMaximumMetres: -Infinity,
    emergencySurfaceSelections: 0,
    emergencySurfaceAttributionFailures: 0,
    contestLateralSelections: 0,
    contestBrakeSelections: 0,
    contestInlineSelections: 0,
    sideBySideCornerSpanActive: false,
    sideBySideCornerSpanSilent: true,
    sideBySideCornerSilentSpans: 0,
    sideBySideCornerSilentSeconds: 0,
    sideBySideCornerContestedSeconds: 0,
    leaderMaximumCommandDeviation: 0,
    leaderFollowerBrakeEvents: 0,
    leaderFollowerBrakeActive: false,
    endingBodyClearance: Infinity,
    derivedFollowBodyFloor: 0,
    leaderTrackingErrorThreshold: 0
  };
}

function openFocusedAudit(
  session: Session,
  options: FocusedSessionOptions,
  state: FocusedAuditState
): void {
  const [first, second] = session.entries as [Entry, Entry];
  state.opened = true;
  state.openedAt = session.t;
  state.previousAuditAt = session.t;
  state.initialFirstProgress = first.prog;
  state.initialSecondProgress = second.prog;
  state.previousFirstS = first.car?.s ?? 0;
  state.previousSecondS = second.car?.s ?? 0;
  state.initialSignedDistance = state.previousFirstS - state.previousSecondS;
  if (state.initialSignedDistance > session.trk.len / 2)
    state.initialSignedDistance -= session.trk.len;
  if (state.initialSignedDistance < -session.trk.len / 2)
    state.initialSignedDistance += session.trk.len;
  if (options.scenario === 'near-touch-tow' || options.scenario === 'drag-pass')
    state.minimumStraightBodyClearance =
      Math.abs(state.initialSignedDistance) - PHYS.carLen;
  state.initialContacts = session.hitN ?? 0;
  state.initialHardContacts = session.hitHard ?? 0;
  state.initialAttackInitiations = session.attackInitiations ?? 0;
  state.initialAttackCompletions = session.attackCompletions ?? 0;
  state.initialSwitchbacks = session.switchbackN ?? 0;
  state.initialSwitchbackCompletions = session.switchbackCompletions ?? 0;
  state.initialDefensiveMovesCommitted =
    session.racecraftDefensiveMovesCommitted ?? 0;
  state.initialDefensiveAuthorizedSideClosures =
    session.racecraftDefensiveAuthorizedSideClosures ?? 0;
  state.initialBrakeAlongside = session.brakeWhileAlongsideN ?? 0;
  state.initialRearLoss = session.rearLossStraightN ?? 0;
  state.previousDefenderLateral = second.latNow;
  state.previousDefenderProgress = second.prog;
  if (options.scenario === 'tow-run' || options.scenario === 'near-touch-tow' ||
      options.scenario === 'drag-pass' ||
      options.scenario === 'alongside-straight') {
    const straight = longestStraight(session.trk);
    state.targetProgress = focusedProgressAtIndex(
      session,
      second,
      options.scenario === 'near-touch-tow'
        ? straight.corner.turnInI
        : straight.brakeI
    );
    state.brakeProgress = focusedProgressAtIndex(
      session,
      second,
      straight.corner.brakeI
    );
    state.expectedCornerApex = straight.corner.apexI;
  } else if (options.scenario === 'side-by-side-corner' ||
      options.scenario === 'defense-legality') {
    const corner = bestPassCorner(session.trk);
    state.targetProgress = focusedProgressAtIndex(session, second, corner.exitI);
    state.brakeProgress = focusedProgressAtIndex(session, second, corner.brakeI);
    state.expectedCornerApex = corner.apexI;
  } else if (options.scenario === 'inside-pass' ||
      options.scenario === 'outside-pass') {
    const corner = bestPassCorner(session.trk);
    state.targetProgress = focusedProgressAtIndex(session, second, corner.exitI);
    state.brakeProgress = focusedProgressAtIndex(session, second, corner.brakeI);
    state.trackOutProgress = focusedProgressAtIndex(session, second, corner.trackOutI);
    state.expectedCornerApex = corner.apexI;
    state.expectedLineKind = options.scenario === 'inside-pass' ? 'inside' : 'outside';
  } else if (options.scenario === 'attack-launch') {
    const corner = longestStraight(session.trk).corner;
    state.targetProgress = focusedProgressAtIndex(session, first, corner.turnInI);
    state.brakeProgress = focusedProgressAtIndex(session, first, corner.brakeI);
    state.expectedCornerApex = corner.apexI;
  } else if (options.scenario === 'solo-baseline') {
    const corner = bestPassCorner(session.trk);
    state.targetProgress = focusedProgressAtIndex(session, first, corner.exitI);
    state.brakeProgress = focusedProgressAtIndex(session, first, corner.brakeI);
    state.expectedCornerApex = corner.apexI;
  } else if (options.scenario === 'switchback' || options.scenario === 'over-under') {
    const { corner, completion } = options.scenario === 'over-under'
      ? overUnderScenario(session.trk)
      : switchbackScenario(session.trk);
    state.brakeProgress = focusedProgressAtIndex(
      session,
      second,
      completion.startIndex
    );
    state.targetProgress = state.brakeProgress + completion.distance;
    state.trackOutProgress = state.brakeProgress;
    state.expectedCornerApex = corner.apexI;
    state.expectedLineKind = 'outside';
  } else if (options.scenario === 'spot-selection') {
    const selection = spotSelectionCorners(session.trk);
    state.targetProgress = focusedProgressAtIndex(session, second, selection.selected.exitI);
    state.expectedCornerApex = selection.selected.apexI;
  } else if (options.scenario === 'faster-behind') {
    state.targetProgress = session.trk.len * 3;
  } else if (options.scenario === 'train-pressure') {
    state.targetProgress = session.t + trainPressureWindow(session.trk).seconds;
  } else if (options.scenario === 'tucked-follow') {
    state.targetProgress = session.trk.len;
  }
}

function focusedHardFailure(session: Session): string {
  if (session.entries.some(entry => entry.car && !finiteCar(entry.car))) return 'non-finite-state';
  if ((session.racecraftMaximumCandidates ?? 0) > 6) return 'candidate-limit';
  if ((session.racecraftPathsMaterialized ?? 0) > 0) return 'materialization-limit';
  if ((session.unexplainedStalls?.length ?? 0) > 0) return 'unexplained-stall';
  if ((session.pitDeadlocks?.length ?? 0) > 0) return 'pit-deadlock';
  return '';
}

function focusedPublicationContest(session: Session, entry: Entry): boolean {
  const own = session.racecraftClaims?.get(entry.code);
  if (!own) return false;
  for (const other of session.entries) {
    if (other === entry || !other.car) continue;
    const claim = session.racecraftClaims?.get(other.code);
    if (claim && publishedTrajectoriesContestedRegion(
      session.trk,
      own,
      claim
    ))
      return true;
  }
  return false;
}

function focusedCornerAt(
  session: Session,
  entry: Entry
): Corner | null {
  if (!entry.car) return null;
  const index = Math.max(0, entry.car.progIdx) % session.trk.n;
  for (const corner of session.trk.corners) {
    const span = (
      corner.exitI - corner.approachI + session.trk.n
    ) % session.trk.n;
    const fromApproach = (
      index - corner.approachI + session.trk.n
    ) % session.trk.n;
    if (fromApproach <= span) return corner;
  }
  return null;
}

function updateFocusedAudit(
  session: Session,
  options: FocusedSessionOptions,
  state: FocusedAuditState
): void {
  if (!state.opened || state.verdict) return;
  const [first, second] = session.entries as [Entry, Entry];
  const observationSeconds = Math.max(0, session.t - state.previousAuditAt);
  state.previousAuditAt = session.t;
  state.hardFailure ||= focusedHardFailure(session);
  if (state.hardFailure) {
    state.verdict = 'red';
    state.verdictReason = state.hardFailure;
    return;
  }
  for (const observed of session.entries) {
    const decision = observed.racecraftDecision;
    if (!decision || state.decisionTimes[observed.code] === decision.at) continue;
    state.decisionTimes[observed.code] = decision.at;
    const selected = decision.candidates.find(candidate =>
      candidate.plan.key === decision.selectedPlanKey);
    if (decision.selectedKind === 'brake-behind')
      state.evaluatorBrakeSelections++;
    else if (decision.selectedKind === 'corner-inside' ||
        decision.selectedKind === 'corner-outside')
      state.evaluatorSteerSelections++;
    else state.evaluatorHoldSelections++;
    const pullOut = selected
      ? straightPullOutUsage(session.trk, selected.plan)
      : null;
    if (pullOut) {
      state.straightPullOutSelections++;
      state.straightPullOutEnvelopeFractionMinimum = Math.min(
        state.straightPullOutEnvelopeFractionMinimum,
        pullOut.envelopeFraction
      );
      state.straightPullOutEnvelopeFractionSum += pullOut.envelopeFraction;
      state.straightPullOutEnvelopeFractionMaximum = Math.max(
        state.straightPullOutEnvelopeFractionMaximum,
        pullOut.envelopeFraction
      );
      state.straightPullOutSignedOffsetMinimumMetres = Math.min(
        state.straightPullOutSignedOffsetMinimumMetres,
        pullOut.signedOffsetMetres
      );
      state.straightPullOutSignedOffsetMaximumMetres = Math.max(
        state.straightPullOutSignedOffsetMaximumMetres,
        pullOut.signedOffsetMetres
      );
    }
    if (options.scenario === 'near-touch-tow' &&
        observed === first &&
        observed.prog < state.brakeProgress &&
        decision.candidates.some(candidate =>
          candidate.feasible &&
          candidate.plan.mode !== 'ideal' &&
          candidate.plan.mode !== 'pit' &&
          candidate.plan.surfaceAuthorization !== 'emergency' &&
          candidate.plan.leaderCode === second.code &&
          (candidate.kind === 'corner-inside' ||
            candidate.kind === 'corner-outside' ||
            straightPullOutUsage(session.trk, candidate.plan) != null)
        ))
      state.escapeAvailableSeen = true;
    if (selected &&
        selected.plan.mode !== 'ideal' &&
        selected.plan.mode !== 'pit' &&
        selected.plan.surfaceAuthorization === 'emergency') {
      state.emergencySurfaceSelections++;
      if (!emergencySelectionHasLiveHazardProvenance(selected))
        state.emergencySurfaceAttributionFailures++;
    }
    if (focusedPublicationContest(session, observed)) {
      if (decision.selectedKind === 'brake-behind')
        state.contestBrakeSelections++;
      else if (decision.selectedKind === 'corner-inside' ||
          decision.selectedKind === 'corner-outside')
        state.contestLateralSelections++;
      else state.contestInlineSelections++;
    }
  }
  if (first.car && second.car) {
    let firstStep = first.car.s - state.previousFirstS;
    let secondStep = second.car.s - state.previousSecondS;
    if (firstStep < -session.trk.len / 2) firstStep += session.trk.len;
    if (firstStep > session.trk.len / 2) firstStep -= session.trk.len;
    if (secondStep < -session.trk.len / 2) secondStep += session.trk.len;
    if (secondStep > session.trk.len / 2) secondStep -= session.trk.len;
    state.firstTravelMetres += firstStep;
    state.secondTravelMetres += secondStep;
    state.previousFirstS = first.car.s;
    state.previousSecondS = second.car.s;
    const relativeTravel = state.initialSignedDistance +
      state.firstTravelMetres - state.secondTravelMetres;
    if (relativeTravel > 1e-6) state.firstAheadSeen = true;
    let signedDistance = first.car.s - second.car.s;
    if (signedDistance > session.trk.len / 2) signedDistance -= session.trk.len;
    if (signedDistance < -session.trk.len / 2) signedDistance += session.trk.len;
    if (state.firstAttackGap < 0 &&
        (session.attackInitiations ?? 0) > state.initialAttackInitiations)
      state.firstAttackGap = Math.abs(signedDistance);
    const bodyClearance = Math.abs(signedDistance) - PHYS.carLen;
    state.minimumBodyClearance = Math.min(state.minimumBodyClearance, bodyClearance);
    if (options.scenario === 'faster-behind') {
      const leaderCommandEta = second.laneProgram.points.length
        ? evaluateLaneEta(second.laneProgram.points, second.prog).eta
        : second.laneProgram.bias;
      state.leaderMaximumCommandDeviation = Math.max(
        state.leaderMaximumCommandDeviation,
        Math.abs(leaderCommandEta)
      );
      const followerAttributedBrake =
        (second.racecraftLongitudinalProgram?.slowPointOwnerCode ??
          second.trafficSlowPoint?.ownerCode) === first.code &&
        (second.inp.brake > 0.05 || second.inp.throttle < 0.05);
      if (followerAttributedBrake && !state.leaderFollowerBrakeActive)
        state.leaderFollowerBrakeEvents++;
      state.leaderFollowerBrakeActive = followerAttributedBrake;
      state.endingBodyClearance = bodyClearance;
      state.derivedFollowBodyFloor =
        oneIntervalPhysicalDivergence(session, second);
    }
    if (options.scenario === 'near-touch-tow') {
      if (second.prog < state.brakeProgress)
        state.minimumStraightBodyClearance = Math.min(
          state.minimumStraightBodyClearance,
          bodyClearance
        );
      if (second.prog >= state.brakeProgress && second.prog <= state.targetProgress)
        state.brakeBodyClearance = Number.isFinite(state.brakeBodyClearance)
          ? Math.max(state.brakeBodyClearance, bodyClearance)
          : bodyClearance;
    }
    state.minimumLateralSeparation = Math.min(
      state.minimumLateralSeparation,
      Math.abs(first.latNow - second.latNow)
    );
    state.maximumLateralSeparation = Math.max(
      state.maximumLateralSeparation,
      Math.abs(first.latNow - second.latNow)
    );
    const selected = first.racecraftDecision?.candidates.find(candidate =>
      candidate.plan.key === first.racecraftDecision?.selectedPlanKey);
    if (state.expectedLineKind && selected?.plan.mode !== 'ideal' &&
        selected?.plan.mode !== 'pit' &&
        selected?.plan.lineKind === state.expectedLineKind)
      state.lineKindSeen = true;
    if (state.fullClearanceProgress < 0 && first.prog - second.prog >= PHYS.carLen)
      state.fullClearanceProgress = first.prog;
    if (!state.trackOutObserved && Number.isFinite(state.trackOutProgress) &&
        Math.min(first.prog, second.prog) >= state.trackOutProgress) {
      state.trackOutObserved = true;
      state.behindAtTrackOut = first.prog - second.prog < PHYS.carLen;
    }
  }
  state.maximumTow = Math.max(state.maximumTow, first.tow || 0);
  const contacts = (session.hitN ?? 0) - state.initialContacts;
  if (contacts > 0 && state.contactAt < 0) state.contactAt = session.t;
  if (Object.values(session.roomPairs ?? {}).some(pair => pair.contactSeed))
    state.contactSeedSeen = true;
  if ((session.sideAgreements?.size ?? 0) > 0) state.agreementSeen = true;
  if (first._alongsideWith === second.code || second._alongsideWith === first.code)
    state.sideBySideSeen = true;
  const firstCorner = focusedCornerAt(session, first);
  const secondCorner = focusedCornerAt(session, second);
  const sideBySideCorner =
    !!firstCorner &&
    firstCorner.id === secondCorner?.id &&
    (first._alongsideWith === second.code ||
      second._alongsideWith === first.code ||
      (session.sideAgreements?.size ?? 0) > 0);
  if (sideBySideCorner) {
    const selectedHazards = [first, second].map(entry =>
      entry.racecraftDecision?.candidates.find(candidate =>
        candidate.plan.key === entry.racecraftDecision?.selectedPlanKey
      )?.hazardCount ?? 0
    );
    const silent = selectedHazards.every(count => count === 0);
    if (!state.sideBySideCornerSpanActive) {
      state.sideBySideCornerSpanActive = true;
      state.sideBySideCornerSpanSilent = true;
    }
    state.sideBySideCornerSpanSilent &&= silent;
    if (silent)
      state.sideBySideCornerSilentSeconds += observationSeconds;
    else
      state.sideBySideCornerContestedSeconds += observationSeconds;
  } else if (state.sideBySideCornerSpanActive) {
    if (state.sideBySideCornerSpanSilent)
      state.sideBySideCornerSilentSpans++;
    state.sideBySideCornerSpanActive = false;
    state.sideBySideCornerSpanSilent = true;
  }
  if (state.contactAt >= 0 && session.t - state.contactAt >= 0.5 &&
      (state.sideBySideSeen || (session.attackEpisodes?.size ?? 0) > 0 ||
        state.agreementSeen))
    state.battleSurvivedContact = true;
  if (options.scenario === 'tucked-follow') {
    const firstIndex = Math.max(0, first.car?.progIdx ?? 0) % session.trk.n;
    const secondIndex = Math.max(0, second.car?.progIdx ?? 0) % session.trk.n;
    const firstEta = first.latNow - session.trk.idealPath.off[firstIndex]!;
    const leaderEta = second.racecraftLateralProgram
      ? sampleCompactLateralProgram(
          session.trk,
          second.racecraftLateralProgram,
          second.prog
        ).value - session.trk.idealPath.off[secondIndex]!
      : second.laneProgram.points.length
        ? evaluateLaneEta(second.laneProgram.points, second.prog).eta
        : second.laneProgram.bias;
    const firstCommandEta = first.racecraftLateralProgram
      ? sampleCompactLateralProgram(
          session.trk,
          first.racecraftLateralProgram,
          first.prog
        ).value - session.trk.idealPath.off[firstIndex]!
      : first.laneProgram.points.length
        ? evaluateLaneEta(first.laneProgram.points, first.prog).eta
        : first.laneProgram.bias;
    state.tuckedMaximumEtaError = Math.max(
      state.tuckedMaximumEtaError,
      Math.abs(firstEta - leaderEta)
    );
    const commandEtaError = Math.abs(firstCommandEta - leaderEta);
    if (commandEtaError > state.tuckedMaximumCommandEtaError) {
      state.tuckedMaximumCommandEtaError = commandEtaError;
      state.tuckedCommandErrorAtSeconds = session.t - state.openedAt;
      state.tuckedCommandErrorLeaderEta = leaderEta;
      state.tuckedCommandErrorFollowerEta = firstEta;
      state.tuckedCommandErrorFollowerCommandEta = firstCommandEta;
      state.tuckedCommandErrorProgressGap = second.prog - first.prog;
      const firstLast = first.laneProgram.points.at(-1);
      const secondLast = second.laneProgram.points.at(-1);
      state.tuckedCommandErrorFollowerPointSpan =
        first.racecraftLateralProgram
          ? first.racecraftLateralProgram.endProgress - first.prog
          : firstLast
            ? firstLast.s - first.prog
            : 0;
      state.tuckedCommandErrorLeaderPointSpan =
        second.racecraftLateralProgram
          ? second.racecraftLateralProgram.endProgress - second.prog
          : secondLast
            ? secondLast.s - second.prog
            : 0;
    }
    state.tuckedMaximumTrackingError = Math.max(
      state.tuckedMaximumTrackingError,
      Math.abs(firstEta - firstCommandEta)
    );
    const firstLaneSpeed = first.racecraftLongitudinalProgram
      ? speedEnvelopeAt(
          first.racecraftLongitudinalProgram.envelope,
          first.prog
        )
      : first.laneBuffer?.count &&
          first.laneBuffer.startIndex === firstIndex
        ? first.laneBuffer.v[0]!
        : session.trk.idealPath.v[firstIndex]!;
    const secondLaneSpeed = second.racecraftLongitudinalProgram
      ? speedEnvelopeAt(
          second.racecraftLongitudinalProgram.envelope,
          second.prog
        )
      : second.laneBuffer?.count &&
          second.laneBuffer.startIndex === secondIndex
        ? second.laneBuffer.v[0]!
        : session.trk.idealPath.v[secondIndex]!;
    state.tuckedFirstLaneSpeedDeficit += Math.max(
      0,
      session.trk.idealPath.v[firstIndex]! - firstLaneSpeed
    ) * observationSeconds;
    state.tuckedSecondLaneSpeedDeficit += Math.max(
      0,
      session.trk.idealPath.v[secondIndex]! - secondLaneSpeed
    ) * observationSeconds;
    state.tuckedGeometrySeconds += observationSeconds;
    if (first.racecraftDecision != null)
      state.tuckedAuthoritySeconds += observationSeconds;
    else if (state.tuckedAuthoritySeconds > 0)
      state.tuckedAuthorityLost = true;
    if (state.firstMarkerSeconds < 0 && state.firstTravelMetres >= state.targetProgress)
      state.firstMarkerSeconds = session.t - state.openedAt;
    if (state.secondMarkerSeconds < 0 && state.secondTravelMetres >= state.targetProgress)
      state.secondMarkerSeconds = session.t - state.openedAt;
  } else {
    if (state.firstMarkerSeconds < 0 && first.prog >= state.targetProgress)
      state.firstMarkerSeconds = session.t - state.openedAt;
    if (state.secondMarkerSeconds < 0 && second.prog >= state.targetProgress)
      state.secondMarkerSeconds = session.t - state.openedAt;
  }
  const selectedMotion = first.racecraftDecision?.candidates.find(candidate =>
    candidate.plan.key === first.racecraftDecision?.selectedPlanKey);
  const selectedPlan = selectedMotion?.plan;
  if (selectedPlan && selectedPlan.mode !== 'ideal' &&
      selectedPlan.mode !== 'pit') {
    const selectedCorner = session.trk.corners.find(corner =>
      corner.id === selectedPlan.cornerId);
    if (selectedCorner?.apexI === state.expectedCornerApex)
      state.selectedCornerSeen = true;
  }

  if (options.scenario === 'defense-legality') {
    const moved = Math.abs(second.latNow - state.previousDefenderLateral) > 0.003;
    const defensiveMotion =
      second.racecraftDefensiveCommitment != null ||
      second.racecraftDecision?.defensiveTargetCode != null;
    if (defensiveMotion && moved) {
      if (second.prog < state.brakeProgress)
        state.defenseMoveBeforeBrake = true;
      else if (!state.defenseMoveBeforeBrake)
        state.defenseMoveAfterBrake = true;
    }
    state.previousDefenderLateral = second.latNow;
    state.previousDefenderProgress = second.prog;
  }

  const hardContacts = (session.hitHard ?? 0) - state.initialHardContacts;
  const brakeAlongside = (session.brakeWhileAlongsideN ?? 0) - state.initialBrakeAlongside;
  const rearLoss = (session.rearLossStraightN ?? 0) - state.initialRearLoss;
  if (hardContacts > 0) {
    state.verdict = 'red';
    state.verdictReason = 'hard contact';
    return;
  }
  if ((options.scenario === 'alongside-straight' && (brakeAlongside > 0 || rearLoss > 0)) ||
      (options.scenario === 'defense-legality' &&
        state.defenseMoveAfterBrake)) {
    state.verdict = 'red';
    state.verdictReason = brakeAlongside > 0 ? 'braking while alongside' :
      rearLoss > 0 ? 'straight-line rear loss' :
      'defense moved in braking zone';
    return;
  }

  const completions = (session.attackCompletions ?? 0) - state.initialAttackCompletions;
  if (options.scenario === 'faster-behind') {
    if (state.firstAheadSeen) {
      state.verdict = 'green';
      state.verdictReason = 'pass completed';
    } else if (state.firstTravelMetres >= state.targetProgress) {
      state.verdict = 'red';
      state.verdictReason = 'no pass within three laps';
    }
  } else if (options.scenario === 'alongside-straight') {
    const bumperClear = Math.abs(first.prog - second.prog) >= PHYS.carLen;
    if (bumperClear && (completions > 0 || (session.attackEpisodes?.size ?? 0) === 0)) {
      state.verdict = 'green';
      state.verdictReason = completions > 0 ? 'clean pass' : 'clean re-tuck after bumper clearance';
    }
  } else if (options.scenario === 'tow-run') {
    if (state.minimumBodyClearance <= 0 && second.prog < state.targetProgress) {
      state.verdict = 'green';
      state.verdictReason = 'tow reached overlap before braking';
    } else if (second.prog >= state.targetProgress) {
      state.verdict = 'red';
      state.verdictReason = 'tow did not reach overlap before braking';
    }
  } else if (options.scenario === 'near-touch-tow') {
    if (second.prog >= state.targetProgress && Number.isFinite(state.brakeBodyClearance)) {
      const reachedNearTouch = state.minimumStraightBodyClearance >= 0 &&
        state.minimumStraightBodyClearance <= NEAR_TOUCH_CLEARANCE_METRES + 1e-9;
      const reopened = state.brakeBodyClearance >
        state.minimumStraightBodyClearance + 1e-9;
      const exercisedEscape = state.escapeAvailableSeen;
      if (reachedNearTouch && reopened && exercisedEscape) {
        state.verdict = 'green';
        state.verdictReason = 'free-lane tow reached near-touch then reopened for braking';
      } else {
        state.verdict = 'red';
        state.verdictReason =
          `near-touch ${state.minimumStraightBodyClearance.toFixed(3)} m, ` +
          `brake ${state.brakeBodyClearance.toFixed(3)} m, ` +
          `escape ${exercisedEscape ? 'seen' : 'missing'}`;
      }
    }
  } else if (options.scenario === 'drag-pass') {
    const nearTouch = state.minimumStraightBodyClearance >= 0 &&
      state.minimumStraightBodyClearance <= NEAR_TOUCH_CLEARANCE_METRES + 1e-9;
    const pulledOut = state.maximumLateralSeparation >= PHYS.carWid * 0.75;
    const bumperClear = first.prog - second.prog >= PHYS.carLen;
    if (nearTouch && state.maximumTow > 0 && pulledOut && bumperClear &&
        second.prog < state.targetProgress) {
      state.verdict = 'green';
      state.verdictReason = 'near-touch tow converted its overspeed into a straight pass';
    } else if (second.prog >= state.targetProgress) {
      state.verdict = 'red';
      state.verdictReason = 'drag pass did not gain full clearance before braking';
    }
  } else if (options.scenario === 'side-by-side-corner') {
    if (state.contactSeedSeen) {
      state.verdict = 'red';
      state.verdictReason = 'light contact seeded forced room';
    } else if (state.firstMarkerSeconds >= 0 && state.secondMarkerSeconds >= 0 &&
        state.sideBySideSeen && state.agreementSeen) {
      state.verdict = 'green';
      state.verdictReason = 'both cars completed the corner under stable side agreement';
    }
  } else if (options.scenario === 'light-rub') {
    if (state.contactSeedSeen) {
      state.verdict = 'red';
      state.verdictReason = 'light contact seeded forced room';
    } else if (state.battleSurvivedContact) {
      state.verdict = 'green';
      state.verdictReason = 'battle survived light contact';
    }
  } else if (options.scenario === 'defense-legality') {
    const defenseMoves =
      (session.racecraftDefensiveMovesCommitted ?? 0) -
        state.initialDefensiveMovesCommitted;
    const defenseBlocks =
      (session.racecraftDefensiveAuthorizedSideClosures ?? 0) -
        state.initialDefensiveAuthorizedSideClosures;
    if (options.defenseVariant === 'committed') {
      if (defenseBlocks > 0 && !state.defenseMoveAfterBrake) {
        state.verdict = 'green';
        state.verdictReason = 'committed attacker was not mirrored';
      } else if (state.secondMarkerSeconds >= 0 && defenseMoves === 0 &&
          !state.defenseMoveAfterBrake) {
        state.verdict = 'green';
        state.verdictReason = 'defender held line against committed attacker';
      }
    } else if (state.secondMarkerSeconds >= 0 && defenseMoves > 0 &&
        state.defenseMoveBeforeBrake && !state.defenseMoveAfterBrake) {
      state.verdict = 'green';
      state.verdictReason = 'anticipatory defense completed before braking';
    }
  } else if (options.scenario === 'attack-launch') {
    const selected = first.racecraftDecision?.candidates.find(candidate =>
      candidate.plan.key === first.racecraftDecision?.selectedPlanKey);
    const evaluatorAttack = selected && selected.kind !== 'hold' &&
      selected.kind !== 'brake-behind' &&
      selected.plan.mode !== 'ideal' && selected.plan.mode !== 'pit' &&
      selected.plan.leaderCode === second.code;
    if (evaluatorAttack) {
      state.verdict = 'green';
      state.verdictReason = 'evaluator selected a feasible passing space';
    } else if (first.prog >= state.brakeProgress) {
      state.verdict = 'red';
      state.verdictReason = 'no evaluator passing decision before braking';
    }
  } else if (options.scenario === 'inside-pass' ||
      options.scenario === 'outside-pass') {
    if (state.firstMarkerSeconds >= 0 && state.secondMarkerSeconds >= 0) {
      const bumperClear = first.prog - second.prog >= PHYS.carLen;
      if (state.lineKindSeen && bumperClear) {
        state.verdict = 'green';
        state.verdictReason = `${state.expectedLineKind} line completed a corner pass`;
      } else {
        state.verdict = 'red';
        state.verdictReason = state.lineKindSeen
          ? `${state.expectedLineKind} line did not gain full clearance by corner exit`
          : `${state.expectedLineKind} alternate line was not observed`;
      }
    }
  } else if (options.scenario === 'over-under') {
    const selected = (session.switchbackN ?? 0) > state.initialSwitchbacks;
    if (selected && state.lineKindSeen && state.trackOutObserved &&
        state.behindAtTrackOut && state.fullClearanceProgress >= state.trackOutProgress &&
        state.fullClearanceProgress < state.targetProgress) {
      state.verdict = 'green';
      state.verdictReason = 'outside exit completed the over-under into the next brake zone';
    } else if (second.prog >= state.targetProgress) {
      state.verdict = 'red';
      state.verdictReason = selected
        ? 'over-under did not complete in the late straight window'
        : 'over-under was not selected';
    }
  } else if (options.scenario === 'switchback') {
    const selected = (session.switchbackN ?? 0) > state.initialSwitchbacks;
    const bumperClear = first.prog - second.prog >= PHYS.carLen;
    const inCompletionWindow = first.prog >= state.brakeProgress &&
      first.prog < state.targetProgress;
    const completionRecorded = (session.switchbackCompletions ?? 0) -
      state.initialSwitchbackCompletions > 0;
    if (selected && bumperClear && inCompletionWindow && completionRecorded) {
      state.verdict = 'green';
      state.verdictReason = 'switchback gained bumper clearance before the next brake zone';
    } else if (state.firstMarkerSeconds >= 0 && state.secondMarkerSeconds >= 0) {
      state.verdict = 'red';
      state.verdictReason = selected
        ? 'switchback did not gain bumper clearance before the next brake zone'
        : 'switchback not selected';
    }
  } else if (options.scenario === 'spot-selection') {
    const selection = spotSelectionCorners(session.trk);
    if (selection.selected.id === selection.first.id) {
      state.verdictReason = 'track has no higher-scored next-corner opportunity';
    } else if (state.selectedCornerSeen) {
      state.verdict = 'green';
      state.verdictReason = 'higher-scored corner selected by the evaluator';
    } else if (first.prog >= state.targetProgress) {
      state.verdict = 'red';
      state.verdictReason = 'higher-scored corner was not selected';
    }
  } else if (options.scenario === 'train-pressure') {
    const attacks = (session.attackInitiations ?? 0) - state.initialAttackInitiations;
    if (attacks >= 2) {
      state.verdict = 'green';
      state.verdictReason = 'multiple followers attacked the underspeed leader train';
    } else if (session.t >= state.targetProgress && attacks === 0) {
      state.verdict = 'red';
      state.verdictReason = 'no pressure attack within the calibrated window';
    }
  } else if (options.scenario === 'tucked-follow' &&
      state.firstMarkerSeconds >= 0 && state.secondMarkerSeconds >= 0) {
    state.verdict = state.tuckedAuthorityLost ? 'red' : 'green';
    state.verdictReason = state.tuckedAuthorityLost
      ? 'follower lost tuck authority during the flying lap'
      : 'tucked pair completed the flying lap with continuous tuck authority';
  } else if (options.scenario === 'solo-baseline' && state.firstMarkerSeconds >= 0) {
    state.verdict = 'green';
    state.verdictReason = 'solo corner baseline complete';
  }
}

export function runFocusedSession(
  built: BuiltTrack,
  options: FocusedSessionOptions
): FocusedSessionSummary {
  if (!(ALL_FOCUSED_SCENARIOS as readonly string[]).includes(options.scenario))
    throw new Error(`Unknown focused scenario ${String(options.scenario)}`);
  const seed = options.seed ?? 1;
  const auditScenario = isAuditFocusedScenario(options.scenario);
  // Behavior probes exercise the production physics/control cadence. A 30 Hz
  // shortcut changes driver input from 60 Hz to 15 Hz and can manufacture
  // reachability overshoot that the browser runtime never executes.
  const fixedStep = options.step ?? 1 / 120;
  const defaultDuration = (() => {
    if (options.scenario === 'classification') return 8;
    if (options.scenario === 'pit') return 15;
    if (options.scenario === 'faster-behind')
      return built.prof.lapTime * RACE_PACE_F * 3 + 30;
    if (options.scenario === 'alongside-straight') return 15;
    if (options.scenario === 'tow-run') return 20;
    if (options.scenario === 'near-touch-tow') return 20;
    if (options.scenario === 'side-by-side-corner') return 24;
    if (options.scenario === 'light-rub') return 6;
    if (options.scenario === 'defense-legality') return 18;
    if (options.scenario === 'attack-launch') return 15;
    if (options.scenario === 'inside-pass' || options.scenario === 'outside-pass') return 30;
    if (options.scenario === 'over-under') return 35;
    if (options.scenario === 'drag-pass') return 25;
    if (options.scenario === 'switchback') return 30;
    if (options.scenario === 'spot-selection') return 35;
    if (options.scenario === 'train-pressure')
      return trainPressureWindow(built.tr).seconds;
    if (options.scenario === 'tucked-follow')
      return built.tr.idealTiming!.lapTime * 1.5 + 20;
    if (options.scenario === 'solo-baseline') return 20;
    return 8;
  })();
  const duration = options.simulatedSeconds ?? defaultDuration;
  const immediateAuditScenario = options.scenario === 'alongside-straight' ||
    options.scenario === 'near-touch-tow' || options.scenario === 'side-by-side-corner' ||
    options.scenario === 'light-rub' ||
    options.scenario === 'defense-legality' || options.scenario === 'attack-launch' ||
    options.scenario === 'inside-pass' || options.scenario === 'outside-pass' ||
    options.scenario === 'over-under' || options.scenario === 'drag-pass' ||
    options.scenario === 'switchback' || options.scenario === 'solo-baseline' ||
    options.scenario === 'train-pressure';
  const settlingSeconds = options.settlingSeconds ??
    (immediateAuditScenario ? 0 : auditScenario ? 0.25 : 0);
  if (!Number.isFinite(fixedStep) || fixedStep <= 0) throw new Error('step must be positive');
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('simulatedSeconds must be positive');
  if (!Number.isFinite(settlingSeconds) || settlingSeconds < 0)
    throw new Error('settlingSeconds must be non-negative');
  const requestedSteps = Math.ceil((duration + settlingSeconds) / fixedStep);
  const limits = resolveDeadline({
    maxSteps: options.maxSteps ?? requestedSteps,
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  return withRandomSource(mulberry32(seed), () => {
    const count = options.scenario === 'train-pressure'
      ? 4
      : options.traffic === 'three-car' ? 3 : 2;
    const session: Session = options.scenario === 'priority' &&
      options.priorityReason === 'qualifying'
      ? createFocusedQualifying(
          built,
          options.wet ?? 0,
          count,
          options.predictiveSafetyHz ?? 10
        )
      : createFocusedRace(
          built,
          options.wet ?? 0,
          count,
          options.predictiveSafetyHz ?? 10
        );
    session.racecraftDecisionLogging = false;
    setupFocusedScenario(session, options);
    const initialProgress = new Map(session.entries.map(entry => [entry.code, entry.prog]));
    const auditState = auditScenario ? makeFocusedAuditState() : null;
    let steps = 0;
    let reason: HeadlessStop['reason'] = 'step-limit';
    let obligationSeen = options.scenario === 'priority' &&
      owes(session, session.entries[0]!, session.entries[1]!) != null;
    let obligationYieldLossSeconds = 0;
    let obligationYieldSpeedFractionMinimum = Infinity;
    let obligationYieldSpeedSamples = 0;
    let emergencyAuthorizedGrassCarSeconds = 0;
    let nonEmergencyGrassCarSeconds = 0;
    while (steps < limits.maximumSteps && steps < requestedSteps) {
      if (limits.expired(steps)) {
        reason = 'deadline';
        break;
      }
      if (auditState && !auditState.opened && steps * fixedStep >= settlingSeconds)
        openFocusedAudit(session, options, auditState);
      // This probe compares traffic/lateral cost between otherwise equal
      // cars. Lap-boundary focus rolls give each entry a different stochastic
      // pace map, which would measure driver noise rather than tucked loss.
      if (options.scenario === 'tucked-follow') {
        for (const entry of session.entries) {
          entry.flow = null;
          entry.focusNow = 1;
        }
      }
      stepSession(session, fixedStep);
      steps++;
      for (const entry of session.entries) {
        if (!entry.car ||
            entry.state === 'pit' ||
            entry.state === 'dnf' ||
            entry.state === 'fin')
          continue;
        const sample = Math.max(0, entry.car.progIdx) % session.trk.n;
        const grassSeconds = surfaceExposureAtLateral(
          session.trk,
          sample,
          entry.latNow
        ).grass * fixedStep;
        if (entry.laneProgram.surfaceAuthorization === 'emergency')
          emergencyAuthorizedGrassCarSeconds += grassSeconds;
        else
          nonEmergencyGrassCarSeconds += grassSeconds;
      }
      if (options.scenario === 'priority') {
        const yielding = session.entries[0]!;
        const beneficiary = session.entries[1]!;
        if (yielding.car && owes(session, yielding, beneficiary)) {
          obligationSeen = true;
          const index = Math.max(0, yielding.car.progIdx) % session.trk.n;
          const curvature = session.trk.idealPath.k[index]!;
          const reference = session.trk.idealPath.v[index]!;
          const target = Math.min(
            reference,
            cornerSpeedForGrip(
              curvature,
              entryDynamicMuAt(yielding, session, reference, curvature),
              entryDownforceScale(yielding)
            )
          ) * entryMargin(
              yielding,
              session,
              session.config.tuneBonus,
              session.wet
            );
          const speedFraction = yielding.spd / Math.max(1, target);
          obligationYieldSpeedFractionMinimum = Math.min(
            obligationYieldSpeedFractionMinimum,
            speedFraction
          );
          obligationYieldLossSeconds += Math.max(
            0,
            1 - speedFraction
          ) * fixedStep;
          obligationYieldSpeedSamples++;
        }
      }
      if (auditState) {
        updateFocusedAudit(session, options, auditState);
        if (auditState.verdict && options.stopWhenDecided !== false) {
          reason = 'complete';
          break;
        }
      }
      if (options.stopOnPriorityRelease && options.scenario === 'priority') {
        const relation = owes(
          session,
          session.entries[0]!,
          session.entries[1]!
        );
        if (relation) obligationSeen = true;
        if (obligationSeen && !relation) {
          reason = 'complete';
          break;
        }
      }
    }
    if (steps >= requestedSteps) reason = 'complete';
    const auditMetric = (value: number): number =>
      Number.isFinite(value) ? round(value) : -1;
    const stationGaps = stationGapMetrics(session);
    const decisionLog = orderedRacecraftDecisionLog(session);
    const selectedJ = selectedJDecomposition(session, decisionLog);
    const core = {
      schemaVersion: 1 as const,
      kind: 'focused-session' as const,
      scenario: options.scenario,
      trackId: built.def.id,
      seed,
      wet: round(session.wet),
      reason,
      steps,
      simulatedSeconds: round(steps * fixedStep),
      eventTypes: session.events.map(stableEventType),
      entries: session.entries.map(stableEntry),
      diagnostics: {
        laneDiscontinuityReasons: aggregateLaneDiscontinuityReasons(session.entries),
        laneEditReasons: aggregateLaneEditReasons(session.entries),
        racecraftInteractionSamples: Object.fromEntries(
          Object.entries(session.racecraftInteractionSamples ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
        ),
        racecraftLiftSamples: Object.fromEntries(
          Object.entries(session.racecraftLiftSamples ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
        ),
        racecraftCornerDecisions: Object.fromEntries(
          Object.entries(session.racecraftCornerDecisions ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([cornerId, count]) => [cornerId, { ...count }])
        ),
        racecraftSelectedJ: selectedJ,
        racecraftEvaluatorWork: {
          ...session.racecraftEvaluatorWork
        },
        racecraftDeliberationsByCar: {
          ...session.racecraftDeliberationsByCar
        },
        racecraftPublicationsByCar: {
          ...session.racecraftPublicationsByCar
        },
        racecraftDirectDecisionProofs: {
          ...session.racecraftDirectDecisionProofs
        },
        racecraftOwnershipInvalidationsByReason: {
          ...session.racecraftOwnershipInvalidationsByReason
        },
        racecraftDefensiveCandidateRejections: {
          ...session.racecraftDefensiveCandidateRejections
        },
        racecraftDefensiveMinimumNoticeSecondsByOutcome:
          Object.fromEntries(
            Object.entries(
              session
                .racecraftDefensiveMinimumNoticeSecondsByOutcome ??
                {}
            ).map(([outcome, seconds]) => [
              outcome,
              round(seconds)
            ])
          ),
        racecraftDefensiveMinimumAlongsideSecondsByOutcome:
          Object.fromEntries(
            Object.entries(
              session
                .racecraftDefensiveMinimumAlongsideSecondsByOutcome ??
                {}
            ).map(([outcome, seconds]) => [
              outcome,
              round(seconds)
            ])
          ),
        racecraftSafetyPredicateRuns: {
          ...session.racecraftSafetyPredicateRuns
        }
      },
      metrics: {
        contacts: session.hitN ?? 0,
        lightContacts: Math.max(
          0,
          (session.hitN ?? 0) - (session.hitHard ?? 0)
        ),
        hardContacts: session.hitHard ?? 0,
        maximumContinuousContactDurationSeconds: round(
          maximumContinuousContactDurationSeconds(session)
        ),
        emergencyAuthorizedGrassCarSeconds: round(
          emergencyAuthorizedGrassCarSeconds
        ),
        nonEmergencyGrassCarSeconds: round(nonEmergencyGrassCarSeconds),
        attackInitiations: session.attackInitiations ?? 0,
        attackCompletions: session.attackCompletions ?? 0,
        activeAttackEpisodes: session.attackEpisodes?.size ?? 0,
        switchbacks: session.switchbackN ?? 0,
        switchbackCompletions: session.switchbackCompletions ?? 0,
        brakeWhileAlongside: session.brakeWhileAlongsideN ?? 0,
        rearLossStraight: session.rearLossStraightN ?? 0,
        stationGapSamples: stationGaps.samples,
        stationGapMeanMetres: round(stationGaps.mean),
        stationGapStdDevMetres: round(stationGaps.standardDeviation),
        stationGapMinimumMetres: round(stationGaps.minimum),
        stationGapMaximumMetres: round(stationGaps.maximum),
        battleLapDelta: round(session.battleLapDeltaSum ?? 0),
        battleLapLossFraction: round(
          (session.battleLapDeltaSum ?? 0) /
            Math.max(1e-9, session.battleLapReferenceSum ?? 0)
        ),
        battleLapSamples: session.battleLapSamples ?? 0,
        laneTargetDiscontinuityMetres: round(session.entries.reduce(
          (sum, entry) => sum + (entry.laneTargetDiscontinuityMetres ?? 0),
          0
        )),
        laneTargetDiscontinuities: session.entries.reduce(
          (sum, entry) => sum + (entry.laneTargetDiscontinuities ?? 0),
          0
        ),
        laneTargetNonManeuverDiscontinuities: session.entries.reduce(
          (sum, entry) => sum + (entry.laneTargetNonManeuverDiscontinuities ?? 0),
          0
        ),
        laneHopMetresPerCarMinute: round(
          session.entries.reduce(
            (sum, entry) => sum + (entry.laneTargetDiscontinuityMetres ?? 0),
            0
          ) / Math.max(1e-9, steps * fixedStep * session.entries.length / 60)
        ),
        laneEdits: session.entries.reduce(
          (sum, entry) => sum + (entry.laneEdits ?? 0),
          0
        ),
        laneMaximumPinError: round(Math.max(
          0,
          ...session.entries.map(entry => entry.laneMaximumPinError ?? 0)
        )),
        laneUnpinnedEdits: session.entries.reduce(
          (sum, entry) => sum + (entry.laneUnpinnedEdits ?? 0),
          0
        ),
        sideBySideSeconds: round(session.sbsT ?? 0),
        obligationObserved: obligationSeen ? 1 : 0,
        obligationYieldLossSeconds: round(obligationYieldLossSeconds),
        obligationYieldSpeedSamples,
        obligationYieldMinimumSpeedFraction: obligationYieldSpeedSamples
          ? round(obligationYieldSpeedFractionMinimum)
          : -1,
        pitFalseLeaders: session.pitForeignFalseLeaders ?? 0,
        pitDeadlocks: session.pitDeadlocks?.length ?? 0,
        unexplainedStalls: session.unexplainedStalls?.length ?? 0,
        maximumPathsMaterialized: session.racecraftPathsMaterialized ?? 0,
        finished: session.mode === 'race' ? session.finCount : 0,
        firstProgressMetres: round(
          session.entries[0]!.prog - (initialProgress.get(session.entries[0]!.code) ?? 0)
        ),
        secondProgressMetres: round(
          session.entries[1]!.prog - (initialProgress.get(session.entries[1]!.code) ?? 0)
        ),
        maximumCandidates: session.racecraftMaximumCandidates ?? 0,
        candidatesEvaluated: session.racecraftCandidatesEvaluated ?? 0,
        pathsMaterialized: session.racecraftPathsMaterialized ?? 0,
        racecraftDecisionSwitches: session.racecraftDecisionSwitches ?? 0,
        racecraftDeliberations: session.racecraftDeliberations ?? 0,
        racecraftTacticalPublications:
          session.racecraftTacticalPublications ?? 0,
        racecraftOffSlotPublicationAttempts:
          session.racecraftOffSlotPublicationAttempts ?? 0,
        racecraftSameSlotReopenings:
          session.racecraftSameSlotReopenings ?? 0,
        racecraftNestedResponseEvaluations:
          session.racecraftNestedResponseEvaluations ?? 0,
        racecraftDirectIdealDecisions:
          session.racecraftDirectIdealDecisions ?? 0,
        racecraftDirectFollowDecisions:
          session.racecraftDirectFollowDecisions ?? 0,
        racecraftDirectFollowWithoutCertificates:
          session.racecraftDirectFollowWithoutCertificates ?? 0,
        racecraftStagedCandidatesOpened:
          session.racecraftStagedCandidatesOpened ?? 0,
        racecraftStagedCandidatesRejected:
          session.racecraftStagedCandidatesRejected ?? 0,
        racecraftStagedCandidatesSelected:
          session.racecraftStagedCandidatesSelected ?? 0,
        racecraftStagedCandidatesCleared:
          session.racecraftStagedCandidatesCleared ?? 0,
        racecraftStagedAcquisitionConstrainedSeconds: round(
          session.racecraftStagedAcquisitionConstrainedSeconds ?? 0
        ),
        racecraftCommittedAttackViews:
          session.racecraftCommittedAttackViews ?? 0,
        racecraftDefensiveResponses:
          session.racecraftDefensiveResponses ?? 0,
        racecraftDefensiveMovesCommitted:
          session.racecraftDefensiveMovesCommitted ?? 0,
        racecraftDefensiveMovesContinued:
          session.racecraftDefensiveMovesContinued ?? 0,
        racecraftDefensiveMovesResetAtExit:
          session.racecraftDefensiveMovesResetAtExit ?? 0,
        racecraftDefensiveRoomProtectedCovers:
          session.racecraftDefensiveRoomProtectedCovers ?? 0,
        racecraftDefensiveAuthorizedSideClosures:
          session.racecraftDefensiveAuthorizedSideClosures ?? 0,
        racecraftDefensiveAuthorizedApproachConflicts:
          session.racecraftDefensiveAuthorizedApproachConflicts ?? 0,
        racecraftDefensivePreConsumptionSafetyInterventions:
          session.racecraftDefensivePreConsumptionSafetyInterventions ?? 0,
        racecraftSwitchbackFamilyChanges:
          session.racecraftSwitchbackFamilyChanges ?? 0,
        racecraftOwnershipAssertions:
          session.racecraftOwnershipAssertions ?? 0,
        racecraftOwnershipCurrentValidations:
          session.racecraftOwnershipCurrentValidations ?? 0,
        racecraftOwnershipInvalidations:
          session.racecraftOwnershipInvalidations ?? 0,
        racecraftDefenderReclaims:
          session.racecraftDefenderReclaims ?? 0,
        racecraftMaximumSingleFileTrainLength:
          session.racecraftMaximumSingleFileTrainLength ?? 0,
        racecraftLongestSingleFileTrainSeconds: round(
          session.racecraftLongestSingleFileTrainSeconds ?? 0
        ),
        racecraftFasterCarBlockedSeconds: round(
          session.racecraftFasterCarBlockedSeconds ?? 0
        ),
        predictiveSafetyHz: session.config.predictiveSafetyHz,
        predictiveSafetyIntervalTicks:
          session.racecraftPredictiveSafetyIntervalTicks,
        racecraftSafetyPasses: session.racecraftSafetyPasses ?? 0,
        racecraftSafetyInterventions:
          session.racecraftSafetyInterventions ?? 0,
        racecraftInteractionSamples: Object.values(
          session.racecraftInteractionSamples ?? {}
        ).reduce((sum, count) => sum + (count ?? 0), 0),
        racecraftLiftSamplesOutsideBlue: Object.entries(
          session.racecraftLiftSamples ?? {}
        ).reduce((sum, [cause, count]) =>
          sum + (cause === 'blue-flag' ? 0 : count ?? 0), 0),
        racecraftBlueLiftSamples:
          session.racecraftLiftSamples?.['blue-flag'] ?? 0,
        racecraftBlueForcedSpanSamples:
          session.racecraftBlueForcedSpanSamples ?? 0,
        racecraftBlueForcedLiftSamples:
          session.racecraftBlueForcedLiftSamples ?? 0,
        racecraftBlueLiftOutsideForcedSpan:
          session.racecraftBlueLiftOutsideForcedSpan ?? 0,
        racecraftReactionEvents: session.racecraftReactionEvents ?? 0,
        racecraftReactionRatePerLap: round(
          (session.racecraftReactionEvents ?? 0) /
            Math.max(1, completedCarLaps(session))
        ),
        racecraftEmergencyLifts: session.racecraftEmergencyLifts ?? 0,
        racecraftExpiredPrograms: session.racecraftExpiredPrograms ?? 0,
        racecraftWanderingSeconds:
          round(session.racecraftWanderingSeconds ?? 0),
        rejectedCandidates: session.racecraftRejectedCandidates ?? 0,
        pathOutOfBoundsRejections:
          session.racecraftRejectedByConstraint?.['road-bound'] ?? 0,
        nonFiniteCandidateRejections:
          session.racecraftRejectedByConstraint?.['non-finite'] ?? 0,
        sideAgreementsLive: session.sideAgreements?.size ?? 0,
        minimumDynamicPathSpeed: round(minimumDynamicLaneSpeed(session.entries)),
        maximumDynamicPathCurvature: round(
          maximumDynamicLaneCurvature(session.trk, session.entries)
        ),
        maximumPathSlew: round(Math.max(
          0,
          ...session.entries.map(entry => entry.pathMaxSlew ?? 0)
        )),
        auditIdealLapSeconds: round(session.trk.idealTiming!.lapTime),
        cornerPassAttempts: Object.values(session.cornerPassCounts ?? {})
          .reduce((sum, count) => sum + count.attempts, 0),
        cornerPasses: Object.values(session.cornerPassCounts ?? {})
          .reduce((sum, count) => sum + count.passes, 0),
        ...(auditState ? {
          auditMinimumBodyClearance: auditMetric(auditState.minimumBodyClearance),
          auditMinimumStraightBodyClearance:
            auditMetric(auditState.minimumStraightBodyClearance),
          auditBrakeBodyClearance: auditMetric(auditState.brakeBodyClearance),
          auditEscapeAvailableSeen: auditState.escapeAvailableSeen ? 1 : 0,
          auditMinimumLateralSeparation: auditMetric(auditState.minimumLateralSeparation),
          auditMaximumLateralSeparation: round(auditState.maximumLateralSeparation),
          auditMaximumTow: round(auditState.maximumTow),
          auditContactObserved: auditState.contactAt >= 0 ? 1 : 0,
          auditContactSeedSeen: auditState.contactSeedSeen ? 1 : 0,
          auditAgreementSeen: auditState.agreementSeen ? 1 : 0,
          auditSideBySideSeen: auditState.sideBySideSeen ? 1 : 0,
          auditBattleSurvivedContact: auditState.battleSurvivedContact ? 1 : 0,
          auditFirstMarkerSeconds: auditMetric(auditState.firstMarkerSeconds),
          auditSecondMarkerSeconds: auditMetric(auditState.secondMarkerSeconds),
          auditTuckedAuthoritySeconds: round(auditState.tuckedAuthoritySeconds),
          auditLeaderMaximumCommandDeviation: round(
            auditState.leaderMaximumCommandDeviation
          ),
          auditLeaderFollowerBrakeEvents:
            auditState.leaderFollowerBrakeEvents,
          auditEndingBodyClearance:
            auditMetric(auditState.endingBodyClearance),
          auditDerivedFollowBodyFloor: round(
            auditState.derivedFollowBodyFloor
          ),
          auditLeaderTrackingErrorThreshold: round(
            auditState.leaderTrackingErrorThreshold
          ),
          auditTuckedAuthorityLost: auditState.tuckedAuthorityLost ? 1 : 0,
          auditTuckedMaximumEtaError: round(auditState.tuckedMaximumEtaError),
          auditTuckedMaximumCommandEtaError: round(
            auditState.tuckedMaximumCommandEtaError
          ),
          auditTuckedMaximumTrackingError: round(auditState.tuckedMaximumTrackingError),
          auditTuckedCommandErrorAtSeconds: round(
            auditState.tuckedCommandErrorAtSeconds
          ),
          auditTuckedCommandErrorLeaderEta: round(
            auditState.tuckedCommandErrorLeaderEta
          ),
          auditTuckedCommandErrorFollowerEta: round(
            auditState.tuckedCommandErrorFollowerEta
          ),
          auditTuckedCommandErrorFollowerCommandEta: round(
            auditState.tuckedCommandErrorFollowerCommandEta
          ),
          auditTuckedCommandErrorProgressGap: round(
            auditState.tuckedCommandErrorProgressGap
          ),
          auditTuckedCommandErrorFollowerPointSpan: round(
            auditState.tuckedCommandErrorFollowerPointSpan
          ),
          auditTuckedCommandErrorLeaderPointSpan: round(
            auditState.tuckedCommandErrorLeaderPointSpan
          ),
          auditTuckedFirstMeanLaneSpeedDeficit: round(
            auditState.tuckedFirstLaneSpeedDeficit /
              Math.max(1e-9, auditState.tuckedGeometrySeconds)
          ),
          auditTuckedSecondMeanLaneSpeedDeficit: round(
            auditState.tuckedSecondLaneSpeedDeficit /
              Math.max(1e-9, auditState.tuckedGeometrySeconds)
          ),
          auditExpectedCornerApex: auditState.expectedCornerApex,
          auditSelectedCornerSeen: auditState.selectedCornerSeen ? 1 : 0,
          auditVocabularyLineSeen: auditState.lineKindSeen ? 1 : 0,
          auditVocabularyTrackOutObserved: auditState.trackOutObserved ? 1 : 0,
          auditVocabularyBehindAtTrackOut: auditState.behindAtTrackOut ? 1 : 0,
          auditVocabularyTrackOutProgress: auditMetric(auditState.trackOutProgress),
          auditVocabularyTargetProgress: auditMetric(auditState.targetProgress),
          auditVocabularyFullClearanceProgress: round(auditState.fullClearanceProgress),
          auditFirstAheadSeen: auditState.firstAheadSeen ? 1 : 0,
          auditFirstAttackGap: round(auditState.firstAttackGap),
          auditFirstTravelMetres: round(auditState.firstTravelMetres),
          auditSecondTravelMetres: round(auditState.secondTravelMetres),
          auditDefenseMoveBeforeBrake: auditState.defenseMoveBeforeBrake ? 1 : 0,
          auditDefenseMoveAfterBrake: auditState.defenseMoveAfterBrake ? 1 : 0,
          auditAttackInitiations: (session.attackInitiations ?? 0) -
            auditState.initialAttackInitiations,
          auditAttackCompletions: (session.attackCompletions ?? 0) -
            auditState.initialAttackCompletions,
          auditSwitchbacks: (session.switchbackN ?? 0) - auditState.initialSwitchbacks,
          auditSwitchbackCompletions: (session.switchbackCompletions ?? 0) -
            auditState.initialSwitchbackCompletions,
          auditDefensiveMovesCommitted:
            (session.racecraftDefensiveMovesCommitted ?? 0) -
              auditState.initialDefensiveMovesCommitted,
          auditDefensiveAuthorizedSideClosures:
            (session.racecraftDefensiveAuthorizedSideClosures ?? 0) -
              auditState.initialDefensiveAuthorizedSideClosures,
          auditHardContacts: (session.hitHard ?? 0) - auditState.initialHardContacts,
          auditEvaluatorSteerSelections: auditState.evaluatorSteerSelections,
          auditEvaluatorBrakeSelections: auditState.evaluatorBrakeSelections,
          auditEvaluatorHoldSelections: auditState.evaluatorHoldSelections,
          auditStraightPullOutSelections:
            auditState.straightPullOutSelections,
          auditStraightPullOutEnvelopeFractionMinimum: auditMetric(
            auditState.straightPullOutEnvelopeFractionMinimum
          ),
          auditStraightPullOutEnvelopeFractionMean: auditState
            .straightPullOutSelections
            ? round(
                auditState.straightPullOutEnvelopeFractionSum /
                  auditState.straightPullOutSelections
              )
            : -1,
          auditStraightPullOutEnvelopeFractionMaximum: auditState
            .straightPullOutSelections
            ? round(auditState.straightPullOutEnvelopeFractionMaximum)
            : -1,
          auditStraightPullOutSignedOffsetMinimumMetres: auditMetric(
            auditState.straightPullOutSignedOffsetMinimumMetres
          ),
          auditStraightPullOutSignedOffsetMaximumMetres: auditMetric(
            auditState.straightPullOutSignedOffsetMaximumMetres
          ),
          auditEmergencySurfaceSelections:
            auditState.emergencySurfaceSelections,
          auditEmergencySurfaceAttributionFailures:
            auditState.emergencySurfaceAttributionFailures,
          auditContestLateralSelections:
            auditState.contestLateralSelections,
          auditContestBrakeSelections:
            auditState.contestBrakeSelections,
          auditContestInlineSelections:
            auditState.contestInlineSelections,
          auditSideBySideCornerSilentSpans:
            auditState.sideBySideCornerSilentSpans,
          auditSideBySideCornerSilentSeconds: round(
            auditState.sideBySideCornerSilentSeconds
          ),
          auditSideBySideCornerContestedSeconds: round(
            auditState.sideBySideCornerContestedSeconds
          )
        } : {})
      },
      ...(auditState ? {
        audit: {
          verdict: auditState.verdict ?? 'undecided' as const,
          reason: auditState.verdictReason
        }
      } : {})
    };
    return { ...core, checksum: checksum(core) };
  });
}
