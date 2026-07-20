import { describe, expect, test } from 'bun:test';

import { createEntry } from '../../../src/session/entry';
import type { Track } from '../../../src/core/model';
import { PHYS, wakeEffect } from '../../../src/core/physics';
import type { Entry, LineupEntry, Session } from '../../../src/session/model';
import {
  initializeLineCharacter,
  recordTrafficFeel
} from '../../../src/session/racecraft/feel';
import {
  withRacecraftCalibration
} from '../../../src/session/racecraft/config';
import {
  claimDefenseResponse,
  physicalLateralMoveSeconds
} from '../../../src/session/racecraft/traffic';
import {
  utilizationMistakeProbability
} from '../../../src/session/racecraft/utilization';
import { racecraftOneMoveLegal } from '../../../src/session/racecraft/evaluator';
import { entryMods } from '../../../src/session/strategy';

const TEAM = { id: 'traffic-test', name: 'Traffic Test', body: '#000', accent: '#fff' } as const;

function entry(code: string): Entry {
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
  return createEntry({
    lineup,
    teamIndex: 0,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
}

describe('traffic episode state', () => {
  test('allows one defense per concurrently active attacker', () => {
    const defender = entry('DEF');
    const first = entry('A');
    const second = entry('B');

    expect(claimDefenseResponse(defender, first)).toBe(true);
    expect(claimDefenseResponse(defender, second)).toBe(true);
    expect(claimDefenseResponse(defender, first)).toBe(false);

    delete defender._defSeenAttackers?.[first.code];
    expect(claimDefenseResponse(defender, first)).toBe(true);
    expect(claimDefenseResponse(defender, first)).toBe(false);
  });

  test('enforces the recorded one-move rule in candidate legality', () => {
    const defender = entry('DEF');
    const attacker = entry('ATK');
    defender.state = 'run';
    attacker.state = 'run';
    defender.car = { s: 100 } as Entry['car'];
    attacker.car = { s: 95 } as Entry['car'];
    defender.latNow = 0;
    attacker.latNow = -2;
    defender._racecraftAppliedKind = 'corner-inside';
    defender._defSeenAttackers = { ATK: true };
    attacker.racecraftDecision = {
      selectedPlanNumericId: 1,
      selectedPlanKey: 'attack',
      candidates: [{
        planNumericId: 1,
        plan: {
          mode: 'side-inside',
          key: 'attack',
          anchors: [],
          leaderCode: 'DEF',
          surfaceAuthorization: 'normal'
        }
      }]
    } as unknown as NonNullable<Entry['racecraftDecision']>;
    const session = {
      trk: { len: 1000 }
    } as Session;

    expect(racecraftOneMoveLegal(
      session, defender, [defender, attacker], 'corner-inside', -1
    )).toBe(true);
    expect(racecraftOneMoveLegal(
      session, defender, [defender, attacker], 'corner-outside', -1
    )).toBe(false);
    expect(racecraftOneMoveLegal(
      session, defender, [defender, attacker], 'hold', -1
    )).toBe(true);
    expect(racecraftOneMoveLegal(
      session, defender, [defender, attacker], 'corner-outside', 1
    )).toBe(true);
  });

  test('derives bounded deterministic line and braking character', () => {
    const track = { corners: [{ id: 'corner-one' }, { id: 'corner-two' }] } as unknown as Track;
    const first = entry('CHAR');
    const same = entry('CHAR');
    initializeLineCharacter(first, track);
    initializeLineCharacter(same, track);

    expect(first.lineBiasByCorner).toEqual(same.lineBiasByCorner);
    expect(Object.values(first.lineBiasByCorner ?? {}).every(value => Math.abs(value) <= 0.35))
      .toBe(true);
    expect(first.brakingEffort).toBeGreaterThanOrEqual(0.76);
    expect(first.brakingEffort).toBeLessThanOrEqual(0.88);
    expect(Math.abs(first.brakingPrudenceOffset)).toBeLessThanOrEqual(0.06);
  });

  test('uses calibrated tow drag and no artificial lateral-acceleration floor', () => {
    const value = entry('AERO');
    value.tow = 0.8;
    const drag = withRacecraftCalibration({ towDragReduction: 0.2 }, () =>
      entryMods(value, 0).dr
    );
    expect(drag).toBeCloseTo(value.mods.dr * 0.84, 10);

    expect(physicalLateralMoveSeconds(40, 1, 0)).toBe(Infinity);
    expect(physicalLateralMoveSeconds(40, 1, 4))
      .toBeLessThan(physicalLateralMoveSeconds(40, 1, 2));

    const parameters = { characteristicDistance: 32, spreadRate: 0.04 };
    expect(wakeEffect(60, 0, 60, parameters).drag).toBeCloseTo(0.5, 10);
    expect(wakeEffect(10, 0, 60, parameters).grip).toBeLessThanOrEqual(0.8);
    expect(wakeEffect(30, 2.5, 60, parameters).drag).toBeGreaterThan(0);
    expect(wakeEffect(30, 3.2, 60, parameters).drag).toBe(0);
  });

  test('prices mistakes by elapsed utilization, focus, and wetness', () => {
    const dry = withRacecraftCalibration({ mistakeUtilizationRate: 0.01 }, () =>
      utilizationMistakeProbability(0.8, 0.6, 0, 1)
    );
    const wet = withRacecraftCalibration({ mistakeUtilizationRate: 0.01 }, () =>
      utilizationMistakeProbability(0.8, 0.6, 1, 1)
    );

    expect(utilizationMistakeProbability(0, 0, 1, 1)).toBe(0);
    expect(utilizationMistakeProbability(1, 1, 1, 1)).toBe(0);
    expect(dry).toBeGreaterThan(0);
    expect(wet).toBeGreaterThan(dry);
    expect(utilizationMistakeProbability(0.8, 0.6, 0, 0.5)).toBeLessThan(dry);
  });

  test('records bounded physical station-gap moments', () => {
    const follower = entry('FOLLOW');
    const leader = entry('LEAD');
    follower.car = { s: 100 } as Entry['car'];
    leader.car = { s: 106 } as Entry['car'];
    follower.prog = 100;
    leader.prog = 106;
    follower.trafficSlowPoint = {
      distance: 1,
      speed: 30,
      ownerCode: leader.code,
      reason: 'traffic-follow:test',
      stationS: 106,
      publishedAt: 20
    };
    const session = {
      t: 20,
      goT: 0,
      trk: { len: 1000 }
    } as unknown as Parameters<typeof recordTrafficFeel>[0];

    recordTrafficFeel(session, [follower, leader] as never);
    leader.car!.s = 107;
    leader.prog = 107;
    recordTrafficFeel(session, [follower, leader] as never);

    const firstGap = 6 - PHYS.carLen;
    const secondGap = 7 - PHYS.carLen;
    expect(session.stationGapDistribution).toEqual({
      samples: 2,
      sumMetres: firstGap + secondGap,
      squaredSumMetres: firstGap ** 2 + secondGap ** 2,
      minimumMetres: firstGap,
      maximumMetres: secondGap
    });
  });
});
