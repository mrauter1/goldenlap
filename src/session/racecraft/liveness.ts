import type { Car, PathMode } from '../../core/model';
import { carBodyCircleClearance } from '../../core/collision';
import { speedEnvelopeAt } from '../../core/speed-envelope';
import type { Entry, Session } from '../model';
import { longitudinalBodyProjection } from './geometry';
import { obligationsFor } from './relations';

type ActiveEntry = Entry & { car: Car };

export const STALL_CRAWL_SPEED_MPS = 0.45;
export const STALL_GRACE_SECONDS = 4;

function physicallyBlocked(session: Session, entry: ActiveEntry): Entry | null {
  for (const other of session.entries) {
    if (other === entry || !other.car ||
        (other.state !== 'run' && other.state !== 'fin' && other.state !== 'pitIn' &&
          other.state !== 'pitOut')) continue;
    const projection = longitudinalBodyProjection(session.trk, entry, other as ActiveEntry);
    if (projection.signedDistance < 0 ||
        carBodyCircleClearance(
          other.car.x - entry.car.x,
          other.car.y - entry.car.y,
          entry.car.h,
          other.car.h
        ) > 0) continue;
    return other;
  }
  return null;
}

function declaredStationaryCause(session: Session, entry: ActiveEntry): string | null {
  if (entry.hFail || entry.cFail || entry.fuel <= 0) return 'failure';
  if (entry.recT > 0 || entry.car.offCourse || entry.car.rev) return 'incident-recovery';
  const blocker = physicallyBlocked(session, entry);
  if (blocker) return `physical-blockage:${blocker.code}`;
  const obligation = obligationsFor(session, entry, session.entries)[0];
  if (obligation)
    return `${obligation.reason}:${obligation.beneficiary.code}`;
  if (entry.trafficSlowPoint &&
      entry.trafficSlowPoint.distance <= 0 &&
      entry.trafficSlowPoint.speed < STALL_CRAWL_SPEED_MPS)
    return `safe-braking:${entry.trafficSlowPoint.ownerCode}`;
  const program = entry.racecraftLongitudinalProgram;
  if (program &&
      speedEnvelopeAt(program.envelope, program.envelope.startProgress) <
        STALL_CRAWL_SPEED_MPS &&
      program.slowPointOwnerCode)
    return `safe-braking:${program.slowPointOwnerCode}`;
  return null;
}

function resetStationaryEpisode(entry: Entry): void {
  delete entry.stationarySince;
  entry.stationaryDuration = 0;
  entry.stationaryCause = null;
  delete entry.unexplainedStallAt;
}

/**
 * Record a hard liveness failure without moving or resetting the car.
 *
 * This runs at the traffic cadence, after all current speed authorities have
 * published their decisions. Legitimate waits reset the unexplained grace
 * clock; a later stale cap therefore cannot inherit time from a real blockage.
 */
export function updateStallDiagnostics(session: Session): void {
  for (const value of session.entries) {
    if (!value.car || value.state !== 'run' ||
        (session.mode === 'race' && session.phase !== 'run')) {
      resetStationaryEpisode(value);
      continue;
    }
    const entry = value as ActiveEntry;
    if (!Number.isFinite(entry.spd) || entry.spd >= STALL_CRAWL_SPEED_MPS) {
      resetStationaryEpisode(entry);
      continue;
    }
    const declared = declaredStationaryCause(session, entry);
    if (declared) {
      delete entry.stationarySince;
      entry.stationaryDuration = 0;
      entry.stationaryCause = declared;
      delete entry.unexplainedStallAt;
      continue;
    }
    entry.stationarySince ??= session.t;
    entry.stationaryDuration = Math.max(0, session.t - entry.stationarySince);
    entry.stationaryCause = 'unexplained';
    if (entry.stationaryDuration + 1e-9 < STALL_GRACE_SECONDS ||
        entry.unexplainedStallAt != null) continue;
    entry.unexplainedStallAt = session.t;
    const records = session.unexplainedStalls ?? (session.unexplainedStalls = []);
    records.push({
      code: entry.code,
      at: session.t,
      duration: entry.stationaryDuration,
      progress: entry.prog,
      speed: entry.spd,
      pathMode: (entry.pathMode ?? 'ideal') as PathMode
    });
  }
}
