import { beforeAll, describe, expect, test } from 'bun:test';

import type { BuiltTrack, Car } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import { prepareHeadlessTrack } from
  '../../../src/game/headless-sim';
import { createEntry } from '../../../src/session/entry';
import type {
  Entry,
  LineupEntry,
  RacecraftDecision,
  Session
} from '../../../src/session/model';
import { publishRacecraftTacticalPublication } from
  '../../../src/session/racecraft/publication';

type ActiveEntry = Entry & { car: Car };

const TEAM = {
  id: 'publication',
  name: 'Publication',
  body: '#111',
  accent: '#eee'
} as const;

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function entry(): ActiveEntry {
  const index = 800;
  const lateral = built.tr.idealPath.off[index]!;
  const lineup: LineupEntry = {
    team: TEAM,
    name: 'DEFENDER',
    code: 'DEFENDER',
    isPlayer: false,
    ci: 0,
    margin: 0,
    focus: 1,
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
  value.car.s = index * built.tr.step;
  value.car.progIdx = index;
  value.car.spd = 30;
  value.car.vx = 30;
  value.spd = 30;
  value.state = 'run';
  value.prog = built.tr.len + value.car.s;
  value.latNow = lateral;
  return value as ActiveEntry;
}

function decision(
  overrides: Partial<RacecraftDecision> = {}
): RacecraftDecision {
  return {
    at: 20,
    decisionMode: 'direct-ideal',
    selectedKind: 'ideal',
    selectedPlanNumericId: null,
    selectedPlanKey: null,
    candidateCount: 0,
    targetLateral: 0,
    interactionCause: null,
    chosenUtilization: 0,
    selectedLongitudinalProgram: null,
    economics: [],
    candidates: [],
    ...overrides
  };
}

function session(value: ActiveEntry): Session {
  return {
    trk: built.tr,
    prof: built.prof,
    entries: [value],
    mode: 'race',
    t: 20,
    goT: 0,
    wet: 0,
    config: { tuneBonus: 0 } as Session['config'],
    events: []
  } as unknown as Session;
}

function publish(
  race: Session,
  value: ActiveEntry,
  epoch: number
) {
  value._racecraftLastDecisionTrafficEpoch = epoch;
  return publishRacecraftTacticalPublication(
    race,
    value,
    epoch
  );
}

describe('defensive publication lineage', () => {
  test('survives targets, revisions, and avoidance until corner exit', () => {
    const value = entry();
    const race = session(value);
    value.racecraftDecision = decision();
    const initial = publish(race, value, 0)!;
    const corner = built.tr.corners.find(candidate =>
      candidate.id === 'prado-c08')!;
    const commitment = Object.freeze({
      cornerId: corner.id,
      cornerExitProgressMetres: value.prog + 5,
      targetCodeAtCommitment: 'ATTACKER-A',
      coveredSide: 1 as const,
      sourceAttackerPublicationRevision: 8,
      authorizedDefenderPublicationRevision: 1,
      authorizedAtSessionTimeSeconds: race.t,
      authorizedTrajectory: initial.trajectory,
      encroachmentStartSessionTimeSeconds: race.t + 0.1,
      noticeDeadlineSessionTimeSeconds: race.t + 1.1,
      authoredFirstConflictSessionTimeSeconds: race.t + 1.2,
      authoredFirstAlongsideSessionTimeSeconds: null,
      authoredOutcome: 'side-closure-authorized' as const
    });

    race.t += 0.1;
    value.racecraftDecision = decision({
      at: race.t,
      decisionMode: 'defense',
      publicationTargetCode: 'ATTACKER-A',
      publicationCornerId: corner.id,
      defensiveCommitment: commitment,
      defensiveTargetCode: 'ATTACKER-A',
      defensiveCornerId: corner.id
    });
    const authored = publish(race, value, 1)!;
    expect(authored.defensiveCommitment).toBe(commitment);
    expect(value.racecraftDefensiveCommitment).toBe(commitment);
    expect(race.racecraftDefensiveMovesCommitted).toBe(1);

    race.t += 0.1;
    value.racecraftDecision = decision({
      at: race.t,
      decisionMode: 'direct-follow',
      publicationTargetCode: 'ATTACKER-B'
    });
    const changedTarget = publish(race, value, 2)!;
    expect(changedTarget.publicationRevision)
      .toBeGreaterThan(authored.publicationRevision);
    expect(changedTarget.targetCode).toBe('ATTACKER-B');
    expect(changedTarget.defensiveCommitment).toBe(commitment);
    expect(race.racecraftDefensiveMovesCommitted).toBe(1);

    value.recT = 0.5;
    race.t += 0.1;
    expect(publish(race, value, 3)).toBeNull();
    expect(value.racecraftDefensiveCommitment).toBe(commitment);

    value.recT = 0;
    race.t += 0.1;
    const restoredPublication = publish(race, value, 4)!;
    expect(restoredPublication.defensiveCommitment).toBe(commitment);
    expect(race.racecraftDefensiveMovesCommitted).toBe(1);

    value.prog = commitment.cornerExitProgressMetres;
    race.t += 0.1;
    const afterExit = publish(race, value, 5)!;
    expect(afterExit.defensiveCommitment).toBeNull();
    expect(value.racecraftDefensiveCommitment).toBeUndefined();
    expect(race.racecraftDefensiveMovesResetAtExit).toBe(1);
  });
});
