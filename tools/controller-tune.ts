import { botStep, PATH_FOLLOWER_TUNING } from '../src/core/autopilot';
import type { PathFollowerTuning, SampledPath, Track } from '../src/core/model';
import { makeCar, stepCar, trackSense } from '../src/core/physics-engine';
import {
  derivePathGeometry,
  detectSemanticCorners,
  legacyRacingLine,
  racingLine,
  refineSemanticCorners,
  speedProfile
} from '../src/core/racing-line';
import { buildTrack } from '../src/core/track';
import { TRACK_DEFS } from '../src/data/tracks';

interface PreparedTrack {
  track: Track & { idealPath: SampledPath };
  profile: ReturnType<typeof speedProfile>;
  markers: { index: number; target: number }[];
}

interface Score {
  tuning: PathFollowerTuning;
  maximum: number;
  meanMaximum: number;
  grass: number;
}

function prepare(): PreparedTrack[] {
  return TRACK_DEFS.map(definition => {
    const track = buildTrack(definition, 6);
    const profile = speedProfile(track);
    detectSemanticCorners(track, profile);
    refineSemanticCorners(track, legacyRacingLine(track));
    const idealPath = racingLine(track);
    const idealProfile = speedProfile(track, idealPath);
    idealPath.v = idealProfile.v;
    track.idealPath = idealPath;
    const markers = (track.corners ?? []).flatMap(corner => [
      { index: corner.turnInI, target: idealPath.off[corner.turnInI]! },
      { index: corner.apexI, target: idealPath.off[corner.apexI]! },
      { index: corner.trackOutI, target: idealPath.off[corner.trackOutI]! }
    ]);
    return { track: track as PreparedTrack['track'], profile, markers };
  });
}

function simulate(prepared: PreparedTrack, tuning: PathFollowerTuning): { maximum: number; grass: number } {
  const { track, profile } = prepared;
  const path = track.idealPath;
  const geometry = derivePathGeometry(track, path);
  const car = makeCar(geometry.x[0]!, geometry.y[0]!, Math.atan2(geometry.ty[0]!, geometry.tx[0]!));
  car.vx = 12;
  car.progIdx = 0;
  const best = prepared.markers.map(() => ({ distance: Infinity, error: Infinity }));
  let previousS = 0;
  let unwrapped = 0;
  let grass = 0;
  for (let step = 0; step < Math.ceil((track.idealTiming?.lapTime ?? profile.lapTime) * 2.55 * 120); step++) {
    const surface = trackSense(track, car);
    if (step > 0) {
      let delta = car.s - previousS;
      if (delta < -track.len / 2) delta += track.len;
      else if (delta > track.len / 2) delta -= track.len;
      if (delta > -2) unwrapped += Math.max(0, delta);
    }
    previousS = car.s;
    if (unwrapped >= track.len * 0.95 && unwrapped <= track.len * 2.05) {
      for (let markerIndex = 0; markerIndex < prepared.markers.length; markerIndex++) {
        const marker = prepared.markers[markerIndex]!;
        const distance = Math.abs(unwrapped - (track.len + marker.index * track.step));
        if (distance < best[markerIndex]!.distance) {
          best[markerIndex]!.distance = distance;
          best[markerIndex]!.error = Math.abs((surface.lat ?? 0) - marker.target);
        }
      }
    }
    const input = botStep(track, profile, car, {
      margin: 0.95,
      muScale: 1,
      path,
      pathTuning: tuning
    });
    stepCar(car, input, surface, 1 / 120, { pw: 1, mu: 1, dr: 1 });
    if (surface.zone === 'grass') grass++;
  }
  return { maximum: Math.max(...best.map(marker => marker.error)), grass };
}

const prepared = prepare();
const candidates: PathFollowerTuning[] = [];
for (const lookaheadBase of [0.5, 1, 1.5])
  for (const lookaheadSpeed of [0.34, 0.36, 0.38])
    for (const lookaheadMinimum of [5])
      for (const pursuitGain of [3.4, 3.5, 3.6, 3.7])
        for (const feedForwardGain of [0.15, 0.2, 0.25])
          candidates.push({
            ...PATH_FOLLOWER_TUNING,
            lookaheadBase,
            lookaheadSpeed,
            lookaheadMinimum,
            lookaheadMaximum: 28,
            pursuitGain,
            feedForwardGain
          });

const scores: Score[] = [];
for (const tuning of candidates) {
  const results = prepared.map(track => simulate(track, tuning));
  scores.push({
    tuning,
    maximum: Math.max(...results.map(result => result.maximum)),
    meanMaximum: results.reduce((sum, result) => sum + result.maximum, 0) / results.length,
    grass: results.reduce((sum, result) => sum + result.grass, 0)
  });
}
scores.sort((left, right) =>
  (left.grass > 0 ? 1000 : 0) + left.maximum -
  ((right.grass > 0 ? 1000 : 0) + right.maximum) ||
  left.meanMaximum - right.meanMaximum
);
console.log(scores.slice(0, 20));
