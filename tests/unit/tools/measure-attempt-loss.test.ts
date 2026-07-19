import { describe, expect, test } from 'bun:test';

import {
  MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE,
  MEASURED_ATTACK_TRANSITION_LOSS_SECONDS
} from '../../../src/session/racecraft/attempt-loss';
import { measureAttackTransitionLoss } from
  '../../../tools/measure-attempt-loss';

describe('attack-transition loss measurement', () => {
  test('reproduces the committed production-step class and refinement record', () => {
    const report = measureAttackTransitionLoss();
    const provenance = MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE;

    expect(report.completeDomain).toBe(true);
    expect(report.nonFiniteCandidates).toEqual([]);
    expect(report.trackIds).toEqual([...provenance.trackIds]);
    expect(report.productionClassCount).toBe(
      provenance.productionClassCount
    );
    expect(report.eligibleStraightCount).toBe(
      provenance.eligibleStraightCount
    );
    expect(report.summary.sampleCount).toBe(provenance.sampleCount);
    expect(report.summary.lossMeanSeconds).toBe(
      MEASURED_ATTACK_TRANSITION_LOSS_SECONDS
    );
    expect(report.summary.residualMeanSeconds).toBe(
      provenance.residualMeanSeconds
    );
    expect(report.convergence.refinedLossMeanSeconds).toBe(
      provenance.convergence.refinedLossMeanSeconds
    );
    expect(report.convergence.aggregateLossMeanDifferenceSeconds).toBe(
      provenance.convergence.aggregateLossMeanDifferenceSeconds
    );
    expect(report.convergence.refinedLossMeanSeconds)
      .toBeGreaterThan(report.summary.lossMeanSeconds);
  }, 30_000);
});
