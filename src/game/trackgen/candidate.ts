import { realizeRhythmPlanV2 } from './closure';
import { resolveRhythmPlanV2, signatureV2ForArchetype } from './grammar';
import { evaluateTier0 } from './gates';
import type {
  RhythmSignatureInput,
  TrackArchetype,
  TrackgenCandidate
} from './types';

export interface GenerateTier0Options {
  archetype: TrackArchetype;
  seed: number;
  signature?: RhythmSignatureInput;
}

export function generateTier0Candidate(options: GenerateTier0Options): TrackgenCandidate {
  const signature = options.signature ?? signatureV2ForArchetype(options.archetype);
  const plan = resolveRhythmPlanV2(options.archetype, options.seed, signature);
  const geometry = realizeRhythmPlanV2(plan);
  return {
    schemaVersion: 2,
    seed: plan.seed,
    archetype: plan.archetype,
    signatureId: plan.signatureId,
    plan,
    geometry,
    tier0: evaluateTier0(plan, geometry)
  };
}
