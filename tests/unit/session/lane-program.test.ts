import { beforeAll, describe, expect, test } from 'bun:test';

import {
  backwardInducedSpeedLimit,
  botStep
} from '../../../src/core/autopilot';
import {
  numericArray,
  type BotParameters,
  type BuiltTrack,
  type SampledPath
} from '../../../src/core/model';
import { sampleCornerLineEtaAnalytic } from '../../../src/core/corner-lines';
import { makeCar } from '../../../src/core/physics-engine';
import {
  cornerSpeedForGrip,
  PHYS
} from '../../../src/core/physics';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  PathPlan,
  Session
} from '../../../src/session/model';
import {
  assertLaneProgramPinned,
  editLaneEtaTarget,
  editLaneTarget,
  evaluateLaneEta,
  evaluateLaneProgram,
  installRacecraftPathPlan,
  LANE_BUFFER_CAPACITY,
  LANE_BUFFER_DISTANCE_METRES,
  setLaneProgram
} from '../../../src/session/racecraft/lane-program';
import {
  racecraftFamilyStateAt
} from '../../../src/session/racecraft/family-geometry';
import {
  publishRacecraftClaimSnapshot,
  updateRacecraftSideAgreements
} from '../../../src/session/racecraft/corridor-planner';
import {
  sideAgreementBounds,
  sideAgreementEnvelopeAt
} from '../../../src/session/racecraft/geometry';
import { maintainRacingLineZeroState } from '../../../src/session/racecraft/evaluator';
import {
  entryMargin,
  entryMu,
  TRAF_DT
} from '../../../src/session/strategy';
import { prepareHeadlessTrack } from '../../../src/game/headless-sim';

const TEAM = { id: 'lane-test', name: 'Lane Test', body: '#000', accent: '#fff' } as const;

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function activeEntry(code = 'LANE', index = 240, residual = 0.27): Entry {
  const lineup: LineupEntry = {
    team: TEAM,
    name: code,
    code,
    isPlayer: false,
    ci: 0,
    margin: 0,
    focus: 0.7,
    trait: ''
  };
  const entry = createEntry({
    lineup,
    teamIndex: 0,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  const track = built.tr;
  const lateral = track.idealPath.off[index]! + residual;
  const heading = Math.atan2(track.ty[index]!, track.tx[index]!);
  const car = makeCar(
    track.x[index]! + track.nx[index]! * lateral,
    track.y[index]! + track.ny[index]! * lateral,
    heading
  );
  car.progIdx = index;
  car.s = index * track.step;
  car.vx = 32;
  car.spd = 32;
  entry.car = car;
  entry.state = 'run';
  entry.lat = residual;
  entry.laneProgram.bias = residual;
  entry.latNow = lateral;
  entry.spd = 32;
  entry.cross = 2;
  entry.prog = 2 * track.len + car.s;
  return entry;
}

function laneSession(): Session {
  return {
    trk: built.tr,
    wet: 0,
    mode: 'race',
    config: { tuneBonus: 0 } as Session['config']
  } as Session;
}

function publishAllClaims(session: Session): void {
  const active = session.entries.filter(entry =>
    !!entry.car &&
    (entry.state === 'run' ||
      entry.state === 'pitIn' ||
      entry.state === 'pitOut')
  ) as Array<Entry & { car: NonNullable<Entry['car']> }>;
  updateRacecraftSideAgreements(session, active);
  publishRacecraftClaimSnapshot(
    session,
    session.entries,
    new Set(active.map(entry => entry.code))
  );
}

function straightIndex(): number {
  const track = built.tr;
  const lookahead = Math.ceil(100 / track.step);
  for (let index = 0; index < track.n; index++) {
    const cornerApproach = track.corners.some(corner => {
      const approachSpan =
        (corner.exitI - corner.approachI + track.n) % track.n;
      const fromApproach =
        (index - corner.approachI + track.n) % track.n;
      return fromApproach <= approachSpan;
    });
    if (cornerApproach) continue;
    let straight = true;
    for (let delta = 0; delta <= lookahead; delta++)
      if (Math.abs(track.kSm[(index + delta) % track.n]!) > 1 / 350) {
        straight = false;
        break;
      }
    if (straight) return index;
  }
  throw new Error('Prado has no 100 m straight test span');
}

function uniformLaneGeometry(
  index: number,
  eta: number
): { curvature: number; ds: number } {
  const track = built.tr;
  const ideal = track.idealPath;
  const previous = (index - 1 + track.n) % track.n;
  const next = (index + 1) % track.n;
  const curvature = track.kSm[index]!;
  const curvatureDerivative =
    (track.kSm[next]! - track.kSm[previous]!) / (2 * track.step);
  const offset = ideal.off[index]! + eta;
  const slope =
    (ideal.off[next]! - ideal.off[previous]!) / (2 * track.step);
  const second =
    (ideal.off[next]! - 2 * ideal.off[index]! + ideal.off[previous]!) /
      (track.step * track.step);
  const longitudinal = 1 - curvature * offset;
  const q = Math.hypot(longitudinal, slope);
  return {
    curvature: (
      longitudinal * second +
      curvature * longitudinal * longitudinal +
      curvatureDerivative * offset * slope +
      2 * curvature * slope * slope
    ) / (q * q * q),
    ds: track.step * q
  };
}

describe('lane program authority', () => {
  test('reuses one fixed buffer and prices an empty biased program from real geometry', () => {
    const entry = activeEntry();
    const session = laneSession();
    const first = evaluateLaneProgram(session, entry);
    const arrays = [first.off, first.k, first.ds, first.v];
    const residual = entry.lat;
    expect(first.count).toBeLessThanOrEqual(LANE_BUFFER_CAPACITY);
    for (let slot = 0; slot < first.count; slot++) {
      const index = (first.startIndex + slot) % built.tr.n;
      const geometry = uniformLaneGeometry(index, residual);
      expect(first.off[slot]).toBe(built.tr.idealPath.off[index]! + residual);
      expect(first.k[slot]).toBeCloseTo(geometry.curvature, 15);
      expect(first.ds[slot]).toBeCloseTo(geometry.ds, 15);
      const localLimit = Math.min(
        built.tr.idealPath.v[index]!,
        cornerSpeedForGrip(geometry.curvature, entryMu(entry, 0))
      ) * entryMargin(entry, session, session.config.tuneBonus, session.wet);
      expect(first.v[slot]).toBeLessThanOrEqual(localLimit);
    }
    const second = evaluateLaneProgram(session, entry);
    expect(second).toBe(first);
    expect([second.off, second.k, second.ds, second.v]).toEqual(arrays);
  });

  test('executes the installed analytic family unchanged through acquisition, corner, and exit', () => {
    const track = built.tr;
    const distanceSamples = (from: number, to: number): number =>
      (to - from + track.n) % track.n;
    const maximumSamples = Math.floor(
      LANE_BUFFER_DISTANCE_METRES / track.step
    );
    const corner = track.corners.find(value =>
      !!value.alternateLines &&
      distanceSamples(value.approachI, value.turnInI) >= 4 &&
      distanceSamples(value.turnInI, value.apexI) >= 2 &&
      distanceSamples(value.approachI, value.exitI) <
        maximumSamples - 2
    );
    if (!corner?.alternateLines)
      throw new Error('Prado has no compact analytic corner test span');
    const line = corner.alternateLines.outside.idealRejoin;
    const entry = activeEntry('ANALYTIC-RUNTIME', corner.approachI, 0);
    const session = laneSession();
    const blend = 0.625;
    const acquisitionSamples = distanceSamples(
      corner.approachI,
      corner.turnInI
    );
    const apexSamples = distanceSamples(
      corner.approachI,
      corner.apexI
    );
    const exitSamples = distanceSamples(
      corner.approachI,
      corner.exitI
    );
    const acquisition = sampleCornerLineEtaAnalytic(
      track,
      corner,
      line,
      corner.turnInI
    );
    const plan = {
      mode: 'side-outside',
      key: 'test:analytic-runtime',
      anchors: [
        {
          index: corner.approachI,
          offset: entry.latNow,
          s: entry.prog
        },
        {
          index: corner.turnInI,
          offset: track.idealPath.off[corner.turnInI]! +
            blend * acquisition.eta,
          s: entry.prog + acquisitionSamples * track.step
        },
        {
          index: corner.exitI,
          offset: track.idealPath.off[corner.exitI]!,
          s: entry.prog + exitSamples * track.step
        }
      ],
      pinnedFirst: true,
      cornerId: corner.id,
      complexId: corner.complexId,
      topology: 'right',
      terminal: 'ideal-rejoin',
      surfaceAuthorization: 'normal',
      lineKind: line.kind,
      lineTerminal: line.terminal,
      lineBlend: blend
    } satisfies Exclude<
      PathPlan,
      { mode: 'ideal' } | { mode: 'pit' }
    >;

    installRacecraftPathPlan(
      track,
      entry,
      `space:${plan.key}`,
      plan,
      'racecraft:self'
    );
    expect(entry.racecraftPathPlan).toBe(plan);
    expect(entry.laneProgram.points).toHaveLength(0);
    expect(() => assertLaneProgramPinned(track, entry)).not.toThrow();

    const lane = evaluateLaneProgram(session, entry);
    const phaseSlots = [
      Math.max(1, Math.floor(acquisitionSamples / 2)),
      apexSamples,
      exitSamples
    ];
    expect(exitSamples).toBeLessThan(lane.count);
    for (const slot of phaseSlots) {
      const progress = entry.prog + slot * track.step;
      const expected = racecraftFamilyStateAt(
        session,
        entry as Entry & { car: NonNullable<Entry['car']> },
        progress,
        plan
      );
      expect(lane.off[slot]).toBeCloseTo(expected.lateral, 14);
      expect(lane.k[slot]).toBeCloseTo(expected.curvature, 14);
      expect(lane.ds[slot]! / track.step).toBeCloseTo(expected.q, 14);
    }
  });

  test('starts a compact tactical acquisition from its authored derivatives', () => {
    const track = built.tr;
    const start = 240;
    const entry = activeEntry('C2-ACQUISITION', start, 0.3);
    const etaFirstDerivative = 0.04;
    const etaSecondDerivative = 0.002;
    const sampleSpans = [0, 18, 42, 70];
    const etas = [0.3, 0.9, 0.45, 0];
    const plan = {
      mode: 'side-outside',
      key: 'test:c2-acquisition-state',
      anchors: sampleSpans.map((samples, anchorIndex) => {
        const index = (start + samples) % track.n;
        return {
          index,
          offset: track.idealPath.off[index]! + etas[anchorIndex]!,
          eta: etas[anchorIndex]!,
          s: entry.prog + samples * track.step,
          ...(anchorIndex === 0
            ? { etaFirstDerivative, etaSecondDerivative }
            : {})
        };
      }),
      pinnedFirst: true,
      topology: 'right',
      terminal: 'ideal-rejoin',
      surfaceAuthorization: 'normal'
    } satisfies Exclude<
      PathPlan,
      { mode: 'ideal' } | { mode: 'pit' }
    >;

    installRacecraftPathPlan(
      track,
      entry,
      'space:test:c2-acquisition-state',
      plan,
      'racecraft:self'
    );
    const lane = evaluateLaneProgram(laneSession(), entry);
    const previous = (start - 1 + track.n) % track.n;
    const next = (start + 1) % track.n;
    const baseCurvature = track.kSm[start]!;
    const baseCurvatureDerivative =
      (track.kSm[next]! - track.kSm[previous]!) / (2 * track.step);
    const offset = entry.latNow;
    const offsetSlope =
      (track.idealPath.off[next]! - track.idealPath.off[previous]!) /
        (2 * track.step) +
      etaFirstDerivative;
    const offsetSecond =
      (track.idealPath.off[next]! -
        2 * track.idealPath.off[start]! +
        track.idealPath.off[previous]!) /
        (track.step * track.step) +
      etaSecondDerivative;
    const longitudinalScale = 1 - baseCurvature * offset;
    const q = Math.hypot(longitudinalScale, offsetSlope);
    const expectedCurvature = (
      longitudinalScale * offsetSecond +
      baseCurvature * longitudinalScale * longitudinalScale +
      baseCurvatureDerivative * offset * offsetSlope +
      2 * baseCurvature * offsetSlope * offsetSlope
    ) / (q * q * q);
    const resetCurvature =
      baseCurvature / Math.abs(longitudinalScale);

    expect(lane.off[0]).toBe(entry.latNow);
    expect(lane.ds[0]! / track.step).toBeCloseTo(q, 12);
    expect(lane.k[0]).toBeCloseTo(expectedCurvature, 12);
    expect(Math.abs(lane.k[0]! - resetCurvature)).toBeGreaterThan(1e-5);
  });

  test('feeds botStep the same samples as an equivalent full reference path', () => {
    const entry = activeEntry('BOT');
    const lane = evaluateLaneProgram(laneSession(), entry);
    const reference: SampledPath = {
      mode: 'ideal',
      off: numericArray(built.tr.n),
      k: numericArray(built.tr.n),
      ds: numericArray(built.tr.n),
      v: numericArray(built.tr.n)
    };
    reference.off.set(built.tr.idealPath.off);
    reference.k.set(built.tr.idealPath.k);
    reference.ds.set(built.tr.idealPath.ds);
    reference.v.set(built.tr.idealPath.v);
    for (let slot = 0; slot < lane.count; slot++) {
      const index = (lane.startIndex + slot) % built.tr.n;
      reference.off[index] = lane.off[slot]!;
      reference.k[index] = lane.k[slot]!;
      reference.ds[index] = lane.ds[slot]!;
      reference.v[index] = lane.v[slot]!;
    }
    const expected = botStep(built.tr, built.prof, entry.car!, {
      path: reference,
      margin: 1
    });
    const actual = botStep(built.tr, built.prof, entry.car!, {
      path: built.tr.idealPath,
      lat: entry.lat,
      lane
    });
    expect(actual).toEqual(expected);
  });

  test('bakes each dynamic grip and aero loss into upcoming corner samples', () => {
    const fresh = activeEntry('FRESH');
    const worn = activeEntry('WORN');
    const wet = activeEntry('WET');
    const dirty = activeEntry('DIRTY');
    const aero = activeEntry('AERO');
    worn.tyre.wear = 1;
    dirty.dirtyT = 1;
    aero.cFail = true;
    const freshLane = evaluateLaneProgram(laneSession(), fresh);
    const wornLane = evaluateLaneProgram(laneSession(), worn);
    const wetLane = evaluateLaneProgram({
      ...laneSession(),
      wet: 0.65
    } as Session, wet);
    const dirtyLane = evaluateLaneProgram(laneSession(), dirty);
    const aeroLane = evaluateLaneProgram(laneSession(), aero);
    let loadedSlot = 0;
    for (let slot = 1; slot < freshLane.count; slot++)
      if (Math.abs(freshLane.k[slot]!) > Math.abs(freshLane.k[loadedSlot]!))
        loadedSlot = slot;

    expect(Math.abs(freshLane.k[loadedSlot]!)).toBeGreaterThan(0);
    for (const degraded of [wornLane, wetLane, dirtyLane, aeroLane])
      expect(degraded.v[loadedSlot]).toBeLessThan(freshLane.v[loadedSlot]!);
  });

  test('publishes full claims while a certifiable overlap creates an agreement', () => {
    const index = straightIndex();
    const first = activeEntry('CLAIM-A', index, -0.4);
    const second = activeEntry('CLAIM-B', index, 0.4);
    const session = {
      ...laneSession(),
      t: 1,
      entries: [first, second]
    } as Session;
    evaluateLaneProgram(session, first);
    evaluateLaneProgram(session, second);

    publishAllClaims(session);
    const firstClaim = session.racecraftClaims!.get(first.code)!;
    const secondClaim = session.racecraftClaims!.get(second.code)!;
    expect(firstClaim.trusted).toBe(true);
    expect(secondClaim.trusted).toBe(true);
    for (const claim of [firstClaim, secondClaim])
      for (let index = 0; index < claim.stations.length; index++)
        expect(claim.stations.v[index]).toBeGreaterThanOrEqual(0);
    expect(session.sideAgreements?.size).toBe(1);
    const firstBias = first.laneProgram.bias;
    const secondBias = second.laneProgram.bias;
    maintainRacingLineZeroState(session, first, session.entries);
    maintainRacingLineZeroState(session, second, session.entries);
    expect(first.laneProgram.binding).toBeNull();
    expect(second.laneProgram.binding).toBeNull();
    expect(first.laneProgram.points).toHaveLength(0);
    expect(second.laneProgram.points).toHaveLength(0);
    expect(first.laneProgram.bias).toBe(firstBias);
    expect(second.laneProgram.bias).toBe(secondBias);
    expect(first.laneEdits ?? 0).toBe(0);
    expect(second.laneEdits ?? 0).toBe(0);
    session.t += TRAF_DT;
    publishAllClaims(session);

    second.car!.s = first.car!.s + PHYS.carLen + 1e-6;
    session.t += TRAF_DT;
    publishAllClaims(session);
    expect(session.sideAgreements?.size).toBe(0);
  });

  test('switches prediction source while keeping measured classes source-local', () => {
    const value = activeEntry('TRUST');
    const session = {
      ...laneSession(),
      t: 1,
      entries: [value]
    } as Session;
    evaluateLaneProgram(session, value);
    publishAllClaims(session);
    const publishedScale =
      session.racecraftClaims!.get(value.code)!
        .lateralTrackingErrorThresholdMetres;
    expect(session.racecraftClaims!.get(value.code)!.source).toBe('published');

    value.car!.slipR = 0.4;
    session.t += TRAF_DT;
    publishAllClaims(session);
    const controlled = session.racecraftClaims!.get(value.code)!;
    expect(controlled.trusted).toBe(false);
    expect(controlled.source).toBe('rederived');
    expect(controlled.lateralTrackingErrorThresholdMetres)
      .toBeGreaterThanOrEqual(0);

    value.car!.slipR = 0;
    value.latNow += 0.35;
    session.t += TRAF_DT;
    publishAllClaims(session);
    const rederived = session.racecraftClaims!.get(value.code)!;
    expect(rederived.trusted).toBe(false);
    expect(rederived.source).toBe('rederived');
    expect(rederived.lateralTrackingErrorThresholdMetres)
      .toBeGreaterThan(controlled.lateralTrackingErrorThresholdMetres);

    value.latNow -= 0.35;
    session.t += TRAF_DT;
    publishAllClaims(session);
    const sameGeneration = session.racecraftClaims!.get(value.code)!;
    expect(sameGeneration.source).toBe('rederived');
    expect(editLaneEtaTarget(
      session,
      value,
      value.lat,
      'test:new-authority-generation',
      true
    )).toBe(true);
    publishAllClaims(session);
    const recovered = session.racecraftClaims!.get(value.code)!;
    expect(recovered.source).toBe('published');
    expect(recovered.lateralTrackingErrorThresholdMetres)
      .toBeGreaterThanOrEqual(publishedScale);
    value.liftT = 0.5;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(value.code)!.trusted).toBe(true);
    value.recT = 0.5;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(value.code)!.source)
      .toBe('published');

    value.recT = 0;
    value.car!.offCourse = true;
    delete value.laneProgram.surfaceAuthorization;
    session.t += TRAF_DT;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(value.code)!.source)
      .toBe('rederived');
    value.laneProgram.surfaceAuthorization = 'emergency';
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(value.code)!.source)
      .toBe('rederived');
    setLaneProgram(
      built.tr,
      value,
      'test:published-emergency',
      [{
        s: value.prog + PHYS.carLen,
        eta: value.lat
      }],
      'test:published-emergency',
      'emergency'
    );
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(value.code)!.source)
      .toBe('published');
  });

  test('publishes the installed backward-composed lane speed law as one rollout', () => {
    const constrained = activeEntry('CONSTRAINED', 300, 0);
    const session = {
      ...laneSession(),
      t: 1,
      entries: [constrained]
    } as Session;
    const freeLane = evaluateLaneProgram(session, constrained);
    const freeProgramSpeed = Array.from(
      freeLane.v.slice(0, freeLane.count),
      speed => speed
    );
    publishAllClaims(session);
    const freeSpeed =
      session.racecraftClaims!.get(constrained.code)!.stations.v[0]!;

    constrained.racecraftLongitudinalProgram = {
      progress: freeProgramSpeed.map((_, slot) =>
        constrained.prog + slot * built.tr.step),
      speed: freeProgramSpeed.map(speed => speed * 0.7),
      brakingEffort: constrained.brakingEffort,
      slowPointOwnerCode: 'LEADER',
      bindingSlowPoint: {
        distance: 12,
        speed: constrained.spd - 10,
        ownerCode: 'LEADER',
        reason: 'traffic-follow:test',
        stationS: (constrained.car!.s + 12) % built.tr.len,
        publishedAt: session.t
      }
    };
    delete constrained._laneBufferRevision;
    const composed = evaluateLaneProgram(session, constrained);
    expect(composed.v[0]).toBeLessThan(constrained.spd);
    session.t += TRAF_DT;
    publishAllClaims(session);
    const constrainedClaim =
      session.racecraftClaims!.get(constrained.code)!;
    expect(constrainedClaim.stations.v[0])
      .toBeLessThan(freeSpeed);
    expect(constrainedClaim.stations.v[0])
      .toBeLessThan(constrained.spd);

    const dt = constrainedClaim.stations.time[0]!;
    const expectedAdvance = (
      constrained.spd + constrainedClaim.stations.v[0]!
    ) * 0.5 * dt;
    const actualAdvance = (
      constrainedClaim.stations.s[0]! - constrainedClaim.originS +
      built.tr.len
    ) % built.tr.len;
    expect(actualAdvance).toBeCloseTo(expectedAdvance, 11);
  });

  test('retains a future selected-program constraint when slot zero is free', () => {
    const index = straightIndex();
    const entry = activeEntry('FUTURE-PROGRAM', index, 0);
    const session = laneSession();
    const free = evaluateLaneProgram(session, entry);
    const speed = Array.from(free.v.slice(0, free.count), value => value);
    const targetSlot = Math.min(60, speed.length - 2);
    const freeTarget = speed[targetSlot]!;
    speed[targetSlot] = freeTarget * 0.55;
    speed[targetSlot + 1] = Math.min(
      speed[targetSlot + 1]!,
      speed[targetSlot]!
    );
    entry.racecraftLongitudinalProgram = {
      progress: speed.map((_, slot) => entry.prog + slot * built.tr.step),
      speed,
      brakingEffort: entry.brakingEffort,
      slowPointOwnerCode: 'LEADER',
      bindingSlowPoint: null
    };
    delete entry._laneBufferRevision;

    const installed = evaluateLaneProgram(session, entry);

    expect(installed.v[targetSlot]).toBeLessThan(freeTarget);
    expect(installed.v[targetSlot]).toBeCloseTo(speed[targetSlot]!, 10);
  });

  test('composes a traffic station into the lane and leaves BotParameters traffic-free', () => {
    const freeEntry = activeEntry('FREE');
    const constrainedEntry = activeEntry('TRAFFIC');
    constrainedEntry.trafficSlowPoint = {
      distance: 20,
      speed: 10,
      ownerCode: 'LEADER',
      reason: 'traffic-follow:test',
      stationS: (constrainedEntry.car!.s + 20) % built.tr.len,
      publishedAt: 0
    };
    const freeLane = evaluateLaneProgram(laneSession(), freeEntry);
    const constrainedLane = evaluateLaneProgram(
      laneSession(),
      constrainedEntry
    );
    expect(constrainedLane.v[0]).toBeLessThan(freeLane.v[0]!);

    const openPath: SampledPath = {
      mode: 'ideal',
      off: numericArray(built.tr.n),
      k: numericArray(built.tr.n),
      ds: numericArray(built.tr.n),
      v: numericArray(built.tr.n)
    };
    openPath.off.set(built.tr.idealPath.off);
    openPath.ds.set(built.tr.idealPath.ds);
    openPath.v.fill(PHYS.vTop);
    const common = {
      path: openPath,
      controlStepSeconds: 1 / 60,
      powerScale: 1
    };
    const unconstrained = botStep(
      built.tr,
      built.prof,
      freeEntry.car!,
      common
    );
    const room = botStep(
      built.tr,
      built.prof,
      constrainedEntry.car!,
      { lane: constrainedLane, path: built.tr.idealPath }
    );
    expect(room.throttle).toBeLessThan(unconstrained.throttle);

    type TrafficIsAbsent =
      'traffic' extends keyof BotParameters ? false : true;
    const trafficIsAbsent: TrafficIsAbsent = true;
    expect(trafficIsAbsent).toBe(true);
    const legacyRuntimeObject = {
      ...common,
      traffic: { distance: 0, speed: freeEntry.spd - 1 }
    };
    expect(botStep(
      built.tr,
      built.prof,
      freeEntry.car!,
      legacyRuntimeObject
    )).toEqual(unconstrained);
  });

  test('preserves sampled pit geometry while composing queue speed', () => {
    const entry = activeEntry('PIT-QUEUE', 300, 0);
    const path: SampledPath = {
      mode: 'pit',
      off: numericArray(built.tr.n),
      k: numericArray(built.tr.n),
      ds: numericArray(built.tr.n),
      v: numericArray(built.tr.n)
    };
    path.off.set(built.tr.idealPath.off);
    path.k.set(built.tr.idealPath.k);
    path.ds.set(built.tr.idealPath.ds);
    path.v.fill(30);
    entry.pathPlan = {
      mode: 'pit',
      key: 'test:pit-queue',
      anchors: []
    };
    entry.path = path;
    const free = evaluateLaneProgram(laneSession(), entry);
    const freeSpeed = free.v[0]!;
    entry.trafficSlowPoint = {
      distance: 4,
      speed: 0,
      ownerCode: 'PIT-LEADER',
      reason: 'traffic-comfort:pit:test',
      stationS: (entry.car!.s + 4) % built.tr.len,
      publishedAt: 0
    };
    delete entry._laneBufferRevision;

    const constrained = evaluateLaneProgram(laneSession(), entry);
    const index = constrained.startIndex;

    expect(constrained.off[0]).toBe(path.off[index]!);
    expect(constrained.k[0]).toBe(path.k[index]!);
    expect(constrained.ds[0]).toBe(path.ds[index]!);
    expect(constrained.v[0]).toBeLessThan(freeSpeed);
  });

  test('prices high-curvature intermediate braking headroom per sample', () => {
    const targetSpeed = 12;
    const segmentDistance = 30;
    const brakingEffort = 0.82;
    const curvature = 1 / 35;
    const intermediateLimit = cornerSpeedForGrip(curvature);
    const atIntermediate = backwardInducedSpeedLimit(
      targetSpeed,
      intermediateLimit,
      segmentDistance,
      curvature,
      1,
      1,
      brakingEffort
    );
    const withIntermediate = backwardInducedSpeedLimit(
      atIntermediate,
      PHYS.vTop,
      segmentDistance,
      0,
      1,
      1,
      brakingEffort
    );
    const targetOnly = backwardInducedSpeedLimit(
      targetSpeed,
      PHYS.vTop,
      segmentDistance * 2,
      0,
      1,
      1,
      brakingEffort
    );

    expect(withIntermediate).toBeLessThan(targetOnly);
  });

  test('pins every edit at the physical car and evaluates a smooth finite profile', () => {
    const entry = activeEntry('PIN', 300, -0.15);
    setLaneProgram(built.tr, entry, 'test-edit', [
      { s: entry.prog + 80, eta: 0 },
      { s: entry.prog + 160, eta: 0 }
    ]);
    const first = entry.laneProgram.points[0]!;
    expect(first.s).toBe(entry.prog);
    expect(first.eta).toBe(
      entry.latNow - built.tr.idealPath.off[entry.car!.progIdx]!
    );
    expect(() => assertLaneProgramPinned(built.tr, entry)).not.toThrow();
    const middle = evaluateLaneEta(entry.laneProgram.points, entry.prog + 40);
    expect(Number.isFinite(middle.eta)).toBe(true);
    expect(Number.isFinite(middle.firstDerivative)).toBe(true);
    expect(Number.isFinite(middle.secondDerivative)).toBe(true);
    const lane = evaluateLaneProgram(laneSession(), entry);
    for (let slot = 0; slot < lane.count; slot++) {
      expect(Number.isFinite(lane.off[slot])).toBe(true);
      expect(Number.isFinite(lane.k[slot])).toBe(true);
      expect(Number.isFinite(lane.ds[slot])).toBe(true);
      expect(Number.isFinite(lane.v[slot])).toBe(true);
      expect(lane.ds[slot]).toBeGreaterThan(0);
      expect(lane.v[slot]).toBeGreaterThanOrEqual(0);
    }
    first.eta += 0.01;
    expect(() => assertLaneProgramPinned(built.tr, entry)).toThrow('not pinned');
  });

  test('reuses lane point objects across traffic-cadence target edits', () => {
    const entry = activeEntry('REUSE', 250, 0);
    const session = { trk: built.tr, wet: 0 } as Session;
    expect(editLaneTarget(session, entry, 0.6, 'first')).toBe(true);
    const first = entry.laneProgram.points[0];
    const target = entry.laneProgram.points[1];
    expect(editLaneTarget(session, entry, -0.6, 'second')).toBe(true);
    expect(entry.laneProgram.points[0]).toBe(first);
    expect(entry.laneProgram.points[1]).toBe(target);
    expect(entry.laneMaximumPinError).toBe(0);
    expect(entry.laneUnpinnedEdits ?? 0).toBe(0);
  });

  test('does not reauthor one ideal-relative target as the ideal line evolves', () => {
    const entry = activeEntry('ETA', 250, 0);
    const session = { trk: built.tr, wet: 0 } as Session;
    expect(editLaneEtaTarget(session, entry, 0.2, 'line-character')).toBe(true);
    const edits = entry.laneEdits;
    const nextIndex = 251;
    entry.car!.progIdx = nextIndex;
    entry.car!.s += built.tr.step;
    entry.prog += built.tr.step;
    entry.latNow = built.tr.idealPath.off[nextIndex]!;
    expect(editLaneEtaTarget(session, entry, 0.2, 'line-character')).toBe(false);
    expect(entry.laneEdits).toBe(edits);
    expect(entry.laneEditReasons).toEqual({ 'line-character': 1 });
  });

  test('does not restart one absolute edit while its pinned transition is active', () => {
    const entry = activeEntry('ABS', 250, 0);
    const session = { trk: built.tr, wet: 0 } as Session;
    expect(editLaneTarget(session, entry, 2, 'incident-avoid')).toBe(true);
    const edits = entry.laneEdits;
    entry.car!.progIdx = 251;
    entry.car!.s += built.tr.step;
    entry.prog += built.tr.step;
    expect(editLaneTarget(session, entry, 2, 'incident-avoid')).toBe(false);
    expect(entry.laneEdits).toBe(edits);
  });

  test('reports without projecting an installed family outside its live agreement', () => {
    const entry = activeEntry('HOLD', 250, 0.27);
    const other = activeEntry('OTHER', 250, -0.27);
    entry.latNow = 2;
    other.latNow = -2;
    const session = laneSession();
    session.entries = [entry, other];
    session.sideAgreements = new Map([[
      'HOLD:OTHER',
      {
        side: 1,
        separatorEta: 0,
        centreClearance: PHYS.carWid,
        familyCertificate: {
          contextKey: 'test:uniform',
          originS: entry.car!.s,
          spanMetres: built.tr.step,
          lowerFamilyKey: 'test:lower',
          upperFamilyKey: 'test:upper'
        },
        since: 0
      }
    ]]);
    entry.laneProgram.points = [
      { s: entry.prog - 2, eta: 0.27 },
      { s: entry.prog - 1, eta: 0.27 }
    ];

    const lane = evaluateLaneProgram(session, entry);

    expect(entry.laneProgram.points).toHaveLength(0);
    expect(entry.laneProgram.bias).toBe(0.27);
    expect(lane.uniformBias).toBeNull();
    const agreement = sideAgreementBounds(session, entry);
    let violatesAgreement = false;
    for (let slot = 0; slot < lane.count; slot++) {
      const index = (lane.startIndex + slot) % built.tr.n;
      const authored = built.tr.idealPath.off[index]! + entry.laneProgram.bias;
      const minimum = sideAgreementEnvelopeAt(
        built.tr,
        index,
        agreement
      ).minimum;
      violatesAgreement ||= authored < minimum;
      const geometry = uniformLaneGeometry(index, entry.laneProgram.bias);
      expect(lane.k[slot]).toBeCloseTo(geometry.curvature, 12);
      expect(lane.off[slot]).toBe(authored);
    }
    expect(violatesAgreement).toBe(true);
    expect(session.racecraftAgreementGeometryViolations).toBe(1);
    expect(entry.laneEdits ?? 0).toBe(0);
  });

  test('keeps deformed family geometry and speed independent of agreement diagnostics', () => {
    const entry = activeEntry('DEFORM', 250, 0.27);
    const freeEntry = activeEntry('FREE-DEFORM', 250, 0.27);
    const other = activeEntry('OTHER', 250, -0.27);
    const points = [
      { s: entry.prog, eta: 0.27 },
      { s: entry.prog + 60, eta: 0.4 },
      { s: entry.prog + 120, eta: 0.27 }
    ];
    entry.laneProgram.points = points.map(point => ({ ...point }));
    freeEntry.laneProgram.points = points.map(point => ({ ...point }));
    const session = laneSession();
    session.entries = [entry, other];
    session.sideAgreements = new Map([[
      'DEFORM:OTHER',
      {
        side: 1,
        separatorEta: 0,
        centreClearance: PHYS.carWid,
        familyCertificate: {
          contextKey: 'test:deformed',
          originS: entry.car!.s,
          spanMetres: built.tr.step,
          lowerFamilyKey: 'test:lower',
          upperFamilyKey: 'test:upper'
        },
        since: 0
      }
    ]]);

    const expected = evaluateLaneProgram(laneSession(), freeEntry);
    const actual = evaluateLaneProgram(session, entry);

    expect(actual.count).toBe(expected.count);
    for (let slot = 0; slot < actual.count; slot++) {
      expect(actual.off[slot]).toBe(expected.off[slot]);
      expect(actual.k[slot]).toBe(expected.k[slot]);
      expect(actual.ds[slot]).toBe(expected.ds[slot]);
      expect(actual.v[slot]).toBe(expected.v[slot]);
    }
    expect(session.racecraftAgreementGeometryViolations).toBe(1);
  });

  test('never projects authored geometry onto a per-sample surface edge', () => {
    const entry = activeEntry('RAW-SURFACE', 250, 0);
    const index = entry.car!.progIdx;
    const outside = built.tr.surface.normalMaximum[index]! + PHYS.carWid;
    entry.laneProgram.bias =
      outside - built.tr.idealPath.off[index]!;

    const lane = evaluateLaneProgram(laneSession(), entry);

    const sample = (lane.startIndex + 1) % built.tr.n;
    const authored = built.tr.idealPath.off[sample]! +
      entry.laneProgram.bias;
    expect(authored).toBeGreaterThan(
      built.tr.surface.normalMaximum[sample]!
    );
    expect(lane.off[1]).toBe(authored);
  });
});
