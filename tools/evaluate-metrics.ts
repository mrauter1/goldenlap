import { readFileSync } from 'node:fs';
import {
  classifyMetric,
  type MetricObservation,
  type MetricPolicy,
  type MetricStatus
} from './lib/statistics';

interface PolicyDocument {
  schemaVersion: number;
  policies: MetricPolicy[];
}

interface ObservationDocument {
  observations: MetricObservation[];
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

const policyPath = argument('--policy') ?? 'tests/fixtures/calibration/metric-policy.json';
const inputPath = argument('--input');
if (!inputPath) {
  console.error('Usage: bun tools/evaluate-metrics.ts --input <observations.json> [--policy <policy.json>]');
  process.exit(2);
}

try {
  const policyDocument = readJson<PolicyDocument>(policyPath);
  const observationDocument = readJson<ObservationDocument>(inputPath);
  const policies = new Map(policyDocument.policies.map(policy => [policy.id, policy]));
  const results = observationDocument.observations.map(observation => {
    const policy = policies.get(observation.metric);
    if (!policy) throw new Error(`No metric policy for ${observation.metric}`);
    return classifyMetric(policy, observation);
  });
  const counts: Record<MetricStatus, number> = {
    green: 0,
    amber: 0,
    red: 0,
    inconclusive: 0
  };
  for (const result of results) counts[result.status]++;
  const status: MetricStatus = counts.red > 0 ? 'red' :
    counts.inconclusive > 0 ? 'inconclusive' : counts.amber > 0 ? 'amber' : 'green';
  console.log(JSON.stringify({ status, counts, results }, null, 2));
  process.exit(counts.red > 0 ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
