import { TRACK_DEFS } from '../src/data/tracks';
import {
  generateTier0Candidate,
  measureTrackTopology,
  normalizedRouteDistance,
  type TrackArchetype,
  type TrackgenPoint
} from '../src/game/trackgen';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function summary(values: readonly number[]): {
  minimum: number;
  mean: number;
  maximum: number;
} {
  return {
    minimum: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    maximum: Math.max(...values)
  };
}

try {
  const seeds = Number(argument('--seeds') ?? 60);
  if (!Number.isInteger(seeds) || seeds < 3)
    throw new Error('--seeds must be an integer of at least 3');
  const archetypes: readonly TrackArchetype[] = ['power', 'balanced', 'technical'];
  const generated = archetypes.map(archetype => {
    const candidates = Array.from({ length: seeds }, (_, seed) =>
      generateTier0Candidate({ archetype, seed }));
    const metrics = candidates.map(candidate => measureTrackTopology(candidate.geometry.points));
    const reference = candidates[0]!.geometry.points;
    const distances = candidates.slice(1).map(candidate =>
      normalizedRouteDistance(reference, candidate.geometry.points));
    const fingerprints = new Set(metrics.map(metric => metric.structuralFingerprint));
    return {
      archetype,
      seeds,
      distinctStructuralFingerprints: fingerprints.size,
      referenceDistance: summary(distances),
      convexHullFill: summary(metrics.map(metric => metric.convexHullFill)),
      primaryAxisReversals: summary(metrics.map(metric => metric.primaryAxisReversals)),
      secondaryAxisReversals: summary(metrics.map(metric => metric.secondaryAxisReversals)),
      curvatureSignRuns: summary(metrics.map(metric => metric.curvatureSignRuns)),
      returnSectionPairs: summary(metrics.map(metric => metric.returnSectionPairs))
    };
  });
  const authored = TRACK_DEFS.map(definition => {
    const points: TrackgenPoint[] = definition.pts.map(([x, y]) => ({ x, y }));
    return {
      id: definition.id,
      ...measureTrackTopology(points)
    };
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    characterization: 'trackgen-topology',
    generated,
    authored
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
