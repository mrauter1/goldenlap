import type { Car, LegacyCorner, Track } from '../../core/model';
import { PHYS } from '../../core/physics';
import { nextCorner } from '../../core/racing-line';
import { clamp, normAng } from '../../shared/math';
import type {
  CornerCorridorAssignment,
  CornerRightsHistory,
  CornerRightsRecord,
  Entry,
  Session
} from '../model';
import { TRAF_DT } from '../strategy';
import { setTargetAbsLat } from './paths';

type ActiveEntry = Entry & { car: Car };

export const ROOM_SEP = 3.4;
const ROAD_EDGE_MARGIN = PHYS.carWid / 2 + 0.6;
const CLEAR_SECONDS = 0.5;
const BUMPER_CLEARANCE = 0.5;
const PREDICTION_SECONDS = 0.55;
const THREE_WIDE_ENTRY_SEPARATION = 1.2;

interface PairCorridor {
  requiredSeparation: number;
  center: number;
  insideTarget: number;
  outsideTarget: number;
  insideMinimum: number;
  insideMaximum: number;
  outsideMinimum: number;
  outsideMaximum: number;
}

export interface LongitudinalBodyProjection {
  signedDistance: number;
  firstHalfExtent: number;
  secondHalfExtent: number;
  clearance: number;
  overlap: boolean;
}

export function idxAheadM(track: Track, from: number, to: number): number {
  return ((to - from + track.n) % track.n) * track.step;
}

export function idxInWindow(track: Track, index: number, from: number, to: number): boolean {
  return ((index - from + track.n) % track.n) <= ((to - from + track.n) % track.n);
}

export function roomPairKey(first: Entry, second: Entry): string {
  return first.code < second.code
    ? `${first.code}|${second.code}`
    : `${second.code}|${first.code}`;
}

export function cornerByApex(track: Track, apexIndex: number): LegacyCorner | null {
  if (apexIndex < 0 || !track.corners) return null;
  for (const corner of track.corners) if (corner.apexI === apexIndex) return corner;
  return null;
}

export function recentCorner(track: Track, index: number, maximumDistance: number): LegacyCorner | null {
  let result: LegacyCorner | null = null;
  let best = maximumDistance;
  for (const corner of track.corners || []) {
    const distance = ((index - corner.apexI + track.n) % track.n) * track.step;
    if (distance <= best) {
      best = distance;
      result = corner;
    }
  }
  return result;
}

export function hasCornerRights(session: Session, first: Entry, second: Entry): boolean {
  return !!session.cornerRights?.has(roomPairKey(first, second));
}

export function signedTrackDistance(track: Track, from: number, to: number): number {
  let distance = (to - from + track.len) % track.len;
  if (distance > track.len / 2) distance -= track.len;
  return distance;
}

function projectedHalfExtent(track: Track, entry: ActiveEntry): number {
  const index = Math.max(0, entry.car.progIdx) % track.n;
  const roadHeading = Math.atan2(track.ty[index]!, track.tx[index]!);
  const yaw = normAng(entry.car.h - roadHeading);
  return Math.abs(Math.cos(yaw)) * PHYS.carLen / 2 +
    Math.abs(Math.sin(yaw)) * PHYS.carWid / 2;
}

export function longitudinalBodyProjection(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): LongitudinalBodyProjection {
  const signedDistance = signedTrackDistance(track, first.car.s, second.car.s);
  const firstHalfExtent = projectedHalfExtent(track, first);
  const secondHalfExtent = projectedHalfExtent(track, second);
  const clearance = Math.abs(signedDistance) - firstHalfExtent - secondHalfExtent;
  return {
    signedDistance,
    firstHalfExtent,
    secondHalfExtent,
    clearance,
    overlap: clearance < 0
  };
}

export function longitudinalBodiesOverlap(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): boolean {
  return longitudinalBodyProjection(track, first, second).overlap;
}

export function longitudinalBodyClearance(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): number {
  return longitudinalBodyProjection(track, first, second).clearance;
}

function usableHalfWidth(track: Track): number {
  return Math.max(0, track.hw - ROAD_EDGE_MARGIN);
}

function boundsFromCornerCoordinates(
  side: -1 | 1,
  minimum: number,
  maximum: number
): { minimum: number; maximum: number } {
  return side > 0
    ? { minimum, maximum }
    : { minimum: -maximum, maximum: -minimum };
}

function solvePairCorridor(
  track: Track,
  corner: LegacyCorner,
  inside: Entry,
  outside: Entry
): PairCorridor {
  const usable = usableHalfWidth(track);
  const requiredSeparation = Math.min(ROOM_SEP, usable * 2);
  const side = corner.side;
  const insideQ = side * inside.latNow;
  const outsideQ = side * outside.latNow;
  const halfSeparation = requiredSeparation / 2;
  const center = clamp(
    (insideQ + outsideQ) / 2,
    -usable + halfSeparation,
    usable - halfSeparation
  );
  const insideTargetQ = center + halfSeparation;
  const outsideTargetQ = center - halfSeparation;
  const insideBounds = boundsFromCornerCoordinates(side, insideTargetQ, usable);
  const outsideBounds = boundsFromCornerCoordinates(side, -usable, outsideTargetQ);
  return {
    requiredSeparation,
    center: side * center,
    insideTarget: side * insideTargetQ,
    outsideTarget: side * outsideTargetQ,
    insideMinimum: insideBounds.minimum,
    insideMaximum: insideBounds.maximum,
    outsideMinimum: outsideBounds.minimum,
    outsideMaximum: outsideBounds.maximum
  };
}

function applyPairCorridor(record: CornerRightsRecord, corridor: PairCorridor): void {
  record.requiredSeparation = corridor.requiredSeparation;
  record.corridorCenter = corridor.center;
  record.insideTarget = corridor.insideTarget;
  record.outsideTarget = corridor.outsideTarget;
  record.insideCorridorMinimum = corridor.insideMinimum;
  record.insideCorridorMaximum = corridor.insideMaximum;
  record.outsideCorridorMinimum = corridor.outsideMinimum;
  record.outsideCorridorMaximum = corridor.outsideMaximum;
}

function onRacingSurface(track: Track, entry: ActiveEntry): boolean {
  return !entry.car.offCourse && Math.abs(entry.latNow) <= track.hw + 0.3;
}

export function updateCornerRights(session: Session, entries: readonly ActiveEntry[]): void {
  const track = session.trk;
  const records = session.cornerRights ?? (session.cornerRights = new Map());
  const history = session.cornerRightsHistory ?? (session.cornerRightsHistory = []);
  const stamp = (session.cornerRightsStamp || 0) + 1;
  session.cornerRightsStamp = stamp;

  for (let left = 0; left < entries.length; left++) {
    const first = entries[left]!;
    if (first.state !== 'run' || !onRacingSurface(track, first)) continue;
    for (let right = left + 1; right < entries.length; right++) {
      const second = entries[right]!;
      if (second.state !== 'run' || !onRacingSurface(track, second)) continue;
      const key = roomPairKey(first, second);
      const existing = records.get(key);
      if (existing) {
        existing.lastSeenStamp = stamp;
        continue;
      }
      if (!longitudinalBodiesOverlap(track, first, second)) continue;
      const firstCorner = acquisitionCorner(track, Math.max(0, first.car.progIdx));
      const secondCorner = acquisitionCorner(track, Math.max(0, second.car.progIdx));
      if (!firstCorner || !secondCorner || firstCorner.id !== secondCorner.id) continue;
      if (!inAcquisitionWindow(track, Math.max(0, first.car.progIdx), firstCorner) ||
          !inAcquisitionWindow(track, Math.max(0, second.car.progIdx), secondCorner)) continue;

      const side = firstCorner.side;
      const firstInside = side * first.latNow > side * second.latNow ||
        (side * first.latNow === side * second.latNow && first.code < second.code);
      const inside = firstInside ? first : second;
      const outside = firstInside ? second : first;
      const defenderCode = first.defT > 0 ? first.code : second.defT > 0 ? second.code : null;
      const record: CornerRightsRecord = {
        key,
        cornerId: firstCorner.id,
        complexId: firstCorner.complexId,
        inside,
        outside,
        insideCode: inside.code,
        outsideCode: outside.code,
        attackerCode: first.atkT > 0 ? first.code : second.atkT > 0 ? second.code : null,
        defenderCode,
        acquiredAt: session.t,
        acquiredPhase: laterPhase(
          phaseAt(track, Math.max(0, first.car.progIdx), firstCorner),
          phaseAt(track, Math.max(0, second.car.progIdx), secondCorner)
        ),
        insideTarget: inside.latNow,
        outsideTarget: outside.latNow,
        requiredSeparation: 0,
        previousInsideLateral: inside.latNow,
        previousOutsideLateral: outside.latNow,
        previousSeparation: Math.abs(inside.latNow - outside.latNow),
        minimumSeparation: Math.abs(inside.latNow - outside.latNow),
        violationCount: 0,
        violationActive: false,
        handoffs: 0,
        defenseCancelled: defenderCode != null,
        lastSeenStamp: stamp,
        clearFor: 0
      };
      applyPairCorridor(record, solvePairCorridor(track, firstCorner, inside, outside));
      inside.defT = 0;
      outside.defT = 0;
      inside.defCorner = -1;
      outside.defCorner = -1;
      records.set(key, record);
      session.cornerRightsAcquisitions = (session.cornerRightsAcquisitions || 0) + 1;
    }
  }

  enforceTurnInTucks(session, entries, records);

  for (const record of [...records.values()]) {
    if (!record.inside.car || !record.outside.car ||
        record.inside.state !== 'run' || record.outside.state !== 'run') {
      release(session, records, history, record, 'state');
      continue;
    }
    const corner = track.corners?.find(item => item.id === record.cornerId);
    if (!corner) {
      release(session, records, history, record, 'corner-missing');
      continue;
    }
    updatePredictiveState(session, record, corner);
    const insidePast = isPast(track, corner.trackOutI, record.inside.car.progIdx);
    const outsidePast = isPast(track, corner.trackOutI, record.outside.car.progIdx);
    if (!insidePast || !outsidePast) {
      record.clearFor = 0;
      record.lastSeenStamp = stamp;
      continue;
    }

    const freeDistance = longitudinalBodyClearance(
      track,
      record.inside as ActiveEntry,
      record.outside as ActiveEntry
    );
    if (freeDistance < BUMPER_CLEARANCE) {
      const linked = nextLinkedCorner(track, corner);
      if (linked && !bothPast(track, linked.trackOutI, record.inside, record.outside)) {
        handoffRecord(session, record, corner, linked);
        record.lastSeenStamp = stamp;
        continue;
      }
    }
    if (freeDistance >= BUMPER_CLEARANCE) record.clearFor += TRAF_DT;
    else record.clearFor = 0;
    if (record.clearFor + 1e-9 >= CLEAR_SECONDS)
      release(session, records, history, record, 'track-out-clear');
    else record.lastSeenStamp = stamp;
  }

  resolveCorridorAssignments(session, records, history);
}

export function applyCornerRights(session: Session): void {
  const track = session.trk;
  for (const assignment of session.cornerRightsAssignments?.values() || []) {
    const entry = assignment.entry;
    if (!entry.car || entry.state !== 'run') continue;
    entry.battle = true;
    entry.pathMode = assignment.role === 'inside' ? 'side-inside' : 'side-outside';
    setTargetAbsLat(track, entry, assignment.target);
  }

  for (const record of session.cornerRights?.values() || []) {
    const inside = record.inside;
    const outside = record.outside;
    if (!inside.car || !outside.car) continue;
    const actualSeparation = Math.abs(inside.latNow - outside.latNow);
    const predicted = record.predictedSeparation ?? actualSeparation;
    const protectedFloor = Math.min(
      record.requiredSeparation,
      Math.max(PHYS.carWid, actualSeparation)
    );
    if (actualSeparation < record.requiredSeparation - 0.35 ||
        predicted < protectedFloor - 0.05) {
      const closingPenalty = Math.max(0.5, (record.closingRate || 0) * 0.35);
      const cap = Math.max(0, Math.min(inside.spd, outside.spd) - closingPenalty);
      inside.vCap = Math.min(inside.vCap, cap);
      outside.vCap = Math.min(outside.vCap, cap);
    }
  }
}

function updatePredictiveState(
  session: Session,
  record: CornerRightsRecord,
  corner: LegacyCorner
): void {
  const side = corner.side;
  const insideQ = side * record.inside.latNow;
  const outsideQ = side * record.outside.latNow;
  const signedSeparation = insideQ - outsideQ;
  const actualSeparation = Math.abs(record.inside.latNow - record.outside.latNow);
  const previousInside = record.previousInsideLateral ?? record.inside.latNow;
  const previousOutside = record.previousOutsideLateral ?? record.outside.latNow;
  const previousSigned = side * previousInside - side * previousOutside;
  const closingRate = Math.max(0, (previousSigned - signedSeparation) / TRAF_DT);
  record.closingRate = closingRate;
  record.predictedSeparation = signedSeparation - closingRate * PREDICTION_SECONDS;
  record.previousInsideLateral = record.inside.latNow;
  record.previousOutsideLateral = record.outside.latNow;
  record.previousSeparation = signedSeparation;
  record.minimumSeparation = Math.min(record.minimumSeparation ?? actualSeparation, actualSeparation);
  session.cornerRightsMinimumSeparation = Math.min(
    session.cornerRightsMinimumSeparation ?? actualSeparation,
    actualSeparation
  );
  const targetSeparation = side * record.insideTarget - side * record.outsideTarget;
  const violation = signedSeparation < -0.05 ||
    targetSeparation < record.requiredSeparation - 1e-6;
  if (violation && !record.violationActive) {
    record.violationCount = (record.violationCount || 0) + 1;
    session.cornerRightsViolations = (session.cornerRightsViolations || 0) + 1;
  }
  record.violationActive = violation;
}

function resolveCorridorAssignments(
  session: Session,
  records: Map<string, CornerRightsRecord>,
  history: CornerRightsHistory[]
): void {
  const assignments = session.cornerRightsAssignments ??
    (session.cornerRightsAssignments = new Map());
  assignments.clear();
  const byCorner = new Map<string, CornerRightsRecord[]>();
  for (const record of records.values()) {
    const list = byCorner.get(record.cornerId) ?? [];
    list.push(record);
    byCorner.set(record.cornerId, list);
  }

  for (const [cornerId, cornerRecords] of byCorner) {
    const pending = new Set(cornerRecords);
    while (pending.size) {
      const seed = pending.values().next().value as CornerRightsRecord;
      pending.delete(seed);
      const componentRecords = [seed];
      const componentEntries = new Set<Entry>([seed.inside, seed.outside]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const candidate of [...pending]) {
          if (!componentEntries.has(candidate.inside) && !componentEntries.has(candidate.outside)) continue;
          pending.delete(candidate);
          componentRecords.push(candidate);
          componentEntries.add(candidate.inside);
          componentEntries.add(candidate.outside);
          expanded = true;
        }
      }
      const entries = [...componentEntries].filter(
        (entry): entry is ActiveEntry => !!entry.car && entry.state === 'run'
      );
      const corner = session.trk.corners?.find(item => item.id === cornerId);
      if (!corner || entries.length < 2) continue;
      if (entries.length === 2) {
        const record = componentRecords.find(candidate => records.has(candidate.key));
        if (record) assignPair(record, assignments);
        continue;
      }
      if (threeWideFeasible(session.trk, entries, corner)) {
        assignThreeWide(session.trk, entries, componentRecords, corner, assignments);
        continue;
      }

      const ordered = [...entries].sort((first, second) =>
        idxAheadM(session.trk, Math.max(0, first.car.progIdx), corner.apexI) -
        idxAheadM(session.trk, Math.max(0, second.car.progIdx), corner.apexI)
      );
      const keep = new Set<Entry>(ordered.slice(0, 2));
      const fallback = ordered.slice(2);
      for (const entry of fallback) {
        entry.atkT = 0;
        entry.atkCorner = -1;
        entry.atkCd = Math.max(entry.atkCd, 1.5);
        entry.tuckT = Math.max(entry.tuckT, 0.8);
        entry._tuckWith = ordered[0]?.code ?? '';
        entry._tuckCorner = corner.apexI;
        session.tuckFailN = (session.tuckFailN || 0) + 1;
        session.cornerRightsThreeCarFallbacks =
          (session.cornerRightsThreeCarFallbacks || 0) + 1;
      }
      for (const record of componentRecords) {
        if (!records.has(record.key)) continue;
        if (!keep.has(record.inside) || !keep.has(record.outside))
          release(session, records, history, record, 'three-car-tuck');
      }
      const survivor = componentRecords.find(record => records.has(record.key));
      if (survivor) assignPair(survivor, assignments);
    }
  }
}

function assignPair(
  record: CornerRightsRecord,
  assignments: Map<string, CornerCorridorAssignment>
): void {
  assignments.set(record.inside.code, {
    entry: record.inside,
    code: record.inside.code,
    cornerId: record.cornerId,
    role: 'inside',
    target: record.insideTarget,
    minimum: record.insideCorridorMinimum ?? Math.min(record.insideTarget, record.outsideTarget),
    maximum: record.insideCorridorMaximum ?? Math.max(record.insideTarget, record.outsideTarget)
  });
  assignments.set(record.outside.code, {
    entry: record.outside,
    code: record.outside.code,
    cornerId: record.cornerId,
    role: 'outside',
    target: record.outsideTarget,
    minimum: record.outsideCorridorMinimum ?? Math.min(record.insideTarget, record.outsideTarget),
    maximum: record.outsideCorridorMaximum ?? Math.max(record.insideTarget, record.outsideTarget)
  });
}

function threeWideFeasible(
  track: Track,
  entries: readonly ActiveEntry[],
  corner: LegacyCorner
): boolean {
  if (entries.length !== 3 || usableHalfWidth(track) * 2 < ROOM_SEP * 2 + 0.8) return false;
  for (let first = 0; first < entries.length; first++)
    for (let second = first + 1; second < entries.length; second++)
      if (!longitudinalBodiesOverlap(track, entries[first]!, entries[second]!)) return false;
  const ordered = [...entries].sort(
    (first, second) => corner.side * first.latNow - corner.side * second.latNow
  );
  return ordered.every((entry, index) => index === 0 ||
    corner.side * (entry.latNow - ordered[index - 1]!.latNow) >= THREE_WIDE_ENTRY_SEPARATION);
}

function assignThreeWide(
  track: Track,
  entries: readonly ActiveEntry[],
  records: readonly CornerRightsRecord[],
  corner: LegacyCorner,
  assignments: Map<string, CornerCorridorAssignment>
): void {
  const side = corner.side;
  const usable = usableHalfWidth(track);
  const ordered = [...entries].sort((first, second) =>
    side * first.latNow - side * second.latNow
  );
  const centre = clamp(
    ordered.reduce((sum, entry) => sum + side * entry.latNow, 0) / ordered.length,
    -usable + ROOM_SEP,
    usable - ROOM_SEP
  );
  const targetsQ = [centre - ROOM_SEP, centre, centre + ROOM_SEP];
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]!;
    const target = side * targetsQ[index]!;
    const role = index === 0 ? 'outside' : index === ordered.length - 1 ? 'inside' : 'middle';
    const bounds = role === 'outside'
      ? boundsFromCornerCoordinates(side, -usable, targetsQ[index]!)
      : role === 'inside'
        ? boundsFromCornerCoordinates(side, targetsQ[index]!, usable)
        : { minimum: target, maximum: target };
    assignments.set(entry.code, {
      entry,
      code: entry.code,
      cornerId: corner.id,
      role,
      target,
      minimum: bounds.minimum,
      maximum: bounds.maximum
    });
  }
  for (const record of records) {
    const inside = assignments.get(record.inside.code);
    const outside = assignments.get(record.outside.code);
    if (inside) record.insideTarget = inside.target;
    if (outside) record.outsideTarget = outside.target;
  }
}

function enforceTurnInTucks(
  session: Session,
  entries: readonly ActiveEntry[],
  records: ReadonlyMap<string, CornerRightsRecord>
): void {
  const track = session.trk;
  for (const attacker of entries) {
    if (attacker.state !== 'run' || attacker.atkT <= 0 || attacker.atkCorner < 0) continue;
    const corner = cornerByApex(track, attacker.atkCorner);
    if (!corner || !idxInWindow(track, Math.max(0, attacker.car.progIdx),
      corner.turnInI, corner.apexI)) continue;
    const protectedPair = [...records.values()].some(record =>
      record.cornerId === corner.id && (record.inside === attacker || record.outside === attacker));
    if (protectedPair) continue;
    const leader = nearestAhead(track, attacker, entries);
    if (!leader || longitudinalBodiesOverlap(track, attacker, leader)) continue;
    attacker.atkT = 0;
    attacker.atkCorner = -1;
    attacker.atkCd = Math.max(attacker.atkCd, 1.5);
    attacker.tuckT = Math.max(attacker.tuckT, 0.8);
    attacker._tuckWith = leader.code;
    attacker._tuckCorner = corner.apexI;
    session.tuckFailN = (session.tuckFailN || 0) + 1;
  }
}

function nearestAhead(
  track: Track,
  entry: ActiveEntry,
  entries: readonly ActiveEntry[]
): ActiveEntry | null {
  let result: ActiveEntry | null = null;
  let best = 40;
  for (const candidate of entries) {
    if (candidate === entry || candidate.state !== 'run') continue;
    const distance = signedTrackDistance(track, entry.car.s, candidate.car.s);
    if (distance > 0 && distance < best) {
      best = distance;
      result = candidate;
    }
  }
  return result;
}

function inAcquisitionWindow(track: Track, index: number, corner: LegacyCorner): boolean {
  return idxInWindow(track, index, corner.approachI, corner.turnInI);
}

function acquisitionCorner(track: Track, index: number): LegacyCorner | null {
  let best: LegacyCorner | null = null;
  let distance = Infinity;
  for (const corner of track.corners || []) {
    if (!inAcquisitionWindow(track, index, corner)) continue;
    const toApex = idxAheadM(track, index, corner.apexI);
    if (toApex < distance) {
      distance = toApex;
      best = corner;
    }
  }
  return best || nextCorner(track, index);
}

function phaseAt(
  track: Track,
  index: number,
  corner: LegacyCorner
): CornerRightsRecord['acquiredPhase'] {
  if (idxInWindow(track, index, corner.approachI, corner.brakeI)) return 'approach';
  if (idxInWindow(track, index, corner.brakeI, corner.turnInI)) return 'brake';
  return 'turn-in';
}

function laterPhase(
  first: CornerRightsRecord['acquiredPhase'],
  second: CornerRightsRecord['acquiredPhase']
): CornerRightsRecord['acquiredPhase'] {
  const order: CornerRightsRecord['acquiredPhase'][] = ['approach', 'brake', 'turn-in'];
  return order[Math.max(order.indexOf(first), order.indexOf(second))]!;
}

function isPast(track: Track, marker: number, index: number): boolean {
  const distance = idxAheadM(track, marker, Math.max(0, index));
  return distance < track.len / 2;
}

function bothPast(track: Track, marker: number, first: Entry, second: Entry): boolean {
  return !!first.car && !!second.car &&
    isPast(track, marker, first.car.progIdx) && isPast(track, marker, second.car.progIdx);
}

function nextLinkedCorner(track: Track, corner: LegacyCorner): LegacyCorner | null {
  if (!corner.complexId) return null;
  let result: LegacyCorner | null = null;
  let best = Infinity;
  for (const candidate of track.corners || []) {
    if (candidate.id === corner.id || candidate.complexId !== corner.complexId) continue;
    const distance = idxAheadM(track, corner.trackOutI, candidate.turnInI);
    if (distance > 0.5 && distance < best && distance < track.len / 2) {
      best = distance;
      result = candidate;
    }
  }
  return result;
}

function handoffRecord(
  session: Session,
  record: CornerRightsRecord,
  current: LegacyCorner,
  next: LegacyCorner
): void {
  if (current.side !== next.side) {
    const previousInside = record.inside;
    record.inside = record.outside;
    record.outside = previousInside;
    record.insideCode = record.inside.code;
    record.outsideCode = record.outside.code;
  }
  record.cornerId = next.id;
  record.complexId = next.complexId;
  applyPairCorridor(record, solvePairCorridor(session.trk, next, record.inside, record.outside));
  record.clearFor = 0;
  record.handoffs = (record.handoffs || 0) + 1;
  session.cornerRightsHandoffs = (session.cornerRightsHandoffs || 0) + 1;
}

function release(
  session: Session,
  records: Map<string, CornerRightsRecord>,
  history: CornerRightsHistory[],
  record: CornerRightsRecord,
  reason: string
): void {
  if (!records.delete(record.key)) return;
  if (reason === 'track-out-clear') {
    for (const entry of [record.inside, record.outside]) {
      entry.atkT = 0;
      entry.atkCorner = -1;
      entry.atkCd = Math.max(entry.atkCd, 1);
      entry.defT = 0;
      entry.defCorner = -1;
      entry.tuckT = Math.max(entry.tuckT, 0.8);
      entry._tuckWith = 'corner-rights';
      entry._tuckCorner = -1;
    }
  }
  history.push({
    key: record.key,
    cornerId: record.cornerId,
    acquiredAt: record.acquiredAt,
    releasedAt: session.t,
    release: reason,
    ...(record.minimumSeparation != null ? { minimumSeparation: record.minimumSeparation } : {}),
    ...(record.violationCount != null ? { violations: record.violationCount } : {}),
    ...(record.handoffs != null ? { handoffs: record.handoffs } : {})
  });
  session.cornerRightsReleases = (session.cornerRightsReleases || 0) + 1;
  if (history.length > 200) history.shift();
}
