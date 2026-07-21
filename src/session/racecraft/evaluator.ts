import {
  backwardInducedSpeedLimit,
  BOT_BRAKING_EFFORT_MAXIMUM,
  BOT_BRAKING_EFFORT_MINIMUM
} from '../../core/autopilot';
import {
  isHardContactImpulse,
  sweptCarContactEpisodes,
  sweptCarContactIntervals,
  sweptCarMinimumClearance,
  type SweptCarContactEpisode,
  type SweptCarPosePair
} from '../../core/collision';
import { sampleCornerLineEta } from '../../core/corner-lines';
import { nextCorner } from '../../core/racing-line';
import type {
  CompactLateralProgram,
  LegacyCorner,
  SpeedEnvelope,
  Track
} from '../../core/model';
import {
  compactLateralGeometryAtProgress,
  writeTrackIdealLateralAnalytic,
  writeCompactLateralGeometryAtProgress,
  writeCompactLateralPoseAtProgress,
  writeSampleCompactLateralProgram,
  type CompactLateralSample
} from
  '../../core/lateral-program';
import {
  availableDeceleration,
  longitudinalAccelerationHeadroom,
  longitudinalGripHeadroomFraction,
  PHYS,
  wakeStrength
} from '../../core/physics';
import { normalLateralEnvelope } from '../../core/surface';
import {
  cloneSpeedEnvelope,
  createSpeedEnvelopeConstructionBuffers,
  speedEnvelopeAddsConstraint,
  speedEnvelopeAt,
  speedEnvelopeFromSamples,
  speedEnvelopeFromUniformSamples,
  type SpeedEnvelopeConstructionBuffers
} from '../../core/speed-envelope';
import { clamp, normAng } from '../../shared/math';
import type {
  Entry,
  EntryTrafficSlowPoint,
  ManeuverCandidateDiagnostic,
  PathPlan,
  PathPlanAnchor,
  RacecraftCandidateEvaluation,
  RacecraftCandidateKind,
  RacecraftCandidateSeed,
  RacecraftClaim,
  RacecraftCornerOwnershipAssertion,
  RacecraftDecision,
  RacecraftDecisionLogEntry,
  RacecraftDirection,
  RacecraftEvaluatorWorkDiagnostics,
  RacecraftInteractionCause,
  RacecraftTrajectoryProgram,
  RacecraftTimedTrajectoryProgram,
  Session
} from '../model';
import {
  entryDownforceScale,
  entryMu,
  LIFT_MARGIN_PENALTY,
  START_BLEND_END,
  TRAF_DT
} from '../strategy';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from './cadence';
import {
  racecraftClaimAtEvaluationEpoch,
  racecraftClaimHorizonSeconds,
  racecraftClaimSegmentCount,
  racecraftClaimSegmentEndTime,
  racecraftClaimStateAtTime,
  writeRacecraftClaimStateAtTime,
  writeRacecraftClaimTowStateAtTime,
  type RacecraftClaimState,
  type RacecraftClaimTowState,
  type RacecraftEvaluationClaim
} from './claim';
import {
  createRacecraftTrajectoryProgram,
  writeRacecraftTrajectorySegment
} from './claim';
import {
  directionalCandidateObjectiveSeconds,
  pairwiseDifferenceTieBand
} from './cost-function';
import {
  battleSpendSeconds,
  createNormalizedPairPaceEvidence,
  createOpportunityIntervalEvidence,
  pairPaceDifferentialSecondsPerLap,
  positionValueSeconds,
  reopportunitySeconds,
  updateNormalizedPairPaceEvidence,
  updateOpportunityIntervalEvidence,
  type NormalizedPairPaceEvidence,
  type OpportunityIntervalEvidence
} from './battle-economics';
import {
  measuredAttackTransitionLossSeconds
} from './attempt-loss';
import {
  evaluateManeuverPlanCompactWithSampler,
  maneuverPredictionStationTime,
  MANEUVER_PREDICTION,
  type ManeuverPlanSampler
} from './feasibility';
import type { ManeuverPhysicalSample } from './feasibility';
import {
  racecraftFamilyDynamics,
  racecraftFamilyStateAt as computeLaneStateAt,
  writePreparedRacecraftFamilyKinematicsAt,
  writePreparedRacecraftFamilyStateAt,
  type RacecraftFamilyDynamics,
  type RacecraftFamilyState as LaneState
} from './family-geometry';
import {
  evaluateLaneEta,
  hasSideAgreement,
  racecraftPairKey,
  sideAgreementBounds,
  sideAgreementCornerFamilyMember,
  sideAgreementEnvelopeAt,
  signedTrackDistance,
  type LateralBounds
} from './geometry';
import {
  clearLaneProgram,
  editLaneEtaTarget,
  LANE_BUFFER_CAPACITY,
  LANE_BUFFER_DISTANCE_METRES,
  physicalLaneMoveSeconds,
  physicalLateralMoveSeconds
} from './lane-program';
import {
  oneIntervalPhysicalDivergence
} from './paths';
import {
  compileCompactLateralProgram,
  sampleCompactPathPlanOffsetAnalytic
} from './compact-path';
import {
  contractIsRevoked,
  isFixedOccupancy,
  isObligationParticipant,
  obligationsFor
} from './relations';
import {
  OBSTACLE_NEIGHBOR_SCAN_METRES,
  racecraftCalibration,
  TRAFFIC_NEIGHBOR_SCAN_METRES
} from './config';
import {
  UTILIZATION_MISTAKE_LIFT_SECONDS,
  utilizationMistakeProbability
} from './utilization';
import {
  composeRacecraftStagedAttackProgram
} from './longitudinal-program';
import {
  plannedNearRubExposureCost,
  type NearRubTrajectorySample
} from './near-rub';
import {
  authorCornerOwnershipAssertion,
  classifyCornerOwnership,
  continuousTrajectoryStateAtTime,
  trajectoryFromPublication,
  type RacecraftTrajectory
} from './corner-ownership';
import {
  recordRacecraftDefensiveCandidateRejection,
  recordRacecraftNestedResponseEvaluation
} from './diagnostics';
import {
  defensiveContactEpisodeIsAuthorized,
  evaluateRacecraftDefensiveLegality,
  racecraftCandidateMayAuthorCornerOwnership,
  racecraftDefensiveCommitmentIsActive,
  racecraftDefensiveLegalityAuthorizesReclaim,
  racecraftMeasuredLegalAlongside,
  type RacecraftDefensiveLegalityResult
} from './defensive-legality';

export const MAX_RACECRAFT_CANDIDATES = 6;
const DECISION_LOG_LIMIT = 32_768;
const IDEAL_PATH_PLAN: Extract<PathPlan, { mode: 'ideal' }> = {
  mode: 'ideal',
  key: 'ideal'
};

type ActiveEntry = Entry & { car: NonNullable<Entry['car']> };
type DynamicPlan = Exclude<PathPlan, { mode: 'ideal' } | { mode: 'pit' }>;

function evaluatorWork(
  session: Session
): RacecraftEvaluatorWorkDiagnostics {
  return session.racecraftEvaluatorWork ??
    (session.racecraftEvaluatorWork = {
      decisionCalls: 0,
      candidateFamilyBuilds: 0,
      candidateSeedsBuilt: 0,
      seedEvaluations: 0,
      branchBoundPrunes: 0,
      speedLawSamples: 0,
      terminalContinuationCalls: 0,
      terminalContinuationSteps: 0,
      hazardsBuilt: 0,
      boundScreenCalls: 0,
      boundScreenClears: 0,
      boundScreenHits: 0,
      viabilityCalls: 0,
      viabilityHazards: 0,
      deterministicSweeps: 0,
      rivalStateBuilds: 0,
      rivalStateCacheHits: 0,
      rivalSweepBuilds: 0,
      rivalSweepCacheHits: 0
    });
}

interface ProgramStation {
  time: number;
  progress: number;
  s: number;
  lateral: number;
  speed: number;
  /** Predicted body orientation relative to the local track tangent. */
  headingOffsetRadians: number;
  /** Immutable analytic state already evaluated at this exact progress. */
  familyState?: LaneState;
}

interface ActionableOwnershipAssertion {
  readonly assertion: RacecraftCornerOwnershipAssertion;
}

interface CandidateProgram {
  evaluation: RacecraftCandidateEvaluation;
  stations: ProgramStation[];
  speedLaw: CandidateSpeedLaw;
  bounds: Map<string, RelativePointStation[] | null> | null;
  positionGains: Map<string, boolean> | null;
  authoredExtensions: Map<number, ProgramStation[]> | null;
  evaluationClaims: EvaluationClaimMap;
  ownershipAssertion: RacecraftCornerOwnershipAssertion | null;
  actionableOwnershipViews: readonly ActionableOwnershipAssertion[];
  defenderReclaim: boolean;
  defensiveLegality: RacecraftDefensiveLegalityResult | null;
  /** Integral of grip utilization over the authored rollout. */
  utilizationExposureSeconds: number;
  utilizationExposure: Array<{
    time: number;
    cumulativeSeconds: number;
  }>;
  fullyScored: boolean;
  branchBounded: boolean;
  effortRiskComputed: boolean;
}

interface CandidateSpeedLaw {
  envelope: SpeedEnvelope;
  brakingEffort: number;
  slowPoint: EntryTrafficSlowPoint | null;
  longitudinalOwnerCode: string | null;
  stagedClearanceProgressMetres: number | null;
  stagedClearanceSeconds: number | null;
  stagedConstrainedSeconds: number;
  stagedPublicationMissing: boolean;
}

interface CandidateEvaluationWorkspace {
  speedLawReferences: CandidateSpeedLawReference[];
  rejectedSpeedLaw: CandidateSpeedLaw | null;
  rejectedStations: ProgramStation[] | null;
  towGridCache: CandidateTowRivalGridCache | null;
  towPublishedStatesByTime: Map<number, CandidateTowPublishedStates>;
  towPublishedStateBuffers: CandidateTowPublishedStates[];
  towPublishedStateUsed: number;
  speedConstructionBuffers: CandidateSpeedConstructionBuffer[];
  speedConstructionUsed: number;
}

interface CandidateSpeedConstructionBuffer {
  speed: number[];
  source: Array<EntryTrafficSlowPoint | null>;
  envelope: SpeedEnvelopeConstructionBuffers;
}

interface CandidateSpeedLawReference {
  brakingEffort: number;
  ownerCode: string | null;
  idealAfterProgress: number;
  speed: number[];
  source: Array<EntryTrafficSlowPoint | null>;
}

interface CandidateSpatialStateScratch {
  plan: PathPlan | null;
  program: CompactLateralProgram | null;
  dynamics: RacecraftFamilyDynamics | null;
  startProgress: number;
  startIndex: number;
  valid: Uint8Array;
  idealValid: Uint8Array;
  idealValue: Float64Array;
  idealFirstDerivative: Float64Array;
  idealSecondDerivative: Float64Array;
  lateral: Float64Array;
  curvature: Float64Array;
  q: Float64Array;
  capabilitySpeed: Float64Array;
  dynamicMu: Float64Array;
  surfaceRoad: Float64Array;
  surfaceCurb: Float64Array;
  surfaceGrass: Float64Array;
  surfaceMu: Float64Array;
  surfaceDrag: Float64Array;
  targetSpeed: Float64Array;
}

interface CandidateSpatialStateScratches {
  working: CandidateSpatialStateScratch;
  retained: CandidateSpatialStateScratch;
}

const candidateSpatialStateScratchesByEntry =
  new WeakMap<Entry, CandidateSpatialStateScratches>();
const retainedCandidateSpatialPlanByEntry = new WeakMap<Entry, PathPlan>();
const candidatePhysicalPlanByPlan = new WeakMap<PathPlan, PathPlan>();
const candidateFamilyStateScratch: LaneState = {
  lateral: 0,
  curvature: 0,
  q: 0,
  headingOffsetRadians: 0,
  capabilitySpeed: 0,
  targetSpeed: 0,
  dynamicMu: 0,
  surfaceRoad: 0,
  surfaceCurb: 0,
  surfaceGrass: 0,
  surfaceMu: 0,
  surfaceDrag: 0
};
const candidateLateralPoseScratch = {
  lateralMetres: 0,
  headingOffsetRadians: 0
};
const candidateIdealSampleScratch: CompactLateralSample = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};
const lambdaIdealSampleScratch: CompactLateralSample = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};
const lambdaFullSampleScratch: CompactLateralSample = {
  value: 0,
  firstDerivative: 0,
  secondDerivative: 0
};
const ownTimeGeometryScratch = {
  lateral: 0,
  curvature: 0,
  q: 0,
  headingOffsetRadians: 0
};

function createCandidateSpatialStateScratch(
  ideal?: CandidateSpatialStateScratch
): CandidateSpatialStateScratch {
  return {
      plan: null,
      program: null,
      dynamics: null,
      startProgress: 0,
      startIndex: 0,
      valid: new Uint8Array(LANE_BUFFER_CAPACITY),
      idealValid: ideal?.idealValid ??
        new Uint8Array(LANE_BUFFER_CAPACITY),
      idealValue: ideal?.idealValue ??
        new Float64Array(LANE_BUFFER_CAPACITY),
      idealFirstDerivative: ideal?.idealFirstDerivative ??
        new Float64Array(LANE_BUFFER_CAPACITY),
      idealSecondDerivative: ideal?.idealSecondDerivative ??
        new Float64Array(LANE_BUFFER_CAPACITY),
      lateral: new Float64Array(LANE_BUFFER_CAPACITY),
      curvature: new Float64Array(LANE_BUFFER_CAPACITY),
      q: new Float64Array(LANE_BUFFER_CAPACITY),
      capabilitySpeed: new Float64Array(LANE_BUFFER_CAPACITY),
      dynamicMu: new Float64Array(LANE_BUFFER_CAPACITY),
      surfaceRoad: new Float64Array(LANE_BUFFER_CAPACITY),
      surfaceCurb: new Float64Array(LANE_BUFFER_CAPACITY),
      surfaceGrass: new Float64Array(LANE_BUFFER_CAPACITY),
      surfaceMu: new Float64Array(LANE_BUFFER_CAPACITY),
      surfaceDrag: new Float64Array(LANE_BUFFER_CAPACITY),
      targetSpeed: new Float64Array(LANE_BUFFER_CAPACITY)
  };
}

function candidateSpatialStateScratches(
  entry: Entry
): CandidateSpatialStateScratches {
  let scratches = candidateSpatialStateScratchesByEntry.get(entry);
  if (!scratches) {
    const working = createCandidateSpatialStateScratch();
    scratches = {
      working,
      retained: createCandidateSpatialStateScratch(working)
    };
    candidateSpatialStateScratchesByEntry.set(entry, scratches);
  }
  return scratches;
}

function candidatePhysicalPlan(plan: PathPlan): PathPlan {
  return candidatePhysicalPlanByPlan.get(plan) ?? plan;
}

function prepareCandidateSpatialState(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan
): CandidateSpatialStateScratch {
  const physicalPlan = candidatePhysicalPlan(plan);
  const scratches = candidateSpatialStateScratches(entry);
  const retainedPlan = retainedCandidateSpatialPlanByEntry.get(entry);
  const spatial = physicalPlan === retainedPlan
    ? scratches.retained
    : scratches.working;
  const other = spatial === scratches.retained
    ? scratches.working
    : scratches.retained;
  if (spatial.startProgress !== entry.prog) {
    if (other.startProgress !== entry.prog)
      spatial.idealValid.fill(0);
    spatial.startProgress = entry.prog;
    spatial.valid.fill(0);
  }
  if (spatial.plan !== physicalPlan) {
    spatial.plan = physicalPlan;
    if (physicalPlan.mode === 'pit')
      throw new Error('Pit authority cannot enter candidate spatial state');
    spatial.program = entry.racecraftPathPlan === physicalPlan &&
        entry.racecraftLateralProgram
      ? entry.racecraftLateralProgram
      : compileCompactLateralProgram(session.trk, physicalPlan);
    spatial.valid.fill(0);
  }
  spatial.dynamics = racecraftFamilyDynamics(session, entry);
  spatial.startIndex = cyclicIndex(session.trk, entry.car.progIdx);
  return spatial;
}

function writeCandidateSpatialStateSlot(
  session: Session,
  entry: ActiveEntry,
  spatial: CandidateSpatialStateScratch,
  slot: number,
  progress: number
): void {
  if (!spatial.idealValid[slot]) {
    const ideal = writeTrackIdealLateralAnalytic(
      session.trk,
      progress,
      candidateIdealSampleScratch
    );
    spatial.idealValue[slot] = ideal.value;
    spatial.idealFirstDerivative[slot] = ideal.firstDerivative;
    spatial.idealSecondDerivative[slot] = ideal.secondDerivative;
    spatial.idealValid[slot] = 1;
  }
  candidateIdealSampleScratch.value = spatial.idealValue[slot]!;
  candidateIdealSampleScratch.firstDerivative =
    spatial.idealFirstDerivative[slot]!;
  candidateIdealSampleScratch.secondDerivative =
    spatial.idealSecondDerivative[slot]!;
  const program = spatial.program;
  const dynamics = spatial.dynamics;
  if (!program || !dynamics)
    throw new Error('Candidate spatial state was not prepared');
  const state = writePreparedRacecraftFamilyKinematicsAt(
    session.trk,
    progress,
    (spatial.startIndex + slot) % session.trk.n,
    program,
    dynamics,
    candidateFamilyStateScratch,
    candidateIdealSampleScratch
  );
  spatial.lateral[slot] = state.lateral;
  spatial.curvature[slot] = state.curvature;
  spatial.q[slot] = state.q;
  spatial.capabilitySpeed[slot] = state.capabilitySpeed;
  spatial.dynamicMu[slot] = state.dynamicMu;
  spatial.surfaceRoad[slot] = state.surfaceRoad;
  spatial.surfaceCurb[slot] = state.surfaceCurb;
  spatial.surfaceGrass[slot] = state.surfaceGrass;
  spatial.surfaceMu[slot] = state.surfaceMu;
  spatial.surfaceDrag[slot] = state.surfaceDrag;
  spatial.targetSpeed[slot] = state.targetSpeed;
  spatial.valid[slot] = 1;
}

type EvaluationClaimMap = ReadonlyMap<string, RacecraftEvaluationClaim>;
const EMPTY_EVALUATION_CLAIMS: EvaluationClaimMap = new Map();
const EMPTY_OWNERSHIP_VIEWS: readonly ActionableOwnershipAssertion[] = [];

export interface RacecraftContestedRegion {
  readonly sMetres: number;
  readonly sessionTimeSeconds: number;
}

interface Hazard {
  key: string;
  other: ActiveEntry;
  claim: RacecraftClaim;
  /** Prediction origin consumed by the continuous body sweep. */
  originS: number;
  originLateral: number;
  originHeadingOffsetRadians: number;
  /** Fixed world geometry for the immutable rival publication. */
  rivalSweepGeometry: {
    origin: WorldBodyPose;
    stations: WorldBodyPose[];
  } | null;
}

interface SweptContact {
  time: number;
  egoProgress: number;
  egoSpeed: number;
  maximumRelativeNormalSpeed: number;
  episodes: readonly SweptCarContactEpisode[];
}

interface HazardCost {
  seconds: number;
  billSeconds: number;
}

interface HazardClearance {
  clearanceMetres: number;
}

type MutableNearRubTrajectorySample = {
  -readonly [Key in keyof NearRubTrajectorySample]:
    NearRubTrajectorySample[Key];
};

interface ScoreProgramsScratch {
  hazards: Hazard[];
  stations: Array<RelativePointStation[] | null>;
  clearances: Array<HazardClearance | null>;
  nearRubSamples: MutableNearRubTrajectorySample[];
}

const scoreProgramsScratchBySession =
  new WeakMap<Session, ScoreProgramsScratch>();

interface RuntimePairEconomics {
  lastAt: number;
  egoProgress: number;
  rivalProgress: number;
  pace: NormalizedPairPaceEvidence;
  opportunity: OpportunityIntervalEvidence;
  activeBattleFamilyNumericId: number | null;
}

type BattleEconomicsRole = 'attack' | 'defense';

interface BattleEconomicsContext {
  rival: ActiveEntry;
  role: BattleEconomicsRole;
  state: RuntimePairEconomics;
  positionValueSeconds: number;
  opportunityPresent: boolean;
  paceDifferentialSecondsPerLap: number;
  reopportunitySeconds: number;
  battleFamilyNumericIds: ReadonlySet<number>;
}

const battleEconomicsBySession =
  new WeakMap<Session, Map<string, RuntimePairEconomics>>();
const observedBattleContextsByEntry =
  new WeakMap<Entry, Map<string, BattleEconomicsContext>>();
const selectedBattleStatesByEntry =
  new WeakMap<Entry, Set<RuntimePairEconomics>>();
const planNumericIds = new WeakMap<PathPlan, number>();
let nextPlanNumericId = 1;
interface FamilyIdentityInterner {
  nextId: number;
  byLabel: Map<string, number>;
}
const familyIdentityBySession =
  new WeakMap<Session, FamilyIdentityInterner>();

interface CandidateTowRivalGridCache {
  computed: Uint8Array;
  hasNearest: Uint8Array;
  downstream: Float64Array;
  lateral: Float64Array;
}

const candidateEvaluationWorkspaceByEntry =
  new WeakMap<Entry, CandidateEvaluationWorkspace>();

function prepareCandidateEvaluationWorkspace(
  entry: Entry
): CandidateEvaluationWorkspace {
  let workspace = candidateEvaluationWorkspaceByEntry.get(entry);
  if (!workspace) {
    workspace = {
      speedLawReferences: [],
      rejectedSpeedLaw: null,
      rejectedStations: null,
      towGridCache: null,
      towPublishedStatesByTime: new Map(),
      towPublishedStateBuffers: [],
      towPublishedStateUsed: 0,
      speedConstructionBuffers: [],
      speedConstructionUsed: 0
    };
    candidateEvaluationWorkspaceByEntry.set(entry, workspace);
    return workspace;
  }
  workspace.speedLawReferences.length = 0;
  workspace.rejectedSpeedLaw = null;
  workspace.rejectedStations = null;
  workspace.towPublishedStatesByTime.clear();
  workspace.towPublishedStateUsed = 0;
  workspace.speedConstructionUsed = 0;
  workspace.towGridCache?.computed.fill(0);
  return workspace;
}

function candidateSpeedConstructionBuffer(
  workspace: CandidateEvaluationWorkspace,
  count: number
): CandidateSpeedConstructionBuffer {
  const index = workspace.speedConstructionUsed++;
  let buffer = workspace.speedConstructionBuffers[index];
  if (!buffer) {
    buffer = {
      speed: new Array<number>(count),
      source: new Array<EntryTrafficSlowPoint | null>(count),
      envelope: createSpeedEnvelopeConstructionBuffers(count - 1)
    };
    workspace.speedConstructionBuffers[index] = buffer;
    return buffer;
  }
  if (buffer.speed.length !== count) {
    buffer.speed = new Array<number>(count);
    buffer.source = new Array<EntryTrafficSlowPoint | null>(count);
    buffer.envelope = createSpeedEnvelopeConstructionBuffers(count - 1);
  }
  return buffer;
}

interface CandidateTowPublishedStates {
  count: number;
  s: Float64Array;
  lateral: Float64Array;
}

const candidateTowPublishedStates = new WeakMap<
  EvaluationClaimMap,
  Map<number, CandidateTowPublishedStates>
>();
const candidateTowWorkspaceByClaims = new WeakMap<
  EvaluationClaimMap,
  CandidateEvaluationWorkspace
>();
const candidateTowClaimViews = new WeakMap<
  EvaluationClaimMap,
  RacecraftEvaluationClaim[]
>();

function candidateTowClaimViewsFor(
  entry: ActiveEntry,
  evaluationClaims: EvaluationClaimMap
): readonly RacecraftEvaluationClaim[] {
  let views = candidateTowClaimViews.get(evaluationClaims);
  if (views) return views;
  views = [];
  for (const [code, view] of evaluationClaims)
    if (code !== entry.code) views.push(view);
  views.sort((left, right) =>
    left.claim.code.localeCompare(right.claim.code));
  candidateTowClaimViews.set(evaluationClaims, views);
  return views;
}

function bindCandidateTowWorkspace(
  evaluationClaims: EvaluationClaimMap,
  workspace: CandidateEvaluationWorkspace
): void {
  candidateTowPublishedStates.set(
    evaluationClaims,
    workspace.towPublishedStatesByTime
  );
  candidateTowWorkspaceByClaims.set(evaluationClaims, workspace);
}
const candidateTowStateScratch: RacecraftClaimState = {
  progressMetres: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};
const candidateTowLateralStateScratch: RacecraftClaimTowState = {
  s: 0,
  lateral: 0
};
const programStationScratchA: ProgramStation = {
  time: 0,
  progress: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};
interface CachedRivalSweepGeometry {
  track: Track;
  publishedAt: number;
  publicationRevision: number;
  predictionKey: string;
  geometry: NonNullable<Hazard['rivalSweepGeometry']>;
}
const rivalSweepGeometryByClaim =
  new WeakMap<RacecraftClaim, CachedRivalSweepGeometry>();

function reconcileBattleOpportunityObservations(
  session: Session,
  entry: ActiveEntry,
  contexts: readonly BattleEconomicsContext[]
): void {
  const previous = observedBattleContextsByEntry.get(entry);
  const current = new Map(contexts.map(context => [
    `${context.role}:${context.rival.code}`,
    context
  ]));
  for (const [key, context] of previous ?? []) {
    if (current.has(key)) continue;
    context.state.opportunity = updateOpportunityIntervalEvidence(
      context.state.opportunity,
      {
        nowSeconds: session.t,
        opportunityPresent: false
      }
    );
  }
  observedBattleContextsByEntry.set(entry, current);
}

function commitBattleEconomicsSelection(
  entry: ActiveEntry,
  selected: CandidateProgram | null,
  contexts: readonly BattleEconomicsContext[]
): void {
  for (const state of selectedBattleStatesByEntry.get(entry) ?? [])
    state.activeBattleFamilyNumericId = null;
  const active = new Set<RuntimePairEconomics>();
  if (selected) {
    const familyNumericId = selected.evaluation.familyNumericId;
    for (const context of contexts) {
      if (!battleProgram(selected, context)) continue;
      context.state.activeBattleFamilyNumericId = familyNumericId;
      active.add(context.state);
    }
  }
  selectedBattleStatesByEntry.set(entry, active);
}

function evaluatorDynamics(
  session: Session,
  entry: Entry
): RacecraftFamilyDynamics {
  if (!entry.car)
    throw new Error('Racecraft dynamics require an active car');
  return racecraftFamilyDynamics(
    session,
    entry as ActiveEntry
  );
}

function laneStateAt(
  session: Session,
  entry: ActiveEntry,
  progress: number,
  plan: PathPlan
): LaneState {
  let effectivePlan = plan;
  if (plan.mode !== 'ideal' && plan.mode !== 'pit' &&
      plan.lineTerminal !== 'sustained-offset') {
    const terminalProgress = plan.anchors.at(-1)?.s;
    if (terminalProgress != null &&
        progress > terminalProgress + Number.EPSILON)
      effectivePlan = IDEAL_PATH_PLAN;
  }
  return computeLaneStateAt(
    session,
    entry,
    progress,
    effectivePlan
  );
}

interface PreparedLaneStateProgram {
  authored: CompactLateralProgram;
  ideal: CompactLateralProgram;
  terminalProgress: number | null;
  dynamics: RacecraftFamilyDynamics;
}

function prepareLaneStateProgram(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan
): PreparedLaneStateProgram {
  if (plan.mode === 'pit')
    throw new Error('Sampled pit paths have no compact family state');
  const authored = compileCompactLateralProgram(session.trk, plan);
  const terminalProgress = plan.mode === 'ideal' ||
      plan.lineTerminal === 'sustained-offset'
    ? null
    : plan.anchors.at(-1)?.s ?? null;
  return {
    authored,
    ideal: terminalProgress == null
      ? authored
      : compileCompactLateralProgram(session.trk, IDEAL_PATH_PLAN),
    terminalProgress,
    dynamics: evaluatorDynamics(session, entry)
  };
}

function preparedLaneStateAt(
  session: Session,
  entry: ActiveEntry,
  progress: number,
  prepared: PreparedLaneStateProgram
): LaneState {
  return writePreparedRacecraftFamilyStateAt(
    session.trk,
    progress,
    indexAtProgress(session.trk, entry, progress),
    prepared.terminalProgress != null &&
        progress > prepared.terminalProgress + Number.EPSILON
      ? prepared.ideal
      : prepared.authored,
    prepared.dynamics,
    {
      lateral: 0,
      curvature: 0,
      q: 0,
      headingOffsetRadians: 0,
      capabilitySpeed: 0,
      targetSpeed: 0,
      dynamicMu: 0,
      surfaceRoad: 0,
      surfaceCurb: 0,
      surfaceGrass: 0,
      surfaceMu: 0,
      surfaceDrag: 0
    }
  );
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function indexAtProgress(
  track: Track,
  entry: ActiveEntry,
  progress: number
): number {
  return cyclicIndex(
    track,
    entry.car.progIdx + (progress - entry.prog) / track.step
  );
}

interface EvaluatorManeuverSamplerContext {
  session: Session;
  entry: ActiveEntry;
  plan: PathPlan;
  program: CompactLateralProgram | null;
  dynamics: RacecraftFamilyDynamics | null;
  stateSlots: Int32Array;
  stateStamps: Uint32Array;
  stateGeneration: number;
  statePool: LaneState[];
  stateUsed: number;
  spatial: CandidateSpatialStateScratch | null;
  diagnostic: ManeuverCandidateDiagnostic | undefined;
}

const evaluatorManeuverSamplerContexts =
  new WeakMap<ActiveEntry, EvaluatorManeuverSamplerContext>();

function evaluatorManeuverProgressAt(
  context: EvaluatorManeuverSamplerContext,
  index: number
): number {
  const start = cyclicIndex(
    context.session.trk,
    context.entry.car.progIdx
  );
  return context.entry.prog + distanceAhead(
    context.session.trk,
    start,
    cyclicIndex(context.session.trk, index)
  );
}

function evaluatorSpatialSlotAt(
  context: EvaluatorManeuverSamplerContext,
  progress: number
): number {
  const spatial = context.spatial;
  if (!spatial || spatial.plan !== candidatePhysicalPlan(context.plan))
    return -1;
  const raw = (progress - spatial.startProgress) /
    context.session.trk.step;
  const slot = Math.round(raw);
  if (slot < 0 || slot >= LANE_BUFFER_CAPACITY ||
      Math.abs(raw - slot) > Number.EPSILON *
        Math.max(1, Math.abs(raw)) * 8)
    return -1;
  return slot;
}

function evaluatorEnsureSpatialSlot(
  context: EvaluatorManeuverSamplerContext,
  progress: number
): number {
  const slot = evaluatorSpatialSlotAt(context, progress);
  if (slot < 0) return -1;
  const spatial = context.spatial!;
  if (!spatial.valid[slot]) {
    if (context.plan.mode === 'pit') return -1;
    writeCandidateSpatialStateSlot(
      context.session,
      context.entry,
      spatial,
      slot,
      progress
    );
  }
  return slot;
}

function evaluatorManeuverStateAt(
  context: EvaluatorManeuverSamplerContext,
  index: number
): LaneState {
  const wrapped = cyclicIndex(context.session.trk, index);
  if (context.stateStamps[wrapped] === context.stateGeneration)
    return context.statePool[context.stateSlots[wrapped]!]!;
  const progress = evaluatorManeuverProgressAt(context, wrapped);
  const program = context.program;
  const dynamics = context.dynamics;
  if (!program || !dynamics)
    throw new Error('Maneuver sampler state was not prepared');
  const slot = context.stateUsed++;
  const state = context.statePool[slot] ??
    (context.statePool[slot] = {
      lateral: 0,
      curvature: 0,
      q: 0,
      headingOffsetRadians: 0,
      capabilitySpeed: 0,
      targetSpeed: 0,
      dynamicMu: 0,
      surfaceRoad: 0,
      surfaceCurb: 0,
      surfaceGrass: 0,
      surfaceMu: 0,
      surfaceDrag: 0
    });
  writePreparedRacecraftFamilyStateAt(
    context.session.trk,
    progress,
    wrapped,
    program,
    dynamics,
    state
  );
  context.stateSlots[wrapped] = slot;
  context.stateStamps[wrapped] = context.stateGeneration;
  return state;
}

const EVALUATOR_MANEUVER_SAMPLER:
  ManeuverPlanSampler<EvaluatorManeuverSamplerContext> = {
    lateralAt(context, index) {
      const progress = evaluatorManeuverProgressAt(context, index);
      const slot = evaluatorEnsureSpatialSlot(context, progress);
      if (slot >= 0) return context.spatial!.lateral[slot]!;
      return evaluatorManeuverStateAt(context, index).lateral;
    },
    curvatureAt(context, index) {
      const progress = evaluatorManeuverProgressAt(context, index);
      const slot = evaluatorEnsureSpatialSlot(context, progress);
      if (slot >= 0) return context.spatial!.curvature[slot]!;
      return evaluatorManeuverStateAt(context, index).curvature;
    },
    writePhysicalSample(context, index, out: ManeuverPhysicalSample) {
      const progress = evaluatorManeuverProgressAt(context, index);
      const slot = evaluatorEnsureSpatialSlot(context, progress);
      if (slot < 0) {
        const state = evaluatorManeuverStateAt(context, index);
        out.lateral = state.lateral;
        out.curvature = state.curvature;
        out.capabilitySpeed = state.capabilitySpeed;
        out.dynamicMu = state.dynamicMu;
        out.road = state.surfaceRoad;
        out.curb = state.surfaceCurb;
        out.grass = state.surfaceGrass;
        out.mu = state.surfaceMu;
        return out;
      }
      const spatial = context.spatial!;
      out.lateral = spatial.lateral[slot]!;
      out.curvature = spatial.curvature[slot]!;
      out.capabilitySpeed = spatial.capabilitySpeed[slot]!;
      out.dynamicMu = spatial.dynamicMu[slot]!;
      out.road = spatial.surfaceRoad[slot]!;
      out.curb = spatial.surfaceCurb[slot]!;
      out.grass = spatial.surfaceGrass[slot]!;
      out.mu = spatial.surfaceMu[slot]!;
      return out;
    }
  };

function distanceAhead(track: Track, from: number, to: number): number {
  return ((cyclicIndex(track, to) - cyclicIndex(track, from) + track.n) %
    track.n) * track.step;
}

function indexInWindow(
  track: Track,
  index: number,
  from: number,
  to: number
): boolean {
  return distanceAhead(track, from, index) <= distanceAhead(track, from, to);
}

function directionFor(delta: number): RacecraftDirection {
  const threshold = PHYS.carWid / 8;
  return delta > threshold ? 'left' : delta < -threshold ? 'right' : 'hold';
}

function activeLeader(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[]
): { entry: ActiveEntry; distance: number } | null {
  let leader: { entry: ActiveEntry; distance: number } | null = null;
  for (const candidate of entries) {
    if (candidate === entry || !candidate.car || candidate.state !== 'run')
      continue;
    const distance = (
      candidate.car.s - entry.car.s + session.trk.len
    ) % session.trk.len;
    const scan = contractIsRevoked(session, candidate) ||
      isFixedOccupancy(session, candidate)
      ? OBSTACLE_NEIGHBOR_SCAN_METRES
      : TRAFFIC_NEIGHBOR_SCAN_METRES;
    if (distance <= 0 || distance > scan) continue;
    if (!leader || distance < leader.distance ||
        (distance === leader.distance &&
          candidate.code.localeCompare(leader.entry.code) < 0))
      leader = { entry: candidate as ActiveEntry, distance };
  }
  return leader;
}

function activeDefensiveAttacker(
  session: Session,
  defender: ActiveEntry,
  entries: readonly Entry[],
  actionableOwnershipViews:
    readonly ActionableOwnershipAssertion[] = EMPTY_OWNERSHIP_VIEWS
): {
  entry: ActiveEntry;
  distance: number;
  claim: RacecraftClaim;
  side: -1 | 1;
} | null {
  let nearest: {
    entry: ActiveEntry;
    distance: number;
    claim: RacecraftClaim;
    side: -1 | 1;
  } | null = null;
  for (const candidate of entries) {
    if (candidate === defender || !candidate.car ||
        candidate.state !== 'run')
      continue;
    const relative = signedTrackDistance(
      session.trk,
      candidate.car.s,
      defender.car.s
    );
    const ownershipIncoming = actionableOwnershipViews.some(view =>
      view.assertion.attackerCode === candidate.code &&
      view.assertion.targetCode === defender.code);
    if (relative < -PHYS.carLen && !ownershipIncoming) continue;
    const distance = Math.abs(relative);
    if (distance > TRAFFIC_NEIGHBOR_SCAN_METRES ||
        (nearest &&
          (
            distance > nearest.distance + Number.EPSILON ||
            (
              Math.abs(distance - nearest.distance) <= Number.EPSILON &&
              candidate.code.localeCompare(nearest.entry.code) >= 0
            )
          )))
      continue;
    const claim = session.racecraftClaims?.get(candidate.code);
    if (!claim || !claim.trusted ||
        claim.mode !== 'staged-attack' ||
        claim.targetCode !== defender.code ||
        claim.selectedFamilyNumericId == null)
      continue;
    const age = Math.max(0, session.t - claim.publishedAt);
    const horizon = racecraftClaimHorizonSeconds(claim);
    if (age > horizon + TRAF_DT + Number.EPSILON) continue;
    const current = racecraftClaimStateAtTime(
      session.trk,
      claim,
      age
    );
    const defenderPublication =
      session.racecraftClaims?.get(defender.code);
    const defenderCurrent = defenderPublication
      ? racecraftClaimStateAtTime(
          session.trk,
          defenderPublication,
          Math.max(0, session.t - defenderPublication.publishedAt)
        )
      : {
          lateral: defender.latNow
        };
    const futureLateral = racecraftClaimStateAtTime(
      session.trk,
      claim,
      horizon
    ).lateral;
    const defenderFuture = defenderPublication
      ? racecraftClaimStateAtTime(
          session.trk,
          defenderPublication,
          Math.max(0, session.t - defenderPublication.publishedAt) +
            Math.max(0, horizon - age)
        ).lateral
      : defender.latNow;
    const currentRelative =
      current.lateral - defenderCurrent.lateral;
    const futureRelative = futureLateral - defenderFuture;
    if (Math.abs(futureRelative - currentRelative) <= Number.EPSILON &&
        Math.abs(currentRelative) <
          PHYS.carWid - Number.EPSILON)
      continue;
    const sideValue = Math.abs(futureRelative) > Number.EPSILON
      ? futureRelative
      : currentRelative;
    if (Math.abs(sideValue) <= Number.EPSILON) continue;
    nearest = {
      entry: candidate as ActiveEntry,
      distance,
      claim,
      side: sideValue < 0 ? -1 : 1
    };
  }
  return nearest;
}

function idealElapsedAtProgress(
  session: Session,
  progress: number
): number {
  const track = session.trk;
  const timing = track.idealTiming ?? {
    t: session.prof.t,
    lapTime: session.prof.lapTime
  };
  const lap = Math.floor(progress / track.len);
  const wrapped = (
    (progress % track.len) + track.len
  ) % track.len;
  const sample = wrapped / track.step;
  const index = Math.min(track.n - 1, Math.floor(sample));
  const u = sample - index;
  const from = timing.t[index]!;
  const to = index + 1 < track.n
    ? timing.t[index + 1]!
    : timing.lapTime;
  return lap * timing.lapTime + from + (to - from) * u;
}

export function racecraftCapabilityPaceRatio(
  session: Session,
  entry: Entry
): number {
  const referenceLap =
    session.trk.idealTiming?.lapTime ?? session.prof.lapTime;
  const observed = entry.lastLap > 0 && Number.isFinite(entry.lastLap)
    ? entry.lastLap
    : entry.best > 0 && Number.isFinite(entry.best)
      ? entry.best
      : null;
  if (observed != null) return observed / referenceLap;
  return 1 / Math.max(
    Number.EPSILON,
    evaluatorDynamics(session, entry).margin
  );
}

function pairEconomicsState(
  session: Session,
  entry: ActiveEntry,
  rival: ActiveEntry
): RuntimePairEconomics {
  let states = battleEconomicsBySession.get(session);
  if (!states) {
    states = new Map();
    battleEconomicsBySession.set(session, states);
  }
  const key = `${entry.code}>${rival.code}`;
  let state = states.get(key);
  if (!state) {
    state = {
      lastAt: session.t,
      egoProgress: entry.prog,
      rivalProgress: rival.prog,
      pace: createNormalizedPairPaceEvidence(
        racecraftCapabilityPaceRatio(session, entry),
        racecraftCapabilityPaceRatio(session, rival)
      ),
      opportunity: createOpportunityIntervalEvidence(),
      activeBattleFamilyNumericId: null
    };
    states.set(key, state);
  }
  return state;
}

function normalAttackProgram(
  program: CandidateProgram,
  leader: ActiveEntry
): boolean {
  const plan = program.evaluation.plan;
  return program.evaluation.feasible &&
    plan.mode !== 'ideal' &&
    plan.mode !== 'pit' &&
    (plan.mode === 'side-inside' || plan.mode === 'side-outside') &&
    plan.surfaceAuthorization !== 'emergency' &&
    plan.leaderCode === leader.code;
}

function normalDefenseProgram(
  session: Session,
  program: CandidateProgram,
  defender: ActiveEntry,
  attackerPublication: RacecraftClaim
): boolean {
  const plan = program.evaluation.plan;
  const age = Math.max(
    0,
    session.t - attackerPublication.publishedAt
  );
  const horizon = racecraftClaimHorizonSeconds(attackerPublication);
  const attackTarget = racecraftClaimStateAtTime(
    session.trk,
    attackerPublication,
    age + horizon
  ).lateral;
  return program.evaluation.feasible &&
    plan.mode !== 'ideal' &&
    plan.mode !== 'pit' &&
    (plan.mode === 'side-inside' || plan.mode === 'side-outside') &&
    plan.surfaceAuthorization !== 'emergency' &&
    Math.abs(program.evaluation.targetLateral - attackTarget) <
      Math.abs(defender.latNow - attackTarget);
}

function battleProgram(
  program: CandidateProgram,
  context: BattleEconomicsContext
): boolean {
  return context.battleFamilyNumericIds.has(
    program.evaluation.familyNumericId
  );
}

function attackProgramGainsPosition(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  hazard: Hazard
): boolean {
  const cached = program.positionGains?.get(hazard.key);
  if (cached != null) return cached;
  const plan = program.evaluation.plan;
  const targetProgress = plan.mode !== 'ideal' && plan.mode !== 'pit'
    ? plan.anchors
        .map(anchor => anchor.s)
        .filter((value): value is number =>
          value != null && value > entry.prog + Number.EPSILON)
        .at(-1)
    : null;
  const initialGap = signedTrackDistance(
    session.trk,
    program.stations[0]!.s,
    hazard.originS
  );
  if (targetProgress == null ||
      targetProgress - entry.prog > session.trk.len / 2 ||
      initialGap <= 0) {
    (program.positionGains ??= new Map()).set(hazard.key, false);
    return false;
  }
  const last = program.stations.at(-1)!;
  const terminal = targetProgress <= last.progress + Number.EPSILON
    ? programStationAtTime(
        session.trk,
        program.stations,
        arrivalTimeOnProgram(program.stations, targetProgress)
      )
    : extendAuthoredProgramToProgress(
        session,
        entry,
        plan,
        program.speedLaw,
        program.stations,
        targetProgress,
        program.evaluationClaims
      );
  const rival = bestPlanStateAtTime(
    session,
    hazard,
    program.evaluationClaims,
    terminal.time
  );
  if (!rival) {
    (program.positionGains ??= new Map()).set(hazard.key, false);
    return false;
  }
  const gains = signedTrackDistance(
    session.trk,
    terminal.s,
    rival.s
  ) <= 0;
  (program.positionGains ??= new Map()).set(hazard.key, gains);
  return gains;
}

function updateBattleEconomicsContext(
  session: Session,
  entry: ActiveEntry,
  rival: ActiveEntry,
  programs: readonly CandidateProgram[],
  hazard: Hazard,
  role: BattleEconomicsRole,
  rivalPublication: RacecraftClaim | null = null
): BattleEconomicsContext {
  const state = pairEconomicsState(session, entry, rival);
  const elapsed = session.t - state.lastAt;
  const referenceLap =
    session.trk.idealTiming?.lapTime ?? session.prof.lapTime;
  const reopportunity = reopportunitySeconds(
    state.opportunity,
    referenceLap
  );
  if (elapsed > Number.EPSILON) {
    const egoReference = idealElapsedAtProgress(
      session,
      entry.prog
    ) - idealElapsedAtProgress(session, state.egoProgress);
    const rivalReference = idealElapsedAtProgress(
      session,
      rival.prog
    ) - idealElapsedAtProgress(session, state.rivalProgress);
    if (egoReference > Number.EPSILON &&
        rivalReference > Number.EPSILON) {
      state.pace = updateNormalizedPairPaceEvidence(
        state.pace,
        {
          elapsedSeconds: elapsed,
          egoReferenceProgressSeconds: egoReference,
          rivalReferenceProgressSeconds: rivalReference,
          reopportunitySeconds: reopportunity
        }
      );
    }
    state.lastAt = session.t;
    state.egoProgress = entry.prog;
    state.rivalProgress = rival.prog;
  }
  const battlePrograms = programs.filter(program =>
    role === 'attack'
      ? normalAttackProgram(program, rival)
      : rivalPublication != null &&
        normalDefenseProgram(
          session,
          program,
          entry,
          rivalPublication
        ));
  if (role === 'attack') {
    for (const program of battlePrograms)
      program.evaluation.positionGain = attackProgramGainsPosition(
        session,
        entry,
        program,
        hazard
      );
  }
  const opportunityPresent = battlePrograms.length > 0;
  state.opportunity = updateOpportunityIntervalEvidence(
    state.opportunity,
    {
      nowSeconds: session.t,
      opportunityPresent
    }
  );
  const measuredReopportunity = reopportunitySeconds(
    state.opportunity,
    referenceLap
  );
  const differential = pairPaceDifferentialSecondsPerLap(
    state.pace,
    referenceLap
  );
  const relevantDifferential =
    role === 'attack' ? differential : -differential;
  return {
    rival,
    role,
    state,
    positionValueSeconds: opportunityPresent
      ? positionValueSeconds({
          pace: entry.pace,
          paceDifferentialSecondsPerLap: relevantDifferential,
          reopportunitySeconds: measuredReopportunity,
          referenceLapSeconds: referenceLap
        })
      : 0,
    opportunityPresent,
    paceDifferentialSecondsPerLap: relevantDifferential,
    reopportunitySeconds: measuredReopportunity,
    battleFamilyNumericIds: new Set(battlePrograms.map(program =>
      program.evaluation.familyNumericId))
  };
}

/** Exact bounded-neighbor membership used by directional hazard construction. */
export function racecraftIsInteractionNeighbor(
  session: Session,
  entry: Entry,
  other: Entry
): boolean {
  if (other === entry || !entry.car || !other.car || other.state !== 'run')
    return false;
  const scan = contractIsRevoked(session, other) ||
    isFixedOccupancy(session, other)
    ? OBSTACLE_NEIGHBOR_SCAN_METRES
    : TRAFFIC_NEIGHBOR_SCAN_METRES;
  return Math.abs(signedTrackDistance(
    session.trk,
    entry.car.s,
    other.car.s
  )) <= scan;
}

/**
 * Family identity used by hysteresis and the standing-decision certificate.
 * Acquisition anchors and generated plan keys are deliberately absent.
 */
export function racecraftStableFamilyId(
  kind: RacecraftCandidateKind,
  plan: PathPlan,
  slowPointOwnerCode: string | null
): string {
  if (plan.mode === 'ideal')
    return `${kind}|ideal|||||||${slowPointOwnerCode ?? ''}`;
  if (plan.mode === 'pit')
    return `${kind}|pit|||||||${slowPointOwnerCode ?? ''}`;
  return [
    kind,
    plan.mode,
    plan.topology ?? '',
    plan.cornerId ?? '',
    plan.complexId ?? '',
    plan.lineKind ?? '',
    plan.lineTerminal ?? '',
    plan.lineBlend == null ? '' : plan.lineBlend.toPrecision(17),
    plan.surfaceAuthorization ?? 'normal',
    plan.emergencyReason ?? '',
    slowPointOwnerCode ?? plan.leaderCode ?? ''
  ].join('|');
}

function racecraftPlanNumericId(plan: PathPlan): number {
  let id = planNumericIds.get(plan);
  if (id == null) {
    id = nextPlanNumericId++;
    planNumericIds.set(plan, id);
  }
  return id;
}

function racecraftFamilyNumericId(
  session: Session,
  kind: RacecraftCandidateKind,
  plan: PathPlan,
  slowPointOwnerCode: string | null
): number {
  let interner = familyIdentityBySession.get(session);
  if (!interner) {
    interner = { nextId: 1, byLabel: new Map() };
    familyIdentityBySession.set(session, interner);
  }
  const label = racecraftStableFamilyId(
    kind,
    plan,
    slowPointOwnerCode
  );
  let id = interner.byLabel.get(label);
  if (id == null) {
    id = interner.nextId++;
    interner.byLabel.set(label, id);
  }
  return id;
}

function currentLaneAt(
  session: Session,
  entry: ActiveEntry,
  progress: number
): number {
  const index = indexAtProgress(session.trk, entry, progress);
  if (entry.racecraftPathPlan)
    return writeSampleCompactLateralProgram(
      session.trk,
      entry.racecraftLateralProgram ??
        compileCompactLateralProgram(
          session.trk,
          entry.racecraftPathPlan
        ),
      progress,
      lambdaFullSampleScratch
    ).value;
  const eta = entry.laneProgram.points.length
    ? evaluateLaneEta(entry.laneProgram.points, progress).eta
    : entry.laneProgram.bias;
  return session.trk.idealPath.off[index]! + eta;
}

function authoredPlanAnchor(
  track: Track,
  plan: PathPlan,
  index: number,
  progress: number,
  offset: number
): PathPlanAnchor {
  const ideal = sampleCompactPathPlanOffsetAnalytic(
    track,
    IDEAL_PATH_PLAN,
    index,
    progress
  );
  const authored = sampleCompactPathPlanOffsetAnalytic(
    track,
    plan,
    index,
    progress
  );
  return {
    index,
    offset,
    eta: offset - ideal.value,
    etaFirstDerivative:
      authored.firstDerivative - ideal.firstDerivative,
    etaSecondDerivative:
      authored.secondDerivative - ideal.secondDerivative,
    s: progress
  };
}

function currentAuthoredAnchor(
  session: Session,
  entry: ActiveEntry
): PathPlanAnchor {
  const track = session.trk;
  const index = cyclicIndex(track, entry.car.progIdx);
  if (entry.racecraftPathPlan)
    return authoredPlanAnchor(
      track,
      entry.racecraftPathPlan,
      index,
      entry.prog,
      entry.latNow
    );
  const lane = entry.laneProgram.points.length
    ? evaluateLaneEta(entry.laneProgram.points, entry.prog)
    : {
        eta: entry.laneProgram.bias,
        firstDerivative: 0,
        secondDerivative: 0
      };
  return {
    index,
    offset: entry.latNow,
    eta: entry.latNow - track.idealPath.off[index]!,
    etaFirstDerivative: lane.firstDerivative,
    etaSecondDerivative: lane.secondDerivative,
    s: entry.prog
  };
}

function horizonProgress(entry: ActiveEntry): number {
  return entry.prog +
    Math.max(8, entry.spd || entry.car.spd) *
      MANEUVER_PREDICTION.horizonSeconds;
}

function currentProgramPlan(
  session: Session,
  entry: ActiveEntry
): DynamicPlan {
  if (entry.racecraftPathPlan) return entry.racecraftPathPlan;
  const track = session.trk;
  const start = cyclicIndex(track, entry.car.progIdx);
  const endProgress = horizonProgress(entry);
  const end = indexAtProgress(track, entry, endProgress);
  return {
    mode: 'tuck',
    key: `cost:${entry.code}:hold:${start}`,
    anchors: [
      currentAuthoredAnchor(session, entry),
      {
        index: end,
        offset: currentLaneAt(session, entry, endProgress),
        s: endProgress
      }
    ],
    pinnedFirst: true,
    topology: 'hold',
    surfaceAuthorization: 'normal'
  };
}

function acquisitionPlan(
  session: Session,
  entry: ActiveEntry,
  kind: 'ideal' | 'recenter'
): DynamicPlan {
  const track = session.trk;
  const start = cyclicIndex(track, entry.car.progIdx);
  const target = track.idealPath.off[start]!;
  const seconds = physicalLaneMoveSeconds(session, entry, target);
  const distance = Math.max(
    PHYS.carLen,
    entry.spd * (Number.isFinite(seconds)
      ? seconds
      : MANEUVER_PREDICTION.horizonSeconds)
  );
  const endProgress = entry.prog + Math.min(
    LANE_BUFFER_DISTANCE_METRES,
    distance
  );
  const end = indexAtProgress(track, entry, endProgress);
  return {
    mode: 'tuck',
    key: `cost:${entry.code}:${kind}:${start}`,
    anchors: [
      currentAuthoredAnchor(session, entry),
      { index: end, offset: track.idealPath.off[end]!, s: endProgress }
    ],
    pinnedFirst: true,
    topology: entry.latNow > track.idealPath.off[start]!
      ? 'right'
      : entry.latNow < track.idealPath.off[start]!
        ? 'left'
        : 'hold',
    surfaceAuthorization: 'normal',
    terminal: 'ideal-rejoin'
  };
}

function cornerAtApproach(track: Track, index: number): LegacyCorner | null {
  for (const corner of track.corners ?? [])
    if (corner.alternateLines &&
        indexInWindow(track, index, corner.approachI, corner.exitI))
      return corner;
  return null;
}

function fullCornerPlan(
  session: Session,
  entry: ActiveEntry,
  corner: LegacyCorner,
  kind: 'corner-inside' | 'corner-outside',
  leaderCode: string | null
): DynamicPlan | null {
  const track = session.trk;
  const lineKind = kind === 'corner-inside' ? 'inside' : 'outside';
  const certified = sideAgreementCornerFamilyMember(session, entry, corner);
  const lineTerminal = certified?.kind === lineKind
    ? certified.terminal
    : hasSideAgreement(session, entry.code)
      ? 'sustained-offset'
      : 'ideal-rejoin';
  const family = corner.alternateLines![lineKind];
  const line = lineTerminal === 'sustained-offset'
    ? family.sustainedOffset
    : family.idealRejoin;
  const start = cyclicIndex(track, entry.car.progIdx);
  const exitDistance = distanceAhead(track, start, corner.exitI);
  let targetPoint: (typeof line.points)[number] | null = null;
  let targetDistance = Infinity;
  for (let index = 0; index < line.points.length; index++) {
    const point = line.points[index]!;
    const distance = distanceAhead(track, start, point.index);
    if (distance <= track.step / 2 || distance > exitDistance ||
        distance >= targetDistance)
      continue;
    targetPoint = point;
    targetDistance = distance;
  }
  if (!targetPoint) return null;
  const targetIndex = targetPoint.index;
  const fullTarget = track.idealPath.off[targetIndex]! +
    sampleCornerLineEta(track, corner, line, targetIndex);
  const moveSeconds = physicalLaneMoveSeconds(session, entry, fullTarget);
  if (!Number.isFinite(moveSeconds)) return null;
  const physicalProgress = entry.prog + Math.max(
    PHYS.carLen,
    entry.spd * moveSeconds
  );
  const physicalIndex = indexAtProgress(track, entry, physicalProgress);
  if (physicalProgress - entry.prog >= exitDistance) return null;
  const acquisitionIndex = distanceAhead(track, start, physicalIndex) >
      distanceAhead(track, start, targetIndex)
    ? physicalIndex
    : cyclicIndex(track, targetIndex);
  const acquisitionProgress = entry.prog +
    distanceAhead(track, start, acquisitionIndex);
  const anchors: DynamicPlan['anchors'] = [
    currentAuthoredAnchor(session, entry),
    {
      index: acquisitionIndex,
      offset: track.idealPath.off[acquisitionIndex]! +
        sampleCornerLineEta(track, corner, line, acquisitionIndex),
      s: acquisitionProgress
    }
  ];
  if (acquisitionIndex !== corner.exitI)
    anchors.push({
      index: corner.exitI,
      offset: track.idealPath.off[corner.exitI]! +
        sampleCornerLineEta(track, corner, line, corner.exitI),
      s: entry.prog + exitDistance
    });
  return {
    mode: kind === 'corner-inside' ? 'side-inside' : 'side-outside',
    key: `cost:${entry.code}:${kind}:${line.terminal}:${corner.id}:${start}`,
    anchors,
    pinnedFirst: true,
    cornerId: corner.id,
    complexId: corner.complexId,
    topology: kind === 'corner-inside'
      ? (corner.side > 0 ? 'left' : 'right')
      : (corner.side > 0 ? 'right' : 'left'),
    surfaceAuthorization: 'normal',
    lineKind: line.kind,
    lineTerminal: line.terminal,
    lineBlend: 1,
    leaderCode
  };
}

interface LambdaIntervalWorkspace {
  from: number[];
  to: number[];
  nextFrom: number[];
  nextTo: number[];
  count: number;
}
interface LambdaSeed {
  lambda: number;
}

const lambdaIntervals: LambdaIntervalWorkspace = {
  from: [],
  to: [],
  nextFrom: [],
  nextTo: [],
  count: 0
};
const lambdaConflictIdeal: number[] = [];
const lambdaConflictSlope: number[] = [];
const lambdaConflictCentre: number[] = [];
const lambdaConflictOverlap: number[] = [];
const lambdaBreakpoints: number[] = [];
const stagedLambdaIdeal: number[] = [];
const stagedLambdaDelta: number[] = [];
const stagedLambdaLeader: number[] = [];
const lambdaClaimStateScratch: RacecraftClaimState = {
  progressMetres: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};

function straightFullPlan(
  session: Session,
  entry: ActiveEntry,
  side: -1 | 1,
  leaderCode: string | null
): DynamicPlan | null {
  const track = session.trk;
  const start = cyclicIndex(track, entry.car.progIdx);
  const horizon = horizonProgress(entry);
  const edgeAt = (progress: number): number => {
    const index = indexAtProgress(track, entry, progress);
    const envelope = normalLateralEnvelope(track, index);
    return side < 0 ? envelope.minimum : envelope.maximum;
  };
  const edgeAnchor = (progress: number): PathPlanAnchor => {
    const index = indexAtProgress(track, entry, progress);
    const ideal = sampleCompactPathPlanOffsetAnalytic(
      track,
      IDEAL_PATH_PLAN,
      index,
      progress
    );
    const offset = edgeAt(progress);
    return {
      index,
      offset,
      eta: offset - ideal.value,
      // A surface edge is an absolute road-space constraint. Express its
      // zero tangent/curvature in Frenet eta so the C2 interpolant joins
      // adjacent local constraints without an authored endpoint scallop.
      etaFirstDerivative: -ideal.firstDerivative,
      etaSecondDerivative: -ideal.secondDerivative,
      s: progress
    };
  };
  const gridStepAtOrAfter = (progress: number): number =>
    Math.ceil(
      Math.max(0, progress - entry.prog) / track.step
    );
  const gridProgress = (step: number): number =>
    entry.prog + step * track.step;
  const targetNow = edgeAt(entry.prog);
  let moveSeconds = physicalLaneMoveSeconds(session, entry, targetNow);
  if (!Number.isFinite(moveSeconds)) return null;
  let acquisitionProgress = entry.prog +
    Math.max(PHYS.carLen, entry.spd * moveSeconds);
  const acquisitionTarget = edgeAt(acquisitionProgress);
  moveSeconds = physicalLaneMoveSeconds(
    session,
    entry,
    acquisitionTarget
  );
  if (!Number.isFinite(moveSeconds)) return null;
  const acquisitionGridStep = gridStepAtOrAfter(
    entry.prog + Math.max(PHYS.carLen, entry.spd * moveSeconds)
  );
  acquisitionProgress = gridProgress(acquisitionGridStep);
  const acquisitionIndex = indexAtProgress(
    track,
    entry,
    acquisitionProgress
  );
  const holdGridStep = Math.max(
    gridStepAtOrAfter(horizon),
    acquisitionGridStep + 1
  );
  const holdProgress = gridProgress(holdGridStep);
  const holdIndex = indexAtProgress(track, entry, holdProgress);
  const holdOffset = edgeAt(holdProgress);
  if (acquisitionIndex === holdIndex) return null;
  const holdEta = holdOffset -
    track.idealPath.off[holdIndex]!;
  const dynamics = evaluatorDynamics(session, entry);
  const rejoinSeconds = physicalLateralMoveSeconds(
    Math.max(0, entry.spd),
    holdEta,
    availableDeceleration(
      entry.spd,
      dynamics.baseMu,
      dynamics.downforceScale
    )
  );
  const rejoinProgress = gridProgress(gridStepAtOrAfter(
    holdProgress + Math.max(
      PHYS.carLen,
      entry.spd * (Number.isFinite(rejoinSeconds)
        ? rejoinSeconds
        : MANEUVER_PREDICTION.horizonSeconds)
    )
  ));
  const rejoinIndex = indexAtProgress(track, entry, rejoinProgress);
  const anchors: DynamicPlan['anchors'] = [
    currentAuthoredAnchor(session, entry),
    edgeAnchor(acquisitionProgress)
  ];
  // The straight member is the local surface constraint itself, not one
  // horizon-wide offset selected by its tightest downstream point. Track-step
  // anchors are the surface authority's fixed resolution: each checked knot
  // is derived from its local envelope, so a later narrowing cannot erase
  // width already available on the straight. The values are constraints, not
  // per-station decision variables.
  for (let step = acquisitionGridStep + 1;
    step <= holdGridStep;
    step++)
    anchors.push(edgeAnchor(gridProgress(step)));
  anchors.push(
    {
      index: rejoinIndex,
      offset: track.idealPath.off[rejoinIndex]!,
      s: rejoinProgress
    }
  );
  return {
    mode: side < 0 ? 'side-inside' : 'side-outside',
    key: `cost:${entry.code}:straight:normal:${side}:${start}`,
    anchors,
    pinnedFirst: true,
    topology: side < 0 ? 'left' : 'right',
    surfaceAuthorization: 'normal',
    leaderCode
  };
}

function blendAnchoredPlan(
  track: Track,
  plan: DynamicPlan,
  lambda: number
): DynamicPlan {
  const idealPath = track.idealPath;
  if (!idealPath)
    throw new Error(`Track ${track.def.id} has no ideal path`);
  return {
    ...plan,
    lineBlend: lambda,
    anchors: plan.anchors.map((anchor, index) => {
      if (index === 0)
        return {
          ...anchor,
          s: anchor.s ?? null,
          eta: anchor.eta ?? null,
          etaFirstDerivative: anchor.etaFirstDerivative ?? null,
          etaSecondDerivative: anchor.etaSecondDerivative ?? null
        };
      const wrapped = cyclicIndex(track, anchor.index);
      const ideal = idealPath.off[wrapped]!;
      const eta = anchor.eta ?? anchor.offset - ideal;
      return {
        ...anchor,
        s: anchor.s ?? null,
        offset: ideal + lambda * eta,
        eta: lambda * eta,
        etaFirstDerivative: anchor.etaFirstDerivative == null
          ? null
          : lambda * anchor.etaFirstDerivative,
        etaSecondDerivative: anchor.etaSecondDerivative == null
          ? null
          : lambda * anchor.etaSecondDerivative
      };
    })
  };
}

function subtractForbidden(
  allowed: LambdaIntervalWorkspace,
  forbiddenMinimum: number,
  forbiddenMaximum: number
): void {
  const minimum = Math.max(0, Math.min(1, forbiddenMinimum));
  const maximum = Math.max(0, Math.min(1, forbiddenMaximum));
  if (maximum < 0 || minimum > 1 || minimum > maximum) return;
  let nextCount = 0;
  for (let index = 0; index < allowed.count; index++) {
    const from = allowed.from[index]!;
    const to = allowed.to[index]!;
    if (maximum <= from || minimum >= to) {
      allowed.nextFrom[nextCount] = from;
      allowed.nextTo[nextCount] = to;
      nextCount++;
      continue;
    }
    if (minimum > from) {
      const nextTo = Math.min(to, minimum);
      if (nextTo - from > Number.EPSILON) {
        allowed.nextFrom[nextCount] = from;
        allowed.nextTo[nextCount] = nextTo;
        nextCount++;
      }
    }
    if (maximum < to) {
      const nextFrom = Math.max(from, maximum);
      if (to - nextFrom > Number.EPSILON) {
        allowed.nextFrom[nextCount] = nextFrom;
        allowed.nextTo[nextCount] = to;
        nextCount++;
      }
    }
  }
  const previousFrom = allowed.from;
  const previousTo = allowed.to;
  allowed.from = allowed.nextFrom;
  allowed.to = allowed.nextTo;
  allowed.nextFrom = previousFrom;
  allowed.nextTo = previousTo;
  allowed.count = nextCount;
}

function intersectAllowed(
  allowed: LambdaIntervalWorkspace,
  minimum: number,
  maximum: number
): void {
  const lower = Math.max(0, minimum);
  const upper = Math.min(1, maximum);
  if (lower > upper) {
    allowed.count = 0;
    return;
  }
  let nextCount = 0;
  for (let index = 0; index < allowed.count; index++) {
    const from = allowed.from[index]!;
    const to = allowed.to[index]!;
    const intersectionFrom = Math.max(from, lower);
    const intersectionTo = Math.min(to, upper);
    if (intersectionFrom <= intersectionTo) {
      allowed.nextFrom[nextCount] = intersectionFrom;
      allowed.nextTo[nextCount] = intersectionTo;
      nextCount++;
    }
  }
  const previousFrom = allowed.from;
  const previousTo = allowed.to;
  allowed.from = allowed.nextFrom;
  allowed.to = allowed.nextTo;
  allowed.nextFrom = previousFrom;
  allowed.nextTo = previousTo;
  allowed.count = nextCount;
}

function constrainAffineToEnvelope(
  allowed: LambdaIntervalWorkspace,
  ideal: number,
  full: number,
  minimum: number,
  maximum: number
): void {
  const slope = full - ideal;
  if (Math.abs(slope) <= Number.EPSILON) {
    if (ideal < minimum || ideal > maximum) allowed.count = 0;
    return;
  }
  const first = (minimum - ideal) / slope;
  const second = (maximum - ideal) / slope;
  intersectAllowed(
    allowed,
    Math.min(first, second),
    Math.max(first, second)
  );
}

function stagedAcquisitionMinimumLambda(
  session: Session,
  entry: ActiveEntry,
  idealPlan: DynamicPlan,
  fullPlan: DynamicPlan,
  evaluationClaims: EvaluationClaimMap
): number | null {
  if (!fullPlan.leaderCode) return 0;
  const claim = evaluationClaims.get(fullPlan.leaderCode)?.claim;
  if (!claim) return null;
  const age = Math.max(0, session.t - claim.publishedAt);
  const idealProgram = compileCompactLateralProgram(
    session.trk,
    idealPlan
  );
  const fullProgram = compileCompactLateralProgram(
    session.trk,
    fullPlan
  );
  let side = 0;
  const sampleCount = racecraftClaimSegmentCount(claim) + 1;
  for (let sample = 0; sample < sampleCount; sample++) {
    const seconds = sample === 0
      ? 0
      : racecraftClaimSegmentEndTime(claim, sample - 1);
    const progress = entry.prog + Math.max(0, entry.spd) * seconds;
    const ideal = writeSampleCompactLateralProgram(
      session.trk,
      idealProgram,
      progress,
      lambdaIdealSampleScratch
    ).value;
    const full = writeSampleCompactLateralProgram(
      session.trk,
      fullProgram,
      progress,
      lambdaFullSampleScratch
    ).value;
    const delta = full - ideal;
    if (side === 0 && Math.abs(delta) > Number.EPSILON)
      side = Math.sign(delta);
    stagedLambdaIdeal[sample] = ideal;
    stagedLambdaDelta[sample] = delta;
    stagedLambdaLeader[sample] = writeRacecraftClaimStateAtTime(
      session.trk,
      claim,
      age + seconds,
      lambdaClaimStateScratch
    ).lateral;
  }
  if (side === 0) return null;

  let minimum = Infinity;
  for (let sample = 0; sample < sampleCount; sample++) {
    const base = side * (
      stagedLambdaIdeal[sample]! - stagedLambdaLeader[sample]!
    );
    if (base >= PHYS.carWid - Number.EPSILON) return 0;
    const reach = side * stagedLambdaDelta[sample]!;
    if (reach <= Number.EPSILON) continue;
    const required = (PHYS.carWid - base) / reach;
    if (required >= -Number.EPSILON &&
        required <= 1 + Number.EPSILON)
      minimum = Math.min(minimum, clamp(required, 0, 1));
  }
  return Number.isFinite(minimum) ? minimum : null;
}

/**
 * Frozen station timing makes every lateral clearance inequality affine in
 * lambda. Every relevant station removes its forbidden interval from [0,1].
 */
function clearanceLambda(
  session: Session,
  entry: ActiveEntry,
  idealPlan: DynamicPlan,
  fullPlan: DynamicPlan,
  entries: readonly Entry[],
  preferMaximum = false,
  evaluationClaims: EvaluationClaimMap = EMPTY_EVALUATION_CLAIMS
): LambdaSeed | null {
  const track = session.trk;
  const idealProgram = compileCompactLateralProgram(track, idealPlan);
  const fullProgram = compileCompactLateralProgram(track, fullPlan);
  // An attack member must be large enough to acquire physical side room.
  // This also rejects a corner family after its meaningful lateral gates
  // have passed, allowing the caller to author the open straight family.
  const acquisitionMinimum = stagedAcquisitionMinimumLambda(
    session,
    entry,
    idealPlan,
    fullPlan,
    evaluationClaims
  );
  if (fullPlan.leaderCode && acquisitionMinimum == null) return null;
  const allowed = lambdaIntervals;
  allowed.from[0] = acquisitionMinimum ?? 0;
  allowed.to[0] = 1;
  allowed.count = 1;
  let conflictCount = 0;
  const agreement = sideAgreementBounds(session, entry);
  if (agreement) {
    const horizon = horizonProgress(entry);
    const sampleCount = Math.max(
      1,
      Math.ceil((horizon - entry.prog) / track.step)
    );
    for (let sample = 0; sample <= sampleCount; sample++) {
      const progress = entry.prog +
        (horizon - entry.prog) * sample / sampleCount;
      const index = indexAtProgress(track, entry, progress);
      const envelope = sideAgreementEnvelopeAt(
        track,
        index,
        agreement,
        fullPlan.surfaceAuthorization ?? 'normal'
      );
      if (envelope.viable === false) return null;
      constrainAffineToEnvelope(
        allowed,
        writeSampleCompactLateralProgram(
          track,
          idealProgram,
          progress,
          lambdaIdealSampleScratch
        ).value,
        writeSampleCompactLateralProgram(
          track,
          fullProgram,
          progress,
          lambdaFullSampleScratch
        ).value,
        envelope.minimum,
        envelope.maximum
      );
      if (!allowed.count) return null;
    }
  }
  for (const other of entries) {
    if (other === entry || !other.car) continue;
    if (session.sideAgreements?.has(
      racecraftPairKey(entry.code, other.code)
    )) continue;
    const prediction = evaluationClaims.get(other.code);
    if (!prediction) continue;
    const claim = prediction.claim;
    for (let segmentIndex = 0;
      segmentIndex < racecraftClaimSegmentCount(claim);
      segmentIndex++) {
      const stationTime = racecraftClaimSegmentEndTime(
        claim,
        segmentIndex
      );
      const stationState = writeRacecraftClaimStateAtTime(
        track,
        claim,
        stationTime,
        lambdaClaimStateScratch
      );
      const stationS = stationState.s;
      const egoS = (
        entry.car.s + Math.max(0, entry.spd) * stationTime
      ) % track.len;
      if (Math.abs(signedTrackDistance(track, egoS, stationS)) >
          PHYS.carLen)
        continue;
      const egoProgress = entry.prog +
        Math.max(0, entry.spd) * stationTime;
      const y0 = writeSampleCompactLateralProgram(
        track,
        idealProgram,
        egoProgress,
        lambdaIdealSampleScratch
      ).value;
      const y1 = writeSampleCompactLateralProgram(
        track,
        fullProgram,
        egoProgress,
        lambdaFullSampleScratch
      ).value;
      const slope = y1 - y0;
      const overlap = PHYS.carWid;
      const stationLateral = stationState.lateral;
      const lower = stationLateral - overlap;
      const upper = stationLateral + overlap;
      if (Math.abs(slope) <= Number.EPSILON) {
        // This station belongs to the acquisition prefix shared by every λ.
        // It cannot inform the side-family seed; continuous collision pricing
        // and hard feasibility still evaluate it after the seed is authored.
        continue;
      }
      lambdaConflictIdeal[conflictCount] = y0;
      lambdaConflictSlope[conflictCount] = slope;
      lambdaConflictCentre[conflictCount] = stationLateral;
      lambdaConflictOverlap[conflictCount] = overlap;
      conflictCount++;
      const first = (lower - y0) / slope;
      const second = (upper - y0) / slope;
      subtractForbidden(
        allowed,
        Math.min(first, second),
        Math.max(first, second)
      );
    }
  }
  if (!allowed.count) {
    let breakpointCount = 1;
    lambdaBreakpoints[0] = 1;
    for (let conflict = 0; conflict < conflictCount; conflict++)
      for (let edgeIndex = 0; edgeIndex < 2; edgeIndex++) {
        const edge = edgeIndex === 0
          ? -lambdaConflictOverlap[conflict]!
          : lambdaConflictOverlap[conflict]!;
        const breakpoint = clamp(
          (
            lambdaConflictCentre[conflict]! + edge -
              lambdaConflictIdeal[conflict]!
          ) / lambdaConflictSlope[conflict]!,
          0,
          1
        );
        let exists = false;
        for (let index = 0; index < breakpointCount; index++)
          if (lambdaBreakpoints[index] === breakpoint) {
            exists = true;
            break;
          }
        if (!exists) lambdaBreakpoints[breakpointCount++] = breakpoint;
      }
    let bestLambda: number | null = null;
    let bestOverlap = Infinity;
    for (let index = 0; index < breakpointCount; index++) {
      const lambda = lambdaBreakpoints[index]!;
      if (lambda <= Number.EPSILON) continue;
      let totalOverlap = 0;
      for (let conflict = 0; conflict < conflictCount; conflict++) {
        const separation = Math.abs(
          lambdaConflictIdeal[conflict]! +
            lambda * lambdaConflictSlope[conflict]! -
            lambdaConflictCentre[conflict]!
        );
        totalOverlap += Math.max(
          0,
          1 - separation / Math.max(
            Number.EPSILON,
            lambdaConflictOverlap[conflict]!
          )
        );
      }
      if (totalOverlap < bestOverlap - Number.EPSILON ||
          (Math.abs(totalOverlap - bestOverlap) <= Number.EPSILON &&
            (bestLambda == null || lambda > bestLambda))) {
        bestOverlap = totalOverlap;
        bestLambda = lambda;
      }
    }
    return bestLambda == null
      ? null
      : { lambda: bestLambda };
  }
  if (preferMaximum)
    return { lambda: allowed.to[allowed.count - 1]! };
  let distinct = -1;
  for (let index = 0; index < allowed.count; index++)
    if (allowed.to[index]! > Number.EPSILON) {
      distinct = index;
      break;
    }
  if (distinct < 0) return null;
  // λ=0 is the ideal member already evaluated separately. A lateral family
  // member must remain a distinct candidate even when the ideal is clear.
  return {
    lambda: allowed.from[distinct]! > Number.EPSILON
      ? allowed.from[distinct]!
      : allowed.to[distinct]!
  };
}

function seededSideCandidate(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  kind: 'corner-inside' | 'corner-outside',
  full: DynamicPlan,
  preferMaximum = false,
  evaluationClaims: EvaluationClaimMap = EMPTY_EVALUATION_CLAIMS
): RacecraftCandidateSeed | null {
  const zero = blendAnchoredPlan(session.trk, full, 0);
  const constrainedSeed = clearanceLambda(
    session,
    entry,
    zero,
    full,
    entries,
    preferMaximum,
    evaluationClaims
  );
  const certified = full.cornerId
    ? sideAgreementCornerFamilyMember(
        session,
        entry,
        session.trk.corners.find(corner => corner.id === full.cornerId)!
      )
    : null;
  const lambdaSeed = constrainedSeed ?? (
    certified != null &&
    certified.kind === full.lineKind &&
    certified.terminal === full.lineTerminal
      ? { lambda: 1 }
      : null
  );
  if (!lambdaSeed || lambdaSeed.lambda <= Number.EPSILON) return null;
  const lambda = lambdaSeed.lambda;
  const plan: DynamicPlan = {
    ...blendAnchoredPlan(session.trk, full, lambda),
    lineBlend: lambda,
    // The exact decision variable lives in lineBlend. A generated key is
    // categorical identity, not a floating-point geometry fingerprint:
    // embedding λ here made equivalent Bun/browser plans differ at the last
    // printed digit and polluted bounded diagnostic keys.
    key: `${full.key}:lambda`
  };
  return { kind, plan, slowPointOwnerCode: null };
}

function brakeBehindSeed(
  session: Session,
  entry: ActiveEntry,
  leader: ActiveEntry,
  physicalPlan?: PathPlan
): RacecraftCandidateSeed {
  const plan: DynamicPlan = {
      ...currentProgramPlan(session, entry),
      key: `cost:${entry.code}:brake-behind:${leader.code}:` +
        cyclicIndex(session.trk, entry.car.progIdx),
      topology: 'brake',
      leaderCode: leader.code
  };
  if (physicalPlan)
    candidatePhysicalPlanByPlan.set(plan, physicalPlan);
  return {
    kind: 'brake-behind',
    plan,
    slowPointOwnerCode: leader.code
  };
}

function appendDistinctCandidateSeed(
  session: Session,
  seeds: RacecraftCandidateSeed[],
  familyNumericIds: number[],
  seed: RacecraftCandidateSeed
): void {
  const identity = racecraftFamilyNumericId(
    session,
    seed.kind,
    seed.plan,
    seed.slowPointOwnerCode
  );
  for (let index = 0; index < familyNumericIds.length; index++)
    if (familyNumericIds[index] === identity) return;
  seeds.push(seed);
  familyNumericIds.push(identity);
}

function buildCandidateSeeds(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  evaluationClaims: EvaluationClaimMap,
  includeBrakeBehind = true
): RacecraftCandidateSeed[] {
  evaluatorWork(session).candidateFamilyBuilds++;
  const leader = activeLeader(session, entry, entries);
  const previousSelected = entry.racecraftDecision?.candidates.find(candidate =>
    candidate.planNumericId ===
      entry.racecraftDecision?.selectedPlanNumericId);
  const incumbentKind = entry.racecraftDecision?.selectedKind ?? 'hold';
  const seeds: RacecraftCandidateSeed[] = [{
    kind: incumbentKind,
    plan: currentProgramPlan(session, entry),
    slowPointOwnerCode:
      entry.racecraftLongitudinalProgram?.slowPointOwnerCode ??
      previousSelected?.slowPointOwnerCode ??
      null
  }];
  const familyNumericIds = [racecraftFamilyNumericId(
    session,
    seeds[0]!.kind,
    seeds[0]!.plan,
    seeds[0]!.slowPointOwnerCode
  )];
  const ideal = acquisitionPlan(session, entry, 'ideal');
  appendDistinctCandidateSeed(session, seeds, familyNumericIds, {
    kind: 'ideal',
    plan: ideal,
    slowPointOwnerCode: null
  });
  const corner = cornerAtApproach(
    session.trk,
    cyclicIndex(session.trk, entry.car.progIdx)
  );
  if (corner) {
    for (const [kind, fallbackSide] of [
      ['corner-inside', -1],
      ['corner-outside', 1]
    ] as const) {
      const full = fullCornerPlan(
        session,
        entry,
        corner,
        kind,
        leader?.entry.code ?? null
      );
      const seeded = full
        ? seededSideCandidate(
            session,
            entry,
            entries,
            kind,
            full,
            false,
            evaluationClaims
          )
        : null;
      const fallbackFull = seeded
        ? null
        : straightFullPlan(
            session,
            entry,
            fallbackSide,
            leader?.entry.code ?? null
          );
      const fallback = fallbackFull
        ? seededSideCandidate(
            session,
            entry,
            entries,
            kind,
            fallbackFull,
            false,
            evaluationClaims
          )
        : null;
      const selectedSeed = seeded ?? fallback;
      if (selectedSeed)
        appendDistinctCandidateSeed(
          session,
          seeds,
          familyNumericIds,
          selectedSeed
        );
    }
  } else {
    for (const [kind, side] of [
      ['corner-inside', -1],
      ['corner-outside', 1]
    ] as const) {
      const full = straightFullPlan(
        session,
        entry,
        side,
        leader?.entry.code ?? null
      );
      const seeded = full
        ? seededSideCandidate(
            session,
            entry,
            entries,
            kind,
            full,
            false,
            evaluationClaims
          )
        : null;
      if (seeded)
        appendDistinctCandidateSeed(
          session,
          seeds,
          familyNumericIds,
          seeded
        );
    }
  }
  if (leader && includeBrakeBehind)
    appendDistinctCandidateSeed(
      session,
      seeds,
      familyNumericIds,
      brakeBehindSeed(session, entry, leader.entry)
    );
  // `ideal` and `recenter` author the same physical acquisition. The
  // incumbent slot already preserves an in-flight recenter; evaluating a
  // second labelled copy would consume the bounded candidate budget.
  if (seeds.length > MAX_RACECRAFT_CANDIDATES)
    throw new Error(`Racecraft candidate budget exceeded: ${seeds.length}/6`);
  evaluatorWork(session).candidateSeedsBuilt += seeds.length;
  return seeds;
}

function candidateRespectsAgreement(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan
): boolean {
  const agreement = sideAgreementBounds(session, entry);
  if (!agreement) return true;
  if (plan.mode !== 'ideal' && plan.mode !== 'pit' &&
      plan.cornerId && plan.lineKind && plan.lineTerminal) {
    const corner = session.trk.corners.find(value =>
      value.id === plan.cornerId);
    const certified = corner
      ? sideAgreementCornerFamilyMember(session, entry, corner)
      : null;
    if (certified?.kind === plan.lineKind &&
        certified.terminal === plan.lineTerminal)
      return true;
  }
  const track = session.trk;
  const distance = Math.max(8, entry.spd) *
    MANEUVER_PREDICTION.horizonSeconds;
  const samples = Math.max(1, Math.ceil(distance / track.step));
  const initialEnvelope = sideAgreementEnvelopeAt(
    track,
    cyclicIndex(track, entry.car.progIdx),
    agreement,
    plan.mode !== 'ideal' && plan.mode !== 'pit'
      ? plan.surfaceAuthorization ?? 'normal'
      : 'normal'
  );
  if (initialEnvelope.viable === false) return false;
  const violation = (
    lateral: number,
    envelope: LateralBounds
  ): { distance: number; side: -1 | 0 | 1 } =>
    lateral < envelope.minimum
      ? { distance: envelope.minimum - lateral, side: -1 }
      : lateral > envelope.maximum
        ? { distance: lateral - envelope.maximum, side: 1 }
        : { distance: 0, side: 0 };
  let recovery = violation(entry.latNow, initialEnvelope);
  let recovered = recovery.distance <= Number.EPSILON;
  for (let sample = 1; sample <= samples; sample++) {
    const progress = entry.prog + distance * sample / samples;
    const index = indexAtProgress(track, entry, progress);
    const envelope = sideAgreementEnvelopeAt(
      track,
      index,
      agreement,
      plan.mode !== 'ideal' && plan.mode !== 'pit'
        ? plan.surfaceAuthorization ?? 'normal'
        : 'normal'
    );
    if (envelope.viable === false) return false;
    const lateral = laneStateAt(
      session,
      entry,
      progress,
      plan
    ).lateral;
    const next = violation(lateral, envelope);
    if (recovered) {
      if (next.distance > Number.EPSILON) return false;
      continue;
    }
    // A newly acquired agreement can expose a measured state just outside
    // its certified corridor. Recovery may consume that pre-existing error,
    // but can neither deepen it nor cross through and leave on the far side.
    if ((next.side !== 0 && next.side !== recovery.side) ||
        next.distance > recovery.distance + Number.EPSILON)
      return false;
    recovery = next;
    recovered = next.distance <= Number.EPSILON;
  }
  return true;
}

function brakingEffortForPlan(
  entry: Entry,
  plan: PathPlan
): number {
  const sideFamily =
    plan.mode === 'side-inside' || plan.mode === 'side-outside';
  return clamp(
    sideFamily ? BOT_BRAKING_EFFORT_MAXIMUM : entry.brakingEffort,
    BOT_BRAKING_EFFORT_MINIMUM,
    BOT_BRAKING_EFFORT_MAXIMUM
  );
}

function candidateTowPublishedStatesAt(
  session: Session,
  entry: ActiveEntry,
  evaluationClaims: EvaluationClaimMap,
  time: number
): CandidateTowPublishedStates {
  let byTime = candidateTowPublishedStates.get(evaluationClaims);
  if (!byTime) {
    byTime = new Map();
    candidateTowPublishedStates.set(evaluationClaims, byTime);
  }
  const cached = byTime.get(time);
  if (cached) {
    evaluatorWork(session).rivalStateCacheHits++;
    return cached;
  }
  const views = candidateTowClaimViewsFor(entry, evaluationClaims);
  const count = views.length;
  const workspace = candidateTowWorkspaceByClaims.get(evaluationClaims);
  const bufferIndex = workspace?.towPublishedStateUsed ?? -1;
  if (workspace) workspace.towPublishedStateUsed++;
  let states = bufferIndex >= 0
    ? workspace!.towPublishedStateBuffers[bufferIndex]
    : undefined;
  if (!states || states.s.length !== count) {
    states = {
      count,
      s: new Float64Array(count),
      lateral: new Float64Array(count)
    };
    if (workspace)
      workspace.towPublishedStateBuffers[bufferIndex] = states;
  } else {
    states.count = count;
  }
  let index = 0;
  for (const view of views) {
    const state = writeRacecraftClaimTowStateAtTime(
      session.trk,
      view.claim,
      time,
      candidateTowLateralStateScratch
    );
    states.s[index] = state.s;
    states.lateral[index] = state.lateral;
    index++;
  }
  byTime.set(time, states);
  evaluatorWork(session).rivalStateBuilds++;
  return states;
}

/**
 * Candidate rollouts consume the frozen leader publication, not the entry's
 * current wake scalar. This preserves the tucked prefix and lets a pull-out
 * lose tow continuously as its authored lateral separation grows.
 */
function candidateTowStrength(
  session: Session,
  entry: ActiveEntry,
  progress: number,
  time: number,
  lateral: number,
  speed: number,
  evaluationClaims: EvaluationClaimMap,
  sharedGridSlot = -1,
  preparedGrid?: CandidateTowRivalGridCache,
  preparedTowRangeM?: number,
  preparedWakeSpreadRate?: number
): number {
  if (!evaluationClaims.size) return 0;
  const ownS = wrappedTrackS(
    session.trk,
    entry.car.s + progress - entry.prog
  );
  let hasNearest = false;
  let nearestDownstream = 0;
  let nearestLateral = 0;
  if (sharedGridSlot >= 0) {
    if (!preparedGrid)
      throw new Error('Shared tow grid requires a decision workspace');
    if (preparedGrid.computed[sharedGridSlot]) {
      evaluatorWork(session).rivalStateCacheHits++;
      if (!preparedGrid.hasNearest[sharedGridSlot]) return 0;
      const calibration = preparedTowRangeM == null ||
          preparedWakeSpreadRate == null
        ? racecraftCalibration()
        : null;
      return wakeStrength(
        preparedGrid.downstream[sharedGridSlot]!,
        preparedGrid.lateral[sharedGridSlot]! - lateral,
        speed,
        preparedTowRangeM ?? calibration!.towRangeM,
        preparedWakeSpreadRate ?? calibration!.wakeSpreadRate
      );
    }
    if (sharedGridSlot === 0) {
      const rivalStates = candidateTowPublishedStatesAt(
        session,
        entry,
        evaluationClaims,
        time
      );
      for (let index = 0; index < rivalStates.count; index++) {
        const downstream = forwardTrackDistance(
          session.trk,
          ownS,
          rivalStates.s[index]!
        );
        if (downstream > TRAFFIC_NEIGHBOR_SCAN_METRES) continue;
        // Evaluation claims are inserted in code order. Keeping the first
        // exact-distance tie therefore preserves the lexical tie-break
        // without carrying strings through the numeric cache.
        if (!hasNearest ||
            downstream < nearestDownstream - Number.EPSILON) {
          hasNearest = true;
          nearestDownstream = downstream;
          nearestLateral = rivalStates.lateral[index]!;
        }
      }
    } else {
      for (const view of candidateTowClaimViewsFor(
        entry,
        evaluationClaims
      )) {
        const state = writeRacecraftClaimTowStateAtTime(
          session.trk,
          view.claim,
          time,
          candidateTowLateralStateScratch
        );
        const downstream = forwardTrackDistance(
          session.trk,
          ownS,
          state.s
        );
        if (downstream > TRAFFIC_NEIGHBOR_SCAN_METRES) continue;
        if (!hasNearest ||
            downstream < nearestDownstream - Number.EPSILON) {
          hasNearest = true;
          nearestDownstream = downstream;
          nearestLateral = state.lateral;
        }
      }
    }
    preparedGrid.computed[sharedGridSlot] = 1;
    preparedGrid.hasNearest[sharedGridSlot] = hasNearest ? 1 : 0;
    preparedGrid.downstream[sharedGridSlot] = nearestDownstream;
    preparedGrid.lateral[sharedGridSlot] = nearestLateral;
    if (sharedGridSlot !== 0) evaluatorWork(session).rivalStateBuilds++;
  } else {
    const rivalStates = candidateTowPublishedStatesAt(
      session,
      entry,
      evaluationClaims,
      time
    );
    for (let index = 0; index < rivalStates.count; index++) {
      const downstream = forwardTrackDistance(
        session.trk,
        ownS,
        rivalStates.s[index]!
      );
      if (downstream > TRAFFIC_NEIGHBOR_SCAN_METRES) continue;
      if (!hasNearest ||
          downstream < nearestDownstream - Number.EPSILON) {
        hasNearest = true;
        nearestDownstream = downstream;
        nearestLateral = rivalStates.lateral[index]!;
      }
    }
  }
  if (!hasNearest) return 0;
  const calibration = preparedTowRangeM == null ||
      preparedWakeSpreadRate == null
    ? racecraftCalibration()
    : null;
  return wakeStrength(
    nearestDownstream,
    nearestLateral - lateral,
    speed,
    preparedTowRangeM ?? calibration!.towRangeM,
    preparedWakeSpreadRate ?? calibration!.wakeSpreadRate
  );
}

function candidateDragScale(
  dynamics: RacecraftFamilyDynamics,
  towStrength?: number
): number {
  if (towStrength == null) return dynamics.modifiers.dr;
  return dynamics.untowedDragScale * (
    1 - dynamics.towDragReduction * clamp(towStrength, 0, 1)
  );
}

function driveAcceleration(
  dynamics: RacecraftFamilyDynamics,
  speed: number,
  curvature: number,
  dynamicMu?: number,
  surfaceDrag = 0,
  towStrength?: number
): number {
  const modifiers = dynamics.modifiers;
  const force = Math.min(
    PHYS.Fmax * modifiers.pw,
    PHYS.power * modifiers.pw / Math.max(4, speed)
  );
  const resistance =
    PHYS.kDrag * candidateDragScale(dynamics, towStrength) *
      speed * speed +
    PHYS.kRoll +
    speed * Math.max(0, surfaceDrag);
  const longitudinal = longitudinalAccelerationHeadroom(
    speed,
    curvature,
    dynamicMu ?? dynamics.baseMu,
    dynamics.downforceScale
  );
  return Math.min((force - resistance) / PHYS.m, longitudinal);
}

function passiveDeceleration(
  dynamics: RacecraftFamilyDynamics,
  speed: number,
  surfaceDrag: number,
  towStrength?: number
): number {
  return (
    PHYS.kDrag * candidateDragScale(dynamics, towStrength) *
      speed * speed +
    PHYS.kRoll +
    speed * Math.max(0, surfaceDrag)
  ) / PHYS.m;
}

function forwardTrackDistance(track: Track, from: number, to: number): number {
  const distance = to - from;
  return distance < 0 ? distance + track.len : distance;
}

function speedLawAt(
  law: CandidateSpeedLaw,
  progress: number
): number {
  return speedEnvelopeAt(law.envelope, progress);
}

function speedLawAddsConstraint(
  reference: CandidateSpeedLaw,
  constrained: CandidateSpeedLaw
): boolean {
  return speedEnvelopeAddsConstraint(
    reference.envelope,
    constrained.envelope
  );
}

function programSpeedAtProgress(
  stations: readonly ProgramStation[],
  progress: number
): number {
  if (progress <= stations[0]!.progress) return stations[0]!.speed;
  for (let index = 1; index < stations.length; index++) {
    const to = stations[index]!;
    if (progress > to.progress) continue;
    const from = stations[index - 1]!;
    const u = (progress - from.progress) /
      Math.max(Number.EPSILON, to.progress - from.progress);
    return from.speed + (to.speed - from.speed) * clamp(u, 0, 1);
  }
  return stations.at(-1)!.speed;
}

function applyCandidateTrafficSpeedConstraint(
  track: Track,
  entry: ActiveEntry,
  owner: ActiveEntry,
  divergence: number,
  count: number,
  firstSharedSlot: number,
  hasReference: boolean,
  speed: number[],
  source: Array<EntryTrafficSlowPoint | null>,
  stationS: number,
  constraintSpeed: number,
  publishedAt: number
): void {
  const clearanceDistance = Math.max(
    0,
    forwardTrackDistance(track, entry.car.s, stationS) -
      PHYS.carLen - divergence
  );
  const slot = Math.min(
    count - 1,
    Math.ceil(clearanceDistance / track.step)
  );
  if ((hasReference && slot >= firstSharedSlot) ||
      constraintSpeed >= speed[slot]! - Number.EPSILON)
    return;
  const constrained = Math.max(0, constraintSpeed);
  speed[slot] = constrained;
  source[slot] = {
    distance: clearanceDistance,
    speed: constrained,
    ownerCode: owner.code,
    reason: 'traffic-follow:cost-candidate',
    stationS: (entry.car.s + clearanceDistance) % track.len,
    publishedAt
  };
}

/**
 * Compose every published target into one spatial law, then retain only the
 * station whose constraint reaches the current sample. Headroom is local to
 * each sample in the backward sweep.
 */
function composeCandidateSpeedLaw(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan,
  slowPointOwnerCode: string | null,
  entries: readonly Entry[],
  evaluationClaims: EvaluationClaimMap = EMPTY_EVALUATION_CLAIMS,
  effortOverride?: number,
  workspace?: CandidateEvaluationWorkspace
): CandidateSpeedLaw {
  if (plan.mode === 'pit')
    throw new Error('Pit authority cannot enter speed-law composition');
  const track = session.trk;
  const dynamics = evaluatorDynamics(session, entry);
  const brakingEffort = clamp(
    effortOverride ?? brakingEffortForPlan(entry, plan),
    BOT_BRAKING_EFFORT_MINIMUM,
    BOT_BRAKING_EFFORT_MAXIMUM
  );
  const count = Math.min(
    LANE_BUFFER_CAPACITY,
    Math.ceil(LANE_BUFFER_DISTANCE_METRES / track.step) + 1
  );
  const stagedAttack = plan.mode !== 'ideal' &&
    (plan.mode === 'side-inside' || plan.mode === 'side-outside') &&
    plan.surfaceAuthorization !== 'emergency' &&
    plan.leaderCode != null;
  let owner: ActiveEntry | null = null;
  let stagedLeader: ActiveEntry | null = null;
  for (let index = 0; index < entries.length; index++) {
    const candidate = entries[index];
    if (!candidate?.car) continue;
    if (!owner && slowPointOwnerCode != null &&
        candidate.code === slowPointOwnerCode)
      owner = candidate as ActiveEntry;
    if (!stagedLeader && stagedAttack &&
        candidate.code === plan.leaderCode)
      stagedLeader = candidate as ActiveEntry;
    if ((owner || slowPointOwnerCode == null) &&
        (stagedLeader || !stagedAttack))
      break;
  }
  const stagedPublication = stagedLeader
    ? evaluationClaims.get(stagedLeader.code)?.claim ?? null
    : null;
  // A staged side candidate starts from its unconstrained capability law.
  // Its target leader is composed afterward only through the continuously
  // solved acquisition prefix; pre-applying that leader here would make
  // braking after side clearance propagate backward and absorb the attack.
  const deferStagedLeaderConstraint =
    owner === stagedLeader && stagedPublication != null;
  const effectiveOwnerCode = owner && !deferStagedLeaderConstraint
    ? owner.code
    : null;
  const idealAfterProgress = plan.mode === 'ideal'
    ? -Infinity
    : plan.lineTerminal === 'sustained-offset'
      ? Infinity
      : plan.anchors.at(-1)?.s ?? Infinity;
  let reference: CandidateSpeedLawReference | null = null;
  let firstSharedSlot = count;
  for (const candidate of workspace?.speedLawReferences ?? []) {
    if (candidate.brakingEffort !== brakingEffort ||
        candidate.ownerCode !== effectiveOwnerCode)
      continue;
    const sharedAfter = Math.max(
      idealAfterProgress,
      candidate.idealAfterProgress
    );
    if (!Number.isFinite(sharedAfter)) continue;
    let slot = Math.max(
      0,
      Math.floor((sharedAfter - entry.prog) / track.step) + 1
    );
    while (slot < count &&
        entry.prog + slot * track.step <=
          sharedAfter + Number.EPSILON)
      slot++;
    if (slot < firstSharedSlot) {
      reference = candidate;
      firstSharedSlot = slot;
    }
  }
  const construction = workspace
    ? candidateSpeedConstructionBuffer(workspace, count)
    : null;
  const speed = construction?.speed ?? new Array<number>(count);
  const source = construction?.source ??
    new Array<EntryTrafficSlowPoint | null>(count);
  const spatial = prepareCandidateSpatialState(session, entry, plan);
  const calibration = racecraftCalibration();
  const towGrid = workspace
    ? workspace.towGridCache ?? (workspace.towGridCache = {
        computed: new Uint8Array(LANE_BUFFER_CAPACITY),
        hasNearest: new Uint8Array(LANE_BUFFER_CAPACITY),
        downstream: new Float64Array(LANE_BUFFER_CAPACITY),
        lateral: new Float64Array(LANE_BUFFER_CAPACITY)
      })
    : undefined;
  for (let slot = 0; slot < count; slot++) {
    const at = entry.prog + slot * track.step;
    if (reference && slot >= firstSharedSlot) {
      speed[slot] = reference.speed[slot]!;
      source[slot] = reference.source[slot] ?? null;
      continue;
    }
    if (!spatial.valid[slot])
      writeCandidateSpatialStateSlot(
        session,
        entry,
        spatial,
        slot,
        at
      );
    speed[slot] = spatial.targetSpeed[slot]!;
    source[slot] = null;
  }
  evaluatorWork(session).speedLawSamples += firstSharedSlot;
  if (owner && !deferStagedLeaderConstraint) {
    const divergence = oneIntervalPhysicalDivergence(session, owner);
    const claim = evaluationClaims.get(owner.code)?.claim;
    applyCandidateTrafficSpeedConstraint(
      track,
      entry,
      owner,
      divergence,
      count,
      firstSharedSlot,
      reference != null,
      speed,
      source,
      claim?.originS ?? owner.car.s,
      claim?.originSpeed ?? owner.spd,
      claim?.publishedAt ?? session.t
    );
    if (claim)
      for (let segmentIndex = 0;
        segmentIndex < racecraftClaimSegmentCount(claim);
        segmentIndex++) {
        const state = writeRacecraftClaimStateAtTime(
          track,
          claim,
          racecraftClaimSegmentEndTime(claim, segmentIndex),
          candidateTowStateScratch
        );
        applyCandidateTrafficSpeedConstraint(
          track,
          entry,
          owner,
          divergence,
          count,
          firstSharedSlot,
          reference != null,
          speed,
          source,
          state.s,
          state.speed,
          claim.publishedAt
        );
      }
  }
  const backwardStart = reference
    ? firstSharedSlot - 1
    : count - 2;
  for (let slot = backwardStart; slot >= 0; slot--) {
    const localSpeed = Math.max(0, speed[slot]!);
    const progress = entry.prog + slot * track.step;
    const estimatedTime = Math.max(
      0,
      progress - entry.prog
    ) / Math.max(Number.EPSILON, entry.spd || entry.car.spd);
    const tow = candidateTowStrength(
      session,
      entry,
      progress,
      estimatedTime,
      spatial.lateral[slot]!,
      localSpeed,
      evaluationClaims,
      slot,
      towGrid,
      calibration.towRangeM,
      calibration.wakeSpreadRate
    );
    const room = longitudinalAccelerationHeadroom(
      localSpeed,
      spatial.curvature[slot]!,
      spatial.dynamicMu[slot]!,
      dynamics.downforceScale
    );
    const braking = brakingEffort * room +
      passiveDeceleration(
        dynamics,
        localSpeed,
        spatial.surfaceDrag[slot]!,
        tow
      );
    const allowed = Math.sqrt(
      speed[slot + 1]! * speed[slot + 1]! +
        2 * braking * spatial.q[slot]! * track.step
    );
    if (allowed < speed[slot]! - Number.EPSILON) {
      speed[slot] = allowed;
      source[slot] = source[slot + 1] ?? null;
    }
  }
  if (workspace && Number.isFinite(idealAfterProgress))
    workspace.speedLawReferences.push({
      brakingEffort,
      ownerCode: effectiveOwnerCode,
      idealAfterProgress,
      speed,
      source
    });
  if (stagedAttack) {
    if (stagedLeader && stagedPublication) {
      const terminalProgress = entry.prog + (count - 1) * track.step;
      const terminalLateral = (
        spatial.valid[count - 1]
          ? spatial.lateral[count - 1]!
          : laneStateAt(
          session,
          entry,
          terminalProgress,
          plan
        ).lateral
      );
      const side: -1 | 1 =
        terminalLateral < stagedPublication.originCentre ? -1 : 1;
      const lateralProgram = compileCompactLateralProgram(track, plan);
      const composition = composeRacecraftStagedAttackProgram(
        session,
        entry,
        stagedLeader,
        stagedPublication,
        side,
        {
          envelope: speedEnvelopeFromUniformSamples(
            entry.prog,
            track.step,
            speed,
            construction?.envelope
          ),
          brakingEffort,
          slowPointOwnerCode: null,
          bindingSlowPoint: null
        },
        at => writeCompactLateralPoseAtProgress(
          track,
          lateralProgram,
          at,
          candidateLateralPoseScratch
        )
      );
      return {
        envelope: composition.program.envelope,
        brakingEffort,
        slowPoint: composition.program.bindingSlowPoint,
        longitudinalOwnerCode:
          composition.program.slowPointOwnerCode,
        stagedClearanceProgressMetres:
          composition.clearanceProgressMetres,
        stagedClearanceSeconds: composition.clearanceSeconds,
        stagedConstrainedSeconds: composition.constrainedSeconds,
        stagedPublicationMissing: false
      };
    }
  }
  return {
    envelope: speedEnvelopeFromUniformSamples(
      entry.prog,
      track.step,
      speed,
      construction?.envelope
    ),
    brakingEffort,
    slowPoint: source[0] ?? null,
    longitudinalOwnerCode: owner?.code ?? null,
    stagedClearanceProgressMetres: null,
    stagedClearanceSeconds: null,
    stagedConstrainedSeconds: 0,
    stagedPublicationMissing: stagedAttack
  };
}

function nextProgramSpeed(
  dynamics: RacecraftFamilyDynamics,
  state: LaneState,
  progress: number,
  speed: number,
  targetSpeed: number,
  seconds: number,
  brakingEffort: number,
  towStrength: number
): number {
  const target = targetSpeed;
  const headroom = longitudinalAccelerationHeadroom(
    speed,
    state.curvature,
    state.dynamicMu,
    dynamics.downforceScale
  );
  if (target < speed) {
    const deceleration = Math.max(
      0,
      brakingEffort * headroom +
        passiveDeceleration(
          dynamics,
          speed,
          state.surfaceDrag,
          towStrength
        )
    );
    return Math.max(
      target,
      speed - deceleration * seconds
    );
  }
  return Math.max(0, Math.min(
    target,
    speed + driveAcceleration(
      dynamics,
      speed,
      state.curvature,
      state.dynamicMu,
      state.surfaceDrag,
      towStrength
    ) * seconds
  ));
}

function advanceReferenceGeometrySpeed(
  dynamics: RacecraftFamilyDynamics,
  state: LaneState,
  distance: number,
  speed: number,
  targetSpeed: number,
  brakingEffort: number
): number {
  const headroom = longitudinalAccelerationHeadroom(
    speed,
    state.curvature,
    state.dynamicMu,
    dynamics.downforceScale
  );
  if (targetSpeed < speed) {
    const deceleration =
      brakingEffort * headroom +
      passiveDeceleration(
        dynamics,
        speed,
        state.surfaceDrag
      );
    return Math.max(
      targetSpeed,
      Math.sqrt(Math.max(
        0,
        speed * speed - 2 * Math.max(0, deceleration) * distance
      ))
    );
  }
  const acceleration = Math.max(0, driveAcceleration(
    dynamics,
    speed,
    state.curvature,
    state.dynamicMu,
    state.surfaceDrag
  ));
  return Math.min(
    targetSpeed,
    Math.sqrt(Math.max(
      0,
      speed * speed + 2 * acceleration * distance
    ))
  );
}

/**
 * Exact sampled continuation on the shared reference geometry. It values a
 * terminal surplus as well as a deficit and naturally carries a top-speed
 * deficit to the next braking zone instead of dividing by zero acceleration.
 */
function terminalContinuationSeconds(
  session: Session,
  entry: ActiveEntry,
  startProgress: number,
  candidateStartSpeed: number,
  referenceStartSpeed: number,
  candidateBrakingEffort: number
): number {
  const work = evaluatorWork(session);
  work.terminalContinuationCalls++;
  let candidateSpeed = Math.max(0, candidateStartSpeed);
  let referenceSpeed = Math.max(0, referenceStartSpeed);
  let progress = startProgress;
  let difference = 0;
  const dynamics = evaluatorDynamics(session, entry);
  const margin = dynamics.margin;
  for (let sample = 0; sample < session.trk.n; sample++) {
    const scale = Math.max(1, candidateSpeed, referenceSpeed);
    if (Math.abs(candidateSpeed - referenceSpeed) <=
        Math.sqrt(Number.EPSILON) * scale)
      break;
    work.terminalContinuationSteps++;
    const nextProgress = progress + session.trk.step;
    const nextIndex = indexAtProgress(session.trk, entry, nextProgress);
    const targetSpeed = session.trk.idealPath.v[nextIndex]! * margin;
    const state = laneStateAt(
      session,
      entry,
      progress,
      IDEAL_PATH_PLAN
    );
    const distance = state.q * session.trk.step;
    const candidateNext = advanceReferenceGeometrySpeed(
      dynamics,
      state,
      distance,
      candidateSpeed,
      targetSpeed,
      candidateBrakingEffort
    );
    const referenceNext = advanceReferenceGeometrySpeed(
      dynamics,
      state,
      distance,
      referenceSpeed,
      targetSpeed,
      entry.brakingEffort
    );
    difference +=
      2 * distance /
        Math.max(Number.EPSILON, candidateSpeed + candidateNext) -
      2 * distance /
        Math.max(Number.EPSILON, referenceSpeed + referenceNext);
    candidateSpeed = candidateNext;
    referenceSpeed = referenceNext;
    progress = nextProgress;
  }
  return difference;
}

function ownTimeSeconds(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan,
  stations: readonly ProgramStation[],
  brakingEffort: number
): number {
  if (plan.mode === 'pit')
    throw new Error('Pit authority cannot enter racecraft own-time scoring');
  const track = session.trk;
  const margin = evaluatorDynamics(session, entry).margin;
  const distance = Math.max(8, entry.spd) *
    MANEUVER_PREDICTION.horizonSeconds;
  const segments = Math.max(1, Math.ceil(distance / track.step));
  const ds = distance / segments;
  const lateralProgram = compileCompactLateralProgram(track, plan);
  let total = 0;
  for (let segment = 0; segment < segments; segment++) {
    const progress = entry.prog + (segment + 0.5) * ds;
    const index = indexAtProgress(track, entry, progress);
    const geometry = writeCompactLateralGeometryAtProgress(
      track,
      lateralProgram,
      progress,
      ownTimeGeometryScratch
    );
    const referenceQ = Math.max(
      Number.EPSILON,
      track.idealPath.ds[index]! / track.step
    );
    const referenceSpeed = Math.max(
      Number.EPSILON,
      track.idealPath.v[index]! * margin
    );
    const candidateSpeed = programSpeedAtProgress(stations, progress);
    const difference = ds * (
      geometry.q / Math.max(Number.EPSILON, candidateSpeed) -
      referenceQ / referenceSpeed
    );
    total += difference;
  }
  const endProgress = entry.prog + distance;
  const endIndex = indexAtProgress(track, entry, endProgress);
  const referenceEnd = track.idealPath.v[endIndex]! * margin;
  const endCandidateSpeed = programSpeedAtProgress(stations, endProgress);
  total += terminalContinuationSeconds(
    session,
    entry,
    endProgress,
    endCandidateSpeed,
    referenceEnd,
    brakingEffort
  );
  return total;
}

function programStations(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan,
  speedLaw: CandidateSpeedLaw,
  evaluationClaims: EvaluationClaimMap = EMPTY_EVALUATION_CLAIMS
): ProgramStation[] {
  let speed = Math.max(0, entry.spd || entry.car.spd);
  let progress = entry.prog;
  let previousTime = 0;
  const dynamics = evaluatorDynamics(session, entry);
  const prepared = prepareLaneStateProgram(session, entry, plan);
  const stations: ProgramStation[] = [{
    time: 0,
    progress,
    s: entry.car.s,
    lateral: entry.latNow,
    speed,
    headingOffsetRadians: normAng(
      entry.car.h - Math.atan2(
        session.trk.ty[Math.max(0, entry.car.progIdx) % session.trk.n]!,
        session.trk.tx[Math.max(0, entry.car.progIdx) % session.trk.n]!
      )
    )
  }];
  let state = preparedLaneStateAt(
    session,
    entry,
    progress,
    prepared
  );
  stations[0]!.familyState = state;
  for (let sample = 1; sample <= MANEUVER_PREDICTION.samples; sample++) {
    const time = maneuverPredictionStationTime(sample);
    const stepSeconds = time - previousTime;
    const tow = candidateTowStrength(
      session,
      entry,
      progress,
      previousTime,
      state.lateral,
      speed,
      evaluationClaims
    );
    const nextSpeed = nextProgramSpeed(
      dynamics,
      state,
      progress,
      speed,
      speedLawAt(speedLaw, progress),
      stepSeconds,
      speedLaw.brakingEffort,
      tow
    );
    progress += (speed + nextSpeed) * 0.5 * stepSeconds;
    speed = nextSpeed;
    state = preparedLaneStateAt(
      session,
      entry,
      progress,
      prepared
    );
    stations.push({
      time,
      progress,
      s: (entry.car.s + progress - entry.prog) % session.trk.len,
      lateral: state.lateral,
      speed,
      headingOffsetRadians: state.headingOffsetRadians,
      familyState: state
    });
    previousTime = time;
  }
  return stations;
}

function programGripUtilization(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan,
  speedLaw: CandidateSpeedLaw,
  stations: readonly ProgramStation[]
): {
  maximum: number;
  exposureSeconds: number;
  exposure: Array<{ time: number; cumulativeSeconds: number }>;
} {
  const dynamics = evaluatorDynamics(session, entry);
  let maximum = 0;
  let exposureSeconds = 0;
  let previousUtilization = 0;
  let previousTime = 0;
  const exposure: Array<{
    time: number;
    cumulativeSeconds: number;
  }> = [];
  for (const station of stations) {
    const state = station.familyState ?? laneStateAt(
      session,
      entry,
      station.progress,
      plan
    );
    const grip = availableDeceleration(
      station.speed,
      state.dynamicMu,
      dynamics.downforceScale
    );
    if (grip <= Number.EPSILON) continue;
    const lateral = station.speed * station.speed *
      Math.abs(state.curvature);
    const headroom = Math.sqrt(Math.max(
      0,
      grip * grip - lateral * lateral
    ));
    const target = speedLawAt(speedLaw, station.progress);
    let longitudinal = 0;
    if (target < station.speed - Number.EPSILON) {
      longitudinal = speedLaw.brakingEffort * headroom;
    } else {
      const driveForce = Math.min(
        PHYS.Fmax * dynamics.modifiers.pw,
        PHYS.power * dynamics.modifiers.pw / Math.max(4, station.speed)
      );
      longitudinal = Math.min(driveForce / PHYS.m, headroom);
    }
    const utilization = clamp(
      Math.sqrt(
        lateral * lateral + longitudinal * longitudinal
      ) / grip,
      0,
      1
    );
    maximum = Math.max(maximum, utilization);
    const elapsed = Math.max(0, station.time - previousTime);
    exposureSeconds +=
      (previousUtilization + utilization) * 0.5 * elapsed;
    exposure.push({
      time: station.time,
      cumulativeSeconds: exposureSeconds
    });
    previousUtilization = utilization;
    previousTime = station.time;
  }
  return { maximum, exposureSeconds, exposure };
}

function writeProgramStationAtTime(
  track: Track,
  stations: readonly ProgramStation[],
  time: number,
  out: ProgramStation
): ProgramStation {
  if (time <= stations[0]!.time) {
    const first = stations[0]!;
    out.time = first.time;
    out.progress = first.progress;
    out.s = first.s;
    out.lateral = first.lateral;
    out.speed = first.speed;
    out.headingOffsetRadians = first.headingOffsetRadians;
    return out;
  }
  for (let index = 1; index < stations.length; index++) {
    const to = stations[index]!;
    if (time > to.time) continue;
    const from = stations[index - 1]!;
    const u = (time - from.time) /
      Math.max(Number.EPSILON, to.time - from.time);
    const blend = clamp(u, 0, 1);
    const progress = from.progress +
      (to.progress - from.progress) * blend;
    out.time = time;
    out.progress = progress;
    out.s = (from.s + progress - from.progress) % track.len;
    out.lateral = from.lateral +
      (to.lateral - from.lateral) * blend;
    out.speed = from.speed + (to.speed - from.speed) * blend;
    out.headingOffsetRadians = normAng(
      from.headingOffsetRadians +
      normAng(
        to.headingOffsetRadians - from.headingOffsetRadians
      ) * blend
    );
    return out;
  }
  const last = stations[stations.length - 1]!;
  out.time = last.time;
  out.progress = last.progress;
  out.s = last.s;
  out.lateral = last.lateral;
  out.speed = last.speed;
  out.headingOffsetRadians = last.headingOffsetRadians;
  return out;
}

function programStationAtTime(
  track: Track,
  stations: readonly ProgramStation[],
  time: number
): ProgramStation {
  return writeProgramStationAtTime(track, stations, time, {
    time: 0,
    progress: 0,
    s: 0,
    lateral: 0,
    speed: 0,
    headingOffsetRadians: 0
  });
}

function staticRejectedCandidateProgram(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  seed: RacecraftCandidateSeed,
  previousKind: RacecraftCandidateKind | null,
  evaluationClaims: EvaluationClaimMap,
  actionableOwnershipViews: readonly ActionableOwnershipAssertion[],
  workspace: CandidateEvaluationWorkspace,
  diagnostic: ManeuverCandidateDiagnostic,
  brakingEffort: number,
  spatial: CandidateSpatialStateScratch,
  retainedSpeedLaw?: CandidateSpeedLaw
): CandidateProgram {
  const currentSpeed = Math.max(0, entry.spd || entry.car.spd);
  let speedLaw = retainedSpeedLaw ?? workspace.rejectedSpeedLaw;
  if (!speedLaw || speedLaw.brakingEffort !== brakingEffort) {
    speedLaw = {
      envelope: speedEnvelopeFromSamples(
        [entry.prog, entry.prog + session.trk.step],
        [currentSpeed, currentSpeed]
      ),
      brakingEffort,
      slowPoint: null,
      longitudinalOwnerCode: null,
      stagedClearanceProgressMetres: null,
      stagedClearanceSeconds: null,
      stagedConstrainedSeconds: 0,
      stagedPublicationMissing: false
    };
    workspace.rejectedSpeedLaw = speedLaw;
  }
  let stations = workspace.rejectedStations;
  if (!stations) {
    stations = [{
      time: 0,
      progress: entry.prog,
      s: entry.car.s,
      lateral: entry.latNow,
      speed: currentSpeed,
      headingOffsetRadians: normAng(
        entry.car.h - Math.atan2(
          session.trk.ty[
            Math.max(0, entry.car.progIdx) % session.trk.n
          ]!,
          session.trk.tx[
            Math.max(0, entry.car.progIdx) % session.trk.n
          ]!
        )
      )
    }];
    workspace.rejectedStations = stations;
  }
  let targetLateral = entry.latNow;
  for (let slot = spatial.valid.length - 1; slot >= 0; slot--)
    if (spatial.valid[slot]) {
      targetLateral = spatial.lateral[slot]!;
      break;
    }
  const evaluation: RacecraftCandidateEvaluation = {
    kind: seed.kind,
    plan: seed.plan,
    planNumericId: racecraftPlanNumericId(seed.plan),
    familyNumericId: racecraftFamilyNumericId(
      session,
      seed.kind,
      seed.plan,
      seed.slowPointOwnerCode
    ),
    feasible: false,
    vetoes: [...diagnostic.rejections],
    targetLateral,
    slowPointOwnerCode: seed.slowPointOwnerCode,
    slowPoint: null,
    interactionCause: obligationsFor(session, entry, entries)[0]?.reason ??
      (seed.slowPointOwnerCode ? 'draft' : 'ordinary'),
    ownTimeSeconds: 0,
    billSeconds: 0,
    proximitySeconds: 0,
    positionValueSeconds: 0,
    attemptLossSeconds: 0,
    battleSpendSeconds: 0,
    effortRiskSeconds: 0,
    positionGain: false,
    minimumPlannedClearanceMetres: null,
    tieBandSeconds: 0,
    hazardCount: 0,
    switchChanged: previousKind != null && previousKind !== seed.kind,
    brakingEffort,
    gripUtilization: clamp(diagnostic.controllerDemand, 0, 1),
    direction: directionFor(targetLateral - entry.latNow),
    speedClass: seed.kind === 'brake-behind' ? 'brake' : 'free',
    cost: Infinity
  };
  return {
    evaluation,
    stations,
    speedLaw,
    bounds: null,
    positionGains: null,
    authoredExtensions: null,
    evaluationClaims,
    ownershipAssertion: null,
    actionableOwnershipViews,
    defenderReclaim: false,
    defensiveLegality: null,
    utilizationExposureSeconds: 0,
    utilizationExposure: [],
    fullyScored: true,
    branchBounded: false,
    effortRiskComputed: true
  };
}

function evaluateSeed(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  seed: RacecraftCandidateSeed,
  previousKind: RacecraftCandidateKind | null,
  evaluationClaims: EvaluationClaimMap,
  actionableOwnershipViews: readonly ActionableOwnershipAssertion[],
  workspace: CandidateEvaluationWorkspace,
  measureOwnTime = true,
  precomposedSpeedLaw?: CandidateSpeedLaw
): CandidateProgram {
  evaluatorWork(session).seedEvaluations++;
  const brakingEffort = precomposedSpeedLaw?.brakingEffort ?? clamp(
    brakingEffortForPlan(entry, seed.plan),
    BOT_BRAKING_EFFORT_MINIMUM,
    BOT_BRAKING_EFFORT_MAXIMUM
  );
  if (seed.plan.mode === 'pit')
    throw new Error('Pit authority cannot enter the racecraft evaluator');
  const spatial = prepareCandidateSpatialState(session, entry, seed.plan);
  let samplerContext = evaluatorManeuverSamplerContexts.get(entry);
  if (!samplerContext) {
    samplerContext = {
      session,
      entry,
      plan: seed.plan,
      program: spatial.program,
      dynamics: spatial.dynamics,
      stateSlots: new Int32Array(session.trk.n),
      stateStamps: new Uint32Array(session.trk.n),
      stateGeneration: 1,
      statePool: [],
      stateUsed: 0,
      spatial,
      diagnostic: undefined
    };
    evaluatorManeuverSamplerContexts.set(entry, samplerContext);
  }
  samplerContext.session = session;
  samplerContext.entry = entry;
  samplerContext.plan = seed.plan;
  samplerContext.spatial = spatial;
  samplerContext.program = spatial.program;
  samplerContext.dynamics = spatial.dynamics;
  if (samplerContext.stateSlots.length !== session.trk.n) {
    samplerContext.stateSlots = new Int32Array(session.trk.n);
    samplerContext.stateStamps = new Uint32Array(session.trk.n);
    samplerContext.stateGeneration = 1;
  } else {
    samplerContext.stateGeneration =
      (samplerContext.stateGeneration + 1) >>> 0;
    if (samplerContext.stateGeneration === 0) {
      samplerContext.stateStamps.fill(0);
      samplerContext.stateGeneration = 1;
    }
  }
  samplerContext.stateUsed = 0;
  const diagnostic = evaluateManeuverPlanCompactWithSampler(
    session,
    entry,
    seed.plan,
    EVALUATOR_MANEUVER_SAMPLER,
    samplerContext,
    false,
    samplerContext.diagnostic
  );
  samplerContext.diagnostic = diagnostic;
  if (!candidateRespectsAgreement(
    session,
    entry,
    seed.plan
  )) {
    if (!diagnostic.rejections.includes('protected-corridor'))
      diagnostic.rejections.push('protected-corridor');
    diagnostic.feasible = false;
  }
  const stagedAttack = seed.plan.mode !== 'ideal' &&
    (seed.plan.mode === 'side-inside' ||
      seed.plan.mode === 'side-outside') &&
    seed.plan.surfaceAuthorization !== 'emergency' &&
    seed.plan.leaderCode != null;
  if (stagedAttack)
    session.racecraftStagedCandidatesOpened =
      (session.racecraftStagedCandidatesOpened ?? 0) + 1;
  // `hold` remains the exact reference for conditional brake-behind
  // admission even when its static geometry is rejected. Skipping that law
  // would change the candidate set rather than merely avoid losing work.
  if (!diagnostic.feasible && seed.kind !== 'hold')
    return staticRejectedCandidateProgram(
      session,
      entry,
      entries,
      seed,
      previousKind,
      evaluationClaims,
      actionableOwnershipViews,
      workspace,
      diagnostic,
      brakingEffort,
      spatial
    );
  const speedLaw = precomposedSpeedLaw ??
    composeCandidateSpeedLaw(
      session,
      entry,
      seed.plan,
      seed.slowPointOwnerCode,
      entries,
      evaluationClaims,
      brakingEffort,
      workspace
    );
  if (!diagnostic.feasible)
    return staticRejectedCandidateProgram(
      session,
      entry,
      entries,
      seed,
      previousKind,
      evaluationClaims,
      actionableOwnershipViews,
      workspace,
      diagnostic,
      brakingEffort,
      spatial,
      speedLaw
    );
  const stations = programStations(
    session,
    entry,
    seed.plan,
    speedLaw,
    evaluationClaims
  );
  if (stagedAttack) {
    session.racecraftStagedAcquisitionConstrainedSeconds =
      (session.racecraftStagedAcquisitionConstrainedSeconds ?? 0) +
      speedLaw.stagedConstrainedSeconds;
  }
  const targetLateral = stations.at(-1)!.lateral;
  const measuredOwnTime = measureOwnTime
    ? ownTimeSeconds(
        session,
        entry,
        seed.plan,
        stations,
        speedLaw.brakingEffort
      )
    : 0;
  let authoredTerminal: number | null = null;
  const finalProgress = stations.at(-1)!.progress;
  if (seed.plan.mode !== 'ideal' &&
      (seed.plan.mode === 'side-inside' ||
        seed.plan.mode === 'side-outside'))
    for (let index = seed.plan.anchors.length - 1; index >= 0; index--) {
      const progress = seed.plan.anchors[index]!.s;
      if (progress != null &&
          progress > finalProgress + Number.EPSILON) {
        authoredTerminal = progress;
        break;
      }
    }
  let authoredExtensions: Map<number, ProgramStation[]> | null = null;
  let utilizationStations = stations;
  if (authoredTerminal != null &&
      authoredTerminal - entry.prog <= session.trk.len / 2) {
    utilizationStations = [
      ...stations.slice(0, -1),
      ...extendedAuthoredProgramStations(
        session,
        entry,
        seed.plan,
        speedLaw,
        stations,
        authoredTerminal,
        evaluationClaims
      )
    ];
    authoredExtensions = new Map([
      [authoredTerminal, utilizationStations]
    ]);
  }
  const grip = programGripUtilization(
    session,
    entry,
    seed.plan,
    speedLaw,
    utilizationStations
  );
  const evaluation: RacecraftCandidateEvaluation = {
    kind: seed.kind,
    plan: seed.plan,
    planNumericId: racecraftPlanNumericId(seed.plan),
    familyNumericId: racecraftFamilyNumericId(
      session,
      seed.kind,
      seed.plan,
      seed.slowPointOwnerCode
    ),
    feasible: diagnostic.feasible && !speedLaw.stagedPublicationMissing,
    vetoes: [
      ...diagnostic.rejections,
      ...(speedLaw.stagedPublicationMissing
        ? ['forward-publication-unavailable']
        : [])
    ],
    targetLateral,
    slowPointOwnerCode: seed.slowPointOwnerCode,
    slowPoint: speedLaw.slowPoint,
    interactionCause: obligationsFor(session, entry, entries)[0]?.reason ??
      (seed.slowPointOwnerCode ? 'draft' : 'ordinary'),
    ownTimeSeconds: measuredOwnTime,
    billSeconds: 0,
    proximitySeconds: 0,
    positionValueSeconds: 0,
    attemptLossSeconds: 0,
    battleSpendSeconds: 0,
    effortRiskSeconds: 0,
    positionGain: false,
    minimumPlannedClearanceMetres: null,
    tieBandSeconds: 0,
    hazardCount: 0,
    switchChanged: previousKind != null && previousKind !== seed.kind,
    brakingEffort: speedLaw.brakingEffort,
    gripUtilization: Math.max(
      clamp(diagnostic.controllerDemand, 0, 1),
      grip.maximum
    ),
    direction: directionFor(targetLateral - entry.latNow),
    speedClass: seed.kind === 'brake-behind' ? 'brake' : 'free',
    cost: Infinity
  };
  return {
    evaluation,
    stations,
    speedLaw,
    bounds: null,
    positionGains: null,
    authoredExtensions,
    evaluationClaims,
    ownershipAssertion: null,
    actionableOwnershipViews,
    defenderReclaim: false,
    defensiveLegality: null,
    utilizationExposureSeconds: grip.exposureSeconds,
    utilizationExposure: grip.exposure,
    fullyScored: false,
    branchBounded: false,
    effortRiskComputed: false
  };
}

export function publishedTrajectoriesContestedRegion(
  track: Track,
  ownClaim: RacecraftClaim,
  otherClaim: RacecraftClaim
): RacecraftContestedRegion | null {
  const ownHorizon = racecraftClaimHorizonSeconds(ownClaim);
  const otherHorizon = racecraftClaimHorizonSeconds(otherClaim);
  const end = Math.min(ownHorizon, otherHorizon);
  const times = [0, end];
  for (const claim of [ownClaim, otherClaim])
    for (let index = 0;
      index < racecraftClaimSegmentCount(claim);
      index++) {
      const time = racecraftClaimSegmentEndTime(claim, index);
      if (time > 0 && time < end) times.push(time);
    }
  times.sort((left, right) => left - right);
  let count = Math.min(1, times.length);
  for (let index = 1; index < times.length; index++) {
    if (Math.abs(times[index]! - times[count - 1]!) <= Number.EPSILON)
      continue;
    times[count++] = times[index]!;
  }
  times.length = count;
  const poses = times.map(time => {
    const own = racecraftClaimStateAtTime(track, ownClaim, time);
    const other = racecraftClaimStateAtTime(track, otherClaim, time);
    return {
      timeSeconds: time,
      relativeLongitudinal: signedTrackDistance(track, own.s, other.s),
      relativeLateral: other.lateral - own.lateral,
      egoHeadingRadians: own.headingOffsetRadians,
      rivalHeadingRadians: other.headingOffsetRadians
    };
  });
  const first = sweptCarContactEpisodes(poses)[0];
  if (!first) return null;
  const own = racecraftClaimStateAtTime(
    track,
    ownClaim,
    first.startTimeSeconds
  );
  const other = racecraftClaimStateAtTime(
    track,
    otherClaim,
    first.startTimeSeconds
  );
  return {
    sMetres: (
      own.s + signedTrackDistance(track, own.s, other.s) / 2 +
      track.len
    ) % track.len,
    sessionTimeSeconds: first.startTimeSeconds
  };
}

function hazardsFor(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  evaluationClaims: EvaluationClaimMap
): Hazard[] {
  const hazards: Hazard[] = [];
  for (const other of entries) {
    if (!racecraftIsInteractionNeighbor(session, entry, other)) continue;
    const prediction = evaluationClaims.get(other.code);
    if (!prediction ||
        racecraftClaimSegmentCount(prediction.claim) === 0)
      continue;
    const claim = prediction.claim;
    const hazard: Hazard = {
      key: `${entry.code}:${other.code}`,
      other: other as ActiveEntry,
      claim,
      originS: claim.originS,
      originLateral: claim.originCentre,
      originHeadingOffsetRadians:
        claim.originHeadingOffsetRadians,
      rivalSweepGeometry: null
    };
    hazards.push(hazard);
  }
  evaluatorWork(session).hazardsBuilt += hazards.length;
  return hazards;
}

function evaluationClaimsAt(
  session: Session,
  entries: readonly Entry[]
): EvaluationClaimMap {
  const views = new Map<string, RacecraftEvaluationClaim>();
  for (const entry of entries) {
    const claim = session.racecraftClaims?.get(entry.code);
    if (!claim) continue;
    views.set(
      entry.code,
      racecraftClaimAtEvaluationEpoch(session.trk, claim, session.t)
    );
  }
  return views;
}

function wrappedTrackS(track: Track, s: number): number {
  // Evaluator advances are shorter than one lap; preserving that bound turns
  // a general modulo into the exact single-wrap operation it represents.
  if (s >= track.len) return s - track.len;
  if (s < 0) return s + track.len;
  return s;
}

interface WorldBodyPose {
  x: number;
  y: number;
  headingRadians: number;
}

const trackTangentHeadings = new WeakMap<Track, Float64Array>();
const sweptPoseScratch: SweptCarPosePair[] = [];
const egoWorldPoseScratch: WorldBodyPose = {
  x: 0,
  y: 0,
  headingRadians: 0
};
const rivalWorldPoseScratch: WorldBodyPose = {
  x: 0,
  y: 0,
  headingRadians: 0
};
const offHorizonRivalStateScratch: RacecraftClaimState = {
  progressMetres: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};

function tangentHeadings(track: Track): Float64Array {
  let headings = trackTangentHeadings.get(track);
  if (headings) return headings;
  headings = new Float64Array(track.n);
  for (let index = 0; index < track.n; index++)
    headings[index] = Math.atan2(track.ty[index]!, track.tx[index]!);
  trackTangentHeadings.set(track, headings);
  return headings;
}

/**
 * Convert one Frenet point to the fixed world frame consumed by the physical
 * four-circle sweep. Sweeping independently sampled track-frame coordinates
 * would rotate the frame between samples and invent non-physical closing
 * speeds in curved or long terminal rollouts.
 */
function writeWorldBodyPose(
  track: Track,
  s: number,
  lateral: number,
  headingOffsetRadians: number,
  out: WorldBodyPose
): WorldBodyPose {
  const sample = wrappedTrackS(track, s) / track.step;
  const fromIndex = Math.floor(sample) % track.n;
  const toIndex = (fromIndex + 1) % track.n;
  const amount = sample - Math.floor(sample);
  const headings = tangentHeadings(track);
  const tangentFrom = headings[fromIndex]!;
  const tangentTo = tangentFrom + normAng(
    headings[toIndex]! - tangentFrom
  );
  const tangent = tangentFrom +
    (tangentTo - tangentFrom) * amount;
  const centreX = track.x[fromIndex]! +
    (track.x[toIndex]! - track.x[fromIndex]!) * amount;
  const centreY = track.y[fromIndex]! +
    (track.y[toIndex]! - track.y[fromIndex]!) * amount;
  out.x = centreX - Math.sin(tangent) * lateral;
  out.y = centreY + Math.cos(tangent) * lateral;
  out.headingRadians = normAng(tangent + headingOffsetRadians);
  return out;
}

function worldBodyPose(
  track: Track,
  s: number,
  lateral: number,
  headingOffsetRadians: number
): WorldBodyPose {
  return writeWorldBodyPose(track, s, lateral, headingOffsetRadians, {
    x: 0,
    y: 0,
    headingRadians: 0
  });
}

function writeSweptPose(
  index: number,
  timeSeconds: number,
  egoWorld: WorldBodyPose,
  rivalWorld: WorldBodyPose
): SweptCarPosePair {
  const out = sweptPoseScratch[index] ?? (sweptPoseScratch[index] = {
    timeSeconds: 0,
    relativeLongitudinal: 0,
    relativeLateral: 0,
    egoHeadingRadians: 0,
    rivalHeadingRadians: 0
  });
  out.timeSeconds = timeSeconds;
  out.relativeLongitudinal = rivalWorld.x - egoWorld.x;
  out.relativeLateral = rivalWorld.y - egoWorld.y;
  out.egoHeadingRadians = egoWorld.headingRadians;
  out.rivalHeadingRadians = rivalWorld.headingRadians;
  return out;
}

function rivalSweepGeometry(
  session: Session,
  hazard: Hazard
): NonNullable<Hazard['rivalSweepGeometry']> {
  if (hazard.rivalSweepGeometry) {
    evaluatorWork(session).rivalSweepCacheHits++;
    return hazard.rivalSweepGeometry;
  }
  const track = session.trk;
  const claim = hazard.claim;
  const shared = rivalSweepGeometryByClaim.get(claim);
  if (shared &&
      shared.track === track &&
      shared.publishedAt === claim.publishedAt &&
      shared.publicationRevision === claim.publicationRevision &&
      shared.predictionKey === claim.predictionKey) {
    hazard.rivalSweepGeometry = shared.geometry;
    evaluatorWork(session).rivalSweepCacheHits++;
    return shared.geometry;
  }
  const stationGeometry = new Array<WorldBodyPose>(
    racecraftClaimSegmentCount(claim)
  );
  for (let index = 0; index < stationGeometry.length; index++) {
    const state = racecraftClaimStateAtTime(
      track,
      claim,
      racecraftClaimSegmentEndTime(claim, index)
    );
    stationGeometry[index] = worldBodyPose(
      track,
      state.s,
      state.lateral,
      state.headingOffsetRadians
    );
  }
  const geometry = {
    origin: worldBodyPose(
      track,
      hazard.originS,
      hazard.originLateral,
      hazard.originHeadingOffsetRadians
    ),
    stations: stationGeometry
  };
  hazard.rivalSweepGeometry = geometry;
  rivalSweepGeometryByClaim.set(claim, {
    track,
    publishedAt: claim.publishedAt,
    publicationRevision: claim.publicationRevision,
    predictionKey: claim.predictionKey,
    geometry
  });
  evaluatorWork(session).rivalSweepBuilds++;
  return geometry;
}

/**
 * Whether this selected analytic family owns the lateral controller now.
 * Installation checks the current authority directly at the owner slot.
 */
export function racecraftSelectedLaneIsExecutable(
  session: Session,
  entry: Entry,
  neighbors: readonly Entry[],
  selected: RacecraftCandidateEvaluation | undefined
): boolean {
  const obligationParticipant = isObligationParticipant(
    session,
    entry,
    [entry, ...neighbors]
  );
  const pitDestination = !!(entry.pitArm || entry.boxArm) &&
    selected != null &&
    selected.plan.mode !== 'ideal' && selected.plan.mode !== 'pit' &&
    selected.plan.key.includes(':pit-destination:');
  return (
    session.mode === 'race' ||
    obligationParticipant ||
    pitDestination
  ) &&
    session.t - session.goT >= START_BLEND_END &&
    entry.avoidT <= 0 &&
    (obligationParticipant || entry.pathPlan == null);
}

interface RelativePointStation {
  timeSeconds: number;
  longitudinalMetres: number;
  lateralMetres: number;
  egoHeadingOffsetRadians: number;
  rivalHeadingOffsetRadians: number;
}

/**
 * Keep a wrapped track separation on the branch nearest the preceding point.
 * Independent shortest-distance samples can jump by a full lap at the
 * half-lap seam, inventing a high-speed sweep through the rival.
 */
function continuousRelativeTrackDistance(
  track: Track,
  previous: number,
  wrapped: number
): number {
  return wrapped + Math.round((previous - wrapped) / track.len) * track.len;
}

export interface RacecraftPointTrajectoryScreenOrigin {
  longitudinalMetres: number;
  lateralMetres: number;
}

/** Conservative axis bound before the exact continuous oriented-body sweep. */
export function racecraftPointTrajectoriesMayIntersect(
  origin: RacecraftPointTrajectoryScreenOrigin,
  stations: readonly RelativePointStation[],
  physicalMarginMetres = 0
): boolean {
  const extent = Math.sqrt(
    PHYS.carLen * PHYS.carLen + PHYS.carWid * PHYS.carWid
  ) +
    Math.max(0, physicalMarginMetres);
  let previous = origin;
  for (const station of stations) {
    const longitudinalMinimum = Math.min(
      previous.longitudinalMetres,
      station.longitudinalMetres
    );
    const longitudinalMaximum = Math.max(
      previous.longitudinalMetres,
      station.longitudinalMetres
    );
    const lateralMinimum = Math.min(
      previous.lateralMetres,
      station.lateralMetres
    );
    const lateralMaximum = Math.max(
      previous.lateralMetres,
      station.lateralMetres
    );
    if (longitudinalMinimum <= extent &&
        longitudinalMaximum >= -extent &&
        lateralMinimum <= extent &&
        lateralMaximum >= -extent)
      return true;
    previous = station;
  }
  return false;
}

function relativePointStations(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard
): RelativePointStation[] {
  let previousLongitudinal = signedTrackDistance(
    session.trk,
    program.stations[0]!.s,
    hazard.originS
  );
  const stations = new Array<RelativePointStation>(
    racecraftClaimSegmentCount(hazard.claim)
  );
  for (let index = 0; index < stations.length; index++) {
    const stationTime = racecraftClaimSegmentEndTime(
      hazard.claim,
      index
    );
    const rival = racecraftClaimStateAtTime(
      session.trk,
      hazard.claim,
      stationTime
    );
    const ego = writeProgramStationAtTime(
      session.trk,
      program.stations,
      stationTime,
      programStationScratchA
    );
    const wrappedLongitudinal = signedTrackDistance(
      session.trk,
      ego.s,
      rival.s
    );
    const longitudinalMetres = continuousRelativeTrackDistance(
      session.trk,
      previousLongitudinal,
      wrappedLongitudinal
    );
    previousLongitudinal = longitudinalMetres;
    stations[index] = {
      timeSeconds: stationTime,
      longitudinalMetres,
      lateralMetres: rival.lateral - ego.lateral,
      egoHeadingOffsetRadians: ego.headingOffsetRadians,
      rivalHeadingOffsetRadians: rival.headingOffsetRadians
    };
  }
  return stations;
}

function pointTrajectoryBound(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard,
  stations: readonly RelativePointStation[],
  physicalMarginMetres = 0
): boolean {
  return racecraftPointTrajectoriesMayIntersect({
    longitudinalMetres: signedTrackDistance(
      session.trk,
      program.stations[0]!.s,
      hazard.originS
    ),
    lateralMetres: hazard.originLateral - program.stations[0]!.lateral
  }, stations, physicalMarginMetres);
}

function boundedRelativeStations(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard,
  physicalMarginMetres = 0
): RelativePointStation[] | null {
  const work = evaluatorWork(session);
  const stations = relativePointStations(
    session,
    program,
    hazard
  );
  work.boundScreenCalls++;
  if (!pointTrajectoryBound(
    session,
    program,
    hazard,
    stations,
    physicalMarginMetres
  )) {
    work.boundScreenClears++;
    return null;
  }
  work.boundScreenHits++;
  return stations;
}

function boundProgramHazard(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard
): RelativePointStation[] | null {
  if (program.bounds?.has(hazard.key))
    return program.bounds.get(hazard.key) ?? null;
  const stations = boundedRelativeStations(
    session,
    program,
    hazard
  );
  (program.bounds ??= new Map()).set(hazard.key, stations);
  return stations;
}

function firstSweptContact(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard,
  points: readonly RelativePointStation[] =
    relativePointStations(session, program, hazard),
  physicalMarginMetres = 0
): SweptContact | null {
  evaluatorWork(session).deterministicSweeps++;
  const origin = program.stations[0]!;
  const rivalGeometry = rivalSweepGeometry(session, hazard);
  writeSweptPose(
    0,
    0,
    writeWorldBodyPose(
      session.trk,
      origin.s,
      origin.lateral,
      origin.headingOffsetRadians,
      egoWorldPoseScratch
    ),
    rivalGeometry.origin
  );
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const ego = writeProgramStationAtTime(
      session.trk,
      program.stations,
      point.timeSeconds,
      programStationScratchA
    );
    const rivalWorld = rivalGeometry.stations[index]!;
    writeSweptPose(
      index + 1,
      point.timeSeconds,
      writeWorldBodyPose(
        session.trk,
        ego.s,
        ego.lateral,
        ego.headingOffsetRadians,
        egoWorldPoseScratch
      ),
      rivalWorld
    );
  }
  sweptPoseScratch.length = points.length + 1;
  const episodes = sweptCarContactEpisodes(
    sweptPoseScratch,
    physicalMarginMetres
  );
  const first = episodes[0];
  if (!first) return null;
  let maximumRelativeNormalSpeed = first.maximumRelativeNormalSpeed;
  for (let index = 1; index < episodes.length; index++)
    maximumRelativeNormalSpeed = Math.max(
      maximumRelativeNormalSpeed,
      episodes[index]!.maximumRelativeNormalSpeed
    );
  const ego = writeProgramStationAtTime(
    session.trk,
    program.stations,
    first.startTimeSeconds,
    programStationScratchA
  );
  return {
    time: first.startTimeSeconds,
    egoProgress: ego.progress,
    egoSpeed: ego.speed,
    maximumRelativeNormalSpeed,
    episodes
  };
}

/**
 * Continue one candidate to its authored convergence anchor without extending
 * the regular collision grid. Local caps are backward-induced sample by
 * sample (corollary 7); omitting passive drag from that preparatory sweep is
 * conservative, while the forward rollout restores the actual tow-dependent
 * drag and drive force.
 */
function extendedAuthoredProgramStations(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan,
  speedLaw: CandidateSpeedLaw,
  stations: readonly ProgramStation[],
  targetProgress: number,
  evaluationClaims: EvaluationClaimMap = EMPTY_EVALUATION_CLAIMS
): ProgramStation[] {
  const start = stations.at(-1)!;
  if (targetProgress <= start.progress + Number.EPSILON)
    return [{ ...start }];
  const span = targetProgress - start.progress;
  const segmentCount = Math.max(
    1,
    Math.ceil(span / session.trk.step)
  );
  const progress = Array.from(
    { length: segmentCount + 1 },
    (_, index) => start.progress + span * index / segmentCount
  );
  const prepared = prepareLaneStateProgram(session, entry, plan);
  const dynamics = prepared.dynamics;
  const states = progress.map(value =>
    preparedLaneStateAt(
      session,
      entry,
      value,
      prepared
    ));
  const caps = progress.map((value, index) => {
    const authored = states[index]!.targetSpeed;
    return value <= speedLaw.envelope.endProgress +
        Number.EPSILON
      ? Math.min(authored, speedLawAt(speedLaw, value))
      : authored;
  });
  caps[0] = Math.min(caps[0]!, start.speed);
  const downforce = dynamics.downforceScale;
  for (let index = segmentCount - 1; index >= 0; index--) {
    const state = states[index]!;
    const distance = (
      progress[index + 1]! - progress[index]!
    ) * state.q;
    caps[index] = Math.min(
      caps[index]!,
      backwardInducedSpeedLimit(
        caps[index + 1]!,
        caps[index]!,
        distance,
        state.curvature,
        state.dynamicMu,
        downforce,
        speedLaw.brakingEffort,
        0
      )
    );
  }

  let time = start.time;
  let speed = start.speed;
  const extension: ProgramStation[] = [{ ...start }];
  for (let index = 0; index < segmentCount; index++) {
    const state = states[index]!;
    const fromProgress = progress[index]!;
    const distance = (
      progress[index + 1]! - fromProgress
    ) * state.q;
    const tow = candidateTowStrength(
      session,
      entry,
      fromProgress,
      time,
      state.lateral,
      speed,
      evaluationClaims
    );
    const target = caps[index + 1]!;
    let nextSpeed: number;
    if (target < speed - Number.EPSILON) {
      const room = longitudinalAccelerationHeadroom(
        speed,
        state.curvature,
        state.dynamicMu,
        downforce
      );
      const deceleration =
        speedLaw.brakingEffort * room +
        passiveDeceleration(
          dynamics,
          speed,
          state.surfaceDrag,
          tow
        );
      nextSpeed = Math.max(
        target,
        Math.sqrt(Math.max(
          0,
          speed * speed - 2 * Math.max(0, deceleration) * distance
        ))
      );
    } else {
      const acceleration = Math.max(0, driveAcceleration(
        dynamics,
        speed,
        state.curvature,
        state.dynamicMu,
        state.surfaceDrag,
        tow
      ));
      nextSpeed = Math.min(
        target,
        Math.sqrt(Math.max(
          0,
          speed * speed + 2 * acceleration * distance
        ))
      );
    }
    time += 2 * distance /
      Math.max(Number.EPSILON, speed + nextSpeed);
    speed = nextSpeed;
    const nextState = states[index + 1]!;
    const nextProgress = progress[index + 1]!;
    extension.push({
      time,
      progress: nextProgress,
      s: wrappedTrackS(
        session.trk,
        entry.car.s + nextProgress - entry.prog
      ),
      lateral: nextState.lateral,
      speed,
      headingOffsetRadians: nextState.headingOffsetRadians,
      familyState: nextState
    });
  }
  return extension;
}

function extendAuthoredProgramToProgress(
  session: Session,
  entry: ActiveEntry,
  plan: PathPlan,
  speedLaw: CandidateSpeedLaw,
  stations: readonly ProgramStation[],
  targetProgress: number,
  evaluationClaims: EvaluationClaimMap = EMPTY_EVALUATION_CLAIMS
): ProgramStation {
  return extendedAuthoredProgramStations(
    session,
    entry,
    plan,
    speedLaw,
    stations,
    targetProgress,
    evaluationClaims
  ).at(-1)!;
}

function programExtendedToProgress(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  targetProgress: number
): CandidateProgram {
  if (targetProgress <=
      program.stations.at(-1)!.progress + Number.EPSILON)
    return program;
  let stations = program.authoredExtensions?.get(targetProgress);
  if (!stations) {
    const extension = extendedAuthoredProgramStations(
      session,
      entry,
      program.evaluation.plan,
      program.speedLaw,
      program.stations,
      targetProgress,
      program.evaluationClaims
    );
    stations = [
      ...program.stations.slice(0, -1),
      ...extension
    ];
    (program.authoredExtensions ??= new Map()).set(
      targetProgress,
      stations
    );
  }
  return {
    ...program,
    stations
  };
}

function bestPlanStateAtTime(
  session: Session,
  hazard: Hazard,
  _evaluationClaims: EvaluationClaimMap,
  time: number
): RacecraftClaimState | null {
  return racecraftClaimStateAtTime(
    session.trk,
    hazard.claim,
    time
  );
}

/**
 * Attack plans may converge after the regular 2.4 s point grid. Only the
 * qualifying attack is continued, at the authored track-step resolution, so
 * the horizon limits ordinary work without replacing a curved region by one
 * sign-indefinite chord.
 */
function offHorizonAttackContact(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  hazard: Hazard
): SweptContact | null {
  const plan = program.evaluation.plan;
  if (plan.mode === 'ideal' || plan.mode === 'pit' ||
      (plan.mode !== 'side-inside' && plan.mode !== 'side-outside'))
    return null;
  const start = program.stations.at(-1)!;
  let targetProgress: number | null = null;
  for (const anchor of plan.anchors)
    if (anchor.s != null &&
        anchor.s > start.progress + Number.EPSILON)
      targetProgress = anchor.s;
  if (targetProgress == null ||
      targetProgress - entry.prog > session.trk.len / 2)
    return null;
  const fullExtension = programExtendedToProgress(
    session,
    entry,
    program,
    targetProgress
  ).stations;
  let extensionStart = 0;
  while (extensionStart < fullExtension.length &&
      fullExtension[extensionStart]!.time <
        start.time - Number.EPSILON)
    extensionStart++;
  let poseCount = 0;
  for (let index = extensionStart;
    index < fullExtension.length;
    index++) {
    const station = fullExtension[index]!;
    const rival = writeRacecraftClaimStateAtTime(
      session.trk,
      hazard.claim,
      station.time,
      offHorizonRivalStateScratch
    );
    writeSweptPose(
      poseCount++,
      station.time,
      writeWorldBodyPose(
        session.trk,
        station.s,
        station.lateral,
        station.headingOffsetRadians,
        egoWorldPoseScratch
      ),
      writeWorldBodyPose(
        session.trk,
        rival.s,
        rival.lateral,
        rival.headingOffsetRadians,
        rivalWorldPoseScratch
      )
    );
  }
  sweptPoseScratch.length = poseCount;
  const episodes = sweptCarContactEpisodes(sweptPoseScratch);
  const first = episodes[0];
  if (!first ||
      first.startTimeSeconds <= start.time + Number.EPSILON)
    return null;
  let maximumRelativeNormalSpeed = first.maximumRelativeNormalSpeed;
  for (let index = 1; index < episodes.length; index++)
    maximumRelativeNormalSpeed = Math.max(
      maximumRelativeNormalSpeed,
      episodes[index]!.maximumRelativeNormalSpeed
    );
  const ego = programStationAtTime(
    session.trk,
    fullExtension,
    first.startTimeSeconds
  );
  return {
    time: first.startTimeSeconds,
    egoProgress: ego.progress,
    egoSpeed: ego.speed,
    maximumRelativeNormalSpeed,
    episodes
  };
}

function mayCreateOffHorizonContest(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard
): boolean {
  const plan = program.evaluation.plan;
  if (plan.mode === 'ideal' || plan.mode === 'pit' ||
      (plan.mode !== 'side-inside' && plan.mode !== 'side-outside'))
    return false;
  const horizon = program.stations.at(-1)!;
  const terminal = plan.anchors
    .map(anchor => anchor.s)
    .filter((value): value is number =>
      value != null && value > horizon.progress + Number.EPSILON)
    .at(-1);
  if (terminal == null) return false;
  const rival = racecraftClaimStateAtTime(
    session.trk,
    hazard.claim,
    horizon.time
  );
  const rivalAhead = signedTrackDistance(
    session.trk,
    horizon.s,
    rival.s
  );
  const remainingProgress = terminal - horizon.progress;
  return rivalAhead <=
    remainingProgress + Math.sqrt(
      PHYS.carLen * PHYS.carLen + PHYS.carWid * PHYS.carWid
    );
}

function programHazardClearance(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard,
  points: readonly RelativePointStation[]
): {
  clearanceMetres: number;
} {
  let relativeLongitudinal = signedTrackDistance(
    session.trk,
    program.stations[0]!.s,
    hazard.originS
  );
  let relativeLateral =
    hazard.originLateral - program.stations[0]!.lateral;
  let previousEgoHeading =
    program.stations[0]!.headingOffsetRadians;
  let previousOtherHeading =
    hazard.originHeadingOffsetRadians;
  let minimumClearance = Infinity;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const egoHeading = normAng(
      previousEgoHeading +
      normAng(
        point.egoHeadingOffsetRadians -
        previousEgoHeading
      ) / 2
    );
    const rivalHeading = normAng(
      previousOtherHeading +
      normAng(
        point.rivalHeadingOffsetRadians -
        previousOtherHeading
      ) / 2
    );
    const clearance = sweptCarMinimumClearance(
      relativeLongitudinal,
      relativeLateral,
      point.longitudinalMetres,
      point.lateralMetres,
      egoHeading,
      rivalHeading
    );
    if (clearance.clearanceMetres < minimumClearance) {
      minimumClearance = clearance.clearanceMetres;
    }
    relativeLongitudinal = point.longitudinalMetres;
    relativeLateral = point.lateralMetres;
    previousEgoHeading = point.egoHeadingOffsetRadians;
    previousOtherHeading = point.rivalHeadingOffsetRadians;
  }
  return {
    clearanceMetres: minimumClearance
  };
}

function nearRubHazardLossSeconds(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard,
  samples: MutableNearRubTrajectorySample[]
): number {
  samples.length = program.stations.length;
  for (let index = 0; index < program.stations.length; index++) {
    const ego = program.stations[index]!;
    const rival = racecraftClaimStateAtTime(
      session.trk,
      hazard.claim,
      ego.time
    );
    const sample = samples[index] ?? (samples[index] = {
      timeSeconds: 0,
      longitudinalCentreDistanceMetres: 0,
      lateralCentreDistanceMetres: 0,
      egoHeadingOffsetRadians: 0,
      rivalHeadingOffsetRadians: 0
    });
    sample.timeSeconds = ego.time;
    sample.longitudinalCentreDistanceMetres = signedTrackDistance(
      session.trk,
      ego.s,
      rival.s
    );
    sample.lateralCentreDistanceMetres = rival.lateral - ego.lateral;
    sample.egoHeadingOffsetRadians = ego.headingOffsetRadians;
    sample.rivalHeadingOffsetRadians = rival.headingOffsetRadians;
  }
  return plannedNearRubExposureCost(
    samples,
    racecraftCalibration().nearRubClearanceMetres,
    program.defensiveLegality?.legal &&
      program.defensiveLegality.targetCode === hazard.other.code &&
      program.defensiveLegality.approachConflictAuthorized &&
      program.defensiveLegality.noticeDeadlineSessionTimeSeconds != null &&
      program.defensiveLegality.turnInSessionTimeSeconds != null
      ? [{
          startTimeSeconds:
            program.defensiveLegality
              .noticeDeadlineSessionTimeSeconds - session.t,
          endTimeSeconds:
            program.defensiveLegality
              .turnInSessionTimeSeconds - session.t
        }]
      : []
  ).lossSeconds;
}

function damagingContact(contact: SweptContact | null): boolean {
  return contact != null &&
    isHardContactImpulse(contact.maximumRelativeNormalSpeed);
}

/**
 * Hard viability is one decision interval deep. The only prediction margin
 * is the derived physical displacement possible before re-observation.
 */
function violatesOneIntervalViability(
  session: Session,
  program: CandidateProgram,
  hazards: readonly Hazard[]
): boolean {
  if (!hazards.length) return false;
  const screened: Array<{
    hazard: Hazard;
    physicalBound: number;
    points: RelativePointStation[];
  }> = [];
  for (const hazard of hazards) {
    const physicalBound = oneIntervalPhysicalDivergence(
      session,
      hazard.other
    );
    const points = boundedRelativeStations(
      session,
      program,
      hazard,
      physicalBound
    );
    if (points) screened.push({ hazard, physicalBound, points });
  }
  if (!screened.length) return false;
  const work = evaluatorWork(session);
  work.viabilityCalls++;
  work.viabilityHazards += screened.length;
  const nextDecision = RACECRAFT_DECISION_INTERVAL_SECONDS;
  for (const { hazard, physicalBound, points } of screened) {
    const contact = firstSweptContact(
      session,
      program,
      hazard,
      points,
      physicalBound
    );
    if (damagingContact(contact) &&
        contact!.time <= nextDecision)
      return true;
  }
  return false;
}

function arrivalTimeOnProgram(
  stations: readonly ProgramStation[],
  targetProgress: number
): number {
  for (let index = 1; index < stations.length; index++) {
    const to = stations[index]!;
    if (to.progress < targetProgress) continue;
    const from = stations[index - 1]!;
    const u = (targetProgress - from.progress) /
      Math.max(Number.EPSILON, to.progress - from.progress);
    return from.time + (to.time - from.time) * clamp(u, 0, 1);
  }
  const last = stations.at(-1)!;
  return last.time + Math.max(0, targetProgress - last.progress) /
    Math.max(Number.EPSILON, last.speed);
}

function trajectoryFromCandidate(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  targetProgress: number
): RacecraftTrajectory {
  const candidate = candidateTimedTrajectory(
    session,
    entry,
    program,
    targetProgress
  );
  return {
    ...candidate.timed,
    fromSessionTimeSeconds: session.t,
    toSessionTimeSeconds:
      candidate.evaluateUntilSessionTimeSeconds
  };
}

function trajectoryRemainsOnNormalSurface(
  session: Session,
  trajectory: RacecraftTrajectory
): boolean {
  const times = [
    trajectory.fromSessionTimeSeconds,
    trajectory.toSessionTimeSeconds
  ];
  for (let index = 0;
    index < trajectory.trajectory.segmentCount;
    index++) {
    const time =
      trajectory.authoredAtSessionTimeSeconds +
      trajectory.trajectory.segmentEndTime[index]! -
      trajectory.trajectoryTimeOffsetSeconds;
    if (time > trajectory.fromSessionTimeSeconds &&
        time < trajectory.toSessionTimeSeconds)
      times.push(time);
  }
  for (const time of times) {
    const point = continuousTrajectoryStateAtTime(
      session.trk,
      trajectory,
      time
    );
    const index = cyclicIndex(
      session.trk,
      Math.round(point.s / session.trk.step)
    );
    const envelope = normalLateralEnvelope(session.trk, index);
    if (point.lateral <
          envelope.minimum - Number.EPSILON ||
        point.lateral >
          envelope.maximum + Number.EPSILON)
      return false;
  }
  return true;
}

function cornerExitProgress(
  session: Session,
  entry: ActiveEntry,
  corner: LegacyCorner
): number {
  return entry.prog + distanceAhead(
    session.trk,
    cyclicIndex(session.trk, entry.car.progIdx),
    corner.exitI
  );
}

function timedTrajectoryFromPublication(
  claim: RacecraftClaim
): RacecraftTimedTrajectoryProgram {
  return {
    ownerCode: claim.code,
    publicationRevision: claim.publicationRevision,
    authoredAtSessionTimeSeconds: claim.publishedAt,
    trajectoryTimeOffsetSeconds: claim.trajectoryTimeOffsetSeconds,
    trajectory: claim.trajectory
  };
}

let candidateTrajectoryConstructionScratch:
  RacecraftTrajectoryProgram | null = null;

function candidateTrajectoryConstructionProgram(
  capacity: number,
  originProgress: number,
  originTrackS: number,
  lateralProgram: RacecraftTrajectoryProgram['lateralProgram']
): RacecraftTrajectoryProgram {
  const scratch = candidateTrajectoryConstructionScratch;
  if (!scratch || scratch.segmentCount !== capacity) {
    candidateTrajectoryConstructionScratch =
      createRacecraftTrajectoryProgram(
        capacity,
        originProgress,
        originTrackS,
        lateralProgram
      );
    return candidateTrajectoryConstructionScratch;
  }
  candidateTrajectoryConstructionScratch = {
    ...scratch,
    originProgress,
    originTrackS,
    lateralProgram
  };
  return candidateTrajectoryConstructionScratch;
}

function candidateTimedTrajectory(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  targetProgress: number
): {
  timed: RacecraftTimedTrajectoryProgram;
  evaluateUntilSessionTimeSeconds: number;
} {
  const extended = programExtendedToProgress(
    session,
    entry,
    program,
    targetProgress
  );
  const stations = extended.stations;
  // Candidate construction is consumed synchronously. Any selected defensive
  // envelope is cloned by the legality author before this scratch is reused.
  const trajectory = candidateTrajectoryConstructionProgram(
    Math.max(0, stations.length - 1),
    stations[0]!.progress,
    stations[0]!.s,
    program.evaluation.plan.mode === 'pit'
      ? null
      : compileCompactLateralProgram(
          session.trk,
          program.evaluation.plan
        )
  );
  for (let index = 1; index < stations.length; index++) {
    const from = stations[index - 1]!;
    const to = stations[index]!;
    writeRacecraftTrajectorySegment(trajectory, index - 1, {
      startTimeSeconds: from.time,
      endTimeSeconds: to.time,
      startProgressMetres: from.progress,
      endProgressMetres: to.progress,
      startSpeedMetresPerSecond: from.speed,
      endSpeedMetresPerSecond: to.speed,
      startLateralMetres: from.lateral,
      endLateralMetres: to.lateral,
      startHeadingOffsetRadians: from.headingOffsetRadians,
      endHeadingOffsetRadians: to.headingOffsetRadians
    });
  }
  const publicationRevision = Math.max(
    entry._racecraftLastPublicationRevision ?? -1,
    session.racecraftClaims?.get(entry.code)
      ?.publicationRevision ?? -1
  ) + 1;
  return {
    timed: {
      ownerCode: entry.code,
      publicationRevision,
      authoredAtSessionTimeSeconds: session.t,
      trajectoryTimeOffsetSeconds: 0,
      trajectory
    },
    evaluateUntilSessionTimeSeconds:
      session.t + stations.at(-1)!.time
  };
}

function defendedCorner(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  attacker: ReturnType<typeof activeDefensiveAttacker>
): LegacyCorner | null {
  const existing = entry.racecraftDefensiveCommitment ??
    session.racecraftClaims?.get(entry.code)?.defensiveCommitment ??
    null;
  if (racecraftDefensiveCommitmentIsActive(existing, entry.prog)) {
    const committed = session.trk.corners.find(corner =>
      corner.id === existing.cornerId);
    if (committed) return committed;
  }
  const plan = program.evaluation.plan;
  const cornerId = attacker?.claim.cornerId ??
    (plan.mode !== 'ideal' && plan.mode !== 'pit'
      ? plan.cornerId ?? null
      : null);
  const authored = cornerId == null
    ? null
    : session.trk.corners.find(corner => corner.id === cornerId) ??
      null;
  return authored ??
    cornerAtApproach(
      session.trk,
      cyclicIndex(session.trk, entry.car.progIdx)
    ) ??
    nextCorner(session.trk, entry.car.progIdx);
}

function applyDefensiveLegality(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  programs: readonly CandidateProgram[],
  actionableOwnershipViews: readonly ActionableOwnershipAssertion[]
): ReturnType<typeof activeDefensiveAttacker> {
  const attacker = activeDefensiveAttacker(
    session,
    entry,
    entries,
    actionableOwnershipViews
  );
  if (!attacker) return null;
  const previousPublication =
    session.racecraftClaims?.get(entry.code);
  const previousDefenderTrajectory = previousPublication
    ? timedTrajectoryFromPublication(previousPublication)
    : null;
  const attackerTrajectory =
    timedTrajectoryFromPublication(attacker.claim);
  const attackerAlreadyAlongside =
    racecraftMeasuredLegalAlongside(
      session,
      entry,
      attacker.entry,
      attacker.side
    );
  const existingCommitment =
    entry.racecraftDefensiveCommitment ??
    previousPublication?.defensiveCommitment ??
    null;
  for (const program of programs) {
    if (!program.evaluation.feasible) continue;
    const corner = defendedCorner(
      session,
      entry,
      program,
      attacker
    );
    if (!corner) continue;
    const exitProgress = cornerExitProgress(
      session,
      entry,
      corner
    );
    const turnInProgress = entry.prog + distanceAhead(
      session.trk,
      cyclicIndex(session.trk, entry.car.progIdx),
      corner.turnInI
    );
    const candidate = candidateTimedTrajectory(
      session,
      entry,
      program,
      turnInProgress
    );
    const ownershipProtectsRoom =
      actionableOwnershipViews.some(view =>
        view.assertion.attackerCode === attacker.entry.code &&
        view.assertion.targetCode === entry.code &&
        view.assertion.cornerId === corner.id &&
        view.assertion.side === attacker.side &&
        (
          view.assertion.authoredOutcome === 'attacker-owned' ||
          view.assertion.authoredOutcome === 'shared'
        ));
    const plan = program.evaluation.plan;
    const result = evaluateRacecraftDefensiveLegality({
      session,
      defender: entry,
      attacker: attacker.entry,
      attackerPublicationRevision:
        attacker.claim.publicationRevision,
      coveredSide: attacker.side,
      corner,
      cornerExitProgressMetres: exitProgress,
      previousDefenderTrajectory,
      candidateDefenderTrajectory: candidate.timed,
      attackerTrajectory,
      candidateLongitudinalProgram: {
        envelope: program.speedLaw.envelope,
        brakingEffort: program.speedLaw.brakingEffort,
        slowPointOwnerCode:
          program.speedLaw.longitudinalOwnerCode,
        bindingSlowPoint: program.speedLaw.slowPoint
      },
      evaluateUntilSessionTimeSeconds:
        candidate.evaluateUntilSessionTimeSeconds,
      existingCommitment,
      attackerAlreadyAlongside,
      ownershipProtectsRoom,
      safetyOnly:
        plan.mode !== 'ideal' &&
        plan.mode !== 'pit' &&
        plan.surfaceAuthorization === 'emergency'
    });
    program.defensiveLegality = result;
    if (result.legal) continue;
    const reason = result.rejectionReason ??
      'timing-unproved';
    const veto = `defensive-${reason}`;
    if (!program.evaluation.vetoes.includes(veto))
      program.evaluation.vetoes.push(veto);
    program.evaluation.feasible = false;
    recordRacecraftDefensiveCandidateRejection(
      session,
      reason
    );
  }
  return attacker;
}

function ownershipAllowsNominalContact(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  hazard: Hazard,
  allowOutgoingAssertion = true
): boolean {
  const plan = program.evaluation.plan;
  if (plan.mode === 'ideal' || plan.mode === 'pit' ||
      (plan.mode !== 'side-inside' &&
        plan.mode !== 'side-outside') ||
      plan.surfaceAuthorization === 'emergency')
    return false;

  const outgoingAttack =
    plan.leaderCode === hazard.other.code &&
    plan.cornerId != null;
  if (outgoingAttack) {
    if (!allowOutgoingAssertion) return false;
    const corner = session.trk.corners.find(value =>
      value.id === plan.cornerId);
    if (!corner || !hazard.claim.trusted) return false;
    const exitProgress = cornerExitProgress(session, entry, corner);
    const authoredEnd = plan.anchors
      .map(anchor => anchor.s)
      .filter((value): value is number => value != null)
      .at(-1);
    if (authoredEnd == null ||
        authoredEnd + Number.EPSILON < exitProgress)
      return false;
    const attackerTrajectory = trajectoryFromCandidate(
      session,
      entry,
      program,
      exitProgress
    );
    if (!trajectoryRemainsOnNormalSurface(
      session,
      attackerTrajectory
    )) return false;
    const leaderTrajectory = trajectoryFromPublication(
      session,
      hazard.claim
    );
    const terminal = continuousTrajectoryStateAtTime(
      session.trk,
      attackerTrajectory,
      attackerTrajectory.toSessionTimeSeconds
    );
    const leaderOrigin = continuousTrajectoryStateAtTime(
      session.trk,
      leaderTrajectory,
      leaderTrajectory.fromSessionTimeSeconds
    );
    const side: -1 | 1 =
      terminal.lateral < leaderOrigin.lateral ? -1 : 1;
    const assertion = authorCornerOwnershipAssertion({
      session,
      corner,
      attackerCode: entry.code,
      targetCode: hazard.other.code,
      attackerTrajectory,
      leaderTrajectory,
      attackerPublicationRevision:
        attackerTrajectory.publicationRevision,
      sourceLeaderPublicationRevision:
        hazard.claim.publicationRevision,
      selectedPlanNumericId: program.evaluation.planNumericId,
      selectedFamilyNumericId: program.evaluation.familyNumericId,
      side
    });
    if (!assertion) return false;
    program.ownershipAssertion = assertion;
    return true;
  }

  const attackerAssertion = hazard.claim.ownershipAssertion;
  const currentLeaderPublication =
    session.racecraftClaims?.get(entry.code);
  if (!attackerAssertion ||
      !program.actionableOwnershipViews.some(view =>
        view.assertion === attackerAssertion) ||
      attackerAssertion.targetCode !== entry.code ||
      attackerAssertion.attackerCode !== hazard.other.code ||
      attackerAssertion.attackerPublicationRevision !==
        hazard.claim.publicationRevision ||
      currentLeaderPublication?.publicationRevision !==
        attackerAssertion.sourceLeaderPublicationRevision)
    return false;
  const corner = session.trk.corners.find(value =>
    value.id === attackerAssertion.cornerId);
  if (!corner) return false;
  const exitProgress = cornerExitProgress(session, entry, corner);
  const leaderTrajectory = trajectoryFromCandidate(
    session,
    entry,
    program,
    exitProgress
  );
  if (!trajectoryRemainsOnNormalSurface(session, leaderTrajectory))
    return false;
  const attackerTrajectory = trajectoryFromPublication(
    session,
    hazard.claim
  );
  const resolution = classifyCornerOwnership(
    session.trk,
    corner,
    leaderTrajectory,
    attackerTrajectory
  );
  if (resolution.outcome !== 'attacker-owned') return false;
  if (!racecraftDefensiveLegalityAuthorizesReclaim(
    program.defensiveLegality
  )) return false;
  program.defenderReclaim = true;
  return true;
}

function nominalContactEpisodesAreAuthorized(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  hazard: Hazard,
  contact: SweptContact
): boolean {
  const defense = program.defensiveLegality;
  const matchingDefense = defense?.legal &&
    defense.targetCode === hazard.other.code &&
    (
      defense.classification === 'new-move' ||
      defense.classification === 'continuation'
    );
  if (matchingDefense && defense.roomProtected) return false;
  const cornerAuthorityNeeded = contact.episodes.some(episode =>
    matchingDefense &&
    defense.turnInSessionTimeSeconds != null &&
    session.t + episode.endTimeSeconds >=
      defense.turnInSessionTimeSeconds - Number.EPSILON);
  const ownershipAllowed =
    (!matchingDefense || cornerAuthorityNeeded) &&
    ownershipAllowsNominalContact(
      session,
      entry,
      program,
      hazard,
      racecraftCandidateMayAuthorCornerOwnership(
        defense
      )
    );
  return contact.episodes.every(episode => {
    const absolute = {
      startTimeSeconds:
        session.t + episode.startTimeSeconds,
      endTimeSeconds:
        session.t + episode.endTimeSeconds
    };
    const approachAllowed =
      defensiveContactEpisodeIsAuthorized(
        defense,
        hazard.other.code,
        absolute
      );
    if (approachAllowed) return true;
    if (!ownershipAllowed) return false;
    if (!matchingDefense) return true;
    const deadline =
      defense.noticeDeadlineSessionTimeSeconds;
    const turnIn = defense.turnInSessionTimeSeconds;
    return deadline != null &&
      turnIn != null &&
      absolute.startTimeSeconds >=
        deadline - Number.EPSILON &&
      absolute.endTimeSeconds >=
        turnIn - Number.EPSILON;
  });
}

function programCarriesUtilizationRisk(program: CandidateProgram): boolean {
  const plan = program.evaluation.plan;
  return plan.mode === 'side-inside' ||
    plan.mode === 'side-outside' ||
    (plan.mode !== 'ideal' && plan.mode !== 'pit' &&
      plan.surfaceAuthorization === 'emergency');
}

function evaluateHazard(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  hazard: Hazard,
  boundedStations?: readonly RelativePointStation[] | null
): HazardCost {
  const stations = boundedStations === undefined
    ? boundedRelativeStations(
        session,
        program,
        hazard
      )
    : boundedStations;
  const contact = (stations
    ? firstSweptContact(
        session,
        program,
        hazard,
        stations,
        0
      )
    : null) ??
    offHorizonAttackContact(
      session,
      entry,
      program,
      hazard
    );
  if (!contact)
    return {
      seconds: 0,
      billSeconds: 0
    };
  if (contact.time >
        MANEUVER_PREDICTION.horizonSeconds + Number.EPSILON) {
    session.racecraftOffHorizonContests =
      (session.racecraftOffHorizonContests ?? 0) + 1;
    session.racecraftOffHorizonMaximumContactTimeSeconds = Math.max(
      session.racecraftOffHorizonMaximumContactTimeSeconds ?? 0,
      contact.time
    );
  }
  const hardContact = damagingContact(contact);
  if (!hardContact &&
      nominalContactEpisodesAreAuthorized(
        session,
        entry,
        program,
        hazard,
        contact
      ))
    return {
      seconds: 0,
      billSeconds: 0
    };
  const veto = hardContact
    ? 'predicted-hard-contact'
    : 'predicted-nominal-contact';
  const newlyRejected = !program.evaluation.vetoes.includes(veto);
  if (newlyRejected)
    program.evaluation.vetoes.push(veto);
  if (hardContact && newlyRejected &&
      program.defensiveLegality != null &&
      (
        program.defensiveLegality.classification === 'new-move' ||
        program.defensiveLegality.classification === 'continuation'
      ))
    recordRacecraftDefensiveCandidateRejection(
      session,
      'hard-safety'
    );
  program.evaluation.feasible = false;
  return {
    seconds: Infinity,
    billSeconds: 0
  };
}

function utilizationRisk(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  fromSeconds = 0,
  toSeconds = MANEUVER_PREDICTION.horizonSeconds
): number {
  const exposureAt = (time: number): number => {
    const samples = program.utilizationExposure;
    if (!samples.length || time <= samples[0]!.time)
      return samples[0]?.cumulativeSeconds ?? 0;
    for (let index = 1; index < samples.length; index++) {
      const to = samples[index]!;
      if (time > to.time) continue;
      const from = samples[index - 1]!;
      const u = (time - from.time) /
        Math.max(Number.EPSILON, to.time - from.time);
      return from.cumulativeSeconds +
        (to.cumulativeSeconds - from.cumulativeSeconds) *
          clamp(u, 0, 1);
    }
    return samples.at(-1)!.cumulativeSeconds;
  };
  const exposureSeconds = Math.max(
    0,
    exposureAt(toSeconds) - exposureAt(fromSeconds)
  );
  const probability = utilizationMistakeProbability(
    1,
    entry.focusNow,
    session.wet,
    exposureSeconds
  );
  if (probability <= Number.EPSILON) return 0;
  const margin = evaluatorDynamics(session, entry).margin;
  const liftedMargin = Math.max(
    Number.EPSILON,
    margin - LIFT_MARGIN_PENALTY
  );
  const consequence = UTILIZATION_MISTAKE_LIFT_SECONDS *
    Math.max(0, margin / liftedMargin - 1);
  return probability * consequence;
}

function programEffortRiskSeconds(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram
): number {
  if (!program.effortRiskComputed) {
    program.evaluation.effortRiskSeconds =
      programCarriesUtilizationRisk(program)
        ? utilizationRisk(
            session,
            entry,
            program,
            0,
            program.utilizationExposure.at(-1)?.time ??
              MANEUVER_PREDICTION.horizonSeconds
          )
        : 0;
    program.effortRiskComputed = true;
  }
  return program.evaluation.effortRiskSeconds;
}

function scorePrograms(
  session: Session,
  entry: ActiveEntry,
  programs: CandidateProgram[],
  hazards: readonly Hazard[]
): void {
  let scratch = scoreProgramsScratchBySession.get(session);
  if (!scratch) {
    scratch = {
      hazards: [],
      stations: [],
      clearances: [],
      nearRubSamples: []
    };
    scoreProgramsScratchBySession.set(session, scratch);
  }
  const boundedHazards = scratch.hazards;
  const boundedStations = scratch.stations;
  const boundedClearances = scratch.clearances;
  for (const program of programs) {
    if (program.fullyScored || program.branchBounded) continue;
    program.fullyScored = true;
    const evaluation = program.evaluation;
    if (!evaluation.feasible) continue;
    // Corollary 9 keeps solitary ideal at J=0. P-BE makes utilization an
    // authored property of side/capability and emergency members; it prices
    // their measured mistake exposure without becoming a proximity term.
    const surfaceRisk = programEffortRiskSeconds(
      session,
      entry,
      program
    );
    boundedHazards.length = 0;
    boundedStations.length = 0;
    boundedClearances.length = 0;
    for (const hazard of hazards) {
      const stations = boundProgramHazard(
        session,
        program,
        hazard
      );
      if (stations ||
          mayCreateOffHorizonContest(session, program, hazard)) {
        const clearance = stations
          ? programHazardClearance(
              session,
              program,
              hazard,
              stations
            )
          : null;
        if (clearance &&
            (evaluation.minimumPlannedClearanceMetres == null ||
              clearance.clearanceMetres <
                evaluation.minimumPlannedClearanceMetres))
          evaluation.minimumPlannedClearanceMetres =
            clearance.clearanceMetres;
        boundedHazards.push(hazard);
        boundedStations.push(stations);
        boundedClearances.push(clearance);
      }
    }
    if (violatesOneIntervalViability(
      session,
      program,
      hazards
    )) {
      const newlyRejected =
        !evaluation.vetoes.includes('predicted-hard-contact');
      if (newlyRejected)
        evaluation.vetoes.push('predicted-hard-contact');
      if (newlyRejected &&
          program.defensiveLegality != null &&
          (
            program.defensiveLegality.classification === 'new-move' ||
            program.defensiveLegality.classification === 'continuation'
          ))
        recordRacecraftDefensiveCandidateRejection(
          session,
          'hard-safety'
        );
      evaluation.feasible = false;
      continue;
    }
    let hazardCost = 0;
    for (let boundedIndex = 0;
      boundedIndex < boundedHazards.length;
      boundedIndex++) {
      const hazard = boundedHazards[boundedIndex]!;
      const stations = boundedStations[boundedIndex]!;
      const clearance = boundedClearances[boundedIndex]!;
      const cost = evaluateHazard(
        session,
        entry,
        program,
        hazard,
        stations
      );
      if (stations)
        evaluation.proximitySeconds += nearRubHazardLossSeconds(
          session,
          program,
          hazard,
          scratch.nearRubSamples
        );
      if (cost.seconds !== 0)
        evaluation.hazardCount++;
      evaluation.billSeconds += cost.billSeconds;
      hazardCost += cost.seconds;
      if (!evaluation.feasible) break;
    }
    if (!evaluation.feasible) {
      evaluation.cost = Infinity;
      continue;
    }
    evaluation.cost =
      evaluation.ownTimeSeconds + surfaceRisk + hazardCost;
  }
}

function applyProgramBattleEconomics(
  program: CandidateProgram,
  contexts: readonly BattleEconomicsContext[]
): void {
  const evaluation = program.evaluation;
  if (!evaluation.feasible || !Number.isFinite(evaluation.cost)) return;
  let activeContextCount = 0;
  let continuingBattle = false;
  let positionValue = 0;
  for (const context of contexts) {
    if (battleProgram(program, context)) {
      activeContextCount++;
      if (context.state.activeBattleFamilyNumericId ===
          evaluation.familyNumericId)
        continuingBattle = true;
    } else {
      positionValue += context.positionValueSeconds;
    }
  }
  evaluation.positionValueSeconds = positionValue;
  evaluation.attemptLossSeconds =
    activeContextCount > 0 && !continuingBattle
      ? measuredAttackTransitionLossSeconds()
      : 0;
  evaluation.battleSpendSeconds = activeContextCount > 0
    ? battleSpendSeconds({
        measuredAttemptLossSeconds: evaluation.attemptLossSeconds,
        measuredProximitySeconds: evaluation.proximitySeconds
      })
    : 0;
  evaluation.cost = directionalCandidateObjectiveSeconds({
    physicalSeconds: evaluation.cost,
    positionValueSeconds: evaluation.positionValueSeconds,
    attemptLossSeconds: evaluation.attemptLossSeconds,
    nearRubLossSeconds: evaluation.proximitySeconds
  });
}

function candidateObjectiveLowerBound(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  contexts: readonly BattleEconomicsContext[]
): number {
  const evaluation = program.evaluation;
  evaluation.cost = evaluation.ownTimeSeconds +
    programEffortRiskSeconds(session, entry, program);
  applyProgramBattleEconomics(program, contexts);
  return evaluation.cost;
}

function incumbentProgram(
  entry: Entry,
  programs: readonly CandidateProgram[]
): CandidateProgram | null {
  const priorDecision = entry.racecraftDecision;
  const selectedFamilyNumericId = priorDecision?.candidates.find(candidate =>
    candidate.planNumericId === priorDecision.selectedPlanNumericId)
    ?.familyNumericId;
  return programs.find(program =>
    selectedFamilyNumericId != null &&
    program.evaluation.familyNumericId === selectedFamilyNumericId) ??
    programs[0] ??
    null;
}

function tieBand(
  candidate: CandidateProgram,
  incumbent: CandidateProgram
): number {
  const base = {
    incumbentSeconds: incumbent.evaluation.cost,
    candidateSeconds: candidate.evaluation.cost
  };
  return pairwiseDifferenceTieBand(base, []);
}

function appendDecisionLog(
  session: Session,
  entry: Entry,
  decision: RacecraftDecision
): void {
  if (!session.racecraftDecisionLogging ||
      session.t - (entry._racecraftLoggedAt ?? -Infinity) <
        RACECRAFT_DECISION_INTERVAL_SECONDS) return;
  entry._racecraftLoggedAt = session.t;
  const record: RacecraftDecisionLogEntry = {
    at: session.t,
    code: entry.code,
    laneProgramReason: entry.laneProgram.reason,
    laneProgramBinding: entry.laneProgram.binding,
    selectedKind: decision.selectedKind,
    selectedPlanNumericId: decision.selectedPlanNumericId,
    selectedPlanKey: decision.selectedPlanKey,
    economics: decision.economics.map(value => ({ ...value })),
    candidates: decision.candidates.map(candidate => ({
      kind: candidate.kind,
      planNumericId: candidate.planNumericId,
      familyNumericId: candidate.familyNumericId,
      planKey: candidate.plan.key,
      stableFamilyId: racecraftStableFamilyId(
        candidate.kind,
        candidate.plan,
        candidate.slowPointOwnerCode
      ),
      feasible: candidate.feasible,
      vetoes: [...candidate.vetoes],
      direction: candidate.direction,
      speedClass: candidate.speedClass,
      ownTimeSeconds: candidate.ownTimeSeconds,
      billSeconds: candidate.billSeconds,
      proximitySeconds: candidate.proximitySeconds,
      positionValueSeconds: candidate.positionValueSeconds,
      attemptLossSeconds: candidate.attemptLossSeconds,
      battleSpendSeconds: candidate.battleSpendSeconds,
      effortRiskSeconds: candidate.effortRiskSeconds,
      positionGain: candidate.positionGain,
      minimumPlannedClearanceMetres:
        candidate.minimumPlannedClearanceMetres,
      tieBandSeconds: candidate.tieBandSeconds,
      hazardCount: candidate.hazardCount,
      switchChanged: candidate.switchChanged,
      cost: candidate.cost
    }))
  };
  const log = session.racecraftDecisionLog ?? (session.racecraftDecisionLog = []);
  if (log.length < DECISION_LOG_LIMIT) log.push(record);
  else {
    const cursor = session.racecraftDecisionLogCursor ?? 0;
    log[cursor] = record;
    session.racecraftDecisionLogCursor = (cursor + 1) % DECISION_LOG_LIMIT;
    session.racecraftDecisionLogDropped =
      (session.racecraftDecisionLogDropped ?? 0) + 1;
  }
}

function accumulateSelectedJ(
  session: Session,
  entry: Entry,
  selected: RacecraftCandidateEvaluation | null
): void {
  if (session.racecraftDecisionLogging ||
      session.t - (entry._racecraftLoggedAt ?? -Infinity) <
        RACECRAFT_DECISION_INTERVAL_SECONDS) return;
  entry._racecraftLoggedAt = session.t;
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
  ].every(Number.isFinite)) return;
  const value = session.racecraftSelectedJAccumulator ??
    (session.racecraftSelectedJAccumulator = {
      samples: 0,
      ownTimeSeconds: 0,
      billSeconds: 0,
      proximitySeconds: 0,
      positionValueSeconds: 0,
      attemptLossSeconds: 0,
      battleSpendSeconds: 0,
      effortRiskSeconds: 0,
      tieBandSeconds: 0,
      totalSeconds: 0,
      hazardCount: 0
    });
  value.samples++;
  value.ownTimeSeconds += selected.ownTimeSeconds;
  value.billSeconds += selected.billSeconds;
  value.proximitySeconds += selected.proximitySeconds;
  value.positionValueSeconds += selected.positionValueSeconds;
  value.attemptLossSeconds += selected.attemptLossSeconds;
  value.battleSpendSeconds += selected.battleSpendSeconds;
  value.effortRiskSeconds += selected.effortRiskSeconds;
  value.tieBandSeconds += selected.tieBandSeconds;
  value.totalSeconds += selected.cost;
  value.hazardCount += selected.hazardCount;
}

export function orderedRacecraftDecisionLog(
  session: Session
): readonly RacecraftDecisionLogEntry[] {
  const log = session.racecraftDecisionLog ?? [];
  const cursor = session.racecraftDecisionLogCursor ?? 0;
  return cursor === 0 ? log : [...log.slice(cursor), ...log.slice(0, cursor)];
}

interface RacecraftProgramSelection {
  active: ActiveEntry;
  evaluationClaims: EvaluationClaimMap;
  programs: CandidateProgram[];
  hazards: Hazard[];
  best: CandidateProgram | null;
  previousKind: RacecraftCandidateKind | null;
  zeroHazardIdeal: boolean;
  economics: BattleEconomicsContext[];
}

function selectRacecraftProgram(
  session: Session,
  entry: Entry,
  entries: readonly Entry[],
  actionableOwnershipViews: readonly ActionableOwnershipAssertion[]
): RacecraftProgramSelection | null {
  if (!entry.car || entry.state !== 'run' || entry.pathPlan?.mode === 'pit')
    return null;
  const active = entry as ActiveEntry;
  const evaluationClaims = evaluationClaimsAt(session, entries);
  const previousKind = entry.racecraftDecision?.selectedKind ?? null;
  let hasInteractionNeighbor = false;
  for (const other of entries)
    if (racecraftIsInteractionNeighbor(session, active, other)) {
      hasInteractionNeighbor = true;
      break;
    }
  if (!hasInteractionNeighbor &&
      racecraftLateralAuthoritySettledOnIdeal(session, active)) {
    reconcileBattleOpportunityObservations(session, active, []);
    return {
      active,
      evaluationClaims,
      programs: [],
      hazards: [],
      best: null,
      previousKind,
      zeroHazardIdeal: true,
      economics: []
    };
  }
  const hazards = hazardsFor(session, active, entries, evaluationClaims);
  const seedEvaluationsBefore = evaluatorWork(session).seedEvaluations;
  const seeds = buildCandidateSeeds(
    session,
    active,
    entries,
    evaluationClaims,
    false
  );
  const workspace = prepareCandidateEvaluationWorkspace(active);
  bindCandidateTowWorkspace(evaluationClaims, workspace);
  retainedCandidateSpatialPlanByEntry.set(active, seeds[0]!.plan);
  const programs = new Array<CandidateProgram>(seeds.length);
  for (let index = 0; index < seeds.length; index++)
    programs[index] = evaluateSeed(
      session,
      active,
      entries,
      seeds[index]!,
      previousKind,
      evaluationClaims,
      actionableOwnershipViews,
      workspace
    );
  const leader = activeLeader(session, active, entries);
  let hold: CandidateProgram | undefined;
  for (const program of programs)
    if (program.evaluation.kind === 'hold') {
      hold = program;
      break;
  }
  if (leader && hold && programs.length < MAX_RACECRAFT_CANDIDATES) {
    const brakeSeed = brakeBehindSeed(
      session,
      active,
      leader.entry,
      hold.evaluation.plan
    );
    const brakeSpeedLaw = composeCandidateSpeedLaw(
      session,
      active,
      brakeSeed.plan,
      brakeSeed.slowPointOwnerCode,
      entries,
      evaluationClaims,
      undefined,
      workspace
    );
    if (speedLawAddsConstraint(hold.speedLaw, brakeSpeedLaw)) {
      evaluatorWork(session).candidateSeedsBuilt++;
      programs.push(evaluateSeed(
        session,
        active,
        entries,
        brakeSeed,
        previousKind,
        evaluationClaims,
        actionableOwnershipViews,
        workspace,
        true,
        brakeSpeedLaw
      ));
    }
  }
  const attacker = applyDefensiveLegality(
    session,
    active,
    entries,
    programs,
    actionableOwnershipViews
  );
  const fullSeedEvaluations =
    evaluatorWork(session).seedEvaluations - seedEvaluationsBefore;
  if (fullSeedEvaluations > MAX_RACECRAFT_CANDIDATES)
    throw new Error(
      `Racecraft full evaluation budget exceeded: ` +
      `${fullSeedEvaluations}/${MAX_RACECRAFT_CANDIDATES}`
    );
  let leaderHazard: Hazard | null = null;
  if (leader)
    for (const hazard of hazards)
      if (hazard.other === leader.entry) {
        leaderHazard = hazard;
        break;
      }
  let attackerHazard: Hazard | null = null;
  if (attacker)
    for (const hazard of hazards)
      if (hazard.other === attacker.entry) {
        attackerHazard = hazard;
        break;
      }
  const incumbent = incumbentProgram(entry, programs);
  const priority: CandidateProgram[] = [];
  const appendPriority = (program: CandidateProgram | null): void => {
    if (program && !priority.includes(program)) priority.push(program);
  };
  appendPriority(incumbent);
  for (const program of programs) {
    if (leader && normalAttackProgram(program, leader.entry))
      appendPriority(program);
    if (attacker && normalDefenseProgram(
      session,
      program,
      active,
      attacker.claim
    ))
      appendPriority(program);
  }
  // Context membership depends on post-contact feasibility, so its members
  // and the incumbent establish exact upper bounds before any pruning.
  scorePrograms(session, active, priority, hazards);
  const economics: BattleEconomicsContext[] = [];
  if (leader && leaderHazard)
    economics.push(updateBattleEconomicsContext(
      session,
      active,
      leader.entry,
      programs,
      leaderHazard,
      'attack'
    ));
  if (attacker && attackerHazard)
    economics.push(updateBattleEconomicsContext(
      session,
      active,
      attacker.entry,
      programs,
      attackerHazard,
      'defense',
      attacker.claim
    ));
  reconcileBattleOpportunityObservations(session, active, economics);
  for (const program of priority)
    applyProgramBattleEconomics(program, economics);
  let upperBound = Infinity;
  for (const program of priority)
    if (program.evaluation.feasible)
      upperBound = Math.min(upperBound, program.evaluation.cost);
  const remaining = programs
    .map((program, index) => ({ program, index }))
    .filter(({ program }) =>
      program.evaluation.feasible && !program.fullyScored)
    .map(value => ({
      ...value,
      lowerBound: candidateObjectiveLowerBound(
        session,
        active,
        value.program,
        economics
      )
    }))
    .sort((left, right) =>
      left.lowerBound - right.lowerBound || left.index - right.index);
  for (const { program, lowerBound } of remaining) {
    if (lowerBound > upperBound) {
      program.branchBounded = true;
      evaluatorWork(session).branchBoundPrunes++;
      continue;
    }
    scorePrograms(session, active, [program], hazards);
    applyProgramBattleEconomics(program, economics);
    if (program.evaluation.feasible)
      upperBound = Math.min(upperBound, program.evaluation.cost);
  }
  let best: CandidateProgram | null = null;
  for (const program of programs)
    if (program.evaluation.feasible &&
        (best == null ||
          program.evaluation.cost < best.evaluation.cost))
      best = program;
  if (best && incumbent?.evaluation.feasible && best !== incumbent) {
    const differenceBand = tieBand(best, incumbent);
    best.evaluation.tieBandSeconds = differenceBand;
    if (!(best.evaluation.cost + differenceBand < incumbent.evaluation.cost)) {
      incumbent.evaluation.tieBandSeconds = differenceBand;
      best = incumbent;
    }
  }
  return {
    active,
    evaluationClaims,
    programs,
    hazards,
    best,
    previousKind,
    zeroHazardIdeal: false,
    economics
  };
}

/** Publish direct ideal authority after the interaction graph proves solitude. */
export function makeRacecraftSettledSolitudeDecision(
  session: Session,
  entry: Entry,
  chosenUtilization: number
): RacecraftDecision {
  const index = entry.car
    ? cyclicIndex(session.trk, entry.car.progIdx)
    : 0;
  return {
    at: session.t,
    selectedKind: 'ideal',
    selectedPlanNumericId: null,
    selectedPlanKey: null,
    candidateCount: 0,
    targetLateral: session.trk.idealPath.off[index]!,
    interactionCause: null,
    chosenUtilization,
    selectedLongitudinalProgram: null,
    economics: [],
    candidates: []
  };
}

/** Exact precondition for the bufferless, infinite solitude certificate. */
export function racecraftLateralAuthoritySettledOnIdeal(
  _session: Session,
  entry: ActiveEntry
): boolean {
  if (entry.state !== 'run' || entry.pathPlan != null ||
      entry.racecraftPathPlan != null ||
      entry.recT > 0 || entry.car.offCourse || entry.avoidT > 0 ||
      entry.laneProgram.points.length > 0 ||
      Math.abs(entry.laneProgram.bias) > Number.EPSILON ||
      entry.laneProgram.binding != null)
    return false;
  return true;
}

/** Curvature of the geometry currently under controller authority. */
export function racecraftCurrentLaneCurvature(
  session: Session,
  entry: ActiveEntry
): number {
  const index = Math.max(0, entry.car.progIdx) % session.trk.n;
  return entry.pathPlan?.mode === 'pit' && entry.path
    ? entry.path.k[index]!
    : entry.racecraftLateralProgram
      ? compactLateralGeometryAtProgress(
          session.trk,
          entry.racecraftLateralProgram,
          entry.prog
        ).curvature
      : session.trk.idealPath.k[index]!;
}

/** Current physical grip use, shared by solitude and mistake observation. */
export function racecraftCurrentGripUtilization(
  session: Session,
  entry: ActiveEntry
): number {
  const curvature = racecraftCurrentLaneCurvature(session, entry);
  const mu = entryMu(entry, session.wet);
  const downforceScale = entryDownforceScale(entry);
  const headroom = longitudinalGripHeadroomFraction(
    entry.spd,
    curvature,
    mu,
    downforceScale
  );
  const lateral = Math.sqrt(Math.max(0, 1 - headroom * headroom));
  const grip = availableDeceleration(entry.spd, mu, downforceScale);
  const braking = grip <= 1e-9
    ? 0
    : clamp(entry.inp.brake, 0, 1) *
      Math.min(grip, PHYS.brakeForce * PHYS.circK / PHYS.m) / grip;
  const drive = grip <= 1e-9
    ? 0
    : clamp(entry.inp.throttle, 0, 1) *
      Math.min(PHYS.Fmax, PHYS.power / Math.max(entry.spd, 4)) /
        PHYS.m / grip;
  const longitudinal = Math.max(braking, drive);
  return clamp(
    Math.sqrt(lateral * lateral + longitudinal * longitudinal),
    0,
    1
  );
}

/** One bounded argmin in seconds against current immutable publications. */
function evaluateRacecraftDecisionOnce(
  session: Session,
  entry: Entry,
  entries: readonly Entry[],
  actionableOwnershipViews: readonly ActionableOwnershipAssertion[]
): RacecraftDecision | null {
  if (!entry.car || entry.state !== 'run' || entry.pathPlan?.mode === 'pit' ||
      entry.recT > 0 || entry.car.offCourse) return null;
  evaluatorWork(session).decisionCalls++;
  const selection = selectRacecraftProgram(
    session,
    entry,
    entries,
    actionableOwnershipViews
  );
  if (!selection) return null;
  if (selection.zeroHazardIdeal) {
    commitBattleEconomicsSelection(selection.active, null, []);
    return makeRacecraftSettledSolitudeDecision(
      session,
      selection.active,
      racecraftCurrentGripUtilization(session, selection.active)
    );
  }
  const {
    active,
    programs,
    best,
    previousKind,
    economics
  } = selection;
  const previousDecision = entry.racecraftDecision;
  const previousSelected = previousDecision?.candidates.find(candidate =>
    candidate.planNumericId === previousDecision.selectedPlanNumericId);
  const previousPublication = session.racecraftClaims?.get(entry.code);
  const selectedPlan = best?.evaluation.plan;
  const selectedTarget = selectedPlan &&
      selectedPlan.mode !== 'ideal' &&
      selectedPlan.mode !== 'pit'
    ? selectedPlan.leaderCode ??
      best?.evaluation.slowPointOwnerCode ??
      null
    : null;
  const previousTarget = previousSelected &&
      previousSelected.plan.mode !== 'ideal' &&
      previousSelected.plan.mode !== 'pit'
    ? previousSelected.plan.leaderCode ??
      previousSelected.slowPointOwnerCode
    : null;
  const selectedSideKind =
    best?.evaluation.kind === 'corner-inside' ||
    best?.evaluation.kind === 'corner-outside';
  const previousSideKind =
    previousSelected?.kind === 'corner-inside' ||
    previousSelected?.kind === 'corner-outside';
  const selectedCornerId = selectedPlan &&
      selectedPlan.mode !== 'ideal' &&
      selectedPlan.mode !== 'pit'
    ? selectedPlan.cornerId ?? null
    : null;
  const previousCornerId = previousSelected &&
      previousSelected.plan.mode !== 'ideal' &&
      previousSelected.plan.mode !== 'pit'
    ? previousSelected.plan.cornerId ?? null
    : null;
  if (best && previousSelected && selectedSideKind && previousSideKind &&
      best.evaluation.kind !== previousSelected.kind &&
      best.evaluation.familyNumericId !==
        previousSelected.familyNumericId &&
      selectedTarget != null &&
      selectedTarget === previousTarget &&
      selectedCornerId === previousCornerId &&
      previousPublication?.mode === 'staged-attack' &&
      previousPublication.targetCode === selectedTarget) {
    session.racecraftSwitchbackFamilyChanges =
      (session.racecraftSwitchbackFamilyChanges ?? 0) + 1;
    session.switchbackN = (session.switchbackN ?? 0) + 1;
    const episode = session.attackEpisodes?.get(
      `${entry.code}:${selectedTarget}`
    );
    if (episode) episode.switchback = true;
  }
  const candidates = new Array<RacecraftCandidateEvaluation>(
    programs.length
  );
  let rejectedCount = 0;
  let stagedRejectedCount = 0;
  const rejectedByConstraint = session.racecraftRejectedByConstraint ??
    (session.racecraftRejectedByConstraint = {});
  for (let index = 0; index < programs.length; index++) {
    const candidate = programs[index]!.evaluation;
    candidates[index] = candidate;
    if (candidate.feasible) continue;
    rejectedCount++;
    if (candidate.plan.mode !== 'ideal' &&
        candidate.plan.mode !== 'pit' &&
        (candidate.plan.mode === 'side-inside' ||
          candidate.plan.mode === 'side-outside') &&
        candidate.plan.surfaceAuthorization !== 'emergency' &&
        candidate.plan.leaderCode != null)
      stagedRejectedCount++;
    for (const veto of candidate.vetoes)
      rejectedByConstraint[veto] =
        (rejectedByConstraint[veto] ?? 0) + 1;
  }
  session.racecraftRejectedCandidates =
    (session.racecraftRejectedCandidates ?? 0) + rejectedCount;
  session.racecraftStagedCandidatesRejected =
    (session.racecraftStagedCandidatesRejected ?? 0) +
    stagedRejectedCount;
  if (best && previousKind != null &&
      best.evaluation.kind !== previousKind)
    session.racecraftDecisionSwitches =
      (session.racecraftDecisionSwitches ?? 0) + 1;
  const defensiveLegality = best?.defensiveLegality ?? null;
  const selectedDefensiveMove =
    defensiveLegality?.legal === true &&
    (
      defensiveLegality.classification === 'new-move' ||
      defensiveLegality.classification === 'continuation'
    );
  const inheritedDefensiveCommitment =
    entry.racecraftDefensiveCommitment ??
    previousPublication?.defensiveCommitment ??
    null;
  const carriedDefensiveCommitment =
    racecraftDefensiveCommitmentIsActive(
      inheritedDefensiveCommitment,
      entry.prog
    )
      ? inheritedDefensiveCommitment
      : null;
  const decision: RacecraftDecision = {
    at: session.t,
    selectedKind: best?.evaluation.kind ?? null,
    selectedPlanNumericId: best?.evaluation.planNumericId ?? null,
    selectedPlanKey: best?.evaluation.plan.key ?? null,
    candidateCount: candidates.length,
    targetLateral: best?.evaluation.targetLateral ?? entry.latNow,
    interactionCause: best?.evaluation.interactionCause ?? null,
    chosenUtilization: best?.evaluation.gripUtilization ?? 0,
    selectedLongitudinalProgram: best
      ? {
          envelope: cloneSpeedEnvelope(best.speedLaw.envelope),
          brakingEffort: best.speedLaw.brakingEffort,
          slowPointOwnerCode: best.speedLaw.longitudinalOwnerCode,
          bindingSlowPoint: best.speedLaw.slowPoint
        }
      : null,
    cornerOwnershipAssertion: best?.ownershipAssertion ?? null,
    defensiveCommitment:
      defensiveLegality?.commitment ??
      carriedDefensiveCommitment,
    defensiveTargetCode: selectedDefensiveMove
      ? defensiveLegality.targetCode
      : null,
    defensiveCornerId: selectedDefensiveMove
      ? defensiveLegality.cornerId
      : null,
    defensiveContinuation:
      defensiveLegality?.classification === 'continuation',
    defensiveApproachConflictAuthorized:
      selectedDefensiveMove &&
      defensiveLegality.approachConflictAuthorized,
    defenderReclaim: best?.defenderReclaim ?? false,
    economics: economics.map(context => ({
      rivalCode: context.rival.code,
      role: context.role,
      opportunityPresent: context.opportunityPresent,
      paceDifferentialSecondsPerLap:
        context.paceDifferentialSecondsPerLap,
      reopportunitySeconds: context.reopportunitySeconds,
      positionValueSeconds: context.positionValueSeconds
    })),
    candidates
  };
  if (best &&
      best.evaluation.plan.mode !== 'ideal' &&
      best.evaluation.plan.mode !== 'pit' &&
      (best.evaluation.plan.mode === 'side-inside' ||
        best.evaluation.plan.mode === 'side-outside') &&
      best.evaluation.plan.surfaceAuthorization !== 'emergency') {
    session.racecraftStagedCandidatesSelected =
      (session.racecraftStagedCandidatesSelected ?? 0) + 1;
    if (best.speedLaw.stagedClearanceProgressMetres != null)
      session.racecraftStagedCandidatesCleared =
        (session.racecraftStagedCandidatesCleared ?? 0) + 1;
  }
  if (best?.ownershipAssertion) {
    session.racecraftOwnershipAssertions =
      (session.racecraftOwnershipAssertions ?? 0) + 1;
  }
  if (best?.defenderReclaim) {
    session.racecraftDefenderReclaims =
      (session.racecraftDefenderReclaims ?? 0) + 1;
  }
  if (selectedDefensiveMove &&
      defensiveLegality.classification === 'new-move') {
    if (defensiveLegality.outcome === 'room-protected')
      session.racecraftDefensiveRoomProtectedCovers =
        (session.racecraftDefensiveRoomProtectedCovers ?? 0) + 1;
    else
      session.racecraftDefensiveAuthorizedSideClosures =
        (session.racecraftDefensiveAuthorizedSideClosures ?? 0) + 1;
  }
  if (decision.defensiveApproachConflictAuthorized)
    session.racecraftDefensiveAuthorizedApproachConflicts =
      (session.racecraftDefensiveAuthorizedApproachConflicts ?? 0) + 1;
  commitBattleEconomicsSelection(active, best, economics);
  entry.racecraftDecision = decision;
  session.racecraftCandidatesEvaluated =
    (session.racecraftCandidatesEvaluated ?? 0) + candidates.length;
  session.racecraftMaximumCandidates = Math.max(
    session.racecraftMaximumCandidates ?? 0,
    candidates.length
  );
  if (best)
    session.racecraftDecisionSamples =
      (session.racecraftDecisionSamples ?? 0) + 1;
  session.racecraftPathsMaterialized ??= 0;
  accumulateSelectedJ(session, entry, best?.evaluation ?? null);
  appendDecisionLog(session, entry, decision);
  return decision;
}

const activeDirectionalEvaluations = new WeakSet<Session>();

/** One owner may have only one live tactical evaluation on its due slot. */
export function evaluateRacecraftDecision(
  session: Session,
  entry: Entry,
  entries: readonly Entry[],
  actionableOwnershipViews: readonly ActionableOwnershipAssertion[] =
    EMPTY_OWNERSHIP_VIEWS
): RacecraftDecision | null {
  if (activeDirectionalEvaluations.has(session)) {
    recordRacecraftNestedResponseEvaluation(session);
    throw new Error(
      `${entry.code} attempted a nested directional evaluation`
    );
  }
  activeDirectionalEvaluations.add(session);
  try {
    return evaluateRacecraftDecisionOnce(
      session,
      entry,
      entries,
      actionableOwnershipViews
    );
  } finally {
    activeDirectionalEvaluations.delete(session);
  }
}

function hasLiveRacecraftInteraction(
  session: Session,
  entry: Entry,
  entries: readonly Entry[],
  targetCode?: string
): boolean {
  for (const obligation of obligationsFor(session, entry, entries))
    if (!targetCode || obligation.beneficiary.code === targetCode) return true;
  if (hasSideAgreement(session, entry.code)) return true;
  const selected = entry.racecraftDecision?.candidates.find(candidate =>
    candidate.planNumericId ===
      entry.racecraftDecision?.selectedPlanNumericId);
  if (!selected || selected.plan.mode === 'ideal' ||
      selected.plan.mode === 'pit') return false;
  const leaderCode = selected.slowPointOwnerCode ?? selected.plan.leaderCode;
  if (!leaderCode || (targetCode && targetCode !== leaderCode)) return false;
  const target = entries.find(candidate =>
    candidate.code === leaderCode && candidate.car);
  if (!entry.car || !target?.car) return false;
  return Math.abs(signedTrackDistance(
    session.trk,
    entry.car.s,
    target.car.s
  )) <= TRAFFIC_NEIGHBOR_SCAN_METRES;
}

function laneProgramBindingIsLive(
  session: Session,
  entry: Entry,
  entries: readonly Entry[]
): boolean {
  const binding = entry.laneProgram.binding;
  if (!binding) return false;
  if (binding.startsWith('racecraft:')) {
    const target = binding.slice('racecraft:'.length);
    if (target === 'self') {
      const selectedKey = entry.racecraftDecision?.selectedPlanKey;
      return selectedKey != null &&
        entry.laneProgram.reason === `space:${selectedKey}`;
    }
    return hasLiveRacecraftInteraction(session, entry, entries, target);
  }
  if (binding.startsWith('recenter:')) return true;
  if (binding === 'grid-hold' || binding === 'start-release')
    return session.t - session.goT < 16;
  if (binding === 'incident-avoid') return entry.avoidT > 0;
  if (binding.startsWith('pit-destination:'))
    return entry.pitArm != null || entry.boxArm;
  return false;
}

/** Expire dead lateral authority into one physical return-to-line program. */
export function maintainRacingLineZeroState(
  session: Session,
  entry: Entry,
  entries: readonly Entry[]
): void {
  if (!entry.car || entry.pathPlan?.mode === 'pit') return;
  const index = cyclicIndex(session.trk, entry.car.progIdx);
  const currentEta = entry.latNow - session.trk.idealPath.off[index]!;
  const analyticTarget = entry.racecraftPathPlan?.anchors.at(-1);
  const targetEta = analyticTarget
    ? analyticTarget.eta ?? (
        analyticTarget.offset -
        session.trk.idealPath.off[
          cyclicIndex(session.trk, analyticTarget.index)
        ]!
      )
    : entry.laneProgram.points.at(-1)?.eta ??
      entry.laneProgram.bias;
  const agreement = sideAgreementBounds(session, entry);
  const hasProgram = entry.racecraftPathPlan != null ||
    entry.laneProgram.points.length > 0 ||
    Math.abs(entry.laneProgram.bias) > Number.EPSILON;
  const interacting = hasLiveRacecraftInteraction(
    session,
    entry,
    entries
  ) || agreement != null;
  if (!interacting && Math.abs(currentEta) > 1.5 * PHYS.carWid)
    session.racecraftWanderingSeconds =
      (session.racecraftWanderingSeconds ?? 0) + TRAF_DT;
  // Agreement geometry is selected by the evaluator. Execution holds the
  // installed family until that replacement exists; it never authors one.
  if (agreement) return;
  if (entry.laneProgram.surfaceAuthorization === 'emergency' &&
      entry.car.offCourse && entry.recT <= 0)
    return;
  if (entry.laneProgram.binding?.startsWith('recenter:')) {
    const endpoint = entry.laneProgram.points.at(-1);
    if (Math.abs(currentEta) <= Number.EPSILON ||
        !endpoint || endpoint.s <= entry.prog + Number.EPSILON)
      clearLaneProgram(entry, 'ideal');
    return;
  }
  if (!hasProgram) return;
  if (laneProgramBindingIsLive(session, entry, entries)) return;
  session.racecraftExpiredPrograms =
    (session.racecraftExpiredPrograms ?? 0) + 1;
  editLaneEtaTarget(
    session,
    entry,
    0,
    `recenter:expired:${entry.laneProgram.binding ?? 'unbound'}`,
    true
  );
  entry.laneProgram.binding = 'recenter:self';
  if (Math.abs(targetEta) <= Number.EPSILON &&
      entry.laneProgram.points.at(-1)?.s! <=
        entry.prog + Number.EPSILON)
    clearLaneProgram(entry, 'ideal');
}
