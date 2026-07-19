import { materializePath } from '../../core/racing-line';
import {
  availableDeceleration,
  PHYS
} from '../../core/physics';
import {
  numericArray,
  type SampledPath,
  type Track
} from '../../core/model';
import { clamp } from '../../shared/math';
import { pitEgressEndW, pitIngressStartW } from '../pit';
import type {
  Entry,
  EntryTrafficSlowPoint,
  PathPlan,
  PathPlanAnchor,
  Session
} from '../model';
import {
  entryDownforceScale,
  entryMu
} from '../strategy';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from './cadence';
import { sampleCompactPathPlanOffset } from './compact-path';
import {
  advanceLateralAuthorityRevision,
  clearLaneProgram,
  editLaneTarget,
  laneProgramTargetAbs
} from './lane-program';
import {
  sideAgreementBounds,
  sideAgreementEnvelopeAt
} from './geometry';

export {
  sampleCompactPathPlan,
  sampleCompactPathPlanOffset,
  sampleCompactPathPlanOffsetAnalytic
} from './compact-path';

/** One-interval kinematic divergence used by viability and following law. */
export function oneIntervalPhysicalDivergence(
  session: Session,
  entry: Entry,
  intervalSeconds = RACECRAFT_DECISION_INTERVAL_SECONDS
): number {
  const interval = Math.max(0, intervalSeconds);
  return 0.5 * availableDeceleration(
    entry.spd,
    entryMu(entry, session.wet || 0),
    entryDownforceScale(entry)
  ) * interval * interval;
}

/** Author queue spacing as data; the lane buffer owns all backward braking. */
export function queueFollowSlowPoint(
  session: Session,
  follower: Entry,
  leader: Entry,
  distance: number,
  timeGap: number,
  reason: string
): EntryTrafficSlowPoint | null {
  if (!follower.car || !leader.car) return null;
  const physicalDivergence = oneIntervalPhysicalDivergence(session, leader);
  const wetScale = 1 + 0.45 * (session.wet || 0);
  const desiredGap = Math.max(
    PHYS.carLen,
    Math.max(0, leader.spd) * Math.max(0, timeGap) * wetScale
  ) + physicalDivergence;
  const targetDistance = Math.max(0, distance - desiredGap);
  return {
    distance: targetDistance,
    speed: Math.max(0, leader.spd),
    ownerCode: leader.code,
    reason: `traffic-comfort:${reason}`,
    stationS: (follower.car.s + targetDistance) % session.trk.len,
    publishedAt: session.t
  };
}

export function lineOffAt(track: Track, entry: Entry): number {
  if (!entry.car) return 0;
  const path = entry.path ?? track.idealPath;
  if (!path) return 0;
  return path.off[Math.max(0, entry.car.progIdx) % track.n] ?? 0;
}

export function targetAbsLat(track: Track, entry: Entry): number {
  return laneProgramTargetAbs(track, entry);
}

export function setTargetAbsLat(
  session: Session,
  entry: Entry,
  lateral: number,
  reason = 'lateral-intent'
): void {
  const track = session.trk;
  const agreement = sideAgreementBounds(session, entry);
  const envelope = sideAgreementEnvelopeAt(
    track,
    currentIndex(track, entry),
    agreement
  );
  if (envelope.viable === false)
    throw new Error(`${entry.code} side agreement has no legal surface at current sample`);
  const target = clamp(lateral, envelope.minimum, envelope.maximum);
  editLaneTarget(session, entry, target, reason);
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function indexAhead(track: Track, index: number, metres: number): number {
  return cyclicIndex(track, index + Math.round(metres / track.step));
}

function distanceAhead(track: Track, from: number, to: number): number {
  return ((to - from + track.n) % track.n) * track.step;
}

function currentIndex(track: Track, entry: Entry): number {
  return cyclicIndex(track, entry.car?.progIdx ?? 0);
}

function currentPathTarget(track: Track, entry: Entry): number {
  if (entry.pathPlan?.mode !== 'pit') return entry.latNow;
  const index = currentIndex(track, entry);
  const path = entry.path ?? track.idealPath;
  const base = path?.off[index] ?? 0;
  return base + (Number.isFinite(entry.lat) ? entry.lat : 0);
}

function idealOffset(track: Track, index: number): number {
  return track.idealPath?.off[cyclicIndex(track, index)] ?? 0;
}

function sortedFutureAnchors(
  track: Track,
  startIndex: number,
  startProgress: number,
  candidates: readonly PathPlanAnchor[],
  maximumDistance = 300
): PathPlanAnchor[] {
  const byIndex = new Map<number, PathPlanAnchor>();
  for (const candidate of candidates) {
    const distance = candidate.s == null
      ? distanceAhead(track, startIndex, cyclicIndex(track, candidate.index))
      : candidate.s - startProgress;
    const index = candidate.s == null
      ? cyclicIndex(track, candidate.index)
      : indexAhead(track, startIndex, distance);
    if (distance < 0.5 || distance > maximumDistance || index === startIndex) continue;
    byIndex.set(index, {
      ...candidate,
      index,
      offset: candidate.s != null && candidate.eta != null
        ? idealOffset(track, index) + candidate.eta
        : candidate.offset
    });
  }
  return [...byIndex.values()].sort((left, right) => {
    const leftDistance = left.s == null
      ? distanceAhead(track, startIndex, left.index)
      : left.s - startProgress;
    const rightDistance = right.s == null
      ? distanceAhead(track, startIndex, right.index)
      : right.s - startProgress;
    return leftDistance - rightDistance;
  });
}

function makePitPlan(
  track: Track,
  entry: Entry,
  key: string,
  candidates: readonly PathPlanAnchor[],
  maximumDistance = 300
): Extract<PathPlan, { mode: 'pit' }> {
  const startIndex = currentIndex(track, entry);
  const startTarget = currentPathTarget(track, entry);
  const anchors: PathPlanAnchor[] = [
    {
      index: startIndex,
      offset: startTarget,
      eta: startTarget - idealOffset(track, startIndex)
    },
    ...sortedFutureAnchors(
      track,
      startIndex,
      entry.prog,
      candidates,
      maximumDistance
    )
  ];
  if (anchors.length < 2) {
    const end = indexAhead(track, startIndex, 45);
    anchors.push({ index: end, offset: idealOffset(track, end) });
  }
  return { mode: 'pit', key, anchors };
}

/** Materialize the dedicated pit authority; racecraft lanes never enter here. */
export function materializePitPathPlan(
  track: Track,
  plan: Extract<PathPlan, { mode: 'pit' }>
): SampledPath {
  if (plan.anchors.length < 2)
    throw new Error(`pit path ${plan.key} needs at least two anchors`);
  const base = track.idealPath;
  if (!base) throw new Error(`Track ${track.def.id} has no ideal path`);
  const offset = numericArray(track.n);
  for (let index = 0; index < track.n; index++)
    offset[index] = sampleCompactPathPlanOffset(
      track,
      plan,
      index
    );
  const path = materializePath(track, offset, 'pit');
  for (let index = 0; index < track.n; index++) {
    if (!Number.isFinite(path.off[index]) || !Number.isFinite(path.k[index]) ||
        !Number.isFinite(path.ds[index]) || !Number.isFinite(path.v[index]) ||
        path.ds[index]! <= 0 || path.v[index]! < 0)
      throw new Error(`pit path ${plan.key} is not finite at ${index}`);
  }
  return path;
}

function pitIndex(track: Track, pitW: number): number {
  const s = ((track.pit.sEntry + pitW) % track.len + track.len) % track.len;
  return cyclicIndex(track, s / track.step);
}

function pitPathPlan(
  session: Session,
  entry: Entry
): Extract<PathPlan, { mode: 'pit' }> {
  const track = session.trk;
  const pit = track.pit;
  const start = currentIndex(track, entry);
  const w = entry.pitW ?? pit.wOf(entry.car?.s ?? pit.sEntry);
  if (entry.state === 'pitIn') {
    const boxW = pit.boxWAt(entry.ti);
    const targetW = entry.pitQueueW ?? boxW;
    const targetOff = entry.pitQueueOff ?? pit.boxOff;
    const queueing = entry.pitQueueW != null;
    const ingressStart = pitIngressStartW(entry, session, queueing);
    if (entry.pitPhase === 'queued') {
      return makePitPlan(track, entry,
        `pit:in:${entry.code}:queued:${targetW.toFixed(1)}`, [
          { index: indexAhead(track, start, 12), offset: targetOff }
        ], 30);
    }
    const anchors: PathPlanAnchor[] = [];
    if (w < ingressStart - 0.5)
      anchors.push({ index: pitIndex(track, ingressStart), offset: pit.off(ingressStart) });
    anchors.push({ index: pitIndex(track, targetW), offset: targetOff });
    return makePitPlan(track, entry,
      `pit:in:${entry.code}:${entry.pitPhase ?? 'travel'}:${targetW.toFixed(1)}`, [
        ...anchors
      ], 100);
  }
  const boxW = pit.boxWAt(entry.ti);
  const egressEnd = pitEgressEndW(entry, session);
  return makePitPlan(track, entry,
    `pit:out:${entry.code}:${entry.pitPhase ?? 'egress'}`, [
      { index: pitIndex(track, Math.max(w + 8, egressEnd)), offset: pit.off(Math.max(w + 8, egressEnd)) },
      { index: pitIndex(track, pit.Lp - pit.rampOut), offset: pit.off(pit.Lp - pit.rampOut) },
      { index: pitIndex(track, pit.Lp - 4), offset: pit.off(pit.Lp - 4) },
      // Continue the merge on the road reference until entry.ts observes that
      // the car footprint is legal.  This keeps the authority handoff both
      // physically achievable and path-continuous for cars lagging the ramp.
      {
        index: pitIndex(track, pit.Lp + pit.rampOut),
        offset: idealOffset(track, pitIndex(track, pit.Lp + pit.rampOut))
      }
    ], pit.Lp + pit.rampOut);
}

function installPitPath(
  session: Session,
  entry: Entry,
  plan: Extract<PathPlan, { mode: 'pit' }>
): void {
  if (entry.pathPlan?.key === plan.key) return;
  const track = session.trk;
  const index = currentIndex(track, entry);
  const previousTarget = currentPathTarget(track, entry);
  const path = materializePitPathPlan(track, plan);
  const slew = Math.abs(path.off[index]! - previousTarget);
  entry.pathMaxSlew = Math.max(entry.pathMaxSlew ?? 0, slew);
  entry.pathPlan = plan;
  entry.path = path;
  advanceLateralAuthorityRevision(entry);
  delete entry._laneBufferRevision;
  clearLaneProgram(entry, 'pit-path');
  entry.pathMode = plan.mode;
  entry.pathBuildN = (entry.pathBuildN ?? 0) + 1;
  entry.lat = 0;
}

function releasePitPath(entry: Entry): void {
  if (!entry.pathPlan) return;
  delete entry.pathPlan;
  delete entry.path;
  advanceLateralAuthorityRevision(entry);
  delete entry._laneBufferRevision;
  entry.pathMode = 'ideal';
}

/**
 * Update the dedicated sampled pit path. Racecraft lane authority belongs to
 * the evaluator and lane program; this function never inspects race semantics.
 */
export function syncPitPaths(
  session: Session,
  entries: readonly Entry[]
): void {
  for (const entry of entries) {
    if (!entry.car) continue;
    const inPitLane = entry.state === 'pitIn' || entry.state === 'pitOut';
    if (inPitLane) {
      installPitPath(session, entry, pitPathPlan(session, entry));
    } else if (entry.pathPlan?.mode === 'pit') {
      releasePitPath(entry);
    }
  }
}
