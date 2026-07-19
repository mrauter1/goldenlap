import {
  detectSemanticCorners,
  legacyRacingLine,
  previewIdealLine,
  refineSemanticCorners,
  speedProfile,
  type IdealLinePreview
} from '../../core/racing-line';
import { buildTrack } from '../../core/track';
import type { LegacyCorner, Track } from '../../core/model';
import type { TrackDefinition } from '../../shared/types';
import { stableFingerprint } from '../../shared/stable-json';
import { generateTier0Candidate } from './candidate';
import { normalizeRhythmSignature, signatureV2ForArchetype } from './grammar';
import { presetFor } from './presets';
import type {
  RhythmSignatureInput,
  TrackArchetype,
  TrackgenCandidate,
  TrackgenGateResult
} from './types';

/** Calibrated below the third-strongest legacy pass zone on the reference calendar. */
export const TRACKGEN_PASS_SPOT_SCORE = 1_000_000;

export interface TrackgenQualityMetrics {
  semanticCorners: number;
  passSpots: number;
  bestPassScore: number;
  linkedComplexes: number;
  rhythmVariance: number;
  widthUtilization: number;
  draftLapSeconds: number;
  draftAverageSpeedKmh: number;
  draftMaximumHeadingStep: number;
}

export interface TrackgenQualityEvaluation {
  accepted: boolean;
  metrics: TrackgenQualityMetrics;
  gates: readonly TrackgenGateResult[];
}

export interface TrackgenDraftAnalysis {
  track: Track;
  corners: readonly LegacyCorner[];
  draft: IdealLinePreview;
}

export interface TrackGenerationArtifact {
  schemaVersion: 2;
  generatorVersion: string;
  signatureSchemaVersion: 2;
  seed: number;
  sourceSeed: number;
  attempt: number;
  archetype: TrackArchetype;
  signatureId: string;
  signatureFingerprint: string;
  definitionFingerprint: string;
  provenanceHash: string;
  resolvedPlan: TrackgenCandidate['plan'];
  realization: {
    groups: TrackgenCandidate['geometry']['groups'];
    closure: TrackgenCandidate['geometry']['closure'];
  };
  tier0: TrackgenCandidate['tier0'];
  tier1: TrackgenQualityEvaluation;
  deeperValidation: {
    headlessProbe: 'pending' | 'passed' | 'failed';
    profileWorkflow: 'pending' | 'passed' | 'failed';
    auditEffects?: 'pending' | 'passed' | 'amber' | 'failed';
    cameraMinimapReview?: 'pending' | 'passed' | 'failed';
    evidence?: Readonly<Record<string, string | number | boolean>>;
  };
}

export interface AcceptedTrackGeneration {
  definition: TrackDefinition;
  candidate: TrackgenCandidate;
  quality: TrackgenQualityEvaluation;
  artifact: TrackGenerationArtifact;
  attempts: number;
}

export interface GenerateAcceptedTrackOptions {
  archetype: TrackArchetype;
  seed: number;
  signature?: RhythmSignatureInput;
  maximumAttempts?: number;
  id?: string;
  name?: string;
}

export function analyzeTrackDraft(definition: TrackDefinition): TrackgenDraftAnalysis {
  const track = buildTrack(definition);
  const center = speedProfile(track);
  detectSemanticCorners(track, center);
  const bootstrap = legacyRacingLine(track);
  const corners = refineSemanticCorners(track, bootstrap);
  const draft = previewIdealLine(track, 65, 0.45);
  return { track, corners, draft };
}

function gate(
  id: string,
  value: number,
  unit: string,
  bounds: { minimum?: number; maximum?: number }
): TrackgenGateResult {
  const minimum = bounds.minimum === undefined || value >= bounds.minimum - 1e-9;
  const maximum = bounds.maximum === undefined || value <= bounds.maximum + 1e-9;
  return { id, value, unit, ...bounds, status: minimum && maximum ? 'pass' : 'fail' };
}

function emptyQualityMetrics(): TrackgenQualityMetrics {
  return {
    semanticCorners: 0,
    passSpots: 0,
    bestPassScore: 0,
    linkedComplexes: 0,
    rhythmVariance: 0,
    widthUtilization: 0,
    draftLapSeconds: Infinity,
    draftAverageSpeedKmh: 0,
    draftMaximumHeadingStep: Infinity
  };
}

function prerequisiteFailure(): TrackgenQualityEvaluation {
  return {
    accepted: false,
    metrics: emptyQualityMetrics(),
    gates: [gate('trackgen.tier0_prerequisite', 0, 'boolean', { minimum: 1 })]
  };
}

function draftBuildFailure(): TrackgenQualityEvaluation {
  return {
    accepted: false,
    metrics: emptyQualityMetrics(),
    gates: [gate('trackgen.draft_line_build', 0, 'boolean', { minimum: 1 })]
  };
}

function cyclicDistance(count: number, from: number, to: number): number {
  return ((to - from + count) % count + count) % count;
}

function rhythmVariance(trackLength: number, samples: number, apexIndices: readonly number[]): number {
  if (apexIndices.length < 3) return 0;
  const distances = apexIndices.map((index, position) => {
    const next = apexIndices[(position + 1) % apexIndices.length]!;
    return cyclicDistance(samples, index, next) / samples * trackLength;
  });
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    distances.length;
  return Math.sqrt(variance) / Math.max(1e-9, mean);
}

export function definitionFromCandidate(
  candidate: TrackgenCandidate,
  identity: { id?: string; name?: string } = {}
): TrackDefinition {
  const suffix = candidate.seed.toString(16).padStart(8, '0');
  const id = identity.id ?? `generated-${candidate.archetype}-${suffix}`;
  const preset = presetFor(candidate.archetype);
  const baseWidth = candidate.geometry.widthProfile.reduce(
    (sum, key) => sum + key.width, 0
  ) / candidate.geometry.widthProfile.length;
  return {
    id,
    no: 'G1',
    name: identity.name ?? `Generated ${candidate.archetype} ${suffix.slice(-4).toUpperCase()}`,
    country: 'GEN',
    width: Math.round(baseWidth * 1e6) / 1e6,
    widthProfile: candidate.geometry.widthProfile,
    pit: { class: 'grand' },
    seed: candidate.seed,
    meta: {
      archetype: candidate.archetype,
      generated: true,
      signature: candidate.signatureId,
      sourceSeed: candidate.seed,
      blurb: `Seeded ${candidate.archetype} circuit from ${candidate.signatureId}.`
    },
    pal: preset.palette,
    pts: candidate.geometry.points.map(point => [point.x, point.y] as const)
  };
}

export function evaluateTrackQualityFromDraft(
  candidate: TrackgenCandidate,
  analysis: TrackgenDraftAnalysis
): TrackgenQualityEvaluation {
  if (!candidate.tier0.accepted) return prerequisiteFailure();
  const { track, corners, draft } = analysis;
  const passScores = corners.map(corner => corner.passScore).sort((left, right) => right - left);
  const passSpots = passScores.filter(score => score >= TRACKGEN_PASS_SPOT_SCORE).length;
  const complexIds = new Set(corners.flatMap(corner => corner.complexId ? [corner.complexId] : []));
  let maximumUtilization = 0;
  for (let index = 0; index < draft.path.off.length; index++) {
    const usable = Math.max(1e-9, track.halfWidth[index]! - 1.85);
    maximumUtilization = Math.max(
      maximumUtilization,
      Math.abs(draft.path.off[index]!) / usable
    );
  }
  const variance = rhythmVariance(track.len, track.n, corners.map(corner => corner.apexI));
  const metrics: TrackgenQualityMetrics = {
    semanticCorners: corners.length,
    passSpots,
    bestPassScore: passScores[0] ?? 0,
    linkedComplexes: complexIds.size,
    rhythmVariance: variance,
    widthUtilization: maximumUtilization,
    draftLapSeconds: draft.timing.lapTime,
    draftAverageSpeedKmh: track.len / draft.timing.lapTime * 3.6,
    draftMaximumHeadingStep: draft.maxHeadingStep
  };
  const gates = [
    gate('trackgen.pass_spots', metrics.passSpots, 'corners', { minimum: 2 }),
    gate('trackgen.semantic_corners', metrics.semanticCorners, 'corners', { minimum: 7 }),
    gate('trackgen.linked_semantic_complexes', metrics.linkedComplexes, 'complexes', {
      minimum: 1
    }),
    gate('trackgen.rhythm_variance', metrics.rhythmVariance, 'coefficient', {
      minimum: 0.18
    }),
    gate('trackgen.width_utilization', metrics.widthUtilization, 'fraction', {
      minimum: 0.35, maximum: 1.2
    }),
    gate('trackgen.draft_heading_step', metrics.draftMaximumHeadingStep, 'rad', {
      maximum: 0.18
    }),
    gate('trackgen.draft_lap_seconds', metrics.draftLapSeconds, 's', {
      minimum: 55, maximum: 150
    })
  ];
  return { accepted: gates.every(result => result.status === 'pass'), metrics, gates };
}

export function evaluateTrackQuality(
  candidate: TrackgenCandidate,
  definition = definitionFromCandidate(candidate)
): TrackgenQualityEvaluation {
  if (!candidate.tier0.accepted) return prerequisiteFailure();
  try {
    return evaluateTrackQualityFromDraft(candidate, analyzeTrackDraft(definition));
  } catch {
    return draftBuildFailure();
  }
}

function attemptSeed(sourceSeed: number, attempt: number): number {
  return (sourceSeed + Math.imul(attempt, 0x9E3779B9)) >>> 0;
}

export function generateAcceptedTrack(
  options: GenerateAcceptedTrackOptions
): AcceptedTrackGeneration {
  const maximumAttempts = options.maximumAttempts ?? 50;
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 500)
    throw new Error('maximumAttempts must be an integer in [1, 500]');
  for (let attempt = 0; attempt < maximumAttempts; attempt++) {
    const candidate = generateTier0Candidate({
      archetype: options.archetype,
      seed: attemptSeed(options.seed >>> 0, attempt),
      ...(options.signature === undefined ? {} : { signature: options.signature })
    });
    if (!candidate.tier0.accepted) continue;
    const definition = definitionFromCandidate(candidate, {
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.name === undefined ? {} : { name: options.name })
    });
    const quality = evaluateTrackQuality(candidate, definition);
    if (!quality.accepted) continue;
    const normalizedSignature = normalizeRhythmSignature(
      options.signature ?? signatureV2ForArchetype(options.archetype)
    );
    const signatureFingerprint = stableFingerprint(normalizedSignature);
    const definitionFingerprint = stableFingerprint(definition);
    const provenanceHash = stableFingerprint({
      generatorVersion: 'trackgen-topology-v2',
      sourceSeed: options.seed >>> 0,
      attempt,
      signatureFingerprint,
      definitionFingerprint,
      resolvedPlan: candidate.plan,
      closure: candidate.geometry.closure,
      tier0: candidate.tier0.metrics,
      tier1: quality.metrics
    });
    const artifact: TrackGenerationArtifact = {
      schemaVersion: 2,
      generatorVersion: 'trackgen-topology-v2',
      signatureSchemaVersion: 2,
      seed: candidate.seed,
      sourceSeed: options.seed >>> 0,
      attempt,
      archetype: options.archetype,
      signatureId: candidate.signatureId,
      signatureFingerprint,
      definitionFingerprint,
      provenanceHash,
      resolvedPlan: candidate.plan,
      realization: {
        groups: candidate.geometry.groups,
        closure: candidate.geometry.closure
      },
      tier0: candidate.tier0,
      tier1: quality,
      deeperValidation: { headlessProbe: 'pending', profileWorkflow: 'pending' }
    };
    return { definition, candidate, quality, artifact, attempts: attempt + 1 };
  }
  throw new Error(
    `No accepted ${options.archetype} track in ${maximumAttempts} attempts from seed ${options.seed}`
  );
}
