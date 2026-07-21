import { describe, expect, test } from 'bun:test';

import {
  backwardInducedSpeedLimit,
  botStep
} from '../../../src/core/autopilot';
import {
  numericArray,
  type BotParameters,
  type CompactLateralProgram,
  type NumericArray,
  type SampledPath,
  type SpeedProfile,
  type Track
} from '../../../src/core/model';
import { speedEnvelopeFromSamples } from
  '../../../src/core/speed-envelope';
import { cornerSpeedForGrip, PHYS } from '../../../src/core/physics';
import { makeCar } from '../../../src/core/physics-engine';

function samples(...values: number[]): NumericArray {
  const result = numericArray(values.length);
  result.set(values);
  return result;
}

function straightFixture(): {
  track: Track;
  profile: SpeedProfile;
  path: SampledPath;
} {
  const step = 30;
  const path: SampledPath = {
    mode: 'ideal',
    off: samples(0, 0, 0, 0),
    k: samples(0, 0, 0, 0),
    ds: samples(step, step, step, step),
    v: samples(PHYS.vTop, PHYS.vTop, 12, PHYS.vTop)
  };
  const profile: SpeedProfile = {
    v: samples(PHYS.vTop, PHYS.vTop, PHYS.vTop, PHYS.vTop),
    t: samples(0, 1, 2, 3),
    lapTime: 4,
    step,
    ds: null
  };
  const track = {
    n: 4,
    step,
    len: 4 * step,
    x: samples(0, step, 2 * step, 3 * step),
    y: samples(0, 0, 0, 0),
    tx: samples(1, 1, 1, 1),
    ty: samples(0, 0, 0, 0),
    nx: samples(0, 0, 0, 0),
    ny: samples(1, 1, 1, 1),
    kSm: samples(0, 0, 0, 0),
    idealPath: path
  } as unknown as Track;
  return { track, profile, path };
}

describe('autopilot speed-law authority', () => {
  test('backward induction charges intermediate curvature before a target', () => {
    const targetSpeed = 12;
    const segmentDistance = 30;
    const brakingEffort = 0.82;
    const intermediateCurvature = 1 / 35;
    const intermediateLimit = cornerSpeedForGrip(intermediateCurvature);
    const atIntermediate = backwardInducedSpeedLimit(
      targetSpeed,
      intermediateLimit,
      segmentDistance,
      intermediateCurvature,
      1,
      1,
      brakingEffort
    );
    const perSampleAllowance = backwardInducedSpeedLimit(
      atIntermediate,
      PHYS.vTop,
      segmentDistance,
      0,
      1,
      1,
      brakingEffort
    );
    const targetOnlyAllowance = backwardInducedSpeedLimit(
      targetSpeed,
      PHYS.vTop,
      2 * segmentDistance,
      0,
      1,
      1,
      brakingEffort
    );

    expect(perSampleAllowance).toBeLessThan(targetOnlyAllowance);
  });

  test('BotParameters and runtime control have no traffic authority', () => {
    type TrafficIsAbsent =
      'traffic' extends keyof BotParameters ? false : true;
    const trafficIsAbsent: TrafficIsAbsent = true;
    expect(trafficIsAbsent).toBe(true);

    const { track, profile, path } = straightFixture();
    const car = makeCar(0, 0, 0);
    car.progIdx = 0;
    car.vx = 45;
    car.spd = 45;
    const parameters: BotParameters = {
      path,
      margin: 1,
      brakingEffort: 0.82
    };
    const expected = botStep(track, profile, car, parameters);
    const extraneousRuntimeObject = {
      ...parameters,
      traffic: { distance: 0, speed: 0 }
    };

    expect(botStep(track, profile, car, extraneousRuntimeObject)).toEqual(expected);
  });

  test('consumes compact lateral and speed programs without a lane buffer', () => {
    const { track, profile } = straightFixture();
    const car = makeCar(0, 0, 0);
    car.progIdx = 0;
    car.vx = 20;
    car.spd = 20;
    const zeros = samples(0);
    const lateralProgram: CompactLateralProgram = {
      startProgress: 0,
      endProgress: 90,
      segmentCount: 1,
      originLateral: 2,
      originFirstDerivative: 0,
      originSecondDerivative: 0,
      reference: new Uint8Array([0]),
      segmentStartProgress: samples(0),
      segmentEndProgress: samples(90),
      c0: samples(2),
      c1: zeros.slice() as NumericArray,
      c2: zeros.slice() as NumericArray,
      c3: zeros.slice() as NumericArray,
      c4: zeros.slice() as NumericArray,
      c5: zeros.slice() as NumericArray,
      terminal: 'ideal',
      terminalEta: 0
    };
    const direct = botStep(track, profile, car, {
      lateralProgram,
      pathProgress: 0,
      speedEnvelope: speedEnvelopeFromSamples([0, 120], [10, 10]),
      speedProgress: 0,
      margin: 1
    });
    const erased = botStep(track, profile, car, { margin: 1 });

    expect(Math.abs(direct.steer - erased.steer)).toBeGreaterThan(0.01);
    expect(direct.brake).toBeGreaterThan(0);
    expect(erased.brake).toBe(0);
  });
});
