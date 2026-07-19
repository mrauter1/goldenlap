import type { Track } from '../../core/model';
import { clamp, normAng } from '../../shared/math';
import type { RacecraftClaim } from '../model';

export interface RacecraftEvaluationClaim {
  /** Immutable publication advanced to the evaluation epoch. */
  claim: RacecraftClaim;
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function cyclicProgress(track: Track, progress: number): number {
  return ((progress % track.len) + track.len) % track.len;
}

function forwardTrackDistance(track: Track, from: number, to: number): number {
  return ((to - from) % track.len + track.len) % track.len;
}

function signedTrackDistance(track: Track, from: number, to: number): number {
  let distance = forwardTrackDistance(track, from, to);
  if (distance > track.len / 2) distance -= track.len;
  return distance;
}

export interface RacecraftClaimState {
  s: number;
  lateral: number;
  speed: number;
  headingOffsetRadians: number;
}

/** Continuous state on the immutable published worldline. */
export function racecraftClaimStateAtTime(
  track: Track,
  claim: RacecraftClaim,
  time: number
): RacecraftClaimState {
  const targetTime = Math.max(0, time);
  let fromTime = 0;
  let fromS = claim.originS;
  let fromLateral = claim.originCentre;
  let fromSpeed = claim.originSpeed;
  let fromHeading = claim.originHeadingOffsetRadians;
  for (const station of claim.stations) {
    if (targetTime > station.time) {
      fromTime = station.time;
      fromS = station.s;
      fromLateral = station.centre;
      fromSpeed = station.speed;
      fromHeading = station.headingOffsetRadians;
      continue;
    }
    const u = clamp(
      (targetTime - fromTime) /
        Math.max(Number.EPSILON, station.time - fromTime),
      0,
      1
    );
    // A station interval is far shorter than half a lap, so the signed cyclic
    // displacement is unique. Treating every negative seam as forward motion
    // turns a sub-noise reanchor correction into an almost-full-lap jump.
    const distance = signedTrackDistance(track, fromS, station.s);
    return {
      s: cyclicProgress(track, fromS + distance * u),
      lateral: fromLateral +
        (station.centre - fromLateral) * u,
      speed: fromSpeed + (station.speed - fromSpeed) * u,
      headingOffsetRadians: normAng(
        fromHeading +
        normAng(station.headingOffsetRadians - fromHeading) * u
      )
    };
  }
  const last = claim.stations.at(-1);
  if (last && targetTime > last.time) {
    const previous = claim.stations.at(-2);
    const previousTime = previous?.time ?? 0;
    const previousLateral = previous?.centre ?? claim.originCentre;
    const previousHeading = previous?.headingOffsetRadians ??
      claim.originHeadingOffsetRadians;
    const span = Math.max(Number.EPSILON, last.time - previousTime);
    const lateralRate = (last.centre - previousLateral) / span;
    const headingRate = normAng(
      last.headingOffsetRadians - previousHeading
    ) / span;
    const elapsed = targetTime - last.time;
    return {
      s: cyclicProgress(
        track,
        last.s + Math.max(0, last.speed) * elapsed
      ),
      lateral: last.centre + lateralRate * elapsed,
      speed: last.speed,
      headingOffsetRadians: normAng(
        last.headingOffsetRadians + headingRate * elapsed
      )
    };
  }
  return {
    s: last?.s ?? claim.originS,
    lateral: last?.centre ?? claim.originCentre,
    speed: last?.speed ?? claim.originSpeed,
    headingOffsetRadians:
      last?.headingOffsetRadians ?? claim.originHeadingOffsetRadians
  };
}

/**
 * Advance an immutable publication to one common evaluation epoch.
 * Publication identity and its stored snapshot remain untouched.
 */
export function racecraftClaimAtEvaluationEpoch(
  track: Track,
  claim: RacecraftClaim,
  evaluationAt: number
): RacecraftEvaluationClaim {
  const age = Math.max(0, evaluationAt - claim.publishedAt);
  if (age <= Number.EPSILON)
    return { claim };

  const origin = racecraftClaimStateAtTime(track, claim, age);
  const stations = claim.stations.map(station => {
    const state = racecraftClaimStateAtTime(
      track,
      claim,
      age + station.time
    );
    return {
      ...station,
      index: cyclicIndex(track, state.s / track.step),
      s: state.s,
      speed: state.speed,
      centre: state.lateral,
      headingOffsetRadians: state.headingOffsetRadians
    };
  });
  return {
    claim: {
      ...claim,
      publishedAt: evaluationAt,
      originS: origin.s,
      originCentre: origin.lateral,
      originSpeed: origin.speed,
      originHeadingOffsetRadians: origin.headingOffsetRadians,
      stations
    }
  };
}

/**
 * Exact point-publication identity at one common epoch. Measured noise does
 * not define a publication class: every changed prediction is information,
 * while each consumer's incremental β check decides whether it matters.
 */
export function racecraftClaimsSharePublication(
  track: Track,
  previous: RacecraftClaim,
  claim: RacecraftClaim
): boolean {
  if (previous.code !== claim.code ||
      previous.source !== claim.source ||
      previous.trusted !== claim.trusted ||
      previous.predictionKey !== claim.predictionKey ||
      previous.lateralAuthorityRevision !==
        claim.lateralAuthorityRevision ||
      previous.longitudinalAuthorityRevision !==
        claim.longitudinalAuthorityRevision ||
      previous.stations.length !== claim.stations.length)
    return false;
  for (let index = 0; index < claim.stations.length; index++)
    if (previous.stations[index]!.time !== claim.stations[index]!.time)
      return false;

  const age = claim.publishedAt - previous.publishedAt;
  if (!Number.isFinite(age) || age < 0) return false;
  const matchesAt = (
    time: number,
    s: number,
    lateral: number,
    speed: number,
    headingOffsetRadians: number,
    compareLateral: boolean
  ): boolean => {
    const predicted = racecraftClaimStateAtTime(
      track,
      previous,
      age + time
    );
    return (!compareLateral || lateral === predicted.lateral) &&
      s === predicted.s &&
      speed === predicted.speed &&
      headingOffsetRadians === predicted.headingOffsetRadians;
  };

  if (!matchesAt(
    0,
    claim.originS,
    claim.originCentre,
    claim.originSpeed,
    claim.originHeadingOffsetRadians,
    true
  )) return false;
  const previousHorizon = previous.stations.at(-1)?.time ?? 0;
  for (const station of claim.stations)
    // Reanchoring appends a new tail interval. Only the overlapping support
    // can contain changed information relative to the predecessor.
    if (age + station.time <= previousHorizon + Number.EPSILON &&
        !matchesAt(
          station.time,
          station.s,
          station.centre,
          station.speed,
          station.headingOffsetRadians,
          true
        ))
      return false;
  return true;
}
