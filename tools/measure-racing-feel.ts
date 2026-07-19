import { prepareHeadlessTrack, runHeadlessRace } from './lib/headless-sim';
import {
  PASS_RATE_SETTLING_LAPS,
  productionDistanceEquivalentPasses
} from './lib/race-metrics';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const tracks = (argument('--tracks') ?? 'prado,nordwald,anhembi')
  .split(',')
  .filter(Boolean);
const seed = Number(argument('--seed') ?? 101);
if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
const simulatedLaps = Number(argument('--laps') ?? 1);
if (!Number.isInteger(simulatedLaps) || simulatedLaps <= 0)
  throw new Error('--laps must be a positive integer');

const started = performance.now();
const results = tracks.map(trackId => {
  const summary = runHeadlessRace(prepareHeadlessTrack(trackId), {
    seed,
    laps: simulatedLaps,
    wet: 0
  });
  return {
    trackId,
    reason: summary.reason,
    classificationValid: summary.classificationValid,
    simulatedLaps: summary.laps,
    productionLaps: summary.productionLaps,
    simulatedSeconds: summary.simulatedSeconds,
    passesObserved: summary.metrics.passes,
    fullRaceEquivalentPasses: productionDistanceEquivalentPasses(
      summary.metrics.passes,
      summary.laps,
      summary.productionLaps
    ),
    projectionSettlingLaps: PASS_RATE_SETTLING_LAPS,
    contacts: summary.metrics.contacts,
    lightContacts: summary.metrics.lightContacts,
    hardContacts: summary.metrics.hardContacts,
    openingHardContacts: summary.metrics.openingHardContacts,
    sideBySideMedianSeconds: summary.metrics.sideBySideDurations.length
      ? [...summary.metrics.sideBySideDurations]
          .sort((left, right) => left - right)[
            Math.floor(summary.metrics.sideBySideDurations.length / 2)
          ]
      : 0,
    attackInitiations: summary.metrics.attackInitiations,
    attackCompletions: summary.metrics.attackCompletions,
    stationGapDistribution: {
      samples: summary.metrics.stationGapSamples,
      meanMetres: summary.metrics.stationGapMeanMetres,
      standardDeviationMetres: summary.metrics.stationGapStdDevMetres,
      minimumMetres: summary.metrics.stationGapMinimumMetres,
      maximumMetres: summary.metrics.stationGapMaximumMetres
    },
    unexplainedStalls: summary.metrics.unexplainedStalls,
    pitDeadlocks: summary.metrics.pitDeadlocks,
    pitDeadlockSamples: [
      ...summary.diagnostics.pitDeadlocks.slice(0, 5),
      ...summary.diagnostics.pitDeadlocks.slice(-5)
    ],
    pitStates: summary.diagnostics.pitStates,
    checksum: summary.checksum
  };
});

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  seed,
  elapsedSeconds: (performance.now() - started) / 1000,
  passMeasurement: simulatedLaps === 1
    ? 'one-lap observed and production-distance equivalent'
    : 'observed over requested laps and production-distance equivalent',
  results
}, null, 2));
