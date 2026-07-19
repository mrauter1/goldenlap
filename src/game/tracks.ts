import {
  applyPathAuthority,
  detectSemanticCorners,
  legacyRacingLine,
  racingLine,
  refineSemanticCorners,
  speedProfile
} from '../core/racing-line';
import { materializeTrackProfile } from '../core/racing-line';
import {
  CORNER_LINE_LIBRARY_VERSION,
  installCornerLineLibrary
} from '../core/corner-lines';
import { PATH_FOLLOWER_TUNING } from '../core/autopilot';
import { PHYS, SURF } from '../core/physics';
import {
  CURB_INSET_METRES,
  CURB_OUTSET_METRES,
  SURFACE_MAP_VERSION
} from '../core/surface';
import { buildTrack } from '../core/track';
import { TRACK_PROFILES } from '../data/track-profiles';
import { PIT_TEAMS, TRACK_DEFS } from '../data/tracks';
import type { BuiltTrack, TrackProfile } from '../core/model';
import { stableFingerprint } from '../shared/stable-json';
import type { TrackDefinition } from '../shared/types';

export interface TrackBuildOptions {
  profile?: TrackProfile | null;
  requireProfile?: boolean;
  warn?: boolean;
}

export function trackProfileFingerprints(
  definition: TrackDefinition,
  pitTeams = PIT_TEAMS
): { trackFingerprint: string; physicsFingerprint: string; surfaceFingerprint: string } {
  return {
    trackFingerprint: stableFingerprint({
      geometryVersion: 'catmull-uniform-v1',
      surfaceGeometryVersion: SURFACE_MAP_VERSION,
      curbInsetMetres: CURB_INSET_METRES,
      curbOutsetMetres: CURB_OUTSET_METRES,
      id: definition.id,
      width: definition.width,
      points: definition.pts,
      pitTeams,
      ...(definition.widthProfile === undefined
        ? {}
        : { widthProfile: definition.widthProfile }),
      ...(definition.pit === undefined ? {} : { pit: definition.pit })
    }),
    physicsFingerprint: stableFingerprint({
      profileSchemaVersion: 1,
      materializerVersion: 'periodic-smootherstep-v1',
      speedProfileVersion: 'surface-friction-circle-v2',
      semanticAuthorityVersion: 'path-derived-braking-v1',
      semanticLineVersion: 'surface-normalized-utilization-v2',
      cornerLineLibraryVersion: CORNER_LINE_LIBRARY_VERSION,
      fixedStep: 1 / 120,
      physics: PHYS,
      pathFollower: PATH_FOLLOWER_TUNING
    }),
    surfaceFingerprint: stableFingerprint({
      surfaceCoefficientVersion: 'footprint-blend-v1',
      surfaceMapVersion: SURFACE_MAP_VERSION,
      curbInsetMetres: CURB_INSET_METRES,
      curbOutsetMetres: CURB_OUTSET_METRES,
      coefficients: SURF
    })
  };
}

export function profileForTrack(trackId: string): TrackProfile | null {
  return TRACK_PROFILES.find(profile => profile.trackId === trackId) ?? null;
}

export function buildTrackDefinition(
  definition: TrackDefinition,
  pitTeams = PIT_TEAMS,
  options: TrackBuildOptions = {}
): BuiltTrack {
  const track = buildTrack(definition, pitTeams);
  const profile = speedProfile(track);
  detectSemanticCorners(track, profile);
  const bootstrapLine = legacyRacingLine(track);
  refineSemanticCorners(track, bootstrapLine);
  const heuristicPath = racingLine(track);
  const fingerprints = trackProfileFingerprints(definition, pitTeams);
  const stored = options.profile === undefined ? profileForTrack(definition.id) : options.profile;
  let idealPath = heuristicPath;
  let warning: string | undefined;
  if (!stored) {
    warning = `Missing TrackProfile for ${definition.id}; using deterministic heuristic fallback`;
    track.trackProfileState = { status: 'missing-fallback', ...fingerprints, warning };
  } else if (stored.schemaVersion !== 1 ||
      stored.trackFingerprint !== fingerprints.trackFingerprint ||
      stored.physicsFingerprint !== fingerprints.physicsFingerprint ||
      stored.surfaceFingerprint !== fingerprints.surfaceFingerprint) {
    warning = `Stale TrackProfile for ${definition.id}; using deterministic heuristic fallback`;
    track.trackProfileState = { status: 'stale-fallback', ...fingerprints, warning };
  } else {
    idealPath = materializeTrackProfile(track, stored);
    track.trackProfile = stored;
    track.trackProfileState = { status: 'matched', ...fingerprints };
  }
  if (warning && options.requireProfile) throw new Error(warning);
  if (warning && options.warn !== false) console.warn(warning);
  const idealProfile = speedProfile(track, idealPath);
  idealPath.v = idealProfile.v;
  applyPathAuthority(track, idealPath, idealProfile);
  track.idealPath = idealPath;
  track.idealTiming = { t: idealProfile.t, lapTime: idealProfile.lapTime };
  if (track.trackProfile) {
    const cornerLines = track.trackProfile.cornerLines;
    const cornerLibraryValid =
      track.trackProfile.cornerLineOptimizerVersion === CORNER_LINE_LIBRARY_VERSION &&
      cornerLines !== undefined;
    if (!cornerLibraryValid) {
      const cornerWarning =
        `Missing or stale corner-line library for ${definition.id}; ` +
        'alternate racecraft lines are unavailable';
      if (options.requireProfile) throw new Error(cornerWarning);
      if (options.warn !== false) console.warn(cornerWarning);
    } else {
      installCornerLineLibrary(track, cornerLines!);
    }
  }
  if (idealProfile.lapTime > profile.lapTime + 1e-6)
    console.warn(
      `Racing line slower than centerline on ${definition.name}: ` +
      `${idealProfile.lapTime.toFixed(3)} > ${profile.lapTime.toFixed(3)}`
    );
  return {
    def: definition,
    tr: track as BuiltTrack['tr'],
    prof: profile
  };
}

export function buildTrackCatalog(): BuiltTrack[] {
  return TRACK_DEFS.map(definition => buildTrackDefinition(definition));
}
