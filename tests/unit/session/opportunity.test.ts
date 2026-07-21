import { beforeAll, describe, expect, test } from 'bun:test';

import type { BuiltTrack, Car } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import { prepareHeadlessTrack } from '../../../src/game/headless-sim';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  RacecraftClaim,
  Session
} from '../../../src/session/model';
import { racecraftTrajectoryProgramFromRows } from
  '../../../src/session/racecraft/claim';
import { classifyRacecraftOpportunity } from
  '../../../src/session/racecraft/opportunity';
import { buildRacecraftPlanningContext } from
  '../../../src/session/racecraft/planning-order';

type ActiveEntry = Entry & { car: Car };

const TEAM = {
  id: 'opportunity',
  name: 'Opportunity',
  body: '#222',
  accent: '#ddd'
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
  entry.car.spd = speed;
  entry.car.vx = speed;
  entry.spd = speed;
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
    sideAgreements: new Map(),
    config: { tuneBonus: 0 } as Session['config'],
    events: []
  } as unknown as Session;
}

function publication(entry: ActiveEntry): RacecraftClaim {
  const rows = [1, 2, 3].map(index => {
    const time = index * 0.2;
    return {
      timeSeconds: time,
      sMetres: entry.car.s + entry.spd * time,
      lateralMetres: entry.latNow,
      speedMetresPerSecond: entry.spd,
      headingOffsetRadians: 0
    };
  });
  return {
    code: entry.code,
    predictionKey: entry.code,
    lateralAuthorityRevision: 1,
    longitudinalAuthorityRevision: 1,
    publicationRevision: 1,
    publishedAt: 20,
    originS: entry.car.s,
    originCentre: entry.latNow,
    originSpeed: entry.spd,
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
        sMetres: entry.car.s,
        lateralMetres: entry.latNow,
        speedMetresPerSecond: entry.spd,
        headingOffsetRadians: 0
      },
      rows,
      entry.prog
    )
  };
}

function opportunity(
  value: Session,
  ego: ActiveEntry,
  claims: ReadonlyMap<string, RacecraftClaim>
) {
  return classifyRacecraftOpportunity(
    value,
    buildRacecraftPlanningContext(
      value,
      ego,
      value.entries as ActiveEntry[],
      claims
    )
  );
}

describe('directional opportunity proof', () => {
  test('uses direct ideal only when no forward publication binds', () => {
    const ego = activeEntry('SOLO', 100, 30);
    const value = session([ego]);
    expect(opportunity(value, ego, new Map()).classification)
      .toBe('direct-ideal');
  });

  test('opens deliberate evaluation for an already-bound open side', () => {
    const follower = activeEntry('FAST', 100, 45);
    const leader = activeEntry('SLOW', 108, 15);
    const value = session([follower, leader]);
    const result = opportunity(
      value,
      follower,
      new Map([[leader.code, publication(leader)]])
    );

    expect(result.binding).not.toBeNull();
    expect(result.classification).toBe('deliberate');
    expect([
      result.negativeSideCertificate,
      result.positiveSideCertificate
    ]).toContain(null);
  });

  test('permits direct follow only with two physical certificates', () => {
    const follower = activeEntry('FOLLOW', 100, 45);
    const leader = activeEntry('BLOCK', 108, 15);
    const value = session([follower, leader]);
    value.trk = {
      ...value.trk,
      surface: {
        ...value.trk.surface,
        normalMinimum: new Float64Array(value.trk.n).fill(-0.4),
        normalMaximum: new Float64Array(value.trk.n).fill(0.4)
      }
    };
    const result = opportunity(
      value,
      follower,
      new Map([[leader.code, publication(leader)]])
    );

    expect(result.classification).toBe('direct-follow');
    expect(result.negativeSideCertificate?.reason)
      .toBe('no-connected-normal-corridor');
    expect(result.positiveSideCertificate?.reason)
      .toBe('no-connected-normal-corridor');
  });

  test('treats a missing forward publication as uncertain', () => {
    const follower = activeEntry('FOLLOWER', 100, 40);
    const leader = activeEntry('LEADER', 112, 20);
    const value = session([follower, leader]);
    const result = opportunity(value, follower, new Map());

    expect(result.classification).toBe('deliberate');
    expect(result.reason).toBe('forward-publication-unavailable');
  });
});
