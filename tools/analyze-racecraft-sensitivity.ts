import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  RACECRAFT_CALIBRATION_DEFAULTS,
  RACECRAFT_CALIBRATION_DEFINITIONS,
  withRacecraftCalibration,
  type RacecraftCalibration
} from '../src/session/racecraft/config';
import { stableFingerprint } from '../src/shared/stable-json';
import {
  prepareHeadlessTrack,
  runFocusedSession,
  type FocusedSessionOptions,
  type FocusedSessionSummary
} from './lib/headless-sim';

interface Probe {
  trackId: 'prado' | 'anhembi';
  wet: number;
  seed: number;
  options: FocusedSessionOptions;
}

interface Aggregate {
  contactsPerScenario: number;
  hardContactsPerScenario: number;
  sideBySideSecondsPerScenario: number;
  obligationObservationFraction: number;
  yieldLossSecondsPerObligation: number;
  progressDeltaMetres: number;
  rejectionsPerScenario: number;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function probes(): Probe[] {
  const result: Probe[] = [];
  const options: FocusedSessionOptions[] = [
    { scenario: 'pair', phase: 'straight', closingSpeedMps: 2, initialGapM: 22 },
    { scenario: 'pair', phase: 'straight', closingSpeedMps: 3, initialGapM: 28 },
    { scenario: 'pair', phase: 'approach', closingSpeedMps: 8, initialGapM: 28 },
    { scenario: 'pair', phase: 'corner', closingSpeedMps: 8, initialGapM: 18 },
    {
      scenario: 'priority', phase: 'straight', priorityReason: 'blue-flag',
      closingSpeedMps: 15, initialGapM: 85, simulatedSeconds: 10
    },
    {
      scenario: 'priority', phase: 'approach', priorityReason: 'qualifying',
      qualifyingYieldPhase: 'out', closingSpeedMps: 18, initialGapM: 110,
      simulatedSeconds: 10
    }
  ];
  for (const trackId of ['prado', 'anhembi'] as const)
    for (const wet of [0, 0.75])
      for (const seed of [11, 29])
        for (const option of options) result.push({ trackId, wet, seed, options: option });
  return result;
}

function runMatrix(
  cases: readonly Probe[],
  override: Partial<RacecraftCalibration>
): FocusedSessionSummary[] {
  const tracks = new Map(['prado', 'anhembi'].map(id => [id, prepareHeadlessTrack(id)]));
  return withRacecraftCalibration(override, () => cases.map(probe =>
    runFocusedSession(tracks.get(probe.trackId)!, {
      ...probe.options,
      wet: probe.wet,
      seed: probe.seed
    })
  ));
}

function aggregate(summaries: readonly FocusedSessionSummary[]): Aggregate {
  const total = (key: string): number => summaries.reduce(
    (sum, summary) => sum + (summary.metrics[key] ?? 0), 0
  );
  const obligations = total('obligationObserved');
  return {
    contactsPerScenario: total('contacts') / summaries.length,
    hardContactsPerScenario: total('hardContacts') / summaries.length,
    sideBySideSecondsPerScenario: total('sideBySideSeconds') / summaries.length,
    obligationObservationFraction: obligations / summaries.length,
    yieldLossSecondsPerObligation:
      total('obligationYieldLossSeconds') / Math.max(1, obligations),
    progressDeltaMetres: summaries.reduce((sum, summary) =>
      sum + Math.abs(
        (summary.metrics.firstProgressMetres ?? 0) -
        (summary.metrics.secondProgressMetres ?? 0)
      ), 0) / summaries.length,
    rejectionsPerScenario: total('rejectedCandidates') / summaries.length
  };
}

const SCALES: Record<keyof Aggregate, number> = {
  contactsPerScenario: 0.1,
  hardContactsPerScenario: 0.05,
  sideBySideSecondsPerScenario: 0.5,
  obligationObservationFraction: 0.1,
  yieldLossSecondsPerObligation: 0.5,
  progressDeltaMetres: 5,
  rejectionsPerScenario: 0.5
};

function difference(left: Aggregate, right: Aggregate): {
  maximumNormalizedEffect: number;
  byMetric: Record<string, number>;
} {
  const byMetric: Record<string, number> = {};
  let maximumNormalizedEffect = 0;
  for (const key of Object.keys(SCALES) as Array<keyof Aggregate>) {
    const effect = Math.abs(right[key] - left[key]) / SCALES[key];
    byMetric[key] = effect;
    maximumNormalizedEffect = Math.max(maximumNormalizedEffect, effect);
  }
  return { maximumNormalizedEffect, byMetric };
}

const started = performance.now();
const cases = probes();
const baselineRuns = runMatrix(cases, {});
const baseline = aggregate(baselineRuns);
const rows = RACECRAFT_CALIBRATION_DEFINITIONS.map(definition => {
  const lowRuns = runMatrix(cases, { [definition.key]: definition.minimum });
  const highRuns = runMatrix(cases, { [definition.key]: definition.maximum });
  const low = aggregate(lowRuns);
  const high = aggregate(highRuns);
  const effect = difference(low, high);
  const changedScenarioFraction = lowRuns.reduce((count, summary, index) =>
    count + (summary.checksum === highRuns[index]!.checksum ? 0 : 1), 0) / cases.length;
  const score = Math.max(effect.maximumNormalizedEffect, changedScenarioFraction);
  return {
    key: definition.key,
    unit: definition.unit,
    bounds: [definition.minimum, definition.maximum],
    default: RACECRAFT_CALIBRATION_DEFAULTS[definition.key],
    score,
    changedScenarioFraction,
    classification: score < 0.05 ? 'negligible' : 'material',
    low,
    high,
    normalizedEffectByMetric: effect.byMetric
  };
});
const report = {
  schemaVersion: 1,
  method: 'common-random-number one-at-a-time bounded focused-session sweep',
  calibrationSeeds: [11, 29],
  validationSeedsUsed: [],
  tracks: ['prado', 'anhembi'],
  weather: ['dry', 'wet'],
  scenarios: cases.length,
  baseline,
  rows,
  negligible: rows.filter(row => row.classification === 'negligible').map(row => row.key),
  elapsedSeconds: (performance.now() - started) / 1000
};
const output = argument('--output') ?? 'output/racecraft/sensitivity.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  ...report,
  fingerprint: stableFingerprint(report)
}, null, 2)}\n`);
console.log(JSON.stringify({
  output,
  scenarios: cases.length,
  elapsedSeconds: report.elapsedSeconds,
  rows: rows.map(row => ({
    key: row.key,
    score: row.score,
    changedScenarioFraction: row.changedScenarioFraction,
    classification: row.classification
  }))
}, null, 2));
