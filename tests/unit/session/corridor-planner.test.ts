import { beforeAll, describe, expect, test } from 'bun:test';

import type { BuiltTrack } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import { PIT_TEAMS, TRACK_DEFS } from '../../../src/data/tracks';
import { buildTrackDefinition } from '../../../src/game/tracks';
import type {
  Entry,
  LineupEntry,
  Session
} from '../../../src/session/model';
import { updateRacecraftSideAgreements } from
  '../../../src/session/racecraft/corridor-planner';
import { PHYS } from '../../../src/core/physics';

const TEAM = {
  id: 'agreement-test',
  name: 'Agreement Test',
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

function activeEntry(
  code: string,
  index: number,
  lateralResidual: number
): Entry & { car: NonNullable<Entry['car']> } {
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
  const resolved = ((index % track.n) + track.n) % track.n;
  const lateral = track.idealPath.off[resolved]! + lateralResidual;
  const heading = Math.atan2(track.ty[resolved]!, track.tx[resolved]!);
  const car = makeCar(
    track.x[resolved]! + track.nx[resolved]! * lateral,
    track.y[resolved]! + track.ny[resolved]! * lateral,
    heading
  );
  car.progIdx = resolved;
  car.s = resolved * track.step;
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
    lat: lateralResidual,
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
      bias: lateralResidual
    }
  } as unknown as Entry & { car: NonNullable<Entry['car']> };
}

function session(entries: Entry[]): Session {
  return {
    trk: built.tr,
    wet: 0,
    mode: 'race',
    t: 1,
    entries,
    config: { tuneBonus: 0 } as Session['config']
  } as Session;
}

describe('physical side agreements', () => {
  test('acquires wraparound overlap without scanning a distant pair', () => {
    const first = activeEntry('WRAP-A', built.tr.n - 1, -1.4);
    const second = activeEntry('WRAP-B', 0, 1.4);
    const distant = activeEntry('DISTANT', 200, 0);
    const value = session([distant, second, first]);

    updateRacecraftSideAgreements(value, [distant, second, first]);

    expect(value.sideAgreements?.has('WRAP-A:WRAP-B')).toBe(true);
    expect(value.sideAgreements?.size).toBe(1);
    expect(value.sideAgreements?.get('WRAP-A:WRAP-B')
      ?.centreClearance).toBe(PHYS.carWid);
  });

  test('retains a current family and releases it after body overlap ends', () => {
    const first = activeEntry('FIRST', 240, -1.4);
    const second = activeEntry('SECOND', 241, 1.4);
    const value = session([first, second]);
    updateRacecraftSideAgreements(value, [first, second]);
    const agreement = value.sideAgreements?.get('FIRST:SECOND');
    expect(agreement).toBeDefined();

    updateRacecraftSideAgreements(value, [second, first]);
    expect(value.sideAgreements?.get('FIRST:SECOND')).toBe(agreement);

    second.car.s = (first.car.s + 20) % built.tr.len;
    second.car.progIdx = Math.round(second.car.s / built.tr.step);
    updateRacecraftSideAgreements(value, [first, second]);
    expect(value.sideAgreements?.has('FIRST:SECOND')).toBe(false);
  });
});
