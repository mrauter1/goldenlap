import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TrackProfile } from '../src/core/model';
import { PIT_TEAMS } from '../src/data/tracks';
import { buildTrackDefinition } from '../src/game/tracks';
import { stableJson } from '../src/shared/stable-json';
import { NEW_TRACK_FIXTURE } from './fixtures/new-track';
import { runSingleCar } from './lib/headless-sim';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

try {
  const reportPath = argument('--report') ??
    'output/track-optimizer/new-track-fixture/cold-900/report.json';
  if (!existsSync(reportPath))
    throw new Error(
      `Missing ${reportPath}; run the cold new-track optimizer proof first or pass ` +
      '--report <report.json> [--profile-source <file>]'
    );
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    trackId: string;
    trackSource: string;
    budgetSeconds: number;
    status: string;
    bestFoundNotGloballyOptimal: boolean;
    cache: { mode: string; warm: boolean };
    deadline: { overrunSeconds: number };
    selectedProfile: TrackProfile;
  };
  if (report.trackId !== NEW_TRACK_FIXTURE.id ||
      report.trackSource !== 'non-production-fixture')
    throw new Error('Report does not describe the locked non-production fixture');
  if (!process.argv.includes('--allow-short-budget') &&
      (report.budgetSeconds < 600 || report.budgetSeconds > 1200))
    throw new Error('Workflow proof budget must be within 600–1200 seconds');
  if (!['normal', 'acceptable'].includes(report.status) ||
      !report.bestFoundNotGloballyOptimal || report.deadline.overrunSeconds > 5 ||
      report.cache.mode !== 'in-memory-per-process' || report.cache.warm)
    throw new Error('Optimizer status, deadline, cache, or claim contract failed');
  const profile = report.selectedProfile;
  if (stableJson(JSON.parse(stableJson(profile))) !== stableJson(profile))
    throw new Error('Generated profile serialization is unstable');
  const built = buildTrackDefinition(NEW_TRACK_FIXTURE, PIT_TEAMS, {
    profile,
    requireProfile: true,
    warn: false
  });
  const dry = runSingleCar(built, { laps: 3, seed: profile.provenance.seed });
  const wet = runSingleCar(built, {
    laps: 1,
    seed: profile.provenance.seed + 1,
    margin: 0.93,
    muScale: 0.82,
    initialLateralOffset: 0.7
  });
  if (dry.reason !== 'complete' || dry.validLaps !== 3 || !dry.finite ||
      dry.offCourseSeconds !== 0 || wet.reason !== 'complete' ||
      wet.validLaps !== 1 || !wet.finite || wet.offCourseSeconds !== 0)
    throw new Error('Generated profile failed production controller validation');

  const changedGeometry = {
    ...NEW_TRACK_FIXTURE,
    pts: NEW_TRACK_FIXTURE.pts.map((point, index) => index === 0
      ? [point[0] + 0.25, point[1]] as const
      : point)
  };
  const stale = buildTrackDefinition(changedGeometry, PIT_TEAMS, {
    profile,
    warn: false
  });
  if (stale.tr.trackProfileState?.status !== 'stale-fallback')
    throw new Error('Geometry change did not trigger stale-profile fallback');
  let staleRejected = false;
  try {
    buildTrackDefinition(changedGeometry, PIT_TEAMS, {
      profile,
      requireProfile: true,
      warn: false
    });
  } catch (error) {
    staleRejected = error instanceof Error && error.message.includes('Stale TrackProfile');
  }
  if (!staleRejected) throw new Error('Release-mode stale profile was not rejected');

  const profileSource = argument('--profile-source');
  let bundleBytes: number | null = null;
  if (profileSource) {
    if (!existsSync(profileSource) ||
        !readFileSync(profileSource, 'utf8').includes(`\"trackId\": \"${profile.trackId}\"`))
      throw new Error('Generated profile source is missing the selected fixture entry');
    const bundlePath = '/tmp/goldenlap-new-track-profile-bundle.js';
    const bundle = Bun.spawnSync([
      'bun', 'build', resolve(profileSource), '--target=browser', '--format=iife',
      `--outfile=${bundlePath}`, '--reject-unresolved'
    ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    if (bundle.exitCode !== 0 || !existsSync(bundlePath))
      throw new Error(`Generated profile source did not bundle: ${bundle.stderr.toString()}`);
    bundleBytes = readFileSync(bundlePath).byteLength;
  }

  console.log(JSON.stringify({
    schemaVersion: 1,
    valid: true,
    trackId: profile.trackId,
    budgetSeconds: report.budgetSeconds,
    status: profile.status,
    anchors: profile.anchors.length,
    verifiedLapTime: profile.metrics.verifiedLapTime,
    dryLapTimes: dry.lapTimes,
    wetLapTime: wet.lapTimes[0],
    staleFallback: stale.tr.trackProfileState?.status,
    staleReleaseRejected: staleRejected,
    generatedProfileBundleBytes: bundleBytes
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
