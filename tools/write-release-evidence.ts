import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { TRACK_PROFILES } from '../src/data/track-profiles';
import { stableFingerprint, stableJson } from '../src/shared/stable-json';

interface StatisticalReport {
  tier: string;
  status: string;
  provisional: boolean;
  elapsedSeconds: number;
  counts: { green: number; amber: number; red: number; inconclusive: number };
  exposure: Record<string, number>;
  policyFingerprint: string;
  scenarioFingerprint: string;
  fingerprint: string;
  workerCount: number;
}

interface OptimizerReport {
  trackId: string;
  trackSource: string;
  budgetSeconds: number;
  status: string;
  bestFoundNotGloballyOptimal: boolean;
  fingerprints: { track: string; physics: string };
  selected: { candidateId: string };
  search: {
    evaluations: number;
    deadlineReached: boolean;
    evaluationCapReached: boolean;
  };
  stageMilliseconds: { total: number };
  deadline: { overrunSeconds: number; reserveFraction: number };
  cache: { mode: string; warm: boolean };
}

interface SensitivityReport {
  method: string;
  scenarios: number;
  validationSeedsUsed: number[];
  rows: Array<{ key: string; unit: string; classification: string; score: number }>;
}

interface BenchmarkReport {
  schemaVersion: number;
  complete?: boolean;
  status?: string;
  failure?: { message?: string };
  trackId: string;
  coldPreparationMilliseconds: number;
  environment: {
    cpuAffinity?: { allowedList: string | null; logicalCpus: number | null; pinned: boolean };
  };
  summaries: Record<string, { wallMillisecondsP95: number }>;
  forecast: Record<string, { singleLapEvaluations: number }>;
  plannerScaling: {
    sizes: Record<string, {
      allocationCounts: {
        maximumCandidatesPerUpdate: number;
        maximumFullPathsPerSelection: number;
      };
      plannerTimeMilliseconds: { p50: number; p95: number };
      wallMillisecondsMedian: number;
      wallMillisecondsP95: number;
    }>;
  };
  plannerDurationScaling: {
    durations: Record<string, {
      allocationCounts: {
        retainedCandidateDiagnosticsAtStop: { p50: number; p95: number };
        retainedDynamicPathsAtStop: { p50: number; p95: number };
        maximumCandidatesPerUpdate: number;
        maximumFullPathsPerSelection: number;
      };
    }>;
  };
}

interface VisualReview {
  schemaVersion: number;
  plan: string;
  reviewedAt1x: boolean;
  reviewedAt: string;
  reviewer: string;
  developmentBundleSha256: string;
  commands: string[];
  entryPaths: string[];
  categories: Record<string, {
    status: string;
    evidence: string[];
    tracks: string[];
    reviewSpeeds: string[];
  }>;
  performance: {
    artifact: string;
    baselineFrameTimeP95Ms: number;
    frameTimeP50Ms: number;
    frameTimeP95Ms: number;
    samples: number;
    warmups: number;
    maximumRegressionFraction: number;
    realTimeTargetP95Ms: number;
  };
}

const FROZEN_BASELINE_RACE_THROUGHPUT = 78.64;
const MINIMUM_RACE_THROUGHPUT = FROZEN_BASELINE_RACE_THROUGHPUT * 0.8;
const DYNAMIC_PLAN = 'racecraft_dynamic_corridor_plan.md';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function bundleEvidence(minify: boolean): Promise<{
  bytes: number;
  sha256: string;
}> {
  const result = await Bun.build({
    entrypoints: ['src/main.ts'],
    target: 'browser',
    format: 'iife',
    minify,
    sourcemap: 'none'
  });
  requireCondition(result.success, `Evidence ${minify ? 'production' : 'development'} build failed`);
  const output = result.outputs.find(item => item.kind === 'entry-point');
  requireCondition(output, 'Evidence build did not produce an entry-point bundle');
  const bytes = new Uint8Array(await output.arrayBuffer());
  return { bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

try {
  const releasePath = 'output/statistics/release.json';
  const normalPath = 'output/statistics/normal.json';
  const benchmarkPath = 'output/benchmarks/dynamic-corridor-final.json';
  const sensitivityPath = 'output/racecraft/sensitivity.json';
  const visualPath = 'output/playwright/visual-review.json';
  const release = readJson<StatisticalReport>(releasePath);
  const normal = readJson<StatisticalReport>(normalPath);
  requireCondition(release.tier === 'release' && !release.provisional,
    'Release statistics are missing or provisional');
  requireCondition(release.counts.red === 0 && release.counts.inconclusive === 0,
    'Release statistics contain a red or inconclusive result');
  requireCondition(normal.counts.red === 0,
    'Normal statistics contain a red result');

  const sensitivity = readJson<SensitivityReport>(sensitivityPath);
  const material = sensitivity.rows.filter(row => row.classification === 'material');
  requireCondition(material.length <= 8,
    `Sensitivity gate exceeded: ${material.length} material dimensions`);
  requireCondition(sensitivity.validationSeedsUsed.length === 0,
    'Sensitivity analysis used held-out validation seeds');

  const benchmark = readJson<BenchmarkReport>(benchmarkPath);
  requireCondition(benchmark.schemaVersion >= 2,
    'Benchmark does not contain dynamic-corridor scaling evidence');
  requireCondition(benchmark.complete === true && benchmark.status === 'complete',
    `Release benchmark is incomplete${benchmark.failure?.message
      ? `: ${benchmark.failure.message}`
      : ''}`);
  requireCondition(Number.isFinite(benchmark.summaries.race?.wallMillisecondsP95),
    'Benchmark is missing the full-race p95');
  requireCondition(benchmark.environment.cpuAffinity?.pinned === true &&
    benchmark.environment.cpuAffinity.logicalCpus === 1,
  'Release benchmark was not captured on one pinned reference CPU');
  const raceThroughput = (benchmark.summaries.race as {
    simulatedSecondsPerWallSecondMedian?: number;
  }).simulatedSecondsPerWallSecondMedian;
  requireCondition(Number.isFinite(raceThroughput) &&
    raceThroughput! >= MINIMUM_RACE_THROUGHPUT,
  `Full-race throughput ${raceThroughput}x is below the ${MINIMUM_RACE_THROUGHPUT}x gate`);
  requireCondition((benchmark.forecast['600']?.singleLapEvaluations ?? 0) > 0,
    'Benchmark cannot forecast a bounded 600-second search');
  for (const size of ['1', '2', '6', '12', '22']) {
    const sample = benchmark.plannerScaling.sizes[size];
    requireCondition(sample, `Benchmark is missing ${size}-car planner scaling`);
    requireCondition(Number.isFinite(sample.plannerTimeMilliseconds.p50) &&
      Number.isFinite(sample.plannerTimeMilliseconds.p95) &&
      Number.isFinite(sample.wallMillisecondsMedian) &&
      Number.isFinite(sample.wallMillisecondsP95),
    `Benchmark ${size}-car timing is non-finite`);
    requireCondition(sample.allocationCounts.maximumCandidatesPerUpdate <= 6,
      `Benchmark ${size}-car run exceeded six candidates per update`);
    requireCondition(sample.allocationCounts.maximumFullPathsPerSelection <= 1,
      `Benchmark ${size}-car run materialized multiple candidate paths`);
  }
  for (const [duration, sample] of Object.entries(
    benchmark.plannerDurationScaling.durations
  )) {
    requireCondition(sample.allocationCounts.maximumCandidatesPerUpdate <= 6 &&
      sample.allocationCounts.maximumFullPathsPerSelection <= 1,
    `Benchmark ${duration}-second run exceeded planner bounds`);
    requireCondition(sample.allocationCounts.retainedCandidateDiagnosticsAtStop.p95 <= 22 &&
      sample.allocationCounts.retainedDynamicPathsAtStop.p95 <= 22,
    `Benchmark ${duration}-second run retained state beyond the grid-size bound`);
  }

  const coldBudgets = [600, 900, 1200];
  const coldRuns = coldBudgets.map(budget => {
    const path = `output/track-optimizer/new-track-fixture/cold-${budget}/report.json`;
    const report = readJson<OptimizerReport>(path);
    requireCondition(report.trackId === 'new-track-fixture' &&
      report.trackSource === 'non-production-fixture',
    `Cold ${budget}-second report uses the wrong fixture`);
    requireCondition(report.budgetSeconds === budget,
      `Cold report budget mismatch for ${budget}`);
    requireCondition(['normal', 'acceptable'].includes(report.status),
      `Cold ${budget}-second run did not return an acceptable profile`);
    requireCondition(report.bestFoundNotGloballyOptimal,
      `Cold ${budget}-second report makes an invalid optimality claim`);
    requireCondition(report.deadline.overrunSeconds <= 5 &&
      !report.search.deadlineReached,
    `Cold ${budget}-second run exceeded its deadline`);
    requireCondition(report.cache.mode === 'in-memory-per-process' && !report.cache.warm,
      `Cold ${budget}-second run used a warm or disk cache`);
    return {
      budgetSeconds: budget,
      status: report.status,
      wallSeconds: report.stageMilliseconds.total / 1000,
      evaluations: report.search.evaluations,
      candidateId: report.selected.candidateId,
      fingerprints: report.fingerprints,
      overrunSeconds: report.deadline.overrunSeconds
    };
  });

  const existingRuns = TRACK_PROFILES.map(profile => {
    const report = readJson<OptimizerReport>(
      `output/track-optimizer/${profile.trackId}/report.json`
    );
    requireCondition(report.trackId === profile.trackId,
      `Optimizer report mismatch for ${profile.trackId}`);
    requireCondition(['normal', 'acceptable'].includes(report.status) &&
      report.bestFoundNotGloballyOptimal && report.deadline.overrunSeconds <= 5,
    `Optimizer evidence failed for ${profile.trackId}`);
    return {
      trackId: profile.trackId,
      status: profile.status,
      anchors: profile.anchors.length,
      trackFingerprint: profile.trackFingerprint,
      physicsFingerprint: profile.physicsFingerprint,
      optimizerVersion: profile.optimizerVersion,
      profileFingerprint: stableFingerprint(profile),
      candidateId: report.selected.candidateId,
      wallSeconds: report.stageMilliseconds.total / 1000,
      evaluations: report.search.evaluations
    };
  });

  const [developmentBundle, productionBundle] = await Promise.all([
    bundleEvidence(false),
    bundleEvidence(true)
  ]);
  const visual = readJson<VisualReview>(visualPath);
  requireCondition(visual.plan === DYNAMIC_PLAN,
    `Visual evidence belongs to a superseded plan; expected ${DYNAMIC_PLAN}`);
  requireCondition(visual.reviewedAt1x, 'Visual evidence was not reviewed at 1x');
  requireCondition(Number.isFinite(Date.parse(visual.reviewedAt)),
    'Visual evidence has no valid review timestamp');
  requireCondition(visual.developmentBundleSha256 === developmentBundle.sha256,
    `Visual evidence was captured from a stale development bundle; expected ${developmentBundle.sha256}, received ${visual.developmentBundleSha256}`);
  const requiredVisualCategories = [
    'cleanLines', 'curbUse', 'attackDefense', 'sideBySide', 'obligationYield',
    'hazardRunoff', 'pitFlow'
  ];
  for (const category of requiredVisualCategories) {
    const evidenceCategory = visual.categories[category];
    requireCondition(evidenceCategory?.status === 'pass',
      `Visual category ${category} is not passed`);
    requireCondition(evidenceCategory.evidence.length > 0,
      `Visual category ${category} has no evidence`);
    const missingTracks = TRACK_PROFILES
      .map(profile => profile.trackId)
      .filter(trackId => !evidenceCategory.tracks.includes(trackId));
    requireCondition(missingTracks.length === 0,
      `Visual category ${category} is missing tracks: ${missingTracks.join(', ')}`);
    requireCondition(evidenceCategory.reviewSpeeds.includes('1x') &&
      evidenceCategory.reviewSpeeds.includes('slow-motion'),
    `Visual category ${category} lacks 1x or slow-motion review`);
    for (const evidence of evidenceCategory.evidence) {
      if (evidence.startsWith('output/'))
        requireCondition(statSync(evidence).size > 0,
          `Visual evidence file ${evidence} is missing or empty`);
    }
  }
  requireCondition(visual.entryPaths.includes('index.html') &&
    visual.entryPaths.includes('golden-lap.html'),
  'Visual evidence does not cover both file entry paths');
  const browserPerformance = visual.performance;
  requireCondition(browserPerformance && browserPerformance.artifact.startsWith('output/') &&
    existsSync(browserPerformance.artifact) && statSync(browserPerformance.artifact).size > 0,
  'Browser performance raw artifact is missing or empty');
  requireCondition([
    browserPerformance.baselineFrameTimeP95Ms,
    browserPerformance.frameTimeP50Ms,
    browserPerformance.frameTimeP95Ms,
    browserPerformance.maximumRegressionFraction,
    browserPerformance.realTimeTargetP95Ms
  ].every(Number.isFinite) && browserPerformance.samples >= 300 &&
    browserPerformance.warmups >= 30,
  'Browser performance evidence is incomplete or non-finite');
  requireCondition(browserPerformance.maximumRegressionFraction <= 0.1,
    'Browser performance evidence weakened the 10% regression gate');
  requireCondition(browserPerformance.frameTimeP95Ms <=
    browserPerformance.baselineFrameTimeP95Ms *
      (1 + browserPerformance.maximumRegressionFraction),
  'Browser frame-time p95 regressed by more than 10%');
  requireCondition(browserPerformance.frameTimeP95Ms <=
    browserPerformance.realTimeTargetP95Ms,
  'Browser frame-time p95 missed the real-time target');

  const packageJson = readJson<{
    packageManager: string;
    engines: { node: string };
    devDependencies: Record<string, string>;
  }>('package.json');
  const git = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe'
  });
  requireCondition(git.exitCode === 0, 'Cannot read Git HEAD for evidence');

  const core = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gitHead: git.stdout.toString().trim(),
    tools: {
      bun: Bun.version,
      node: process.version.replace(/^v/, ''),
      packageManager: packageJson.packageManager,
      typescript: packageJson.devDependencies.typescript,
      playwright: packageJson.devDependencies.playwright
    },
    bundles: {
      development: developmentBundle,
      production: productionBundle,
      index: {
        bytes: statSync('index.html').size,
        sha256: sha256Bytes(readFileSync('index.html'))
      },
      redirect: {
        bytes: statSync('golden-lap.html').size,
        sha256: sha256Bytes(readFileSync('golden-lap.html'))
      }
    },
    profiles: existingRuns,
    newTrackColdRuns: coldRuns,
    benchmark: {
      artifact: benchmarkPath,
      frozenBaselineRaceThroughput: FROZEN_BASELINE_RACE_THROUGHPUT,
      minimumRaceThroughput: MINIMUM_RACE_THROUGHPUT,
      report: benchmark
    },
    sensitivity: {
      method: sensitivity.method,
      scenarios: sensitivity.scenarios,
      materialDimensions: material.map(row => ({
        key: row.key,
        unit: row.unit,
        score: row.score
      }))
    },
    statistics: {
      normal: {
        status: normal.status,
        counts: normal.counts,
        elapsedSeconds: normal.elapsedSeconds,
        fingerprint: normal.fingerprint
      },
      release: {
        status: release.status,
        counts: release.counts,
        elapsedSeconds: release.elapsedSeconds,
        workerCount: release.workerCount,
        exposure: release.exposure,
        policyFingerprint: release.policyFingerprint,
        scenarioFingerprint: release.scenarioFingerprint,
        fingerprint: release.fingerprint
      }
    },
    visualReview: visual,
    implementationAuthority: 'racecraft_dynamic_corridor_implementation_report.md',
    planAuthority: DYNAMIC_PLAN
  };
  const report = { ...core, fingerprint: stableFingerprint(core) };
  const output = 'output/release/racecraft-dynamic-corridor-manifest.json';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${stableJson(report, 2)}\n`);
  console.log(stableJson({
    valid: true,
    output,
    fingerprint: report.fingerprint,
    releaseCounts: release.counts,
    profiles: existingRuns.length,
    coldRuns: coldRuns.length,
    materialDimensions: material.length,
    bundles: report.bundles
  }, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
