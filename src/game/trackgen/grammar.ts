import { mulberry32 } from '../../shared/rng';
import type {
  NumericRange,
  ResolvedShapeGroup,
  RhythmPlan,
  RhythmPlanV2,
  RhythmSignature,
  RhythmSignatureInput,
  RhythmSignatureV2,
  RhythmToken,
  TrackArchetype,
  TrackCornerClass
} from './types';
import { expectedLobeSpans, knotsForGroup, migrateRhythmSignature } from './motifs';
import { presetFor } from './presets';
import { presetV2For } from './presets-v2';

const CORNER_CLASSES: readonly TrackCornerClass[] = [
  'hairpin', 'slow', 'medium', 'fast', 'kink'
];

function finiteRange(range: NumericRange, label: string): void {
  if (!Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] > range[1])
    throw new Error(`${label} must be a finite ordered range`);
}

export function validateRhythmSignature(signature: RhythmSignature): void {
  if (signature.schemaVersion !== 1) throw new Error('Unsupported rhythm signature schema');
  if (!signature.id.trim() || !signature.name.trim())
    throw new Error('Rhythm signature id and name are required');
  if (!['power', 'balanced', 'technical'].includes(signature.archetype))
    throw new Error(`Unknown track archetype ${String(signature.archetype)}`);
  if (signature.tokens.length < 6 || signature.tokens.length > 24)
    throw new Error('Rhythm signatures must contain 6–24 tokens');
  let flexConnectors = 0;
  const represented = new Set<TrackCornerClass>();
  const directions = new Set<string>();
  for (const token of signature.tokens) {
    if (token.kind === 'straight') {
      finiteRange(token.length, 'Straight length');
      if (token.length[0] <= 0) throw new Error('Straight lengths must be positive');
      if (token.flex) flexConnectors++;
      continue;
    }
    directions.add(token.direction);
    if (token.kind === 'corner') {
      if (!CORNER_CLASSES.includes(token.class))
        throw new Error(`Unknown corner class ${String(token.class)}`);
      finiteRange(token.angleDegrees, 'Corner angle');
      if (token.angleDegrees[0] <= 0 || token.angleDegrees[1] >= 220)
        throw new Error('Corner angles must stay within (0, 220) degrees');
      represented.add(token.class);
    } else {
      finiteRange(token.length, 'Complex length');
      if (token.length[0] <= 0) throw new Error('Complex lengths must be positive');
    }
  }
  if (flexConnectors < 2) throw new Error('Rhythm signatures need at least two flex straights');
  if (directions.size < 2) throw new Error('Rhythm signatures must represent both directions');
  if (represented.size < 5)
    throw new Error('Rhythm signatures must explicitly represent all five corner classes');
}

function ranged(random: () => number, range: NumericRange): number {
  return range[0] + (range[1] - range[0]) * random();
}

function resolveToken(random: () => number, token: RhythmToken) {
  if (token.kind === 'straight') return {
    kind: 'straight' as const,
    length: ranged(random, token.length),
    flex: token.flex === true
  };
  if (token.kind === 'corner') return {
    kind: 'corner' as const,
    class: token.class,
    direction: token.direction,
    angleDegrees: ranged(random, token.angleDegrees)
  };
  return {
    kind: 'complex' as const,
    complex: token.complex,
    direction: token.direction,
    length: ranged(random, token.length)
  };
}

export function resolveRhythmPlan(
  archetype: TrackArchetype,
  seed: number,
  signature: RhythmSignature = presetFor(archetype).signature
): RhythmPlan {
  validateRhythmSignature(signature);
  if (signature.archetype !== archetype)
    throw new Error(`Signature ${signature.id} is ${signature.archetype}, not ${archetype}`);
  if (!Number.isInteger(seed)) throw new Error('Track seed must be an integer');
  const normalizedSeed = seed >>> 0;
  const random = mulberry32(normalizedSeed);
  return {
    seed: normalizedSeed,
    signatureId: signature.id,
    archetype,
    tokens: signature.tokens.map(token => resolveToken(random, token))
  };
}

export function signatureForArchetype(archetype: TrackArchetype): RhythmSignature {
  return presetFor(archetype).signature;
}

function rangeContains(range: NumericRange, value: number): boolean {
  return range[0] <= value && value <= range[1];
}

export function validateRhythmSignatureV2(signature: RhythmSignatureV2): void {
  if (signature.schemaVersion !== 2) throw new Error('Unsupported rhythm signature schema');
  if (!signature.id.trim() || !signature.name.trim())
    throw new Error('Rhythm signature id and name are required');
  if (!['power', 'balanced', 'technical'].includes(signature.archetype))
    throw new Error(`Unknown track archetype ${String(signature.archetype)}`);
  if (signature.winding !== 'clockwise' && signature.winding !== 'counter-clockwise')
    throw new Error(`Unknown track winding ${String(signature.winding)}`);
  if (signature.groups.length < 6 || signature.groups.length > 32)
    throw new Error('Rhythm signatures must contain 6–32 groups');

  const ids = new Set<string>();
  let pitGroups = 0;
  let flexVariables = 0;
  let flexGroups = 0;
  const represented = new Set<TrackCornerClass>();
  const directions = new Set<number>();
  for (const group of signature.groups) {
    if (!group.id.trim() || ids.has(group.id))
      throw new Error(`Rhythm group ids must be non-empty and unique: ${group.id}`);
    ids.add(group.id);
    finiteRange(group.lengthMetres, `${group.id} length`);
    if (group.lengthMetres[0] <= 0) throw new Error(`${group.id} length must be positive`);
    if (group.role === 'grid-pit') pitGroups++;
    if (group.radiusClass) represented.add(group.radiusClass);

    const knots = knotsForGroup(group);
    const minimumKnots = group.kind === 'corner' ? 3 : 2;
    if (knots.length < minimumKnots)
      throw new Error(`${group.id} requires at least ${minimumKnots} knots`);
    for (let index = 0; index < knots.length; index++) {
      const knot = knots[index]!;
      finiteRange(knot.at, `${group.id} knot ${index} position`);
      finiteRange(knot.curvatureWeight, `${group.id} knot ${index} curvature weight`);
      if (!rangeContains([0, 1], knot.at[0]) || !rangeContains([0, 1], knot.at[1]))
        throw new Error(`${group.id} knot positions must stay in [0, 1]`);
      if (index === 0 && (knot.at[0] !== 0 || knot.at[1] !== 0))
        throw new Error(`${group.id} first knot must be fixed at 0`);
      if (index === knots.length - 1 && (knot.at[0] !== 1 || knot.at[1] !== 1))
        throw new Error(`${group.id} last knot must be fixed at 1`);
      const next = knots[index + 1];
      if (next && knot.at[1] >= next.at[0])
        throw new Error(`${group.id} knot ranges must resolve in strict order`);
    }

    const spans = expectedLobeSpans(group);
    if (spans.length !== group.lobes.length)
      throw new Error(`${group.id} lobe count does not match motif ${group.motif}`);
    group.lobes.forEach((lobe, index) => {
      finiteRange(lobe.angleDegrees, `${group.id} lobe ${index} angle`);
      if (lobe.firstKnot < 0 || lobe.lastKnot >= knots.length ||
          lobe.firstKnot >= lobe.lastKnot)
        throw new Error(`${group.id} lobe ${index} references an invalid knot span`);
      if (lobe.firstKnot !== spans[index]![0] || lobe.lastKnot !== spans[index]![1])
        throw new Error(`${group.id} lobe ${index} does not match motif span`);
      if (lobe.angleDegrees[0] < 0 && lobe.angleDegrees[1] > 0)
        throw new Error(`${group.id} lobe ${index} angle range cannot cross zero`);
      if (lobe.angleDegrees[0] !== 0 || lobe.angleDegrees[1] !== 0)
        directions.add(Math.sign((lobe.angleDegrees[0] + lobe.angleDegrees[1]) / 2));
    });
    if (group.kind !== 'nominal-straight' && !group.lobes.length)
      throw new Error(`${group.id} must define at least one turn lobe`);

    if (group.flex) {
      flexGroups++;
      if (group.flex.lengthDeltaMetres) {
        finiteRange(group.flex.lengthDeltaMetres, `${group.id} flex length`);
        flexVariables++;
      }
      if (group.flex.shallowBendBiasDelta) {
        finiteRange(group.flex.shallowBendBiasDelta, `${group.id} flex bend bias`);
        flexVariables++;
      }
      for (const flex of group.flex.lobes ?? []) {
        if (!Number.isInteger(flex.lobe) || flex.lobe < 0 || flex.lobe >= group.lobes.length)
          throw new Error(`${group.id} flex references invalid lobe ${flex.lobe}`);
        finiteRange(flex.angleDeltaDegrees, `${group.id} flex lobe angle`);
        flexVariables++;
      }
    }
  }
  if (pitGroups !== 1) throw new Error('Rhythm signatures require exactly one grid-pit group');
  if (flexGroups < 2 || flexVariables < 3)
    throw new Error('Rhythm signatures require two flex groups and three closure variables');
  if (directions.size < 2) throw new Error('Rhythm signatures must represent both directions');
  if (represented.size < 5)
    throw new Error('Rhythm signatures must explicitly represent all five corner classes');
}

export function normalizeRhythmSignature(input: RhythmSignatureInput): RhythmSignatureV2 {
  const signature = input.schemaVersion === 1 ? migrateRhythmSignature(input) : input;
  validateRhythmSignatureV2(signature);
  return signature;
}

function resolveV2Group(random: () => number, group: RhythmSignatureV2['groups'][number])
  : ResolvedShapeGroup {
  const lengthMetres = ranged(random, group.lengthMetres);
  const knots = knotsForGroup(group).map(knot => {
    const at = ranged(random, knot.at);
    return {
      at,
      s: at * lengthMetres,
      curvatureWeight: ranged(random, knot.curvatureWeight)
    };
  });
  const lobes = group.lobes.map(lobe => ({
    firstKnot: lobe.firstKnot,
    lastKnot: lobe.lastKnot,
    angleDegrees: ranged(random, lobe.angleDegrees)
  }));
  return {
    id: group.id,
    kind: group.kind,
    motif: group.motif,
    lengthMetres,
    knots,
    lobes,
    movable: group.movable,
    ...(group.radiusClass === undefined ? {} : { radiusClass: group.radiusClass }),
    ...(group.role === undefined ? {} : { role: group.role }),
    ...(group.flex === undefined ? {} : {
      flex: {
        ...(group.flex.lengthDeltaMetres === undefined
          ? {}
          : { lengthDeltaMetres: group.flex.lengthDeltaMetres }),
        lobes: [...(group.flex.lobes ?? [])],
        ...(group.flex.shallowBendBiasDelta === undefined
          ? {}
          : { shallowBendBiasDelta: group.flex.shallowBendBiasDelta })
      }
    })
  };
}

export function resolveRhythmPlanV2(
  archetype: TrackArchetype,
  seed: number,
  signatureInput: RhythmSignatureInput = presetV2For(archetype).signature
): RhythmPlanV2 {
  const signature = normalizeRhythmSignature(signatureInput);
  if (signature.archetype !== archetype)
    throw new Error(`Signature ${signature.id} is ${signature.archetype}, not ${archetype}`);
  if (!Number.isInteger(seed)) throw new Error('Track seed must be an integer');
  const normalizedSeed = seed >>> 0;
  const random = mulberry32(normalizedSeed);
  return {
    schemaVersion: 2,
    seed: normalizedSeed,
    signatureId: signature.id,
    archetype,
    winding: signature.winding,
    groups: signature.groups.map(group => resolveV2Group(random, group))
  };
}

export function signatureV2ForArchetype(archetype: TrackArchetype): RhythmSignatureV2 {
  return presetV2For(archetype).signature;
}
