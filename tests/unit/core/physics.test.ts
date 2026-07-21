import { describe, expect, test } from 'bun:test';

import {
  availableDeceleration,
  brakingDistance,
  brakingSpeedCap,
  cornerSpeedForGrip,
  liftDeceleration,
  longitudinalAccelerationHeadroom,
  longitudinalGripHeadroomFraction,
  PHYS,
  wakeEffect,
  wakeStrength
} from '../../../src/core/physics';

describe('shared braking model', () => {
  test('uses one widening wake for drag and grip body coverage', () => {
    const parameters = { characteristicDistance: 32, spreadRate: 0.04 };
    const aligned = wakeEffect(10, 0, 60, parameters);
    const sideDraft = wakeEffect(30, 2.5, 60, parameters);
    const clear = wakeEffect(30, 3.2, 60, parameters);

    expect(aligned.drag).toBe(aligned.grip);
    expect(sideDraft.drag).toBeGreaterThan(0);
    expect(sideDraft.drag).toBeLessThan(aligned.drag);
    expect(clear).toEqual({ drag: 0, grip: 0 });
    expect(wakeStrength(
      30,
      2.5,
      60,
      parameters.characteristicDistance,
      parameters.spreadRate
    )).toBe(sideDraft.drag);
  });

  test('derives increasing grip from aero load and finite stopping distances', () => {
    expect(availableDeceleration(60)).toBeGreaterThan(availableDeceleration(10));
    expect(brakingDistance(60)).toBeGreaterThan(brakingDistance(30));
    expect(brakingDistance(0)).toBe(0);
  });

  test('solves one aero-coupled corner-speed law for every grip level', () => {
    const curvature = 0.018;
    const fresh = cornerSpeedForGrip(curvature, 1);
    const degraded = cornerSpeedForGrip(curvature, 0.62);

    expect(degraded).toBeLessThan(fresh);
    expect(degraded * degraded * curvature).toBeCloseTo(
      availableDeceleration(degraded, 0.62),
      8
    );
    expect(cornerSpeedForGrip(0, 0.2)).toBe(PHYS.vTop);
  });

  test('uses the same reduced aero load for cornering and braking', () => {
    const curvature = 0.018;
    const healthy = cornerSpeedForGrip(curvature, 1, 1);
    const damaged = cornerSpeedForGrip(curvature, 1, 0.82);

    expect(damaged).toBeLessThan(healthy);
    expect(availableDeceleration(damaged, 1, 0.82)).toBeCloseTo(
      damaged * damaged * curvature,
      8
    );
    expect(availableDeceleration(50, 1, 0.82))
      .toBeLessThan(availableDeceleration(50, 1, 1));
    expect(brakingDistance(50, 1, 1, 0.82))
      .toBeGreaterThan(brakingDistance(50, 1, 1, 1));
  });

  test('inverts its own stopping-distance law', () => {
    const speed = 54;
    const distance = brakingDistance(speed, 0.94, 0.7);
    expect(brakingSpeedCap(distance, 0, 0.94, 0.7)).toBeCloseTo(speed, 1);
    expect(brakingSpeedCap(distance + 30, 0, 0.94, 0.7)).toBeGreaterThan(speed);
    expect(brakingSpeedCap(0, 0, 1, 0.7)).toBeLessThan(PHYS.vTop * 0.01);
  });

  test('derives lift deceleration from the production drag and rolling law', () => {
    expect(liftDeceleration(0)).toBeCloseTo(PHYS.kRoll / PHYS.m, 12);
    expect(liftDeceleration(PHYS.vTop)).toBeGreaterThan(liftDeceleration(40));
  });

  test('derives longitudinal headroom from current corner load', () => {
    const leaderSpeed = 25;
    const totalGrip = availableDeceleration(leaderSpeed);
    const loadedCurvature = 0.9 * totalGrip / (leaderSpeed * leaderSpeed);

    expect(longitudinalAccelerationHeadroom(leaderSpeed, loadedCurvature))
      .toBeLessThan(totalGrip);
    expect(longitudinalGripHeadroomFraction(leaderSpeed, loadedCurvature))
      .toBeCloseTo(Math.sqrt(1 - 0.9 ** 2), 8);
  });
});
