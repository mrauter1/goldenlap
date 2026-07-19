import { describe, expect, test } from 'bun:test';

import { normalLateralEnvelope } from '../../../src/core/surface';
import { buildTrack } from '../../../src/core/track';
import { PIT_TEAMS, TRACK_DEFS } from '../../../src/data/tracks';
import {
  definitionFromCandidate,
  generateTier0Candidate
} from '../../../src/game/trackgen';
import { stableFingerprint } from '../../../src/shared/stable-json';

const LEGACY_GEOMETRY = {
  prado: 'fnv1a32:0eca6881',
  costa: 'fnv1a32:00abb0a0',
  nordwald: 'fnv1a32:4f7299ff',
  villa: 'fnv1a32:1efada7d',
  anhembi: 'fnv1a32:9aebae71',
  cerro: 'fnv1a32:6f7fb12f'
} as const;

function geometryFingerprint(track: ReturnType<typeof buildTrack>): string {
  return stableFingerprint({
    n: track.n,
    step: track.step,
    len: track.len,
    x: Array.from(track.x),
    y: Array.from(track.y),
    tx: Array.from(track.tx),
    ty: Array.from(track.ty),
    nx: Array.from(track.nx),
    ny: Array.from(track.ny),
    k: Array.from(track.k),
    kSm: Array.from(track.kSm)
  });
}

describe('real-scale track integration', () => {
  test('keeps every scalar-width legacy track and pit bit-identical', () => {
    const legacyDefinitions = TRACK_DEFS.filter(definition =>
      !('generated' in definition.meta && definition.meta.generated)
    );
    expect(legacyDefinitions).toHaveLength(6);
    for (const definition of legacyDefinitions) {
      const track = buildTrack(definition, PIT_TEAMS);
      expect(geometryFingerprint(track)).toBe(
        LEGACY_GEOMETRY[definition.id as keyof typeof LEGACY_GEOMETRY]
      );
      expect(Array.from(track.halfWidth).every(value => value === definition.width / 2))
        .toBe(true);
      expect(track.hw).toBe(definition.width / 2);
      expect(track.pit).toMatchObject({
        rampIn: 42,
        rampOut: 46,
        Lp: 186,
        sExit: 52
      });
      expect(track.pit.boxWAt(0)).toBe(58);
      expect(track.pit.boxWAt(1)).toBe(68);
    }
  });

  test('samples local width and grand-track pit geometry from explicit hints', () => {
    const candidate = generateTier0Candidate({ archetype: 'power', seed: 0 });
    expect(candidate.tier0.accepted).toBe(true);
    const definition = definitionFromCandidate(candidate);
    const track = buildTrack(definition, PIT_TEAMS);
    const widths = Array.from(track.halfWidth);
    const expectedMinimumWidth = Math.min(
      ...(definition.widthProfile?.map(key => key.width) ?? [definition.width])
    );
    const narrow = widths.indexOf(Math.min(...widths));
    const wide = widths.indexOf(Math.max(...widths));

    expect(definition.widthProfile).toBeDefined();
    expect(Math.min(...widths) * 2).toBeCloseTo(expectedMinimumWidth, 2);
    expect(Math.max(...widths) * 2).toBeCloseTo(15, 6);
    expect(track.hw).toBe(Math.min(...widths));
    expect(track.surface.roadHalfWidthAt[narrow]).toBe(track.halfWidth[narrow]);
    expect(track.surface.roadHalfWidthAt[wide]).toBe(track.halfWidth[wide]);
    expect(normalLateralEnvelope(track, wide).maximum)
      .toBeGreaterThan(normalLateralEnvelope(track, narrow).maximum);
    expect(track.pit).toMatchObject({
      rampIn: 64,
      rampOut: 80,
      Lp: 284,
      sExit: 80
    });
    expect(track.pit.boxWAt(0)).toBe(88);
    expect(track.pit.boxWAt(1)).toBe(102);
  });
});
