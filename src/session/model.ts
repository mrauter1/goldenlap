import type {
  Car, CarInput, CarModifiers, LapTracker, LegacyCorner, PathMode, SampledPath,
  SpeedProfile, Track
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
  | 'egress-reservation'
  | 'merge-traffic';
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

export interface PathPlanAnchor { index: number; offset: number }
export type DynamicPathMode = Exclude<PathMode, 'ideal' | 'pit'>;
export type PathPlan =
  | { mode: 'ideal'; key: 'ideal' }
  | { mode: 'pit'; key: string; anchors: PathPlanAnchor[] }
  | {
      mode: DynamicPathMode;
      key: string;
      anchors: PathPlanAnchor[];
      cornerId?: string;
      complexId?: string | null;
      corridor?: { minimum: number; maximum: number };
    };

export interface SideBySidePair {
  t0: number;
  contact: boolean;
  seen: number;
  a: string;
  b: string;
}

export interface SideBySideEpisode { t: number; contact: boolean; reason: string }
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
  first: number;
  last: number;
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
  capA: number;
  capB: number;
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
  latTgt: number;
  gridLat: number;
  vCap: number;
  trafCap: number;
  liftT: number;
  yieldT: number;
  atkT: number;
  atkSide: number;
  atkCorner: number;
  atkCd: number;
  atkSeq: number;
  closeT: number;
  defT: number;
  defCorner: number;
  defAbs: number;
  concedeT: number;
  concedeV: number;
  tuckT: number;
  tow: number;
  lungeT: number;
  recT: number;
  avoidT: number;
  _avoidWith: string;
  _avoidSide: number;
  _roomWith: string;
  _tuckWith: string;
  _tuckCorner: number;
  _lungeRoll: number;
  mistT: number;
  battle: boolean;
  focusNow: number;
  flow: number[] | null;
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
  path?: SampledPath;
  pathMode?: PathMode;
  pathPlan?: PathPlan;
  pathBuildN?: number;
  pathModeSince?: number;
  pathModeTime?: Partial<Record<PathMode, number>>;
  pathMaxSlew?: number;
  _mishap?: boolean;
  _pitMergeCommitted?: boolean;
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
  _roomActive?: boolean;
  _defMoveKey?: string;
  _defSeenKey?: string;
  _hitT?: number;
  _bestCps?: number[] | undefined;
  _curCps?: number[];
  _cpSeen?: number;
  _dLive?: number | null;
  priorityYield?: PriorityYield;
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
  hitSamples?: HitSample[];
  concedeN?: number;
  concedeSoftN?: number;
  sbsT?: number;
  sbsPairs?: Record<string, SideBySidePair>;
  sbsEpisodes?: SideBySideEpisode[];
  _sbsStamp?: number;
  roomPairs?: Record<string, LegacyRoomPair>;
  _roomStamp?: number;
  tuckFailN?: number;
  tuckExitN?: number;
  lungeN?: number;
  lockupN?: number;
  defMoveN?: number;
  defRepeatN?: number;
  pitReservations?: Map<string, PitReservation>;
  pitDeadlocks?: PitDeadlockRecord[];
  pitForeignFalseLeaders?: number;
  pitUnintendedWait?: number;
  priorityRecords?: Map<string, PriorityRecord>;
  priorityHistory?: PriorityHistory[];
  priorityActivations?: number;
  blueFlagActivations?: number;
  qualifyingPriorityActivations?: number;
  priorityLateDetections?: number;
  priorityObstructionTime?: number;
  priorityIllegalDecisions?: number;
  priorityHandoffs?: number;
  priorityPathCrossings?: number;
  priorityMaximumQueue?: number;
  cornerRights?: Map<string, CornerRightsRecord>;
  cornerRightsHistory?: CornerRightsHistory[];
  cornerRightsAssignments?: Map<string, CornerCorridorAssignment>;
  cornerRightsStamp?: number;
  cornerRightsAcquisitions?: number;
  cornerRightsReleases?: number;
  cornerRightsHandoffs?: number;
  cornerRightsViolations?: number;
  cornerRightsThreeCarFallbacks?: number;
  cornerRightsMinimumSeparation?: number;
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

export type PriorityReason = 'blue-flag' | 'qualifying';
export interface PriorityYield { reason: PriorityReason; beneficiary: string }
export interface PriorityRecord {
  key: string;
  reason: PriorityReason;
  beneficiary: Entry;
  yielding: Entry;
  acquiredAt: number;
  lastSeenAt: number;
  lastGap: number;
  filteredClosing: number;
  closingAge: number;
  timeToCatch: number;
  yieldSide: number;
  detectedPhase: 'straight' | 'approach' | 'corner' | 'pit-entry';
  holdUntilI: number | null;
  clearFor: number;
  minimumGap: number;
  maximumGap: number;
  obstructionTime: number;
  pathCrossings: number;
  lastLateralOrder: number;
  suppressionApplied: boolean;
  illegalDecisionActive: boolean;
}
export interface PriorityHistory {
  key: string;
  reason: PriorityReason;
  release: string;
  duration: number;
  maximumGap: number;
  minimumGap?: number;
  detectedPhase?: PriorityRecord['detectedPhase'];
  obstructionTime?: number;
  pathCrossings?: number;
}

export interface EntryStepCallbacks { onLine(entry: Entry, session: Session, valid: boolean): void }

export interface RacecraftPathState { mode: PathMode; path: SampledPath }
export interface CornerRightsRecord {
  key: string;
  cornerId: string;
  complexId: string | null;
  inside: Entry;
  outside: Entry;
  insideCode: string;
  outsideCode: string;
  attackerCode: string | null;
  defenderCode: string | null;
  acquiredAt: number;
  acquiredPhase: 'approach' | 'brake' | 'turn-in';
  insideTarget: number;
  outsideTarget: number;
  requiredSeparation: number;
  corridorCenter?: number;
  insideCorridorMinimum?: number;
  insideCorridorMaximum?: number;
  outsideCorridorMinimum?: number;
  outsideCorridorMaximum?: number;
  previousInsideLateral?: number;
  previousOutsideLateral?: number;
  previousSeparation?: number;
  closingRate?: number;
  predictedSeparation?: number;
  minimumSeparation?: number;
  violationCount?: number;
  violationActive?: boolean;
  handoffs?: number;
  defenseCancelled?: boolean;
  lastSeenStamp: number;
  clearFor: number;
}
export interface CornerCorridorAssignment {
  entry: Entry;
  code: string;
  cornerId: string;
  role: 'inside' | 'middle' | 'outside';
  target: number;
  minimum: number;
  maximum: number;
}
export interface CornerRightsHistory {
  key: string;
  cornerId: string;
  acquiredAt: number;
  releasedAt: number;
  release: string;
  minimumSeparation?: number;
  violations?: number;
  handoffs?: number;
}

export function carModifiers(entry: Entry): CarModifiers {
  return { pw: entry.mods.pw, mu: entry.mods.hMu, dr: entry.mods.dr };
}
