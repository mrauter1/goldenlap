import { describe, expect, test } from 'bun:test';

import { PHYS } from '../../../src/core/physics';
import {
  measuredContactGrindLossSeconds,
  measuredContactLossSeconds
} from '../../../src/session/racecraft/contact-loss';
import {
  nearRubExposureWeight,
  plannedNearRubExposureCost,
  type NearRubTrajectorySample
} from '../../../src/session/racecraft/near-rub';

const CLEARANCE_METRES = 0.15;

function sample(
  timeSeconds: number,
  bodyEdgeDaylightMetres: number,
  longitudinalCentreDistanceMetres = 0
): NearRubTrajectorySample {
  return {
    timeSeconds,
    longitudinalCentreDistanceMetres,
    lateralCentreDistanceMetres:
      PHYS.carWid + bodyEdgeDaylightMetres,
    egoHeadingOffsetRadians: 0,
    rivalHeadingOffsetRadians: 0
  };
}

function hold(
  durationSeconds: number,
  bodyEdgeDaylightMetres: number
) {
  return plannedNearRubExposureCost([
    sample(0, bodyEdgeDaylightMetres),
    sample(durationSeconds, bodyEdgeDaylightMetres)
  ], CLEARANCE_METRES);
}

describe('soft near-rub economics', () => {
  test('uses the continuous 0.15 m daylight ramp', () => {
    expect(nearRubExposureWeight(-0.01, CLEARANCE_METRES)).toBe(1);
    expect(nearRubExposureWeight(0, CLEARANCE_METRES)).toBe(1);
    expect(nearRubExposureWeight(
      CLEARANCE_METRES / 2,
      CLEARANCE_METRES
    )).toBeCloseTo(0.5, 14);
    expect(nearRubExposureWeight(
      CLEARANCE_METRES,
      CLEARANCE_METRES
    )).toBe(0);
    expect(nearRubExposureWeight(
      CLEARANCE_METRES + 0.01,
      CLEARANCE_METRES
    )).toBe(0);

    const crossing = plannedNearRubExposureCost([
      sample(0, 0),
      sample(1, CLEARANCE_METRES)
    ], CLEARANCE_METRES);
    expect(crossing.equivalentSeconds).toBeCloseTo(0.5, 14);
  });

  test('maps exact body-edge contact to grind-equivalent time only', () => {
    const oneSecond = hold(1, 0);
    expect(oneSecond.alongsideEpisodes).toBe(1);
    expect(oneSecond.equivalentSeconds).toBe(1);
    expect(oneSecond.lossSeconds)
      .toBe(measuredContactGrindLossSeconds(1));
    expect(oneSecond.lossSeconds).not.toBe(
      measuredContactGrindLossSeconds(1) +
      measuredContactLossSeconds(1.7951962222222224)
    );
  });

  test('keeps legal daylight free and persistent near-rub expensive', () => {
    const legal = hold(2, CLEARANCE_METRES);
    const brief = hold(0.2, 0);
    const persistent = hold(2, 0);
    expect(legal.equivalentSeconds).toBe(0);
    expect(legal.lossSeconds).toBe(0);
    expect(brief.lossSeconds).toBeGreaterThan(0);
    expect(persistent.lossSeconds).toBeGreaterThan(brief.lossSeconds);
  });

  test('prices disconnected alongside episodes separately', () => {
    const disconnected = plannedNearRubExposureCost([
      sample(0, 0, 0),
      sample(0.5, 0, 0),
      sample(0.6, 0, 10),
      sample(1.1, 0, 10),
      sample(1.2, 0, 0),
      sample(1.7, 0, 0)
    ], CLEARANCE_METRES);

    expect(disconnected.alongsideEpisodes).toBe(2);
    expect(disconnected.lossSeconds).toBeCloseTo(
      2 * measuredContactGrindLossSeconds(
        disconnected.equivalentSeconds / 2
      ),
      12
    );
    expect(disconnected.lossSeconds).not.toBeCloseTo(
      measuredContactGrindLossSeconds(
        disconnected.equivalentSeconds
      ),
      6
    );
  });

  test('sums independent rival costs without concatenating durations', () => {
    const first = hold(0.5, 0);
    const second = hold(0.5, 0);
    const separatelyPriced = first.lossSeconds + second.lossSeconds;
    expect(separatelyPriced).toBeCloseTo(
      2 * measuredContactGrindLossSeconds(0.5),
      14
    );
    expect(separatelyPriced).not.toBeCloseTo(
      measuredContactGrindLossSeconds(1),
      6
    );
  });

  test('excludes only an authorized displaced approach suffix', () => {
    const priced = plannedNearRubExposureCost([
      sample(0, 0),
      sample(3, 0)
    ], CLEARANCE_METRES, [{
      startTimeSeconds: 1,
      endTimeSeconds: 2
    }]);

    expect(priced.equivalentSeconds).toBeCloseTo(2, 14);
    expect(priced.alongsideEpisodes).toBe(2);
    expect(priced.lossSeconds).toBeCloseTo(
      2 * measuredContactGrindLossSeconds(1),
      14
    );
  });
});
