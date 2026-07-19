import { TRACKGEN_PRESETS } from './presets';
import type {
  ClosureFlexSpec,
  NumericRange,
  RhythmGroupKind,
  RhythmGroupSpec,
  RhythmSignatureV2,
  TrackArchetype,
  TrackCornerClass,
  TrackMotifId,
  TrackgenPresetV2,
  TurnLobeSpec
} from './types';

interface GroupOptions {
  id: string;
  kind: RhythmGroupKind;
  motif: TrackMotifId;
  length: NumericRange;
  angles?: readonly NumericRange[];
  spans?: readonly (readonly [number, number])[];
  radiusClass?: TrackCornerClass;
  movable?: boolean;
  role?: 'grid-pit' | 'landmark';
  flex?: ClosureFlexSpec;
}

function group(options: GroupOptions): RhythmGroupSpec {
  const spans = options.spans ?? [];
  const angles = options.angles ?? [];
  if (spans.length !== angles.length)
    throw new Error(`Preset group ${options.id} has mismatched lobe spans`);
  const lobes: TurnLobeSpec[] = spans.map((span, index) => ({
    firstKnot: span[0],
    lastKnot: span[1],
    angleDegrees: angles[index]!
  }));
  return {
    id: options.id,
    kind: options.kind,
    motif: options.motif,
    lengthMetres: options.length,
    lobes,
    movable: options.movable ?? options.kind !== 'nominal-straight',
    ...(options.radiusClass === undefined ? {} : { radiusClass: options.radiusClass }),
    ...(options.role === undefined ? {} : { role: options.role }),
    ...(options.flex === undefined ? {} : { flex: options.flex })
  };
}

const ONE = [[0, 2]] as const;
const SWEEPER = [[0, 4]] as const;
const TWO = [[0, 2], [2, 4]] as const;
const THREE = [[0, 2], [2, 4], [4, 6]] as const;

const POWER_SIGNATURE: RhythmSignatureV2 = {
  schemaVersion: 2,
  id: 'preset-power-v2',
  name: 'Power topology grammar',
  archetype: 'power',
  winding: 'counter-clockwise',
  groups: [
    group({
      id: 'pit-straight', kind: 'nominal-straight', motif: 'true-straight',
      length: [1_050, 1_180], role: 'grid-pit', movable: false
    }),
    group({
      id: 'opening-hairpin', kind: 'corner', motif: 'single-apex',
      length: [145, 175], angles: [[170, 180]], spans: ONE,
      radiusClass: 'hairpin'
    }),
    group({
      id: 'return-bow', kind: 'nominal-straight', motif: 'shallow-bow',
      length: [820, 960], angles: [[2, 5]], spans: ONE, movable: false,
      flex: { lengthDeltaMetres: [-280, 280], shallowBendBiasDelta: [-0.5, 0.5] }
    }),
    group({
      id: 'sweeper-chain', kind: 'complex', motif: 'sweeper-chain',
      length: [820, 950], angles: [[-78, -66], [130, 150], [-64, -53]], spans: THREE
    }),
    group({
      id: 'fast-left', kind: 'corner', motif: 'long-sweeper',
      length: [330, 390], angles: [[62, 70]], spans: SWEEPER,
      radiusClass: 'fast'
    }),
    group({
      id: 'back-bow', kind: 'nominal-straight', motif: 'shallow-s',
      length: [900, 1_030], angles: [[2, 4], [-4, -2]], spans: TWO, movable: false,
      flex: { lengthDeltaMetres: [-300, 300], shallowBendBiasDelta: [-0.5, 0.5] }
    }),
    group({
      id: 'medium-right', kind: 'corner', motif: 'late-apex',
      length: [170, 220], angles: [[-84, -76]], spans: ONE,
      radiusClass: 'medium'
    }),
    group({
      id: 'heavy-chicane', kind: 'complex', motif: 'chicane',
      length: [310, 370], angles: [[84, 96], [-96, -84]], spans: TWO
    }),
    group({
      id: 'slow-left', kind: 'corner', motif: 'decreasing-radius',
      length: [165, 205], angles: [[100, 110]], spans: [[0, 3]],
      radiusClass: 'slow'
    }),
    group({
      id: 'third-bow', kind: 'nominal-straight', motif: 'shallow-bow',
      length: [780, 920], angles: [[-4, -2]], spans: ONE, movable: false,
      flex: { lengthDeltaMetres: [-260, 260] }
    }),
    group({
      id: 'kink-right', kind: 'corner', motif: 'single-apex',
      length: [135, 175], angles: [[-28, -22]], spans: ONE,
      radiusClass: 'kink',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-20, 20] }] }
    }),
    group({
      id: 'closing-sweeper', kind: 'corner', motif: 'long-sweeper',
      length: [720, 840], angles: [[106, 114]], spans: SWEEPER,
      radiusClass: 'kink',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-24, 24] }] }
    })
  ]
};

const BALANCED_SIGNATURE: RhythmSignatureV2 = {
  schemaVersion: 2,
  id: 'preset-balanced-v2',
  name: 'Balanced topology grammar',
  archetype: 'balanced',
  winding: 'counter-clockwise',
  groups: [
    group({
      id: 'pit-straight', kind: 'nominal-straight', motif: 'true-straight',
      length: [800, 900], role: 'grid-pit', movable: false
    }),
    group({
      id: 'opening-s', kind: 'complex', motif: 's',
      length: [390, 460], angles: [[76, 88], [-88, -76]], spans: TWO
    }),
    group({
      id: 'slow-left', kind: 'corner', motif: 'early-apex',
      length: [150, 190], angles: [[105, 115]], spans: ONE,
      radiusClass: 'slow'
    }),
    group({
      id: 'medium-right', kind: 'corner', motif: 'decreasing-radius',
      length: [190, 230], angles: [[-90, -82]], spans: [[0, 3]],
      radiusClass: 'medium'
    }),
    group({
      id: 'middle-bow', kind: 'nominal-straight', motif: 'shallow-bow',
      length: [580, 690], angles: [[2, 5]], spans: ONE, movable: false,
      flex: { lengthDeltaMetres: [-240, 240], shallowBendBiasDelta: [-0.5, 0.5] }
    }),
    group({
      id: 'flowing-chain', kind: 'complex', motif: 'sweeper-chain',
      length: [590, 680], angles: [[55, 66], [-127, -108], [72, 88]], spans: THREE
    }),
    group({
      id: 'fast-left', kind: 'corner', motif: 'long-sweeper',
      length: [300, 360], angles: [[62, 68]], spans: SWEEPER,
      radiusClass: 'fast',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-18, 18] }] }
    }),
    group({
      id: 'double-right', kind: 'corner', motif: 'double-apex',
      length: [320, 380], angles: [[-104, -96]], spans: SWEEPER,
      radiusClass: 'medium'
    }),
    group({
      id: 'hairpin-left', kind: 'corner', motif: 'late-apex',
      length: [155, 185], angles: [[170, 180]], spans: ONE,
      radiusClass: 'hairpin',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-15, 15] }] }
    }),
    group({
      id: 'kink-right', kind: 'corner', motif: 'single-apex',
      length: [145, 175], angles: [[-25, -20]], spans: ONE,
      radiusClass: 'kink',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-4, 4] }] }
    }),
    group({
      id: 'closing-sweeper', kind: 'corner', motif: 'long-sweeper',
      length: [420, 500], angles: [[196, 204]], spans: SWEEPER,
      radiusClass: 'medium',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-25, 25] }] }
    }),
    group({
      id: 'closing-bow', kind: 'nominal-straight', motif: 'shallow-s',
      length: [430, 520], angles: [[2, 4], [-4, -2]], spans: TWO, movable: false,
      flex: { lengthDeltaMetres: [-220, 220] }
    })
  ]
};

const TECHNICAL_SIGNATURE: RhythmSignatureV2 = {
  schemaVersion: 2,
  id: 'preset-technical-v2',
  name: 'Technical topology grammar',
  archetype: 'technical',
  winding: 'clockwise',
  groups: [
    group({
      id: 'pit-straight', kind: 'nominal-straight', motif: 'true-straight',
      length: [680, 760], role: 'grid-pit', movable: false
    }),
    group({
      id: 'opening-chicane', kind: 'complex', motif: 'chicane',
      length: [260, 320], angles: [[138, 158], [-158, -138]], spans: TWO
    }),
    group({
      id: 'hairpin-right', kind: 'corner', motif: 'single-apex',
      length: [145, 175], angles: [[-180, -170]], spans: ONE,
      radiusClass: 'hairpin'
    }),
    group({
      id: 'slow-left', kind: 'corner', motif: 'late-apex',
      length: [140, 175], angles: [[105, 115]], spans: ONE,
      radiusClass: 'slow'
    }),
    group({
      id: 'middle-s', kind: 'complex', motif: 's',
      length: [310, 370], angles: [[-138, -119], [119, 138]], spans: TWO
    }),
    group({
      id: 'medium-right', kind: 'corner', motif: 'decreasing-radius',
      length: [165, 205], angles: [[-90, -82]], spans: [[0, 3]],
      radiusClass: 'medium'
    }),
    group({
      id: 'short-bow', kind: 'nominal-straight', motif: 'shallow-bow',
      length: [350, 410], angles: [[-5, -2]], spans: ONE, movable: false,
      flex: { lengthDeltaMetres: [-200, 200], shallowBendBiasDelta: [-0.5, 0.5] }
    }),
    group({
      id: 'double-right', kind: 'corner', motif: 'double-apex',
      length: [270, 320], angles: [[-104, -96]], spans: SWEEPER,
      radiusClass: 'medium'
    }),
    group({
      id: 'fast-left', kind: 'corner', motif: 'long-sweeper',
      length: [250, 310], angles: [[56, 64]], spans: SWEEPER,
      radiusClass: 'fast'
    }),
    group({
      id: 'kink-right', kind: 'corner', motif: 'single-apex',
      length: [220, 260], angles: [[-28, -22]], spans: ONE,
      radiusClass: 'kink',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-20, 20] }] }
    }),
    group({
      id: 'closing-sweeper', kind: 'corner', motif: 'long-sweeper',
      length: [410, 480], angles: [[-150, -140]], spans: SWEEPER,
      radiusClass: 'medium',
      flex: { lobes: [{ lobe: 0, angleDeltaDegrees: [-25, 25] }] }
    }),
    group({
      id: 'return-bow', kind: 'nominal-straight', motif: 'shallow-s',
      length: [300, 360], angles: [[2, 4], [-4, -2]], spans: TWO, movable: false,
      flex: { lengthDeltaMetres: [-180, 180] }
    }),
    group({
      id: 'last-burst', kind: 'transition', motif: 'sweeper-chain',
      length: [340, 410], angles: [[-50, -42], [90, 102], [-50, -42]], spans: THREE,
      movable: false,
      flex: { lengthDeltaMetres: [-180, 180] }
    })
  ]
};

function orderMovableGroups(
  signature: RhythmSignatureV2,
  orderedIds: readonly string[]
): RhythmSignatureV2 {
  const movable = signature.groups.filter(item =>
    item.movable && item.kind !== 'nominal-straight'
  );
  if (movable.length !== orderedIds.length ||
      new Set(orderedIds).size !== orderedIds.length)
    throw new Error(`Preset ${signature.id} has an invalid movable-group order`);
  const byId = new Map(movable.map(item => [item.id, item]));
  const ordered = orderedIds.map(id => {
    const item = byId.get(id);
    if (!item) throw new Error(`Preset ${signature.id} cannot order unknown group ${id}`);
    return item;
  });
  let cursor = 0;
  return {
    ...signature,
    groups: signature.groups.map(item =>
      item.movable && item.kind !== 'nominal-straight'
        ? ordered[cursor++]!
        : item
    )
  };
}

export const TRACKGEN_V2_SIGNATURES: Readonly<Record<TrackArchetype, RhythmSignatureV2>> = {
  power: orderMovableGroups(POWER_SIGNATURE, [
    'slow-left',
    'fast-left',
    'heavy-chicane',
    'medium-right',
    'kink-right',
    'opening-hairpin',
    'closing-sweeper',
    'sweeper-chain'
  ]),
  balanced: orderMovableGroups(BALANCED_SIGNATURE, [
    'slow-left',
    'flowing-chain',
    'fast-left',
    'hairpin-left',
    'kink-right',
    'medium-right',
    'double-right',
    'opening-s',
    'closing-sweeper'
  ]),
  technical: orderMovableGroups(TECHNICAL_SIGNATURE, [
    'double-right',
    'kink-right',
    'closing-sweeper',
    'slow-left',
    'middle-s',
    'medium-right',
    'opening-chicane',
    'fast-left',
    'hairpin-right'
  ])
};

export function presetV2For(archetype: TrackArchetype): TrackgenPresetV2 {
  const legacy = TRACKGEN_PRESETS[archetype];
  return {
    signature: TRACKGEN_V2_SIGNATURES[archetype],
    policy: legacy.policy,
    palette: legacy.palette
  };
}
