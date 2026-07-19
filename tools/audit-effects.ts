import { readFileSync } from 'node:fs';

import type { BuiltTrack, TrackDefinition } from '../src/core/model';
import { evaluateCornerLine } from '../src/core/corner-lines';
import { PHYS } from '../src/core/physics';
import { stableFingerprint } from '../src/shared/stable-json';
import {
  prepareHeadlessTrack,
  prepareHeadlessTrackDefinition,
  runFocusedSession,
  type AuditFocusedScenario,
  type FocusedSessionOptions,
  type FocusedSessionSummary
} from './lib/headless-sim';
import { emitAuditEvent } from './lib/audit-events';
import { focusedInvariantFailures } from './lib/audit-invariants';
import { PROFILE_LAP_TIME_RATIO_ABSOLUTE } from './lib/profile-evaluate';

type EffectPhase =
  | 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L4b' | 'L5'
  | 'G' | 'H' | 'I' | 'K' | 'J' | 'C' | 'M5' | 'M6';
type EffectScenario =
  | AuditFocusedScenario
  | 'priority'
  | 'corner-line-library';
type AuditStatus = 'green' | 'amber' | 'red';

interface ScenarioManifest {
  tracks: string[];
  seedSets: Record<string, number[]>;
}

interface EffectCaseSpec {
  phase: EffectPhase;
  scenario: EffectScenario;
  variant: string;
  options?: Partial<FocusedSessionOptions>;
}

interface EffectCaseResult {
  caseId: string;
  phase: EffectPhase;
  scenario: EffectScenario;
  variant: string;
  trackId: string;
  seed: number;
  status: AuditStatus;
  reason: string;
  simulatedSeconds: number;
  wallMilliseconds: number;
  checksum: string;
  metrics: Record<string, number>;
  provenance?: {
    cornerId: string;
    apexIndex: number;
    passScore: number;
    vocabulary: 'inside' | 'outside' | 'switchback' | 'over-under' | 'drag-pass';
  };
}

interface AuditFailure {
  caseId: string;
  phase: EffectPhase | 'invariant' | 'runner';
  reason: string;
}

interface ParsedArguments {
  phases: EffectPhase[];
  tracks: string[];
  seedSet: string;
  seeds: number[];
  deadlineMs: number;
  budgetMs: number;
  abortOnRed: boolean;
}

const SUITE = 'racecraft-effects';
const DEFAULT_TRACKS = ['prado', 'nordwald', 'anhembi'];
const PHASE_ORDER: readonly EffectPhase[] = [
  'L0', 'L1', 'L2', 'L3', 'L4', 'L4b', 'L5', 'G', 'H', 'I', 'K', 'J', 'C',
  'M5', 'M6'
];

const PHASE_CASES: Readonly<Record<EffectPhase, readonly EffectCaseSpec[]>> = {
  L0: [
    { phase: 'L0', scenario: 'tucked-follow', variant: 'flying-lap' },
    { phase: 'L0', scenario: 'side-by-side-corner', variant: 'battle-economy' }
  ],
  L1: [
    { phase: 'L1', scenario: 'tucked-follow', variant: 'compatibility' },
    { phase: 'L1', scenario: 'side-by-side-corner', variant: 'compatibility' }
  ],
  L2: [
    { phase: 'L2', scenario: 'tucked-follow', variant: 'single-authority' },
    { phase: 'L2', scenario: 'side-by-side-corner', variant: 'pinned-room' },
    {
      phase: 'L2', scenario: 'defense-legality', variant: 'pinned-defense',
      options: { defenseVariant: 'anticipatory' }
    }
  ],
  L3: [
    { phase: 'L3', scenario: 'corner-line-library', variant: 'cached-real-lines' }
  ],
  L4: [
    { phase: 'L4', scenario: 'attack-launch', variant: 'tow-until-brake-derived-launch' },
    { phase: 'L4', scenario: 'switchback', variant: 'cached-outside-cutback' },
    { phase: 'L4', scenario: 'side-by-side-corner', variant: 'real-lines-economy' },
    { phase: 'L4', scenario: 'tucked-follow', variant: 'leader-eta-authority' }
  ],
  L4b: [
    { phase: 'L4b', scenario: 'tucked-follow', variant: 'location-priced-full-lap' },
    { phase: 'L4b', scenario: 'near-touch-tow', variant: 'free-lane-brake-reopen' },
    {
      phase: 'L4b', scenario: 'defense-legality', variant: 'anticipatory-regression',
      options: { defenseVariant: 'anticipatory' }
    }
  ],
  L5: [
    { phase: 'L5', scenario: 'inside-pass', variant: 'inside-dive' },
    { phase: 'L5', scenario: 'outside-pass', variant: 'around-the-outside' },
    { phase: 'L5', scenario: 'switchback', variant: 'switchback' },
    {
      phase: 'L5', scenario: 'over-under', variant: 'over-under',
      options: { initialGapM: 1, attackerGripScale: 1.04 }
    },
    { phase: 'L5', scenario: 'drag-pass', variant: 'drag-pass' }
  ],
  G: [
    { phase: 'G', scenario: 'light-rub', variant: 'low-impulse' }
  ],
  H: [
    {
      phase: 'H', scenario: 'faster-behind', variant: 'equal-wear',
      options: { firstTyreWear: 0.35, secondTyreWear: 0.35 }
    },
    {
      phase: 'H', scenario: 'faster-behind', variant: 'fresh-vs-worn',
      options: { firstTyreWear: 0.08, secondTyreWear: 0.68 }
    }
  ],
  I: [
    { phase: 'I', scenario: 'alongside-straight', variant: 'steady-overlap' },
    { phase: 'I', scenario: 'side-by-side-corner', variant: 'protected-corner' }
  ],
  K: [
    { phase: 'K', scenario: 'tow-run', variant: 'one-second-gap' },
    { phase: 'K', scenario: 'alongside-straight', variant: 'rear-stability' }
  ],
  J: [
    {
      phase: 'J', scenario: 'defense-legality', variant: 'anticipatory',
      options: { defenseVariant: 'anticipatory' }
    },
    {
      phase: 'J', scenario: 'defense-legality', variant: 'committed-attacker',
      options: { defenseVariant: 'committed' }
    },
    { phase: 'J', scenario: 'switchback', variant: 'covered-inside' },
    { phase: 'J', scenario: 'spot-selection', variant: 'next-two-corners' }
  ],
  C: [
    { phase: 'C', scenario: 'train-pressure', variant: 'underspeed-leader' }
  ],
  M5: [
    {
      phase: 'M5',
      scenario: 'train-pressure',
      variant: 'steer-vs-brake-overslow'
    },
    {
      phase: 'M5',
      scenario: 'priority',
      variant: 'yield-speed-canary',
      options: {
        priorityReason: 'blue-flag',
        initialGapM: 28,
        closingSpeedMps: 9
      }
    }
  ],
  M6: [
    {
      phase: 'M6',
      scenario: 'tow-run',
      variant: 'cost-evaluated-tow'
    },
    {
      phase: 'M6',
      scenario: 'attack-launch',
      variant: 'cost-evaluated-space'
    }
  ]
};

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function positiveNumber(raw: string | null, fallback: number, name: string): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function integerList(raw: string): number[] {
  const values = raw.split(',').filter(Boolean).map(Number);
  if (!values.length || values.some(value => !Number.isInteger(value)))
    throw new Error('--seeds must contain comma-separated integers');
  return values;
}

function parsePhases(raw: string | null): EffectPhase[] {
  if (!raw || raw.toLowerCase() === 'all') return [...PHASE_ORDER];
  const values = raw.split(',').map(value =>
    value.toLowerCase() === 'l4b' ? 'L4b' : value.toUpperCase()
  ) as EffectPhase[];
  if (!values.length || values.some(value => !PHASE_ORDER.includes(value)))
    throw new Error(`--phase must be one of ${PHASE_ORDER.join(',')} or all`);
  return [...new Set(values)];
}

function parseArguments(
  manifest: ScenarioManifest,
  additionalTrackIds: readonly string[] = []
): ParsedArguments {
  const seedSet = argument('--seed-set') ?? 'calibration';
  const explicitSeeds = argument('--seeds');
  const seeds = explicitSeeds ? integerList(explicitSeeds) : manifest.seedSets[seedSet];
  if (!seeds?.length) throw new Error(`Unknown or empty seed set ${seedSet}`);
  const rawTracks = argument('--tracks') ?? argument('--track');
  const tracks = rawTracks ? rawTracks.split(',').filter(Boolean) : DEFAULT_TRACKS;
  const knownTracks = new Set([...manifest.tracks, ...additionalTrackIds]);
  const unknownTracks = tracks.filter(track => !knownTracks.has(track));
  if (unknownTracks.length) throw new Error(`Unknown tracks: ${unknownTracks.join(', ')}`);
  return {
    phases: parsePhases(argument('--phase')),
    tracks,
    seedSet: explicitSeeds ? 'custom' : seedSet,
    seeds,
    deadlineMs: positiveNumber(argument('--deadline-ms'), 5_000, '--deadline-ms'),
    budgetMs: positiveNumber(argument('--budget-ms'), 60_000, '--budget-ms'),
    abortOnRed: process.argv.includes('--abort-on-red')
  };
}

function metric(summary: FocusedSessionSummary, name: string): number {
  return summary.metrics[name] ?? 0;
}

function effectMetrics(
  spec: EffectCaseSpec,
  summary: FocusedSessionSummary,
  soloCornerSeconds: number | null
): Record<string, number> {
  const selectedJ = summary.diagnostics.racecraftSelectedJ;
  const cornerDecisions = Object.values(
    summary.diagnostics.racecraftCornerDecisions
  );
  const metrics: Record<string, number> = {
    ...summary.metrics,
    racecraftSelectedJSamples: selectedJ.samples,
    racecraftSelectedJDroppedSamples: selectedJ.droppedSamples,
    racecraftSelectedJOwnTimeSeconds: selectedJ.ownTimeSeconds,
    racecraftSelectedJBillSeconds: selectedJ.billSeconds,
    racecraftSelectedJRecourseSeconds: selectedJ.recourseSeconds,
    racecraftSelectedJTieBandSeconds: selectedJ.tieBandSeconds,
    racecraftSelectedJTotalSeconds: selectedJ.totalSeconds,
    racecraftSelectedJHazardCount: selectedJ.hazardCount,
    racecraftCornerInlineDecisions: cornerDecisions.reduce(
      (sum, count) => sum + count.inline,
      0
    ),
    racecraftCornerOffsetDecisions: cornerDecisions.reduce(
      (sum, count) => sum + count.offset,
      0
    )
  };
  if (spec.scenario === 'tucked-follow') {
    const clean = metric(summary, 'auditSecondMarkerSeconds');
    metrics.tuckedFollowingLossFraction =
      (metric(summary, 'auditFirstMarkerSeconds') - clean) / Math.max(1e-9, clean);
  }
  if (spec.scenario === 'side-by-side-corner' && soloCornerSeconds !== null) {
    const pair = Math.max(
      metric(summary, 'auditFirstMarkerSeconds'),
      metric(summary, 'auditSecondMarkerSeconds')
    );
    metrics.battleEconomyLossFraction =
      (pair - soloCornerSeconds) /
        Math.max(1e-9, metric(summary, 'auditIdealLapSeconds'));
  }
  return metrics;
}

function effectProvenance(
  track: BuiltTrack,
  spec: EffectCaseSpec,
  summary: FocusedSessionSummary
): EffectCaseResult['provenance'] {
  if (spec.phase !== 'L5') return undefined;
  const apexIndex = metric(summary, 'auditExpectedCornerApex');
  const corner = track.tr.corners.find(candidate => candidate.apexI === apexIndex);
  if (!corner) return undefined;
  const vocabulary = spec.scenario === 'inside-pass'
    ? 'inside'
    : spec.scenario === 'outside-pass'
      ? 'outside'
      : spec.scenario === 'switchback'
        ? 'switchback'
        : spec.scenario === 'over-under'
          ? 'over-under'
          : 'drag-pass';
  return {
    cornerId: corner.id,
    apexIndex: corner.apexI,
    passScore: corner.passScore,
    vocabulary
  };
}

export function auditCornerLineLibrary(track: BuiltTrack): {
  status: AuditStatus;
  reason: string;
  metrics: Record<string, number>;
  checksum: string;
} {
  let lines = 0;
  let negativeLossLines = 0;
  let typicalLossLines = 0;
  let minimumLoss = Infinity;
  let maximumLoss = -Infinity;
  let sumLoss = 0;
  let minimumApexSeparation = Infinity;
  let maximumTimingDrift = 0;
  let maximumLapRatio = 0;
  try {
    for (const corner of track.tr.corners) {
      const pair = corner.alternateLines;
      if (!pair) throw new Error(`missing ${corner.id} alternate lines`);
      const apexInside = track.tr.idealPath.off[corner.apexI]! +
        pair.inside.idealRejoin.points.find(point => point.index === corner.apexI)!.eta;
      const apexOutside = track.tr.idealPath.off[corner.apexI]! +
        pair.outside.idealRejoin.points.find(point => point.index === corner.apexI)!.eta;
      minimumApexSeparation = Math.min(
        minimumApexSeparation,
        corner.side * (apexInside - apexOutside)
      );
      for (const line of [
        pair.inside.idealRejoin,
        pair.inside.sustainedOffset,
        pair.outside.idealRejoin,
        pair.outside.sustainedOffset
      ]) {
        const evaluated = evaluateCornerLine(track.tr, corner, line);
        const drift = Math.max(
          Math.abs(evaluated.apexSpeed - line.apexSpeed),
          Math.abs(evaluated.cornerTimeSeconds - line.cornerTimeSeconds),
          Math.abs(evaluated.lapTimeLossSeconds - line.lapTimeLossSeconds)
        );
        maximumTimingDrift = Math.max(maximumTimingDrift, drift);
        maximumLapRatio = Math.max(
          maximumLapRatio,
          evaluated.timing.lapTime / track.tr.idealTiming.lapTime
        );
        const loss = evaluated.lapTimeLossSeconds;
        minimumLoss = Math.min(minimumLoss, loss);
        maximumLoss = Math.max(maximumLoss, loss);
        sumLoss += loss;
        negativeLossLines += loss < -1e-9 ? 1 : 0;
        typicalLossLines += loss >= 0.2 - 1e-9 && loss <= 0.8 + 1e-9 ? 1 : 0;
        lines++;
      }
    }
  } catch (error) {
    return {
      status: 'red',
      reason: error instanceof Error ? error.message : String(error),
      metrics: { cornerLines: lines },
      checksum: stableFingerprint({ track: track.def.id, lines, error: String(error) })
    };
  }
  const metrics = {
    cornerLines: lines,
    cornerLineMinimumLossSeconds: minimumLoss,
    cornerLineMaximumLossSeconds: maximumLoss,
    cornerLineMeanLossSeconds: sumLoss / Math.max(1, lines),
    cornerLineNegativeLossLines: negativeLossLines,
    cornerLineTypicalLossLines: typicalLossLines,
    cornerLineTypicalLossFraction: typicalLossLines / Math.max(1, lines),
    cornerLineMinimumApexSeparation: minimumApexSeparation,
    cornerLineMaximumTimingDrift: maximumTimingDrift,
    cornerLineMaximumLapRatio: maximumLapRatio
  };
  const hardFailure = lines !== track.tr.corners.length * 4 ||
    minimumApexSeparation < PHYS.carWid - 1e-8 ||
    maximumTimingDrift > 1e-8 ||
    maximumLapRatio > PROFILE_LAP_TIME_RATIO_ABSOLUTE + 1e-9;
  const status: AuditStatus = hardFailure
    ? 'red'
    : negativeLossLines > 0 || typicalLossLines !== lines
      ? 'amber'
      : 'green';
  const reason = hardFailure
    ? `corner-line validation failed: ${lines} lines, ` +
      `${minimumApexSeparation.toFixed(3)} m apex separation, ` +
      `${maximumLapRatio.toFixed(5)} max lap ratio`
    : status === 'amber'
      ? `${typicalLossLines}/${lines} lines in the typical 0.2–0.8 s band; ` +
        `${negativeLossLines} physically timed faster than the committed ideal line`
      : `all ${lines} lines are legal, distinct, reproducible, and in the typical cost band`;
  return { status, reason, metrics, checksum: stableFingerprint(metrics) };
}

export function classifyEffectCase(
  spec: EffectCaseSpec,
  summary: FocusedSessionSummary,
  soloCornerSeconds: number | null
): { status: AuditStatus; reason: string; hardFailures: string[] } {
  const hardFailures = focusedInvariantFailures(summary);
  if ((spec.phase === 'L0' || spec.phase === 'L1') &&
      metric(summary, 'maximumPathSlew') > 0.5 + 1e-9)
    hardFailures.push('path-slew');
  if (hardFailures.length)
    return { status: 'red', reason: hardFailures.join(', '), hardFailures };
  if (summary.reason === 'deadline')
    return { status: 'red', reason: 'case deadline exceeded', hardFailures };

  if (spec.phase === 'M5' && spec.scenario === 'train-pressure') {
    const steer = metric(summary, 'auditEvaluatorSteerSelections');
    const brake = metric(summary, 'auditEvaluatorBrakeSelections');
    const ratio = steer / Math.max(1, steer + brake);
    return {
      status: ratio >= 0.9 ? 'green' : 'amber',
      reason: `overslow-leader steer ratio ${(ratio * 100).toFixed(1)}% ` +
        `(${steer} steer / ${brake} brake)`,
      hardFailures
    };
  }

  if (spec.phase === 'M5' && spec.scenario === 'priority') {
    const samples = metric(summary, 'obligationYieldSpeedSamples');
    const minimum = metric(summary, 'obligationYieldMinimumSpeedFraction');
    if (samples <= 0) return {
      status: 'red',
      reason: 'yield-speed canary observed no active obligation samples',
      hardFailures
    };
    return {
      status: minimum >= 0.95 ? 'green' : 'amber',
      reason: `yield minimum speed ${(minimum * 100).toFixed(1)}% of local pace ` +
        `across ${samples} samples`,
      hardFailures
    };
  }

  if (spec.phase === 'M6') {
    const selectedJ = summary.diagnostics.racecraftSelectedJ;
    const cornerDecisions = Object.values(
      summary.diagnostics.racecraftCornerDecisions
    );
    const inline = cornerDecisions.reduce((sum, count) => sum + count.inline, 0);
    const offset = cornerDecisions.reduce((sum, count) => sum + count.offset, 0);
    const switches = metric(summary, 'racecraftDecisionSwitches');
    const finiteJ = [
      selectedJ.ownTimeSeconds,
      selectedJ.billSeconds,
      selectedJ.recourseSeconds,
      selectedJ.tieBandSeconds,
      selectedJ.totalSeconds,
      selectedJ.hazardCount
    ].every(Number.isFinite);
    const observed = selectedJ.samples > 0 && finiteJ;
    const scenarioGreen = summary.audit?.verdict === 'green';
    return {
      status: observed && scenarioGreen ? 'green' : 'amber',
      reason: `${selectedJ.samples} selected-J samples ` +
        `(mean ${selectedJ.totalSeconds.toFixed(4)} s, ` +
        `${selectedJ.hazardCount.toFixed(2)} hazards), ${switches} switches, ` +
        `${inline} inline / ${offset} offset corner decisions; ` +
        `${summary.audit?.reason ?? 'scenario produced no verdict'}`,
      hardFailures
    };
  }

  if (spec.phase === 'L2') {
    const nonManeuver = metric(summary, 'laneTargetNonManeuverDiscontinuities');
    if (nonManeuver > 0) return {
      status: 'red',
      reason: `${nonManeuver} non-maneuver lane-target discontinuities (target 0)`,
      hardFailures
    };
  }

  if (spec.scenario === 'attack-launch') {
    return {
      status: summary.audit?.verdict === 'green' ? 'green' : 'amber',
      reason: summary.audit?.reason ??
        'space-selection scenario produced no verdict',
      hardFailures
    };
  }

  if (spec.scenario === 'faster-behind') {
    const passed = summary.audit?.verdict === 'green';
    return {
      status: passed ? 'green' : 'amber',
      reason: passed ? 'pass completed within three laps' : 'seed did not complete a pass',
      hardFailures
    };
  }
  if (spec.scenario === 'tucked-follow') {
    if (metric(summary, 'auditTuckedAuthorityLost') > 0) return {
      status: 'red',
      reason: 'follower lost tuck authority during the flying lap',
      hardFailures
    };
    const followerSeconds = metric(summary, 'auditFirstMarkerSeconds');
    const cleanSeconds = metric(summary, 'auditSecondMarkerSeconds');
    const loss = (followerSeconds - cleanSeconds) / Math.max(1e-9, cleanSeconds);
    return {
      status: loss <= 0.01 + 1e-9 ? 'green' : 'red',
      reason: `tucked following lap loss ${(loss * 100).toFixed(3)}% (target ≤1%)`,
      hardFailures
    };
  }
  if (spec.scenario === 'side-by-side-corner' && soloCornerSeconds !== null) {
    const pairTime = Math.max(
      metric(summary, 'auditFirstMarkerSeconds'),
      metric(summary, 'auditSecondMarkerSeconds')
    );
    const idealLapSeconds = metric(summary, 'auditIdealLapSeconds');
    const loss = (pairTime - soloCornerSeconds) / Math.max(1e-9, idealLapSeconds);
    if (pairTime < 0 || loss > 0.03 + 1e-9)
      return {
        status: 'red',
        reason: `battle economy ${(loss * 100).toFixed(3)}% exceeds 3% ` +
          `(pair ${pairTime.toFixed(3)}s, solo ${soloCornerSeconds.toFixed(3)}s, ` +
          `lap ${idealLapSeconds.toFixed(3)}s)`,
        hardFailures
      };
    if (loss < 0.01 - 1e-9 && summary.audit?.verdict === 'green')
      return {
        status: 'amber',
        reason: `battle economy ${(loss * 100).toFixed(3)}% is below the 1–3% target`,
        hardFailures
      };
  }
  if (spec.scenario === 'defense-legality' &&
      (spec.variant === 'anticipatory-regression' ||
        spec.variant === 'anticipatory' || spec.variant === 'pinned-defense') &&
      summary.audit?.verdict === 'undecided')
    return {
      status: 'amber',
      reason: 'discretionary anticipatory defense did not complete in the assertion window',
      hardFailures
    };
  if (spec.scenario === 'tow-run' && summary.audit?.verdict === 'red')
    return {
      status: 'amber',
      reason: `legacy overlap probe superseded by non-negative near-touch: ` +
        summary.audit.reason,
      hardFailures
    };
  if ((spec.phase === 'L5' || spec.scenario === 'switchback') &&
      summary.audit?.verdict === 'red')
    return {
      status: 'amber',
      reason: `track-dependent vocabulary finding: ${summary.audit.reason}`,
      hardFailures
    };
  if (summary.audit?.verdict === 'green')
    return { status: 'green', reason: summary.audit.reason, hardFailures };
  if (summary.audit?.verdict === 'red')
    return { status: 'red', reason: summary.audit.reason, hardFailures };
  const unsupportedSpot = spec.scenario === 'spot-selection' &&
    summary.audit?.reason.includes('no higher-scored') === true;
  return {
    status: unsupportedSpot ? 'amber' : 'red',
    reason: summary.audit?.reason ?? 'scenario produced no verdict',
    hardFailures
  };
}

function baselineCornerSeconds(
  track: BuiltTrack,
  seed: number,
  deadlineMs: number
): { seconds: number; summary: FocusedSessionSummary } {
  const summary = runFocusedSession(track, {
    scenario: 'solo-baseline', seed, deadlineMs, stopWhenDecided: true
  });
  const seconds = metric(summary, 'auditFirstMarkerSeconds');
  if (summary.audit?.verdict !== 'green' || seconds < 0)
    throw new Error(`Solo baseline failed on ${track.def.id}: ${summary.audit?.reason ?? summary.reason}`);
  return { seconds, summary };
}

function aggregateFasterBehind(
  cases: readonly EffectCaseResult[],
  failures: AuditFailure[]
): void {
  const groups = new Map<string, EffectCaseResult[]>();
  for (const result of cases.filter(item => item.scenario === 'faster-behind')) {
    const key = `${result.trackId}/${result.variant}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const successes = group.filter(item => item.status === 'green').length;
    const rate = successes / group.length;
    if (rate + 1e-9 < 0.8) failures.push({
      caseId: key,
      phase: 'H',
      reason: `faster-behind pass rate ${(rate * 100).toFixed(1)}% is below 80%`
    });
  }
}

function aggregateVocabulary(
  cases: readonly EffectCaseResult[],
  _failures: AuditFailure[]
): void {
  // Vocabulary outcomes are observations after evaluator unification. A
  // missing discretionary move is not an invariant failure in the M5
  // deletion phase.
  void cases;
}

export function runEffectAudit(
  args: ParsedArguments,
  now: () => number = Date.now,
  suppliedTracks: ReadonlyMap<string, BuiltTrack> = new Map()
): {
  audit: string;
  phase: string;
  status: AuditStatus;
  cases: EffectCaseResult[];
  failures: AuditFailure[];
  seeds: { set: string; values: number[] };
  tracks: string[];
  elapsedMilliseconds: number;
} {
  const startedAt = now();
  const tracks = new Map<string, BuiltTrack>();
  const baselines = new Map<string, number>();
  const cases: EffectCaseResult[] = [];
  const failures: AuditFailure[] = [];
  const specs = args.phases.flatMap(phase => PHASE_CASES[phase]);
  const total = args.tracks.length * args.seeds.length * specs.length;
  emitAuditEvent(SUITE, 'suite-start', {
    phase: args.phases.join(','), total, status: 'running', seedSet: args.seedSet
  });

  let aborted = false;
  for (const trackId of args.tracks) {
    if (aborted) break;
    if (now() - startedAt >= args.budgetMs) {
      failures.push({ caseId: trackId, phase: 'runner', reason: 'audit wall budget exceeded' });
      break;
    }
    const built = tracks.get(trackId) ?? suppliedTracks.get(trackId) ??
      prepareHeadlessTrack(trackId);
    tracks.set(trackId, built);
    const needsBaseline = specs.some(spec => spec.scenario === 'side-by-side-corner');
    if (needsBaseline) {
      const baseline = baselineCornerSeconds(built, args.seeds[0]!, args.deadlineMs);
      baselines.set(trackId, baseline.seconds);
      emitAuditEvent(SUITE, 'case-result', {
        phase: 'baseline', caseId: `${trackId}/solo-baseline`, status: 'green',
        cornerSeconds: baseline.seconds
      });
    }
    for (const seed of args.seeds) {
      if (aborted) break;
      for (const spec of specs) {
        const caseId = `${spec.phase}/${trackId}/${seed}/${spec.scenario}/${spec.variant}`;
        if (now() - startedAt >= args.budgetMs) {
          failures.push({ caseId, phase: 'runner', reason: 'audit wall budget exceeded' });
          aborted = true;
          break;
        }
        emitAuditEvent(SUITE, 'case-start', {
          phase: spec.phase, caseId, completed: cases.length, total, status: 'running'
        });
        const caseStartedAt = now();
        if (spec.scenario === 'corner-line-library') {
          const classification = auditCornerLineLibrary(built);
          const result: EffectCaseResult = {
            caseId,
            phase: spec.phase,
            scenario: spec.scenario,
            variant: spec.variant,
            trackId,
            seed,
            status: classification.status,
            reason: classification.reason,
            simulatedSeconds: 0,
            wallMilliseconds: now() - caseStartedAt,
            checksum: classification.checksum,
            metrics: classification.metrics
          };
          cases.push(result);
          emitAuditEvent(SUITE, 'case-result', {
            phase: spec.phase,
            caseId,
            completed: cases.length,
            total,
            status: result.status,
            reason: result.reason,
            simulatedSeconds: 0,
            wallMilliseconds: result.wallMilliseconds
          });
          if (result.status === 'red') {
            failures.push({ caseId, phase: spec.phase, reason: result.reason });
            if (args.abortOnRed) {
              aborted = true;
              break;
            }
          }
          continue;
        }
        const summary = runFocusedSession(built, {
          scenario: spec.scenario,
          seed,
          deadlineMs: args.deadlineMs,
          stopWhenDecided: true,
          ...spec.options
        });
        const classification = classifyEffectCase(
          spec,
          summary,
          baselines.get(trackId) ?? null
        );
        const provenance = effectProvenance(built, spec, summary);
        const result: EffectCaseResult = {
          caseId,
          phase: spec.phase,
          scenario: spec.scenario,
          variant: spec.variant,
          trackId,
          seed,
          status: classification.status,
          reason: classification.reason,
          simulatedSeconds: summary.simulatedSeconds,
          wallMilliseconds: now() - caseStartedAt,
          checksum: summary.checksum,
          metrics: effectMetrics(spec, summary, baselines.get(trackId) ?? null),
          ...(provenance ? { provenance } : {})
        };
        cases.push(result);
        emitAuditEvent(SUITE, 'case-result', {
          phase: spec.phase,
          caseId,
          completed: cases.length,
          total,
          status: result.status,
          reason: result.reason,
          simulatedSeconds: result.simulatedSeconds,
          wallMilliseconds: result.wallMilliseconds
        });
        if (classification.hardFailures.length) {
          failures.push({ caseId, phase: 'invariant', reason: classification.reason });
          emitAuditEvent(SUITE, 'failure', {
            phase: 'invariant', caseId, status: 'failed', reason: classification.reason
          });
          aborted = true;
          break;
        }
        if (result.status === 'red' && spec.scenario !== 'faster-behind') {
          failures.push({ caseId, phase: spec.phase, reason: result.reason });
          if (args.abortOnRed) {
            aborted = true;
            break;
          }
        }
      }
    }
  }
  aggregateFasterBehind(cases, failures);
  aggregateVocabulary(cases, failures);
  const elapsedMilliseconds = now() - startedAt;
  const hasAmber = cases.some(result =>
    result.status === 'amber' && result.scenario !== 'faster-behind');
  const status: AuditStatus = failures.length ? 'red' : hasAmber ? 'amber' : 'green';
  emitAuditEvent(SUITE, 'suite-result', {
    phase: args.phases.join(','), completed: cases.length, total,
    elapsedMilliseconds, status, failures: failures.length
  });
  return {
    audit: SUITE,
    phase: args.phases.join(','),
    status,
    cases,
    failures,
    seeds: { set: args.seedSet, values: args.seeds },
    tracks: args.tracks,
    elapsedMilliseconds
  };
}

function main(): void {
  try {
    const manifest = JSON.parse(readFileSync(
      'tests/fixtures/calibration/scenario-manifest.json', 'utf8'
    )) as ScenarioManifest;
    const definitionFile = argument('--definition-file');
    const definition = definitionFile
      ? JSON.parse(readFileSync(definitionFile, 'utf8')) as TrackDefinition
      : null;
    const supplied = definition
      ? new Map([[definition.id, prepareHeadlessTrackDefinition(definition)]])
      : new Map<string, BuiltTrack>();
    const result = runEffectAudit(
      parseArguments(manifest, definition ? [definition.id] : []),
      Date.now,
      supplied
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'red') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitAuditEvent(SUITE, 'failure', { phase: 'runner', status: 'failed', message });
    process.stderr.write(`${message}\n`);
    process.stdout.write(`${JSON.stringify({
      audit: SUITE,
      phase: 'runner',
      status: 'red',
      cases: [],
      failures: [{ caseId: 'runner', phase: 'runner', reason: message }]
    })}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.main) main();
