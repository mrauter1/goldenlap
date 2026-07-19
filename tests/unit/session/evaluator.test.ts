import { beforeAll, describe, expect, test } from 'bun:test';

import { CAR_COLLISION_CONTACT_SLOP_METRES } from
  '../../../src/core/collision';
import { BOT_BRAKING_EFFORT_MAXIMUM } from
  '../../../src/core/autopilot';
import type { BuiltTrack } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import { PHYS } from '../../../src/core/physics';
import {
  emergencyLateralEnvelope,
  normalLateralEnvelope
} from '../../../src/core/surface';
import { prepareHeadlessTrack } from '../../../src/game/headless-sim';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  PathPlan,
  RacecraftClaim,
  RacecraftDecision,
  RacecraftLongitudinalProgram,
  Session
} from '../../../src/session/model';
import {
  publishRacecraftClaimSnapshot,
  updateRacecraftSideAgreements
} from '../../../src/session/racecraft/corridor-planner';
import {
  evaluateRacecraftDecision,
  maintainRacingLineZeroState,
  MAX_RACECRAFT_CANDIDATES,
  racecraftDeferredResponses,
  racecraftJointEmergencyResponse,
  racecraftContestedRegionResponsibility,
  racecraftDecisionCertificateBreakReason,
  racecraftPointTrajectoriesMayIntersect,
  racecraftStableFamilyId,
  rebuildRacecraftSelectedProgram,
  rederiveRacecraftOptimalProgram,
  sealRacecraftDecisionCertificate,
  snapshotContestedRegion
} from '../../../src/session/racecraft/evaluator';
import { racecraftClaimAtEvaluationEpoch } from
  '../../../src/session/racecraft/claim';
import { sampleCompactPathPlanOffset } from
  '../../../src/session/racecraft/compact-path';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from '../../../src/session/racecraft/cadence';
import {
  TRAFFIC_NEIGHBOR_SCAN_METRES
} from '../../../src/session/racecraft/config';
import {
  sideAgreementBounds,
  sideAgreementCornerFamilyMember,
  sideAgreementEnvelopeAt
} from '../../../src/session/racecraft/geometry';
import {
  clearLaneProgram,
  evaluateLaneProgram,
  installRacecraftPathPlan
} from '../../../src/session/racecraft/lane-program';
import {
  oneIntervalPhysicalDivergence
} from '../../../src/session/racecraft/paths';
import {
  MEASURED_ATTACK_TRANSITION_LOSS_SECONDS
} from '../../../src/session/racecraft/attempt-loss';
import {
  racecraftDemandedClaimCodes,
  updateTraffic
} from '../../../src/session/racecraft/traffic';

const TEAM = {
  id: 'cost-evaluator-test',
  name: 'Cost Evaluator Test',
  body: '#000',
  accent: '#fff'
} as const;

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function activeEntry(
  code: string,
  index: number,
  lateral: number,
  speed = 32
): Entry {
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
  const heading = Math.atan2(track.ty[index]!, track.tx[index]!);
  const car = makeCar(
    track.x[index]! + track.nx[index]! * lateral,
    track.y[index]! + track.ny[index]! * lateral,
    heading
  );
  car.progIdx = index;
  car.s = index * track.step;
  car.vx = speed;
  car.spd = speed;
  entry.car = car;
  entry.state = 'run';
  entry.latNow = lateral;
  entry.lat = lateral - track.idealPath.off[index]!;
  entry.spd = speed;
  entry.cross = 2;
  entry.prog = 2 * track.len + car.s;
  entry.laneProgram.bias = entry.lat;
  return entry;
}

function placeEntry(
  entry: Entry,
  index: number,
  lateral = built.tr.idealPath.off[index]!
): void {
  const track = built.tr;
  const car = entry.car!;
  car.progIdx = index;
  car.s = index * track.step;
  car.x = track.x[index]! + track.nx[index]! * lateral;
  car.y = track.y[index]! + track.ny[index]! * lateral;
  car.h = Math.atan2(track.ty[index]!, track.tx[index]!);
  entry.latNow = lateral;
  entry.lat = lateral - track.idealPath.off[index]!;
  entry.prog = entry.cross * track.len + car.s;
}

function raceSession(entries: Entry[]): Session {
  return {
    trk: built.tr,
    prof: built.prof,
    wet: 0,
    mode: 'race',
    t: 5,
    goT: 0,
    entries,
    sideAgreements: new Map(),
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

function advanceEntryAlongClaim(
  entry: Entry,
  claim: RacecraftClaim,
  elapsed: number
): void {
  const track = built.tr;
  const station = claim.stations.find(value =>
    value.time + Number.EPSILON >= elapsed) ?? claim.stations.at(-1)!;
  const span = Math.max(Number.EPSILON, station.time);
  const u = Math.min(1, Math.max(0, elapsed / span));
  const distance = (
    (station.s - claim.originS) % track.len + track.len
  ) % track.len * u;
  const s = (claim.originS + distance) % track.len;
  const lateral = claim.originCentre +
    (station.centre - claim.originCentre) * u;
  const index = Math.round(s / track.step) % track.n;
  entry.car!.s = s;
  entry.car!.progIdx = index;
  entry.car!.x = track.x[index]! + track.nx[index]! * lateral;
  entry.car!.y = track.y[index]! + track.ny[index]! * lateral;
  entry.car!.h = Math.atan2(track.ty[index]!, track.tx[index]!);
  entry.car!.vx = entry.spd +
    (station.speed - entry.spd) * u;
  entry.car!.vy = 0;
  entry.prog += distance;
  entry.latNow = lateral;
  entry.lat = lateral - track.idealPath.off[index]!;
}

function displaceEntryLaterally(entry: Entry, displacement: number): void {
  const track = built.tr;
  const index = Math.max(0, entry.car!.progIdx) % track.n;
  const lateral = entry.latNow + displacement;
  entry.car!.x = track.x[index]! + track.nx[index]! * lateral;
  entry.car!.y = track.y[index]! + track.ny[index]! * lateral;
  entry.latNow = lateral;
  entry.lat = lateral - track.idealPath.off[index]!;
}

function placeholderCertificate(
  selectedFamilyId: string | null = null,
  claimRevisions: Record<string, number> = {}
): RacecraftDecision['certificate'] {
  return {
    selectedFamilyId,
    neighborCodes: [],
    claimRevisions,
    authorityKey: '',
    validUntil: Infinity,
    zeroHazardIdeal: false
  };
}

function claim(
  code: string,
  originS: number,
  originCentre: number,
  stationData: ReadonlyArray<{
    time: number;
    s: number;
    centre: number;
    headingOffsetRadians?: number;
  }>,
  originHeadingOffsetRadians = 0
): RacecraftClaim {
  return {
    code,
    source: 'published',
    predictionKey: `published:${code}`,
    lateralAuthorityRevision: 0,
    longitudinalAuthorityRevision: 0,
    publicationRevision: 0,
    publishedAt: 1,
    originS,
    originCentre,
    originSpeed: 30,
    originHeadingOffsetRadians,
    trusted: true,
    lateralTrackingErrorThresholdMetres: PHYS.carWid / 10,
    longitudinalTrackingErrorThresholdMetres: PHYS.carWid / 10,
    trackingErrorMetres: 0,
    stations: stationData.map(station => ({
      index: Math.round(station.s / built.tr.step) % built.tr.n,
      time: station.time,
      s: station.s,
      speed: 30,
      centre: station.centre,
      headingOffsetRadians: station.headingOffsetRadians ?? 0
    }))
  };
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

function orderGainingStraightBattle(prefix: string): {
  session: Session;
  follower: Entry;
  leader: Entry;
} {
  const index = straightIndex();
  const lateral = built.tr.idealPath.off[index]!;
  const gap = 30;
  const follower = activeEntry(`${prefix}-FOLLOW`, index, lateral, 45);
  const leaderIndex = (
    index + Math.round(gap / built.tr.step)
  ) % built.tr.n;
  const leader = activeEntry(
    `${prefix}-LEAD`,
    leaderIndex,
    built.tr.idealPath.off[leaderIndex]!,
    10
  );
  leader.car!.s = (follower.car!.s + gap) % built.tr.len;
  leader.prog = follower.prog + gap;
  follower.lastLap = 60;
  leader.lastLap = 90;
  const session = raceSession([follower, leader]);
  evaluateLaneProgram(session, follower);
  evaluateLaneProgram(session, leader);
  publishAllClaims(session);
  return { session, follower, leader };
}

function clearStandingDecision(prefix: string): {
  session: Session;
  entry: Entry;
  rival: Entry;
  decision: RacecraftDecision;
} {
  const index = straightIndex();
  const gap = 50;
  const rivalIndex = (
    index + Math.round(gap / built.tr.step)
  ) % built.tr.n;
  const entry = activeEntry(
    `${prefix}-EGO`,
    index,
    built.tr.idealPath.off[index]!,
    32
  );
  const rival = activeEntry(
    `${prefix}-RIVAL`,
    rivalIndex,
    built.tr.idealPath.off[rivalIndex]!,
    32
  );
  rival.car!.s = (entry.car!.s + gap) % built.tr.len;
  rival.prog = entry.prog + gap;
  const session = raceSession([entry, rival]);
  evaluateLaneProgram(session, entry);
  evaluateLaneProgram(session, rival);
  publishAllClaims(session);
  const decision = evaluateRacecraftDecision(
    session,
    entry,
    session.entries
  )!;
  return { session, entry, rival, decision };
}

describe('seconds-valued racecraft evaluator', () => {
  test('anchors a contested region to symmetric snapshot overlap only', () => {
    const first = claim('A', 100, -1.25, [
      { time: 0.2, s: 106, centre: -1.25 },
      { time: 0.4, s: 112, centre: -1.25 },
      { time: 0.6, s: 118, centre: -0.4 }
    ]);
    const second = claim('B', 100, 1.25, [
      { time: 0.2, s: 106, centre: 1.25 },
      { time: 0.4, s: 112, centre: 1.25 },
      { time: 0.6, s: 118, centre: 0.4 }
    ]);
    const forward = snapshotContestedRegion(built.tr, first, second);
    const reverse = snapshotContestedRegion(built.tr, second, first);
    expect(forward).not.toBeNull();
    expect(reverse).not.toBeNull();
    expect(forward!.s).toBeCloseTo(reverse!.s, 12);
    expect(forward!.time).toBeCloseTo(reverse!.time, 12);
    expect(forward!.index).toBe(reverse!.index);

    const silent = claim('C', 100, 2.5, [
      { time: 0.2, s: 106, centre: 2.5 },
      { time: 0.4, s: 112, centre: 2.5 },
      { time: 0.6, s: 118, centre: 2.5 }
    ]);
    expect(snapshotContestedRegion(built.tr, first, silent)).toBeNull();
  });

  test('uses published body orientation for snapshot overlap', () => {
    const first = claim('A', 100, 0, [
      { time: 0.2, s: 100, centre: 0 }
    ]);
    const parallel = claim('B', 100, 2.5, [
      { time: 0.2, s: 100, centre: 2.5 }
    ]);
    const sideways = claim('B', 100, 2.5, [
      {
        time: 0.2,
        s: 100,
        centre: 2.5,
        headingOffsetRadians: Math.PI / 2
      }
    ], Math.PI / 2);

    expect(snapshotContestedRegion(built.tr, first, parallel)).toBeNull();
    expect(snapshotContestedRegion(built.tr, first, sideways))
      .not.toBeNull();
  });

  test('ages an immutable claim coherently before hazard evaluation', () => {
    const source = claim('AGED', 100, -1.25, [
      { time: 0.2, s: 106, centre: -1.25 },
      { time: 0.4, s: 112, centre: -1.25 },
      { time: 0.6, s: 118, centre: -0.4 }
    ]);
    const originalStations = source.stations.map(station => ({ ...station }));

    const evaluation = racecraftClaimAtEvaluationEpoch(
      built.tr,
      source,
      source.publishedAt + 0.1
    );

    expect(evaluation.claim).not.toBe(source);
    expect(evaluation.claim.publishedAt).toBeCloseTo(1.1, 12);
    expect(evaluation.claim.originS).toBeCloseTo(103, 12);
    expect(evaluation.claim.originCentre).toBeCloseTo(-1.25, 12);
    expect(evaluation.claim.stations[0]!.time).toBe(0.2);
    expect(evaluation.claim.stations[0]!.s).toBeCloseTo(109, 12);
    expect(evaluation.claim.stations[1]!.s).toBeCloseTo(115, 12);
    expect(evaluation.claim.lateralTrackingErrorThresholdMetres)
      .toBe(source.lateralTrackingErrorThresholdMetres);
    expect(evaluation.claim.longitudinalTrackingErrorThresholdMetres)
      .toBe(source.longitudinalTrackingErrorThresholdMetres);
    expect(source.publishedAt).toBe(1);
    expect(source.originS).toBe(100);
    expect(source.stations).toEqual(originalStations);
  });

  test('keeps the six-member budget and authors a straight pull-out', () => {
    const index = straightIndex();
    const lateral = built.tr.idealPath.off[index]!;
    const follower = activeEntry('FOLLOW', index, lateral, 33);
    const leaderIndex = (index + 2) % built.tr.n;
    const leader = activeEntry(
      'LEAD',
      leaderIndex,
      built.tr.idealPath.off[leaderIndex]!,
      32
    );
    const session = raceSession([follower, leader]);
    const gap = PHYS.carLen +
      oneIntervalPhysicalDivergence(session, leader);
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    evaluateLaneProgram(session, follower);
    evaluateLaneProgram(session, leader);
    publishAllClaims(session);
    const seedEvaluationsBefore =
      session.racecraftEvaluatorWork?.seedEvaluations ?? 0;

    const decision = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    );
    expect(decision).not.toBeNull();
    expect(decision!.candidateCount).toBeLessThanOrEqual(
      MAX_RACECRAFT_CANDIDATES
    );
    expect(
      session.racecraftEvaluatorWork!.seedEvaluations -
        seedEvaluationsBefore
    ).toBeLessThanOrEqual(MAX_RACECRAFT_CANDIDATES);
    expect(session.racecraftPathsMaterialized ?? 0).toBe(0);
    const pullOuts = decision!.candidates.filter(candidate =>
      (candidate.kind === 'corner-inside' ||
        candidate.kind === 'corner-outside') &&
      candidate.plan.mode !== 'ideal' &&
      candidate.plan.mode !== 'pit' &&
      candidate.plan.cornerId == null
    );
    expect(pullOuts).toHaveLength(2);
    for (const pullOut of pullOuts) {
      expect(pullOut.feasible).toBe(true);
      expect(pullOut.brakingEffort)
        .toBe(BOT_BRAKING_EFFORT_MAXIMUM);
      if (pullOut.plan.mode === 'ideal' || pullOut.plan.mode === 'pit')
        throw new Error('straight pull-out lost its compact geometry');
      expect(pullOut.plan.lineBlend).toBe(1);
      expect(pullOut.plan.anchors.length).toBeGreaterThanOrEqual(3);
      const side = pullOut.kind === 'corner-inside' ? -1 : 1;
      for (const anchor of pullOut.plan.anchors.slice(1, -1)) {
        const envelope = normalLateralEnvelope(built.tr, anchor.index);
        expect(anchor.offset).toBeCloseTo(
          side < 0 ? envelope.minimum : envelope.maximum,
          12
        );
      }
      const end = pullOut.plan.anchors.at(-1)!.s!;
      const sampleCount = Math.ceil(
        (end - follower.prog) / built.tr.step
      );
      for (let sample = 0; sample <= sampleCount; sample++) {
        const sampleIndex = (
          follower.car!.progIdx + sample
        ) % built.tr.n;
        const offset = sampleCompactPathPlanOffset(
          built.tr,
          pullOut.plan,
          sampleIndex
        );
        const envelope = normalLateralEnvelope(built.tr, sampleIndex);
        expect(offset).toBeGreaterThanOrEqual(envelope.minimum - 1e-9);
        expect(offset).toBeLessThanOrEqual(envelope.maximum + 1e-9);
      }
    }
    for (const candidate of decision!.candidates) {
      expect(Number.isFinite(candidate.ownTimeSeconds)).toBe(true);
      expect(candidate.cost === Infinity ||
        Number.isFinite(candidate.cost)).toBe(true);
    }
  });

  test('assigns full responsibility to a candidate-created contest', () => {
    expect(racecraftContestedRegionResponsibility(null, 0, 0)).toBe(1);
    const snapshotRegion = { index: 0, s: 0, time: 0 };
    expect(racecraftContestedRegionResponsibility(
      snapshotRegion,
      0.9,
      1
    )).toBeLessThan(0.5);
    expect(racecraftContestedRegionResponsibility(
      snapshotRegion,
      1,
      0.9
    )).toBeGreaterThan(0.5);
  });

  test('does not price separating body overlap as a future collision', () => {
    const index = straightIndex();
    const lateral = built.tr.idealPath.off[index]!;
    const follower = activeEntry('SEPARATING-EGO', index, lateral, 30);
    const leader = activeEntry(
      'SEPARATING-RIVAL',
      (index + 2) % built.tr.n,
      lateral,
      35
    );
    const gap = PHYS.carLen - PHYS.carWid / 20;
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    const session = raceSession([follower, leader]);
    evaluateLaneProgram(session, follower);
    evaluateLaneProgram(session, leader);
    publishAllClaims(session);

    const decision = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    );
    const hold = decision!.candidates.find(candidate =>
      candidate.kind === 'hold'
    )!;
    expect(hold.billSeconds).toBe(0);
    expect(hold.recourseSeconds).toBe(0);
  });

  test('screens clear point trajectories before viability and recourse', () => {
    const index = straightIndex();
    const lateral = built.tr.idealPath.off[index]!;
    const follower = activeEntry('SCREEN-EGO', index, lateral, 32);
    const gap = 50;
    const leaderIndex = (
      index + Math.round(gap / built.tr.step)
    ) % built.tr.n;
    const leader = activeEntry(
      'SCREEN-RIVAL',
      leaderIndex,
      built.tr.idealPath.off[leaderIndex]!,
      32
    );
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    const session = raceSession([follower, leader]);
    evaluateLaneProgram(session, follower);
    evaluateLaneProgram(session, leader);
    publishAllClaims(session);

    const decision = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    );
    const work = session.racecraftEvaluatorWork!;

    expect(decision).not.toBeNull();
    expect(work.boundScreenCalls).toBeGreaterThan(0);
    expect(work.boundScreenClears).toBe(work.boundScreenCalls);
    expect(work.boundScreenHits).toBe(0);
    expect(work.viabilityCalls).toBe(0);
    expect(work.deterministicSweeps).toBe(0);
  });

  test('derives beta from a near-clearance binding segment', () => {
    const index = straightIndex();
    const ideal = built.tr.idealPath.off[index]!;
    const ego = activeEntry('BETA-EGO', index, ideal + 0.4, 32);
    const rival = activeEntry(
      'BETA-RIVAL',
      index,
      ideal - (2 * PHYS.colR2 -
        CAR_COLLISION_CONTACT_SLOP_METRES + PHYS.carWid / 20),
      32
    );
    const session = raceSession([ego, rival]);
    evaluateLaneProgram(session, ego);
    evaluateLaneProgram(session, rival);
    publishRacecraftClaimSnapshot(
      session,
      session.entries,
      new Set([ego.code, rival.code])
    );
    const rivalClaim = session.racecraftClaims!.get(rival.code)!;
    rivalClaim.lateralTrackingErrorThresholdMetres = PHYS.carWid / 10;
    rivalClaim.originCentre =
      built.tr.idealPath.off[index]! -
      (2 * PHYS.colR2 -
        CAR_COLLISION_CONTACT_SLOP_METRES + PHYS.carWid / 20);
    for (const station of rivalClaim.stations)
      station.centre =
        built.tr.idealPath.off[station.index]! -
        (2 * PHYS.colR2 -
          CAR_COLLISION_CONTACT_SLOP_METRES + PHYS.carWid / 20);

    const initial = evaluateRacecraftDecision(
      session,
      ego,
      session.entries
    )!;
    const incumbent = initial.candidates.find(candidate =>
      candidate.kind === 'ideal')!;
    ego._racecraftAppliedKind = 'ideal';
    ego.racecraftDecision = {
      ...initial,
      selectedKind: 'ideal',
      selectedPlanKey: incumbent.plan.key,
      certificate: {
        ...initial.certificate,
        selectedFamilyId: racecraftStableFamilyId(
          'ideal',
          incumbent.plan,
          incumbent.slowPointOwnerCode
        )
      }
    };
    const workBefore =
      session.racecraftEvaluatorWork?.tieBandHazardEvaluations ?? 0;

    const reconsidered = evaluateRacecraftDecision(
      session,
      ego,
      session.entries
    )!;

    expect(session.racecraftEvaluatorWork!.tieBandHazardEvaluations)
      .toBeGreaterThan(workBefore);
    expect(Math.max(...reconsidered.candidates.map(candidate =>
      candidate.tieBandSeconds))).toBeGreaterThan(0);
  });

  test('rederives the production argmin without mutating decision diagnostics', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'PURE-REDERIVE',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const session = raceSession([entry]);
    evaluateLaneProgram(session, entry);
    publishAllClaims(session);
    session.racecraftRejectedCandidates = 7;
    session.racecraftRejectedByConstraint = { 'road-bound': 3 };
    session.racecraftDecisionSwitches = 5;
    session.racecraftCandidatesEvaluated = 11;
    session.racecraftMaximumCandidates = 4;
    session.racecraftDecisionSamples = 9;
    session.racecraftPathsMaterialized = 2;
    session.racecraftDecisionLogging = true;
    session.racecraftDecisionLog = [];
    const rejectedByConstraint = session.racecraftRejectedByConstraint;

    const rederived = rederiveRacecraftOptimalProgram(
      session,
      entry,
      session.entries
    );

    expect(rederived).not.toBeNull();
    expect(rederived!.candidateCount).toBeLessThanOrEqual(
      MAX_RACECRAFT_CANDIDATES
    );
    expect(entry.racecraftDecision).toBeUndefined();
    expect(entry._racecraftLoggedAt).toBeUndefined();
    expect(session.racecraftRejectedCandidates).toBe(7);
    expect(session.racecraftRejectedByConstraint).toBe(rejectedByConstraint);
    expect(session.racecraftRejectedByConstraint).toEqual({ 'road-bound': 3 });
    expect(session.racecraftDecisionSwitches).toBe(5);
    expect(session.racecraftCandidatesEvaluated).toBe(11);
    expect(session.racecraftMaximumCandidates).toBe(4);
    expect(session.racecraftDecisionSamples).toBe(9);
    expect(session.racecraftPathsMaterialized).toBe(2);
    expect(session.racecraftDecisionLog).toEqual([]);

    const rebuilt = rebuildRacecraftSelectedProgram(
      session,
      entry,
      session.entries,
      rederived!
    );
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.candidateCount).toBe(1);
    expect(rebuilt!.kind).toBe(rederived!.kind);
    expect(rebuilt!.slowPointOwnerCode).toBe(
      rederived!.slowPointOwnerCode
    );
    expect(entry.racecraftDecision).toBeUndefined();
    expect(session.racecraftCandidatesEvaluated).toBe(11);
    expect(session.racecraftDecisionLog).toEqual([]);

    const decision = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    );
    expect(decision).not.toBeNull();
    expect(decision!.selectedPlanKey).toBeNull();
    expect(decision!.selectedKind).toBe(rederived!.kind);
    expect(rederived!.candidateCount).toBe(decision!.candidateCount);
  });

  test('reuses the bounded maneuver family as deferred responses', () => {
    const index = straightIndex();
    const lateral = built.tr.idealPath.off[index]!;
    const follower = activeEntry('NODE-EGO', index, lateral, 33);
    const leaderIndex = (index + 2) % built.tr.n;
    const leader = activeEntry(
      'NODE-RIVAL',
      leaderIndex,
      built.tr.idealPath.off[leaderIndex]!,
      32
    );
    const session = raceSession([follower, leader]);
    const gap = PHYS.carLen +
      oneIntervalPhysicalDivergence(session, leader);
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    evaluateLaneProgram(session, follower);
    evaluateLaneProgram(session, leader);
    publishAllClaims(session);

    const responses = racecraftDeferredResponses(
      session,
      follower,
      session.entries,
      'hold',
      leader.code,
    );

    expect(responses.length).toBeLessThanOrEqual(
      MAX_RACECRAFT_CANDIDATES
    );
    expect(session.racecraftPathsMaterialized ?? 0).toBe(0);
    const lateralResponses = responses
      .filter(response =>
        response.feasible &&
        (response.kind === 'corner-inside' ||
          response.kind === 'corner-outside'))
    expect(lateralResponses.length).toBeGreaterThan(0);
  });

  test('screens continuous point crossings without station tunnelling', () => {
    expect(racecraftPointTrajectoriesMayIntersect({
      longitudinalMetres: -2 * PHYS.carLen,
      lateralMetres: 0
    }, [{
      timeSeconds: 0.2,
      longitudinalMetres: 2 * PHYS.carLen,
      lateralMetres: 0
    }])).toBe(true);

    expect(racecraftPointTrajectoriesMayIntersect({
      longitudinalMetres: 0,
      lateralMetres: Math.hypot(PHYS.carLen, PHYS.carWid) -
        Number.EPSILON
    }, [{
      timeSeconds: 0.2,
      longitudinalMetres: 0,
      lateralMetres: Math.hypot(PHYS.carLen, PHYS.carWid) -
        Number.EPSILON
    }])).toBe(true);

    const outsideBodyBound =
      Math.hypot(PHYS.carLen, PHYS.carWid) + 2;
    const origin = {
      longitudinalMetres: 0,
      lateralMetres: outsideBodyBound
    };
    const stations = [{
      timeSeconds: 0.2,
      longitudinalMetres: 0,
      lateralMetres: outsideBodyBound
    }];
    expect(racecraftPointTrajectoriesMayIntersect(origin, stations))
      .toBe(false);
  });

  test('partitions a physical overlap into protected drivable lanes', () => {
    const index = straightIndex();
    const first = activeEntry('LEFT', index, -1.1);
    const second = activeEntry('RIGHT', index, 1.1);
    const session = raceSession([first, second]);
    updateRacecraftSideAgreements(
      session,
      [first, second] as Array<Entry & { car: NonNullable<Entry['car']> }>
    );
    const firstBounds = sideAgreementBounds(session, first);
    const secondBounds = sideAgreementBounds(session, second);
    expect(firstBounds).not.toBeNull();
    expect(secondBounds).not.toBeNull();
    const agreement = session.sideAgreements!.get('LEFT:RIGHT')!;
    expect(agreement.familyCertificate.contextKey).toBe('straight');
    expect(agreement.familyCertificate.lowerFamilyKey)
      .toBe('straight:normal-minimum');
    expect(agreement.familyCertificate.upperFamilyKey)
      .toBe('straight:normal-maximum');
    const firstEnvelope = sideAgreementEnvelopeAt(
      built.tr,
      index,
      firstBounds
    );
    const secondEnvelope = sideAgreementEnvelopeAt(
      built.tr,
      index,
      secondBounds
    );
    expect(firstEnvelope.viable).toBe(true);
    expect(secondEnvelope.viable).toBe(true);
    expect(
      secondEnvelope.minimum - firstEnvelope.maximum
    ).toBeGreaterThanOrEqual(
      PHYS.carWid - 1e-9
    );
  });

  test('chooses the legal emergency side across a pincer', () => {
    const index = straightIndex();
    const ego = activeEntry('PIN-EGO', index, -1.1);
    const agreementRival = activeEntry('PIN-UPPER', index, 1.1);
    const outerRival = activeEntry('PIN-LOWER', index, -3.5);
    const session = raceSession([ego, agreementRival, outerRival]);
    evaluateLaneProgram(session, ego);
    evaluateLaneProgram(session, agreementRival);
    evaluateLaneProgram(session, outerRival);
    updateRacecraftSideAgreements(
      session,
      [ego, agreementRival] as Array<
        Entry & { car: NonNullable<Entry['car']> }
      >
    );
    publishRacecraftClaimSnapshot(
      session,
      session.entries,
      new Set(session.entries.map(entry => entry.code))
    );

    expect(sideAgreementBounds(session, ego)).not.toBeNull();
    const response = racecraftJointEmergencyResponse(
      session,
      ego,
      session.entries
    );
    expect(response).not.toBeNull();
    expect(response!.direction).toBe(-1);
    expect(response!.targetLateral).toBeLessThan(ego.latNow);
  });

  test('repositions a straight separator to preserve both finite normal families', () => {
    const index = straightIndex();
    const lower = activeEntry('LOWER', index, -4.5);
    const upper = activeEntry('UPPER', index, -2.4);
    const session = raceSession([lower, upper]);
    const ideal = built.tr.idealPath.off[index]!;
    const measuredMidpointEta =
      ((lower.latNow - ideal) + (upper.latNow - ideal)) / 2;

    updateRacecraftSideAgreements(
      session,
      [lower, upper] as Array<Entry & { car: NonNullable<Entry['car']> }>
    );

    const agreement = session.sideAgreements!.get('LOWER:UPPER');
    expect(agreement).toBeDefined();
    expect(agreement!.separatorEta).toBeGreaterThan(measuredMidpointEta);
    expect(session.racecraftAgreementFamilyRepositions).toBe(1);
    expect(agreement!.familyCertificate.spanMetres).toBeGreaterThan(0);

    updateRacecraftSideAgreements(
      session,
      [lower, upper] as Array<Entry & { car: NonNullable<Entry['car']> }>
    );
    expect(session.racecraftAgreementFamilyRepositions).toBe(1);
  });

  test('certifies an overlap complex from sustained apex-grid members', () => {
    const corner = built.tr.corners.find(value =>
      value.id === 'prado-c03')!;
    const first = activeEntry('BLOCKED-A', corner.approachI, -0.5);
    const second = activeEntry('BLOCKED-B', corner.approachI, 2.7);
    const session = raceSession([first, second]);
    const active = [first, second] as Array<
      Entry & { car: NonNullable<Entry['car']> }
    >;

    updateRacecraftSideAgreements(session, active);

    const agreement = session.sideAgreements?.get('BLOCKED-A:BLOCKED-B');
    expect(agreement).toBeDefined();
    expect(agreement!.familyCertificate.contextKey).toBe(
      'corner:prado-x02:prado-c03,prado-c04'
    );
    expect(agreement!.familyCertificate.lowerFamilyKey).toBe(
      'prado-c03:outside:sustained-offset+' +
      'prado-c04:outside:sustained-offset'
    );
    expect(agreement!.familyCertificate.upperFamilyKey).toBe(
      'prado-c03:inside:sustained-offset+' +
      'prado-c04:inside:sustained-offset'
    );
    expect(sideAgreementCornerFamilyMember(session, first, corner)).toEqual({
      kind: 'outside',
      terminal: 'sustained-offset'
    });
    expect(sideAgreementCornerFamilyMember(session, second, corner)).toEqual({
      kind: 'inside',
      terminal: 'sustained-offset'
    });
    expect(session.racecraftAgreementFamilyCertificateFailures).toBeUndefined();
    evaluateLaneProgram(session, first);
    evaluateLaneProgram(session, second);
    publishAllClaims(session);
    const decision = evaluateRacecraftDecision(session, first, session.entries);
    const certifiedCandidate = decision?.candidates.find(candidate =>
      candidate.plan.mode !== 'ideal' &&
      candidate.plan.mode !== 'pit' &&
      candidate.plan.lineKind === 'outside'
    );
    expect(certifiedCandidate).toBeDefined();
    expect(certifiedCandidate!.vetoes).toEqual([]);
    expect(
      certifiedCandidate!.plan.mode === 'ideal' ||
      certifiedCandidate!.plan.mode === 'pit'
        ? null
        : certifiedCandidate!.plan.lineTerminal
    ).toBe('sustained-offset');

    updateRacecraftSideAgreements(session, active);
    expect(session.sideAgreements?.has('BLOCKED-A:BLOCKED-B')).toBe(true);
    expect(session.racecraftAgreementFamilyCertificateFailures).toBeUndefined();
  });

  test('keeps a solitary emergency arc without demanding a self-claim', () => {
    const index = straightIndex();
    const normal = normalLateralEnvelope(built.tr, index);
    const lateral = normal.maximum + 0.5;
    const entry = activeEntry('ESCAPE', index, lateral, 30);
    const distance = Math.ceil(90 / built.tr.step) * built.tr.step;
    const endProgress = entry.prog + distance;
    const endIndex = (index + Math.round(distance / built.tr.step)) %
      built.tr.n;
    const plan = {
      mode: 'side-outside',
      key: `test:published-emergency:${index}`,
      anchors: [
        {
          index,
          offset: lateral,
          s: entry.prog
        },
        {
          index: endIndex,
          offset: lateral,
          s: endProgress
        }
      ],
      pinnedFirst: true,
      topology: 'right',
      surfaceAuthorization: 'emergency',
      emergencyReason: 'collision-avoidance'
    } satisfies Exclude<PathPlan, { mode: 'ideal' } | { mode: 'pit' }>;
    const longitudinal: RacecraftLongitudinalProgram = {
      progress: [entry.prog, endProgress],
      speed: [entry.spd, entry.spd],
      brakingEffort: entry.brakingEffort,
      slowPointOwnerCode: null,
      bindingSlowPoint: null
    };
    const decision: RacecraftDecision = {
      at: 20,
      selectedKind: 'corner-outside',
      selectedPlanKey: plan.key,
      candidateCount: 1,
      targetLateral: lateral,
      interactionCause: 'ordinary',
      chosenUtilization: 0,
      selectedLongitudinalProgram: longitudinal,
      economics: [],
      certificate: placeholderCertificate(
        racecraftStableFamilyId('corner-outside', plan, null)
      ),
      candidates: [{
        kind: 'corner-outside',
        plan,
        feasible: true,
        vetoes: [],
        targetLateral: lateral,
        slowPointOwnerCode: null,
        slowPoint: null,
        interactionCause: 'ordinary',
        ownTimeSeconds: 0,
        billSeconds: 0,
        recourseSeconds: 0,
        proximitySeconds: 0,
        positionValueSeconds: 0,
        attemptLossSeconds: 0,
        battleSpendSeconds: 0,
        effortRiskSeconds: 0,
        positionGain: false,
        minimumPlannedClearanceMetres: null,
        tieBandSeconds: 0,
        hazardCount: 0,
        switchChanged: false,
        brakingEffort: entry.brakingEffort,
        gripUtilization: 0,
        direction: 'right',
        speedClass: 'free',
        cost: 0
      }]
    };
    const session = raceSession([entry]);
    session.t = 20;
    entry.racecraftDecision = decision;
    entry.racecraftLongitudinalProgram = longitudinal;
    installRacecraftPathPlan(
      built.tr,
      entry,
      `space:${plan.key}`,
      plan,
      'racecraft:self'
    );
    evaluateLaneProgram(session, entry);
    entry.car!.offCourse = true;
    expect(lateral).toBeLessThan(
      emergencyLateralEnvelope(built.tr, index).maximum
    );
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(entry.code)!.trusted).toBe(true);

    session.t += 1 / 30;
    updateTraffic(session);

    expect(entry.racecraftDecision).toBe(decision);
    // Every selected candidate installs its one complete speed authority;
    // the presence of a rival constraint is no longer a second install gate.
    expect(entry.racecraftLongitudinalProgram)
      .toBe(decision.selectedLongitudinalProgram!);
    expect(entry.racecraftDecision.selectedLongitudinalProgram)
      .toBe(longitudinal);
    expect(entry.racecraftPathPlan).toBe(plan);
    expect(entry.laneProgram.reason).toBe(`space:${plan.key}`);
    expect(entry.laneProgram.binding).toBe('racecraft:self');
    expect(entry.laneProgram.surfaceAuthorization).toBe('emergency');
    expect(session.racecraftClaims?.has(entry.code)).toBe(false);
    expect(entry.racecraftClaim).toBeUndefined();
  });

  test('absorbs a same-family point revision inside the difference beta', () => {
    const { session, entry, rival, decision } =
      clearStandingDecision('BETA-REVISION');
    expect(decision.candidates.every(candidate =>
      candidate.billSeconds === 0 &&
      candidate.recourseSeconds === 0
    )).toBe(true);
    const previous = session.racecraftClaims!.get(rival.code)!;
    const revised: RacecraftClaim = {
      ...previous,
      publicationRevision: previous.publicationRevision + 1,
      stations: previous.stations.map(station => ({
        ...station,
        index: (station.index + 1) % built.tr.n,
        s: (station.s + built.tr.step) % built.tr.len
      }))
    };
    session.racecraftClaims = new Map(session.racecraftClaims)
      .set(rival.code, revised);
    rival.racecraftClaim = revised;

    expect(decision.certificate.claimRevisions[rival.code])
      .toBe(previous.publicationRevision);
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBeNull();
    expect(decision.certificate.claimRevisions[rival.code])
      .toBe(revised.publicationRevision);
    expect(session.racecraftTier0BetaRechecks).toBe(1);
    expect(session.racecraftTier0BetaAccepts).toBe(1);
    expect(session.racecraftTier0BetaBreaks ?? 0).toBe(0);
  });

  test('does not absorb prediction-family or source revisions', () => {
    const { session, entry, rival, decision } =
      clearStandingDecision('CLASS-REVISION');
    const previous = session.racecraftClaims!.get(rival.code)!;
    const changedFamily: RacecraftClaim = {
      ...previous,
      predictionKey: `${previous.predictionKey}:changed-family`,
      publicationRevision: previous.publicationRevision + 1,
      stations: previous.stations.map(station => ({ ...station }))
    };
    session.racecraftClaims = new Map(session.racecraftClaims)
      .set(rival.code, changedFamily);
    rival.racecraftClaim = changedFamily;
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBe('claim-revision');
    expect(decision.certificate.claimRevisions[rival.code])
      .toBe(previous.publicationRevision);

    const changedSource: RacecraftClaim = {
      ...previous,
      source: 'rederived',
      publicationRevision: previous.publicationRevision + 2,
      stations: previous.stations.map(station => ({ ...station }))
    };
    session.racecraftClaims = new Map(session.racecraftClaims)
      .set(rival.code, changedSource);
    rival.racecraftClaim = changedSource;
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBe('claim-revision');
    expect(session.racecraftTier0BetaRechecks ?? 0).toBe(0);
    expect(session.racecraftTier0BetaAccepts ?? 0).toBe(0);
  });

  test('revises when a rederived worldline departs its aged point publication', () => {
    const index = straightIndex();
    const rivalIndex = (index + 10) % built.tr.n;
    const entry = activeEntry(
      'REVISION-EGO',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const rival = activeEntry(
      'REVISION-RIVAL',
      rivalIndex,
      built.tr.idealPath.off[rivalIndex]!,
      28
    );
    const session = raceSession([entry, rival]);
    publishAllClaims(session);
    const initial = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    );
    expect(initial).not.toBeNull();
    entry.racecraftDecision = initial!;

    const elapsed = 1 / 30;
    advanceEntryAlongClaim(
      entry,
      session.racecraftClaims!.get(entry.code)!,
      elapsed
    );
    advanceEntryAlongClaim(
      rival,
      session.racecraftClaims!.get(rival.code)!,
      elapsed
    );
    displaceEntryLaterally(rival, PHYS.carWid / 2);
    rival.car!.slipR = 0.3;
    session.t += elapsed;
    publishAllClaims(session);
    const revoked = session.racecraftClaims!.get(rival.code)!;
    expect(revoked.source).toBe('rederived');
    expect(revoked.publicationRevision).toBe(1);
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBe('claim-revision');

    const refreshed = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    );
    expect(refreshed).not.toBeNull();
    entry.racecraftDecision = refreshed!;
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBeNull();

    advanceEntryAlongClaim(
      entry,
      session.racecraftClaims!.get(entry.code)!,
      elapsed
    );
    advanceEntryAlongClaim(
      rival,
      session.racecraftClaims!.get(rival.code)!,
      elapsed
    );
    session.t += elapsed;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(rival.code)!
      .publicationRevision).toBe(2);
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBeNull();
    expect(refreshed!.certificate.claimRevisions[rival.code]).toBe(2);
    expect(session.racecraftTier0BetaAccepts).toBe(1);
  });

  test('seals installed authority without absorbing an unseen publication', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'SNAPSHOT-SEAL-EGO',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const rivalIndex = (index + 8) % built.tr.n;
    const rival = activeEntry(
      'SNAPSHOT-SEAL-RIVAL',
      rivalIndex,
      built.tr.idealPath.off[rivalIndex]!,
      30
    );
    const session = raceSession([entry, rival]);
    session.t = 20;
    publishAllClaims(session);
    const decision = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    )!;
    entry.racecraftDecision = decision;
    expect(decision.certificate.claimRevisions[rival.code]).toBe(0);

    displaceEntryLaterally(rival, PHYS.carWid / 2);
    rival.car!.slipR = 0.3;
    publishAllClaims(session);
    expect(session.racecraftClaims!.get(rival.code)!.publicationRevision)
      .toBe(1);

    sealRacecraftDecisionCertificate(session, entry, [rival]);

    expect(decision.certificate.claimRevisions[rival.code]).toBe(0);
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBe('claim-revision');
  });

  test('expires an active certificate exactly at the declared ceiling', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'EXPIRY',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const rival = activeEntry(
      'EXPIRY-RIVAL',
      (index + 10) % built.tr.n,
      built.tr.idealPath.off[(index + 10) % built.tr.n]!,
      32
    );
    const session = raceSession([entry, rival]);
    publishAllClaims(session);
    entry.racecraftDecision = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    )!;
    const due = entry.racecraftDecision.certificate.validUntil;
    expect(due).toBeCloseTo(
      session.t + RACECRAFT_DECISION_INTERVAL_SECONDS,
      12
    );

    session.t = due - 1e-6;
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBeNull();
    session.t = due;
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBe('expiry');
  });

  test('invalidates a deferred analytic family after its anchor ages', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'AGED-AUTHORITY',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const rivalIndex = (index + 3) % built.tr.n;
    const rival = activeEntry(
      'AGED-RIVAL',
      rivalIndex,
      built.tr.idealPath.off[rivalIndex]!,
      32
    );
    const session = raceSession([entry, rival]);
    session.t = 20;
    publishAllClaims(session);
    const evaluated = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    )!;
    const selected = evaluated.candidates.find(candidate =>
      candidate.kind !== 'hold' &&
      candidate.kind !== 'brake-behind' &&
      candidate.plan.mode !== 'ideal' &&
      candidate.plan.mode !== 'pit'
    )!;
    expect(selected).toBeDefined();
    if (selected.plan.mode === 'ideal' || selected.plan.mode === 'pit')
      throw new Error('test requires one analytic candidate');
    const selectedPlan = selected.plan;
    entry.racecraftDecision = {
      ...evaluated,
      selectedKind: selected.kind,
      selectedPlanKey: selectedPlan.key,
      certificate: {
        ...evaluated.certificate,
        selectedFamilyId: racecraftStableFamilyId(
          selected.kind,
          selectedPlan,
          selected.slowPointOwnerCode
        )
      }
    };
    installRacecraftPathPlan(
      built.tr,
      entry,
      `space:${selectedPlan.key}`,
      selectedPlan,
      'racecraft:self'
    );
    placeEntry(
      entry,
      (index + 1) % built.tr.n,
      built.tr.idealPath.off[(index + 1) % built.tr.n]!
    );
    session.t += 1 / 30;
    sealRacecraftDecisionCertificate(session, entry, [rival]);
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBeNull();

    clearLaneProgram(entry, 'recenter:expired');
    sealRacecraftDecisionCertificate(session, entry, [rival]);
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      [rival]
    )).toBe('authority');
  });

  test('uses semantic hold and brake identities across moving anchors', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'STABLE-EGO',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const rival = activeEntry(
      'STABLE-RIVAL',
      (index + 3) % built.tr.n,
      built.tr.idealPath.off[(index + 3) % built.tr.n]!,
      20
    );
    const session = raceSession([entry, rival]);
    const gap = PHYS.carLen +
      oneIntervalPhysicalDivergence(session, rival);
    rival.car!.s = (entry.car!.s + gap) % built.tr.len;
    rival.prog = entry.prog + gap;
    publishAllClaims(session);
    const evaluated = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    )!;
    const hold = evaluated.candidates.find(candidate =>
      candidate.kind === 'hold')!;
    const brake = evaluated.candidates.find(candidate =>
      candidate.kind === 'brake-behind')!;
    for (const selected of [hold, brake]) {
      entry._racecraftAppliedKind = selected.kind;
      entry.racecraftDecision = {
        ...evaluated,
        selectedKind: selected.kind,
        selectedPlanKey: selected.plan.key,
        certificate: {
          ...evaluated.certificate,
          selectedFamilyId: racecraftStableFamilyId(
            selected.kind,
            selected.plan,
            selected.slowPointOwnerCode
          )
        }
      };
      sealRacecraftDecisionCertificate(session, entry, [rival]);
      const originalFamily =
        entry.racecraftDecision.certificate.selectedFamilyId;
      entry.prog += built.tr.step;
      entry.car!.s = (entry.car!.s + built.tr.step) % built.tr.len;
      entry.car!.progIdx = (entry.car!.progIdx + 1) % built.tr.n;
      rival.prog += built.tr.step;
      rival.car!.s = (rival.car!.s + built.tr.step) % built.tr.len;
      rival.car!.progIdx = (rival.car!.progIdx + 1) % built.tr.n;
      session.t += 1 / 30;
      entry._hitT = session.t;

      expect(racecraftDecisionCertificateBreakReason(
        session,
        entry,
        [rival]
      )).toBeNull();
      expect(entry.racecraftDecision.certificate.selectedFamilyId)
        .toBe(originalFamily);
    }
  });

  test('short-circuits an exact solitary ideal without candidate scoring', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'SOLITARY',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const session = raceSession([entry]);
    const before = session.racecraftCandidatesEvaluated ?? 0;

    const decision = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    )!;

    expect(decision.selectedKind).toBe('ideal');
    expect(decision.candidateCount).toBe(0);
    expect(decision.candidates).toEqual([]);
    expect(decision.selectedLongitudinalProgram).toBeNull();
    expect(decision.certificate.zeroHazardIdeal).toBe(true);
    expect(decision.certificate.validUntil).toBe(Infinity);
    expect(session.racecraftCandidatesEvaluated ?? 0).toBe(before);
    expect(session.racecraftEvaluatorWork?.candidateFamilyBuilds ?? 0).toBe(0);
    expect(session.racecraftEvaluatorWork?.seedEvaluations ?? 0).toBe(0);
  });

  test('does not issue infinite ideal authority to an offset solitary car', () => {
    const index = straightIndex();
    const ideal = built.tr.idealPath.off[index]!;
    const entry = activeEntry('OFFSET-DOMINANCE', index, ideal + 2, 32);
    entry.laneProgram.bias = 2;
    const session = raceSession([entry]);

    const decision = evaluateRacecraftDecision(
      session,
      entry,
      session.entries
    )!;

    expect(decision.candidateCount).toBeGreaterThan(0);
    expect(decision.certificate.zeroHazardIdeal).toBe(false);
    expect(decision.certificate.validUntil).toBeCloseTo(
      session.t + RACECRAFT_DECISION_INTERVAL_SECONDS,
      12
    );
    expect(session.racecraftEvaluatorWork?.candidateFamilyBuilds)
      .toBeGreaterThan(0);
  });

  test('demands both endpoints at the exact interaction boundary', () => {
    const index = straightIndex();
    const first = activeEntry(
      'BOUNDARY-A',
      index,
      built.tr.idealPath.off[index]!
    );
    const distanceSamples = Math.round(
      TRAFFIC_NEIGHBOR_SCAN_METRES / built.tr.step
    );
    const secondIndex = (index + distanceSamples) % built.tr.n;
    const second = activeEntry(
      'BOUNDARY-B',
      secondIndex,
      built.tr.idealPath.off[secondIndex]!
    );
    second.car!.s = (
      first.car!.s + TRAFFIC_NEIGHBOR_SCAN_METRES
    ) % built.tr.len;
    second.prog = first.prog + TRAFFIC_NEIGHBOR_SCAN_METRES;
    const session = raceSession([first, second]);

    expect(racecraftDemandedClaimCodes(
      session,
      session.entries
    )).toEqual(new Set([first.code, second.code]));
  });

  test('removes undemanded claims and their publication-only family', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'CLAIM-REMOVAL',
      index,
      built.tr.idealPath.off[index]!
    );
    const session = raceSession([entry]);
    publishAllClaims(session);
    entry._racecraftRederivedProgram = {
      kind: 'ideal',
      plan: { mode: 'ideal', key: 'ideal' },
      slowPointOwnerCode: null,
      absorbedDecisionAt: session.t
    };

    publishRacecraftClaimSnapshot(session, session.entries, new Set());

    expect(session.racecraftClaims?.size).toBe(0);
    expect(entry.racecraftClaim).toBeUndefined();
    expect(entry._racecraftClaimWrite).toBeUndefined();
    expect(entry._racecraftRederivedProgram).toBeUndefined();

    publishRacecraftClaimSnapshot(
      session,
      session.entries,
      new Set([entry.code])
    );
    expect(session.racecraftClaims!.get(entry.code)!.publicationRevision)
      .toBe(1);
  });

  test('keeps a solitary ideal in Tier 0 without periodic deliberation', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'SOLITARY-SCHEDULER',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const session = raceSession([entry]);
    session.t = 20;

    updateTraffic(session);
    const candidateEvaluations = session.racecraftCandidatesEvaluated ?? 0;
    expect(entry.racecraftDecision?.candidateCount).toBe(0);
    expect(entry.racecraftDecision?.candidates).toEqual([]);
    expect(entry.racecraftDecision?.selectedLongitudinalProgram).toBeNull();
    expect(entry.racecraftLongitudinalProgram).toBeNull();
    expect(entry.laneBuffer).toBeUndefined();
    expect(entry.racecraftClaim).toBeUndefined();
    expect(session.racecraftClaims?.has(entry.code)).toBe(false);
    expect(session.racecraftTier0IdealDominance).toBe(1);
    expect(session.racecraftTier1Deliberations ?? 0).toBe(0);
    const claimEpoch = session.racecraftClaimTick;

    session.t += RACECRAFT_DECISION_INTERVAL_SECONDS * 2;
    updateTraffic(session);
    expect(session.racecraftCandidatesEvaluated ?? 0)
      .toBe(candidateEvaluations);
    expect(session.racecraftTier1Deliberations ?? 0).toBe(0);
    expect(session.racecraftTier0Accepted).toBe(2);
    expect(session.racecraftClaimTick).toBe(claimEpoch);
  });

  test('re-centres offset solitude continuously before dropping its lane', () => {
    const index = straightIndex();
    const ideal = built.tr.idealPath.off[index]!;
    const entry = activeEntry('OFFSET-SOLITUDE', index, ideal + 2);
    const session = raceSession([entry]);
    session.t = 20;
    entry.racecraftLongitudinalProgram = {
      progress: [entry.prog, entry.prog + 10],
      speed: [entry.spd, entry.spd],
      brakingEffort: entry.brakingEffort,
      slowPointOwnerCode: null,
      bindingSlowPoint: null
    };

    updateTraffic(session);

    expect(entry.racecraftDecision).toBeUndefined();
    expect(entry.racecraftLongitudinalProgram).toBeNull();
    expect(entry.racecraftClaim).toBeUndefined();
    expect(entry.laneBuffer).toBeDefined();
    expect(entry.laneProgram.binding).toBe('recenter:self');
    expect(entry.laneProgram.points[0]!.eta).toBeCloseTo(2, 10);
    expect(entry.laneProgram.points[1]!.eta).toBe(0);
    expect(entry.laneTargetDiscontinuities ?? 0).toBe(0);
    expect(session.racecraftTier1Deliberations ?? 0).toBe(0);

    placeEntry(entry, index, ideal);
    session.t += 1 / 30;
    updateTraffic(session);
    expect(entry.laneProgram.points).toHaveLength(0);
    expect(entry.laneProgram.binding).toBeNull();
    expect(entry.laneBuffer).toBeUndefined();

    session.t += 1 / 30;
    updateTraffic(session);
    expect(entry.racecraftDecision?.certificate.zeroHazardIdeal).toBe(true);
    expect(entry.racecraftDecision?.candidates).toEqual([]);
    expect(entry.laneBuffer).toBeUndefined();
    expect(session.racecraftTier1Deliberations ?? 0).toBe(0);
  });

  test('publishes both claims on interaction entry and clears them on exit', () => {
    const index = straightIndex();
    const first = activeEntry(
      'REENTRY-A',
      index,
      built.tr.idealPath.off[index]!
    );
    const farIndex = (
      index + Math.ceil(
        (TRAFFIC_NEIGHBOR_SCAN_METRES + 30) / built.tr.step
      )
    ) % built.tr.n;
    const second = activeEntry(
      'REENTRY-B',
      farIndex,
      built.tr.idealPath.off[farIndex]!
    );
    const session = raceSession([first, second]);
    session.t = 20;

    updateTraffic(session);
    expect(session.racecraftClaims?.size).toBe(0);

    const nearIndex = (
      index + Math.ceil((PHYS.carLen + 1) / built.tr.step)
    ) % built.tr.n;
    placeEntry(second, nearIndex);
    session.t += 1 / 30;
    updateTraffic(session);
    const firstClaim = session.racecraftClaims?.get(first.code);
    const secondClaim = session.racecraftClaims?.get(second.code);
    expect(firstClaim).toBeDefined();
    expect(secondClaim).toBeDefined();
    expect(firstClaim!.publishedAt).toBe(session.t);
    expect(secondClaim!.publishedAt).toBe(session.t);
    expect(first.racecraftDecision?.certificate.neighborCodes)
      .toEqual([second.code]);
    expect(second.racecraftDecision?.certificate.neighborCodes)
      .toEqual([first.code]);

    placeEntry(second, farIndex);
    session.t += 1 / 30;
    updateTraffic(session);
    expect(session.racecraftClaims?.size).toBe(0);
    expect(first.racecraftClaim).toBeUndefined();
    expect(second.racecraftClaim).toBeUndefined();

    placeEntry(second, nearIndex);
    session.t += 1 / 30;
    updateTraffic(session);
    expect(session.racecraftClaims?.has(first.code)).toBe(true);
    expect(session.racecraftClaims?.has(second.code)).toBe(true);
  });

  test('does not spin a certified no-feasible-winner decision', () => {
    const index = straightIndex();
    const entry = activeEntry(
      'NO-WINNER',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const session = raceSession([entry]);
    entry.racecraftDecision = {
      at: session.t,
      selectedKind: null,
      selectedPlanKey: null,
      candidateCount: 1,
      targetLateral: entry.latNow,
      interactionCause: null,
      chosenUtilization: 0,
      selectedLongitudinalProgram: null,
      economics: [],
      certificate: placeholderCertificate(),
      candidates: []
    };
    sealRacecraftDecisionCertificate(session, entry, []);
    session.t += 1 / 30;

    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      []
    )).toBeNull();
  });

  test('re-evaluates manually swapped families when publication changes', () => {
    const index = straightIndex();
    const follower = activeEntry(
      'CADENCE-FOLLOW',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const leaderIndex = (index + 3) % built.tr.n;
    const leader = activeEntry(
      'CADENCE-LEAD',
      leaderIndex,
      built.tr.idealPath.off[leaderIndex]!,
      32
    );
    const gap = PHYS.carLen + 0.1;
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    const session = raceSession([follower, leader]);
    session.t = 20;
    updateTraffic(session);
    const followerBrake = follower.racecraftDecision!.candidates.find(
      candidate => candidate.kind === 'brake-behind'
    )!;
    const leaderHold = leader.racecraftDecision!.candidates.find(
      candidate => candidate.kind === 'hold'
    )!;
    expect(followerBrake).toBeDefined();
    expect(leaderHold).toBeDefined();
    for (const [entry, selected] of [
      [follower, followerBrake],
      [leader, leaderHold]
    ] as const) {
      entry._racecraftAppliedKind = selected.kind;
      clearLaneProgram(entry, 'ideal');
      entry.racecraftDecision = {
        ...entry.racecraftDecision!,
        selectedKind: selected.kind,
        selectedPlanKey: selected.plan.key,
        certificate: {
          ...entry.racecraftDecision!.certificate,
          selectedFamilyId: racecraftStableFamilyId(
            selected.kind,
            selected.plan,
            selected.slowPointOwnerCode
          )
        }
      };
    }
    publishAllClaims(session);
    sealRacecraftDecisionCertificate(session, follower, [leader]);
    sealRacecraftDecisionCertificate(session, leader, [follower]);
    const candidateEvaluations = session.racecraftCandidatesEvaluated ?? 0;
    const tier1 = session.racecraftTier1Deliberations ?? 0;
    for (let tick = 0; tick < 2; tick++) {
      const elapsed = 1 / 30;
      advanceEntryAlongClaim(
        follower,
        session.racecraftClaims!.get(follower.code)!,
        elapsed
      );
      advanceEntryAlongClaim(
        leader,
        session.racecraftClaims!.get(leader.code)!,
        elapsed
      );
      session.t += elapsed;
      follower._hitT = leader._hitT = session.t;
      updateTraffic(session);
    }

    expect(session.racecraftCertificateBreaks).toEqual({
      bootstrap: 2,
      'claim-revision': 4
    });
    expect(session.racecraftCandidatesEvaluated ?? 0)
      .toBeGreaterThan(candidateEvaluations);
    expect(session.racecraftTier1Deliberations ?? 0).toBe(tier1 + 4);
  });

  test('stages simultaneous bootstrap decisions against one claim snapshot', () => {
    const index = straightIndex();
    const first = activeEntry(
      'SNAPSHOT-A',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const second = activeEntry(
      'SNAPSHOT-B',
      (index + 3) % built.tr.n,
      built.tr.idealPath.off[(index + 3) % built.tr.n]!,
      32
    );
    second.car!.s = (first.car!.s + PHYS.carLen + 0.1) % built.tr.len;
    second.prog = first.prog + PHYS.carLen + 0.1;
    const session = raceSession([first, second]);
    session.t = 20;

    updateTraffic(session);

    expect(first.racecraftDecision?.at).toBe(20);
    expect(second.racecraftDecision?.at).toBe(20);
    expect(first.racecraftDecision?.certificate
      .claimRevisions[second.code]).toBe(0);
    expect(second.racecraftDecision?.certificate
      .claimRevisions[first.code]).toBe(0);
    expect(session.racecraftCertificateBreaks?.bootstrap).toBe(2);
  });

  test('expires dead lateral authority into one physical recenter program', () => {
    const index = straightIndex();
    const entry = activeEntry('RECENTER', index, 2);
    entry.laneProgram = {
      points: [],
      reason: 'space:dead',
      binding: 'racecraft:DEAD',
      bias: 2
    };
    entry.racecraftDecision = {
      at: 0,
      selectedKind: 'corner-inside',
      selectedPlanKey: 'space:dead',
      candidateCount: 1,
      targetLateral: 2,
      interactionCause: null,
      chosenUtilization: 0,
      selectedLongitudinalProgram: null,
      economics: [],
      certificate: placeholderCertificate(),
      candidates: []
    };
    const session = raceSession([entry]);
    sealRacecraftDecisionCertificate(session, entry, []);

    maintainRacingLineZeroState(session, entry, session.entries);

    expect(entry.laneProgram.binding).toBe('recenter:self');
    expect(entry.laneProgram.points.at(-1)?.eta).toBe(0);
    expect(racecraftDecisionCertificateBreakReason(
      session,
      entry,
      []
    )).toBe('authority');
    expect(session.racecraftExpiredPrograms).toBe(1);
  });

  test('prices an order-gaining side family as one battle attempt', () => {
    const { session, follower } =
      orderGainingStraightBattle('ECON');

    const decision = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    )!;
    const attack = decision.candidates.find(candidate =>
      candidate.positionGain &&
      candidate.billSeconds === 0 &&
      candidate.attemptLossSeconds > 0
    );
    expect(decision.candidateCount)
      .toBeLessThanOrEqual(MAX_RACECRAFT_CANDIDATES);
    expect(session.racecraftPathsMaterialized ?? 0).toBe(0);
    expect(attack).toBeDefined();
    expect(attack!.positionGain).toBe(true);
    expect(decision.economics[0]!.opportunityPresent).toBe(true);
    expect(decision.economics[0]!.positionValueSeconds).toBeGreaterThan(0);
    expect(attack!.billSeconds).toBe(0);
    expect(attack!.positionValueSeconds).toBe(0);
    expect(attack!.attemptLossSeconds)
      .toBe(MEASURED_ATTACK_TRANSITION_LOSS_SECONDS);
    expect(attack!.battleSpendSeconds).toBeCloseTo(
      attack!.attemptLossSeconds +
        attack!.recourseSeconds +
        attack!.proximitySeconds,
      12
    );
    const stay = decision.candidates.find(candidate =>
      candidate.kind === 'hold'
    )!;
    expect(stay.positionValueSeconds)
      .toBe(decision.economics[0]!.positionValueSeconds);
  });

  test('charges one attack-family transition per opportunity episode', () => {
    const { session, follower, leader } =
      orderGainingStraightBattle('EPISODE');
    const first = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    )!;
    const selected = first.candidates.find(candidate =>
      candidate.plan.key === first.selectedPlanKey
    )!;
    const familyId = racecraftStableFamilyId(
      selected.kind,
      selected.plan,
      selected.slowPointOwnerCode
    );
    expect(selected.attemptLossSeconds)
      .toBe(MEASURED_ATTACK_TRANSITION_LOSS_SECONDS);

    const continuing = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    )!;
    const sameFamily = continuing.candidates.find(candidate =>
      racecraftStableFamilyId(
        candidate.kind,
        candidate.plan,
        candidate.slowPointOwnerCode
      ) === familyId
    )!;
    expect(sameFamily).toBeDefined();
    expect(sameFamily.attemptLossSeconds).toBe(0);

    const nearIndex = leader.car!.progIdx;
    const nearS = leader.car!.s;
    const nearProg = leader.prog;
    const farDistance = TRAFFIC_NEIGHBOR_SCAN_METRES + PHYS.carLen;
    const farIndex = (
      follower.car!.progIdx +
      Math.round(farDistance / built.tr.step)
    ) % built.tr.n;
    placeEntry(leader, farIndex);
    leader.car!.s = (follower.car!.s + farDistance) % built.tr.len;
    leader.prog = follower.prog + farDistance;
    publishAllClaims(session);
    const absent = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    )!;
    expect(absent.economics).toEqual([]);

    placeEntry(leader, nearIndex);
    leader.car!.s = nearS;
    leader.prog = nearProg;
    publishAllClaims(session);
    const returned = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    )!;
    const restarted = returned.candidates.find(candidate =>
      racecraftStableFamilyId(
        candidate.kind,
        candidate.plan,
        candidate.slowPointOwnerCode
      ) === familyId
    )!;
    expect(restarted).toBeDefined();
    expect(restarted.attemptLossSeconds)
      .toBe(MEASURED_ATTACK_TRANSITION_LOSS_SECONDS);
  });

  test('treats a partial pull-out as an attack and activates defense', () => {
    const index = straightIndex();
    const gap = 30;
    const leaderIndex = (
      index + Math.round(gap / built.tr.step)
    ) % built.tr.n;
    const follower = activeEntry(
      'NO-GAIN-FOLLOW',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const leader = activeEntry(
      'NO-GAIN-LEAD',
      leaderIndex,
      built.tr.idealPath.off[leaderIndex]!,
      32
    );
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    const quietSession = raceSession([follower, leader]);
    evaluateLaneProgram(quietSession, follower);
    evaluateLaneProgram(quietSession, leader);
    publishAllClaims(quietSession);
    const pullOutDecision = evaluateRacecraftDecision(
      quietSession,
      follower,
      quietSession.entries
    )!;
    const pullOut = pullOutDecision.candidates.find(candidate =>
      (candidate.kind === 'corner-inside' ||
        candidate.kind === 'corner-outside') &&
      !candidate.positionGain
    )!;
    expect(pullOut).toBeDefined();
    expect(pullOut.attemptLossSeconds)
      .toBe(MEASURED_ATTACK_TRANSITION_LOSS_SECONDS);
    expect(pullOut.positionValueSeconds).toBe(0);
    expect(pullOutDecision.economics[0]!.opportunityPresent).toBe(true);
    follower.racecraftDecision = {
      ...pullOutDecision,
      selectedKind: pullOut.kind,
      selectedPlanKey: pullOut.plan.key
    };
    const quietDefense = evaluateRacecraftDecision(
      quietSession,
      leader,
      quietSession.entries
    )!;
    expect(quietDefense.economics.some(value =>
      value.role === 'defense' &&
      value.rivalCode === follower.code)).toBe(true);
  });

  test('preserves tow on the shared prefix before a pull-out loses it', () => {
    const index = straightIndex();
    const gap = 12;
    const leaderIndex = (
      index + Math.round(gap / built.tr.step)
    ) % built.tr.n;
    const follower = activeEntry(
      'TOW-FOLLOW',
      index,
      built.tr.idealPath.off[index]!,
      32
    );
    const leader = activeEntry(
      'TOW-LEAD',
      leaderIndex,
      built.tr.idealPath.off[leaderIndex]!,
      32
    );
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    const session = raceSession([follower, leader]);
    evaluateLaneProgram(session, follower);
    evaluateLaneProgram(session, leader);
    publishAllClaims(session);
    const decision = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    )!;
    const hold = decision.candidates.find(candidate =>
      candidate.kind === 'hold'
    )!;
    const side = decision.candidates.find(candidate =>
      candidate.kind === 'corner-inside' &&
      candidate.plan.mode !== 'ideal' &&
      candidate.plan.mode !== 'pit' &&
      candidate.plan.surfaceAuthorization !== 'emergency'
    )!;
    const holdProgram = rebuildRacecraftSelectedProgram(
      session,
      follower,
      session.entries,
      hold
    )!;
    const sideProgram = rebuildRacecraftSelectedProgram(
      session,
      follower,
      session.entries,
      side
    )!;
    const paired = Math.min(
      holdProgram.stations.length,
      sideProgram.stations.length
    );
    const firstLateralDivergence = Array.from(
      { length: paired },
      (_, station) => station
    ).find(station =>
      Math.abs(
        holdProgram.stations[station]!.lateral -
          sideProgram.stations[station]!.lateral
      ) > Number.EPSILON
    )!;
    expect(firstLateralDivergence).toBeGreaterThan(0);
    for (let station = 0; station < firstLateralDivergence; station++)
      expect(sideProgram.stations[station]!.speed)
        .toBeCloseTo(holdProgram.stations[station]!.speed, 12);
    expect(sideProgram.stations.slice(firstLateralDivergence).some(
      (station, offset) =>
        station.speed <
          holdProgram.stations[firstLateralDivergence + offset]!.speed -
            Number.EPSILON
    )).toBe(true);
  });

  test.skip(
    'prices a contested rejoin beyond the sampled horizon ' +
    '(derived 3 s catch does not intersect the authored rejoin)',
    () => {
    const index = straightIndex();
    const followerSpeed = 40;
    const leaderSpeed = 30;
    const derivedContactTime = 3;
    const gap = PHYS.carLen +
      (followerSpeed - leaderSpeed) * derivedContactTime;
    const leaderIndex = (
      index + Math.round(gap / built.tr.step)
    ) % built.tr.n;
    const follower = activeEntry(
      'TERMINAL-FOLLOW',
      index,
      built.tr.idealPath.off[index]!,
      followerSpeed
    );
    const leader = activeEntry(
      'TERMINAL-LEAD',
      leaderIndex,
      built.tr.idealPath.off[leaderIndex]!,
      leaderSpeed
    );
    leader.car!.s = (follower.car!.s + gap) % built.tr.len;
    leader.prog = follower.prog + gap;
    const session = raceSession([follower, leader]);
    evaluateLaneProgram(session, follower);
    evaluateLaneProgram(session, leader);
    publishAllClaims(session);

    const decision = evaluateRacecraftDecision(
      session,
      follower,
      session.entries
    )!;

    expect(decision).not.toBeNull();
    expect(decision.candidates.every(candidate =>
      !candidate.feasible || Number.isFinite(candidate.cost)
    )).toBe(true);
    expect(session.racecraftOffHorizonContests ?? 0).toBeGreaterThan(0);
    expect(session.racecraftOffHorizonMaximumContactTimeSeconds ?? 0)
      .toBeGreaterThan(2.4);
    }
  );

});
