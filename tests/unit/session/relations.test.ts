import { describe, expect, test } from 'bun:test';

import type { Car } from '../../../src/core/model';
import { PHYS } from '../../../src/core/physics';
import { makeCar } from '../../../src/core/physics-engine';
import { prepareHeadlessTrack } from '../../../src/game/headless-sim';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  Session
} from '../../../src/session/model';
import {
  contractIsRevoked,
  obligationsFor,
  owes
} from '../../../src/session/racecraft/relations';
import { createRacecraftClaimStations } from
  '../../../src/session/racecraft/claim';

type ActiveEntry = Entry & { car: Car };

const built = prepareHeadlessTrack('prado');
const TEAM = {
  id: 'relations-test',
  name: 'Relations Test',
  body: '#000',
  accent: '#fff'
} as const;

function activeEntry(code: string, s: number, speed: number): ActiveEntry {
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
  const index = Math.round(s / built.tr.step) % built.tr.n;
  entry.car = makeCar(
    built.tr.x[index]!,
    built.tr.y[index]!,
    Math.atan2(built.tr.ty[index]!, built.tr.tx[index]!)
  );
  entry.car.s = s;
  entry.car.progIdx = index;
  entry.car.vx = speed;
  entry.car.spd = speed;
  entry.spd = speed;
  entry.prog = s;
  entry.state = 'run';
  entry.cross = 1;
  return entry as ActiveEntry;
}

function relationSession(
  mode: 'race' | 'quali',
  entries: Entry[]
): Session {
  return {
    trk: built.tr,
    mode,
    entries,
    wet: 0,
    t: 20
  } as Session;
}

describe('stateless racecraft obligations', () => {
  test('derives and releases a blue-flag obligation from current geometry', () => {
    const yielding = activeEntry('YIELD', 100, 25);
    const beneficiary = activeEntry('FAST', 70, 35);
    beneficiary.cross = 2;
    const session = relationSession('race', [yielding, beneficiary]);

    expect(owes(session, yielding, beneficiary)).toBe('blue-flag');
    expect(obligationsFor(session, yielding, session.entries)).toEqual([
      { yielding, beneficiary, reason: 'blue-flag' }
    ]);
    expect('priorityRecords' in session).toBe(false);

    beneficiary.car.s = yielding.car.s + PHYS.carLen + 1;
    beneficiary.prog = beneficiary.car.s;
    expect(owes(session, yielding, beneficiary)).toBeNull();
  });

  test('uses the same relation for qualifying traffic without stored priority', () => {
    const yielding = activeEntry('OUT', 100, 24);
    const beneficiary = activeEntry('FLY', 72, 34);
    yielding.lapPhase = 'out';
    beneficiary.lapPhase = 'flying';
    const session = relationSession('quali', [yielding, beneficiary]);

    expect(owes(session, yielding, beneficiary)).toBe('qualifying');
    yielding.lapPhase = 'flying';
    expect(owes(session, yielding, beneficiary)).toBeNull();
  });

  test('turns reduced damaged-car capability into a relation, not a lane override', () => {
    const yielding = activeEntry('DAMAGED', 100, 20);
    const beneficiary = activeEntry('HEALTHY', 82, 32);
    yielding.hFail = true;
    const session = relationSession('race', [yielding, beneficiary]);
    const laneBefore = structuredClone(yielding.laneProgram);

    expect(owes(session, yielding, beneficiary)).toBe('damage');
    expect(yielding.laneProgram).toEqual(laneBefore);
  });
});

describe('stateless hazard publication', () => {
  test('publishes actual revoked occupancy without obstacle episodes', () => {
    const follower = activeEntry('FOLLOWER', 100, 34);
    const stopped = activeEntry('STOPPED', 130, 0);
    const session = relationSession('race', [follower, stopped]);
    session.racecraftClaims = new Map([[
      stopped.code,
      {
        code: stopped.code,
        source: 'ballistic',
        predictionKey: `ballistic:${stopped.code}`,
        lateralAuthorityRevision: -1,
        longitudinalAuthorityRevision: -1,
        publicationRevision: 0,
        publishedAt: session.t,
        originS: stopped.car.s,
        originCentre: stopped.latNow,
        originSpeed: stopped.spd,
        originHeadingOffsetRadians: 0,
        trusted: false,
        lateralTrackingErrorThresholdMetres: PHYS.carWid / 10,
        longitudinalTrackingErrorThresholdMetres: PHYS.carWid / 10,
        trackingErrorMetres: 0,
        stations: createRacecraftClaimStations(0)
      }
    ]]);

    expect(contractIsRevoked(session, stopped)).toBe(true);
    expect('obstacleEpisodes' in session).toBe(false);
  });
});
