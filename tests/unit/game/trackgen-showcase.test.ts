import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { buildTrack } from '../../../src/core/track';
import { ARDENNE_TRACK } from '../../../src/data/generated/ardenne/track-definition';
import { PAULISTA_TRACK } from '../../../src/data/generated/paulista/track-definition';
import { PIT_TEAMS } from '../../../src/data/tracks';
import {
  normalizeRhythmSignature,
  type RhythmSignatureInput,
  type TrackGenerationArtifact
} from '../../../src/game/trackgen';
import { stableFingerprint } from '../../../src/shared/stable-json';
import type { TrackDefinition } from '../../../src/shared/types';

const SHOWCASES = [
  {
    definition: ARDENNE_TRACK,
    definitionFile: 'src/data/generated/ardenne/definition.json',
    artifactFile: 'src/data/generated/ardenne/generation-artifact.json',
    signatureFile: 'signatures/spa.json',
    archetype: 'power',
    length: [6_800, 7_200]
  },
  {
    definition: PAULISTA_TRACK,
    definitionFile: 'src/data/generated/paulista/definition.json',
    artifactFile: 'src/data/generated/paulista/generation-artifact.json',
    signatureFile: 'signatures/interlagos.json',
    archetype: 'balanced',
    length: [4_400, 4_900]
  }
] as const;

describe('committed generated-track showcases', () => {
  test('keep source definitions and immutable generation provenance aligned', () => {
    for (const showcase of SHOWCASES) {
      const storedDefinition = JSON.parse(
        readFileSync(showcase.definitionFile, 'utf8')
      ) as TrackDefinition;
      const artifact = JSON.parse(
        readFileSync(showcase.artifactFile, 'utf8')
      ) as TrackGenerationArtifact;
      const signature = normalizeRhythmSignature(JSON.parse(
        readFileSync(showcase.signatureFile, 'utf8')
      ) as RhythmSignatureInput);
      const track = buildTrack(showcase.definition, PIT_TEAMS);

      expect(storedDefinition).toEqual(showcase.definition);
      expect(artifact.schemaVersion).toBe(2);
      expect(artifact.generatorVersion).toBe('trackgen-topology-v2');
      expect(artifact.archetype).toBe(showcase.archetype);
      expect(artifact.tier0.accepted).toBe(true);
      expect(artifact.tier1.accepted).toBe(true);
      expect(artifact.deeperValidation.headlessProbe).toBe('passed');
      expect(artifact.deeperValidation.profileWorkflow).toBe('passed');
      expect(artifact.deeperValidation.auditEffects).toBe('amber');
      expect(artifact.deeperValidation.cameraMinimapReview).toBe('passed');
      expect(stableFingerprint(showcase.definition)).toBe(artifact.definitionFingerprint);
      expect(stableFingerprint(signature)).toBe(artifact.signatureFingerprint);
      expect(track.len).toBeCloseTo(artifact.tier0.metrics.lengthMetres, 6);
      expect(track.len).toBeGreaterThanOrEqual(showcase.length[0]);
      expect(track.len).toBeLessThanOrEqual(showcase.length[1]);
    }
  });
});
