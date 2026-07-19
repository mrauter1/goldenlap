import { normAng } from '../shared/math';
import {
  denseArray,
  numericArray,
  type DenseArray,
  type NumericArray
} from './model';

export interface SampledTrackCenterline {
  n: number;
  step: number;
  len: number;
  x: NumericArray;
  y: NumericArray;
  tx: NumericArray;
  ty: NumericArray;
  nx: NumericArray;
  ny: NumericArray;
  heading: NumericArray;
  k: NumericArray;
  kSm: NumericArray;
}

/** The production Catmull-Rom and uniform-resampling authority. */
export function sampleTrackCenterline(
  points: readonly (readonly [number, number])[]
): SampledTrackCenterline {
  const count = points.length;
  if (count < 4) throw new Error('A track needs at least four control points');
  const rawX = denseArray<number>();
  const rawY = denseArray<number>();
  for (let index = 0; index < count; index++) {
    const p0 = points[(index - 1 + count) % count]!;
    const p1 = points[index]!;
    const p2 = points[(index + 1) % count]!;
    const p3 = points[(index + 2) % count]!;
    const segmentLength = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const samples = Math.max(8, Math.ceil(segmentLength / 1.2));
    for (let sample = 0; sample < samples; sample++) {
      const t = sample / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      rawX.push(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3));
      rawY.push(0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3));
    }
  }
  const rawCount = rawX.length;
  const cumulative = numericArray(rawCount + 1);
  for (let index = 0; index < rawCount; index++) {
    const next = (index + 1) % rawCount;
    cumulative[index + 1] = cumulative[index]! +
      Math.hypot(rawX[next]! - rawX[index]!, rawY[next]! - rawY[index]!);
  }
  const len = cumulative[rawCount]!;
  const n = Math.max(64, Math.round(len / 2));
  const step = len / n;
  const x = numericArray(n);
  const y = numericArray(n);
  let segment = 0;
  for (let index = 0; index < n; index++) {
    const distance = index * step;
    while (segment < rawCount - 1 && cumulative[segment + 1]! < distance) segment++;
    const span = Math.max(1e-9, cumulative[segment + 1]! - cumulative[segment]!);
    const fraction = (distance - cumulative[segment]!) / span;
    const next = (segment + 1) % rawCount;
    x[index] = rawX[segment]! + (rawX[next]! - rawX[segment]!) * fraction;
    y[index] = rawY[segment]! + (rawY[next]! - rawY[segment]!) * fraction;
  }
  const tx = numericArray(n);
  const ty = numericArray(n);
  const nx = numericArray(n);
  const ny = numericArray(n);
  const heading = numericArray(n);
  const k = numericArray(n);
  const kSm = numericArray(n);
  for (let index = 0; index < n; index++) {
    const previous = (index - 1 + n) % n;
    const next = (index + 1) % n;
    const dx = x[next]! - x[previous]!;
    const dy = y[next]! - y[previous]!;
    const length = Math.max(1e-9, Math.hypot(dx, dy));
    tx[index] = dx / length;
    ty[index] = dy / length;
    nx[index] = -ty[index]!;
    ny[index] = tx[index]!;
    heading[index] = Math.atan2(ty[index]!, tx[index]!);
  }
  for (let index = 0; index < n; index++) {
    const previous = (index - 1 + n) % n;
    const next = (index + 1) % n;
    k[index] = normAng(heading[next]! - heading[previous]!) / (2 * step);
  }
  for (let index = 0; index < n; index++) {
    let sum = 0;
    for (let delta = -3; delta <= 3; delta++)
      sum += k[(index + delta + n) % n]!;
    kSm[index] = sum / 7;
  }
  return { n, step, len, x, y, tx, ty, nx, ny, heading, k, kSm };
}

