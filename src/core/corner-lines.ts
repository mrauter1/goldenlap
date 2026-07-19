import {
  brakingStartForCorner,
  materializePath,
  speedProfile
} from './racing-line';
import { normalLateralEnvelope, normalLateralIsLegal } from './surface';
import {
  numericArray,
  type Corner,
  type CornerAlternateLineProfile,
  type CornerLineFamilyProfile,
  type CornerLinePairProfile,
  type SampledPath,
  type SpeedProfile,
  type Track
} from './model';
import { clamp, lerp } from '../shared/math';

export const CORNER_LINE_LIBRARY_VERSION = 'apex-grid-sustained-offset-v2';

export interface CornerLineEvaluation {
  path: SampledPath;
  timing: SpeedProfile;
  brakeI: number;
  apexSpeed: number;
  cornerTimeSeconds: number;
  lapTimeLossSeconds: number;
}

export interface CornerLineEtaSample {
  eta: number;
  /** dη/ds, where s is track distance in metres. */
  firstDerivative: number;
  /** d²η/ds², where s is track distance in metres. */
  secondDerivative: number;
}

interface NaturalCubicSegment {
  startMetres: number;
  spanMetres: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

interface CornerLineSpline {
  originIndex: number;
  endMetres: number;
  segments: readonly NaturalCubicSegment[];
}

const cornerLineSplineCache = new WeakMap<
  Track,
  WeakMap<Corner, WeakMap<CornerAlternateLineProfile, CornerLineSpline>>
>();
const validatedCornerLineContexts = new WeakMap<
  CornerAlternateLineProfile,
  { track: Track; corner: Corner }
>();

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function cyclicSamplePosition(track: Track, index: number): number {
  return ((index % track.n) + track.n) % track.n;
}

function distanceAheadSamples(track: Track, from: number, to: number): number {
  return (cyclicIndex(track, to) - cyclicIndex(track, from) + track.n) % track.n;
}

function distanceAheadMetres(track: Track, from: number, to: number): number {
  return (
    cyclicSamplePosition(track, to) - cyclicIndex(track, from) + track.n
  ) % track.n * track.step;
}

function smootherstep(value: number): number {
  const u = Math.max(0, Math.min(1, value));
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function compositeExitSpan(
  track: Track,
  corner: Corner,
  terminalEta: number
): number {
  const authoredSpan = distanceAheadSamples(
    track,
    corner.approachI,
    corner.turnInI
  );
  for (let span = authoredSpan; span >= 1; span--) {
    let legal = true;
    for (let delta = 1; delta <= span; delta++) {
      const index = (corner.exitI + delta) % track.n;
      const eta = lerp(terminalEta, 0, smootherstep(delta / span));
      if (!normalLateralIsLegal(
        track,
        index,
        track.idealPath!.off[index]! + eta
      )) {
        legal = false;
        break;
      }
    }
    if (legal) return span;
  }
  return 0;
}

function compositeEntranceSpan(
  track: Track,
  corner: Corner,
  terminalEta: number
): number {
  const authoredSpan = distanceAheadSamples(
    track,
    corner.approachI,
    corner.turnInI
  );
  for (let span = authoredSpan; span >= 1; span--) {
    let legal = true;
    for (let delta = 1; delta <= span; delta++) {
      const index = (corner.approachI - delta + track.n) % track.n;
      const eta = lerp(
        0,
        terminalEta,
        smootherstep((span - delta) / span)
      );
      if (!normalLateralIsLegal(
        track,
        index,
        track.idealPath!.off[index]! + eta
      )) {
        legal = false;
        break;
      }
    }
    if (legal) return span;
  }
  return 0;
}

function cornerTime(
  track: Track,
  timing: Pick<SpeedProfile, 't' | 'lapTime'>,
  from: number,
  to: number
): number {
  const start = cyclicIndex(track, from);
  const end = cyclicIndex(track, to);
  return end >= start
    ? timing.t[end]! - timing.t[start]!
    : timing.lapTime - timing.t[start]! + timing.t[end]!;
}

function assertLineShape(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile,
  expectedKind: 'inside' | 'outside'
): void {
  const cached = validatedCornerLineContexts.get(line);
  if (cached?.track === track && cached.corner === corner &&
      line.kind === expectedKind) return;
  if (line.kind !== expectedKind)
    throw new Error(`${corner.id} ${expectedKind} line has kind ${line.kind}`);
  if (line.terminal !== 'ideal-rejoin' &&
      line.terminal !== 'sustained-offset')
    throw new Error(`${corner.id} ${expectedKind} line has no terminal authority`);
  if (line.terminal === 'ideal-rejoin' &&
      (line.points.length < 5 || line.points.length > 8))
    throw new Error(`${corner.id} ${expectedKind} rejoin line needs 5-8 control points`);
  if (line.terminal === 'sustained-offset' && line.points.length !== 4)
    throw new Error(
      `${corner.id} ${expectedKind} sustained line needs approach/turn-in/apex/exit points`
    );
  const first = line.points[0]!;
  const last = line.points[line.points.length - 1]!;
  if (cyclicIndex(track, first.index) !== corner.approachI ||
      cyclicIndex(track, last.index) !== corner.exitI)
    throw new Error(`${corner.id} ${expectedKind} line has the wrong corner span`);
  if (line.terminal === 'ideal-rejoin' && (first.eta !== 0 || last.eta !== 0))
    throw new Error(`${corner.id} ${expectedKind} line must join the ideal line at both ends`);
  if (line.terminal === 'sustained-offset') {
    if (cyclicIndex(track, line.points[1]!.index) !== corner.turnInI ||
        cyclicIndex(track, line.points[2]!.index) !== corner.apexI)
      throw new Error(
        `${corner.id} ${expectedKind} sustained line has the wrong apex grid`
      );
    if (first.eta !== line.points[1]!.eta || first.eta !== last.eta)
      throw new Error(
        `${corner.id} ${expectedKind} sustained line must hold its terminal offset`
      );
  }
  const span = distanceAheadSamples(track, corner.approachI, corner.exitI);
  let previousDistance = -1;
  for (const point of line.points) {
    if (!Number.isInteger(point.index) || !Number.isFinite(point.eta))
      throw new Error(`${corner.id} ${expectedKind} line has a non-finite control point`);
    const index = cyclicIndex(track, point.index);
    const distance = distanceAheadSamples(track, corner.approachI, index);
    if (distance <= previousDistance || distance > span)
      throw new Error(`${corner.id} ${expectedKind} line points are not forward-sorted`);
    const lateral = track.idealPath!.off[index]! + point.eta;
    if (!normalLateralIsLegal(track, index, lateral))
      throw new Error(`${corner.id} ${expectedKind} line control point leaves the surface`);
    previousDistance = distance;
  }
  if (!Number.isInteger(line.brakeI) || line.brakeI < 0 || line.brakeI >= track.n ||
      !Number.isFinite(line.apexSpeed) || line.apexSpeed < 0 ||
      !Number.isFinite(line.cornerTimeSeconds) || line.cornerTimeSeconds <= 0 ||
      !Number.isFinite(line.lapTimeLossSeconds))
    throw new Error(`${corner.id} ${expectedKind} line has invalid timing metadata`);
  validatedCornerLineContexts.set(line, { track, corner });
}

function sampleQuinticTransition(
  from: number,
  to: number,
  spanMetres: number,
  metres: number
): CornerLineEtaSample {
  const u = clamp(metres / Math.max(Number.EPSILON, spanMetres), 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const smoother = u3 * (u * (u * 6 - 15) + 10);
  const first = 30 * u2 * (u - 1) * (u - 1) /
    Math.max(Number.EPSILON, spanMetres);
  const second = 60 * u * (2 * u2 - 3 * u + 1) /
    Math.max(Number.EPSILON, spanMetres * spanMetres);
  const delta = to - from;
  return {
    eta: from + delta * smoother,
    firstDerivative: delta * first,
    secondDerivative: delta * second
  };
}

/**
 * The sustained member is a compact composite apex arc: hold the authored
 * corridor offset to turn-in, transition to the apex parameter, then return
 * to the same offset at exit. Each join has zero first and second derivative,
 * so acquisition and the post-exit hold remain G2 without resampling.
 */
function sampleSustainedCornerLine(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile,
  sampleIndex: number
): CornerLineEtaSample {
  if (!Number.isFinite(sampleIndex))
    throw new Error('Corner-line sample index must be finite');
  assertLineShape(track, corner, line, line.kind);
  const approach = line.points[0]!;
  const turnIn = line.points[1]!;
  const apex = line.points[2]!;
  const exit = line.points[3]!;
  const sampleMetres = distanceAheadMetres(track, corner.approachI, sampleIndex);
  const turnInMetres =
    distanceAheadSamples(track, corner.approachI, turnIn.index) * track.step;
  const apexMetres =
    distanceAheadSamples(track, corner.approachI, apex.index) * track.step;
  const exitMetres =
    distanceAheadSamples(track, corner.approachI, exit.index) * track.step;
  if (sampleMetres <= turnInMetres)
    return { eta: approach.eta, firstDerivative: 0, secondDerivative: 0 };
  if (sampleMetres <= apexMetres)
    return sampleQuinticTransition(
      turnIn.eta,
      apex.eta,
      apexMetres - turnInMetres,
      sampleMetres - turnInMetres
    );
  if (sampleMetres <= exitMetres)
    return sampleQuinticTransition(
      apex.eta,
      exit.eta,
      exitMetres - apexMetres,
      sampleMetres - apexMetres
    );
  return { eta: exit.eta, firstDerivative: 0, secondDerivative: 0 };
}

function buildNaturalCubicSpline(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile
): CornerLineSpline {
  const count = line.points.length;
  const positions = numericArray(count);
  const values = numericArray(count);
  for (let index = 0; index < count; index++) {
    const point = line.points[index]!;
    positions[index] =
      distanceAheadSamples(track, corner.approachI, point.index) * track.step;
    values[index] = point.eta;
  }

  const lower = numericArray(count);
  const diagonal = numericArray(count);
  const upper = numericArray(count);
  const rightHandSide = numericArray(count);
  diagonal[0] = 1;
  diagonal[count - 1] = 1;
  for (let index = 1; index < count - 1; index++) {
    const previousSpan = positions[index]! - positions[index - 1]!;
    const nextSpan = positions[index + 1]! - positions[index]!;
    lower[index] = previousSpan;
    diagonal[index] = 2 * (previousSpan + nextSpan);
    upper[index] = nextSpan;
    rightHandSide[index] = 6 * (
      (values[index + 1]! - values[index]!) / nextSpan -
      (values[index]! - values[index - 1]!) / previousSpan
    );
  }

  for (let index = 1; index < count; index++) {
    const scale = lower[index]! / diagonal[index - 1]!;
    diagonal[index] = diagonal[index]! - scale * upper[index - 1]!;
    rightHandSide[index] =
      rightHandSide[index]! - scale * rightHandSide[index - 1]!;
  }
  const secondDerivatives = numericArray(count);
  secondDerivatives[count - 1] =
    rightHandSide[count - 1]! / diagonal[count - 1]!;
  for (let index = count - 2; index >= 0; index--) {
    secondDerivatives[index] = (
      rightHandSide[index]! -
      upper[index]! * secondDerivatives[index + 1]!
    ) / diagonal[index]!;
  }

  const segments: NaturalCubicSegment[] = [];
  for (let index = 0; index < count - 1; index++) {
    const spanMetres = positions[index + 1]! - positions[index]!;
    const fromSecondDerivative = secondDerivatives[index]!;
    const toSecondDerivative = secondDerivatives[index + 1]!;
    segments.push({
      startMetres: positions[index]!,
      spanMetres,
      a: values[index]!,
      b: (values[index + 1]! - values[index]!) / spanMetres -
        spanMetres * (2 * fromSecondDerivative + toSecondDerivative) / 6,
      c: fromSecondDerivative / 2,
      d: (toSecondDerivative - fromSecondDerivative) / (6 * spanMetres)
    });
  }
  return {
    originIndex: corner.approachI,
    endMetres: positions[count - 1]!,
    segments
  };
}

function cornerLineSpline(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile
): CornerLineSpline {
  let byCorner = cornerLineSplineCache.get(track);
  if (!byCorner) {
    byCorner = new WeakMap();
    cornerLineSplineCache.set(track, byCorner);
  }
  let byLine = byCorner.get(corner);
  if (!byLine) {
    byLine = new WeakMap();
    byCorner.set(corner, byLine);
  }
  const cached = byLine.get(line);
  if (cached) return cached;
  assertLineShape(track, corner, line, line.kind);
  const spline = buildNaturalCubicSpline(track, corner, line);
  byLine.set(line, spline);
  return spline;
}

function sampleNaturalCubicSpline(
  track: Track,
  spline: CornerLineSpline,
  sampleIndex: number
): CornerLineEtaSample {
  if (!Number.isFinite(sampleIndex))
    throw new Error('Corner-line sample index must be finite');
  const sampleMetres = distanceAheadMetres(track, spline.originIndex, sampleIndex);
  if (sampleMetres > spline.endMetres)
    return { eta: 0, firstDerivative: 0, secondDerivative: 0 };
  let segment = spline.segments[spline.segments.length - 1]!;
  for (const candidate of spline.segments) {
    if (sampleMetres <= candidate.startMetres + candidate.spanMetres) {
      segment = candidate;
      break;
    }
  }
  const localMetres = clamp(
    sampleMetres - segment.startMetres,
    0,
    segment.spanMetres
  );
  return {
    eta: segment.a + localMetres * (
      segment.b + localMetres * (segment.c + localMetres * segment.d)
    ),
    firstDerivative:
      segment.b + localMetres * (2 * segment.c + 3 * localMetres * segment.d),
    secondDerivative: 2 * segment.c + 6 * localMetres * segment.d
  };
}

function sampleCornerLineEtaUnchecked(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile,
  sampleIndex: number
): number {
  const sampleDistance = distanceAheadSamples(track, corner.approachI, sampleIndex);
  const cornerSpan = distanceAheadSamples(track, corner.approachI, corner.exitI);
  if (sampleDistance > cornerSpan) return 0;
  for (let pointIndex = 0; pointIndex < line.points.length - 1; pointIndex++) {
    const from = line.points[pointIndex]!;
    const to = line.points[pointIndex + 1]!;
    const fromDistance = distanceAheadSamples(track, corner.approachI, from.index);
    const toDistance = distanceAheadSamples(track, corner.approachI, to.index);
    if (sampleDistance < fromDistance || sampleDistance > toDistance) continue;
    return lerp(
      from.eta,
      to.eta,
      smootherstep((sampleDistance - fromDistance) / Math.max(1, toDistance - fromDistance))
    );
  }
  return line.points[line.points.length - 1]?.eta ?? 0;
}

/** Analytically sample the natural C2 spline derived from a cached corner line. */
export function sampleCornerLineEtaAnalytic(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile,
  sampleIndex: number
): CornerLineEtaSample {
  if (line.terminal === 'sustained-offset')
    return sampleSustainedCornerLine(track, corner, line, sampleIndex);
  return sampleNaturalCubicSpline(
    track,
    cornerLineSpline(track, corner, line),
    sampleIndex
  );
}

/** Evaluate one cached corner-line eta from its analytic spline. */
export function sampleCornerLineEta(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile,
  sampleIndex: number
): number {
  return sampleCornerLineEtaAnalytic(track, corner, line, sampleIndex).eta;
}

/** Materialize one offline validation path from compact eta control points. */
export function materializeCornerLine(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile
): SampledPath {
  if (!track.idealPath) throw new Error(`Track ${track.def.id} has no ideal path`);
  assertLineShape(track, corner, line, line.kind);
  const off = numericArray(track.n);
  off.set(track.idealPath.off);
  const cornerSpan = distanceAheadSamples(
    track,
    corner.approachI,
    corner.exitI
  );
  for (let delta = 0; delta <= cornerSpan; delta++) {
    const index = (corner.approachI + delta) % track.n;
    const lateral = track.idealPath.off[index]! +
      (line.terminal === 'sustained-offset'
        ? sampleCornerLineEta(track, corner, line, index)
        : sampleCornerLineEtaUnchecked(track, corner, line, index));
    if (line.terminal === 'sustained-offset') {
      off[index] = lateral;
    } else {
      const envelope = normalLateralEnvelope(track, index);
      off[index] = clamp(lateral, envelope.minimum, envelope.maximum);
    }
  }
  if (line.terminal === 'sustained-offset') {
    // The runtime member holds its offset while an agreement is live. Offline
    // whole-lap/controller validation closes that member with a G2 transition
    // whose length mirrors the authored approach-to-turn-in acquisition.
    const terminalEta = line.points.at(-1)!.eta;
    const entranceSpan = compositeEntranceSpan(track, corner, terminalEta);
    if (entranceSpan === 0)
      throw new Error(`${corner.id} ${line.kind} sustained line has no legal acquisition`);
    for (let delta = 1; delta <= entranceSpan; delta++) {
      const index = (corner.approachI - delta + track.n) % track.n;
      off[index] = track.idealPath.off[index]! + lerp(
        0,
        terminalEta,
        smootherstep((entranceSpan - delta) / entranceSpan)
      );
    }
    const rejoinSpan = compositeExitSpan(track, corner, terminalEta);
    if (rejoinSpan === 0)
      throw new Error(`${corner.id} ${line.kind} sustained line has no legal composite exit`);
    for (let delta = 1; delta <= rejoinSpan; delta++) {
      const index = (corner.exitI + delta) % track.n;
      off[index] = track.idealPath.off[index]! + lerp(
        terminalEta,
        0,
        smootherstep(delta / rejoinSpan)
      );
    }
  }
  const path = materializePath(track, off, 'ideal');
  for (let index = 0; index < track.n; index++) {
    if (!Number.isFinite(path.off[index]!) || !Number.isFinite(path.k[index]!) ||
        !Number.isFinite(path.ds[index]!) || !Number.isFinite(path.v[index]!) ||
        !normalLateralIsLegal(track, index, path.off[index]!))
      throw new Error(`${corner.id} ${line.kind} line is invalid at sample ${index}`);
  }
  return path;
}

export function evaluateCornerLine(
  track: Track,
  corner: Corner,
  line: CornerAlternateLineProfile
): CornerLineEvaluation {
  if (!track.idealTiming) throw new Error(`Track ${track.def.id} has no ideal timing`);
  const path = materializeCornerLine(track, corner, line);
  const timing = speedProfile(track, path);
  path.v = timing.v;
  return {
    path,
    timing,
    brakeI: brakingStartForCorner(track, timing.v, corner.apexI),
    apexSpeed: timing.v[corner.apexI]!,
    cornerTimeSeconds: cornerTime(track, timing, corner.approachI, corner.exitI),
    lapTimeLossSeconds: timing.lapTime - track.idealTiming.lapTime
  };
}

/** Validate the cached profile authority, then attach it to semantic corners. */
export function installCornerLineLibrary(
  track: Track,
  library: readonly CornerLinePairProfile[]
): void {
  if (!track.idealPath || !track.idealTiming)
    throw new Error(`Track ${track.def.id} needs its ideal line before corner lines`);
  const corners = track.corners ?? [];
  if (library.length !== corners.length)
    throw new Error(
      `Corner-line coverage mismatch on ${track.def.id}: ${library.length}/${corners.length}`
    );
  const byId = new Map<string, CornerLinePairProfile>();
  for (const pair of library) {
    if (byId.has(pair.cornerId))
      throw new Error(`Duplicate corner-line pair ${pair.cornerId}`);
    byId.set(pair.cornerId, pair);
  }
  for (const corner of corners) {
    const pair = byId.get(corner.id);
    if (!pair) throw new Error(`Missing corner-line pair ${corner.id}`);
    for (const [kind, family] of [
      ['inside', pair.inside],
      ['outside', pair.outside]
    ] as const satisfies readonly [
      'inside' | 'outside',
      CornerLineFamilyProfile
    ][]) {
      assertLineShape(track, corner, family.idealRejoin, kind);
      if (family.idealRejoin.terminal !== 'ideal-rejoin')
        throw new Error(`${corner.id} ${kind} ideal-rejoin member has wrong terminal`);
      assertLineShape(track, corner, family.sustainedOffset, kind);
      if (family.sustainedOffset.terminal !== 'sustained-offset')
        throw new Error(`${corner.id} ${kind} sustained member has wrong terminal`);
    }
    corner.alternateLines = pair;
  }
  for (const cornerId of byId.keys()) {
    if (!corners.some(corner => corner.id === cornerId))
      throw new Error(`Corner-line pair ${cornerId} has no semantic corner`);
  }
}
