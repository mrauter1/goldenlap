import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CORNER_LINE_LIBRARY_VERSION } from '../src/core/corner-lines';
import type { TrackProfile } from '../src/core/model';
import { TRACK_PROFILES } from '../src/data/track-profiles';
import { PIT_TEAMS, TRACK_DEFS } from '../src/data/tracks';
import { buildTrackDefinition, trackProfileFingerprints } from '../src/game/tracks';
import { stableJson } from '../src/shared/stable-json';
import {
  densifyCornerLineLibrary,
  optimizeCornerLineLibrary,
  selectControllerValidatedCornerLines
} from './lib/corner-line-search';
import { runSingleCar } from './lib/headless-sim';

const write = process.argv.includes('--write');
const libraryOnly = process.argv.includes('--library-only');
const trackArgument = process.argv.find(argument => argument.startsWith('--track='));
const selectedTrackId = trackArgument?.slice('--track='.length);
const outputPath = resolve(import.meta.dir, '../src/data/track-profiles.ts');

if (selectedTrackId && !TRACK_PROFILES.some(profile => profile.trackId === selectedTrackId))
  throw new Error(`Unknown track profile ${selectedTrackId}`);

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

const generated: TrackProfile[] = [];
const rows = [];
for (const current of TRACK_PROFILES) {
  if (selectedTrackId && current.trackId !== selectedTrackId) continue;
  const definition = TRACK_DEFS.find(candidate => candidate.id === current.trackId);
  if (!definition) throw new Error(`Unknown track profile ${current.trackId}`);
  const source = current as TrackProfile;
  const {
    cornerLines: _oldCornerLines,
    cornerLineOptimizerVersion: _oldCornerVersion,
    cornerLineProvenance: _oldCornerProvenance,
    ...idealProfile
  } = source;
  const provisional: TrackProfile = {
    ...idealProfile,
    ...trackProfileFingerprints(definition, PIT_TEAMS)
  };
  const built = buildTrackDefinition(definition, PIT_TEAMS, {
    profile: provisional,
    warn: false
  });
  const started = performance.now();
  const optimized = libraryOnly
    ? densifyCornerLineLibrary(built.tr, _oldCornerLines ?? [])
    : optimizeCornerLineLibrary(built.tr);
  const controller = selectControllerValidatedCornerLines(
    built,
    optimized,
    provisional.provenance.seed + 100,
    !libraryOnly
  );
  const withLines: TrackProfile = {
    ...provisional,
    cornerLineOptimizerVersion: CORNER_LINE_LIBRARY_VERSION,
    cornerLines: controller.library,
    cornerLineProvenance: {
      evaluations: optimized.evaluations,
      search: libraryOnly
        ? 'committed-rejoin+surface-extreme-apex-grid+controller-finalists'
        : 'deterministic-constrained-coordinate-pattern+controller-finalists',
      controllerValidations: controller.controllerValidations,
      backedOffLines: controller.backedOffLines
    }
  };
  let verifiedLapTime = withLines.metrics.verifiedLapTime;
  if (!libraryOnly) {
    const production = buildTrackDefinition(definition, PIT_TEAMS, {
      profile: withLines,
      requireProfile: true,
      warn: false
    });
    const simulation = runSingleCar(production, {
      laps: 3,
      seed: withLines.provenance.seed
    });
    if (simulation.reason !== 'complete' || simulation.validLaps !== 3 ||
        simulation.invalidLaps !== 0 || !simulation.finite || simulation.offCourseSeconds !== 0)
      throw new Error(`Ideal profile validation failed while generating ${definition.id}`);
    verifiedLapTime = round((simulation.lapTimes[1]! + simulation.lapTimes[2]!) / 2);
  }
  const profile: TrackProfile = {
    ...withLines,
    metrics: { ...withLines.metrics, verifiedLapTime }
  };
  generated.push(profile);
  rows.push({
    trackId: definition.id,
    corners: optimized.library.length,
    evaluations: optimized.evaluations,
    milliseconds: round(performance.now() - started),
    verifiedLapTime,
    minimumLossSeconds: round(Math.min(...controller.library.flatMap(pair => [
      pair.inside.idealRejoin.lapTimeLossSeconds,
      pair.inside.sustainedOffset.lapTimeLossSeconds,
      pair.outside.idealRejoin.lapTimeLossSeconds,
      pair.outside.sustainedOffset.lapTimeLossSeconds
    ]))),
    maximumLossSeconds: round(Math.max(...controller.library.flatMap(pair => [
      pair.inside.idealRejoin.lapTimeLossSeconds,
      pair.inside.sustainedOffset.lapTimeLossSeconds,
      pair.outside.idealRejoin.lapTimeLossSeconds,
      pair.outside.sustainedOffset.lapTimeLossSeconds
    ]))),
    controllerValidations: controller.controllerValidations,
    backedOffLines: controller.backedOffLines
  });
  console.error(`Generated ${definition.id}: ${optimized.library.length} corners`);
}

if (write) {
  const outputProfiles = selectedTrackId
    ? TRACK_PROFILES.map(profile =>
        generated.find(candidate => candidate.trackId === profile.trackId) ?? profile
      )
    : generated;
  const source =
    "import type { TrackProfile } from '../shared/types';\n\n" +
    '/** Generated compact ideal profiles and controller-validated corner-line libraries. */\n' +
    `export const TRACK_PROFILES = ${stableJson(outputProfiles, 2)} ` +
    'as const satisfies readonly TrackProfile[];\n';
  writeFileSync(outputPath, source);
}

console.log(stableJson({
  schemaVersion: 1,
  optimizerVersion: CORNER_LINE_LIBRARY_VERSION,
  libraryOnly,
  wrote: write,
  rows
}, 2));
