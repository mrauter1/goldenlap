import { materializeTrackProfile } from '../src/core/racing-line';
import type { BuiltTrack, TrackProfile, TrackProfileAnchor } from '../src/core/model';
import { PIT_TEAMS, TRACK_DEFS } from '../src/data/tracks';
import { buildTrackDefinition, trackProfileFingerprints } from '../src/game/tracks';
import { stableJson } from '../src/shared/stable-json';
import { runSingleCar } from './lib/headless-sim';

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function baselineAnchors(built: BuiltTrack): TrackProfileAnchor[] {
  const track = built.tr;
  const indices = new Set<number>();
  const atDistance = (distance: number): number =>
    ((Math.round(distance / track.step) % track.n) + track.n) % track.n;
  const pitStart = ((track.pit.sEntry - 80) % track.len + track.len) % track.len;
  for (const distance of [pitStart, track.pit.sExit + 30, track.len - 25, 25])
    indices.add(atDistance(distance));
  for (const corner of track.corners) {
    if (corner.planRole === 'complex-secondary') continue;
    indices.add(corner.turnInI);
    indices.add(corner.apexI);
    indices.add(corner.trackOutI);
  }
  return [...indices].sort((left, right) => left - right).map(index => ({
    sFraction: round(index / track.n),
    lateral: round(track.idealPath.off[index]!)
  }));
}

function generateProfile(built: BuiltTrack): TrackProfile {
  const fingerprints = trackProfileFingerprints(built.def, PIT_TEAMS);
  const clean = runSingleCar(built, { laps: 1, seed: 101 });
  const robustness = [
    runSingleCar(built, { laps: 1, seed: 211, muScale: 0.82, margin: 0.93 }),
    runSingleCar(built, { laps: 1, seed: 307, muScale: 0.9, margin: 0.94 }),
    runSingleCar(built, { laps: 1, seed: 401, muScale: 1.04, margin: 0.96 })
  ];
  const robustnessScore = robustness.filter(summary =>
    summary.reason === 'complete' && summary.validLaps === 1 && summary.finite &&
    summary.offCourseSeconds === 0
  ).length / robustness.length;
  const profile: TrackProfile = {
    schemaVersion: 1,
    trackId: built.def.id,
    ...fingerprints,
    optimizerVersion: 'semantic-baseline-1',
    status: clean.validLaps === 1 && clean.offCourseSeconds === 0 &&
      clean.maximumMarkerError <= 0.75 && robustnessScore === 1
      ? 'normal'
      : 'acceptable',
    anchors: baselineAnchors(built),
    metrics: {
      estimatedLapTime: round(built.tr.idealTiming.lapTime),
      verifiedLapTime: clean.lapTimes[0] ?? Infinity,
      maximumTrackingError: clean.maximumMarkerError,
      offCourseSeconds: clean.offCourseSeconds,
      robustnessScore: round(robustnessScore)
    },
    provenance: {
      seed: 101,
      budgetSeconds: 0,
      evaluations: 4,
      search: 'deterministic-semantic-safe-incumbent'
    }
  };
  const reconstructed = materializeTrackProfile(built.tr, profile);
  let maximumDifference = 0;
  for (let index = 0; index < built.tr.n; index++)
    maximumDifference = Math.max(
      maximumDifference,
      Math.abs(reconstructed.off[index]! - built.tr.idealPath.off[index]!)
    );
  if (maximumDifference > 1e-6)
    throw new Error(`${built.def.id} baseline reconstruction differs by ${maximumDifference}`);
  return profile;
}

const profiles = TRACK_DEFS.map(definition => generateProfile(
  buildTrackDefinition(definition, PIT_TEAMS, { profile: null, warn: false })
));
console.log(stableJson({ profiles }, 2));
