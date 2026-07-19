import { mulberry32 } from '../../shared/rng';
import { stableFingerprint } from '../../shared/stable-json';
import { validateRhythmSignature } from './grammar';
import type {
  NumericRange,
  RhythmSignature,
  RhythmSignatureV2,
  RhythmGroupSpec,
  RhythmToken
} from './types';
import { validateRhythmSignatureV2 } from './grammar';

export type RhythmScrambleMode = 'parameters' | 'ordering' | 'both';

export interface ScrambleRhythmSignatureOptions {
  signature: RhythmSignature;
  seed: number;
  revision: number;
  mode: RhythmScrambleMode;
}

const MODE_SALT: Readonly<Record<RhythmScrambleMode, number>> = {
  parameters: 0xA511E9B3,
  ordering: 0x63D83595,
  both: 0xC2B2AE35
};

// A scramble explores around the authored grammar without changing a corner's
// semantic class. Wider complex variation is safe because its internal turns
// are still realized by the same grammar primitive.
const CORNER_CENTER_SCALE: NumericRange = [0.90, 1.10];
const CORNER_SPAN_SCALE: NumericRange = [0.75, 1.25];
const COMPLEX_CENTER_SCALE: NumericRange = [0.80, 1.20];
const COMPLEX_SPAN_SCALE: NumericRange = [0.75, 1.25];
const MINIMUM_CORNER_ANGLE_DEGREES = 10;
const MAXIMUM_CORNER_ANGLE_DEGREES = 210;
const MINIMUM_COMPLEX_LENGTH_METRES = 100;
const MAXIMUM_COMPLEX_LENGTH_METRES = 1_600;

function ranged(random: () => number, range: NumericRange): number {
  return range[0] + (range[1] - range[0]) * random();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function scrambleRange(
  range: NumericRange,
  random: () => number,
  centerScale: NumericRange,
  spanScale: NumericRange,
  minimum: number,
  maximum: number,
  step: number
): NumericRange {
  const center = (range[0] + range[1]) / 2 * ranged(random, centerScale);
  const originalSpan = range[1] - range[0];
  const span = Math.max(step, originalSpan * ranged(random, spanScale));
  const round = (value: number): number => Math.round(value / step) * step;
  let lower = round(clamp(center - span / 2, minimum, maximum - step));
  let upper = round(clamp(center + span / 2, lower + step, maximum));

  if (lower === range[0] && upper === range[1]) {
    if (upper + step <= maximum) upper += step;
    else lower = Math.max(minimum, lower - step);
  }
  return [lower, upper];
}

function scrambleParameters(tokens: readonly RhythmToken[], random: () => number): RhythmToken[] {
  return tokens.map(token => {
    if (token.kind === 'straight') return token;
    if (token.kind === 'corner') return {
      ...token,
      angleDegrees: scrambleRange(
        token.angleDegrees,
        random,
        CORNER_CENTER_SCALE,
        CORNER_SPAN_SCALE,
        MINIMUM_CORNER_ANGLE_DEGREES,
        MAXIMUM_CORNER_ANGLE_DEGREES,
        1
      )
    };
    return {
      ...token,
      length: scrambleRange(
        token.length,
        random,
        COMPLEX_CENTER_SCALE,
        COMPLEX_SPAN_SCALE,
        MINIMUM_COMPLEX_LENGTH_METRES,
        MAXIMUM_COMPLEX_LENGTH_METRES,
        10
      )
    };
  });
}

function scrambleOrdering(tokens: readonly RhythmToken[], random: () => number): RhythmToken[] {
  const slots = tokens
    .map((token, index) => token.kind === 'straight' ? -1 : index)
    .filter(index => index >= 0);
  const movable = slots.map(index => ({ token: tokens[index]!, sourceIndex: index }));
  if (movable.length < 2) return [...tokens];

  for (let index = movable.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [movable[index], movable[other]] = [movable[other]!, movable[index]!];
  }
  if (movable.every((entry, index) => entry.sourceIndex === slots[index]))
    movable.push(movable.shift()!);

  const result = [...tokens];
  slots.forEach((slot, index) => { result[slot] = movable[index]!.token; });
  return result;
}

function scrambleId(signature: RhythmSignature, tokens: readonly RhythmToken[]): string {
  const base = signature.id.replace(/--scramble-[0-9a-f]{8}$/u, '');
  const fingerprint = stableFingerprint({ archetype: signature.archetype, tokens });
  return `${base}--scramble-${fingerprint.slice(-8)}`;
}

export function scrambleRhythmSignature(
  options: ScrambleRhythmSignatureOptions
): RhythmSignature {
  validateRhythmSignature(options.signature);
  if (!Number.isInteger(options.seed)) throw new Error('Scramble seed must be an integer');
  if (!Number.isInteger(options.revision) || options.revision < 0)
    throw new Error('Scramble revision must be a non-negative integer');

  const mixedSeed = (
    (options.seed >>> 0) ^
    Math.imul((options.revision + 1) >>> 0, 0x9E3779B1) ^
    MODE_SALT[options.mode]
  ) >>> 0;
  const random = mulberry32(mixedSeed);
  let tokens: readonly RhythmToken[] = options.signature.tokens;
  if (options.mode === 'parameters' || options.mode === 'both')
    tokens = scrambleParameters(tokens, random);
  if (options.mode === 'ordering' || options.mode === 'both')
    tokens = scrambleOrdering(tokens, random);

  const result: RhythmSignature = {
    ...options.signature,
    id: scrambleId(options.signature, tokens),
    tokens
  };
  validateRhythmSignature(result);
  return result;
}

function scrambleSignedRange(
  range: NumericRange,
  random: () => number,
  scale: NumericRange,
  step: number
): NumericRange {
  const sign = range[1] <= 0 ? -1 : 1;
  const magnitude: NumericRange = sign < 0 ? [-range[1], -range[0]] : range;
  const maximum = Math.max(step * 2, magnitude[1] * 1.35);
  const scrambled = scrambleRange(
    magnitude,
    random,
    scale,
    CORNER_SPAN_SCALE,
    0,
    maximum,
    step
  );
  return sign < 0 ? [-scrambled[1], -scrambled[0]] : scrambled;
}

function scrambleV2Parameters(
  groups: readonly RhythmGroupSpec[],
  random: () => number
): RhythmGroupSpec[] {
  return groups.map(group => {
    if (group.role === 'grid-pit') return group;
    const lengthMetres = scrambleRange(
      group.lengthMetres,
      random,
      group.kind === 'nominal-straight' ? [0.90, 1.10] : COMPLEX_CENTER_SCALE,
      COMPLEX_SPAN_SCALE,
      80,
      1_800,
      10
    );
    const lobes = group.lobes.map(lobe => ({
      ...lobe,
      angleDegrees: scrambleSignedRange(
        lobe.angleDegrees,
        random,
        group.kind === 'nominal-straight' ? [0.80, 1.20] : CORNER_CENTER_SCALE,
        1
      )
    }));
    const knots = group.knots?.map((knot, index) => {
      if (index === 0 || index === group.knots!.length - 1) return knot;
      return {
        ...knot,
        curvatureWeight: scrambleSignedRange(
          knot.curvatureWeight,
          random,
          [0.85, 1.15],
          0.01
        )
      };
    });
    return {
      ...group,
      lengthMetres,
      lobes,
      ...(knots === undefined ? {} : { knots })
    };
  });
}

function scrambleV2Ordering(
  groups: readonly RhythmGroupSpec[],
  random: () => number
): RhythmGroupSpec[] {
  const slots = groups
    .map((group, index) => group.movable && group.kind !== 'nominal-straight' ? index : -1)
    .filter(index => index >= 0);
  const movable = slots.map(index => ({ group: groups[index]!, sourceIndex: index }));
  if (movable.length < 2) return [...groups];
  for (let index = movable.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [movable[index], movable[other]] = [movable[other]!, movable[index]!];
  }
  if (movable.every((entry, index) => entry.sourceIndex === slots[index]))
    movable.push(movable.shift()!);
  const result = [...groups];
  slots.forEach((slot, index) => { result[slot] = movable[index]!.group; });
  return result;
}

export interface ScrambleRhythmSignatureV2Options {
  signature: RhythmSignatureV2;
  seed: number;
  revision: number;
  mode: RhythmScrambleMode;
}

export function scrambleRhythmSignatureV2(
  options: ScrambleRhythmSignatureV2Options
): RhythmSignatureV2 {
  validateRhythmSignatureV2(options.signature);
  if (!Number.isInteger(options.seed)) throw new Error('Scramble seed must be an integer');
  if (!Number.isInteger(options.revision) || options.revision < 0)
    throw new Error('Scramble revision must be a non-negative integer');
  const mixedSeed = (
    (options.seed >>> 0) ^
    Math.imul((options.revision + 1) >>> 0, 0x9E3779B1) ^
    MODE_SALT[options.mode]
  ) >>> 0;
  const random = mulberry32(mixedSeed);
  let groups: readonly RhythmGroupSpec[] = options.signature.groups;
  if (options.mode === 'parameters' || options.mode === 'both')
    groups = scrambleV2Parameters(groups, random);
  if (options.mode === 'ordering' || options.mode === 'both')
    groups = scrambleV2Ordering(groups, random);
  const base = options.signature.id.replace(/--scramble-[0-9a-f]{8}$/u, '');
  const fingerprint = stableFingerprint({ archetype: options.signature.archetype, groups });
  const result: RhythmSignatureV2 = {
    ...options.signature,
    id: `${base}--scramble-${fingerprint.slice(-8)}`,
    groups
  };
  validateRhythmSignatureV2(result);
  return result;
}
