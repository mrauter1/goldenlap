import type { Car, Track } from '../../core/model';
import { CAR_COLLISION_AXLE_OFFSET_METRES } from '../../core/collision';
import { stepCar, trackSense } from '../../core/physics-engine';
import {
  longitudinalAccelerationHeadroom,
  PHYS
} from '../../core/physics';
import { surfaceExposureAtLateral } from '../../core/surface';
import { clamp, normAng } from '../../shared/math';
import type {
  Entry,
  PathPlan,
  RacecraftCandidateKind,
  RacecraftClaim,
  RacecraftClaimRevisionReason,
  RacecraftClaimStation,
  RacecraftTrackingErrorScale,
  RacecraftPredictionSource,
  Session
} from '../model';
import {
  entryDownforceScale,
  entryMargin,
  entryMods,
  entryMu,
  flowOff,
  H_STEP,
  TRAF_DT
} from '../strategy';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from './cadence';
import {
  racecraftClaimsSharePublication,
  racecraftClaimStateAtTime
} from './claim';
import {
  racecraftFamilyGeometryAt,
  racecraftFamilyStateAt
} from './family-geometry';
import {
  maneuverPredictionStationTime,
  MANEUVER_PREDICTION
} from './feasibility';
import {
  certifySideAgreementFamily,
  evaluateLaneEta,
  longitudinalBodyProjection,
  racecraftPairKey,
  sideAgreementFamilyCertificateIsCurrent,
  sideAgreementFamilyContextKey,
  sportingSideAgreementCentreClearance
} from './geometry';
import { STALL_CRAWL_SPEED_MPS } from './liveness';
import { sampleCompactPathPlanOffset } from './compact-path';
import {
  racecraftStableFamilyId,
  rebuildRacecraftSelectedProgram,
  rederiveRacecraftOptimalProgram,
  type RacecraftOptimalProgram
} from './evaluator';

type ActiveEntry = Entry & { car: Car };

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function indexAtProgress(
  track: Track,
  entry: ActiveEntry,
  progress: number
): number {
  return cyclicIndex(
    track,
    entry.car.progIdx + (progress - entry.prog) / track.step
  );
}

function forwardTrackDistance(track: Track, from: number, to: number): number {
  return ((to - from) % track.len + track.len) % track.len;
}

function signedTrackDistance(track: Track, from: number, to: number): number {
  let distance = forwardTrackDistance(track, from, to);
  if (distance > track.len / 2) distance -= track.len;
  return distance;
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
  const activeByCode = new Map(active.map(entry => [entry.code, entry] as const));
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
  // Agreement release scales with the number of live agreements, not with
  // every possible car pair.
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
  // The projection of either oriented body onto the track tangent cannot
  // exceed its diagonal. Pairs beyond one body diagonal therefore cannot
  // have longitudinal body overlap and need no agreement work.
  const maximumOverlapDistance = Math.hypot(PHYS.carLen, PHYS.carWid);
  for (let firstIndex = 0; firstIndex < sorted.length; firstIndex++) {
    const one = sorted[firstIndex]!;
    for (let step = 1; step < sorted.length; step++) {
      const two = sorted[(firstIndex + step) % sorted.length]!;
      const distance = forwardTrackDistance(
        session.trk,
        one.car.s,
        two.car.s
      );
      if (distance > maximumOverlapDistance) break;
      const key = racecraftPairKey(one.code, two.code);
      if (visited.has(key)) continue;
      visited.add(key);
      const agreement = agreements.get(key);
      const longitudinal = longitudinalBodyProjection(session.trk, one, two);
      if (longitudinal.overlap) {
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
        const centreClearance =
          sportingSideAgreementCentreClearance();
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
        continue;
      }
      failureContexts.delete(key);
    }
  }
}

function publishedLateralRaw(
  track: Track,
  entry: ActiveEntry,
  progress: number
): number {
  const index = indexAtProgress(track, entry, progress);
  if (entry.pathPlan?.mode === 'pit' && entry.path)
    return entry.path.off[index]!;
  if (entry.racecraftPathPlan)
    return sampleCompactPathPlanOffset(
      track,
      entry.racecraftPathPlan,
      index,
      progress
    );
  const lane = entry.laneBuffer;
  if (lane?.count &&
      entry._laneBufferRevision === (entry.laneEdits ?? 0)) {
    const slot = (index - lane.startIndex + track.n) % track.n;
    if (slot < lane.count) return lane.off[slot]!;
  }
  const eta = entry.laneProgram.points.length
    ? evaluateLaneEta(entry.laneProgram.points, progress).eta
    : entry.laneProgram.bias;
  return track.idealPath!.off[index]! + eta;
}

function laneSpeedAt(
  track: Track,
  entry: ActiveEntry,
  progress: number
): number {
  const index = indexAtProgress(track, entry, progress);
  if (entry.pathPlan?.mode === 'pit' && entry.path)
    return Math.max(0, entry.path.v[index]!);
  const lane = entry.laneBuffer;
  if (lane?.count &&
      entry._laneBufferRevision === (entry.laneEdits ?? 0)) {
    const slot = (index - lane.startIndex + track.n) % track.n;
    if (slot < lane.count) return Math.max(0, lane.v[slot]!);
  }
  return Math.max(0, track.idealPath!.v[index]!);
}

function selectedProgramTargetSpeed(
  session: Session,
  entry: ActiveEntry,
  progress: number
): number {
  const track = session.trk;
  const index = indexAtProgress(track, entry, progress);
  let target: number;
  if (entry.pathPlan?.mode === 'pit' && entry.path) {
    target = Math.max(0, entry.path.v[index]!);
  } else if (entry.racecraftPathPlan) {
    target = racecraftFamilyStateAt(
      session,
      entry,
      progress,
      entry.racecraftPathPlan
    ).targetSpeed;
  } else {
    const lane = entry.laneBuffer;
    if (lane?.count &&
        entry._laneBufferRevision === (entry.laneEdits ?? 0)) {
      const slot = (index - lane.startIndex + track.n) % track.n;
      if (slot < lane.count) target = Math.max(0, lane.v[slot]!);
      else target = 0;
    } else {
      const margin = clamp(
        entryMargin(entry, session, session.config.tuneBonus, session.wet) +
          flowOff(entry, session),
        0.85,
        0.985
      );
      target = Math.max(0, laneSpeedAt(track, entry, progress) * margin);
    }
  }

  const longitudinal = entry.racecraftLongitudinalProgram;
  if (!longitudinal?.progress.length ||
      longitudinal.progress.length !== longitudinal.speed.length)
    return target;
  const last = longitudinal.progress.length - 1;
  if (progress > longitudinal.progress[last]!)
    return target;
  if (progress <= longitudinal.progress[0]!)
    return Math.min(target, longitudinal.speed[0]!);
  let from = 0;
  while (from < last - 1 &&
      longitudinal.progress[from + 1]! < progress)
    from++;
  const to = Math.min(from + 1, last);
  const fromProgress = longitudinal.progress[from]!;
  const toProgress = longitudinal.progress[to]!;
  const u = toProgress > fromProgress
    ? clamp(
        (progress - fromProgress) / (toProgress - fromProgress),
        0,
        1
      )
    : 0;
  const programSpeed = longitudinal.speed[from]! +
    (longitudinal.speed[to]! - longitudinal.speed[from]!) * u;
  return Math.min(target, Math.max(0, programSpeed));
}

function laneCurvatureAt(
  track: Track,
  entry: ActiveEntry,
  progress: number
): number {
  const index = indexAtProgress(track, entry, progress);
  if (entry.racecraftPathPlan)
    return racecraftFamilyGeometryAt(
      track,
      entry,
      progress,
      entry.racecraftPathPlan
    ).curvature;
  const lane = entry.laneBuffer;
  if (lane?.count &&
      entry._laneBufferRevision === (entry.laneEdits ?? 0)) {
    const slot = (index - lane.startIndex + track.n) % track.n;
    if (slot < lane.count) return lane.k[slot]!;
  }
  return entry.pathPlan?.mode === 'pit' && entry.path
    ? entry.path.k[index]!
    : track.idealPath!.k[index]!;
}

function laneSurfaceAt(
  track: Track,
  entry: ActiveEntry,
  progress: number
): { mu: number; drag: number } {
  const index = indexAtProgress(track, entry, progress);
  if (entry.racecraftPathPlan) {
    const lateral = sampleCompactPathPlanOffset(
      track,
      entry.racecraftPathPlan,
      index,
      progress
    );
    const exposure = surfaceExposureAtLateral(track, index, lateral);
    return { mu: exposure.mu, drag: exposure.drag };
  }
  const lane = entry.laneBuffer;
  if (lane?.count &&
      entry._laneBufferRevision === (entry.laneEdits ?? 0)) {
    const slot = (index - lane.startIndex + track.n) % track.n;
    if (slot < lane.count)
      return {
        mu: lane.mu[slot]!,
        drag: lane.drag[slot]!
      };
  }
  return { mu: 1, drag: 0 };
}

function nextPublishedSpeed(
  session: Session,
  entry: ActiveEntry,
  progress: number,
  speed: number,
  target: number,
  seconds: number
): number {
  return nextPredictionSpeed(
    session,
    entry,
    speed,
    target,
    laneCurvatureAt(session.trk, entry, progress),
    laneSurfaceAt(session.trk, entry, progress),
    seconds
  );
}

function nextPredictionSpeed(
  session: Session,
  entry: ActiveEntry,
  speed: number,
  target: number,
  curvature: number,
  surface: { mu: number; drag: number },
  seconds: number,
  dynamicMu = entryMu(entry, session.wet) * surface.mu
): number {
  const modifiers = entryMods(entry, session.wet);
  const gripHeadroom = longitudinalAccelerationHeadroom(
    speed,
    curvature,
    dynamicMu,
    entryDownforceScale(entry)
  );
  const passiveDeceleration = (
    PHYS.kDrag * modifiers.dr * speed * speed +
    PHYS.kRoll +
    speed * Math.max(0, surface.drag)
  ) / PHYS.m;
  if (target < speed) {
    const brakingEffort =
      entry.racecraftLongitudinalProgram?.brakingEffort ??
      entry.brakingEffort;
    const deceleration = Math.max(
      0,
      brakingEffort * gripHeadroom + passiveDeceleration
    );
    return Math.max(target, speed - deceleration * seconds);
  }
  const driveForce = Math.min(
    PHYS.Fmax * modifiers.pw,
    PHYS.power * modifiers.pw / Math.max(4, speed)
  );
  const driveAcceleration =
    driveForce / PHYS.m - passiveDeceleration;
  return Math.max(0, Math.min(
    target,
    speed + Math.min(driveAcceleration, gripHeadroom) * seconds
  ));
}

interface PredictionStation {
  s: number;
  speed: number;
  centre: number;
  headingOffsetRadians: number;
}

function roadHeadingAt(track: Track, index: number): number {
  const resolved = cyclicIndex(track, index);
  return Math.atan2(track.ty[resolved]!, track.tx[resolved]!);
}

function measuredBodyHeadingOffset(
  track: Track,
  car: Car
): number {
  return normAng(car.h - roadHeadingAt(track, car.progIdx));
}

function controlledBodyHeadingOffset(
  track: Track,
  entry: ActiveEntry,
  progress: number
): number {
  if (entry.racecraftPathPlan)
    return racecraftFamilyGeometryAt(
      track,
      entry,
      progress,
      entry.racecraftPathPlan
    ).headingOffsetRadians;
  const lateral = publishedLateralRaw(track, entry, progress);
  const lateralSlope = (
    publishedLateralRaw(track, entry, progress + track.step) -
    publishedLateralRaw(track, entry, progress - track.step)
  ) / (2 * track.step);
  const index = indexAtProgress(track, entry, progress);
  return Math.atan2(
    lateralSlope,
    1 - track.kSm[index]! * lateral
  );
}

function ballisticPredictionStations(
  session: Session,
  entry: ActiveEntry
): PredictionStation[] {
  const track = session.trk;
  const car = { ...entry.car };
  const input = { steer: 0, throttle: 0, brake: 0, hand: false };
  const modifiers = entryMods(entry, session.wet);
  const result: PredictionStation[] = [];
  let elapsed = 0;
  for (let sample = 1; sample <= MANEUVER_PREDICTION.samples; sample++) {
    const sampleTime = maneuverPredictionStationTime(sample);
    while (elapsed + Number.EPSILON < sampleTime) {
      const duration = Math.min(H_STEP, sampleTime - elapsed);
      const surface = trackSense(track, car);
      stepCar(car, input, surface, duration, modifiers);
      elapsed += duration;
    }
    const surface = trackSense(track, car);
    result.push({
      s: car.s,
      speed: Math.hypot(car.vx, car.vy),
      centre: surface.lat ?? entry.latNow,
      headingOffsetRadians: measuredBodyHeadingOffset(track, car)
    });
  }
  return result;
}

function predictionResidual(
  session: Session,
  entry: ActiveEntry,
  prior: RacecraftClaim
): { lateral: number; longitudinal: number } {
  const elapsed = Math.max(0, session.t - prior.publishedAt);
  const predicted = racecraftClaimStateAtTime(
    session.trk,
    prior,
    elapsed
  );
  const measuredHeading = measuredBodyHeadingOffset(
    session.trk,
    entry.car
  );
  const headingEndpointError =
    2 * CAR_COLLISION_AXLE_OFFSET_METRES *
    Math.sin(Math.abs(normAng(
      measuredHeading - predicted.headingOffsetRadians
    )) / 2);
  return {
    lateral: Math.max(
      Math.abs(entry.latNow - predicted.lateral),
      headingEndpointError
    ),
    longitudinal: Math.abs(signedTrackDistance(
      session.trk,
      predicted.s,
      entry.car.s
    )) + TRAF_DT * Math.abs(
      predicted.speed - Math.max(0, entry.spd || entry.car.spd)
    )
  };
}

function predictionState(
  session: Session,
  entry: ActiveEntry
): { unstable: boolean; noControlAuthority: boolean } {
  const index = cyclicIndex(session.trk, entry.car.progIdx);
  const roadHeading = Math.atan2(
    session.trk.ty[index]!,
    session.trk.tx[index]!
  );
  const headingError = Math.abs(normAng(entry.car.h - roadHeading));
  const speed = Math.hypot(entry.car.vx, entry.car.vy);
  const worldVelocityX =
    entry.car.vx * Math.cos(entry.car.h) -
    entry.car.vy * Math.sin(entry.car.h);
  const worldVelocityY =
    entry.car.vx * Math.sin(entry.car.h) +
    entry.car.vy * Math.cos(entry.car.h);
  const forwardVelocity =
    worldVelocityX * session.trk.tx[index]! +
    worldVelocityY * session.trk.ty[index]!;
  const spinning = speed > STALL_CRAWL_SPEED_MPS &&
    (headingError >= Math.PI / 2 || forwardVelocity <= 0);
  const stalled = speed < STALL_CRAWL_SPEED_MPS &&
    (entry.stationaryDuration ?? 0) >=
      RACECRAFT_DECISION_INTERVAL_SECONDS;
  const unstable = Math.abs(entry.car.r) > 1 ||
    Math.abs(entry.car.slipR) > 0.28 ||
    headingError > 0.42;
  return {
    unstable,
    noControlAuthority: spinning || stalled
  };
}

function defaultTrackingErrorScale(
  entry: ActiveEntry,
  source: RacecraftPredictionSource,
  previous: RacecraftClaim | undefined,
  observedPublishedTrackingError: RacecraftTrackingErrorScale
): RacecraftTrackingErrorScale {
  const stored = entry.claimTrackingErrorScaleBySource?.[source];
  if (stored) return { ...stored };
  if (previous?.source === source)
    return {
      lateralThresholdMetres:
        previous.lateralTrackingErrorThresholdMetres,
      longitudinalThresholdMetres:
        previous.longitudinalTrackingErrorThresholdMetres
    };
  if (!previous && source === 'published')
    return {
      lateralThresholdMetres:
        entry.claimLateralTrackingErrorThresholdMetres ??
          observedPublishedTrackingError.lateralThresholdMetres,
      longitudinalThresholdMetres:
        entry.claimLongitudinalTrackingErrorThresholdMetres ??
          observedPublishedTrackingError.longitudinalThresholdMetres
    };
  return {
    lateralThresholdMetres: 0,
    longitudinalThresholdMetres: 0
  };
}

function updateTrackingErrorEwma(
  current: RacecraftTrackingErrorScale,
  observed: RacecraftTrackingErrorScale
): RacecraftTrackingErrorScale {
  const sampleWeight = clamp(
    TRAF_DT / RACECRAFT_DECISION_INTERVAL_SECONDS,
    0,
    1
  );
  // ε is a source-local measured tracking-error EWMA. Longitudinal residuals
  // must not widen the lateral β perturbation or any geometric clearance.
  return {
    lateralThresholdMetres:
      current.lateralThresholdMetres +
      (observed.lateralThresholdMetres -
        current.lateralThresholdMetres) * sampleWeight,
    longitudinalThresholdMetres:
      current.longitudinalThresholdMetres +
      (observed.longitudinalThresholdMetres -
        current.longitudinalThresholdMetres) * sampleWeight
  };
}

function measuredInstalledProgramError(
  session: Session,
  entry: ActiveEntry
): RacecraftTrackingErrorScale {
  const speed = Math.max(0, entry.spd || entry.car.spd);
  return {
    lateralThresholdMetres: Math.abs(
      entry.latNow - publishedLateralRaw(session.trk, entry, entry.prog)
    ),
    longitudinalThresholdMetres: TRAF_DT * Math.abs(
      speed - selectedProgramTargetSpeed(session, entry, entry.prog)
    )
  };
}

function claimIsTrusted(
  session: Session,
  entry: ActiveEntry,
  publicationTracked: boolean,
  state = predictionState(session, entry)
): boolean {
  const publishedOffSurface =
    entry.laneProgram.surfaceAuthorization === 'emergency';
  return publicationTracked &&
    (!entry.car.offCourse || publishedOffSurface) &&
    !state.unstable &&
    !state.noControlAuthority;
}

function createClaim(code: string): RacecraftClaim {
  return {
    code,
    source: 'published',
    predictionKey: '',
    lateralAuthorityRevision: -1,
    longitudinalAuthorityRevision: -1,
    publicationRevision: 0,
    publishedAt: 0,
    originS: 0,
    originCentre: 0,
    originSpeed: 0,
    originHeadingOffsetRadians: 0,
    trusted: false,
    lateralTrackingErrorThresholdMetres: 0,
    longitudinalTrackingErrorThresholdMetres: 0,
    trackingErrorMetres: 0,
    stations: []
  };
}

interface PreparedClaim {
  entry: ActiveEntry;
  claim: RacecraftClaim;
  previous: RacecraftClaim | undefined;
}

function predictionKeyForClaim(
  entry: ActiveEntry,
  source: RacecraftPredictionSource,
  rederived: RacecraftOptimalProgram | null,
  rederivedPitProgram: boolean
): string {
  if (source === 'published') {
    const longitudinal = entry.racecraftLongitudinalProgram;
    const slowPointOwnerCode =
      longitudinal?.slowPointOwnerCode ?? null;
    const installed = entry.racecraftPathPlan ?? entry.pathPlan;
    const family = installed
      ? racecraftStableFamilyId(
          installed.mode === 'pit'
            ? 'hold'
            : entry._racecraftAppliedKind ?? 'hold',
          installed,
          slowPointOwnerCode
        )
      : racecraftStableFamilyId(
          'ideal',
          { mode: 'ideal', key: 'ideal' },
          slowPointOwnerCode
        );
    return `published:${family}`;
  }
  if (source === 'ballistic')
    return 'ballistic';
  if (rederived)
    return 'rederived:' +
      racecraftStableFamilyId(
        rederived.kind,
        rederived.plan,
        rederived.slowPointOwnerCode
      );
  const selected = selectedDecisionFamily(entry);
  if (selected)
    return `${source}:` +
      racecraftStableFamilyId(
        selected.kind,
        selected.plan,
        selected.slowPointOwnerCode
      );
  if (rederivedPitProgram && entry.pathPlan)
    return `rederived-pit:${entry.pathPlan.key}`;
  return `${source}:` +
    `${entry.racecraftPathPlan?.key ?? entry.pathPlan?.key ?? 'ideal'}:` +
    `${entry.laneProgram.reason}:${entry.laneProgram.binding ?? ''}`;
}

/**
 * A trusted execution program already published its overlapping future.
 * Re-observation owns time zero; only the newly exposed tail is computed.
 */
function retainAgedPredictionSupport(
  track: Track,
  previous: RacecraftClaim | undefined,
  claim: RacecraftClaim
): void {
  if (!previous ||
      previous.source !== claim.source ||
      previous.predictionKey !== claim.predictionKey)
    return;
  const age = claim.publishedAt - previous.publishedAt;
  if (!Number.isFinite(age) || age < 0) return;
  const predictedOrigin = racecraftClaimStateAtTime(track, previous, age);
  const originLongitudinalError = Math.abs(signedTrackDistance(
    track,
    predictedOrigin.s,
    claim.originS
  )) + TRAF_DT * Math.abs(
    predictedOrigin.speed - claim.originSpeed
  );
  // The semantic key proves that the future authority did not change. Only
  // its newly measured execution origin can contradict the aged publication;
  // regenerating already-published support is neither observation nor news.
  const lateralThreshold =
    previous.lateralTrackingErrorThresholdMetres;
  const longitudinalThreshold =
    previous.longitudinalTrackingErrorThresholdMetres;
  if (Math.abs(predictedOrigin.lateral - claim.originCentre) >
        lateralThreshold + Number.EPSILON ||
      originLongitudinalError >
        longitudinalThreshold + Number.EPSILON)
    return;
  const previousHorizon = previous.stations.at(-1)?.time ?? 0;
  for (const station of claim.stations) {
    if (age + station.time > previousHorizon + Number.EPSILON) continue;
    const retained = racecraftClaimStateAtTime(
      track,
      previous,
      age + station.time
    );
    station.index = cyclicIndex(track, retained.s / track.step);
    station.s = retained.s;
    station.speed = retained.speed;
    station.centre = retained.lateral;
    station.headingOffsetRadians = retained.headingOffsetRadians;
  }
}

function selectedDecisionFamily(entry: ActiveEntry): {
  at: number;
  kind: RacecraftCandidateKind;
  plan: PathPlan;
  slowPointOwnerCode: string | null;
} | null {
  const decision = entry.racecraftDecision;
  const selected = decision?.candidates.find(candidate =>
    candidate.plan.key === decision.selectedPlanKey);
  if (!decision || !selected || decision.selectedKind == null) return null;
  return {
    at: decision.at,
    kind: decision.selectedKind,
    plan: selected.plan,
    slowPointOwnerCode: selected.slowPointOwnerCode ?? null
  };
}

function rederivedProgramForClaim(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[],
  previous: RacecraftClaim | undefined
): RacecraftOptimalProgram | null {
  let cached = entry._racecraftRederivedProgram;
  if (previous?.source !== 'rederived' || !cached) {
    const selected = rederiveRacecraftOptimalProgram(session, entry, entries);
    if (!selected) return null;
    cached = entry._racecraftRederivedProgram = {
      kind: selected.kind,
      plan: selected.plan,
      slowPointOwnerCode: selected.slowPointOwnerCode,
      absorbedDecisionAt: entry.racecraftDecision?.at ?? -Infinity
    };
    return selected;
  }

  const decisionFamily = selectedDecisionFamily(entry);
  if (decisionFamily && decisionFamily.at > cached.absorbedDecisionAt) {
    cached.kind = decisionFamily.kind;
    cached.plan = decisionFamily.plan;
    cached.slowPointOwnerCode = decisionFamily.slowPointOwnerCode;
    cached.absorbedDecisionAt = decisionFamily.at;
  } else if (entry.racecraftDecision &&
      entry.racecraftDecision.at > cached.absorbedDecisionAt) {
    // A real deliberation with no feasible winner still consumes the epoch;
    // retain the last usable family rather than running another hidden argmin.
    cached.absorbedDecisionAt = entry.racecraftDecision.at;
  }
  return rebuildRacecraftSelectedProgram(
    session,
    entry,
    entries,
    cached
  );
}

function prepareClaim(
  session: Session,
  entry: ActiveEntry,
  entries: readonly Entry[]
): PreparedClaim {
  const track = session.trk;
  const previous = entry.racecraftClaim;
  const previousResidual = previous
    ? predictionResidual(session, entry, previous)
    : null;
  const installedError = measuredInstalledProgramError(session, entry);
  const authorityRevision =
    entry._racecraftLateralAuthorityRevision ?? 0;
  const longitudinalAuthorityRevision =
    entry._racecraftLongitudinalAuthorityRevision ?? 0;
  const bySource = entry.claimTrackingErrorScaleBySource ??
    (entry.claimTrackingErrorScaleBySource = {});
  if (!previous && !bySource.published)
    bySource.published = defaultTrackingErrorScale(
      entry,
      'published',
      previous,
      installedError
    );
  let detection = entry._racecraftPublicationDetection;
  if (!detection ||
      detection.lateralAuthorityRevision !== authorityRevision ||
      detection.longitudinalAuthorityRevision !==
        longitudinalAuthorityRevision) {
    detection = entry._racecraftPublicationDetection = {
      lateralAuthorityRevision: authorityRevision,
      longitudinalAuthorityRevision,
      scale: {
        ...(bySource.published ?? defaultTrackingErrorScale(
          entry,
          'published',
          previous,
          installedError
        ))
      },
      rejected: false
    };
  }
  const state = predictionState(session, entry);
  const publicationStateAllowed = claimIsTrusted(
    session,
    entry,
    true,
    state
  );
  const previousMatchesGeneration =
    previous?.source === 'published' &&
    previous.lateralAuthorityRevision === authorityRevision &&
    previous.longitudinalAuthorityRevision ===
      longitudinalAuthorityRevision;
  if (previousMatchesGeneration && previousResidual) {
    if (!publicationStateAllowed)
      detection.rejected = true;
    if (!detection.rejected)
      // The EWMA is a measured scale for publication identity and beta, not a
      // statistical support bound. Point divergence outside the predecessor's
      // frozen class advances the claim revision and forces deliberation; it
      // cannot by itself prove that a stable installed authority was lost.
      bySource.published = updateTrackingErrorEwma(
        bySource.published ?? detection.scale,
        {
          lateralThresholdMetres: previousResidual.lateral,
          longitudinalThresholdMetres: previousResidual.longitudinal
        }
      );
  }
  const trusted = claimIsTrusted(
    session,
    entry,
    !detection.rejected,
    state
  );
  const source: RacecraftPredictionSource = trusted
    ? 'published'
    : state.noControlAuthority
      ? 'ballistic'
      : 'rederived';
  if (source !== 'rederived') delete entry._racecraftRederivedProgram;
  let trackingErrorScale = source === 'published'
    ? detection.scale
    : defaultTrackingErrorScale(
        entry,
        source,
        previous,
        installedError
      );
  let claim = entry._racecraftClaimWrite;
  if (!claim || claim === previous) claim = createClaim(entry.code);
  claim.code = entry.code;
  claim.source = source;
  claim.lateralAuthorityRevision = source === 'published'
    ? authorityRevision
    : -1;
  claim.longitudinalAuthorityRevision = source === 'published'
    ? longitudinalAuthorityRevision
    : -1;
  claim.publishedAt = session.t;
  claim.originS = entry.car.s;
  claim.originCentre = entry.latNow;
  claim.originSpeed = Math.max(0, entry.spd || entry.car.spd);
  claim.originHeadingOffsetRadians = measuredBodyHeadingOffset(
    track,
    entry.car
  );
  claim.trusted = trusted;
  claim.lateralTrackingErrorThresholdMetres =
    trackingErrorScale.lateralThresholdMetres;
  claim.longitudinalTrackingErrorThresholdMetres =
    trackingErrorScale.longitudinalThresholdMetres;
  claim.trackingErrorMetres = previousResidual?.lateral ?? 0;

  const ballistic = source === 'ballistic'
    ? ballisticPredictionStations(session, entry)
    : null;
  // Pit synchronization has already re-derived this car's unique controlled
  // program from its measured pit state. It is the non-race analogue of the
  // bounded racecraft argmin, and the ordinary rollout below consumes it
  // directly without inventing a race candidate family in the pit lane.
  const rederivedPitProgram = source === 'rederived' &&
    entry.pathPlan?.mode === 'pit' &&
    entry.path != null;
  const rederived = source === 'rederived' && !rederivedPitProgram
    ? rederivedProgramForClaim(session, entry, entries, previous)
    : null;
  if (source === 'rederived' && !rederived && !rederivedPitProgram)
    throw new Error(`${entry.code} has no re-derived prediction program`);
  claim.predictionKey = predictionKeyForClaim(
    entry,
    source,
    rederived,
    rederivedPitProgram
  );
  if (source !== 'published' &&
      previous?.source === source &&
      previous.predictionKey === claim.predictionKey &&
      previousResidual) {
    bySource[source] = updateTrackingErrorEwma(
      bySource[source] ?? trackingErrorScale,
      {
        lateralThresholdMetres: previousResidual.lateral,
        longitudinalThresholdMetres: previousResidual.longitudinal
      }
    );
    trackingErrorScale = bySource[source]!;
    claim.lateralTrackingErrorThresholdMetres =
      trackingErrorScale.lateralThresholdMetres;
    claim.longitudinalTrackingErrorThresholdMetres =
      trackingErrorScale.longitudinalThresholdMetres;
  }
  let progress = entry.prog;
  let speed = Math.max(0, entry.spd || entry.car.spd);
  let previousTime = 0;
  for (let sample = 0; sample < MANEUVER_PREDICTION.samples; sample++) {
    const rederivedStation = rederived?.stations[sample + 1];
    const predicted = ballistic?.[sample];
    const time = maneuverPredictionStationTime(sample + 1);
    const stepSeconds = time - previousTime;
    let s: number;
    let centre: number;
    let headingOffsetRadians: number;
    if (rederivedStation) {
      progress = rederivedStation.progress;
      speed = rederivedStation.speed;
      s = rederivedStation.s;
      centre = rederivedStation.lateral;
      headingOffsetRadians = rederivedStation.headingOffsetRadians;
    } else if (predicted) {
      speed = predicted.speed;
      s = predicted.s;
      centre = predicted.centre;
      headingOffsetRadians = predicted.headingOffsetRadians;
    } else {
      const target = selectedProgramTargetSpeed(session, entry, progress);
      const nextSpeed = nextPublishedSpeed(
        session,
        entry,
        progress,
        speed,
        target,
        stepSeconds
      );
      progress += (speed + nextSpeed) * 0.5 * stepSeconds;
      speed = nextSpeed;
      s = (entry.car.s + progress - entry.prog) % track.len;
      centre = publishedLateralRaw(track, entry, progress);
      headingOffsetRadians = controlledBodyHeadingOffset(
        track,
        entry,
        progress
      );
    }
    const stationIndex = cyclicIndex(track, s / track.step);
    const station: RacecraftClaimStation = claim.stations[sample] ?? {
      index: 0,
      time: 0,
      s: 0,
      speed: 0,
      centre: 0,
      headingOffsetRadians: 0
    };
    station.index = stationIndex;
    station.time = time;
    station.s = s;
    station.speed = speed;
    station.centre = centre;
    station.headingOffsetRadians = headingOffsetRadians;
    claim.stations[sample] = station;
    previousTime = time;
  }
  claim.stations.length = MANEUVER_PREDICTION.samples;
  if (!bySource[source]) bySource[source] = { ...trackingErrorScale };
  const samePublication = previous != null &&
    racecraftClaimsSharePublication(track, previous, claim);
  if (samePublication && previous) {
    // The predecessor's frozen detector proved extensional equivalence.
    // Only now may the overlapping support be retained; retaining before
    // comparison would conceal a genuine same-family point departure.
    claim.lateralTrackingErrorThresholdMetres =
      previous.lateralTrackingErrorThresholdMetres;
    claim.longitudinalTrackingErrorThresholdMetres =
      previous.longitudinalTrackingErrorThresholdMetres;
    retainAgedPredictionSupport(track, previous, claim);
  }
  if (previous && !samePublication) {
    const reason: RacecraftClaimRevisionReason =
      previous.source !== claim.source ||
      previous.trusted !== claim.trusted
        ? 'prediction-source'
        : previous.predictionKey !== claim.predictionKey ||
            previous.lateralAuthorityRevision !==
              claim.lateralAuthorityRevision ||
            previous.longitudinalAuthorityRevision !==
              claim.longitudinalAuthorityRevision
          ? 'prediction-family'
          : 'point-divergence';
    const reasons = session.racecraftClaimRevisionReasons ??
      (session.racecraftClaimRevisionReasons = {});
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const lastRevision = Math.max(
    entry._racecraftLastPublicationRevision ?? -1,
    previous?.publicationRevision ?? -1
  );
  claim.publicationRevision = samePublication && previous
    ? previous.publicationRevision
    : lastRevision + 1;
  return { entry, claim, previous };
}

/**
 * Publish one immutable claim snapshot for the arbitration epoch.
 *
 * All claims are prepared against the previous snapshot, then swapped at
 * once. Double buffers keep the hot path allocation-free after warm-up while
 * making same-epoch processing order unobservable.
 */
export function publishRacecraftClaimSnapshot(
  session: Session,
  entries: readonly Entry[],
  demandedCodes: ReadonlySet<string>
): void {
  const active = entries.filter((entry): entry is ActiveEntry =>
    !!entry.car &&
    (entry.state === 'run' ||
      entry.state === 'pitIn' ||
      entry.state === 'pitOut'));
  const demanded = active.filter(entry => demandedCodes.has(entry.code));
  const prepared = demanded.map(entry => prepareClaim(session, entry, demanded));
  const claims = session._racecraftClaimMapWrite ??
    new Map<string, RacecraftClaim>();
  claims.clear();
  for (const entry of entries) {
    if (demandedCodes.has(entry.code)) continue;
    delete entry.racecraftClaim;
    delete entry._racecraftClaimWrite;
    delete entry._racecraftRederivedProgram;
  }
  for (const value of prepared) {
    const { entry, claim, previous } = value;
    claims.set(entry.code, claim);
    if (previous) entry._racecraftClaimWrite = previous;
    else delete entry._racecraftClaimWrite;
    entry.racecraftClaim = claim;
    entry._racecraftLastPublicationRevision = claim.publicationRevision;
    entry.claimLateralTrackingErrorThresholdMetres =
      claim.lateralTrackingErrorThresholdMetres;
    entry.claimLongitudinalTrackingErrorThresholdMetres =
      claim.longitudinalTrackingErrorThresholdMetres;
    entry.claimTrackingErrorMetres = claim.trackingErrorMetres;
    if (!claim.trusted)
      session.racecraftClaimUntrustedSamples =
        (session.racecraftClaimUntrustedSamples ?? 0) + 1;
  }
  const priorMap = session.racecraftClaims;
  session.racecraftClaims = claims;
  session._racecraftClaimMapWrite = priorMap instanceof Map
    ? priorMap
    : new Map<string, RacecraftClaim>();
  session.racecraftClaimTick = (session.racecraftClaimTick ?? 0) + 1;
}
