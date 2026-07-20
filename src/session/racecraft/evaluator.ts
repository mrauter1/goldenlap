import {
  backwardInducedSpeedLimit,
  BOT_BRAKING_EFFORT_MAXIMUM,
  BOT_BRAKING_EFFORT_MINIMUM,
  PATH_FOLLOWER_SETTLE_DISTANCE
} from '../../core/autopilot';
import {
  isHardContactImpulse,
  sweptCarContactEpisodes,
  sweptCarContactIntervals,
  sweptCarMinimumClearance,
  type SweptCarContactEpisode
} from '../../core/collision';
import { sampleCornerLineEta } from '../../core/corner-lines';
import type { LegacyCorner, Track } from '../../core/model';
import {
  availableDeceleration,
  longitudinalAccelerationHeadroom,
  longitudinalGripHeadroomFraction,
  PHYS,
  wakeEffect
} from '../../core/physics';
import {
  emergencyLateralIsLegal,
  normalLateralEnvelope
} from '../../core/surface';
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
  RacecraftDecision,
  RacecraftDecisionCertificateBreakReason,
  RacecraftDecisionLogEntry,
  RacecraftDirection,
  RacecraftEvaluatorWorkDiagnostics,
  RacecraftInteractionCause,
  Session
} from '../model';
import {
  entryDownforceScale,
  entryMargin,
  entryMods,
  entryMu,
  flowOff,
  LIFT_MARGIN_PENALTY,
  START_BLEND_END,
  TRAF_DT
} from '../strategy';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from './cadence';
import {
  createRacecraftClaimStations,
  racecraftClaimAtEvaluationEpoch,
  racecraftClaimStateAtTime,
  writeRacecraftClaimStateAtTime,
  type RacecraftClaimState,
  type RacecraftEvaluationClaim
} from './claim';
import {
  arrivalQuantizedResponsibility,
  pairwiseDifferenceTieBand,
  responseSlack
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
  measuredContactEpisodeLossBound,
  measuredContactEpisodeLossSeconds
} from './contact-loss';
import {
  evaluateManeuverPlanCompactWithSampler,
  maneuverPredictionStationTime,
  MANEUVER_PREDICTION,
  type ManeuverPlanSampler
} from './feasibility';
import {
  racecraftFamilyStateAt as computeLaneStateAt,
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
  sampleCompactPathPlanOffset,
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
      arrivalFamilyBuilds: 0,
      arrivalFamilyCacheHits: 0,
      tieBandHazardEvaluations: 0,
      rivalStateBuilds: 0,
      rivalStateCacheHits: 0,
      rivalSweepBuilds: 0,
      rivalSweepCacheHits: 0,
      rivalContinuationBuilds: 0,
      rivalContinuationCacheHits: 0
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
}

export interface RacecraftOptimalProgramStation {
  time: number;
  progress: number;
  s: number;
  lateral: number;
  speed: number;
  /** Predicted body orientation relative to the local track tangent. */
  headingOffsetRadians: number;
}

export interface RacecraftOptimalProgram {
  kind: RacecraftCandidateKind;
  plan: PathPlan;
  slowPointOwnerCode: string | null;
  candidateCount: number;
  stations: readonly RacecraftOptimalProgramStation[];
}

interface CandidateProgram {
  evaluation: RacecraftCandidateEvaluation;
  stations: ProgramStation[];
  speedLaw: CandidateSpeedLaw;
  emergencyHazards: Map<string, number>;
  perturbations: Map<string, {
    base: number;
    billSeconds: number;
    recourseSeconds: number;
    bindingStationIndex: number;
  }>;
  bounds: Map<string, RelativePointStation[] | null>;
  positionGains: Map<string, boolean>;
  authoredExtensions: Map<number, ProgramStation[]>;
  evaluationClaims: EvaluationClaimMap;
  /** Integral of grip utilization over the authored rollout. */
  utilizationExposureSeconds: number;
  utilizationExposure: Array<{
    time: number;
    cumulativeSeconds: number;
  }>;
}

interface StandingDecisionEvaluation {
  at: number;
  session: Session;
  entry: ActiveEntry;
  entries: ActiveEntry[];
  evaluationClaims: EvaluationClaimMap;
  programs: CandidateProgram[];
  hazards: Hazard[];
  selected: CandidateProgram | null;
}

interface CandidateSpeedLaw {
  progress: number[];
  speed: number[];
  brakingEffort: number;
  slowPoint: EntryTrafficSlowPoint | null;
}

export interface RacecraftDeferredResponseSummary {
  kind: RacecraftCandidateKind;
  planKey: string;
  lineBlend: number | null;
  targetLateral: number;
  surfaceAuthorization: 'normal' | 'emergency';
  feasible: boolean;
}

export interface RacecraftEmergencyResponseSummary {
  direction: -1 | 1;
  targetLateral: number;
}

type EvaluationClaimMap = ReadonlyMap<string, RacecraftEvaluationClaim>;
const EMPTY_EVALUATION_CLAIMS: EvaluationClaimMap = new Map();

export interface RacecraftContestedRegion {
  index: number;
  s: number;
  time: number;
}

interface Hazard {
  key: string;
  other: ActiveEntry;
  claim: RacecraftClaim;
  /** Prediction origin consumed by the continuous body sweep. */
  originS: number;
  originLateral: number;
  originHeadingOffsetRadians: number;
  ownClaim: RacecraftClaim | null;
  /** First overlap of the two immutable snapshot programs, if one exists. */
  region: RacecraftContestedRegion | null | undefined;
  /** Snapshot-derived and candidate-independent within this deliberation. */
  adaptResponsibility: number | null;
  /** Fixed world geometry for the immutable rival publication. */
  rivalSweepGeometry: {
    origin: WorldBodyPose;
    stations: WorldBodyPose[];
  } | null;
  bestPlanContinuation: {
    plan: PathPlan;
    speedLaw: CandidateSpeedLaw;
    stations: ProgramStation[];
    evaluationClaims: EvaluationClaimMap;
  } | null;
  bestPlanContinuationResolved: boolean;
}

interface SweptContact {
  time: number;
  egoProgress: number;
  egoSpeed: number;
  maximumRelativeNormalSpeed: number;
  stationIndex: number;
  episodes: readonly SweptCarContactEpisode[];
}

interface HazardCost {
  seconds: number;
  billSeconds: number;
  recourseSeconds: number;
  bindingStationIndex: number;
}

interface HazardClearance {
  stationIndex: number;
  clearanceMetres: number;
}

interface ScoreProgramsScratch {
  hazards: Hazard[];
  stations: Array<RelativePointStation[] | null>;
  clearances: Array<HazardClearance | null>;
}

const scoreProgramsScratchBySession =
  new WeakMap<Session, ScoreProgramsScratch>();

interface HazardResponseOption {
  q: number | null;
  qLowerBound: number;
  waitSlack: number;
  emergency: boolean;
  order: number;
  unresolvedContacts: SweptContact[] | null;
}

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
const standingDecisionEvaluations =
  new WeakMap<RacecraftDecision, StandingDecisionEvaluation>();
const planNumericIds = new WeakMap<PathPlan, number>();
let nextPlanNumericId = 1;
interface FamilyIdentityInterner {
  nextId: number;
  byLabel: Map<string, number>;
}
const familyIdentityBySession =
  new WeakMap<Session, FamilyIdentityInterner>();

interface CandidateTowRivalSnapshot {
  code: string | null;
  downstream: number;
  lateral: number;
}

const candidateTowRivalSnapshots = new WeakMap<
  EvaluationClaimMap,
  WeakMap<ActiveEntry, Map<number, CandidateTowRivalSnapshot>>
>();
const candidateTowStateScratch: RacecraftClaimState = {
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};
const programStationScratchA: ProgramStation = {
  time: 0,
  progress: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};
const programStationScratchB: ProgramStation = {
  time: 0,
  progress: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};

type BestPlanContinuation =
  NonNullable<Hazard['bestPlanContinuation']>;

interface CachedBestPlanContinuation {
  session: Session;
  other: ActiveEntry;
  publishedAt: number;
  publicationRevision: number;
  predictionKey: string;
  value: BestPlanContinuation | null;
}

const bestPlanContinuationByClaim =
  new WeakMap<RacecraftClaim, CachedBestPlanContinuation>();
interface CachedRivalSweepGeometry {
  track: Track;
  publishedAt: number;
  publicationRevision: number;
  predictionKey: string;
  geometry: NonNullable<Hazard['rivalSweepGeometry']>;
}
const rivalSweepGeometryByClaim =
  new WeakMap<RacecraftClaim, CachedRivalSweepGeometry>();

function cloneBestPlanContinuation(
  value: BestPlanContinuation
): BestPlanContinuation {
  return {
    plan: value.plan,
    speedLaw: value.speedLaw,
    stations: value.stations.map(station => ({ ...station })),
    evaluationClaims: value.evaluationClaims
  };
}

function freezeActiveEntry(entry: ActiveEntry): ActiveEntry {
  return {
    ...entry,
    car: { ...entry.car },
    tyre: { ...entry.tyre },
    rel: { ...entry.rel },
    wearAcc: { ...entry.wearAcc },
    inp: { ...entry.inp },
    mods: { ...entry.mods },
    flow: entry.flow ? [...entry.flow] : null,
    lineBiasByCorner: entry.lineBiasByCorner
      ? { ...entry.lineBiasByCorner }
      : null,
    racecraftLongitudinalProgram: entry.racecraftLongitudinalProgram
      ? {
          ...entry.racecraftLongitudinalProgram,
          progress: [...entry.racecraftLongitudinalProgram.progress],
          speed: [...entry.racecraftLongitudinalProgram.speed]
        }
      : null,
    laneProgram: {
      ...entry.laneProgram,
      points: entry.laneProgram.points.map(point => ({ ...point }))
    }
  };
}

function freezeStandingSession(
  session: Session,
  entries: ActiveEntry[]
): Session {
  const frozen = {
    ...session,
    entries,
    events: []
  } as Session;
  if (session.racecraftClaims)
    frozen.racecraftClaims = new Map(session.racecraftClaims);
  else delete frozen.racecraftClaims;
  if (session.sideAgreements)
    frozen.sideAgreements = new Map(
      [...session.sideAgreements].map(([key, agreement]) => [
        key,
        {
          ...agreement,
          familyCertificate: { ...agreement.familyCertificate }
        }
      ])
    );
  else delete frozen.sideAgreements;
  const familyInterner = familyIdentityBySession.get(session);
  if (familyInterner)
    familyIdentityBySession.set(frozen, familyInterner);
  delete frozen.racecraftEvaluatorWork;
  return frozen;
}

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

interface CachedEvaluatorDynamics {
  session: Session;
  at: number;
  baseMu: number;
  downforceScale: number;
  modifiers: ReturnType<typeof entryMods>;
  margin: number;
}

const evaluatorDynamicsCache = new WeakMap<Entry, CachedEvaluatorDynamics>();
const evaluatorLaneStateCache = new WeakMap<Entry, {
  session: Session;
  at: number;
  plans: Map<PathPlan, Map<number, LaneState>>;
}>();
function evaluatorDynamics(
  session: Session,
  entry: Entry
): CachedEvaluatorDynamics {
  const cached = evaluatorDynamicsCache.get(entry);
  if (Number.isFinite(session.t) &&
      cached?.session === session &&
      cached.at === session.t)
    return cached;
  const baseMu = entryMu(entry, session.wet);
  const value = {
    session,
    at: session.t,
    baseMu,
    downforceScale: entryDownforceScale(entry),
    modifiers: entryMods(entry, session.wet, baseMu),
    margin: clamp(
      entryMargin(
        entry,
        session,
        session.config.tuneBonus,
        session.wet
      ) + flowOff(entry, session),
      0.85,
      0.985
    )
  };
  if (Number.isFinite(session.t)) evaluatorDynamicsCache.set(entry, value);
  return value;
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
  let cache = evaluatorLaneStateCache.get(entry);
  if (!cache || cache.session !== session || cache.at !== session.t) {
    cache = {
      session,
      at: session.t,
      plans: new Map()
    };
    evaluatorLaneStateCache.set(entry, cache);
  }
  let states = cache.plans.get(effectivePlan);
  if (!states) {
    states = new Map();
    cache.plans.set(effectivePlan, states);
  }
  const existing = states.get(progress);
  if (existing) return existing;
  const state = computeLaneStateAt(
    session,
    entry,
    progress,
    effectivePlan
  );
  states.set(progress, state);
  return state;
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
  states: Map<number, LaneState>;
  diagnostic: ManeuverCandidateDiagnostic | undefined;
}

const evaluatorManeuverSamplerContexts =
  new WeakMap<ActiveEntry, EvaluatorManeuverSamplerContext>();

function evaluatorManeuverStateAt(
  context: EvaluatorManeuverSamplerContext,
  index: number
): LaneState {
  const wrapped = cyclicIndex(context.session.trk, index);
  const cached = context.states.get(wrapped);
  if (cached) return cached;
  const start = cyclicIndex(
    context.session.trk,
    context.entry.car.progIdx
  );
  const progress = context.entry.prog +
    distanceAhead(context.session.trk, start, wrapped);
  const state = laneStateAt(
    context.session,
    context.entry,
    progress,
    context.plan
  );
  context.states.set(wrapped, state);
  return state;
}

const EVALUATOR_MANEUVER_SAMPLER:
  ManeuverPlanSampler<EvaluatorManeuverSamplerContext> = {
    lateralAt(context, index) {
      return evaluatorManeuverStateAt(context, index).lateral;
    },
    curvatureAt(context, index) {
      return evaluatorManeuverStateAt(context, index).curvature;
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
  entries: readonly Entry[]
): {
  entry: ActiveEntry;
  distance: number;
  selected: RacecraftCandidateEvaluation;
} | null {
  let nearest: {
    entry: ActiveEntry;
    distance: number;
    selected: RacecraftCandidateEvaluation;
  } | null = null;
  for (const candidate of entries) {
    if (candidate === defender || !candidate.car ||
        candidate.state !== 'run')
      continue;
    const distance = (
      defender.car.s - candidate.car.s + session.trk.len
    ) % session.trk.len;
    if (distance <= 0 || distance > TRAFFIC_NEIGHBOR_SCAN_METRES ||
        (nearest && distance >= nearest.distance))
      continue;
    const selected = candidate.racecraftDecision?.candidates.find(value =>
      value.planNumericId ===
        candidate.racecraftDecision?.selectedPlanNumericId);
    const targetsDefender = selected?.plan.mode !== 'ideal' &&
      selected?.plan.mode !== 'pit' &&
      (selected?.plan.mode === 'side-inside' ||
        selected?.plan.mode === 'side-outside') &&
      selected?.plan.surfaceAuthorization !== 'emergency' &&
      selected?.plan.leaderCode === defender.code;
    if (!targetsDefender) continue;
    nearest = {
      entry: candidate as ActiveEntry,
      distance,
      selected
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

function capabilityPaceRatio(
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
        capabilityPaceRatio(session, entry),
        capabilityPaceRatio(session, rival)
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
  program: CandidateProgram,
  defender: ActiveEntry,
  attacker: ActiveEntry
): boolean {
  const plan = program.evaluation.plan;
  return program.evaluation.feasible &&
    plan.mode !== 'ideal' &&
    plan.mode !== 'pit' &&
    (plan.mode === 'side-inside' || plan.mode === 'side-outside') &&
    plan.surfaceAuthorization !== 'emergency' &&
    Math.abs(program.evaluation.targetLateral - attacker.latNow) <
      Math.abs(defender.latNow - attacker.latNow);
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
  const cached = program.positionGains.get(hazard.key);
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
    program.positionGains.set(hazard.key, false);
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
    program.positionGains.set(hazard.key, false);
    return false;
  }
  const gains = signedTrackDistance(
    session.trk,
    terminal.s,
    rival.s
  ) <= 0;
  program.positionGains.set(hazard.key, gains);
  return gains;
}

function updateBattleEconomicsContext(
  session: Session,
  entry: ActiveEntry,
  rival: ActiveEntry,
  programs: readonly CandidateProgram[],
  hazard: Hazard,
  role: BattleEconomicsRole
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
      : normalDefenseProgram(program, entry, rival));
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

/** Exact membership predicate shared by Tier 0 and full hazard construction. */
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
    return sampleCompactPathPlanOffset(
      session.trk,
      entry.racecraftPathPlan,
      index,
      progress
    );
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
  const targetPoint = line.points
    .map(point => ({
      point,
      distance: distanceAhead(track, start, point.index)
    }))
    .filter(value =>
      value.distance > track.step / 2 &&
      value.distance <= exitDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.point;
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

type LambdaInterval = [number, number];
interface LambdaConflict {
  ideal: number;
  slope: number;
  centre: number;
  overlap: number;
}
interface LambdaSeed {
  lambda: number;
}

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

/**
 * One closed-form avoidance member: the minimum constant parallel offset on
 * the requested side that clears every screened claim station. It is not an
 * arc search and has no per-station lateral freedom.
 */
function emergencyEscapePlan(
  session: Session,
  entry: ActiveEntry,
  hazards: readonly Hazard[],
  side: -1 | 1,
): DynamicPlan | null {
  const track = session.trk;
  const start = cyclicIndex(track, entry.car.progIdx);
  let targetEta = entry.latNow - track.idealPath.off[start]!;
  let hasConstraint = false;
  for (const hazard of hazards) {
    const claim = hazard.claim;
    for (let stationIndex = 0;
      stationIndex < claim.stations.length;
      stationIndex++) {
      const stationTime = claim.stations.time[stationIndex]!;
      const stationS = claim.stations.s[stationIndex]!;
      const egoS = (
        entry.car.s + Math.max(0, entry.spd) * stationTime
      ) % track.len;
      if (Math.abs(signedTrackDistance(track, egoS, stationS)) >
          PHYS.carLen)
        continue;
      const index = cyclicIndex(track, egoS / track.step);
      const clearance = PHYS.carWid;
      const ideal = track.idealPath.off[index]!;
      const eta = claim.stations.y[stationIndex]! -
        ideal + side * clearance;
      targetEta = side < 0
        ? Math.min(targetEta, eta)
        : Math.max(targetEta, eta);
      hasConstraint = true;
    }
  }
  if (!hasConstraint) return null;
  const targetNow = track.idealPath.off[start]! + targetEta;
  const moveSeconds = physicalLaneMoveSeconds(session, entry, targetNow);
  if (!Number.isFinite(moveSeconds)) return null;
  const acquisitionProgress = entry.prog + Math.max(
    PHYS.carLen,
    entry.spd * moveSeconds
  );
  const holdProgress = Math.max(
    horizonProgress(entry),
    acquisitionProgress + track.step
  );
  const dynamics = evaluatorDynamics(session, entry);
  const rejoinSeconds = physicalLateralMoveSeconds(
    Math.max(0, entry.spd),
    targetEta,
    availableDeceleration(
      entry.spd,
      dynamics.baseMu,
      dynamics.downforceScale
    )
  );
  const rejoinProgress = holdProgress + Math.max(
    PHYS.carLen,
    entry.spd * (Number.isFinite(rejoinSeconds)
      ? rejoinSeconds
      : MANEUVER_PREDICTION.horizonSeconds)
  );
  const acquisitionIndex = indexAtProgress(
    track,
    entry,
    acquisitionProgress
  );
  const holdIndex = indexAtProgress(track, entry, holdProgress);
  const rejoinIndex = indexAtProgress(track, entry, rejoinProgress);
  if (acquisitionIndex === holdIndex) return null;
  return {
    mode: side < 0 ? 'side-inside' : 'side-outside',
    key: `cost:${entry.code}:escape:${side}:${start}`,
    anchors: [
      currentAuthoredAnchor(session, entry),
      {
        index: acquisitionIndex,
        offset: track.idealPath.off[acquisitionIndex]! + targetEta,
        s: acquisitionProgress
      },
      {
        index: holdIndex,
        offset: track.idealPath.off[holdIndex]! + targetEta,
        s: holdProgress
      },
      {
        index: rejoinIndex,
        offset: track.idealPath.off[rejoinIndex]!,
        s: rejoinProgress
      }
    ],
    pinnedFirst: true,
    topology: side < 0 ? 'left' : 'right',
    surfaceAuthorization: 'emergency',
    emergencyReason: 'collision-avoidance',
    leaderCode: hazards[0]?.other.code ?? null
  };
}

/**
 * The emergency member is one constraint-derived response for the complete
 * live hazard set. Both connected surface components are solved in closed
 * form; projecting onto the nearer component is not an online arc search.
 */
function jointEmergencyEscapeSeed(
  session: Session,
  entry: ActiveEntry,
  hazards: readonly Hazard[]
): RacecraftCandidateSeed | null {
  const isLegal = (plan: DynamicPlan): boolean => {
    if (!candidateRespectsAgreement(session, entry, plan)) return false;
    const endProgress = plan.anchors.at(-1)?.s ?? entry.prog;
    const distance = Math.max(0, endProgress - entry.prog);
    const samples = Math.max(
      1,
      Math.ceil(distance / session.trk.step)
    );
    for (let sample = 0; sample <= samples; sample++) {
      const progress = entry.prog + distance * sample / samples;
      const index = indexAtProgress(session.trk, entry, progress);
      const lateral = sampleCompactPathPlanOffset(
        session.trk,
        plan,
        index,
        progress
      );
      if (!emergencyLateralIsLegal(
        session.trk,
        index,
        lateral
      )) return false;
    }
    return true;
  };
  let selected: { side: -1 | 1; plan: DynamicPlan; move: number } | null =
    null;
  for (const side of [-1, 1] as const) {
    const plan = emergencyEscapePlan(session, entry, hazards, side);
    const acquisition = plan?.anchors[1];
    if (!plan || !acquisition || !isLegal(plan)) continue;
    const move = Math.abs(acquisition.offset - entry.latNow);
    if (!selected ||
        move < selected.move - Number.EPSILON ||
        (Math.abs(move - selected.move) <= Number.EPSILON &&
          side < selected.side))
      selected = { side, plan, move };
  }
  return selected
    ? {
        kind: selected.side < 0
          ? 'corner-inside'
          : 'corner-outside',
        plan: selected.plan,
        slowPointOwnerCode: null
      }
    : null;
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
  allowed: readonly LambdaInterval[],
  forbiddenMinimum: number,
  forbiddenMaximum: number
): LambdaInterval[] {
  const minimum = Math.max(0, Math.min(1, forbiddenMinimum));
  const maximum = Math.max(0, Math.min(1, forbiddenMaximum));
  if (maximum < 0 || minimum > 1 || minimum > maximum) return [...allowed];
  const next: LambdaInterval[] = [];
  for (const [from, to] of allowed) {
    if (maximum <= from || minimum >= to) {
      next.push([from, to]);
      continue;
    }
    if (minimum > from) next.push([from, Math.min(to, minimum)]);
    if (maximum < to) next.push([Math.max(from, maximum), to]);
  }
  return next.filter(([from, to]) => to - from > Number.EPSILON);
}

function intersectAllowed(
  allowed: readonly LambdaInterval[],
  minimum: number,
  maximum: number
): LambdaInterval[] {
  const lower = Math.max(0, minimum);
  const upper = Math.min(1, maximum);
  if (lower > upper) return [];
  const next: LambdaInterval[] = [];
  for (const [from, to] of allowed) {
    const intersectionFrom = Math.max(from, lower);
    const intersectionTo = Math.min(to, upper);
    if (intersectionFrom <= intersectionTo)
      next.push([intersectionFrom, intersectionTo]);
  }
  return next;
}

function constrainAffineToEnvelope(
  allowed: readonly LambdaInterval[],
  ideal: number,
  full: number,
  minimum: number,
  maximum: number
): LambdaInterval[] {
  const slope = full - ideal;
  if (Math.abs(slope) <= Number.EPSILON)
    return ideal >= minimum && ideal <= maximum ? [...allowed] : [];
  const first = (minimum - ideal) / slope;
  const second = (maximum - ideal) / slope;
  return intersectAllowed(
    allowed,
    Math.min(first, second),
    Math.max(first, second)
  );
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
  let allowed: LambdaInterval[] = [[0, 1]];
  const conflicts: LambdaConflict[] = [];
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
      allowed = constrainAffineToEnvelope(
        allowed,
        sampleCompactPathPlanOffset(track, idealPlan, index, progress),
        sampleCompactPathPlanOffset(track, fullPlan, index, progress),
        envelope.minimum,
        envelope.maximum
      );
      if (!allowed.length) return null;
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
    for (let stationIndex = 0;
      stationIndex < claim.stations.length;
      stationIndex++) {
      const stationTime = claim.stations.time[stationIndex]!;
      const stationS = claim.stations.s[stationIndex]!;
      const egoS = (
        entry.car.s + Math.max(0, entry.spd) * stationTime
      ) % track.len;
      if (Math.abs(signedTrackDistance(track, egoS, stationS)) >
          PHYS.carLen)
        continue;
      const index = cyclicIndex(track, egoS / track.step);
      const egoProgress = entry.prog +
        Math.max(0, entry.spd) * stationTime;
      const y0 = sampleCompactPathPlanOffset(
        track,
        idealPlan,
        index,
        egoProgress
      );
      const y1 = sampleCompactPathPlanOffset(
        track,
        fullPlan,
        index,
        egoProgress
      );
      const slope = y1 - y0;
      const overlap = PHYS.carWid;
      const stationLateral = claim.stations.y[stationIndex]!;
      const lower = stationLateral - overlap;
      const upper = stationLateral + overlap;
      if (Math.abs(slope) <= Number.EPSILON) {
        // This station belongs to the acquisition prefix shared by every λ.
        // It cannot inform the side-family seed; continuous collision pricing
        // and hard feasibility still evaluate it after the seed is authored.
        continue;
      }
      conflicts.push({
        ideal: y0,
        slope,
        centre: stationLateral,
        overlap
      });
      const first = (lower - y0) / slope;
      const second = (upper - y0) / slope;
      allowed = subtractForbidden(
        allowed,
        Math.min(first, second),
        Math.max(first, second)
      );
    }
  }
  if (!allowed.length) {
    const breakpoints = new Set<number>([1]);
    for (const conflict of conflicts)
      for (const edge of [-conflict.overlap, conflict.overlap])
        breakpoints.add(clamp(
          (conflict.centre + edge - conflict.ideal) / conflict.slope,
          0,
          1
        ));
    let bestLambda: number | null = null;
    let bestOverlap = Infinity;
    for (const lambda of breakpoints) {
      if (lambda <= Number.EPSILON) continue;
      let totalOverlap = 0;
      for (const conflict of conflicts) {
        const separation = Math.abs(
          conflict.ideal + lambda * conflict.slope - conflict.centre
        );
        totalOverlap += Math.max(
          0,
          1 - separation / Math.max(Number.EPSILON, conflict.overlap)
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
    return { lambda: allowed.at(-1)![1] };
  const distinct = allowed.find(([, to]) => to > Number.EPSILON);
  if (!distinct) return null;
  // λ=0 is the ideal member already evaluated separately. A lateral family
  // member must remain a distinct response even when the ideal is clear.
  return {
    lambda: distinct[0] > Number.EPSILON ? distinct[0] : distinct[1]
  };
}

function seededSideCandidate(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  kind: 'corner-inside' | 'corner-outside',
  full: DynamicPlan,
  preferMaximum = false,
  enforceOneMove = true,
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
  const targetProgress = horizonProgress(entry);
  const targetIndex = indexAtProgress(session.trk, entry, targetProgress);
  const target = sampleCompactPathPlanOffset(
    session.trk,
    plan,
    targetIndex,
    targetProgress
  );
  const seed = (!enforceOneMove ||
      racecraftOneMoveLegal(session, entry, entries, kind, target))
    ? { kind, plan, slowPointOwnerCode: null }
    : null;
  return seed;
}

export function racecraftDefensiveAttacker(
  session: Session,
  defender: Entry,
  entries: readonly Entry[],
  targetLateral: number
): Entry | null {
  if (!defender.car) return null;
  const nearest = activeDefensiveAttacker(
    session,
    defender as ActiveEntry,
    entries
  )?.entry ?? null;
  if (!nearest) return null;
  return Math.abs(targetLateral - nearest.latNow) <
    Math.abs(defender.latNow - nearest.latNow)
    ? nearest
    : null;
}

export function racecraftOneMoveLegal(
  session: Session,
  defender: Entry,
  entries: readonly Entry[],
  kind: RacecraftCandidateKind,
  targetLateral: number
): boolean {
  if (kind === 'hold' || kind === 'brake-behind') return true;
  const attacker = racecraftDefensiveAttacker(
    session,
    defender,
    entries,
    targetLateral
  );
  if (!attacker ||
      defender._defSeenAttackers?.[attacker.code] !== true) return true;
  return defender._racecraftAppliedKind === kind;
}

function brakeBehindSeed(
  session: Session,
  entry: ActiveEntry,
  leader: ActiveEntry
): RacecraftCandidateSeed {
  return {
    kind: 'brake-behind',
    plan: {
      ...currentProgramPlan(session, entry),
      key: `cost:${entry.code}:brake-behind:${leader.code}:` +
        cyclicIndex(session.trk, entry.car.progIdx),
      topology: 'brake',
      leaderCode: leader.code
    },
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
  const incumbentKind = entry._racecraftAppliedKind ??
    entry.racecraftDecision?.selectedKind ??
    'hold';
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
    for (const kind of [
      'corner-inside',
      'corner-outside'
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
            true,
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
            true,
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
  // second labelled copy would consume the emergency-response budget.
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
  shareRivalSnapshot = false
): number {
  if (!evaluationClaims.size) return 0;
  const ownS = wrappedTrackS(
    session.trk,
    entry.car.s + progress - entry.prog
  );
  let nearest: CandidateTowRivalSnapshot | undefined;
  let byProgress: Map<number, CandidateTowRivalSnapshot> | undefined;
  if (shareRivalSnapshot) {
    let byEntry = candidateTowRivalSnapshots.get(evaluationClaims);
    if (!byEntry) {
      byEntry = new WeakMap();
      candidateTowRivalSnapshots.set(evaluationClaims, byEntry);
    }
    byProgress = byEntry.get(entry);
    if (!byProgress) {
      byProgress = new Map();
      byEntry.set(entry, byProgress);
    }
    nearest = byProgress.get(progress);
    if (nearest) evaluatorWork(session).rivalStateCacheHits++;
  }
  let nearestCode = nearest?.code ?? null;
  let nearestDownstream = nearest?.downstream ?? 0;
  let nearestLateral = nearest?.lateral ?? 0;
  if (!nearest) {
    for (const [code, view] of evaluationClaims) {
      if (code === entry.code) continue;
      const rival = writeRacecraftClaimStateAtTime(
        session.trk,
        view.claim,
        time,
        candidateTowStateScratch
      );
      const downstream = forwardTrackDistance(
        session.trk,
        ownS,
        rival.s
      );
      if (downstream > TRAFFIC_NEIGHBOR_SCAN_METRES) continue;
      if (nearestCode == null ||
          downstream < nearestDownstream - Number.EPSILON ||
          (Math.abs(downstream - nearestDownstream) <= Number.EPSILON &&
            code.localeCompare(nearestCode) < 0)) {
        nearestCode = code;
        nearestDownstream = downstream;
        nearestLateral = rival.lateral;
      }
    }
    if (byProgress)
      byProgress.set(progress, {
        code: nearestCode,
        downstream: nearestDownstream,
        lateral: nearestLateral
      });
    evaluatorWork(session).rivalStateBuilds++;
  }
  if (nearestCode == null) return 0;
  const calibration = racecraftCalibration();
  return wakeEffect(
    nearestDownstream,
    nearestLateral - lateral,
    speed,
    {
      characteristicDistance: calibration.towRangeM,
      spreadRate: calibration.wakeSpreadRate
    }
  ).drag;
}

function candidateDragScale(
  session: Session,
  entry: Entry,
  towStrength?: number
): number {
  const current = evaluatorDynamics(session, entry).modifiers.dr;
  if (towStrength == null) return current;
  const reduction = racecraftCalibration().towDragReduction;
  const currentFactor = Math.max(
    Number.EPSILON,
    1 - reduction * clamp(entry.tow || 0, 0, 1)
  );
  const base = current / currentFactor;
  return base * (
    1 - reduction * clamp(towStrength, 0, 1)
  );
}

function driveAcceleration(
  session: Session,
  entry: Entry,
  speed: number,
  curvature: number,
  dynamicMu?: number,
  surfaceDrag = 0,
  towStrength?: number
): number {
  const dynamics = evaluatorDynamics(session, entry);
  const modifiers = dynamics.modifiers;
  const force = Math.min(
    PHYS.Fmax * modifiers.pw,
    PHYS.power * modifiers.pw / Math.max(4, speed)
  );
  const resistance =
    PHYS.kDrag * candidateDragScale(
      session,
      entry,
      towStrength
    ) * speed * speed +
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
  session: Session,
  entry: Entry,
  speed: number,
  surfaceDrag: number,
  towStrength?: number
): number {
  return (
    PHYS.kDrag * candidateDragScale(
      session,
      entry,
      towStrength
    ) * speed * speed +
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
  if (progress <= law.progress[0]!) return law.speed[0]!;
  for (let index = 1; index < law.progress.length; index++) {
    if (progress > law.progress[index]!) continue;
    const fromProgress = law.progress[index - 1]!;
    const toProgress = law.progress[index]!;
    const u = (progress - fromProgress) /
      Math.max(Number.EPSILON, toProgress - fromProgress);
    return law.speed[index - 1]! +
      (law.speed[index]! - law.speed[index - 1]!) * clamp(u, 0, 1);
  }
  return law.speed.at(-1)!;
}

function speedLawAddsConstraint(
  reference: CandidateSpeedLaw,
  constrained: CandidateSpeedLaw
): boolean {
  if (reference.progress.length !== constrained.progress.length ||
      reference.speed.length !== constrained.speed.length)
    return true;
  return constrained.speed.some((speed, index) =>
    speed < reference.speed[index]! - Number.EPSILON);
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
  effortOverride?: number
): CandidateSpeedLaw {
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
  evaluatorWork(session).speedLawSamples += count;
  const progress: number[] = [];
  const speed: number[] = [];
  const states: LaneState[] = [];
  const source: Array<EntryTrafficSlowPoint | null> = [];
  for (let slot = 0; slot < count; slot++) {
    const at = entry.prog + slot * track.step;
    const state = laneStateAt(session, entry, at, plan);
    progress.push(at);
    states.push(state);
    speed.push(state.targetSpeed);
    source.push(null);
  }
  const owner = slowPointOwnerCode
    ? entries.find((candidate): candidate is ActiveEntry =>
      candidate.code === slowPointOwnerCode && !!candidate.car)
    : null;
  if (owner) {
    const divergence = oneIntervalPhysicalDivergence(session, owner);
    const claim = evaluationClaims.get(owner.code)?.claim;
    const constraints: Array<{
      stationS: number;
      speed: number;
      publishedAt: number;
    }> = [{
      stationS: claim?.originS ?? owner.car.s,
      speed: claim?.originSpeed ?? owner.spd,
      publishedAt: claim?.publishedAt ?? session.t
    }];
    if (claim)
      for (let stationIndex = 0;
        stationIndex < claim.stations.length;
        stationIndex++)
        constraints.push({
          stationS: claim.stations.s[stationIndex]!,
          speed: claim.stations.v[stationIndex]!,
          publishedAt: claim.publishedAt
        });
    for (const constraint of constraints) {
      const clearanceDistance = Math.max(
        0,
        forwardTrackDistance(track, entry.car.s, constraint.stationS) -
          PHYS.carLen - divergence
      );
      const slot = Math.min(
        count - 1,
        Math.ceil(clearanceDistance / track.step)
      );
      if (constraint.speed >= speed[slot]! - Number.EPSILON) continue;
      speed[slot] = Math.max(0, constraint.speed);
      source[slot] = {
        distance: clearanceDistance,
        speed: Math.max(0, constraint.speed),
        ownerCode: owner.code,
        reason: 'traffic-follow:cost-candidate',
        stationS: (entry.car.s + clearanceDistance) % track.len,
        publishedAt: constraint.publishedAt
      };
    }
  }
  for (let slot = count - 2; slot >= 0; slot--) {
    const state = states[slot]!;
    const localSpeed = Math.max(0, speed[slot]!);
    const estimatedTime = Math.max(
      0,
      progress[slot]! - entry.prog
    ) / Math.max(Number.EPSILON, entry.spd || entry.car.spd);
    const tow = candidateTowStrength(
      session,
      entry,
      progress[slot]!,
      estimatedTime,
      state.lateral,
      localSpeed,
      evaluationClaims,
      true
    );
    const room = longitudinalAccelerationHeadroom(
      localSpeed,
      state.curvature,
      state.dynamicMu,
      dynamics.downforceScale
    );
    const braking = brakingEffort * room +
      passiveDeceleration(
        session,
        entry,
        localSpeed,
        state.surfaceDrag,
        tow
      );
    const allowed = Math.sqrt(
      speed[slot + 1]! * speed[slot + 1]! +
        2 * braking * state.q * track.step
    );
    if (allowed < speed[slot]! - Number.EPSILON) {
      speed[slot] = allowed;
      source[slot] = source[slot + 1] ?? null;
    }
  }
  return {
    progress,
    speed,
    brakingEffort,
    slowPoint: source[0] ?? null
  };
}

function nextProgramSpeed(
  session: Session,
  entry: ActiveEntry,
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
    evaluatorDynamics(session, entry).downforceScale
  );
  if (target < speed) {
    const deceleration = Math.max(
      0,
      brakingEffort * headroom +
        passiveDeceleration(
          session,
          entry,
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
      session,
      entry,
      speed,
      state.curvature,
      state.dynamicMu,
      state.surfaceDrag,
      towStrength
    ) * seconds
  ));
}

function advanceReferenceGeometrySpeed(
  session: Session,
  entry: ActiveEntry,
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
    evaluatorDynamics(session, entry).downforceScale
  );
  if (targetSpeed < speed) {
    const deceleration =
      brakingEffort * headroom +
      passiveDeceleration(
        session,
        entry,
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
    session,
    entry,
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
  const margin = evaluatorDynamics(session, entry).margin;
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
      session,
      entry,
      state,
      distance,
      candidateSpeed,
      targetSpeed,
      candidateBrakingEffort
    );
    const referenceNext = advanceReferenceGeometrySpeed(
      session,
      entry,
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
  const track = session.trk;
  const margin = evaluatorDynamics(session, entry).margin;
  const distance = Math.max(8, entry.spd) *
    MANEUVER_PREDICTION.horizonSeconds;
  const segments = Math.max(1, Math.ceil(distance / track.step));
  const ds = distance / segments;
  let total = 0;
  for (let segment = 0; segment < segments; segment++) {
    const progress = entry.prog + (segment + 0.5) * ds;
    const index = indexAtProgress(track, entry, progress);
    const state = laneStateAt(session, entry, progress, plan);
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
      state.q / Math.max(Number.EPSILON, candidateSpeed) -
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
  for (let sample = 1; sample <= MANEUVER_PREDICTION.samples; sample++) {
    const time = maneuverPredictionStationTime(sample);
    const stepSeconds = time - previousTime;
    const state = laneStateAt(
      session,
      entry,
      progress,
      plan
    );
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
      session,
      entry,
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
    const lane = laneStateAt(
      session,
      entry,
      progress,
      plan
    );
    stations.push({
      time,
      progress,
      s: (entry.car.s + progress - entry.prog) % session.trk.len,
      lateral: lane.lateral,
      speed,
      headingOffsetRadians: lane.headingOffsetRadians
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
    const state = laneStateAt(
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

function evaluateSeed(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  seed: RacecraftCandidateSeed,
  previousKind: RacecraftCandidateKind | null,
  evaluationClaims: EvaluationClaimMap,
  measureOwnTime = true,
  precomposedSpeedLaw?: CandidateSpeedLaw
): CandidateProgram {
  evaluatorWork(session).seedEvaluations++;
  const speedLaw = precomposedSpeedLaw ?? composeCandidateSpeedLaw(
    session,
    entry,
    seed.plan,
    seed.slowPointOwnerCode,
    entries,
    evaluationClaims
  );
  const stations = programStations(
    session,
    entry,
    seed.plan,
    speedLaw,
    evaluationClaims
  );
  const ownTime = measureOwnTime
    ? ownTimeSeconds(
        session,
        entry,
        seed.plan,
        stations,
        speedLaw.brakingEffort
      )
    : 0;
  let samplerContext = evaluatorManeuverSamplerContexts.get(entry);
  if (!samplerContext) {
    samplerContext = {
      session,
      entry,
      plan: seed.plan,
      states: new Map(),
      diagnostic: undefined
    };
    evaluatorManeuverSamplerContexts.set(entry, samplerContext);
  }
  samplerContext.session = session;
  samplerContext.entry = entry;
  samplerContext.plan = seed.plan;
  samplerContext.states.clear();
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
  const targetLateral = stations.at(-1)!.lateral;
  const authoredTerminal = seed.plan.mode !== 'ideal' &&
      seed.plan.mode !== 'pit' &&
      (seed.plan.mode === 'side-inside' ||
        seed.plan.mode === 'side-outside')
    ? seed.plan.anchors
        .map(anchor => anchor.s)
        .filter((value): value is number =>
          value != null &&
          value > stations.at(-1)!.progress + Number.EPSILON)
        .at(-1)
    : null;
  const utilizationStations = authoredTerminal != null &&
      authoredTerminal - entry.prog <= session.trk.len / 2
    ? [
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
      ]
    : stations;
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
    feasible: diagnostic.feasible,
    vetoes: [...diagnostic.rejections],
    targetLateral,
    slowPointOwnerCode: seed.slowPointOwnerCode,
    slowPoint: speedLaw.slowPoint,
    interactionCause: obligationsFor(session, entry, entries)[0]?.reason ??
      (seed.slowPointOwnerCode ? 'draft' : 'ordinary'),
    ownTimeSeconds: ownTime,
    billSeconds: 0,
    recourseSeconds: 0,
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
    emergencyHazards: new Map(),
    perturbations: new Map(),
    bounds: new Map(),
    positionGains: new Map(),
    authoredExtensions: new Map(),
    evaluationClaims,
    utilizationExposureSeconds: grip.exposureSeconds,
    utilizationExposure: grip.exposure
  };
}

export function snapshotContestedRegion(
  track: Track,
  ownClaim: RacecraftClaim,
  otherClaim: RacecraftClaim
): RacecraftContestedRegion | null {
  const count = Math.min(
    ownClaim.stations.length,
    otherClaim.stations.length
  );
  let previousOwnS = ownClaim.originS;
  let previousOtherS = otherClaim.originS;
  let previousOwnLateral = ownClaim.originCentre;
  let previousOtherLateral = otherClaim.originCentre;
  let previousOwnHeading = ownClaim.originHeadingOffsetRadians;
  let previousOtherHeading =
    otherClaim.originHeadingOffsetRadians;
  let previousLongitudinal = signedTrackDistance(
    track,
    previousOwnS,
    previousOtherS
  );
  let previousLateral = previousOtherLateral - previousOwnLateral;
  let previousTime = 0;
  for (let stationIndex = 0; stationIndex < count; stationIndex++) {
    const ownS = ownClaim.stations.s[stationIndex]!;
    const otherS = otherClaim.stations.s[stationIndex]!;
    const ownLateral = ownClaim.stations.y[stationIndex]!;
    const otherLateral = otherClaim.stations.y[stationIndex]!;
    const ownTime = ownClaim.stations.time[stationIndex]!;
    const otherTime = otherClaim.stations.time[stationIndex]!;
    const ownHeading = ownClaim.stations.heading[stationIndex]!;
    const otherHeading = otherClaim.stations.heading[stationIndex]!;
    const longitudinal = signedTrackDistance(
      track,
      ownS,
      otherS
    );
    const lateral = otherLateral - ownLateral;
    const elapsed = Math.max(
      Number.EPSILON,
      Math.min(ownTime, otherTime) - previousTime
    );
    const sweep = sweptCarContactIntervals(
      previousLongitudinal,
      previousLateral,
      longitudinal,
      lateral,
      normAng(
        previousOwnHeading +
        normAng(
          ownHeading - previousOwnHeading
        ) / 2
      ),
      normAng(
        previousOtherHeading +
        normAng(
          otherHeading - previousOtherHeading
        ) / 2
      )
    )[0];
    if (sweep) {
      const fraction = sweep.enterFraction;
      const ownDistance = forwardTrackDistance(
        track,
        previousOwnS,
        ownS
      );
      const contactOwnS = (
        previousOwnS + ownDistance * fraction
      ) % track.len;
      const otherDistance = forwardTrackDistance(
        track,
        stationIndex === 0
          ? otherClaim.originS
          : previousOtherS,
        otherS
      );
      const contactOtherS = (
        (stationIndex === 0
          ? otherClaim.originS
          : previousOtherS) +
        otherDistance * fraction
      ) % track.len;
      const regionS = (
        contactOwnS +
        signedTrackDistance(track, contactOwnS, contactOtherS) / 2 +
        track.len
      ) % track.len;
      return {
        index: cyclicIndex(track, regionS / track.step),
        s: regionS,
        time: previousTime +
          (ownTime - previousTime) * fraction
      };
    }
    previousOwnS = ownS;
    previousOtherS = otherS;
    previousOwnLateral = ownLateral;
    previousOtherLateral = otherLateral;
    previousOwnHeading = ownHeading;
    previousOtherHeading = otherHeading;
    previousLongitudinal = longitudinal;
    previousLateral = lateral;
    previousTime = Math.min(ownTime, otherTime);
  }
  return null;
}

function hazardsFor(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  evaluationClaims: EvaluationClaimMap
): Hazard[] {
  const hazards: Hazard[] = [];
  const ownPrediction = evaluationClaims.get(entry.code);
  const ownClaim = ownPrediction?.claim;
  for (const other of entries) {
    if (!racecraftIsInteractionNeighbor(session, entry, other)) continue;
    const prediction = evaluationClaims.get(other.code);
    if (!prediction?.claim.stations.length) continue;
    const claim = prediction.claim;
    const hazard: Hazard = {
      key: `${entry.code}:${other.code}`,
      other: other as ActiveEntry,
      claim,
      originS: claim.originS,
      originLateral: claim.originCentre,
      originHeadingOffsetRadians:
        claim.originHeadingOffsetRadians,
      ownClaim: ownClaim ?? null,
      region: undefined,
      adaptResponsibility: null,
      rivalSweepGeometry: null,
      bestPlanContinuation: null,
      bestPlanContinuationResolved: false
    };
    hazards.push(hazard);
  }
  evaluatorWork(session).hazardsBuilt += hazards.length;
  return hazards;
}

function programStationAt(
  stations: readonly ProgramStation[],
  stationIndex: number
): ProgramStation {
  return stations[Math.min(stationIndex + 1, stations.length - 1)]!;
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

/**
 * Convert one Frenet point to the fixed world frame consumed by the physical
 * four-circle sweep. Sweeping independently sampled track-frame coordinates
 * would rotate the frame between samples and invent non-physical closing
 * speeds in curved or long terminal rollouts.
 */
function worldBodyPose(
  track: Track,
  s: number,
  lateral: number,
  headingOffsetRadians: number
): WorldBodyPose {
  const sample = wrappedTrackS(track, s) / track.step;
  const fromIndex = Math.floor(sample) % track.n;
  const toIndex = (fromIndex + 1) % track.n;
  const amount = sample - Math.floor(sample);
  const tangentFrom = Math.atan2(
    track.ty[fromIndex]!,
    track.tx[fromIndex]!
  );
  const tangentTo = tangentFrom + normAng(
    Math.atan2(track.ty[toIndex]!, track.tx[toIndex]!) -
      tangentFrom
  );
  const tangent = tangentFrom +
    (tangentTo - tangentFrom) * amount;
  const centreX = track.x[fromIndex]! +
    (track.x[toIndex]! - track.x[fromIndex]!) * amount;
  const centreY = track.y[fromIndex]! +
    (track.y[toIndex]! - track.y[fromIndex]!) * amount;
  return {
    x: centreX - Math.sin(tangent) * lateral,
    y: centreY + Math.cos(tangent) * lateral,
    headingRadians: normAng(tangent + headingOffsetRadians)
  };
}

function relativeWorldBodyPose(
  track: Track,
  ego: {
    s: number;
    lateral: number;
    headingOffsetRadians: number;
  },
  rival: {
    s: number;
    lateral: number;
    headingOffsetRadians: number;
  }
): {
  relativeLongitudinal: number;
  relativeLateral: number;
  egoHeadingRadians: number;
  rivalHeadingRadians: number;
} {
  const egoWorld = worldBodyPose(
    track,
    ego.s,
    ego.lateral,
    ego.headingOffsetRadians
  );
  const rivalWorld = worldBodyPose(
    track,
    rival.s,
    rival.lateral,
    rival.headingOffsetRadians
  );
  return {
    relativeLongitudinal: rivalWorld.x - egoWorld.x,
    relativeLateral: rivalWorld.y - egoWorld.y,
    egoHeadingRadians: egoWorld.headingRadians,
    rivalHeadingRadians: rivalWorld.headingRadians
  };
}

function relativeWorldPose(
  egoWorld: WorldBodyPose,
  rivalWorld: WorldBodyPose
): {
  relativeLongitudinal: number;
  relativeLateral: number;
  egoHeadingRadians: number;
  rivalHeadingRadians: number;
} {
  return {
    relativeLongitudinal: rivalWorld.x - egoWorld.x,
    relativeLateral: rivalWorld.y - egoWorld.y,
    egoHeadingRadians: egoWorld.headingRadians,
    rivalHeadingRadians: rivalWorld.headingRadians
  };
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
    claim.stations.length
  );
  for (let index = 0; index < claim.stations.length; index++)
    stationGeometry[index] = worldBodyPose(
      track,
      claim.stations.s[index]!,
      claim.stations.y[index]!,
      claim.stations.heading[index]!
    );
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

function publicationRevision(
  session: Session,
  entry: Entry
): number {
  return session.racecraftClaims
    ?.get(entry.code)
    ?.publicationRevision ?? -1;
}

function certificateClaimRevisions(
  session: Session,
  neighbors: readonly Entry[]
): Record<string, number> {
  const revisions: Record<string, number> = Object.create(null);
  for (const neighbor of neighbors)
    revisions[neighbor.code] = publicationRevision(session, neighbor);
  return revisions;
}

function agreementAuthorityTuple(
  session: Session,
  entry: Entry,
  neighbor: Entry
): readonly unknown[] | null {
  const agreement = session.sideAgreements?.get(
    racecraftPairKey(entry.code, neighbor.code)
  );
  if (!agreement) return null;
  return [
    neighbor.code,
    agreement.side,
    agreement.separatorEta,
    agreement.centreClearance,
    agreement.since,
    agreement.familyCertificate.contextKey,
    agreement.familyCertificate.originS,
    agreement.familyCertificate.spanMetres,
    agreement.familyCertificate.lowerFamilyKey,
    agreement.familyCertificate.upperFamilyKey
  ];
}

/**
 * Exact discrete authority state. Continuous geometry and objective drift have
 * no theorem-backed Tier-0 band yet, so they are covered only by schedule
 * expiry; this key contains no inferred tolerance.
 */
export function racecraftDecisionAuthorityKey(
  session: Session,
  entry: Entry,
  neighbors: readonly Entry[]
): string {
  const ordered = [...neighbors].sort((left, right) =>
    left.code.localeCompare(right.code));
  const agreements = ordered
    .map(neighbor => agreementAuthorityTuple(session, entry, neighbor))
    .filter((value): value is readonly unknown[] => value != null);
  const outgoingObligations = obligationsFor(
    session,
    entry,
    [entry, ...ordered]
  ).map(obligation => [
    'out',
    obligation.reason,
    obligation.beneficiary.code
  ]);
  const incomingObligations = ordered.flatMap(neighbor =>
    obligationsFor(session, neighbor, [neighbor, entry])
      .filter(obligation => obligation.beneficiary === entry)
      .map(obligation => [
        'in',
        obligation.reason,
        neighbor.code
      ]));
  const obligations = [
    ...outgoingObligations,
    ...incomingObligations
  ].sort((left, right) => JSON.stringify(left).localeCompare(
    JSON.stringify(right)
  ));
  const attackers = ordered.flatMap(neighbor => {
    const decision = neighbor.racecraftDecision;
    const selected = decision?.candidates.find(candidate =>
      candidate.planNumericId === decision.selectedPlanNumericId);
    if (!selected || selected.kind === 'hold' ||
        selected.kind === 'brake-behind' ||
        selected.plan.mode === 'ideal' || selected.plan.mode === 'pit' ||
        selected.plan.leaderCode !== entry.code)
      return [];
    return [racecraftStableFamilyId(
      selected.kind,
      selected.plan,
      selected.slowPointOwnerCode
    )];
  }).sort();
  const defendedAgainst = Object.entries(entry._defSeenAttackers ?? {})
    .filter(([, active]) => active)
    .map(([code]) => code)
    .sort();
  return JSON.stringify([
    entry.state,
    entry.pathPlan?.mode ?? '',
    entry.car?.offCourse === true,
    entry.recT > 0,
    entry.avoidT > 0,
    entry.pitArm != null,
    entry.boxArm,
    entry._racecraftAppliedKind ?? '',
    entry.laneEdits ?? 0,
    entry.laneProgram.binding ?? '',
    entry.laneProgram.surfaceAuthorization ?? 'normal',
    defendedAgainst,
    attackers,
    agreements,
    obligations
  ]);
}

function exactInteractionNeighbors(
  session: Session,
  entry: Entry,
  entries: readonly Entry[]
): Entry[] {
  return entries
    .filter(other => racecraftIsInteractionNeighbor(session, entry, other))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function makeDecisionCertificate(
  session: Session,
  entry: Entry,
  neighbors: readonly Entry[],
  selectedFamilyNumericId: number | null,
  selectedFamilyId: string | null,
  zeroHazardIdeal: boolean
): RacecraftDecision['certificate'] {
  const ordered = [...neighbors].sort((left, right) =>
    left.code.localeCompare(right.code));
  return {
    selectedFamilyNumericId,
    selectedFamilyId,
    neighborCodes: ordered.map(neighbor => neighbor.code),
    claimRevisions:
      certificateClaimRevisions(session, ordered),
    authorityKey: racecraftDecisionAuthorityKey(session, entry, ordered),
    // β-drift and live-feasibility bands are not presently derivable. The
    // declared deliberation interval is the conservative resolution ceiling.
    validUntil: zeroHazardIdeal && ordered.length === 0
      ? Infinity
      : session.t + RACECRAFT_DECISION_INTERVAL_SECONDS,
    zeroHazardIdeal
  };
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sameRevisionRecord(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return sameStringArray(leftKeys, rightKeys) &&
    leftKeys.every(key => left[key] === right[key]);
}

function samePredictionClass(
  previous: RacecraftClaim,
  current: RacecraftClaim
): boolean {
  return previous.code === current.code &&
    previous.source === current.source &&
    previous.trusted === current.trusted &&
    previous.predictionKey === current.predictionKey &&
    previous.lateralAuthorityRevision ===
      current.lateralAuthorityRevision &&
    previous.longitudinalAuthorityRevision ===
      current.longitudinalAuthorityRevision;
}

/**
 * Re-express a revised point publication on the standing decision's absolute
 * time grid. Points that have already happened remain frozen; only the
 * affected hazard's still-future binding support is rebound.
 */
function rebindClaimToStandingEpoch(
  track: Track,
  previous: RacecraftClaim,
  current: RacecraftClaim,
  elapsed: number
): RacecraftClaim {
  const stations = createRacecraftClaimStations(
    previous.stations.length
  );
  stations.length = previous.stations.length;
  for (let index = 0; index < stations.length; index++) {
    const stationTime = previous.stations.time[index]!;
    stations.time[index] = stationTime;
    if (stationTime <= elapsed + Number.EPSILON) {
      stations.s[index] = previous.stations.s[index]!;
      stations.v[index] = previous.stations.v[index]!;
      stations.y[index] = previous.stations.y[index]!;
      stations.heading[index] = previous.stations.heading[index]!;
      continue;
    }
    const rebound = racecraftClaimStateAtTime(
      track,
      current,
      stationTime - elapsed
    );
    stations.s[index] = rebound.s;
    stations.v[index] = rebound.speed;
    stations.y[index] = rebound.lateral;
    stations.heading[index] = rebound.headingOffsetRadians;
  }
  return {
    ...previous,
    publicationRevision: current.publicationRevision,
    stations
  };
}

function cloneProgramForIncrementalRecheck(
  program: CandidateProgram
): CandidateProgram {
  const vetoes = program.evaluation.vetoes.filter(veto =>
    veto !== 'predicted-hard-contact');
  return {
    ...program,
    evaluation: {
      ...program.evaluation,
      feasible: vetoes.length === 0,
      vetoes,
      billSeconds: 0,
      recourseSeconds: 0,
      battleSpendSeconds: 0,
      effortRiskSeconds: 0,
      minimumPlannedClearanceMetres: null,
      hazardCount: 0,
      cost: Infinity
    },
    emergencyHazards: new Map(),
    perturbations: new Map(),
    bounds: new Map(),
    positionGains: new Map(program.positionGains),
    authoredExtensions: new Map(program.authoredExtensions)
  };
}

function repriceFrozenProgramAgainstClaims(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  program: CandidateProgram,
  evaluationClaims: EvaluationClaimMap
): CandidateProgram {
  const rebound = cloneProgramForIncrementalRecheck(program);
  if (!rebound.evaluation.feasible) return rebound;
  const plan = rebound.evaluation.plan;
  const speedLaw = composeCandidateSpeedLaw(
    session,
    entry,
    plan,
    rebound.evaluation.slowPointOwnerCode,
    entries,
    evaluationClaims,
    rebound.speedLaw.brakingEffort
  );
  const stations = programStations(
    session,
    entry,
    plan,
    speedLaw,
    evaluationClaims
  );
  const ownTime = ownTimeSeconds(
    session,
    entry,
    plan,
    stations,
    speedLaw.brakingEffort
  );
  const authoredTerminal = plan.mode !== 'ideal' &&
      plan.mode !== 'pit' &&
      (plan.mode === 'side-inside' ||
        plan.mode === 'side-outside')
    ? plan.anchors
        .map(anchor => anchor.s)
        .filter((value): value is number =>
          value != null &&
          value > stations.at(-1)!.progress + Number.EPSILON)
        .at(-1)
    : null;
  const utilizationStations = authoredTerminal != null &&
      authoredTerminal - entry.prog <= session.trk.len / 2
    ? [
        ...stations.slice(0, -1),
        ...extendedAuthoredProgramStations(
          session,
          entry,
          plan,
          speedLaw,
          stations,
          authoredTerminal,
          evaluationClaims
        )
      ]
    : stations;
  const grip = programGripUtilization(
    session,
    entry,
    plan,
    speedLaw,
    utilizationStations
  );
  return {
    ...rebound,
    evaluation: {
      ...rebound.evaluation,
      ownTimeSeconds: ownTime,
      slowPoint: speedLaw.slowPoint,
      brakingEffort: speedLaw.brakingEffort
    },
    stations,
    speedLaw,
    authoredExtensions: new Map(),
    evaluationClaims,
    utilizationExposureSeconds: grip.exposureSeconds,
    utilizationExposure: grip.exposure
  };
}

function restoreFixedEconomics(programs: readonly CandidateProgram[]): void {
  for (const program of programs) {
    const evaluation = program.evaluation;
    if (!evaluation.feasible || !Number.isFinite(evaluation.cost))
      continue;
    evaluation.battleSpendSeconds = battleSpendSeconds({
      measuredAttemptLossSeconds: evaluation.attemptLossSeconds,
      contestSeconds: evaluation.recourseSeconds,
      measuredProximitySeconds: evaluation.proximitySeconds
    });
    evaluation.cost +=
      evaluation.positionValueSeconds +
      evaluation.attemptLossSeconds +
      evaluation.proximitySeconds;
  }
}

/**
 * A point revision is new publication information, but it need not invalidate
 * an argmin that does not consume the changed points. Rebind the revised
 * hazard to the frozen candidate programs, then spend β on the full
 * candidate-minus-incumbent J difference. The selected speed law is part of
 * the certified decision and is not re-authored by this check; a β break
 * delegates that work to full deliberation.
 */
function incrementalClaimRevisionIsInsideTieBand(
  session: Session,
  entry: ActiveEntry,
  currentRevisions: Record<string, number>
): boolean {
  const decision = entry.racecraftDecision;
  if (!decision) return false;
  const snapshot = standingDecisionEvaluations.get(decision);
  if (!snapshot?.selected) return false;
  const triggerCodes = Object.keys(currentRevisions).filter(code =>
    currentRevisions[code] !== decision.certificate.claimRevisions[code]
  );
  if (!triggerCodes.length) return false;
  const elapsed = session.t - snapshot.at;
  if (!Number.isFinite(elapsed) || elapsed < 0 ||
      elapsed > RACECRAFT_DECISION_INTERVAL_SECONDS +
        Number.EPSILON)
    return false;

  const evaluationClaims =
    new Map<string, RacecraftEvaluationClaim>(
      snapshot.evaluationClaims
    );
  for (const changedCode of triggerCodes) {
    const previous = snapshot.evaluationClaims.get(changedCode)?.claim;
    const current = session.racecraftClaims?.get(changedCode);
    if (!previous || !current ||
        !samePredictionClass(previous, current))
      return false;
  }
  const reboundCodes = snapshot.hazards
    .map(hazard => hazard.other.code)
    .filter(code => {
      const previous = snapshot.evaluationClaims.get(code)?.claim;
      const current = session.racecraftClaims?.get(code);
      return previous != null && current != null &&
        previous.publicationRevision !== current.publicationRevision;
    });
  for (const changedCode of reboundCodes) {
    const previous = snapshot.evaluationClaims.get(changedCode)!.claim;
    const current = session.racecraftClaims!.get(changedCode)!;
    if (!samePredictionClass(previous, current)) return false;
    evaluationClaims.set(changedCode, {
      claim: rebindClaimToStandingEpoch(
        session.trk,
        previous,
        current,
        elapsed
      )
    });
  }
  session.racecraftTier0BetaRechecks =
    (session.racecraftTier0BetaRechecks ?? 0) + 1;
  const reboundHazards = snapshot.hazards.map(previous => {
    const rebound = evaluationClaims.get(previous.other.code)?.claim;
    if (!reboundCodes.includes(previous.other.code) || !rebound)
      return previous;
    return {
      ...previous,
      claim: rebound,
      region: undefined,
      adaptResponsibility: null,
      rivalSweepGeometry: null,
      bestPlanContinuation: null,
      bestPlanContinuationResolved: false
    } satisfies Hazard;
  });
  const evaluationSession = snapshot.session;
  const programs = snapshot.programs.map(program =>
    repriceFrozenProgramAgainstClaims(
      evaluationSession,
      snapshot.entry,
      snapshot.entries,
      program,
      evaluationClaims
    ));
  scorePrograms(
    evaluationSession,
    snapshot.entry,
    programs,
    reboundHazards
  );
  restoreFixedEconomics(programs);
  const byPlanKey = new Map(programs.map(program => [
    program.evaluation.plan.key,
    program
  ]));
  const incumbent = byPlanKey.get(
    snapshot.selected.evaluation.plan.key
  );
  if (!incumbent) return false;
  if (!incumbent.evaluation.feasible ||
      !Number.isFinite(incumbent.evaluation.cost))
    return false;
  const best = programs
    .filter(program =>
      program.evaluation.feasible &&
      Number.isFinite(program.evaluation.cost))
    .sort((left, right) =>
      left.evaluation.cost - right.evaluation.cost)[0];
  if (!best) return false;
  if (best !== incumbent) {
    const beta = tieBand(
      evaluationSession,
      snapshot.entry,
      best,
      incumbent,
      reboundHazards,
      programs
    );
    if (best.evaluation.cost + beta <
        incumbent.evaluation.cost) {
      session.racecraftTier0BetaBreaks =
        (session.racecraftTier0BetaBreaks ?? 0) + 1;
      return false;
    }
  }
  decision.certificate = {
    ...decision.certificate,
    claimRevisions: currentRevisions
  };
  session.racecraftTier0BetaAccepts =
    (session.racecraftTier0BetaAccepts ?? 0) + 1;
  return true;
}

/**
 * Whether this selected analytic family owns the lateral controller now.
 * Certificate validation and installation share this predicate so a family
 * deferred behind another authority cannot later be installed from an aged
 * acquisition anchor.
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

function selectedAnalyticAnchorHasAged(
  session: Session,
  entry: Entry,
  neighbors: readonly Entry[]
): boolean {
  const decision = entry.racecraftDecision;
  const selected = decision?.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  if (!selected || selected.kind === 'hold' ||
      selected.kind === 'brake-behind' ||
      selected.plan.mode === 'ideal' || selected.plan.mode === 'pit' ||
      !racecraftSelectedLaneIsExecutable(
        session,
        entry,
        neighbors,
        selected
      ) ||
      entry.racecraftPathPlan === selected.plan)
    return false;
  const first = selected.plan.anchors[0];
  return !selected.plan.pinnedFirst || !first || first.s == null ||
    Math.abs(first.s - entry.prog) > 1e-9 ||
    Math.abs(first.offset - entry.latNow) > 1e-9;
}

/** The single Tier-0 validity gate. Null means the standing proof still holds. */
export function racecraftDecisionCertificateBreakReason(
  session: Session,
  entry: Entry,
  neighbors: readonly Entry[]
): RacecraftDecisionCertificateBreakReason | null {
  const certificate = entry.racecraftDecision?.certificate;
  if (!certificate) return 'bootstrap';
  const ordered = [...neighbors].sort((left, right) =>
    left.code.localeCompare(right.code));
  if (!sameStringArray(
    certificate.neighborCodes,
    ordered.map(neighbor => neighbor.code)
  )) return 'neighbor-set';
  const currentRevisions =
    certificateClaimRevisions(session, ordered);
  if (!sameRevisionRecord(
    certificate.claimRevisions,
    currentRevisions
  ) && !incrementalClaimRevisionIsInsideTieBand(
    session,
    entry as ActiveEntry,
    currentRevisions
  )) return 'claim-revision';
  if (selectedAnalyticAnchorHasAged(session, entry, ordered))
    return 'authority';
  if (certificate.authorityKey !==
      racecraftDecisionAuthorityKey(session, entry, ordered))
    return 'authority';
  if (session.t + Number.EPSILON >= certificate.validUntil) return 'expiry';
  return null;
}

/**
 * Absorb authority written by installation in the same arbitration epoch.
 * This does not extend a standing decision; callers use it only for a decision
 * selected or explicitly retained at the current epoch.
 */
export function sealRacecraftDecisionCertificate(
  session: Session,
  entry: Entry,
  neighbors: readonly Entry[]
): void {
  const decision = entry.racecraftDecision;
  if (!decision) return;
  decision.certificate = {
    ...decision.certificate,
    authorityKey: racecraftDecisionAuthorityKey(
      session,
      entry,
      neighbors
    )
  };
}

/**
 * An installed emergency publication is retained by tracking/control proof,
 * not by a fresh argmin. Its explicit renewal may absorb the current snapshot.
 */
export function renewPublishedEmergencyCertificate(
  session: Session,
  entry: Entry,
  neighbors: readonly Entry[]
): void {
  const decision = entry.racecraftDecision;
  if (!decision) return;
  decision.certificate = makeDecisionCertificate(
    session,
    entry,
    neighbors,
    decision.certificate.selectedFamilyNumericId,
    decision.certificate.selectedFamilyId,
    decision.certificate.zeroHazardIdeal
  );
}

function oneIntervalProgramWindow(
  session: Session,
  program: CandidateProgram,
  sourceStartTime: number
): CandidateProgram {
  const count = Math.max(
    1,
    Math.ceil(RACECRAFT_DECISION_INTERVAL_SECONDS / TRAF_DT)
  );
  const stations: ProgramStation[] = [];
  for (let sample = 0; sample <= count; sample++) {
    const localTime = RACECRAFT_DECISION_INTERVAL_SECONDS *
      sample / count;
    stations.push({
      ...programStationAtTime(
        session.trk,
        program.stations,
        sourceStartTime + localTime
      ),
      time: localTime
    });
  }
  return { ...program, stations };
}

function oneIntervalHazardWindow(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard,
  sourceStartTime: number
): Hazard {
  const track = session.trk;
  const start = racecraftClaimStateAtTime(
    track,
    hazard.claim,
    sourceStartTime
  );
  const stationCount = Math.max(0, program.stations.length - 1);
  const stations = createRacecraftClaimStations(stationCount);
  stations.length = stationCount;
  for (let index = 0; index < stationCount; index++) {
    const egoStation = program.stations[index + 1]!;
    const absoluteTime = sourceStartTime + egoStation.time;
    const predicted = racecraftClaimStateAtTime(
      track,
      hazard.claim,
      absoluteTime
    );
    stations.time[index] = egoStation.time;
    stations.s[index] = predicted.s;
    stations.v[index] = predicted.speed;
    stations.y[index] = predicted.lateral;
    stations.heading[index] = predicted.headingOffsetRadians;
  }
  return {
    ...hazard,
    originS: start.s,
    originLateral: start.lateral,
    originHeadingOffsetRadians: start.headingOffsetRadians,
    rivalSweepGeometry: null,
    claim: {
      ...hazard.claim,
      publishedAt: session.t + sourceStartTime,
      originS: start.s,
      originCentre: start.lateral,
      originSpeed: start.speed,
      originHeadingOffsetRadians: start.headingOffsetRadians,
      stations
    }
  };
}

interface RelativePointStation {
  timeSeconds: number;
  longitudinalMetres: number;
  lateralMetres: number;
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
  hazard: Hazard,
  lateralPerturbation: {
    stationIndex: number;
    direction: -1 | 1;
  } | null
): RelativePointStation[] {
  let previousLongitudinal = signedTrackDistance(
    session.trk,
    program.stations[0]!.s,
    hazard.originS
  );
  const stations = new Array<RelativePointStation>(
    hazard.claim.stations.length
  );
  for (let index = 0; index < stations.length; index++) {
    const stationTime = hazard.claim.stations.time[index]!;
    const ego = writeProgramStationAtTime(
      session.trk,
      program.stations,
      stationTime,
      programStationScratchA
    );
    const perturbation =
      lateralPerturbation?.stationIndex === index
        ? lateralPerturbation.direction *
          hazard.claim.lateralTrackingErrorThresholdMetres
        : 0;
    const wrappedLongitudinal = signedTrackDistance(
      session.trk,
      ego.s,
      hazard.claim.stations.s[index]!
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
      lateralMetres:
        hazard.claim.stations.y[index]! + perturbation - ego.lateral
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
  lateralPerturbation: {
    stationIndex: number;
    direction: -1 | 1;
  } | null,
  physicalMarginMetres = 0
): RelativePointStation[] | null {
  const work = evaluatorWork(session);
  const stations = relativePointStations(
    session,
    program,
    hazard,
    lateralPerturbation
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
  if (program.bounds.has(hazard.key))
    return program.bounds.get(hazard.key) ?? null;
  const stations = boundedRelativeStations(
    session,
    program,
    hazard,
    null
  );
  program.bounds.set(hazard.key, stations);
  return stations;
}

function firstSweptContact(
  session: Session,
  program: CandidateProgram,
  hazard: Hazard,
  points: readonly RelativePointStation[] =
    relativePointStations(session, program, hazard, null),
  physicalMarginMetres = 0,
  lateralPerturbation: {
    stationIndex: number;
    direction: -1 | 1;
  } | null = null
): SweptContact | null {
  evaluatorWork(session).deterministicSweeps++;
  const origin = program.stations[0]!;
  const rivalGeometry = rivalSweepGeometry(session, hazard);
  const originPose = relativeWorldPose(
    worldBodyPose(
      session.trk,
      origin.s,
      origin.lateral,
      origin.headingOffsetRadians
    ),
    rivalGeometry.origin
  );
  const poses = [{
    timeSeconds: 0,
    ...originPose
  }];
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const ego = writeProgramStationAtTime(
      session.trk,
      program.stations,
      point.timeSeconds,
      programStationScratchA
    );
    const perturbation =
      lateralPerturbation?.stationIndex === index
        ? lateralPerturbation.direction *
          hazard.claim.lateralTrackingErrorThresholdMetres
        : 0;
    const rivalWorld = perturbation === 0
      ? rivalGeometry.stations[index]!
      : worldBodyPose(
          session.trk,
          hazard.claim.stations.s[index]!,
          hazard.claim.stations.y[index]! + perturbation,
          hazard.claim.stations.heading[index]!
        );
    const pose = relativeWorldPose(
      worldBodyPose(
        session.trk,
        ego.s,
        ego.lateral,
        ego.headingOffsetRadians
      ),
      rivalWorld
    );
    poses.push({
      timeSeconds: point.timeSeconds,
      ...pose
    });
  }
  const episodes = sweptCarContactEpisodes(
    poses,
    physicalMarginMetres
  );
  const first = episodes[0];
  if (!first) return null;
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
    maximumRelativeNormalSpeed: Math.max(
      ...episodes.map(episode =>
        episode.maximumRelativeNormalSpeed)
    ),
    stationIndex: first.stationIndex,
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
  const states = progress.map(value =>
    laneStateAt(
      session,
      entry,
      value,
      plan
    ));
  const caps = progress.map((value, index) => {
    const authored = states[index]!.targetSpeed;
    return value <= speedLaw.progress.at(-1)! +
        Number.EPSILON
      ? Math.min(authored, speedLawAt(speedLaw, value))
      : authored;
  });
  caps[0] = Math.min(caps[0]!, start.speed);
  const downforce = evaluatorDynamics(session, entry).downforceScale;
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
          session,
          entry,
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
        session,
        entry,
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
      headingOffsetRadians: nextState.headingOffsetRadians
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
  let stations = program.authoredExtensions.get(targetProgress);
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
    program.authoredExtensions.set(targetProgress, stations);
  }
  return {
    ...program,
    stations
  };
}

function retainBestPlanContinuation(
  session: Session,
  hazard: Hazard,
  value: BestPlanContinuation | null
): BestPlanContinuation | null {
  const claim = hazard.claim;
  const retained = value
    ? cloneBestPlanContinuation(value)
    : null;
  hazard.bestPlanContinuation = retained;
  hazard.bestPlanContinuationResolved = true;
  bestPlanContinuationByClaim.set(claim, {
    session,
    other: hazard.other,
    publishedAt: claim.publishedAt,
    publicationRevision: claim.publicationRevision,
    predictionKey: claim.predictionKey,
    value
  });
  evaluatorWork(session).rivalContinuationBuilds++;
  return retained;
}

function bestPlanContinuationForHazard(
  session: Session,
  hazard: Hazard,
  evaluationClaims: EvaluationClaimMap
): BestPlanContinuation | null {
  if (hazard.bestPlanContinuationResolved)
    return hazard.bestPlanContinuation;
  const claim = hazard.claim;
  const shared = bestPlanContinuationByClaim.get(claim);
  if (shared &&
      shared.session === session &&
      shared.other === hazard.other &&
      shared.publishedAt === claim.publishedAt &&
      shared.publicationRevision === claim.publicationRevision &&
      shared.predictionKey === claim.predictionKey) {
    hazard.bestPlanContinuation = shared.value
      ? cloneBestPlanContinuation(shared.value)
      : null;
    hazard.bestPlanContinuationResolved = true;
    evaluatorWork(session).rivalContinuationCacheHits++;
    return hazard.bestPlanContinuation;
  }
  if (hazard.claim.source === 'ballistic') {
    return retainBestPlanContinuation(session, hazard, null);
  }
  const rival = hazard.other;
  let kind: RacecraftCandidateKind;
  let sourcePlan: PathPlan;
  let slowPointOwnerCode: string | null;
  if (hazard.claim.source === 'rederived') {
    const rederived = rival._racecraftRederivedProgram;
    if (!rederived) {
      return retainBestPlanContinuation(session, hazard, null);
    }
    kind = rederived.kind;
    sourcePlan = rederived.plan;
    slowPointOwnerCode = rederived.slowPointOwnerCode;
  } else {
    const installed = rival.racecraftPathPlan ?? rival.pathPlan;
    kind = installed?.mode === 'pit'
      ? 'hold'
      : rival._racecraftAppliedKind ??
        rival.racecraftDecision?.selectedKind ??
        'ideal';
    sourcePlan = installed ?? IDEAL_PATH_PLAN;
    slowPointOwnerCode =
      rival.racecraftLongitudinalProgram?.slowPointOwnerCode ?? null;
  }
  const familyId = racecraftStableFamilyId(
    kind,
    sourcePlan,
    slowPointOwnerCode
  );
  if (!hazard.claim.predictionKey.endsWith(familyId)) {
    return retainBestPlanContinuation(session, hazard, null);
  }
  const plan = reanchorSelectedFamily(
    session,
    rival,
    sourcePlan
  );
  if (!plan) {
    return retainBestPlanContinuation(session, hazard, null);
  }
  const speedLaw = composeCandidateSpeedLaw(
    session,
    rival,
    plan,
    slowPointOwnerCode,
    session.entries,
    evaluationClaims
  );
  const claimHorizon = hazard.claim.stations.length > 0
    ? hazard.claim.stations.time[hazard.claim.stations.length - 1]!
    : 0;
  const publishedEndpoint = racecraftClaimStateAtTime(
    session.trk,
    hazard.claim,
    claimHorizon
  );
  const endpointDistance = forwardTrackDistance(
    session.trk,
    rival.car.s,
    publishedEndpoint.s
  );
  const continuation = {
    plan,
    speedLaw,
    stations: [{
      time: claimHorizon,
      progress: rival.prog + endpointDistance,
      s: publishedEndpoint.s,
      lateral: publishedEndpoint.lateral,
      speed: publishedEndpoint.speed,
      headingOffsetRadians: publishedEndpoint.headingOffsetRadians
    }],
    evaluationClaims
  };
  return retainBestPlanContinuation(session, hazard, continuation);
}

function bestPlanStateAtTime(
  session: Session,
  hazard: Hazard,
  evaluationClaims: EvaluationClaimMap,
  time: number
): RacecraftClaimState | null {
  const claimHorizon = hazard.claim.stations.length > 0
    ? hazard.claim.stations.time[hazard.claim.stations.length - 1]!
    : 0;
  if (time <= claimHorizon + Number.EPSILON)
    return racecraftClaimStateAtTime(
      session.trk,
      hazard.claim,
      time
    );
  const continuation = bestPlanContinuationForHazard(
    session,
    hazard,
    evaluationClaims
  );
  if (!continuation) return null;
  let stations = continuation.stations;
  if (time > stations.at(-1)!.time + Number.EPSILON) {
    const last = stations.at(-1)!;
    const targetProgress = last.progress +
      PHYS.vTop * (time - last.time) +
      session.trk.step;
    const extension = extendedAuthoredProgramStations(
      session,
      hazard.other,
      continuation.plan,
      continuation.speedLaw,
      continuation.stations,
      targetProgress,
      continuation.evaluationClaims
    );
    stations = [
      ...continuation.stations.slice(0, -1),
      ...extension
    ];
    continuation.stations = stations;
  }
  const state = programStationAtTime(
    session.trk,
    stations,
    time
  );
  return {
    s: state.s,
    lateral: state.lateral,
    speed: state.speed,
    headingOffsetRadians: state.headingOffsetRadians
  };
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
  hazard: Hazard,
  lateralPerturbation: {
    stationIndex: number;
    direction: -1 | 1;
  } | null = null
): SweptContact | null {
  const plan = program.evaluation.plan;
  if (plan.mode === 'ideal' || plan.mode === 'pit' ||
      (plan.mode !== 'side-inside' && plan.mode !== 'side-outside'))
    return null;
  const start = program.stations.at(-1)!;
  const targetProgress = plan.anchors
    .map(anchor => anchor.s)
    .filter((value): value is number =>
      value != null && value > start.progress + Number.EPSILON)
    .at(-1);
  if (targetProgress == null ||
      targetProgress - entry.prog > session.trk.len / 2)
    return null;
  const fullExtension = programExtendedToProgress(
    session,
    entry,
    program,
    targetProgress
  ).stations;
  const extensionStart = Math.max(
    0,
    fullExtension.findIndex(station =>
      station.time >= start.time - Number.EPSILON)
  );
  const extension = fullExtension.slice(extensionStart);
  const perturbation = lateralPerturbation &&
      lateralPerturbation.stationIndex ===
        Math.max(0, hazard.claim.stations.length - 1)
    ? lateralPerturbation.direction *
      hazard.claim.lateralTrackingErrorThresholdMetres
    : 0;
  const poses = [];
  for (const station of extension) {
    const rival = bestPlanStateAtTime(
      session,
      hazard,
      program.evaluationClaims,
      station.time
    );
    if (!rival) return null;
    const pose = relativeWorldBodyPose(
      session.trk,
      station,
      {
        s: rival.s,
        lateral: rival.lateral + perturbation,
        headingOffsetRadians: rival.headingOffsetRadians
      }
    );
    poses.push({
      timeSeconds: station.time,
      ...pose
    });
  }
  const episodes = sweptCarContactEpisodes(poses);
  const first = episodes[0];
  if (!first ||
      first.startTimeSeconds <= start.time + Number.EPSILON)
    return null;
  const ego = programStationAtTime(
    session.trk,
    extension,
    first.startTimeSeconds
  );
  return {
    time: first.startTimeSeconds,
    egoProgress: ego.progress,
    egoSpeed: ego.speed,
    maximumRelativeNormalSpeed: Math.max(
      ...episodes.map(episode =>
        episode.maximumRelativeNormalSpeed)
    ),
    stationIndex: Math.max(0, hazard.claim.stations.length - 1),
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
  stationIndex: number;
  clearanceMetres: number;
} {
  let relativeLongitudinal = signedTrackDistance(
    session.trk,
    program.stations[0]!.s,
    hazard.originS
  );
  let relativeLateral =
    hazard.originLateral - program.stations[0]!.lateral;
  let previousTime = 0;
  let previousOtherHeading =
    hazard.originHeadingOffsetRadians;
  let minimumClearance = Infinity;
  let bindingStationIndex = -1;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const ego = writeProgramStationAtTime(
      session.trk,
      program.stations,
      point.timeSeconds,
      programStationScratchA
    );
    const egoPrevious = writeProgramStationAtTime(
      session.trk,
      program.stations,
      previousTime,
      programStationScratchB
    );
    const egoHeading = normAng(
      egoPrevious.headingOffsetRadians +
      normAng(
        ego.headingOffsetRadians -
        egoPrevious.headingOffsetRadians
      ) / 2
    );
    const rivalHeading = normAng(
      previousOtherHeading +
      normAng(
        hazard.claim.stations.heading[index]! -
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
      if (index === 0 || clearance.fraction >= 0.5) {
        bindingStationIndex = index;
      } else {
        bindingStationIndex = index - 1;
      }
    }
    relativeLongitudinal = point.longitudinalMetres;
    relativeLateral = point.lateralMetres;
    previousTime = point.timeSeconds;
    previousOtherHeading = hazard.claim.stations.heading[index]!;
  }
  return {
    stationIndex: bindingStationIndex,
    clearanceMetres: minimumClearance
  };
}

function damagingContact(contact: SweptContact | null): boolean {
  return contact != null &&
    isHardContactImpulse(contact.maximumRelativeNormalSpeed);
}

function conditionedResponseProgram(
  session: Session,
  current: CandidateProgram,
  conditionedBaseline: CandidateProgram,
  response: CandidateProgram,
  delaySeconds: number
): CandidateProgram {
  const stations = new Array<ProgramStation>(current.stations.length);
  for (let index = 0; index < current.stations.length; index++) {
    const station = current.stations[index]!;
    if (station.time <= delaySeconds + Number.EPSILON) {
      stations[index] = { ...station };
      continue;
    }
    const responseTime = station.time - delaySeconds;
    const responseBase = writeProgramStationAtTime(
      session.trk,
      response.stations,
      responseTime,
      programStationScratchA
    );
    const conditionedBase = writeProgramStationAtTime(
      session.trk,
      conditionedBaseline.stations,
      responseTime,
      programStationScratchB
    );
    const progressDelta =
      responseBase.progress - conditionedBase.progress;
    const progress = station.progress + progressDelta;
    stations[index] = {
      time: station.time,
      progress,
      s: wrappedTrackS(session.trk, station.s + progressDelta),
      lateral: station.lateral +
        responseBase.lateral - conditionedBase.lateral,
      speed: Math.max(
        0,
        station.speed + responseBase.speed - conditionedBase.speed
      ),
      headingOffsetRadians: normAng(
        station.headingOffsetRadians +
        normAng(
          responseBase.headingOffsetRadians -
          conditionedBase.headingOffsetRadians
        )
      )
    };
  }
  return {
    ...response,
    stations,
    // The conditioned prefix changes the extension's initial state. Reusing
    // the source response's progress-keyed tail would splice stations
    // authored from a different state into this program.
    authoredExtensions: new Map()
  };
}

function clearsOneIntervalPhysicalBound(
  session: Session,
  program: CandidateProgram,
  hazards: readonly Hazard[],
  sourceStartTime: number
): boolean {
  const localProgram = oneIntervalProgramWindow(
    session,
    program,
    sourceStartTime
  );
  for (const hazard of hazards) {
    const localHazard = oneIntervalHazardWindow(
      session,
      localProgram,
      hazard,
      sourceStartTime
    );
    const physicalBound = oneIntervalPhysicalDivergence(
      session,
      hazard.other
    );
    const points = boundedRelativeStations(
      session,
      localProgram,
      localHazard,
      null,
      physicalBound
    );
    if (points && damagingContact(firstSweptContact(
      session,
      localProgram,
      localHazard,
      points,
      physicalBound
    ))) return false;
  }
  return true;
}

/**
 * Hard viability is one decision interval deep. The only prediction margin
 * is the derived physical displacement possible before re-observation.
 */
function violatesOneIntervalViability(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  hazards: readonly Hazard[],
  responsePrograms: readonly CandidateProgram[]
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
      null,
      physicalBound
    );
    if (points) screened.push({ hazard, physicalBound, points });
  }
  if (!screened.length) return false;
  const screenedHazards = screened.map(value => value.hazard);
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
  if (clearsOneIntervalPhysicalBound(
    session,
    program,
    screenedHazards,
    nextDecision
  ))
    return false;

  const atNextDecision = programStationAtTime(
    session.trk,
    program.stations,
    nextDecision
  );
  const conditionedActuation =
    PATH_FOLLOWER_SETTLE_DISTANCE /
      Math.max(Number.EPSILON, atNextDecision.speed);
  const clearsWith = (response: CandidateProgram): boolean => {
    if (!response.evaluation.feasible ||
        response === program) return false;
    const delayed = conditionedResponseProgram(
      session,
      program,
      program,
      response,
      nextDecision + conditionedActuation
    );
    return clearsOneIntervalPhysicalBound(
      session,
      delayed,
      screenedHazards,
      nextDecision
    );
  };
  for (const response of responsePrograms)
    if (clearsWith(response)) return false;
  return true;
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

function programStationAtProgress(
  session: Session,
  entry: ActiveEntry,
  program: CandidateProgram,
  targetProgress: number
): ProgramStation {
  if (targetProgress <=
      program.stations.at(-1)!.progress + Number.EPSILON)
    return programStationAtTime(
      session.trk,
      program.stations,
      arrivalTimeOnProgram(program.stations, targetProgress)
    );
  return extendAuthoredProgramToProgress(
    session,
    entry,
    program.evaluation.plan,
    program.speedLaw,
    program.stations,
    targetProgress,
    program.evaluationClaims
  );
}

/**
 * Q starts after the shared prefix. Compare arrival at the incumbent's
 * continuation endpoint so neither the present acquisition nor the
 * pre-observation prefix can be counted a second time.
 */
function incrementalContinuationTimeSeconds(
  session: Session,
  entry: ActiveEntry,
  current: CandidateProgram,
  response: CandidateProgram,
  baseline?: {
    targetProgress: number;
    referenceSpeed: number;
    currentSeconds: number;
  }
): number {
  const targetProgress =
    baseline?.targetProgress ?? current.stations.at(-1)!.progress;
  const referenceSpeed = baseline?.referenceSpeed ?? (
    session.trk.idealPath.v[
      indexAtProgress(session.trk, entry, targetProgress)
    ]! * evaluatorDynamics(session, entry).margin
  );
  const responseStation = programStationAtProgress(
    session,
    entry,
    response,
    targetProgress
  );
  const currentSeconds = baseline?.currentSeconds ?? (
    arrivalTimeOnProgram(current.stations, targetProgress) +
    terminalContinuationSeconds(
      session,
      entry,
      targetProgress,
      programSpeedAtProgress(current.stations, targetProgress),
      referenceSpeed,
      current.speedLaw.brakingEffort
    )
  );
  return responseStation.time +
    terminalContinuationSeconds(
      session,
      entry,
      targetProgress,
      responseStation.speed,
      referenceSpeed,
      response.speedLaw.brakingEffort
    ) - currentSeconds;
}

interface EarliestArrivalFamily {
  session: Session;
  at: number;
  progress: number;
  trackS: number;
  speed: number;
  lateral: number;
  programs: Array<{
    plan: DynamicPlan;
    speedLaw: CandidateSpeedLaw;
    stations: ProgramStation[];
  }>;
}

const earliestArrivalFamilyCache =
  new WeakMap<Entry, EarliestArrivalFamily>();

function earliestFeasibleArrival(
  session: Session,
  entry: ActiveEntry,
  contestedS: number
): number {
  const track = session.trk;
  const targetProgress = entry.prog +
    forwardTrackDistance(track, entry.car.s, contestedS);
  let cached = earliestArrivalFamilyCache.get(entry);
  if (!cached || cached.session !== session ||
      cached.at !== session.t ||
      cached.progress !== entry.prog ||
      cached.trackS !== entry.car.s ||
      cached.speed !== entry.spd ||
      cached.lateral !== entry.latNow) {
    const plans: DynamicPlan[] = [
      acquisitionPlan(session, entry, 'ideal')
    ];
    const corner = cornerAtApproach(
      track,
      cyclicIndex(track, entry.car.progIdx)
    );
    for (const [kind, side] of [
      ['corner-inside', -1],
      ['corner-outside', 1]
    ] as const) {
      const full = corner
        ? fullCornerPlan(session, entry, corner, kind, null)
        : straightFullPlan(session, entry, side, null);
      const seeded = full
        ? seededSideCandidate(session, entry, [], kind, full, false, false)
        : null;
      if (seeded &&
          seeded.plan.mode !== 'ideal' &&
          seeded.plan.mode !== 'pit')
        plans.push(seeded.plan);
    }
    const programs: EarliestArrivalFamily['programs'] = [];
    for (const plan of plans) {
      if (!candidateRespectsAgreement(session, entry, plan))
        continue;
      const speedLaw = composeCandidateSpeedLaw(
        session,
        entry,
        plan,
        null,
        [],
        EMPTY_EVALUATION_CLAIMS,
        BOT_BRAKING_EFFORT_MAXIMUM
      );
      programs.push({
        plan,
        speedLaw,
        stations: programStations(
          session,
          entry,
          plan,
          speedLaw
        )
      });
    }
    cached = {
      session,
      at: session.t,
      progress: entry.prog,
      trackS: entry.car.s,
      speed: entry.spd,
      lateral: entry.latNow,
      programs
    };
    earliestArrivalFamilyCache.set(entry, cached);
    evaluatorWork(session).arrivalFamilyBuilds++;
  } else {
    evaluatorWork(session).arrivalFamilyCacheHits++;
  }
  let earliest = Infinity;
  for (const program of cached.programs) {
    const stations = program.stations;
    const arrival = targetProgress >
        stations.at(-1)!.progress + Number.EPSILON
      ? extendAuthoredProgramToProgress(
          session,
          entry,
          program.plan,
          program.speedLaw,
          stations,
          targetProgress
        ).time
      : arrivalTimeOnProgram(stations, targetProgress);
    earliest = Math.min(
      earliest,
      arrival
    );
  }
  return Number.isFinite(earliest)
    ? earliest
    : forwardTrackDistance(track, entry.car.s, contestedS) /
      Math.max(Number.EPSILON, entry.spd);
}

export function racecraftContestedRegionResponsibility(
  region: RacecraftContestedRegion | null,
  ownArrivalSeconds: number,
  rivalArrivalSeconds: number
): number {
  if (!region) return 1;
  return arrivalQuantizedResponsibility(
    ownArrivalSeconds - rivalArrivalSeconds,
    RACECRAFT_DECISION_INTERVAL_SECONDS
  );
}

function responsibility(
  session: Session,
  entry: ActiveEntry,
  hazard: Hazard
): number {
  if (hazard.region === undefined)
    hazard.region = hazard.ownClaim
      ? snapshotContestedRegion(
          session.trk,
          hazard.ownClaim,
          hazard.claim
        )
      : null;
  // A candidate that creates an intersection absent from the immutable
  // snapshot owns that novel contest completely. Snapshot-derived arrival
  // asymmetry remains authoritative for contests that already existed.
  if (!hazard.region)
    return racecraftContestedRegionResponsibility(null, 0, 0);
  const contestedS = hazard.region.s;
  const ownEta = earliestFeasibleArrival(session, entry, contestedS);
  const rivalEta = earliestFeasibleArrival(
    session,
    hazard.other,
    contestedS
  );
  return racecraftContestedRegionResponsibility(
    hazard.region,
    ownEta,
    rivalEta
  );
}

function brakingCompletionSeconds(
  session: Session,
  entry: ActiveEntry,
  current: CandidateProgram,
  response: CandidateProgram,
  hazardTime: number
): number {
  const downforceScale = evaluatorDynamics(session, entry).downforceScale;
  const targetTime = Math.max(0, hazardTime);
  const target = programStationAtTime(
    session.trk,
    response.stations,
    targetTime
  );
  const samples = current.stations
    .filter(station => station.time < targetTime - Number.EPSILON)
    .map(station => ({ ...station }));
  samples.push(programStationAtTime(
    session.trk,
    current.stations,
    targetTime
  ));
  if (target.speed >= samples[0]!.speed - Number.EPSILON) return 0;

  const allowed = new Array<number>(samples.length);
  allowed[allowed.length - 1] = target.speed;
  for (let index = samples.length - 2; index >= 0; index--) {
    const from = samples[index]!;
    const to = samples[index + 1]!;
    const state = laneStateAt(
      session,
      entry,
      from.progress,
      current.evaluation.plan
    );
    const distance = Math.max(
      0,
      (to.progress - from.progress) * state.q
    );
    allowed[index] = backwardInducedSpeedLimit(
      allowed[index + 1]!,
      from.speed,
      distance,
      state.curvature,
      state.dynamicMu,
      downforceScale,
      response.speedLaw.brakingEffort,
      passiveDeceleration(
        session,
        entry,
        from.speed,
        state.surfaceDrag
      )
    );
  }

  let previousDifference =
    samples[0]!.speed - allowed[0]!;
  if (previousDifference > Number.EPSILON) return targetTime;
  for (let index = 1; index < samples.length; index++) {
    const difference = samples[index]!.speed - allowed[index]!;
    if (difference <= Number.EPSILON) {
      previousDifference = difference;
      continue;
    }
    const from = samples[index - 1]!;
    const to = samples[index]!;
    const span = difference - previousDifference;
    const fraction = span <= Number.EPSILON
      ? 1
      : clamp(-previousDifference / span, 0, 1);
    const brakingStart =
      from.time + (to.time - from.time) * fraction;
    return Math.max(0, targetTime - brakingStart);
  }
  return 0;
}

function responseCompletionSeconds(
  session: Session,
  entry: ActiveEntry,
  current: CandidateProgram,
  response: CandidateProgram,
  hazardTime: number
): number {
  const currentStation = current.stations[0]!;
  let lateralExcursion = 0;
  for (const station of response.stations) {
    if (station.time > hazardTime + Number.EPSILON) break;
    const baseline = programStationAtTime(
      session.trk,
      current.stations,
      station.time
    );
    lateralExcursion = Math.max(
      lateralExcursion,
      Math.abs(station.lateral - baseline.lateral)
    );
  }
  const atHazard = programStationAtTime(
    session.trk,
    response.stations,
    hazardTime
  );
  const baselineAtHazard = programStationAtTime(
    session.trk,
    current.stations,
    hazardTime
  );
  lateralExcursion = Math.max(
    lateralExcursion,
    Math.abs(atHazard.lateral - baselineAtHazard.lateral)
  );
  const currentState = laneStateAt(
    session,
    entry,
    currentStation.progress,
    current.evaluation.plan
  );
  const grip = longitudinalAccelerationHeadroom(
    currentStation.speed,
    currentState.curvature,
    currentState.dynamicMu,
    evaluatorDynamics(session, entry).downforceScale
  );
  const lateral = physicalLateralMoveSeconds(
    currentStation.speed,
    lateralExcursion,
    grip
  );
  const braking = brakingCompletionSeconds(
    session,
    entry,
    current,
    response,
    hazardTime
  );
  return Math.max(lateral, braking);
}

function contactLossSeconds(contact: SweptContact | null): number {
  return contact
    ? measuredContactEpisodeLossSeconds(contact.episodes)
    : 0;
}

function resolveHazardResponseOption(
  option: HazardResponseOption
): number {
  if (option.q != null) return option.q;
  let q = option.qLowerBound;
  for (const contact of option.unresolvedContacts ?? []) {
    const bound = measuredContactEpisodeLossBound(contact.episodes);
    q += contactLossSeconds(contact) - bound.lowerBoundSeconds;
  }
  option.q = q;
  option.unresolvedContacts = null;
  return q;
}

function minimumHazardResponseOption(
  options: readonly HazardResponseOption[],
  includeEmergency: boolean
): HazardResponseOption | null {
  let best: HazardResponseOption | null = null;
  for (const option of options) {
    if (!includeEmergency && option.emergency || option.q == null) continue;
    if (!best ||
        option.q < best.q! ||
        (option.q === best.q && option.order < best.order))
      best = option;
  }
  let unresolved: HazardResponseOption | null = null;
  for (const option of options) {
    if (!includeEmergency && option.emergency || option.q != null) continue;
    if (!unresolved ||
        option.qLowerBound < unresolved.qLowerBound ||
        (option.qLowerBound === unresolved.qLowerBound &&
          option.order < unresolved.order))
      unresolved = option;
  }
  if (unresolved && (
    !best ||
    unresolved.qLowerBound < best.q! ||
    (unresolved.qLowerBound === best.q &&
      unresolved.order < best.order)
  )) {
    resolveHazardResponseOption(unresolved);
    return minimumHazardResponseOption(options, includeEmergency);
  }
  return best;
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
  hazards: readonly Hazard[],
  responsePrograms: readonly CandidateProgram[],
  lateralPerturbation: {
    stationIndex: number;
    direction: -1 | 1;
  } | null = null,
  boundedStations?: readonly RelativePointStation[] | null,
  boundedClearance?: {
    stationIndex: number;
    clearanceMetres: number;
  } | null
): HazardCost {
  const stations = boundedStations === undefined
    ? boundedRelativeStations(
        session,
        program,
        hazard,
        lateralPerturbation
      )
    : boundedStations;
  const contact = (stations
    ? firstSweptContact(
        session,
        program,
        hazard,
        stations,
        0,
        lateralPerturbation
      )
    : null) ??
    offHorizonAttackContact(
      session,
      entry,
      program,
      hazard,
      lateralPerturbation
    );
  if (!contact)
    return {
      seconds: 0,
      billSeconds: 0,
      recourseSeconds: 0,
      bindingStationIndex: stations
        ? (boundedClearance ?? programHazardClearance(
            session,
            program,
            hazard,
            stations
          )).stationIndex
        : -1
    };
  const targetProgress = contact.egoProgress;
  const currentThroughContact = programExtendedToProgress(
    session,
    entry,
    program,
    targetProgress
  );
  if (!lateralPerturbation &&
      contact.time >
        MANEUVER_PREDICTION.horizonSeconds + Number.EPSILON) {
    session.racecraftOffHorizonContests =
      (session.racecraftOffHorizonContests ?? 0) + 1;
    session.racecraftOffHorizonMaximumContactTimeSeconds = Math.max(
      session.racecraftOffHorizonMaximumContactTimeSeconds ?? 0,
      contact.time
    );
  }
  const atNextDecision = programStationAtTime(
    session.trk,
    currentThroughContact.stations,
    RACECRAFT_DECISION_INTERVAL_SECONDS
  );
  const actuationSeconds = PATH_FOLLOWER_SETTLE_DISTANCE /
    Math.max(Number.EPSILON, atNextDecision.speed);
  if (contact.time <
      RACECRAFT_DECISION_INTERVAL_SECONDS + actuationSeconds) {
    const physicalLoss = contactLossSeconds(contact);
    return {
      seconds: physicalLoss,
      billSeconds: physicalLoss,
      recourseSeconds: 0,
      bindingStationIndex: contact.stationIndex
    };
  }

  const currentContinuationRisk =
    programCarriesUtilizationRisk(program)
      ? utilizationRisk(
          session,
          entry,
          program,
          RACECRAFT_DECISION_INTERVAL_SECONDS,
          contact.time
        )
      : 0;
  const referenceSpeed =
    session.trk.idealPath.v[
      indexAtProgress(session.trk, entry, targetProgress)
    ]! * evaluatorDynamics(session, entry).margin;
  const continuationBaseline = {
    targetProgress,
    referenceSpeed,
    currentSeconds:
      contact.time +
      terminalContinuationSeconds(
        session,
        entry,
        targetProgress,
        contact.egoSpeed,
        referenceSpeed,
        program.speedLaw.brakingEffort
      )
  };
  const evaluateResponse = (
    response: CandidateProgram,
    order: number
  ): HazardResponseOption | null => {
    if (!response.evaluation.feasible ||
        response === program) return null;
    const responseThroughContact = programExtendedToProgress(
      session,
      entry,
      response,
      targetProgress
    );
    const completion = responseCompletionSeconds(
      session,
      entry,
      currentThroughContact,
      responseThroughContact,
      contact.time
    );
    if (!Number.isFinite(completion)) return null;
    const slack = responseSlack({
      timeToHazardSeconds: contact.time,
      actuationSeconds,
      completionSeconds: completion,
      nextDecisionSeconds: RACECRAFT_DECISION_INTERVAL_SECONDS
    });
    if (slack.nowSeconds < 0) return null;
    const delayed = conditionedResponseProgram(
      session,
      currentThroughContact,
      currentThroughContact,
      responseThroughContact,
      RACECRAFT_DECISION_INTERVAL_SECONDS + actuationSeconds
    );
    let residualLowerBoundSeconds = 0;
    const unresolvedContacts: SweptContact[] = [];
    for (const residualHazard of hazards) {
      const residualPoints = relativePointStations(
        session,
        delayed,
        residualHazard,
        residualHazard === hazard ? lateralPerturbation : null
      );
      const residualBound = pointTrajectoryBound(
        session,
        delayed,
        residualHazard,
        residualPoints
      );
      const residualContact = (
        residualBound
          ? firstSweptContact(
              session,
              delayed,
              residualHazard,
              residualPoints,
              0,
              residualHazard === hazard
                ? lateralPerturbation
                : null
            )
          : null
      ) ?? offHorizonAttackContact(
        session,
        entry,
        delayed,
        residualHazard
      );
      if (!residualContact) continue;
      if (damagingContact(residualContact)) return null;
      const loss = measuredContactEpisodeLossBound(
        residualContact.episodes
      );
      residualLowerBoundSeconds += loss.lowerBoundSeconds;
      if (!loss.exact) unresolvedContacts.push(residualContact);
    }
    const responsePlan = delayed.evaluation.plan;
    const emergency =
      responsePlan.mode !== 'ideal' &&
      responsePlan.mode !== 'pit' &&
      responsePlan.surfaceAuthorization === 'emergency';
    const responseContinuationRisk =
      programCarriesUtilizationRisk(delayed)
        ? utilizationRisk(
            session,
            entry,
            delayed,
            RACECRAFT_DECISION_INTERVAL_SECONDS,
            contact.time
          )
        : 0;
    const qLowerBound = incrementalContinuationTimeSeconds(
        session,
        entry,
        program,
        delayed,
        continuationBaseline
      ) +
        responseContinuationRisk -
        currentContinuationRisk +
        residualLowerBoundSeconds;
    return {
      q: unresolvedContacts.length ? null : qLowerBound,
      qLowerBound,
      waitSlack: slack.waitSeconds,
      emergency,
      order,
      unresolvedContacts: unresolvedContacts.length
        ? unresolvedContacts
        : null
    };
  };
  const options: HazardResponseOption[] = [];
  for (let order = 0; order < responsePrograms.length; order++) {
    const option = evaluateResponse(responsePrograms[order]!, order);
    if (option) options.push(option);
  }
  const physicalLossBound = measuredContactEpisodeLossBound(
    contact.episodes
  );
  const bestNormal = minimumHazardResponseOption(options, false);
  const normalResponseExpired =
    bestNormal == null || bestNormal.waitSlack <= 0;
  const bestResponse = minimumHazardResponseOption(
    options,
    normalResponseExpired
  );
  if (normalResponseExpired && !lateralPerturbation)
    program.emergencyHazards.set(hazard.key, contact.time);
  let bestContinuation = bestResponse?.q ?? Infinity;
  if (physicalLossBound.lowerBoundSeconds < bestContinuation)
    bestContinuation = physicalLossBound.exact
      ? physicalLossBound.lowerBoundSeconds
      : contactLossSeconds(contact);
  const adaptResponsibility =
    hazard.adaptResponsibility ??=
      responsibility(session, entry, hazard);
  const contest = adaptResponsibility * bestContinuation;
  return {
    seconds: contest,
    billSeconds: 0,
    recourseSeconds: contest,
    bindingStationIndex: contact.stationIndex
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

function scorePrograms(
  session: Session,
  entry: ActiveEntry,
  programs: CandidateProgram[],
  hazards: readonly Hazard[],
  responsePrograms: readonly CandidateProgram[] = programs
): void {
  let scratch = scoreProgramsScratchBySession.get(session);
  if (!scratch) {
    scratch = { hazards: [], stations: [], clearances: [] };
    scoreProgramsScratchBySession.set(session, scratch);
  }
  const boundedHazards = scratch.hazards;
  const boundedStations = scratch.stations;
  const boundedClearances = scratch.clearances;
  for (const program of programs) {
    const evaluation = program.evaluation;
    if (!evaluation.feasible) continue;
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
      } else {
        program.perturbations.set(hazard.key, {
          base: 0,
          billSeconds: 0,
          recourseSeconds: 0,
          bindingStationIndex: -1
        });
      }
    }
    if (violatesOneIntervalViability(
      session,
      entry,
      program,
      hazards,
      programs
    )) {
      if (!evaluation.vetoes.includes('predicted-hard-contact'))
        evaluation.vetoes.push('predicted-hard-contact');
      evaluation.feasible = false;
      continue;
    }
    // Corollary 9 keeps solitary ideal at J=0. P-BE makes utilization an
    // authored property of side/capability and emergency members; it prices
    // their measured mistake exposure without becoming a proximity term.
    const plan = evaluation.plan;
    const surfaceRisk = programCarriesUtilizationRisk(program)
      ? utilizationRisk(
          session,
          entry,
          program,
          0,
          program.utilizationExposure.at(-1)?.time ??
            MANEUVER_PREDICTION.horizonSeconds
        )
      : 0;
    evaluation.effortRiskSeconds = surfaceRisk;
    let hazardCost = surfaceRisk;
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
        hazards,
        responsePrograms,
        null,
        stations,
        clearance
      );
      if (cost.seconds !== 0)
        evaluation.hazardCount++;
      evaluation.billSeconds += cost.billSeconds;
      evaluation.recourseSeconds += cost.recourseSeconds;
      hazardCost += cost.seconds;
      if (!evaluation.feasible) break;
      program.perturbations.set(hazard.key, {
        base: cost.seconds,
        billSeconds: cost.billSeconds,
        recourseSeconds: cost.recourseSeconds,
        bindingStationIndex: cost.bindingStationIndex
      });
    }
    if (!evaluation.feasible) {
      evaluation.cost = Infinity;
      continue;
    }
    evaluation.cost = evaluation.ownTimeSeconds + hazardCost;
  }
}

function applyBattleEconomics(
  programs: readonly CandidateProgram[],
  contexts: readonly BattleEconomicsContext[]
): void {
  for (const program of programs) {
    const evaluation = program.evaluation;
    if (!evaluation.feasible || !Number.isFinite(evaluation.cost))
      continue;
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
          contestSeconds: evaluation.recourseSeconds,
          measuredProximitySeconds: evaluation.proximitySeconds
        })
      : 0;
    evaluation.cost +=
      evaluation.positionValueSeconds +
      evaluation.attemptLossSeconds +
      evaluation.proximitySeconds;
  }
}

function incumbentProgram(
  entry: Entry,
  programs: readonly CandidateProgram[]
): CandidateProgram | null {
  const selectedFamilyNumericId =
    entry.racecraftDecision?.certificate?.selectedFamilyNumericId;
  return programs.find(program =>
    selectedFamilyNumericId != null &&
    program.evaluation.familyNumericId === selectedFamilyNumericId) ??
    programs[0] ??
    null;
}

function tieBand(
  session: Session,
  entry: ActiveEntry,
  candidate: CandidateProgram,
  incumbent: CandidateProgram,
  hazards: readonly Hazard[],
  responsePrograms: readonly CandidateProgram[]
): number {
  const perturbations: Array<{
    incumbentSeconds: number;
    candidateSeconds: number;
  }> = [];
  const base = {
    incumbentSeconds: incumbent.evaluation.cost,
    candidateSeconds: candidate.evaluation.cost
  };
  for (const hazard of hazards) {
    const candidateShift = candidate.perturbations.get(hazard.key);
    const incumbentShift = incumbent.perturbations.get(hazard.key);
    if (!candidateShift || !incumbentShift) continue;
    const bindingStations = new Set([
      candidateShift.bindingStationIndex,
      incumbentShift.bindingStationIndex
    ]);
    bindingStations.delete(-1);
    for (const stationIndex of bindingStations) {
      for (const direction of [-1, 1] as const) {
        evaluatorWork(session).tieBandHazardEvaluations += 2;
        const perturbation = { stationIndex, direction };
        const candidateSeconds = evaluateHazard(
          session,
          entry,
          candidate,
          hazard,
          hazards,
          responsePrograms,
          perturbation
        ).seconds;
        const incumbentSeconds = evaluateHazard(
          session,
          entry,
          incumbent,
          hazard,
          hazards,
          responsePrograms,
          perturbation
        ).seconds;
        perturbations.push({
          candidateSeconds: candidate.evaluation.cost -
            candidateShift.base + candidateSeconds,
          incumbentSeconds: incumbent.evaluation.cost -
            incumbentShift.base + incumbentSeconds
        });
      }
    }
  }
  return pairwiseDifferenceTieBand(base, perturbations);
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
      recourseSeconds: candidate.recourseSeconds,
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

export function orderedRacecraftDecisionLog(
  session: Session
): readonly RacecraftDecisionLogEntry[] {
  const log = session.racecraftDecisionLog ?? [];
  const cursor = session.racecraftDecisionLogCursor ?? 0;
  return cursor === 0 ? log : [...log.slice(cursor), ...log.slice(0, cursor)];
}

/**
 * Test/diagnostic view of the deterministic next-observation response set.
 * It performs no recursive objective evaluation and materializes no path.
 */
export function racecraftDeferredResponses(
  session: Session,
  entry: Entry,
  entries: readonly Entry[],
  candidateKind: RacecraftCandidateKind,
  rivalCode: string
): RacecraftDeferredResponseSummary[] {
  if (!entry.car || entry.state !== 'run') return [];
  const selection = selectRacecraftProgram(session, entry, entries);
  if (!selection ||
      !selection.hazards.some(hazard =>
        hazard.other.code === rivalCode) ||
      !selection.programs.some(program =>
        program.evaluation.kind === candidateKind))
    return [];
  return selection.programs.map(response => {
    const plan = response.evaluation.plan;
    return {
      kind: response.evaluation.kind,
      planKey: plan.key,
      lineBlend: plan.mode !== 'ideal' && plan.mode !== 'pit'
        ? plan.lineBlend ?? null
        : null,
      targetLateral: response.evaluation.targetLateral,
      surfaceAuthorization:
        plan.mode !== 'ideal' && plan.mode !== 'pit'
          ? plan.surfaceAuthorization ?? 'normal'
          : 'normal',
      feasible: response.evaluation.feasible
    };
  });
}

/** Diagnostic view of the single constraint-derived emergency response. */
export function racecraftJointEmergencyResponse(
  session: Session,
  entry: Entry,
  entries: readonly Entry[]
): RacecraftEmergencyResponseSummary | null {
  if (!entry.car || entry.state !== 'run') return null;
  const active = entry as ActiveEntry;
  const claims = evaluationClaimsAt(session, entries);
  const hazards = hazardsFor(session, active, entries, claims);
  const seed = jointEmergencyEscapeSeed(session, active, hazards);
  if (!seed ||
      seed.plan.mode === 'ideal' ||
      seed.plan.mode === 'pit')
    return null;
  return {
    direction: seed.kind === 'corner-inside' ? -1 : 1,
    targetLateral: seed.plan.anchors[1]?.offset ?? entry.latNow
  };
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

function repriceHazardsWithEmergencyResponse(
  session: Session,
  entry: ActiveEntry,
  programs: readonly CandidateProgram[],
  hazards: readonly Hazard[],
  normalProgramCount: number
): void {
  for (let programIndex = 0;
    programIndex < normalProgramCount;
    programIndex++) {
    const program = programs[programIndex]!;
    if (!program.evaluation.feasible ||
        !program.emergencyHazards.size) continue;
    const evaluation = program.evaluation;
    for (const hazard of hazards) {
      if (!program.emergencyHazards.has(hazard.key)) continue;
      const stations = boundProgramHazard(session, program, hazard);
      const clearance = stations
        ? programHazardClearance(
            session,
            program,
            hazard,
            stations
          )
        : null;
      const previous = program.perturbations.get(hazard.key);
      const cost = evaluateHazard(
        session,
        entry,
        program,
        hazard,
        hazards,
        programs,
        null,
        stations,
        clearance
      );
      const previousSeconds = previous?.base ?? 0;
      if (previousSeconds === 0 && cost.seconds !== 0)
        evaluation.hazardCount++;
      else if (previousSeconds !== 0 && cost.seconds === 0)
        evaluation.hazardCount--;
      evaluation.billSeconds += cost.billSeconds -
        (previous?.billSeconds ?? 0);
      evaluation.recourseSeconds += cost.recourseSeconds -
        (previous?.recourseSeconds ?? 0);
      evaluation.cost += cost.seconds - previousSeconds;
      program.perturbations.set(hazard.key, {
        base: cost.seconds,
        billSeconds: cost.billSeconds,
        recourseSeconds: cost.recourseSeconds,
        bindingStationIndex: cost.bindingStationIndex
      });
    }
    program.emergencyHazards.clear();
  }
}

function appendSlackGatedEmergencyProgram(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  programs: CandidateProgram[],
  hazards: readonly Hazard[],
  evaluationClaims: EvaluationClaimMap,
  previousKind: RacecraftCandidateKind | null
): void {
  const expiringKeys = new Set<string>();
  for (const program of programs) {
    for (const key of program.emergencyHazards.keys())
      expiringKeys.add(key);
  }
  if (!expiringKeys.size) return;
  if (programs.length >= MAX_RACECRAFT_CANDIDATES)
    throw new Error('Slack-gated emergency has no maneuver slot');
  const expiringHazards: Hazard[] = [];
  for (const hazard of hazards)
    if (expiringKeys.has(hazard.key))
      expiringHazards.push(hazard);
  const seed = jointEmergencyEscapeSeed(
    session,
    entry,
    expiringHazards
  );
  if (!seed) {
    for (const program of programs) program.emergencyHazards.clear();
    return;
  }
  const normalProgramCount = programs.length;
  evaluatorWork(session).candidateSeedsBuilt++;
  const emergency = evaluateSeed(
    session,
    entry,
    entries,
    seed,
    previousKind,
    evaluationClaims
  );
  programs.push(emergency);
  repriceHazardsWithEmergencyResponse(
    session,
    entry,
    programs,
    hazards,
    normalProgramCount
  );
  scorePrograms(
    session,
    entry,
    [emergency],
    hazards,
    programs
  );
}

function selectRacecraftProgram(
  session: Session,
  entry: Entry,
  entries: readonly Entry[]
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
  const programs = new Array<CandidateProgram>(seeds.length);
  for (let index = 0; index < seeds.length; index++)
    programs[index] = evaluateSeed(
      session,
      active,
      entries,
      seeds[index]!,
      previousKind,
      evaluationClaims
    );
  const leader = activeLeader(session, active, entries);
  let hold: CandidateProgram | undefined;
  for (const program of programs)
    if (program.evaluation.kind === 'hold') {
      hold = program;
      break;
    }
  if (leader && hold && programs.length < MAX_RACECRAFT_CANDIDATES) {
    const brakeSeed = brakeBehindSeed(session, active, leader.entry);
    const brakeSpeedLaw = composeCandidateSpeedLaw(
      session,
      active,
      brakeSeed.plan,
      brakeSeed.slowPointOwnerCode,
      entries,
      evaluationClaims
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
        true,
        brakeSpeedLaw
      ));
    }
  }
  scorePrograms(session, active, programs, hazards);
  appendSlackGatedEmergencyProgram(
    session,
    active,
    entries,
    programs,
    hazards,
    evaluationClaims,
    previousKind
  );
  const fullSeedEvaluations =
    evaluatorWork(session).seedEvaluations - seedEvaluationsBefore;
  if (fullSeedEvaluations > MAX_RACECRAFT_CANDIDATES)
    throw new Error(
      `Racecraft full evaluation budget exceeded: ` +
      `${fullSeedEvaluations}/${MAX_RACECRAFT_CANDIDATES}`
    );
  const economics: BattleEconomicsContext[] = [];
  let leaderHazard: Hazard | null = null;
  if (leader)
    for (const hazard of hazards)
      if (hazard.other === leader.entry) {
        leaderHazard = hazard;
        break;
      }
  if (leader && leaderHazard)
    economics.push(updateBattleEconomicsContext(
      session,
      active,
      leader.entry,
      programs,
      leaderHazard,
      'attack'
    ));
  const attacker = activeDefensiveAttacker(session, active, entries);
  let attackerHazard: Hazard | null = null;
  if (attacker)
    for (const hazard of hazards)
      if (hazard.other === attacker.entry) {
        attackerHazard = hazard;
        break;
      }
  if (attacker && attackerHazard)
    economics.push(updateBattleEconomicsContext(
      session,
      active,
      attacker.entry,
      programs,
      attackerHazard,
      'defense'
    ));
  reconcileBattleOpportunityObservations(session, active, economics);
  applyBattleEconomics(programs, economics);
  const incumbent = incumbentProgram(entry, programs);
  let best: CandidateProgram | null = null;
  for (const program of programs)
    if (program.evaluation.feasible &&
        (best == null ||
          program.evaluation.cost < best.evaluation.cost))
      best = program;
  if (best && incumbent?.evaluation.feasible && best !== incumbent) {
    const beta = tieBand(
      session,
      active,
      best,
      incumbent,
      hazards,
      programs
    );
    best.evaluation.tieBandSeconds = beta;
    if (!(best.evaluation.cost + beta < incumbent.evaluation.cost)) {
      incumbent.evaluation.tieBandSeconds = beta;
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

function selectedFamilyOffset(
  track: Track,
  plan: PathPlan,
  index: number,
  progress: number
): number {
  return plan.mode === 'ideal' || plan.mode === 'pit'
    ? track.idealPath!.off[cyclicIndex(track, index)]!
    : sampleCompactPathPlanOffset(track, plan, index, progress);
}

function selectedAnchorProgress(
  track: Track,
  entry: ActiveEntry,
  anchor: DynamicPlan['anchors'][number]
): number {
  if (anchor.s != null) return anchor.s;
  const distance = (
    cyclicIndex(track, anchor.index) -
    cyclicIndex(track, entry.car.progIdx) +
    track.n
  ) % track.n * track.step;
  return entry.prog + distance;
}

/**
 * Preserve one selected family while rebuilding only its physical acquisition
 * from the latest measured state. This is geometry construction, not a
 * candidate search.
 */
function reanchorSelectedFamily(
  session: Session,
  entry: ActiveEntry,
  source: PathPlan
): DynamicPlan | null {
  if (source.mode === 'pit') return null;
  const track = session.trk;
  const family = source.mode === 'ideal' ? null : source;
  const start = cyclicIndex(track, entry.car.progIdx);
  const speed = Math.max(0, entry.spd || entry.car.spd);
  const horizonDistance = Math.max(8, speed) *
    MANEUVER_PREDICTION.horizonSeconds;
  const probeProgress = entry.prog + Math.max(track.step, PHYS.carLen);
  const probeIndex = indexAtProgress(track, entry, probeProgress);
  const moveSeconds = physicalLaneMoveSeconds(
    session,
    entry,
    selectedFamilyOffset(track, source, probeIndex, probeProgress)
  );
  const acquisitionDistance = Math.min(
    horizonDistance,
    Math.max(
      track.step,
      PHYS.carLen,
      speed * (Number.isFinite(moveSeconds)
        ? moveSeconds
        : MANEUVER_PREDICTION.horizonSeconds)
    )
  );
  const acquisitionProgress = entry.prog + acquisitionDistance;
  const acquisitionIndex = indexAtProgress(
    track,
    entry,
    acquisitionProgress
  );
  const anchors: DynamicPlan['anchors'] = [
    currentAuthoredAnchor(session, entry),
    {
      index: acquisitionIndex,
      offset: selectedFamilyOffset(
        track,
        source,
        acquisitionIndex,
        acquisitionProgress
      ),
      s: acquisitionProgress
    }
  ];
  for (const anchor of family?.anchors.slice(1) ?? []) {
    const progress = selectedAnchorProgress(track, entry, anchor);
    if (progress <= acquisitionProgress + Number.EPSILON ||
        progress - entry.prog > track.len / 2) continue;
    const index = cyclicIndex(track, anchor.index);
    if (index === anchors.at(-1)!.index) continue;
    anchors.push({ ...anchor, index, s: progress });
  }
  const horizonProgress = entry.prog + horizonDistance;
  const horizonIndex = indexAtProgress(track, entry, horizonProgress);
  if (anchors.at(-1)!.s! < horizonProgress - Number.EPSILON &&
      anchors.at(-1)!.index !== horizonIndex)
    anchors.push({
      index: horizonIndex,
      offset: selectedFamilyOffset(
        track,
        source,
        horizonIndex,
        horizonProgress
      ),
      s: horizonProgress
    });

  const plan: DynamicPlan = family
    ? {
        ...family,
        key: `${family.key}:rederived:${entry.prog.toPrecision(12)}`,
        anchors,
        pinnedFirst: true
      }
    : {
        mode: 'tuck',
        key: `ideal:rederived:${entry.code}:${entry.prog.toPrecision(12)}`,
        anchors,
        pinnedFirst: true,
        topology: 'hold',
        terminal: 'ideal-rejoin',
        surfaceAuthorization: 'normal'
      };
  if (plan.cornerId) {
    const corner = track.corners.find(value => value.id === plan.cornerId);
    const exitDistance = corner
      ? distanceAhead(track, start, corner.exitI)
      : Infinity;
    if (!corner || exitDistance > track.len / 2) {
      delete plan.cornerId;
      delete plan.complexId;
      delete plan.lineKind;
      delete plan.lineBlend;
    }
  }
  return plan;
}

/**
 * Re-evaluate the production candidate family without installing a path or
 * touching decision diagnostics. Claim publication consumes this when a
 * driven car has broken its prior publication.
 */
export function rederiveRacecraftOptimalProgram(
  session: Session,
  entry: Entry,
  entries: readonly Entry[]
): RacecraftOptimalProgram | null {
  const selection = selectRacecraftProgram(session, entry, entries);
  if (!selection) return null;
  if (selection.zeroHazardIdeal) {
    const program = evaluateSeed(
      session,
      selection.active,
      entries,
      {
        kind: 'ideal',
        plan: acquisitionPlan(session, selection.active, 'ideal'),
        slowPointOwnerCode: null
      },
      selection.previousKind,
      selection.evaluationClaims
    );
    return {
      kind: 'ideal',
      plan: program.evaluation.plan,
      slowPointOwnerCode: null,
      candidateCount: 0,
      stations: program.stations.map(station => ({ ...station }))
    };
  }
  // A car already outside a hard constraint can have an empty feasible set.
  // Its ideal-family member is still the non-adversarial recovery prediction;
  // critically, it never falls back to the broken incumbent publication.
  const best = selection.best ??
    selection.programs.find(program =>
      program.evaluation.kind === 'ideal') ??
    null;
  if (!best) return null;
  return {
    kind: best.evaluation.kind,
    plan: best.evaluation.plan,
    slowPointOwnerCode: best.evaluation.slowPointOwnerCode,
    candidateCount: selection.programs.length,
    stations: best.stations.map(station => ({ ...station }))
  };
}

/**
 * Rebuild one previously selected family from measurement and evaluate only
 * that seed. No alternative family, objective, tie-band, or path installation
 * participates between deliberation epochs.
 */
export function rebuildRacecraftSelectedProgram(
  session: Session,
  entry: Entry,
  entries: readonly Entry[],
  selected: {
    kind: RacecraftCandidateKind;
    plan: PathPlan;
    slowPointOwnerCode: string | null;
  }
): RacecraftOptimalProgram | null {
  if (!entry.car || entry.state !== 'run' || entry.pathPlan?.mode === 'pit')
    return null;
  const active = entry as ActiveEntry;
  const plan = reanchorSelectedFamily(session, active, selected.plan);
  if (!plan) return null;
  const evaluationClaims = evaluationClaimsAt(session, entries);
  const program = evaluateSeed(
    session,
    active,
    entries,
    {
      kind: selected.kind,
      plan,
      slowPointOwnerCode: selected.slowPointOwnerCode
    },
    selected.kind,
    evaluationClaims
  );
  return {
    kind: selected.kind,
    plan,
    slowPointOwnerCode: selected.slowPointOwnerCode,
    candidateCount: 1,
    stations: program.stations.map(station => ({ ...station }))
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
    certificate: makeDecisionCertificate(
      session,
      entry,
      [],
      null,
      null,
      true
    ),
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
    : entry.laneBuffer?.startIndex === index && entry.laneBuffer.count > 0
      ? entry.laneBuffer.k[0]!
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

/** One bounded argmin in seconds, evaluated against the immutable snapshot. */
export function evaluateRacecraftDecision(
  session: Session,
  entry: Entry,
  entries: readonly Entry[]
): RacecraftDecision | null {
  if (!entry.car || entry.state !== 'run' || entry.pathPlan?.mode === 'pit' ||
      entry.recT > 0 || entry.car.offCourse) return null;
  evaluatorWork(session).decisionCalls++;
  const selection = selectRacecraftProgram(session, entry, entries);
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
  const candidates = programs.map(program => program.evaluation);
  const rejected = candidates.filter(candidate => !candidate.feasible);
  session.racecraftRejectedCandidates =
    (session.racecraftRejectedCandidates ?? 0) + rejected.length;
  const rejectedByConstraint = session.racecraftRejectedByConstraint ??
    (session.racecraftRejectedByConstraint = {});
  for (const candidate of rejected)
    for (const veto of candidate.vetoes)
      rejectedByConstraint[veto] = (rejectedByConstraint[veto] ?? 0) + 1;
  if (best && previousKind != null &&
      best.evaluation.kind !== previousKind)
    session.racecraftDecisionSwitches =
      (session.racecraftDecisionSwitches ?? 0) + 1;
  const neighbors = exactInteractionNeighbors(session, active, entries);
  const selectedFamilyId = best
    ? racecraftStableFamilyId(
        best.evaluation.kind,
        best.evaluation.plan,
        best.evaluation.slowPointOwnerCode
      )
    : null;
  const selectedFamilyNumericId =
    best?.evaluation.familyNumericId ?? null;
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
          progress: [...best.speedLaw.progress],
          speed: [...best.speedLaw.speed],
          brakingEffort: best.speedLaw.brakingEffort,
          slowPointOwnerCode: best.evaluation.slowPointOwnerCode,
          bindingSlowPoint: best.speedLaw.slowPoint
        }
      : null,
    economics: economics.map(context => ({
      rivalCode: context.rival.code,
      role: context.role,
      opportunityPresent: context.opportunityPresent,
      paceDifferentialSecondsPerLap:
        context.paceDifferentialSecondsPerLap,
      reopportunitySeconds: context.reopportunitySeconds,
      positionValueSeconds: context.positionValueSeconds
    })),
    certificate: makeDecisionCertificate(
      session,
      active,
      neighbors,
      selectedFamilyNumericId,
      selectedFamilyId,
      false
    ),
    candidates
  };
  const frozenEntries = [
    active,
    ...selection.hazards.map(hazard => hazard.other)
  ].filter((candidate, index, all) =>
    all.findIndex(value => value.code === candidate.code) === index
  ).map(freezeActiveEntry);
  const frozenByCode = new Map(frozenEntries.map(candidate => [
    candidate.code,
    candidate
  ]));
  const frozenActive = frozenByCode.get(active.code)!;
  const frozenHazards: Hazard[] = selection.hazards.map(hazard => {
    const frozen: Hazard = {
      ...hazard,
      other: frozenByCode.get(hazard.other.code)!,
      rivalSweepGeometry: null
    };
    if (hazard.bestPlanContinuation)
      frozen.bestPlanContinuation = {
        ...hazard.bestPlanContinuation,
        speedLaw: {
          ...hazard.bestPlanContinuation.speedLaw,
          progress: [...hazard.bestPlanContinuation.speedLaw.progress],
          speed: [...hazard.bestPlanContinuation.speedLaw.speed]
        },
        stations: hazard.bestPlanContinuation.stations.map(station => ({
          ...station
        })),
        evaluationClaims:
          new Map(hazard.bestPlanContinuation.evaluationClaims)
      };
    else frozen.bestPlanContinuation = null;
    return frozen;
  });
  standingDecisionEvaluations.set(decision, {
    at: session.t,
    session: freezeStandingSession(session, frozenEntries),
    entry: frozenActive,
    entries: frozenEntries,
    evaluationClaims: selection.evaluationClaims,
    programs,
    hazards: frozenHazards,
    selected: best
  });
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
  appendDecisionLog(session, entry, decision);
  return decision;
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
