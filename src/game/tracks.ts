import {
  detectSemanticCorners,
  legacyRacingLine,
  racingLine,
  refineSemanticCorners,
  speedProfile
} from '../core/racing-line';
import { buildTrack } from '../core/track';
import { PIT_TEAMS, TRACK_DEFS } from '../data/tracks';
import type { BuiltTrack } from '../core/model';

export function buildTrackCatalog(): BuiltTrack[] {
  return TRACK_DEFS.map(definition => {
    const track = buildTrack(definition, PIT_TEAMS);
    const profile = speedProfile(track);
    detectSemanticCorners(track, profile);
    const bootstrapLine = legacyRacingLine(track);
    refineSemanticCorners(track, bootstrapLine);
    const idealPath = racingLine(track);
    const idealProfile = speedProfile(track, idealPath);
    idealPath.v = idealProfile.v;
    track.idealPath = idealPath;
    track.idealTiming = { t: idealProfile.t, lapTime: idealProfile.lapTime };
    if (idealProfile.lapTime > profile.lapTime + 1e-6)
      console.warn(
        `Racing line slower than centerline on ${definition.name}: ` +
        `${idealProfile.lapTime.toFixed(3)} > ${profile.lapTime.toFixed(3)}`
      );
    return { definition, track, profile };
  }).map(({ definition, track, profile }) => ({
    def: definition,
    tr: track as BuiltTrack['tr'],
    prof: profile
  }));
}
