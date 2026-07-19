import { describe, expect, test } from 'bun:test';

import { numericArray } from '../../../src/core/model';
import { makeCar, trackSense } from '../../../src/core/physics-engine';
import { speedProfile } from '../../../src/core/racing-line';
import {
  authoredCurbAt,
  normalLateralEnvelope,
  normalLateralIsLegal,
  surfaceExposureAtLateral,
  writeSurfaceExposureAtLateral
} from '../../../src/core/surface';
import { buildTrack } from '../../../src/core/track';
import { TRACK_DEFS } from '../../../src/data/tracks';

function curbFixture() {
  for (const definition of TRACK_DEFS) {
    const track = buildTrack(definition, 6);
    for (let index = 0; index < track.n; index++) {
      for (const side of [-1, 1] as const) {
        if (!authoredCurbAt(track, index, side)) continue;
        const uncurbed = Array.from({ length: track.n }, (_, candidate) => candidate)
          .find(candidate => !authoredCurbAt(track, candidate, side));
        if (uncurbed != null) return { track, index, uncurbed, side };
      }
    }
  }
  throw new Error('No authored curb fixture');
}

describe('shared authored surface map', () => {
  test('render curb segments exactly match the per-sample/per-side map', () => {
    for (const definition of TRACK_DEFS) {
      const track = buildTrack(definition, 6);
      const expected = new Set<string>();
      for (let index = 0; index < track.n; index++) {
        if (track.surface.curbNegative[index]) expected.add(`${index}:-1`);
        if (track.surface.curbPositive[index]) expected.add(`${index}:1`);
      }
      const rendered = new Set(track.curbs.map(curb => `${curb.index}:${curb.side}`));
      expect(rendered).toEqual(expected);
      expect(track.surface.fingerprint.startsWith('fnv1a32:')).toBe(true);
    }
  });

  test('an authored curb extends the legal normal envelope but an uncurbed edge does not', () => {
    const { track, index, uncurbed, side } = curbFixture();
    const curbEnvelope = normalLateralEnvelope(track, index);
    const roadEnvelope = normalLateralEnvelope(track, uncurbed);
    const curbEdge = side > 0 ? curbEnvelope.maximum : curbEnvelope.minimum;
    const roadEdge = side > 0 ? roadEnvelope.maximum : roadEnvelope.minimum;
    const lateral = (curbEdge + roadEdge) / 2;

    expect(Math.abs(curbEdge)).toBeGreaterThan(Math.abs(roadEdge));
    expect(normalLateralIsLegal(track, index, lateral)).toBe(true);
    expect(normalLateralIsLegal(track, uncurbed, lateral)).toBe(false);
    const exposure = surfaceExposureAtLateral(track, index, lateral);
    expect(exposure.curb).toBeGreaterThan(0);
    expect(exposure.grass).toBe(0);
  });

  test('footprint grip blends continuously onto a curb and uses the same physics classification', () => {
    const { track, index, side } = curbFixture();
    const transition = side * (track.surface.curbInner - 1);
    const before = surfaceExposureAtLateral(track, index, transition - side * 0.005);
    const after = surfaceExposureAtLateral(track, index, transition + side * 0.005);
    expect(Math.abs(after.mu - before.mu)).toBeLessThan(0.002);
    expect(Math.abs(after.drag - before.drag)).toBeLessThan(0.03);

    const envelope = normalLateralEnvelope(track, index);
    const lateral = side > 0 ? envelope.maximum : envelope.minimum;
    const car = makeCar(
      track.x[index]! + track.nx[index]! * lateral,
      track.y[index]! + track.ny[index]! * lateral,
      Math.atan2(track.ty[index]!, track.tx[index]!)
    );
    car.progIdx = index;
    const sensed = trackSense(track, car);
    const expected = surfaceExposureAtLateral(track, index, sensed.lat!);
    expect(sensed.zone).toBe(expected.zone);
    expect(sensed.mu).toBeCloseTo(expected.mu, 10);
    expect(sensed.drag).toBeCloseTo(expected.drag, 10);
  });

  test('the analytical speed profile includes the authored curb grip penalty', () => {
    const { track, index, side } = curbFixture();
    const roadOffset = numericArray(track.n);
    const curbOffset = numericArray(track.n);
    const distance = numericArray(track.n);
    for (let sample = 0; sample < track.n; sample++) distance[sample] = track.step;
    const envelope = normalLateralEnvelope(track, index);
    curbOffset[index] = side > 0 ? envelope.maximum : envelope.minimum;
    const road = speedProfile(track, { k: track.kSm, ds: distance, off: roadOffset });
    const curb = speedProfile(track, { k: track.kSm, ds: distance, off: curbOffset });
    expect(curb.v[index]).toBeLessThanOrEqual(road.v[index]! + 1e-9);
    expect(Number.isFinite(curb.lapTime)).toBe(true);
  });

  test('the allocation-free surface blend matches the full exposure model', () => {
    const { track, index } = curbFixture();
    const lateral = track.surface.normalMaximum[index]!;
    const expected = surfaceExposureAtLateral(track, index, lateral);
    const scratch = { road: 0, curb: 0, grass: 0, mu: 0, drag: 0 };
    writeSurfaceExposureAtLateral(track, index, lateral, scratch);
    expect(scratch).toEqual({
      road: expected.road,
      curb: expected.curb,
      grass: expected.grass,
      mu: expected.mu,
      drag: expected.drag
    });
  });
});
