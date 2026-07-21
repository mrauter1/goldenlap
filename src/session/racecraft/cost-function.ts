export interface PairwiseCandidateCosts {
  incumbentSeconds: number;
  candidateSeconds: number;
}

export interface DirectionalCandidateObjective {
  physicalSeconds: number;
  positionValueSeconds: number;
  attemptLossSeconds: number;
  nearRubLossSeconds: number;
}

function finite(label: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
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

/**
 * Complete selected-candidate objective. Decomposition fields are diagnostic
 * views of these same scalars, so each physical/economic term enters J once.
 */
export function directionalCandidateObjectiveSeconds(
  objective: DirectionalCandidateObjective
): number {
  return finite('physicalSeconds', objective.physicalSeconds) +
    finite('positionValueSeconds', objective.positionValueSeconds) +
    finite('attemptLossSeconds', objective.attemptLossSeconds) +
    finite('nearRubLossSeconds', objective.nearRubLossSeconds);
}
