import { beforeAll, describe, expect, test } from 'bun:test';

import type {
  BuiltTrack,
  Car,
  Corner
} from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import { PHYS } from '../../../src/core/physics';
import { speedEnvelopeFromSamples } from
  '../../../src/core/speed-envelope';
import { prepareHeadlessTrack } from
  '../../../src/game/headless-sim';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  RacecraftLongitudinalProgram,
  RacecraftTimedTrajectoryProgram,
  Session
} from '../../../src/session/model';
import { racecraftTrajectoryProgramFromRows } from
  '../../../src/session/racecraft/claim';
import {
  classifyRacecraftDefensiveTiming,
  defensiveContactEpisodeIsAuthorized,
  evaluateRacecraftDefensiveLegality,
  racecraftCandidateMayAuthorCornerOwnership,
  racecraftDefensiveCommitmentIsActive,
  racecraftDefensiveLegalityAuthorizesReclaim
} from '../../../src/session/racecraft/defensive-legality';

type ActiveEntry = Entry & { car: Car };

const TEAM = {
  id: 'defensive-legality',
  name: 'Defensive legality',
  body: '#111',
  accent: '#eee'
} as const;
const SESSION_TIME_SECONDS = 100;
const DEFENDER_SPEED = 30;

let built: BuiltTrack;
let corner: Corner;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
  corner = built.tr.corners.find(value =>
    value.id === 'prado-c08')!;
});

function forwardDistance(from: number, to: number): number {
  const distance = to - from;
  return distance < 0 ? distance + built.tr.len : distance;
}

function activeEntry(
  code: string,
  s: number,
  speed: number,
  lateral = 0
): ActiveEntry {
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
  entry.car.spd = speed;
  entry.car.vx = speed;
  entry.spd = speed;
  entry.state = 'run';
  entry.prog = 2 * built.tr.len + s;
  entry.latNow = lateral;
  entry.brakingEffort = 0.9;
  return entry as ActiveEntry;
}

function session(entries: ActiveEntry[]): Session {
  return {
    trk: built.tr,
    prof: built.prof,
    entries,
    mode: 'race',
    t: SESSION_TIME_SECONDS,
    goT: 0,
    wet: 0,
    config: { tuneBonus: 0 } as Session['config'],
    events: []
  } as unknown as Session;
}

interface LateralKnot {
  readonly timeSeconds: number;
  readonly lateralMetres: number;
  readonly headingOffsetRadians?: number;
}

function timedTrajectory(
  entry: ActiveEntry,
  speed: number,
  revision: number,
  knots: readonly LateralKnot[]
): RacecraftTimedTrajectoryProgram {
  const originLateral = knots[0]?.timeSeconds === 0
    ? knots[0].lateralMetres
    : entry.latNow;
  const originHeading = knots[0]?.timeSeconds === 0
    ? knots[0].headingOffsetRadians ?? 0
    : 0;
  const future = knots[0]?.timeSeconds === 0
    ? knots.slice(1)
    : knots;
  return {
    ownerCode: entry.code,
    publicationRevision: revision,
    authoredAtSessionTimeSeconds: SESSION_TIME_SECONDS,
    trajectoryTimeOffsetSeconds: 0,
    trajectory: racecraftTrajectoryProgramFromRows(
      built.tr,
      {
        timeSeconds: 0,
        sMetres: entry.car.s,
        lateralMetres: originLateral,
        speedMetresPerSecond: speed,
        headingOffsetRadians: originHeading
      },
      future.map(knot => ({
        timeSeconds: knot.timeSeconds,
        sMetres: (
          entry.car.s + speed * knot.timeSeconds
        ) % built.tr.len,
        lateralMetres: knot.lateralMetres,
        speedMetresPerSecond: speed,
        headingOffsetRadians:
          knot.headingOffsetRadians ?? originHeading
      })),
      entry.prog
    )
  };
}

function cornerProgress(
  defender: ActiveEntry,
  index: number
): number {
  return defender.prog + forwardDistance(
    defender.car.s,
    index * built.tr.step
  );
}

function brakingProgram(
  defender: ActiveEntry
): RacecraftLongitudinalProgram {
  const brake = cornerProgress(defender, corner.brakeI);
  const turnIn = cornerProgress(defender, corner.turnInI);
  const exit = cornerProgress(defender, corner.exitI);
  return {
    envelope: speedEnvelopeFromSamples(
      [defender.prog, brake, turnIn, exit],
      [DEFENDER_SPEED, DEFENDER_SPEED, 20, 20]
    ),
    brakingEffort: 0.9,
    slowPointOwnerCode: null,
    bindingSlowPoint: null
  };
}

function fixture(
  gapMetres: number,
  attackerSpeed = 40
): {
  race: Session;
  defender: ActiveEntry;
  attacker: ActiveEntry;
  previous: RacecraftTimedTrajectoryProgram;
  attackerTrajectory: RacecraftTimedTrajectoryProgram;
  horizonSeconds: number;
} {
  const originS = corner.approachI * built.tr.step;
  const defender = activeEntry(
    'DEFENDER',
    originS,
    DEFENDER_SPEED
  );
  const attacker = activeEntry(
    'ATTACKER',
    originS - gapMetres,
    attackerSpeed
  );
  const horizonSeconds = (
    forwardDistance(
      defender.car.s,
      corner.exitI * built.tr.step
    ) / DEFENDER_SPEED
  ) + 0.5;
  return {
    race: session([defender, attacker]),
    defender,
    attacker,
    previous: timedTrajectory(
      defender,
      DEFENDER_SPEED,
      1,
      [{ timeSeconds: horizonSeconds, lateralMetres: 0 }]
    ),
    attackerTrajectory: timedTrajectory(
      attacker,
      attackerSpeed,
      7,
      [{ timeSeconds: horizonSeconds, lateralMetres: 0 }]
    ),
    horizonSeconds
  };
}

function candidate(
  defender: ActiveEntry,
  horizonSeconds: number,
  movementStartsSeconds: number,
  targetLateralMetres: number,
  revision = 2
): RacecraftTimedTrajectoryProgram {
  return timedTrajectory(
    defender,
    DEFENDER_SPEED,
    revision,
    [
      {
        timeSeconds: movementStartsSeconds,
        lateralMetres: 0
      },
      {
        timeSeconds: movementStartsSeconds + 0.2,
        lateralMetres: targetLateralMetres
      },
      {
        timeSeconds: horizonSeconds,
        lateralMetres: targetLateralMetres
      }
    ]
  );
}

function orientedLateralHalfExtent(
  headingOffsetRadians: number
): number {
  return Math.abs(Math.sin(headingOffsetRadians)) *
      PHYS.carLen / 2 +
    Math.abs(Math.cos(headingOffsetRadians)) *
      PHYS.carWid / 2;
}

function evaluate(input: {
  fixture: ReturnType<typeof fixture>;
  candidate: RacecraftTimedTrajectoryProgram;
  attacker?: ActiveEntry;
  attackerTrajectory?: RacecraftTimedTrajectoryProgram;
  existingCommitment?: Entry['racecraftDefensiveCommitment'];
  attackerAlreadyAlongside?: boolean;
  ownershipProtectsRoom?: boolean;
  safetyOnly?: boolean;
}) {
  const value = input.fixture;
  const attacker = input.attacker ?? value.attacker;
  const attackerTrajectory =
    input.attackerTrajectory ?? value.attackerTrajectory;
  return evaluateRacecraftDefensiveLegality({
    session: value.race,
    defender: value.defender,
    attacker,
    attackerPublicationRevision:
      attackerTrajectory.publicationRevision,
    coveredSide: 1,
    corner,
    cornerExitProgressMetres:
      cornerProgress(value.defender, corner.exitI),
    previousDefenderTrajectory: value.previous,
    candidateDefenderTrajectory: input.candidate,
    attackerTrajectory,
    candidateLongitudinalProgram:
      brakingProgram(value.defender),
    evaluateUntilSessionTimeSeconds:
      SESSION_TIME_SECONDS + value.horizonSeconds,
    existingCommitment: input.existingCommitment ?? null,
    attackerAlreadyAlongside:
      input.attackerAlreadyAlongside ?? false,
    ownershipProtectsRoom:
      input.ownershipProtectsRoom ?? false,
    safetyOnly: input.safetyOnly ?? false
  });
}

describe('per-corner defensive legality', () => {
  test('treats notice and alongside equality as exact shared boundaries', () => {
    const exactNotice = classifyRacecraftDefensiveTiming({
      tEncroachSessionTimeSeconds: 10,
      tBrakeSessionTimeSeconds: 12,
      tConflictSessionTimeSeconds: 11,
      tAlongsideSessionTimeSeconds: 11.1,
      turnInSessionTimeSeconds: 13,
      attackerAlreadyAlongside: false,
      ownershipProtectsRoom: false,
      noticeSeconds: 1
    });
    expect(exactNotice.legal).toBe(true);
    expect(exactNotice.outcome).toBe('side-closure-authorized');
    expect(exactNotice.approachConflictAuthorized).toBe(true);

    const exactAlongside = classifyRacecraftDefensiveTiming({
      tEncroachSessionTimeSeconds: 10,
      tBrakeSessionTimeSeconds: 12,
      tConflictSessionTimeSeconds: null,
      tAlongsideSessionTimeSeconds: 11,
      turnInSessionTimeSeconds: 13,
      attackerAlreadyAlongside: false,
      ownershipProtectsRoom: false,
      noticeSeconds: 1
    });
    expect(exactAlongside.legal).toBe(true);
    expect(exactAlongside.roomProtected).toBe(true);
    expect(exactAlongside.outcome).toBe('room-protected');

    const sudden = classifyRacecraftDefensiveTiming({
      tEncroachSessionTimeSeconds: 10,
      tBrakeSessionTimeSeconds: 12,
      tConflictSessionTimeSeconds: 10.999,
      tAlongsideSessionTimeSeconds: null,
      turnInSessionTimeSeconds: 13,
      attackerAlreadyAlongside: false,
      ownershipProtectsRoom: false,
      noticeSeconds: 1
    });
    expect(sudden.legal).toBe(false);
    expect(sudden.rejectionReason).toBe('insufficient-notice');

    for (const protection of [
      { attackerAlreadyAlongside: true, ownershipProtectsRoom: false },
      { attackerAlreadyAlongside: false, ownershipProtectsRoom: true }
    ]) {
      const protectedRoom = classifyRacecraftDefensiveTiming({
        tEncroachSessionTimeSeconds: 10,
        tBrakeSessionTimeSeconds: 12,
        tConflictSessionTimeSeconds: 11.5,
        tAlongsideSessionTimeSeconds: null,
        turnInSessionTimeSeconds: 13,
        noticeSeconds: 1,
        ...protection
      });
      expect(protectedRoom.legal).toBe(false);
      expect(protectedRoom.roomProtected).toBe(true);
    }
  });

  test('preserves exact oriented-body room for a timely alongside car', () => {
    const value = fixture(0, DEFENDER_SPEED);
    const defenderHeading = 0.22;
    const attackerHeading = -0.18;
    const exactSeparation =
      orientedLateralHalfExtent(defenderHeading) +
      orientedLateralHalfExtent(attackerHeading);
    const movementStartsSeconds = 0.1;
    const sharedMovementMetres = 0.5;
    value.previous = timedTrajectory(
      value.defender,
      DEFENDER_SPEED,
      1,
      [
        {
          timeSeconds: 0,
          lateralMetres: 0,
          headingOffsetRadians: defenderHeading
        },
        {
          timeSeconds: value.horizonSeconds,
          lateralMetres: 0,
          headingOffsetRadians: defenderHeading
        }
      ]
    );
    value.attackerTrajectory = timedTrajectory(
      value.attacker,
      DEFENDER_SPEED,
      7,
      [
        {
          timeSeconds: 0,
          lateralMetres: exactSeparation,
          headingOffsetRadians: attackerHeading
        },
        {
          timeSeconds: movementStartsSeconds,
          lateralMetres: exactSeparation,
          headingOffsetRadians: attackerHeading
        },
        {
          timeSeconds: movementStartsSeconds + 0.2,
          lateralMetres:
            exactSeparation + sharedMovementMetres,
          headingOffsetRadians: attackerHeading
        },
        {
          timeSeconds: value.horizonSeconds,
          lateralMetres:
            exactSeparation + sharedMovementMetres,
          headingOffsetRadians: attackerHeading
        }
      ]
    );
    const exactRoom = evaluate({
      fixture: value,
      candidate: timedTrajectory(
        value.defender,
        DEFENDER_SPEED,
        2,
        [
          {
            timeSeconds: 0,
            lateralMetres: 0,
            headingOffsetRadians: defenderHeading
          },
          {
            timeSeconds: movementStartsSeconds,
            lateralMetres: 0,
            headingOffsetRadians: defenderHeading
          },
          {
            timeSeconds: movementStartsSeconds + 0.2,
            lateralMetres: sharedMovementMetres,
            headingOffsetRadians: defenderHeading
          },
          {
            timeSeconds: value.horizonSeconds,
            lateralMetres: sharedMovementMetres,
            headingOffsetRadians: defenderHeading
          }
        ]
      )
    });
    expect(exactRoom.legal).toBe(true);
    expect(exactRoom.roomProtected).toBe(true);
    expect(exactRoom.outcome).toBe('room-protected');
    expect(exactRoom.tAlongsideSessionTimeSeconds)
      .toBeCloseTo(SESSION_TIME_SECONDS, 8);
    expect(exactRoom.tConflictSessionTimeSeconds).toBeNull();

    const invadedRoom = evaluate({
      fixture: value,
      candidate: timedTrajectory(
        value.defender,
        DEFENDER_SPEED,
        3,
        [
          {
            timeSeconds: 0,
            lateralMetres: 0,
            headingOffsetRadians: defenderHeading
          },
          {
            timeSeconds: movementStartsSeconds,
            lateralMetres: 0,
            headingOffsetRadians: defenderHeading
          },
          {
            timeSeconds: movementStartsSeconds + 0.2,
            lateralMetres: sharedMovementMetres + 0.01,
            headingOffsetRadians: defenderHeading
          },
          {
            timeSeconds: value.horizonSeconds,
            lateralMetres: sharedMovementMetres + 0.01,
            headingOffsetRadians: defenderHeading
          }
        ]
      )
    });
    expect(invadedRoom.legal).toBe(false);
    expect(invadedRoom.roomProtected).toBe(true);
    expect(invadedRoom.tAlongsideSessionTimeSeconds)
      .toBeCloseTo(SESSION_TIME_SECONDS, 8);
    expect(invadedRoom.tConflictSessionTimeSeconds)
      .not.toBeNull();
  });

  test('keeps defense separate from ownership and reclaim authority', () => {
    const move = {
      classification: 'new-move',
      legal: true,
      rejectionReason: null,
      targetCode: 'ATTACKER',
      cornerId: corner.id,
      tEncroachSessionTimeSeconds: 10,
      tBrakeSessionTimeSeconds: 12,
      tConflictSessionTimeSeconds: null,
      tAlongsideSessionTimeSeconds: null,
      turnInSessionTimeSeconds: 13,
      noticeDeadlineSessionTimeSeconds: 11,
      roomProtected: false,
      approachConflictAuthorized: false,
      outcome: 'side-closure-authorized',
      commitment: null
    } as const;
    expect(racecraftCandidateMayAuthorCornerOwnership(move))
      .toBe(false);
    expect(racecraftDefensiveLegalityAuthorizesReclaim(move))
      .toBe(true);
    expect(racecraftDefensiveLegalityAuthorizesReclaim({
      ...move,
      classification: 'continuation'
    })).toBe(true);
    expect(racecraftDefensiveLegalityAuthorizesReclaim({
      ...move,
      classification: 'not-impeding'
    })).toBe(false);
    expect(racecraftDefensiveLegalityAuthorizesReclaim({
      ...move,
      legal: false,
      rejectionReason: 'move-spent'
    })).toBe(false);
  });

  test('measures physical onset and rejects sudden or post-braking moves', () => {
    const suddenValue = fixture(PHYS.carLen + 4, 42);
    const sudden = evaluate({
      fixture: suddenValue,
      candidate: candidate(
        suddenValue.defender,
        suddenValue.horizonSeconds,
        0.1,
        0.75
      )
    });
    expect(sudden.tEncroachSessionTimeSeconds)
      .toBeCloseTo(SESSION_TIME_SECONDS + 0.1, 5);
    expect(sudden.tConflictSessionTimeSeconds).not.toBeNull();
    expect(sudden.legal).toBe(false);
    expect(sudden.rejectionReason).toBe('insufficient-notice');

    const lateValue = fixture(40);
    const late = evaluate({
      fixture: lateValue,
      candidate: candidate(
        lateValue.defender,
        lateValue.horizonSeconds,
        1.5,
        0.75
      )
    });
    expect(late.tEncroachSessionTimeSeconds)
      .toBeCloseTo(SESSION_TIME_SECONDS + 1.5, 5);
    expect(late.tBrakeSessionTimeSeconds)
      .toBeLessThan(late.tEncroachSessionTimeSeconds!);
    expect(late.legal).toBe(false);
    expect(late.rejectionReason).toBe('post-braking');
  });

  test('derives encroachment onset from defender geometry alone', () => {
    const value = fixture(40);
    const movement = candidate(
      value.defender,
      value.horizonSeconds,
      0.25,
      0.75
    );
    const baseline = evaluate({ fixture: value, candidate: movement });
    const displacedAttacker = timedTrajectory(
      value.attacker,
      value.attacker.spd,
      8,
      [
        {
          timeSeconds: 0,
          lateralMetres: -2.5,
          headingOffsetRadians: -0.3
        },
        {
          timeSeconds: value.horizonSeconds,
          lateralMetres: 2.5,
          headingOffsetRadians: 0.3
        }
      ]
    );
    const changedAttacker = evaluate({
      fixture: value,
      candidate: movement,
      attackerTrajectory: displacedAttacker
    });
    expect(changedAttacker.tEncroachSessionTimeSeconds)
      .toBe(baseline.tEncroachSessionTimeSeconds);
  });

  test('authors one legal closure and rejects later envelope expansion', () => {
    const value = fixture(PHYS.carLen + 15, 40);
    const firstCandidate = candidate(
      value.defender,
      value.horizonSeconds,
      0.1,
      0.75
    );
    const first = evaluate({
      fixture: value,
      candidate: firstCandidate
    });
    expect(first.legal).toBe(true);
    expect(first.classification).toBe('new-move');
    expect(first.outcome).toBe('side-closure-authorized');
    expect(first.tConflictSessionTimeSeconds)
      .toBeGreaterThanOrEqual(
        first.noticeDeadlineSessionTimeSeconds! -
          Number.EPSILON
      );
    expect(first.approachConflictAuthorized).toBe(true);
    expect(first.commitment).not.toBeNull();
    expect(Object.isFrozen(first.commitment)).toBe(true);

    const changedAttacker = activeEntry(
      'CHANGED-ATTACKER',
      value.attacker.car.s,
      value.attacker.spd
    );
    const changedPublication = {
      ...value.attackerTrajectory,
      ownerCode: changedAttacker.code,
      publicationRevision: 99
    };
    const continuation = evaluate({
      fixture: value,
      candidate: firstCandidate,
      attacker: changedAttacker,
      attackerTrajectory: changedPublication,
      existingCommitment: first.commitment!
    });
    expect(continuation.legal).toBe(true);
    expect(continuation.classification).toBe('continuation');
    expect(continuation.commitment).toBe(first.commitment);

    const expansion = evaluate({
      fixture: value,
      candidate: candidate(
        value.defender,
        value.horizonSeconds,
        0.1,
        1.2,
        3
      ),
      attacker: changedAttacker,
      attackerTrajectory: changedPublication,
      existingCommitment: first.commitment!
    });
    expect(expansion.legal).toBe(false);
    expect(expansion.rejectionReason).toBe('move-spent');

    expect(racecraftDefensiveCommitmentIsActive(
      first.commitment,
      first.commitment!.cornerExitProgressMetres -
        1e-6
    )).toBe(true);
    expect(racecraftDefensiveCommitmentIsActive(
      first.commitment,
      first.commitment!.cornerExitProgressMetres
    )).toBe(false);
  });

  test('does not consume authority for non-impeding or safety-only motion', () => {
    const value = fixture(40);
    const away = evaluate({
      fixture: value,
      candidate: candidate(
        value.defender,
        value.horizonSeconds,
        0.1,
        -0.75
      )
    });
    expect(away.legal).toBe(true);
    expect(away.classification).toBe('not-impeding');
    expect(away.commitment).toBeNull();

    const safetyOnly = evaluate({
      fixture: value,
      candidate: candidate(
        value.defender,
        value.horizonSeconds,
        0.1,
        0.75
      ),
      safetyOnly: true
    });
    expect(safetyOnly.legal).toBe(true);
    expect(safetyOnly.classification).toBe('safety-only');
    expect(safetyOnly.commitment).toBeNull();
  });

  test('scopes the nominal-conflict exception to the target and suffix', () => {
    const result = {
      classification: 'new-move',
      legal: true,
      rejectionReason: null,
      targetCode: 'ATTACKER',
      cornerId: corner.id,
      tEncroachSessionTimeSeconds: 10,
      tBrakeSessionTimeSeconds: 12,
      tConflictSessionTimeSeconds: 11,
      tAlongsideSessionTimeSeconds: null,
      turnInSessionTimeSeconds: 13,
      noticeDeadlineSessionTimeSeconds: 11,
      roomProtected: false,
      approachConflictAuthorized: true,
      outcome: 'side-closure-authorized',
      commitment: null
    } as const;

    expect(defensiveContactEpisodeIsAuthorized(
      result,
      'ATTACKER',
      { startTimeSeconds: 11, endTimeSeconds: 12.9 }
    )).toBe(true);
    expect(defensiveContactEpisodeIsAuthorized(
      result,
      'ATTACKER',
      { startTimeSeconds: 10.99, endTimeSeconds: 12 }
    )).toBe(false);
    expect(defensiveContactEpisodeIsAuthorized(
      result,
      'ATTACKER',
      { startTimeSeconds: 11, endTimeSeconds: 13 }
    )).toBe(false);
    expect(defensiveContactEpisodeIsAuthorized(
      result,
      'UNRELATED',
      { startTimeSeconds: 11, endTimeSeconds: 12 }
    )).toBe(false);
  });
});
