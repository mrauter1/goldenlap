import {
  generateTier0Candidate,
  type TrackArchetype
} from '../src/game/trackgen';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const ARCHETYPES: readonly TrackArchetype[] = ['power', 'balanced', 'technical'];
const MINIMUM_OCCUPIED_BUCKETS = 25;
const MAXIMUM_BUCKET_SHARE = 0.15;
const MAXIMUM_DUPLICATE_RATE = 0.8;

try {
  const seedsPerArchetype = Number(argument('--seeds') ?? 1_000);
  if (!Number.isInteger(seedsPerArchetype) || seedsPerArchetype < 1)
    throw new Error('--seeds must be a positive integer per archetype');
  const started = performance.now();
  const archetypes = ARCHETYPES.map(archetype => {
    const fingerprints = new Map<string, number>();
    let closureSolved = 0;
    let tier0Accepted = 0;
    for (let seed = 0; seed < seedsPerArchetype; seed++) {
      const candidate = generateTier0Candidate({ archetype, seed });
      if (!candidate.geometry.closure.converged) continue;
      closureSolved++;
      if (!candidate.tier0.accepted) continue;
      tier0Accepted++;
      const fingerprint = candidate.tier0.metrics.topology.structuralFingerprint;
      fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1);
    }
    const maximumBucket = Math.max(0, ...fingerprints.values());
    const occupiedBuckets = fingerprints.size;
    const maximumBucketShare = tier0Accepted ? maximumBucket / tier0Accepted : 1;
    const duplicateRate = tier0Accepted
      ? 1 - occupiedBuckets / tier0Accepted
      : 1;
    const status = tier0Accepted > 0 &&
      occupiedBuckets >= Math.min(MINIMUM_OCCUPIED_BUCKETS, tier0Accepted) &&
      maximumBucketShare <= MAXIMUM_BUCKET_SHARE &&
      duplicateRate <= MAXIMUM_DUPLICATE_RATE
      ? 'green'
      : 'red';
    return {
      archetype,
      seeds: seedsPerArchetype,
      closureSolved,
      tier0Accepted,
      occupiedBuckets,
      maximumBucket,
      maximumBucketShare,
      duplicateRate,
      status
    };
  });
  const report = {
    schemaVersion: 1,
    audit: 'trackgen-topology-diversity',
    seedsPerArchetype,
    bands: {
      minimumOccupiedBuckets: MINIMUM_OCCUPIED_BUCKETS,
      maximumBucketShare: MAXIMUM_BUCKET_SHARE,
      maximumDuplicateRate: MAXIMUM_DUPLICATE_RATE
    },
    archetypes,
    elapsedMilliseconds: performance.now() - started,
    status: archetypes.every(result => result.status === 'green') ? 'green' : 'red'
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status === 'red') process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
