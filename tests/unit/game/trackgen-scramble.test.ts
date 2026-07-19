import { describe, expect, test } from 'bun:test';

import {
  generateTier0Candidate,
  scrambleRhythmSignature,
  signatureForArchetype,
  validateRhythmSignature,
  type RhythmSignature,
  type RhythmToken
} from '../../../src/game/trackgen';

function scramble(
  signature: RhythmSignature,
  mode: 'parameters' | 'ordering' | 'both',
  revision = 0
): RhythmSignature {
  return scrambleRhythmSignature({ signature, seed: 0x51A7E, revision, mode });
}

function movable(tokens: readonly RhythmToken[]): readonly RhythmToken[] {
  return tokens.filter(token => token.kind !== 'straight');
}

describe('track signature scrambles', () => {
  test('are deterministic for the same signature, seed, revision, and mode', () => {
    const source = signatureForArchetype('balanced');
    expect(scramble(source, 'both')).toEqual(scramble(source, 'both'));
  });

  test('parameter-only scramble changes ranges but preserves the rhythm order', () => {
    const source = signatureForArchetype('balanced');
    const result = scramble(source, 'parameters');

    expect(result.tokens.map(token => token.kind)).toEqual(source.tokens.map(token => token.kind));
    expect(result.tokens.map(token => token.kind === 'straight' ? token : {
      kind: token.kind,
      identity: token.kind === 'corner'
        ? `${token.class}:${token.direction}`
        : `${token.complex}:${token.direction}`
    })).toEqual(source.tokens.map(token => token.kind === 'straight' ? token : {
      kind: token.kind,
      identity: token.kind === 'corner'
        ? `${token.class}:${token.direction}`
        : `${token.complex}:${token.direction}`
    }));
    expect(result.tokens).not.toEqual(source.tokens);
    expect(() => validateRhythmSignature(result)).not.toThrow();
  });

  test('ordering-only scramble moves corners while preserving straight slots and parameters', () => {
    const source = signatureForArchetype('power');
    const result = scramble(source, 'ordering');

    source.tokens.forEach((token, index) => {
      if (token.kind === 'straight') expect(result.tokens[index]).toEqual(token);
    });
    expect(movable(result.tokens)).not.toEqual(movable(source.tokens));
    expect([...movable(result.tokens)].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))))
      .toEqual([...movable(source.tokens)].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))));
    expect(() => validateRhythmSignature(result)).not.toThrow();
  });

  test('combined scramble changes both dimensions and remains generator-deterministic', () => {
    const source = signatureForArchetype('technical');
    const result = scramble(source, 'both');
    const first = generateTier0Candidate({
      archetype: result.archetype,
      seed: 77,
      signature: result
    });
    const second = generateTier0Candidate({
      archetype: result.archetype,
      seed: 77,
      signature: result
    });

    expect(movable(result.tokens).map(token => token.kind))
      .not.toEqual(movable(source.tokens).map(token => token.kind));
    expect(result.tokens).not.toEqual(source.tokens);
    expect(second).toEqual(first);
  });

  test('revision advances repeated scrambles reproducibly', () => {
    const source = signatureForArchetype('balanced');
    expect(scramble(source, 'parameters', 1)).not.toEqual(scramble(source, 'parameters', 0));
  });
});
