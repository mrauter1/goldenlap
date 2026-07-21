import { beforeAll, describe, expect, test } from 'bun:test';

import type { BuiltTrack, Car, Corner } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import { PHYS } from '../../../src/core/physics';
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
import {
  authorCornerOwnershipAssertion,
  classifyCornerOwnership,
  continuousTrajectoryStateAtTime,
  cornerOwnershipTimingBandSeconds,
  validateCornerOwnership,
  type RacecraftTrajectory
} from '../../../src/session/racecraft/corner-ownership';

type ActiveEntry = Entry & { car: Car };

const TEAM = {
  id: 'ownership',
  name: 'Ownership',
  body: '#333',
  accent: '#ccc'
} as const;

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function forwardDistance(from: number, to: number): number {
  const distance = to - from;
  return distance < 0 ? distance + built.tr.len : distance;
}

function ownershipCorner(): Corner {
  return [...built.tr.corners].sort((left, right) => {
    const leftSpan = (
      left.apexI - left.turnInI + built.tr.n
    ) % built.tr.n;
    const rightSpan = (
      right.apexI - right.turnInI + built.tr.n
    ) % built.tr.n;
    return rightSpan - leftSpan;
  })[0]!;
}

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
  entry.prog = 2 * built.tr.len + s;
  entry.latNow = lateral;
  return entry as ActiveEntry;
}

function constantTrajectory(
  entry: ActiveEntry,
  corner: Corner,
  speed: number
): RacecraftTrajectory {
  const exitS = corner.exitI * built.tr.step;
  const exitProgress = entry.prog +
    forwardDistance(entry.car.s, exitS);
  const exitSeconds = (exitProgress - entry.prog) / speed;
  const originIndex =
    Math.round(entry.car.s / built.tr.step) % built.tr.n;
  const origin = {
    timeSeconds: 0,
    sMetres: entry.car.s,
    lateralMetres: built.tr.idealPath.off[originIndex]!,
    speedMetresPerSecond: speed,
    headingOffsetRadians: 0
  };
  const rows = [];
  for (let seconds = 0.1; seconds < exitSeconds; seconds += 0.1) {
    const progress = entry.prog + speed * seconds;
    const s = progress % built.tr.len;
    const index = Math.round(s / built.tr.step) % built.tr.n;
    rows.push({
      timeSeconds: seconds,
      sMetres: s,
      lateralMetres: built.tr.idealPath.off[index]!,
      speedMetresPerSecond: speed,
      headingOffsetRadians: 0
    });
  }
  const exitIndex = corner.exitI;
  rows.push({
    timeSeconds: exitSeconds,
    sMetres: exitS,
    lateralMetres: built.tr.idealPath.off[exitIndex]!,
    speedMetresPerSecond: speed,
    headingOffsetRadians: 0
  });
  return {
    ownerCode: entry.code,
    publicationRevision: 1,
    authoredAtSessionTimeSeconds: 0,
    trajectoryTimeOffsetSeconds: 0,
    trajectory: racecraftTrajectoryProgramFromRows(
      built.tr,
      origin,
      rows,
      entry.prog
    ),
    fromSessionTimeSeconds: 0,
    toSessionTimeSeconds: exitSeconds
  };
}

function publication(
  entry: ActiveEntry,
  trajectory: RacecraftTrajectory,
  revision: number,
  targetCode: string | null,
  planId: number | null,
  familyId: number | null
): RacecraftClaim {
  const origin = continuousTrajectoryStateAtTime(
    built.tr,
    trajectory,
    trajectory.fromSessionTimeSeconds
  );
  return {
    code: entry.code,
    predictionKey: entry.code,
    lateralAuthorityRevision: 1,
    longitudinalAuthorityRevision: 1,
    publicationRevision: revision,
    publishedAt: 0,
    originS: origin.s,
    originCentre: origin.lateral,
    originSpeed: origin.speed,
    originHeadingOffsetRadians: origin.headingOffsetRadians,
    trusted: true,
    mode: targetCode ? 'staged-attack' : 'direct-ideal',
    targetCode,
    cornerId: null,
    selectedPlanNumericId: planId,
    selectedFamilyNumericId: familyId,
    selectedLongitudinalProgram: null,
    ownershipAssertion: null,
    defensiveCommitment: null,
    trajectoryTimeOffsetSeconds: 0,
    trajectory: trajectory.trajectory
  };
}

function fixture(attackerSpeed = 12, leaderSpeed = 8) {
  const corner = ownershipCorner();
  const turnInS = corner.turnInI * built.tr.step;
  const originS = (turnInS - 10 + built.tr.len) % built.tr.len;
  const attacker = activeEntry('ATTACKER', originS, attackerSpeed);
  const leader = activeEntry(
    'LEADER',
    (originS + 8.2) % built.tr.len,
    leaderSpeed
  );
  const attackerTrajectory = constantTrajectory(
    attacker,
    corner,
    attackerSpeed
  );
  const leaderTrajectory = constantTrajectory(
    leader,
    corner,
    leaderSpeed
  );
  const value = {
    trk: built.tr,
    prof: built.prof,
    entries: [attacker, leader],
    mode: 'race',
    t: 0,
    wet: 0,
    config: { tuneBonus: 0 } as Session['config'],
    events: []
  } as unknown as Session;
  return {
    corner,
    attacker,
    leader,
    attackerTrajectory,
    leaderTrajectory,
    session: value
  };
}

describe('immutable apex ownership', () => {
  test('derives a positive timing band from trajectory resolution', () => {
    const value = fixture();
    const band = cornerOwnershipTimingBandSeconds(
      value.attackerTrajectory,
      value.leaderTrajectory
    );
    expect(band).toBeGreaterThan(0);
    expect(band).toBeLessThanOrEqual(0.1 + Number.EPSILON);
  });

  test('authors an immutable assertion for an attacker-owned conflict', () => {
    const value = fixture();
    const classification = classifyCornerOwnership(
      built.tr,
      value.corner,
      value.attackerTrajectory,
      value.leaderTrajectory
    );
    expect(classification.outcome).toBe('attacker-owned');
    const assertion = authorCornerOwnershipAssertion({
      session: value.session,
      corner: value.corner,
      attackerCode: value.attacker.code,
      targetCode: value.leader.code,
      attackerTrajectory: value.attackerTrajectory,
      leaderTrajectory: value.leaderTrajectory,
      attackerPublicationRevision: 2,
      sourceLeaderPublicationRevision: 4,
      selectedPlanNumericId: 11,
      selectedFamilyNumericId: 12,
      side: -1
    });

    expect(assertion).not.toBeNull();
    expect(Object.isFrozen(assertion)).toBe(true);
    expect(assertion?.authoredOutcome).toBe('attacker-owned');
  });

  test('classifies equal apex arrival as shared ownership', () => {
    const corner = ownershipCorner();
    const turnInS = corner.turnInI * built.tr.step;
    const originS = turnInS - 1;
    const attacker = activeEntry('SHARED-ATTACKER', originS, 10);
    const leader = activeEntry('SHARED-LEADER', originS, 10);
    const exitS = corner.exitI * built.tr.step;
    const exitProgress = attacker.prog +
      forwardDistance(attacker.car.s, exitS);
    const exitSeconds = (exitProgress - attacker.prog) / 10;
    const convergingTrajectory = (
      entry: ActiveEntry,
      startLateral: number,
      endLateral: number
    ): RacecraftTrajectory => ({
      ownerCode: entry.code,
      publicationRevision: 1,
      authoredAtSessionTimeSeconds: 0,
      trajectoryTimeOffsetSeconds: 0,
      trajectory: racecraftTrajectoryProgramFromRows(
        built.tr,
        {
          timeSeconds: 0,
          sMetres: entry.car.s,
          lateralMetres: startLateral,
          speedMetresPerSecond: 10,
          headingOffsetRadians: 0
        },
        [
          {
            timeSeconds: 0.25,
            sMetres: (entry.car.s + 2.5) % built.tr.len,
            lateralMetres: endLateral,
            speedMetresPerSecond: 10,
            headingOffsetRadians: 0
          },
          {
            timeSeconds: exitSeconds,
            sMetres: exitS,
            lateralMetres: endLateral,
            speedMetresPerSecond: 10,
            headingOffsetRadians: 0
          }
        ],
        entry.prog
      ),
      fromSessionTimeSeconds: 0,
      toSessionTimeSeconds: exitSeconds
    });
    const attackerTrajectory = convergingTrajectory(
      attacker,
      -1.6,
      -0.2
    );
    const leaderTrajectory = convergingTrajectory(
      leader,
      1.6,
      0.2
    );
    const classification = classifyCornerOwnership(
      built.tr,
      corner,
      attackerTrajectory,
      leaderTrajectory
    );
    expect(classification.outcome).toBe('shared');
    expect(classification.attackerApexArrivalSessionTimeSeconds)
      .toBeCloseTo(
        classification.leaderApexArrivalSessionTimeSeconds!,
        10
      );
  });

  test('invalidates a replaced source without mutating the assertion', () => {
    const value = fixture();
    const assertion = authorCornerOwnershipAssertion({
      session: value.session,
      corner: value.corner,
      attackerCode: value.attacker.code,
      targetCode: value.leader.code,
      attackerTrajectory: value.attackerTrajectory,
      leaderTrajectory: value.leaderTrajectory,
      attackerPublicationRevision: 2,
      sourceLeaderPublicationRevision: 4,
      selectedPlanNumericId: 11,
      selectedFamilyNumericId: 12,
      side: 1
    })!;
    const attackerPublication = publication(
      value.attacker,
      value.attackerTrajectory,
      3,
      value.leader.code,
      11,
      12
    );
    const leaderPublication = publication(
      value.leader,
      value.leaderTrajectory,
      4,
      null,
      null,
      null
    );
    const before = { ...assertion };
    const validated = validateCornerOwnership({
      session: value.session,
      assertion,
      attacker: value.attacker,
      attackerPublication,
      leader: value.leader,
      leaderPublication
    });

    expect(validated).toMatchObject({
      outcome: 'inactive',
      reason: 'source-replaced'
    });
    expect(assertion).toEqual(before);
  });

  test('rejects a late attacker as leader-owned', () => {
    const value = fixture();
    const delayedAttacker: RacecraftTrajectory = {
      ...value.attackerTrajectory,
      authoredAtSessionTimeSeconds:
        value.attackerTrajectory.authoredAtSessionTimeSeconds + 3.5,
      fromSessionTimeSeconds:
        value.attackerTrajectory.fromSessionTimeSeconds + 3.5,
      toSessionTimeSeconds:
        value.attackerTrajectory.toSessionTimeSeconds + 3.5
    };
    const classification = classifyCornerOwnership(
      built.tr,
      value.corner,
      delayedAttacker,
      value.leaderTrajectory
    );
    expect(classification).toMatchObject({
      outcome: 'leader-owned'
    });
  });

  test('revokes a fresh view after measured attacker divergence', () => {
    const value = fixture();
    const assertion = authorCornerOwnershipAssertion({
      session: value.session,
      corner: value.corner,
      attackerCode: value.attacker.code,
      targetCode: value.leader.code,
      attackerTrajectory: value.attackerTrajectory,
      leaderTrajectory: value.leaderTrajectory,
      attackerPublicationRevision: 2,
      sourceLeaderPublicationRevision: 4,
      selectedPlanNumericId: 11,
      selectedFamilyNumericId: 12,
      side: -1
    })!;
    const attackerPublication = publication(
      value.attacker,
      value.attackerTrajectory,
      2,
      value.leader.code,
      11,
      12
    );
    const leaderPublication = publication(
      value.leader,
      value.leaderTrajectory,
      4,
      null,
      null,
      null
    );
    const before = { ...assertion };
    value.attacker.latNow += PHYS.carWid;

    expect(validateCornerOwnership({
      session: value.session,
      assertion,
      attacker: value.attacker,
      attackerPublication,
      leader: value.leader,
      leaderPublication
    })).toMatchObject({
      outcome: 'inactive',
      reason: 'attacker-diverged'
    });
    expect(assertion).toEqual(before);
  });
});
