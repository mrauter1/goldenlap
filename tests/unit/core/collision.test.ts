import { describe, expect, test } from 'bun:test';

import {
  CAR_COLLISION_AXLE_OFFSET_METRES,
  CAR_COLLISION_CONTACT_SLOP_METRES,
  carBodyCircleClearance,
  collideCars,
  sweptCarContactEpisodes,
  sweptCarContactIntervals,
  sweptCarMinimumClearance
} from '../../../src/core/collision';
import { PHYS } from '../../../src/core/physics';
import { makeCar } from '../../../src/core/physics-engine';

describe('capsule collision resolution', () => {
  test('sweeps the production four-circle body without station tunnelling', () => {
    const from = -8;
    const to = 8;
    const intervals = sweptCarContactIntervals(
      from,
      0,
      to,
      0,
      0,
      0
    );
    const bodyReach =
      2 * CAR_COLLISION_AXLE_OFFSET_METRES +
      2 * PHYS.colR2 -
      CAR_COLLISION_CONTACT_SLOP_METRES;

    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.enterFraction).toBeCloseTo(
      (-bodyReach - from) / (to - from),
      12
    );
    expect(intervals[0]!.leaveFraction).toBeCloseTo(
      (bodyReach - from) / (to - from),
      12
    );
    expect(intervals[0]!.normalLongitudinal).toBeCloseTo(-1, 12);
    expect(intervals[0]!.normalLateral).toBeCloseTo(0, 12);
  });

  test('distinguishes maintained overlap from separated static bodies', () => {
    expect(sweptCarContactIntervals(
      0,
      PHYS.carWid - 0.1,
      0,
      PHYS.carWid - 0.1,
      0,
      0
    )).toEqual([{
      enterFraction: 0,
      leaveFraction: 1,
      normalLongitudinal: 0,
      normalLateral: 1
    }]);
    expect(sweptCarContactIntervals(
      0,
      PHYS.carWid + 0.1,
      0,
      PHYS.carWid + 0.1,
      0,
      0
    )).toHaveLength(0);
  });

  test('reports signed clearance from the production body geometry', () => {
    expect(carBodyCircleClearance(
      0,
      PHYS.carWid - 0.1,
      0,
      0
    )).toBeLessThan(0);
    expect(carBodyCircleClearance(
      0,
      PHYS.carWid + 0.1,
      0,
      0
    )).toBeGreaterThan(0);

    const lateralContactDistance =
      2 * PHYS.colR2 - CAR_COLLISION_CONTACT_SLOP_METRES;
    expect(carBodyCircleClearance(
      0,
      lateralContactDistance,
      0,
      0
    )).toBeCloseTo(0, 12);
  });

  test('finds the binding clearance between trajectory endpoints', () => {
    const closest = sweptCarMinimumClearance(
      -5,
      PHYS.carWid + 0.1,
      5,
      PHYS.carWid + 0.1,
      0,
      0
    );

    expect(closest.fraction).toBeCloseTo(0.5, 12);
    expect(closest.clearanceMetres).toBeGreaterThan(0);
    expect(closest.clearanceMetres).toBeLessThan(0.2);
  });

  test('prices separated re-contacts as distinct body episodes', () => {
    const episodes = sweptCarContactEpisodes([
      {
        timeSeconds: 0,
        relativeLongitudinal: -8,
        relativeLateral: 0,
        egoHeadingRadians: 0,
        rivalHeadingRadians: 0
      },
      {
        timeSeconds: 1,
        relativeLongitudinal: 8,
        relativeLateral: 0,
        egoHeadingRadians: 0,
        rivalHeadingRadians: 0
      },
      {
        timeSeconds: 2,
        relativeLongitudinal: -8,
        relativeLateral: 0,
        egoHeadingRadians: 0,
        rivalHeadingRadians: 0
      }
    ]);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.endTimeSeconds)
      .toBeLessThan(episodes[1]!.startTimeSeconds);
    expect(episodes.every(episode =>
      episode.initialRelativeNormalSpeed > 0 &&
      episode.durationSeconds > 0)).toBe(true);
  });

  test('uses explicit body heading rather than trajectory direction', () => {
    const poses = (rivalHeadingRadians: number) => [
      {
        timeSeconds: 0,
        relativeLongitudinal: 0,
        relativeLateral: 4,
        egoHeadingRadians: 0,
        rivalHeadingRadians
      },
      {
        timeSeconds: 1,
        relativeLongitudinal: 0,
        relativeLateral: 2.5,
        egoHeadingRadians: 0,
        rivalHeadingRadians
      }
    ];

    expect(sweptCarContactEpisodes(poses(0))).toHaveLength(0);
    expect(sweptCarContactEpisodes(poses(Math.PI / 2))).toHaveLength(1);
  });

  test('clears a light lateral overlap by numerical epsilon only', () => {
    const first = makeCar(0, 0, 0);
    const second = makeCar(0, PHYS.carWid - 0.1, 0);
    first.vy = 0.5;
    second.vy = -0.5;

    const impacts = collideCars([first, second]);

    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.imp).toBeLessThanOrEqual(1);
    expect(second.y - first.y).toBeGreaterThan(PHYS.carWid);
    expect(collideCars([first, second])).toHaveLength(0);
  });
});
