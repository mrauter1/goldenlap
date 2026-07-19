import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { availableParallelism } from 'node:os';

import { TRACK_DEFS } from '../src/data/tracks';
import { stableFingerprint, stableJson } from '../src/shared/stable-json';
import {
  prepareHeadlessTrack,
  runFocusedSession,
  runHeadlessRace,
  type FocusedSessionOptions,
  type FocusedSessionSummary,
  type HeadlessRaceSummary
} from './lib/headless-sim';
import {
  classifyMetric,
  empiricalQuantile,
  empiricalQuantileInterval,
  poissonRateInterval,
  wilsonInterval,
  type MetricObservation,
  type MetricPolicy,
  type MetricResult,
  type MetricStatus
} from './lib/statistics';
import { emitAuditEvent } from './lib/audit-events';
import { productionDistanceEquivalentPasses } from './lib/race-metrics';
import {
  finiteFocusedSummary as finiteFocused,
  focusedInvariantFailures,
  raceInvariantFailures
} from './lib/audit-invariants';

type Tier = 'fast' | 'normal' | 'release';
type Weather = 'dry' | 'wet';
const DEFAULT_MAXIMUM_WORKERS = 6;

interface ScenarioManifest {
  schemaVersion: number;
  tracks: string[];
  weather: Weather[];
  seedSets: Record<'calibration' | 'validation' | 'release', number[]>;
  replicates: Record<'fast' | 'validation' | 'release', number>;
  derivedSeedRule: string;
  exposureDefinitions: Record<string, string>;
}

interface PolicyDocument { schemaVersion: number; policies: MetricPolicy[] }

interface RaceRecord {
  stratum: string;
  baseSeed: number;
  replicate: number;
  summary: HeadlessRaceSummary;
}

interface FocusRecord {
  stratum: string;
  kind: 'pair' | 'priority' | 'pit' | 'boundary';
  variant?: string;
  baseSeed: number;
  replicate: number;
  summary: FocusedSessionSummary;
}

interface LossDiagnostic {
  value: number;
  stratum: string;
  baseSeed: number;
  replicate: number;
  phase: 'straight' | 'corner';
}

interface RaceBatch {
  stratum: string;
  trackId: string;
  weather: Weather;
  items: Array<{ baseSeed: number; replicate: number; seed: number }>;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function releaseWorkerCount(batchCount: number): number {
  const requested = Number(argument('--workers') ?? NaN);
  const maximum = Math.max(1, availableParallelism() - 1);
  if (Number.isFinite(requested) && (!Number.isInteger(requested) || requested <= 0))
    throw new Error('--workers must be a positive integer');
  // Twelve concurrent Bun/physics workers exceeded the reference laptop's
  // memory/CPU envelope and let the OS terminate the public verify command.
  // Six is the measured stable throughput point; callers can still request a
  // smaller (or explicitly larger, machine-permitting) pool.
  const selected = Number.isFinite(requested)
    ? requested
    : Math.min(maximum, DEFAULT_MAXIMUM_WORKERS);
  return Math.min(batchCount, maximum, selected);
}

async function runRaceBatches(
  batches: readonly RaceBatch[],
  workerCount: number
): Promise<RaceRecord[]> {
  const records: RaceRecord[] = [];
  const total = batches.reduce((count, batch) => count + batch.items.length, 0);
  let completed = 0;
  let next = 0;
  emitAuditEvent('statistics', 'phase-start', {
    phase: 'race-workers', total, workers: workerCount, status: 'running'
  });
  const run = async (): Promise<void> => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      const child = Bun.spawn([
        'bun', 'tools/run-race-stratum.ts', '--track', batch.trackId,
        '--weather', batch.weather, '--seeds', batch.items.map(item => item.seed).join(',')
      ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'inherit' });
      const [exitCode, stdout] = await Promise.all([
        child.exited,
        new Response(child.stdout).text()
      ]);
      if (exitCode !== 0)
        throw new Error(`Race worker failed for ${batch.stratum} (exit ${exitCode})`);
      const summaries = JSON.parse(stdout) as HeadlessRaceSummary[];
      if (summaries.length !== batch.items.length)
        throw new Error(`Race worker returned the wrong count for ${batch.stratum}`);
      for (let index = 0; index < summaries.length; index++) {
        const item = batch.items[index]!;
        assertRaceInvariants(
          summaries[index]!,
          `${batch.stratum}/${item.baseSeed}/${item.replicate}`
        );
        records.push({
          stratum: batch.stratum,
          baseSeed: item.baseSeed,
          replicate: item.replicate,
          summary: summaries[index]!
        });
      }
      completed += summaries.length;
      emitAuditEvent('statistics', 'progress', {
        phase: 'race-workers', completed, total, stratum: batch.stratum,
        status: 'running'
      });
    }
  };
  await Promise.all(Array.from({ length: workerCount }, run));
  return records.sort((left, right) => left.stratum.localeCompare(right.stratum) ||
    left.baseSeed - right.baseSeed || left.replicate - right.replicate);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function selectedTier(): Tier {
  const raw = argument('--tier') ?? 'fast';
  if (raw !== 'fast' && raw !== 'normal' && raw !== 'release')
    throw new Error('--tier must be fast, normal, or release');
  return raw;
}

function derivedSeed(
  baseSeed: number,
  replicate: number,
  trackIndex: number,
  weatherIndex: number
): number {
  return baseSeed + replicate * 1_000_003 + trackIndex * 1_009 + weatherIndex * 101;
}

function statusFrom(results: readonly MetricResult[]): MetricStatus {
  if (results.some(result => result.status === 'red')) return 'red';
  if (results.some(result => result.status === 'inconclusive')) return 'inconclusive';
  if (results.some(result => result.status === 'amber')) return 'amber';
  return 'green';
}

function assertRaceInvariants(summary: HeadlessRaceSummary, caseId: string): void {
  const failures = raceInvariantFailures(summary);
  emitAuditEvent('statistics', 'case-result', {
    phase: 'race',
    caseId,
    status: failures.length ? 'failed' : 'green',
    contacts: summary.metrics.contacts,
    lightContacts: summary.metrics.lightContacts,
    hardContacts: summary.metrics.hardContacts,
    openingHardContacts: summary.metrics.openingHardContacts,
    dnfs: summary.metrics.dnfs,
    failures
  });
  if (failures.length) {
    emitAuditEvent('statistics', 'failure', { phase: 'race', caseId, failures });
    throw new Error(`Hard invariant failed for ${caseId}: ${failures.join(', ')}`);
  }
}

function pushFocusedRecord(focus: FocusRecord[], record: FocusRecord): void {
  const scenario = record.variant ? `${record.kind}-${record.variant}` : record.kind;
  const caseId = `${record.stratum}/${scenario}/${record.baseSeed}/${record.replicate}`;
  const failures = focusedInvariantFailures(record.summary);
  emitAuditEvent('statistics', 'case-result', {
    phase: 'focused',
    caseId,
    status: failures.length ? 'failed' : 'green',
    simulatedSeconds: record.summary.simulatedSeconds,
    failures
  });
  if (failures.length) {
    emitAuditEvent('statistics', 'failure', { phase: 'focused', caseId, failures });
    throw new Error(`Hard invariant failed for ${caseId}: ${failures.join(', ')}`);
  }
  focus.push(record);
}

function quantileObservation(
  metric: string,
  values: readonly number[],
  probability: number,
  stratum?: string
): MetricObservation {
  return {
    metric,
    value: values.length ? empiricalQuantile(values, probability) : 0,
    samples: values.length,
    ...(values.length ? { interval: empiricalQuantileInterval(values, probability) } : {}),
    ...(stratum ? { stratum } : {})
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function quantizeSimulationSeconds(value: number): number {
  const fixedStep = 1 / 120;
  return Math.round(value / fixedStep) * fixedStep;
}

function racecraftDecisionDiagnostics(
  records: readonly RaceRecord[]
): {
  selectedJ: {
    samples: number;
    droppedSamples: number;
    ownTimeSeconds: number;
    billSeconds: number;
    recourseSeconds: number;
    tieBandSeconds: number;
    totalSeconds: number;
    hazardCount: number;
  };
  decisionSwitches: { total: number; perRace: number };
  cornerDecisions: {
    inline: number;
    offset: number;
    byStratumAndCorner: Record<string, { inline: number; offset: number }>;
  };
} {
  const samples = sum(records.map(
    record => record.summary.diagnostics.racecraftSelectedJ.samples
  ));
  const weighted = (
    select: (summary: HeadlessRaceSummary) => number
  ): number => sum(records.map(record =>
    select(record.summary) *
      record.summary.diagnostics.racecraftSelectedJ.samples
  )) / Math.max(1, samples);
  const switches = sum(records.map(
    record => record.summary.metrics.racecraftDecisionSwitches
  ));
  const byStratumAndCorner:
    Record<string, { inline: number; offset: number }> = {};
  let inline = 0;
  let offset = 0;
  for (const record of records) {
    for (const [cornerId, count] of Object.entries(
      record.summary.diagnostics.racecraftCornerDecisions
    )) {
      const key = `${record.stratum}/${cornerId}`;
      const aggregate = byStratumAndCorner[key] ?? { inline: 0, offset: 0 };
      aggregate.inline += count.inline;
      aggregate.offset += count.offset;
      byStratumAndCorner[key] = aggregate;
      inline += count.inline;
      offset += count.offset;
    }
  }
  return {
    selectedJ: {
      samples,
      droppedSamples: sum(records.map(
        record => record.summary.diagnostics.racecraftSelectedJ.droppedSamples
      )),
      ownTimeSeconds: weighted(
        summary => summary.diagnostics.racecraftSelectedJ.ownTimeSeconds
      ),
      billSeconds: weighted(
        summary => summary.diagnostics.racecraftSelectedJ.billSeconds
      ),
      recourseSeconds: weighted(
        summary => summary.diagnostics.racecraftSelectedJ.recourseSeconds
      ),
      tieBandSeconds: weighted(
        summary => summary.diagnostics.racecraftSelectedJ.tieBandSeconds
      ),
      totalSeconds: weighted(
        summary => summary.diagnostics.racecraftSelectedJ.totalSeconds
      ),
      hazardCount: weighted(
        summary => summary.diagnostics.racecraftSelectedJ.hazardCount
      )
    },
    decisionSwitches: {
      total: switches,
      perRace: switches / Math.max(1, records.length)
    },
    cornerDecisions: { inline, offset, byStratumAndCorner }
  };
}

function addPopulationObservations(
  observations: MetricObservation[],
  raceRecords: readonly RaceRecord[]
): void {
  const strata = new Map<string, RaceRecord[]>();
  for (const record of raceRecords) {
    const group = strata.get(record.stratum) ?? [];
    group.push(record);
    strata.set(record.stratum, group);
  }
  for (const [stratum, records] of strata) {
    const races = records.map(record => record.summary);
    const raceCount = races.length;
    const countRate = (
      metric: string,
      select: (race: HeadlessRaceSummary) => number
    ): void => {
      const events = sum(races.map(select));
      observations.push({
        metric,
        value: events / Math.max(1, raceCount),
        samples: raceCount,
        interval: poissonRateInterval(events, raceCount),
        stratum
      });
    };
    countRate('race.contacts_per_race', race => race.metrics.contacts);
    countRate('race.light_contacts_per_race', race => race.metrics.lightContacts);
    countRate('race.hard_contacts_per_race', race => race.metrics.hardContacts);
    countRate('race.opening_hard_contacts_per_race', race => race.metrics.openingHardContacts);
    countRate('race.dnfs_per_race', race => race.metrics.dnfs);
    observations.push(quantileObservation(
      'race.passes_per_race',
      races.map(race => productionDistanceEquivalentPasses(
        race.metrics.passes,
        race.laps,
        race.productionLaps
      )),
      0.5,
      stratum
    ));
    observations.push(quantileObservation(
      'race.off_course_car_seconds_fraction',
      races.map(race => race.exposure.offCourseCarSeconds /
        Math.max(1e-9, race.exposure.carSeconds)),
      0.95,
      stratum
    ));
    observations.push(quantileObservation(
      'race.curb_car_seconds_fraction',
      races.map(race => race.exposure.curbCarSeconds /
        Math.max(1e-9, race.exposure.carSeconds)),
      0.95,
      stratum
    ));
    observations.push(quantileObservation(
      'race.grass_car_seconds_fraction',
      races.map(race => race.exposure.grassCarSeconds /
        Math.max(1e-9, race.exposure.carSeconds)),
      0.95,
      stratum
    ));
    const attempts = sum(races.map(race => race.exposure.passAttempts));
    const successes = sum(races.map(race => race.metrics.passSuccesses));
    observations.push({
      metric: 'race.pass_success_fraction',
      value: attempts ? successes / attempts : 0,
      samples: attempts,
      ...(attempts ? { interval: wilsonInterval(successes, attempts) } : {}),
      stratum
    });
    const stationGapSamples = sum(
      races.map(race => race.metrics.stationGapSamples)
    );
    const stationGapMean = sum(races.map(race =>
      race.metrics.stationGapMeanMetres * race.metrics.stationGapSamples
    )) / Math.max(1, stationGapSamples);
    const stationGapSecondMoment = sum(races.map(race =>
      (race.metrics.stationGapStdDevMetres ** 2 +
        race.metrics.stationGapMeanMetres ** 2) *
          race.metrics.stationGapSamples
    )) / Math.max(1, stationGapSamples);
    observations.push({
      metric: 'race.station_gap_mean_metres',
      value: stationGapMean,
      samples: stationGapSamples,
      stratum
    });
    observations.push({
      metric: 'race.station_gap_standard_deviation_metres',
      value: Math.sqrt(Math.max(
        0,
        stationGapSecondMoment - stationGapMean ** 2
      )),
      samples: stationGapSamples,
      stratum
    });
    countRate('race.attack_initiations_per_race', race => race.metrics.attackInitiations);
    countRate('race.switchback_completions_per_race',
      race => race.metrics.switchbackCompletions);
    countRate('race.brake_while_alongside_per_race',
      race => race.metrics.brakeWhileAlongside);
    countRate('race.rear_loss_straight_per_race',
      race => race.metrics.rearLossStraight);
    countRate('race.defense_move_in_braking_per_race',
      race => race.metrics.defenseMoveInBraking);
    countRate('race.defense_mirror_per_race',
      race => race.metrics.defenseMirror);
    const battleLapSamples = sum(races.map(race => race.metrics.battleLapSamples));
    observations.push({
      metric: 'race.battle_lap_delta_seconds',
      value: sum(races.map(race => race.metrics.battleLapDelta)) /
        Math.max(1, battleLapSamples),
      samples: battleLapSamples,
      stratum
    });

    const durations = races.flatMap(race => race.metrics.sideBySideDurations);
    observations.push(quantileObservation(
      'race.side_by_side_median_seconds', durations, 0.5, stratum
    ));
    const episodes = sum(races.map(race => race.metrics.sideBySideEpisodes));
    const contactEpisodes = sum(races.map(race => race.metrics.sideBySideContactEpisodes));
    observations.push({
      metric: 'race.side_by_side_contact_fraction',
      value: episodes ? contactEpisodes / episodes : 0,
      samples: episodes,
      ...(episodes ? { interval: wilsonInterval(contactEpisodes, episodes) } : {}),
      stratum
    });
  }
}

function metricValue(summary: FocusedSessionSummary, name: string): number {
  return summary.metrics[name] ?? 0;
}

function focusedOptions(
  seed: number,
  wet: number,
  options: Omit<FocusedSessionOptions, 'seed' | 'wet'>
): FocusedSessionOptions {
  return { ...options, seed, wet };
}

function runFocusPopulations(
  built: ReturnType<typeof prepareHeadlessTrack>,
  stratum: string,
  seed: number,
  baseSeed: number,
  replicate: number,
  weather: Weather,
  focus: FocusRecord[],
  losses: {
    qualifyingStraight: number[];
    qualifyingCorner: number[];
    pit: number[];
    obligationYield: number[];
  },
  qualifyingLossDiagnostics: LossDiagnostic[]
): void {
  const wet = weather === 'wet' ? 0.65 : 0;
  const side: -1 | 1 = ((seed >>> 1) & 1) === 0 ? -1 : 1;
  const closing = [3, 8, 14][Math.abs(seed) % 3]!;
  const gap = [18, 35, 70][Math.abs(seed >>> 2) % 3]!;
  const phase = (['straight', 'approach', 'corner'] as const)[Math.abs(seed >>> 4) % 3]!;
  const pair = runFocusedSession(built, focusedOptions(seed, wet, {
    scenario: 'pair',
    phase,
    side,
    closingSpeedMps: closing,
    initialGapM: gap,
    traffic: replicate % 3 === 2 ? 'three-car' : 'pair',
    simulatedSeconds: 10
  }));
  pushFocusedRecord(focus, { stratum, kind: 'pair', baseSeed, replicate, summary: pair });

  const blue = runFocusedSession(built, focusedOptions(seed + 17, wet, {
    scenario: 'priority',
    phase,
    side,
    closingSpeedMps: closing,
    initialGapM: Math.min(gap, 35),
    priorityReason: 'blue-flag',
    simulatedSeconds: 20
  }));
  pushFocusedRecord(focus, {
    stratum, kind: 'priority', variant: 'blue', baseSeed, replicate, summary: blue
  });
  losses.obligationYield.push(
    metricValue(blue, 'obligationYieldLossSeconds')
  );

  for (const priorityPhase of ['straight', 'corner'] as const) {
    const scenarioOptions = {
      scenario: 'priority' as const,
      phase: priorityPhase,
      side,
      closingSpeedMps: closing,
      initialGapM: Math.min(gap, 35),
      priorityReason: 'qualifying' as const,
      qualifyingYieldPhase: replicate % 2 ? 'in' as const : 'out' as const,
      simulatedSeconds: 20,
      stopOnPriorityRelease: true
    };
    const active = runFocusedSession(built, focusedOptions(seed + 31, wet, scenarioOptions));
    const episodeDuration = Math.max(0.2, active.simulatedSeconds);
    const control = runFocusedSession(built, focusedOptions(seed + 31, wet, {
      ...scenarioOptions,
      priorityDisabled: true,
      simulatedSeconds: episodeDuration
    }));
    pushFocusedRecord(focus, {
      stratum,
      kind: 'priority',
      variant: `qualifying-${priorityPhase}`,
      baseSeed,
      replicate,
      summary: active
    });
    const controlProgress = metricValue(control, 'secondProgressMetres');
    const progressLoss = quantizeSimulationSeconds(Math.max(
      0,
      controlProgress -
        metricValue(active, 'secondProgressMetres')
    ) / Math.max(1, controlProgress / episodeDuration));
    (priorityPhase === 'straight'
      ? losses.qualifyingStraight
      : losses.qualifyingCorner).push(progressLoss);
    qualifyingLossDiagnostics.push({
      value: progressLoss,
      stratum,
      baseSeed,
      replicate,
      phase: priorityPhase
    });
    losses.obligationYield.push(
      metricValue(active, 'obligationYieldLossSeconds')
    );
  }

  const pitOptions = { scenario: 'pit' as const, simulatedSeconds: 15 };
  const pit = runFocusedSession(built, focusedOptions(seed + 47, 0, pitOptions));
  const pitControl = runFocusedSession(built, focusedOptions(seed + 47, 0, {
    ...pitOptions,
    pitControl: true
  }));
  pushFocusedRecord(focus, { stratum, kind: 'pit', baseSeed, replicate, summary: pit });
  losses.pit.push(Math.max(
    0,
    metricValue(pitControl, 'firstProgressMetres') -
      metricValue(pit, 'firstProgressMetres')
  ) / 12);
}

function runBoundarySweep(
  tier: Tier,
  focus: FocusRecord[]
): void {
  const gaps = tier === 'release' ? [2.2, 4.5] : [3.4];
  const closings = tier === 'release' ? [3, 14] : [8];
  for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex++) {
    const built = prepareHeadlessTrack(TRACK_DEFS[trackIndex]!.id);
    for (const [weatherIndex, weather] of (['dry', 'wet'] as const).entries()) {
      for (const side of [-1, 1] as const) {
        for (const phase of ['approach', 'corner'] as const) {
          for (const gap of gaps) {
            for (const closing of closings) {
              const seed = 700_001 + trackIndex * 1009 + weatherIndex * 101 +
                (side > 0 ? 17 : 0) + Math.round(gap * 10) + closing;
              const summary = runFocusedSession(built, {
                scenario: 'pair',
                seed,
                wet: weather === 'wet' ? 0.65 : 0,
                phase,
                side,
                initialGapM: gap,
                closingSpeedMps: closing,
                simulatedSeconds: 6
              });
              pushFocusedRecord(focus, {
                stratum: `${built.def.id}/${weather}/${phase}/${side > 0 ? 'left' : 'right'}`,
                kind: 'boundary',
                baseSeed: seed,
                replicate: 0,
                summary
              });
            }
          }
        }
      }
    }
  }
}

export function invariantObservations(
  races: readonly HeadlessRaceSummary[],
  focused: readonly FocusedSessionSummary[],
  staleProfiles: number
): MetricObservation[] {
  const samples = races.length + focused.length;
  return [
    {
      metric: 'invariant.non_finite_state',
      value: races.filter(race => !race.finite).length +
        focused.filter(summary => !finiteFocused(summary)).length,
      samples
    },
    {
      metric: 'invariant.invalid_classification',
      value: races.filter(race => !race.classificationValid).length,
      samples: races.length
    },
    {
      metric: 'invariant.stale_profile_used',
      value: staleProfiles,
      samples: TRACK_DEFS.length
    },
    {
      metric: 'invariant.maneuver_candidate_limit',
      value: races.filter(race => race.metrics.maximumCandidates > 6).length +
        focused.filter(summary => metricValue(summary, 'maximumCandidates') > 6).length,
      samples
    },
    {
      metric: 'invariant.maneuver_materialization_limit',
      value: races.filter(race => race.metrics.maximumPathsMaterialized > 0).length +
        focused.filter(summary => metricValue(summary, 'maximumPathsMaterialized') > 0).length,
      samples
    },
    {
      metric: 'invariant.unexplained_stall',
      value: sum(races.map(race => race.metrics.unexplainedStalls)) +
        sum(focused.map(summary => metricValue(summary, 'unexplainedStalls'))),
      samples
    },
    {
      metric: 'invariant.pit_deadlock',
      value: sum(races.map(race => race.metrics.pitDeadlocks)) +
        sum(focused.map(summary => metricValue(summary, 'pitDeadlocks'))),
      samples
    },
    {
      metric: 'invariant.pit_false_leader',
      value: sum(races.map(race => race.metrics.pitFalseLeaders)) +
        sum(focused.map(summary => metricValue(summary, 'pitFalseLeaders'))),
      samples
    },
    {
      metric: 'invariant.repeated_defense',
      value: sum(races.map(race => race.metrics.repeatedDefenses)),
      samples: races.length
    },
    {
      metric: 'invariant.soft_contact_concede',
      value: sum(races.map(race => race.metrics.softContactConcedes)),
      samples: races.length
    }
  ];
}

export function pathBoundCandidateRejectionDiagnostics(
  raceRecords: ReadonlyArray<{
    stratum: string;
    baseSeed: number;
    replicate: number;
    summary: Pick<HeadlessRaceSummary, 'checksum' | 'metrics'>;
  }>
): Array<{
  value: number;
  stratum: string;
  baseSeed: number;
  replicate: number;
  checksum: string;
}> {
  return raceRecords
    .filter(record => record.summary.metrics.pathOutOfBoundsRejections > 0)
    .map(record => ({
      value: record.summary.metrics.pathOutOfBoundsRejections,
      stratum: record.stratum,
      baseSeed: record.baseSeed,
      replicate: record.replicate,
      checksum: record.summary.checksum
    }));
}

function countStatuses(results: readonly MetricResult[]): Record<MetricStatus, number> {
  const counts: Record<MetricStatus, number> = {
    green: 0,
    amber: 0,
    red: 0,
    inconclusive: 0
  };
  for (const result of results) counts[result.status]++;
  return counts;
}

async function main(): Promise<void> {
  try {
    const started = performance.now();
    const tier = selectedTier();
    emitAuditEvent('statistics', 'suite-start', { tier, status: 'running' });
    const focusOnly = hasFlag('--focus-only');
    const policyPath = argument('--policy') ??
      'tests/fixtures/calibration/metric-policy.json';
    const scenarioPath = argument('--scenarios') ??
      'tests/fixtures/calibration/scenario-manifest.json';
    const policies = readJson<PolicyDocument>(policyPath).policies;
    const policyById = new Map(policies.map(policy => [policy.id, policy]));
    const manifest = readJson<ScenarioManifest>(scenarioPath);
    const baseSeeds = tier === 'release'
      ? manifest.seedSets.release
      : tier === 'normal'
        ? manifest.seedSets.validation
        : manifest.seedSets.validation.slice(0, 1);
    const replicates = tier === 'release'
      ? manifest.replicates.release
      : tier === 'normal'
        ? manifest.replicates.validation
        : manifest.replicates.fast;
    const raceRecords: RaceRecord[] = [];
    const raceBatches: RaceBatch[] = [];
    const focus: FocusRecord[] = [];
    const losses = {
      qualifyingStraight: [] as number[],
      qualifyingCorner: [] as number[],
      pit: [] as number[],
      obligationYield: [] as number[]
    };
    const qualifyingLossDiagnostics: LossDiagnostic[] = [];
    let staleProfiles = 0;
    const builtTracks = manifest.tracks.map(trackId => prepareHeadlessTrack(trackId));
    for (const built of builtTracks)
      if (built.tr.trackProfileState?.status !== 'matched') staleProfiles++;

    // Run full races first: they carry every hard production invariant and are
    // parallel for normal/release tiers. A failure therefore stops before the
    // much larger focused population is spent.
    for (let trackIndex = 0; trackIndex < manifest.tracks.length; trackIndex++) {
      const trackId = manifest.tracks[trackIndex]!;
      const built = builtTracks[trackIndex]!;
      for (let weatherIndex = 0; weatherIndex < manifest.weather.length; weatherIndex++) {
        const weather = manifest.weather[weatherIndex]!;
        const stratum = `${trackId}/${weather}`;
        const raceBatch: RaceBatch = {
          stratum,
          trackId,
          weather,
          items: []
        };
        for (const baseSeed of baseSeeds) {
          for (let replicate = 0; replicate < replicates; replicate++) {
            const seed = derivedSeed(baseSeed, replicate, trackIndex, weatherIndex);
            if (tier !== 'fast' && !focusOnly) {
              raceBatch.items.push({ baseSeed, replicate, seed });
            } else if (tier === 'fast' && trackIndex === 0) {
              const summary = runHeadlessRace(built, {
                seed,
                laps: 1,
                wet: weather === 'wet' ? 0.65 : 0,
                includeLapStrata: true
              });
              assertRaceInvariants(summary, `${stratum}/${baseSeed}/${replicate}`);
              raceRecords.push({ stratum, baseSeed, replicate, summary });
            }
          }
        }
        if (raceBatch.items.length) raceBatches.push(raceBatch);
      }
    }

    const workerCount = tier !== 'fast'
      ? releaseWorkerCount(raceBatches.length)
      : 1;
    if (raceBatches.length)
      raceRecords.push(...await runRaceBatches(raceBatches, workerCount));

    for (let trackIndex = 0; trackIndex < manifest.tracks.length; trackIndex++) {
      const trackId = manifest.tracks[trackIndex]!;
      const built = builtTracks[trackIndex]!;
      emitAuditEvent('statistics', 'phase-start', {
        phase: 'track-focus', caseId: trackId, status: 'running'
      });
      for (let weatherIndex = 0; weatherIndex < manifest.weather.length; weatherIndex++) {
        const weather = manifest.weather[weatherIndex]!;
        const stratum = `${trackId}/${weather}`;
        for (const baseSeed of baseSeeds) {
          for (let replicate = 0; replicate < replicates; replicate++) {
            const seed = derivedSeed(baseSeed, replicate, trackIndex, weatherIndex);
            runFocusPopulations(
              built, stratum, seed, baseSeed, replicate, weather, focus, losses,
              qualifyingLossDiagnostics
            );
          }
        }
      }
    }
    emitAuditEvent('statistics', 'phase-start', {
      phase: 'boundary-sweep', status: 'running'
    });
    runBoundarySweep(tier, focus);

    const observations = invariantObservations(
      raceRecords.map(record => record.summary),
      focus.map(record => record.summary),
      staleProfiles
    );
    observations.push(quantileObservation(
      'path.maximum_target_slew_m',
      raceRecords.map(record => record.summary.metrics.maximumPathSlew),
      1
    ));
    observations.push(quantileObservation('pit.unintended_wait_seconds', losses.pit, 0.99));
    observations.push(quantileObservation(
      'obligation.qualifying_loss_straight_seconds', losses.qualifyingStraight, 0.95
    ));
    observations.push(quantileObservation(
      'obligation.qualifying_loss_corner_seconds', losses.qualifyingCorner, 0.95
    ));
    observations.push(quantileObservation(
      'obligation.yield_loss_seconds', losses.obligationYield, 0.95
    ));
    addPopulationObservations(observations, raceRecords);

    const results = observations.map(observation => {
      const policy = policyById.get(observation.metric);
      if (!policy) throw new Error(`No metric policy for ${observation.metric}`);
      return classifyMetric(policy, observation);
    });
    const status = statusFrom(results);
    const counts = countStatuses(results);
    const reportCore = {
      schemaVersion: 1,
      tier,
      status,
      provisional: tier !== 'release' || counts.inconclusive > 0,
      elapsedSeconds: (performance.now() - started) / 1000,
      policyPath,
      scenarioPath,
      policyFingerprint: stableFingerprint(policies),
      scenarioFingerprint: stableFingerprint(manifest),
      seedSource: tier === 'release' ? 'release' : 'validation',
      baseSeeds,
      replicates,
      workerCount,
      derivedSeedRule: manifest.derivedSeedRule,
      separation: 'calibration seeds are never used by this validation command',
      exposureDefinitions: manifest.exposureDefinitions,
      exposure: {
        races: raceRecords.length,
        focusedScenarios: focus.length,
        raceSeconds: sum(raceRecords.map(record => record.summary.exposure.raceSeconds)),
        carSeconds: sum(raceRecords.map(record => record.summary.exposure.carSeconds)),
        carKilometres: sum(raceRecords.map(record => record.summary.exposure.carKilometres)),
        sideBySideEpisodes: sum(raceRecords.map(record =>
          record.summary.metrics.sideBySideEpisodes)),
        passAttempts: sum(raceRecords.map(record => record.summary.exposure.passAttempts)),
        obligationEpisodes: sum(focus.map(record =>
          metricValue(record.summary, 'obligationObserved'))),
        pitConflicts: focus.filter(record => record.kind === 'pit').length,
        boundaryCases: focus.filter(record => record.kind === 'boundary').length
      },
      strata: [...new Set(raceRecords.map(record => record.stratum))],
      counts,
      results,
      raceChecksums: raceRecords.map(record => ({
        stratum: record.stratum,
        baseSeed: record.baseSeed,
        replicate: record.replicate,
        checksum: record.summary.checksum
      })),
      diagnostics: {
        largestQualifyingLosses: [...qualifyingLossDiagnostics]
          .sort((left, right) => right.value - left.value)
          .slice(0, 30),
        highestOffCourseFractions: raceRecords.map(record => ({
          value: record.summary.exposure.offCourseCarSeconds /
            Math.max(1e-9, record.summary.exposure.carSeconds),
          stratum: record.stratum,
          baseSeed: record.baseSeed,
          replicate: record.replicate,
          checksum: record.summary.checksum
        })).sort((left, right) => right.value - left.value).slice(0, 30),
        pathBoundCandidateRejections: pathBoundCandidateRejectionDiagnostics(
          raceRecords
        ),
        racecraftDecisions: racecraftDecisionDiagnostics(raceRecords)
      },
      simplification: {
        raceLength: 'one-lap full-field production races for population throughput',
        hazardEvaluation:
          'deterministic continuous body sweep over published point trajectories',
        provisionalRule: 'only the release tier may make conclusive population claims'
      }
    };
    const report = { ...reportCore, fingerprint: stableFingerprint(reportCore) };
    const outputPath = argument('--output') ?? `output/statistics/${tier}.json`;
    if (!hasFlag('--no-write')) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${stableJson(report, 2)}\n`);
    }
    console.log(stableJson({
      tier,
      status,
      provisional: report.provisional,
      elapsedSeconds: report.elapsedSeconds,
      exposure: report.exposure,
      counts,
      red: results.filter(result => result.status === 'red'),
      inconclusive: results.filter(result => result.status === 'inconclusive'),
      output: hasFlag('--no-write') ? null : outputPath,
      fingerprint: report.fingerprint
    }, 2));
    const requireConclusive = tier === 'release' || hasFlag('--require-conclusive');
    const exitCode = counts.red > 0 || (requireConclusive && counts.inconclusive > 0) ? 1 : 0;
    emitAuditEvent('statistics', 'suite-result', {
      tier,
      status: exitCode ? 'failed' : status,
      elapsedMilliseconds: report.elapsedSeconds * 1000,
      counts,
      output: hasFlag('--no-write') ? null : outputPath
    });
    process.exit(exitCode);
  } catch (error) {
    emitAuditEvent('statistics', 'failure', {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(2);
  }
}

if (import.meta.main) void main();
