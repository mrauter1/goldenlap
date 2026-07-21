import { describe, expect, test } from 'bun:test';

import {
  buildSpeedEnvelope,
  createSpeedEnvelopeConstructionBuffers,
  firstSpeedEnvelopeBindingProgress,
  lowerSpeedEnvelopes,
  releasedSpeedEnvelope,
  speedEnvelopeAt,
  speedEnvelopeFromSamples,
  speedEnvelopeFromUniformSamples,
  speedEnvelopeProgressAtSeconds,
  speedEnvelopeTravelSeconds
} from '../../../src/core/speed-envelope';

describe('continuous speed envelopes', () => {
  test('builds uniform grids without changing owned envelope values', () => {
    const start = 12.3;
    const step = 3.7;
    const speed = [11, 17, 13, 19];
    const progress = speed.map((_, index) => start + index * step);

    expect(speedEnvelopeFromUniformSamples(start, step, speed))
      .toEqual(speedEnvelopeFromSamples(progress, speed));

    const buffers = createSpeedEnvelopeConstructionBuffers(
      speed.length - 1
    );
    const owned = speedEnvelopeFromUniformSamples(
      start,
      step,
      speed,
      buffers
    );
    expect(owned.segmentStartProgress)
      .toBe(buffers.segmentStartProgress);
    expect(owned.prefixTravelSeconds)
      .toBe(buffers.prefixTravelSeconds);
  });

  test('interpolates affine speed squared and integrates exactly', () => {
    const envelope = speedEnvelopeFromSamples(
      [0, 10, 20],
      [10, 20, 20]
    );
    expect(speedEnvelopeAt(envelope, 5))
      .toBeCloseTo(Math.sqrt(250), 12);
    const seconds = speedEnvelopeTravelSeconds(envelope, 0, 20);
    expect(seconds).toBeCloseTo(2 * 10 / 30 + 2 * 10 / 40, 12);
    expect(speedEnvelopeProgressAtSeconds(envelope, 0, seconds))
      .toBeCloseTo(20, 12);
  });

  test('uses exact prefix travel across partial affine segments', () => {
    const envelope = speedEnvelopeFromSamples(
      [0, 10, 25, 40],
      [8, 18, 12, 24]
    );
    const from = 4;
    const to = 32;
    const firstFrom = Math.sqrt(64 + (324 - 64) * from / 10);
    const firstSeconds = 2 * (10 - from) / (firstFrom + 18);
    const middleSeconds = 2 * 15 / (18 + 12);
    const lastTo = Math.sqrt(144 + (576 - 144) * 7 / 15);
    const lastSeconds = 2 * 7 / (12 + lastTo);
    const seconds = speedEnvelopeTravelSeconds(envelope, from, to);

    expect(seconds).toBeCloseTo(
      firstSeconds + middleSeconds + lastSeconds,
      12
    );
    expect(speedEnvelopeProgressAtSeconds(envelope, from, seconds))
      .toBeCloseTo(to, 11);
  });

  test('inverts travel from the middle of an accelerating segment', () => {
    const envelope = speedEnvelopeFromSamples([0, 20], [10, 30]);
    const from = 5;
    const to = 13;
    const seconds = speedEnvelopeTravelSeconds(envelope, from, to);

    expect(speedEnvelopeProgressAtSeconds(envelope, from, seconds))
      .toBeCloseTo(to, 12);
  });

  test('constructs exact lower crossings and first binding', () => {
    const free = buildSpeedEnvelope(0, 20, [{
      startProgress: 0,
      endProgress: 20,
      v2AtStart: 400,
      slope: 0
    }]);
    const diagonal = buildSpeedEnvelope(0, 20, [{
      startProgress: 0,
      endProgress: 20,
      v2AtStart: 500,
      slope: -10
    }]);
    const lower = lowerSpeedEnvelopes(free, diagonal);
    expect(firstSpeedEnvelopeBindingProgress(free, lower))
      .toBeCloseTo(10, 12);
    expect(speedEnvelopeAt(lower, 5)).toBe(20);
    expect(speedEnvelopeAt(lower, 15)).toBeCloseTo(Math.sqrt(350), 12);
  });

  test('streams disjoint knots and preserves equality at a binding boundary', () => {
    const free = speedEnvelopeFromSamples(
      [0, 4, 11, 20],
      [20, 20, 20, 20]
    );
    const constrained = speedEnvelopeFromSamples(
      [0, 7, 13, 20],
      [22, 21, 17, 16]
    );
    const expected = 7 + (13 - 7) *
      ((20 * 20 - 21 * 21) / (17 * 17 - 21 * 21));

    expect(firstSpeedEnvelopeBindingProgress(free, constrained))
      .toBeCloseTo(expected, 12);
    expect(firstSpeedEnvelopeBindingProgress(free, free)).toBeNull();
  });

  test('releases a constraint without retaining sampled suffix authority', () => {
    const free = speedEnvelopeFromSamples([0, 10, 20], [20, 20, 20]);
    const constrained = speedEnvelopeFromSamples(
      [0, 10, 20],
      [10, 10, 10]
    );
    const released = releasedSpeedEnvelope(free, constrained, 10);
    expect(speedEnvelopeAt(released, 5)).toBe(10);
    expect(speedEnvelopeAt(released, 10)).toBe(10);
    expect(speedEnvelopeAt(released, 10 + 1e-6)).toBe(20);
  });
});
