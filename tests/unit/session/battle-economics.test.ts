import { describe, expect, test } from 'bun:test';

import {
  PACE_POSITION_VALUE_WEIGHTS,
  battleSpendSeconds,
  createNormalizedPairPaceEvidence,
  createOpportunityIntervalEvidence,
  normalizedProgressTimeRatio,
  pacePositionValueWeight,
  pairPaceDifferentialSecondsPerLap,
  positionValueSeconds,
  reopportunitySeconds,
  updateNormalizedPairPaceEvidence,
  updateOpportunityIntervalEvidence
} from '../../../src/session/racecraft/battle-economics';

describe('battle economics', () => {
  test('declares pace value as strategy content', () => {
    expect(PACE_POSITION_VALUE_WEIGHTS).toEqual([
      { pace: 0, name: 'save', weight: 0.5, source: 'strategy' },
      { pace: 1, name: 'race', weight: 1, source: 'strategy' },
      { pace: 2, name: 'push', weight: 2, source: 'strategy' }
    ]);
    expect([0, 1, 2].map(pace =>
      pacePositionValueWeight(pace as 0 | 1 | 2)
    )).toEqual([0.5, 1, 2]);
  });

  test('updates normalized progress-time pace with measured opportunity decay', () => {
    const initial = createNormalizedPairPaceEvidence(1, 1);
    const updated = updateNormalizedPairPaceEvidence(initial, {
      elapsedSeconds: 10,
      egoReferenceProgressSeconds: 10,
      rivalReferenceProgressSeconds: 8,
      reopportunitySeconds: 20
    });
    const retained = Math.exp(-0.5);
    expect(updated.egoProgressTimeRatio).toBe(1);
    expect(updated.rivalProgressTimeRatio).toBeCloseTo(
      retained + (1 - retained) * 1.25,
      14
    );
    expect(pairPaceDifferentialSecondsPerLap(updated, 80))
      .toBeCloseTo(80 * (1 - retained) * 0.25, 12);
    expect(normalizedProgressTimeRatio(10, 8)).toBe(1.25);
  });

  test('converges under finer observation sampling', () => {
    const initial = createNormalizedPairPaceEvidence(1.1, 0.95);
    const oneStep = updateNormalizedPairPaceEvidence(initial, {
      elapsedSeconds: 10,
      egoReferenceProgressSeconds: 10,
      rivalReferenceProgressSeconds: 8,
      reopportunitySeconds: 20
    });
    const halfStep = {
      elapsedSeconds: 5,
      egoReferenceProgressSeconds: 5,
      rivalReferenceProgressSeconds: 4,
      reopportunitySeconds: 20
    };
    const twoSteps = updateNormalizedPairPaceEvidence(
      updateNormalizedPairPaceEvidence(initial, halfStep),
      halfStep
    );
    expect(twoSteps.egoProgressTimeRatio)
      .toBeCloseTo(oneStep.egoProgressTimeRatio, 14);
    expect(twoSteps.rivalProgressTimeRatio)
      .toBeCloseTo(oneStep.rivalProgressTimeRatio, 14);
  });

  test('measures only passing-opportunity onset intervals', () => {
    let evidence = createOpportunityIntervalEvidence();
    expect(reopportunitySeconds(evidence, 80)).toBe(80);

    evidence = updateOpportunityIntervalEvidence(evidence, {
      nowSeconds: 10,
      opportunityPresent: true
    });
    evidence = updateOpportunityIntervalEvidence(evidence, {
      nowSeconds: 20,
      opportunityPresent: true
    });
    evidence = updateOpportunityIntervalEvidence(evidence, {
      nowSeconds: 30,
      opportunityPresent: false
    });
    evidence = updateOpportunityIntervalEvidence(evidence, {
      nowSeconds: 70,
      opportunityPresent: true
    });
    expect(evidence.measuredIntervals).toBe(1);
    expect(reopportunitySeconds(evidence, 80)).toBe(60);

    evidence = updateOpportunityIntervalEvidence(evidence, {
      nowSeconds: 71,
      opportunityPresent: false
    });
    evidence = updateOpportunityIntervalEvidence(evidence, {
      nowSeconds: 190,
      opportunityPresent: true
    });
    expect(evidence.measuredIntervals).toBe(2);
    expect(reopportunitySeconds(evidence, 80)).toBe(90);
  });

  test('prices one opportunity in honest seconds', () => {
    const race = positionValueSeconds({
      pace: 1,
      paceDifferentialSecondsPerLap: 1.5,
      reopportunitySeconds: 100,
      referenceLapSeconds: 80
    });
    expect(race).toBeCloseTo(1.875, 14);
    expect(positionValueSeconds({
      pace: 0,
      paceDifferentialSecondsPerLap: 1.5,
      reopportunitySeconds: 100,
      referenceLapSeconds: 80
    })).toBeCloseTo(race / 2, 14);
    expect(positionValueSeconds({
      pace: 2,
      paceDifferentialSecondsPerLap: 1.5,
      reopportunitySeconds: 100,
      referenceLapSeconds: 80
    })).toBeCloseTo(race * 2, 14);
    expect(positionValueSeconds({
      pace: 2,
      paceDifferentialSecondsPerLap: -1,
      reopportunitySeconds: 100,
      referenceLapSeconds: 80
    })).toBe(0);
  });

  test('requires measured battle losses and sums them without a fallback', () => {
    expect(battleSpendSeconds({
      measuredAttemptLossSeconds: 0.42,
      contestSeconds: 0.18,
      measuredProximitySeconds: 0.07
    })).toBeCloseTo(0.67, 14);
    expect(() => battleSpendSeconds({
      measuredAttemptLossSeconds: -0.01,
      contestSeconds: 0,
      measuredProximitySeconds: 0
    })).toThrow();
  });

  test('rejects invalid pace and opportunity evidence', () => {
    expect(() => createNormalizedPairPaceEvidence(0, 1)).toThrow();
    expect(() => updateNormalizedPairPaceEvidence(
      createNormalizedPairPaceEvidence(1, 1),
      {
        elapsedSeconds: 1,
        egoReferenceProgressSeconds: 0,
        rivalReferenceProgressSeconds: 1,
        reopportunitySeconds: 80
      }
    )).toThrow();

    const opportunity = updateOpportunityIntervalEvidence(
      createOpportunityIntervalEvidence(),
      { nowSeconds: 2, opportunityPresent: false }
    );
    expect(() => updateOpportunityIntervalEvidence(opportunity, {
      nowSeconds: 1,
      opportunityPresent: true
    })).toThrow();
    expect(() => positionValueSeconds({
      pace: 1,
      paceDifferentialSecondsPerLap: 1,
      reopportunitySeconds: 80,
      referenceLapSeconds: 0
    })).toThrow();
  });
});
