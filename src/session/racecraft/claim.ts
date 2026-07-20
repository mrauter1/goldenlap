import type { Track } from '../../core/model';
import { clamp, normAng } from '../../shared/math';
import type { RacecraftClaim, RacecraftClaimStations } from '../model';

export interface RacecraftClaimStationInput {
  readonly time: number;
  readonly s: number;
  readonly centre: number;
  readonly speed: number;
  readonly headingOffsetRadians: number;
}

export function createRacecraftClaimStations(
  capacity: number
): RacecraftClaimStations {
  return {
    length: 0,
    time: new Float64Array(capacity),
    s: new Float64Array(capacity),
    y: new Float64Array(capacity),
    v: new Float64Array(capacity),
    heading: new Float64Array(capacity)
  };
}

export function racecraftClaimStationsFromRows(
  rows: readonly RacecraftClaimStationInput[]
): RacecraftClaimStations {
  const stations = createRacecraftClaimStations(rows.length);
  stations.length = rows.length;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    stations.time[index] = row.time;
    stations.s[index] = row.s;
    stations.y[index] = row.centre;
    stations.v[index] = row.speed;
    stations.heading[index] = row.headingOffsetRadians;
  }
  return stations;
}

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
  const distance = to - from;
  return distance < 0 ? distance + track.len : distance;
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

/** Write continuous state on the immutable publication into caller scratch. */
export function writeRacecraftClaimStateAtTime(
  track: Track,
  claim: RacecraftClaim,
  time: number,
  out: RacecraftClaimState
): RacecraftClaimState {
  const targetTime = Math.max(0, time);
  let fromTime = 0;
  let fromS = claim.originS;
  let fromLateral = claim.originCentre;
  let fromSpeed = claim.originSpeed;
  let fromHeading = claim.originHeadingOffsetRadians;
  const stations = claim.stations;
  for (let index = 0; index < stations.length; index++) {
    const stationTime = stations.time[index]!;
    if (targetTime > stationTime) {
      fromTime = stationTime;
      fromS = stations.s[index]!;
      fromLateral = stations.y[index]!;
      fromSpeed = stations.v[index]!;
      fromHeading = stations.heading[index]!;
      continue;
    }
    const u = clamp(
      (targetTime - fromTime) /
        Math.max(Number.EPSILON, stationTime - fromTime),
      0,
      1
    );
    // A station interval is far shorter than half a lap, so the signed cyclic
    // displacement is unique. Treating every negative seam as forward motion
    // turns a sub-noise reanchor correction into an almost-full-lap jump.
    const stationS = stations.s[index]!;
    const stationLateral = stations.y[index]!;
    const stationSpeed = stations.v[index]!;
    const stationHeading = stations.heading[index]!;
    const distance = signedTrackDistance(track, fromS, stationS);
    out.s = cyclicProgress(track, fromS + distance * u);
    out.lateral = fromLateral +
      (stationLateral - fromLateral) * u;
    out.speed = fromSpeed + (stationSpeed - fromSpeed) * u;
    out.headingOffsetRadians = normAng(
      fromHeading +
      normAng(stationHeading - fromHeading) * u
    );
    return out;
  }
  const lastIndex = stations.length - 1;
  if (lastIndex >= 0 && targetTime > stations.time[lastIndex]!) {
    const previousIndex = lastIndex - 1;
    const previousTime = previousIndex >= 0
      ? stations.time[previousIndex]!
      : 0;
    const previousLateral = previousIndex >= 0
      ? stations.y[previousIndex]!
      : claim.originCentre;
    const previousHeading = previousIndex >= 0
      ? stations.heading[previousIndex]!
      : claim.originHeadingOffsetRadians;
    const lastTime = stations.time[lastIndex]!;
    const lastLateral = stations.y[lastIndex]!;
    const lastHeading = stations.heading[lastIndex]!;
    const lastSpeed = stations.v[lastIndex]!;
    const span = Math.max(Number.EPSILON, lastTime - previousTime);
    const lateralRate = (lastLateral - previousLateral) / span;
    const headingRate = normAng(
      lastHeading - previousHeading
    ) / span;
    const elapsed = targetTime - lastTime;
    out.s = cyclicProgress(
      track,
      stations.s[lastIndex]! + Math.max(0, lastSpeed) * elapsed
    );
    out.lateral = lastLateral + lateralRate * elapsed;
    out.speed = lastSpeed;
    out.headingOffsetRadians = normAng(
      lastHeading + headingRate * elapsed
    );
    return out;
  }
  out.s = lastIndex >= 0 ? stations.s[lastIndex]! : claim.originS;
  out.lateral = lastIndex >= 0
    ? stations.y[lastIndex]!
    : claim.originCentre;
  out.speed = lastIndex >= 0
    ? stations.v[lastIndex]!
    : claim.originSpeed;
  out.headingOffsetRadians = lastIndex >= 0
    ? stations.heading[lastIndex]!
    : claim.originHeadingOffsetRadians;
  return out;
}

/** Allocating convenience API for cold callers and diagnostics. */
export function racecraftClaimStateAtTime(
  track: Track,
  claim: RacecraftClaim,
  time: number
): RacecraftClaimState {
  return writeRacecraftClaimStateAtTime(track, claim, time, {
    s: 0,
    lateral: 0,
    speed: 0,
    headingOffsetRadians: 0
  });
}

interface EvaluationEpochCache {
  publishedAt: number;
  publicationRevision: number;
  predictionKey: string;
  byTrack: WeakMap<Track, Map<number, RacecraftEvaluationClaim>>;
}

const evaluationEpochCache =
  new WeakMap<RacecraftClaim, EvaluationEpochCache>();

/**
 * Advance an immutable publication to one common evaluation epoch.
 * Publication identity and its stored snapshot remain untouched.
 */
export function racecraftClaimAtEvaluationEpoch(
  track: Track,
  claim: RacecraftClaim,
  evaluationAt: number
): RacecraftEvaluationClaim {
  let cached = evaluationEpochCache.get(claim);
  if (!cached ||
      cached.publishedAt !== claim.publishedAt ||
      cached.publicationRevision !== claim.publicationRevision ||
      cached.predictionKey !== claim.predictionKey) {
    cached = {
      publishedAt: claim.publishedAt,
      publicationRevision: claim.publicationRevision,
      predictionKey: claim.predictionKey,
      byTrack: new WeakMap()
    };
    evaluationEpochCache.set(claim, cached);
  }
  let byTime = cached.byTrack.get(track);
  if (!byTime) {
    byTime = new Map();
    cached.byTrack.set(track, byTime);
  }
  const cachedView = byTime.get(evaluationAt);
  if (cachedView) return cachedView;
  const age = Math.max(0, evaluationAt - claim.publishedAt);
  if (age <= Number.EPSILON) {
    const view = { claim };
    byTime.set(evaluationAt, view);
    return view;
  }

  const origin = racecraftClaimStateAtTime(track, claim, age);
  const stations = createRacecraftClaimStations(claim.stations.length);
  stations.length = claim.stations.length;
  for (let index = 0; index < stations.length; index++) {
    const stationTime = claim.stations.time[index]!;
    const state = racecraftClaimStateAtTime(
      track,
      claim,
      age + stationTime
    );
    stations.time[index] = stationTime;
    stations.s[index] = state.s;
    stations.v[index] = state.speed;
    stations.y[index] = state.lateral;
    stations.heading[index] = state.headingOffsetRadians;
  }
  const view = {
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
  byTime.set(evaluationAt, view);
  return view;
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
    if (previous.stations.time[index] !== claim.stations.time[index])
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
  const previousHorizon = previous.stations.length > 0
    ? previous.stations.time[previous.stations.length - 1]!
    : 0;
  for (let index = 0; index < claim.stations.length; index++)
    // Reanchoring appends a new tail interval. Only the overlapping support
    // can contain changed information relative to the predecessor.
    if (age + claim.stations.time[index]! <=
          previousHorizon + Number.EPSILON &&
        !matchesAt(
          claim.stations.time[index]!,
          claim.stations.s[index]!,
          claim.stations.y[index]!,
          claim.stations.v[index]!,
          claim.stations.heading[index]!,
          true
        ))
      return false;
  return true;
}
