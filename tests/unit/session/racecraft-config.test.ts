import { describe, expect, test } from 'bun:test';
import {
  RACECRAFT_CALIBRATION_DEFAULTS,
  RACECRAFT_CALIBRATION_DEFINITIONS,
  RACECRAFT_RESOLUTION_DEFAULTS,
  racecraftCalibration,
  racecraftResolution,
  withRacecraftCalibration,
  withRacecraftResolution
} from '../../../src/session/racecraft/config';
import {
  maneuverPredictionStationTime,
  MANEUVER_PREDICTION
} from '../../../src/session/racecraft/feasibility';
import { TRAF_DT } from '../../../src/session/strategy';

describe('global racecraft calibration surface', () => {
  test('contains only sourced physical and behavioral calibration', () => {
    expect(RACECRAFT_CALIBRATION_DEFINITIONS.length).toBeLessThanOrEqual(11);
    expect(new Set(RACECRAFT_CALIBRATION_DEFINITIONS.map(item => item.key)).size)
      .toBe(RACECRAFT_CALIBRATION_DEFINITIONS.length);
    expect(RACECRAFT_CALIBRATION_DEFINITIONS.map(item => String(item.key)).sort())
      .toEqual(Object.keys(RACECRAFT_CALIBRATION_DEFAULTS).sort());
    for (const definition of RACECRAFT_CALIBRATION_DEFINITIONS) {
      const value = RACECRAFT_CALIBRATION_DEFAULTS[definition.key];
      expect(value).toBeGreaterThanOrEqual(definition.minimum);
      expect(value).toBeLessThanOrEqual(definition.maximum);
      expect(definition.unit.length).toBeGreaterThan(0);
      expect(definition.owner.length).toBeGreaterThan(0);
      expect(definition.rationale.length).toBeGreaterThan(0);
    }
    expect(RACECRAFT_CALIBRATION_DEFAULTS.nearRubClearanceMetres)
      .toBe(0.15);
    expect(RACECRAFT_CALIBRATION_DEFINITIONS.find(definition =>
      definition.key === 'nearRubClearanceMetres'
    )).toMatchObject({
      unit: 'm',
      owner: 'sporting near-rub preference'
    });
    expect(RACECRAFT_CALIBRATION_DEFAULTS.defensiveBlockNoticeSeconds)
      .toBe(1);
    expect(RACECRAFT_CALIBRATION_DEFINITIONS.find(definition =>
      definition.key === 'defensiveBlockNoticeSeconds'
    )).toMatchObject({
      unit: 's',
      owner: 'sporting defensive-block safety'
    });
  });

  test('applies a scoped override and restores defaults even after an error', () => {
    const before = racecraftCalibration();
    expect(withRacecraftCalibration({ towDragReduction: 0.2 }, () =>
      racecraftCalibration().towDragReduction)).toBe(0.2);
    expect(racecraftCalibration()).toBe(before);
    expect(() => withRacecraftCalibration(
      { towDragReduction: 99 },
      () => null
    )).toThrow('towDragReduction');
    expect(() => withRacecraftCalibration({ wakeSpreadRate: 0.06 }, () => {
      throw new Error('probe');
    })).toThrow('probe');
    expect(racecraftCalibration()).toBe(before);
  });

  test('scopes numerical resolution without changing production defaults', () => {
    const before = racecraftResolution();
    expect(before).toBe(RACECRAFT_RESOLUTION_DEFAULTS);
    expect(MANEUVER_PREDICTION.samples).toBe(12);
    expect(withRacecraftResolution({
      stationSamples: 24
    }, () => ({
      resolution: racecraftResolution(),
      samples: MANEUVER_PREDICTION.samples
    }))).toEqual({
      resolution: {
        stationSamples: 24
      },
      samples: 24
    });
    expect(racecraftResolution()).toBe(before);
    expect(MANEUVER_PREDICTION.samples).toBe(12);
    expect(() => withRacecraftResolution(
      { stationSamples: 0 },
      () => null
    )).toThrow('stationSamples');
    expect(() => withRacecraftResolution({
      stationSamples: 24
    }, () => {
      throw new Error('resolution-probe');
    })).toThrow('resolution-probe');
    expect(racecraftResolution()).toBe(before);
  });

  test('samples the next observation exactly before spanning the horizon', () => {
    const times = Array.from(
      { length: MANEUVER_PREDICTION.samples + 1 },
      (_, sample) => maneuverPredictionStationTime(sample)
    );

    expect(times[0]).toBe(0);
    expect(times[1]).toBe(TRAF_DT);
    expect(times.at(-1)).toBe(MANEUVER_PREDICTION.horizonSeconds);
    for (let index = 1; index < times.length; index++)
      expect(times[index]).toBeGreaterThan(times[index - 1]!);
  });
});
