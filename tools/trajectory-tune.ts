import { botStep } from '../src/core/autopilot';
import type { LegacyCorner, SampledPath, Track } from '../src/core/model';
import { makeCar, stepCar, trackSense } from '../src/core/physics-engine';
import {
  derivePathGeometry,
  detectSemanticCorners,
  legacyRacingLine,
  previewIdealLine,
  refineSemanticCorners,
  speedProfile
} from '../src/core/racing-line';
import { buildTrack } from '../src/core/track';
import { TRACK_DEFS } from '../src/data/tracks';

interface Marker {
  corner: LegacyCorner;
  index: number;
  target: number;
  bestDistance: number;
  error: number;
}

function simulate(track: Track, path: SampledPath, markers: Marker[], lapTime: number): {
  maximum: number;
  isolated: number;
  grass: number;
} {
  const geometry = derivePathGeometry(track, path);
  const car = makeCar(
    geometry.x[0]!,
    geometry.y[0]!,
    Math.atan2(geometry.ty[0]!, geometry.tx[0]!)
  );
  car.vx = 12;
  car.progIdx = 0;
  let previousS = 0;
  let unwrapped = 0;
  let grass = 0;
  const profile = speedProfile(track);
  for (let step = 0; step < Math.ceil(lapTime * 2.8 * 120); step++) {
    const surface = trackSense(track, car);
    if (step > 0) {
      let delta = car.s - previousS;
      if (delta < -track.len / 2) delta += track.len;
      else if (delta > track.len / 2) delta -= track.len;
      if (delta > -2) unwrapped += Math.max(0, delta);
    }
    previousS = car.s;
    if (unwrapped >= track.len * 0.95 && unwrapped <= track.len * 2.05) {
      for (const marker of markers) {
        const markerS = track.len + marker.index * track.step;
        const distance = Math.abs(unwrapped - markerS);
        if (distance < marker.bestDistance) {
          marker.bestDistance = distance;
          marker.error = Math.abs((surface.lat ?? 0) - marker.target);
        }
      }
    }
    const input = botStep(track, profile, car, { margin: 0.95, muScale: 1, path });
    stepCar(car, input, surface, 1 / 120, { pw: 1, mu: 1, dr: 1 });
    if (surface.zone === 'grass') grass++;
  }
  return {
    maximum: Math.max(...markers.map(marker => marker.error)),
    isolated: Math.max(0, ...markers.filter(marker => marker.corner.isolated)
      .map(marker => marker.error)),
    grass
  };
}

const spans = [35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 110, 130, 160] as const;
for (const definition of TRACK_DEFS) {
  const rows = [];
  for (const span of spans) {
    const track = buildTrack(definition, 6);
    const center = speedProfile(track);
    detectSemanticCorners(track, center);
    refineSemanticCorners(track, legacyRacingLine(track));
    const preview = previewIdealLine(track, span);
    const planned = new Map(preview.phaseMarkers.map(marker => [marker.cornerId, marker]));
    const markers: Marker[] = [];
    for (const corner of track.corners ?? []) {
      const plan = planned.get(corner.id);
      for (const index of plan
        ? [plan.turnInI, plan.apexI, plan.trackOutI]
        : [corner.turnInI, corner.apexI, corner.trackOutI]) {
        markers.push({
          corner,
          index,
          target: preview.path.off[index]!,
          bestDistance: Infinity,
          error: Infinity
        });
      }
    }
    const result = simulate(track, preview.path, markers, preview.timing.lapTime);
    rows.push({
      span,
      lap: preview.timing.lapTime.toFixed(3),
      maximum: result.maximum.toFixed(3),
      isolated: result.isolated.toFixed(3),
      grass: result.grass
    });
  }
  console.log(definition.id, rows);
}
