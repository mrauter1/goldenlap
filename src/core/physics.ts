export interface PhysicsConstants {
  m: number; g: number; L: number; a: number; b: number; Iz: number;
  mu: number; muRearBonus: number; kDf: number; dfMax: number; dfFront: number;
  power: number; Fmax: number; tc: number; revForce: number;
  brakeForce: number; brakeBias: number; circK: number;
  kDrag: number; kRoll: number; kDragLat: number;
  slipPeakF: number; slipPeakR: number; slipSharp: number;
  steerMax: number; steerFade: number; steerLerp: number;
  yawDamp: number; vTop: number; profMu: number; brkFrac: number;
  colRadius: number; colR2: number; carLen: number; carWid: number;
}

export const PHYS: Readonly<PhysicsConstants> = {
  m: 720, g: 9.81, L: 3.10, a: 1.62, b: 1.48, Iz: 1720,
  mu: 1.70, muRearBonus: 1.08,
  kDf: 2.35, dfMax: 5200, dfFront: 0.477,
  power: 520000, Fmax: 13000, tc: 0.82, revForce: 5200,
  brakeForce: 26500, brakeBias: 0.58, circK: 0.72,
  kDrag: 0.72, kRoll: 140, kDragLat: 1.6,
  slipPeakF: 0.13, slipPeakR: 0.10, slipSharp: 1.8,
  steerMax: 0.44, steerFade: 20, steerLerp: 11,
  yawDamp: 900, vTop: 89,
  profMu: 0.93, brkFrac: 0.92,
  colRadius: 1.5, colR2: 1.0, carLen: 5.4, carWid: 2.0
};

export interface WakeParameters {
  characteristicDistance: number;
  spreadRate: number;
}

export interface WakeEffect {
  drag: number;
  grip: number;
}

/** Fraction of the follower body covered by a laterally offset wake plume. */
export function bodyOverlapFraction(
  lateralSeparation: number,
  plumeHalfWidth: number
): number {
  const bodyHalfWidth = PHYS.carWid / 2;
  const separation = Math.abs(lateralSeparation);
  const plumeMinimum = separation - Math.max(0, plumeHalfWidth);
  const plumeMaximum = separation + Math.max(0, plumeHalfWidth);
  const overlap = Math.max(
    0,
    Math.min(bodyHalfWidth, plumeMaximum) -
      Math.max(-bodyHalfWidth, plumeMinimum)
  );
  return Math.min(1, overlap / PHYS.carWid);
}

/**
 * One wake object shared by drag and grip consumers. The longitudinal form is
 * the existing smooth inverse-square decay; only physical body coverage turns
 * it into a lateral effect.
 */
export function wakeEffect(
  downstreamDistance: number,
  lateralSeparation: number,
  speed: number,
  parameters: WakeParameters
): WakeEffect {
  const distance = Math.max(0, downstreamDistance);
  const wakeScale = Math.max(
    Number.EPSILON,
    parameters.characteristicDistance,
    Math.max(0, speed)
  );
  const ratio = distance / wakeScale;
  const longitudinal = Math.min(0.8, 1 / (1 + ratio * ratio));
  const plumeHalfWidth = PHYS.carWid / 2 +
    Math.max(0, parameters.spreadRate) * distance;
  const strength = longitudinal * bodyOverlapFraction(
    lateralSeparation,
    plumeHalfWidth
  );
  return { drag: strength, grip: strength };
}

/**
 * Maximum steady-state corner speed under the production tyre/downforce law.
 * Callers may add longitudinal profile limits, but no caller re-derives this
 * lateral limit.
 */
export function cornerSpeedForGrip(
  curvature: number,
  muScale = 1,
  downforceScale = 1
): number {
  const k = Math.abs(curvature);
  if (k <= 1e-9) return PHYS.vTop;
  const mu = PHYS.mu * PHYS.profMu * Math.max(0.01, muScale);
  const aeroScale = Math.max(0, downforceScale);
  const downforceCoefficient = mu * PHYS.kDf * aeroScale / PHYS.m;
  const uncappedSquared = k > downforceCoefficient + 1e-9
    ? mu * PHYS.g / (k - downforceCoefficient)
    : Infinity;
  const scaledDownforceCap = PHYS.dfMax * aeroScale;
  const downforceCapSpeedSquared = aeroScale > 1e-9
    ? PHYS.dfMax / PHYS.kDf
    : 0;
  const speedSquared = uncappedSquared <= downforceCapSpeedSquared
    ? uncappedSquared
    : mu * (PHYS.g + scaledDownforceCap / PHYS.m) / k;
  return Math.min(PHYS.vTop, Math.sqrt(Math.max(0, speedSquared)));
}

/** Total grip acceleration available before the friction-circle split. */
export function availableDeceleration(
  speed: number,
  muScale = 1,
  downforceScale = 1
): number {
  const velocity = Math.max(0, speed);
  const gripScale = Math.max(0.01, muScale);
  const aeroScale = Math.max(0, downforceScale);
  return PHYS.mu * PHYS.profMu * gripScale *
    (PHYS.g + Math.min(PHYS.kDf * velocity * velocity, PHYS.dfMax) *
      aeroScale / PHYS.m);
}

/** Longitudinal acceleration left after the current path consumes lateral grip. */
export function longitudinalAccelerationHeadroom(
  speed: number,
  curvature: number,
  muScale = 1,
  downforceScale = 1
): number {
  const total = availableDeceleration(speed, muScale, downforceScale);
  const lateral = Math.max(0, speed) ** 2 * Math.abs(curvature);
  return Math.sqrt(Math.max(0, total * total - lateral * lateral));
}

/** Share of the friction circle available for longitudinal speed changes. */
export function longitudinalGripHeadroomFraction(
  speed: number,
  curvature: number,
  muScale = 1,
  downforceScale = 1
): number {
  const total = availableDeceleration(speed, muScale, downforceScale);
  return total <= 1e-9
    ? 0
    : Math.min(1, longitudinalAccelerationHeadroom(
        speed,
        curvature,
        muScale,
        downforceScale
      ) / total);
}

/**
 * Stop distance under the same speed-dependent grip/downforce model used by
 * the controller. This is the analytic integral of v / a(v), including the
 * downforce cap, rather than a fixed guessed deceleration.
 */
export function brakingDistance(
  speed: number,
  muScale = 1,
  effort = 1,
  downforceScale = 1
): number {
  const velocity = Math.max(0, speed);
  if (velocity <= 0) return 0;
  const scale = PHYS.mu * PHYS.profMu * Math.max(0.01, muScale) *
    Math.max(0.05, effort);
  const aeroScale = Math.max(0, downforceScale);
  const downforcePerMass = PHYS.kDf * aeroScale / PHYS.m;
  if (downforcePerMass <= 1e-12)
    return velocity * velocity / (2 * scale * PHYS.g);
  const capSpeed = Math.sqrt(PHYS.dfMax / PHYS.kDf);
  const integratedBelowCap = (upper: number): number =>
    Math.log((PHYS.g + downforcePerMass * upper * upper) / PHYS.g) /
      (2 * scale * downforcePerMass);
  if (velocity <= capSpeed) return integratedBelowCap(velocity);
  const cappedAcceleration = scale *
    (PHYS.g + PHYS.dfMax * aeroScale / PHYS.m);
  return integratedBelowCap(capSpeed) +
    (velocity * velocity - capSpeed * capSpeed) / (2 * cappedAcceleration);
}

/** Instantaneous deceleration after a full lift, derived from drag and rolling resistance. */
export function liftDeceleration(speed: number, dragScale = 1): number {
  const velocity = Math.max(0, speed);
  return (PHYS.kDrag * Math.max(0, dragScale) * velocity * velocity + PHYS.kRoll) /
    PHYS.m;
}

/** Largest speed that can reach finalSpeed after the supplied braking room. */
export function brakingSpeedCap(
  distance: number,
  finalSpeed = 0,
  muScale = 1,
  effort = 1,
  downforceScale = 1
): number {
  const targetDistance = Math.max(0, distance) +
    brakingDistance(finalSpeed, muScale, effort, downforceScale);
  let low = Math.max(0, finalSpeed);
  let high = Math.max(PHYS.vTop * 1.2, low + 20);
  if (brakingDistance(high, muScale, effort, downforceScale) <= targetDistance)
    return Infinity;
  for (let iteration = 0; iteration < 14; iteration++) {
    const middle = (low + high) / 2;
    if (brakingDistance(middle, muScale, effort, downforceScale) <= targetDistance)
      low = middle;
    else high = middle;
  }
  return low;
}

export const SURF = {
  road: { mu: 1.00, drag: 0 },
  curb: { mu: 0.94, drag: 2.5 },
  grass: { mu: 0.52, drag: 30 }
} as const;
