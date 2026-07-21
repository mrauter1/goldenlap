import { beforeAll, describe, expect, test } from 'bun:test';

import type { BuiltTrack, Car } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import { prepareHeadlessTrack } from '../../../src/game/headless-sim';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  RacecraftClaim,
  RacecraftDecision,
  Session
} from '../../../src/session/model';
import { RacecraftPendingDecisionReason } from
  '../../../src/session/model';
import { racecraftTrajectoryProgramFromRows } from
  '../../../src/session/racecraft/claim';
import {
  applyRacecraftPredictiveSafetyVeto,
  RACECRAFT_PREDICTIVE_SAFETY_PREDICATES,
  resolvePredictiveSafetyIntervalTicks,
  runRacecraftPredictiveSafetyPass
} from '../../../src/session/racecraft/reactive-safety';

type ActiveEntry = Entry & { car: Car };

const TEAM = {
  id: 'reactive-safety',
  name: 'Reactive safety',
  body: '#000',
  accent: '#fff'
} as const;

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function activeEntry(
  code: string,
  s: number,
  speed: number
): ActiveEntry {
  const index = Math.round(s / built.tr.step) % built.tr.n;
  const lateral = built.tr.idealPath.off[index]!;
  const lineup: LineupEntry = {
    team: TEAM,
    name: code,
    code,
    isPlayer: false,
    ci: 0,
    margin: 0,
    focus: 0.8,
    trait: ''
  };
  const value = createEntry({
    lineup,
    teamIndex: 0,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  value.car = makeCar(
    built.tr.x[index]! + built.tr.nx[index]! * lateral,
    built.tr.y[index]! + built.tr.ny[index]! * lateral,
    Math.atan2(built.tr.ty[index]!, built.tr.tx[index]!)
  );
  value.car.s = s;
  value.car.progIdx = index;
  value.car.spd = speed;
  value.car.vx = speed;
  value.spd = speed;
  value.state = 'run';
  value.latNow = lateral;
  value.prog = built.tr.len + s;
  return value as ActiveEntry;
}

function session(
  entries: ActiveEntry[],
  intervalTicks: 1 | 3
): Session {
  return {
    trk: built.tr,
    prof: built.prof,
    entries,
    mode: 'race',
    t: 20,
    goT: 0,
    wet: 0,
    config: {
      predictiveSafetyHz: intervalTicks === 1 ? 30 : 10
    },
    events: [],
    racecraftPredictiveSafetyIntervalTicks: intervalTicks
  } as unknown as Session;
}

function publication(
  entry: ActiveEntry,
  originS: number,
  speed: number,
  revision: number
): RacecraftClaim {
  const horizon = 0.1;
  return Object.freeze({
    code: entry.code,
    predictionKey: `${entry.code}:${revision}`,
    lateralAuthorityRevision: revision,
    longitudinalAuthorityRevision: revision,
    publicationRevision: revision,
    publishedAt: 20,
    originS,
    originCentre: entry.latNow,
    originSpeed: speed,
    originHeadingOffsetRadians: 0,
    trusted: true,
    mode: 'direct-ideal',
    targetCode: null,
    cornerId: null,
    selectedPlanNumericId: null,
    selectedFamilyNumericId: null,
    selectedLongitudinalProgram: null,
    ownershipAssertion: null,
    defensiveCommitment: null,
    trajectoryTimeOffsetSeconds: 0,
    trajectory: racecraftTrajectoryProgramFromRows(
      built.tr,
      {
        timeSeconds: 0,
        sMetres: originS,
        speedMetresPerSecond: speed,
        lateralMetres: entry.latNow,
        headingOffsetRadians: 0
      },
      [{
        timeSeconds: horizon,
        sMetres: (originS + speed * horizon) % built.tr.len,
        speedMetresPerSecond: speed,
        lateralMetres: entry.latNow,
        headingOffsetRadians: 0
      }],
      entry.prog
    )
  });
}

describe('shared predictive reactive safety', () => {
  test('resolves the session-fixed 10/30 Hz setting to traffic ticks', () => {
    expect(resolvePredictiveSafetyIntervalTicks(10)).toBe(3);
    expect(resolvePredictiveSafetyIntervalTicks(30)).toBe(1);
  });

  test('runs the identical frozen predicate inventory at either cadence', () => {
    const tenEntries = [
      activeEntry('TEN-A', 100, 30),
      activeEntry('TEN-B', 140, 30)
    ];
    const ten = session(tenEntries, 3);
    expect(runRacecraftPredictiveSafetyPass(ten, tenEntries, 0)).toBe(true);
    const retained = tenEntries[0]!.racecraftPredictiveSafety!;
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.predicateInventory)).toBe(true);
    expect(retained.predicateInventory)
      .toBe(RACECRAFT_PREDICTIVE_SAFETY_PREDICATES);
    expect(runRacecraftPredictiveSafetyPass(ten, tenEntries, 1)).toBe(false);
    expect(runRacecraftPredictiveSafetyPass(ten, tenEntries, 2)).toBe(false);
    expect(tenEntries[0]!.racecraftPredictiveSafety).toBe(retained);
    expect(runRacecraftPredictiveSafetyPass(ten, tenEntries, 3)).toBe(true);
    expect(tenEntries[0]!.racecraftPredictiveSafety).not.toBe(retained);

    const thirtyEntries = [
      activeEntry('THIRTY-A', 100, 30),
      activeEntry('THIRTY-B', 140, 30)
    ];
    const thirty = session(thirtyEntries, 1);
    for (let epoch = 0; epoch <= 3; epoch++)
      expect(runRacecraftPredictiveSafetyPass(
        thirty,
        thirtyEntries,
        epoch
      )).toBe(true);

    expect(Object.keys(ten.racecraftSafetyPredicateRuns!).sort())
      .toEqual([...RACECRAFT_PREDICTIVE_SAFETY_PREDICATES].sort());
    expect(Object.keys(thirty.racecraftSafetyPredicateRuns!).sort())
      .toEqual([...RACECRAFT_PREDICTIVE_SAFETY_PREDICATES].sort());
    for (const predicate of RACECRAFT_PREDICTIVE_SAFETY_PREDICATES) {
      expect(ten.racecraftSafetyPredicateRuns![predicate]).toBe(4);
      expect(thirty.racecraftSafetyPredicateRuns![predicate]).toBe(8);
    }
  });

  test('vetoes measured hard closing without changing tactical authority', () => {
    const follower = activeEntry('FOLLOWER', 100, 50);
    const leader = activeEntry('LEADER', 106, 10);
    const race = session([follower, leader], 3);
    const decision = Object.freeze({ at: 19 }) as RacecraftDecision;
    follower.racecraftDecision = decision;
    const followerPublication = publication(follower, 100, 50, 7);
    const leaderPublication = publication(leader, 106, 10, 11);
    const publications = new Map([
      [follower.code, followerPublication],
      [leader.code, leaderPublication]
    ]);
    race.racecraftClaims = publications;
    follower.inp.throttle = 1;
    follower.inp.brake = 0;

    expect(runRacecraftPredictiveSafetyPass(
      race,
      [follower, leader],
      0
    )).toBe(true);
    expect(follower.racecraftPredictiveSafety?.hardClosingVeto).toBe(true);
    expect(follower.racecraftPredictiveSafety?.predicate)
      .toBe('measured-hard-closing');
    expect(
      (follower.racecraftPendingDecisionReasons ?? 0) &
        RacecraftPendingDecisionReason.PredictiveSafety
    ).not.toBe(0);
    expect(follower.racecraftDecision).toBe(decision);
    expect(race.racecraftClaims).toBe(publications);
    expect(race.racecraftClaims.get(follower.code))
      .toBe(followerPublication);
    expect(race.racecraftClaims.get(leader.code))
      .toBe(leaderPublication);

    applyRacecraftPredictiveSafetyVeto(follower);
    expect(follower.inp.throttle).toBe(0);
    expect(follower.inp.brake).toBe(1);
    expect(follower.racecraftDecision).toBe(decision);
    expect(race.racecraftClaims).toBe(publications);
  });

  test('can veto from aged immutable publications without measured closing', () => {
    const follower = activeEntry('PUBLISHED-FOLLOWER', 100, 20);
    const leader = activeEntry('PUBLISHED-LEADER', 140, 20);
    const race = session([follower, leader], 1);
    const followerPublication = publication(follower, 100, 50, 3);
    const leaderPublication = publication(leader, 106, 10, 5);
    const publications = new Map([
      [follower.code, followerPublication],
      [leader.code, leaderPublication]
    ]);
    race.racecraftClaims = publications;

    runRacecraftPredictiveSafetyPass(race, [follower, leader], 0);

    expect(follower.racecraftPredictiveSafety?.hardClosingVeto).toBe(true);
    expect(follower.racecraftPredictiveSafety?.predicate)
      .toBe('published-hard-closing');
    expect(follower.racecraftPredictiveSafety?.hazardPublicationRevision)
      .toBe(5);
    expect(race.racecraftClaims).toBe(publications);
    expect(race.racecraftClaims.get(follower.code))
      .toBe(followerPublication);
    expect(race.racecraftClaims.get(leader.code))
      .toBe(leaderPublication);
  });

  test('counts safety intervention before a closure publication is consumed', () => {
    const attacker = activeEntry('ATTACKER', 100, 50);
    const defender = activeEntry('DEFENDER', 106, 10);
    const race = session([attacker, defender], 1);
    const attackerPublication: RacecraftClaim = {
      ...publication(attacker, 100, 50, 8),
      mode: 'staged-attack' as const,
      targetCode: defender.code,
      cornerId: 'prado-c08',
      selectedPlanNumericId: 3,
      selectedFamilyNumericId: 4
    };
    const defenderBase = publication(defender, 106, 10, 11);
    const commitment = Object.freeze({
      cornerId: 'prado-c08',
      cornerExitProgressMetres: defender.prog + 100,
      targetCodeAtCommitment: attacker.code,
      coveredSide: 1 as const,
      sourceAttackerPublicationRevision:
        attackerPublication.publicationRevision,
      authorizedDefenderPublicationRevision:
        defenderBase.publicationRevision,
      authorizedAtSessionTimeSeconds: race.t,
      authorizedTrajectory: defenderBase.trajectory,
      encroachmentStartSessionTimeSeconds: race.t + 0.1,
      noticeDeadlineSessionTimeSeconds: race.t + 1.1,
      authoredFirstConflictSessionTimeSeconds: race.t + 1.2,
      authoredFirstAlongsideSessionTimeSeconds: null,
      authoredOutcome: 'side-closure-authorized' as const
    });
    const defenderPublication: RacecraftClaim = {
      ...defenderBase,
      mode: 'defense' as const,
      targetCode: attacker.code,
      cornerId: commitment.cornerId,
      defensiveCommitment: commitment
    };
    race.racecraftClaims = new Map<string, RacecraftClaim>([
      [attacker.code, attackerPublication],
      [defender.code, defenderPublication]
    ]);

    runRacecraftPredictiveSafetyPass(
      race,
      [attacker, defender],
      0
    );
    expect(
      race.racecraftDefensivePreConsumptionSafetyInterventions
    ).toBe(1);
    expect(defenderPublication.defensiveCommitment)
      .toBe(commitment);

    delete attacker.racecraftPredictiveSafety;
    race.racecraftClaims = new Map<string, RacecraftClaim>([
      [
        attacker.code,
        {
          ...attackerPublication,
          publicationRevision: 9
        }
      ],
      [defender.code, defenderPublication]
    ]);
    runRacecraftPredictiveSafetyPass(
      race,
      [attacker, defender],
      1
    );
    expect(
      race.racecraftDefensivePreConsumptionSafetyInterventions
    ).toBe(1);
  });
});
