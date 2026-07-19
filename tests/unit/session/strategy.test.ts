import { describe, expect, test } from 'bun:test';

import { buildTrack } from '../../../src/core/track';
import { TRACK_DEFS } from '../../../src/data/tracks';
import { definitionFromCandidate, generateTier0Candidate } from '../../../src/game/trackgen';
import { createEntry } from '../../../src/session/entry';
import type { LineupEntry } from '../../../src/session/model';
import {
  entryMargin,
  FLOW_ZONES,
  flowZoneCount,
  rollFocus
} from '../../../src/session/strategy';

const TEAM = { id: 'strategy-test', name: 'Strategy Test', body: '#000', accent: '#fff' } as const;

function entry() {
  const lineup: LineupEntry = {
    team: TEAM,
    name: 'Flow Test',
    code: 'FLW',
    isPlayer: false,
    ci: 0,
    margin: 0,
    focus: 0.7,
    trait: ''
  };
  return createEntry({
    lineup,
    teamIndex: 0,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
}

describe('track-scaled strategy flow zones', () => {
  test('preserves legacy random consumption and scales generated tracks by length', () => {
    const legacy = buildTrack(TRACK_DEFS[0]!);
    const generated = buildTrack(definitionFromCandidate(
      generateTier0Candidate({ archetype: 'power', seed: 1 })
    ));

    expect(flowZoneCount(legacy)).toBe(FLOW_ZONES);
    expect(flowZoneCount(generated)).toBe(Math.round(generated.len / 300));
    expect(generated.len / flowZoneCount(generated)).toBeGreaterThanOrEqual(250);
    expect(generated.len / flowZoneCount(generated)).toBeLessThanOrEqual(350);

    const legacyEntry = entry();
    const generatedEntry = entry();
    rollFocus(legacyEntry, legacy);
    rollFocus(generatedEntry, generated);
    expect(legacyEntry.flow).toHaveLength(FLOW_ZONES);
    expect(generatedEntry.flow).toHaveLength(flowZoneCount(generated));
  });
});
