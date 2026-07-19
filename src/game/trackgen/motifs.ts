import type {
  NumericRange,
  ResolvedShapeGroup,
  RhythmGroupSpec,
  RhythmSignature,
  RhythmSignatureV2,
  ShapeKnotSpec,
  TrackCornerClass,
  TrackDirection,
  TrackMotifId,
  TurnLobeSpec
} from './types';

interface MotifTemplate {
  knots: readonly ShapeKnotSpec[];
  lobeSpans: readonly (readonly [number, number])[];
}

const fixed = (value: number): NumericRange => [value, value];
const knot = (at: number, curvatureWeight: number): ShapeKnotSpec => ({
  at: fixed(at),
  curvatureWeight: fixed(curvatureWeight)
});

const MOTIFS: Readonly<Record<Exclude<TrackMotifId, 'custom-compound'>, MotifTemplate>> = {
  'true-straight': {
    knots: [knot(0, 0), knot(1, 0)],
    lobeSpans: []
  },
  'shallow-bow': {
    knots: [knot(0, 0), knot(0.5, 1), knot(1, 0)],
    lobeSpans: [[0, 2]]
  },
  'shallow-s': {
    knots: [knot(0, 0), knot(0.25, 1), knot(0.5, 0), knot(0.75, -1), knot(1, 0)],
    lobeSpans: [[0, 2], [2, 4]]
  },
  'single-apex': {
    knots: [knot(0, 0), knot(0.5, 1), knot(1, 0)],
    lobeSpans: [[0, 2]]
  },
  'early-apex': {
    knots: [knot(0, 0), knot(0.34, 1), knot(1, 0)],
    lobeSpans: [[0, 2]]
  },
  'late-apex': {
    knots: [knot(0, 0), knot(0.66, 1), knot(1, 0)],
    lobeSpans: [[0, 2]]
  },
  'increasing-radius': {
    knots: [knot(0, 0), knot(0.25, 1), knot(0.58, 0.82), knot(1, 0)],
    lobeSpans: [[0, 3]]
  },
  'decreasing-radius': {
    knots: [knot(0, 0), knot(0.42, 0.82), knot(0.75, 1), knot(1, 0)],
    lobeSpans: [[0, 3]]
  },
  'double-apex': {
    knots: [knot(0, 0), knot(0.24, 1), knot(0.5, 0.42), knot(0.76, 1), knot(1, 0)],
    lobeSpans: [[0, 4]]
  },
  'long-sweeper': {
    knots: [knot(0, 0), knot(0.18, 0.72), knot(0.5, 1), knot(0.82, 0.72), knot(1, 0)],
    lobeSpans: [[0, 4]]
  },
  'sweeper-chain': {
    knots: [
      knot(0, 0), knot(0.16, 1), knot(0.32, 0), knot(0.5, -0.72),
      knot(0.66, 0), knot(0.84, 0.88), knot(1, 0)
    ],
    lobeSpans: [[0, 2], [2, 4], [4, 6]]
  },
  s: {
    knots: [knot(0, 0), knot(0.25, 1), knot(0.5, 0), knot(0.75, -1), knot(1, 0)],
    lobeSpans: [[0, 2], [2, 4]]
  },
  chicane: {
    knots: [knot(0, 0), knot(0.2, 1), knot(0.48, 0), knot(0.72, -1), knot(1, 0)],
    lobeSpans: [[0, 2], [2, 4]]
  }
};

const CLASS_RADIUS: Readonly<Record<TrackCornerClass, number>> = {
  hairpin: 27,
  slow: 45,
  medium: 85,
  fast: 165,
  kink: 340
};

function signedRange(direction: TrackDirection, range: NumericRange): NumericRange {
  return direction === 'left' ? range : [-range[1], -range[0]];
}

function cornerLength(
  cornerClass: TrackCornerClass,
  angleDegrees: NumericRange
): NumericRange {
  const radius = CLASS_RADIUS[cornerClass];
  return [
    radius * angleDegrees[0] * Math.PI / 180 * 0.92,
    radius * angleDegrees[1] * Math.PI / 180 * 1.08
  ];
}

export function motifTemplate(motif: TrackMotifId): MotifTemplate {
  if (motif === 'custom-compound')
    throw new Error('custom-compound requires explicit knots');
  return MOTIFS[motif];
}

export function knotsForGroup(group: RhythmGroupSpec): readonly ShapeKnotSpec[] {
  if (group.motif === 'custom-compound') {
    if (!group.knots) throw new Error(`Custom group ${group.id} requires knots`);
    return group.knots;
  }
  if (group.knots) throw new Error(`Standard motif ${group.motif} cannot override knots`);
  return motifTemplate(group.motif).knots;
}

export function expectedLobeSpans(group: RhythmGroupSpec): readonly (readonly [number, number])[] {
  if (group.motif === 'custom-compound')
    return group.lobes.map(lobe => [lobe.firstKnot, lobe.lastKnot] as const);
  return motifTemplate(group.motif).lobeSpans;
}

function lobe(
  firstKnot: number,
  lastKnot: number,
  angleDegrees: NumericRange
): TurnLobeSpec {
  return { firstKnot, lastKnot, angleDegrees };
}

function legacyGroupId(index: number): string {
  return `legacy-${String(index + 1).padStart(2, '0')}`;
}

/** Deterministic compatibility adapter for Studio/CLI v1 JSON. */
export function migrateRhythmSignature(signature: RhythmSignature): RhythmSignatureV2 {
  let straightIndex = 0;
  const groups: RhythmGroupSpec[] = signature.tokens.map((token, index) => {
    const id = legacyGroupId(index);
    if (token.kind === 'straight') {
      const firstStraight = straightIndex++ === 0;
      const motif: TrackMotifId = firstStraight ? 'true-straight' :
        straightIndex % 2 === 0 ? 'shallow-bow' : 'shallow-s';
      const lobes = motif === 'true-straight' ? [] :
        motif === 'shallow-bow'
          ? [lobe(0, 2, [1, 4])]
          : [lobe(0, 2, [1, 3]), lobe(2, 4, [-3, -1])];
      return {
        id,
        kind: 'nominal-straight',
        motif,
        lengthMetres: token.length,
        lobes,
        movable: false,
        ...(firstStraight ? { role: 'grid-pit' as const } : {}),
        ...(token.flex ? {
          flex: {
            lengthDeltaMetres: [-token.length[0] * 0.2, token.length[1] * 0.2],
            ...(motif === 'true-straight'
              ? {}
              : { shallowBendBiasDelta: [-0.3, 0.3] as NumericRange })
          }
        } : {})
      };
    }
    if (token.kind === 'corner') return {
      id,
      kind: 'corner',
      motif: token.class === 'fast' || token.class === 'kink'
        ? 'long-sweeper'
        : 'single-apex',
      lengthMetres: cornerLength(token.class, token.angleDegrees),
      lobes: [lobe(
        0,
        token.class === 'fast' || token.class === 'kink' ? 4 : 2,
        signedRange(token.direction, token.angleDegrees)
      )],
      radiusClass: token.class,
      movable: true
    };
    const direction = token.direction === 'left' ? 1 : -1;
    const motif = token.complex;
    const lobes = motif === 'double-apex'
      ? [lobe(0, 4, [direction * 95, direction * 125].sort((a, b) => a - b) as [number, number])]
      : motif === 'sweeper-chain'
        ? [
            lobe(0, 2, signedRange(token.direction, [35, 55])),
            lobe(2, 4, signedRange(token.direction === 'left' ? 'right' : 'left', [20, 40])),
            lobe(4, 6, signedRange(token.direction, [30, 50]))
          ]
        : [
            lobe(0, 2, signedRange(token.direction, [35, 55])),
            lobe(2, 4, signedRange(token.direction === 'left' ? 'right' : 'left', [35, 55]))
          ];
    return {
      id,
      kind: 'complex',
      motif,
      lengthMetres: token.length,
      lobes,
      movable: true
    };
  });
  return {
    schemaVersion: 2,
    id: `${signature.id}-v2`,
    name: `${signature.name} (migrated v2)`,
    archetype: signature.archetype,
    winding: 'counter-clockwise',
    groups
  };
}

export function resolvedGroupRadius(group: ResolvedShapeGroup): number {
  let maximum = 0;
  for (const knotSpec of group.knots) maximum = Math.max(maximum, Math.abs(knotSpec.curvatureWeight));
  if (maximum <= 1e-12 || !group.lobes.length) return Infinity;
  const totalAngle = group.lobes.reduce(
    (sum, turnLobe) => sum + Math.abs(turnLobe.angleDegrees) * Math.PI / 180,
    0
  );
  return group.lengthMetres / Math.max(1e-9, totalAngle) / maximum;
}
