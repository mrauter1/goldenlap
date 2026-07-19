import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { BuiltTrack } from '../src/core/model';
import {
  RACECRAFT_CALIBRATION_DEFAULTS,
  RACECRAFT_CALIBRATION_DEFINITIONS,
  withRacecraftCalibration,
  type RacecraftCalibration
} from '../src/session/racecraft/config';
import {
  STRATEGY_BALANCE_DEFAULTS,
  STRATEGY_BALANCE_DEFINITIONS,
  withStrategyBalance,
  type StrategyBalance
} from '../src/session/strategy';
import {
  prepareHeadlessTrack,
  runFocusedSession,
  runHeadlessRace,
  type AuditFocusedScenario,
  type ForcedHeadlessStrategy,
  type FocusedSessionOptions
} from './lib/headless-sim';
import { emitAuditEvent } from './lib/audit-events';
import { focusedInvariantFailures, raceInvariantFailures } from './lib/audit-invariants';
import {
  modelTrackStrategy,
  runStrategyModel,
  strategyObjective,
  type StrategyModelReport,
  type StrategySchedule,
  type TrackStrategyModel
} from './strategy-model';

type AuditStatus = 'green' | 'amber' | 'red';
type OptimizeArea = 'tyres' | 'racecraft' | 'all';

interface ScenarioManifest {
  tracks: string[];
  seedSets: Record<string, number[]>;
}

interface BalanceFailure {
  trackId: string;
  target: string;
  value: number | string;
  expected: string;
  status: 'amber' | 'red';
}

interface CandidateState {
  strategy: StrategyBalance;
  racecraft: RacecraftCalibration;
}

interface CandidateEvaluation {
  key: string;
  value: number;
  objective: number;
  modelObjective: number;
  gateScore: number;
  gateGreen: boolean;
  accepted: boolean;
  elapsedMilliseconds: number;
}

interface OptimizationArtifact {
  schemaVersion: 1;
  audit: 'game-balance-optimizer';
  area: OptimizeArea;
  complete: boolean;
  reason: string;
  budgetMilliseconds: number;
  elapsedMilliseconds: number;
  initialObjective: number;
  bestObjective: number;
  best: CandidateState;
  evaluations: CandidateEvaluation[];
}

const SUITE = 'game-balance';
const ALL_TRACKS = ['prado', 'costa', 'nordwald', 'villa', 'anhembi', 'cerro'];

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

function trackIds(manifest: ScenarioManifest): string[] {
  const raw = argument('--tracks') ?? argument('--track');
  const ids = raw ? raw.split(',').filter(Boolean) : [...ALL_TRACKS];
  const unknown = ids.filter(id => !manifest.tracks.includes(id));
  if (unknown.length) throw new Error(`Unknown tracks: ${unknown.join(', ')}`);
  return ids;
}

export function balanceFailures(report: StrategyModelReport): BalanceFailure[] {
  const failures: BalanceFailure[] = [];
  for (const track of report.tracks) {
    if (!track.targets.pureParity) failures.push({
      trackId: track.trackId, target: 'pure-parity', value: track.pureDeltaSeconds,
      expected: 'normal ±4 s; acceptable ±8 s',
      status: Math.abs(track.pureDeltaSeconds) <= 8 ? 'amber' : 'red'
    });
    if (!track.targets.mixedViable) failures.push({
      trackId: track.trackId, target: 'mixed-viability', value: track.mixedDeltaSeconds,
      expected: 'normal ≤3 s; acceptable ≤6 s',
      status: track.mixedDeltaSeconds <= 6 ? 'amber' : 'red'
    });
    if (!track.targets.distinctStops) failures.push({
      trackId: track.trackId, target: 'stop-texture', value: track.stopDifference,
      expected: 'normal +1 stop; acceptable 0 to +2 stops',
      status: track.stopDifference >= 0 && track.stopDifference <= 2 ? 'amber' : 'red'
    });
    if (!track.targets.undercut) failures.push({
      trackId: track.trackId, target: 'undercut', value: track.undercutGainSeconds,
      expected: 'normal 2–5 s; acceptable 1–8 s',
      status: track.undercutGainSeconds >= 1 && track.undercutGainSeconds <= 8
        ? 'amber' : 'red'
    });
    if (!track.targets.wetCrossover) failures.push({
      trackId: track.trackId, target: 'wet-crossover', value: track.wetCrossover,
      expected: 'normal 0.23–0.33; acceptable 0.18–0.40',
      status: track.wetCrossover >= 0.18 && track.wetCrossover <= 0.40 ? 'amber' : 'red'
    });
    if (!track.targets.paceModesVisible) failures.push({
      trackId: track.trackId, target: 'pace-visibility', value: 'below band',
      expected: 'normal ≥1.5 s/lap; acceptable ≥1.0 s/lap',
      status: (() => {
        const save = track.paceModes.find(item => item.freeShare === 1 && item.mode === 'save')!;
        const push = track.paceModes.find(item => item.freeShare === 1 && item.mode === 'push')!;
        return save.paceSecondsPerLap - push.paceSecondsPerLap >= 1 ? 'amber' : 'red';
      })()
    });
  }
  return failures;
}

function reportMode(ids: string[]): {
  audit: string;
  mode: 'report';
  status: AuditStatus;
  report: StrategyModelReport;
  failures: BalanceFailure[];
} {
  emitAuditEvent(SUITE, 'phase-start', { phase: 'tier-0', status: 'running' });
  const report = runStrategyModel(ids);
  const failures = balanceFailures(report);
  const status: AuditStatus = failures.some(failure => failure.status === 'red')
    ? 'red' : failures.length ? 'amber' : 'green';
  emitAuditEvent(SUITE, 'suite-result', {
    phase: 'tier-0', status, tracks: ids.length, objective: report.objective,
    failures: failures.length
  });
  return { audit: SUITE, mode: 'report', status, report, failures };
}

function scenarioGateForKey(key: string): Array<{
  scenario: AuditFocusedScenario | 'priority';
  options?: Partial<FocusedSessionOptions>;
}> {
  if (key.includes('tow')) return [{ scenario: 'tow-run' }];
  if (key.includes('dirty')) return [{ scenario: 'alongside-straight' }];
  if (key.includes('pressure') || key.includes('underspeed'))
    return [{ scenario: 'train-pressure' }];
  if (key.includes('blueFlag'))
    return [{ scenario: 'priority', options: { priorityReason: 'blue-flag' } }];
  if (key.includes('qualifying')) return [{
    scenario: 'priority',
    options: { priorityReason: 'qualifying', qualifyingYieldPhase: 'out' }
  }];
  if (key.includes('prediction')) return [{ scenario: 'side-by-side-corner' }];
  if (key.includes('attack'))
    return [{ scenario: 'faster-behind' }, { scenario: 'spot-selection' }];
  if (key.includes('reaction') || key.includes('braking'))
    return [{ scenario: 'faster-behind' }, { scenario: 'alongside-straight' }];
  return [{ scenario: 'faster-behind' }];
}

function gateCandidate(
  track: BuiltTrack,
  key: string
): { green: boolean; score: number; hardFailures: string[] } {
  let score = 0;
  let green = true;
  for (const gate of scenarioGateForKey(key)) {
    const summary = runFocusedSession(track, {
      scenario: gate.scenario,
      seed: 11,
      deadlineMs: 5_000,
      stopWhenDecided: true,
      ...gate.options
    });
    const invariants = focusedInvariantFailures(summary);
    if (invariants.length) return { green: false, score: 10_000, hardFailures: invariants };
    if (gate.scenario === 'priority') {
      const priorityGreen = (summary.metrics.obligationObserved ?? 0) > 0 &&
        (summary.metrics.obligationYieldSpeedSamples ?? 0) > 0;
      green &&= priorityGreen;
      score += priorityGreen ? 0 : 100;
    } else {
      const verdict = summary.audit?.verdict;
      green &&= verdict === 'green';
      score += verdict === 'green' ? 0 : verdict === 'red' ? 100 : 30;
    }
  }
  return { green, score, hardFailures: [] };
}

function cloneState(state: CandidateState): CandidateState {
  return { strategy: { ...state.strategy }, racecraft: { ...state.racecraft } };
}

function withCandidate<T>(state: CandidateState, run: () => T): T {
  return withStrategyBalance(state.strategy, () =>
    withRacecraftCalibration(state.racecraft, run));
}

function writeArtifact(path: string, artifact: OptimizationArtifact): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
}

function optimizeMode(ids: string[], area: OptimizeArea): {
  audit: string;
  mode: 'optimize';
  status: AuditStatus;
  artifactPath: string;
  artifact: OptimizationArtifact;
} {
  const budgetMs = positiveNumber(argument('--budget-ms'), 600_000, '--budget-ms');
  const artifactPath = argument('--output') ?? 'output/audit-balance-optimizer.json';
  const startedAt = Date.now();
  const tracks = ids.map(prepareHeadlessTrack);
  const gateTrack = tracks[0]!;
  let best = {
    strategy: { ...STRATEGY_BALANCE_DEFAULTS },
    racecraft: { ...RACECRAFT_CALIBRATION_DEFAULTS }
  };
  const model = () => {
    const reports = tracks.map(modelTrackStrategy);
    return strategyObjective(reports).total;
  };
  const initialModelObjective = withCandidate(best, model);
  let bestObjective = initialModelObjective;
  const evaluations: CandidateEvaluation[] = [];
  const definitions: Array<{
    family: 'strategy' | 'racecraft';
    key: string;
    minimum: number;
    maximum: number;
  }> = [];
  if (area === 'tyres' || area === 'all')
    definitions.push(...STRATEGY_BALANCE_DEFINITIONS.map(definition => ({
      family: 'strategy' as const, key: definition.key,
      minimum: definition.minimum, maximum: definition.maximum
    })));
  if (area === 'racecraft' || area === 'all')
    definitions.push(...RACECRAFT_CALIBRATION_DEFINITIONS.map(definition => ({
      family: 'racecraft' as const, key: definition.key,
      minimum: definition.minimum, maximum: definition.maximum
    })));
  // Artifacts are resumable evidence: until the final iteration finishes they
  // must never claim completion, including if the process is interrupted.
  let complete = false;
  let reason = 'coordinate descent running';
  const artifact = (): OptimizationArtifact => ({
    schemaVersion: 1,
    audit: 'game-balance-optimizer',
    area,
    complete,
    reason,
    budgetMilliseconds: budgetMs,
    elapsedMilliseconds: Date.now() - startedAt,
    initialObjective: initialModelObjective,
    bestObjective,
    best: cloneState(best),
    evaluations: [...evaluations]
  });
  writeArtifact(artifactPath, artifact());
  emitAuditEvent(SUITE, 'phase-start', {
    phase: `optimize:${area}`, status: 'running', total: definitions.length * 6
  });
  outer: for (let pass = 0; pass < 3; pass++) {
    for (const definition of definitions) {
      if (Date.now() - startedAt >= budgetMs) {
        reason = 'wall budget exceeded';
        break outer;
      }
      const family = best[definition.family] as unknown as Record<string, number>;
      const current = family[definition.key]!;
      const step = (definition.maximum - definition.minimum) / (4 * 2 ** pass);
      const values = [...new Set([
        Math.max(definition.minimum, current - step),
        Math.min(definition.maximum, current + step)
      ])].filter(value => Math.abs(value - current) > 1e-12);
      for (const value of values) {
        if (Date.now() - startedAt >= budgetMs) {
          reason = 'wall budget exceeded';
          break outer;
        }
        const candidate = cloneState(best);
        (candidate[definition.family] as unknown as Record<string, number>)[definition.key] = value;
        const evaluationStartedAt = Date.now();
        const modelObjective = withCandidate(candidate, model);
        const modelImproves = area === 'racecraft' || modelObjective + 1e-9 < bestObjective;
        const gate = modelImproves
          ? withCandidate(candidate, () => gateCandidate(gateTrack, definition.key))
          : { green: false, score: 1_000, hardFailures: [] };
        if (gate.hardFailures.length) {
          complete = false;
          reason = `hard invariant: ${gate.hardFailures.join(', ')}`;
          writeArtifact(artifactPath, artifact());
          emitAuditEvent(SUITE, 'failure', {
            phase: `optimize:${area}`,
            caseId: `${definition.family}.${definition.key}=${value}`,
            status: 'failed',
            failures: gate.hardFailures
          });
          throw new Error(reason);
        }
        const objective = area === 'racecraft'
          ? gate.score
          : modelObjective + gate.score * 1_000;
        const accepted = gate.green && objective + 1e-9 < bestObjective;
        evaluations.push({
          key: `${definition.family}.${definition.key}`,
          value,
          objective,
          modelObjective,
          gateScore: gate.score,
          gateGreen: gate.green,
          accepted,
          elapsedMilliseconds: Date.now() - evaluationStartedAt
        });
        emitAuditEvent(SUITE, 'case-result', {
          phase: `optimize:${area}`,
          caseId: `${definition.family}.${definition.key}=${value}`,
          completed: evaluations.length,
          status: accepted ? 'green' : 'amber',
          objective,
          modelObjective,
          gateScore: gate.score,
          accepted
        });
        if (accepted) {
          best = candidate;
          bestObjective = objective;
        }
        writeArtifact(artifactPath, artifact());
      }
    }
  }
  if (reason !== 'wall budget exceeded') {
    complete = true;
    reason = 'coordinate descent complete';
  }
  writeArtifact(artifactPath, artifact());
  const status: AuditStatus = !complete ? 'amber' : bestObjective <= 1e-9 ? 'green' : 'red';
  emitAuditEvent(SUITE, 'suite-result', {
    phase: `optimize:${area}`, status, complete,
    elapsedMilliseconds: Date.now() - startedAt, evaluations: evaluations.length,
    bestObjective
  });
  return { audit: SUITE, mode: 'optimize', status, artifactPath, artifact: artifact() };
}

function scaledForcedStrategy(
  entryIndex: number,
  schedule: StrategySchedule,
  productionLaps: number,
  matrixLaps: number
): ForcedHeadlessStrategy {
  const cumulative: number[] = [];
  let elapsed = 0;
  for (let index = 0; index < schedule.stintLaps.length - 1; index++) {
    elapsed += schedule.stintLaps[index]!;
    cumulative.push(Math.max(1, Math.min(matrixLaps - 1,
      Math.round(elapsed / productionLaps * matrixLaps))));
  }
  const boxLaps = cumulative.filter((lap, index) => index === 0 || lap > cumulative[index - 1]!);
  const compounds = schedule.compounds.slice(0, boxLaps.length + 1);
  return { entryIndex, compounds, boxLaps };
}

function matrixMode(manifest: ScenarioManifest, ids: string[]): {
  audit: string;
  mode: 'matrix';
  status: AuditStatus;
  seedSet: string;
  seeds: number[];
  laps: number;
  tracks: Array<{
    trackId: string;
    softWins: number;
    hardWins: number;
    ties: number;
    softWinRate: number;
    meanSoftMinusHardSeconds: number;
    status: AuditStatus;
  }>;
  failures: string[];
} {
  const explicitSeeds = argument('--seeds');
  const seedSet = explicitSeeds ? 'custom' : argument('--seed-set') ?? 'calibration';
  const seeds = explicitSeeds
    ? integerList(explicitSeeds)
    : manifest.seedSets[seedSet];
  if (!seeds?.length) throw new Error(`Unknown or empty seed set ${seedSet}`);
  const laps = Math.round(positiveNumber(argument('--matrix-laps'), 5, '--matrix-laps'));
  if (laps < 5 || laps > 10) throw new Error('--matrix-laps must be from 5 to 10');
  const gridSize = Math.round(positiveNumber(argument('--grid-size'), 4, '--grid-size'));
  const deadlineMs = positiveNumber(argument('--deadline-ms'), 30_000, '--deadline-ms');
  const failures: string[] = [];
  const results = [];
  emitAuditEvent(SUITE, 'suite-start', {
    phase: 'matrix', status: 'running', total: ids.length * seeds.length * 2,
    seedSet, laps
  });
  let completed = 0;
  for (const trackId of ids) {
    const built = prepareHeadlessTrack(trackId);
    const model = modelTrackStrategy(built);
    let softWins = 0;
    let hardWins = 0;
    let ties = 0;
    const timeDeltas: number[] = [];
    for (const seed of seeds) {
      for (const swapped of [false, true]) {
        const softIndex = swapped ? 1 : 0;
        const hardIndex = swapped ? 0 : 1;
        const strategies = [
          scaledForcedStrategy(softIndex, model.bestSoft, model.laps, laps),
          scaledForcedStrategy(hardIndex, model.bestHard, model.laps, laps)
        ];
        const caseId = `${trackId}/${seed}/${swapped ? 'hard-soft' : 'soft-hard'}`;
        emitAuditEvent(SUITE, 'case-start', {
          phase: 'matrix', caseId, completed, status: 'running'
        });
        const summary = runHeadlessRace(built, {
          seed, laps, gridSize, deadlineMs, forcedStrategies: strategies,
          includeLapStrata: true
        });
        const invariantFailures = raceInvariantFailures(summary);
        if (summary.reason === 'deadline') invariantFailures.push('deadline');
        if (invariantFailures.length) {
          emitAuditEvent(SUITE, 'failure', {
            phase: 'matrix', caseId, status: 'failed', failures: invariantFailures
          });
          throw new Error(`Matrix hard failure ${caseId}: ${invariantFailures.join(', ')}`);
        }
        const soft = summary.strategyResults?.find(item => item.entryIndex === softIndex);
        const hard = summary.strategyResults?.find(item => item.entryIndex === hardIndex);
        if (!soft || !hard) throw new Error(`Missing forced strategy result for ${caseId}`);
        if (soft.finishPosition < hard.finishPosition) softWins++;
        else if (hard.finishPosition < soft.finishPosition) hardWins++;
        else ties++;
        if (soft.finishTime > 0 && hard.finishTime > 0)
          timeDeltas.push(soft.finishTime - hard.finishTime);
        completed++;
        emitAuditEvent(SUITE, 'case-result', {
          phase: 'matrix', caseId, completed, status: 'green',
          softPosition: soft.finishPosition, hardPosition: hard.finishPosition,
          softTime: soft.finishTime, hardTime: hard.finishTime
        });
      }
    }
    const decisions = softWins + hardWins;
    const softWinRate = decisions ? softWins / decisions : 0.5;
    const meanDelta = timeDeltas.length
      ? timeDeltas.reduce((sum, value) => sum + value, 0) / timeDeltas.length
      : 0;
    const status: AuditStatus = softWinRate >= 0.3 && softWinRate <= 0.7
      ? 'green'
      : softWinRate >= 0.2 && softWinRate <= 0.8 ? 'amber' : 'red';
    if (status === 'red') failures.push(
      `${trackId}: soft win rate ${(softWinRate * 100).toFixed(1)}% outside ` +
      'the acceptable 20–80% band (normal 30–70%)'
    );
    results.push({
      trackId, softWins, hardWins, ties,
      softWinRate: Math.round(softWinRate * 1e9) / 1e9,
      meanSoftMinusHardSeconds: Math.round(meanDelta * 1e9) / 1e9,
      status
    });
  }
  const status: AuditStatus = failures.length
    ? 'red' : results.some(result => result.status === 'amber') ? 'amber' : 'green';
  emitAuditEvent(SUITE, 'suite-result', {
    phase: 'matrix', status, completed, failures: failures.length
  });
  return {
    audit: SUITE, mode: 'matrix', status, seedSet, seeds, laps,
    tracks: results, failures
  };
}

function parseArea(raw: string): OptimizeArea {
  if (raw === 'tyres' || raw === 'racecraft' || raw === 'all') return raw;
  throw new Error('--optimize must be tyres, racecraft, or all');
}

function main(): void {
  try {
    const manifest = JSON.parse(readFileSync(
      'tests/fixtures/calibration/scenario-manifest.json', 'utf8'
    )) as ScenarioManifest;
    const ids = trackIds(manifest);
    const optimize = argument('--optimize');
    const result = process.argv.includes('--matrix')
      ? matrixMode(manifest, ids)
      : optimize ? optimizeMode(ids, parseArea(optimize)) : reportMode(ids);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'red') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitAuditEvent(SUITE, 'failure', { phase: 'runner', status: 'failed', message });
    process.stderr.write(`${message}\n`);
    process.stdout.write(`${JSON.stringify({
      audit: SUITE,
      mode: 'error',
      status: 'red',
      failures: [message]
    })}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.main) main();
