import { PHYS } from '../core/physics';
import { clamp, lerp } from '../shared/math';
import { random } from '../shared/rng';
import { emitToast } from './events';
import { minRel } from './strategy';
import type {
  Entry, PartKey, PitPhase, PitReservation, PitReservationKind, PitWaitReason,
  RaceSession, Session
} from './model';

const PIT_SWEEP_HORIZON = 0.85;
const PIT_HALF_LENGTH = PHYS.carLen / 2;
const PIT_HALF_WIDTH = PHYS.carWid / 2;
const RESERVATION_TTL = 2;
const BOX_GAP = 10;
const DEADLOCK_SECONDS = 4;
const QUEUE_OUTBOARD = 3.0;
const PIT_EGRESS_DISTANCE = 14;

export interface PitOccupancy {
  phase: PitPhase;
  longitudinal: number;
  lateral: number;
  halfLength: number;
  halfWidth: number;
  sweptMinimumW: number;
  sweptMaximumW: number;
  sweptMinimumLateral: number;
  sweptMaximumLateral: number;
  crossing: boolean;
  stationary: boolean;
}

export interface PitMotionPlan {
  phase: PitPhase;
  lateral: number;
  speedCap: number;
  stopW: number | null;
  queued: boolean;
}

export interface PitReservationDecision {
  granted: boolean;
  reason: PitWaitReason | null;
  owner: Entry | null;
}

export function pitLongitudinal(entry: Entry, session: Session): number | null {
  if (!entry.car) return null;
  return entry.pitW != null && Number.isFinite(entry.pitW)
    ? entry.pitW
    : session.trk.pit.wOf(entry.car.s);
}

export function pitLateral(entry: Entry, session: Session): number | null {
  const longitudinal = pitLongitudinal(entry, session);
  if (longitudinal == null) return null;
  if (entry.state === 'pit') return session.trk.pit.boxOff;
  return Number.isFinite(entry.latNow) ? entry.latNow : session.trk.pit.off(longitudinal);
}

export function pitPhaseOf(entry: Entry): PitPhase {
  if (entry.pitPhase) return entry.pitPhase;
  if (entry.state === 'pit') return 'stopped-box';
  if (entry.state === 'pitOut') return 'egress';
  return 'travel';
}

function smootherstep(value: number): number {
  const u = clamp(value, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function futurePitLateral(entry: Entry, session: Session, longitudinal: number, futureW: number): number {
  const pit = session.trk.pit;
  const phase = pitPhaseOf(entry);
  if (phase === 'stopped-box') return pit.boxOff;
  if (phase === 'queued') return entry.pitQueueOff ?? pit.boxOff + QUEUE_OUTBOARD;
  if (phase === 'ingress') {
    if (entry.pitQueueW != null && entry.pitQueueOff != null)
      return entry.pitQueueOff;
    return pit.boxOff;
  }
  if (phase === 'egress') {
    const boxW = pit.boxWAt(entry.ti);
    return lerp(
      pit.boxOff,
      pit.off(futureW),
      smootherstep((futureW - boxW) / PIT_EGRESS_DISTANCE)
    );
  }
  return pit.off(Math.max(longitudinal, futureW));
}

export function pitOccupancy(
  entry: Entry,
  session: Session,
  horizon = PIT_SWEEP_HORIZON
): PitOccupancy | null {
  const longitudinal = pitLongitudinal(entry, session);
  const lateral = pitLateral(entry, session);
  if (longitudinal == null || lateral == null) return null;
  const phase = pitPhaseOf(entry);
  const stationary = phase === 'stopped-box' || phase === 'queued' || entry.spd < 0.25;
  const futureW = stationary ? longitudinal : longitudinal + Math.max(0, entry.spd) * horizon;
  const futureLateral = futurePitLateral(entry, session, longitudinal, futureW);
  return {
    phase,
    longitudinal,
    lateral,
    halfLength: PIT_HALF_LENGTH,
    halfWidth: PIT_HALF_WIDTH,
    sweptMinimumW: Math.min(longitudinal, futureW) - PIT_HALF_LENGTH,
    sweptMaximumW: Math.max(longitudinal, futureW) + PIT_HALF_LENGTH,
    sweptMinimumLateral: Math.min(lateral, futureLateral) - PIT_HALF_WIDTH,
    sweptMaximumLateral: Math.max(lateral, futureLateral) + PIT_HALF_WIDTH,
    crossing: phase === 'ingress' || phase === 'egress',
    stationary
  };
}

export function occupiesPitTravelLane(entry: Entry, session: Session): boolean {
  const occupancy = pitOccupancy(entry, session);
  if (!occupancy) return false;
  const pit = session.trk.pit;
  const travelA = pit.off(occupancy.sweptMinimumW + occupancy.halfLength);
  const travelB = pit.off(occupancy.sweptMaximumW - occupancy.halfLength);
  const travelMinimum = Math.min(travelA, travelB) - 1.15;
  const travelMaximum = Math.max(travelA, travelB) + 1.15;
  // Include a modest suspension/steering envelope. A car centred in its box
  // is 3.2 m from the lane and therefore does not become a false leader.
  return occupancy.sweptMaximumLateral >= travelMinimum &&
    occupancy.sweptMinimumLateral <= travelMaximum;
}

export function pitSweptOccupanciesOverlap(first: PitOccupancy, second: PitOccupancy): boolean {
  return first.sweptMaximumW >= second.sweptMinimumW &&
    second.sweptMaximumW >= first.sweptMinimumW &&
    first.sweptMaximumLateral >= second.sweptMinimumLateral &&
    second.sweptMaximumLateral >= first.sweptMinimumLateral;
}

export function pitTrafficReference(
  traveller: Entry,
  session: Session
): { entry: Entry; distance: number; reason: PitWaitReason } | null {
  const phase = pitPhaseOf(traveller);
  const reservationKey = traveller.pitReservationKey;
  const reservation = reservationKey
    ? session.pitReservations?.get(reservationKey)
    : null;
  // Granting a crossing reservation transfers right of way to its owner.
  // Continuing to apply the generic lane follower to that same car can stop
  // it inside the crossing while every other car waits for its reservation.
  // Through-lane cars still see the owner below when they query for traffic.
  if ((phase === 'ingress' || phase === 'egress') && reservation?.owner === traveller)
    return null;
  const own = pitOccupancy(traveller, session);
  if (!own) return null;
  let result: { entry: Entry; distance: number; reason: PitWaitReason } | null = null;
  for (const other of session.entries) {
    if (other === traveller || !other.car) continue;
    if (other.state !== 'pitIn' && other.state !== 'pit' && other.state !== 'pitOut') continue;
    const occupancy = pitOccupancy(other, session);
    if (!occupancy || !occupiesPitTravelLane(other, session)) continue;
    const distance = occupancy.longitudinal - own.longitudinal;
    if (distance <= 0.2 || distance >= 45) continue;
    const lateralOverlap = own.sweptMaximumLateral >= occupancy.sweptMinimumLateral &&
      occupancy.sweptMaximumLateral >= own.sweptMinimumLateral;
    if (!lateralOverlap) continue;
    if (!result || distance < result.distance) {
      result = {
        entry: other,
        distance,
        reason: occupancy.crossing ? 'physical-crossing' : 'lane-conflict'
      };
    }
  }
  return result;
}

function reservationRangesOverlap(first: PitReservation, second: PitReservation): boolean {
  return first.maximumW >= second.minimumW && second.maximumW >= first.minimumW;
}

export function releasePitReservation(entry: Entry, session: Session): void {
  const key = entry.pitReservationKey;
  if (key) session.pitReservations?.delete(key);
  delete entry.pitReservationKey;
}

export function prunePitReservations(session: Session): void {
  const reservations = session.pitReservations;
  if (!reservations) return;
  for (const [key, reservation] of reservations) {
    const occupancy = pitOccupancy(reservation.owner, session, 0.25);
    const physicallyCrossing = !!occupancy && occupancy.crossing &&
      occupiesPitTravelLane(reservation.owner, session);
    const active = reservation.owner.car &&
      (reservation.owner.state === 'pitIn' || reservation.owner.state === 'pitOut' ||
        reservation.owner.state === 'pit');
    if (active && (reservation.expiresAt > session.t || physicallyCrossing)) {
      if (physicallyCrossing && reservation.expiresAt <= session.t)
        reservation.expiresAt = session.t + 0.25;
      continue;
    }
    reservations.delete(key);
    if (reservation.owner.pitReservationKey === key)
      delete reservation.owner.pitReservationKey;
  }
}

function approachingTravelLaneCar(entry: Entry, session: Session, crossingW: number): Entry | null {
  let closest: Entry | null = null;
  let closestMetric = Infinity;
  for (const other of session.entries) {
    if (other === entry || !other.car || other.spd < 0.5) continue;
    if (other.state !== 'pitIn' && other.state !== 'pitOut') continue;
    if (!occupiesPitTravelLane(other, session)) continue;
    const longitudinal = pitLongitudinal(other, session);
    if (longitudinal == null) continue;
    const fromBehind = crossingW - longitudinal;
    const justAhead = longitudinal - crossingW;
    const eta = fromBehind >= 0 ? fromBehind / Math.max(2, other.spd) : Infinity;
    const conflict = (fromBehind >= 0 && fromBehind <= 28 && eta <= 2.4) ||
      (justAhead > 0 && justAhead <= 9);
    const metric = fromBehind >= 0 ? fromBehind : 28 + justAhead;
    if (conflict && metric < closestMetric) {
      closestMetric = metric;
      closest = other;
    }
  }
  return closest;
}

export function claimPitReservation(
  entry: Entry,
  session: Session,
  kind: PitReservationKind,
  crossingW: number
): PitReservationDecision {
  prunePitReservations(session);
  const reservations = session.pitReservations ?? (session.pitReservations = new Map());
  const ownKey = `${kind}:${entry.code}`;
  const current = reservations.get(ownKey);
  if (current) {
    current.expiresAt = session.t + RESERVATION_TTL;
    entry.pitReservationKey = ownKey;
    return { granted: true, reason: null, owner: null };
  }
  const candidate: PitReservation = {
    key: ownKey,
    kind,
    owner: entry,
    ownerCode: entry.code,
    crossingW,
    minimumW: crossingW - 7,
    maximumW: crossingW + (kind === 'egress' ? PIT_EGRESS_DISTANCE + 1 : 8),
    acquiredAt: session.t,
    expiresAt: session.t + RESERVATION_TTL
  };
  for (const reservation of reservations.values()) {
    if (reservation.owner === entry || !reservationRangesOverlap(candidate, reservation)) continue;
    // An arriving through-lane car may revoke a release that has not begun.
    // Once the other car physically occupies the crossing, geometry wins.
    const physical = pitOccupancy(reservation.owner, session, 0.25);
    const physicalCrossing = !!physical && physical.crossing &&
      occupiesPitTravelLane(reservation.owner, session);
    if (kind === 'ingress' && reservation.kind === 'egress' && !physicalCrossing &&
        reservation.owner.state === 'pit') {
      reservations.delete(reservation.key);
      if (reservation.owner.pitReservationKey === reservation.key)
        delete reservation.owner.pitReservationKey;
      continue;
    }
    return {
      granted: false,
      reason: reservation.kind === 'ingress' ? 'ingress-reservation' : 'egress-reservation',
      owner: reservation.owner
    };
  }
  const laneCar = approachingTravelLaneCar(entry, session, crossingW);
  if (laneCar) return { granted: false, reason: 'travel-lane', owner: laneCar };
  reservations.set(ownKey, candidate);
  entry.pitReservationKey = ownKey;
  return { granted: true, reason: null, owner: null };
}

export function pitBoxOccupant(entry: Entry, session: Session): Entry | null {
  const boxW = session.trk.pit.boxWAt(entry.ti);
  for (const other of session.entries) {
    if (other === entry || !other.car || other.ti !== entry.ti || other.state !== 'pit') continue;
    const otherW = pitLongitudinal(other, session);
    if (otherW != null && Math.abs(otherW - boxW) <= 2) return other;
  }
  return null;
}

export function pitQueuePoint(entry: Entry, session: Session): { w: number; off: number } {
  const pit = session.trk.pit;
  // The rearward point clears the preceding box longitudinally. The outboard
  // apron offset keeps its envelope separate from the occupied own box while
  // remaining well clear of the travel lane.
  return { w: pit.boxWAt(entry.ti) - BOX_GAP / 4, off: pit.boxOff + QUEUE_OUTBOARD };
}

export function pitIngressStartW(
  entry: Entry,
  session: Session,
  queueing = false
): number {
  const pit = session.trk.pit;
  const boxW = pit.boxWAt(entry.ti);
  if (queueing) {
    // Do not cross the working lane until the preceding stopped-car envelope
    // has passed behind the incoming car.
    return Math.max(pit.rampIn, boxW - BOX_GAP + PIT_HALF_LENGTH + 0.45);
  }
  return boxW - Math.max(3.8, BOX_GAP - PHYS.carLen - 0.4);
}

export function pitEgressEndW(entry: Entry, session: Session): number {
  // The lateral path reaches the travel lane after PIT_EGRESS_DISTANCE, but
  // egress remains the owning phase until the rear of the car has cleared the
  // reserved crossing (including its one-metre longitudinal uncertainty).
  return session.trk.pit.boxWAt(entry.ti) + PIT_EGRESS_DISTANCE + 1 + PIT_HALF_LENGTH;
}

function setPitWait(entry: Entry, reason: PitWaitReason | null, owner: Entry | null): void {
  entry.pitWaitReason = reason;
  entry.pitWaitOwner = owner?.code ?? null;
}

export function requestPitBoxRelease(entry: Entry, session: Session): boolean {
  const boxW = session.trk.pit.boxWAt(entry.ti);
  const decision = claimPitReservation(entry, session, 'egress', boxW);
  setPitWait(entry, decision.reason, decision.owner);
  return decision.granted;
}

export function planPitMotion(entry: Entry, session: Session): PitMotionPlan {
  const pit = session.trk.pit;
  const w = pitLongitudinal(entry, session) ?? 0;
  const boxW = pit.boxWAt(entry.ti);
  if (entry.state === 'pitIn') {
    const occupant = pitBoxOccupant(entry, session);
    const queue = pitQueuePoint(entry, session);
    entry.pitQueueW = occupant ? queue.w : null;
    entry.pitQueueOff = occupant ? queue.off : null;
    if (entry.pitPhase === 'queued' && occupant) {
      setPitWait(entry, 'same-team-queue', occupant);
      return { phase: 'queued', lateral: queue.off, speedCap: 0, stopW: queue.w, queued: true };
    }
    if (entry.pitPhase === 'queued' && !occupant) {
      const decision = claimPitReservation(entry, session, 'ingress', boxW);
      if (!decision.granted) {
        setPitWait(entry, decision.reason, decision.owner);
        return { phase: 'queued', lateral: entry.latNow, speedCap: 0, stopW: w, queued: true };
      }
      setPitWait(entry, null, null);
      const startW = queue.w;
      const u = smootherstep((w - startW) / Math.max(0.5, boxW - startW));
      const lateral = lerp(queue.off, pit.boxOff, u);
      const speedCap = Math.min(2.2, Math.sqrt(2 * 1.8 * Math.max(0, boxW - w - 0.35)));
      return { phase: 'ingress', lateral, speedCap, stopW: boxW, queued: false };
    }
    const ingressStart = pitIngressStartW(entry, session, !!occupant);
    if (w < ingressStart) {
      releasePitReservation(entry, session);
      const distance = ingressStart - w;
      const phase: PitPhase = distance > 18 ? 'travel' : 'decelerate';
      const speedCap = phase === 'travel'
        ? pit.limit
        : Math.min(pit.limit, Math.sqrt(2.6 * 2.6 + 2 * 3.2 * Math.max(0, distance - 0.5)));
      setPitWait(entry, null, null);
      return { phase, lateral: pit.off(w), speedCap, stopW: null, queued: false };
    }
    const decision = claimPitReservation(entry, session, 'ingress', boxW);
    if (!decision.granted) {
      setPitWait(entry, decision.reason, decision.owner);
      const stopDistance = Math.max(0, ingressStart - w - 0.4);
      return {
        phase: 'decelerate', lateral: pit.off(w),
        speedCap: Math.sqrt(2 * 3.2 * stopDistance), stopW: null, queued: false
      };
    }
    setPitWait(entry, occupant ? 'box-occupied' : null, occupant);
    const targetW = occupant ? queue.w : boxW;
    const targetOff = occupant ? queue.off : pit.boxOff;
    const u = smootherstep((w - ingressStart) / Math.max(0.5, targetW - ingressStart));
    const lateral = lerp(pit.off(ingressStart), targetOff, u);
    const approachSpeed = occupant ? 2.4 : 3.2;
    const speedCap = Math.min(
      approachSpeed,
      Math.sqrt(2 * 2.2 * Math.max(0, targetW - w - 0.35))
    );
    return {
      phase: 'ingress', lateral, speedCap, stopW: targetW,
      queued: !!occupant
    };
  }

  const egressEnd = pitEgressEndW(entry, session);
  if (w < egressEnd) {
    const decision = claimPitReservation(entry, session, 'egress', boxW);
    if (!decision.granted) {
      setPitWait(entry, decision.reason, decision.owner);
      return { phase: 'egress', lateral: pit.boxOff, speedCap: 0, stopW: w, queued: false };
    }
    setPitWait(entry, null, null);
    const u = smootherstep((w - boxW) / PIT_EGRESS_DISTANCE);
    const lateral = lerp(pit.boxOff, pit.off(w), u);
    return { phase: 'egress', lateral, speedCap: Math.min(5, pit.limit), stopW: null, queued: false };
  }
  releasePitReservation(entry, session);
  const mergeStart = pit.Lp - pit.rampOut - 32;
  setPitWait(entry, null, null);
  return {
    phase: w >= mergeStart ? 'merge' : 'travel',
    lateral: pit.off(w),
    speedCap: pit.limit,
    stopW: null,
    queued: false
  };
}

export function notePitProgress(entry: Entry, session: Session): void {
  const w = pitLongitudinal(entry, session);
  if (w == null) return;
  const phase = pitPhaseOf(entry);
  if (entry.pitProgressPhase !== phase) {
    entry.pitProgressPhase = phase;
    entry.pitProgressW = w;
    entry.pitProgressAt = session.t;
    delete entry.pitDeadlockAt;
    return;
  }
  if (entry.pitProgressW == null || entry.pitProgressAt == null ||
      Math.abs(w - entry.pitProgressW) >= 0.5) {
    entry.pitProgressW = w;
    entry.pitProgressAt = session.t;
    return;
  }
  const owner = entry.pitWaitOwner
    ? session.entries.find(candidate => candidate.code === entry.pitWaitOwner)
    : null;
  // A declared double-stack queue and a reservation owner that is making
  // progress are intentional waits, not deadlocks. Keep the waiting car's
  // watchdog fresh; if the owner also stops progressing, its own watchdog (or
  // this one after the grace expires) records the real obstruction.
  if ((entry.pitWaitReason === 'same-team-queue' && owner?.state === 'pit' && owner.pitT > 0) ||
      (owner?.pitProgressAt != null && session.t - owner.pitProgressAt < 1)) {
    entry.pitProgressAt = session.t;
    return;
  }
  if (session.t - entry.pitProgressAt < DEADLOCK_SECONDS ||
      (entry.pitDeadlockAt != null && session.t - entry.pitDeadlockAt < DEADLOCK_SECONDS)) return;
  entry.pitDeadlockAt = session.t;
  const deadlocks = session.pitDeadlocks ?? (session.pitDeadlocks = []);
  if (deadlocks.length >= 200) deadlocks.shift();
  deadlocks.push({
    code: entry.code,
    time: session.t,
    pitW: w,
    phase,
    reason: entry.pitWaitReason ?? null,
    owner: entry.pitWaitOwner ?? null
  });
}

export function pitTime(entry: Entry, fix: boolean, session: Session): number {
  let time: number;
  entry._mishap = false;
  if (entry.isPlayer) {
    time = 7.6 - session.config.pitSkill * 0.55 + (fix ? 3.5 : 0);
    if (random() < 0.10 - session.config.pitFocus * 0.015) {
      time += 4;
      entry._mishap = true;
    }
  } else {
    time = 6.4 + random() * 1.2 + (fix ? 3.5 : 0);
  }
  return time;
}

export function servePit(entry: Entry, session: Session): void {
  const arm = entry.pitArm || { comp: entry.tyre.c, fix: false };
  entry.tyre = { c: arm.comp, wear: 0, fit: entry.cross };
  if (arm.fix) {
    for (const key of ['e', 'h', 'c'] as const satisfies readonly PartKey[])
      entry.rel[key] = Math.max(entry.rel[key], Math.min(0.85, entry.rel[key] + 0.5));
    entry.hFail = false;
    entry.cFail = false;
  }
  entry.pitT = pitTime(entry, arm.fix, session);
  if (entry.isPlayer)
    emitToast(session, `${entry.code} — in the box${entry._mishap ? ' … sticky wheel nut!' : ''}`,
      entry._mishap ? 'bad' : 'info');
  entry.pitArm = null;
  entry.stops++;
}

export function rivalPitAI(entry: Entry, session: RaceSession): void {
  if (entry.isPlayer || entry.pitArm || entry.state !== 'run') return;
  const lapsLeft = session.laps - (entry.cross - 1);
  if (lapsLeft <= 1) return;
  const slick = entry.tyre.c !== 'W';
  if (entry.tyre.wear > 0.78 || (session.wet > 0.42 && slick) ||
      (session.wet < 0.15 && !slick) || entry.hFail) {
    const comp = session.wet > 0.33 ? 'W' : (lapsLeft > 0.42 * session.laps ? 'H' : 'S');
    entry.pitArm = { comp, fix: entry.hFail || minRel(entry) < 0.3 };
  }
}
