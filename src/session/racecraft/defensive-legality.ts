import {
  carBodyCircleClearance,
  type SweptCarContactEpisode
} from '../../core/collision';
import type {
  LegacyCorner,
  Track
} from '../../core/model';
import { PHYS } from '../../core/physics';
import { normAng } from '../../shared/math';
import type {
  Entry,
  RacecraftDefensiveCandidateRejection,
  RacecraftDefensiveMoveCommitment,
  RacecraftDefensiveMoveOutcome,
  RacecraftLongitudinalProgram,
  RacecraftTimedTrajectoryProgram,
  Session
} from '../model';
import {
  cloneRacecraftTrajectoryProgram,
  racecraftTrajectoryProgressAtTime,
  writeRacecraftTrajectoryStateAtTime,
  type RacecraftClaimState
} from './claim';
import { racecraftCalibration } from './config';
import {
  continuousTimedTrajectoryContactEpisodes
} from './corner-ownership';
import {
  firstRacecraftCornerBrakingBinding
} from './longitudinal-program';

const CONTINUOUS_TIME_SUBDIVISIONS = 2;
const ROOT_ITERATIONS = 48;
const GEOMETRY_EPSILON_METRES = 1e-7;

export type RacecraftDefensiveMoveClassification =
  | 'not-impeding'
  | 'safety-only'
  | 'new-move'
  | 'continuation';

export interface RacecraftDefensiveTimingClassification {
  readonly legal: boolean;
  readonly rejectionReason: RacecraftDefensiveCandidateRejection | null;
  readonly noticeDeadlineSessionTimeSeconds: number | null;
  readonly roomProtected: boolean;
  readonly approachConflictAuthorized: boolean;
  readonly outcome: RacecraftDefensiveMoveOutcome;
}

export interface RacecraftDefensiveLegalityResult
  extends RacecraftDefensiveTimingClassification {
  readonly classification: RacecraftDefensiveMoveClassification;
  readonly targetCode: string;
  readonly cornerId: string;
  readonly tEncroachSessionTimeSeconds: number | null;
  readonly tBrakeSessionTimeSeconds: number | null;
  readonly tConflictSessionTimeSeconds: number | null;
  readonly tAlongsideSessionTimeSeconds: number | null;
  readonly turnInSessionTimeSeconds: number | null;
  readonly commitment: RacecraftDefensiveMoveCommitment | null;
}

function carriesDefensiveMoveAuthority(
  result: RacecraftDefensiveLegalityResult | null
): boolean {
  return result?.legal === true &&
    (
      result.classification === 'new-move' ||
      result.classification === 'continuation'
    );
}

/** A cover remains defensive; it cannot manufacture outgoing apex rights. */
export function racecraftCandidateMayAuthorCornerOwnership(
  defensiveLegality: RacecraftDefensiveLegalityResult | null
): boolean {
  return !carriesDefensiveMoveAuthority(defensiveLegality);
}

/** A lateral reclaim must independently qualify as this corner's one move. */
export function racecraftDefensiveLegalityAuthorizesReclaim(
  defensiveLegality: RacecraftDefensiveLegalityResult | null
): boolean {
  return carriesDefensiveMoveAuthority(defensiveLegality);
}

export interface EvaluateRacecraftDefensiveLegalityInput {
  readonly session: Session;
  readonly defender: Entry;
  readonly attacker: Entry;
  readonly attackerPublicationRevision: number;
  readonly coveredSide: -1 | 1;
  readonly corner: LegacyCorner;
  readonly cornerExitProgressMetres: number;
  readonly previousDefenderTrajectory:
    RacecraftTimedTrajectoryProgram | null;
  readonly candidateDefenderTrajectory:
    RacecraftTimedTrajectoryProgram;
  readonly attackerTrajectory: RacecraftTimedTrajectoryProgram;
  readonly candidateLongitudinalProgram:
    RacecraftLongitudinalProgram;
  readonly evaluateUntilSessionTimeSeconds: number;
  readonly existingCommitment:
    RacecraftDefensiveMoveCommitment | null;
  readonly attackerAlreadyAlongside: boolean;
  readonly ownershipProtectsRoom: boolean;
  readonly safetyOnly: boolean;
}

interface TimedState extends RacecraftClaimState {
  sessionTimeSeconds: number;
}

const timedStateScratch = Array.from(
  { length: 8 },
  (): TimedState => ({
    progressMetres: 0,
    s: 0,
    lateral: 0,
    speed: 0,
    headingOffsetRadians: 0,
    sessionTimeSeconds: 0
  })
);
let timedStateScratchCursor = 0;
const continuousBreakpointScratch: number[] = [];
const continuousTimeScratch: number[] = [];

function forwardTrackDistance(
  track: Track,
  from: number,
  to: number
): number {
  const distance = to - from;
  return distance < 0 ? distance + track.len : distance;
}

function signedTrackDistance(
  track: Track,
  from: number,
  to: number
): number {
  const forward = forwardTrackDistance(track, from, to);
  return forward > track.len / 2 ? forward - track.len : forward;
}

function stateAt(
  track: Track,
  timed: RacecraftTimedTrajectoryProgram,
  sessionTimeSeconds: number
): TimedState {
  const state = timedStateScratch[
    timedStateScratchCursor++ % timedStateScratch.length
  ]!;
  writeRacecraftTrajectoryStateAtTime(
    track,
    timed.trajectory,
    timed.trajectoryTimeOffsetSeconds +
      sessionTimeSeconds -
      timed.authoredAtSessionTimeSeconds,
    state
  );
  state.sessionTimeSeconds = sessionTimeSeconds;
  return state;
}

function appendTimedBreakpoints(
  output: number[],
  timed: RacecraftTimedTrajectoryProgram,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): void {
  const program = timed.trajectory;
  for (let index = 0; index < program.segmentCount; index++) {
    const startTime = program.segmentStartTime[index]!;
    const endTime = program.segmentEndTime[index]!;
    for (let boundary = 0; boundary < 2; boundary++) {
      const programTime = boundary === 0 ? startTime : endTime;
      const time = timed.authoredAtSessionTimeSeconds +
        programTime - timed.trajectoryTimeOffsetSeconds;
      if (time > fromSessionTimeSeconds &&
          time < toSessionTimeSeconds)
        output.push(time);
    }
  }
}

function continuousTimes(
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number,
  trajectories: readonly RacecraftTimedTrajectoryProgram[]
): number[] {
  const breakpoints = continuousBreakpointScratch;
  breakpoints.length = 2;
  breakpoints[0] = fromSessionTimeSeconds;
  breakpoints[1] = toSessionTimeSeconds;
  for (const trajectory of trajectories)
    appendTimedBreakpoints(
      breakpoints,
      trajectory,
      fromSessionTimeSeconds,
      toSessionTimeSeconds
    );
  breakpoints.sort((left, right) => left - right);
  let uniqueCount = Math.min(1, breakpoints.length);
  for (let index = 1; index < breakpoints.length; index++) {
    if (Math.abs(
      breakpoints[index]! - breakpoints[uniqueCount - 1]!
    ) <= Number.EPSILON) continue;
    breakpoints[uniqueCount++] = breakpoints[index]!;
  }
  breakpoints.length = uniqueCount;
  const times = continuousTimeScratch;
  times.length = 1;
  times[0] = breakpoints[0]!;
  for (let index = 1; index < breakpoints.length; index++) {
    const from = breakpoints[index - 1]!;
    const to = breakpoints[index]!;
    for (let subdivision = 1;
      subdivision <= CONTINUOUS_TIME_SUBDIVISIONS;
      subdivision++)
      times.push(
        from + (to - from) *
          subdivision / CONTINUOUS_TIME_SUBDIVISIONS
      );
  }
  return times;
}

function orientedLateralHalfExtent(
  headingOffsetRadians: number
): number {
  return Math.abs(Math.sin(headingOffsetRadians)) *
      PHYS.carLen / 2 +
    Math.abs(Math.cos(headingOffsetRadians)) *
      PHYS.carWid / 2;
}

function orientedLongitudinalHalfExtent(
  headingOffsetRadians: number
): number {
  return Math.abs(Math.cos(headingOffsetRadians)) *
      PHYS.carLen / 2 +
    Math.abs(Math.sin(headingOffsetRadians)) *
      PHYS.carWid / 2;
}

function selectedSideClearance(
  attacker: TimedState,
  defender: TimedState,
  side: -1 | 1
): number {
  return side * (attacker.lateral - defender.lateral) -
    orientedLateralHalfExtent(attacker.headingOffsetRadians) -
    orientedLateralHalfExtent(defender.headingOffsetRadians);
}

function selectedSideOuterEdge(
  state: TimedState,
  side: -1 | 1
): number {
  return side * state.lateral +
    orientedLateralHalfExtent(state.headingOffsetRadians);
}

function firstOrientedRoomViolationTime(
  track: Track,
  defender: RacecraftTimedTrajectoryProgram,
  attacker: RacecraftTimedTrajectoryProgram,
  side: -1 | 1,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): number | null {
  const times = continuousTimes(
    fromSessionTimeSeconds,
    toSessionTimeSeconds,
    [defender, attacker]
  );
  return firstPositiveTime(times, time => {
    const defenderState = stateAt(track, defender, time);
    const attackerState = stateAt(track, attacker, time);
    const sideOrder = side * (
      attackerState.lateral - defenderState.lateral
    ) + GEOMETRY_EPSILON_METRES;
    const longitudinalOverlap =
      orientedLongitudinalHalfExtent(
        defenderState.headingOffsetRadians
      ) +
      orientedLongitudinalHalfExtent(
        attackerState.headingOffsetRadians
      ) -
      Math.abs(signedTrackDistance(
        track,
        defenderState.s,
        attackerState.s
      )) + GEOMETRY_EPSILON_METRES;
    const roomInvasion = -selectedSideClearance(
      attackerState,
      defenderState,
      side
    ) - GEOMETRY_EPSILON_METRES;
    return Math.min(
      sideOrder,
      longitudinalOverlap,
      roomInvasion
    );
  });
}

function firstPositiveTime(
  times: readonly number[],
  valueAt: (sessionTimeSeconds: number) => number
): number | null {
  let fromTime = times[0]!;
  let fromValue = valueAt(fromTime);
  if (fromValue > GEOMETRY_EPSILON_METRES) return fromTime;
  for (let index = 1; index < times.length; index++) {
    const toTime = times[index]!;
    const toValue = valueAt(toTime);
    if (toValue <= GEOMETRY_EPSILON_METRES) {
      fromTime = toTime;
      fromValue = toValue;
      continue;
    }
    let low = fromTime;
    let high = toTime;
    for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration++) {
      const midpoint = (low + high) / 2;
      if (valueAt(midpoint) > GEOMETRY_EPSILON_METRES) high = midpoint;
      else low = midpoint;
    }
    return high;
  }
  return null;
}

function firstEncroachmentTime(
  track: Track,
  previous: RacecraftTimedTrajectoryProgram,
  candidate: RacecraftTimedTrajectoryProgram,
  side: -1 | 1,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): number | null {
  const times = continuousTimes(
    fromSessionTimeSeconds,
    toSessionTimeSeconds,
    [previous, candidate]
  );
  const initialPrevious = stateAt(
    track,
    previous,
    fromSessionTimeSeconds
  );
  const initialCandidate = stateAt(
    track,
    candidate,
    fromSessionTimeSeconds
  );
  const initialReduction =
    selectedSideOuterEdge(initialCandidate, side) -
    selectedSideOuterEdge(initialPrevious, side);
  return firstPositiveTime(times, time => {
    return selectedSideOuterEdge(
      stateAt(track, candidate, time),
      side
    ) - selectedSideOuterEdge(
      stateAt(track, previous, time),
      side
    ) - initialReduction;
  });
}

function candidateMovesTowardSideWithoutPrior(
  track: Track,
  candidate: RacecraftTimedTrajectoryProgram,
  side: -1 | 1,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): boolean {
  const times = continuousTimes(
    fromSessionTimeSeconds,
    toSessionTimeSeconds,
    [candidate]
  );
  const initial = stateAt(track, candidate, fromSessionTimeSeconds);
  const initialEdge = side * initial.lateral +
    orientedLateralHalfExtent(initial.headingOffsetRadians);
  return times.some(time => {
    const state = stateAt(track, candidate, time);
    return side * state.lateral +
      orientedLateralHalfExtent(state.headingOffsetRadians) >
      initialEdge + GEOMETRY_EPSILON_METRES;
  });
}

function contactEpisodes(
  track: Track,
  first: RacecraftTimedTrajectoryProgram,
  second: RacecraftTimedTrajectoryProgram,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): SweptCarContactEpisode[] {
  return continuousTimedTrajectoryContactEpisodes(
    track,
    first,
    second,
    fromSessionTimeSeconds,
    toSessionTimeSeconds
  );
}

interface DefensiveConflictEvidence {
  readonly tPhysicalConflictSessionTimeSeconds: number | null;
  readonly tRoomViolationSessionTimeSeconds: number | null;
  readonly tAlongsideSessionTimeSeconds: number | null;
}

function defensiveConflictEvidence(
  track: Track,
  defender: RacecraftTimedTrajectoryProgram,
  attacker: RacecraftTimedTrajectoryProgram,
  side: -1 | 1,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number,
  noticeDeadlineSessionTimeSeconds: number,
  attackerAlreadyAlongside: boolean,
  ownershipProtectsRoom: boolean
): DefensiveConflictEvidence {
  const episodes = contactEpisodes(
    track,
    defender,
    attacker,
    fromSessionTimeSeconds,
    toSessionTimeSeconds
  );
  const tPhysicalConflictSessionTimeSeconds =
    episodes[0]?.startTimeSeconds ?? null;
  const tAlongsideSessionTimeSeconds = firstLegalAlongsideTime(
    track,
    defender,
    attacker,
    side,
    fromSessionTimeSeconds,
    Math.min(
      toSessionTimeSeconds,
      tPhysicalConflictSessionTimeSeconds ??
        toSessionTimeSeconds
    )
  );
  const roomProtected = attackerAlreadyAlongside ||
    ownershipProtectsRoom ||
    (
      tAlongsideSessionTimeSeconds != null &&
      tAlongsideSessionTimeSeconds <=
        noticeDeadlineSessionTimeSeconds + Number.EPSILON
    );
  return {
    tPhysicalConflictSessionTimeSeconds,
    tRoomViolationSessionTimeSeconds: roomProtected
      ? firstOrientedRoomViolationTime(
        track,
        defender,
        attacker,
        side,
        fromSessionTimeSeconds,
        toSessionTimeSeconds
      )
      : null,
    tAlongsideSessionTimeSeconds
  };
}

function resolvedDefensiveConflictTiming(
  evidence: DefensiveConflictEvidence,
  noticeDeadlineSessionTimeSeconds: number,
  attackerAlreadyAlongside: boolean,
  ownershipProtectsRoom: boolean
): {
  readonly tConflictSessionTimeSeconds: number | null;
  readonly tAlongsideSessionTimeSeconds: number | null;
} {
  const roomProtected = attackerAlreadyAlongside ||
    ownershipProtectsRoom ||
    (
      evidence.tAlongsideSessionTimeSeconds != null &&
      evidence.tAlongsideSessionTimeSeconds <=
        noticeDeadlineSessionTimeSeconds + Number.EPSILON
    );
  const conflicts = [
    evidence.tPhysicalConflictSessionTimeSeconds,
    ...(roomProtected
      ? [evidence.tRoomViolationSessionTimeSeconds]
      : [])
  ].filter((value): value is number => value != null);
  return {
    tConflictSessionTimeSeconds:
      conflicts.length > 0 ? Math.min(...conflicts) : null,
    tAlongsideSessionTimeSeconds:
      evidence.tAlongsideSessionTimeSeconds
  };
}

function legalAlongsideAt(
  track: Track,
  defender: RacecraftTimedTrajectoryProgram,
  attacker: RacecraftTimedTrajectoryProgram,
  side: -1 | 1,
  time: number
): boolean {
  const defenderState = stateAt(track, defender, time);
  const attackerState = stateAt(track, attacker, time);
  if (side * (
    attackerState.lateral - defenderState.lateral
  ) < -GEOMETRY_EPSILON_METRES)
    return false;
  const longitudinalOverlap =
    orientedLongitudinalHalfExtent(
      defenderState.headingOffsetRadians
    ) +
    orientedLongitudinalHalfExtent(
      attackerState.headingOffsetRadians
    ) -
    Math.abs(signedTrackDistance(
      track,
      defenderState.s,
      attackerState.s
    ));
  if (longitudinalOverlap < -GEOMETRY_EPSILON_METRES)
    return false;
  return selectedSideClearance(
    attackerState,
    defenderState,
    side
  ) >= -GEOMETRY_EPSILON_METRES;
}

function firstLegalAlongsideTime(
  track: Track,
  defender: RacecraftTimedTrajectoryProgram,
  attacker: RacecraftTimedTrajectoryProgram,
  side: -1 | 1,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): number | null {
  const times = continuousTimes(
    fromSessionTimeSeconds,
    toSessionTimeSeconds,
    [defender, attacker]
  );
  if (legalAlongsideAt(
    track,
    defender,
    attacker,
    side,
    times[0]!
  )) return times[0]!;
  for (let index = 1; index < times.length; index++) {
    const to = times[index]!;
    if (!legalAlongsideAt(track, defender, attacker, side, to))
      continue;
    let low = times[index - 1]!;
    let high = to;
    for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration++) {
      const midpoint = (low + high) / 2;
      if (legalAlongsideAt(
        track,
        defender,
        attacker,
        side,
        midpoint
      )) high = midpoint;
      else low = midpoint;
    }
    return high;
  }
  return null;
}

function firstProgressCrossingTime(
  track: Track,
  trajectory: RacecraftTimedTrajectoryProgram,
  targetProgressMetres: number,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): number | null {
  const progressAt = (sessionTimeSeconds: number): number =>
    racecraftTrajectoryProgressAtTime(
      trajectory.trajectory,
      trajectory.trajectoryTimeOffsetSeconds +
        sessionTimeSeconds -
        trajectory.authoredAtSessionTimeSeconds
    );
  const from = progressAt(fromSessionTimeSeconds);
  if (from >= targetProgressMetres - Number.EPSILON)
    return fromSessionTimeSeconds;
  const to = progressAt(toSessionTimeSeconds);
  if (to < targetProgressMetres - Number.EPSILON)
    return null;
  let low = fromSessionTimeSeconds;
  let high = toSessionTimeSeconds;
  for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration++) {
    const midpoint = (low + high) / 2;
    if (progressAt(midpoint) >= targetProgressMetres)
      high = midpoint;
    else
      low = midpoint;
  }
  return high;
}

function candidateInsideAuthorizedEnvelope(
  track: Track,
  candidate: RacecraftTimedTrajectoryProgram,
  commitment: RacecraftDefensiveMoveCommitment,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): boolean {
  const authorized: RacecraftTimedTrajectoryProgram = {
    ownerCode: candidate.ownerCode,
    publicationRevision:
      commitment.authorizedDefenderPublicationRevision,
    authoredAtSessionTimeSeconds:
      commitment.authorizedAtSessionTimeSeconds,
    trajectoryTimeOffsetSeconds: 0,
    trajectory: commitment.authorizedTrajectory
  };
  const times = continuousTimes(
    fromSessionTimeSeconds,
    toSessionTimeSeconds,
    [candidate, authorized]
  );
  for (const time of times) {
    const candidateState = stateAt(track, candidate, time);
    const authorizedState = stateAt(track, authorized, time);
    const candidateEdge =
      commitment.coveredSide * candidateState.lateral +
      orientedLateralHalfExtent(
        candidateState.headingOffsetRadians
      );
    const authorizedEdge =
      commitment.coveredSide * authorizedState.lateral +
      orientedLateralHalfExtent(
        authorizedState.headingOffsetRadians
      );
    if (candidateEdge >
        authorizedEdge + GEOMETRY_EPSILON_METRES)
      return false;
  }
  return true;
}

export function classifyRacecraftDefensiveTiming(input: {
  readonly tEncroachSessionTimeSeconds: number;
  readonly tBrakeSessionTimeSeconds: number | null;
  readonly tConflictSessionTimeSeconds: number | null;
  readonly tAlongsideSessionTimeSeconds: number | null;
  readonly turnInSessionTimeSeconds: number | null;
  readonly attackerAlreadyAlongside: boolean;
  readonly ownershipProtectsRoom: boolean;
  readonly noticeSeconds: number;
}): RacecraftDefensiveTimingClassification {
  const deadline =
    input.tEncroachSessionTimeSeconds + input.noticeSeconds;
  const roomProtected =
    input.attackerAlreadyAlongside ||
    input.ownershipProtectsRoom ||
    (
      input.tAlongsideSessionTimeSeconds != null &&
      input.tAlongsideSessionTimeSeconds <=
        deadline + Number.EPSILON
    );
  const outcome: RacecraftDefensiveMoveOutcome =
    roomProtected
      ? 'room-protected'
      : 'side-closure-authorized';
  if (input.tBrakeSessionTimeSeconds == null)
    return {
      legal: false,
      rejectionReason: 'timing-unproved',
      noticeDeadlineSessionTimeSeconds: deadline,
      roomProtected,
      approachConflictAuthorized: false,
      outcome
    };
  if (input.tEncroachSessionTimeSeconds >=
      input.tBrakeSessionTimeSeconds - Number.EPSILON)
    return {
      legal: false,
      rejectionReason: 'post-braking',
      noticeDeadlineSessionTimeSeconds: deadline,
      roomProtected,
      approachConflictAuthorized: false,
      outcome
    };
  if (input.tConflictSessionTimeSeconds != null &&
      input.tConflictSessionTimeSeconds <
        deadline - Number.EPSILON)
    return {
      legal: false,
      rejectionReason: 'insufficient-notice',
      noticeDeadlineSessionTimeSeconds: deadline,
      roomProtected,
      approachConflictAuthorized: false,
      outcome
    };
  if (roomProtected &&
      input.tConflictSessionTimeSeconds != null)
    return {
      legal: false,
      rejectionReason: input.ownershipProtectsRoom
        ? 'ownership-room'
        : 'timely-alongside-room',
      noticeDeadlineSessionTimeSeconds: deadline,
      roomProtected,
      approachConflictAuthorized: false,
      outcome
    };
  return {
    legal: true,
    rejectionReason: null,
    noticeDeadlineSessionTimeSeconds: deadline,
    roomProtected,
    approachConflictAuthorized:
      input.tConflictSessionTimeSeconds != null &&
      input.turnInSessionTimeSeconds != null &&
      input.tConflictSessionTimeSeconds >=
        deadline - Number.EPSILON &&
      input.tConflictSessionTimeSeconds <
        input.turnInSessionTimeSeconds - Number.EPSILON,
    outcome
  };
}

function inheritedContinuationTiming(input: {
  readonly commitment: RacecraftDefensiveMoveCommitment;
  readonly tConflictSessionTimeSeconds: number | null;
  readonly tAlongsideSessionTimeSeconds: number | null;
  readonly turnInSessionTimeSeconds: number | null;
  readonly attackerAlreadyAlongside: boolean;
  readonly ownershipProtectsRoom: boolean;
}): RacecraftDefensiveTimingClassification {
  const deadline =
    input.commitment.noticeDeadlineSessionTimeSeconds;
  const roomProtected =
    input.attackerAlreadyAlongside ||
    input.ownershipProtectsRoom ||
    (
      input.tAlongsideSessionTimeSeconds != null &&
      input.tAlongsideSessionTimeSeconds <=
        deadline + Number.EPSILON
    );
  if (input.tConflictSessionTimeSeconds != null &&
      input.tConflictSessionTimeSeconds <
        deadline - Number.EPSILON)
    return {
      legal: false,
      rejectionReason: 'insufficient-notice',
      noticeDeadlineSessionTimeSeconds: deadline,
      roomProtected,
      approachConflictAuthorized: false,
      outcome: roomProtected
        ? 'room-protected'
        : 'side-closure-authorized'
    };
  if (roomProtected &&
      input.tConflictSessionTimeSeconds != null)
    return {
      legal: false,
      rejectionReason: input.ownershipProtectsRoom
        ? 'ownership-room'
        : 'timely-alongside-room',
      noticeDeadlineSessionTimeSeconds: deadline,
      roomProtected,
      approachConflictAuthorized: false,
      outcome: 'room-protected'
    };
  return {
    legal: true,
    rejectionReason: null,
    noticeDeadlineSessionTimeSeconds: deadline,
    roomProtected,
    approachConflictAuthorized:
      input.commitment.authoredOutcome ===
        'side-closure-authorized' &&
      input.tConflictSessionTimeSeconds != null &&
      input.turnInSessionTimeSeconds != null &&
      input.tConflictSessionTimeSeconds >=
        deadline - Number.EPSILON &&
      input.tConflictSessionTimeSeconds <
        input.turnInSessionTimeSeconds - Number.EPSILON,
    outcome: roomProtected
      ? 'room-protected'
      : input.commitment.authoredOutcome
  };
}

export function racecraftDefensiveCommitmentIsActive(
  commitment: RacecraftDefensiveMoveCommitment | null | undefined,
  defenderProgressMetres: number
): commitment is RacecraftDefensiveMoveCommitment {
  return commitment != null &&
    defenderProgressMetres <
      commitment.cornerExitProgressMetres - Number.EPSILON;
}

export function racecraftMeasuredLegalAlongside(
  session: Session,
  defender: Entry,
  attacker: Entry,
  side: -1 | 1
): boolean {
  if (!defender.car || !attacker.car) return false;
  const defenderIndex =
    Math.max(0, defender.car.progIdx) % session.trk.n;
  const attackerIndex =
    Math.max(0, attacker.car.progIdx) % session.trk.n;
  const defenderRoadHeading = Math.atan2(
    session.trk.ty[defenderIndex]!,
    session.trk.tx[defenderIndex]!
  );
  const attackerRoadHeading = Math.atan2(
    session.trk.ty[attackerIndex]!,
    session.trk.tx[attackerIndex]!
  );
  const defenderHeading = normAng(
    defender.car.h - defenderRoadHeading
  );
  const attackerHeading = normAng(
    attacker.car.h - attackerRoadHeading
  );
  const longitudinalOverlap =
    orientedLongitudinalHalfExtent(defenderHeading) +
    orientedLongitudinalHalfExtent(attackerHeading) -
    Math.abs(signedTrackDistance(
      session.trk,
      defender.car.s,
      attacker.car.s
    ));
  if (longitudinalOverlap < -GEOMETRY_EPSILON_METRES ||
      side * (attacker.latNow - defender.latNow) <
        -GEOMETRY_EPSILON_METRES)
    return false;
  // Existing light physical overlap is still measured alongside and must not
  // let a defender squeeze farther. The exact separator applies to the new
  // candidate from this state onward.
  return carBodyCircleClearance(
    attacker.car.x - defender.car.x,
    attacker.car.y - defender.car.y,
    defender.car.h,
    attacker.car.h
  ) >= -PHYS.carWid / 4 ||
    longitudinalOverlap >= 0;
}

export function defensiveContactEpisodeIsAuthorized(
  result: RacecraftDefensiveLegalityResult | null,
  targetCode: string,
  episode: Pick<
    SweptCarContactEpisode,
    'startTimeSeconds' | 'endTimeSeconds'
  >
): boolean {
  return result != null &&
    result.legal &&
    result.targetCode === targetCode &&
    result.approachConflictAuthorized &&
    result.noticeDeadlineSessionTimeSeconds != null &&
    result.turnInSessionTimeSeconds != null &&
    episode.startTimeSeconds >=
      result.noticeDeadlineSessionTimeSeconds - Number.EPSILON &&
    episode.endTimeSeconds <
      result.turnInSessionTimeSeconds - Number.EPSILON;
}

export function evaluateRacecraftDefensiveLegality(
  input: EvaluateRacecraftDefensiveLegalityInput
): RacecraftDefensiveLegalityResult {
  const start = input.session.t;
  const end = Math.max(
    start,
    input.evaluateUntilSessionTimeSeconds
  );
  const track = input.session.trk;
  const candidateStart = stateAt(
    track,
    input.candidateDefenderTrajectory,
    start
  );
  const turnInProgress = candidateStart.progressMetres +
    forwardTrackDistance(
      track,
      candidateStart.s,
      input.corner.turnInI * track.step
    );
  const brakeProgress = candidateStart.progressMetres +
    forwardTrackDistance(
      track,
      candidateStart.s,
      input.corner.brakeI * track.step
    );
  const turnInSessionTimeSeconds = firstProgressCrossingTime(
    track,
    input.candidateDefenderTrajectory,
    turnInProgress,
    start,
    end
  );
  const brake = firstRacecraftCornerBrakingBinding(
    input.candidateLongitudinalProgram,
    brakeProgress,
    turnInProgress
  );
  const tBrakeSessionTimeSeconds = brake
    ? start + brake.seconds
    : null;
  const approachEndSessionTimeSeconds = Math.min(
    end,
    turnInSessionTimeSeconds ?? end
  );
  const activeCommitment =
    racecraftDefensiveCommitmentIsActive(
      input.existingCommitment,
      input.defender.prog
    )
      ? input.existingCommitment
      : null;

  if (input.safetyOnly)
    return {
      classification: 'safety-only',
      legal: true,
      rejectionReason: null,
      targetCode: input.attacker.code,
      cornerId: input.corner.id,
      tEncroachSessionTimeSeconds: null,
      tBrakeSessionTimeSeconds,
      tConflictSessionTimeSeconds: null,
      tAlongsideSessionTimeSeconds: null,
      turnInSessionTimeSeconds,
      noticeDeadlineSessionTimeSeconds: null,
      roomProtected: false,
      approachConflictAuthorized: false,
      outcome: activeCommitment?.authoredOutcome ??
        'room-protected',
      commitment: activeCommitment
    };

  const tEncroachSessionTimeSeconds =
    input.previousDefenderTrajectory
      ? firstEncroachmentTime(
          track,
          input.previousDefenderTrajectory,
          input.candidateDefenderTrajectory,
          input.coveredSide,
          start,
          Math.min(
            end,
            turnInSessionTimeSeconds ?? end
          )
        )
      : null;
  const movesTowardWithoutPrior =
    input.previousDefenderTrajectory == null &&
    candidateMovesTowardSideWithoutPrior(
      track,
      input.candidateDefenderTrajectory,
      input.coveredSide,
      start,
      Math.min(end, turnInSessionTimeSeconds ?? end)
    );

  if (activeCommitment) {
    const insideEnvelope =
      activeCommitment.coveredSide === input.coveredSide &&
      candidateInsideAuthorizedEnvelope(
        track,
        input.candidateDefenderTrajectory,
        activeCommitment,
        start,
        Math.min(end, turnInSessionTimeSeconds ?? end)
      );
    if (insideEnvelope) {
      const evidence = defensiveConflictEvidence(
        track,
        input.candidateDefenderTrajectory,
        input.attackerTrajectory,
        input.coveredSide,
        start,
        approachEndSessionTimeSeconds,
        activeCommitment.noticeDeadlineSessionTimeSeconds,
        input.attackerAlreadyAlongside,
        input.ownershipProtectsRoom
      );
      const conflict = resolvedDefensiveConflictTiming(
        evidence,
        activeCommitment.noticeDeadlineSessionTimeSeconds,
        input.attackerAlreadyAlongside,
        input.ownershipProtectsRoom
      );
      const timing = inheritedContinuationTiming({
        commitment: activeCommitment,
        ...conflict,
        turnInSessionTimeSeconds,
        attackerAlreadyAlongside:
          input.attackerAlreadyAlongside,
        ownershipProtectsRoom: input.ownershipProtectsRoom
      });
      return {
        classification: 'continuation',
        ...timing,
        targetCode: input.attacker.code,
        cornerId: activeCommitment.cornerId,
        tEncroachSessionTimeSeconds,
        tBrakeSessionTimeSeconds,
        ...conflict,
        turnInSessionTimeSeconds,
        commitment: activeCommitment
      };
    }
    if (tEncroachSessionTimeSeconds != null ||
        movesTowardWithoutPrior)
      return {
        classification: 'new-move',
        legal: false,
        rejectionReason: 'move-spent',
        targetCode: input.attacker.code,
        cornerId: activeCommitment.cornerId,
        tEncroachSessionTimeSeconds,
        tBrakeSessionTimeSeconds,
        tConflictSessionTimeSeconds: null,
        tAlongsideSessionTimeSeconds: null,
        turnInSessionTimeSeconds,
        noticeDeadlineSessionTimeSeconds:
          activeCommitment.noticeDeadlineSessionTimeSeconds,
        roomProtected: false,
        approachConflictAuthorized: false,
        outcome: activeCommitment.authoredOutcome,
        commitment: activeCommitment
      };
    return {
      classification: 'not-impeding',
      legal: true,
      rejectionReason: null,
      targetCode: input.attacker.code,
      cornerId: activeCommitment.cornerId,
      tEncroachSessionTimeSeconds: null,
      tBrakeSessionTimeSeconds,
      tConflictSessionTimeSeconds: null,
      tAlongsideSessionTimeSeconds: null,
      turnInSessionTimeSeconds,
      noticeDeadlineSessionTimeSeconds:
        activeCommitment.noticeDeadlineSessionTimeSeconds,
      roomProtected: false,
      approachConflictAuthorized: false,
      outcome: activeCommitment.authoredOutcome,
      commitment: activeCommitment
    };
  }

  if (input.previousDefenderTrajectory == null &&
      movesTowardWithoutPrior)
    return {
      classification: 'new-move',
      legal: false,
      rejectionReason: 'timing-unproved',
      targetCode: input.attacker.code,
      cornerId: input.corner.id,
      tEncroachSessionTimeSeconds: null,
      tBrakeSessionTimeSeconds,
      tConflictSessionTimeSeconds: null,
      tAlongsideSessionTimeSeconds: null,
      turnInSessionTimeSeconds,
      noticeDeadlineSessionTimeSeconds: null,
      roomProtected: false,
      approachConflictAuthorized: false,
      outcome: 'room-protected',
      commitment: null
    };

  if (tEncroachSessionTimeSeconds == null)
    return {
      classification: 'not-impeding',
      legal: true,
      rejectionReason: null,
      targetCode: input.attacker.code,
      cornerId: input.corner.id,
      tEncroachSessionTimeSeconds: null,
      tBrakeSessionTimeSeconds,
      tConflictSessionTimeSeconds: null,
      tAlongsideSessionTimeSeconds: null,
      turnInSessionTimeSeconds,
      noticeDeadlineSessionTimeSeconds: null,
      roomProtected: false,
      approachConflictAuthorized: false,
      outcome: 'room-protected',
      commitment: null
    };

  const noticeSeconds =
    racecraftCalibration().defensiveBlockNoticeSeconds;
  const noticeDeadlineSessionTimeSeconds =
    tEncroachSessionTimeSeconds + noticeSeconds;
  const evidence = defensiveConflictEvidence(
    track,
    input.candidateDefenderTrajectory,
    input.attackerTrajectory,
    input.coveredSide,
    start,
    approachEndSessionTimeSeconds,
    noticeDeadlineSessionTimeSeconds,
    input.attackerAlreadyAlongside,
    input.ownershipProtectsRoom
  );
  const conflict = resolvedDefensiveConflictTiming(
    evidence,
    noticeDeadlineSessionTimeSeconds,
    input.attackerAlreadyAlongside,
    input.ownershipProtectsRoom
  );
  const timing = classifyRacecraftDefensiveTiming({
    tEncroachSessionTimeSeconds,
    tBrakeSessionTimeSeconds,
    ...conflict,
    turnInSessionTimeSeconds,
    attackerAlreadyAlongside: input.attackerAlreadyAlongside,
    ownershipProtectsRoom: input.ownershipProtectsRoom,
    noticeSeconds
  });
  const commitment = timing.legal
    ? Object.freeze({
        cornerId: input.corner.id,
        cornerExitProgressMetres:
          input.cornerExitProgressMetres,
        targetCodeAtCommitment: input.attacker.code,
        coveredSide: input.coveredSide,
        sourceAttackerPublicationRevision:
          input.attackerPublicationRevision,
        authorizedDefenderPublicationRevision:
          input.candidateDefenderTrajectory.publicationRevision,
        authorizedAtSessionTimeSeconds: start,
        authorizedTrajectory: cloneRacecraftTrajectoryProgram(
          input.candidateDefenderTrajectory.trajectory
        ),
        encroachmentStartSessionTimeSeconds:
          tEncroachSessionTimeSeconds,
        noticeDeadlineSessionTimeSeconds:
          timing.noticeDeadlineSessionTimeSeconds!,
        authoredFirstConflictSessionTimeSeconds:
          conflict.tConflictSessionTimeSeconds,
        authoredFirstAlongsideSessionTimeSeconds:
          conflict.tAlongsideSessionTimeSeconds,
        authoredOutcome: timing.outcome
      } satisfies RacecraftDefensiveMoveCommitment)
    : null;
  return {
    classification: 'new-move',
    ...timing,
    targetCode: input.attacker.code,
    cornerId: input.corner.id,
    tEncroachSessionTimeSeconds,
    tBrakeSessionTimeSeconds,
    ...conflict,
    turnInSessionTimeSeconds,
    commitment
  };
}
