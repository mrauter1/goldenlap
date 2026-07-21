import type { Car, CompactLateralProgram, Track } from '../../core/model';
import {
  longitudinalAccelerationHeadroom,
  PHYS
} from '../../core/physics';
import { surfaceExposureAtLateral } from '../../core/surface';
import { clamp, normAng } from '../../shared/math';
import { cloneSpeedEnvelope } from '../../core/speed-envelope';
import type {
  Entry,
  RacecraftClaim,
  RacecraftDefensiveMoveCommitment,
  RacecraftLongitudinalProgram,
  RacecraftPublicationMode,
  Session
} from '../model';
import {
  entryMargin,
  flowOff
} from '../strategy';
import {
  createRacecraftTrajectoryProgram,
  writeRacecraftTrajectorySegment
} from './claim';
import {
  cloneCompactLateralProgram,
  compileCompactLateralProgram,
  sampleCompactPathPlanOffset
} from './compact-path';
import {
  maneuverPredictionStationTime,
  MANEUVER_PREDICTION
} from './feasibility';
import {
  racecraftFamilyDynamics,
  writePreparedRacecraftFamilyStateAt,
  type RacecraftFamilyDynamics,
  type RacecraftFamilyState
} from './family-geometry';
import { evaluateLaneEta } from './geometry';
import { racecraftLongitudinalSpeedAt } from './longitudinal-program';
import {
  recordRacecraftDefensiveCommitmentAuthored,
  recordRacecraftDefensiveCommitmentReset,
  recordRacecraftOffSlotPublicationAttempt,
  recordRacecraftPublication
} from './diagnostics';
import {
  racecraftDefensiveCommitmentIsActive
} from './defensive-legality';

type ActiveEntry = Entry & { car: Car };
const IDEAL_PATH_PLAN = { mode: 'ideal', key: 'ideal' } as const;

interface PublicationGeometry {
  lateral: number;
  curvature: number;
  headingOffsetRadians: number;
  surfaceMu: number;
  surfaceDrag: number;
  targetSpeed: number;
}

const publicationGeometryScratchA: PublicationGeometry = {
  lateral: 0,
  curvature: 0,
  headingOffsetRadians: 0,
  surfaceMu: 0,
  surfaceDrag: 0,
  targetSpeed: 0
};
const publicationGeometryScratchB: PublicationGeometry = {
  ...publicationGeometryScratchA
};
const publicationFamilyScratch: RacecraftFamilyState = {
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

function roadHeadingAt(track: Track, index: number): number {
  const resolved = cyclicIndex(track, index);
  return Math.atan2(track.ty[resolved]!, track.tx[resolved]!);
}

function measuredHeadingOffset(track: Track, car: Car): number {
  return normAng(car.h - roadHeadingAt(track, car.progIdx));
}

function lateralAt(
  session: Session,
  entry: ActiveEntry,
  progress: number
): number {
  const track = session.trk;
  const index = indexAtProgress(track, entry, progress);
  if (entry.pathPlan?.mode === 'pit' && entry.path)
    return entry.path.off[index]!;
  if (entry.racecraftPathPlan)
    return sampleCompactPathPlanOffset(
      track,
      entry.racecraftPathPlan,
      index,
      progress
    );
  const eta = entry.laneProgram.points.length
    ? evaluateLaneEta(entry.laneProgram.points, progress).eta
    : entry.laneProgram.bias;
  return track.idealPath.off[index]! + eta;
}

function geometryAt(
  session: Session,
  entry: ActiveEntry,
  progress: number,
  out: PublicationGeometry,
  fallbackMargin?: number,
  preparedProgram?: CompactLateralProgram,
  preparedDynamics?: RacecraftFamilyDynamics
): PublicationGeometry {
  const track = session.trk;
  const index = indexAtProgress(track, entry, progress);
  if (entry.racecraftPathPlan) {
    if (!preparedProgram || !preparedDynamics)
      throw new Error('Publication family state was not prepared');
    const family = writePreparedRacecraftFamilyStateAt(
      track,
      progress,
      index,
      preparedProgram,
      preparedDynamics,
      publicationFamilyScratch
    );
    out.lateral = family.lateral;
    out.curvature = family.curvature;
    out.headingOffsetRadians = family.headingOffsetRadians;
    out.surfaceMu = family.surfaceMu;
    out.surfaceDrag = family.surfaceDrag;
    out.targetSpeed = family.targetSpeed;
    return out;
  }

  const lateral = lateralAt(session, entry, progress);
  const previous = lateralAt(session, entry, progress - track.step);
  const next = lateralAt(session, entry, progress + track.step);
  const slope = (next - previous) / (2 * track.step);
  const exposure = surfaceExposureAtLateral(track, index, lateral);
  const margin = fallbackMargin ?? clamp(
    entryMargin(entry, session, session.config.tuneBonus, session.wet) +
      flowOff(entry, session),
    0.85,
    0.985
  );
  const pathSpeed = entry.pathPlan?.mode === 'pit' && entry.path
    ? entry.path.v[index]!
    : track.idealPath.v[index]!;
  out.lateral = lateral;
  out.curvature = entry.pathPlan?.mode === 'pit' && entry.path
    ? entry.path.k[index]!
    : track.idealPath.k[index]!;
  out.headingOffsetRadians = Math.atan2(
    slope,
    1 - track.kSm[index]! * lateral
  );
  out.surfaceMu = exposure.mu;
  out.surfaceDrag = exposure.drag;
  out.targetSpeed = Math.max(0, pathSpeed * margin);
  return out;
}

interface PublicationDynamics {
  readonly modifiers: RacecraftFamilyDynamics['modifiers'];
  readonly baseMu: number;
  readonly downforceScale: number;
  readonly brakingEffort: number;
  readonly margin: number;
}

function installedTargetSpeed(
  session: Session,
  entry: ActiveEntry,
  progress: number,
  geometricTarget: number
): number {
  const program =
    entry.racecraftDecision?.selectedLongitudinalProgram ??
    entry.racecraftLongitudinalProgram;
  if (!program) return geometricTarget;
  const start = program.envelope.startProgress;
  const end = program.envelope.endProgress;
  if (progress > end + Number.EPSILON) return geometricTarget;
  return Math.min(
    geometricTarget,
    racecraftLongitudinalSpeedAt(program, Math.max(start, progress))
  );
}

function advanceSpeed(
  dynamics: PublicationDynamics,
  speed: number,
  target: number,
  curvature: number,
  surfaceMu: number,
  surfaceDrag: number,
  seconds: number
): number {
  const modifiers = dynamics.modifiers;
  const dynamicMu = dynamics.baseMu * surfaceMu;
  const gripHeadroom = longitudinalAccelerationHeadroom(
    speed,
    curvature,
    dynamicMu,
    dynamics.downforceScale
  );
  const passiveDeceleration = (
    PHYS.kDrag * modifiers.dr * speed * speed +
    PHYS.kRoll +
    speed * Math.max(0, surfaceDrag)
  ) / PHYS.m;
  if (target < speed) {
    return Math.max(
      target,
      speed - Math.max(
        0,
        dynamics.brakingEffort * gripHeadroom + passiveDeceleration
      ) * seconds
    );
  }
  const driveForce = Math.min(
    PHYS.Fmax * modifiers.pw,
    PHYS.power * modifiers.pw / Math.max(4, speed)
  );
  const driveAcceleration = driveForce / PHYS.m - passiveDeceleration;
  return Math.max(0, Math.min(
    target,
    speed + Math.min(driveAcceleration, gripHeadroom) * seconds
  ));
}

function cloneLongitudinalProgram(
  program: RacecraftLongitudinalProgram | null | undefined
): RacecraftLongitudinalProgram | null {
  if (!program) return null;
  return {
    envelope: cloneSpeedEnvelope(program.envelope),
    brakingEffort: program.brakingEffort,
    slowPointOwnerCode: program.slowPointOwnerCode,
    bindingSlowPoint: program.bindingSlowPoint
      ? { ...program.bindingSlowPoint }
      : null
  };
}

function publicationMode(entry: ActiveEntry): RacecraftPublicationMode {
  if (entry.state === 'pitIn' || entry.state === 'pitOut') return 'pit';
  return entry.racecraftDecision?.decisionMode ?? 'direct-ideal';
}

function selectedTarget(entry: ActiveEntry): string | null {
  const decision = entry.racecraftDecision;
  if (decision?.publicationTargetCode !== undefined)
    return decision.publicationTargetCode;
  const selected = decision?.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  return selected &&
      selected.plan.mode !== 'ideal' &&
      selected.plan.mode !== 'pit'
    ? selected.plan.leaderCode ??
        selected.slowPointOwnerCode ??
        null
    : selected?.slowPointOwnerCode ??
        decision?.selectedLongitudinalProgram?.slowPointOwnerCode ??
        null;
}

function selectedCorner(entry: ActiveEntry): string | null {
  const decision = entry.racecraftDecision;
  if (decision?.publicationCornerId !== undefined)
    return decision.publicationCornerId;
  const selected = decision?.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  return selected &&
      selected.plan.mode !== 'ideal' &&
      selected.plan.mode !== 'pit'
    ? selected.plan.cornerId ?? null
    : null;
}

function selectedIdentity(entry: ActiveEntry): {
  planNumericId: number | null;
  familyNumericId: number | null;
} {
  const decision = entry.racecraftDecision;
  const selected = decision?.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  return {
    planNumericId: selected?.planNumericId ??
      decision?.selectedPlanNumericId ??
      null,
    familyNumericId: selected?.familyNumericId ?? null
  };
}

function tacticalPublicationIsAllowed(entry: ActiveEntry): boolean {
  if (entry.state === 'pitIn' || entry.state === 'pitOut') return true;
  if (entry.recT > 0) return false;
  if (!entry.car.offCourse) return true;
  return entry.racecraftDecision?.decisionMode === 'emergency';
}

function activeDefensiveCommitment(
  session: Session,
  entry: ActiveEntry,
  previous: RacecraftClaim | undefined
): RacecraftDefensiveMoveCommitment | null {
  const stored = entry.racecraftDefensiveCommitment ??
    previous?.defensiveCommitment ??
    null;
  if (racecraftDefensiveCommitmentIsActive(stored, entry.prog)) {
    entry.racecraftDefensiveCommitment = stored;
    return stored;
  }
  if (stored) recordRacecraftDefensiveCommitmentReset(session);
  delete entry.racecraftDefensiveCommitment;
  return null;
}

/**
 * Author one immutable tactical trajectory after the owner's real decision
 * slot. The owner never refreshes it between slots; consumers age it on read.
 */
export function publishRacecraftTacticalPublication(
  session: Session,
  entry: ActiveEntry,
  trafficEpoch: number
): RacecraftClaim | null {
  if (entry._racecraftLastDecisionTrafficEpoch !== trafficEpoch) {
    recordRacecraftOffSlotPublicationAttempt(session);
    return null;
  }
  const previous = session.racecraftClaims?.get(entry.code);
  const inheritedCommitment = activeDefensiveCommitment(
    session,
    entry,
    previous
  );
  if (!tacticalPublicationIsAllowed(entry)) {
    const next = new Map(session.racecraftClaims ?? []);
    next.delete(entry.code);
    session.racecraftClaims = next;
    delete entry.racecraftClaim;
    return null;
  }

  const mode = publicationMode(entry);
  const identity = selectedIdentity(entry);
  const longitudinal = cloneLongitudinalProgram(
    entry.racecraftDecision?.selectedLongitudinalProgram ??
      entry.racecraftLongitudinalProgram
  );
  const installedLateral = entry.state === 'pitIn' ||
      entry.state === 'pitOut' ||
      entry.pathPlan?.mode === 'pit'
    ? null
    : entry.racecraftLateralProgram ??
      compileCompactLateralProgram(session.trk, IDEAL_PATH_PLAN);
  const trajectory = createRacecraftTrajectoryProgram(
    MANEUVER_PREDICTION.samples,
    entry.prog,
    entry.car.s,
    installedLateral
      ? cloneCompactLateralProgram(installedLateral)
      : null
  );
  let progress = entry.prog;
  let speed = Math.max(0, entry.spd || entry.car.spd);
  let previousTime = 0;
  const sharedDynamics = racecraftFamilyDynamics(session, entry);
  const dynamics: PublicationDynamics = {
    modifiers: sharedDynamics.modifiers,
    baseMu: sharedDynamics.baseMu,
    downforceScale: sharedDynamics.downforceScale,
    brakingEffort:
      entry.racecraftDecision?.selectedLongitudinalProgram
        ?.brakingEffort ??
      entry.racecraftLongitudinalProgram?.brakingEffort ??
      entry.brakingEffort,
    margin: sharedDynamics.margin
  };
  let geometry = geometryAt(
    session,
    entry,
    progress,
    publicationGeometryScratchA,
    dynamics.margin,
    installedLateral ?? undefined,
    sharedDynamics
  );
  let futureGeometry = publicationGeometryScratchB;
  for (let index = 0; index < trajectory.segmentCount; index++) {
    const time = maneuverPredictionStationTime(index + 1);
    const seconds = time - previousTime;
    const target = installedTargetSpeed(
      session,
      entry,
      progress,
      geometry.targetSpeed
    );
    const nextSpeed = advanceSpeed(
      dynamics,
      speed,
      target,
      geometry.curvature,
      geometry.surfaceMu,
      geometry.surfaceDrag,
      seconds
    );
    const nextProgress =
      progress + (speed + nextSpeed) * 0.5 * seconds;
    const future = geometryAt(
      session,
      entry,
      nextProgress,
      futureGeometry,
      dynamics.margin,
      installedLateral ?? undefined,
      sharedDynamics
    );
    writeRacecraftTrajectorySegment(trajectory, index, {
      startTimeSeconds: previousTime,
      endTimeSeconds: time,
      startProgressMetres: progress,
      endProgressMetres: nextProgress,
      startSpeedMetresPerSecond: speed,
      endSpeedMetresPerSecond: nextSpeed,
      startLateralMetres: geometry.lateral,
      endLateralMetres: future.lateral,
      startHeadingOffsetRadians: geometry.headingOffsetRadians,
      endHeadingOffsetRadians: future.headingOffsetRadians
    });
    progress = nextProgress;
    speed = nextSpeed;
    previousTime = time;
    futureGeometry = geometry;
    geometry = future;
  }

  const revision = Math.max(
    previous?.publicationRevision ?? -1,
    entry._racecraftLastPublicationRevision ?? -1
  ) + 1;
  const decisionCommitment =
    entry.racecraftDecision?.defensiveCommitment;
  const selectedCommitment =
    racecraftDefensiveCommitmentIsActive(
      decisionCommitment,
      entry.prog
    )
      ? decisionCommitment
      : inheritedCommitment;
  const authoredNewCommitment = selectedCommitment != null &&
    (
      inheritedCommitment == null ||
      selectedCommitment.authorizedDefenderPublicationRevision !==
        inheritedCommitment.authorizedDefenderPublicationRevision ||
      selectedCommitment.cornerId !== inheritedCommitment.cornerId
    );
  if (selectedCommitment)
    entry.racecraftDefensiveCommitment = selectedCommitment;
  if (authoredNewCommitment)
    recordRacecraftDefensiveCommitmentAuthored(
      session,
      selectedCommitment
    );
  if (entry.racecraftDecision?.defensiveContinuation)
    session.racecraftDefensiveMovesContinued =
      (session.racecraftDefensiveMovesContinued ?? 0) + 1;
  const claim: RacecraftClaim = Object.freeze({
    code: entry.code,
    predictionKey: [
      mode,
      identity.planNumericId ?? '-',
      identity.familyNumericId ?? '-',
      entry._racecraftLateralAuthorityRevision ?? 0,
      entry._racecraftLongitudinalAuthorityRevision ?? 0
    ].join(':'),
    lateralAuthorityRevision:
      entry._racecraftLateralAuthorityRevision ?? 0,
    longitudinalAuthorityRevision:
      entry._racecraftLongitudinalAuthorityRevision ?? 0,
    publicationRevision: revision,
    publishedAt: session.t,
    originS: entry.car.s,
    originCentre: entry.latNow,
    originSpeed: Math.max(0, entry.spd || entry.car.spd),
    originHeadingOffsetRadians: measuredHeadingOffset(
      session.trk,
      entry.car
    ),
    trusted: true,
    mode,
    targetCode: selectedTarget(entry),
    cornerId: selectedCorner(entry),
    selectedPlanNumericId: identity.planNumericId,
    selectedFamilyNumericId: identity.familyNumericId,
    selectedLongitudinalProgram: longitudinal,
    ownershipAssertion:
      entry.racecraftDecision?.cornerOwnershipAssertion ?? null,
    defensiveCommitment: selectedCommitment,
    trajectoryTimeOffsetSeconds: 0,
    trajectory
  });
  const next = new Map(session.racecraftClaims ?? []);
  next.set(entry.code, claim);
  session.racecraftClaims = next;
  entry.racecraftClaim = claim;
  entry._racecraftLastPublicationRevision = revision;
  recordRacecraftPublication(session, entry);
  return claim;
}

/** Remove departed owners without changing any surviving publication object. */
export function pruneRacecraftTacticalPublications(
  session: Session,
  activeCodes: ReadonlySet<string>
): void {
  const current = session.racecraftClaims;
  if (!current) return;
  let changed = false;
  const next = new Map<string, RacecraftClaim>();
  for (const [code, publication] of current) {
    if (activeCodes.has(code)) next.set(code, publication);
    else changed = true;
  }
  if (changed) session.racecraftClaims = next;
}
