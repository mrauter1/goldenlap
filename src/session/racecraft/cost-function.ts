export interface ResponseSlack {
  nowSeconds: number;
  waitSeconds: number;
}

export interface ResponseSlackInput {
  timeToHazardSeconds: number;
  actuationSeconds: number;
  completionSeconds: number;
  nextDecisionSeconds: number;
}

export interface PairwiseCandidateCosts {
  incumbentSeconds: number;
  candidateSeconds: number;
}

function finite(label: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function nonNegative(label: string, value: number): number {
  finite(label, value);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

/** Abramowitz-Stegun 7.1.26, used only as a numerical Phi approximation. */
function standardNormalCdf(value: number): number {
  if (value === 0) return 0.5;
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) +
    1.421413741) * t - 0.284496736) * t + 0.254829592) *
    t * Math.exp(-x * x);
  const cdf = 0.5 * (1 + sign * erf);
  return Math.max(0, Math.min(1, cdf));
}

/**
 * Smooth prospective responsibility over the time resolution at which an
 * arrival difference can change a decision. This is cadence quantization,
 * not execution uncertainty.
 */
export function arrivalQuantizedResponsibility(
  egoMinusRivalSeconds: number,
  arrivalQuantizationSeconds: number
): number {
  finite('egoMinusRivalSeconds', egoMinusRivalSeconds);
  const quantization = nonNegative(
    'arrivalQuantizationSeconds',
    arrivalQuantizationSeconds
  );
  if (quantization === 0)
    return egoMinusRivalSeconds > 0
      ? 1
      : egoMinusRivalSeconds < 0 ? 0 : 0.5;
  return standardNormalCdf(
    egoMinusRivalSeconds / quantization
  );
}

/**
 * Current and one-decision-deferred response slack. The decision interval is
 * subtracted exactly once and no separate reaction latency is introduced.
 */
export function responseSlack(input: ResponseSlackInput): ResponseSlack {
  const timeToHazard = nonNegative(
    'timeToHazardSeconds',
    input.timeToHazardSeconds
  );
  const actuation = nonNegative(
    'actuationSeconds',
    input.actuationSeconds
  );
  const completion = nonNegative(
    'completionSeconds',
    input.completionSeconds
  );
  const nextDecision = nonNegative(
    'nextDecisionSeconds',
    input.nextDecisionSeconds
  );
  const nowSeconds = timeToHazard - actuation - completion;
  return {
    nowSeconds,
    waitSeconds: nowSeconds - nextDecision
  };
}

/**
 * Maximum perturbation of the candidate-minus-incumbent cost difference.
 * Common-mode cost movement cancels before the tie band is measured.
 */
export function pairwiseDifferenceTieBand(
  base: PairwiseCandidateCosts,
  perturbations: readonly PairwiseCandidateCosts[]
): number {
  finite('base.incumbentSeconds', base.incumbentSeconds);
  finite('base.candidateSeconds', base.candidateSeconds);
  const baseDifference = base.candidateSeconds - base.incumbentSeconds;
  let maximumDifferenceChange = 0;
  for (const perturbation of perturbations) {
    finite('perturbation.incumbentSeconds', perturbation.incumbentSeconds);
    finite('perturbation.candidateSeconds', perturbation.candidateSeconds);
    const perturbedDifference =
      perturbation.candidateSeconds - perturbation.incumbentSeconds;
    maximumDifferenceChange = Math.max(
      maximumDifferenceChange,
      Math.abs(perturbedDifference - baseDifference)
    );
  }
  return maximumDifferenceChange;
}
