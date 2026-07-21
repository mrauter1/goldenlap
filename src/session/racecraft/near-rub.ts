import { PHYS } from '../../core/physics';
import { clamp } from '../../shared/math';
import { measuredContactGrindLossSeconds } from './contact-loss';

export interface NearRubTrajectorySample {
  readonly timeSeconds: number;
  readonly longitudinalCentreDistanceMetres: number;
  readonly lateralCentreDistanceMetres: number;
  readonly egoHeadingOffsetRadians: number;
  readonly rivalHeadingOffsetRadians: number;
}

export interface NearRubExposureCost {
  readonly equivalentSeconds: number;
  readonly lossSeconds: number;
  readonly alongsideEpisodes: number;
}

export interface NearRubExcludedTimeInterval {
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number;
}

interface NearRubSampleState {
  readonly longitudinalOverlapMetres: number;
  readonly bodyEdgeDaylightMetres: number;
}

function projectedHalfExtent(
  headingOffsetRadians: number,
  longitudinal: boolean
): number {
  const cosine = Math.abs(Math.cos(headingOffsetRadians));
  const sine = Math.abs(Math.sin(headingOffsetRadians));
  return longitudinal
    ? cosine * PHYS.carLen / 2 + sine * PHYS.carWid / 2
    : sine * PHYS.carLen / 2 + cosine * PHYS.carWid / 2;
}

function sampleState(
  sample: NearRubTrajectorySample
): NearRubSampleState {
  const longitudinalExtent =
    projectedHalfExtent(sample.egoHeadingOffsetRadians, true) +
    projectedHalfExtent(sample.rivalHeadingOffsetRadians, true);
  const lateralExtent =
    projectedHalfExtent(sample.egoHeadingOffsetRadians, false) +
    projectedHalfExtent(sample.rivalHeadingOffsetRadians, false);
  return {
    longitudinalOverlapMetres:
      longitudinalExtent -
      Math.abs(sample.longitudinalCentreDistanceMetres),
    bodyEdgeDaylightMetres:
      Math.abs(sample.lateralCentreDistanceMetres) - lateralExtent
  };
}

export function nearRubExposureWeight(
  bodyEdgeDaylightMetres: number,
  clearanceMetres: number
): number {
  if (!Number.isFinite(bodyEdgeDaylightMetres))
    throw new RangeError('bodyEdgeDaylightMetres must be finite');
  if (!Number.isFinite(clearanceMetres) || clearanceMetres <= 0)
    throw new RangeError('clearanceMetres must be finite and positive');
  const tolerance = Number.EPSILON * Math.max(
    1,
    Math.abs(bodyEdgeDaylightMetres),
    clearanceMetres
  ) * 8;
  if (bodyEdgeDaylightMetres >= clearanceMetres - tolerance)
    return 0;
  if (bodyEdgeDaylightMetres <= tolerance)
    return 1;
  return clamp(
    1 - Math.max(0, bodyEdgeDaylightMetres) / clearanceMetres,
    0,
    1
  );
}

function integrateLinearNearRubWeight(
  fromDaylightMetres: number,
  toDaylightMetres: number,
  durationSeconds: number,
  clearanceMetres: number
): number {
  if (durationSeconds <= 0) return 0;
  const delta = toDaylightMetres - fromDaylightMetres;
  const breakpoints = [0, 1];
  if (Math.abs(delta) > Number.EPSILON) {
    for (const daylight of [0, clearanceMetres]) {
      const fraction = (daylight - fromDaylightMetres) / delta;
      if (fraction > 0 && fraction < 1) breakpoints.push(fraction);
    }
  }
  breakpoints.sort((left, right) => left - right);
  let equivalentSeconds = 0;
  for (let index = 1; index < breakpoints.length; index++) {
    const from = breakpoints[index - 1]!;
    const to = breakpoints[index]!;
    const fromWeight = nearRubExposureWeight(
      fromDaylightMetres + delta * from,
      clearanceMetres
    );
    const toWeight = nearRubExposureWeight(
      fromDaylightMetres + delta * to,
      clearanceMetres
    );
    equivalentSeconds += durationSeconds * (to - from) *
      (fromWeight + toWeight) / 2;
  }
  return equivalentSeconds;
}

function activeAlongsideFraction(
  fromOverlapMetres: number,
  toOverlapMetres: number
): { from: number; to: number } | null {
  if (fromOverlapMetres > 0 && toOverlapMetres > 0)
    return { from: 0, to: 1 };
  if (fromOverlapMetres <= 0 && toOverlapMetres <= 0)
    return null;
  if (fromOverlapMetres <= 0) {
    const crossing = clamp(
      -fromOverlapMetres /
        (toOverlapMetres - fromOverlapMetres),
      0,
      1
    );
    return { from: crossing, to: 1 };
  }
  const crossing = clamp(
    fromOverlapMetres /
      (fromOverlapMetres - toOverlapMetres),
    0,
    1
  );
  return { from: 0, to: crossing };
}

/**
 * Integrate the soft daylight ramp per maximal connected alongside episode.
 * Each episode enters only the measured sustained-pressure curve: merely
 * entering the soft band never invents an initial-strike bill.
 */
export function plannedNearRubExposureCost(
  samples: readonly NearRubTrajectorySample[],
  clearanceMetres: number,
  excludedIntervals:
    readonly NearRubExcludedTimeInterval[] = []
): NearRubExposureCost {
  if (!Number.isFinite(clearanceMetres) || clearanceMetres <= 0)
    throw new RangeError('clearanceMetres must be finite and positive');
  if (samples.length < 2)
    return {
      equivalentSeconds: 0,
      lossSeconds: 0,
      alongsideEpisodes: 0
    };
  const excluded = [...excludedIntervals]
    .filter(interval =>
      interval.endTimeSeconds >
        interval.startTimeSeconds + Number.EPSILON)
    .sort((left, right) =>
      left.startTimeSeconds - right.startTimeSeconds ||
      left.endTimeSeconds - right.endTimeSeconds);
  for (const interval of excluded)
    if (!Number.isFinite(interval.startTimeSeconds) ||
        !Number.isFinite(interval.endTimeSeconds))
      throw new RangeError(
        'near-rub excluded interval times must be finite'
      );
  let episodeEquivalentSeconds = 0;
  let equivalentSeconds = 0;
  let lossSeconds = 0;
  let alongsideEpisodes = 0;
  let episodeOpen = false;
  const closeEpisode = (): void => {
    if (!episodeOpen) return;
    equivalentSeconds += episodeEquivalentSeconds;
    lossSeconds += measuredContactGrindLossSeconds(
      episodeEquivalentSeconds
    );
    alongsideEpisodes++;
    episodeEquivalentSeconds = 0;
    episodeOpen = false;
  };

  const processInterval = (
    fromState: NearRubSampleState,
    toState: NearRubSampleState,
    durationSeconds: number
  ): void => {
    const active = activeAlongsideFraction(
      fromState.longitudinalOverlapMetres,
      toState.longitudinalOverlapMetres
    );
    if (!active) {
      closeEpisode();
      return;
    }
    episodeOpen = true;
    const daylightDelta =
      toState.bodyEdgeDaylightMetres -
      fromState.bodyEdgeDaylightMetres;
    const activeFromDaylight =
      fromState.bodyEdgeDaylightMetres +
      daylightDelta * active.from;
    const activeToDaylight =
      fromState.bodyEdgeDaylightMetres +
      daylightDelta * active.to;
    episodeEquivalentSeconds += integrateLinearNearRubWeight(
      activeFromDaylight,
      activeToDaylight,
      durationSeconds * (active.to - active.from),
      clearanceMetres
    );
    if (active.to < 1 ||
        toState.longitudinalOverlapMetres <= 0)
      closeEpisode();
  };

  let fromSample = samples[0]!;
  let fromState = sampleState(fromSample);
  for (let index = 1; index < samples.length; index++) {
    const toSample = samples[index]!;
    const durationSeconds = toSample.timeSeconds - fromSample.timeSeconds;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
      throw new RangeError(
        'near-rub sample times must be finite and strictly increasing'
      );
    const toState = sampleState(toSample);
    const split = [0, 1];
    for (const interval of excluded)
      for (const boundary of [
        interval.startTimeSeconds,
        interval.endTimeSeconds
      ]) {
        const fraction = (
          boundary - fromSample.timeSeconds
        ) / durationSeconds;
        if (fraction > Number.EPSILON &&
            fraction < 1 - Number.EPSILON)
          split.push(fraction);
      }
    split.sort((left, right) => left - right);
    for (let splitIndex = 1;
      splitIndex < split.length;
      splitIndex++) {
      const from = split[splitIndex - 1]!;
      const to = split[splitIndex]!;
      const midpointTime = fromSample.timeSeconds +
        durationSeconds * (from + to) / 2;
      if (excluded.some(interval =>
        midpointTime >= interval.startTimeSeconds &&
        midpointTime < interval.endTimeSeconds)) {
        closeEpisode();
        continue;
      }
      const interpolateState = (
        fraction: number
      ): NearRubSampleState => ({
        longitudinalOverlapMetres:
          fromState.longitudinalOverlapMetres +
          (
            toState.longitudinalOverlapMetres -
            fromState.longitudinalOverlapMetres
          ) * fraction,
        bodyEdgeDaylightMetres:
          fromState.bodyEdgeDaylightMetres +
          (
            toState.bodyEdgeDaylightMetres -
            fromState.bodyEdgeDaylightMetres
          ) * fraction
      });
      processInterval(
        interpolateState(from),
        interpolateState(to),
        durationSeconds * (to - from)
      );
    }
    fromSample = toSample;
    fromState = toState;
  }
  closeEpisode();
  return {
    equivalentSeconds,
    lossSeconds,
    alongsideEpisodes
  };
}
