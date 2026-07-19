import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname } from 'node:path';

import { empiricalQuantile } from './lib/statistics';
import { stableJson } from '../src/shared/stable-json';
import { emitAuditEvent } from './lib/audit-events';
import {
  prepareHeadlessTrack,
  prepareHeadlessTrackDefinition,
  runFocusedSession,
  runHeadlessRace,
  runSingleCar
} from './lib/headless-sim';
import type { TrackDefinition } from '../src/shared/types';

interface Measurement {
  wallMilliseconds: number;
  simulatedSeconds: number;
  steps: number;
}

interface PlannerMeasurement extends Measurement {
  candidatesEvaluated: number;
  pathsMaterialized: number;
  maximumCandidates: number;
  maximumPathsMaterialized: number;
  retainedPitPaths: number;
  retainedDecisionCandidates: number;
}

class BenchmarkGateFailure extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BenchmarkGateFailure';
  }
}

function cpuAffinity(): { allowedList: string | null; logicalCpus: number | null; pinned: boolean } {
  try {
    const match = readFileSync('/proc/self/status', 'utf8')
      .match(/^Cpus_allowed_list:\s*(.+)$/m);
    const allowedList = match?.[1]?.trim() ?? null;
    if (!allowedList) return { allowedList: null, logicalCpus: null, pinned: false };
    const logicalCpus = allowedList.split(',').reduce((total, part) => {
      const [first, last = first] = part.split('-').map(Number);
      return total + (Number.isInteger(first) && Number.isInteger(last)
        ? Math.max(0, last! - first! + 1)
        : 0);
    }, 0);
    return { allowedList, logicalCpus, pinned: logicalCpus === 1 };
  } catch {
    return { allowedList: null, logicalCpus: null, pinned: false };
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = argument(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function measure(action: () => { simulatedSeconds: number; steps: number }): Measurement {
  const start = performance.now();
  const result = action();
  const wallMilliseconds = performance.now() - start;
  return { wallMilliseconds, simulatedSeconds: result.simulatedSeconds, steps: result.steps };
}

function summarize(samples: Measurement[]): Record<string, number> {
  const wall = samples.map(sample => sample.wallMilliseconds);
  const throughput = samples.map(sample => sample.simulatedSeconds / (sample.wallMilliseconds / 1000));
  const steps = samples.map(sample => sample.steps / (sample.wallMilliseconds / 1000));
  return {
    samples: samples.length,
    wallMillisecondsMedian: empiricalQuantile(wall, 0.5),
    wallMillisecondsP10: empiricalQuantile(wall, 0.1),
    wallMillisecondsP90: empiricalQuantile(wall, 0.9),
    wallMillisecondsP95: empiricalQuantile(wall, 0.95),
    wallMillisecondsSpread: empiricalQuantile(wall, 0.9) - empiricalQuantile(wall, 0.1),
    simulatedSecondsPerWallSecondMedian: empiricalQuantile(throughput, 0.5),
    stepsPerWallSecondMedian: empiricalQuantile(steps, 0.5)
  };
}

function plannerMeasurement(
  action: () => ReturnType<typeof runHeadlessRace>
): PlannerMeasurement {
  const start = performance.now();
  const result = action();
  const wallMilliseconds = performance.now() - start;
  return {
    wallMilliseconds,
    simulatedSeconds: result.simulatedSeconds,
    steps: result.steps,
    candidatesEvaluated: result.metrics.candidatesEvaluated,
    pathsMaterialized: result.metrics.pathsMaterialized,
    maximumCandidates: result.metrics.maximumCandidates,
    maximumPathsMaterialized: result.metrics.maximumPathsMaterialized,
    retainedPitPaths: result.performance?.retainedPitPaths ?? 0,
    retainedDecisionCandidates:
      result.performance?.retainedDecisionCandidates ?? 0
  };
}

function measurementSeries(
  phase: string,
  caseId: string,
  sampleCount: number,
  action: () => { simulatedSeconds: number; steps: number },
  minimumThroughput?: number
): Measurement[] {
  const values: Measurement[] = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    emitAuditEvent('benchmark-sim', 'case-start', {
      phase, caseId, completed: sample, total: sampleCount, status: 'running'
    });
    const value = measure(action);
    values.push(value);
    const throughput = value.simulatedSeconds / (value.wallMilliseconds / 1000);
    emitAuditEvent('benchmark-sim', 'case-result', {
      phase,
      caseId,
      completed: sample + 1,
      total: sampleCount,
      status: minimumThroughput !== undefined && throughput < minimumThroughput
        ? 'amber'
        : 'green',
      wallMilliseconds: value.wallMilliseconds,
      simulatedSecondsPerWallSecond: throughput,
      minimumThroughput
    });
    if (minimumThroughput !== undefined) {
      const failures = values.filter(item =>
        item.simulatedSeconds / (item.wallMilliseconds / 1000) < minimumThroughput).length;
      if (failures > sampleCount / 2) {
        emitAuditEvent('benchmark-sim', 'failure', {
          phase,
          caseId,
          completed: sample + 1,
          total: sampleCount,
          status: 'failed',
          reason: 'median-gate-mathematically-unreachable',
          failures,
          minimumThroughput
        });
        throw new BenchmarkGateFailure(
          `${caseId} median cannot recover to ${minimumThroughput}x ` +
          `after ${failures} sub-gate samples`,
          {
            phase,
            caseId,
            reason: 'median-gate-mathematically-unreachable',
            completed: sample + 1,
            total: sampleCount,
            failures,
            minimumThroughput,
            measurements: values
          }
        );
      }
    }
  }
  return values;
}

function plannerMeasurementSeries(
  phase: string,
  caseId: string,
  sampleCount: number,
  action: () => ReturnType<typeof runHeadlessRace>
): PlannerMeasurement[] {
  const values: PlannerMeasurement[] = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    emitAuditEvent('benchmark-sim', 'case-start', {
      phase, caseId, completed: sample, total: sampleCount, status: 'running'
    });
    const value = plannerMeasurement(action);
    values.push(value);
    emitAuditEvent('benchmark-sim', 'case-result', {
      phase,
      caseId,
      completed: sample + 1,
      total: sampleCount,
      status: value.maximumCandidates <= 6 && value.maximumPathsMaterialized === 0
        ? 'green'
        : 'failed',
      wallMilliseconds: value.wallMilliseconds,
      candidatesEvaluated: value.candidatesEvaluated,
      pathsMaterialized: value.pathsMaterialized,
      maximumCandidates: value.maximumCandidates,
      maximumPathsMaterialized: value.maximumPathsMaterialized
    });
    if (value.maximumCandidates > 6 || value.maximumPathsMaterialized > 0)
      throw new BenchmarkGateFailure(
        `${caseId} exceeded the hard planner complexity bound`,
        {
          phase,
          caseId,
          reason: 'planner-complexity-bound-exceeded',
          completed: sample + 1,
          total: sampleCount,
          measurement: value
        }
      );
  }
  return values;
}

function summarizePlanner(samples: PlannerMeasurement[]) {
  const countSummary = (field: keyof PlannerMeasurement) => {
    const values = samples.map(sample => sample[field]);
    return {
      p50: empiricalQuantile(values, 0.5),
      p95: empiricalQuantile(values, 0.95)
    };
  };
  const materializationsPerSecond = samples.map(sample =>
    sample.pathsMaterialized / Math.max(1e-9, sample.simulatedSeconds));
  return {
    ...summarize(samples),
    allocationCounts: {
      candidateDiagnostics: countSummary('candidatesEvaluated'),
      fullPathsMaterialized: countSummary('pathsMaterialized'),
      fullPathsMaterializedPerSimulatedSecond: {
        p50: empiricalQuantile(materializationsPerSecond, 0.5),
        p95: empiricalQuantile(materializationsPerSecond, 0.95)
      },
      maximumCandidatesPerUpdate: Math.max(...samples.map(sample => sample.maximumCandidates)),
      maximumFullPathsPerSelection: Math.max(
        ...samples.map(sample => sample.maximumPathsMaterialized)
      ),
      retainedPitPathsAtStop: countSummary('retainedPitPaths'),
      retainedDecisionCandidatesAtStop:
        countSummary('retainedDecisionCandidates')
    }
  };
}

const requestedOutput = argument('--output');
let failureContext: Record<string, unknown> = {
  schemaVersion: 2,
  complete: false,
  status: 'failed'
};

try {
  const definitionFile = argument('--definition-file');
  const suppliedDefinition = definitionFile
    ? JSON.parse(readFileSync(definitionFile, 'utf8')) as TrackDefinition
    : null;
  const trackId = suppliedDefinition?.id ?? argument('--track') ?? 'prado';
  const samples = positiveInteger('--samples', 7);
  const warmups = positiveInteger('--warmups', 2);
  const minimumRaceThroughput = Number(argument('--minimum-race-throughput') ?? 62.912);
  if (!Number.isFinite(minimumRaceThroughput) || minimumRaceThroughput <= 0)
    throw new Error('--minimum-race-throughput must be a positive finite number');
  const affinity = cpuAffinity();
  if (process.argv.includes('--require-pinned-cpu') && !affinity.pinned)
    throw new Error(
      `Reference benchmark requires one pinned CPU; current affinity is ` +
      `${affinity.allowedList ?? 'unavailable'}`
    );
  emitAuditEvent('benchmark-sim', 'suite-start', {
    trackId, samples, warmups, minimumRaceThroughput, cpuAffinity: affinity, status: 'running'
  });
  failureContext = {
    ...failureContext,
    trackId,
    warmups,
    requestedSamples: samples,
    minimumRaceThroughput,
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      bun: Bun.version,
      node: process.versions.node,
      cpuAffinity: affinity
    }
  };
  const preparationStarted = performance.now();
  const built = suppliedDefinition
    ? prepareHeadlessTrackDefinition(suppliedDefinition)
    : prepareHeadlessTrack(trackId);
  const coldPreparationMilliseconds = performance.now() - preparationStarted;
  failureContext = { ...failureContext, coldPreparationMilliseconds };
  const workloads = {
    // The frozen full-grid gate is the release-critical result. Measure it
    // first so an unrecoverable median aborts before auxiliary workloads and
    // does not inherit their sustained-load power-state bias.
    race: () => runHeadlessRace(built, { seed: 401, laps: 1, wet: 0 }),
    single: () => runSingleCar(built, { laps: 1, seed: 101 }),
    pair: () => runFocusedSession(built, { scenario: 'pair', seed: 211 }),
    session: () => runFocusedSession(built, {
      scenario: 'pair',
      seed: 307,
      simulatedSeconds: 60,
      maxSteps: 7_200
    })
  };
  for (let index = 0; index < warmups; index++) {
    for (const workload of Object.values(workloads)) workload();
    emitAuditEvent('benchmark-sim', 'progress', {
      phase: 'warmup', completed: index + 1, total: warmups, status: 'running'
    });
  }
  const measurements = Object.fromEntries(Object.entries(workloads).map(([name, workload]) => [
    name,
    measurementSeries(
      'workload', name, samples, workload,
      name === 'race' ? minimumRaceThroughput : undefined
    )
  ])) as Record<keyof typeof workloads, Measurement[]>;
  const summaries = Object.fromEntries(Object.entries(measurements).map(([name, values]) => [
    name,
    summarize(values)
  ])) as Record<keyof typeof workloads, Record<string, number>>;
  const candidateSeconds = summaries.single.wallMillisecondsMedian / 1000;
  const plannerSizes = [1, 2, 6, 12, 22] as const;
  const plannerSteps = 900;
  const plannerWorkloads = Object.fromEntries(plannerSizes.map(size => [
    String(size),
    () => runHeadlessRace(built, {
      seed: 503,
      laps: 99,
      maxSteps: plannerSteps,
      gridSize: size,
      wet: 0,
      includePerformanceDiagnostics: true
    })
  ])) as Record<string, () => ReturnType<typeof runHeadlessRace>>;
  for (const workload of Object.values(plannerWorkloads)) workload();
  const plannerScaling = Object.fromEntries(Object.entries(plannerWorkloads).map(
    ([size, workload]) => [
      size,
      summarizePlanner(plannerMeasurementSeries('planner-scaling', size, samples, workload))
    ]
  ));
  const durationSamples = Math.min(samples, 3);
  const durationScaling = Object.fromEntries([10, 20, 40].map(seconds => {
    const workload = () => runHeadlessRace(built, {
      seed: 503,
      laps: 99,
      maxSteps: seconds * 30,
      gridSize: 22,
      wet: 0,
      includePerformanceDiagnostics: true
    });
    workload();
    return [
      String(seconds),
      summarizePlanner(plannerMeasurementSeries(
        'duration-scaling', `${seconds}s`, durationSamples, workload
      ))
    ];
  }));
  const validationReserve = 0.2;
  const forecast = Object.fromEntries([600, 900, 1200].map(budget => [
    String(budget),
    {
      searchSeconds: budget * (1 - validationReserve),
      validationSeconds: budget * validationReserve,
      singleLapEvaluations: Math.floor(budget * (1 - validationReserve) / candidateSeconds)
    }
  ]));
  const report = {
    schemaVersion: 2,
    complete: true,
    status: 'complete',
    trackId,
    fixedStepSeconds: {
      single: 1 / 120,
      pair: 1 / 120,
      session: 1 / 120,
      race: 1 / 30,
      plannerScaling: 1 / 30
    },
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      bun: Bun.version,
      node: process.versions.node,
      cpuAffinity: affinity
    },
    coldPreparationMilliseconds,
    warmups,
    summaries,
    plannerScaling: {
      simulatedSeconds: plannerSteps / 30,
      productionTrafficHz: 30,
      sizes: plannerScaling
    },
    plannerDurationScaling: {
      gridSize: 22,
      samples: durationSamples,
      productionTrafficHz: 30,
      durations: durationScaling
    },
    forecastAssumption: '80% search budget; one production single-car lap per candidate',
    forecast
  };
  const output = requestedOutput;
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${stableJson(report, 2)}\n`);
  }
  console.log(stableJson({ ...report, output }, 2));
  const throughputPassed =
    summaries.race.simulatedSecondsPerWallSecondMedian >= minimumRaceThroughput;
  emitAuditEvent('benchmark-sim', 'suite-result', {
    trackId,
    status: throughputPassed ? 'green' : 'failed',
    raceThroughput: summaries.race.simulatedSecondsPerWallSecondMedian,
    minimumRaceThroughput,
    output
  });
  if (!throughputPassed) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (requestedOutput) {
    const failureReport = {
      ...failureContext,
      complete: false,
      status: 'failed',
      failure: {
        type: error instanceof BenchmarkGateFailure ? error.name : 'BenchmarkError',
        message,
        ...(error instanceof BenchmarkGateFailure ? { details: error.details } : {})
      }
    };
    mkdirSync(dirname(requestedOutput), { recursive: true });
    writeFileSync(requestedOutput, `${stableJson(failureReport, 2)}\n`);
  }
  emitAuditEvent('benchmark-sim', 'failure', {
    status: 'failed', message, output: requestedOutput
  });
  console.error(message);
  process.exit(error instanceof BenchmarkGateFailure ? 1 : 2);
}
