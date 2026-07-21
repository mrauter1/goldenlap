import { describe, expect, test } from 'bun:test';

import { botStep } from '../../../src/core/autopilot';
import type { Car, PathMode } from '../../../src/core/model';
import { derivePathGeometry, nextCorner } from '../../../src/core/racing-line';
import { makeCar } from '../../../src/core/physics-engine';
import { PHYS } from '../../../src/core/physics';
import { normalLateralIsLegal } from '../../../src/core/surface';
import { TRACK_DEFS } from '../../../src/data/tracks';
import { prepareHeadlessTrack } from '../../../src/game/headless-sim';
import { createEntry, stepEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  PathPlan,
  RacecraftClaim,
  RacecraftDecision,
  RaceSession
} from '../../../src/session/model';
import {
  materializePitPathPlan,
  queueFollowSlowPoint,
  sampleCompactPathPlan,
  sampleCompactPathPlanOffsetAnalytic,
  setTargetAbsLat,
  syncPitPaths
} from '../../../src/session/racecraft/paths';
import { sampleQuinticHermiteSegment } from '../../../src/session/racecraft/interpolation';
import {
  clearLaneProgram,
  editLaneTarget,
  evaluateLaneProgram,
  installRacecraftPathPlan
} from '../../../src/session/racecraft/lane-program';
import { evaluateManeuverPlanCompact } from '../../../src/session/racecraft/feasibility';
import { updateRacecraftSideAgreements } from
  '../../../src/session/racecraft/corridor-planner';
import { publishRacecraftTacticalPublication } from
  '../../../src/session/racecraft/publication';
import {
  racecraftClaimSegmentCount,
  racecraftClaimSegmentEndTime,
  racecraftClaimStateAtTime,
  racecraftTrajectoryProgramFromRows
} from '../../../src/session/racecraft/claim';
import { entryDynamicMu, entryMu } from '../../../src/session/strategy';
import { evaluateRacecraftDecision } from '../../../src/session/racecraft/evaluator';
import { bestPassingCorner } from '../../../src/session/racecraft/traffic';

type ActiveEntry = Entry & { car: Car };

const TEAM = { id: 'path-test', name: 'Path Test', body: '#000', accent: '#fff' } as const;

function lineup(code: string): LineupEntry {
  return {
    team: TEAM,
    name: code,
    code,
    isPlayer: false,
    ci: 0,
    margin: 0,
    focus: 0.7,
    trait: ''
  };
}

function entry(code: string, teamIndex = 0): ActiveEntry {
  const value = createEntry({
    lineup: lineup(code),
    teamIndex,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  value.state = 'run';
  value.car = makeCar(0, 0, 0);
  return value as ActiveEntry;
}

function session(trackIndex = 0): RaceSession {
  const built = prepareHeadlessTrack(TRACK_DEFS[trackIndex]!.id);
  const track = built.tr;
  return {
    trk: track as RaceSession['trk'],
    prof: built.prof,
    entries: [],
    config: {
      playerWearRate: 1,
      engineerPrecision: 1,
      pitSkill: 1,
      pitFocus: 1,
      tuneBonus: 0,
      tuningPoints: 0,
      predictiveSafetyHz: 10
    },
    events: [],
    t: 20,
    scale: 1,
    prevScale: 1,
    wet: 0,
    evo: 0,
    phase: 'run',
    uiT: 0,
    trafT: 0,
    racecraftPredictiveSafetyIntervalTicks: 3,
    goT: 0,
    camI: 0,
    mode: 'race',
    countT: 0,
    _lt: 0,
    laps: 10,
    chequered: false,
    finCount: 0,
    winT: 0,
    endT: 0,
    raining: false,
    rainAt: -1,
    rainEnd: -1
  };
}

function publishAllClaims(session: RaceSession): void {
  const active = session.entries.filter(entry =>
    !!entry.car &&
    (entry.state === 'run' ||
      entry.state === 'pitIn' ||
      entry.state === 'pitOut')
  ) as Array<Entry & { car: NonNullable<Entry['car']> }>;
  updateRacecraftSideAgreements(session, active);
  const epoch = session.racecraftTrafficEpoch ?? 0;
  for (const value of active) {
    value._racecraftLastDecisionTrafficEpoch = epoch;
    publishRacecraftTacticalPublication(session, value, epoch);
  }
}

function placeAtIndex(sessionValue: RaceSession, value: ActiveEntry, index: number, speed = 28): void {
  const track = sessionValue.trk;
  const i = ((index % track.n) + track.n) % track.n;
  const offset = track.idealPath.off[i]!;
  const geometry = derivePathGeometry(track, track.idealPath);
  value.car.x = track.x[i]! + track.nx[i]! * offset;
  value.car.y = track.y[i]! + track.ny[i]! * offset;
  value.car.h = Math.atan2(geometry.ty[i]!, geometry.tx[i]!);
  value.car.vx = speed;
  value.car.vy = 0;
  value.car.s = i * track.step;
  value.car.progIdx = i;
  value.prog = value.car.s;
  value.spd = speed;
  value.latNow = offset;
  value.lat = 0;
  clearLaneProgram(value, 'test-place');
  editLaneTarget(sessionValue, value, offset, 'test-place');
}

function ahead(sessionValue: RaceSession, index: number, metres: number): number {
  return (index + Math.round(metres / sessionValue.trk.step)) % sessionValue.trk.n;
}

function setLateral(sessionValue: RaceSession, value: ActiveEntry, lateral: number): void {
  const index = value.car.progIdx;
  value.car.x = sessionValue.trk.x[index]! + sessionValue.trk.nx[index]! * lateral;
  value.car.y = sessionValue.trk.y[index]! + sessionValue.trk.ny[index]! * lateral;
  value.latNow = lateral;
}

describe('phase-varying racecraft lane programs', () => {
  test('evaluates defense once against one immutable attacker publication', () => {
    const race = session();
    const attacker = entry('FIXED-ATTACKER');
    const defender = entry('ONE-SLOT-DEFENDER');
    const corner = race.trk.corners.find(value =>
      value.id === 'prado-c08')!;
    const defenderIndex = corner.approachI;
    const attackerIndex = (
      defenderIndex -
      Math.ceil((PHYS.carLen + 12) / race.trk.step) +
      race.trk.n
    ) % race.trk.n;
    placeAtIndex(race, attacker, attackerIndex, 40);
    placeAtIndex(race, defender, defenderIndex, 30);
    race.entries = [attacker, defender];
    evaluateLaneProgram(race, attacker);
    evaluateLaneProgram(race, defender);
    publishAllClaims(race);

    const published = race.racecraftClaims!.get(attacker.code)!;
    const horizon = 3;
    const attackerPublication: RacecraftClaim = Object.freeze({
      ...published,
      mode: 'staged-attack',
      targetCode: defender.code,
      cornerId: corner.id,
      selectedPlanNumericId: 81,
      selectedFamilyNumericId: 82,
      trajectory: racecraftTrajectoryProgramFromRows(
        race.trk,
        {
          timeSeconds: 0,
          sMetres: attacker.car.s,
          lateralMetres: attacker.latNow,
          speedMetresPerSecond: attacker.spd,
          headingOffsetRadians: 0
        },
        [
          {
            timeSeconds: 1,
            sMetres: (
              attacker.car.s + attacker.spd
            ) % race.trk.len,
            lateralMetres: attacker.latNow - 1,
            speedMetresPerSecond: attacker.spd,
            headingOffsetRadians: 0
          },
          {
            timeSeconds: horizon,
            sMetres: (
              attacker.car.s + attacker.spd * horizon
            ) % race.trk.len,
            lateralMetres: attacker.latNow - 2.5,
            speedMetresPerSecond: attacker.spd,
            headingOffsetRadians: 0
          }
        ],
        attacker.prog
      )
    });
    const publications = new Map(race.racecraftClaims)
      .set(attacker.code, attackerPublication);
    race.racecraftClaims = publications;
    const attackerDecision = Object.freeze({
      at: race.t,
      selectedKind: 'corner-inside'
    }) as RacecraftDecision;
    attacker.racecraftDecision = attackerDecision;

    const decision = evaluateRacecraftDecision(
      race,
      defender,
      race.entries
    )!;

    expect(decision.candidateCount).toBeLessThanOrEqual(6);
    expect(
      decision.defensiveTargetCode === attacker.code ||
      decision.candidates.some(candidate =>
        candidate.vetoes.some(veto =>
          veto.startsWith('defensive-')))
    ).toBe(true);
    expect(race.racecraftEvaluatorWork?.decisionCalls).toBe(1);
    expect(race.racecraftNestedResponseEvaluations ?? 0).toBe(0);
    expect(
      decision.defensiveTargetCode == null ||
      decision.cornerOwnershipAssertion == null
    ).toBe(true);
    expect(attacker.racecraftDecision).toBe(attackerDecision);
    expect(race.racecraftClaims).toBe(publications);
    expect(race.racecraftClaims.get(attacker.code))
      .toBe(attackerPublication);
  });

  test('opens exact-width staged families after a corner attack gate has passed', () => {
    const race = session();
    const follower = entry('STAGED-FOLLOWER');
    const leader = entry('STAGED-LEADER');
    const corner = race.trk.corners.find(value =>
      value.id === 'prado-c06')!;
    const start = (corner.trackOutI + 5) % race.trk.n;
    placeAtIndex(race, follower, start, 40);
    placeAtIndex(
      race,
      leader,
      ahead(race, start, PHYS.carLen + 0.15),
      40
    );
    race.entries = [follower, leader];
    evaluateLaneProgram(race, follower);
    evaluateLaneProgram(race, leader);
    publishAllClaims(race);

    const decision = evaluateRacecraftDecision(
      race,
      follower,
      race.entries
    )!;
    const staged = decision.candidates.flatMap(candidate => {
      const plan = candidate.plan;
      return plan.mode !== 'ideal' &&
        plan.mode !== 'pit' &&
        (plan.mode === 'side-inside' ||
          plan.mode === 'side-outside')
        ? [{ candidate, plan }]
        : [];
    });

    expect(staged.length).toBeGreaterThan(0);
    expect(staged.some(({ candidate, plan }) =>
      plan.cornerId == null &&
      candidate.slowPointOwnerCode == null
    )).toBe(true);
    expect(staged.every(({ plan }) =>
      plan.lineBlend != null &&
      plan.lineBlend > 0 &&
      plan.lineBlend <= 1
    )).toBe(true);
    expect(['corner-inside', 'corner-outside'])
      .not.toContain(decision.selectedKind);
    expect(decision.candidateCount).toBeLessThanOrEqual(6);
  });

  test('binds brake-behind to its backward-composed slow point', () => {
    const race = session();
    const follower = entry('FOLLOWER');
    const leader = entry('LEADER');
    let straight = 0;
    for (let index = 1; index < race.trk.n; index++)
      if (Math.abs(race.trk.idealPath.k[index]!) <
          Math.abs(race.trk.idealPath.k[straight]!)) straight = index;
    placeAtIndex(race, follower, straight, 38);
    placeAtIndex(race, leader, ahead(race, straight, 18), 36);
    race.entries = [follower, leader];
    evaluateLaneProgram(race, follower);
    evaluateLaneProgram(race, leader);
    publishAllClaims(race);
    const published = race.racecraftClaims!.get(leader.code)!;
    const rows = Array.from(
      { length: racecraftClaimSegmentCount(published) },
      (_, index) => {
        const time = racecraftClaimSegmentEndTime(published, index);
        const state = racecraftClaimStateAtTime(
          race.trk,
          published,
          time
        );
        return {
          timeSeconds: time,
          sMetres: state.s,
          lateralMetres: state.lateral,
          speedMetresPerSecond: index === 0 ? 0 : 55,
          headingOffsetRadians: state.headingOffsetRadians
        };
      }
    );
    const claim: RacecraftClaim = {
      ...published,
      trajectory: racecraftTrajectoryProgramFromRows(
        race.trk,
        {
          timeSeconds: 0,
          sMetres: published.originS,
          lateralMetres: published.originCentre,
          speedMetresPerSecond: published.originSpeed,
          headingOffsetRadians:
            published.originHeadingOffsetRadians
        },
        rows,
        leader.prog
      )
    };
    race.racecraftClaims = new Map(race.racecraftClaims)
      .set(leader.code, claim);
    leader.spd = 55;
    leader.car.spd = 55;

    const decision = evaluateRacecraftDecision(
      race,
      follower,
      race.entries
    )!;
    const candidate = decision.candidates.find(value =>
      value.kind === 'brake-behind')!;

    expect(candidate.slowPointOwnerCode).toBe(leader.code);
    expect(candidate.slowPoint).not.toBeNull();
    const firstPublishedSpeed = racecraftClaimStateAtTime(
      race.trk,
      claim,
      racecraftClaimSegmentEndTime(claim, 0)
    ).speed;
    expect(candidate.slowPoint!.speed).toBe(firstPublishedSpeed);
    expect(candidate.slowPoint!.distance).toBeGreaterThan(0);
    expect(candidate.slowPoint).toEqual({
      distance: candidate.slowPoint!.distance,
      speed: firstPublishedSpeed,
      ownerCode: leader.code,
      reason: 'traffic-follow:cost-candidate',
      stationS: (
        follower.car.s + candidate.slowPoint!.distance
      ) % race.trk.len,
      publishedAt: race.t
    });
  });

  test('authors queue comfort as slow-point data without a speed cap', () => {
    const race = session();
    const follower = entry('QUEUE-FOLLOWER');
    const leader = entry('QUEUE-LEADER');
    placeAtIndex(race, follower, 200, 30);
    placeAtIndex(race, leader, ahead(race, 200, 30), 20);
    race.entries = [follower, leader];

    const point = queueFollowSlowPoint(
      race,
      follower,
      leader,
      30,
      0.65,
      'test'
    )!;

    expect(point.ownerCode).toBe(leader.code);
    expect(point.reason).toBe('traffic-comfort:test');
    expect(point.speed).toBe(leader.spd);
    expect(point.distance).toBeGreaterThanOrEqual(0);
    expect(point.distance).toBeLessThan(30 - PHYS.carLen);
    expect('allowance' in point).toBe(false);
  });

  test('vetoes recovery authority while two agreements leave no joint lane', () => {
    const race = session();
    const lower = entry('LOWER');
    const middle = entry('MIDDLE');
    const upper = entry('UPPER');
    placeAtIndex(race, lower, 200, 24);
    placeAtIndex(race, middle, 200, 24);
    placeAtIndex(race, upper, 200, 24);
    race.entries = [lower, middle, upper];
    const certificate = {
      contextKey: 'test:pinch',
      originS: middle.car.s,
      spanMetres: race.trk.step,
      lowerFamilyKey: 'test:lower',
      upperFamilyKey: 'test:upper'
    };
    race.sideAgreements = new Map([
      ['LOWER:MIDDLE', {
        side: -1,
        separatorEta: -0.5,
        centreClearance: PHYS.carWid,
        familyCertificate: certificate,
        since: race.t
      }],
      ['MIDDLE:UPPER', {
        side: -1,
        separatorEta: 0.5,
        centreClearance: PHYS.carWid,
        familyCertificate: certificate,
        since: race.t
      }]
    ]);
    const edits = middle.laneEdits;
    const target = middle._laneTargetAbsolute;

    expect(setTargetAbsLat(
      race,
      middle,
      race.trk.idealPath.off[middle.car.progIdx]!,
      'contact-recovery'
    )).toBe(false);
    expect(middle.laneEdits).toBe(edits);
    expect(middle._laneTargetAbsolute).toBe(target);
  });

  test('gates the small dirty-air grip loss on actual cornering load', () => {
    const race = session();
    const value = entry('WAKE');
    value.dirtyT = 1;
    const curvature = race.trk.idealPath.k;
    let straight = 0;
    let corner = 0;
    for (let index = 1; index < race.trk.n; index++) {
      if (Math.abs(curvature[index]!) < Math.abs(curvature[straight]!)) straight = index;
      if (Math.abs(curvature[index]!) > Math.abs(curvature[corner]!)) corner = index;
    }

    placeAtIndex(race, value, straight, 30);
    const base = entryMu(value, race.wet);
    const straightGrip = entryDynamicMu(value, race);
    placeAtIndex(race, value, corner, 30);
    const cornerGrip = entryDynamicMu(value, race);

    expect(cornerGrip).toBeLessThan(base);
    expect(base - straightGrip).toBeLessThan(base - cornerGrip);
  });

  test('precomputes pass scores and picks only from the next two corners', () => {
    const race = session();
    expect(race.trk.corners.every(corner =>
      Number.isFinite(corner.passScore) && corner.passScore >= 0
    )).toBe(true);
    const index = race.trk.corners[0]!.approachI;
    const first = nextCorner(race.trk, index)!;
    const second = nextCorner(race.trk, (first.exitI + 1) % race.trk.n)!;
    const selected = bestPassingCorner(race.trk, index)!;
    const expected = second.id !== first.id && second.passScore > first.passScore
      ? second
      : first;
    expect(selected.id).toBe(expected.id);
  });

  test('samples evaluator candidates compactly and materializes the pit authority alone', () => {
    const modes: Exclude<PathMode, 'ideal'>[] = [
      'side-inside', 'side-outside', 'obstacle-avoid', 'tuck', 'pit'
    ];
    for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex++) {
      const race = session(trackIndex);
      const track = race.trk;
      const start = 100;
      for (const mode of modes) {
        const plan: PathPlan = mode === 'pit'
          ? {
              mode,
              key: `test:${track.def.id}:${mode}`,
              anchors: [
                { index: start, offset: track.idealPath.off[start]! },
                { index: ahead(race, start, 25), offset: track.pit.laneOff },
                { index: ahead(race, start, 60), offset: track.pit.boxOff }
              ]
            }
          : {
              mode,
              key: `test:${track.def.id}:${mode}`,
              anchors: [
                { index: start, offset: track.idealPath.off[start]! },
                { index: ahead(race, start, 25), offset: 2.1 },
                { index: ahead(race, start, 60), offset: -1.4 }
              ]
            };
        const stations = [
          start,
          ahead(race, start, 12),
          ahead(race, start, 25),
          ahead(race, start, 42),
          ahead(race, start, 60),
          ahead(race, start, 90)
        ];
        const compact = sampleCompactPathPlan(track, plan, stations);
        for (const lateral of compact) expect(Number.isFinite(lateral)).toBe(true);
        if (plan.mode === 'pit') {
          const path = materializePitPathPlan(track, plan);
          expect(path.mode).toBe('pit');
          for (let station = 0; station < stations.length; station++)
            expect(compact[station]).toBeCloseTo(path.off[stations[station]!]!, 10);
          for (let index = 0; index < track.n; index++) {
            expect(Number.isFinite(path.off[index])).toBe(true);
            expect(Number.isFinite(path.k[index])).toBe(true);
            expect(Number.isFinite(path.ds[index])).toBe(true);
            expect(Number.isFinite(path.v[index])).toBe(true);
            expect(path.ds[index]!).toBeGreaterThan(0);
            expect(path.v[index]!).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  }, 20_000);

  test('samples multi-anchor tactical geometry as one C2 eta curve', () => {
    const race = session();
    const track = race.trk;
    const start = 320;
    const origin = 4 * track.len + start * track.step;
    const distances = [0, 30, 70, 110];
    const etas = [0.2, 0.8, 1.9, 0];
    const indices = distances.map(distance => ahead(race, start, distance));
    const firstSlope = 0.025;
    const firstCurvature = -0.0007;
    const plan: PathPlan = {
      mode: 'side-outside',
      key: 'test:c2-tactical-eta',
      anchors: indices.map((index, anchorIndex) => ({
        index,
        offset: track.idealPath.off[index]! + etas[anchorIndex]!,
        eta: etas[anchorIndex]!,
        s: origin + distances[anchorIndex]!,
        ...(anchorIndex === 0
          ? {
              etaFirstDerivative: firstSlope,
              etaSecondDerivative: firstCurvature
            }
          : {})
      })),
      pinnedFirst: true,
      topology: 'right',
      terminal: 'ideal-rejoin',
      surfaceAuthorization: 'normal'
    };
    const idealSecondKnot = sampleCompactPathPlanOffsetAnalytic(
      track,
      { mode: 'ideal', key: 'ideal' },
      indices[2]!,
      origin + distances[2]!
    );
    const slopes = [
      firstSlope,
      (etas[2]! - etas[0]!) / (distances[2]! - distances[0]!),
      -idealSecondKnot.firstDerivative,
      0
    ];
    const curvatures = [
      firstCurvature,
      (slopes[2]! - slopes[0]!) /
        (distances[2]! - distances[0]!),
      -idealSecondKnot.secondDerivative,
      0
    ];

    const atStart = sampleCompactPathPlanOffsetAnalytic(
      track,
      plan,
      indices[0]!,
      origin
    );
    const idealStart = sampleCompactPathPlanOffsetAnalytic(
      track,
      { mode: 'ideal', key: 'ideal' },
      indices[0]!,
      origin
    );
    expect(atStart.firstDerivative - idealStart.firstDerivative)
      .toBeCloseTo(firstSlope, 12);
    expect(atStart.secondDerivative - idealStart.secondDerivative)
      .toBeCloseTo(firstCurvature, 12);

    const knotProgress = origin + distances[1]!;
    const epsilon = 1e-5;
    const before = sampleCompactPathPlanOffsetAnalytic(
      track,
      plan,
      indices[1]!,
      knotProgress - epsilon
    );
    const after = sampleCompactPathPlanOffsetAnalytic(
      track,
      plan,
      indices[1]!,
      knotProgress + epsilon
    );
    const idealKnot = sampleCompactPathPlanOffsetAnalytic(
      track,
      { mode: 'ideal', key: 'ideal' },
      indices[1]!,
      knotProgress
    );
    expect(before.value).toBeCloseTo(after.value, 6);
    expect(before.firstDerivative).toBeCloseTo(after.firstDerivative, 6);
    expect(before.secondDerivative).toBeCloseTo(after.secondDerivative, 6);
    expect(before.firstDerivative - idealKnot.firstDerivative)
      .toBeCloseTo(slopes[1]!, 6);
    expect(Math.abs(slopes[1]!)).toBeGreaterThan(1e-3);

    const midpointDistance = 50;
    const midpointIndex = ahead(race, start, midpointDistance);
    const midpointProgress = origin + midpointDistance;
    const midpoint = sampleCompactPathPlanOffsetAnalytic(
      track,
      plan,
      midpointIndex,
      midpointProgress
    );
    const idealMidpoint = sampleCompactPathPlanOffsetAnalytic(
      track,
      { mode: 'ideal', key: 'ideal' },
      midpointIndex,
      midpointProgress
    );
    const expectedEta = sampleQuinticHermiteSegment(
      {
        value: etas[1]!,
        firstDerivative: slopes[1]!,
        secondDerivative: curvatures[1]!
      },
      {
        value: etas[2]!,
        firstDerivative: slopes[2]!,
        secondDerivative: curvatures[2]!
      },
      distances[2]! - distances[1]!,
      (midpointDistance - distances[1]!) /
        (distances[2]! - distances[1]!)
    );
    expect(midpoint.value - idealMidpoint.value)
      .toBeCloseTo(expectedEta.value, 12);
    expect(midpoint.firstDerivative - idealMidpoint.firstDerivative)
      .toBeCloseTo(expectedEta.firstDerivative, 12);
    expect(midpoint.secondDerivative - idealMidpoint.secondDerivative)
      .toBeCloseTo(expectedEta.secondDerivative, 12);
  });

  test('feeds compact tactical authority directly to the production controller', () => {
    const race = session();
    const value = entry('SCALAR');
    placeAtIndex(race, value, 240, 24);
    value.pathMode = 'ideal';
    const staleLane = evaluateLaneProgram(race, value);
    for (let slot = 0; slot < staleLane.count; slot++)
      staleLane.off[slot] = -2.2;
    const targetIndex = (value.car.progIdx + 40) % race.trk.n;
    const plan = {
      mode: 'side-outside',
      key: 'test:direct-controller',
      anchors: [
        {
          index: value.car.progIdx,
          offset: value.latNow,
          s: value.prog
        },
        {
          index: targetIndex,
          offset: 2.2,
          s: value.prog + 40 * race.trk.step
        }
      ],
      pinnedFirst: true,
      topology: 'right',
      terminal: 'ideal-rejoin',
      surfaceAuthorization: 'normal'
    } satisfies Exclude<
      PathPlan,
      { mode: 'ideal' } | { mode: 'pit' }
    >;
    installRacecraftPathPlan(
      race.trk,
      value,
      `space:${plan.key}`,
      plan,
      'racecraft:self'
    );
    value.botTick = 0;
    race.entries = [value];
    const expected = botStep(race.trk, race.prof, value.car, {
      lateralProgram: value.racecraftLateralProgram!,
      pathProgress: value.prog
    });
    const erased = botStep(race.trk, race.prof, value.car, {
      path: race.trk.idealPath,
      lat: 0
    });

    stepEntry(value, race, 1 / 120, () => {});

    expect(value.inp.steer).toBeCloseTo(expected.steer, 12);
    expect(Math.abs(value.inp.steer - erased.steer)).toBeGreaterThan(0.01);
    expect(value.laneBuffer).toBe(staleLane);
  });

  test('pit sync is the only sampled-path installer', () => {
    const race = session();
    const raceCar = entry('RACE');
    placeAtIndex(race, raceCar, 120, 24);
    editLaneTarget(race, raceCar, 2.2, 'evaluator-owned-lane');
    const laneReason = raceCar.laneProgram.reason;

    const pitCar = entry('PIT', 2);
    const pitW = 20;
    const pitIndex = Math.round(
      ((race.trk.pit.sEntry + pitW) % race.trk.len) / race.trk.step
    ) % race.trk.n;
    placeAtIndex(race, pitCar, pitIndex, 14);
    pitCar.state = 'pitIn';
    pitCar.pitW = pitW;
    pitCar.pitPhase = 'travel';
    pitCar.latNow = race.trk.pit.off(pitW);
    pitCar.lat = pitCar.latNow;

    syncPitPaths(race, [raceCar, pitCar]);

    expect(raceCar.pathPlan).toBeUndefined();
    expect(raceCar.path).toBeUndefined();
    expect(raceCar.laneProgram.reason).toBe(laneReason);
    expect(pitCar.pathPlan?.mode).toBe('pit');
    expect(pitCar.pathMode).toBe('pit');
    expect(pitCar.path).toBeDefined();
    expect(pitCar.pathMaxSlew).toBeLessThanOrEqual(0.5);
  });

  test('rejects an out-of-road candidate', () => {
    const race = session();
    const ego = entry('EGO');
    const start = 1269;
    placeAtIndex(race, ego, start, 30);
    const plan: PathPlan = {
      mode: 'tuck',
      key: 'test:occupied-crossing',
      anchors: [
        { index: start, offset: race.trk.idealPath.off[start]! },
        { index: ahead(race, start, 45), offset: 3 }
      ]
    };
    const outside = evaluateManeuverPlanCompact(
      race,
      ego,
      plan,
      () => race.trk.hw + PHYS.carWid,
      null
    );
    expect(outside.feasible).toBe(false);
    expect(outside.rejections).toContain('road-bound');
  });

  test('keeps immutable publications unchanged throughout evaluation', () => {
    const race = session();
    const left = entry('LEFT');
    const right = entry('RIGHT');
    const start = 1269;
    placeAtIndex(race, left, start, 30);
    placeAtIndex(race, right, start, 30);
    setLateral(race, left, -3.8);
    clearLaneProgram(left, 'left-claim');
    editLaneTarget(race, left, -3.8, 'left-claim');
    setLateral(race, right, 3.8);
    clearLaneProgram(right, 'right-claim');
    editLaneTarget(race, right, 3.8, 'right-claim');
    race.entries = [left, right];
    evaluateLaneProgram(race, left);
    evaluateLaneProgram(race, right);
    publishAllClaims(race);
    const publications = race.racecraftClaims!;
    const leftPublication = publications.get(left.code)!;
    const leftTrajectory = leftPublication.trajectory;
    const leftCentres = Array.from(
      { length: racecraftClaimSegmentCount(leftPublication) },
      (_, index) => racecraftClaimStateAtTime(
        race.trk,
        leftPublication,
        racecraftClaimSegmentEndTime(leftPublication, index)
      ).lateral
    );

    const end = ahead(race, start, 90);
    const leftPlan: PathPlan = {
      mode: 'tuck',
      key: 'test:left-reservation',
      anchors: [
        { index: start, offset: -3.8 },
        { index: end, offset: -1 }
      ],
      topology: 'left'
    };
    const leftSample = (index: number): number =>
      sampleCompactPathPlan(race.trk, leftPlan, [index])[0]!;
    const first = evaluateManeuverPlanCompact(
      race,
      left,
      leftPlan,
      leftSample,
      null
    );
    expect(first.rejections).toEqual([]);
    expect(first.feasible).toBe(true);

    const rightPlan: PathPlan = {
      mode: 'tuck',
      key: 'test:right-double-book',
      anchors: [
        { index: start, offset: 3.8 },
        { index: end, offset: -1 }
      ],
      topology: 'right'
    };
    const second = evaluateManeuverPlanCompact(
      race,
      right,
      rightPlan,
      index => sampleCompactPathPlan(race.trk, rightPlan, [index])[0]!,
      null
    );
    expect(second.feasible).toBe(true);
    expect(race.racecraftClaims).toBe(publications);
    const standingLeftPublication = publications.get(left.code)!;
    expect(standingLeftPublication.trajectory).toBe(leftTrajectory);
    expect(Array.from(
      { length: racecraftClaimSegmentCount(standingLeftPublication) },
      (_, index) => racecraftClaimStateAtTime(
        race.trk,
        standingLeftPublication,
        racecraftClaimSegmentEndTime(standingLeftPublication, index)
      ).lateral
    )).toEqual(leftCentres);

    editLaneTarget(race, left, -1, 'new-selected-program');
    evaluateLaneProgram(race, left);
    race.t += 1 / 30;
    publishAllClaims(race);
    expect(race.racecraftClaims).not.toBe(publications);
    const immutableLeftPublication = publications.get(left.code)!;
    expect(immutableLeftPublication.trajectory).toBe(leftTrajectory);
    expect(Array.from(
      { length: racecraftClaimSegmentCount(immutableLeftPublication) },
      (_, index) => racecraftClaimStateAtTime(
        race.trk,
        immutableLeftPublication,
        racecraftClaimSegmentEndTime(immutableLeftPublication, index)
      ).lateral
    )).toEqual(leftCentres);
  });

  test('leaves compact geometry raw and rejects it at the surface veto', () => {
    const race = session();
    const start = race.trk.n - 80;
    const roadLimit = race.trk.hw - (PHYS.carWid / 2 + 0.6);
    const plan: PathPlan = {
      mode: 'tuck',
      key: 'test:bounded-closure',
      anchors: [
        { index: start, offset: roadLimit + 4 },
        { index: ahead(race, start, 35), offset: -roadLimit - 4 }
      ]
    };
    let outside = false;
    for (let index = 0; index < race.trk.n; index++)
      if (!normalLateralIsLegal(
        race.trk,
        index,
        sampleCompactPathPlan(race.trk, plan, [index])[0]!
      )) outside = true;
    expect(outside).toBe(true);
    const car = entry('BOUNDS');
    placeAtIndex(race, car, start);
    const diagnostic = evaluateManeuverPlanCompact(
      race,
      car,
      plan,
      index => sampleCompactPathPlan(race.trk, plan, [index])[0]!,
      null
    );
    expect(diagnostic.rejections).toContain('road-bound');
    expect(diagnostic.feasible).toBe(false);
  });

});
