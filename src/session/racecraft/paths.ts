import { materializePath, nextCorner } from '../../core/racing-line';
import { PHYS } from '../../core/physics';
import {
  numericArray,
  type LegacyCorner,
  type PathMode,
  type SampledPath,
  type Track
} from '../../core/model';
import { clamp, lerp } from '../../shared/math';
import { pitEgressEndW, pitIngressStartW } from '../pit';
import type {
  CornerCorridorAssignment,
  CornerRightsRecord,
  Entry,
  PathPlan,
  PathPlanAnchor,
  PriorityRecord,
  Session
} from '../model';
import { TRAF_DT } from '../strategy';

const PATH_LIMIT_MARGIN = PHYS.carWid / 2 + 0.6;
const REJOIN_DISTANCE = 70;
const DIRECT_IDEAL_SLEW = 0.05;

export function followCap(
  session: Session,
  follower: Entry,
  leader: Entry,
  distance: number,
  timeGap: number,
  gain = 1.6,
  relativeBrakingBase = 6.8
): number {
  const wet = session.wet || 0;
  const desiredGap = Math.max(5, leader.spd * timeGap * (1 + 0.45 * wet));
  const closing = Math.max(0, follower.spd - leader.spd);
  const closingDamp = 0.35 + 0.35 * wet;
  const gapLaw = leader.spd + (distance - desiredGap) * gain - closing * closingDamp;
  const relativeBraking = relativeBrakingBase * (1 - 0.24 * wet);
  const brakeSafe = Math.sqrt(
    leader.spd * leader.spd + 2 * relativeBraking * Math.max(0, distance - 5)
  );
  return Math.max(leader.spd - 8, Math.min(gapLaw, brakeSafe));
}

export function lineOffAt(track: Track, entry: Entry): number {
  if (!entry.car) return 0;
  const path = entry.path ?? track.idealPath;
  if (!path) return 0;
  return path.off[Math.max(0, entry.car.progIdx) % track.n] ?? 0;
}

export function targetAbsLat(track: Track, entry: Entry): number {
  return lineOffAt(track, entry) + entry.latTgt;
}

export function setTargetAbsLat(track: Track, entry: Entry, lateral: number): void {
  const limit = track.hw - 2.0;
  let target = clamp(lateral, -limit, limit);
  const corridor = entry.pathPlan && entry.pathPlan.mode !== 'ideal' &&
    entry.pathPlan.mode !== 'pit' ? entry.pathPlan.corridor : undefined;
  if (corridor) target = clamp(target, corridor.minimum, corridor.maximum);
  entry.latTgt = target - lineOffAt(track, entry);
}

function smootherstep(value: number): number {
  const u = clamp(value, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
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
  candidates: readonly PathPlanAnchor[],
  maximumDistance = 300
): PathPlanAnchor[] {
  const byIndex = new Map<number, PathPlanAnchor>();
  for (const candidate of candidates) {
    const index = cyclicIndex(track, candidate.index);
    const distance = distanceAhead(track, startIndex, index);
    if (distance < 0.5 || distance > maximumDistance) continue;
    byIndex.set(index, { index, offset: candidate.offset });
  }
  return [...byIndex.values()].sort((left, right) =>
    distanceAhead(track, startIndex, left.index) - distanceAhead(track, startIndex, right.index)
  );
}

function makePlan(
  track: Track,
  entry: Entry,
  mode: Exclude<PathMode, 'ideal'>,
  key: string,
  candidates: readonly PathPlanAnchor[],
  options: {
    corner?: LegacyCorner;
    corridor?: { minimum: number; maximum: number };
    maximumDistance?: number;
  } = {}
): PathPlan {
  const startIndex = currentIndex(track, entry);
  const anchors: PathPlanAnchor[] = [
    { index: startIndex, offset: currentPathTarget(track, entry) },
    ...sortedFutureAnchors(track, startIndex, candidates, options.maximumDistance)
  ];
  if (anchors.length < 2) {
    const end = indexAhead(track, startIndex, 45);
    anchors.push({ index: end, offset: idealOffset(track, end) });
  }
  if (mode === 'pit') return { mode, key, anchors };
  const plan: PathPlan = {
    mode,
    key,
    anchors,
    ...(options.corner ? {
      cornerId: options.corner.id,
      complexId: options.corner.complexId
    } : {}),
    ...(options.corridor ? { corridor: options.corridor } : {})
  };
  return plan;
}

/** Materialize one immutable steering/speed authority from a compact plan. */
export function materializePathPlan(track: Track, plan: PathPlan): SampledPath {
  if (plan.mode === 'ideal') {
    if (!track.idealPath) throw new Error(`Track ${track.def.id} has no ideal path`);
    return track.idealPath;
  }
  if (plan.anchors.length < 2)
    throw new Error(`${plan.mode} path ${plan.key} needs at least two anchors`);
  const base = track.idealPath;
  if (!base) throw new Error(`Track ${track.def.id} has no ideal path`);
  // A priority beneficiary that is already on the ideal authority must keep
  // that exact geometry. Sparse ideal anchors would smooth between their
  // offsets and subtly bend the pass path away from the racing line.
  if (plan.mode === 'priority-pass' && plan.key.endsWith(':ideal'))
    return { ...base, mode: 'priority-pass' };
  const offset = numericArray(track.n);
  for (let index = 0; index < track.n; index++) offset[index] = base.off[index]!;
  const roadLimit = track.hw - PATH_LIMIT_MARGIN;
  if (plan.mode !== 'pit' && roadLimit <= 0)
    throw new Error(`Track ${track.def.id} has no usable path width`);
  for (let anchorIndex = 0; anchorIndex < plan.anchors.length - 1; anchorIndex++) {
    const from = plan.anchors[anchorIndex]!;
    const to = plan.anchors[anchorIndex + 1]!;
    const fromIndex = cyclicIndex(track, from.index);
    const toIndex = cyclicIndex(track, to.index);
    const span = (toIndex - fromIndex + track.n) % track.n;
    if (span <= 0 || span * track.step > track.len / 2)
      throw new Error(`${plan.mode} path ${plan.key} has a non-forward anchor interval`);
    for (let delta = 0; delta <= span; delta++) {
      const value = lerp(from.offset, to.offset, smootherstep(delta / span));
      let bounded = plan.mode === 'pit' ? value : clamp(value, -roadLimit, roadLimit);
      if (plan.mode !== 'pit' && plan.corridor)
        bounded = clamp(bounded, plan.corridor.minimum, plan.corridor.maximum);
      offset[(fromIndex + delta) % track.n] = bounded;
    }
  }
  if (plan.mode === 'pit' || plan.mode === 'tuck' || plan.mode === 'blue-yield' ||
      plan.mode === 'qualifying-yield' || plan.mode === 'priority-pass') {
    // These plans may hold their final anchor for longer than the currently
    // sampled lookahead. Close the unused remainder of the cycle smoothly
    // back to the current-position anchor so the transition remains behind
    // the active plan and cannot introduce a curvature/speed discontinuity.
    const from = plan.anchors[plan.anchors.length - 1]!;
    const to = plan.anchors[0]!;
    const fromIndex = cyclicIndex(track, from.index);
    const toIndex = cyclicIndex(track, to.index);
    const span = (toIndex - fromIndex + track.n) % track.n;
    for (let delta = 1; delta < span; delta++)
      offset[(fromIndex + delta) % track.n] = lerp(
        from.offset,
        to.offset,
        smootherstep(delta / span)
      );
  }
  const path = materializePath(track, offset, plan.mode);
  if (plan.mode !== 'pit') {
    if (plan.cornerId) path.cornerId = plan.cornerId;
    if (plan.complexId !== undefined) path.complexId = plan.complexId;
  }
  for (let index = 0; index < track.n; index++) {
    if (!Number.isFinite(path.off[index]) || !Number.isFinite(path.k[index]) ||
        !Number.isFinite(path.ds[index]) || !Number.isFinite(path.v[index]) ||
        path.ds[index]! <= 0 || path.v[index]! < 0)
      throw new Error(`${plan.mode} path ${plan.key} is not finite at ${index}`);
  }
  return path;
}

function cornerByApex(track: Track, apex: number): LegacyCorner | null {
  return track.corners?.find(corner => corner.apexI === apex) ?? null;
}

function cornerPathPlan(
  session: Session,
  entry: Entry,
  mode: 'attack' | 'defend',
  corner: LegacyCorner | null
): PathPlan {
  const track = session.trk;
  const start = currentIndex(track, entry);
  const usable = track.hw - PATH_LIMIT_MARGIN;
  if (!corner) {
    const side = entry.atkSide >= 0 ? 1 : -1;
    return makePlan(track, entry, mode, `${mode}:straight:${side}`, [
      { index: indexAhead(track, start, 28), offset: side * usable * 0.72 },
      { index: indexAhead(track, start, 85), offset: side * usable * 0.55 },
      { index: indexAhead(track, start, 125), offset: idealOffset(track, indexAhead(track, start, 125)) }
    ]);
  }
  const side = corner.side;
  const targets = mode === 'attack'
    ? { entry: 0.58, apex: 0.80, exit: 0.28 }
    : { entry: 0.43, apex: 0.62, exit: 0.10 };
  return makePlan(track, entry, mode, `${mode}:${corner.id}`, [
    { index: corner.brakeI, offset: side * usable * targets.entry },
    { index: corner.turnInI, offset: side * usable * targets.entry },
    { index: corner.apexI, offset: side * usable * targets.apex },
    { index: corner.trackOutI, offset: side * usable * targets.exit },
    { index: corner.exitI, offset: idealOffset(track, corner.exitI) }
  ], { corner });
}

interface RightsPathContext {
  record: CornerRightsRecord;
  assignment: CornerCorridorAssignment | null;
}

function rightsForEntry(session: Session, entry: Entry): RightsPathContext | null {
  const assignment = session.cornerRightsAssignments?.get(entry.code) ?? null;
  for (const record of session.cornerRights?.values() ?? []) {
    if (record.inside !== entry && record.outside !== entry) continue;
    if (assignment && record.cornerId !== assignment.cornerId) continue;
    return { record, assignment };
  }
  return null;
}

function rightsPathPlan(
  session: Session,
  entry: Entry,
  context: RightsPathContext
): PathPlan {
  const track = session.trk;
  const record = context.record;
  const assignment = context.assignment;
  const cornerId = assignment?.cornerId ?? record.cornerId;
  const corner = track.corners.find(candidate => candidate.id === cornerId);
  if (!corner) return rejoinPathPlan(session, entry, `missing-rights:${cornerId}`);
  const usable = track.hw - PATH_LIMIT_MARGIN;
  const inside = assignment ? assignment.role === 'inside' : record.inside === entry;
  const current = currentPathTarget(track, entry);
  const target = assignment?.target ?? (inside ? record.insideTarget : record.outsideTarget);
  const split = (record.insideTarget + record.outsideTarget) / 2;
  const fallback = corner.side > 0
    ? inside
      ? { minimum: split, maximum: usable }
      : { minimum: -usable, maximum: split }
    : inside
      ? { minimum: -usable, maximum: split }
      : { minimum: split, maximum: usable };
  const protectedCorridor = assignment
    ? { minimum: assignment.minimum, maximum: assignment.maximum }
    : inside
      ? {
          minimum: record.insideCorridorMinimum ?? fallback.minimum,
          maximum: record.insideCorridorMaximum ?? fallback.maximum
        }
      : {
          minimum: record.outsideCorridorMinimum ?? fallback.minimum,
          maximum: record.outsideCorridorMaximum ?? fallback.maximum
        };
  const corridor = {
    minimum: Math.min(protectedCorridor.minimum, current),
    maximum: Math.max(protectedCorridor.maximum, current)
  };
  const role = assignment?.role ?? (inside ? 'inside' : 'outside');
  const desiredApex = role === 'inside'
    ? corner.side * usable * 0.72
    : role === 'outside'
      ? -corner.side * usable * 0.54
      : target;
  const apex = clamp(desiredApex, protectedCorridor.minimum, protectedCorridor.maximum);
  const trackOut = clamp(target, protectedCorridor.minimum, protectedCorridor.maximum);
  const mode = inside ? 'side-inside' : 'side-outside';
  return makePlan(track, entry, mode, `${mode}:${record.key}:${cornerId}:${role}`, [
    { index: corner.turnInI, offset: target },
    { index: corner.apexI, offset: apex },
    { index: corner.trackOutI, offset: trackOut },
    { index: corner.exitI, offset: trackOut }
  ], { corner, corridor });
}

function priorityForEntry(session: Session, entry: Entry): PriorityRecord | null {
  if (entry.priorityYield) {
    for (const record of session.priorityRecords?.values() ?? [])
      if (record.yielding === entry && record.beneficiary.code === entry.priorityYield.beneficiary)
        return record;
  }
  let nearest: PriorityRecord | null = null;
  for (const record of session.priorityRecords?.values() ?? []) {
    if (record.beneficiary !== entry) continue;
    if (!nearest || record.lastGap < nearest.lastGap) nearest = record;
  }
  return nearest;
}

function priorityPathPlan(
  session: Session,
  entry: Entry,
  record: PriorityRecord
): PathPlan {
  const track = session.trk;
  const start = currentIndex(track, entry);
  const yielding = record.yielding === entry;
  const distanceToPit = entry.car
    ? (track.pit.sEntry - entry.car.s + track.len) % track.len
    : Infinity;
  if (yielding && (entry.pitArm || entry.boxArm) && distanceToPit < 180)
    return pitPathPlan(session, entry);
  const mode = yielding
    ? record.reason === 'blue-flag' ? 'blue-yield' : 'qualifying-yield'
    : 'priority-pass';
  const catchWindow = clamp(
    Number.isFinite(record.timeToCatch) ? record.timeToCatch + 2 : 10,
    6,
    22
  );
  const minimumHold = 320;
  const maximumHold = Math.max(
    minimumHold,
    Math.min(1200, track.len / 2 - track.step * 2)
  );
  let holdDistance = clamp(
    Math.max(entry.spd, record.beneficiary.spd, record.yielding.spd) * catchWindow,
    minimumHold,
    maximumHold
  );
  if (record.holdUntilI != null)
    holdDistance = Math.max(
      holdDistance,
      Math.min(maximumHold, distanceAhead(track, start, record.holdUntilI) + 180)
    );
  const holdIndex = indexAhead(track, start, holdDistance);
  if (!yielding) {
    if (record.detectedPhase === 'corner') {
      const usable = track.hw - PATH_LIMIT_MARGIN;
      const passSide = clamp(
        record.yielding.latNow - Math.sign(record.yieldSide || 1) *
          (PHYS.carWid + 0.6),
        -usable,
        usable
      );
      const corner = record.holdUntilI == null ? null :
        track.corners.find(candidate => candidate.trackOutI === record.holdUntilI) ?? null;
      const anchors: PathPlanAnchor[] = [
        { index: indexAhead(track, start, 24), offset: passSide }
      ];
      if (corner && distanceAhead(track, start, corner.trackOutI) < track.len / 2)
        anchors.push({ index: corner.trackOutI, offset: passSide });
      anchors.push({ index: holdIndex, offset: passSide });
      return makePlan(track, entry, mode, `${mode}:${record.key}:corner-side`, anchors,
        { maximumDistance: maximumHold + track.step });
    }
    const idealNow = idealOffset(track, start);
    const current = currentPathTarget(track, entry);
    if (Math.abs(current - idealNow) <= DIRECT_IDEAL_SLEW) {
      return {
        mode,
        key: `${mode}:${record.key}:ideal`,
        anchors: [
          { index: start, offset: idealNow },
          { index: holdIndex, offset: idealOffset(track, holdIndex) }
        ]
      };
    }
    const rejoinPrefix = `${mode}:${record.key}:ideal-rejoin:`;
    if (entry.pathPlan?.mode === 'priority-pass' &&
        entry.pathPlan.key.startsWith(rejoinPrefix)) return entry.pathPlan;
    const rejoinIndex = indexAhead(track, start, REJOIN_DISTANCE);
    return makePlan(track, entry, mode, `${rejoinPrefix}${start}`, [
      { index: rejoinIndex, offset: idealOffset(track, rejoinIndex) },
      { index: holdIndex, offset: idealOffset(track, holdIndex) }
    ], { maximumDistance: maximumHold + track.step });
  }
  if (record.detectedPhase === 'corner' && record.holdUntilI != null) {
    const held = currentPathTarget(track, entry);
    const corner = track.corners.find(candidate =>
      candidate.trackOutI === record.holdUntilI) ?? null;
    const anchors: PathPlanAnchor[] = [];
    if (corner && distanceAhead(track, start, corner.apexI) < track.len / 2)
      anchors.push({ index: corner.apexI, offset: held });
    anchors.push(
      { index: record.holdUntilI, offset: record.yieldSide },
      { index: holdIndex, offset: record.yieldSide }
    );
    return makePlan(track, entry, mode, `${mode}:${record.key}:corner`, anchors,
      { maximumDistance: maximumHold + track.step });
  }
  if (record.detectedPhase === 'approach' && record.holdUntilI != null) {
    const corner = track.corners.find(candidate =>
      candidate.trackOutI === record.holdUntilI) ?? null;
    if (corner) {
      const toBrake = distanceAhead(track, start, corner.brakeI);
      const toTurnIn = distanceAhead(track, start, corner.turnInI);
      const semanticDistance = toBrake >= 8 && toBrake <= toTurnIn
        ? toBrake
        : toTurnIn;
      const transitionIndex = indexAhead(track, start, Math.min(28, semanticDistance));
      return makePlan(track, entry, mode, `${mode}:${record.key}:approach`, [
        { index: transitionIndex, offset: record.yieldSide },
        { index: holdIndex, offset: record.yieldSide }
      ], { maximumDistance: maximumHold + track.step });
    }
  }
  const transition = record.detectedPhase === 'approach' ? 28 : 20;
  return makePlan(track, entry, mode, `${mode}:${record.key}:${record.detectedPhase}`, [
    { index: indexAhead(track, start, transition), offset: record.yieldSide },
    { index: holdIndex, offset: record.yieldSide }
  ], { maximumDistance: maximumHold + track.step });
}

function pitIndex(track: Track, pitW: number): number {
  const s = ((track.pit.sEntry + pitW) % track.len + track.len) % track.len;
  return cyclicIndex(track, s / track.step);
}

function pitPathPlan(session: Session, entry: Entry): PathPlan {
  const track = session.trk;
  const pit = track.pit;
  const start = currentIndex(track, entry);
  if (entry.state === 'run') {
    return makePlan(track, entry, 'pit', `pit:approach:${entry.code}`, [
      { index: indexAhead(track, start, 55), offset: Math.min(3.2, track.hw - 2) },
      { index: pitIndex(track, 0), offset: pit.off(0) },
      { index: pitIndex(track, 24), offset: pit.off(24) }
    ], { maximumDistance: 260 });
  }
  const w = entry.pitW ?? pit.wOf(entry.car?.s ?? pit.sEntry);
  if (entry.state === 'pitIn') {
    const boxW = pit.boxWAt(entry.ti);
    const targetW = entry.pitQueueW ?? boxW;
    const targetOff = entry.pitQueueOff ?? pit.boxOff;
    const queueing = entry.pitQueueW != null;
    const ingressStart = pitIngressStartW(entry, session, queueing);
    if (entry.pitPhase === 'queued') {
      return makePlan(track, entry, 'pit',
        `pit:in:${entry.code}:queued:${targetW.toFixed(1)}`, [
          { index: indexAhead(track, start, 12), offset: targetOff }
        ], { maximumDistance: 30 });
    }
    const anchors: PathPlanAnchor[] = [];
    if (w < ingressStart - 0.5)
      anchors.push({ index: pitIndex(track, ingressStart), offset: pit.off(ingressStart) });
    anchors.push({ index: pitIndex(track, targetW), offset: targetOff });
    return makePlan(track, entry, 'pit',
      `pit:in:${entry.code}:${entry.pitPhase ?? 'travel'}:${targetW.toFixed(1)}`, [
        ...anchors
      ], { maximumDistance: 100 });
  }
  const boxW = pit.boxWAt(entry.ti);
  const egressEnd = pitEgressEndW(entry, session);
  return makePlan(track, entry, 'pit',
    `pit:out:${entry.code}:${entry.pitPhase ?? 'egress'}`, [
      { index: pitIndex(track, Math.max(w + 8, egressEnd)), offset: pit.off(Math.max(w + 8, egressEnd)) },
      { index: pitIndex(track, pit.Lp - pit.rampOut), offset: pit.off(pit.Lp - pit.rampOut) },
      { index: pitIndex(track, pit.Lp - 4), offset: pit.off(pit.Lp - 4) }
    ], { maximumDistance: pit.Lp });
}

function rejoinPathPlan(session: Session, entry: Entry, reason: string): PathPlan {
  const track = session.trk;
  const start = currentIndex(track, entry);
  const end = indexAhead(track, start, REJOIN_DISTANCE);
  return makePlan(track, entry, 'tuck', `tuck:${entry.code}:${reason}:${start}`, [
    { index: end, offset: idealOffset(track, end) }
  ]);
}

function planHasFinished(track: Track, entry: Entry, plan: PathPlan): boolean {
  if (plan.mode === 'ideal' || plan.anchors.length < 2 || !entry.car) return true;
  const start = plan.anchors[0]!.index;
  const end = plan.anchors[plan.anchors.length - 1]!.index;
  const total = distanceAhead(track, start, end);
  const progress = distanceAhead(track, start, currentIndex(track, entry));
  return progress >= total && progress < track.len / 2;
}

function installPlan(session: Session, entry: Entry, plan: PathPlan): void {
  if (entry.pathPlan?.key === plan.key) return;
  const track = session.trk;
  const index = currentIndex(track, entry);
  const previousTarget = currentPathTarget(track, entry);
  const path = materializePathPlan(track, plan);
  const slew = Math.abs(path.off[index]! - previousTarget);
  entry.pathMaxSlew = Math.max(entry.pathMaxSlew ?? 0, slew);
  if (slew > 0.500001)
    throw new Error(`${entry.code} ${plan.mode} path target jumped ${slew.toFixed(3)}m`);
  entry.pathPlan = plan;
  if (plan.mode === 'ideal') delete entry.path;
  else entry.path = path;
  entry.pathMode = plan.mode;
  entry.pathModeSince = session.t;
  entry.pathBuildN = (entry.pathBuildN ?? 0) + 1;
  entry.lat = 0;
  entry.latTgt = 0;
}

function installIdeal(session: Session, entry: Entry): void {
  if (entry.pathPlan?.mode === 'ideal' && !entry.path) {
    entry.pathMode = 'ideal';
    return;
  }
  entry.pathPlan = { mode: 'ideal', key: 'ideal' };
  entry.pathMode = 'ideal';
  entry.pathModeSince = session.t;
  delete entry.path;
  entry.lat = 0;
  entry.latTgt = 0;
}

function desiredPlan(session: Session, entry: Entry): PathPlan | null {
  const track = session.trk;
  if (!entry.car) return null;
  if (entry.state === 'pitIn' || entry.state === 'pitOut') return pitPathPlan(session, entry);
  const rights = rightsForEntry(session, entry);
  if (rights) return rightsPathPlan(session, entry, rights);
  const priority = priorityForEntry(session, entry);
  if (priority) return priorityPathPlan(session, entry, priority);
  if ((entry.pitArm || entry.boxArm) &&
      (track.pit.sEntry - entry.car.s + track.len) % track.len < 180)
    return pitPathPlan(session, entry);
  if (entry.atkT > 0 && entry.tuckT <= 0)
    return cornerPathPlan(session, entry, 'attack', cornerByApex(track, entry.atkCorner));
  if (entry.defT > 0)
    return cornerPathPlan(session, entry, 'defend', cornerByApex(track, entry.defCorner));
  if (entry.tuckT > 0) {
    const reason = `explicit:${entry._tuckWith || 'traffic'}`;
    const prefix = `tuck:${entry.code}:${reason}:`;
    if (entry.pathPlan?.mode === 'tuck' && entry.pathPlan.key.startsWith(prefix))
      return entry.pathPlan;
    return rejoinPathPlan(session, entry, reason);
  }
  return null;
}

/**
 * Resolve final arbitration into cached paths once per traffic update. Scalar
 * targets remain only for incident avoidance and legacy emergency room.
 */
export function syncRacecraftPaths(session: Session, entries: readonly Entry[]): void {
  for (const entry of entries) {
    if (!entry.car) continue;
    const emergencyScalar = entry.hFail || entry.avoidT > 0 || entry.recT > 0 ||
      entry.car.offCourse || (!!entry._roomActive && !rightsForEntry(session, entry));
    if (emergencyScalar) {
      delete entry.path;
      entry.pathPlan = { mode: 'ideal', key: 'ideal' };
      entry.pathMode = 'ideal';
    } else {
      const desired = desiredPlan(session, entry);
      if (desired) installPlan(session, entry, desired);
      else if (entry.pathPlan?.mode === 'tuck') {
        if (planHasFinished(session.trk, entry, entry.pathPlan)) installIdeal(session, entry);
        else entry.pathMode = 'tuck';
      } else if (entry.pathPlan && entry.pathPlan.mode !== 'ideal') {
        installPlan(session, entry, rejoinPathPlan(session, entry, entry.pathPlan.key));
      } else installIdeal(session, entry);
    }
    const mode = entry.pathMode ?? 'ideal';
    const times = entry.pathModeTime ?? (entry.pathModeTime = {});
    times[mode] = (times[mode] ?? 0) + TRAF_DT;
  }
}
