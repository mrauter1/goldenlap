import { describe, expect, test } from 'bun:test';

import {
  HARD_CONTACT_IMPULSE,
  isHardContactImpulse
} from '../../../src/core/collision';
import type { HitPairMetric } from '../../../src/session/model';
import {
  recordContinuousContactStep,
  requiresContactRecovery
} from '../../../src/session/session';

describe('contact severity policy', () => {
  test('classifies only suspension-damaging impacts as hard', () => {
    expect(HARD_CONTACT_IMPULSE).toBe(16);
    expect(isHardContactImpulse(HARD_CONTACT_IMPULSE - 0.01)).toBe(false);
    expect(isHardContactImpulse(HARD_CONTACT_IMPULSE)).toBe(false);
    expect(isHardContactImpulse(HARD_CONTACT_IMPULSE + 0.01)).toBe(true);
    expect(isHardContactImpulse(Number.NaN)).toBe(false);
  });

  test('starts forced recovery only for hard contact or an unstable car', () => {
    expect(requiresContactRecovery(false, false, false)).toBe(false);
    expect(requiresContactRecovery(true, false, false)).toBe(true);
    expect(requiresContactRecovery(false, true, false)).toBe(true);
    expect(requiresContactRecovery(false, false, true)).toBe(true);
  });

  test('measures only consecutive production contact steps per pair', () => {
    const pair: HitPairMetric = {
      n: 0,
      hard: 0,
      side: 0,
      room: 0,
      max: 0,
      sumImp: 0,
      sumSep: 0,
      sumDs: 0,
      continuousContactSeconds: 0,
      maximumContinuousContactSeconds: 0,
      lastContactStep: -1,
      contactEpisodes: 0
    };
    const physicsStepSeconds = 1 / 120;

    recordContinuousContactStep(pair, 10, physicsStepSeconds);
    recordContinuousContactStep(pair, 11, physicsStepSeconds);
    recordContinuousContactStep(pair, 11, physicsStepSeconds);
    expect(pair.continuousContactSeconds).toBe(2 * physicsStepSeconds);
    expect(pair.maximumContinuousContactSeconds)
      .toBe(2 * physicsStepSeconds);
    expect(pair.contactEpisodes).toBe(1);

    // A physics step without an impact ends the episode. The historical
    // maximum remains bounded in the same per-pair record.
    recordContinuousContactStep(pair, 13, physicsStepSeconds);
    expect(pair.continuousContactSeconds).toBe(physicsStepSeconds);
    expect(pair.maximumContinuousContactSeconds)
      .toBe(2 * physicsStepSeconds);
    expect(pair.lastContactStep).toBe(13);
    expect(pair.contactEpisodes).toBe(2);
  });
});
