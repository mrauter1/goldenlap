import { describe, expect, test } from 'bun:test';
import type {
  RacecraftDecisionLogCandidate,
  RacecraftDecisionLogEntry
} from '../../../src/session/model';
import type { HeadlessRaceSummary } from '../../../tools/lib/headless-sim';
import {
  insideLungeOnsets,
  longestStraightCorners,
  objectiveAttribution,
  summarizePbeProbe
} from '../../../tools/racecraft-battle-economics-check';

function candidate(
  kind: RacecraftDecisionLogCandidate['kind'],
  cost: number,
  components: Partial<RacecraftDecisionLogCandidate> = {}
): RacecraftDecisionLogCandidate {
  return {
    kind,
    planNumericId: 1,
    familyNumericId: 1,
    planKey: `plan:${kind}`,
    stableFamilyId: `family:${kind}`,
    feasible: true,
    vetoes: [],
    direction: 'hold',
    speedClass: 'free',
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
    cost,
    ...components
  };
}

function decision(
  at: number,
  code: string,
  selectedKind: RacecraftDecisionLogEntry['selectedKind'],
  selectedPlanKey: string | null,
  candidates: RacecraftDecisionLogCandidate[]
): RacecraftDecisionLogEntry {
  return {
    at,
    code,
    laneProgramReason: 'test',
    laneProgramBinding: null,
    selectedKind,
    selectedPlanNumericId: selectedPlanKey == null ? null : 1,
    selectedPlanKey,
    economics: [],
    candidates
  };
}

const selectedJ = {
  samples: 3,
  droppedSamples: 0,
  ownTimeSeconds: 0.1,
  billSeconds: 0.2,
  proximitySeconds: 0.4,
  positionValueSeconds: 0.5,
  attemptLossSeconds: 0.6,
  battleSpendSeconds: 0.7,
  effortRiskSeconds: 0.8,
  tieBandSeconds: 0.9,
  totalSeconds: 1,
  hazardCount: 1
};

function summary(
  options: {
    grid?: 'pack' | 'clean';
    log?: RacecraftDecisionLogEntry[];
  } = {}
): HeadlessRaceSummary {
  const pack = options.grid !== 'clean';
  return {
    reason: 'complete',
    simulatedSeconds: pack ? 150 : 140,
    checksum: pack ? 'pack' : 'clean',
    laps: 2,
    exposure: {
      carKilometres: pack ? 100 : 5
    },
    metrics: {
      contacts: pack ? 24 : 0,
      contactEpisodes: pack ? 5 : 0,
      attackInitiations: pack ? 8 : 0,
      attackCompletions: pack ? 3 : 0,
      attackPaceOutcomeSamples: pack ? 8 : 0,
      attackCompletionPaceDifferentialCorrelation: pack ? 0.4 : null,
      agreementDaylightSamples: pack ? 12 : 0,
      agreementDaylightMeanMetres: pack ? 0.3 : null,
      agreementDaylightMinimumMetres: pack ? 0.2 : null,
      maximumCandidates: pack ? 6 : 1,
      pathsMaterialized: 0
    },
    diagnostics: {
      racecraftSelectedJ: selectedJ
    },
    racecraftDecisionLog: options.log ?? [],
    strategyResults: [{
      entryIndex: 0,
      code: 'AAA',
      finishPosition: 1,
      finishTime: pack ? 142 : 138,
      stops: 0,
      finalCompound: 'S'
    }]
  } as unknown as HeadlessRaceSummary;
}

const track = {
  n: 100,
  len: 200,
  step: 2,
  corners: [
    { id: 'c1', apexI: 10, brakeI: 5, trackOutI: 15 },
    { id: 'c2', apexI: 45, brakeI: 40, trackOutI: 50 },
    { id: 'c3', apexI: 80, brakeI: 75, trackOutI: 85 }
  ]
};

describe('P-BE phase probe observer', () => {
  test('ranks physical track-out to brake spans without a clearance key', () => {
    expect(longestStraightCorners(track)).toEqual([
      { cornerId: 'c2', straightLengthMetres: 50 },
      { cornerId: 'c3', straightLengthMetres: 50 }
    ]);
  });

  test('counts inside-family onsets instead of repeated decision records', () => {
    const log = [
      decision(
        0,
        'AAA',
        'corner-inside',
        'cost:AAA:corner-inside:line:c2:10',
        []
      ),
      decision(
        0.1,
        'AAA',
        'corner-inside',
        'cost:AAA:corner-inside:line:c2:10',
        []
      ),
      decision(0.2, 'AAA', 'hold', 'cost:AAA:hold:12', []),
      decision(
        0.3,
        'AAA',
        'corner-inside',
        'cost:AAA:corner-inside:line:c2:20',
        []
      )
    ];
    expect(insideLungeOnsets(log, [{
      cornerId: 'c2',
      straightLengthMetres: 50
    }])).toEqual([{
      cornerId: 'c2',
      straightLengthMetres: 50,
      insideLungeOnsets: 2
    }]);
  });

  test('attributes only strict counterfactual argmin changes', () => {
    const log = [
      decision(0, 'AAA', 'corner-inside', 'attack', [
        candidate('corner-inside', 1, { planKey: 'attack' }),
        candidate('hold', 1.2, {
          positionValueSeconds: 0.4
        })
      ]),
      decision(0.1, 'BBB', 'hold', 'hold', [
        candidate('hold', 1, { planKey: 'hold' }),
        candidate('corner-outside', 1.1, {
          battleSpendSeconds: 0.3,
          proximitySeconds: 0.2
        })
      ]),
      decision(0.2, 'CCC', 'hold', 'held-by-tie-band', [
        candidate('hold', 1.2, {
          planKey: 'held-by-tie-band',
          positionValueSeconds: 0.4
        }),
        candidate('corner-inside', 1)
      ])
    ];
    const result = objectiveAttribution(summary({ log }));
    expect(result.selectedSamples).toBe(3);
    expect(result.nonArgminSelectedSamples).toBe(1);
    expect(result.selectionsMadeDecisiveBy).toEqual({
      positionValue: 1,
      battleSpend: 1,
      proximity: 1
    });
    expect(result.selectedSamplesCarrying).toEqual({
      positionValue: 1,
      battleSpend: 0,
      proximity: 0
    });
  });

  test('reports all observable evidence and names unavailable joins', () => {
    const log = [
      decision(
        0,
        'AAA',
        'corner-inside',
        'cost:AAA:corner-inside:line:c2:10',
        [candidate('corner-inside', 1, {
          planKey: 'cost:AAA:corner-inside:line:c2:10',
          minimumPlannedClearanceMetres: 0.3
        })]
      )
    ];
    const output = summarizePbeProbe(
      summary({ log }),
      summary({ grid: 'clean' }),
      track
    );
    expect(output.packVsCleanAirLeader).toMatchObject({
      status: 'observed',
      value: {
        comparatorCode: 'AAA',
        packFinishPosition: 1,
        packRaceAverageSecondsPerLap: 71,
        cleanAirRaceAverageSecondsPerLap: 69,
        deficitSecondsPerLap: 2,
        comparatorWasPackWinner: true
      }
    });
    expect(output.contact).toMatchObject({
      collisionSolverContactSteps: 24,
      contactStepsPerRaceLap: 12,
      touchEpisodesPerRaceLap: {
        status: 'observed',
        value: 2.5
      },
      agreementDaylightMetres: {
        status: 'observed',
        value: {
          samples: 12,
          mean: 0.3,
          minimum: 0.2
        }
      }
    });
    expect(output.attacks).toMatchObject({
      initiated: 8,
      completed: 3,
      initiatedPerRaceLap: 4,
      completionRate: 0.375,
      completionPaceDifferentialCorrelation: {
        status: 'observed',
        value: 0.4
      }
    });
    expect(output.insideLungesAfterLongestStraights).toHaveLength(2);
    expect(output.budgets).toEqual({
      maximumCandidates: 6,
      maximumMaterializations: 0
    });
    expect(output.observabilityBlockers).toEqual([]);
  });
});
