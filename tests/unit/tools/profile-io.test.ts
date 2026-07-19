import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TRACK_PROFILES } from '../../../src/data/track-profiles';
import { updateTrackProfileSource } from '../../../tools/lib/profile-io';

describe('stable one-entry TrackProfile serialization', () => {
  test('updates only the selected profile and is stable on repetition', () => {
    const source = readFileSync('src/data/track-profiles.ts', 'utf8');
    const original = TRACK_PROFILES[0]!;
    const changed = {
      ...original,
      optimizerVersion: 'profile-io-test',
      provenance: { ...original.provenance, evaluations: original.provenance.evaluations + 1 }
    };
    const updated = updateTrackProfileSource(source, changed);
    expect(updated).not.toBe(source);
    expect(updated).toContain('"optimizerVersion": "profile-io-test"');
    for (const untouched of TRACK_PROFILES.slice(1)) {
      const marker = `"trackId": "${untouched.trackId}"`;
      const updatedIndex = updated.indexOf(marker);
      const sourceIndex = source.indexOf(marker);
      expect(updatedIndex).toBeGreaterThanOrEqual(0);
      expect(sourceIndex).toBeGreaterThanOrEqual(0);
      expect(updated.slice(updatedIndex)).toBe(source.slice(sourceIndex));
      break;
    }
    expect(updateTrackProfileSource(updated, changed)).toBe(updated);
  });
});
