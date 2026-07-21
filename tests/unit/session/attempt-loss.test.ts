import { describe, expect, test } from 'bun:test';

import {
  MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE,
  MEASURED_ATTACK_TRANSITION_LOSS_SECONDS,
  attackTransitionLossSeconds,
  measuredAttackTransitionLossSeconds,
  residualAttackTransitionSeconds,
  summarizeMeasuredAttackTransitionLoss,
  type MeasuredAttackTransitionLossPoint
} from '../../../src/session/racecraft/attempt-loss';

function point(
  residualSeconds: number
): MeasuredAttackTransitionLossPoint {
  return {
    trackId: 'prado',
    straightId: 'straight',
    productionClass: 'test',
    side: 1,
    initialSpeedMetresPerSecond: 60,
    commonProgressDistanceMetres: 144,
    attackArrivalSeconds: 2.6,
    stayBehindArrivalSeconds: 2.4,
    attackOwnTimeSeconds: 0.2 - residualSeconds,
    stayBehindOwnTimeSeconds: 0,
    residualSeconds,
    lossSeconds: Math.max(0, residualSeconds)
  };
}

describe('measured attack-transition loss', () => {
  test('publishes the complete production-step measured class', () => {
    expect(MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE.completeDomain)
      .toBe(true);
    expect(
      MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE.nonFiniteCandidateCount
    ).toBe(0);
    expect(MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE.sampleCount)
      .toBe(1803);
    expect(MEASURED_ATTACK_TRANSITION_LOSS_SECONDS)
      .toBe(0.06674665779269824);
    expect(measuredAttackTransitionLossSeconds())
      .toBe(MEASURED_ATTACK_TRANSITION_LOSS_SECONDS);
    expect(
      MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE.convergence
        .aggregateLossMeanDifferenceSeconds
    ).toBe(0.003807661811085994);
    expect(
      MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE.convergence.errorDirection
    ).toContain('increases');
  });

  test('removes deterministic own-path time exactly once', () => {
    expect(residualAttackTransitionSeconds(
      2.75,
      2.4,
      0.2,
      0.05
    )).toBeCloseTo(0.2, 14);
    expect(attackTransitionLossSeconds(
      2.75,
      2.4,
      0.2,
      0.05
    )).toBeCloseTo(0.2, 14);
  });

  test('records a measured gain but never turns it into a negative bill', () => {
    expect(residualAttackTransitionSeconds(
      2.4,
      2.5,
      0.2,
      0
    )).toBeCloseTo(-0.3, 14);
    expect(attackTransitionLossSeconds(
      2.4,
      2.5,
      0.2,
      0
    )).toBe(0);
  });

  test('summarizes the complete measured domain without a fitted statistic', () => {
    expect(summarizeMeasuredAttackTransitionLoss([
      point(-0.1),
      point(0.2),
      point(0.5)
    ])).toEqual({
      sampleCount: 3,
      residualMeanSeconds: 0.19999999999999998,
      residualMinimumSeconds: -0.1,
      residualMaximumSeconds: 0.5,
      lossMeanSeconds: 0.2333333333333333,
      lossMaximumSeconds: 0.5
    });
  });

  test('rejects invalid or inconsistently priced measurements', () => {
    expect(() => residualAttackTransitionSeconds(
      Infinity,
      2,
      0,
      0
    )).toThrow();
    expect(() => summarizeMeasuredAttackTransitionLoss([])).toThrow();
    expect(() => summarizeMeasuredAttackTransitionLoss([
      { ...point(-0.1), lossSeconds: 0.1 }
    ])).toThrow();
  });
});
