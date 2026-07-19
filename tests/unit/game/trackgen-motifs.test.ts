import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  migrateRhythmSignature,
  normalizeRhythmSignature,
  resolveRhythmPlanV2,
  scrambleRhythmSignatureV2,
  signatureForArchetype,
  signatureV2ForArchetype,
  validateRhythmSignatureV2,
  type RhythmGroupSpec,
  type TrackArchetype
} from '../../../src/game/trackgen';

const ARCHETYPES: readonly TrackArchetype[] = ['power', 'balanced', 'technical'];

function movable(groups: readonly RhythmGroupSpec[]): readonly RhythmGroupSpec[] {
  return groups.filter(group => group.movable && group.kind !== 'nominal-straight');
}

describe('trackgen v2 shape grammar', () => {
  test('native presets validate and resolve deterministically', () => {
    for (const archetype of ARCHETYPES) {
      const signature = signatureV2ForArchetype(archetype);
      expect(() => validateRhythmSignatureV2(signature)).not.toThrow();
      const first = resolveRhythmPlanV2(archetype, 0x51A7E, signature);
      const second = resolveRhythmPlanV2(archetype, 0x51A7E, signature);
      expect(second).toEqual(first);
      expect(first.groups.filter(group => group.kind === 'corner')
        .every(group => group.knots.length >= 3)).toBe(true);
      expect(first.groups.some(group => group.lobes.length > 1)).toBe(true);
    }
  });

  test('checked-in preset and circuit-reference signatures are native v2 inputs', () => {
    for (const archetype of ARCHETYPES) {
      const stored = normalizeRhythmSignature(JSON.parse(readFileSync(
        `signatures/presets/${archetype}.json`, 'utf8'
      )));
      expect(stored).toEqual(signatureV2ForArchetype(archetype));
    }
    for (const [file, archetype] of [
      ['signatures/spa.json', 'power'],
      ['signatures/interlagos.json', 'balanced']
    ] as const) {
      const stored = normalizeRhythmSignature(JSON.parse(readFileSync(file, 'utf8')));
      expect(stored.schemaVersion).toBe(2);
      expect(stored.archetype).toBe(archetype);
      expect(stored.groups.some(group => group.lobes.length >= 2)).toBe(true);
      expect(stored.groups.filter(group => group.role === 'grid-pit')).toHaveLength(1);
    }
  });

  test('compound lobes retain independent signed turns when their net angle cancels', () => {
    const plan = resolveRhythmPlanV2('balanced', 9);
    const openingS = plan.groups.find(group => group.id === 'opening-s');
    expect(openingS?.lobes).toHaveLength(2);
    expect(openingS?.lobes[0]!.angleDegrees).toBeGreaterThan(0);
    expect(openingS?.lobes[1]!.angleDegrees).toBeLessThan(0);
  });

  test('v1 signatures migrate deterministically into valid v2 groups', () => {
    for (const archetype of ARCHETYPES) {
      const source = signatureForArchetype(archetype);
      const first = migrateRhythmSignature(source);
      const second = migrateRhythmSignature(source);
      expect(second).toEqual(first);
      expect(() => validateRhythmSignatureV2(first)).not.toThrow();
      expect(first.groups.filter(group => group.role === 'grid-pit')).toHaveLength(1);
    }
  });

  test('v2 scrambles preserve fixed straight slots and separate parameter/order changes', () => {
    const source = signatureV2ForArchetype('balanced');
    const parameters = scrambleRhythmSignatureV2({
      signature: source, seed: 17, revision: 0, mode: 'parameters'
    });
    const ordering = scrambleRhythmSignatureV2({
      signature: source, seed: 17, revision: 0, mode: 'ordering'
    });
    const both = scrambleRhythmSignatureV2({
      signature: source, seed: 17, revision: 0, mode: 'both'
    });

    expect(parameters.groups.map(group => group.id)).toEqual(source.groups.map(group => group.id));
    expect(parameters.groups).not.toEqual(source.groups);
    source.groups.forEach((group, index) => {
      if (!group.movable) expect(ordering.groups[index]).toEqual(group);
    });
    expect(movable(ordering.groups).map(group => group.id))
      .not.toEqual(movable(source.groups).map(group => group.id));
    expect([...movable(ordering.groups)].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...movable(source.groups)].sort((a, b) => a.id.localeCompare(b.id)));
    expect(both.groups).not.toEqual(parameters.groups);
    expect(() => validateRhythmSignatureV2(both)).not.toThrow();
  });
});
