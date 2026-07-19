import type {
  RhythmSignature,
  TrackArchetype,
  TrackgenPreset
} from './types';

const POWER_SIGNATURE: RhythmSignature = {
  schemaVersion: 1,
  id: 'preset-power',
  name: 'Power circuit grammar',
  archetype: 'power',
  tokens: [
    { kind: 'straight', length: [1_050, 1_450], flex: true },
    { kind: 'corner', class: 'hairpin', direction: 'left', angleDegrees: [165, 190] },
    { kind: 'straight', length: [620, 900], flex: true },
    { kind: 'complex', complex: 'sweeper-chain', direction: 'right', length: [760, 1_050] },
    { kind: 'corner', class: 'fast', direction: 'left', angleDegrees: [45, 85] },
    { kind: 'straight', length: [720, 1_020], flex: true },
    { kind: 'corner', class: 'medium', direction: 'right', angleDegrees: [70, 115] },
    { kind: 'complex', complex: 'chicane', direction: 'left', length: [260, 420] },
    { kind: 'corner', class: 'slow', direction: 'right', angleDegrees: [85, 125] },
    { kind: 'corner', class: 'kink', direction: 'left', angleDegrees: [18, 35] }
  ]
};

const BALANCED_SIGNATURE: RhythmSignature = {
  schemaVersion: 1,
  id: 'preset-balanced',
  name: 'Balanced circuit grammar',
  archetype: 'balanced',
  tokens: [
    { kind: 'straight', length: [760, 1_050], flex: true },
    { kind: 'complex', complex: 's', direction: 'left', length: [360, 540] },
    { kind: 'corner', class: 'slow', direction: 'right', angleDegrees: [90, 135] },
    { kind: 'corner', class: 'medium', direction: 'left', angleDegrees: [70, 110] },
    { kind: 'straight', length: [520, 760], flex: true },
    { kind: 'complex', complex: 'sweeper-chain', direction: 'right', length: [620, 880] },
    { kind: 'corner', class: 'fast', direction: 'left', angleDegrees: [45, 80] },
    { kind: 'complex', complex: 'double-apex', direction: 'right', length: [340, 520] },
    { kind: 'corner', class: 'hairpin', direction: 'left', angleDegrees: [165, 190] },
    { kind: 'corner', class: 'kink', direction: 'right', angleDegrees: [18, 35] }
  ]
};

const TECHNICAL_SIGNATURE: RhythmSignature = {
  schemaVersion: 1,
  id: 'preset-technical',
  name: 'Technical circuit grammar',
  archetype: 'technical',
  tokens: [
    { kind: 'straight', length: [520, 740], flex: true },
    { kind: 'complex', complex: 'chicane', direction: 'left', length: [240, 360] },
    { kind: 'corner', class: 'hairpin', direction: 'right', angleDegrees: [170, 195] },
    { kind: 'corner', class: 'slow', direction: 'left', angleDegrees: [95, 145] },
    { kind: 'complex', complex: 's', direction: 'right', length: [280, 430] },
    { kind: 'corner', class: 'medium', direction: 'left', angleDegrees: [70, 110] },
    { kind: 'straight', length: [390, 560], flex: true },
    { kind: 'complex', complex: 'double-apex', direction: 'right', length: [300, 450] },
    { kind: 'corner', class: 'fast', direction: 'left', angleDegrees: [40, 70] },
    { kind: 'corner', class: 'kink', direction: 'right', angleDegrees: [16, 32] }
  ]
};

const COMMON_PALETTE = {
  grass: '#91AE70', stripe: '#9AB879', road: '#5C5867', edge: '#F3EEE1',
  shadow: 'rgba(34,30,44,0.18)', tree: '#466F49', tree2: '#568052',
  bush: '#668E58', rock: '#898274', dust: '#C7CAA0'
} as const;

export const TRACKGEN_PRESETS: Readonly<Record<TrackArchetype, TrackgenPreset>> = {
  power: {
    signature: POWER_SIGNATURE,
    policy: {
      lengthMetres: [6_000, 8_000], averageSpeedKmh: [200, 230],
      targetLengthMetres: 7_050, halfExtentMetres: 900,
      upperHeightMetres: 1_200, cornerAmplitudeScale: 2.00
    },
    palette: { ...COMMON_PALETTE, grass: '#829D68', stripe: '#8BA771' }
  },
  balanced: {
    signature: BALANCED_SIGNATURE,
    policy: {
      lengthMetres: [4_000, 5_500], averageSpeedKmh: [180, 200],
      targetLengthMetres: 4_750, halfExtentMetres: 600,
      upperHeightMetres: 1_100, cornerAmplitudeScale: 3.40
    },
    palette: { ...COMMON_PALETTE }
  },
  technical: {
    signature: TECHNICAL_SIGNATURE,
    policy: {
      lengthMetres: [3_000, 4_500], averageSpeedKmh: [160, 180],
      targetLengthMetres: 3_750, halfExtentMetres: 500,
      upperHeightMetres: 800, cornerAmplitudeScale: 1.80
    },
    palette: { ...COMMON_PALETTE, grass: '#A5A47A', stripe: '#AFAD83' }
  }
};

export function presetFor(archetype: TrackArchetype): TrackgenPreset {
  return TRACKGEN_PRESETS[archetype];
}
