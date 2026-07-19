import { describe, expect, test } from 'bun:test';

import {
  generateAcceptedTrack,
  type TrackArchetype
} from '../../../src/game/trackgen';

const SOURCES: Readonly<Record<TrackArchetype, number>> = {
  power: 0,
  balanced: 0,
  technical: 8
};

describe('track generator Tier 1', () => {
  test('finds a deterministic racing-quality track for every archetype', () => {
    for (const archetype of ['power', 'balanced', 'technical'] as const) {
      const options = { archetype, seed: SOURCES[archetype], maximumAttempts: 50 };
      const first = generateAcceptedTrack(options);
      const second = generateAcceptedTrack(options);

      expect(second).toEqual(first);
      expect(first.attempts).toBeLessThanOrEqual(50);
      expect(first.candidate.tier0.accepted).toBe(true);
      expect(first.quality.accepted).toBe(true);
      expect(first.quality.metrics.passSpots).toBeGreaterThanOrEqual(2);
      expect(first.artifact.schemaVersion).toBe(2);
      expect(first.artifact.generatorVersion).toBe('trackgen-topology-v2');
      expect(first.artifact.signatureSchemaVersion).toBe(2);
      expect(first.artifact.resolvedPlan.schemaVersion).toBe(2);
      expect(first.artifact.realization.groups.length).toBeGreaterThanOrEqual(6);
      expect(first.artifact.realization.closure.converged).toBe(true);
      expect(first.artifact.definitionFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
      expect(first.artifact.provenanceHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
      expect(first.artifact.deeperValidation).toEqual({
        headlessProbe: 'pending',
        profileWorkflow: 'pending'
      });
    }
  }, 30_000);
});
