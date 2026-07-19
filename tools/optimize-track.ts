import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PIT_TEAMS, TRACK_DEFS } from '../src/data/tracks';
import { CORNER_LINE_LIBRARY_VERSION } from '../src/core/corner-lines';
import { materializeTrackProfile } from '../src/core/racing-line';
import { buildTrackDefinition, profileForTrack } from '../src/game/tracks';
import { runSingleCar } from './lib/headless-sim';
import { evaluateProfileAnalytically, makeHeuristicProfile } from './lib/profile-evaluate';
import { upsertTrackProfileSource } from './lib/profile-io';
import { optimizeTrackProfile } from './lib/profile-search';
import { characterizeTrack } from './lib/track-characterize';
import { NEW_TRACK_FIXTURE } from './fixtures/new-track';
import { emitAuditEvent } from './lib/audit-events';
import {
  optimizeCornerLineLibrary,
  selectControllerValidatedCornerLines,
  seedCornerLineLibrary
} from './lib/corner-line-search';
import type { TrackDefinition, TrackProfile } from '../src/shared/types';

class ProductFailure extends Error {}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function numberArgument(name: string, fallback: number): number {
  const raw = argument(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function integerArgument(name: string, fallback: number): number {
  const value = numberArgument(name, fallback);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function markdown(report: Record<string, unknown>): string {
  const selected = report.selected as Record<string, unknown>;
  const search = report.search as Record<string, unknown>;
  const stage = report.stageMilliseconds as Record<string, number>;
  return `# Track optimization — ${report.trackId}\n\n` +
    `Status: **${report.status}**\n\n` +
    `This is the best profile found within the bounded search, not a claim of global optimality.\n\n` +
    `- Seed: ${report.seed}\n` +
    `- Budget: ${report.budgetSeconds} s\n` +
    `- Evaluations: ${search.evaluations}\n` +
    `- Variables: ${search.variableCount}\n` +
    `- Verified improvement: ${report.verifiedImprovementSeconds} s\n` +
    `- Predicted improvement: ${report.predictedImprovementSeconds} s\n` +
    `- Selected profile status: ${selected.status}\n` +
    `- Stage A: ${stage.baseline.toFixed(1)} ms\n` +
    `- Stage B: ${stage.search.toFixed(1)} ms\n` +
    `- Stage C: ${stage.validation.toFixed(1)} ms\n` +
    `- Stage D: ${stage.characterization.toFixed(1)} ms\n` +
    `- Total: ${stage.total.toFixed(1)} ms\n\n` +
    `## Simplifications\n\n${(report.simplifications as string[]).length
      ? (report.simplifications as string[]).map(item => `- ${item}`).join('\n')
      : '- None triggered.'}\n`;
}

function atomicWrite(file: string, contents: string): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, file);
}

try {
  const definitionFile = argument('--definition-file');
  const suppliedDefinition = definitionFile
    ? JSON.parse(readFileSync(resolve(definitionFile), 'utf8')) as TrackDefinition
    : null;
  const trackId = suppliedDefinition?.id ?? argument('--track');
  if (!trackId)
    throw new Error(
      'Usage: --track <track-id> or --definition-file <file> [--budget-seconds 900] [--write]'
    );
  const definition = suppliedDefinition ??
    TRACK_DEFS.find(candidate => candidate.id === trackId) ??
    (NEW_TRACK_FIXTURE.id === trackId ? NEW_TRACK_FIXTURE : null);
  if (!definition) throw new Error(`Unknown track ${trackId}`);
  const fixture = suppliedDefinition !== null || definition === NEW_TRACK_FIXTURE;
  const allowShort = process.argv.includes('--allow-short-budget');
  const budgetSeconds = numberArgument('--budget-seconds', 900);
  if ((!allowShort && (budgetSeconds < 600 || budgetSeconds > 1200)) ||
      (allowShort && (budgetSeconds <= 0 || budgetSeconds > 1200)))
    throw new Error('Budget must be 600–1200 seconds (or positive with --allow-short-budget)');
  const seed = integerArgument('--seed', 101);
  const maxEvaluations = integerArgument('--max-evaluations', 1200);
  emitAuditEvent('track-optimizer', 'suite-start', {
    trackId, budgetSeconds, maxEvaluations, seed, status: 'running'
  });
  const write = process.argv.includes('--write');
  const profileFileArgument = argument('--profile-file');
  if (fixture && write && !profileFileArgument)
    throw new Error('The non-production fixture requires --profile-file when --write is used');
  const jsonOutput = process.argv.includes('--json');
  const started = performance.now();
  const deadlineAt = started + budgetSeconds * 1000;
  const searchDeadlineAt = started + budgetSeconds * 1000 * 0.68;
  const validationDeadlineAt = started + budgetSeconds * 1000 * 0.9;

  const built = buildTrackDefinition(definition, PIT_TEAMS, { warn: false });
  const stored = fixture ? null : profileForTrack(definition.id);
  const migratedStored = stored && built.tr.trackProfileState
    ? {
        ...stored,
        trackFingerprint: built.tr.trackProfileState.trackFingerprint,
        physicsFingerprint: built.tr.trackProfileState.physicsFingerprint,
        surfaceFingerprint: built.tr.trackProfileState.surfaceFingerprint
      }
    : null;
  const incumbent = built.tr.trackProfileState?.status === 'matched' && built.tr.trackProfile
    ? built.tr.trackProfile
    : migratedStored && evaluateProfileAnalytically(built, migratedStored).valid
      ? migratedStored
      : makeHeuristicProfile(built, seed);
  const baselineStarted = performance.now();
  emitAuditEvent('track-optimizer', 'phase-start', {
    phase: 'baseline', caseId: trackId, status: 'running'
  });
  const incumbentPath = materializeTrackProfile(built.tr, incumbent);
  const baseline = runSingleCar(built, {
    path: incumbentPath,
    laps: 1,
    seed,
    deadlineMs: Math.max(0, Math.min(60_000, searchDeadlineAt - performance.now()))
  });
  if (baseline.reason !== 'complete' || baseline.validLaps !== 1 ||
      baseline.offCourseSeconds !== 0 || !baseline.finite)
    throw new ProductFailure('Safe incumbent violates a deterministic invariant');
  const baselineFinished = performance.now();
  emitAuditEvent('track-optimizer', 'case-result', {
    phase: 'baseline',
    caseId: trackId,
    status: 'green',
    elapsedMilliseconds: baselineFinished - baselineStarted,
    lapTime: baseline.lapTimes[0],
    maximumTrackingError: baseline.maximumPathError
  });

  let optimization: ReturnType<typeof optimizeTrackProfile>;
  try {
    optimization = optimizeTrackProfile(built, incumbent, {
      seed,
      maxEvaluations,
      budgetSeconds,
      searchDeadlineAt,
      validationDeadlineAt,
      onProgress: event => emitAuditEvent('track-optimizer', 'progress', {
        phase: event.phase,
        caseId: trackId,
        stage: event.stage,
        completed: event.evaluations,
        total: event.maximumEvaluations,
        candidateId: event.candidateId,
        valid: event.valid,
        status: 'running'
      })
    });
  } catch (error) {
    if (error instanceof Error &&
        (error.message.includes('Safe incumbent') || error.message.includes('no valid profile')))
      throw new ProductFailure(error.message);
    throw error;
  }
  const {
    cornerLines: _selectedCornerLines,
    cornerLineOptimizerVersion: _selectedCornerVersion,
    cornerLineProvenance: _selectedCornerProvenance,
    ...selectedIdealProfile
  } = optimization.selectedProfile;
  let selectedProfile: TrackProfile = selectedIdealProfile;
  let cornerLineEvaluations = 0;
  let cornerLineControllerValidations = 0;
  let cornerLineBackedOff = 0;
  let cornerLineMilliseconds = 0;
  if (write) {
    const cornerLineStarted = performance.now();
    const selectedBuilt = buildTrackDefinition(definition, PIT_TEAMS, {
      profile: selectedProfile,
      warn: false
    });
    const cornerLines = allowShort && budgetSeconds < 600
      ? seedCornerLineLibrary(selectedBuilt.tr)
      : optimizeCornerLineLibrary(selectedBuilt.tr);
    const controllerLines = selectControllerValidatedCornerLines(
      selectedBuilt,
      cornerLines,
      seed + 100
    );
    cornerLineEvaluations = cornerLines.evaluations;
    cornerLineControllerValidations = controllerLines.controllerValidations;
    cornerLineBackedOff = controllerLines.backedOffLines;
    cornerLineMilliseconds = performance.now() - cornerLineStarted;
    selectedProfile = {
      ...selectedProfile,
      cornerLineOptimizerVersion: CORNER_LINE_LIBRARY_VERSION,
      cornerLines: controllerLines.library,
      cornerLineProvenance: {
        evaluations: cornerLines.evaluations,
        search: allowShort && budgetSeconds < 600
          ? 'deterministic-constrained-safe-incumbent+controller-finalists'
          : 'deterministic-constrained-coordinate-pattern+controller-finalists',
        controllerValidations: controllerLines.controllerValidations,
        backedOffLines: controllerLines.backedOffLines
      }
    };
  }
  const characterizationStarted = performance.now();
  emitAuditEvent('track-optimizer', 'phase-start', {
    phase: 'characterization', caseId: trackId, status: 'running'
  });
  const characterization = performance.now() < deadlineAt && optimization.selected.analytical.path
    ? characterizeTrack(
        built,
        optimization.selected.analytical.path,
        selectedProfile,
        seed + 10_000
      )
    : null;
  const characterizationFinished = performance.now();
  const finished = performance.now();
  const overrunSeconds = Math.max(0, (finished - deadlineAt) / 1000);
  if (overrunSeconds > 5)
    throw new ProductFailure(`Optimizer exceeded deadline by ${overrunSeconds}s`);
  const report = {
    schemaVersion: 1,
    trackId,
    trackSource: fixture ? 'non-production-fixture' : 'production-catalog',
    seed,
    budgetSeconds,
    maxEvaluations,
    status: selectedProfile.status,
    bestFoundNotGloballyOptimal: true,
    fingerprints: {
      track: selectedProfile.trackFingerprint,
      physics: selectedProfile.physicsFingerprint,
      surface: selectedProfile.surfaceFingerprint
    },
    baseline: {
      verifiedLapTime: optimization.incumbent.measuredLapTime,
      predictedLapTime: optimization.incumbent.analytical.predictedLapTime,
      controllerLapTime: baseline.lapTimes[0],
      maximumTrackingError: baseline.maximumPathError
    },
    selected: {
      status: selectedProfile.status,
      verifiedLapTime: optimization.selected.measuredLapTime,
      robustLapTime: optimization.selected.robustLapTime,
      predictedLapTime: optimization.selected.analytical.predictedLapTime,
      maximumTrackingError: optimization.selected.maximumTrackingError,
      robustnessScore: optimization.selected.robustnessScore,
      candidateId: optimization.selected.analytical.id,
      curbMetres: optimization.selected.analytical.curbMetres,
      grassMetres: optimization.selected.analytical.grassMetres,
      maximumCurbFraction: optimization.selected.analytical.maximumCurbFraction,
      maximumGrassFraction: optimization.selected.analytical.maximumGrassFraction
    },
    verifiedImprovementSeconds: optimization.verifiedImprovementSeconds,
    predictedImprovementSeconds: optimization.predictedImprovementSeconds,
    search: {
      variableCount: optimization.search.variableCount,
      totalMutableAnchors: optimization.search.totalMutableAnchors,
      evaluations: optimization.search.evaluations,
      cacheHits: optimization.search.cacheHits,
      rejectedBeforeEvaluation: optimization.search.rejectedBeforeEvaluation,
      deadlineReached: optimization.search.deadlineReached,
      evaluationCapReached: optimization.search.evaluationCapReached,
      paretoCandidates: optimization.search.pareto.length
    },
    finalists: optimization.finalists.map(finalist => ({
      id: finalist.analytical.id,
      valid: finalist.valid,
      rejection: finalist.rejection,
      predictedLapTime: finalist.analytical.predictedLapTime,
      measuredLapTime: finalist.measuredLapTime,
      robustLapTime: finalist.robustLapTime,
      maximumTrackingError: finalist.maximumTrackingError,
      curbMetres: finalist.analytical.curbMetres,
      grassMetres: finalist.analytical.grassMetres
    })),
    characterization,
    simplifications: optimization.search.simplifications,
    stageMilliseconds: {
      baseline: baselineFinished - baselineStarted,
      search: optimization.timings.searchMilliseconds,
      validation: optimization.timings.validationMilliseconds,
      cornerLines: cornerLineMilliseconds,
      characterization: characterizationFinished - characterizationStarted,
      total: finished - started
    },
    deadline: { overrunSeconds, reserveFraction: 0.1 },
    cache: { mode: 'in-memory-per-process', warm: false },
    cornerLines: {
      generated: write,
      evaluations: cornerLineEvaluations,
      controllerValidations: cornerLineControllerValidations,
      backedOffLines: cornerLineBackedOff,
      optimizerVersion: write ? CORNER_LINE_LIBRARY_VERSION : null
    },
    selectedProfile
  };

  const outputDirectory = resolve(
    argument('--output-dir') ?? `output/track-optimizer/${trackId}`
  );
  mkdirSync(outputDirectory, { recursive: true });
  atomicWrite(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  atomicWrite(resolve(outputDirectory, 'report.md'), markdown(report));
  if (write) {
    const profileFile = resolve(profileFileArgument ?? 'src/data/track-profiles.ts');
    mkdirSync(dirname(profileFile), { recursive: true });
    const source = existsSync(profileFile)
      ? readFileSync(profileFile, 'utf8')
      : 'type TrackProfile = unknown;\n\n' +
        'export const TRACK_PROFILES = [\n' +
        '] as const satisfies readonly TrackProfile[];\n';
    atomicWrite(profileFile, upsertTrackProfileSource(source, selectedProfile));
  }
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else console.log(
    `${trackId}: ${report.status}; ${optimization.search.evaluations} evaluations; ` +
    `${optimization.verifiedImprovementSeconds.toFixed(3)}s verified improvement; ` +
    `${((finished - started) / 1000).toFixed(2)}s wall time${write ? '; profile written' : ''}`
  );
  emitAuditEvent('track-optimizer', 'suite-result', {
    trackId,
    status: report.status === 'normal' ? 'green' : 'amber',
    elapsedMilliseconds: finished - started,
    evaluations: optimization.search.evaluations,
    outputDirectory
  });
} catch (error) {
  emitAuditEvent('track-optimizer', 'failure', {
    status: 'failed', message: error instanceof Error ? error.message : String(error)
  });
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(error instanceof ProductFailure ? 1 : 2);
}
