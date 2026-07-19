import {
  generateTier0Candidate,
  hardInvariantFailures,
  type TrackArchetype
} from '../src/game/trackgen';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

try {
  const rawSeeds = Number(argument('--seeds') ?? 10_000);
  if (!Number.isInteger(rawSeeds) || rawSeeds < 1)
    throw new Error('--seeds must be a positive integer');
  const archetypes: readonly TrackArchetype[] = ['power', 'balanced', 'technical'];
  let accepted = 0;
  let generationElapsedMilliseconds = 0;
  let invariantElapsedMilliseconds = 0;
  const byArchetype = Object.fromEntries(archetypes.map(archetype => [
    archetype,
    { seeds: 0, accepted: 0, rejected: 0 }
  ])) as Record<TrackArchetype, { seeds: number; accepted: number; rejected: number }>;
  const escapes: Array<{ seed: number; archetype: TrackArchetype; failures: string[] }> = [];
  const started = performance.now();
  for (let seed = 0; seed < rawSeeds; seed++) {
    const archetype = archetypes[seed % archetypes.length]!;
    byArchetype[archetype].seeds++;
    const generationStarted = performance.now();
    const candidate = generateTier0Candidate({ archetype, seed });
    generationElapsedMilliseconds += performance.now() - generationStarted;
    if (!candidate.tier0.accepted) {
      byArchetype[archetype].rejected++;
      continue;
    }
    accepted++;
    byArchetype[archetype].accepted++;
    const invariantStarted = performance.now();
    const failures = hardInvariantFailures(candidate.plan, candidate.geometry);
    invariantElapsedMilliseconds += performance.now() - invariantStarted;
    if (failures.length) escapes.push({ seed, archetype, failures });
  }
  const elapsedMilliseconds = performance.now() - started;
  const candidatesPerSecond = rawSeeds / (generationElapsedMilliseconds / 1_000);
  const report = {
    schemaVersion: 2,
    audit: 'trackgen-hard-invariants',
    seeds: rawSeeds,
    accepted,
    rejected: rawSeeds - accepted,
    byArchetype,
    invariantEscapes: escapes.length,
    escapes: escapes.slice(0, 20),
    elapsedMilliseconds,
    generationElapsedMilliseconds,
    invariantElapsedMilliseconds,
    candidatesPerSecond,
    throughputTargetCandidatesPerSecond: 100,
    throughputTargetMet: candidatesPerSecond >= 100,
    acceptedGenerationCeilingSeconds: 30,
    status: escapes.length === 0 ? 'green' : 'red'
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status === 'red') process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
