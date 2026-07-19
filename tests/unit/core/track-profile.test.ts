import { describe, expect, test } from 'bun:test';
import { materializeTrackProfile } from '../../../src/core/racing-line';
import type { TrackProfile } from '../../../src/core/model';
import { TRACK_PROFILES } from '../../../src/data/track-profiles';
import { PIT_TEAMS, TRACK_DEFS } from '../../../src/data/tracks';
import { buildTrackDefinition } from '../../../src/game/tracks';
import { stableJson } from '../../../src/shared/stable-json';
import { makeHeuristicProfile } from '../../../tools/lib/profile-evaluate';

describe('compact TrackProfile authority', () => {
  test('has one deterministic compact matching profile for every committed track', () => {
    const committedIds: string[] = TRACK_PROFILES.map(profile => profile.trackId);
    const trackIds: string[] = TRACK_DEFS.map(definition => definition.id);
    expect(committedIds).toEqual(trackIds);
    expect(new Set(TRACK_PROFILES.map(profile => profile.trackId)).size).toBe(TRACK_PROFILES.length);
    for (const profile of TRACK_PROFILES) {
      expect(profile.anchors.length).toBeGreaterThan(4);
      expect(profile.anchors.length).toBeLessThan(64);
      const serialized = stableJson(profile);
      expect(stableJson(JSON.parse(serialized))).toBe(serialized);
    }
  });

  test('round-trips the semantic safe incumbent and materializes optimized profiles', () => {
    for (const definition of TRACK_DEFS) {
      const heuristic = buildTrackDefinition(definition, PIT_TEAMS, { profile: null, warn: false });
      const safeProfile = makeHeuristicProfile(heuristic, 101);
      const reconstructed = materializeTrackProfile(heuristic.tr, safeProfile);
      const profiled = buildTrackDefinition(definition, PIT_TEAMS, { requireProfile: true });
      expect(profiled.tr.trackProfileState?.status).toBe('matched');
      expect(profiled.tr.trackProfile?.trackId).toBe(definition.id);
      let baselineDifference = 0;
      for (let index = 0; index < profiled.tr.n; index++) {
        baselineDifference = Math.max(baselineDifference, Math.abs(
          reconstructed.off[index]! - heuristic.tr.idealPath.off[index]!
        ));
        expect(Number.isFinite(profiled.tr.idealPath.k[index]!)).toBe(true);
        expect(Number.isFinite(profiled.tr.idealPath.ds[index]!)).toBe(true);
        expect(Number.isFinite(profiled.tr.idealPath.v[index]!)).toBe(true);
      }
      expect(baselineDifference).toBeLessThanOrEqual(1e-8);
      expect(profiled.tr.idealTiming.lapTime).toBeLessThanOrEqual(
        heuristic.tr.idealTiming.lapTime * 1.01
      );
    }
  });

  test('uses explicit development fallbacks and rejects them in release mode', () => {
    const definition = TRACK_DEFS[0]!;
    const missing = buildTrackDefinition(definition, PIT_TEAMS, { profile: null, warn: false });
    expect(missing.tr.trackProfileState?.status).toBe('missing-fallback');
    expect(() => buildTrackDefinition(definition, PIT_TEAMS, {
      profile: null,
      requireProfile: true,
      warn: false
    })).toThrow('Missing TrackProfile');

    const stored = TRACK_PROFILES[0]!;
    const stale: TrackProfile = { ...stored, physicsFingerprint: 'fnv1a32:stale000' };
    const fallback = buildTrackDefinition(definition, PIT_TEAMS, { profile: stale, warn: false });
    expect(fallback.tr.trackProfileState?.status).toBe('stale-fallback');
    expect(() => buildTrackDefinition(definition, PIT_TEAMS, {
      profile: stale,
      requireProfile: true,
      warn: false
    })).toThrow('Stale TrackProfile');
  });

  test('rejects duplicate and out-of-bounds anchors before materialization', () => {
    const built = buildTrackDefinition(TRACK_DEFS[0]!, PIT_TEAMS, { profile: null, warn: false });
    const stored = TRACK_PROFILES[0]!;
    expect(() => materializeTrackProfile(built.tr, {
      ...stored,
      anchors: [stored.anchors[0]!, stored.anchors[0]!]
    })).toThrow('duplicate');
    expect(() => materializeTrackProfile(built.tr, {
      ...stored,
      anchors: [
        { sFraction: 0, lateral: built.tr.hw * 2 },
        { sFraction: 0.5, lateral: 0 }
      ]
    })).toThrow('out-of-bounds');
  });
});
