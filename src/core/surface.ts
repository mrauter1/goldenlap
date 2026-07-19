import { PHYS, SURF } from './physics';
import type {
  SampledPath, SurfaceExposure, Track, TrackSurfaceMap
} from './model';
import { numericArray } from './model';

export const SURFACE_MAP_VERSION = 'authored-curb-map-v1';
export const CURB_INSET_METRES = 0.25;
export const CURB_OUTSET_METRES = 1.15;
export const NORMAL_SURFACE_MARGIN = PHYS.carWid / 2 + 0.6;

type SurfaceTrack = Pick<Track, 'n' | 'hw' | 'halfWidth' | 'kSm'>;

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Build the one curb authority consumed by rendering, physics and planning. */
export function buildTrackSurfaceMap(track: SurfaceTrack): TrackSurfaceMap {
  const curbNegative = new Uint8Array(track.n);
  const curbPositive = new Uint8Array(track.n);
  for (let index = 0; index < track.n; index++) {
    const radius = 1 / Math.max(Math.abs(track.kSm[index]!), 1e-9);
    if (radius >= 130) continue;
    const inside: -1 | 1 = track.kSm[index]! > 0 ? 1 : -1;
    (inside > 0 ? curbPositive : curbNegative)[index] = 1;
    if (radius < 75)
      (inside > 0 ? curbNegative : curbPositive)[index] = 1;
  }
  const mask = `${Array.from(curbNegative).join('')}:${Array.from(curbPositive).join('')}`;
  const roadHalfWidthAt = numericArray(track.n);
  const curbInnerAt = numericArray(track.n);
  const curbOuterAt = numericArray(track.n);
  const normalMinimum = numericArray(track.n);
  const normalMaximum = numericArray(track.n);
  let variableWidth = false;
  for (let index = 0; index < track.n; index++) {
    const halfWidth = track.halfWidth[index]!;
    roadHalfWidthAt[index] = halfWidth;
    curbInnerAt[index] = halfWidth - CURB_INSET_METRES;
    curbOuterAt[index] = halfWidth + CURB_OUTSET_METRES;
    if (Math.abs(halfWidth - track.hw) > 1e-12) variableWidth = true;
    const negativeEdge = curbNegative[index] === 1
      ? curbOuterAt[index]!
      : halfWidth;
    const positiveEdge = curbPositive[index] === 1
      ? curbOuterAt[index]!
      : halfWidth;
    normalMinimum[index] = -Math.max(0, negativeEdge - NORMAL_SURFACE_MARGIN);
    normalMaximum[index] = Math.max(0, positiveEdge - NORMAL_SURFACE_MARGIN);
  }
  return {
    schemaVersion: 1,
    roadHalfWidth: track.hw,
    curbInner: track.hw - CURB_INSET_METRES,
    curbOuter: track.hw + CURB_OUTSET_METRES,
    roadHalfWidthAt,
    curbInnerAt,
    curbOuterAt,
    curbNegative,
    curbPositive,
    normalMinimum,
    normalMaximum,
    fingerprint: fnv1a([
      SURFACE_MAP_VERSION,
      track.n,
      track.hw,
      CURB_INSET_METRES,
      CURB_OUTSET_METRES,
      SURF.road.mu,
      SURF.curb.mu,
      SURF.grass.mu,
      SURF.road.drag,
      SURF.curb.drag,
      SURF.grass.drag,
      mask,
      ...(variableWidth ? [Array.from(track.halfWidth).join(',')] : [])
    ].join('|'))
  };
}

export function authoredCurbAt(
  track: Pick<Track, 'n' | 'surface'>,
  index: number,
  side: -1 | 1
): boolean {
  const sample = ((Math.round(index) % track.n) + track.n) % track.n;
  return (side > 0
    ? track.surface.curbPositive[sample]
    : track.surface.curbNegative[sample]) === 1;
}

export function surfaceZoneAtLateral(
  track: Pick<Track, 'n' | 'surface'>,
  index: number,
  lateral: number
): 'road' | 'curb' | 'grass' {
  const sample = ((Math.round(index) % track.n) + track.n) % track.n;
  const side: -1 | 1 = lateral >= 0 ? 1 : -1;
  const absolute = Math.abs(lateral);
  if (authoredCurbAt(track, index, side)) {
    if (absolute < track.surface.curbInnerAt[sample]!) return 'road';
    if (absolute <= track.surface.curbOuterAt[sample]!) return 'curb';
    return 'grass';
  }
  return absolute <= track.surface.roadHalfWidthAt[sample]! ? 'road' : 'grass';
}

export function normalLateralEnvelope(
  track: Pick<Track, 'n' | 'surface'>,
  index: number,
  margin = NORMAL_SURFACE_MARGIN
): { minimum: number; maximum: number } {
  const sample = ((Math.round(index) % track.n) + track.n) % track.n;
  if (margin === NORMAL_SURFACE_MARGIN) return {
    minimum: track.surface.normalMinimum[sample]!,
    maximum: track.surface.normalMaximum[sample]!
  };
  const negativeEdge = authoredCurbAt(track, index, -1)
    ? track.surface.curbOuterAt[sample]!
    : track.surface.roadHalfWidthAt[sample]!;
  const positiveEdge = authoredCurbAt(track, index, 1)
    ? track.surface.curbOuterAt[sample]!
    : track.surface.roadHalfWidthAt[sample]!;
  return {
    minimum: -Math.max(0, negativeEdge - margin),
    maximum: Math.max(0, positiveEdge - margin)
  };
}

/** The shared road-only reference used for line-shape semantics, not legality. */
export function roadLateralEnvelope(
  track: Pick<Track, 'surface'>,
  margin = NORMAL_SURFACE_MARGIN
): { minimum: number; maximum: number } {
  const extent = Math.max(0, track.surface.roadHalfWidth - margin);
  return { minimum: -extent, maximum: extent };
}

/** Road-only envelope at one local-width sample. */
export function roadLateralEnvelopeAt(
  track: Pick<Track, 'n' | 'surface'>,
  index: number,
  margin = NORMAL_SURFACE_MARGIN
): { minimum: number; maximum: number } {
  const sample = ((Math.round(index) % track.n) + track.n) % track.n;
  const extent = Math.max(0, track.surface.roadHalfWidthAt[sample]! - margin);
  return { minimum: -extent, maximum: extent };
}

export function normalLateralIsLegal(
  track: Pick<Track, 'n' | 'surface'>,
  index: number,
  lateral: number,
  margin = NORMAL_SURFACE_MARGIN
): boolean {
  if (margin === NORMAL_SURFACE_MARGIN) {
    const sample = ((Math.round(index) % track.n) + track.n) % track.n;
    return lateral >= track.surface.normalMinimum[sample]! - 1e-9 &&
      lateral <= track.surface.normalMaximum[sample]! + 1e-9;
  }
  const envelope = normalLateralEnvelope(track, index, margin);
  return lateral >= envelope.minimum - 1e-9 && lateral <= envelope.maximum + 1e-9;
}

export function emergencyLateralEnvelope(
  _track: Pick<Track, 'n' | 'surface'>,
  _index: number
): { minimum: number; maximum: number } {
  // Grass/runoff is response space, not a grip-reach tube. No continuous
  // barrier envelope is authored in the current track model.
  return {
    minimum: -Infinity,
    maximum: Infinity
  };
}

export function emergencyLateralIsLegal(
  _track: Pick<Track, 'n' | 'surface'>,
  _index: number,
  lateral: number
): boolean {
  return Number.isFinite(lateral);
}

function intervalOverlap(
  minimum: number,
  maximum: number,
  from: number,
  to: number
): number {
  return Math.max(0, Math.min(maximum, to) - Math.max(minimum, from));
}

export interface SurfaceExposureScratch {
  road: number;
  curb: number;
  grass: number;
  mu: number;
  drag: number;
}

/** Allocation-free surface blend for hot local-trajectory evaluation. */
export function writeSurfaceExposureAtLateral(
  track: Pick<Track, 'n' | 'surface'>,
  index: number,
  lateral: number,
  output: SurfaceExposureScratch,
  footprintHalfWidth = PHYS.carWid / 2
): void {
  const sample = ((Math.round(index) % track.n) + track.n) % track.n;
  const minimum = lateral - Math.max(0, footprintHalfWidth);
  const maximum = lateral + Math.max(0, footprintHalfWidth);
  const width = Math.max(1e-9, maximum - minimum);
  const negativeCurb = track.surface.curbNegative[sample] === 1;
  const positiveCurb = track.surface.curbPositive[sample] === 1;
  const roadMinimum = -(negativeCurb
    ? track.surface.curbInnerAt[sample]!
    : track.surface.roadHalfWidthAt[sample]!);
  const roadMaximum = positiveCurb
    ? track.surface.curbInnerAt[sample]!
    : track.surface.roadHalfWidthAt[sample]!;
  const roadLength = intervalOverlap(minimum, maximum, roadMinimum, roadMaximum);
  const curbLength = (negativeCurb
    ? intervalOverlap(
        minimum, maximum,
        -track.surface.curbOuterAt[sample]!, -track.surface.curbInnerAt[sample]!
      )
    : 0) + (positiveCurb
      ? intervalOverlap(
          minimum, maximum,
          track.surface.curbInnerAt[sample]!, track.surface.curbOuterAt[sample]!
        )
      : 0);
  output.road = Math.min(1, roadLength / width);
  output.curb = Math.min(1 - output.road, curbLength / width);
  output.grass = Math.max(0, 1 - output.road - output.curb);
  output.mu = output.road * SURF.road.mu + output.curb * SURF.curb.mu +
    output.grass * SURF.grass.mu;
  output.drag = output.road * SURF.road.drag + output.curb * SURF.curb.drag +
    output.grass * SURF.grass.drag;
}

/**
 * Analytic lateral-footprint blending. Because each surface is a one-
 * dimensional interval at a track sample, splitting at the authored edges is
 * both continuous and cheaper than per-wheel contact simulation.
 */
export function surfaceExposureAtLateral(
  track: Pick<Track, 'n' | 'surface'>,
  index: number,
  lateral: number,
  footprintHalfWidth = PHYS.carWid / 2
): SurfaceExposure {
  const scratch: SurfaceExposureScratch = {
    road: 0,
    curb: 0,
    grass: 0,
    mu: 0,
    drag: 0
  };
  writeSurfaceExposureAtLateral(track, index, lateral, scratch, footprintHalfWidth);
  return {
    ...scratch,
    zone: scratch.grass > 1e-6 ? 'grass' : scratch.curb > 1e-6 ? 'curb' : 'road'
  };
}

export interface PathSurfaceExposure {
  roadMetres: number;
  curbMetres: number;
  grassMetres: number;
  maximumGrassFraction: number;
  maximumCurbFraction: number;
}

export function pathSurfaceExposure(
  track: Pick<Track, 'n' | 'surface' | 'step'>,
  path: Pick<SampledPath, 'off' | 'ds'>
): PathSurfaceExposure {
  let roadMetres = 0;
  let curbMetres = 0;
  let grassMetres = 0;
  let maximumGrassFraction = 0;
  let maximumCurbFraction = 0;
  for (let index = 0; index < track.n; index++) {
    const exposure = surfaceExposureAtLateral(track, index, path.off[index]!);
    const distance = path.ds[index] ?? track.step;
    roadMetres += exposure.road * distance;
    curbMetres += exposure.curb * distance;
    grassMetres += exposure.grass * distance;
    maximumGrassFraction = Math.max(maximumGrassFraction, exposure.grass);
    maximumCurbFraction = Math.max(maximumCurbFraction, exposure.curb);
  }
  return {
    roadMetres,
    curbMetres,
    grassMetres,
    maximumGrassFraction,
    maximumCurbFraction
  };
}
