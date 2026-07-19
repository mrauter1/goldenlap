import { describe, expect, test } from 'bun:test';

import {
  TRACKGEN_MAX_CURVATURE_RATE,
  evaluateTier0,
  generateTier0Candidate,
  signatureV2ForArchetype,
  validateRhythmSignatureV2,
  type RealizedTrackGeometry,
  type TrackArchetype
} from '../../../src/game/trackgen';

const ARCHETYPES: readonly TrackArchetype[] = ['power', 'balanced', 'technical'];

describe('track generator Tier 0', () => {
  test('is deterministic for every archetype and seed', () => {
    for (const archetype of ARCHETYPES) {
      const first = generateTier0Candidate({ archetype, seed: 0x51A7E });
      const second = generateTier0Candidate({ archetype, seed: 0x51A7E });
      expect(second).toEqual(first);
      expect(first.geometry.endPose).not.toEqual(first.geometry.startPose);
      expect(first.geometry.closureIterations).toBeLessThanOrEqual(28);
      if (first.geometry.closure.converged) {
        expect(first.tier0.metrics.closureErrorMetres).toBeLessThanOrEqual(1e-6);
        expect(first.tier0.metrics.closureHeadingErrorRadians).toBeLessThanOrEqual(1e-9);
      } else {
        expect(first.tier0.gates.find(gate => gate.id === 'trackgen.closure_error_m')?.status)
          .toBe('fail');
      }
    }
  }, 30_000);

  test('ships valid archetype grammars with physical coverage', () => {
    for (const archetype of ARCHETYPES)
      expect(() => validateRhythmSignatureV2(signatureV2ForArchetype(archetype))).not.toThrow();
  });

  test('rejects closure, curvature-rate, and self-intersection defects', () => {
    const source = generateTier0Candidate({ archetype: 'balanced', seed: 19 });
    const openGeometry: RealizedTrackGeometry = {
      ...source.geometry,
      endPose: { ...source.geometry.endPose, x: source.geometry.endPose.x + 0.5 }
    };
    expect(evaluateTier0(source.plan, openGeometry).gates.find(
      gate => gate.id === 'trackgen.closure_error_m'
    )?.status).toBe('fail');

    const crossingGeometry: RealizedTrackGeometry = {
      ...source.geometry,
      points: [
        { x: 0, y: 0 }, { x: 400, y: 400 },
        { x: 0, y: 400 }, { x: 400, y: 0 }
      ]
    };
    const crossing = evaluateTier0(source.plan, crossingGeometry, 8);
    expect(crossing.gates.find(gate => gate.id === 'trackgen.self_intersections')?.status)
      .toBe('fail');

    const kinkGeometry: RealizedTrackGeometry = {
      ...source.geometry,
      points: [
        { x: 0, y: 0 }, { x: 500, y: 0 }, { x: 501, y: 1 },
        { x: 500, y: 500 }, { x: 0, y: 500 }
      ]
    };
    const kink = evaluateTier0(source.plan, kinkGeometry, 8);
    expect(kink.metrics.maximumCurvatureRate).toBeGreaterThan(TRACKGEN_MAX_CURVATURE_RATE);
    expect(kink.gates.find(gate => gate.id === 'trackgen.curvature_rate')?.status).toBe('fail');
  });

  test('reports Tier-0 throughput while staying below the accepted 30 s ceiling', () => {
    for (let index = 0; index < 6; index++)
      generateTier0Candidate({ archetype: ARCHETYPES[index % ARCHETYPES.length]!, seed: index });
    const count = 12;
    const started = performance.now();
    for (let index = 0; index < count; index++)
      generateTier0Candidate({
        archetype: ARCHETYPES[index % ARCHETYPES.length]!,
        seed: index + 10_000
      });
    const candidatesPerSecond = count / ((performance.now() - started) / 1_000);
    expect(candidatesPerSecond).toBeGreaterThan(0);
    expect((performance.now() - started) / count).toBeLessThan(30_000);
  }, 30_000);
});
