import {
  isHardContactImpulse,
  sweptCarContactEpisodes,
  type SweptCarPosePair
} from '../../core/collision';
import type { Car, Track } from '../../core/model';
import { normAng } from '../../shared/math';
import type {
  Entry,
  PredictiveSafetyHz,
  RacecraftClaim,
  RacecraftPredictiveSafetyPredicate,
  RacecraftPredictiveSafetyResult,
  Session
} from '../model';
import { RacecraftPendingDecisionReason } from '../model';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from './cadence';
import { racecraftClaimStateAtTime } from './claim';
import { OBSTACLE_NEIGHBOR_SCAN_METRES } from './config';
import { signedTrackDistance } from './geometry';

type ActiveEntry = Entry & { car: Car };

export const RACECRAFT_PREDICTIVE_SAFETY_PREDICATES =
  Object.freeze([
    'measured-hard-closing',
    'published-hard-closing'
  ] as const satisfies readonly RacecraftPredictiveSafetyPredicate[]);

export function resolvePredictiveSafetyIntervalTicks(
  hertz: PredictiveSafetyHz
): 1 | 3 {
  return hertz === 30 ? 1 : 3;
}

interface HardClosingEvent {
  readonly hazardCode: string;
  readonly predicate: RacecraftPredictiveSafetyPredicate;
  readonly contactSeconds: number;
  readonly relativeNormalSpeed: number;
  readonly publicationRevision: number | null;
}

function roadHeading(track: Track, entry: ActiveEntry): number {
  const index = Math.max(0, entry.car.progIdx) % track.n;
  return Math.atan2(track.ty[index]!, track.tx[index]!);
}

function hardClosingEvent(
  poses: readonly SweptCarPosePair[],
  hazardCode: string,
  predicate: RacecraftPredictiveSafetyPredicate,
  publicationRevision: number | null
): HardClosingEvent | null {
  const contact = sweptCarContactEpisodes(poses)
    .find(episode =>
      isHardContactImpulse(episode.maximumRelativeNormalSpeed));
  return contact
    ? {
        hazardCode,
        predicate,
        contactSeconds: contact.startTimeSeconds,
        relativeNormalSpeed: contact.maximumRelativeNormalSpeed,
        publicationRevision
      }
    : null;
}

function measuredHardClosing(
  session: Session,
  entry: ActiveEntry,
  other: ActiveEntry
): HardClosingEvent | null {
  const horizon = RACECRAFT_DECISION_INTERVAL_SECONDS;
  const egoHeading = roadHeading(session.trk, entry);
  const longitudinal = signedTrackDistance(
    session.trk,
    entry.car.s,
    other.car.s
  );
  const lateral = other.latNow - entry.latNow;
  const relativeLongitudinalSpeed = other.spd - entry.spd;
  const relativeLateralSpeed =
    (other._trafficLateralVelocity ?? 0) -
    (entry._trafficLateralVelocity ?? 0);
  return hardClosingEvent(
    [
      {
        timeSeconds: 0,
        relativeLongitudinal: longitudinal,
        relativeLateral: lateral,
        egoHeadingRadians: normAng(entry.car.h - egoHeading),
        rivalHeadingRadians: normAng(other.car.h - egoHeading)
      },
      {
        timeSeconds: horizon,
        relativeLongitudinal:
          longitudinal + relativeLongitudinalSpeed * horizon,
        relativeLateral: lateral + relativeLateralSpeed * horizon,
        egoHeadingRadians: normAng(entry.car.h - egoHeading),
        rivalHeadingRadians: normAng(other.car.h - egoHeading)
      }
    ],
    other.code,
    'measured-hard-closing',
    null
  );
}

function publicationHardClosing(
  session: Session,
  entry: ActiveEntry,
  other: ActiveEntry,
  ownPublication: RacecraftClaim | undefined,
  otherPublication: RacecraftClaim | undefined
): HardClosingEvent | null {
  if (!ownPublication || !otherPublication) return null;
  const horizon = RACECRAFT_DECISION_INTERVAL_SECONDS;
  const ownAge = Math.max(0, session.t - ownPublication.publishedAt);
  const otherAge = Math.max(0, session.t - otherPublication.publishedAt);
  const ownNow = racecraftClaimStateAtTime(
    session.trk,
    ownPublication,
    ownAge
  );
  const otherNow = racecraftClaimStateAtTime(
    session.trk,
    otherPublication,
    otherAge
  );
  const ownFuture = racecraftClaimStateAtTime(
    session.trk,
    ownPublication,
    ownAge + horizon
  );
  const otherFuture = racecraftClaimStateAtTime(
    session.trk,
    otherPublication,
    otherAge + horizon
  );
  return hardClosingEvent(
    [
      {
        timeSeconds: 0,
        relativeLongitudinal: signedTrackDistance(
          session.trk,
          ownNow.s,
          otherNow.s
        ),
        relativeLateral: otherNow.lateral - ownNow.lateral,
        egoHeadingRadians: ownNow.headingOffsetRadians,
        rivalHeadingRadians: otherNow.headingOffsetRadians
      },
      {
        timeSeconds: horizon,
        relativeLongitudinal: signedTrackDistance(
          session.trk,
          ownFuture.s,
          otherFuture.s
        ),
        relativeLateral: otherFuture.lateral - ownFuture.lateral,
        egoHeadingRadians: ownFuture.headingOffsetRadians,
        rivalHeadingRadians: otherFuture.headingOffsetRadians
      }
    ],
    other.code,
    'published-hard-closing',
    otherPublication.publicationRevision
  );
}

function earlier(
  current: HardClosingEvent | null,
  candidate: HardClosingEvent | null
): HardClosingEvent | null {
  if (!candidate) return current;
  if (!current ||
      candidate.contactSeconds < current.contactSeconds -
        Number.EPSILON ||
      (Math.abs(candidate.contactSeconds - current.contactSeconds) <=
          Number.EPSILON &&
        (candidate.relativeNormalSpeed >
          current.relativeNormalSpeed + Number.EPSILON ||
          (Math.abs(
            candidate.relativeNormalSpeed -
            current.relativeNormalSpeed
          ) <= Number.EPSILON &&
            candidate.hazardCode.localeCompare(current.hazardCode) < 0))))
    return candidate;
  return current;
}

function result(
  session: Session,
  trafficEpoch: number,
  event: HardClosingEvent | null
): RacecraftPredictiveSafetyResult {
  return Object.freeze({
    evaluatedAtSessionTimeSeconds: session.t,
    trafficEpoch,
    intervalTicks: session.racecraftPredictiveSafetyIntervalTicks,
    predicateInventory: RACECRAFT_PREDICTIVE_SAFETY_PREDICATES,
    hardClosingVeto: event != null,
    requiredBrakingEffort: event ? 1 : 0,
    hazardCode: event?.hazardCode ?? null,
    predicate: event?.predicate ?? null,
    predictedContactSeconds: event?.contactSeconds ?? null,
    relativeNormalSpeedMetresPerSecond:
      event?.relativeNormalSpeed ?? 0,
    hazardPublicationRevision:
      event?.publicationRevision ?? null
  });
}

function defensiveClosureAwaitsAttackerConsumption(
  attacker: ActiveEntry,
  attackerPublication: RacecraftClaim | undefined,
  defenderPublication: RacecraftClaim | undefined
): boolean {
  const commitment = defenderPublication?.defensiveCommitment;
  return commitment != null &&
    commitment.authoredOutcome === 'side-closure-authorized' &&
    commitment.targetCodeAtCommitment === attacker.code &&
    (defenderPublication?.publicationRevision ?? -1) >=
      commitment.authorizedDefenderPublicationRevision &&
    attackerPublication?.publicationRevision ===
      commitment.sourceAttackerPublicationRevision;
}

/**
 * One shared predicate inventory runs at either resolved cadence. The output
 * can veto damaging closing control and latch deliberation, but it cannot
 * author or replace tactical, ownership, or longitudinal authority.
 */
export function runRacecraftPredictiveSafetyPass(
  session: Session,
  entries: readonly ActiveEntry[],
  trafficEpoch: number
): boolean {
  const interval = session.racecraftPredictiveSafetyIntervalTicks;
  if (trafficEpoch % interval !== 0) return false;
  session.racecraftSafetyPasses =
    (session.racecraftSafetyPasses ?? 0) + 1;
  const predicateRuns = session.racecraftSafetyPredicateRuns ??
    (session.racecraftSafetyPredicateRuns = {});
  for (const entry of entries) {
    let event: HardClosingEvent | null = null;
    for (const predicate of RACECRAFT_PREDICTIVE_SAFETY_PREDICATES)
      predicateRuns[predicate] = (predicateRuns[predicate] ?? 0) + 1;
    const ownPublication = session.racecraftClaims?.get(entry.code);
    for (const other of entries) {
      if (other === entry ||
          Math.abs(signedTrackDistance(
            session.trk,
            entry.car.s,
            other.car.s
          )) > OBSTACLE_NEIGHBOR_SCAN_METRES)
        continue;
      event = earlier(
        event,
        measuredHardClosing(session, entry, other)
      );
      event = earlier(
        event,
        publicationHardClosing(
          session,
          entry,
          other,
          ownPublication,
          session.racecraftClaims?.get(other.code)
        )
      );
    }
    const previous = entry.racecraftPredictiveSafety;
    entry.racecraftPredictiveSafety = result(
      session,
      trafficEpoch,
      event
    );
    if (event) {
      entry.racecraftPendingDecisionReasons =
        (entry.racecraftPendingDecisionReasons ?? 0) |
        RacecraftPendingDecisionReason.PredictiveSafety;
      if (!previous?.hardClosingVeto) {
        session.racecraftSafetyInterventions =
          (session.racecraftSafetyInterventions ?? 0) + 1;
        if (defensiveClosureAwaitsAttackerConsumption(
          entry,
          ownPublication,
          session.racecraftClaims?.get(event.hazardCode)
        ))
          session.racecraftDefensivePreConsumptionSafetyInterventions =
            (
              session
                .racecraftDefensivePreConsumptionSafetyInterventions ??
              0
            ) + 1;
      }
    }
  }
  return true;
}

export function applyRacecraftPredictiveSafetyVeto(entry: Entry): void {
  const safety = entry.racecraftPredictiveSafety;
  if (!safety?.hardClosingVeto) return;
  entry.inp.throttle = 0;
  entry.inp.brake = Math.max(
    entry.inp.brake,
    safety.requiredBrakingEffort
  );
}
