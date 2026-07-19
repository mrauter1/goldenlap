import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  evaluateProfileAnalytically,
  makeHeuristicProfile
} from '../../../tools/lib/profile-evaluate';
import {
  optimizeTrackProfile,
  searchTrackProfile
} from '../../../tools/lib/profile-search';
import { TRACK_PROFILES } from '../../../src/data/track-profiles';
import { PIT_TEAMS, TRACK_DEFS } from '../../../src/data/tracks';
import { buildTrackDefinition } from '../../../src/game/tracks';
import { stableJson } from '../../../src/shared/stable-json';

const definition = TRACK_DEFS[0]!;
const profile = TRACK_PROFILES[0]!;

describe('bounded TrackProfile optimizer', () => {
  test('rejects semantically invalid candidates before production validation', () => {
    const built = buildTrackDefinition(definition, PIT_TEAMS, { profile: null, warn: false });
    expect(evaluateProfileAnalytically(built, profile).valid).toBe(true);
    const inverted = {
      ...profile,
      anchors: profile.anchors.map(anchor => ({ ...anchor, lateral: -anchor.lateral }))
    };
    const result = evaluateProfileAnalytically(built, inverted);
    expect(result.valid).toBe(false);
    expect(result.rejection).toContain('outside-apex-outside');
  });

  test('finds a clear verified improvement from a controlled suboptimal profile', () => {
    const built = buildTrackDefinition(definition, PIT_TEAMS, { profile: null, warn: false });
    const heuristic = makeHeuristicProfile(built, 101);
    const suboptimal = {
      ...heuristic,
      anchors: heuristic.anchors.map(anchor => ({ ...anchor, lateral: anchor.lateral * 1.5 }))
    };
    const first = optimizeTrackProfile(built, suboptimal, {
      seed: 101,
      maxEvaluations: 350,
      budgetSeconds: 1
    });
    const second = optimizeTrackProfile(built, suboptimal, {
      seed: 101,
      maxEvaluations: 350,
      budgetSeconds: 1
    });
    expect(first.search.variableCount).toBeLessThanOrEqual(36);
    expect(first.search.evaluations).toBeLessThanOrEqual(350);
    expect(first.search.evaluations).toBeGreaterThan(40);
    // Eighteen 120 Hz simulation frames is a material, reproducible gain; the
    // exact old 0.3 s threshold depended on the superseded road-only baseline.
    expect(first.verifiedImprovementSeconds).toBeGreaterThanOrEqual(0.15);
    expect(first.predictedImprovementSeconds).toBeGreaterThanOrEqual(0.15);
    expect(first.selected.valid).toBe(true);
    expect(first.search.ranked.some(candidate =>
      candidate.valid && candidate.curbMetres > 0 && candidate.grassMetres === 0
    )).toBe(true);
    expect(stableJson(first.selectedProfile.anchors)).toBe(stableJson(second.selectedProfile.anchors));
    expect(first.selected.measuredLapTime).toBe(second.selected.measuredLapTime);
  }, 15_000);

  test('honors evaluation caps and an injected monotonic deadline', () => {
    const built = buildTrackDefinition(definition, PIT_TEAMS, { profile: null, warn: false });
    const capped = searchTrackProfile(built, profile, {
      seed: 7,
      maxEvaluations: 10,
      budgetSeconds: 1
    });
    expect(capped.evaluations).toBe(10);
    expect(capped.evaluationCapReached).toBe(true);
    let tick = 0;
    const deadline = searchTrackProfile(built, profile, {
      seed: 7,
      maxEvaluations: 100,
      budgetSeconds: 1,
      searchDeadlineAt: 8,
      now: () => ++tick
    });
    expect(deadline.deadlineReached).toBe(true);
    expect(deadline.evaluations).toBeLessThan(10);
  });

  test('short-budget CLI is bounded, no-write, and emits a valid report', () => {
    const sourceBefore = readFileSync('src/data/track-profiles.ts', 'utf8');
    const result = Bun.spawnSync([
      'bun', 'tools/optimize-track.ts', '--track', 'prado',
      '--budget-seconds', '4', '--allow-short-budget',
      '--max-evaluations', '40', '--seed', '101', '--json',
      '--output-dir', '/tmp/goldenlap-profile-optimizer-test'
    ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as {
      status: string;
      bestFoundNotGloballyOptimal: boolean;
      search: { evaluations: number };
      deadline: { overrunSeconds: number };
    };
    expect(['normal', 'acceptable']).toContain(report.status);
    expect(report.bestFoundNotGloballyOptimal).toBe(true);
    expect(report.search.evaluations).toBeLessThanOrEqual(40);
    expect(report.deadline.overrunSeconds).toBeLessThanOrEqual(5);
    expect(readFileSync('src/data/track-profiles.ts', 'utf8')).toBe(sourceBefore);
  }, 10_000);

  test('optimizes and writes the non-production cold-start fixture explicitly', () => {
    const directory = '/tmp/goldenlap-new-track-cli-test';
    const profileSource = `${directory}/track-profiles.ts`;
    const result = Bun.spawnSync([
      'bun', 'tools/optimize-track.ts', '--track', 'new-track-fixture',
      '--budget-seconds', '4', '--allow-short-budget', '--max-evaluations', '40',
      '--seed', '101', '--write', '--profile-file', profileSource,
      '--output-dir', directory
    ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    expect(existsSync(profileSource)).toBe(true);
    expect(readFileSync(profileSource, 'utf8')).toContain('"trackId": "new-track-fixture"');
    const validation = Bun.spawnSync([
      'bun', 'tools/validate-new-track-workflow.ts',
      '--report', `${directory}/report.json`, '--profile-source', profileSource,
      '--allow-short-budget'
    ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(validation.exitCode).toBe(0);
    expect(JSON.parse(validation.stdout.toString()).valid).toBe(true);
  }, 15_000);
});
