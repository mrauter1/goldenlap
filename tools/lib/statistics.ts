export interface Interval {
  lower: number;
  upper: number;
}

export interface MetricBounds {
  minimum?: number;
  maximum?: number;
}

export type MetricClassification = 'invariant' | 'distribution' | 'target';
export type MetricStatus = 'green' | 'amber' | 'red' | 'inconclusive';

export interface MetricPolicy {
  id: string;
  unit: string;
  scope: string;
  aggregation: string;
  distribution: string;
  minimumSamples: number;
  classification: MetricClassification;
  normal?: MetricBounds;
  acceptable?: MetricBounds;
  absolute?: MetricBounds;
  rationale: string;
  owner: string;
}

export interface MetricObservation {
  metric: string;
  value: number;
  samples?: number;
  interval?: Interval;
  stratum?: string;
}

export interface MetricResult extends MetricObservation {
  status: MetricStatus;
  reason: string;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertProbability(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0 || value >= 1) throw new Error(`${name} must be between 0 and 1`);
}

/** R-7 empirical quantile, matching the common linear interpolation rule. */
export function empiricalQuantile(values: readonly number[], probability: number): number {
  if (!values.length) throw new Error('empiricalQuantile requires at least one value');
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new Error('probability must be between 0 and 1');
  const sorted = [...values];
  for (const value of sorted) assertFinite(value, 'sample');
  sorted.sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const first = sorted[lower]!;
  const second = sorted[Math.min(sorted.length - 1, lower + 1)]!;
  return first + (second - first) * fraction;
}

/**
 * Approximate central confidence interval for a population quantile using
 * sample order statistics. The rank uncertainty is binomial and therefore
 * does not assume a Gaussian metric distribution; the existing inverse-normal
 * approximation selects conservative bounded ranks without a new dependency.
 */
export function empiricalQuantileInterval(
  values: readonly number[],
  probability: number,
  confidence = 0.95
): Interval {
  if (!values.length) throw new Error('empiricalQuantileInterval requires at least one value');
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new Error('probability must be between 0 and 1');
  assertProbability(confidence, 'confidence');
  const sorted = [...values];
  for (const value of sorted) assertFinite(value, 'sample');
  sorted.sort((left, right) => left - right);
  if (sorted.length === 1 || probability === 0 || probability === 1) {
    const value = empiricalQuantile(sorted, probability);
    return { lower: value, upper: value };
  }
  const z = inverseNormalCdf(0.5 + confidence / 2);
  const meanRank = (sorted.length - 1) * probability;
  const rankDeviation = z * Math.sqrt(sorted.length * probability * (1 - probability));
  const lowerIndex = Math.max(0, Math.floor(meanRank - rankDeviation - 0.5));
  const upperIndex = Math.min(
    sorted.length - 1,
    Math.ceil(meanRank + rankDeviation + 0.5)
  );
  return { lower: sorted[lowerIndex]!, upper: sorted[upperIndex]! };
}

// Peter J. Acklam's inverse-normal approximation, sufficient for confidence
// intervals without adding a statistics runtime dependency.
export function inverseNormalCdf(probability: number): number {
  assertProbability(probability, 'probability');
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996, 3.754408661907416
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(
  successes: number,
  total: number,
  confidence = 0.95
): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 ||
      successes < 0 || successes > total)
    throw new Error('wilsonInterval requires integer 0 <= successes <= total and total > 0');
  assertProbability(confidence, 'confidence');
  const z = inverseNormalCdf(0.5 + confidence / 2);
  const z2 = z * z;
  const proportion = successes / total;
  const denominator = 1 + z2 / total;
  const center = (proportion + z2 / (2 * total)) / denominator;
  const radius = z * Math.sqrt(
    proportion * (1 - proportion) / total + z2 / (4 * total * total)
  ) / denominator;
  return {
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius)
  };
}

function chiSquareQuantileApprox(probability: number, degrees: number): number {
  assertProbability(probability, 'probability');
  if (!Number.isFinite(degrees) || degrees <= 0)
    throw new Error('degrees must be positive');
  const z = inverseNormalCdf(probability);
  const base = 1 - 2 / (9 * degrees) + z * Math.sqrt(2 / (9 * degrees));
  return degrees * Math.max(0, base) ** 3;
}

/**
 * Two-sided Garwood-style Poisson rate interval. The chi-square quantiles use
 * the Wilson-Hilferty approximation; the zero-event upper bound is exact.
 */
export function poissonRateInterval(
  events: number,
  exposure: number,
  confidence = 0.95
): Interval {
  if (!Number.isInteger(events) || events < 0)
    throw new Error('events must be a non-negative integer');
  if (!Number.isFinite(exposure) || exposure <= 0)
    throw new Error('exposure must be positive');
  assertProbability(confidence, 'confidence');
  const alpha = 1 - confidence;
  if (events === 0) {
    return { lower: 0, upper: -Math.log(alpha / 2) / exposure };
  }
  return {
    lower: 0.5 * chiSquareQuantileApprox(alpha / 2, 2 * events) / exposure,
    upper: 0.5 * chiSquareQuantileApprox(1 - alpha / 2, 2 * (events + 1)) / exposure
  };
}

function belowMinimum(value: number, bounds: MetricBounds | undefined): boolean {
  return bounds?.minimum !== undefined && value < bounds.minimum;
}

function aboveMaximum(value: number, bounds: MetricBounds | undefined): boolean {
  return bounds?.maximum !== undefined && value > bounds.maximum;
}

function inside(value: number, bounds: MetricBounds | undefined): boolean {
  return !belowMinimum(value, bounds) && !aboveMaximum(value, bounds);
}

function intervalInside(interval: Interval, bounds: MetricBounds | undefined): boolean {
  return !belowMinimum(interval.lower, bounds) && !aboveMaximum(interval.upper, bounds);
}

function intervalWhollyOutside(interval: Interval, bounds: MetricBounds | undefined): boolean {
  if (!bounds) return false;
  return (bounds.minimum !== undefined && interval.upper < bounds.minimum) ||
    (bounds.maximum !== undefined && interval.lower > bounds.maximum);
}

export function classifyMetric(
  policy: MetricPolicy,
  observation: MetricObservation
): MetricResult {
  if (!Number.isInteger(policy.minimumSamples) || policy.minimumSamples <= 0)
    throw new Error(`${policy.id} minimumSamples must be a positive integer`);
  assertFinite(observation.value, `${policy.id} value`);
  if (observation.metric !== policy.id)
    throw new Error(`Observation ${observation.metric} does not match policy ${policy.id}`);
  if (observation.interval) {
    assertFinite(observation.interval.lower, `${policy.id} interval lower`);
    assertFinite(observation.interval.upper, `${policy.id} interval upper`);
    if (observation.interval.lower > observation.interval.upper)
      throw new Error(`${policy.id} interval is reversed`);
  }
  if (policy.classification === 'target') {
    return { ...observation, status: 'green', reason: 'target-only metric' };
  }
  if (!inside(observation.value, policy.absolute)) {
    return { ...observation, status: 'red', reason: 'observed value exceeds absolute boundary' };
  }
  if (policy.classification === 'invariant') {
    const status = inside(observation.value, policy.acceptable) ? 'green' : 'red';
    return {
      ...observation,
      status,
      reason: status === 'green' ? 'invariant holds' : 'invariant violated'
    };
  }
  const samples = observation.samples ?? 1;
  if (!Number.isInteger(samples) || samples < 0)
    throw new Error(`${policy.id} samples must be a non-negative integer`);
  if (samples < policy.minimumSamples) {
    return {
      ...observation,
      status: 'inconclusive',
      reason: `requires at least ${policy.minimumSamples} samples; received ${samples}`
    };
  }
  const interval = observation.interval;
  if (interval) {
    if (intervalWhollyOutside(interval, policy.acceptable))
      return { ...observation, status: 'red', reason: 'confidence interval is outside acceptable boundary' };
    if (!intervalInside(interval, policy.acceptable))
      return { ...observation, status: 'inconclusive', reason: 'confidence interval crosses acceptable boundary' };
    if (intervalInside(interval, policy.normal))
      return { ...observation, status: 'green', reason: 'confidence interval is inside normal boundary' };
    return { ...observation, status: 'amber', reason: 'inside acceptable boundary but outside normal boundary' };
  }
  if (inside(observation.value, policy.normal))
    return { ...observation, status: 'green', reason: 'inside normal boundary' };
  if (inside(observation.value, policy.acceptable))
    return { ...observation, status: 'amber', reason: 'inside acceptable boundary but outside normal boundary' };
  return { ...observation, status: 'red', reason: 'outside acceptable boundary' };
}

export function stratify<T>(
  values: readonly T[],
  keyOf: (value: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}
