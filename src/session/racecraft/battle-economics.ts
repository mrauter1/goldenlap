import type { PaceMode } from '../model';

export interface PacePositionValueWeight {
  readonly pace: PaceMode;
  readonly name: 'save' | 'race' | 'push';
  readonly weight: number;
  readonly source: 'strategy';
}

/**
 * Strategy content, not calibration: pace mode states how much one passing
 * opportunity is worth. It does not alter contact, contest, or safety prices.
 */
export const PACE_POSITION_VALUE_WEIGHTS:
readonly [
  PacePositionValueWeight,
  PacePositionValueWeight,
  PacePositionValueWeight
] = Object.freeze([
  Object.freeze({
    pace: 0 as const,
    name: 'save' as const,
    weight: 1 / 2,
    source: 'strategy' as const
  }),
  Object.freeze({
    pace: 1 as const,
    name: 'race' as const,
    weight: 1,
    source: 'strategy' as const
  }),
  Object.freeze({
    pace: 2 as const,
    name: 'push' as const,
    weight: 2,
    source: 'strategy' as const
  })
]);

export interface NormalizedPairPaceEvidence {
  /**
   * Actual elapsed time divided by ideal time advanced over the same track
   * progress. The ratio is dimensionless and therefore track-length neutral.
   */
  readonly egoProgressTimeRatio: number;
  readonly rivalProgressTimeRatio: number;
}

export interface PairPaceObservation {
  readonly elapsedSeconds: number;
  readonly egoReferenceProgressSeconds: number;
  readonly rivalReferenceProgressSeconds: number;
  readonly reopportunitySeconds: number;
}

export interface OpportunityIntervalEvidence {
  readonly opportunityPresent: boolean;
  readonly lastObservationSeconds: number | null;
  readonly lastOnsetSeconds: number | null;
  readonly meanIntervalSeconds: number | null;
  readonly measuredIntervals: number;
}

export interface OpportunityObservation {
  readonly nowSeconds: number;
  readonly opportunityPresent: boolean;
}

export interface PositionValueInput {
  readonly pace: PaceMode;
  readonly paceDifferentialSecondsPerLap: number;
  readonly reopportunitySeconds: number;
  readonly referenceLapSeconds: number;
}

export interface BattleSpendInput {
  /** Measured residual loss of entering this attack family. */
  readonly measuredAttemptLossSeconds: number;
  /** Deterministic contested-region price already computed by the evaluator. */
  readonly contestSeconds: number;
  /** Integrated loss from the measured contact-rate curve. */
  readonly measuredProximitySeconds: number;
}

function finite(label: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function positive(label: string, value: number): number {
  finite(label, value);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function nonNegative(label: string, value: number): number {
  finite(label, value);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

export function pacePositionValueWeight(pace: PaceMode): number {
  return PACE_POSITION_VALUE_WEIGHTS[pace].weight;
}

/**
 * Creates bounded pair state from a derived or measured prior. A neutral
 * reference prior is `(1, 1)`; callers may instead supply capability-lap
 * ratios without introducing a separate bootstrap rule here.
 */
export function createNormalizedPairPaceEvidence(
  egoProgressTimeRatio: number,
  rivalProgressTimeRatio: number
): NormalizedPairPaceEvidence {
  return {
    egoProgressTimeRatio: positive(
      'egoProgressTimeRatio',
      egoProgressTimeRatio
    ),
    rivalProgressTimeRatio: positive(
      'rivalProgressTimeRatio',
      rivalProgressTimeRatio
    )
  };
}

/**
 * Converts progress during an observation interval into the dimensionless
 * pace quantity used by the EWMA: actual time / ideal time for that progress.
 */
export function normalizedProgressTimeRatio(
  elapsedSeconds: number,
  referenceProgressSeconds: number
): number {
  return positive('elapsedSeconds', elapsedSeconds) /
    positive('referenceProgressSeconds', referenceProgressSeconds);
}

/**
 * Exponential observation-time update. The decay horizon is the measured
 * time between opportunities, so no independent memory or persistence knob
 * exists. Splitting a constant observation into finer samples converges to
 * the same result.
 */
export function updateNormalizedPairPaceEvidence(
  state: NormalizedPairPaceEvidence,
  observation: PairPaceObservation
): NormalizedPairPaceEvidence {
  const elapsed = nonNegative(
    'elapsedSeconds',
    observation.elapsedSeconds
  );
  positive('egoProgressTimeRatio', state.egoProgressTimeRatio);
  positive('rivalProgressTimeRatio', state.rivalProgressTimeRatio);
  if (elapsed === 0) {
    if (observation.egoReferenceProgressSeconds !== 0 ||
        observation.rivalReferenceProgressSeconds !== 0)
      throw new RangeError(
        'zero elapsedSeconds requires zero reference progress'
      );
    return state;
  }

  const reopportunity = positive(
    'reopportunitySeconds',
    observation.reopportunitySeconds
  );
  const egoObservation = normalizedProgressTimeRatio(
    elapsed,
    observation.egoReferenceProgressSeconds
  );
  const rivalObservation = normalizedProgressTimeRatio(
    elapsed,
    observation.rivalReferenceProgressSeconds
  );
  const retained = Math.exp(-elapsed / reopportunity);
  const observed = 1 - retained;
  return {
    egoProgressTimeRatio:
      retained * state.egoProgressTimeRatio + observed * egoObservation,
    rivalProgressTimeRatio:
      retained * state.rivalProgressTimeRatio + observed * rivalObservation
  };
}

/**
 * Positive means the rival is slower: seconds the rival loses to ego over
 * one reference lap. Both pair members use the same reference-lap currency.
 */
export function pairPaceDifferentialSecondsPerLap(
  state: NormalizedPairPaceEvidence,
  referenceLapSeconds: number
): number {
  const lap = positive('referenceLapSeconds', referenceLapSeconds);
  const ego = positive(
    'egoProgressTimeRatio',
    state.egoProgressTimeRatio
  );
  const rival = positive(
    'rivalProgressTimeRatio',
    state.rivalProgressTimeRatio
  );
  return lap * (rival - ego);
}

export function createOpportunityIntervalEvidence():
OpportunityIntervalEvidence {
  return {
    opportunityPresent: false,
    lastObservationSeconds: null,
    lastOnsetSeconds: null,
    meanIntervalSeconds: null,
    measuredIntervals: 0
  };
}

/**
 * Records only the physical false→true edge. The running arithmetic mean is
 * exact for every observed interval and uses constant memory; selecting or
 * rejecting an attack never changes the evidence.
 */
export function updateOpportunityIntervalEvidence(
  state: OpportunityIntervalEvidence,
  observation: OpportunityObservation
): OpportunityIntervalEvidence {
  const now = nonNegative('nowSeconds', observation.nowSeconds);
  if (state.lastObservationSeconds != null &&
      now < state.lastObservationSeconds)
    throw new RangeError('opportunity observations must be chronological');

  const onset =
    observation.opportunityPresent && !state.opportunityPresent;
  if (!onset) {
    return {
      ...state,
      opportunityPresent: observation.opportunityPresent,
      lastObservationSeconds: now
    };
  }

  if (state.lastOnsetSeconds == null) {
    return {
      ...state,
      opportunityPresent: true,
      lastObservationSeconds: now,
      lastOnsetSeconds: now
    };
  }

  const interval = now - state.lastOnsetSeconds;
  if (interval === 0) {
    return {
      ...state,
      opportunityPresent: true,
      lastObservationSeconds: now,
      lastOnsetSeconds: now
    };
  }
  const measuredIntervals = state.measuredIntervals + 1;
  const previousMean = state.meanIntervalSeconds ?? interval;
  const meanIntervalSeconds = state.measuredIntervals === 0
    ? interval
    : previousMean +
      (interval - previousMean) / measuredIntervals;
  return {
    opportunityPresent: true,
    lastObservationSeconds: now,
    lastOnsetSeconds: now,
    meanIntervalSeconds,
    measuredIntervals
  };
}

/**
 * Before a pair has produced two opportunity onsets, one reference lap is
 * the derived estimate of when the same track opportunity returns.
 */
export function reopportunitySeconds(
  state: OpportunityIntervalEvidence,
  referenceLapSeconds: number
): number {
  const fallback = positive('referenceLapSeconds', referenceLapSeconds);
  if (state.meanIntervalSeconds == null) return fallback;
  return positive('meanIntervalSeconds', state.meanIntervalSeconds);
}

/**
 * Opportunity value in seconds. Dividing by the reference lap is required
 * dimensionally: (s/lap) × s / (s/lap) = s.
 */
export function positionValueSeconds(input: PositionValueInput): number {
  const differential = finite(
    'paceDifferentialSecondsPerLap',
    input.paceDifferentialSecondsPerLap
  );
  const reopportunity = positive(
    'reopportunitySeconds',
    input.reopportunitySeconds
  );
  const referenceLap = positive(
    'referenceLapSeconds',
    input.referenceLapSeconds
  );
  return pacePositionValueWeight(input.pace) *
    Math.max(0, differential) *
    reopportunity /
    referenceLap;
}

/**
 * All terms are caller-supplied honest seconds. In particular, attempt and
 * proximity losses have no fallback constant in the decision code.
 */
export function battleSpendSeconds(input: BattleSpendInput): number {
  return nonNegative(
    'measuredAttemptLossSeconds',
    input.measuredAttemptLossSeconds
  ) + nonNegative('contestSeconds', input.contestSeconds) +
    nonNegative(
      'measuredProximitySeconds',
      input.measuredProximitySeconds
    );
}
