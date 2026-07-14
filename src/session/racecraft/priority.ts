import { PHYS } from '../../core/physics';
import { nextCorner } from '../../core/racing-line';
import type { Car, Track } from '../../core/model';
import { normAng } from '../../shared/math';
import { TRAF_DT } from '../strategy';
import type {
  Entry, PriorityReason, PriorityRecord, QualifyingLapPhase, Session
} from '../model';
import { idxInWindow } from './corner-rights';
import { followCap, setTargetAbsLat } from './paths';

type ActiveEntry = Entry & { car: Car };

const BLUE_OUTER = 120;
const BLUE_HARD = 55;
const BLUE_TTC = 4;
const QUALIFYING_OUTER = 180;
const QUALIFYING_HARD = 75;
const QUALIFYING_TTC = 5;
const CLOSING_MINIMUM = 0.5;
const OPENING_HARD_LIMIT = -1;
const CLEARANCE = 2;
const CLEAR_TIME = 0.5;
const CLOSING_FILTER_TIME = 1;
const LATE_GAP = 10;
const LATE_TIME_TO_CATCH = 0.75;
const LATERAL_ORDER_EPSILON = 0.25;
const YIELD_EDGE_MARGIN = PHYS.carWid / 2 + 0.6;
const PATH_CROSSING_WINDOW = 18;
const FOLLOW_BRAKE_HORIZON = 2.6;

function isRacingSurface(track: Track, entry: Entry): entry is ActiveEntry {
  return !!entry.car && entry.state === 'run' && !entry.car.offCourse &&
    Math.abs(entry.latNow) <= track.hw + 0.3;
}

export function qualifyingLapPhase(entry: Entry): QualifyingLapPhase | null {
  if (entry.boxArm || entry.pitArm || entry.state === 'pitIn' || entry.state === 'pit')
    return 'in';
  if (entry.lapPhase) return entry.lapPhase;
  return entry.lapLive ? 'flying' : 'out';
}

function recordKey(yielding: Entry, beneficiary: Entry): string {
  return `${yielding.code}>${beneficiary.code}`;
}

function bumperGap(track: Track, beneficiary: ActiveEntry, yielding: ActiveEntry): number {
  const centreGap = (yielding.car.s - beneficiary.car.s + track.len) % track.len;
  return Math.max(0, centreGap - PHYS.carLen);
}

function priorityReason(
  session: Session,
  beneficiary: ActiveEntry,
  yielding: ActiveEntry
): PriorityReason | null {
  if (session.mode === 'race')
    return beneficiary.cross - yielding.cross >= 1 ? 'blue-flag' : null;
  const beneficiaryPhase = qualifyingLapPhase(beneficiary);
  const yieldingPhase = qualifyingLapPhase(yielding);
  if (beneficiaryPhase !== 'flying' || yieldingPhase === 'flying') return null;
  return yieldingPhase === 'out' || yieldingPhase === 'in' ? 'qualifying' : null;
}

function detectionGate(
  session: Session,
  reason: PriorityReason,
  gap: number,
  closing: number
): boolean {
  const wetScale = 1 + 0.25 * session.wet;
  const outer = (reason === 'blue-flag' ? BLUE_OUTER : QUALIFYING_OUTER) * wetScale;
  const hard = (reason === 'blue-flag' ? BLUE_HARD : QUALIFYING_HARD) * wetScale;
  const catchTime = (reason === 'blue-flag' ? BLUE_TTC : QUALIFYING_TTC) * wetScale;
  const timeToCatch = gap / Math.max(CLOSING_MINIMUM, closing);
  return gap <= outer &&
    ((closing >= CLOSING_MINIMUM && timeToCatch <= catchTime) ||
      (gap <= hard && closing >= OPENING_HARD_LIMIT));
}

function hasActiveRights(session: Session, entry: Entry): boolean {
  for (const record of session.cornerRights?.values() ?? [])
    if (record.inside === entry || record.outside === entry) return true;
  return false;
}

function detectedPhase(
  session: Session,
  yielding: ActiveEntry
): Pick<PriorityRecord, 'detectedPhase' | 'holdUntilI'> {
  const distanceToPit =
    (session.trk.pit.sEntry - yielding.car.s + session.trk.len) % session.trk.len;
  if ((yielding.pitArm || yielding.boxArm) && distanceToPit < 180)
    return { detectedPhase: 'pit-entry', holdUntilI: null };
  const index = Math.max(0, yielding.car.progIdx);
  let activeCorner: (typeof session.trk.corners)[number] | null = null;
  let activeDistance = Infinity;
  for (const corner of session.trk.corners) {
    if (!idxInWindow(session.trk, index, corner.turnInI, corner.trackOutI)) continue;
    const distance = ((corner.trackOutI - index + session.trk.n) % session.trk.n) *
      session.trk.step;
    if (distance < activeDistance) {
      activeDistance = distance;
      activeCorner = corner;
    }
  }
  if (activeCorner)
    return { detectedPhase: 'corner', holdUntilI: activeCorner.trackOutI };
  let approachCorner: (typeof session.trk.corners)[number] | null = null;
  let approachDistance = Infinity;
  for (const corner of session.trk.corners) {
    if (!idxInWindow(session.trk, index, corner.approachI, corner.turnInI)) continue;
    const distance = ((corner.turnInI - index + session.trk.n) % session.trk.n) *
      session.trk.step;
    if (distance < approachDistance) {
      approachDistance = distance;
      approachCorner = corner;
    }
  }
  if (approachCorner)
    return { detectedPhase: 'approach', holdUntilI: approachCorner.trackOutI };
  return { detectedPhase: 'straight', holdUntilI: null };
}

function chooseYieldSide(
  session: Session,
  yielding: ActiveEntry,
  beneficiary: ActiveEntry,
  phase: Pick<PriorityRecord, 'detectedPhase' | 'holdUntilI'>
): number {
  const track = session.trk;
  const limit = track.hw - YIELD_EDGE_MARGIN;
  if (phase.detectedPhase === 'pit-entry') return limit;
  const index = Math.max(0, yielding.car.progIdx) % track.n;
  const ideal = track.idealPath.off[index]!;
  if (Math.abs(yielding.latNow) > Math.abs(ideal) + 1)
    return yielding.latNow < 0 ? -limit : limit;
  const corner = phase.holdUntilI == null
    ? nextCorner(track, index)
    : track.corners.find(candidate => candidate.trackOutI === phase.holdUntilI) ?? null;
  if (corner && phase.detectedPhase === 'approach') return -corner.side * limit;
  if (corner && phase.detectedPhase === 'corner') {
    // Once committed, never ask the yielding car to cross the approaching
    // car's present corridor. Hold through the apex, then clear away from it.
    const lateralOrder = beneficiary.latNow - yielding.latNow;
    if (Math.abs(lateralOrder) >= LATERAL_ORDER_EPSILON)
      return lateralOrder < 0 ? limit : -limit;
    return corner.side * limit;
  }
  return ideal >= 0 ? -limit : limit;
}

function lateralHalfExtent(track: Track, entry: ActiveEntry): number {
  const index = Math.max(0, entry.car.progIdx) % track.n;
  const roadHeading = Math.atan2(track.ty[index]!, track.tx[index]!);
  const yaw = normAng(entry.car.h - roadHeading);
  return Math.abs(Math.sin(yaw)) * PHYS.carLen / 2 +
    Math.abs(Math.cos(yaw)) * PHYS.carWid / 2;
}

function lateralEnvelopesSeparate(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): boolean {
  return Math.abs(first.latNow - second.latNow) >=
    lateralHalfExtent(track, first) + lateralHalfExtent(track, second) + 0.2;
}

function releaseRecord(session: Session, record: PriorityRecord, release: string): void {
  session.priorityRecords?.delete(record.key);
  const history = session.priorityHistory ?? (session.priorityHistory = []);
  if (history.length >= 200) history.shift();
  history.push({
    key: record.key,
    reason: record.reason,
    release,
    duration: Math.max(0, session.t - record.acquiredAt),
    maximumGap: record.maximumGap,
    minimumGap: record.minimumGap,
    detectedPhase: record.detectedPhase,
    obstructionTime: record.obstructionTime,
    pathCrossings: record.pathCrossings
  });
  if (record.yielding.priorityYield?.beneficiary === record.beneficiary.code) {
    const queued = [...(session.priorityRecords?.values() ?? [])]
      .some(candidate => candidate.yielding === record.yielding);
    if (!queued) {
      delete record.yielding.priorityYield;
      record.yielding.yieldT = 0;
    }
  }
}

function updateExistingRecord(session: Session, record: PriorityRecord): boolean {
  if (!isRacingSurface(session.trk, record.beneficiary) ||
      !isRacingSurface(session.trk, record.yielding)) {
    releaseRecord(session, record, 'inactive');
    return false;
  }
  const gap = bumperGap(session.trk, record.beneficiary, record.yielding);
  const observed = Math.abs(record.lastGap - gap) > 250
    ? record.beneficiary.spd - record.yielding.spd
    : (record.lastGap - gap) / TRAF_DT;
  const alpha = 1 - Math.exp(-TRAF_DT / 1);
  record.closingAge += TRAF_DT;
  if (record.closingAge < CLOSING_FILTER_TIME)
    record.filteredClosing = record.beneficiary.spd - record.yielding.spd;
  else record.filteredClosing += (observed - record.filteredClosing) * alpha;
  record.timeToCatch = gap / Math.max(CLOSING_MINIMUM, record.filteredClosing);
  record.lastGap = gap;
  record.lastSeenAt = session.t;
  const centreAhead = (record.beneficiary.car.s - record.yielding.car.s + session.trk.len) %
    session.trk.len;
  const beneficiaryBehind = centreAhead >= session.trk.len / 2;
  if (beneficiaryBehind) {
    const forwardToYielding = session.trk.len - centreAhead;
    record.minimumGap = Math.min(record.minimumGap, gap);
    record.maximumGap = Math.max(record.maximumGap, gap);
    if (!lateralEnvelopesSeparate(session.trk, record.beneficiary, record.yielding)) {
      record.obstructionTime += TRAF_DT;
      session.priorityObstructionTime = (session.priorityObstructionTime || 0) + TRAF_DT;
    }
    if (forwardToYielding <= PATH_CROSSING_WINDOW) {
      const lateralDifference = record.beneficiary.latNow - record.yielding.latNow;
      const lateralOrder = Math.abs(lateralDifference) >= LATERAL_ORDER_EPSILON
        ? Math.sign(lateralDifference)
        : 0;
      if (record.lastLateralOrder && lateralOrder &&
          lateralOrder !== record.lastLateralOrder) {
        record.pathCrossings++;
        session.priorityPathCrossings = (session.priorityPathCrossings || 0) + 1;
      }
      if (lateralOrder) record.lastLateralOrder = lateralOrder;
    }
  }
  const physicallyClear = centreAhead < session.trk.len / 2 &&
    centreAhead - PHYS.carLen >= CLEARANCE;
  record.clearFor = physicallyClear ? record.clearFor + TRAF_DT : 0;
  if (record.clearFor + 1e-9 >= CLEAR_TIME) {
    releaseRecord(session, record, 'physical-clearance');
    return false;
  }
  if (record.holdUntilI != null) {
    const past = ((record.yielding.car.progIdx - record.holdUntilI + session.trk.n) %
      session.trk.n) * session.trk.step;
    if (past > 0 && past < session.trk.len / 2) record.holdUntilI = null;
  }
  return true;
}

/**
 * Detect every eligible beneficiary independently from normal one/two-ahead
 * traffic references, then maintain the records until physical clearance.
 */
export function updatePriorityRecords(session: Session, entries: readonly ActiveEntry[]): void {
  const records = session.priorityRecords ?? (session.priorityRecords = new Map());
  for (const record of [...records.values()]) updateExistingRecord(session, record);

  for (const yielding of entries) {
    if (!isRacingSurface(session.trk, yielding)) continue;
    for (const beneficiary of entries) {
      if (beneficiary === yielding || !isRacingSurface(session.trk, beneficiary)) continue;
      const reason = priorityReason(session, beneficiary, yielding);
      if (!reason) continue;
      const key = recordKey(yielding, beneficiary);
      if (records.has(key)) continue;
      const gap = bumperGap(session.trk, beneficiary, yielding);
      const closing = beneficiary.spd - yielding.spd;
      if (!detectionGate(session, reason, gap, closing)) continue;
      const phase = detectedPhase(session, yielding);
      const queued = [...records.values()]
        .filter(candidate => candidate.yielding === yielding)
        .sort((left, right) => left.acquiredAt - right.acquiredAt ||
          left.lastGap - right.lastGap ||
          left.beneficiary.code.localeCompare(right.beneficiary.code));
      const active = yielding.priorityYield
        ? queued.find(candidate =>
            candidate.beneficiary.code === yielding.priorityYield?.beneficiary)
        : null;
      const yieldSide = (active ?? queued[0])?.yieldSide ??
        chooseYieldSide(session, yielding, beneficiary, phase);
      const timeToCatch = gap / Math.max(CLOSING_MINIMUM, closing);
      records.set(key, {
        key,
        reason,
        beneficiary,
        yielding,
        acquiredAt: session.t,
        lastSeenAt: session.t,
        lastGap: gap,
        filteredClosing: closing,
        closingAge: 0,
        timeToCatch,
        yieldSide,
        detectedPhase: phase.detectedPhase,
        holdUntilI: phase.holdUntilI,
        clearFor: 0,
        minimumGap: gap,
        maximumGap: gap,
        obstructionTime: 0,
        pathCrossings: 0,
        lastLateralOrder: 0,
        suppressionApplied: false,
        illegalDecisionActive: false
      });
      session.priorityActivations = (session.priorityActivations ?? 0) + 1;
      if (reason === 'blue-flag')
        session.blueFlagActivations = (session.blueFlagActivations ?? 0) + 1;
      else
        session.qualifyingPriorityActivations =
          (session.qualifyingPriorityActivations ?? 0) + 1;
      if (gap <= LATE_GAP || timeToCatch <= LATE_TIME_TO_CATCH)
        session.priorityLateDetections = (session.priorityLateDetections ?? 0) + 1;
      const queueLength = queued.length + 1;
      session.priorityMaximumQueue = Math.max(session.priorityMaximumQueue ?? 0, queueLength);
    }
  }
}

function suppressBattle(entry: Entry): void {
  entry.atkT = 0;
  entry.atkCd = Math.max(entry.atkCd, 1);
  entry.atkCorner = -1;
  entry.defT = 0;
  entry.defCorner = -1;
  entry.lungeT = 0;
  entry.tow = 0;
  entry.battle = false;
}

/** Apply one stable yield choice per car; additional records remain queued. */
export function applyPriorityRecords(session: Session): void {
  const records = session.priorityRecords;
  if (!records?.size) {
    for (const entry of session.entries) {
      if (entry.priorityYield) delete entry.priorityYield;
      entry.yieldT = 0;
    }
    return;
  }
  const byYielding = new Map<Entry, PriorityRecord[]>();
  for (const record of records.values()) {
    const queue = byYielding.get(record.yielding) ?? [];
    queue.push(record);
    byYielding.set(record.yielding, queue);
  }
  for (const [yielding, queue] of byYielding) {
    if (!isRacingSurface(session.trk, yielding)) continue;
    queue.sort((left, right) => left.acquiredAt - right.acquiredAt ||
      left.lastGap - right.lastGap || left.beneficiary.code.localeCompare(right.beneficiary.code));
    const previous = yielding.priorityYield?.beneficiary;
    const record = queue.find(candidate => candidate.beneficiary.code === previous) ?? queue[0]!;
    if (previous && previous !== record.beneficiary.code)
      session.priorityHandoffs = (session.priorityHandoffs ?? 0) + 1;
    yielding.priorityYield = { reason: record.reason, beneficiary: record.beneficiary.code };
    yielding.yieldT = Math.max(yielding.yieldT, TRAF_DT * 2);
    const illegalDecision = record.suppressionApplied &&
      (yielding.atkT > 0 || yielding.defT > 0 || yielding.lungeT > 0);
    if (illegalDecision && !record.illegalDecisionActive)
      session.priorityIllegalDecisions = (session.priorityIllegalDecisions ?? 0) + 1;
    for (const queuedRecord of queue) {
      queuedRecord.suppressionApplied = true;
      queuedRecord.illegalDecisionActive = illegalDecision;
    }
    suppressBattle(yielding);
    const yieldingHasRights = hasActiveRights(session, yielding);
    if (!yieldingHasRights) {
      yielding.pathMode = record.reason === 'blue-flag' ? 'blue-yield' : 'qualifying-yield';
      if (record.lastGap < 55)
        yielding.vCap = Math.min(yielding.vCap, Math.max(12, yielding.spd - 1.5));
    }
    const beneficiary = record.beneficiary;
    suppressBattle(beneficiary);
    const beneficiaryHasRights = hasActiveRights(session, beneficiary);
    if (isRacingSurface(session.trk, beneficiary) && !beneficiaryHasRights)
      beneficiary.pathMode = 'priority-pass';
    if (isRacingSurface(session.trk, beneficiary)) {
      const forwardToYielding =
        (yielding.car.s - beneficiary.car.s + session.trk.len) % session.trk.len;
      const beneficiaryBehind = forwardToYielding < session.trk.len / 2;
      const bumperDistance = Math.max(0, forwardToYielding - PHYS.carLen);
      const closing = Math.max(0.5, beneficiary.spd - yielding.spd);
      const timeToContact = bumperDistance / closing;
      if (beneficiaryBehind && forwardToYielding < 100 &&
          timeToContact <= FOLLOW_BRAKE_HORIZON &&
          !lateralEnvelopesSeparate(session.trk, beneficiary, yielding))
        beneficiary.vCap = Math.min(
          beneficiary.vCap,
          followCap(session, beneficiary, yielding, forwardToYielding, 0.15, 2.2, 10.5)
        );
    }
  }
}

export function isPriorityYielding(session: Session, entry: Entry): boolean {
  for (const record of session.priorityRecords?.values() ?? [])
    if (record.yielding === entry) return true;
  return false;
}

export function hasPriorityRelation(session: Session, first: Entry, second: Entry): boolean {
  for (const record of session.priorityRecords?.values() ?? [])
    if ((record.yielding === first && record.beneficiary === second) ||
        (record.yielding === second && record.beneficiary === first)) return true;
  return false;
}

/** Non-preference safety for qualifying pairs not covered by a priority record. */
export function applyQualifyingTrafficSafety(
  session: Session,
  track: Track,
  follower: ActiveEntry,
  leader: ActiveEntry,
  distance: number,
  lateralSeparation: number
): boolean {
  if (session.mode !== 'quali') return false;
  if (distance < 22) {
    if (distance < 15)
      setTargetAbsLat(track, follower, leader.latNow >= 0 ? -2.6 : 2.6);
    if (distance < 12 && lateralSeparation < 2.4)
      follower.vCap = followCap(session, follower, leader, distance, 0.35);
  } else {
    follower.latTgt *= 0.9;
  }
  return true;
}
