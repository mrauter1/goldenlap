import { clamp } from '../../shared/math';

export interface CubicInterpolationSample {
  value: number;
  firstDerivative: number;
  secondDerivative: number;
}

function smootherstep(value: number): number {
  const u = clamp(value, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function smootherstepFirstDerivative(value: number): number {
  const u = clamp(value, 0, 1);
  return 30 * u * u * (u - 1) * (u - 1);
}

function smootherstepSecondDerivative(value: number): number {
  const u = clamp(value, 0, 1);
  return 120 * u * u * u - 180 * u * u + 60 * u;
}

export function sampleSmootherstepSegment(
  from: number,
  to: number,
  span: number,
  value: number
): CubicInterpolationSample {
  const safeSpan = Math.max(Number.EPSILON, span);
  const delta = to - from;
  return {
    value: from + delta * smootherstep(value),
    firstDerivative: delta * smootherstepFirstDerivative(value) / safeSpan,
    secondDerivative: delta * smootherstepSecondDerivative(value) /
      (safeSpan * safeSpan)
  };
}

export function sampleHermiteSegment(
  from: number,
  to: number,
  fromSlope: number,
  toSlope: number,
  span: number,
  value: number
): CubicInterpolationSample {
  const safeSpan = Math.max(Number.EPSILON, span);
  const u = clamp(value, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const valueAt = (2 * u3 - 3 * u2 + 1) * from +
    (u3 - 2 * u2 + u) * safeSpan * fromSlope +
    (-2 * u3 + 3 * u2) * to +
    (u3 - u2) * safeSpan * toSlope;
  const firstDerivative = (
    (6 * u2 - 6 * u) * from +
    (3 * u2 - 4 * u + 1) * safeSpan * fromSlope +
    (-6 * u2 + 6 * u) * to +
    (3 * u2 - 2 * u) * safeSpan * toSlope
  ) / safeSpan;
  const secondDerivative = (
    (12 * u - 6) * from +
    (6 * u - 4) * safeSpan * fromSlope +
    (-12 * u + 6) * to +
    (6 * u - 2) * safeSpan * toSlope
  ) / (safeSpan * safeSpan);
  return {
    value: valueAt,
    firstDerivative,
    secondDerivative
  };
}

/** Quintic Hermite segment matching value, slope, and curvature at both ends. */
export function sampleQuinticHermiteSegment(
  from: CubicInterpolationSample,
  to: CubicInterpolationSample,
  span: number,
  value: number
): CubicInterpolationSample {
  const safeSpan = Math.max(Number.EPSILON, span);
  const u = clamp(value, 0, 1);
  const a0 = from.value;
  const a1 = from.firstDerivative * safeSpan;
  const a2 = from.secondDerivative * safeSpan * safeSpan / 2;
  const valueRemainder = to.value - a0 - a1 - a2;
  const slopeRemainder =
    to.firstDerivative * safeSpan - a1 - 2 * a2;
  const curvatureRemainder =
    to.secondDerivative * safeSpan * safeSpan - 2 * a2;
  const a3 =
    10 * valueRemainder -
    4 * slopeRemainder +
    curvatureRemainder / 2;
  const a4 =
    -15 * valueRemainder +
    7 * slopeRemainder -
    curvatureRemainder;
  const a5 =
    6 * valueRemainder -
    3 * slopeRemainder +
    curvatureRemainder / 2;
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const u5 = u4 * u;
  return {
    value: a0 + a1 * u + a2 * u2 + a3 * u3 + a4 * u4 + a5 * u5,
    firstDerivative: (
      a1 +
      2 * a2 * u +
      3 * a3 * u2 +
      4 * a4 * u3 +
      5 * a5 * u4
    ) / safeSpan,
    secondDerivative: (
      2 * a2 +
      6 * a3 * u +
      12 * a4 * u2 +
      20 * a5 * u3
    ) / (safeSpan * safeSpan)
  };
}
