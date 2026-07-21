import { BOT_BRAKING_HORIZON_METRES } from '../../core/autopilot';
import { PHYS, availableDeceleration } from '../../core/physics';
import {
  cloneSpeedEnvelope,
  firstSpeedEnvelopeBindingProgress,
  releasedSpeedEnvelope,
  speedEnvelopeAt,
  speedEnvelopeBreakpoints,
  speedEnvelopeFromSamples,
  speedEnvelopeTravelSeconds
} from '../../core/speed-envelope';
import type {
  Entry,
  RacecraftClaim,
  RacecraftLongitudinalProgram,
  Session
} from '../model';
import {
  dynamicMuAtSample,
  entryDownforceScale,
  entryDirtyAirGripLoss,
  entryMargin,
  entryMu
} from '../strategy';
import { clamp } from '../../shared/math';
import {
  racecraftClaimSegmentCount,
  racecraftClaimSegmentEndTime,
  writeRacecraftClaimStateAtTime,
  type RacecraftClaimState
} from './claim';
import { oneIntervalPhysicalDivergence } from './paths';

export interface RacecraftLongitudinalBinding {
  readonly progressMetres: number;
  readonly seconds: number;
}

export interface RacecraftLateralTrajectoryState {
  readonly lateralMetres: number;
  readonly headingOffsetRadians: number;
}

export interface RacecraftStagedAttackComposition {
  readonly program: RacecraftLongitudinalProgram;
  readonly clearanceProgressMetres: number | null;
  readonly clearanceSeconds: number | null;
  readonly constrainedSeconds: number;
}

const longitudinalClaimStateScratch: RacecraftClaimState = {
  progressMetres: 0,
  s: 0,
  lateral: 0,
  speed: 0,
  headingOffsetRadians: 0
};

function wrappedIndex(session: Session, progress: number): number {
  return (
    Math.round(progress / session.trk.step) %
      session.trk.n + session.trk.n
  ) % session.trk.n;
}

function forwardTrackDistance(
  session: Session,
  from: number,
  to: number
): number {
  const distance = to - from;
  return distance < 0 ? distance + session.trk.len : distance;
}

export function racecraftLongitudinalSpeedAt(
  program: RacecraftLongitudinalProgram,
  progressMetres: number
): number {
  return speedEnvelopeAt(program.envelope, progressMetres);
}

export function racecraftLongitudinalTravelSeconds(
  program: RacecraftLongitudinalProgram,
  fromProgressMetres: number,
  toProgressMetres: number
): number {
  return speedEnvelopeTravelSeconds(
    program.envelope,
    fromProgressMetres,
    toProgressMetres
  );
}

function physicalBackwardSweep(
  session: Session,
  entry: Entry,
  progress: readonly number[],
  speed: number[],
  brakingEffort: number
): void {
  const downforceScale = entryDownforceScale(entry);
  const baseMu = entryMu(entry, session.wet);
  const dirtyAirGripLoss = entryDirtyAirGripLoss(entry, session);
  for (let index = speed.length - 2; index >= 0; index--) {
    const currentProgress = progress[index]!;
    const currentIndex = wrappedIndex(session, currentProgress);
    const reference = session.trk.idealPath.v[currentIndex]!;
    const curvature = session.trk.idealPath.k[currentIndex]!;
    const dynamicMu = dynamicMuAtSample(
      baseMu,
      dirtyAirGripLoss,
      reference,
      curvature,
      downforceScale
    );
    const deceleration = brakingEffort * availableDeceleration(
      Math.max(0, speed[index]!),
      dynamicMu,
      downforceScale
    );
    const distance = Math.max(
      Number.EPSILON,
      progress[index + 1]! - currentProgress
    );
    const permitted = Math.sqrt(Math.max(
      0,
      speed[index + 1]! * speed[index + 1]! +
        2 * deceleration * distance
    ));
    speed[index] = Math.min(speed[index]!, permitted);
  }
}

export function composeRacecraftFreeLongitudinalProgram(
  session: Session,
  entry: Entry
): RacecraftLongitudinalProgram {
  const count = Math.max(
    2,
    Math.ceil(BOT_BRAKING_HORIZON_METRES / session.trk.step) + 1
  );
  const progress = new Array<number>(count);
  const speed = new Array<number>(count);
  const margin = entryMargin(
    entry,
    session,
    session.config.tuneBonus,
    session.wet
  );
  for (let index = 0; index < count; index++) {
    const at = entry.prog + index * session.trk.step;
    progress[index] = at;
    speed[index] = session.trk.idealPath.v[
      wrappedIndex(session, at)
    ]! * margin;
  }
  speed[0] = Math.min(
    speed[0]!,
    Math.max(0, entry.spd || entry.car?.spd || 0)
  );
  physicalBackwardSweep(
    session,
    entry,
    progress,
    speed,
    entry.brakingEffort
  );
  return {
    envelope: speedEnvelopeFromSamples(progress, speed),
    brakingEffort: entry.brakingEffort,
    slowPointOwnerCode: null,
    bindingSlowPoint: null
  };
}

interface LeaderSafeOptions {
  readonly constraintHorizonSeconds?: number;
  readonly retainTerminalConstraint?: boolean;
}

interface LeaderSafeWorkspace {
  readonly progress: number[];
  readonly freeSpeed: number[];
  readonly speed: number[];
  readonly constraintTime: number[];
  readonly constraintProgress: number[];
  readonly constraintSpeed: number[];
  readonly selectedProgress: number[];
  readonly selectedSpeed: number[];
  readonly age: number;
  readonly divergence: number;
  readonly claimState: RacecraftClaimState;
}

function leaderConstraintProgress(
  session: Session,
  entry: Entry,
  divergence: number,
  state: RacecraftClaimState
): number {
  const clearance = Math.max(
    0,
    forwardTrackDistance(
      session,
      entry.car?.s ?? entry.prog % session.trk.len,
      state.s
    ) - PHYS.carLen - divergence
  );
  return entry.prog + clearance;
}

function createLeaderSafeWorkspace(
  session: Session,
  entry: Entry,
  leader: Entry,
  publication: RacecraftClaim,
  free: RacecraftLongitudinalProgram
): LeaderSafeWorkspace {
  const progress = speedEnvelopeBreakpoints(free.envelope);
  const freeSpeed = new Array<number>(progress.length);
  const speed = new Array<number>(progress.length);
  for (let index = 0; index < progress.length; index++)
    freeSpeed[index] = speedEnvelopeAt(free.envelope, progress[index]!);
  const age = Math.max(0, session.t - publication.publishedAt);
  const divergence = oneIntervalPhysicalDivergence(session, leader);
  const count = racecraftClaimSegmentCount(publication) + 1;
  const constraintTime = new Array<number>(count);
  const constraintProgress = new Array<number>(count);
  const constraintSpeed = new Array<number>(count);
  const claimState: RacecraftClaimState = {
    progressMetres: 0,
    s: 0,
    lateral: 0,
    speed: 0,
    headingOffsetRadians: 0
  };
  writeRacecraftClaimStateAtTime(
    session.trk,
    publication,
    age,
    claimState
  );
  constraintTime[0] = 0;
  constraintProgress[0] = leaderConstraintProgress(
    session,
    entry,
    divergence,
    claimState
  );
  constraintSpeed[0] = Math.max(0, claimState.speed);
  for (let index = 0;
    index < racecraftClaimSegmentCount(publication);
    index++) {
    const futureSeconds = racecraftClaimSegmentEndTime(
      publication,
      index
    );
    writeRacecraftClaimStateAtTime(
      session.trk,
      publication,
      age + futureSeconds,
      claimState
    );
    constraintTime[index + 1] = futureSeconds;
    constraintProgress[index + 1] = leaderConstraintProgress(
      session,
      entry,
      divergence,
      claimState
    );
    constraintSpeed[index + 1] = Math.max(0, claimState.speed);
  }
  return {
    progress,
    freeSpeed,
    speed,
    constraintTime,
    constraintProgress,
    constraintSpeed,
    selectedProgress: new Array<number>(count + 1),
    selectedSpeed: new Array<number>(count + 1),
    age,
    divergence,
    claimState
  };
}

function composeRacecraftLeaderSafeProgramWithWorkspace(
  session: Session,
  entry: Entry,
  leader: Entry,
  publication: RacecraftClaim,
  free: RacecraftLongitudinalProgram,
  brakingEffort: number,
  options: LeaderSafeOptions,
  workspace: LeaderSafeWorkspace
): RacecraftLongitudinalProgram {
  const progress = workspace.progress;
  const speed = workspace.speed;
  for (let index = 0; index < speed.length; index++)
    speed[index] = workspace.freeSpeed[index]!;
  const constraintHorizon = options.constraintHorizonSeconds ?? Infinity;
  let selectedCount = 0;
  let lastConstraintSeconds = 0;
  for (let index = 0; index < workspace.constraintTime.length; index++) {
    const futureSeconds = workspace.constraintTime[index]!;
    if (index > 0 &&
        futureSeconds > constraintHorizon + Number.EPSILON) break;
    workspace.selectedProgress[selectedCount] =
      workspace.constraintProgress[index]!;
    workspace.selectedSpeed[selectedCount] =
      workspace.constraintSpeed[index]!;
    selectedCount++;
    lastConstraintSeconds = futureSeconds;
  }
  if (Number.isFinite(constraintHorizon) &&
      constraintHorizon >
        lastConstraintSeconds + Number.EPSILON) {
    writeRacecraftClaimStateAtTime(
      session.trk,
      publication,
      workspace.age + constraintHorizon,
      workspace.claimState
    );
    workspace.selectedProgress[selectedCount] = leaderConstraintProgress(
      session,
      entry,
      workspace.divergence,
      workspace.claimState
    );
    workspace.selectedSpeed[selectedCount] = Math.max(
      0,
      workspace.claimState.speed
    );
    selectedCount++;
  }
  for (let index = 1; index < selectedCount; index++) {
    const candidateProgress = workspace.selectedProgress[index]!;
    const candidateSpeed = workspace.selectedSpeed[index]!;
    let cursor = index - 1;
    while (cursor >= 0 && (
      workspace.selectedProgress[cursor]! > candidateProgress ||
      (workspace.selectedProgress[cursor] === candidateProgress &&
        workspace.selectedSpeed[cursor]! > candidateSpeed)
    )) {
      workspace.selectedProgress[cursor + 1] =
        workspace.selectedProgress[cursor]!;
      workspace.selectedSpeed[cursor + 1] =
        workspace.selectedSpeed[cursor]!;
      cursor--;
    }
    workspace.selectedProgress[cursor + 1] = candidateProgress;
    workspace.selectedSpeed[cursor + 1] = candidateSpeed;
  }
  let envelopeCount = 0;
  for (let index = 0; index < selectedCount; index++) {
    const candidateProgress = workspace.selectedProgress[index]!;
    const candidateSpeed = workspace.selectedSpeed[index]!;
    if (envelopeCount > 0 &&
        Math.abs(
          workspace.selectedProgress[envelopeCount - 1]! -
            candidateProgress
        ) <= Number.EPSILON) {
      workspace.selectedSpeed[envelopeCount - 1] = Math.min(
        workspace.selectedSpeed[envelopeCount - 1]!,
        candidateSpeed
      );
    } else {
      workspace.selectedProgress[envelopeCount] = candidateProgress;
      workspace.selectedSpeed[envelopeCount] = candidateSpeed;
      envelopeCount++;
    }
  }
  let segment = 0;
  let terminalApplied = false;
  const retainTerminalConstraint =
    options.retainTerminalConstraint ?? true;
  for (let index = 0; index < progress.length; index++) {
    const at = progress[index]!;
    if (at + Number.EPSILON < workspace.selectedProgress[0]!) continue;
    const terminalProgress =
      workspace.selectedProgress[envelopeCount - 1]!;
    if (!retainTerminalConstraint &&
        at > terminalProgress + Number.EPSILON &&
        terminalApplied)
      continue;
    while (segment + 1 < envelopeCount &&
        at > workspace.selectedProgress[segment + 1]!)
      segment++;
    const fromProgress = workspace.selectedProgress[segment]!;
    const fromSpeed = workspace.selectedSpeed[segment]!;
    const toProgress = segment + 1 < envelopeCount
      ? workspace.selectedProgress[segment + 1]!
      : null;
    const permitted = toProgress != null
      ? fromSpeed +
        (
          workspace.selectedSpeed[segment + 1]! -
          fromSpeed
        ) * clamp(
          (at - fromProgress) /
            Math.max(
              Number.EPSILON,
              toProgress - fromProgress
            ),
          0,
          1
        )
      : fromSpeed;
    speed[index] = Math.min(speed[index]!, permitted);
    if (!retainTerminalConstraint &&
        at + Number.EPSILON >= terminalProgress)
      terminalApplied = true;
  }
  physicalBackwardSweep(
    session,
    entry,
    progress,
    speed,
    brakingEffort
  );
  const constrainedEnvelope = speedEnvelopeFromSamples(progress, speed);
  const binding = firstRacecraftLongitudinalBinding(free, {
    envelope: constrainedEnvelope,
    brakingEffort,
    slowPointOwnerCode: leader.code,
    bindingSlowPoint: null
  });
  return {
    envelope: constrainedEnvelope,
    brakingEffort,
    slowPointOwnerCode: leader.code,
    bindingSlowPoint: binding
      ? {
          distance: binding.progressMetres - entry.prog,
          speed: racecraftLongitudinalSpeedAt(
            {
              envelope: constrainedEnvelope,
              brakingEffort,
              slowPointOwnerCode: leader.code,
              bindingSlowPoint: null
            },
            binding.progressMetres
          ),
          ownerCode: leader.code,
          reason: 'traffic-follow:directional',
          stationS: (
            (entry.car?.s ?? 0) +
            binding.progressMetres - entry.prog
          ) % session.trk.len,
          publishedAt: publication.publishedAt
        }
      : null
  };
}

export function composeRacecraftLeaderSafeProgram(
  session: Session,
  entry: Entry,
  leader: Entry,
  publication: RacecraftClaim,
  free = composeRacecraftFreeLongitudinalProgram(session, entry),
  brakingEffort = entry.brakingEffort,
  options: LeaderSafeOptions = {}
): RacecraftLongitudinalProgram {
  return composeRacecraftLeaderSafeProgramWithWorkspace(
    session,
    entry,
    leader,
    publication,
    free,
    brakingEffort,
    options,
    createLeaderSafeWorkspace(
      session,
      entry,
      leader,
      publication,
      free
    )
  );
}

export function firstRacecraftLongitudinalBinding(
  free: RacecraftLongitudinalProgram,
  constrained: RacecraftLongitudinalProgram
): RacecraftLongitudinalBinding | null {
  const bindingProgress = firstSpeedEnvelopeBindingProgress(
    free.envelope,
    constrained.envelope
  );
  return bindingProgress == null
    ? null
    : {
        progressMetres: bindingProgress,
        seconds: racecraftLongitudinalTravelSeconds(
          constrained,
          constrained.envelope.startProgress,
          bindingProgress
        )
      };
}

/**
 * Resolve the installed program's first continuous deceleration segment for
 * one corner. `brakeProgressMetres` identifies the corner rather than
 * authoring a timing rule; the returned time comes only from the installed
 * `(s, v²)` authority.
 */
export function firstRacecraftCornerBrakingBinding(
  program: RacecraftLongitudinalProgram,
  brakeProgressMetres: number,
  turnInProgressMetres: number
): RacecraftLongitudinalBinding | null {
  const envelope = program.envelope;
  const brake = Math.max(envelope.startProgress, brakeProgressMetres);
  const turnIn = Math.min(envelope.endProgress, turnInProgressMetres);
  if (!(turnIn > envelope.startProgress) || brake > turnIn)
    return null;
  let anchor = -1;
  for (let index = 0; index < envelope.segmentCount; index++) {
    const start = envelope.segmentStartProgress[index]!;
    const end = envelope.segmentEndProgress[index]!;
    if (end < brake - Number.EPSILON ||
        start > turnIn + Number.EPSILON ||
        envelope.slope[index]! >= -Number.EPSILON)
      continue;
    anchor = index;
    break;
  }
  if (anchor < 0) return null;
  while (anchor > 0 &&
      envelope.slope[anchor - 1]! < -Number.EPSILON &&
      Math.abs(
        envelope.segmentEndProgress[anchor - 1]! -
        envelope.segmentStartProgress[anchor]!
      ) <= Number.EPSILON * Math.max(
        1,
        Math.abs(envelope.segmentStartProgress[anchor]!)
      ))
    anchor--;
  const progressMetres = Math.max(
    envelope.startProgress,
    envelope.segmentStartProgress[anchor]!
  );
  return {
    progressMetres,
    seconds: racecraftLongitudinalTravelSeconds(
      program,
      envelope.startProgress,
      progressMetres
    )
  };
}

function orientedLateralHalfExtent(headingRadians: number): number {
  return Math.abs(Math.sin(headingRadians)) * PHYS.carLen / 2 +
    Math.abs(Math.cos(headingRadians)) * PHYS.carWid / 2;
}

function sideClearanceAt(
  session: Session,
  publication: RacecraftClaim,
  ageSeconds: number,
  side: -1 | 1,
  progressMetres: number,
  seconds: number,
  lateralStateAtProgress: (
    progressMetres: number
  ) => RacecraftLateralTrajectoryState
): number {
  const ego = lateralStateAtProgress(progressMetres);
  const leader = writeRacecraftClaimStateAtTime(
    session.trk,
    publication,
    ageSeconds + seconds,
    longitudinalClaimStateScratch
  );
  return side * (ego.lateralMetres - leader.lateral) -
    orientedLateralHalfExtent(ego.headingOffsetRadians) -
    orientedLateralHalfExtent(leader.headingOffsetRadians);
}

function firstContinuousSideClearance(
  session: Session,
  publication: RacecraftClaim,
  side: -1 | 1,
  constrained: RacecraftLongitudinalProgram,
  lateralStateAtProgress: (
    progressMetres: number
  ) => RacecraftLateralTrajectoryState
): RacecraftLongitudinalBinding | null {
  const age = Math.max(0, session.t - publication.publishedAt);
  const start = constrained.envelope.startProgress;
  let previousProgress = start;
  let previousSeconds = 0;
  let previousClearance = sideClearanceAt(
    session,
    publication,
    age,
    side,
    previousProgress,
    previousSeconds,
    lateralStateAtProgress
  );
  if (previousClearance >= 0)
    return { progressMetres: previousProgress, seconds: 0 };
  const envelope = constrained.envelope;
  for (let index = 0; index < envelope.segmentCount; index++) {
    const progress = envelope.segmentEndProgress[index]!;
    if (!(progress > start)) continue;
    const seconds = racecraftLongitudinalTravelSeconds(
      constrained,
      start,
      progress
    );
    const clearance = sideClearanceAt(
      session,
      publication,
      age,
      side,
      progress,
      seconds,
      lateralStateAtProgress
    );
    if (clearance < 0) {
      previousProgress = progress;
      previousSeconds = seconds;
      previousClearance = clearance;
      continue;
    }
    let lowProgress = previousProgress;
    let highProgress = progress;
    let lowSeconds = previousSeconds;
    let highSeconds = seconds;
    for (let iteration = 0; iteration < 40; iteration++) {
      const midpoint = (lowProgress + highProgress) / 2;
      const midpointSeconds = racecraftLongitudinalTravelSeconds(
        constrained,
        start,
        midpoint
      );
      const midpointClearance = sideClearanceAt(
        session,
        publication,
        age,
        side,
        midpoint,
        midpointSeconds,
        lateralStateAtProgress
      );
      if (midpointClearance >= 0) {
        highProgress = midpoint;
        highSeconds = midpointSeconds;
      } else {
        lowProgress = midpoint;
        lowSeconds = midpointSeconds;
        previousClearance = midpointClearance;
      }
      if (highProgress - lowProgress <=
          Number.EPSILON * Math.max(1, Math.abs(highProgress)))
        break;
    }
    void lowSeconds;
    void previousClearance;
    return {
      progressMetres: highProgress,
      seconds: highSeconds
    };
  }
  return null;
}

/**
 * One attack program follows longitudinally while it acquires lateral space.
 * The leader constraint is released only at the continuously solved,
 * orientation-aware body-clearance event; no decision occurs at that event.
 */
export function composeRacecraftStagedAttackProgram(
  session: Session,
  entry: Entry,
  leader: Entry,
  publication: RacecraftClaim,
  side: -1 | 1,
  free: RacecraftLongitudinalProgram,
  lateralStateAtProgress: (
    progressMetres: number
  ) => RacecraftLateralTrajectoryState
): RacecraftStagedAttackComposition {
  const freeClearance = firstContinuousSideClearance(
    session,
    publication,
    side,
    free,
    lateralStateAtProgress
  );
  if (freeClearance?.seconds === 0)
    return {
      program: {
        ...free,
        envelope: cloneSpeedEnvelope(free.envelope),
        slowPointOwnerCode: null,
        bindingSlowPoint: null
      },
      clearanceProgressMetres: freeClearance.progressMetres,
      clearanceSeconds: 0,
      constrainedSeconds: 0
    };
  const leaderWorkspace = createLeaderSafeWorkspace(
    session,
    entry,
    leader,
    publication,
    free
  );
  if (!freeClearance) {
    const constrained = composeRacecraftLeaderSafeProgramWithWorkspace(
      session,
      entry,
      leader,
      publication,
      free,
      free.brakingEffort,
      {},
      leaderWorkspace
    );
    return {
      program: constrained,
      clearanceProgressMetres: null,
      clearanceSeconds: null,
      constrainedSeconds: racecraftLongitudinalTravelSeconds(
        constrained,
        constrained.envelope.startProgress,
        constrained.envelope.endProgress
      )
    };
  }

  let clearance = freeClearance;
  let constrained = free;
  for (let iteration = 0; iteration < 12; iteration++) {
    constrained = composeRacecraftLeaderSafeProgramWithWorkspace(
      session,
      entry,
      leader,
      publication,
      free,
      free.brakingEffort,
      {
        constraintHorizonSeconds: clearance.seconds,
        retainTerminalConstraint: false
      },
      leaderWorkspace
    );
    const next = firstContinuousSideClearance(
      session,
      publication,
      side,
      constrained,
      lateralStateAtProgress
    );
    if (!next) {
      const full = composeRacecraftLeaderSafeProgramWithWorkspace(
        session,
        entry,
        leader,
        publication,
        free,
        free.brakingEffort,
        {},
        leaderWorkspace
      );
      return {
        program: full,
        clearanceProgressMetres: null,
        clearanceSeconds: null,
        constrainedSeconds: racecraftLongitudinalTravelSeconds(
          full,
          full.envelope.startProgress,
          full.envelope.endProgress
        )
      };
    }
    const converged =
      Math.abs(next.seconds - clearance.seconds) <= 1e-7 &&
      Math.abs(
        next.progressMetres - clearance.progressMetres
      ) <= 1e-7;
    clearance = next;
    if (converged) break;
  }
  constrained = composeRacecraftLeaderSafeProgramWithWorkspace(
    session,
    entry,
    leader,
    publication,
    free,
    free.brakingEffort,
    {
      constraintHorizonSeconds: clearance.seconds,
      retainTerminalConstraint: false
    },
    leaderWorkspace
  );
  clearance = firstContinuousSideClearance(
    session,
    publication,
    side,
    constrained,
    lateralStateAtProgress
  ) ?? clearance;
  const release = clearance?.progressMetres ?? Infinity;
  return {
    program: {
      envelope: clearance
        ? releasedSpeedEnvelope(
            free.envelope,
            constrained.envelope,
            release
          )
        : cloneSpeedEnvelope(constrained.envelope),
      brakingEffort: free.brakingEffort,
      slowPointOwnerCode: clearance ? null : leader.code,
      bindingSlowPoint: constrained.bindingSlowPoint
    },
    clearanceProgressMetres: clearance?.progressMetres ?? null,
    clearanceSeconds: clearance?.seconds ?? null,
    constrainedSeconds: clearance.seconds
  };
}
