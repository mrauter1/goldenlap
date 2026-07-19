import { TRACK_PROFILES } from '../src/data/track-profiles';
import { PIT_TEAMS, TRACK_DEFS } from '../src/data/tracks';
import { buildTrackDefinition } from '../src/game/tracks';
import {
  CORNER_LINE_LIBRARY_VERSION,
  evaluateCornerLine
} from '../src/core/corner-lines';
import { PHYS } from '../src/core/physics';
import { stableJson } from '../src/shared/stable-json';
import {
  evaluateProfileAnalytically,
  PROFILE_LAP_TIME_RATIO_ABSOLUTE,
  PROFILE_MARKER_ERROR_ABSOLUTE_METRES
} from './lib/profile-evaluate';
import { runSingleCar } from './lib/headless-sim';

try {
  const ids = new Set<string>();
  const rows = [];
  for (const definition of TRACK_DEFS) {
    const profile = TRACK_PROFILES.find(candidate => candidate.trackId === definition.id);
    if (!profile) throw new Error(`Missing TrackProfile for ${definition.id}`);
    if (ids.has(profile.trackId)) throw new Error(`Duplicate TrackProfile ${profile.trackId}`);
    ids.add(profile.trackId);
    if (stableJson(JSON.parse(stableJson(profile))) !== stableJson(profile))
      throw new Error(`Unstable TrackProfile serialization for ${profile.trackId}`);
    const built = buildTrackDefinition(definition, PIT_TEAMS, {
      profile,
      requireProfile: true,
      warn: false
    });
    const simulation = runSingleCar(built, { laps: 3, seed: profile.provenance.seed });
    const analytical = evaluateProfileAnalytically(built, profile);
    const wet = runSingleCar(built, {
      laps: 1,
      seed: profile.provenance.seed + 1,
      margin: 0.93,
      muScale: 0.82,
      initialLateralOffset: 0.7
    });
    if (profile.cornerLineOptimizerVersion !== CORNER_LINE_LIBRARY_VERSION ||
        profile.cornerLines?.length !== built.tr.corners.length)
      throw new Error(`Profile ${profile.trackId} has no current corner-line library`);
    let maximumAlternateMarkerError = 0;
    let minimumAlternateLoss = Infinity;
    let maximumAlternateLoss = -Infinity;
    let alternateIndex = 0;
    for (const corner of built.tr.corners) {
      const pair = corner.alternateLines;
      if (!pair) throw new Error(`Profile ${profile.trackId} is missing ${corner.id} lines`);
      const apexInside = built.tr.idealPath.off[corner.apexI]! +
        pair.inside.idealRejoin.points.find(point => point.index === corner.apexI)!.eta;
      const apexOutside = built.tr.idealPath.off[corner.apexI]! +
        pair.outside.idealRejoin.points.find(point => point.index === corner.apexI)!.eta;
      if (corner.side * (apexInside - apexOutside) < PHYS.carWid - 1e-8)
        throw new Error(`Profile ${profile.trackId} ${corner.id} alternates are not distinct`);
      for (const line of [
        pair.inside.idealRejoin,
        pair.inside.sustainedOffset,
        pair.outside.idealRejoin,
        pair.outside.sustainedOffset
      ]) {
        const evaluated = evaluateCornerLine(built.tr, corner, line);
        if (evaluated.brakeI !== line.brakeI ||
            Math.abs(evaluated.apexSpeed - line.apexSpeed) > 1e-8 ||
            Math.abs(evaluated.cornerTimeSeconds - line.cornerTimeSeconds) > 1e-8 ||
            Math.abs(evaluated.lapTimeLossSeconds - line.lapTimeLossSeconds) > 1e-8 ||
            evaluated.timing.lapTime >
              built.tr.idealTiming.lapTime * PROFILE_LAP_TIME_RATIO_ABSOLUTE + 1e-9)
          throw new Error(`Profile ${profile.trackId} ${corner.id} timing policy failed`);
        const driven = runSingleCar(built, {
          laps: 1,
          seed: profile.provenance.seed + 100 + alternateIndex++,
          path: evaluated.path
        });
        if (driven.reason !== 'complete' || driven.validLaps !== 1 ||
            driven.invalidLaps !== 0 || !driven.finite || driven.offCourseSeconds !== 0 ||
            driven.maximumMarkerError > PROFILE_MARKER_ERROR_ABSOLUTE_METRES + 1e-9)
          throw new Error(
            `Profile ${profile.trackId} ${corner.id} ${line.kind} controller validation failed`
          );
        maximumAlternateMarkerError = Math.max(
          maximumAlternateMarkerError,
          driven.maximumMarkerError
        );
        minimumAlternateLoss = Math.min(minimumAlternateLoss, line.lapTimeLossSeconds);
        maximumAlternateLoss = Math.max(maximumAlternateLoss, line.lapTimeLossSeconds);
      }
    }
    if (simulation.reason !== 'complete' || simulation.validLaps !== 3 || !simulation.finite ||
        simulation.offCourseSeconds !== 0 || wet.reason !== 'complete' ||
        wet.validLaps !== 1 || !wet.finite || wet.offCourseSeconds !== 0 ||
        !analytical.valid || analytical.grassMetres > 1e-7 ||
        analytical.maximumGrassFraction > 1e-8)
      throw new Error(`Profile ${profile.trackId} failed production controller validation`);
    const verifiedLapTime = (simulation.lapTimes[1]! + simulation.lapTimes[2]!) / 2;
    if (Math.abs(verifiedLapTime - profile.metrics.verifiedLapTime) > 1 / 120 + 1e-9)
      throw new Error(`Profile ${profile.trackId} verified lap provenance drifted`);
    rows.push({
      trackId: profile.trackId,
      status: profile.status,
      runtime: built.tr.trackProfileState?.status,
      anchors: profile.anchors.length,
      verifiedLapTime,
      wetLapTime: wet.lapTimes[0],
      offCourseSeconds: simulation.offCourseSeconds + wet.offCourseSeconds,
      maximumTrackingError: Math.max(
        simulation.maximumMarkerError,
        wet.maximumMarkerError
      ),
      curbMetres: analytical.curbMetres,
      grassMetres: analytical.grassMetres,
      maximumCurbFraction: analytical.maximumCurbFraction,
      maximumGrassFraction: analytical.maximumGrassFraction,
      cornerLines: profile.cornerLines.length * 4,
      minimumAlternateLoss,
      maximumAlternateLoss,
      maximumAlternateMarkerError
    });
  }
  if (ids.size !== TRACK_PROFILES.length)
    throw new Error('Committed TrackProfile exists for an unknown track');
  console.log(JSON.stringify({ schemaVersion: 1, valid: true, rows }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
