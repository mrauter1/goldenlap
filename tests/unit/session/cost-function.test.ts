import { describe, expect, test } from 'bun:test';
import {
  arrivalQuantizedResponsibility,
  pairwiseDifferenceTieBand,
  responseSlack
} from '../../../src/session/racecraft/cost-function';

describe('racecraft cost-function primitives', () => {
  test('smooths responsibility over decision-time quantization', () => {
    const later = arrivalQuantizedResponsibility(0.5, 0.5);
    const earlier = arrivalQuantizedResponsibility(-0.5, 0.5);
    expect(later).toBeCloseTo(0.841344746, 6);
    expect(earlier).toBeCloseTo(1 - later, 6);
    expect(arrivalQuantizedResponsibility(0, 0.5)).toBe(0.5);
    expect(arrivalQuantizedResponsibility(0, 0)).toBe(0.5);
    expect(arrivalQuantizedResponsibility(0.01, 0)).toBe(1);
    expect(arrivalQuantizedResponsibility(-0.01, 0)).toBe(0);
  });

  test('subtracts the next-decision interval exactly once from slack', () => {
    const slack = responseSlack({
      timeToHazardSeconds: 1.2,
      actuationSeconds: 0.1,
      completionSeconds: 0.6,
      nextDecisionSeconds: 0.1
    });
    expect(slack.nowSeconds).toBeCloseTo(0.5, 12);
    expect(slack.waitSeconds).toBeCloseTo(0.4, 12);
    expect(slack.nowSeconds - slack.waitSeconds).toBeCloseTo(0.1, 12);
  });

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

  test('rejects invalid timing and quantization inputs', () => {
    expect(() => arrivalQuantizedResponsibility(0, -1)).toThrow();
    expect(() => responseSlack({
      timeToHazardSeconds: 1,
      actuationSeconds: 0,
      completionSeconds: 0,
      nextDecisionSeconds: -0.1
    })).toThrow();
  });
});
