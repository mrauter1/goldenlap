import { describe, expect, test } from 'bun:test';

import {
  CAR_COLLISION_CONTACT_SLOP_METRES,
  HARD_CONTACT_IMPULSE
} from '../../../src/core/collision';
import { PHYS } from '../../../src/core/physics';
import {
  MEASURED_CONTACT_GRIND_LOSS,
  MEASURED_CONTACT_GRIND_LOSS_PROVENANCE,
  MEASURED_CONTACT_LOSS,
  MEASURED_CONTACT_LOSS_PROVENANCE,
  measuredContactEpisodeLossSeconds,
  measuredContactGrindLossSeconds,
  measuredContactLossSeconds,
  measuredContactRecoverySeconds
} from '../../../src/session/racecraft/contact-loss';
import {
  measureContactGrindLossCurve,
  measureContactLossCurve,
  measureParallelHoldContactRateCurve
} from '../../../tools/measure-contact-loss';

describe('measured physical contact loss', () => {
  test('is the reproducible committed output of production contact physics', () => {
    const first = measureContactLossCurve();
    const second = measureContactLossCurve();
    expect(second).toEqual(first);

    const { kind, rows, ...provenance } = first;
    expect(kind).toBe('measured-contact-loss');
    expect(provenance).toEqual(MEASURED_CONTACT_LOSS_PROVENANCE);
    expect(rows.map(row => ({
      relativeNormalSpeedMetresPerSecond:
        row.measuredRelativeNormalSpeed,
      recoverySeconds: row.recoverySeconds,
      secondsLost: row.secondsLost
    }))).toEqual([...MEASURED_CONTACT_LOSS]);
    for (const row of rows)
      expect(row.measuredRelativeNormalSpeed)
        .toBe(row.requestedRelativeNormalSpeed);
  });

  test('keeps every measured knot and interpolates both contact classes without reshaping', () => {
    expect(MEASURED_CONTACT_LOSS[0])
      .toEqual({
        relativeNormalSpeedMetresPerSecond: 0,
        recoverySeconds: 0,
        secondsLost: 0
      });
    expect(MEASURED_CONTACT_LOSS.at(-1)!
      .relativeNormalSpeedMetresPerSecond).toBe(2 * PHYS.vTop);
    expect(MEASURED_CONTACT_LOSS_PROVENANCE
      .hardContactBoundaryMetresPerSecond).toBe(HARD_CONTACT_IMPULSE);
    expect(Number(MEASURED_CONTACT_LOSS_PROVENANCE
      .maximumRelativeNormalSpeedMetresPerSecond)).toBe(2 * PHYS.vTop);
    expect(measuredContactLossSeconds(0)).toBe(0);
    expect(MEASURED_CONTACT_LOSS.some(point =>
      point.relativeNormalSpeedMetresPerSecond === HARD_CONTACT_IMPULSE
    )).toBe(true);

    let observedPhysicalDecrease = false;
    for (let index = 1; index < MEASURED_CONTACT_LOSS.length; index++) {
      const lower = MEASURED_CONTACT_LOSS[index - 1]!;
      const upper = MEASURED_CONTACT_LOSS[index]!;
      expect(upper.relativeNormalSpeedMetresPerSecond)
        .toBeGreaterThan(lower.relativeNormalSpeedMetresPerSecond);
      expect(Number.isFinite(upper.secondsLost)).toBe(true);
      expect(Number.isFinite(upper.recoverySeconds)).toBe(true);
      expect(upper.secondsLost).toBeGreaterThanOrEqual(0);
      expect(upper.recoverySeconds).toBeGreaterThanOrEqual(0);
      if (upper.secondsLost < lower.secondsLost)
        observedPhysicalDecrease = true;

      const middle = (
        lower.relativeNormalSpeedMetresPerSecond +
        upper.relativeNormalSpeedMetresPerSecond
      ) / 2;
      const interpolatedLoss = measuredContactLossSeconds(middle);
      const interpolatedRecovery =
        measuredContactRecoverySeconds(middle);
      expect(interpolatedLoss).toBeCloseTo(
        (lower.secondsLost + upper.secondsLost) / 2,
        14
      );
      expect(interpolatedRecovery).toBeCloseTo(
        (lower.recoverySeconds + upper.recoverySeconds) / 2,
        14
      );
    }
    expect(observedPhysicalDecrease).toBe(true);
  });

  test('supplies physical loss above the hard boundary but never extrapolates', () => {
    const hard = MEASURED_CONTACT_LOSS.find(point =>
      point.relativeNormalSpeedMetresPerSecond === HARD_CONTACT_IMPULSE
    )!;
    expect(measuredContactLossSeconds(HARD_CONTACT_IMPULSE))
      .toBe(hard.secondsLost);
    expect(measuredContactRecoverySeconds(HARD_CONTACT_IMPULSE))
      .toBe(hard.recoverySeconds);
    expect(measuredContactLossSeconds(
      HARD_CONTACT_IMPULSE + Number.EPSILON * HARD_CONTACT_IMPULSE
    )).toBeGreaterThanOrEqual(0);
    expect(measuredContactLossSeconds(2 * PHYS.vTop))
      .toBe(MEASURED_CONTACT_LOSS.at(-1)!.secondsLost);
    expect(() => measuredContactLossSeconds(
      2 * PHYS.vTop + Number.EPSILON * 2 * PHYS.vTop
    )).toThrow('measured physical curve');
    expect(() => measuredContactLossSeconds(-Number.EPSILON)).toThrow();
    expect(() => measuredContactRecoverySeconds(Number.NaN)).toThrow();
  });

  test('measures sustained pressure independently of the initial strike', () => {
    const first = measureContactGrindLossCurve();
    const second = measureContactGrindLossCurve();
    expect(second).toEqual(first);

    const { kind, rows, ...provenance } = first;
    expect(kind).toBe('measured-contact-grind-loss');
    expect(provenance).toEqual(MEASURED_CONTACT_GRIND_LOSS_PROVENANCE);
    expect(rows.map(row => ({
      durationSeconds: row.durationSeconds,
      additionalSecondsLost: row.additionalSecondsLost
    }))).toEqual([...MEASURED_CONTACT_GRIND_LOSS]);
    expect(rows[0]!.totalSecondsLost)
      .toBe(first.baselineSingleStrikeLossSeconds);
    expect(rows[0]!.additionalSecondsLost).toBe(0);
    expect(rows.at(-1)!.impactCount).toBeGreaterThan(1);
  });

  test('preserves the nonlinear duration response instead of fitting a scalar rate', () => {
    for (let index = 1;
      index < MEASURED_CONTACT_GRIND_LOSS.length;
      index++) {
      const lower = MEASURED_CONTACT_GRIND_LOSS[index - 1]!;
      const upper = MEASURED_CONTACT_GRIND_LOSS[index]!;
      expect(upper.durationSeconds).toBeGreaterThan(lower.durationSeconds);
      expect(upper.additionalSecondsLost)
        .toBeGreaterThanOrEqual(lower.additionalSecondsLost);
      expect(measuredContactGrindLossSeconds(upper.durationSeconds))
        .toBe(upper.additionalSecondsLost);

      const middle = (lower.durationSeconds + upper.durationSeconds) / 2;
      expect(measuredContactGrindLossSeconds(middle)).toBeCloseTo(
        (lower.additionalSecondsLost + upper.additionalSecondsLost) / 2,
        14
      );
    }

    const first = MEASURED_CONTACT_GRIND_LOSS[1]!;
    const last = MEASURED_CONTACT_GRIND_LOSS.at(-1)!;
    expect(last.additionalSecondsLost / last.durationSeconds)
      .toBeGreaterThan(
        first.additionalSecondsLost / first.durationSeconds
      );
    expect(() => measuredContactGrindLossSeconds(
      last.durationSeconds +
        MEASURED_CONTACT_GRIND_LOSS_PROVENANCE.durationStepSeconds
    )).toThrow('measured sustained-contact curve');
    expect(() => measuredContactGrindLossSeconds(-Number.EPSILON)).toThrow();
    expect(() => measuredContactGrindLossSeconds(Number.NaN)).toThrow();
  });

  test('charges a fresh strike and grind bill after separation', () => {
    const episodes = [
      {
        initialRelativeNormalSpeed: 3,
        durationSeconds: 0.1
      },
      {
        initialRelativeNormalSpeed: 5,
        durationSeconds: 0.2
      }
    ];

    expect(measuredContactEpisodeLossSeconds(episodes)).toBeCloseTo(
      measuredContactLossSeconds(3) +
      measuredContactGrindLossSeconds(0.1) +
      measuredContactLossSeconds(5) +
      measuredContactGrindLossSeconds(0.2),
      12
    );
  });

  test('records the non-stationary parallel-hold blocker without minting a rate curve', () => {
    const first = measureParallelHoldContactRateCurve();
    const second = measureParallelHoldContactRateCurve();
    expect(second).toEqual(first);

    expect(first.kind).toBe('measured-parallel-hold-contact-rate');
    expect(first.physicsStepSeconds).toBe(1 / 120);
    expect(first.controlStepSeconds).toBe(1 / 60);
    expect(first.bodyContactCentreSeparationMetres).toBe(
      2 * PHYS.colR2 - CAR_COLLISION_CONTACT_SLOP_METRES
    );
    expect(first.maximumClearanceMetres).toBe(PHYS.carWid);
    expect(first.clearanceStepMetres).toBe(
      PHYS.carWid /
      first.convergence.refinedClearanceIntervalCount
    );
    expect(first.convergence.refinedClearanceIntervalCount).toBe(
      2 * first.convergence.baseClearanceIntervalCount
    );
    expect(first.exposureSecondsPerScenario).toBe(
      2 * first.convergence.baseExposureSecondsPerScenario
    );
    expect(first.minimumStraightDistanceMetres).toBe(
      first.settleDistanceMetres +
      PHYS.vTop * first.exposureSecondsPerScenario
    );
    expect(first.sourceTrackIds).toEqual([
      'prado',
      'costa',
      'nordwald',
      'anhembi',
      'cerro',
      'ardenne',
      'paulista'
    ]);
    expect(first.scenarioCountPerClearance).toBe(14);
    expect(first.analyticGaussianUsedAsSource).toBe(false);

    const observed = first.rows.filter(
      row => row.episodeStarts > 0
    );
    expect(observed.map(row => row.clearanceMetres)).toEqual([
      0,
      1 / 12,
      1 / 6
    ]);
    expect(observed.map(row => row.baseExposureEpisodeStarts)).toEqual([
      7,
      2,
      1
    ]);
    expect(observed.map(row => row.episodeStarts)).toEqual([8, 2, 1]);
    expect(observed.every(row =>
      row.meanEpisodeDurationSeconds === first.physicsStepSeconds &&
      row.directSecondsLost > 0
    )).toBe(true);
    expect(first.rows.slice(3).every(row =>
      row.episodeStarts === 0 &&
      row.contactStepSeconds === 0 &&
      row.directSecondsLost === 0
    )).toBe(true);
    expect(first.rows.every(row =>
      row.offSurfaceTerminations === 0
    )).toBe(true);

    const zero = first.rows[0]!;
    expect(zero.baseExposureEpisodeStartsPerSecond).toBe(
      7 / zero.baseExposureSeconds
    );
    expect(zero.episodeStartsPerSecond).toBe(
      8 / zero.exposureSeconds
    );
    expect(first.convergence
      .maximumEpisodeRateExposureDifferencePerSecond).toBe(
        zero.baseExposureEpisodeStartsPerSecond -
        zero.episodeStartsPerSecond
      );
    expect(first.convergence
      .maximumEpisodeRateExposureDifferencePerSecond).toBeGreaterThan(0);
    expect(first.convergence
      .exposureConvergedAtNumericalPrecision).toBe(false);
  }, 20_000);
});
