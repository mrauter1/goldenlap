import type { Car } from '../../core/model';
import { PHYS } from '../../core/physics';
import { normalLateralEnvelope } from '../../core/surface';
import type {
  Entry,
  Session
} from '../model';
import { completedRaceLaps, qualifyingLapPhase } from './preference';
import {
  racecraftCalibration,
  TRAFFIC_NEIGHBOR_SCAN_METRES
} from './config';
import { MANEUVER_PREDICTION } from './feasibility';
import { signedTrackDistance } from './geometry';

type ActiveEntry = Entry & { car: Car };

export type RacecraftObligationReason =
  | 'blue-flag'
  | 'qualifying'
  | 'damage';

export interface RacecraftObligation {
  yielding: ActiveEntry;
  beneficiary: ActiveEntry;
  reason: RacecraftObligationReason;
}

function activeOnTrack(entry: Entry): entry is ActiveEntry {
  return !!entry.car && entry.state === 'run' && !entry.car.offCourse;
}

function beneficiaryCanReach(
  session: Session,
  yielding: ActiveEntry,
  beneficiary: ActiveEntry,
  catchSeconds: number
): boolean {
  const signed = signedTrackDistance(
    session.trk,
    beneficiary.car.s,
    yielding.car.s
  );
  if (signed < -PHYS.carLen ||
      signed > TRAFFIC_NEIGHBOR_SCAN_METRES) return false;
  if (Math.abs(signed) <= PHYS.carLen) return true;
  const closing = beneficiary.spd - yielding.spd;
  return closing > 0 &&
    Math.max(0, signed - PHYS.carLen) / closing <= catchSeconds;
}

/**
 * Sporting protocol is a relation, not a lifecycle. This predicate says only
 * who owes whom; candidate costs and the reactive evaluator decide how.
 */
export function owes(
  session: Session,
  yielding: Entry,
  beneficiary: Entry
): RacecraftObligationReason | null {
  if (yielding === beneficiary ||
      !activeOnTrack(yielding) ||
      !activeOnTrack(beneficiary)) return null;
  const calibration = racecraftCalibration();
  if (session.mode === 'race' &&
      completedRaceLaps(beneficiary) > completedRaceLaps(yielding) &&
      beneficiaryCanReach(
        session,
        yielding,
        beneficiary,
        calibration.blueFlagTimeToCatchSeconds
      ))
    return 'blue-flag';
  if (session.mode === 'quali' &&
      qualifyingLapPhase(beneficiary) === 'flying' &&
      (qualifyingLapPhase(yielding) === 'out' ||
        qualifyingLapPhase(yielding) === 'in') &&
      beneficiaryCanReach(
        session,
        yielding,
        beneficiary,
        calibration.qualifyingTimeToCatchSeconds
      ))
    return 'qualifying';
  if ((yielding.hFail || yielding.cFail) &&
      beneficiaryCanReach(
        session,
        yielding,
        beneficiary,
        MANEUVER_PREDICTION.horizonSeconds
      ))
    return 'damage';
  return null;
}

export function obligationsFor(
  session: Session,
  yielding: Entry,
  entries: readonly Entry[]
): RacecraftObligation[] {
  const result: RacecraftObligation[] = [];
  for (const beneficiary of entries) {
    const reason = owes(session, yielding, beneficiary);
    if (!reason || !beneficiary.car || !yielding.car) continue;
    result.push({
      yielding: yielding as ActiveEntry,
      beneficiary: beneficiary as ActiveEntry,
      reason
    });
  }
  result.sort((left, right) => {
    const leftDistance = signedTrackDistance(
      session.trk,
      left.beneficiary.car.s,
      left.yielding.car.s
    );
    const rightDistance = signedTrackDistance(
      session.trk,
      right.beneficiary.car.s,
      right.yielding.car.s
    );
    return leftDistance - rightDistance ||
      left.beneficiary.code.localeCompare(right.beneficiary.code);
  });
  return result;
}

export function hasObligationRelation(
  session: Session,
  first: Entry,
  second: Entry
): boolean {
  return owes(session, first, second) != null ||
    owes(session, second, first) != null;
}

export function isObligationParticipant(
  session: Session,
  entry: Entry,
  entries: readonly Entry[] = session.entries
): boolean {
  return entries.some(other =>
    other !== entry && hasObligationRelation(session, entry, other));
}

export function obligationGeometryForcesSingleFile(
  session: Session,
  obligation: RacecraftObligation
): boolean {
  const start = Math.max(0, obligation.yielding.car.progIdx) % session.trk.n;
  const required = PHYS.carWid;
  for (let sample = 0; sample <= MANEUVER_PREDICTION.samples; sample++) {
    const time = MANEUVER_PREDICTION.horizonSeconds *
      sample / MANEUVER_PREDICTION.samples;
    const index = (start + Math.round(
      obligation.yielding.spd * time / session.trk.step
    )) % session.trk.n;
    const legal = normalLateralEnvelope(session.trk, index);
    if (legal.maximum - legal.minimum + 1e-9 < required) return true;
  }
  return false;
}

/** A revoked program publishes measured/predicted occupancy, never a timer. */
export function contractIsRevoked(session: Session, entry: Entry): boolean {
  if (!entry.car || entry.state === 'dnf' || entry.state === 'pit') return true;
  const claim = session.racecraftClaims?.get(entry.code);
  if (claim) return !claim.trusted;
  const publishedOffSurface =
    entry.laneProgram.surfaceAuthorization === 'emergency';
  return (entry.car.offCourse && !publishedOffSurface) ||
    entry.recT > 0 ||
    Math.abs(entry.car.r) > 1 ||
    Math.abs(entry.car.slipR) > 0.28;
}

export function isFixedOccupancy(session: Session, entry: Entry): boolean {
  return !!entry.car &&
    entry.spd * MANEUVER_PREDICTION.horizonSeconds <= PHYS.carLen / 2;
}
