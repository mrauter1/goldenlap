import { beforeAll, describe, expect, test } from 'bun:test';

import type { BuiltTrack, Car } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import {
  speedEnvelopeAt,
  speedEnvelopeFromSamples
} from '../../../src/core/speed-envelope';
import { prepareHeadlessTrack } from '../../../src/game/headless-sim';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  RacecraftClaim,
  RacecraftLongitudinalProgram,
  Session
} from '../../../src/session/model';
import { racecraftTrajectoryProgramFromRows } from
  '../../../src/session/racecraft/claim';
import {
  composeRacecraftStagedAttackProgram,
  firstRacecraftCornerBrakingBinding,
  firstRacecraftLongitudinalBinding,
  racecraftLongitudinalSpeedAt,
  racecraftLongitudinalTravelSeconds
} from '../../../src/session/racecraft/longitudinal-program';

type ActiveEntry = Entry & { car: Car };

const TEAM = {
  id: 'longitudinal-program',
  name: 'Longitudinal program',
  body: '#111',
  accent: '#eee'
} as const;

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function activeEntry(code: string, s: number, lateral = 0): ActiveEntry {
  const index = Math.round(s / built.tr.step) % built.tr.n;
  const lineup: LineupEntry = {
    team: TEAM,
    name: code,
    code,
    isPlayer: false,
    ci: 0,
    margin: 0,
    focus: 1,
    trait: ''
  };
  const entry = createEntry({
    lineup,
    teamIndex: 0,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  entry.car = makeCar(
    built.tr.x[index]! + built.tr.nx[index]! * lateral,
    built.tr.y[index]! + built.tr.ny[index]! * lateral,
    Math.atan2(built.tr.ty[index]!, built.tr.tx[index]!)
  );
  entry.car.s = s;
  entry.car.progIdx = index;
  entry.car.spd = 40;
  entry.car.vx = 40;
  entry.spd = 40;
  entry.state = 'run';
  entry.prog = built.tr.len + s;
  entry.latNow = lateral;
  entry.brakingEffort = 0.82;
  return entry as ActiveEntry;
}

function session(entries: ActiveEntry[]): Session {
  return {
    trk: built.tr,
    prof: built.prof,
    entries,
    mode: 'race',
    t: 20,
    goT: 0,
    wet: 0,
    config: { tuneBonus: 0 } as Session['config'],
    events: []
  } as unknown as Session;
}

function publication(leader: ActiveEntry): RacecraftClaim {
  const rows = [1, 2, 3].map(index => {
    const time = index * 0.2;
    return {
      timeSeconds: time,
      sMetres: leader.car.s + leader.spd * time,
      lateralMetres: leader.latNow,
      speedMetresPerSecond: 25,
      headingOffsetRadians: 0
    };
  });
  return {
    code: leader.code,
    predictionKey: leader.code,
    lateralAuthorityRevision: 1,
    longitudinalAuthorityRevision: 1,
    publicationRevision: 1,
    publishedAt: 20,
    originS: leader.car.s,
    originCentre: leader.latNow,
    originSpeed: 25,
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
        sMetres: leader.car.s,
        lateralMetres: leader.latNow,
        speedMetresPerSecond: 25,
        headingOffsetRadians: 0
      },
      rows,
      leader.prog
    )
  };
}

function freeProgram(entry: ActiveEntry): RacecraftLongitudinalProgram {
  return {
    envelope: speedEnvelopeFromSamples(
      [0, 10, 20, 30, 40].map(value => entry.prog + value),
      [40, 40, 40, 40, 40]
    ),
    brakingEffort: 0.96,
    slowPointOwnerCode: null,
    bindingSlowPoint: null
  };
}

describe('directional longitudinal programs', () => {
  test('interpolates speed and integrates continuous travel time', () => {
    const program: RacecraftLongitudinalProgram = {
      envelope: speedEnvelopeFromSamples(
        [0, 10, 20],
        [10, 20, 20]
      ),
      brakingEffort: 1,
      slowPointOwnerCode: null,
      bindingSlowPoint: null
    };
    expect(racecraftLongitudinalSpeedAt(program, 5))
      .toBeCloseTo(Math.sqrt(250), 12);
    expect(racecraftLongitudinalTravelSeconds(program, 0, 20))
      .toBeCloseTo(2 * 10 / 30 + 2 * 10 / 40, 12);
  });

  test('finds the installed corner-braking onset continuously', () => {
    const program: RacecraftLongitudinalProgram = {
      envelope: speedEnvelopeFromSamples(
        [0, 10, 20, 30],
        [30, 30, 20, 20]
      ),
      brakingEffort: 1,
      slowPointOwnerCode: null,
      bindingSlowPoint: null
    };
    const binding = firstRacecraftCornerBrakingBinding(
      program,
      10,
      30
    );
    expect(binding?.progressMetres).toBe(10);
    expect(binding?.seconds).toBeCloseTo(1 / 3, 12);
    expect(firstRacecraftCornerBrakingBinding(
      {
        ...program,
        envelope: speedEnvelopeFromSamples(
          [0, 10, 20, 30],
          [30, 30, 30, 30]
        )
      },
      10,
      30
    )).toBeNull();
  });

  test('follows while acquiring and releases only after side clearance', () => {
    const follower = activeEntry('FOLLOWER', 100);
    const leader = activeEntry('LEADER', 112);
    leader.spd = leader.car.spd = leader.car.vx = 25;
    const value = session([follower, leader]);
    const free = freeProgram(follower);
    const staged = composeRacecraftStagedAttackProgram(
      value,
      follower,
      leader,
      publication(leader),
      1,
      free,
      progress => ({
        lateralMetres: Math.min(
          3,
          3 * (progress - follower.prog) / 30
        ),
        headingOffsetRadians: 0
      })
    );

    expect(staged.clearanceProgressMetres).not.toBeNull();
    expect(staged.clearanceSeconds).toBeGreaterThan(0);
    expect(firstRacecraftLongitudinalBinding(
      free,
      staged.program
    )).not.toBeNull();
    expect(racecraftLongitudinalSpeedAt(
      staged.program,
      staged.clearanceProgressMetres! - 1
    )).toBeLessThan(40);
    const releaseSpeed = racecraftLongitudinalSpeedAt(
      staged.program,
      staged.clearanceProgressMetres!
    );
    expect(racecraftLongitudinalSpeedAt(
      staged.program,
      staged.clearanceProgressMetres! + 1
    )).toBeGreaterThan(releaseSpeed);
    expect(racecraftLongitudinalSpeedAt(
      staged.program,
      staged.program.envelope.endProgress
    )).toBe(40);
  });

  test('retains the leader-safe law when clearance is never reached', () => {
    const follower = activeEntry('BOUND', 100);
    const leader = activeEntry('BLOCKER', 112);
    leader.spd = leader.car.spd = leader.car.vx = 25;
    const value = session([follower, leader]);
    const staged = composeRacecraftStagedAttackProgram(
      value,
      follower,
      leader,
      publication(leader),
      -1,
      freeProgram(follower),
      () => ({
        lateralMetres: 0,
        headingOffsetRadians: 0
      })
    );

    expect(staged.clearanceProgressMetres).toBeNull();
    expect(staged.program.slowPointOwnerCode).toBe(leader.code);
    expect(speedEnvelopeAt(
      staged.program.envelope,
      staged.program.envelope.startProgress
    )).toBeLessThan(40);
  });
});
