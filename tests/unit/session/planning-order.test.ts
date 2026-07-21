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
import { racecraftTrajectoryProgramFromRows } from
  '../../../src/session/racecraft/claim';
import {
  buildRacecraftPlanningContext,
  buildRacecraftPlanningOrder,
  racecraftDecisionSlotForCode,
  racecraftDecisionSlotIsDue,
  RACECRAFT_DIRECTIONAL_SLOT_COUNT,
  selectedCommittedDefenseView
} from '../../../src/session/racecraft/planning-order';

type ActiveEntry = Entry & { car: Car };

const TEAM = {
  id: 'planning-order',
  name: 'Planning order',
  body: '#000',
  accent: '#fff'
} as const;

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function activeEntry(code: string, s: number): ActiveEntry {
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
  entry.car.spd = 30;
  entry.car.vx = 30;
  entry.spd = 30;
  entry.state = 'run';
  entry.latNow = lateral;
  entry.prog = built.tr.len + s;
  entry.cross = 1;
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

function publication(
  entry: ActiveEntry,
  targetCode: string,
  terminalLateral = entry.latNow - 2
): RacecraftClaim {
  const rows = [1, 2].map(index => {
    const time = 0.1 * index;
    return {
      timeSeconds: time,
      sMetres: entry.car.s + entry.spd * time,
      speedMetresPerSecond: entry.spd,
      lateralMetres: entry.latNow +
        (terminalLateral - entry.latNow) * index / 2,
      headingOffsetRadians: 0
    };
  });
  return {
    code: entry.code,
    predictionKey: entry.code,
    lateralAuthorityRevision: 1,
    longitudinalAuthorityRevision: 1,
    publicationRevision: 3,
    publishedAt: 20,
    originS: entry.car.s,
    originCentre: entry.latNow,
    originSpeed: entry.spd,
    originHeadingOffsetRadians: 0,
    trusted: true,
    mode: 'staged-attack',
    targetCode,
    cornerId: null,
    selectedPlanNumericId: 7,
    selectedFamilyNumericId: 7,
    selectedLongitudinalProgram: null,
    ownershipAssertion: null,
    defensiveCommitment: null,
    trajectoryTimeOffsetSeconds: 0,
    trajectory: racecraftTrajectoryProgramFromRows(
      built.tr,
      {
        timeSeconds: 0,
        sMetres: entry.car.s,
        speedMetresPerSecond: entry.spd,
        lateralMetres: entry.latNow,
        headingOffsetRadians: 0
      },
      rows,
      entry.prog
    )
  };
}

function sideDecision(
  targetLateral: number,
  familyNumericId = 11
): RacecraftDecision {
  const plan = {
    mode: 'side-inside' as const,
    key: 'test:cover',
    anchors: [],
    pinnedFirst: true,
    topology: 'left' as const,
    surfaceAuthorization: 'normal' as const
  };
  return {
    at: 20,
    selectedKind: 'corner-inside',
    selectedPlanNumericId: 9,
    selectedPlanKey: plan.key,
    candidateCount: 1,
    targetLateral,
    interactionCause: 'ordinary',
    chosenUtilization: 0,
    selectedLongitudinalProgram: null,
    economics: [],
    candidates: [{
      kind: 'corner-inside',
      plan,
      planNumericId: 9,
      familyNumericId,
      feasible: true,
      vetoes: [],
      targetLateral,
      slowPointOwnerCode: null,
      slowPoint: null,
      interactionCause: 'ordinary',
      ownTimeSeconds: 0,
      billSeconds: 0,
      proximitySeconds: 0,
      positionValueSeconds: 0,
      attemptLossSeconds: 0,
      battleSpendSeconds: 0,
      effortRiskSeconds: 0,
      positionGain: false,
      minimumPlannedClearanceMetres: null,
      tieBandSeconds: 0,
      hazardCount: 0,
      switchChanged: false,
      brakingEffort: 1,
      gripUtilization: 0,
      direction: 'left',
      speedClass: 'free',
      cost: 0
    }]
  };
}

describe('directional planning order', () => {
  test('is front-to-back and invariant to input permutation', () => {
    const rear = activeEntry('REAR', built.tr.len - 5);
    const middle = activeEntry('MIDDLE', 5);
    const front = activeEntry('FRONT', 15);
    const first = session([middle, rear, front]);
    const second = session([front, middle, rear]);

    expect(buildRacecraftPlanningOrder(first, first.entries as ActiveEntry[])
      .orderedEntries.map(entry => entry.code))
      .toEqual(['FRONT', 'MIDDLE', 'REAR']);
    expect(buildRacecraftPlanningOrder(second, second.entries as ActiveEntry[])
      .orderedEntries.map(entry => entry.code))
      .toEqual(['FRONT', 'MIDDLE', 'REAR']);
  });

  test('assigns each code to exactly one of three tactical slots', () => {
    for (const code of ['A', 'B', 'C', 'FDS', 'MER']) {
      const entry = activeEntry(code, 100);
      const slot = racecraftDecisionSlotForCode(code);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(RACECRAFT_DIRECTIONAL_SLOT_COUNT);
      expect(
        Array.from(
          { length: RACECRAFT_DIRECTIONAL_SLOT_COUNT },
          (_, epoch) => racecraftDecisionSlotIsDue(epoch, entry)
        ).filter(Boolean)
      ).toHaveLength(1);
    }
  });

  test('derives a committed rear attack only from its selected publication', () => {
    const attacker = activeEntry('ATTACKER', 100);
    const defender = activeEntry('DEFENDER', 120);
    const value = session([attacker, defender]);
    const claims = new Map([
      [attacker.code, publication(attacker, defender.code)]
    ]);

    const context = buildRacecraftPlanningContext(
      value,
      defender,
      value.entries as ActiveEntry[],
      claims
    );

    expect(context.committedAttacks).toHaveLength(1);
    expect(context.committedAttacks[0]).toMatchObject({
      attackerCode: attacker.code,
      targetCode: defender.code,
      publicationRevision: 3
    });
    claims.get(attacker.code)!.mode = 'direct-follow';
    expect(buildRacecraftPlanningContext(
      value,
      defender,
      value.entries as ActiveEntry[],
      claims
    ).committedAttacks).toEqual([]);
  });

  test('keeps an uncommitted rear car out of the leader evaluation', () => {
    const rear = activeEntry('REAR', 100);
    const leader = activeEntry('LEADER', 120);
    const value = session([rear, leader]);
    const rearPublication = {
      ...publication(rear, leader.code),
      mode: 'direct-follow' as const,
      targetCode: null
    };
    const context = buildRacecraftPlanningContext(
      value,
      leader,
      value.entries as ActiveEntry[],
      new Map([[rear.code, rearPublication]])
    );

    expect(context.rearEntries.map(entry => entry.code))
      .toContain(rear.code);
    expect(context.committedAttacks).toEqual([]);
    expect(context.evaluationEntries.map(entry => entry.code))
      .not.toContain(rear.code);
  });

  test('keeps a laterally settled selected attack committed', () => {
    const attacker = activeEntry('ATTACKER', 100);
    const defender = activeEntry('DEFENDER', 120);
    attacker.latNow = -2.2;
    const value = session([attacker, defender]);
    const claims = new Map([
      [
        attacker.code,
        publication(attacker, defender.code, attacker.latNow)
      ],
      [
        defender.code,
        {
          ...publication(defender, '', defender.latNow),
          mode: 'direct-ideal' as const,
          targetCode: null
        }
      ]
    ]);

    expect(buildRacecraftPlanningContext(
      value,
      defender,
      value.entries as ActiveEntry[],
      claims
    ).committedAttacks).toMatchObject([{
      attackerCode: attacker.code,
      side: -1,
      sideClear: true
    }]);
  });

  test('labels only a selected cover or its continuation as defense', () => {
    const attacker = activeEntry('ATTACKER', 100);
    const defender = activeEntry('DEFENDER', 120);
    const value = session([attacker, defender]);
    const attackerPublication = publication(
      attacker,
      defender.code,
      defender.latNow - 2
    );
    const defenderPublication = {
      ...publication(defender, '', defender.latNow),
      mode: 'direct-ideal' as const,
      targetCode: null
    };
    const claims = new Map([
      [attacker.code, attackerPublication],
      [defender.code, defenderPublication]
    ]);
    let context = buildRacecraftPlanningContext(
      value,
      defender,
      value.entries as ActiveEntry[],
      claims
    );

    expect(selectedCommittedDefenseView(
      defender,
      context,
      sideDecision(defender.latNow - 1)
    )?.attackerCode).toBe(attacker.code);
    expect(selectedCommittedDefenseView(
      defender,
      context,
      sideDecision(defender.latNow + 1)
    )).toBeNull();

    claims.set(defender.code, {
      ...defenderPublication,
      mode: 'defense',
      targetCode: attacker.code,
      selectedFamilyNumericId: 77
    });
    context = buildRacecraftPlanningContext(
      value,
      defender,
      value.entries as ActiveEntry[],
      claims
    );
    expect(selectedCommittedDefenseView(
      defender,
      context,
      sideDecision(defender.latNow, 77)
    )?.attackerCode).toBe(attacker.code);
  });

  test('exposes a defense to the attacker only on its next assigned slot', () => {
    const attacker = activeEntry('ATTACKER', 100);
    const defender = activeEntry('DEFENDER', 120);
    const value = session([attacker, defender]);
    const attackerPublication = publication(
      attacker,
      defender.code,
      defender.latNow - 2
    );
    const initialDefenderPublication = {
      ...publication(defender, '', defender.latNow),
      mode: 'direct-ideal' as const,
      targetCode: null
    };
    const claims = new Map([
      [attacker.code, attackerPublication],
      [defender.code, initialDefenderPublication]
    ]);
    const attackerDecision = Object.freeze({
      at: value.t,
      selectedKind: 'corner-inside'
    }) as RacecraftDecision;
    attacker.racecraftDecision = attackerDecision;
    const defenderEpoch = racecraftDecisionSlotForCode(
      defender.code
    );
    expect(racecraftDecisionSlotIsDue(
      defenderEpoch,
      defender
    )).toBe(true);
    expect(racecraftDecisionSlotIsDue(
      defenderEpoch,
      attacker
    )).toBe(false);
    expect(buildRacecraftPlanningContext(
      value,
      defender,
      value.entries as ActiveEntry[],
      claims
    ).committedAttacks).toHaveLength(1);

    const defenderPublication = Object.freeze({
      ...initialDefenderPublication,
      publicationRevision:
        initialDefenderPublication.publicationRevision + 1,
      mode: 'defense' as const,
      targetCode: attacker.code,
      selectedFamilyNumericId: 77
    });
    claims.set(defender.code, defenderPublication);
    expect(attacker.racecraftDecision).toBe(attackerDecision);
    expect(claims.get(attacker.code)).toBe(attackerPublication);

    const nextAttackerEpoch = Array.from(
      { length: RACECRAFT_DIRECTIONAL_SLOT_COUNT },
      (_, offset) => defenderEpoch + 1 + offset
    ).find(epoch => racecraftDecisionSlotIsDue(
      epoch,
      attacker
    ))!;
    expect(nextAttackerEpoch).toBeGreaterThan(defenderEpoch);
    const attackerContext = buildRacecraftPlanningContext(
      value,
      attacker,
      value.entries as ActiveEntry[],
      claims
    );
    expect(attackerContext.publications.get(defender.code))
      .toBe(defenderPublication);
    expect(attackerContext.forwardEntries.map(entry => entry.code))
      .toContain(defender.code);
    expect(attacker.racecraftDecision).toBe(attackerDecision);
  });
});
