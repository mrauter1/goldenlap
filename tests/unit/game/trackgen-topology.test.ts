import { describe, expect, test } from 'bun:test';

import {
  measureTrackTopology,
  normalizedRouteDistance,
  type TrackgenPoint
} from '../../../src/game/trackgen';

const RECTANGLE: readonly TrackgenPoint[] = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 200 },
  { x: 0, y: 200 }
];

const FOLDED: readonly TrackgenPoint[] = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 100 },
  { x: 120, y: 100 },
  { x: 120, y: 240 },
  { x: 450, y: 240 },
  { x: 450, y: 360 },
  { x: 0, y: 360 }
];

describe('track topology characterization', () => {
  test('distinguishes a folded route from a convex scaffold', () => {
    const rectangle = measureTrackTopology(RECTANGLE);
    const folded = measureTrackTopology(FOLDED);

    expect(rectangle.convexHullFill).toBeGreaterThan(0.95);
    expect(folded.convexHullFill).toBeLessThan(rectangle.convexHullFill);
    expect(folded.primaryAxisReversals + folded.secondaryAxisReversals)
      .toBeGreaterThan(rectangle.primaryAxisReversals + rectangle.secondaryAxisReversals);
    expect(folded.structuralFingerprint).not.toBe(rectangle.structuralFingerprint);
  });

  test('route distance ignores translation, rotation, and uniform scale', () => {
    const transformed = RECTANGLE.map(point => ({
      x: 100 - point.y * 2,
      y: -50 + point.x * 2
    }));
    expect(normalizedRouteDistance(RECTANGLE, transformed)).toBeLessThan(1e-9);
  });
});
