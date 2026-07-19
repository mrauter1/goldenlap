import {
  CORNER_LINE_LIBRARY_VERSION,
  evaluateCornerLine,
  sampleCornerLineEtaAnalytic
} from '../../src/core/corner-lines';
import { PHYS } from '../../src/core/physics';
import { normalLateralEnvelope } from '../../src/core/surface';
import type {
  BuiltTrack,
  Corner,
  CornerAlternateLineProfile,
  CornerLineFamilyProfile,
  CornerLineKind,
  CornerLinePairProfile,
  Track
} from '../../src/core/model';
import { runSingleCar } from './headless-sim';
import { PROFILE_MARKER_ERROR_ABSOLUTE_METRES } from './profile-evaluate';

interface VariablePoint {
  index: number;
  minimum: number;
  maximum: number;
  value: number;
  step: number;
}

export interface CornerLineSearchResult {
  library: CornerLinePairProfile[];
  evaluations: number;
  optimizerVersion: typeof CORNER_LINE_LIBRARY_VERSION;
}

export interface CornerLineControllerSelection {
  library: CornerLinePairProfile[];
  controllerValidations: number;
  backedOffLines: number;
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function distanceAheadSamples(track: Track, from: number, to: number): number {
  return (cyclicIndex(track, to) - cyclicIndex(track, from) + track.n) % track.n;
}

function interiorIndices(track: Track, corner: Corner): number[] {
  const span = distanceAheadSamples(track, corner.approachI, corner.exitI);
  const indices = new Set([
    corner.brakeI,
    corner.turnInI,
    corner.apexI,
    corner.trackOutI
  ].map(index => cyclicIndex(track, index)).filter(index =>
    index !== corner.approachI && index !== corner.exitI
  ));
  // Degenerate semantic markers still receive four independent control
  // sites. Their locations come from equal divisions of the actual span.
  for (let division = 1; indices.size < 4; division++) {
    const index = (corner.approachI + Math.round(span * division / 5)) % track.n;
    if (index !== corner.approachI && index !== corner.exitI) indices.add(index);
  }
  return [...indices]
    .filter(index => index !== corner.approachI && index !== corner.exitI)
    .sort((left, right) =>
      distanceAheadSamples(track, corner.approachI, left) -
      distanceAheadSamples(track, corner.approachI, right)
    )
    .slice(0, 4);
}

function signedRange(
  track: Track,
  corner: Corner,
  index: number,
  kind: CornerLineKind,
  afterApex: boolean
): { minimum: number; maximum: number } {
  const envelope = normalLateralEnvelope(track, index);
  const signedMinimum = Math.min(
    corner.side * envelope.minimum,
    corner.side * envelope.maximum
  );
  const signedMaximum = Math.max(
    corner.side * envelope.minimum,
    corner.side * envelope.maximum
  );
  const split = (signedMinimum + signedMaximum) / 2;
  const insideMinimum = Math.min(signedMaximum, split + PHYS.carWid / 2);
  const outsideMaximum = Math.max(signedMinimum, split - PHYS.carWid / 2);
  const signed = kind === 'inside' || afterApex
    ? { minimum: insideMinimum, maximum: signedMaximum }
    : { minimum: signedMinimum, maximum: outsideMaximum };
  const first = corner.side * signed.minimum;
  const second = corner.side * signed.maximum;
  return { minimum: Math.min(first, second), maximum: Math.max(first, second) };
}

function initialVariables(
  track: Track,
  corner: Corner,
  kind: CornerLineKind
): VariablePoint[] {
  const apexDistance = distanceAheadSamples(track, corner.approachI, corner.apexI);
  return interiorIndices(track, corner).map(index => {
    const afterApex = kind === 'outside' &&
      distanceAheadSamples(track, corner.approachI, index) > apexDistance;
    const range = signedRange(track, corner, index, kind, afterApex);
    return {
      index,
      minimum: range.minimum,
      maximum: range.maximum,
      value: (range.minimum + range.maximum) / 2,
      step: (range.maximum - range.minimum) / 2
    };
  });
}

function candidateLine(
  track: Track,
  corner: Corner,
  kind: CornerLineKind,
  variables: readonly VariablePoint[]
): CornerAlternateLineProfile {
  const points = [
    { index: corner.approachI, eta: 0 },
    ...variables.map(variable => ({
      index: variable.index,
      eta: variable.value - track.idealPath!.off[variable.index]!
    })),
    { index: corner.exitI, eta: 0 }
  ].sort((left, right) =>
    distanceAheadSamples(track, corner.approachI, left.index) -
    distanceAheadSamples(track, corner.approachI, right.index)
  );
  return {
    kind,
    terminal: 'ideal-rejoin',
    points,
    brakeI: corner.brakeI,
    apexSpeed: corner.vApex,
    cornerTimeSeconds: Number.EPSILON,
    lapTimeLossSeconds: 0
  };
}

function sustainedBaseline(
  track: Track,
  corner: Corner,
  side: -1 | 1
): number {
  const span = distanceAheadSamples(track, corner.approachI, corner.exitI);
  let baseline = side < 0 ? -Infinity : Infinity;
  for (let delta = 0; delta <= span; delta++) {
    const index = (corner.approachI + delta) % track.n;
    const envelope = normalLateralEnvelope(track, index);
    const ideal = track.idealPath!.off[index]!;
    baseline = side < 0
      ? Math.max(baseline, envelope.minimum - ideal)
      : Math.min(baseline, envelope.maximum - ideal);
  }
  if (!Number.isFinite(baseline))
    throw new Error(`${corner.id} has no sustained ${side < 0 ? 'lower' : 'upper'} offset`);
  return baseline;
}

/**
 * Add the smallest dense-grid member that a corner-sharing corridor needs:
 * approach/turn-in hold, one apex parameter, and a non-rejoining exit.
 * The baseline and apex limit both come from the normal-surface extremes;
 * λ below is only an offline analytic surface fit, never a runtime search.
 */
function sustainedCornerLine(
  track: Track,
  corner: Corner,
  kind: CornerLineKind
): CornerAlternateLineProfile {
  const side = (kind === 'inside' ? corner.side : -corner.side) as -1 | 1;
  const baseline = sustainedBaseline(track, corner, side);
  const apexEnvelope = normalLateralEnvelope(track, corner.apexI);
  const apexIdeal = track.idealPath!.off[corner.apexI]!;
  const apexExtreme = (
    side < 0 ? apexEnvelope.minimum : apexEnvelope.maximum
  ) - apexIdeal;
  const provisional = (apexEta: number): CornerAlternateLineProfile => ({
    kind,
    terminal: 'sustained-offset',
    points: [
      { index: corner.approachI, eta: baseline },
      { index: corner.turnInI, eta: baseline },
      { index: corner.apexI, eta: apexEta },
      { index: corner.exitI, eta: baseline }
    ],
    brakeI: corner.brakeI,
    apexSpeed: corner.vApex,
    cornerTimeSeconds: Number.EPSILON,
    lapTimeLossSeconds: 0
  });
  const extreme = provisional(apexExtreme);
  const span = distanceAheadSamples(track, corner.approachI, corner.exitI);
  let lambda = 1;
  for (let delta = 0; delta <= span; delta++) {
    const index = (corner.approachI + delta) % track.n;
    const evaluation = sampleCornerLineEtaAnalytic(
      track,
      corner,
      extreme,
      index
    );
    const excursion = evaluation.eta - baseline;
    if (Math.abs(excursion) <= Number.EPSILON) continue;
    const envelope = normalLateralEnvelope(track, index);
    const baseLateral = track.idealPath!.off[index]! + baseline;
    const bound = excursion < 0
      ? (envelope.minimum - baseLateral) / excursion
      : (envelope.maximum - baseLateral) / excursion;
    lambda = Math.min(lambda, bound);
  }
  const compact = provisional(round(
    baseline + (apexExtreme - baseline) * Math.max(0, Math.min(1, lambda))
  ));
  const final = evaluateCornerLine(track, corner, compact);
  return {
    ...compact,
    brakeI: final.brakeI,
    apexSpeed: round(final.apexSpeed),
    cornerTimeSeconds: round(final.cornerTimeSeconds),
    lapTimeLossSeconds: round(final.lapTimeLossSeconds)
  };
}

function safeSustainedCornerLine(
  track: Track,
  corner: Corner,
  kind: CornerLineKind
): CornerAlternateLineProfile {
  const compact: CornerAlternateLineProfile = {
    kind,
    terminal: 'sustained-offset',
    points: [
      { index: corner.approachI, eta: 0 },
      { index: corner.turnInI, eta: 0 },
      { index: corner.apexI, eta: 0 },
      { index: corner.exitI, eta: 0 }
    ],
    brakeI: corner.brakeI,
    apexSpeed: corner.vApex,
    cornerTimeSeconds: Number.EPSILON,
    lapTimeLossSeconds: 0
  };
  const final = evaluateCornerLine(track, corner, compact);
  return {
    ...compact,
    brakeI: final.brakeI,
    apexSpeed: round(final.apexSpeed),
    cornerTimeSeconds: round(final.cornerTimeSeconds),
    lapTimeLossSeconds: round(final.lapTimeLossSeconds)
  };
}

function cornerLineFamily(
  track: Track,
  corner: Corner,
  idealRejoin: CornerAlternateLineProfile,
  safe = false
): CornerLineFamilyProfile {
  return {
    idealRejoin,
    sustainedOffset: safe
      ? safeSustainedCornerLine(track, corner, idealRejoin.kind)
      : sustainedCornerLine(track, corner, idealRejoin.kind)
  };
}

function finalizedLine(
  track: Track,
  corner: Corner,
  kind: CornerLineKind,
  variables: readonly VariablePoint[]
): CornerAlternateLineProfile {
  const compact = candidateLine(track, corner, kind, variables);
  const roundedCompact = {
    ...compact,
    points: compact.points.map(point => ({ index: point.index, eta: round(point.eta) }))
  };
  const final = evaluateCornerLine(track, corner, roundedCompact);
  return {
    ...roundedCompact,
    brakeI: final.brakeI,
    apexSpeed: round(final.apexSpeed),
    cornerTimeSeconds: round(final.cornerTimeSeconds),
    lapTimeLossSeconds: round(final.lapTimeLossSeconds)
  };
}

function optimizeCornerLine(
  track: Track,
  corner: Corner,
  kind: CornerLineKind
): { line: CornerAlternateLineProfile; evaluations: number } {
  const variables = initialVariables(track, corner, kind);
  let evaluations = 0;
  const evaluate = (): ReturnType<typeof evaluateCornerLine> => {
    evaluations++;
    return evaluateCornerLine(track, corner, candidateLine(track, corner, kind, variables));
  };
  let best = evaluate();
  const lateralResolution = PHYS.carWid / 16;
  for (;;) {
    let moved = false;
    for (const variable of variables) {
      const incumbent = variable.value;
      let selectedValue = incumbent;
      let selected = best;
      for (const direction of [-1, 1] as const) {
        const value = Math.max(
          variable.minimum,
          Math.min(variable.maximum, incumbent + direction * variable.step)
        );
        if (Math.abs(value - incumbent) <= 1e-12) continue;
        variable.value = value;
        let trial: ReturnType<typeof evaluateCornerLine> | null = null;
        try {
          trial = evaluate();
        } catch {
          // Surface/geometry rejection is an ordinary offline search result.
        }
        if (trial && trial.timing.lapTime < selected.timing.lapTime - 1e-9) {
          selected = trial;
          selectedValue = value;
        }
      }
      variable.value = selectedValue;
      if (selectedValue !== incumbent) {
        best = selected;
        moved = true;
      }
    }
    if (moved) continue;
    let hasResolution = false;
    for (const variable of variables) {
      variable.step /= 2;
      hasResolution ||= variable.step >= lateralResolution;
    }
    if (!hasResolution) break;
  }
  for (const variable of variables) variable.value = round(variable.value);
  const line = finalizedLine(track, corner, kind, variables);
  evaluations++;
  return { line, evaluations };
}

/** Two deterministic constrained profile-optimizer passes per semantic corner. */
export function optimizeCornerLineLibrary(track: Track): CornerLineSearchResult {
  if (!track.idealPath || !track.idealTiming || !track.corners)
    throw new Error(`Track ${track.def.id} has no committed semantic ideal line`);
  const library: CornerLinePairProfile[] = [];
  let evaluations = 0;
  for (const corner of track.corners) {
    const inside = optimizeCornerLine(track, corner, 'inside');
    const outside = optimizeCornerLine(track, corner, 'outside');
    evaluations += inside.evaluations + outside.evaluations;
    library.push({
      cornerId: corner.id,
      inside: cornerLineFamily(track, corner, inside.line),
      outside: cornerLineFamily(track, corner, outside.line)
    });
    evaluations += 2;
  }
  return { library, evaluations, optimizerVersion: CORNER_LINE_LIBRARY_VERSION };
}

/**
 * Densify an already controller-validated rejoin library without retuning its
 * solo-racing authority. This is the library-only migration path used when
 * adding the sustained apex-grid member to committed profiles.
 */
export function densifyCornerLineLibrary(
  track: Track,
  committed: readonly unknown[]
): CornerLineSearchResult {
  if (!track.idealPath || !track.idealTiming || !track.corners)
    throw new Error(`Track ${track.def.id} has no committed semantic ideal line`);
  const byCorner = new Map((committed as Array<{
    cornerId: string;
    inside: CornerAlternateLineProfile | CornerLineFamilyProfile;
    outside: CornerAlternateLineProfile | CornerLineFamilyProfile;
  }>).map(pair => [pair.cornerId, pair]));
  const library: CornerLinePairProfile[] = [];
  for (const corner of track.corners) {
    const pair = byCorner.get(corner.id);
    if (!pair) throw new Error(`Missing committed corner-line pair ${corner.id}`);
    const rejoin = (kind: CornerLineKind): CornerAlternateLineProfile => {
      const value = pair[kind];
      const line = 'idealRejoin' in value ? value.idealRejoin : value;
      return { ...line, kind, terminal: 'ideal-rejoin' };
    };
    library.push({
      cornerId: corner.id,
      inside: cornerLineFamily(track, corner, rejoin('inside')),
      outside: cornerLineFamily(track, corner, rejoin('outside'))
    });
  }
  return {
    library,
    evaluations: library.length * 2,
    optimizerVersion: CORNER_LINE_LIBRARY_VERSION
  };
}

/** Deterministic safe incumbent for explicit short-budget/non-production workflows. */
export function seedCornerLineLibrary(track: Track): CornerLineSearchResult {
  if (!track.idealPath || !track.idealTiming || !track.corners)
    throw new Error(`Track ${track.def.id} has no committed semantic ideal line`);
  const library: CornerLinePairProfile[] = [];
  for (const corner of track.corners) {
    const inside = finalizedLine(track, corner, 'inside', initialVariables(track, corner, 'inside'));
    const outside = finalizedLine(track, corner, 'outside', initialVariables(track, corner, 'outside'));
    library.push({
      cornerId: corner.id,
      inside: cornerLineFamily(track, corner, inside, true),
      outside: cornerLineFamily(track, corner, outside, true)
    });
  }
  return {
    library,
    evaluations: library.length * 4,
    optimizerVersion: CORNER_LINE_LIBRARY_VERSION
  };
}

function lineWithMeasuredTiming(
  built: BuiltTrack,
  corner: Corner,
  line: CornerAlternateLineProfile
): CornerAlternateLineProfile {
  const evaluated = evaluateCornerLine(built.tr, corner, line);
  return {
    ...line,
    brakeI: evaluated.brakeI,
    apexSpeed: round(evaluated.apexSpeed),
    cornerTimeSeconds: round(evaluated.cornerTimeSeconds),
    lapTimeLossSeconds: round(evaluated.lapTimeLossSeconds)
  };
}

/** Production-controller finalist validation with deterministic safe backoff. */
export function selectControllerValidatedCornerLines(
  built: BuiltTrack,
  optimized: CornerLineSearchResult,
  seed: number,
  validateIdealRejoin = true
): CornerLineControllerSelection {
  const safe = seedCornerLineLibrary(built.tr);
  const safeByCorner = new Map(safe.library.map(pair => [pair.cornerId, pair]));
  const library: CornerLinePairProfile[] = [];
  let controllerValidations = 0;
  let backedOffLines = 0;
  let lineIndex = 0;
  const driveable = (corner: Corner, line: CornerAlternateLineProfile): boolean => {
    const evaluated = evaluateCornerLine(built.tr, corner, line);
    const validationSeed = seed + lineIndex;
    const summary = runSingleCar(built, {
      laps: 1,
      seed: validationSeed,
      path: evaluated.path
    });
    controllerValidations++;
    const absolute = summary.reason === 'complete' && summary.validLaps === 1 &&
      summary.invalidLaps === 0 && summary.finite && summary.offCourseSeconds === 0 &&
      summary.maximumMarkerError <= PROFILE_MARKER_ERROR_ABSOLUTE_METRES + 1e-9;
    if (absolute || validateIdealRejoin) return absolute;
    // A library-only densification must not silently retune the committed
    // ideal/controller pair. If that pair is already red in the working tree,
    // require the new member to be no worse under the identical controller
    // run; the zero-offset safe incumbent is then exactly the reference.
    const reference = runSingleCar(built, {
      laps: 1,
      seed: validationSeed,
      path: built.tr.idealPath
    });
    return summary.reason === 'complete' && summary.finite &&
      summary.invalidLaps <= reference.invalidLaps &&
      summary.offCourseSeconds <= reference.offCourseSeconds + 1e-9 &&
      summary.maximumMarkerError <= reference.maximumMarkerError + 1e-9;
  };
  for (const pair of optimized.library) {
    const corner = built.tr.corners.find(candidate => candidate.id === pair.cornerId);
    const safePair = safeByCorner.get(pair.cornerId);
    if (!corner || !safePair) throw new Error(`Missing corner-line finalist ${pair.cornerId}`);
    const selected = {} as {
      inside: CornerLineFamilyProfile;
      outside: CornerLineFamilyProfile;
    };
    for (const kind of ['inside', 'outside'] as const) {
      const family = {} as CornerLineFamilyProfile;
      for (const member of ['idealRejoin', 'sustainedOffset'] as const) {
        const candidate = pair[kind][member];
        const incumbent = safePair[kind][member];
        if (member === 'idealRejoin' && !validateIdealRejoin) {
          family[member] = candidate;
          lineIndex++;
          continue;
        }
        if (driveable(corner, candidate)) {
          family[member] = candidate;
          lineIndex++;
          continue;
        }
        backedOffLines++;
        if (!driveable(corner, incumbent))
          throw new Error(
            `${pair.cornerId} ${kind} ${member} safe incumbent is not driveable`
          );
        let chosen = incumbent;
        const maximumDelta = Math.max(...candidate.points.map((point, index) =>
          Math.abs(point.eta - incumbent.points[index]!.eta)
        ));
        const fractionStep = maximumDelta <= Number.EPSILON
          ? 1
          : Math.min(1, (PHYS.carWid / 16) / maximumDelta);
        for (
          let fraction = 1 - fractionStep;
          fraction > Number.EPSILON;
          fraction -= fractionStep
        ) {
          const trial = lineWithMeasuredTiming(built, corner, {
            ...candidate,
            points: candidate.points.map((point, index) => ({
              index: point.index,
              eta: round(
                incumbent.points[index]!.eta +
                (point.eta - incumbent.points[index]!.eta) * fraction
              )
            }))
          });
          if (driveable(corner, trial)) {
            chosen = trial;
            break;
          }
        }
        family[member] = chosen;
        lineIndex++;
      }
      selected[kind] = family;
    }
    library.push({ cornerId: pair.cornerId, ...selected });
  }
  return { library, controllerValidations, backedOffLines };
}
