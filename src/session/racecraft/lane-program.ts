import {
  cornerSpeedForGrip,
  longitudinalAccelerationHeadroom,
  PHYS
} from '../../core/physics';
import {
  writeSurfaceExposureAtLateral,
  type SurfaceExposureScratch
} from '../../core/surface';
import {
  numericArray,
  type LaneSampleBuffer,
  type Track
} from '../../core/model';
import { clamp } from '../../shared/math';
import type {
  Entry,
  LanePoint,
  PathPlan,
  Session,
  SurfaceAuthorization
} from '../model';
import {
  backwardInducedSpeedLimit,
  BOT_BRAKING_EFFORT_MAXIMUM,
  BOT_BRAKING_EFFORT_MINIMUM,
  BOT_BRAKING_HORIZON_METRES
} from '../../core/autopilot';
import {
  dynamicMuAtSample,
  entryDownforceScale,
  entryDirtyAirGripLoss,
  entryMargin,
  entryMods,
  entryMu,
  flowOff
} from '../strategy';
import {
  physicalLaneMoveSeconds,
  sideAgreementBounds,
  sideAgreementEnvelopeAt,
  evaluateLaneEta,
  type LaneEvaluation
} from './geometry';
import { compileCompactLateralProgram } from './compact-path';
export const LANE_BUFFER_CAPACITY = 256;
// Sampled pit/transition control retains enough runway for the controller's
// complete braking lookahead while traffic advances between updates.
export const LANE_BUFFER_DISTANCE_METRES = BOT_BRAKING_HORIZON_METRES;

const laneSurfaceScratch: SurfaceExposureScratch = {
  road: 0,
  curb: 0,
  grass: 0,
  mu: 0,
  drag: 0
};

const MAX_LANE_EDIT_REASONS = 32;

export function advanceLateralAuthorityRevision(entry: Entry): void {
  entry._racecraftLateralAuthorityRevision =
    (entry._racecraftLateralAuthorityRevision ?? 0) + 1;
}

function recordLaneEdit(entry: Entry, reason: string): void {
  entry.laneEdits = (entry.laneEdits ?? 0) + 1;
  // A sampled pit path remains the effective authority; latent road-lane
  // edits become one new generation only when that pit authority releases.
  if (entry.pathPlan?.mode !== 'pit')
    advanceLateralAuthorityRevision(entry);
  const counts = entry.laneEditReasons ?? (entry.laneEditReasons = {});
  if (counts[reason] === undefined && Object.keys(counts).length >= MAX_LANE_EDIT_REASONS)
    return;
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function createLaneBuffer(): LaneSampleBuffer {
  return {
    startIndex: 0,
    count: 0,
    uniformBias: 0,
    off: numericArray(LANE_BUFFER_CAPACITY),
    k: numericArray(LANE_BUFFER_CAPACITY),
    ds: numericArray(LANE_BUFFER_CAPACITY),
    v: numericArray(LANE_BUFFER_CAPACITY),
    mu: numericArray(LANE_BUFFER_CAPACITY),
    drag: numericArray(LANE_BUFFER_CAPACITY)
  };
}

function currentIndex(track: Track, entry: Entry): number {
  return Math.max(0, entry.car?.progIdx ?? 0) % track.n;
}

function currentEta(track: Track, entry: Entry): number {
  const index = currentIndex(track, entry);
  return entry.latNow - (track.idealPath?.off[index] ?? 0);
}

function idealOffsetAtProgress(track: Track, entry: Entry, progress: number): number {
  const samples = Math.round((progress - entry.prog) / track.step);
  const index = ((currentIndex(track, entry) + samples) % track.n + track.n) % track.n;
  return track.idealPath?.off[index] ?? 0;
}

export function laneProgramTargetAbs(track: Track, entry: Entry): number {
  const racecraftTarget = entry.racecraftPathPlan?.anchors.at(-1);
  if (racecraftTarget) return racecraftTarget.offset;
  const last = entry.laneProgram.points[entry.laneProgram.points.length - 1];
  if (last) return idealOffsetAtProgress(track, entry, last.s) + last.eta;
  const index = currentIndex(track, entry);
  const base = entry.path ?? track.idealPath;
  return (base?.off[index] ?? 0) + (entry.path ? 0 : entry.laneProgram.bias);
}

export function laneProgramTargetEta(entry: Entry): number {
  return entry.laneProgram.points[entry.laneProgram.points.length - 1]?.eta ??
    entry.laneProgram.bias;
}

export function assertLaneProgramPinned(track: Track, entry: Entry): void {
  const plan = entry.racecraftPathPlan;
  if (plan) {
    const first = plan.anchors[0];
    if (!plan.pinnedFirst || !first || first.s == null ||
        Math.abs(first.s - entry.prog) > 1e-9 ||
        Math.abs(first.offset - entry.latNow) > 1e-9)
      throw new Error(
        `${entry.code} analytic lane authority is not pinned at the car`
      );
    return;
  }
  const first = entry.laneProgram.points[0];
  if (!first) return;
  const eta = currentEta(track, entry);
  if (Math.abs(first.s - entry.prog) > 1e-9 || Math.abs(first.eta - eta) > 1e-9)
    throw new Error(
      `${entry.code} lane edit is not pinned at the car ` +
      `(s=${first.s.toFixed(6)}/${entry.prog.toFixed(6)}, ` +
      `eta=${first.eta.toFixed(6)}/${eta.toFixed(6)})`
    );
}

type RuntimeRacecraftPathPlan = Exclude<
  PathPlan,
  { mode: 'ideal' } | { mode: 'pit' }
>;

/**
 * Install the evaluator's immutable compact authority without translating it
 * into lane points. The first anchor remains the measured physical state.
 */
export function installRacecraftPathPlan(
  track: Track,
  entry: Entry,
  reason: string,
  plan: RuntimeRacecraftPathPlan,
  binding: string | null = reason
): void {
  if (entry.racecraftPathPlan === plan) {
    entry.racecraftLateralProgram ??=
      compileCompactLateralProgram(track, plan);
    entry.laneProgram.reason = reason;
    entry.laneProgram.binding = binding;
    if (plan.surfaceAuthorization === 'emergency')
      entry.laneProgram.surfaceAuthorization = 'emergency';
    else delete entry.laneProgram.surfaceAuthorization;
    return;
  }
  const first = plan.anchors[0];
  const pinError = !plan.pinnedFirst || !first || first.s == null
    ? Infinity
    : Math.max(
        Math.abs(first.s - entry.prog),
        Math.abs(first.offset - entry.latNow)
      );
  entry.laneMaximumPinError = Math.max(
    entry.laneMaximumPinError ?? 0,
    pinError
  );
  if (pinError > 1e-9) {
    entry.laneUnpinnedEdits = (entry.laneUnpinnedEdits ?? 0) + 1;
    throw new Error(`${entry.code} analytic lane edit pin error ${pinError}`);
  }
  delete entry._laneTargetAbsolute;
  entry.laneProgram.points.length = 0;
  entry.laneProgram.bias = 0;
  entry.laneProgram.reason = reason;
  entry.laneProgram.binding = binding;
  if (plan.surfaceAuthorization === 'emergency')
    entry.laneProgram.surfaceAuthorization = 'emergency';
  else delete entry.laneProgram.surfaceAuthorization;
  entry.racecraftPathPlan = plan;
  entry.racecraftLateralProgram =
    compileCompactLateralProgram(track, plan);
  recordLaneEdit(entry, reason);
  delete entry._laneBufferRevision;
  assertLaneProgramPinned(track, entry);
}

/** Replace a program only at an edit boundary; traffic evaluation allocates nothing. */
export function setLaneProgram(
  track: Track,
  entry: Entry,
  reason: string,
  futurePoints: readonly LanePoint[],
  binding: string | null = reason,
  surfaceAuthorization: SurfaceAuthorization = 'normal'
): void {
  delete entry.racecraftPathPlan;
  delete entry.racecraftLateralProgram;
  delete entry._laneTargetAbsolute;
  delete entry._laneBufferRevision;
  const pinned: LanePoint = { s: entry.prog, eta: currentEta(track, entry) };
  const pinError = Math.max(
    Math.abs(pinned.s - entry.prog),
    Math.abs(pinned.eta - currentEta(track, entry))
  );
  recordLaneEdit(entry, reason);
  entry.laneMaximumPinError = Math.max(entry.laneMaximumPinError ?? 0, pinError);
  if (pinError > 0) {
    entry.laneUnpinnedEdits = (entry.laneUnpinnedEdits ?? 0) + 1;
    throw new Error(`${entry.code} lane edit pin error ${pinError}`);
  }
  const sorted = futurePoints
    .filter(point => Number.isFinite(point.s) && Number.isFinite(point.eta) &&
      point.s > entry.prog + 1e-9)
    .sort((left, right) => left.s - right.s);
  const points: LanePoint[] = [pinned];
  for (const point of sorted) {
    if (points.length >= LANE_BUFFER_CAPACITY) break;
    const previous = points[points.length - 1]!;
    if (point.s <= previous.s + 1e-9) continue;
    points.push({ s: point.s, eta: point.eta });
  }
  entry.laneProgram.points = points;
  entry.laneProgram.reason = reason;
  entry.laneProgram.binding = binding;
  if (surfaceAuthorization === 'emergency')
    entry.laneProgram.surfaceAuthorization = 'emergency';
  else delete entry.laneProgram.surfaceAuthorization;
  assertLaneProgramPinned(track, entry);
}

function setTwoPointLaneProgram(
  track: Track,
  entry: Entry,
  reason: string,
  targetS: number,
  targetEta: number
): void {
  delete entry.racecraftPathPlan;
  delete entry.racecraftLateralProgram;
  delete entry._laneBufferRevision;
  const points = entry.laneProgram.points;
  const first = points[0] ?? { s: 0, eta: 0 };
  const target = points[1] ?? { s: 0, eta: 0 };
  first.s = entry.prog;
  first.eta = currentEta(track, entry);
  target.s = targetS;
  target.eta = targetEta;
  points[0] = first;
  points[1] = target;
  points.length = 2;
  entry.laneProgram.reason = reason;
  entry.laneProgram.binding = reason;
  delete entry.laneProgram.surfaceAuthorization;
  recordLaneEdit(entry, reason);
  entry.laneMaximumPinError = Math.max(entry.laneMaximumPinError ?? 0, 0);
  assertLaneProgramPinned(track, entry);
}

export function clearLaneProgram(entry: Entry, reason = 'ideal'): void {
  const changed = entry.racecraftPathPlan != null ||
    entry.laneProgram.points.length > 0 ||
    Math.abs(entry.laneProgram.bias) > Number.EPSILON ||
    entry.laneProgram.surfaceAuthorization != null;
  delete entry.racecraftPathPlan;
  delete entry.racecraftLateralProgram;
  entry.laneProgram.points.length = 0;
  entry.laneProgram.reason = reason;
  entry.laneProgram.binding = null;
  entry.laneProgram.bias = 0;
  delete entry.laneProgram.surfaceAuthorization;
  delete entry._laneTargetAbsolute;
  delete entry._laneBufferRevision;
  if (changed) recordLaneEdit(entry, reason);
}

export {
  evaluateLaneEta,
  physicalLaneEscapeSeconds,
  physicalLaneMoveSeconds,
  physicalLateralMoveSeconds
} from './geometry';

/**
 * Author one absolute lateral target. The first point is the measured car
 * position; the endpoint distance comes from the shared physical move law.
 */
export function editLaneTarget(
  session: Session,
  entry: Entry,
  lateral: number,
  reason: string,
  force = false
): boolean {
  if (!entry.car) return false;
  const track = session.trk;
  const index = currentIndex(track, entry);
  const surfaceMinimum = track.surface.normalMinimum[index]!;
  const surfaceMaximum = track.surface.normalMaximum[index]!;
  const agreement = sideAgreementBounds(session, entry);
  const currentEnvelope = sideAgreementEnvelopeAt(track, index, agreement);
  if (currentEnvelope.viable === false) return false;
  const minimum = agreement ? currentEnvelope.minimum : surfaceMinimum;
  const maximum = agreement ? currentEnvelope.maximum : surfaceMaximum;
  let target = clamp(lateral, minimum, maximum);
  if (!force && entry.laneProgram.points.length > 0 &&
      entry._laneTargetAbsolute !== undefined &&
      Math.abs(entry._laneTargetAbsolute - target) <= 1e-9)
    return false;
  const priorTarget = laneProgramTargetAbs(track, entry);
  if (!force && !entry.racecraftPathPlan &&
      Math.abs(priorTarget - target) <= 1e-9)
    return false;

  const moveSeconds = physicalLaneMoveSeconds(session, entry, target);
  if (!Number.isFinite(moveSeconds)) return false;
  const moveDistance = Math.max(
    PHYS.carLen,
    entry.spd * moveSeconds
  );
  const targetIndex = (index + Math.max(2, Math.round(moveDistance / track.step))) % track.n;
  const targetMinimum = track.surface.normalMinimum[targetIndex]!;
  const targetMaximum = track.surface.normalMaximum[targetIndex]!;
  const targetEnvelope = sideAgreementEnvelopeAt(
    track,
    targetIndex,
    agreement
  );
  if (targetEnvelope.viable === false) return false;
  const authorizedTargetMinimum = agreement
    ? targetEnvelope.minimum
    : targetMinimum;
  const authorizedTargetMaximum = agreement
    ? targetEnvelope.maximum
    : targetMaximum;
  target = clamp(
    target,
    authorizedTargetMinimum,
    authorizedTargetMaximum
  );
  const targetProgress = entry.prog + moveDistance;
  const targetEta = target - (track.idealPath?.off[targetIndex] ?? 0);
  setTwoPointLaneProgram(track, entry, reason, targetProgress, targetEta);
  entry._laneTargetAbsolute = target;
  // Pit motion still consumes this residual; lateral authority is exclusively
  // the lane program.
  entry.lat = currentEta(track, entry);
  return true;
}

/** Author a target relative to the ideal line, used by clean-line character. */
export function editLaneEtaTarget(
  session: Session,
  entry: Entry,
  targetEta: number,
  reason: string,
  force = false
): boolean {
  if (!entry.car) return false;
  const track = session.trk;
  const index = currentIndex(track, entry);
  if (!force && !entry.racecraftPathPlan &&
      Math.abs(laneProgramTargetEta(entry) - targetEta) <= 1e-9)
    return false;
  delete entry._laneTargetAbsolute;
  const currentIdeal = track.idealPath?.off[index] ?? 0;
  const moveSeconds = physicalLaneMoveSeconds(
    session,
    entry,
    currentIdeal + targetEta
  );
  if (!Number.isFinite(moveSeconds)) return false;
  const moveDistance = Math.max(PHYS.carLen, entry.spd * moveSeconds);
  const targetIndex = (index + Math.max(2, Math.round(moveDistance / track.step))) % track.n;
  const targetIdeal = track.idealPath?.off[targetIndex] ?? 0;
  const targetAbsolute = clamp(
    targetIdeal + targetEta,
    track.surface.normalMinimum[targetIndex]!,
    track.surface.normalMaximum[targetIndex]!
  );
  const adjustedEta = targetAbsolute - targetIdeal;
  setTwoPointLaneProgram(
    track,
    entry,
    reason,
    entry.prog + moveDistance,
    adjustedEta
  );
  entry.lat = currentEta(track, entry);
  return true;
}

function writeLaneSurfaceSample(
  track: Track,
  buffer: LaneSampleBuffer,
  slot: number,
  index: number,
  lateral: number
): void {
  const halfWidth = PHYS.carWid / 2;
  const negativeRoadEdge = track.surface.curbNegative[index] === 1
    ? -track.surface.curbInner
    : -track.surface.roadHalfWidth;
  const positiveRoadEdge = track.surface.curbPositive[index] === 1
    ? track.surface.curbInner
    : track.surface.roadHalfWidth;
  if (lateral - halfWidth >= negativeRoadEdge &&
      lateral + halfWidth <= positiveRoadEdge) {
    buffer.mu[slot] = 1;
    buffer.drag[slot] = 0;
  } else {
    writeSurfaceExposureAtLateral(track, index, lateral, laneSurfaceScratch);
    buffer.mu[slot] = laneSurfaceScratch.mu;
    buffer.drag[slot] = laneSurfaceScratch.drag;
  }
}

function writeLaneGeometrySample(
  track: Track,
  buffer: LaneSampleBuffer,
  slot: number,
  index: number,
  evaluation: LaneEvaluation,
  lateral: number
): void {
  const ideal = track.idealPath!;
  const previousIndex = (index - 1 + track.n) % track.n;
  const nextIndex = (index + 1) % track.n;
  const baseCurvature = track.kSm[index]!;
  const baseCurvatureDerivative = (
    track.kSm[nextIndex]! - track.kSm[previousIndex]!
  ) / (2 * track.step);
  // Runtime paths are represented along the track centreline normal, not
  // along the ideal path's own normal. Full Frenet geometry therefore uses
  // the total centreline offset d = ideal.off + eta and derivatives with
  // respect to centreline arc length.
  const idealSlope = (
    ideal.off[nextIndex]! - ideal.off[previousIndex]!
  ) / (2 * track.step);
  const idealSecondDerivative = (
    ideal.off[nextIndex]! - 2 * ideal.off[index]! +
      ideal.off[previousIndex]!
  ) / (track.step * track.step);
  const totalOffset = ideal.off[index]! + evaluation.eta;
  const lateralSlope = idealSlope + evaluation.firstDerivative;
  const lateralSecondDerivative =
    idealSecondDerivative + evaluation.secondDerivative;
  const longitudinalScale = 1 - baseCurvature * totalOffset;
  const q = Math.max(
    Number.EPSILON,
    Math.sqrt(
      longitudinalScale * longitudinalScale +
      lateralSlope * lateralSlope
    )
  );
  const numerator = longitudinalScale * lateralSecondDerivative +
    baseCurvature * longitudinalScale * longitudinalScale +
    baseCurvatureDerivative * totalOffset * lateralSlope +
    2 * baseCurvature * lateralSlope * lateralSlope;
  buffer.k[slot] = numerator / (q * q * q);
  buffer.ds[slot] = track.step * q;
  writeLaneSurfaceSample(track, buffer, slot, index, lateral);
}

function writeLaneSpeedSamples(
  session: Session,
  entry: Entry,
  buffer: LaneSampleBuffer
): void {
  // Compact tactical authority owns the controller's complete continuous
  // envelope. The lane buffer still supplies transition lateral geometry during
  // a transition, but constructing a second sampled speed authority here
  // would duplicate hot-loop work whose values are never consumed.
  if (entry.racecraftLongitudinalProgram) return;
  const track = session.trk;
  const referencePath = entry.pathPlan?.mode === 'pit' && entry.path
    ? entry.path
    : track.idealPath!;
  const baseMu = entryMu(entry, session.wet);
  const downforceScale = entryDownforceScale(entry);
  const dirtyAirGripLoss = entryDirtyAirGripLoss(entry, session);
  const margin = clamp(
    entryMargin(entry, session, session.config.tuneBonus, session.wet) +
      flowOff(entry, session),
    0.85,
    0.985
  );
  const brakingEffort = clamp(
    session.mode === 'race' ? entry.brakingEffort : 0.82,
    BOT_BRAKING_EFFORT_MINIMUM,
    BOT_BRAKING_EFFORT_MAXIMUM
  );
  for (let slot = 0; slot < buffer.count; slot++) {
    const index = (buffer.startIndex + slot) % track.n;
    const referenceSpeed = referencePath.v[index]!;
    const dynamicMu = dynamicMuAtSample(
      baseMu,
      dirtyAirGripLoss,
      referenceSpeed,
      buffer.k[slot]!,
      downforceScale
    ) * buffer.mu[slot]!;
    buffer.v[slot] = Math.min(
      referenceSpeed,
      cornerSpeedForGrip(buffer.k[slot]!, dynamicMu, downforceScale)
    ) * margin;
  }

  const slowPoint = entry.trafficSlowPoint;
  if (slowPoint) {
    const targetDistance = Math.max(0, slowPoint.distance);
    let targetSlot = targetDistance === 0 ? 0 : -1;
    let distance = 0;
    for (let slot = 0;
      targetSlot < 0 && slot < buffer.count - 1;
      slot++) {
      distance += buffer.ds[slot]!;
      if (distance >= targetDistance) targetSlot = slot + 1;
    }
    if (targetSlot >= 0)
      buffer.v[targetSlot] = Math.min(
        buffer.v[targetSlot]!,
        Math.max(0, slowPoint.speed)
      );
  }

  let reachableSpeed = Math.max(0, entry.spd);
  for (let slot = 0; slot < buffer.count - 1; slot++) {
    reachableSpeed = Math.min(reachableSpeed, buffer.v[slot]!);
    const index = (buffer.startIndex + slot) % track.n;
    const dynamicMu = dynamicMuAtSample(
      baseMu,
      dirtyAirGripLoss,
      reachableSpeed,
      buffer.k[slot]!,
      downforceScale
    ) * buffer.mu[slot]!;
    const headroom = longitudinalAccelerationHeadroom(
      reachableSpeed,
      buffer.k[slot]!,
      dynamicMu,
      downforceScale
    );
    const modifiers = entryMods(entry, session.wet);
    const driveForce = Math.min(
      PHYS.Fmax * modifiers.pw,
      PHYS.power * modifiers.pw / Math.max(4, reachableSpeed)
    );
    const resistance =
      PHYS.kDrag * modifiers.dr * reachableSpeed * reachableSpeed +
      PHYS.kRoll +
      reachableSpeed * Math.max(0, buffer.drag[slot]!);
    const acceleration = Math.min(
      (driveForce - resistance) / PHYS.m,
      headroom
    );
    reachableSpeed = Math.sqrt(Math.max(
      0,
      reachableSpeed * reachableSpeed +
        2 * acceleration * buffer.ds[slot]!
    ));
    buffer.v[slot + 1] = Math.min(
      buffer.v[slot + 1]!,
      reachableSpeed
    );
  }

  for (let slot = buffer.count - 2; slot >= 0; slot--) {
    const index = (buffer.startIndex + slot) % track.n;
    const referenceSpeed = referencePath.v[index]!;
    const dynamicMu = dynamicMuAtSample(
      baseMu,
      dirtyAirGripLoss,
      referenceSpeed,
      buffer.k[slot]!,
      downforceScale
    ) * buffer.mu[slot]!;
    const modifiers = entryMods(entry, session.wet);
    const passiveDeceleration = (
      PHYS.kDrag * modifiers.dr * referenceSpeed * referenceSpeed +
      PHYS.kRoll +
      referenceSpeed * Math.max(0, buffer.drag[slot]!)
    ) / PHYS.m;
    buffer.v[slot] = backwardInducedSpeedLimit(
      buffer.v[slot + 1]!,
      buffer.v[slot]!,
      buffer.ds[slot]!,
      buffer.k[slot]!,
      dynamicMu,
      downforceScale,
      brakingEffort,
      passiveDeceleration
    );
  }
}

function evaluateSampledPitPath(
  track: Track,
  entry: Entry,
  buffer: LaneSampleBuffer
): void {
  const path = entry.path!;
  for (let slot = 0; slot < buffer.count; slot++) {
    const index = (buffer.startIndex + slot) % track.n;
    buffer.off[slot] = path.off[index]!;
    buffer.k[slot] = path.k[index]!;
    buffer.ds[slot] = path.ds[index]!;
    buffer.mu[slot] = 1;
    buffer.drag[slot] = 0;
  }
}

function evaluateDeformedProgram(
  session: Session,
  entry: Entry,
  buffer: LaneSampleBuffer,
  corridor: { minimum: number; maximum: number } | null
): boolean {
  const track = session.trk;
  const ideal = track.idealPath!;
  const points = entry.laneProgram.points;
  let agreementViolation = false;
  let trackIndex = buffer.startIndex;
  for (let slot = 0; slot < buffer.count; slot++) {
    const progress = entry.prog + slot * track.step;
    const evaluation = evaluateLaneEta(points, progress);
    const authoredOffset = ideal.off[trackIndex]! + evaluation.eta;
    const surfaceAuthorization =
      entry.laneProgram.surfaceAuthorization ?? 'normal';
    if (corridor) {
      const agreementEnvelope = sideAgreementEnvelopeAt(
        track,
        trackIndex,
        corridor,
        surfaceAuthorization
      );
      if (agreementEnvelope.viable === false ||
          authoredOffset < agreementEnvelope.minimum - 1e-9 ||
          authoredOffset > agreementEnvelope.maximum + 1e-9)
        agreementViolation = true;
    }
    buffer.off[slot] = authoredOffset;
    writeLaneGeometrySample(
      track,
      buffer,
      slot,
      trackIndex,
      evaluation,
      authoredOffset
    );
    trackIndex++;
    if (trackIndex === track.n) trackIndex = 0;
  }
  return agreementViolation;
}

function evaluateUniformBias(
  track: Track,
  entry: Entry,
  buffer: LaneSampleBuffer,
  corridor: { minimum: number; maximum: number } | null
): boolean {
  const ideal = track.idealPath!;
  let agreementViolation = false;
  let trackIndex = buffer.startIndex;
  for (let slot = 0; slot < buffer.count; slot++) {
    const authoredOffset = ideal.off[trackIndex]! + entry.laneProgram.bias;
    if (corridor) {
      const agreementEnvelope = sideAgreementEnvelopeAt(
        track,
        trackIndex,
        corridor
      );
      if (agreementEnvelope.viable === false ||
          authoredOffset < agreementEnvelope.minimum - 1e-9 ||
          authoredOffset > agreementEnvelope.maximum + 1e-9)
        agreementViolation = true;
    }
    buffer.off[slot] = authoredOffset;
    writeLaneGeometrySample(
      track,
      buffer,
      slot,
      trackIndex,
      {
        eta: entry.laneProgram.bias,
        firstDerivative: 0,
        secondDerivative: 0
      },
      authoredOffset
    );
    trackIndex++;
    if (trackIndex === track.n) trackIndex = 0;
  }
  return agreementViolation;
}

function recordAgreementGeometryViolation(
  session: Session,
  violation: boolean
): void {
  if (!violation) return;
  session.racecraftAgreementGeometryViolations =
    (session.racecraftAgreementGeometryViolations ?? 0) + 1;
}

/** Fill the reusable 30 Hz span with geometry and this car's dynamic speed law. */
export function evaluateLaneProgram(
  session: Session,
  entry: Entry
): LaneSampleBuffer {
  const track = session.trk;
  if (!track.idealPath) throw new Error(`Track ${track.def.id} has no ideal path`);
  const buffer = entry.laneBuffer ?? (entry.laneBuffer = createLaneBuffer());
  const corridor = sideAgreementBounds(session, entry);
  const nextStartIndex = currentIndex(track, entry);
  buffer.startIndex = nextStartIndex;
  if (entry.pathPlan?.mode === 'pit' && entry.path) {
    buffer.count = Math.min(
      track.n,
      LANE_BUFFER_CAPACITY,
      Math.ceil(LANE_BUFFER_DISTANCE_METRES / track.step) + 2
    );
    buffer.uniformBias = null;
    evaluateSampledPitPath(track, entry, buffer);
    writeLaneSpeedSamples(session, entry, buffer);
    entry._laneBufferRevision = entry.laneEdits ?? 0;
    return buffer;
  }
  if (entry.racecraftPathPlan)
    throw new Error(
      `${entry.code} compact racecraft authority cannot be sampled into a lane buffer`
    );
  const last = entry.laneProgram.points[entry.laneProgram.points.length - 1];
  if (last && entry.prog >= last.s - 1e-9) {
    entry.laneProgram.bias = last.eta;
    entry.laneProgram.points.length = 0;
    entry.laneProgram.reason = `hold:${entry.laneProgram.reason}`;
    delete entry.laneProgram.surfaceAuthorization;
  }
  if (entry.laneProgram.points.length || Math.abs(entry.laneProgram.bias) > 1e-12) {
    buffer.count = Math.min(
      track.n,
      LANE_BUFFER_CAPACITY,
      Math.ceil(LANE_BUFFER_DISTANCE_METRES / track.step) + 2
    );
    buffer.uniformBias = null;
    const agreementViolation = entry.laneProgram.points.length
      ? evaluateDeformedProgram(session, entry, buffer, corridor)
      : evaluateUniformBias(track, entry, buffer, corridor);
    recordAgreementGeometryViolation(session, agreementViolation);
    writeLaneSpeedSamples(session, entry, buffer);
    entry._laneBufferRevision = entry.laneEdits ?? 0;
    return buffer;
  }

  buffer.count = Math.min(
    track.n,
    LANE_BUFFER_CAPACITY,
    Math.ceil(LANE_BUFFER_DISTANCE_METRES / track.step) + 2
  );
  buffer.uniformBias = 0;
  recordAgreementGeometryViolation(
    session,
    evaluateUniformBias(track, entry, buffer, corridor)
  );
  writeLaneSpeedSamples(session, entry, buffer);
  entry._laneBufferRevision = entry.laneEdits ?? 0;
  return buffer;
}
