import {
  isHardContactImpulse,
  sweptCarContactEpisodes,
  type SweptCarContactEpisode,
  type SweptCarPosePair
} from '../../core/collision';
import type { LegacyCorner, Track } from '../../core/model';
import { PHYS } from '../../core/physics';
import type {
  Entry,
  RacecraftClaim,
  RacecraftTimedTrajectoryProgram,
  RacecraftCornerOwnershipAssertion,
  Session,
  ValidatedCornerOwnership
} from '../model';
import { TRAF_DT } from '../strategy';
import { normAng } from '../../shared/math';
import {
  racecraftClaimStateAtTime,
  racecraftTrajectoryProgressAtTime,
  racecraftTrajectoryHorizonSeconds,
  writeRacecraftTrajectoryStateAtTime,
  type RacecraftClaimState
} from './claim';

const ROOT_ITERATIONS = 48;
const DIRECT_CONFLICT_SUBDIVISIONS = 2;
const TIME_EPSILON_SECONDS = 1e-9;

/**
 * One immutable direct trajectory together with the consumer-owned interval
 * on which conflict and gate authority may be derived.
 */
export interface RacecraftTrajectory
  extends RacecraftTimedTrajectoryProgram {
  readonly fromSessionTimeSeconds: number;
  readonly toSessionTimeSeconds: number;
}

export interface RacecraftTrajectoryConflict {
  readonly sessionTimeSeconds: number;
  readonly progressMetres: number;
}

export type CornerOwnershipClassification =
  | {
      readonly outcome: 'attacker-owned' | 'shared';
      readonly attackerApexArrivalSessionTimeSeconds: number;
      readonly leaderApexArrivalSessionTimeSeconds: number;
      readonly firstConflict: RacecraftTrajectoryConflict;
    }
  | {
      readonly outcome: 'leader-owned' | 'inactive';
      readonly attackerApexArrivalSessionTimeSeconds: number | null;
      readonly leaderApexArrivalSessionTimeSeconds: number | null;
      readonly firstConflict: RacecraftTrajectoryConflict | null;
    };

function forwardDistance(track: Track, from: number, to: number): number {
  const distance = to - from;
  return distance < 0 ? distance + track.len : distance;
}

function signedDistance(track: Track, from: number, to: number): number {
  const forward = forwardDistance(track, from, to);
  return forward > track.len / 2 ? forward - track.len : forward;
}

function gateProgress(
  track: Track,
  trajectory: RacecraftTrajectory,
  gateSMetres: number
): number | null {
  const first = continuousTrajectoryStateAtTime(
    track,
    trajectory,
    trajectory.fromSessionTimeSeconds
  );
  return first.progressMetres +
    forwardDistance(track, first.s, gateSMetres);
}

export function writeContinuousTrajectoryStateAtTime(
  track: Track,
  trajectory: RacecraftTrajectory,
  sessionTimeSeconds: number,
  out: RacecraftClaimState
): RacecraftClaimState {
  return writeRacecraftTrajectoryStateAtTime(
    track,
    trajectory.trajectory,
    trajectory.trajectoryTimeOffsetSeconds +
      sessionTimeSeconds -
      trajectory.authoredAtSessionTimeSeconds,
    out
  );
}

export function continuousTrajectoryStateAtTime(
  track: Track,
  trajectory: RacecraftTrajectory,
  sessionTimeSeconds: number
): RacecraftClaimState {
  return writeContinuousTrajectoryStateAtTime(
    track,
    trajectory,
    sessionTimeSeconds,
    {
      progressMetres: 0,
      s: 0,
      lateral: 0,
      speed: 0,
      headingOffsetRadians: 0
    }
  );
}

function continuousTrajectoryProgressAtTime(
  trajectory: RacecraftTrajectory,
  sessionTimeSeconds: number
): number {
  return racecraftTrajectoryProgressAtTime(
    trajectory.trajectory,
    trajectory.trajectoryTimeOffsetSeconds +
      sessionTimeSeconds -
      trajectory.authoredAtSessionTimeSeconds
  );
}

export function continuousTrajectoryGateCrossingTimeAtS(
  track: Track,
  trajectory: RacecraftTrajectory,
  gateSMetres: number
): number | null {
  const target = gateProgress(track, trajectory, gateSMetres);
  if (target == null) return null;
  const fromProgress = continuousTrajectoryProgressAtTime(
    trajectory,
    trajectory.fromSessionTimeSeconds
  );
  if (target <= fromProgress + Number.EPSILON)
    return trajectory.fromSessionTimeSeconds;
  const toProgress = continuousTrajectoryProgressAtTime(
    trajectory,
    trajectory.toSessionTimeSeconds
  );
  if (toProgress < target - Number.EPSILON) return null;
  let low = trajectory.fromSessionTimeSeconds;
  let high = trajectory.toSessionTimeSeconds;
  for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration++) {
    const midpoint = (low + high) / 2;
    if (continuousTrajectoryProgressAtTime(
      trajectory,
      midpoint
    ) >= target)
      high = midpoint;
    else
      low = midpoint;
  }
  return high;
}

interface TrackWorldPose {
  x: number;
  y: number;
  roadHeading: number;
  bodyHeading: number;
}

function writeTrackWorldPose(
  track: Track,
  point: RacecraftClaimState,
  out: TrackWorldPose
): TrackWorldPose {
  const sample = point.s / track.step;
  const index = Math.floor(sample) % track.n;
  const next = (index + 1) % track.n;
  const fraction = sample - Math.floor(sample);
  const x = track.x[index]! +
    (track.x[next]! - track.x[index]!) * fraction;
  const y = track.y[index]! +
    (track.y[next]! - track.y[index]!) * fraction;
  const nx = track.nx[index]! +
    (track.nx[next]! - track.nx[index]!) * fraction;
  const ny = track.ny[index]! +
    (track.ny[next]! - track.ny[index]!) * fraction;
  const tx = track.tx[index]! +
    (track.tx[next]! - track.tx[index]!) * fraction;
  const ty = track.ty[index]! +
    (track.ty[next]! - track.ty[index]!) * fraction;
  const roadHeading = Math.atan2(ty, tx);
  out.x = x + nx * point.lateral;
  out.y = y + ny * point.lateral;
  out.roadHeading = roadHeading;
  out.bodyHeading = roadHeading + point.headingOffsetRadians;
  return out;
}

function appendTimedTrajectoryBreakpoints(
  output: number[],
  trajectory: RacecraftTimedTrajectoryProgram,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): void {
  const program = trajectory.trajectory;
  for (let index = 0; index < program.segmentCount; index++) {
    for (let boundary = 0; boundary < 2; boundary++) {
      const programTime = boundary === 0
        ? program.segmentStartTime[index]!
        : program.segmentEndTime[index]!;
      const sessionTime =
        trajectory.authoredAtSessionTimeSeconds +
        programTime - trajectory.trajectoryTimeOffsetSeconds;
      if (sessionTime > fromSessionTimeSeconds &&
          sessionTime < toSessionTimeSeconds)
        output.push(sessionTime);
    }
  }
}

function directConflictTimes(
  first: RacecraftTimedTrajectoryProgram,
  second: RacecraftTimedTrajectoryProgram,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): number[] {
  const breakpoints = directConflictBreakpointScratch;
  breakpoints.length = 2;
  breakpoints[0] = fromSessionTimeSeconds;
  breakpoints[1] = toSessionTimeSeconds;
  appendTimedTrajectoryBreakpoints(
    breakpoints,
    first,
    fromSessionTimeSeconds,
    toSessionTimeSeconds
  );
  appendTimedTrajectoryBreakpoints(
    breakpoints,
    second,
    fromSessionTimeSeconds,
    toSessionTimeSeconds
  );
  breakpoints.sort((left, right) => left - right);
  let uniqueCount = Math.min(1, breakpoints.length);
  for (let index = 1; index < breakpoints.length; index++) {
    if (Math.abs(
      breakpoints[index]! - breakpoints[uniqueCount - 1]!
    ) <= TIME_EPSILON_SECONDS) continue;
    breakpoints[uniqueCount++] = breakpoints[index]!;
  }
  breakpoints.length = uniqueCount;
  const times = directConflictTimeScratch;
  times.length = 1;
  times[0] = breakpoints[0]!;
  for (let index = 1; index < breakpoints.length; index++) {
    const from = breakpoints[index - 1]!;
    const to = breakpoints[index]!;
    for (let subdivision = 1;
      subdivision <= DIRECT_CONFLICT_SUBDIVISIONS;
      subdivision++)
      times.push(
        from + (to - from) *
          subdivision / DIRECT_CONFLICT_SUBDIVISIONS
      );
  }
  return times;
}

const directConflictBreakpointScratch: number[] = [];
const directConflictTimeScratch: number[] = [];
const directConflictPoseScratch: SweptCarPosePair[] = [];
const directConflictAttackerStateScratch: RacecraftClaimState = {
  progressMetres: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};
const directConflictLeaderStateScratch: RacecraftClaimState = {
  progressMetres: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};
const directConflictAttackerPoseScratch: TrackWorldPose = {
  x: 0,
  y: 0,
  roadHeading: 0,
  bodyHeading: 0
};
const directConflictLeaderPoseScratch: TrackWorldPose = {
  x: 0,
  y: 0,
  roadHeading: 0,
  bodyHeading: 0
};

export function continuousTimedTrajectoryContactEpisodes(
  track: Track,
  attacker: RacecraftTimedTrajectoryProgram,
  leader: RacecraftTimedTrajectoryProgram,
  fromSessionTimeSeconds: number,
  toSessionTimeSeconds: number
): SweptCarContactEpisode[] {
  const start = Math.min(
    fromSessionTimeSeconds,
    toSessionTimeSeconds
  );
  const end = Math.max(
    fromSessionTimeSeconds,
    toSessionTimeSeconds
  );
  if (end <= start + TIME_EPSILON_SECONDS) return [];
  const times = directConflictTimes(attacker, leader, start, end);
  const attackerState = directConflictAttackerStateScratch;
  const leaderState = directConflictLeaderStateScratch;
  const poses = directConflictPoseScratch;
  for (let index = 0; index < times.length; index++) {
    const time = times[index]!;
    writeRacecraftTrajectoryStateAtTime(
      track,
      attacker.trajectory,
      attacker.trajectoryTimeOffsetSeconds +
        time - attacker.authoredAtSessionTimeSeconds,
      attackerState
    );
    writeRacecraftTrajectoryStateAtTime(
      track,
      leader.trajectory,
      leader.trajectoryTimeOffsetSeconds +
        time - leader.authoredAtSessionTimeSeconds,
      leaderState
    );
    const attackerPose = writeTrackWorldPose(
      track,
      attackerState,
      directConflictAttackerPoseScratch
    );
    const leaderPose = writeTrackWorldPose(
      track,
      leaderState,
      directConflictLeaderPoseScratch
    );
    const dx = leaderPose.x - attackerPose.x;
    const dy = leaderPose.y - attackerPose.y;
    const cos = Math.cos(attackerPose.roadHeading);
    const sin = Math.sin(attackerPose.roadHeading);
    let pose = poses[index];
    if (!pose) {
      pose = {
        timeSeconds: 0,
        relativeLongitudinal: 0,
        relativeLateral: 0,
        egoHeadingRadians: 0,
        rivalHeadingRadians: 0
      };
      poses[index] = pose;
    }
    pose.timeSeconds = time;
    pose.relativeLongitudinal = dx * cos + dy * sin;
    pose.relativeLateral = -dx * sin + dy * cos;
    pose.egoHeadingRadians = normAng(
      attackerPose.bodyHeading - attackerPose.roadHeading
    );
    pose.rivalHeadingRadians = normAng(
      leaderPose.bodyHeading - attackerPose.roadHeading
    );
  }
  poses.length = times.length;
  return sweptCarContactEpisodes(poses);
}

export function continuousTrajectoryContactEpisodes(
  track: Track,
  attacker: RacecraftTrajectory,
  leader: RacecraftTrajectory
): SweptCarContactEpisode[] {
  const start = Math.max(
    attacker.fromSessionTimeSeconds,
    leader.fromSessionTimeSeconds
  );
  const end = Math.min(
    attacker.toSessionTimeSeconds,
    leader.toSessionTimeSeconds
  );
  return end <= start + TIME_EPSILON_SECONDS
    ? []
    : continuousTimedTrajectoryContactEpisodes(
        track,
        attacker,
        leader,
        start,
        end
      );
}

export function firstContinuousTrajectoryConflict(
  track: Track,
  attacker: RacecraftTrajectory,
  leader: RacecraftTrajectory
): RacecraftTrajectoryConflict | null {
  const episode = continuousTrajectoryContactEpisodes(
    track,
    attacker,
    leader
  )[0];
  if (!episode) return null;
  const state = continuousTrajectoryStateAtTime(
    track,
    attacker,
    episode.startTimeSeconds
  );
  return {
    sessionTimeSeconds: episode.startTimeSeconds,
    progressMetres: state.progressMetres
  };
}

export function trajectoryFromPublication(
  session: Session,
  publication: RacecraftClaim,
  evaluatedAtSessionTimeSeconds = session.t
): RacecraftTrajectory {
  const horizonSessionTimeSeconds =
    publication.publishedAt +
    racecraftTrajectoryHorizonSeconds(publication.trajectory) -
    publication.trajectoryTimeOffsetSeconds;
  return {
    ownerCode: publication.code,
    publicationRevision: publication.publicationRevision,
    authoredAtSessionTimeSeconds: publication.publishedAt,
    trajectoryTimeOffsetSeconds:
      publication.trajectoryTimeOffsetSeconds,
    trajectory: publication.trajectory,
    fromSessionTimeSeconds: evaluatedAtSessionTimeSeconds,
    toSessionTimeSeconds: Math.max(
      evaluatedAtSessionTimeSeconds,
      horizonSessionTimeSeconds
    )
  };
}

export function cornerOwnershipTimingBandSeconds(
  attacker: RacecraftTrajectory,
  leader: RacecraftTrajectory
): number {
  let maximumStep = TRAF_DT;
  for (const trajectory of [attacker, leader])
    for (let index = 0;
      index < trajectory.trajectory.segmentCount;
      index++)
      maximumStep = Math.max(
        maximumStep,
        trajectory.trajectory.segmentEndTime[index]! -
          trajectory.trajectory.segmentStartTime[index]!
      );
  return maximumStep / 2;
}

export function classifyCornerOwnership(
  track: Track,
  corner: LegacyCorner,
  attacker: RacecraftTrajectory,
  leader: RacecraftTrajectory
): CornerOwnershipClassification {
  const firstConflict = firstContinuousTrajectoryConflict(
    track,
    attacker,
    leader
  );
  const turnIn = gateProgress(
    track,
    attacker,
    corner.turnInI * track.step
  );
  const exit = gateProgress(
    track,
    attacker,
    corner.exitI * track.step
  );
  if (!firstConflict || turnIn == null || exit == null ||
      firstConflict.progressMetres < turnIn - Number.EPSILON ||
      firstConflict.progressMetres > exit + Number.EPSILON)
    return {
      outcome: 'inactive',
      attackerApexArrivalSessionTimeSeconds: null,
      leaderApexArrivalSessionTimeSeconds: null,
      firstConflict
    };
  const attackerApex = continuousTrajectoryGateCrossingTimeAtS(
    track,
    attacker,
    corner.apexI * track.step
  );
  const leaderApex = continuousTrajectoryGateCrossingTimeAtS(
    track,
    leader,
    corner.apexI * track.step
  );
  const attackerExit = continuousTrajectoryGateCrossingTimeAtS(
    track,
    attacker,
    corner.exitI * track.step
  );
  if (attackerApex == null || leaderApex == null ||
      attackerExit == null)
    return {
      outcome: 'inactive',
      attackerApexArrivalSessionTimeSeconds: attackerApex,
      leaderApexArrivalSessionTimeSeconds: leaderApex,
      firstConflict
    };
  const delta = leaderApex - attackerApex;
  const band = cornerOwnershipTimingBandSeconds(attacker, leader);
  if (delta < -band)
    return {
      outcome: 'leader-owned',
      attackerApexArrivalSessionTimeSeconds: attackerApex,
      leaderApexArrivalSessionTimeSeconds: leaderApex,
      firstConflict
    };
  return {
    outcome: Math.abs(delta) <= band ? 'shared' : 'attacker-owned',
    attackerApexArrivalSessionTimeSeconds: attackerApex,
    leaderApexArrivalSessionTimeSeconds: leaderApex,
    firstConflict
  };
}

export interface AuthorCornerOwnershipInput {
  readonly session: Session;
  readonly corner: LegacyCorner;
  readonly attackerCode: string;
  readonly targetCode: string;
  readonly attackerTrajectory: RacecraftTrajectory;
  readonly leaderTrajectory: RacecraftTrajectory;
  readonly attackerPublicationRevision: number;
  readonly sourceLeaderPublicationRevision: number;
  readonly selectedPlanNumericId: number;
  readonly selectedFamilyNumericId: number;
  readonly side: -1 | 1;
}

export function authorCornerOwnershipAssertion(
  input: AuthorCornerOwnershipInput
): RacecraftCornerOwnershipAssertion | null {
  const classification = classifyCornerOwnership(
    input.session.trk,
    input.corner,
    input.attackerTrajectory,
    input.leaderTrajectory
  );
  if (classification.outcome !== 'attacker-owned' &&
      classification.outcome !== 'shared')
    return null;
  return Object.freeze({
    assertionId: [
      input.attackerCode,
      input.targetCode,
      input.corner.id,
      input.attackerPublicationRevision,
      input.sourceLeaderPublicationRevision,
      input.selectedPlanNumericId,
      input.selectedFamilyNumericId
    ].join(':'),
    attackerCode: input.attackerCode,
    targetCode: input.targetCode,
    cornerId: input.corner.id,
    side: input.side,
    authoredOutcome: classification.outcome,
    attackerPublicationRevision: input.attackerPublicationRevision,
    sourceLeaderPublicationRevision:
      input.sourceLeaderPublicationRevision,
    selectedPlanNumericId: input.selectedPlanNumericId,
    selectedFamilyNumericId: input.selectedFamilyNumericId
  });
}

function inactiveOwnership(
  assertion: RacecraftCornerOwnershipAssertion,
  session: Session,
  reason: ValidatedCornerOwnership['reason'],
  outcome: ValidatedCornerOwnership['outcome'] = 'inactive'
): ValidatedCornerOwnership {
  return {
    assertionId: assertion.assertionId,
    evaluatedAtSessionTimeSeconds: session.t,
    outcome,
    attackerApexArrivalSessionTimeSeconds: null,
    leaderApexArrivalSessionTimeSeconds: null,
    firstConflict: null,
    reason
  };
}

export interface ValidateCornerOwnershipInput {
  readonly session: Session;
  readonly assertion: RacecraftCornerOwnershipAssertion;
  readonly attacker: Entry;
  readonly attackerPublication: RacecraftClaim;
  readonly leader: Entry;
  readonly leaderPublication: RacecraftClaim;
}

export function validateCornerOwnership(
  input: ValidateCornerOwnershipInput
): ValidatedCornerOwnership {
  const {
    session,
    assertion,
    attacker,
    attackerPublication,
    leader,
    leaderPublication
  } = input;
  if (!attacker.car || !leader.car ||
      attackerPublication.publicationRevision !==
        assertion.attackerPublicationRevision ||
      attackerPublication.selectedPlanNumericId !==
        assertion.selectedPlanNumericId ||
      attackerPublication.selectedFamilyNumericId !==
        assertion.selectedFamilyNumericId ||
      attackerPublication.targetCode !== assertion.targetCode ||
      leaderPublication.publicationRevision !==
        assertion.sourceLeaderPublicationRevision)
    return inactiveOwnership(assertion, session, 'source-replaced');
  if (!attackerPublication.trusted ||
      attackerPublication.mode !== 'staged-attack')
    return inactiveOwnership(assertion, session, 'attacker-diverged');
  const attackerAge = Math.max(
    0,
    session.t - attackerPublication.publishedAt
  );
  const authoredCurrent = racecraftClaimStateAtTime(
    session.trk,
    attackerPublication,
    attackerAge
  );
  if (attacker.car.offCourse || attacker.recT > 0 ||
      Math.abs(signedDistance(
        session.trk,
        authoredCurrent.s,
        attacker.car.s
      )) > PHYS.carLen / 2 ||
      Math.abs(
        authoredCurrent.lateral - attacker.latNow
      ) > PHYS.carWid / 2)
    return inactiveOwnership(assertion, session, 'attacker-diverged');
  const corner = session.trk.corners.find(value =>
    value.id === assertion.cornerId);
  if (!corner)
    return inactiveOwnership(assertion, session, 'corner-ended');
  const currentIndex =
    ((Math.max(0, attacker.car.progIdx) % session.trk.n) +
      session.trk.n) % session.trk.n;
  const cornerSpan =
    (corner.exitI - corner.approachI + session.trk.n) %
      session.trk.n;
  const cornerOffset =
    (currentIndex - corner.approachI + session.trk.n) %
      session.trk.n;
  if (cornerOffset > cornerSpan)
    return inactiveOwnership(assertion, session, 'corner-ended');
  const attackerTrajectory = trajectoryFromPublication(
    session,
    attackerPublication
  );
  const leaderTrajectory = trajectoryFromPublication(
    session,
    leaderPublication
  );
  if (continuousTrajectoryContactEpisodes(
    session.trk,
    attackerTrajectory,
    leaderTrajectory
  ).some(episode =>
    isHardContactImpulse(episode.maximumRelativeNormalSpeed)))
    return inactiveOwnership(assertion, session, 'hard-infeasible');
  const classification = classifyCornerOwnership(
    session.trk,
    corner,
    attackerTrajectory,
    leaderTrajectory
  );
  if (classification.outcome === 'inactive')
    return inactiveOwnership(assertion, session, 'conflict-ended');
  if (classification.outcome === 'leader-owned')
    return {
      ...inactiveOwnership(
        assertion,
        session,
        leaderPublication.mode === 'ownership-response'
          ? 'defender-reclaimed'
          : 'lost-gate',
        'leader-owned'
      ),
      attackerApexArrivalSessionTimeSeconds:
        classification.attackerApexArrivalSessionTimeSeconds,
      leaderApexArrivalSessionTimeSeconds:
        classification.leaderApexArrivalSessionTimeSeconds,
      firstConflict: classification.firstConflict
    };
  return {
    assertionId: assertion.assertionId,
    evaluatedAtSessionTimeSeconds: session.t,
    outcome: classification.outcome,
    attackerApexArrivalSessionTimeSeconds:
      classification.attackerApexArrivalSessionTimeSeconds,
    leaderApexArrivalSessionTimeSeconds:
      classification.leaderApexArrivalSessionTimeSeconds,
    firstConflict: classification.firstConflict,
    reason: 'current'
  };
}
