import type { Car, Track } from '../../core/model';
import { PHYS } from '../../core/physics';
import type { Entry, Session } from '../model';
import { MANEUVER_PREDICTION } from './feasibility';
import {
  certifySideAgreementFamily,
  longitudinalBodyProjection,
  racecraftPairKey,
  sideAgreementFamilyCertificateIsCurrent,
  sideAgreementFamilyContextKey
} from './geometry';

type ActiveEntry = Entry & { car: Car };

const MAXIMUM_BODY_OVERLAP_DISTANCE_METRES = Math.sqrt(
  PHYS.carLen * PHYS.carLen + PHYS.carWid * PHYS.carWid
);

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function forwardTrackDistance(track: Track, from: number, to: number): number {
  const distance = to - from;
  return distance < 0 ? distance + track.len : distance;
}

export function updateRacecraftSideAgreements(
  session: Session,
  active: readonly ActiveEntry[]
): void {
  const agreements = session.sideAgreements ??
    (session.sideAgreements = new Map());
  const failureContexts =
    session._racecraftAgreementCertificateFailureContexts ??
    (session._racecraftAgreementCertificateFailureContexts = new Map());
  const activeByCode = new Map(
    active.map(entry => [entry.code, entry] as const)
  );
  for (const key of agreements.keys()) {
    const separator = key.indexOf(':');
    if (!activeByCode.has(key.slice(0, separator)) ||
        !activeByCode.has(key.slice(separator + 1))) {
      agreements.delete(key);
      failureContexts.delete(key);
    }
  }
  for (const key of failureContexts.keys()) {
    const separator = key.indexOf(':');
    if (!activeByCode.has(key.slice(0, separator)) ||
        !activeByCode.has(key.slice(separator + 1)))
      failureContexts.delete(key);
  }

  // Agreement release scales with live agreements, not all possible pairs.
  for (const [key, agreement] of agreements) {
    const separator = key.indexOf(':');
    const one = activeByCode.get(key.slice(0, separator));
    const two = activeByCode.get(key.slice(separator + 1));
    if (!one || !two) continue;
    const longitudinal = longitudinalBodyProjection(session.trk, one, two);
    if (longitudinal.overlap) {
      const daylight =
        Math.abs(one.latNow - two.latNow) - PHYS.carWid;
      session.racecraftAgreementDaylightMetresSum =
        (session.racecraftAgreementDaylightMetresSum ?? 0) + daylight;
      session.racecraftAgreementDaylightSamples =
        (session.racecraftAgreementDaylightSamples ?? 0) + 1;
      session.racecraftAgreementDaylightMinimumMetres = Math.min(
        session.racecraftAgreementDaylightMinimumMetres ?? Infinity,
        daylight
      );
      continue;
    }
    failureContexts.delete(key);
    agreements.delete(key);
  }

  const sorted = [...active].sort((left, right) =>
    left.car.s - right.car.s || left.code.localeCompare(right.code));
  const visited = new Set<string>();
  // Neither oriented body can project farther than its diagonal.
  for (let firstIndex = 0; firstIndex < sorted.length; firstIndex++) {
    const one = sorted[firstIndex]!;
    for (let step = 1; step < sorted.length; step++) {
      const two = sorted[(firstIndex + step) % sorted.length]!;
      const distance = forwardTrackDistance(
        session.trk,
        one.car.s,
        two.car.s
      );
      if (distance > MAXIMUM_BODY_OVERLAP_DISTANCE_METRES) break;
      const key = racecraftPairKey(one.code, two.code);
      if (visited.has(key)) continue;
      visited.add(key);
      const agreement = agreements.get(key);
      const longitudinal = longitudinalBodyProjection(
        session.trk,
        one,
        two
      );
      if (!longitudinal.overlap) {
        failureContexts.delete(key);
        continue;
      }

      const first = one.code < two.code ? one : two;
      const second = first === one ? two : one;
      const side = agreement?.side ??
        (Math.sign(first.latNow - second.latNow) ||
          (first.code.localeCompare(second.code) <= 0 ? -1 : 1));
      const lower = side < 0 ? first : second;
      const upper = lower === first ? second : first;
      if (!agreement) {
        const currentFailureContext =
          `${sideAgreementFamilyContextKey(
            session.trk,
            lower,
            upper
          )}|${lower.code}<${upper.code}`;
        if (failureContexts.get(key) === currentFailureContext)
          continue;
      }
      if (agreement && sideAgreementFamilyCertificateIsCurrent(
        session.trk,
        lower,
        upper,
        agreement.familyCertificate
      )) continue;

      const firstTrackIndex = cyclicIndex(
        session.trk,
        first.car.progIdx
      );
      const secondTrackIndex = cyclicIndex(
        session.trk,
        second.car.progIdx
      );
      const firstEta = first.latNow -
        session.trk.idealPath.off[firstTrackIndex]!;
      const secondEta = second.latNow -
        session.trk.idealPath.off[secondTrackIndex]!;
      const preferredSeparatorEta = agreement?.separatorEta ??
        (firstEta + secondEta) / 2;
      const centreClearance = PHYS.carWid;
      const straightSpanMetres = Math.max(
        PHYS.carLen,
        Math.max(
          0,
          lower.spd || lower.car.spd,
          upper.spd || upper.car.spd
        ) * MANEUVER_PREDICTION.horizonSeconds
      );
      const certification = certifySideAgreementFamily(
        session,
        lower,
        upper,
        centreClearance,
        preferredSeparatorEta,
        straightSpanMetres
      );
      if (!certification.familyCertificate ||
          certification.separatorEta == null) {
        agreements.delete(key);
        const failureContext =
          `${certification.contextKey}|${lower.code}<${upper.code}`;
        if (failureContexts.get(key) !== failureContext) {
          failureContexts.set(key, failureContext);
          session.racecraftAgreementFamilyCertificateFailures =
            (session.racecraftAgreementFamilyCertificateFailures ?? 0) + 1;
          const failuresByContext =
            session.racecraftAgreementFamilyCertificateFailuresByContext ??
            (session.racecraftAgreementFamilyCertificateFailuresByContext =
              {});
          failuresByContext[certification.contextKey] =
            (failuresByContext[certification.contextKey] ?? 0) + 1;
        }
        continue;
      }

      failureContexts.delete(key);
      if (Math.abs(
        certification.separatorEta - preferredSeparatorEta
      ) > Number.EPSILON)
        session.racecraftAgreementFamilyRepositions =
          (session.racecraftAgreementFamilyRepositions ?? 0) + 1;
      if (agreement) {
        agreement.separatorEta = certification.separatorEta;
        agreement.centreClearance = centreClearance;
        agreement.familyCertificate = certification.familyCertificate;
      } else {
        agreements.set(key, {
          side: side < 0 ? -1 : 1,
          separatorEta: certification.separatorEta,
          centreClearance,
          familyCertificate: certification.familyCertificate,
          since: session.t
        });
      }
    }
  }
}
