export interface MeasuredAttackTransitionLossPoint {
  readonly trackId: string;
  readonly straightId: string;
  readonly productionClass: string;
  readonly side: -1 | 1;
  readonly initialSpeedMetresPerSecond: number;
  readonly commonProgressDistanceMetres: number;
  readonly attackArrivalSeconds: number;
  readonly stayBehindArrivalSeconds: number;
  readonly attackOwnTimeSeconds: number;
  readonly stayBehindOwnTimeSeconds: number;
  readonly residualSeconds: number;
  readonly lossSeconds: number;
}

export interface MeasuredAttackTransitionLossSummary {
  readonly sampleCount: number;
  readonly residualMeanSeconds: number;
  readonly residualMinimumSeconds: number;
  readonly residualMaximumSeconds: number;
  readonly lossMeanSeconds: number;
  readonly lossMaximumSeconds: number;
}

/**
 * Deterministic output from tools/measure-attempt-loss.ts. The measured
 * quantity is the positive residual after removing the evaluator's ΔT from
 * an authored pull-out versus a matched stay-behind replay. Each feasible
 * normal-surface opportunity in the shipped track × production AI class ×
 * side domain has equal weight; no observed value was fitted or selected.
 */
export const MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE = Object.freeze({
  schemaVersion: 1 as const,
  method:
    'authored production side-family transition versus matched stay-behind control',
  source: 'measured' as const,
  physicsStepSeconds: 0.008333333333333333,
  refinedPhysicsStepSeconds: 0.004166666666666667,
  controlStepSeconds: 0.016666666666666666,
  deliberationIntervalSeconds: 0.1,
  predictionHorizonSeconds: 2.4,
  commonProgressRule:
    'initial speed multiplied by the production prediction horizon',
  straightOriginRule:
    'first grid sample after controller-settle distance beyond prior corner exit',
  leaderPlacementRule:
    'furthest in-grid centre point inside the production traffic scan',
  driverDomain:
    'all production AI team/driver slots at expected grid perturbation',
  aggregation:
    'arithmetic mean of per-opportunity positive residual seconds',
  trackIds: Object.freeze([
    'prado',
    'costa',
    'nordwald',
    'villa',
    'anhembi',
    'cerro',
    'ardenne',
    'paulista'
  ]),
  productionClassCount: 12,
  eligibleStraightCount: 65,
  sampleCount: 1464,
  completeDomain: true,
  nonFiniteCandidateCount: 0,
  residualMeanSeconds: 0.10945370587317264,
  residualMinimumSeconds: -0.7111678411231055,
  residualMaximumSeconds: 0.8273349760877938,
  lossMeanSeconds: 0.13556064173925947,
  lossMaximumSeconds: 0.8273349760877938,
  convergence: Object.freeze({
    maximumResidualDifferenceSeconds: 0.08006636092183061,
    meanResidualDifferenceSeconds: 0.009631774129833645,
    refinedResidualMeanSeconds: 0.11447772199645025,
    aggregateResidualMeanDifferenceSeconds: 0.005024016123277603,
    refinedLossMeanSeconds: 0.1417761355631283,
    aggregateLossMeanDifferenceSeconds: 0.006215493823868823,
    errorDirection:
      'halving the physics step increases the aggregate loss estimate'
  }),
  exclusions: Object.freeze({
    contact: 'rival absent from both matched replays',
    contest: 'candidate hazard count and contest bill required to be zero',
    proximity: 'rival absent from both matched replays',
    deterministicOwnPath:
      'attack minus stay-behind evaluator own-time removed exactly once'
  })
});

/** Measured one-time residual cost of entering a new attack family. */
export const MEASURED_ATTACK_TRANSITION_LOSS_SECONDS =
  MEASURED_ATTACK_TRANSITION_LOSS_PROVENANCE.lossMeanSeconds;

export function measuredAttackTransitionLossSeconds(): number {
  return MEASURED_ATTACK_TRANSITION_LOSS_SECONDS;
}

/**
 * Residual time carried by initiating an authored attack family after the
 * evaluator's deterministic path-time term has already been paid. Contact,
 * contest and proximity must be absent from the matched replay; their prices
 * remain separate objective terms.
 */
export function residualAttackTransitionSeconds(
  attackArrivalSeconds: number,
  stayBehindArrivalSeconds: number,
  attackOwnTimeSeconds: number,
  stayBehindOwnTimeSeconds: number
): number {
  for (const [name, value] of [
    ['attackArrivalSeconds', attackArrivalSeconds],
    ['stayBehindArrivalSeconds', stayBehindArrivalSeconds],
    ['attackOwnTimeSeconds', attackOwnTimeSeconds],
    ['stayBehindOwnTimeSeconds', stayBehindOwnTimeSeconds]
  ] as const) {
    if (!Number.isFinite(value))
      throw new RangeError(`${name} must be finite`);
  }
  if (attackArrivalSeconds < 0 || stayBehindArrivalSeconds < 0)
    throw new RangeError('arrival times must be non-negative');
  return attackArrivalSeconds - stayBehindArrivalSeconds -
    (attackOwnTimeSeconds - stayBehindOwnTimeSeconds);
}

/**
 * ℓattempt is a loss. A negative residual means ΔT already over-priced the
 * observed transition; it is evidence, but it cannot subsidize another cost.
 */
export function attackTransitionLossSeconds(
  attackArrivalSeconds: number,
  stayBehindArrivalSeconds: number,
  attackOwnTimeSeconds: number,
  stayBehindOwnTimeSeconds: number
): number {
  return Math.max(0, residualAttackTransitionSeconds(
    attackArrivalSeconds,
    stayBehindArrivalSeconds,
    attackOwnTimeSeconds,
    stayBehindOwnTimeSeconds
  ));
}

export function summarizeMeasuredAttackTransitionLoss(
  points: readonly MeasuredAttackTransitionLossPoint[]
): MeasuredAttackTransitionLossSummary {
  if (points.length === 0)
    throw new RangeError('attack-transition measurement needs samples');
  let residualSum = 0;
  let residualMinimum = Infinity;
  let residualMaximum = -Infinity;
  let lossSum = 0;
  let lossMaximum = 0;
  for (const point of points) {
    if (!Number.isFinite(point.residualSeconds) ||
        !Number.isFinite(point.lossSeconds) ||
        point.lossSeconds < 0)
      throw new RangeError('attack-transition samples must be finite');
    const expectedLoss = Math.max(0, point.residualSeconds);
    if (Math.abs(expectedLoss - point.lossSeconds) > Number.EPSILON)
      throw new RangeError(
        'attack-transition loss must be the positive residual part'
      );
    residualSum += point.residualSeconds;
    residualMinimum = Math.min(residualMinimum, point.residualSeconds);
    residualMaximum = Math.max(residualMaximum, point.residualSeconds);
    lossSum += point.lossSeconds;
    lossMaximum = Math.max(lossMaximum, point.lossSeconds);
  }
  return {
    sampleCount: points.length,
    residualMeanSeconds: residualSum / points.length,
    residualMinimumSeconds: residualMinimum,
    residualMaximumSeconds: residualMaximum,
    lossMeanSeconds: lossSum / points.length,
    lossMaximumSeconds: lossMaximum
  };
}
