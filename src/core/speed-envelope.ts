import {
  numericArray,
  type NumericArray,
  type SpeedEnvelope
} from './model';

export interface SpeedEnvelopeConstructionBuffers {
  readonly segmentStartProgress: NumericArray;
  readonly segmentEndProgress: NumericArray;
  readonly v2AtStart: NumericArray;
  readonly slope: NumericArray;
  readonly prefixTravelSeconds: NumericArray;
}

export function createSpeedEnvelopeConstructionBuffers(
  segmentCount: number
): SpeedEnvelopeConstructionBuffers {
  return {
    segmentStartProgress: numericArray(segmentCount),
    segmentEndProgress: numericArray(segmentCount),
    v2AtStart: numericArray(segmentCount),
    slope: numericArray(segmentCount),
    prefixTravelSeconds: numericArray(segmentCount + 1)
  };
}

/** One bounded affine constraint in `(s, v²)` space. */
export interface SpeedEnvelopeConstraint {
  readonly startProgress: number;
  readonly endProgress: number;
  readonly v2AtStart: number;
  readonly slope: number;
}

interface MutableEnvelopeSegment {
  startProgress: number;
  endProgress: number;
  v2AtStart: number;
  slope: number;
  constraintIndex: number;
}

const segmentPool: MutableEnvelopeSegment[] = [];
let segmentPoolUsed = 0;

function sameBreakpoint(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON *
    Math.max(1, Math.abs(left), Math.abs(right));
}

function constraintV2At(
  constraint: SpeedEnvelopeConstraint,
  progress: number
): number {
  return constraint.v2AtStart +
    constraint.slope * (progress - constraint.startProgress);
}

function pooledSegment(
  startProgress: number,
  endProgress: number,
  v2AtStart: number,
  slope: number,
  constraintIndex: number
): MutableEnvelopeSegment {
  const pooled = segmentPool[segmentPoolUsed++];
  if (pooled) {
    pooled.startProgress = startProgress;
    pooled.endProgress = endProgress;
    pooled.v2AtStart = v2AtStart;
    pooled.slope = slope;
    pooled.constraintIndex = constraintIndex;
    return pooled;
  }
  const created = {
    startProgress,
    endProgress,
    v2AtStart,
    slope,
    constraintIndex
  };
  segmentPool.push(created);
  return created;
}

function appendConstraintSegment(
  output: MutableEnvelopeSegment[],
  constraint: SpeedEnvelopeConstraint,
  constraintIndex: number,
  startProgress: number,
  endProgress: number
): void {
  if (!(endProgress > startProgress) ||
      sameBreakpoint(startProgress, endProgress)) return;
  const previous = output.at(-1);
  if (previous &&
      previous.constraintIndex === constraintIndex &&
      sameBreakpoint(previous.endProgress, startProgress)) {
    previous.endProgress = endProgress;
    return;
  }
  output.push(pooledSegment(
    startProgress,
    endProgress,
    constraintV2At(constraint, startProgress),
    constraint.slope,
    constraintIndex
  ));
}

function appendExistingSegment(
  output: MutableEnvelopeSegment[],
  segment: MutableEnvelopeSegment,
  startProgress: number,
  endProgress: number
): void {
  if (!(endProgress > startProgress) ||
      sameBreakpoint(startProgress, endProgress)) return;
  const previous = output.at(-1);
  if (previous &&
      previous.constraintIndex === segment.constraintIndex &&
      sameBreakpoint(previous.endProgress, startProgress)) {
    previous.endProgress = endProgress;
    return;
  }
  if (sameBreakpoint(startProgress, segment.startProgress) &&
      sameBreakpoint(endProgress, segment.endProgress)) {
    output.push(segment);
    return;
  }
  output.push(pooledSegment(
    startProgress,
    endProgress,
    segment.v2AtStart +
      segment.slope * (startProgress - segment.startProgress),
    segment.slope,
    segment.constraintIndex
  ));
}

function appendLowerInterval(
  output: MutableEnvelopeSegment[],
  existing: MutableEnvelopeSegment,
  candidate: SpeedEnvelopeConstraint,
  candidateIndex: number,
  startProgress: number,
  endProgress: number
): void {
  const existingIntercept =
    existing.v2AtStart - existing.slope * existing.startProgress;
  const candidateIntercept =
    candidate.v2AtStart - candidate.slope * candidate.startProgress;
  const slopeDifference = existing.slope - candidate.slope;
  let crossing: number | null = null;
  if (slopeDifference !== 0) {
    const intersection =
      (candidateIntercept - existingIntercept) / slopeDifference;
    if (intersection > startProgress &&
        intersection < endProgress &&
        !sameBreakpoint(intersection, startProgress) &&
        !sameBreakpoint(intersection, endProgress))
      crossing = intersection;
  }

  const appendSelected = (from: number, to: number): void => {
    const probe = from + (to - from) / 2;
    const existingV2 = existing.v2AtStart +
      existing.slope * (probe - existing.startProgress);
    const candidateV2 = constraintV2At(candidate, probe);
    if (existingV2 <= candidateV2)
      appendExistingSegment(output, existing, from, to);
    else
      appendConstraintSegment(
        output,
        candidate,
        candidateIndex,
        from,
        to
      );
  };

  if (crossing == null) {
    appendSelected(startProgress, endProgress);
    return;
  }
  appendSelected(startProgress, crossing);
  appendSelected(crossing, endProgress);
}

function validateConstraint(
  constraint: SpeedEnvelopeConstraint
): void {
  if (!Number.isFinite(constraint.startProgress) ||
      !Number.isFinite(constraint.endProgress) ||
      !Number.isFinite(constraint.v2AtStart) ||
      !Number.isFinite(constraint.slope))
    throw new RangeError('Speed envelope constraint must be finite');
}

function mergeConstraint(
  segments: readonly MutableEnvelopeSegment[],
  constraint: SpeedEnvelopeConstraint,
  constraintIndex: number,
  startProgress: number,
  endProgress: number,
  output: MutableEnvelopeSegment[]
): MutableEnvelopeSegment[] {
  output.length = 0;
  validateConstraint(constraint);
  const candidateStart = Math.max(
    startProgress,
    constraint.startProgress
  );
  const candidateEnd = Math.min(
    endProgress,
    constraint.endProgress
  );
  if (!(candidateEnd > candidateStart)) {
    for (const segment of segments) output.push(segment);
    return output;
  }

  let candidateCursor = candidateStart;
  for (const existing of segments) {
    if (existing.endProgress <= candidateStart ||
        existing.startProgress >= candidateEnd) {
      if (existing.startProgress >= candidateEnd &&
          candidateCursor < candidateEnd) {
        appendConstraintSegment(
          output,
          constraint,
          constraintIndex,
          candidateCursor,
          candidateEnd
        );
        candidateCursor = candidateEnd;
      }
      appendExistingSegment(
        output,
        existing,
        existing.startProgress,
        existing.endProgress
      );
      continue;
    }

    const overlapStart = Math.max(
      existing.startProgress,
      candidateStart
    );
    const overlapEnd = Math.min(
      existing.endProgress,
      candidateEnd
    );
    if (existing.startProgress < overlapStart)
      appendExistingSegment(
        output,
        existing,
        existing.startProgress,
        overlapStart
      );
    if (candidateCursor < overlapStart)
      appendConstraintSegment(
        output,
        constraint,
        constraintIndex,
        candidateCursor,
        overlapStart
      );
    appendLowerInterval(
      output,
      existing,
      constraint,
      constraintIndex,
      overlapStart,
      overlapEnd
    );
    if (overlapEnd < existing.endProgress)
      appendExistingSegment(
        output,
        existing,
        overlapEnd,
        existing.endProgress
      );
    candidateCursor = Math.max(candidateCursor, overlapEnd);
  }
  if (candidateCursor < candidateEnd)
    appendConstraintSegment(
      output,
      constraint,
      constraintIndex,
      candidateCursor,
      candidateEnd
    );
  return output;
}

function finishEnvelope(
  startProgress: number,
  endProgress: number,
  segments: readonly MutableEnvelopeSegment[]
): SpeedEnvelope {
  if (!segments.length ||
      !sameBreakpoint(segments[0]!.startProgress, startProgress) ||
      !sameBreakpoint(segments.at(-1)!.endProgress, endProgress))
    throw new RangeError(
      'Speed envelope constraints leave an uncovered interval'
    );
  for (let index = 1; index < segments.length; index++)
    if (!sameBreakpoint(
      segments[index - 1]!.endProgress,
      segments[index]!.startProgress
    ))
      throw new RangeError(
        'Speed envelope constraints leave an uncovered interval'
      );

  const segmentStartProgress = numericArray(segments.length);
  const segmentEndProgress = numericArray(segments.length);
  const v2AtStart = numericArray(segments.length);
  const slope = numericArray(segments.length);
  const prefixTravelSeconds = numericArray(segments.length + 1);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    segmentStartProgress[index] = segment.startProgress;
    segmentEndProgress[index] = segment.endProgress;
    v2AtStart[index] = segment.v2AtStart;
    slope[index] = segment.slope;
    const endV2 = segment.v2AtStart +
      segment.slope * (segment.endProgress - segment.startProgress);
    prefixTravelSeconds[index + 1] =
      prefixTravelSeconds[index]! +
      2 * (segment.endProgress - segment.startProgress) /
        Math.max(
          Number.EPSILON,
          Math.sqrt(Math.max(0, segment.v2AtStart)) +
            Math.sqrt(Math.max(0, endV2))
        );
  }
  return {
    startProgress,
    endProgress,
    segmentCount: segments.length,
    segmentStartProgress,
    segmentEndProgress,
    v2AtStart,
    slope,
    prefixTravelSeconds
  };
}

/** Construct the exact lower envelope of bounded affine constraints. */
export function buildSpeedEnvelope(
  startProgress: number,
  endProgress: number,
  constraints: readonly SpeedEnvelopeConstraint[]
): SpeedEnvelope {
  if (!Number.isFinite(startProgress) ||
      !Number.isFinite(endProgress) ||
      !(endProgress > startProgress))
    throw new RangeError('Speed envelope requires a finite positive domain');

  segmentPoolUsed = 0;
  let segments: MutableEnvelopeSegment[] = [];
  let scratch: MutableEnvelopeSegment[] = [];
  for (let constraintIndex = 0;
    constraintIndex < constraints.length;
    constraintIndex++) {
    const merged = mergeConstraint(
      segments,
      constraints[constraintIndex]!,
      constraintIndex,
      startProgress,
      endProgress,
      scratch
    );
    scratch = segments;
    segments = merged;
  }
  return finishEnvelope(startProgress, endProgress, segments);
}

/** Add exact bounded constraints to an existing owned envelope. */
export function constrainSpeedEnvelope(
  envelope: SpeedEnvelope,
  constraints: readonly SpeedEnvelopeConstraint[]
): SpeedEnvelope {
  segmentPoolUsed = 0;
  let segments = new Array<MutableEnvelopeSegment>(
    envelope.segmentCount
  );
  for (let index = 0; index < envelope.segmentCount; index++)
    segments[index] = pooledSegment(
      envelope.segmentStartProgress[index]!,
      envelope.segmentEndProgress[index]!,
      envelope.v2AtStart[index]!,
      envelope.slope[index]!,
      index
    );
  let scratch: MutableEnvelopeSegment[] = [];
  for (let index = 0; index < constraints.length; index++) {
    const merged = mergeConstraint(
      segments,
      constraints[index]!,
      envelope.segmentCount + index,
      envelope.startProgress,
      envelope.endProgress,
      scratch
    );
    scratch = segments;
    segments = merged;
  }
  return finishEnvelope(
    envelope.startProgress,
    envelope.endProgress,
    segments
  );
}

/** Build one continuous envelope whose knots are supplied as speeds. */
export function speedEnvelopeFromSamples(
  progress: readonly number[],
  speed: readonly number[]
): SpeedEnvelope {
  if (progress.length !== speed.length || progress.length < 2)
    throw new RangeError('Speed envelope requires at least two paired knots');
  const segmentCount = progress.length - 1;
  const segmentStartProgress = numericArray(segmentCount);
  const segmentEndProgress = numericArray(segmentCount);
  const v2AtStart = numericArray(segmentCount);
  const slope = numericArray(segmentCount);
  const prefixTravelSeconds = numericArray(segmentCount + 1);
  for (let index = 0; index < progress.length - 1; index++) {
    const start = progress[index]!;
    const end = progress[index + 1]!;
    const fromSpeed = speed[index]!;
    const toSpeed = speed[index + 1]!;
    if (!Number.isFinite(start) || !Number.isFinite(end) ||
        !Number.isFinite(fromSpeed) || !Number.isFinite(toSpeed) ||
        !(end > start))
      throw new RangeError('Speed envelope knots must increase');
    const clampedFrom = Math.max(0, fromSpeed);
    const clampedTo = Math.max(0, toSpeed);
    const fromV2 = clampedFrom * clampedFrom;
    const toV2 = clampedTo * clampedTo;
    segmentStartProgress[index] = start;
    segmentEndProgress[index] = end;
    v2AtStart[index] = fromV2;
    slope[index] = (toV2 - fromV2) / (end - start);
    prefixTravelSeconds[index + 1] =
      prefixTravelSeconds[index]! +
      2 * (end - start) /
        Math.max(Number.EPSILON, clampedFrom + clampedTo);
  }
  return {
    startProgress: progress[0]!,
    endProgress: progress.at(-1)!,
    segmentCount,
    segmentStartProgress,
    segmentEndProgress,
    v2AtStart,
    slope,
    prefixTravelSeconds
  };
}

/** Build the same owned envelope when knots lie on one uniform spatial grid. */
export function speedEnvelopeFromUniformSamples(
  startProgress: number,
  step: number,
  speed: readonly number[],
  ownedBuffers?: SpeedEnvelopeConstructionBuffers
): SpeedEnvelope {
  if (!Number.isFinite(startProgress) || !Number.isFinite(step) ||
      !(step > 0) || speed.length < 2)
    throw new RangeError(
      'Uniform speed envelope requires a finite positive grid'
    );
  const segmentCount = speed.length - 1;
  const buffers = ownedBuffers ??
    createSpeedEnvelopeConstructionBuffers(segmentCount);
  if (buffers.segmentStartProgress.length !== segmentCount ||
      buffers.segmentEndProgress.length !== segmentCount ||
      buffers.v2AtStart.length !== segmentCount ||
      buffers.slope.length !== segmentCount ||
      buffers.prefixTravelSeconds.length !== segmentCount + 1)
    throw new RangeError('Speed envelope construction buffer size mismatch');
  const {
    segmentStartProgress,
    segmentEndProgress,
    v2AtStart,
    slope,
    prefixTravelSeconds
  } = buffers;
  prefixTravelSeconds[0] = 0;
  for (let index = 0; index < segmentCount; index++) {
    const start = startProgress + index * step;
    const end = startProgress + (index + 1) * step;
    const fromSpeed = speed[index]!;
    const toSpeed = speed[index + 1]!;
    if (!Number.isFinite(fromSpeed) || !Number.isFinite(toSpeed))
      throw new RangeError('Speed envelope knots must be finite');
    const clampedFrom = Math.max(0, fromSpeed);
    const clampedTo = Math.max(0, toSpeed);
    const fromV2 = clampedFrom * clampedFrom;
    const toV2 = clampedTo * clampedTo;
    segmentStartProgress[index] = start;
    segmentEndProgress[index] = end;
    v2AtStart[index] = fromV2;
    slope[index] = (toV2 - fromV2) / (end - start);
    prefixTravelSeconds[index + 1] =
      prefixTravelSeconds[index]! +
      2 * (end - start) /
        Math.max(Number.EPSILON, clampedFrom + clampedTo);
  }
  return {
    startProgress,
    endProgress: startProgress + segmentCount * step,
    segmentCount,
    segmentStartProgress,
    segmentEndProgress,
    v2AtStart,
    slope,
    prefixTravelSeconds
  };
}

export function speedEnvelopeSegmentIndexAt(
  envelope: SpeedEnvelope,
  progress: number
): number {
  if (envelope.segmentCount === 0)
    throw new RangeError('Speed envelope contains no segments');
  const at = Math.min(
    envelope.endProgress,
    Math.max(envelope.startProgress, progress)
  );
  let low = 0;
  let high = envelope.segmentCount - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (at > envelope.segmentEndProgress[middle]!)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}

export function speedEnvelopeV2At(
  envelope: SpeedEnvelope,
  progress: number
): number {
  const index = speedEnvelopeSegmentIndexAt(envelope, progress);
  const at = Math.min(
    envelope.endProgress,
    Math.max(envelope.startProgress, progress)
  );
  return Math.max(
    0,
    envelope.v2AtStart[index]! +
      envelope.slope[index]! *
        (at - envelope.segmentStartProgress[index]!)
  );
}

export function speedEnvelopeAt(
  envelope: SpeedEnvelope,
  progress: number
): number {
  return Math.sqrt(speedEnvelopeV2At(envelope, progress));
}

export function cloneSpeedEnvelope(
  envelope: SpeedEnvelope
): SpeedEnvelope {
  const segmentStartProgress = numericArray(envelope.segmentCount);
  const segmentEndProgress = numericArray(envelope.segmentCount);
  const v2AtStart = numericArray(envelope.segmentCount);
  const slope = numericArray(envelope.segmentCount);
  const prefixTravelSeconds = numericArray(envelope.segmentCount + 1);
  segmentStartProgress.set(envelope.segmentStartProgress);
  segmentEndProgress.set(envelope.segmentEndProgress);
  v2AtStart.set(envelope.v2AtStart);
  slope.set(envelope.slope);
  prefixTravelSeconds.set(envelope.prefixTravelSeconds);
  return {
    startProgress: envelope.startProgress,
    endProgress: envelope.endProgress,
    segmentCount: envelope.segmentCount,
    segmentStartProgress,
    segmentEndProgress,
    v2AtStart,
    slope,
    prefixTravelSeconds
  };
}

export function speedEnvelopesEqual(
  left: SpeedEnvelope,
  right: SpeedEnvelope
): boolean {
  if (left.startProgress !== right.startProgress ||
      left.endProgress !== right.endProgress ||
      left.segmentCount !== right.segmentCount)
    return false;
  for (let index = 0; index < left.segmentCount; index++)
    if (left.segmentStartProgress[index] !==
          right.segmentStartProgress[index] ||
        left.segmentEndProgress[index] !==
          right.segmentEndProgress[index] ||
        left.v2AtStart[index] !== right.v2AtStart[index] ||
        left.slope[index] !== right.slope[index] ||
        left.prefixTravelSeconds[index] !==
          right.prefixTravelSeconds[index])
      return false;
  return left.prefixTravelSeconds[left.segmentCount] ===
    right.prefixTravelSeconds[right.segmentCount];
}

/** Sorted unique union of continuous segment boundaries. */
export function speedEnvelopeBreakpoints(
  first: SpeedEnvelope,
  second?: SpeedEnvelope
): number[] {
  const start = second
    ? Math.max(first.startProgress, second.startProgress)
    : first.startProgress;
  const end = second
    ? Math.min(first.endProgress, second.endProgress)
    : first.endProgress;
  if (!(end >= start)) return [];
  const points = [start];
  let firstIndex = speedEnvelopeSegmentIndexAt(first, start);
  let secondIndex = second
    ? speedEnvelopeSegmentIndexAt(second, start)
    : -1;
  while (points.at(-1)! < end &&
      firstIndex < first.segmentCount) {
    const firstEnd = Math.min(
      end,
      first.segmentEndProgress[firstIndex]!
    );
    const secondEnd = second
      ? Math.min(
          end,
          second.segmentEndProgress[secondIndex]!
        )
      : end;
    const next = Math.min(firstEnd, secondEnd);
    if (!sameBreakpoint(points.at(-1)!, next)) points.push(next);
    if (firstEnd <= next || sameBreakpoint(firstEnd, next))
      firstIndex++;
    if (second &&
        (secondEnd <= next || sameBreakpoint(secondEnd, next)))
      secondIndex++;
  }
  if (!sameBreakpoint(points.at(-1)!, end)) points.push(end);
  return points;
}

export function speedEnvelopeAddsConstraint(
  reference: SpeedEnvelope,
  constrained: SpeedEnvelope
): boolean {
  return firstSpeedEnvelopeBindingProgress(reference, constrained) != null;
}

/** Exact first progress at which `constrained` drops below `free`. */
export function firstSpeedEnvelopeBindingProgress(
  free: SpeedEnvelope,
  constrained: SpeedEnvelope
): number | null {
  const start = Math.max(free.startProgress, constrained.startProgress);
  const end = Math.min(free.endProgress, constrained.endProgress);
  if (!(end >= start)) return null;
  let freeIndex = speedEnvelopeSegmentIndexAt(free, start);
  let constrainedIndex = speedEnvelopeSegmentIndexAt(
    constrained,
    start
  );
  let cursor = start;
  while (cursor <= end &&
      freeIndex < free.segmentCount &&
      constrainedIndex < constrained.segmentCount) {
    const next = Math.min(
      end,
      free.segmentEndProgress[freeIndex]!,
      constrained.segmentEndProgress[constrainedIndex]!
    );
    const freeStart = free.segmentStartProgress[freeIndex]!;
    const constrainedStart =
      constrained.segmentStartProgress[constrainedIndex]!;
    const fromDifference =
      constrained.v2AtStart[constrainedIndex]! +
        constrained.slope[constrainedIndex]! *
          (cursor - constrainedStart) -
      (free.v2AtStart[freeIndex]! +
        free.slope[freeIndex]! * (cursor - freeStart));
    if (fromDifference < -Number.EPSILON) return cursor;
    if (next > cursor) {
      const toDifference =
        constrained.v2AtStart[constrainedIndex]! +
          constrained.slope[constrainedIndex]! *
            (next - constrainedStart) -
        (free.v2AtStart[freeIndex]! +
          free.slope[freeIndex]! * (next - freeStart));
      if (toDifference < -Number.EPSILON) {
        const denominator = toDifference - fromDifference;
        if (Math.abs(denominator) <= Number.EPSILON) return cursor;
        return cursor + (next - cursor) *
          (-fromDifference / denominator);
      }
    }
    if (next >= end || sameBreakpoint(next, end)) break;
    if (free.segmentEndProgress[freeIndex]! <= next ||
        sameBreakpoint(free.segmentEndProgress[freeIndex]!, next))
      freeIndex++;
    if (constrained.segmentEndProgress[constrainedIndex]! <= next ||
        sameBreakpoint(
          constrained.segmentEndProgress[constrainedIndex]!,
          next
        ))
      constrainedIndex++;
    cursor = next;
  }
  return null;
}

function speedEnvelopePrefixSecondsAt(
  envelope: SpeedEnvelope,
  progress: number
): number {
  const at = Math.min(
    envelope.endProgress,
    Math.max(envelope.startProgress, progress)
  );
  const index = speedEnvelopeSegmentIndexAt(envelope, at);
  const start = envelope.segmentStartProgress[index]!;
  const distance = Math.max(0, at - start);
  const fromSpeed = Math.sqrt(Math.max(
    0,
    envelope.v2AtStart[index]!
  ));
  const toSpeed = Math.sqrt(Math.max(
    0,
    envelope.v2AtStart[index]! +
      envelope.slope[index]! * distance
  ));
  return envelope.prefixTravelSeconds[index]! +
    2 * distance / Math.max(Number.EPSILON, fromSpeed + toSpeed);
}

/** Exact travel time through affine-v² segments. */
export function speedEnvelopeTravelSeconds(
  envelope: SpeedEnvelope,
  fromProgress: number,
  toProgress: number
): number {
  const from = Math.max(envelope.startProgress, fromProgress);
  const to = Math.min(envelope.endProgress, toProgress);
  if (!(to > from)) return 0;
  return speedEnvelopePrefixSecondsAt(envelope, to) -
    speedEnvelopePrefixSecondsAt(envelope, from);
}

/**
 * Invert travel time over the envelope. Affine `v²` makes each segment's
 * distance integral exact; only the segment selection is iterative.
 */
export function speedEnvelopeProgressAtSeconds(
  envelope: SpeedEnvelope,
  fromProgress: number,
  seconds: number
): number {
  const cursor = Math.min(
    envelope.endProgress,
    Math.max(envelope.startProgress, fromProgress)
  );
  const remaining = Math.max(0, seconds);
  if (remaining <= Number.EPSILON || cursor >= envelope.endProgress)
    return cursor;
  const startPrefix = speedEnvelopePrefixSecondsAt(envelope, cursor);
  const target = startPrefix + remaining;
  const total = envelope.prefixTravelSeconds[envelope.segmentCount]!;
  if (target >= total - Number.EPSILON) return envelope.endProgress;
  let low = speedEnvelopeSegmentIndexAt(envelope, cursor);
  let high = envelope.segmentCount - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (envelope.prefixTravelSeconds[middle + 1]! <
        target - Number.EPSILON)
      low = middle + 1;
    else
      high = middle;
  }
  const index = low;
  const segmentStart = envelope.segmentStartProgress[index]!;
  const segmentStartSeconds = envelope.prefixTravelSeconds[index]!;
  const elapsed = Math.max(0, target - segmentStartSeconds);
  const startSpeed = Math.sqrt(Math.max(
    0,
    envelope.v2AtStart[index]!
  ));
  const acceleration = envelope.slope[index]! / 2;
  const distance = Math.abs(acceleration) <= Number.EPSILON
    ? startSpeed * elapsed
    : startSpeed * elapsed + acceleration * elapsed * elapsed / 2;
  return Math.min(
    envelope.segmentEndProgress[index]!,
    segmentStart + Math.max(0, distance)
  );
}

function envelopeSegmentV2At(
  envelope: SpeedEnvelope,
  index: number,
  progress: number
): number {
  return envelope.v2AtStart[index]! +
    envelope.slope[index]! *
      (progress - envelope.segmentStartProgress[index]!);
}

function appendEnvelopeInterval(
  output: MutableEnvelopeSegment[],
  envelope: SpeedEnvelope,
  index: number,
  identity: number,
  startProgress: number,
  endProgress: number
): void {
  if (!(endProgress > startProgress) ||
      sameBreakpoint(startProgress, endProgress)) return;
  const previous = output.at(-1);
  if (previous &&
      previous.constraintIndex === identity &&
      sameBreakpoint(previous.endProgress, startProgress)) {
    previous.endProgress = endProgress;
    return;
  }
  output.push(pooledSegment(
    startProgress,
    endProgress,
    envelopeSegmentV2At(envelope, index, startProgress),
    envelope.slope[index]!,
    identity
  ));
}

function appendSelectedEnvelopeInterval(
  output: MutableEnvelopeSegment[],
  first: SpeedEnvelope,
  firstIndex: number,
  second: SpeedEnvelope,
  secondIndex: number,
  secondIdentityOffset: number,
  startProgress: number,
  endProgress: number
): void {
  const probe = startProgress + (endProgress - startProgress) / 2;
  if (envelopeSegmentV2At(first, firstIndex, probe) <=
      envelopeSegmentV2At(second, secondIndex, probe)) {
    appendEnvelopeInterval(
      output,
      first,
      firstIndex,
      firstIndex,
      startProgress,
      endProgress
    );
    return;
  }
  appendEnvelopeInterval(
    output,
    second,
    secondIndex,
    secondIdentityOffset + secondIndex,
    startProgress,
    endProgress
  );
}

function appendLowerEnvelopeInterval(
  output: MutableEnvelopeSegment[],
  first: SpeedEnvelope,
  firstIndex: number,
  second: SpeedEnvelope,
  secondIndex: number,
  startProgress: number,
  endProgress: number
): void {
  const firstSlope = first.slope[firstIndex]!;
  const secondSlope = second.slope[secondIndex]!;
  const firstIntercept = first.v2AtStart[firstIndex]! -
    firstSlope * first.segmentStartProgress[firstIndex]!;
  const secondIntercept = second.v2AtStart[secondIndex]! -
    secondSlope * second.segmentStartProgress[secondIndex]!;
  const slopeDifference = firstSlope - secondSlope;
  let crossing: number | null = null;
  if (slopeDifference !== 0) {
    const intersection =
      (secondIntercept - firstIntercept) / slopeDifference;
    if (intersection > startProgress &&
        intersection < endProgress &&
        !sameBreakpoint(intersection, startProgress) &&
        !sameBreakpoint(intersection, endProgress))
      crossing = intersection;
  }
  const secondIdentityOffset = first.segmentCount;
  if (crossing == null) {
    appendSelectedEnvelopeInterval(
      output,
      first,
      firstIndex,
      second,
      secondIndex,
      secondIdentityOffset,
      startProgress,
      endProgress
    );
    return;
  }
  appendSelectedEnvelopeInterval(
    output,
    first,
    firstIndex,
    second,
    secondIndex,
    secondIdentityOffset,
    startProgress,
    crossing
  );
  appendSelectedEnvelopeInterval(
    output,
    first,
    firstIndex,
    second,
    secondIndex,
    secondIdentityOffset,
    crossing,
    endProgress
  );
}

function appendLowerEnvelopeRange(
  output: MutableEnvelopeSegment[],
  first: SpeedEnvelope,
  second: SpeedEnvelope,
  startProgress: number,
  endProgress: number
): void {
  if (!(endProgress > startProgress)) return;
  let firstIndex = speedEnvelopeSegmentIndexAt(first, startProgress);
  let secondIndex = speedEnvelopeSegmentIndexAt(second, startProgress);
  let cursor = startProgress;
  while (cursor < endProgress &&
      firstIndex < first.segmentCount &&
      secondIndex < second.segmentCount) {
    const firstEnd = first.segmentEndProgress[firstIndex]!;
    const secondEnd = second.segmentEndProgress[secondIndex]!;
    const next = Math.min(endProgress, firstEnd, secondEnd);
    appendLowerEnvelopeInterval(
      output,
      first,
      firstIndex,
      second,
      secondIndex,
      cursor,
      next
    );
    if (next >= endProgress || sameBreakpoint(next, endProgress)) break;
    if (firstEnd <= next || sameBreakpoint(firstEnd, next)) firstIndex++;
    if (secondEnd <= next || sameBreakpoint(secondEnd, next)) secondIndex++;
    cursor = next;
  }
}

function appendEnvelopeRange(
  output: MutableEnvelopeSegment[],
  envelope: SpeedEnvelope,
  startProgress: number,
  endProgress: number
): void {
  if (!(endProgress > startProgress)) return;
  let index = speedEnvelopeSegmentIndexAt(envelope, startProgress);
  let cursor = startProgress;
  while (cursor < endProgress && index < envelope.segmentCount) {
    const next = Math.min(
      endProgress,
      envelope.segmentEndProgress[index]!
    );
    appendEnvelopeInterval(
      output,
      envelope,
      index,
      index,
      cursor,
      next
    );
    if (next >= endProgress || sameBreakpoint(next, endProgress)) break;
    index++;
    cursor = next;
  }
}

/** Exact lower envelope over the shared domain. */
export function lowerSpeedEnvelopes(
  first: SpeedEnvelope,
  second: SpeedEnvelope
): SpeedEnvelope {
  const start = Math.max(first.startProgress, second.startProgress);
  const end = Math.min(first.endProgress, second.endProgress);
  if (!(end > start))
    throw new RangeError('Speed envelopes have no shared positive domain');
  segmentPoolUsed = 0;
  const segments: MutableEnvelopeSegment[] = [];
  appendLowerEnvelopeRange(segments, first, second, start, end);
  return finishEnvelope(start, end, segments);
}

/**
 * Retain the lower of both authorities through `releaseProgress`, then use
 * the free authority alone. The release is a program transition, not a
 * tactical decision.
 */
export function releasedSpeedEnvelope(
  free: SpeedEnvelope,
  constrained: SpeedEnvelope,
  releaseProgress: number
): SpeedEnvelope {
  const start = Math.max(free.startProgress, constrained.startProgress);
  const end = Math.min(free.endProgress, constrained.endProgress);
  if (!(end > start))
    throw new RangeError('Speed envelopes have no shared positive domain');
  const release = Math.min(end, Math.max(start, releaseProgress));
  segmentPoolUsed = 0;
  const segments: MutableEnvelopeSegment[] = [];
  appendLowerEnvelopeRange(
    segments,
    free,
    constrained,
    start,
    release
  );
  appendEnvelopeRange(segments, free, release, end);
  return finishEnvelope(start, end, segments);
}
