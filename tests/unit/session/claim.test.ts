import { describe, expect, test } from 'bun:test';

import type { Track } from '../../../src/core/model';
import type { RacecraftClaim } from '../../../src/session/model';
import {
  racecraftClaimAtEvaluationEpoch,
  racecraftClaimsSharePublication,
  racecraftClaimStateAtTime
} from '../../../src/session/racecraft/claim';

const TRACK = {
  len: 100,
  n: 50,
  step: 2
} as Track;

function claim(
  overrides: Partial<RacecraftClaim> = {}
): RacecraftClaim {
  const centre = overrides.originCentre ?? 0;
  return {
    code: 'CAR',
    source: 'published',
    predictionKey: 'published:test',
    lateralAuthorityRevision: 0,
    longitudinalAuthorityRevision: 0,
    publicationRevision: 0,
    publishedAt: 0,
    originS: 99,
    originCentre: centre,
    originSpeed: 10,
    originHeadingOffsetRadians: 0,
    trusted: true,
    lateralTrackingErrorThresholdMetres: 0.2,
    longitudinalTrackingErrorThresholdMetres: 0.2,
    trackingErrorMetres: 0,
    stations: [1, 2].map(time => ({
      index: 0,
      time,
      s: (99 + 10 * time) % TRACK.len,
      speed: 10,
      centre,
      headingOffsetRadians: 0
    })),
    ...overrides
  };
}

function agedRepublish(
  previous: RacecraftClaim,
  age: number
): RacecraftClaim {
  const origin = racecraftClaimStateAtTime(TRACK, previous, age);
  const stations = previous.stations.map(station => {
    const state = racecraftClaimStateAtTime(
      TRACK,
      previous,
      age + station.time
    );
    return {
      ...station,
      s: state.s,
      speed: state.speed,
      centre: state.lateral,
      headingOffsetRadians: state.headingOffsetRadians
    };
  });
  return {
    ...previous,
    publishedAt: previous.publishedAt + age,
    originS: origin.s,
    originCentre: origin.lateral,
    originSpeed: origin.speed,
    originHeadingOffsetRadians: origin.headingOffsetRadians,
    stations
  };
}

describe('exact point-publication identity', () => {
  test('treats an exact aged wraparound reanchor as the same publication', () => {
    const previous = claim();
    const next = agedRepublish(previous, 0.1);

    expect(next.originS).toBeCloseTo(0, 12);
    expect(racecraftClaimsSharePublication(TRACK, previous, next))
      .toBe(true);
  });

  test('interpolates a reanchor seam as a signed correction, not a lap', () => {
    const previous = claim({
      originS: 40,
      originSpeed: 2,
      stations: [
        {
          index: 21, time: 1, s: 42, speed: 2, centre: 0,
          headingOffsetRadians: 0
        },
        {
          index: 21, time: 2, s: 41.9, speed: 2, centre: 0,
          headingOffsetRadians: 0
        }
      ]
    });

    expect(racecraftClaimStateAtTime(TRACK, previous, 1.5).s)
      .toBeCloseTo(41.95, 12);

    const acrossZero = claim({
      originS: 0.1,
      originSpeed: 0,
      stations: [
        {
          index: 0, time: 1, s: 99.9, speed: 0, centre: 0,
          headingOffsetRadians: 0
        }
      ]
    });
    expect(racecraftClaimStateAtTime(TRACK, acrossZero, 0.5).s)
      .toBeCloseTo(0, 12);
  });

  test('interpolates body orientation across the angular seam', () => {
    const previous = claim({
      originHeadingOffsetRadians: Math.PI - 0.1,
      stations: [{
        index: 0,
        time: 1,
        s: 9,
        speed: 10,
        centre: 0,
        headingOffsetRadians: -Math.PI + 0.1
      }]
    });

    expect(Math.abs(
      racecraftClaimStateAtTime(TRACK, previous, 0.5)
        .headingOffsetRadians
    )).toBeCloseTo(Math.PI, 12);
  });

  test('cannot amplify a local seam through repeated evaluation epochs', () => {
    let current = claim({
      originS: 40,
      originSpeed: 2,
      stations: [
        {
          index: 21, time: 1, s: 42, speed: 2, centre: 0,
          headingOffsetRadians: 0
        },
        {
          index: 21, time: 2, s: 41.9, speed: 2, centre: 0,
          headingOffsetRadians: 0
        }
      ]
    });
    for (let refresh = 1; refresh <= 40; refresh++) {
      current = racecraftClaimAtEvaluationEpoch(
        TRACK,
        current,
        current.publishedAt + 1 / 30
      ).claim;
      const points = [current.originS, ...current.stations.map(station =>
        station.s)];
      for (let index = 1; index < points.length; index++) {
        let distance = (
          points[index]! - points[index - 1]! + TRACK.len
        ) % TRACK.len;
        if (distance > TRACK.len / 2) distance -= TRACK.len;
        expect(Math.abs(distance)).toBeLessThan(TRACK.len / 2);
      }
      expect(points.every(point => point >= 0 && point < TRACK.len))
        .toBe(true);
    }
  });

  test('does not use the detection scale as publication identity', () => {
    const previous = claim();
    const inside = agedRepublish(previous, 0.1);
    inside.originCentre += 0.19;
    for (const station of inside.stations)
      station.centre += 0.19;
    inside.originS = (inside.originS + 0.1) % TRACK.len;
    inside.originSpeed += 1;
    for (const station of inside.stations) {
      station.s = (station.s + 0.1) % TRACK.len;
      station.speed += 1;
    }
    expect(racecraftClaimsSharePublication(TRACK, previous, inside))
      .toBe(false);

    const outside = agedRepublish(previous, 0.1);
    outside.originS = (outside.originS + 0.15) % TRACK.len;
    outside.originSpeed += 2;
    expect(racecraftClaimsSharePublication(TRACK, previous, outside))
      .toBe(false);
  });

  test('keys an installed-authority change even with identical points', () => {
    const previous = claim();
    const equivalent = agedRepublish(previous, 0.1);
    equivalent.lateralAuthorityRevision++;
    equivalent.longitudinalAuthorityRevision++;
    expect(racecraftClaimsSharePublication(TRACK, previous, equivalent))
      .toBe(false);

    const changed = agedRepublish(previous, 0.1);
    changed.lateralAuthorityRevision++;
    changed.originCentre +=
      previous.lateralTrackingErrorThresholdMetres + 1e-6;
    expect(racecraftClaimsSharePublication(TRACK, previous, changed))
      .toBe(false);
  });

  test('keys every body-orientation divergence', () => {
    const previous = claim();
    const inside = agedRepublish(previous, 0.1);
    inside.originHeadingOffsetRadians += Number.EPSILON;
    expect(racecraftClaimsSharePublication(TRACK, previous, inside))
      .toBe(false);

    const outside = agedRepublish(previous, 0.1);
    outside.originHeadingOffsetRadians += 0.1;
    expect(racecraftClaimsSharePublication(TRACK, previous, outside))
      .toBe(false);
  });

  test('keeps source, trust, and point-time grid discrete', () => {
    const previous = claim();
    const source = agedRepublish(previous, 0.1);
    source.source = 'rederived';
    expect(racecraftClaimsSharePublication(TRACK, previous, source))
      .toBe(false);

    const trust = agedRepublish(previous, 0.1);
    trust.trusted = false;
    expect(racecraftClaimsSharePublication(TRACK, previous, trust))
      .toBe(false);

    const grid = agedRepublish(previous, 0.1);
    grid.stations[0]!.time += Number.EPSILON;
    expect(racecraftClaimsSharePublication(TRACK, previous, grid))
      .toBe(false);
  });
});
