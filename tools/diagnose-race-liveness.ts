import { prepareHeadlessTrack, runHeadlessRace } from './lib/headless-sim';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const trackId = argument('--track') ?? 'villa';
const seed = Number(argument('--seed') ?? 1_011_111);
const wet = Number(argument('--wet') ?? 0);
const includeClassification = process.argv.includes('--classification');
if (!Number.isInteger(seed) || !Number.isFinite(wet))
  throw new Error('--seed must be an integer and --wet must be finite');
const summary = runHeadlessRace(prepareHeadlessTrack(trackId), {
  seed,
  laps: 1,
  wet,
  includeClassificationDiagnostics: includeClassification,
  includePerformanceDiagnostics: true
});
console.log(JSON.stringify({
  trackId: summary.trackId,
  seed: summary.seed,
  reason: summary.reason,
  simulatedSeconds: summary.simulatedSeconds,
  classificationValid: summary.classificationValid,
  contacts: summary.metrics.contacts,
  dnfs: summary.metrics.dnfs,
  pitDeadlocks: summary.metrics.pitDeadlocks,
  unexplainedStalls: summary.metrics.unexplainedStalls,
  maximumCandidates: summary.metrics.maximumCandidates,
  maximumPathsMaterialized: summary.metrics.maximumPathsMaterialized,
  candidatesEvaluated: summary.metrics.candidatesEvaluated,
  pathsMaterialized: summary.metrics.pathsMaterialized,
  retainedPitPaths: summary.performance?.retainedPitPaths,
  retainedDecisionCandidates: summary.performance?.retainedDecisionCandidates,
  candidateRejections: summary.diagnostics.candidateRejections,
  ...(includeClassification ? { classification: summary.diagnostics.classification } : {})
}, null, 2));
process.exit(summary.classificationValid ? 0 : 1);
