import type {
  RacecraftDecisionLogCandidate,
  RacecraftDecisionLogEntry
} from '../src/session/model';
import {
  prepareHeadlessTrack,
  runHeadlessRace,
  type HeadlessRaceSummary
} from './lib/headless-sim';

export const PBE_PROBE_SEED = 101;
export const PBE_PROBE_STEP_SECONDS = 1 / 120;
/**
 * One opening lap plus one steady-state lap exercises both Prado long
 * straights twice while keeping the bounded decision log below its capacity.
 */
export const PBE_PROBE_LAPS = 2;

interface Observed<T> {
  status: 'observed';
  value: T;
}

interface Unobservable {
  status: 'unobservable';
  value: null;
  reason: string;
}

export type ProbeObservation<T> = Observed<T> | Unobservable;

export interface LongStraightCorner {
  cornerId: string;
  straightLengthMetres: number;
}

export interface LungeObservation extends LongStraightCorner {
  insideLungeOnsets: number;
}

export interface ObjectiveAttribution {
  selectedMeans: HeadlessRaceSummary['diagnostics']['racecraftSelectedJ'];
  selectedSamples: number;
  nonArgminSelectedSamples: number;
  selectionsMadeDecisiveBy: {
    positionValue: number;
    battleSpend: number;
    proximity: number;
  };
  selectedSamplesCarrying: {
    positionValue: number;
    battleSpend: number;
    proximity: number;
  };
}

export interface PbeProbeOutput {
  schemaVersion: 1;
  probe: 'p-be-battle-economics';
  trackId: 'prado';
  seed: number;
  stepSeconds: number;
  laps: number;
  runs: {
    pack: {
      reason: HeadlessRaceSummary['reason'];
      checksum: string;
      simulatedSeconds: number;
    };
    cleanAir: {
      reason: HeadlessRaceSummary['reason'];
      checksum: string;
      simulatedSeconds: number;
    };
  };
  packVsCleanAirLeader: ProbeObservation<{
    comparatorCode: string;
    packFinishPosition: number;
    packRaceAverageSecondsPerLap: number;
    cleanAirRaceAverageSecondsPerLap: number;
    deficitSecondsPerLap: number;
    /**
     * The designated comparator is the pack leader only when it wins. The
     * numeric comparison remains useful when it does not, but is not silently
     * relabelled as leader evidence.
     */
    comparatorWasPackWinner: boolean;
  }>;
  contact: {
    collisionSolverContactSteps: number;
    contactStepsPerRaceLap: number;
    contactStepsPerCarLapExposure: number;
    touchEpisodesPerRaceLap: ProbeObservation<number>;
    agreementDaylightMetres: ProbeObservation<{
      samples: number;
      mean: number;
      minimum: number;
    }>;
  };
  grassAttribution: {
    emergencyAuthorizedCarSeconds: number;
    nonEmergencyCarSeconds: number;
    nonEmergencyByAuthority:
      HeadlessRaceSummary['exposure']['nonEmergencyGrassCarSecondsByAuthority'];
  };
  attacks: {
    initiated: number;
    completed: number;
    initiatedPerRaceLap: number;
    completionRate: number;
    completionPaceDifferentialCorrelation:
      ProbeObservation<number>;
  };
  insideLungesAfterLongestStraights: LungeObservation[];
  budgets: {
    maximumCandidates: number;
    maximumMaterializations: number;
  };
  objectiveAttribution: ObjectiveAttribution;
  observabilityBlockers: Array<{
    metric: string;
    reason: string;
  }>;
}

interface TrackForStraightRanking {
  n: number;
  len: number;
  step: number;
  corners: readonly {
    id: string;
    apexI: number;
    brakeI: number;
    trackOutI: number;
  }[];
}

function round(value: number): number {
  return Number.isFinite(value)
    ? Math.round(value * 1e9) / 1e9
    : value;
}

function observed<T>(value: T): Observed<T> {
  return { status: 'observed', value };
}

function unobservable(reason: string): Unobservable {
  return {
    status: 'unobservable',
    value: null,
    reason
  };
}

/**
 * A straight is the normal-surface span from one corner's track-out to the
 * next corner's brake marker. Wrapped spans longer than half a lap are
 * overlapping descriptors inside a complex, not straights.
 */
export function longestStraightCorners(
  track: TrackForStraightRanking,
  count = 2
): LongStraightCorner[] {
  if (!Number.isInteger(count) || count < 0)
    throw new RangeError('count must be a non-negative integer');
  const ordered = [...track.corners].sort((left, right) =>
    left.apexI - right.apexI || left.id.localeCompare(right.id));
  return ordered
    .flatMap((corner, index) => {
      const previous = ordered[
        (index - 1 + ordered.length) % ordered.length
      ];
      if (!previous) return [];
      const samples = (
        corner.brakeI - previous.trackOutI + track.n
      ) % track.n;
      const distance = samples * track.step;
      return distance > 0 && distance < track.len / 2
        ? [{
            cornerId: corner.id,
            straightLengthMetres: round(distance)
          }]
        : [];
    })
    .sort((left, right) =>
      right.straightLengthMetres - left.straightLengthMetres ||
      left.cornerId.localeCompare(right.cornerId))
    .slice(0, count);
}

function planKeyContainsCorner(
  planKey: string | null,
  cornerId: string
): boolean {
  return planKey?.split(':').includes(cornerId) ?? false;
}

/**
 * Counts transitions into the inside family, not repeated 10 Hz records while
 * one lunge remains selected.
 */
export function insideLungeOnsets(
  log: readonly RacecraftDecisionLogEntry[],
  straights: readonly LongStraightCorner[]
): LungeObservation[] {
  const lastFamilyByCar = new Map<string, string | null>();
  const counts = new Map(straights.map(item => [item.cornerId, 0]));
  for (const record of log) {
    const selectedFamily = record.selectedKind === 'corner-inside'
      ? record.selectedPlanKey
      : null;
    const previous = lastFamilyByCar.get(record.code) ?? null;
    if (selectedFamily !== null && selectedFamily !== previous) {
      for (const straight of straights) {
        if (!planKeyContainsCorner(selectedFamily, straight.cornerId))
          continue;
        counts.set(
          straight.cornerId,
          (counts.get(straight.cornerId) ?? 0) + 1
        );
      }
    }
    lastFamilyByCar.set(record.code, selectedFamily);
  }
  return straights.map(straight => ({
    ...straight,
    insideLungeOnsets: counts.get(straight.cornerId) ?? 0
  }));
}

function selectedCandidate(
  record: RacecraftDecisionLogEntry
): RacecraftDecisionLogCandidate | null {
  if (record.selectedPlanKey == null) return null;
  return record.candidates.find(candidate =>
    candidate.planKey === record.selectedPlanKey &&
    candidate.feasible &&
    Number.isFinite(candidate.cost)) ?? null;
}

function strictlyCheaperAlternative(
  record: RacecraftDecisionLogEntry,
  selected: RacecraftDecisionLogCandidate,
  subtract: (
    candidate: RacecraftDecisionLogCandidate
  ) => number
): boolean {
  const selectedCost = selected.cost - subtract(selected);
  return record.candidates.some(candidate =>
    candidate !== selected &&
    candidate.feasible &&
    Number.isFinite(candidate.cost) &&
    candidate.cost - subtract(candidate) < selectedCost);
}

/**
 * Attribution uses exact logged seconds. A term is decisive only when the
 * selected candidate is an argmin with the full J and removing that term
 * makes another finite candidate strictly cheaper. Ties remain unattributed.
 */
export function objectiveAttribution(
  summary: HeadlessRaceSummary
): ObjectiveAttribution {
  let selectedSamples = 0;
  let nonArgminSelectedSamples = 0;
  let positionValueCarrying = 0;
  let battleSpendCarrying = 0;
  let proximityCarrying = 0;
  let positionValueDecisive = 0;
  let battleSpendDecisive = 0;
  let proximityDecisive = 0;
  for (const record of summary.racecraftDecisionLog ?? []) {
    const selected = selectedCandidate(record);
    if (!selected) continue;
    selectedSamples++;
    if (selected.positionValueSeconds > 0) positionValueCarrying++;
    if (selected.battleSpendSeconds > 0) battleSpendCarrying++;
    if (selected.proximitySeconds > 0) proximityCarrying++;
    const hasCheaperFullCost = record.candidates.some(candidate =>
      candidate !== selected &&
      candidate.feasible &&
      Number.isFinite(candidate.cost) &&
      candidate.cost < selected.cost);
    if (hasCheaperFullCost) {
      nonArgminSelectedSamples++;
      continue;
    }
    if (strictlyCheaperAlternative(
      record,
      selected,
      candidate => candidate.positionValueSeconds
    )) positionValueDecisive++;
    if (strictlyCheaperAlternative(
      record,
      selected,
      candidate => candidate.battleSpendSeconds
    )) battleSpendDecisive++;
    if (strictlyCheaperAlternative(
      record,
      selected,
      candidate => candidate.proximitySeconds
    )) proximityDecisive++;
  }
  return {
    selectedMeans: summary.diagnostics.racecraftSelectedJ,
    selectedSamples,
    nonArgminSelectedSamples,
    selectionsMadeDecisiveBy: {
      positionValue: positionValueDecisive,
      battleSpend: battleSpendDecisive,
      proximity: proximityDecisive
    },
    selectedSamplesCarrying: {
      positionValue: positionValueCarrying,
      battleSpend: battleSpendCarrying,
      proximity: proximityCarrying
    }
  };
}

function designatedComparator(
  summary: HeadlessRaceSummary
): NonNullable<HeadlessRaceSummary['strategyResults']>[number] | null {
  return summary.strategyResults?.find(item => item.entryIndex === 0) ?? null;
}

function leaderComparison(
  pack: HeadlessRaceSummary,
  cleanAir: HeadlessRaceSummary
): PbeProbeOutput['packVsCleanAirLeader'] {
  const packComparator = designatedComparator(pack);
  const cleanComparator = designatedComparator(cleanAir);
  if (!packComparator || !cleanComparator)
    return unobservable(
      'the designated entry finish time was not retained in strategyResults'
    );
  if (pack.reason !== 'complete' || cleanAir.reason !== 'complete' ||
      packComparator.finishTime <= 0 || cleanComparator.finishTime <= 0)
    return unobservable(
      'both the pack and clean-air comparator must finish before a lap deficit exists'
    );
  if (packComparator.code !== cleanComparator.code)
    return unobservable(
      'pack and clean-air runs did not retain the same designated comparator'
    );
  const packAverage = packComparator.finishTime / pack.laps;
  const cleanAverage = cleanComparator.finishTime / cleanAir.laps;
  return observed({
    comparatorCode: packComparator.code,
    packFinishPosition: packComparator.finishPosition,
    packRaceAverageSecondsPerLap: round(packAverage),
    cleanAirRaceAverageSecondsPerLap: round(cleanAverage),
    deficitSecondsPerLap: round(packAverage - cleanAverage),
    comparatorWasPackWinner: packComparator.finishPosition === 1
  });
}

export function summarizePbeProbe(
  pack: HeadlessRaceSummary,
  cleanAir: HeadlessRaceSummary,
  track: TrackForStraightRanking
): PbeProbeOutput {
  const paceCorrelationReason =
    'fewer than two measured attack outcomes, or no outcome variance, prevents a Pearson correlation';
  const carLapExposure = pack.exposure.carKilometres * 1000 / track.len;
  const decisionLog = pack.racecraftDecisionLog ?? [];
  const longStraights = longestStraightCorners(track);
  return {
    schemaVersion: 1,
    probe: 'p-be-battle-economics',
    trackId: 'prado',
    seed: PBE_PROBE_SEED,
    stepSeconds: PBE_PROBE_STEP_SECONDS,
    laps: pack.laps,
    runs: {
      pack: {
        reason: pack.reason,
        checksum: pack.checksum,
        simulatedSeconds: pack.simulatedSeconds
      },
      cleanAir: {
        reason: cleanAir.reason,
        checksum: cleanAir.checksum,
        simulatedSeconds: cleanAir.simulatedSeconds
      }
    },
    packVsCleanAirLeader: leaderComparison(pack, cleanAir),
    contact: {
      // hitN is intentionally named precisely: production increments it on
      // every solver step in contact, not only on contact episode onset.
      collisionSolverContactSteps: pack.metrics.contacts,
      contactStepsPerRaceLap: round(
        pack.metrics.contacts / Math.max(1, pack.laps)
      ),
      contactStepsPerCarLapExposure: round(
        pack.metrics.contacts / Math.max(Number.EPSILON, carLapExposure)
      ),
      touchEpisodesPerRaceLap: observed(round(
        pack.metrics.contactEpisodes / Math.max(1, pack.laps)
      )),
      agreementDaylightMetres:
        pack.metrics.agreementDaylightMeanMetres == null ||
        pack.metrics.agreementDaylightMinimumMetres == null
          ? unobservable(
              'no live longitudinal-overlap agreement sample was observed'
            )
          : observed({
              samples: pack.metrics.agreementDaylightSamples,
              mean: pack.metrics.agreementDaylightMeanMetres,
              minimum: pack.metrics.agreementDaylightMinimumMetres
            })
    },
    grassAttribution: {
      emergencyAuthorizedCarSeconds:
        pack.exposure.emergencyAuthorizedGrassCarSeconds,
      nonEmergencyCarSeconds:
        pack.exposure.nonEmergencyGrassCarSeconds,
      nonEmergencyByAuthority:
        pack.exposure.nonEmergencyGrassCarSecondsByAuthority
    },
    attacks: {
      initiated: pack.metrics.attackInitiations,
      completed: pack.metrics.attackCompletions,
      initiatedPerRaceLap: round(
        pack.metrics.attackInitiations / Math.max(1, pack.laps)
      ),
      completionRate: round(
        pack.metrics.attackCompletions /
          Math.max(1, pack.metrics.attackInitiations)
      ),
      completionPaceDifferentialCorrelation:
        pack.metrics.attackCompletionPaceDifferentialCorrelation == null
          ? unobservable(paceCorrelationReason)
          : observed(round(
              pack.metrics.attackCompletionPaceDifferentialCorrelation
            ))
    },
    insideLungesAfterLongestStraights:
      insideLungeOnsets(decisionLog, longStraights),
    budgets: {
      maximumCandidates: pack.metrics.maximumCandidates,
      maximumMaterializations: pack.metrics.pathsMaterialized
    },
    objectiveAttribution: objectiveAttribution(pack),
    observabilityBlockers: [
      ...(pack.metrics.attackCompletionPaceDifferentialCorrelation == null
        ? [{
        metric: 'completion correlation with measured pace differential',
        reason: paceCorrelationReason
          }]
        : [])
    ]
  };
}

export function runPbePhaseProbe(): PbeProbeOutput {
  const built = prepareHeadlessTrack('prado');
  const comparatorStrategy = [{
    entryIndex: 0,
    compounds: ['S'] as const,
    boxLaps: [] as const
  }];
  const pack = runHeadlessRace(built, {
    seed: PBE_PROBE_SEED,
    step: PBE_PROBE_STEP_SECONDS,
    laps: PBE_PROBE_LAPS,
    wet: 0,
    includeRacecraftDecisionLog: true,
    forcedStrategies: comparatorStrategy
  });
  const cleanAir = runHeadlessRace(built, {
    seed: PBE_PROBE_SEED,
    step: PBE_PROBE_STEP_SECONDS,
    laps: PBE_PROBE_LAPS,
    wet: 0,
    gridSize: 1,
    forcedStrategies: comparatorStrategy
  });
  return summarizePbeProbe(pack, cleanAir, built.tr);
}

if (import.meta.main)
  console.log(JSON.stringify(runPbePhaseProbe(), null, 2));
