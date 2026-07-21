import { describe, expect, test } from 'bun:test';

import {
  compactLateralGeometryAtProgress,
  sampleCompactLateralProgram,
  sampleTrackIdealLateralAnalytic
} from '../../../src/core/lateral-program';
import {
  numericArray,
  type CompactLateralProgram,
  type NumericArray,
  type SampledPath,
  type Track
} from '../../../src/core/model';

function samples(...values: number[]): NumericArray {
  const result = numericArray(values.length);
  result.set(values);
  return result;
}

function fixture(): Track {
  const ideal: SampledPath = {
    mode: 'ideal',
    off: samples(0, 0, 0, 0),
    k: samples(0, 0, 0, 0),
    ds: samples(10, 10, 10, 10),
    v: samples(40, 40, 40, 40)
  };
  return {
    def: { id: 'compact-test' },
    n: 4,
    step: 10,
    len: 40,
    kSm: samples(0, 0, 0, 0),
    idealPath: ideal
  } as unknown as Track;
}

function curvedFixture(): Track {
  const track = fixture();
  track.idealPath!.off = samples(0, 1, -0.5, 2);
  return track;
}

describe('compact lateral programs', () => {
  test('evaluates cached periodic ideal quintics with exact knot derivatives', () => {
    const track = curvedFixture();
    const atKnot = sampleTrackIdealLateralAnalytic(track, 10);
    const expectedFirst = (-0.5 - 0) / 20;
    const expectedSecond = (-0.5 - 2 * 1 + 0) / 100;

    expect(atKnot.value).toBe(1);
    expect(atKnot.firstDerivative).toBeCloseTo(expectedFirst, 14);
    expect(atKnot.secondDerivative).toBeCloseTo(expectedSecond, 14);
    expect(sampleTrackIdealLateralAnalytic(track, 7.25)).toEqual(
      sampleTrackIdealLateralAnalytic(track, 47.25)
    );
  });

  test('retains the pinned origin and evaluates owned polynomial segments', () => {
    const program: CompactLateralProgram = {
      startProgress: 100,
      endProgress: 120,
      segmentCount: 1,
      originLateral: 1,
      originFirstDerivative: 0.1,
      originSecondDerivative: 0,
      reference: new Uint8Array([0]),
      segmentStartProgress: samples(100),
      segmentEndProgress: samples(120),
      c0: samples(1),
      c1: samples(2),
      c2: samples(0),
      c3: samples(0),
      c4: samples(0),
      c5: samples(0),
      terminal: 'ideal-relative',
      terminalEta: 3
    };
    const track = fixture();

    expect(sampleCompactLateralProgram(track, program, 100)).toEqual({
      value: 1,
      firstDerivative: 0.1,
      secondDerivative: 0
    });
    expect(sampleCompactLateralProgram(track, program, 110)).toEqual({
      value: 2,
      firstDerivative: 0.1,
      secondDerivative: 0
    });
    expect(sampleCompactLateralProgram(track, program, 130).value).toBe(3);
    const geometry = compactLateralGeometryAtProgress(track, program, 110);
    expect(geometry.lateral).toBe(2);
    expect(geometry.q).toBeCloseTo(Math.hypot(1, 0.1), 14);
    expect(geometry.headingOffsetRadians).toBeCloseTo(
      Math.atan2(0.1, 1),
      14
    );
  });
});
