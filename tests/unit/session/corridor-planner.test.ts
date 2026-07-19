import { beforeAll, describe, expect, test } from 'bun:test';

import { sampleCornerLineEtaAnalytic } from '../../../src/core/corner-lines';
import type { BuiltTrack } from '../../../src/core/model';
import { PHYS } from '../../../src/core/physics';
import { makeCar } from '../../../src/core/physics-engine';
import type {
  Entry,
  LineupEntry,
  PathPlan,
  RacecraftDecision,
  Session
} from '../../../src/session/model';
import {
  publishRacecraftClaimSnapshot,
  updateRacecraftSideAgreements
} from '../../../src/session/racecraft/corridor-planner';
import { racecraftClaimStateAtTime } from '../../../src/session/racecraft/claim';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from '../../../src/session/racecraft/cadence';
import {
  rederiveRacecraftOptimalProgram
} from '../../../src/session/racecraft/evaluator';
import { racecraftFamilyStateAt } from '../../../src/session/racecraft/family-geometry';
import {
  sampleQuinticHermiteSegment,
  sampleSmootherstepSegment
} from '../../../src/session/racecraft/interpolation';
import {
  signedTrackDistance,
  sportingSideAgreementCentreClearance
} from '../../../src/session/racecraft/geometry';
import { sampleCompactPathPlanOffsetAnalytic } from '../../../src/session/racecraft/paths';
import { TRAF_DT } from '../../../src/session/strategy';
import { PIT_TEAMS, TRACK_DEFS } from '../../../src/data/tracks';
import { buildTrackDefinition } from '../../../src/game/tracks';
import { normAng } from '../../../src/shared/math';

const TEAM = {
  id: 'claim-test',
  name: 'Claim Test',
  body: '#000',
  accent: '#fff'
} as const;

let built: BuiltTrack;

beforeAll(() => {
  built = buildTrackDefinition(TRACK_DEFS[0]!, PIT_TEAMS, {
    requireProfile: true,
    warn: false
  });
});

function activeEntry(code: string, index = 240, residual = 0.27): Entry {
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
  return {
    lu: lineup,
    name: code,
    code,
    isPlayer: false,
    mods: { pw: 1, dr: 1, hMu: 1 },
    car,
    tyre: { c: 'S', wear: 0, fit: 0 },
    fuel: 1,
    pace: 1,
    hFail: false,
    cFail: false,
    prog: 2 * track.len + car.s,
    spd: 32,
    latNow: lateral,
    state: 'run',
    pitW: null,
    lat: residual,
    trafficSlowPoint: null,
    liftT: 0,
    tow: 0,
    dirtyT: 0,
    brakingEffort: 0.82,
    focusNow: 0.7,
    recT: 0,
    inp: { steer: 0, throttle: 1, brake: 0, hand: false },
    laneProgram: {
      points: [],
      reason: 'test',
      binding: null,
      bias: residual
    }
  } as unknown as Entry;
}

function claimSession(entry: Entry): Session {
  return {
    trk: built.tr,
    wet: 0,
    mode: 'race',
    t: 1,
    entries: [entry],
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

function selectOffsetFamily(entry: Entry, eta = 2): PathPlan {
  const track = built.tr;
  const start = Math.max(0, entry.car!.progIdx) % track.n;
  const acquisition = (start + 14) % track.n;
  const hold = (start + 48) % track.n;
  const plan: PathPlan = {
    mode: 'side-outside',
    key: `test-family:${entry.code}`,
    anchors: [
      { index: start, offset: entry.latNow, s: entry.prog },
      {
        index: acquisition,
        offset: track.idealPath.off[acquisition]! + eta,
        s: entry.prog + 14 * track.step
      },
      {
        index: hold,
        offset: track.idealPath.off[hold]! + eta,
        s: entry.prog + 48 * track.step
      }
    ],
    pinnedFirst: true,
    topology: 'right',
    surfaceAuthorization: 'normal'
  };
  entry.racecraftDecision = {
    at: 0,
    selectedKind: 'corner-outside',
    selectedPlanKey: plan.key,
    candidateCount: 1,
    targetLateral: track.idealPath.off[hold]! + eta,
    interactionCause: 'ordinary',
    chosenUtilization: 0,
    candidates: [{
      kind: 'corner-outside',
      plan,
      feasible: true,
      vetoes: [],
      targetLateral: track.idealPath.off[hold]! + eta
    }]
  } as unknown as RacecraftDecision;
  return plan;
}

function placeLaterally(entry: Entry, lateral: number): void {
  const track = built.tr;
  const index = Math.max(0, entry.car!.progIdx) % track.n;
  entry.car!.x = track.x[index]! + track.nx[index]! * lateral;
  entry.car!.y = track.y[index]! + track.ny[index]! * lateral;
  entry.latNow = lateral;
  entry.lat = lateral - track.idealPath.off[index]!;
  entry.laneProgram.bias = entry.lat;
}

function advanceAlongPublishedClaim(
  session: Session,
  entry: Entry,
  seconds: number
): void {
  const track = session.trk;
  const claim = session.racecraftClaims!.get(entry.code)!;
  const predicted = racecraftClaimStateAtTime(track, claim, seconds);
  const delta = signedTrackDistance(track, entry.car!.s, predicted.s);
  const index = ((Math.round(predicted.s / track.step) % track.n) +
    track.n) % track.n;
  entry.prog += delta;
  entry.car!.s = predicted.s;
  entry.car!.progIdx = index;
  entry.car!.spd = predicted.speed;
  entry.car!.vx = predicted.speed;
  entry.spd = predicted.speed;
  entry.latNow = predicted.lateral;
  entry.lat = predicted.lateral - track.idealPath.off[index]!;
  entry.car!.x = track.x[index]! + track.nx[index]! * predicted.lateral;
  entry.car!.y = track.y[index]! + track.ny[index]! * predicted.lateral;
  entry.car!.h = normAng(
    Math.atan2(track.ty[index]!, track.tx[index]!) +
      predicted.headingOffsetRadians
  );
}

describe('racecraft claim trust', () => {
  test('orders authored sub-step anchors by continuous progress', () => {
    const track = built.tr;
    const firstProgress =
      2 * track.len + 1034.3125 * track.step;
    const span = track.step / 12;
    const plan: PathPlan = {
      mode: 'tuck',
      key: 'test:continuous-anchor-order',
      anchors: [
        {
          index: 1035,
          offset: -0.4,
          s: firstProgress
        },
        {
          index: 1034,
          offset: 0.8,
          s: firstProgress + span
        }
      ],
      pinnedFirst: true,
      topology: 'hold',
      surfaceAuthorization: 'normal'
    };
    const expected = sampleSmootherstepSegment(-0.4, 0.8, span, 0.5);
    const sampled = sampleCompactPathPlanOffsetAnalytic(
      track,
      plan,
      1034,
      firstProgress + span / 2
    );
    expect(sampled.value).toBeCloseTo(expected.value, 12);
    expect(sampled.firstDerivative).toBeCloseTo(
      expected.firstDerivative,
      10
    );
    expect(sampled.secondDerivative).toBeCloseTo(
      expected.secondDerivative,
      10
    );
  });

  test('shares exact acquisition and corner-family curvature with rederived prediction', () => {
    const track = built.tr;
    const corner = track.corners.find(value =>
      value.approachI < value.turnInI &&
      value.turnInI < value.apexI &&
      value.apexI < value.exitI &&
      !!value.alternateLines
    )!;
    const line = corner.alternateLines!.outside.idealRejoin;
    const entry = activeEntry('ANALYTIC-FAMILY', corner.approachI, 0);
    const session = claimSession(entry);
    const blend = 0.625;
    const acquisitionIndex = corner.turnInI;
    const acquisitionDistance =
      (acquisitionIndex - corner.approachI) * track.step;
    const exitDistance = (corner.exitI - corner.approachI) * track.step;
    const acquisitionLine = sampleCornerLineEtaAnalytic(
      track,
      corner,
      line,
      acquisitionIndex
    );
    const plan: PathPlan = {
      mode: 'side-outside',
      key: 'test:analytic-family',
      anchors: [
        {
          index: corner.approachI,
          offset: entry.latNow,
          s: entry.prog
        },
        {
          index: acquisitionIndex,
          offset: track.idealPath.off[acquisitionIndex]! +
            blend * acquisitionLine.eta,
          s: entry.prog + acquisitionDistance
        },
        {
          index: corner.exitI,
          offset: track.idealPath.off[corner.exitI]!,
          s: entry.prog + exitDistance
        }
      ],
      pinnedFirst: true,
      cornerId: corner.id,
      lineKind: line.kind,
      lineBlend: blend,
      topology: 'right',
      surfaceAuthorization: 'normal'
    };
    const expectedCurvature = (
      index: number,
      offset: {
        value: number;
        firstDerivative: number;
        secondDerivative: number;
      }
    ): number => {
      const previous = (index - 1 + track.n) % track.n;
      const next = (index + 1) % track.n;
      const curvature = track.kSm[index]!;
      const curvatureDerivative =
        (track.kSm[next]! - track.kSm[previous]!) / (2 * track.step);
      const scale = 1 - curvature * offset.value;
      const q = Math.hypot(scale, offset.firstDerivative);
      return (
        scale * offset.secondDerivative +
        curvature * scale * scale +
        curvatureDerivative * offset.value * offset.firstDerivative +
        2 * curvature * offset.firstDerivative * offset.firstDerivative
      ) / (q * q * q);
    };

    const acquisitionSampleIndex = Math.round(
      (corner.approachI + acquisitionIndex) / 2
    );
    const acquisitionPrevious = (acquisitionIndex - 1 + track.n) % track.n;
    const acquisitionNext = (acquisitionIndex + 1) % track.n;
    const acquisitionLineSample = sampleCornerLineEtaAnalytic(
      track,
      corner,
      line,
      acquisitionIndex
    );
    const acquisitionSample = sampleQuinticHermiteSegment(
      {
        value: entry.latNow,
        firstDerivative: 0,
        secondDerivative: 0
      },
      {
        value: plan.anchors[1]!.offset,
        firstDerivative:
          (track.idealPath.off[acquisitionNext]! -
            track.idealPath.off[acquisitionPrevious]!) /
            (2 * track.step) +
          blend * acquisitionLineSample.firstDerivative,
        secondDerivative:
          (track.idealPath.off[acquisitionNext]! -
            2 * track.idealPath.off[acquisitionIndex]! +
            track.idealPath.off[acquisitionPrevious]!) /
            (track.step * track.step) +
          blend * acquisitionLineSample.secondDerivative
      },
      acquisitionDistance,
      (acquisitionSampleIndex - corner.approachI) /
        (acquisitionIndex - corner.approachI)
    );
    const directAcquisition = sampleCompactPathPlanOffsetAnalytic(
      track,
      plan,
      acquisitionSampleIndex
    );
    expect(directAcquisition.value).toBeCloseTo(acquisitionSample.value, 12);
    expect(directAcquisition.firstDerivative).toBeCloseTo(
      acquisitionSample.firstDerivative,
      12
    );
    expect(directAcquisition.secondDerivative).toBeCloseTo(
      acquisitionSample.secondDerivative,
      12
    );
    const acquisitionState = racecraftFamilyStateAt(
      session,
      entry as Entry & { car: NonNullable<Entry['car']> },
      entry.prog +
        (acquisitionSampleIndex - corner.approachI) * track.step,
      plan
    );
    expect(acquisitionState.curvature).toBeCloseTo(
      expectedCurvature(acquisitionSampleIndex, acquisitionSample),
      12
    );

    const cornerIndex = corner.apexI;
    const previous = (cornerIndex - 1 + track.n) % track.n;
    const next = (cornerIndex + 1) % track.n;
    const cornerLine = sampleCornerLineEtaAnalytic(
      track,
      corner,
      line,
      cornerIndex
    );
    const cornerOffset = {
      value: track.idealPath.off[cornerIndex]! + blend * cornerLine.eta,
      firstDerivative:
        (track.idealPath.off[next]! - track.idealPath.off[previous]!) /
          (2 * track.step) +
        blend * cornerLine.firstDerivative,
      secondDerivative:
        (track.idealPath.off[next]! -
          2 * track.idealPath.off[cornerIndex]! +
          track.idealPath.off[previous]!) / (track.step * track.step) +
        blend * cornerLine.secondDerivative
    };
    expect(sampleCompactPathPlanOffsetAnalytic(track, plan, cornerIndex))
      .toEqual(cornerOffset);
    const cornerState = racecraftFamilyStateAt(
      session,
      entry as Entry & { car: NonNullable<Entry['car']> },
      entry.prog + (cornerIndex - corner.approachI) * track.step,
      plan
    );
    expect(cornerState.curvature).toBeCloseTo(
      expectedCurvature(cornerIndex, cornerOffset),
      12
    );
  });

  test('contact and mishap markers do not revoke a stable tracked claim', () => {
    const entry = activeEntry('CONTACT-TRUST');
    const session = claimSession(entry);
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(entry.code)!.trusted).toBe(true);

    entry._hitT = session.t;
    advanceAlongPublishedClaim(session, entry, TRAF_DT);
    session.t += TRAF_DT;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(entry.code)!.trusted).toBe(true);

    delete entry._hitT;
    entry._mishap = true;
    advanceAlongPublishedClaim(session, entry, TRAF_DT);
    session.t += TRAF_DT;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(entry.code)!.trusted).toBe(true);

    entry.recT = 0.5;
    advanceAlongPublishedClaim(session, entry, TRAF_DT);
    session.t += TRAF_DT;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(entry.code)!.source).toBe('published');
  });

  test('re-deliberates on stable point divergence without inventing a lost authority', () => {
    const entry = activeEntry('POINT-DIVERGENCE');
    const session = claimSession(entry);
    publishAllClaims(session);
    const initial = session.racecraftClaims!.get(entry.code)!;
    const authoredBias = entry.laneProgram.bias;

    advanceAlongPublishedClaim(session, entry, TRAF_DT);
    placeLaterally(entry, entry.latNow + PHYS.carWid / 20);
    entry.laneProgram.bias = authoredBias;
    session.t += TRAF_DT;
    publishAllClaims(session);

    const revised = session.racecraftClaims!.get(entry.code)!;
    expect(revised.source).toBe('published');
    expect(revised.trusted).toBe(true);
    expect(revised.publicationRevision)
      .toBeGreaterThan(initial.publicationRevision);
    expect(session.racecraftClaimRevisionReasons?.['point-divergence'])
      .toBe(1);
  });

  test('publishes the re-evaluated optimum for an unstable driven car', () => {
    const entry = activeEntry('REDERIVED-FAMILY');
    const session = claimSession(entry);
    const broken = selectOffsetFamily(entry);
    entry.car!.slipR = 0.3;
    const decisionBefore = entry.racecraftDecision;
    const expected = rederiveRacecraftOptimalProgram(
      session,
      entry,
      session.entries
    );
    expect(expected).not.toBeNull();
    expect(expected!.candidateCount).toBeLessThanOrEqual(6);
    expect(expected!.plan.key).not.toBe(broken.key);
    expect(entry.racecraftDecision).toBe(decisionBefore);

    publishAllClaims(session);
    const claim = session.racecraftClaims!.get(entry.code)!;
    expect(claim.trusted).toBe(false);
    expect(claim.source).toBe('rederived');
    expect(claim.stations).toHaveLength(expected!.stations.length - 1);
    for (let index = 0; index < claim.stations.length; index++) {
      const station = claim.stations[index]!;
      const optimal = expected!.stations[index + 1]!;
      expect(station.time).toBeCloseTo(optimal.time, 12);
      expect(station.s).toBeCloseTo(optimal.s, 12);
      expect(station.speed).toBeCloseTo(optimal.speed, 12);
      expect(station.centre).toBeCloseTo(optimal.lateral, 12);
      expect(station.headingOffsetRadians)
        .toBeCloseTo(optimal.headingOffsetRadians, 12);
    }

    const cache = entry._racecraftRederivedProgram!;
    const selectedFamily = cache.plan;
    const absorbedDecisionAt = cache.absorbedDecisionAt;
    placeLaterally(entry, entry.latNow + 0.08);
    session.t += TRAF_DT;
    publishAllClaims(session);
    const repeated = session.racecraftClaims!.get(entry.code)!;
    expect(repeated.source).toBe('rederived');
    expect(entry._racecraftRederivedProgram).toBe(cache);
    expect(entry._racecraftRederivedProgram!.plan).toBe(selectedFamily);
    expect(entry._racecraftRederivedProgram!.absorbedDecisionAt)
      .toBe(absorbedDecisionAt);
    expect(repeated.originCentre).toBe(entry.latNow);

    const newerFamily = selectOffsetFamily(entry, 1.25);
    entry.racecraftDecision!.at = session.t + TRAF_DT;
    session.t += TRAF_DT;
    publishAllClaims(session);
    expect(entry._racecraftRederivedProgram).toBe(cache);
    expect(entry._racecraftRederivedProgram!.plan).toBe(newerFamily);
    expect(entry._racecraftRederivedProgram!.absorbedDecisionAt)
      .toBe(entry.racecraftDecision!.at);
  });

  test('uses ballistic rollout only for measured spin or persistent stall', () => {
    const spinning = activeEntry('SPIN');
    const spinIndex = spinning.car!.progIdx;
    spinning.car!.h = Math.atan2(
      built.tr.ty[spinIndex]!,
      built.tr.tx[spinIndex]!
    ) + Math.PI / 2;
    spinning.car!.vx = 0;
    spinning.car!.vy = -32;
    const spinSession = claimSession(spinning);
    publishAllClaims(spinSession);
    const spinClaim = spinSession.racecraftClaims!.get(spinning.code)!;
    expect(spinClaim.source).toBe('ballistic');
    expect(spinClaim.originHeadingOffsetRadians)
      .toBeCloseTo(Math.PI / 2, 12);
    const firstSpinStation = spinClaim.stations[0]!;
    const trajectoryHeading = Math.atan2(
      firstSpinStation.centre - spinClaim.originCentre,
      signedTrackDistance(
        built.tr,
        spinClaim.originS,
        firstSpinStation.s
      )
    );
    expect(Math.abs(normAng(
      firstSpinStation.headingOffsetRadians - trajectoryHeading
    ))).toBeGreaterThan(0.5);
    expect(spinning._racecraftRederivedProgram).toBeUndefined();

    const stalled = activeEntry('STALL');
    stalled.car!.vx = 0;
    stalled.car!.spd = 0;
    stalled.spd = 0;
    stalled.stationaryDuration = RACECRAFT_DECISION_INTERVAL_SECONDS;
    const stallSession = claimSession(stalled);
    publishAllClaims(stallSession);
    expect(stallSession.racecraftClaims!.get(stalled.code)!.source)
      .toBe('ballistic');

    const transitioning = activeEntry('REDERIVED-TO-SPIN');
    const transitionSession = claimSession(transitioning);
    transitioning.car!.slipR = 0.3;
    publishAllClaims(transitionSession);
    expect(transitioning._racecraftRederivedProgram).toBeDefined();
    const transitionIndex = transitioning.car!.progIdx;
    transitioning.car!.h = Math.atan2(
      built.tr.ty[transitionIndex]!,
      built.tr.tx[transitionIndex]!
    ) + Math.PI;
    transitionSession.t += TRAF_DT;
    publishAllClaims(transitionSession);
    expect(transitionSession.racecraftClaims!.get(transitioning.code)!.source)
      .toBe('ballistic');
    expect(transitioning._racecraftRederivedProgram).toBeUndefined();
  });

  test('switches prediction source without mixing tracking-error classes', () => {
    const entry = activeEntry('SOURCE-NOISE');
    const session = claimSession(entry);
    entry.claimTrackingErrorScaleBySource = {
      published: {
        lateralThresholdMetres: 0.15,
        longitudinalThresholdMetres: 0.11
      },
      rederived: {
        lateralThresholdMetres: 0.37,
        longitudinalThresholdMetres: 0.29
      }
    };
    entry.car!.slipR = 0.3;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(entry.code)!
      .lateralTrackingErrorThresholdMetres)
      .toBe(0.37);
    expect(entry._racecraftRederivedProgram).toBeDefined();

    entry.car!.slipR = 0;
    session.t += TRAF_DT;
    publishAllClaims(session);
    const published = session.racecraftClaims!.get(entry.code)!;
    expect(published.source).toBe('published');
    expect(published.lateralTrackingErrorThresholdMetres).toBe(0.15);
    expect(entry._racecraftRederivedProgram).toBeUndefined();
    expect(entry.claimTrackingErrorScaleBySource.rederived)
      .toEqual({
        lateralThresholdMetres: 0.37,
        longitudinalThresholdMetres: 0.29
      });
  });

  test('does not cap or reject ballistic occupancy at an emergency envelope', () => {
    const entry = activeEntry('NO-TUBE');
    const lateral = built.tr.surface.normalMaximum[entry.car!.progIdx]! +
      PHYS.carWid * 4;
    placeLaterally(entry, lateral);
    entry.car!.vx = 0;
    entry.car!.spd = 0;
    entry.spd = 0;
    entry.stationaryDuration = RACECRAFT_DECISION_INTERVAL_SECONDS;
    entry.car!.offCourse = true;
    const session = claimSession(entry);

    publishAllClaims(session);
    const claim = session.racecraftClaims!.get(entry.code)!;
    expect(claim.source).toBe('ballistic');
    expect(claim.stations.every(station =>
      station.centre > built.tr.surface.normalMaximum[station.index]!))
      .toBe(true);
  });

  test('acquires wraparound overlap without scanning unrelated pairs', () => {
    const first = activeEntry('WRAP-A', built.tr.n - 1, -1.4);
    const second = activeEntry('WRAP-B', 0, 1.4);
    const distant = activeEntry('DISTANT', 200, 0);
    const session = claimSession(first);
    session.entries = [distant, second, first];

    updateRacecraftSideAgreements(
      session,
      session.entries as Array<Entry & { car: NonNullable<Entry['car']> }>
    );

    expect(session.sideAgreements?.has('WRAP-A:WRAP-B')).toBe(true);
    expect(session.sideAgreements?.size).toBe(1);
    expect(session.sideAgreements?.get('WRAP-A:WRAP-B')
      ?.centreClearance).toBe(sportingSideAgreementCentreClearance());
  });
});
