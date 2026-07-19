import {
  botStep,
  PATH_FOLLOWER_SETTLE_DISTANCE
} from '../src/core/autopilot';
import type {
  BuiltTrack,
  CarInput,
  PathGeometry
} from '../src/core/model';
import { PHYS } from '../src/core/physics';
import {
  makeCar,
  stepCar,
  trackSense
} from '../src/core/physics-engine';
import { derivePathGeometry } from '../src/core/racing-line';
import { TEAM_DEFS } from '../src/data/teams';
import { PIT_TEAMS, TRACK_DEFS } from '../src/data/tracks';
import { createEntry } from '../src/session/entry';
import type {
  Entry,
  LineupEntry,
  PathPlan,
  RacecraftCandidateEvaluation,
  RaceSession,
  SessionConfig
} from '../src/session/model';
import {
  attackTransitionLossSeconds,
  residualAttackTransitionSeconds,
  summarizeMeasuredAttackTransitionLoss,
  type MeasuredAttackTransitionLossPoint
} from '../src/session/racecraft/attempt-loss';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from
  '../src/session/racecraft/cadence';
import {
  TRAFFIC_NEIGHBOR_SCAN_METRES
} from '../src/session/racecraft/config';
import {
  evaluateRacecraftDecision,
  rebuildRacecraftSelectedProgram
} from '../src/session/racecraft/evaluator';
import { racecraftFamilyStateAt } from
  '../src/session/racecraft/family-geometry';
import { MANEUVER_PREDICTION } from
  '../src/session/racecraft/feasibility';
import {
  evaluateLaneProgram,
  installRacecraftPathPlan
} from '../src/session/racecraft/lane-program';
import {
  entryDynamicMu,
  entryMargin,
  entryMods,
  flowOff,
  H_STEP,
  START_BLEND_END,
  TRAF_DT
} from '../src/session/strategy';
import { clamp } from '../src/shared/math';
import { buildTrackDefinition } from '../src/game/tracks';
import { rivalLevel } from '../src/game/weekend';

interface ProductionClass {
  id: string;
  lineup: LineupEntry;
  modifiers: {
    pw: number;
    dr: number;
    hMu: number;
  };
}

interface StraightScenario {
  id: string;
  startIndex: number;
  nextApproachIndex: number;
  availableMetres: number;
}

interface AuthoredPair {
  attack: RacecraftCandidateEvaluation;
  hold: RacecraftCandidateEvaluation;
  entry: Entry;
  initialSpeedMetresPerSecond: number;
  commonProgress: number;
}

export interface NonFiniteAttackTransitionCandidate {
  trackId: string;
  straightId: string;
  productionClass: string;
  kind: RacecraftCandidateEvaluation['kind'];
  planMode: PathPlan['mode'];
  ownTimeValue: 'NaN' | 'positive-infinity' | 'negative-infinity';
  analyticGeometryFinite: boolean;
  rolloutStationsFinite: boolean;
  withinHorizonIntegralFinite: boolean;
  installedLaneLawFinite: boolean;
  source:
    | 'candidate-geometry'
    | 'speed-law-or-rollout'
    | 'within-horizon-delta'
    | 'terminal-continuation';
}

interface AuthoredPairBatch {
  pairs: AuthoredPair[];
  nonFiniteCandidates: NonFiniteAttackTransitionCandidate[];
}

interface RefinementObservation {
  point: MeasuredAttackTransitionLossPoint;
  refinedResidualSeconds: number;
  residualRefinementDifferenceSeconds: number;
}

export interface AttackTransitionLossMeasurementReport {
  schemaVersion: 1;
  kind: 'measured-attack-transition-loss';
  method:
    'authored production side-family transition versus matched stay-behind control';
  source: 'measured';
  physicsStepSeconds: number;
  refinedPhysicsStepSeconds: number;
  controlStepSeconds: number;
  deliberationIntervalSeconds: number;
  commonProgressRule:
    'attack family authored terminal rejoin progress';
  straightOriginRule:
    'first grid sample after controller-settle distance beyond prior corner exit';
  leaderPlacementRule:
    'furthest in-grid centre point inside the production traffic scan';
  driverDomain:
    'all production AI team/driver slots at expected grid perturbation';
  trackIds: string[];
  productionClassCount: number;
  eligibleStraightCount: number;
  completeDomain: boolean;
  nonFiniteCandidates: NonFiniteAttackTransitionCandidate[];
  exclusions: {
    contact: 'rival absent from both matched replays';
    contest: 'candidate hazard count and contest bill required to be zero';
    proximity: 'rival absent from both matched replays';
    deterministicOwnPath:
      'attack minus stay-behind evaluator own-time removed exactly once';
  };
  convergence: {
    maximumResidualDifferenceSeconds: number;
    meanResidualDifferenceSeconds: number;
    baseResidualMeanSeconds: number;
    refinedResidualMeanSeconds: number;
    aggregateResidualMeanDifferenceSeconds: number;
    baseLossMeanSeconds: number;
    refinedLossMeanSeconds: number;
    aggregateLossMeanDifferenceSeconds: number;
  };
  summary: ReturnType<typeof summarizeMeasuredAttackTransitionLoss>;
  rows: MeasuredAttackTransitionLossPoint[];
}

const REFINED_PHYSICS_STEP_SECONDS = H_STEP / 2;
const CONTROL_STEP_SECONDS = H_STEP * 2;
const EXPECTED_AI_FOCUS = (0.45 + 0.75) / 2;
const DRIVER_MARGIN_OFFSET = 0.0045;
const MEASUREMENT_CONFIG: SessionConfig = Object.freeze({
  playerWearRate: 0,
  engineerPrecision: 0,
  pitSkill: 0,
  pitFocus: 0,
  tuneBonus: 0,
  tuningPoints: 0
});

function forwardMetres(
  built: BuiltTrack,
  fromIndex: number,
  toIndex: number
): number {
  const track = built.tr;
  return (
    ((toIndex - fromIndex) % track.n + track.n) % track.n
  ) * track.step;
}

function productionClasses(): ProductionClass[] {
  const result: ProductionClass[] = [];
  for (const team of TEAM_DEFS) {
    const level = rivalLevel(team.tier);
    team.drv.forEach((driver, index) => {
      const id = `${team.id}:${driver.c}`;
      result.push({
        id,
        lineup: {
          team,
          name: driver.n,
          code: `M-${driver.c}`,
          isPlayer: false,
          ci: -1,
          margin: team.tier +
            (index === 0 ? DRIVER_MARGIN_OFFSET : -DRIVER_MARGIN_OFFSET),
          focus: EXPECTED_AI_FOCUS,
          trait: ''
        },
        modifiers: {
          pw: 1 + 0.028 * level,
          dr: 1 - 0.045 * level,
          hMu: 1 + 0.010 * level
        }
      });
    });
  }
  return result;
}

function straightScenarios(built: BuiltTrack): StraightScenario[] {
  const track = built.tr;
  const settleSteps = Math.ceil(
    PATH_FOLLOWER_SETTLE_DISTANCE / track.step
  );
  const seen = new Set<string>();
  const result: StraightScenario[] = [];
  for (const previous of track.corners) {
    const startIndex = (
      previous.exitI + settleSteps
    ) % track.n;
    let next = track.corners[0]!;
    let nextDistance = Infinity;
    for (const candidate of track.corners) {
      const distance = forwardMetres(
        built,
        startIndex,
        candidate.approachI
      );
      if (distance <= Number.EPSILON || distance >= nextDistance) continue;
      next = candidate;
      nextDistance = distance;
    }
    const id = `${previous.id}->${next.id}`;
    const identity = `${startIndex}:${next.approachI}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({
      id,
      startIndex,
      nextApproachIndex: next.approachI,
      availableMetres: nextDistance
    });
  }
  return result;
}

function makeMeasurementSession(
  built: BuiltTrack,
  entries: Entry[]
): RaceSession {
  return {
    mode: 'race',
    trk: built.tr,
    prof: built.prof,
    config: MEASUREMENT_CONFIG,
    events: [],
    entries,
    t: START_BLEND_END,
    scale: 1,
    prevScale: 1,
    wet: 0,
    evo: 0.5,
    phase: 'run',
    countT: 0,
    _lt: 0,
    laps: 2,
    chequered: false,
    finCount: 0,
    goT: 0,
    winT: 0,
    endT: 0,
    uiT: 0,
    trafT: 0,
    camI: -1,
    raining: false,
    rainAt: -1,
    rainEnd: -1,
    sideAgreements: new Map()
  };
}

function makeMeasurementEntry(
  built: BuiltTrack,
  pathGeometry: PathGeometry,
  production: ProductionClass,
  code: string,
  progress: number,
  speed: number
): Entry {
  const track = built.tr;
  const wrapped = ((progress % track.len) + track.len) % track.len;
  const index = Math.round(wrapped / track.step) % track.n;
  const entry = createEntry({
    lineup: {
      ...production.lineup,
      code,
      name: code
    },
    teamIndex: 0,
    modifiers: production.modifiers
  });
  const car = makeCar(
    pathGeometry.x[index]!,
    pathGeometry.y[index]!,
    Math.atan2(pathGeometry.ty[index]!, pathGeometry.tx[index]!)
  );
  car.progIdx = index;
  car.s = index * track.step;
  car.vx = speed;
  car.spd = speed;
  entry.car = car;
  entry.state = 'run';
  entry.cross = Math.floor(progress / track.len);
  entry.prog = progress;
  entry.spd = speed;
  entry.latNow = track.idealPath.off[index]!;
  entry.lat = 0;
  entry.laneProgram.bias = 0;
  entry.focusNow = EXPECTED_AI_FOCUS;
  entry.mistT = Infinity;
  entry.flow = null;
  return entry;
}

function setEntrySpeed(entry: Entry, speed: number): void {
  entry.spd = speed;
  entry.car!.vx = speed;
  entry.car!.vy = 0;
  entry.car!.spd = speed;
}

function programSpeedAtProgress(
  stations: readonly {
    progress: number;
    speed: number;
  }[],
  progress: number
): number {
  if (!stations.length) return NaN;
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

function nonFiniteOwnTimeValue(
  value: number
): NonFiniteAttackTransitionCandidate['ownTimeValue'] {
  if (Number.isNaN(value)) return 'NaN';
  return value > 0 ? 'positive-infinity' : 'negative-infinity';
}

function diagnoseNonFiniteCandidate(
  built: BuiltTrack,
  pathGeometry: PathGeometry,
  production: ProductionClass,
  straight: StraightScenario,
  session: RaceSession,
  entry: Entry,
  candidate: RacecraftCandidateEvaluation,
  initialSpeed: number
): NonFiniteAttackTransitionCandidate {
  const distance = Math.max(8, initialSpeed) *
    MANEUVER_PREDICTION.horizonSeconds;
  const segments = Math.max(1, Math.ceil(distance / built.tr.step));
  const ds = distance / segments;
  let analyticGeometryFinite = true;
  for (let segment = 0; segment <= segments; segment++) {
    const progress = entry.prog + segment * ds;
    const state = racecraftFamilyStateAt(
      session,
      entry as Entry & { car: NonNullable<Entry['car']> },
      progress,
      candidate.plan
    );
    if ([
      state.lateral,
      state.curvature,
      state.q,
      state.headingOffsetRadians,
      state.targetSpeed,
      state.dynamicMu,
      state.surfaceDrag
    ].every(Number.isFinite))
      continue;
    analyticGeometryFinite = false;
    break;
  }

  const rebuilt = rebuildRacecraftSelectedProgram(
    session,
    entry,
    session.entries,
    candidate
  );
  const rolloutStationsFinite = !!rebuilt &&
    rebuilt.stations.length > 0 &&
    rebuilt.stations.every(station => [
      station.time,
      station.progress,
      station.s,
      station.lateral,
      station.speed,
      station.headingOffsetRadians
    ].every(Number.isFinite));

  let withinHorizonIntegral = 0;
  if (analyticGeometryFinite && rolloutStationsFinite) {
    const margin = clamp(
      entryMargin(
        entry,
        session,
        session.config.tuneBonus,
        session.wet
      ) + flowOff(entry, session),
      0.85,
      0.985
    );
    for (let segment = 0; segment < segments; segment++) {
      const progress = entry.prog + (segment + 0.5) * ds;
      const index = (
        entry.car!.progIdx +
        Math.round((progress - entry.prog) / built.tr.step)
      ) % built.tr.n;
      const wrappedIndex = (index + built.tr.n) % built.tr.n;
      const state = racecraftFamilyStateAt(
        session,
        entry as Entry & { car: NonNullable<Entry['car']> },
        progress,
        candidate.plan
      );
      const referenceQ = Math.max(
        Number.EPSILON,
        built.tr.idealPath.ds[wrappedIndex]! / built.tr.step
      );
      const referenceSpeed = Math.max(
        Number.EPSILON,
        built.tr.idealPath.v[wrappedIndex]! * margin
      );
      const candidateSpeed = programSpeedAtProgress(
        rebuilt!.stations,
        progress
      );
      withinHorizonIntegral += ds * (
        state.q / Math.max(Number.EPSILON, candidateSpeed) -
        referenceQ / referenceSpeed
      );
    }
  } else {
    withinHorizonIntegral = NaN;
  }
  const withinHorizonIntegralFinite =
    Number.isFinite(withinHorizonIntegral);

  const replayEntry = makeMeasurementEntry(
    built,
    pathGeometry,
    production,
    `${entry.code}-D`,
    entry.prog,
    initialSpeed
  );
  const replaySession = makeMeasurementSession(built, [replayEntry]);
  if (candidate.plan.mode !== 'ideal' &&
      candidate.plan.mode !== 'pit')
    installRacecraftPathPlan(
      built.tr,
      replayEntry,
      'measurement:non-finite-diagnostic',
      candidate.plan,
      'measurement'
    );
  const lane = evaluateLaneProgram(replaySession, replayEntry);
  let installedLaneLawFinite = true;
  for (let slot = 0; slot < lane.count; slot++) {
    if ([
      lane.off[slot],
      lane.k[slot],
      lane.v[slot],
      lane.ds[slot],
      lane.mu[slot],
      lane.drag[slot]
    ].every(Number.isFinite))
      continue;
    installedLaneLawFinite = false;
    break;
  }

  const source = !analyticGeometryFinite
    ? 'candidate-geometry'
    : !rolloutStationsFinite || !installedLaneLawFinite
      ? 'speed-law-or-rollout'
      : !withinHorizonIntegralFinite
        ? 'within-horizon-delta'
        : 'terminal-continuation';
  return {
    trackId: built.def.id,
    straightId: straight.id,
    productionClass: production.id,
    kind: candidate.kind,
    planMode: candidate.plan.mode,
    ownTimeValue: nonFiniteOwnTimeValue(candidate.ownTimeSeconds),
    analyticGeometryFinite,
    rolloutStationsFinite,
    withinHorizonIntegralFinite,
    installedLaneLawFinite,
    source
  };
}

function authoredAttackPairs(
  built: BuiltTrack,
  pathGeometry: PathGeometry,
  production: ProductionClass,
  straight: StraightScenario
): AuthoredPairBatch {
  const track = built.tr;
  const startS = straight.startIndex * track.step;
  const startProgress = 2 * track.len + startS;
  const leaderSteps = Math.max(
    1,
    Math.floor(TRAFFIC_NEIGHBOR_SCAN_METRES / track.step)
  );
  const leaderGap = leaderSteps * track.step;
  const ego = makeMeasurementEntry(
    built,
    pathGeometry,
    production,
    `${production.lineup.code}-E`,
    startProgress,
    0
  );
  const leader = makeMeasurementEntry(
    built,
    pathGeometry,
    production,
    `${production.lineup.code}-L`,
    startProgress + leaderGap,
    0
  );
  const session = makeMeasurementSession(built, [ego, leader]);
  const initialSpeed = track.idealPath.v[straight.startIndex]! *
    clamp(
      entryMargin(ego, session, session.config.tuneBonus, session.wet),
      0.85,
      0.985
    );
  const leaderIndex = leader.car!.progIdx;
  const leaderSpeed = track.idealPath.v[leaderIndex]! *
    clamp(
      entryMargin(leader, session, session.config.tuneBonus, session.wet),
      0.85,
      0.985
    );
  setEntrySpeed(ego, initialSpeed);
  setEntrySpeed(leader, leaderSpeed);

  if (straight.availableMetres + Number.EPSILON <
      leaderGap + PHYS.carLen)
    return { pairs: [], nonFiniteCandidates: [] };

  const decision = evaluateRacecraftDecision(session, ego, session.entries);
  if (!decision) return { pairs: [], nonFiniteCandidates: [] };
  const noHazard = (candidate: RacecraftCandidateEvaluation): boolean =>
    candidate.feasible &&
    candidate.hazardCount === 0 &&
    candidate.billSeconds === 0 &&
    candidate.recourseSeconds === 0;
  const relevant = decision.candidates.filter(candidate =>
    noHazard(candidate) &&
    (
      candidate.kind === 'hold' ||
      candidate.kind === 'corner-inside' ||
      candidate.kind === 'corner-outside'
    ));
  const nonFiniteCandidates = relevant
    .filter(candidate => !Number.isFinite(candidate.ownTimeSeconds))
    .map(candidate => diagnoseNonFiniteCandidate(
      built,
      pathGeometry,
      production,
      straight,
      session,
      ego,
      candidate,
      initialSpeed
    ));
  const hold = relevant.find(candidate =>
    candidate.kind === 'hold' &&
    Number.isFinite(candidate.ownTimeSeconds));
  if (!hold) return { pairs: [], nonFiniteCandidates };
  const pairs = relevant
    .filter(candidate =>
      (candidate.kind === 'corner-inside' ||
        candidate.kind === 'corner-outside') &&
      candidate.plan.mode !== 'ideal' &&
      candidate.plan.mode !== 'pit' &&
      candidate.plan.surfaceAuthorization !== 'emergency' &&
      Number.isFinite(candidate.ownTimeSeconds))
    .flatMap(attack => {
      const terminal = attack.plan.mode !== 'ideal' &&
          attack.plan.mode !== 'pit'
        ? attack.plan.anchors
            .map(anchor => anchor.s)
            .filter((value): value is number =>
              value != null &&
              value > startProgress + Number.EPSILON)
            .at(-1)
        : null;
      return terminal != null &&
          terminal - startProgress <= track.len / 2
        ? [{
            attack,
            hold,
            entry: ego,
            initialSpeedMetresPerSecond: initialSpeed,
            commonProgress: terminal
          }]
        : [];
    });
  return { pairs, nonFiniteCandidates };
}

function signedTrackDelta(
  trackLength: number,
  from: number,
  to: number
): number {
  const wrapped = ((to - from) % trackLength + trackLength) % trackLength;
  return wrapped > trackLength / 2 ? wrapped - trackLength : wrapped;
}

function replayToProgress(
  built: BuiltTrack,
  pathGeometry: PathGeometry,
  production: ProductionClass,
  source: Entry,
  plan: PathPlan,
  initialSpeed: number,
  targetProgress: number,
  brakingEffort: number,
  physicsStepSeconds: number
): number {
  const controlSteps = CONTROL_STEP_SECONDS / physicsStepSeconds;
  if (!Number.isInteger(controlSteps))
    throw new Error('physics refinement must divide the control cadence');
  const entry = makeMeasurementEntry(
    built,
    pathGeometry,
    production,
    `${source.code}-R`,
    source.prog,
    initialSpeed
  );
  const session = makeMeasurementSession(built, [entry]);
  if (plan.mode !== 'ideal' && plan.mode !== 'pit') {
    installRacecraftPathPlan(
      built.tr,
      entry,
      'measurement:attack-transition',
      plan,
      'measurement'
    );
    evaluateLaneProgram(session, entry);
  }
  const car = entry.car!;
  let input: CarInput = {
    steer: 0,
    throttle: 0,
    brake: 0,
    hand: false
  };
  let elapsed = 0;
  let progress = source.prog;
  let surface = trackSense(built.tr, car);
  entry.latNow = surface.lat!;
  entry.lat = surface.lat! -
    built.tr.idealPath.off[Math.max(0, car.progIdx) % built.tr.n]!;
  const maximumSeconds = built.tr.idealTiming.lapTime;
  for (let step = 0;
    elapsed < maximumSeconds;
    step++) {
    session.t = START_BLEND_END + elapsed;
    if (step % controlSteps === 0) {
      const dynamicMu = entryDynamicMu(entry, session);
      const modifiers = entryMods(entry, session.wet, dynamicMu);
      input = botStep(built.tr, built.prof, car, {
        margin: clamp(
          entryMargin(
            entry,
            session,
            session.config.tuneBonus,
            session.wet
          ) + flowOff(entry, session),
          0.85,
          0.985
        ),
        muScale: dynamicMu,
        downforceScale: modifiers.df,
        brakingEffort,
        powerScale: modifiers.pw,
        controlStepSeconds: CONTROL_STEP_SECONDS,
        path: built.tr.idealPath,
        ...(entry.laneBuffer ? { lane: entry.laneBuffer } : {})
      });
    }
    const previousProgress = progress;
    const previousS = car.s;
    const modifiers = entryMods(
      entry,
      session.wet,
      entryDynamicMu(entry, session)
    );
    stepCar(car, input, surface, physicsStepSeconds, modifiers);
    elapsed += physicsStepSeconds;
    surface = trackSense(built.tr, car);
    progress += signedTrackDelta(built.tr.len, previousS, car.s);
    entry.prog = progress;
    entry.spd = car.spd;
    entry.latNow = surface.lat!;
    entry.lat = surface.lat! -
      built.tr.idealPath.off[Math.max(0, car.progIdx) % built.tr.n]!;
    if (progress + Number.EPSILON < targetProgress) continue;
    const advanced = progress - previousProgress;
    const fraction = advanced > Number.EPSILON
      ? clamp(
          (targetProgress - previousProgress) / advanced,
          0,
          1
        )
      : 1;
    return elapsed - physicsStepSeconds +
      fraction * physicsStepSeconds;
  }
  throw new Error(
    `${built.def.id}:${production.id} did not reach the common station`
  );
}

function sideOf(candidate: RacecraftCandidateEvaluation): -1 | 1 {
  if (candidate.kind === 'corner-inside') return -1;
  if (candidate.kind === 'corner-outside') return 1;
  throw new Error(`${candidate.kind} is not an attack-family member`);
}

function measureAuthoredPair(
  built: BuiltTrack,
  pathGeometry: PathGeometry,
  production: ProductionClass,
  straight: StraightScenario,
  pair: AuthoredPair
): RefinementObservation {
  if (!Number.isFinite(pair.attack.ownTimeSeconds) ||
      !Number.isFinite(pair.hold.ownTimeSeconds))
    throw new Error(
      `${built.def.id}:${straight.id}:${production.id}:` +
      `${pair.attack.kind} has non-finite own time ` +
      `${pair.attack.ownTimeSeconds}/${pair.hold.ownTimeSeconds}`
    );
  const holdArrival = replayToProgress(
    built,
    pathGeometry,
    production,
    pair.entry,
    pair.hold.plan,
    pair.initialSpeedMetresPerSecond,
    pair.commonProgress,
    pair.hold.brakingEffort,
    H_STEP
  );
  const attackArrival = replayToProgress(
    built,
    pathGeometry,
    production,
    pair.entry,
    pair.attack.plan,
    pair.initialSpeedMetresPerSecond,
    pair.commonProgress,
    pair.attack.brakingEffort,
    H_STEP
  );
  const refinedHoldArrival = replayToProgress(
    built,
    pathGeometry,
    production,
    pair.entry,
    pair.hold.plan,
    pair.initialSpeedMetresPerSecond,
    pair.commonProgress,
    pair.hold.brakingEffort,
    REFINED_PHYSICS_STEP_SECONDS
  );
  const refinedAttackArrival = replayToProgress(
    built,
    pathGeometry,
    production,
    pair.entry,
    pair.attack.plan,
    pair.initialSpeedMetresPerSecond,
    pair.commonProgress,
    pair.attack.brakingEffort,
    REFINED_PHYSICS_STEP_SECONDS
  );
  const residual = residualAttackTransitionSeconds(
    attackArrival,
    holdArrival,
    pair.attack.ownTimeSeconds,
    pair.hold.ownTimeSeconds
  );
  const refinedResidual = residualAttackTransitionSeconds(
    refinedAttackArrival,
    refinedHoldArrival,
    pair.attack.ownTimeSeconds,
    pair.hold.ownTimeSeconds
  );
  const point: MeasuredAttackTransitionLossPoint = {
    trackId: built.def.id,
    straightId: straight.id,
    productionClass: production.id,
    side: sideOf(pair.attack),
    initialSpeedMetresPerSecond: pair.initialSpeedMetresPerSecond,
    commonProgressDistanceMetres:
      pair.commonProgress - pair.entry.prog,
    attackArrivalSeconds: attackArrival,
    stayBehindArrivalSeconds: holdArrival,
    attackOwnTimeSeconds: pair.attack.ownTimeSeconds,
    stayBehindOwnTimeSeconds: pair.hold.ownTimeSeconds,
    residualSeconds: residual,
    lossSeconds: attackTransitionLossSeconds(
      attackArrival,
      holdArrival,
      pair.attack.ownTimeSeconds,
      pair.hold.ownTimeSeconds
    )
  };
  return {
    point,
    refinedResidualSeconds: refinedResidual,
    residualRefinementDifferenceSeconds:
      Math.abs(residual - refinedResidual)
  };
}

export function measureAttackTransitionLoss():
AttackTransitionLossMeasurementReport {
  if (Math.abs(
    RACECRAFT_DECISION_INTERVAL_SECONDS - 3 * TRAF_DT
  ) > Number.EPSILON)
    throw new Error('measurement assumes the declared three-tick deliberation');
  const classes = productionClasses();
  const rows: MeasuredAttackTransitionLossPoint[] = [];
  const nonFiniteCandidates: NonFiniteAttackTransitionCandidate[] = [];
  const trackIds: string[] = [];
  let eligibleStraightCount = 0;
  let refinementDifferenceSum = 0;
  let refinementDifferenceMaximum = 0;
  let refinedResidualSum = 0;
  let refinedLossSum = 0;
  for (const definition of TRACK_DEFS) {
    const built = buildTrackDefinition(definition, PIT_TEAMS);
    const pathGeometry = derivePathGeometry(
      built.tr,
      built.tr.idealPath
    );
    const straights = straightScenarios(built);
    let trackSamples = 0;
    for (const straight of straights) {
      let straightSamples = 0;
      for (const production of classes) {
        const authored = authoredAttackPairs(
          built,
          pathGeometry,
          production,
          straight
        );
        nonFiniteCandidates.push(...authored.nonFiniteCandidates);
        for (const pair of authored.pairs) {
          const measured = measureAuthoredPair(
            built,
            pathGeometry,
            production,
            straight,
            pair
          );
          rows.push(measured.point);
          refinementDifferenceSum +=
            measured.residualRefinementDifferenceSeconds;
          refinementDifferenceMaximum = Math.max(
            refinementDifferenceMaximum,
            measured.residualRefinementDifferenceSeconds
          );
          refinedResidualSum += measured.refinedResidualSeconds;
          refinedLossSum += Math.max(
            0,
            measured.refinedResidualSeconds
          );
          straightSamples++;
          trackSamples++;
        }
      }
      if (straightSamples > 0) eligibleStraightCount++;
    }
    if (trackSamples > 0) trackIds.push(definition.id);
  }
  if (rows.length === 0)
    throw new Error('no production attack transition could be measured');
  const summary = summarizeMeasuredAttackTransitionLoss(rows);
  const refinedResidualMean = refinedResidualSum / rows.length;
  const refinedLossMean = refinedLossSum / rows.length;
  return {
    schemaVersion: 1,
    kind: 'measured-attack-transition-loss',
    method:
      'authored production side-family transition versus matched stay-behind control',
    source: 'measured',
    physicsStepSeconds: H_STEP,
    refinedPhysicsStepSeconds: REFINED_PHYSICS_STEP_SECONDS,
    controlStepSeconds: CONTROL_STEP_SECONDS,
    deliberationIntervalSeconds: RACECRAFT_DECISION_INTERVAL_SECONDS,
    commonProgressRule:
      'attack family authored terminal rejoin progress',
    straightOriginRule:
      'first grid sample after controller-settle distance beyond prior corner exit',
    leaderPlacementRule:
      'furthest in-grid centre point inside the production traffic scan',
    driverDomain:
      'all production AI team/driver slots at expected grid perturbation',
    trackIds,
    productionClassCount: classes.length,
    eligibleStraightCount,
    completeDomain: nonFiniteCandidates.length === 0,
    nonFiniteCandidates,
    exclusions: {
      contact: 'rival absent from both matched replays',
      contest: 'candidate hazard count and contest bill required to be zero',
      proximity: 'rival absent from both matched replays',
      deterministicOwnPath:
        'attack minus stay-behind evaluator own-time removed exactly once'
    },
    convergence: {
      maximumResidualDifferenceSeconds: refinementDifferenceMaximum,
      meanResidualDifferenceSeconds:
        refinementDifferenceSum / rows.length,
      baseResidualMeanSeconds: summary.residualMeanSeconds,
      refinedResidualMeanSeconds: refinedResidualMean,
      aggregateResidualMeanDifferenceSeconds: Math.abs(
        summary.residualMeanSeconds - refinedResidualMean
      ),
      baseLossMeanSeconds: summary.lossMeanSeconds,
      refinedLossMeanSeconds: refinedLossMean,
      aggregateLossMeanDifferenceSeconds: Math.abs(
        summary.lossMeanSeconds - refinedLossMean
      )
    },
    summary,
    rows
  };
}

if (import.meta.main)
  process.stdout.write(`${JSON.stringify(
    measureAttackTransitionLoss(),
    null,
    2
  )}\n`);
