import { prepareHeadlessTrack, runHeadlessRace } from './lib/headless-sim';
import { emitAuditEvent } from './lib/audit-events';
import { raceInvariantFailures } from './lib/audit-invariants';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

try {
  const trackId = argument('--track');
  const weather = argument('--weather');
  const rawSeeds = argument('--seeds');
  if (!trackId || (weather !== 'dry' && weather !== 'wet') || !rawSeeds)
    throw new Error('Usage: --track <id> --weather <dry|wet> --seeds <comma-list>');
  const seeds = rawSeeds.split(',').map(Number);
  if (!seeds.length || seeds.some(seed => !Number.isInteger(seed)))
    throw new Error('Every race seed must be an integer');
  const built = prepareHeadlessTrack(trackId);
  const invalidOnly = hasFlag('--invalid-only');
  const summaries = [];
  emitAuditEvent('race-stratum', 'suite-start', {
    trackId, weather, total: seeds.length, status: 'running'
  });
  let completed = 0;
  for (const seed of seeds) {
    const caseId = `${trackId}/${weather}/${seed}`;
    emitAuditEvent('race-stratum', 'case-start', {
      phase: 'race', caseId, completed, total: seeds.length, status: 'running'
    });
    const summary = runHeadlessRace(built, {
      seed,
      laps: 1,
      wet: weather === 'wet' ? 0.65 : 0,
      includeLapStrata: true,
      includeClassificationDiagnostics: invalidOnly
    });
    const failures = raceInvariantFailures(summary);
    completed++;
    emitAuditEvent('race-stratum', 'case-result', {
      phase: 'race',
      caseId,
      completed,
      total: seeds.length,
      status: failures.length ? 'failed' : 'green',
      contacts: summary.metrics.contacts,
      lightContacts: summary.metrics.lightContacts,
      hardContacts: summary.metrics.hardContacts,
      dnfs: summary.metrics.dnfs,
      failures
    });
    if (failures.length)
      throw new Error(`Hard invariant failed for ${caseId}: ${failures.join(', ')}`);
    if (!invalidOnly || !summary.classificationValid) summaries.push(summary);
    if (invalidOnly && !summary.classificationValid) break;
  }
  emitAuditEvent('race-stratum', 'suite-result', {
    trackId, weather, completed, total: seeds.length, status: 'green'
  });
  process.stdout.write(JSON.stringify(summaries));
} catch (error) {
  emitAuditEvent('race-stratum', 'failure', {
    status: 'failed', message: error instanceof Error ? error.message : String(error)
  });
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(2);
}
