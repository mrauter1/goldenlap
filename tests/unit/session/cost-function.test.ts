import { describe, expect, test } from 'bun:test';
import {
  directionalCandidateObjectiveSeconds,
  pairwiseDifferenceTieBand
} from '../../../src/session/racecraft/cost-function';

describe('racecraft cost-function primitives', () => {
  test('forms the tie band from pairwise differences', () => {
    const band = pairwiseDifferenceTieBand(
      { incumbentSeconds: 10, candidateSeconds: 9.8 },
      [
        { incumbentSeconds: 13, candidateSeconds: 12.8 },
        { incumbentSeconds: 9.9, candidateSeconds: 10.1 },
        { incumbentSeconds: 10.4, candidateSeconds: 9.7 }
      ]
    );
    expect(band).toBeCloseTo(0.5, 12);
    expect(pairwiseDifferenceTieBand(
      { incumbentSeconds: 2, candidateSeconds: 1 },
      [{ incumbentSeconds: 12, candidateSeconds: 11 }]
    )).toBe(0);
  });

  test('charges the near-rub decomposition scalar exactly once', () => {
    expect(directionalCandidateObjectiveSeconds({
      physicalSeconds: 0.2,
      positionValueSeconds: 0.3,
      attemptLossSeconds: 0.4,
      nearRubLossSeconds: 0.5
    })).toBeCloseTo(1.4, 14);
  });
});
