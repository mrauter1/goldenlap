import {
  carBodyCircleClearance,
  CAR_COLLISION_CONTACT_SLOP_METRES,
  collideCars,
  HARD_CONTACT_IMPULSE
} from '../src/core/collision';
import {
  botStep,
  PATH_FOLLOWER_SETTLE_DISTANCE
} from '../src/core/autopilot';
import type {
  BuiltTrack,
  Car,
  CarInput,
  SampledPath,
  SurfaceState
} from '../src/core/model';
import { numericArray } from '../src/core/model';
import {
  availableDeceleration,
  liftDeceleration,
  PHYS,
  SURF
} from '../src/core/physics';
import {
  makeCar,
  stepCar,
  trackSense
} from '../src/core/physics-engine';
import {
  derivePathGeometry,
  materializePath
} from '../src/core/racing-line';
import { PIT_TEAMS, TRACK_DEFS } from '../src/data/tracks';
import { buildTrackDefinition } from '../src/game/tracks';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from
  '../src/session/racecraft/cadence';
import { RACECRAFT_CALIBRATION_DEFAULTS } from
  '../src/session/racecraft/config';
import { TRAF_DT } from '../src/session/strategy';

interface MotionSample {
  timeSeconds: number;
  longitudinalMetres: number;
}

export interface ContactLossMeasurement {
  requestedRelativeNormalSpeed: number;
  measuredRelativeNormalSpeed: number;
  forwardRecoverySeconds: number;
  lateralRecoverySeconds: number;
  recoverySeconds: number;
  secondsLost: number;
}

export interface ContactLossMeasurementReport {
  schemaVersion: 2;
  kind: 'measured-contact-loss';
  method: 'stable-car lateral strike versus identical no-contact control';
  physicsStepSeconds: number;
  referenceSpeedMetresPerSecond: number;
  hardContactBoundaryMetresPerSecond: number;
  maximumRelativeNormalSpeedMetresPerSecond: number;
  relativeNormalSpeedStepMetresPerSecond: number;
  maximumMeasurementSeconds: number;
  contactLateralSeparationMetres: number;
  rows: ContactLossMeasurement[];
}

export interface ContactGrindLossMeasurement {
  durationSeconds: number;
  impactCount: number;
  totalRecoverySeconds: number;
  totalSecondsLost: number;
  additionalSecondsLost: number;
}

export interface ContactGrindLossMeasurementReport {
  schemaVersion: 1;
  kind: 'measured-contact-grind-loss';
  method:
    'one-sided sustained lateral pressure versus identical no-contact control';
  physicsStepSeconds: number;
  referenceSpeedMetresPerSecond: number;
  pressureRelativeNormalSpeedMetresPerSecond: number;
  durationStepSeconds: number;
  maximumDurationSeconds: number;
  contactLateralSeparationMetres: number;
  baselineSingleStrikeLossSeconds: number;
  rows: ContactGrindLossMeasurement[];
}

export interface ParallelHoldContactRateMeasurement {
  clearanceMetres: number;
  baseExposureSeconds: number;
  baseExposureEpisodeStarts: number;
  baseExposureEpisodeStartsPerSecond: number;
  exposureSeconds: number;
  episodeStarts: number;
  episodeStartsPerSecond: number;
  contactStepSeconds: number;
  contactSecondsPerExposureSecond: number;
  meanEpisodeDurationSeconds: number;
  directSecondsLost: number;
  directSecondsLostPerExposureSecond: number;
  directSecondsLostPerEpisode: number;
  offSurfaceTerminations: number;
}

export interface ParallelHoldContactRateConvergence {
  baseClearanceIntervalCount: number;
  refinedClearanceIntervalCount: number;
  maximumEpisodeRateGridDifferencePerSecond: number;
  baseExposureSecondsPerScenario: number;
  refinedExposureSecondsPerScenario: number;
  maximumEpisodeRateExposureDifferencePerSecond: number;
  maximumContactFractionExposureDifference: number;
  maximumDirectLossRateExposureDifference: number;
  exposureConvergedAtNumericalPrecision: boolean;
}

export interface ParallelHoldContactRateMeasurementReport {
  schemaVersion: 1;
  kind: 'measured-parallel-hold-contact-rate';
  method:
    'production path follower and collision physics on symmetric parallel paths';
  physicsStepSeconds: number;
  controlStepSeconds: number;
  deliberationIntervalSeconds: number;
  referenceSpeedMetresPerSecond: number;
  bodyContactCentreSeparationMetres: number;
  maximumClearanceMetres: number;
  clearanceStepMetres: number;
  settleDistanceMetres: number;
  minimumStraightDistanceMetres: number;
  exposureSecondsPerScenario: number;
  sourceTrackIds: string[];
  scenarioCountPerClearance: number;
  analyticGaussianUsedAsSource: false;
  convergence: ParallelHoldContactRateConvergence;
  rows: ParallelHoldContactRateMeasurement[];
}

const PHYSICS_STEP_SECONDS = 1 / 120;
const CONTROL_STEP_SECONDS = PHYSICS_STEP_SECONDS * 2;
const REFERENCE_SPEED_METRES_PER_SECOND =
  Math.sqrt(PHYS.dfMax / PHYS.kDf);
const RELATIVE_NORMAL_SPEED_STEP =
  2 * availableDeceleration(REFERENCE_SPEED_METRES_PER_SECOND) * TRAF_DT;
const MAXIMUM_RELATIVE_NORMAL_SPEED = 2 * PHYS.vTop;
const MAXIMUM_MEASUREMENT_SECONDS =
  PHYS.vTop / liftDeceleration(PHYS.vTop);
const CONTACT_LATERAL_SEPARATION =
  PHYS.carWid - PHYS.colR2 / 2;
const MAXIMUM_GRIND_DURATION_SECONDS =
  RACECRAFT_CALIBRATION_DEFAULTS.predictionHorizonSeconds;
const PARALLEL_HOLD_BODY_CONTACT_SEPARATION =
  2 * PHYS.colR2 - CAR_COLLISION_CONTACT_SLOP_METRES;
const PARALLEL_HOLD_MAXIMUM_CLEARANCE = PHYS.carWid;
const PARALLEL_HOLD_BASE_CLEARANCE_INTERVALS = Math.round(
  RACECRAFT_DECISION_INTERVAL_SECONDS / PHYSICS_STEP_SECONDS
);
const PARALLEL_HOLD_REFINED_CLEARANCE_INTERVALS =
  2 * PARALLEL_HOLD_BASE_CLEARANCE_INTERVALS;
const PARALLEL_HOLD_CLEARANCE_STEP =
  PARALLEL_HOLD_MAXIMUM_CLEARANCE /
  PARALLEL_HOLD_REFINED_CLEARANCE_INTERVALS;
const PARALLEL_HOLD_BASE_EXPOSURE_SECONDS =
  RACECRAFT_CALIBRATION_DEFAULTS.predictionHorizonSeconds;
const PARALLEL_HOLD_EXPOSURE_SECONDS =
  2 * PARALLEL_HOLD_BASE_EXPOSURE_SECONDS;
const ROAD_SURFACE: SurfaceState = {
  zone: 'road',
  mu: SURF.road.mu,
  drag: SURF.road.drag,
  lat: 0
};
const RECOVERY_INPUT: CarInput = {
  steer: 0,
  throttle: 1,
  brake: 0,
  hand: false
};

interface ParallelHoldScenario {
  trackId: string;
  built: BuiltTrack;
  startIndex: number;
}

interface ParallelHoldAccumulator {
  exposureSeconds: number;
  episodeStarts: number;
  contactStepSeconds: number;
  directSecondsLost: number;
  offSurfaceTerminations: number;
}

interface ParallelHoldTrial {
  base: ParallelHoldAccumulator;
  refined: ParallelHoldAccumulator;
}

function relativeNormalSpeedGrid(): number[] {
  const speeds = [0];
  for (let speed = RELATIVE_NORMAL_SPEED_STEP;
    speed < MAXIMUM_RELATIVE_NORMAL_SPEED;
    speed += RELATIVE_NORMAL_SPEED_STEP)
    speeds.push(speed);
  speeds.push(HARD_CONTACT_IMPULSE, MAXIMUM_RELATIVE_NORMAL_SPEED);
  return [...new Set(speeds)].sort((left, right) => left - right);
}

function sustainedContactDurationGrid(): number[] {
  const steps = Math.round(
    MAXIMUM_GRIND_DURATION_SECONDS /
    RACECRAFT_DECISION_INTERVAL_SECONDS
  );
  if (Math.abs(
    steps * RACECRAFT_DECISION_INTERVAL_SECONDS -
    MAXIMUM_GRIND_DURATION_SECONDS
  ) > PHYSICS_STEP_SECONDS / 2)
    throw new Error(
      'contact horizon must be an integer number of deliberation intervals'
    );
  return Array.from(
    { length: steps + 1 },
    (_, index) => index * RACECRAFT_DECISION_INTERVAL_SECONDS
  );
}

function parallelHoldClearanceGrid(): number[] {
  return Array.from(
    { length: PARALLEL_HOLD_REFINED_CLEARANCE_INTERVALS + 1 },
    (_, index) => index * PARALLEL_HOLD_CLEARANCE_STEP
  );
}

function parallelHoldScenarios(): ParallelHoldScenario[] {
  const scenarios: ParallelHoldScenario[] = [];
  const requiredStraightDistance =
    PATH_FOLLOWER_SETTLE_DISTANCE +
    PHYS.vTop * PARALLEL_HOLD_EXPOSURE_SECONDS;
  for (const definition of TRACK_DEFS) {
    const built = buildTrackDefinition(definition, PIT_TEAMS, {
      requireProfile: true,
      warn: false
    });
    const corners = [...built.tr.corners].sort(
      (left, right) => left.apexI - right.apexI
    );
    let trackScenarioCount = 0;
    for (let index = 0; index < corners.length; index++) {
      const corner = corners[index]!;
      const previous = corners[
        (index - 1 + corners.length) % corners.length
      ]!;
      const distance = (
        (corner.brakeI - previous.trackOutI + built.tr.n) % built.tr.n
      ) * built.tr.step;
      if (distance < requiredStraightDistance ||
          distance >= built.tr.len / 2)
        continue;
      scenarios.push({
        trackId: definition.id,
        built,
        startIndex: previous.trackOutI
      });
      trackScenarioCount++;
    }
    if (trackScenarioCount > 0) continue;
  }
  if (scenarios.length === 0)
    throw new Error(
      'no shipped straight spans one settled refined parallel-hold exposure'
    );
  return scenarios;
}

function synchronizedParallelPaths(
  built: BuiltTrack,
  clearanceMetres: number
): readonly [SampledPath, SampledPath] {
  const build = (
    centreSeparation: number
  ): readonly [SampledPath, SampledPath] => {
    const negativeOffset = numericArray(built.tr.n);
    const positiveOffset = numericArray(built.tr.n);
    negativeOffset.fill(-centreSeparation / 2);
    positiveOffset.fill(centreSeparation / 2);
    return [
      materializePath(built.tr, negativeOffset, 'side-inside'),
      materializePath(built.tr, positiveOffset, 'side-outside')
    ];
  };
  const minimumBodyClearance = (
    paths: readonly [SampledPath, SampledPath]
  ): number => {
    const negativeGeometry = derivePathGeometry(built.tr, paths[0]);
    const positiveGeometry = derivePathGeometry(built.tr, paths[1]);
    let minimum = Infinity;
    for (let index = 0; index < built.tr.n; index++) {
      const negativeHeading = Math.atan2(
        negativeGeometry.ty[index]!,
        negativeGeometry.tx[index]!
      );
      const positiveHeading = Math.atan2(
        positiveGeometry.ty[index]!,
        positiveGeometry.tx[index]!
      );
      const dx = positiveGeometry.x[index]! - negativeGeometry.x[index]!;
      const dy = positiveGeometry.y[index]! - negativeGeometry.y[index]!;
      minimum = Math.min(minimum, carBodyCircleClearance(
        dx * Math.cos(negativeHeading) + dy * Math.sin(negativeHeading),
        -dx * Math.sin(negativeHeading) + dy * Math.cos(negativeHeading),
        0,
        positiveHeading - negativeHeading
      ));
    }
    return minimum;
  };

  let centreSeparation =
    PARALLEL_HOLD_BODY_CONTACT_SEPARATION + clearanceMetres;
  let paths = build(centreSeparation);
  let residual = minimumBodyClearance(paths) - clearanceMetres;
  // Constant normal offsets are analytically parallel. The sampled path
  // tangent introduces a sub-millimetre discretization residual. A secant
  // solve removes it so the independent variable remains exact body
  // clearance; its second seed is the cadence-derived base grid step.
  let previousSeparation = centreSeparation;
  let previousResidual = residual;
  centreSeparation +=
    PARALLEL_HOLD_MAXIMUM_CLEARANCE /
    PARALLEL_HOLD_BASE_CLEARANCE_INTERVALS;
  paths = build(centreSeparation);
  residual = minimumBodyClearance(paths) - clearanceMetres;
  const numericalTolerance =
    Number.EPSILON * Math.max(1, PARALLEL_HOLD_MAXIMUM_CLEARANCE) * 512;
  const maximumIterations = Math.ceil(-Math.log2(Number.EPSILON));
  for (let iteration = 0;
    Math.abs(residual) > numericalTolerance &&
    iteration < maximumIterations;
    iteration++) {
    const slope = (residual - previousResidual) /
      (centreSeparation - previousSeparation);
    if (!Number.isFinite(slope) || Math.abs(slope) <= Number.EPSILON)
      break;
    const nextSeparation = centreSeparation - residual / slope;
    previousSeparation = centreSeparation;
    previousResidual = residual;
    centreSeparation = nextSeparation;
    paths = build(centreSeparation);
    residual = minimumBodyClearance(paths) - clearanceMetres;
  }
  const measuredMinimum = clearanceMetres + residual;
  if (Math.abs(measuredMinimum - clearanceMetres) >
      numericalTolerance)
    throw new Error(
      `parallel path body clearance correction failed by ` +
      `${measuredMinimum - clearanceMetres} m on ${built.def.id}`
    );

  // Equal centreline progress keeps the bodies side-by-side while respecting
  // the tighter member's local grip limit. Offset paths have different ds;
  // copying one member's speed would create a longitudinal experiment.
  for (let index = 0; index < built.tr.n; index++) {
    const progressRate = Math.min(
      paths[0].v[index]! / paths[0].ds[index]!,
      paths[1].v[index]! / paths[1].ds[index]!
    );
    paths[0].v[index] = progressRate * paths[0].ds[index]!;
    paths[1].v[index] = progressRate * paths[1].ds[index]!;
  }
  return paths;
}

function carOnPath(
  built: BuiltTrack,
  path: SampledPath,
  index: number
): Car {
  const geometry = derivePathGeometry(built.tr, path);
  const car = makeCar(
    geometry.x[index]!,
    geometry.y[index]!,
    Math.atan2(geometry.ty[index]!, geometry.tx[index]!)
  );
  // botStep's production default margin is 0.965. Starting at that target
  // removes an artificial launch transient without changing the controller.
  car.vx = path.v[index]! * 0.965;
  car.spd = car.vx;
  car.progIdx = index;
  car.s = index * built.tr.step;
  return car;
}

interface ControlledParallelCar {
  car: Car;
  path: SampledPath;
  input: CarInput;
  lastS: number;
  progressMetres: number;
}

function controlledParallelCar(
  built: BuiltTrack,
  path: SampledPath,
  index: number
): ControlledParallelCar {
  const car = carOnPath(built, path, index);
  trackSense(built.tr, car);
  return {
    car,
    path,
    input: { steer: 0, throttle: 0, brake: 0, hand: false },
    lastS: car.s,
    progressMetres: 0
  };
}

function signedTrackStep(
  length: number,
  from: number,
  to: number
): number {
  let distance = ((to - from) % length + length) % length;
  if (distance > length / 2) distance -= length;
  return distance;
}

function driveParallelCar(
  built: BuiltTrack,
  controlled: ControlledParallelCar,
  step: number
): void {
  const surface = trackSense(built.tr, controlled.car);
  if (step % Math.round(CONTROL_STEP_SECONDS / PHYSICS_STEP_SECONDS) === 0)
    controlled.input = botStep(
      built.tr,
      built.prof,
      controlled.car,
      { path: controlled.path }
    );
  stepCar(
    controlled.car,
    controlled.input,
    surface,
    PHYSICS_STEP_SECONDS
  );
}

function sampleParallelProgress(
  built: BuiltTrack,
  controlled: ControlledParallelCar
): boolean {
  const surface = trackSense(built.tr, controlled.car);
  controlled.progressMetres += signedTrackStep(
    built.tr.len,
    controlled.lastS,
    controlled.car.s
  );
  controlled.lastS = controlled.car.s;
  return surface.zone === 'road';
}

function directParallelLossSeconds(
  actual: readonly [ControlledParallelCar, ControlledParallelCar],
  control: readonly [ControlledParallelCar, ControlledParallelCar]
): number {
  const distanceDeficit = Math.max(0, (
    control[0].progressMetres + control[1].progressMetres -
    actual[0].progressMetres - actual[1].progressMetres
  ) / 2);
  const controlSpeed = (
    Math.hypot(control[0].car.vx, control[0].car.vy) +
    Math.hypot(control[1].car.vx, control[1].car.vy)
  ) / 2;
  return distanceDeficit / Math.max(Number.EPSILON, controlSpeed);
}

function parallelCarsInContact(first: Car, second: Car): boolean {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const cosine = Math.cos(first.h);
  const sine = Math.sin(first.h);
  return carBodyCircleClearance(
    dx * cosine + dy * sine,
    -dx * sine + dy * cosine,
    0,
    second.h - first.h
  ) < 0;
}

function snapshotParallelAccumulator(
  exposureSeconds: number,
  episodeStarts: number,
  contactStepSeconds: number,
  actual: readonly [ControlledParallelCar, ControlledParallelCar],
  control: readonly [ControlledParallelCar, ControlledParallelCar],
  offSurfaceTerminations = 0
): ParallelHoldAccumulator {
  return {
    exposureSeconds,
    episodeStarts,
    contactStepSeconds,
    directSecondsLost: directParallelLossSeconds(actual, control),
    offSurfaceTerminations
  };
}

function measureParallelHoldTrial(
  scenario: ParallelHoldScenario,
  paths: readonly [SampledPath, SampledPath]
): ParallelHoldTrial {
  const actual = [
    controlledParallelCar(scenario.built, paths[0], scenario.startIndex),
    controlledParallelCar(scenario.built, paths[1], scenario.startIndex)
  ] as const;
  const control = [
    controlledParallelCar(scenario.built, paths[0], scenario.startIndex),
    controlledParallelCar(scenario.built, paths[1], scenario.startIndex)
  ] as const;

  let step = 0;
  const maximumSettleSteps = Math.ceil(
    scenario.built.prof.lapTime / PHYSICS_STEP_SECONDS
  );
  while (Math.min(
    actual[0].progressMetres,
    actual[1].progressMetres
  ) < PATH_FOLLOWER_SETTLE_DISTANCE) {
    for (const controlled of [...actual, ...control])
      driveParallelCar(scenario.built, controlled, step);
    for (const controlled of [...actual, ...control])
      if (!sampleParallelProgress(scenario.built, controlled))
        throw new Error(
          `parallel-hold controller left the road while settling on ` +
          `${scenario.trackId}`
        );
    step++;
    if (step > maximumSettleSteps)
      throw new Error(
        `parallel-hold controller did not settle on ${scenario.trackId}`
      );
  }
  for (const controlled of [...actual, ...control]) {
    controlled.progressMetres = 0;
    controlled.lastS = controlled.car.s;
  }

  const baseSteps = Math.round(
    PARALLEL_HOLD_BASE_EXPOSURE_SECONDS / PHYSICS_STEP_SECONDS
  );
  const refinedSteps = Math.round(
    PARALLEL_HOLD_EXPOSURE_SECONDS / PHYSICS_STEP_SECONDS
  );
  let episodeStarts = 0;
  let contactSteps = 0;
  let previousContact = false;
  let base: ParallelHoldAccumulator | null = null;
  for (let exposureStep = 0; exposureStep < refinedSteps; exposureStep++) {
    for (const controlled of [...actual, ...control])
      driveParallelCar(scenario.built, controlled, step);
    const contact = parallelCarsInContact(
      actual[0].car,
      actual[1].car
    );
    collideCars([
      actual[0].car,
      actual[1].car
    ]);
    if (contact && !previousContact) episodeStarts++;
    if (contact) contactSteps++;
    previousContact = contact;
    const actualOnRoad = actual.map(controlled =>
      sampleParallelProgress(scenario.built, controlled)
    ).every(Boolean);
    const controlOnRoad = control.map(controlled =>
      sampleParallelProgress(scenario.built, controlled)
    ).every(Boolean);
    if (!controlOnRoad)
      throw new Error(
        `parallel-hold no-contact control left the road on ` +
        `${scenario.trackId}`
      );
    step++;

    if (exposureStep + 1 === baseSteps)
      base = snapshotParallelAccumulator(
        PARALLEL_HOLD_BASE_EXPOSURE_SECONDS,
        episodeStarts,
        contactSteps * PHYSICS_STEP_SECONDS,
        actual,
        control
      );
    if (!actualOnRoad) {
      const elapsedSeconds = (exposureStep + 1) * PHYSICS_STEP_SECONDS;
      const terminated = snapshotParallelAccumulator(
        elapsedSeconds,
        episodeStarts,
        contactSteps * PHYSICS_STEP_SECONDS,
        actual,
        control,
        1
      );
      return {
        base: base ?? terminated,
        refined: terminated
      };
    }
  }
  if (!base)
    throw new Error('parallel-hold base exposure was not sampled');
  return {
    base,
    refined: snapshotParallelAccumulator(
      PARALLEL_HOLD_EXPOSURE_SECONDS,
      episodeStarts,
      contactSteps * PHYSICS_STEP_SECONDS,
      actual,
      control
    )
  };
}

function emptyParallelAccumulator(): ParallelHoldAccumulator {
  return {
    exposureSeconds: 0,
    episodeStarts: 0,
    contactStepSeconds: 0,
    directSecondsLost: 0,
    offSurfaceTerminations: 0
  };
}

function addParallelAccumulator(
  target: ParallelHoldAccumulator,
  source: ParallelHoldAccumulator
): void {
  target.exposureSeconds += source.exposureSeconds;
  target.episodeStarts += source.episodeStarts;
  target.contactStepSeconds += source.contactStepSeconds;
  target.directSecondsLost += source.directSecondsLost;
  target.offSurfaceTerminations += source.offSurfaceTerminations;
}

function parallelMeasurement(
  clearanceMetres: number,
  value: ParallelHoldAccumulator,
  base: ParallelHoldAccumulator
): ParallelHoldContactRateMeasurement {
  const exposure = Math.max(Number.EPSILON, value.exposureSeconds);
  const baseExposure = Math.max(Number.EPSILON, base.exposureSeconds);
  return {
    clearanceMetres,
    baseExposureSeconds: base.exposureSeconds,
    baseExposureEpisodeStarts: base.episodeStarts,
    baseExposureEpisodeStartsPerSecond:
      base.episodeStarts / baseExposure,
    exposureSeconds: value.exposureSeconds,
    episodeStarts: value.episodeStarts,
    episodeStartsPerSecond: value.episodeStarts / exposure,
    contactStepSeconds: value.contactStepSeconds,
    contactSecondsPerExposureSecond:
      value.contactStepSeconds / exposure,
    meanEpisodeDurationSeconds: value.episodeStarts > 0
      ? value.contactStepSeconds / value.episodeStarts
      : 0,
    directSecondsLost: value.directSecondsLost,
    directSecondsLostPerExposureSecond:
      value.directSecondsLost / exposure,
    directSecondsLostPerEpisode: value.episodeStarts > 0
      ? value.directSecondsLost / value.episodeStarts
      : 0,
    offSurfaceTerminations: value.offSurfaceTerminations
  };
}

function crossingTime(
  previousTime: number,
  nextTime: number,
  previousValue: number,
  nextValue: number,
  target: number
): number {
  const span = nextValue - previousValue;
  if (span === 0) return nextTime;
  const fraction = Math.max(
    0,
    Math.min(1, (target - previousValue) / span)
  );
  return previousTime + (nextTime - previousTime) * fraction;
}

function longitudinalAtTime(
  samples: readonly MotionSample[],
  timeSeconds: number
): number {
  if (timeSeconds <= samples[0]!.timeSeconds)
    return samples[0]!.longitudinalMetres;
  for (let index = 1; index < samples.length; index++) {
    const next = samples[index]!;
    if (timeSeconds > next.timeSeconds) continue;
    const previous = samples[index - 1]!;
    const fraction = (timeSeconds - previous.timeSeconds) /
      (next.timeSeconds - previous.timeSeconds);
    return previous.longitudinalMetres +
      (next.longitudinalMetres - previous.longitudinalMetres) * fraction;
  }
  return samples[samples.length - 1]!.longitudinalMetres;
}

function timeAtLongitudinal(
  samples: readonly MotionSample[],
  longitudinalMetres: number
): number {
  if (longitudinalMetres <= samples[0]!.longitudinalMetres)
    return samples[0]!.timeSeconds;
  for (let index = 1; index < samples.length; index++) {
    const next = samples[index]!;
    if (longitudinalMetres > next.longitudinalMetres) continue;
    const previous = samples[index - 1]!;
    return crossingTime(
      previous.timeSeconds,
      next.timeSeconds,
      previous.longitudinalMetres,
      next.longitudinalMetres,
      longitudinalMetres
    );
  }
  throw new Error('control did not reach the measured recovery station');
}

function stepRecoveryCar(car: Car): void {
  stepCar(
    car,
    RECOVERY_INPUT,
    ROAD_SURFACE,
    PHYSICS_STEP_SECONDS
  );
}

function measureContactLoss(
  requestedRelativeNormalSpeed: number
): ContactLossMeasurement {
  if (requestedRelativeNormalSpeed === 0) {
    return {
      requestedRelativeNormalSpeed: 0,
      measuredRelativeNormalSpeed: 0,
      forwardRecoverySeconds: 0,
      lateralRecoverySeconds: 0,
      recoverySeconds: 0,
      secondsLost: 0
    };
  }

  const impacted = makeCar(0, 0, 0);
  impacted.vx = REFERENCE_SPEED_METRES_PER_SECOND;
  const control = makeCar(0, 0, 0);
  control.vx = REFERENCE_SPEED_METRES_PER_SECOND;
  const striking = makeCar(0, CONTACT_LATERAL_SEPARATION, 0);
  striking.vx = REFERENCE_SPEED_METRES_PER_SECOND;
  striking.vy = -requestedRelativeNormalSpeed;

  const impacts = collideCars([impacted, striking]);
  if (impacts.length !== 1)
    throw new Error(
      `expected one collision at ${requestedRelativeNormalSpeed} m/s`
    );
  const measuredRelativeNormalSpeed = impacts[0]!.imp;
  const samples: MotionSample[] = [{
    timeSeconds: 0,
    longitudinalMetres: control.x
  }];
  const impactedSamples: MotionSample[] = [{
    timeSeconds: 0,
    longitudinalMetres: impacted.x
  }];

  let forwardRecoverySeconds: number | null =
    impacted.vx >= REFERENCE_SPEED_METRES_PER_SECOND ? 0 : null;
  let lateralRecoverySeconds: number | null =
    impacted.vy >= 0 ? 0 : null;
  let timeSeconds = 0;
  const maximumSteps = Math.ceil(
    MAXIMUM_MEASUREMENT_SECONDS / PHYSICS_STEP_SECONDS
  );
  for (let step = 0; step < maximumSteps; step++) {
    const previousTime = timeSeconds;
    const previousForwardSpeed = impacted.vx;
    const previousLateralSpeed = impacted.vy;
    stepRecoveryCar(impacted);
    stepRecoveryCar(control);
    timeSeconds += PHYSICS_STEP_SECONDS;
    samples.push({
      timeSeconds,
      longitudinalMetres: control.x
    });
    impactedSamples.push({
      timeSeconds,
      longitudinalMetres: impacted.x
    });

    if (forwardRecoverySeconds == null &&
        impacted.vx >= REFERENCE_SPEED_METRES_PER_SECOND) {
      forwardRecoverySeconds = crossingTime(
        previousTime,
        timeSeconds,
        previousForwardSpeed,
        impacted.vx,
        REFERENCE_SPEED_METRES_PER_SECOND
      );
    }
    if (lateralRecoverySeconds == null && impacted.vy >= 0) {
      lateralRecoverySeconds = crossingTime(
        previousTime,
        timeSeconds,
        previousLateralSpeed,
        impacted.vy,
        0
      );
    }
    if (forwardRecoverySeconds != null && lateralRecoverySeconds != null)
      break;
  }
  if (forwardRecoverySeconds == null || lateralRecoverySeconds == null)
    throw new Error(
      `contact recovery exceeded the physical measurement horizon at ` +
      `${requestedRelativeNormalSpeed} m/s`
    );

  const recoverySeconds = Math.max(
    forwardRecoverySeconds,
    lateralRecoverySeconds
  );
  const recoveryStation = longitudinalAtTime(
    impactedSamples,
    recoverySeconds
  );
  const controlArrivalSeconds = timeAtLongitudinal(samples, recoveryStation);
  return {
    requestedRelativeNormalSpeed,
    measuredRelativeNormalSpeed,
    forwardRecoverySeconds,
    lateralRecoverySeconds,
    recoverySeconds,
    secondsLost: Math.max(0, recoverySeconds - controlArrivalSeconds)
  };
}

/**
 * Measures the incremental cost of refusing to separate after the first
 * strike. Only the striking car's inward velocity is replenished: production
 * physics owns both cars' motion and separation, and neither car is
 * repositioned. That makes this one-sided curve conservative versus mutual
 * convergence; it deliberately does not invent a scalar rate for the
 * observed nonlinear duration response.
 */
function measureContactGrindLoss(
  durationSeconds: number,
  baselineSingleStrikeLossSeconds: number
): ContactGrindLossMeasurement {
  const pressureSteps = Math.round(durationSeconds / PHYSICS_STEP_SECONDS);
  if (Math.abs(
    pressureSteps * PHYSICS_STEP_SECONDS - durationSeconds
  ) > Number.EPSILON * Math.max(1, durationSeconds) * 8)
    throw new Error('contact duration must resolve on the physics cadence');

  const impacted = makeCar(0, 0, 0);
  impacted.vx = REFERENCE_SPEED_METRES_PER_SECOND;
  const control = makeCar(0, 0, 0);
  control.vx = REFERENCE_SPEED_METRES_PER_SECOND;
  const striking = makeCar(0, CONTACT_LATERAL_SEPARATION, 0);
  striking.vx = REFERENCE_SPEED_METRES_PER_SECOND;
  striking.vy = -RELATIVE_NORMAL_SPEED_STEP;

  const initialImpacts = collideCars([impacted, striking]);
  if (initialImpacts.length !== 1)
    throw new Error('expected the sustained-pressure trial to start in contact');
  let impactCount = initialImpacts.length;
  let timeSeconds = 0;
  const controlSamples: MotionSample[] = [{
    timeSeconds,
    longitudinalMetres: control.x
  }];
  const impactedSamples: MotionSample[] = [{
    timeSeconds,
    longitudinalMetres: impacted.x
  }];

  for (let step = 0; step < pressureSteps; step++) {
    stepRecoveryCar(impacted);
    stepRecoveryCar(control);
    // This is the only externally maintained quantity in the protocol:
    // one driver continues to close laterally at the smallest sampled
    // relative-normal speed while every consequence remains production
    // collision and vehicle physics.
    striking.vy = -RELATIVE_NORMAL_SPEED_STEP;
    stepRecoveryCar(striking);
    impactCount += collideCars([impacted, striking]).length;
    timeSeconds += PHYSICS_STEP_SECONDS;
    controlSamples.push({
      timeSeconds,
      longitudinalMetres: control.x
    });
    impactedSamples.push({
      timeSeconds,
      longitudinalMetres: impacted.x
    });
  }

  let forwardRecoverySeconds: number | null =
    impacted.vx >= REFERENCE_SPEED_METRES_PER_SECOND ? timeSeconds : null;
  let lateralRecoverySeconds: number | null =
    impacted.vy >= 0 ? timeSeconds : null;
  const maximumRecoverySteps = Math.ceil(
    MAXIMUM_MEASUREMENT_SECONDS / PHYSICS_STEP_SECONDS
  );
  for (let step = 0;
    step < maximumRecoverySteps &&
    (forwardRecoverySeconds == null || lateralRecoverySeconds == null);
    step++) {
    const previousForwardSpeed = impacted.vx;
    const previousLateralSpeed = impacted.vy;
    const previousTime = timeSeconds;
    stepRecoveryCar(impacted);
    stepRecoveryCar(control);
    timeSeconds += PHYSICS_STEP_SECONDS;
    controlSamples.push({
      timeSeconds,
      longitudinalMetres: control.x
    });
    impactedSamples.push({
      timeSeconds,
      longitudinalMetres: impacted.x
    });
    if (forwardRecoverySeconds == null &&
        impacted.vx >= REFERENCE_SPEED_METRES_PER_SECOND) {
      forwardRecoverySeconds = crossingTime(
        previousTime,
        timeSeconds,
        previousForwardSpeed,
        impacted.vx,
        REFERENCE_SPEED_METRES_PER_SECOND
      );
    }
    if (lateralRecoverySeconds == null && impacted.vy >= 0) {
      lateralRecoverySeconds = crossingTime(
        previousTime,
        timeSeconds,
        previousLateralSpeed,
        impacted.vy,
        0
      );
    }
  }
  if (forwardRecoverySeconds == null || lateralRecoverySeconds == null)
    throw new Error(
      `sustained-contact recovery exceeded the physical measurement ` +
      `horizon at ${durationSeconds} s`
    );

  const recoverySeconds = Math.max(
    forwardRecoverySeconds,
    lateralRecoverySeconds
  );
  const recoveryStation = longitudinalAtTime(
    impactedSamples,
    recoverySeconds
  );
  const controlArrivalSeconds = timeAtLongitudinal(
    controlSamples,
    recoveryStation
  );
  const totalSecondsLost = Math.max(
    0,
    recoverySeconds - controlArrivalSeconds
  );
  return {
    durationSeconds,
    impactCount,
    totalRecoverySeconds: recoverySeconds,
    totalSecondsLost,
    additionalSecondsLost: Math.max(
      0,
      totalSecondsLost - baselineSingleStrikeLossSeconds
    )
  };
}

export function measureContactLossCurve(): ContactLossMeasurementReport {
  return {
    schemaVersion: 2,
    kind: 'measured-contact-loss',
    method: 'stable-car lateral strike versus identical no-contact control',
    physicsStepSeconds: PHYSICS_STEP_SECONDS,
    referenceSpeedMetresPerSecond: REFERENCE_SPEED_METRES_PER_SECOND,
    hardContactBoundaryMetresPerSecond: HARD_CONTACT_IMPULSE,
    maximumRelativeNormalSpeedMetresPerSecond:
      MAXIMUM_RELATIVE_NORMAL_SPEED,
    relativeNormalSpeedStepMetresPerSecond: RELATIVE_NORMAL_SPEED_STEP,
    maximumMeasurementSeconds: MAXIMUM_MEASUREMENT_SECONDS,
    contactLateralSeparationMetres: CONTACT_LATERAL_SEPARATION,
    rows: relativeNormalSpeedGrid().map(measureContactLoss)
  };
}

export function measureContactGrindLossCurve():
ContactGrindLossMeasurementReport {
  const baselineSingleStrikeLossSeconds =
    measureContactLoss(RELATIVE_NORMAL_SPEED_STEP).secondsLost;
  return {
    schemaVersion: 1,
    kind: 'measured-contact-grind-loss',
    method:
      'one-sided sustained lateral pressure versus identical no-contact control',
    physicsStepSeconds: PHYSICS_STEP_SECONDS,
    referenceSpeedMetresPerSecond: REFERENCE_SPEED_METRES_PER_SECOND,
    pressureRelativeNormalSpeedMetresPerSecond:
      RELATIVE_NORMAL_SPEED_STEP,
    durationStepSeconds: RACECRAFT_DECISION_INTERVAL_SECONDS,
    maximumDurationSeconds: MAXIMUM_GRIND_DURATION_SECONDS,
    contactLateralSeparationMetres: CONTACT_LATERAL_SEPARATION,
    baselineSingleStrikeLossSeconds,
    rows: sustainedContactDurationGrid().map(duration =>
      measureContactGrindLoss(duration, baselineSingleStrikeLossSeconds))
  };
}

export function measureParallelHoldContactRateCurve():
ParallelHoldContactRateMeasurementReport {
  if (PARALLEL_HOLD_BASE_CLEARANCE_INTERVALS <= 0 ||
      PARALLEL_HOLD_REFINED_CLEARANCE_INTERVALS !==
        2 * PARALLEL_HOLD_BASE_CLEARANCE_INTERVALS)
    throw new Error(
      'parallel-hold clearance refinement must double the cadence-derived grid'
    );
  const scenarios = parallelHoldScenarios();
  const refinedRows: ParallelHoldContactRateMeasurement[] = [];
  const baseRows: ParallelHoldContactRateMeasurement[] = [];
  for (const clearanceMetres of parallelHoldClearanceGrid()) {
    const base = emptyParallelAccumulator();
    const refined = emptyParallelAccumulator();
    let activeBuilt: BuiltTrack | null = null;
    let paths: readonly [SampledPath, SampledPath] | null = null;
    for (const scenario of scenarios) {
      if (scenario.built !== activeBuilt) {
        activeBuilt = scenario.built;
        paths = synchronizedParallelPaths(
          scenario.built,
          clearanceMetres
        );
      }
      const trial = measureParallelHoldTrial(scenario, paths!);
      addParallelAccumulator(base, trial.base);
      addParallelAccumulator(refined, trial.refined);
    }
    baseRows.push(parallelMeasurement(clearanceMetres, base, base));
    refinedRows.push(parallelMeasurement(clearanceMetres, refined, base));
  }

  let maximumEpisodeRateGridDifferencePerSecond = 0;
  for (let index = 1; index < refinedRows.length - 1; index += 2) {
    const interpolated = (
      refinedRows[index - 1]!.episodeStartsPerSecond +
      refinedRows[index + 1]!.episodeStartsPerSecond
    ) / 2;
    maximumEpisodeRateGridDifferencePerSecond = Math.max(
      maximumEpisodeRateGridDifferencePerSecond,
      Math.abs(
        refinedRows[index]!.episodeStartsPerSecond - interpolated
      )
    );
  }
  let maximumEpisodeRateExposureDifferencePerSecond = 0;
  let maximumContactFractionExposureDifference = 0;
  let maximumDirectLossRateExposureDifference = 0;
  for (let index = 0; index < refinedRows.length; index++) {
    maximumEpisodeRateExposureDifferencePerSecond = Math.max(
      maximumEpisodeRateExposureDifferencePerSecond,
      Math.abs(
        refinedRows[index]!.episodeStartsPerSecond -
        baseRows[index]!.episodeStartsPerSecond
      )
    );
    maximumContactFractionExposureDifference = Math.max(
      maximumContactFractionExposureDifference,
      Math.abs(
        refinedRows[index]!.contactSecondsPerExposureSecond -
        baseRows[index]!.contactSecondsPerExposureSecond
      )
    );
    maximumDirectLossRateExposureDifference = Math.max(
      maximumDirectLossRateExposureDifference,
      Math.abs(
        refinedRows[index]!.directSecondsLostPerExposureSecond -
        baseRows[index]!.directSecondsLostPerExposureSecond
      )
    );
  }
  const sourceTrackIds = [...new Set(
    scenarios.map(scenario => scenario.trackId)
  )];
  return {
    schemaVersion: 1,
    kind: 'measured-parallel-hold-contact-rate',
    method:
      'production path follower and collision physics on symmetric parallel paths',
    physicsStepSeconds: PHYSICS_STEP_SECONDS,
    controlStepSeconds: CONTROL_STEP_SECONDS,
    deliberationIntervalSeconds: RACECRAFT_DECISION_INTERVAL_SECONDS,
    referenceSpeedMetresPerSecond: REFERENCE_SPEED_METRES_PER_SECOND,
    bodyContactCentreSeparationMetres:
      PARALLEL_HOLD_BODY_CONTACT_SEPARATION,
    maximumClearanceMetres: PARALLEL_HOLD_MAXIMUM_CLEARANCE,
    clearanceStepMetres: PARALLEL_HOLD_CLEARANCE_STEP,
    settleDistanceMetres: PATH_FOLLOWER_SETTLE_DISTANCE,
    minimumStraightDistanceMetres:
      PATH_FOLLOWER_SETTLE_DISTANCE +
      PHYS.vTop * PARALLEL_HOLD_EXPOSURE_SECONDS,
    exposureSecondsPerScenario: PARALLEL_HOLD_EXPOSURE_SECONDS,
    sourceTrackIds,
    scenarioCountPerClearance: scenarios.length,
    analyticGaussianUsedAsSource: false,
    convergence: {
      baseClearanceIntervalCount:
        PARALLEL_HOLD_BASE_CLEARANCE_INTERVALS,
      refinedClearanceIntervalCount:
        PARALLEL_HOLD_REFINED_CLEARANCE_INTERVALS,
      maximumEpisodeRateGridDifferencePerSecond,
      baseExposureSecondsPerScenario:
        PARALLEL_HOLD_BASE_EXPOSURE_SECONDS,
      refinedExposureSecondsPerScenario:
        PARALLEL_HOLD_EXPOSURE_SECONDS,
      maximumEpisodeRateExposureDifferencePerSecond,
      maximumContactFractionExposureDifference,
      maximumDirectLossRateExposureDifference,
      exposureConvergedAtNumericalPrecision:
        maximumEpisodeRateExposureDifferencePerSecond <=
          Number.EPSILON *
          Math.max(
            1,
            ...refinedRows.map(row => row.episodeStartsPerSecond)
          ) * 512
    },
    rows: refinedRows
  };
}

if (import.meta.main) {
  console.log(JSON.stringify({
    strike: measureContactLossCurve(),
    grind: measureContactGrindLossCurve(),
    parallelHold: measureParallelHoldContactRateCurve()
  }, null, 2));
}
