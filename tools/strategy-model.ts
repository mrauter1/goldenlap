import { PHYS } from '../src/core/physics';
import type { BuiltTrack } from '../src/core/model';
import type { TyreCompound } from '../src/session/model';
import {
  PACE_FUEL,
  PACE_MARGIN,
  PACE_RISK,
  PACE_WEAR,
  RACE_PACE_F,
  STRATEGY_BALANCE_DEFAULTS,
  strategyBalance,
  tyreGrip,
  tyreLifeLaps,
  type StrategyBalance
} from '../src/session/strategy';
import { raceLapsFor } from '../src/game/weekend';
import { prepareHeadlessTrack } from './lib/headless-sim';

export interface StrategySchedule {
  compounds: TyreCompound[];
  stintLaps: number[];
  stops: number;
  freshCompoundSeconds: number;
  wearSeconds: number;
  pitSeconds: number;
  totalDeficitSeconds: number;
}

export interface PaceModeEstimate {
  mode: 'save' | 'race' | 'push';
  freeShare: number;
  paceSecondsPerLap: number;
  wearMultiplier: number;
  fuelMultiplier: number;
  riskMultiplier: number;
  expectedSecondsPerRace: number;
}

export interface TrackStrategyModel {
  trackId: string;
  trackName: string;
  laps: number;
  trackLengthMetres: number;
  referenceLapSeconds: number;
  raceLapSeconds: number;
  pitLossSeconds: number;
  bestSoft: StrategySchedule;
  bestHard: StrategySchedule;
  bestMixed: StrategySchedule;
  pureDeltaSeconds: number;
  mixedDeltaSeconds: number;
  stopDifference: number;
  undercutGainSeconds: number;
  wetCrossover: number;
  paceModes: PaceModeEstimate[];
  traitEV: Record<string, { secondsPerRace: number; cashPerRace: number }>;
  upgradeSensitivity: {
    cornerTimeShare: number;
    engineSecondsPerLevel: number;
    chassisSecondsPerLevel: number;
    handlingSecondsPerLevel: number;
    secondsPerNineThousand: Record<'engine' | 'chassis' | 'handling', number>;
  };
  targets: {
    pureParity: boolean;
    mixedViable: boolean;
    distinctStops: boolean;
    undercut: boolean;
    wetCrossover: boolean;
    paceModesVisible: boolean;
  };
}

export interface StrategyModelReport {
  schemaVersion: 1;
  balance: Readonly<StrategyBalance>;
  objective: number;
  objectiveComponents: Record<string, number>;
  tracks: TrackStrategyModel[];
}

const MAXIMUM_STOPS = 4;
const MAXIMUM_SCHEDULE_WEAR = 1.05;

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function stintLengths(laps: number, stints: number): number[] {
  const base = Math.floor(laps / stints);
  const longer = laps % stints;
  return Array.from({ length: stints }, (_value, index) => base + (index < longer ? 1 : 0));
}

function lapSecondsAtWear(
  compound: TyreCompound,
  wear: number,
  raceLapSeconds: number,
  wet = 0
): number {
  const referenceGrip = strategyBalance().softFreshGrip;
  const grip = tyreGrip({ c: compound, wear, fit: 0 }, wet);
  return raceLapSeconds * Math.sqrt(referenceGrip / Math.max(0.1, grip));
}

function scheduleFor(
  compounds: TyreCompound[],
  laps: number,
  raceLapSeconds: number,
  pitLossSeconds: number,
  wet = 0
): StrategySchedule | null {
  const lengths = stintLengths(laps, compounds.length);
  let freshCompoundSeconds = 0;
  let wearSeconds = 0;
  for (let stint = 0; stint < compounds.length; stint++) {
    const compound = compounds[stint]!;
    const length = lengths[stint]!;
    const life = tyreLifeLaps(compound, laps, wet);
    if (length / life > MAXIMUM_SCHEDULE_WEAR) return null;
    const freshLap = lapSecondsAtWear(compound, 0, raceLapSeconds, wet);
    freshCompoundSeconds += (freshLap - raceLapSeconds) * length;
    for (let lap = 0; lap < length; lap++) {
      const wear = (lap + 0.5) / life;
      wearSeconds += lapSecondsAtWear(compound, wear, raceLapSeconds, wet) - freshLap;
    }
  }
  const stops = compounds.length - 1;
  const pitSeconds = stops * pitLossSeconds;
  return {
    compounds,
    stintLaps: lengths,
    stops,
    freshCompoundSeconds: round(freshCompoundSeconds),
    wearSeconds: round(wearSeconds),
    pitSeconds: round(pitSeconds),
    totalDeficitSeconds: round(freshCompoundSeconds + wearSeconds + pitSeconds)
  };
}

function bestPureSchedule(
  compound: 'S' | 'H',
  laps: number,
  raceLapSeconds: number,
  pitLossSeconds: number
): StrategySchedule {
  const schedules: StrategySchedule[] = [];
  for (let stops = 0; stops <= MAXIMUM_STOPS; stops++) {
    const schedule = scheduleFor(
      Array.from({ length: stops + 1 }, () => compound),
      laps,
      raceLapSeconds,
      pitLossSeconds
    );
    if (schedule) schedules.push(schedule);
  }
  const best = schedules.sort((left, right) =>
    left.totalDeficitSeconds - right.totalDeficitSeconds || left.stops - right.stops)[0];
  if (!best) throw new Error(`No feasible ${compound} schedule for ${laps} laps`);
  return best;
}

function bestMixedSchedule(
  laps: number,
  raceLapSeconds: number,
  pitLossSeconds: number
): StrategySchedule {
  const schedules: StrategySchedule[] = [];
  for (let stops = 1; stops <= MAXIMUM_STOPS; stops++) {
    const stints = stops + 1;
    for (let mask = 1; mask < (1 << stints) - 1; mask++) {
      const compounds = Array.from({ length: stints }, (_value, index) =>
        (mask & (1 << index)) ? 'S' as const : 'H' as const);
      const schedule = scheduleFor(compounds, laps, raceLapSeconds, pitLossSeconds);
      if (schedule) schedules.push(schedule);
    }
  }
  const best = schedules.sort((left, right) =>
    left.totalDeficitSeconds - right.totalDeficitSeconds || left.stops - right.stops)[0];
  if (!best) throw new Error(`No feasible mixed schedule for ${laps} laps`);
  return best;
}

function pitLoss(track: BuiltTrack, raceLapSeconds: number): number {
  const raceSpeed = track.tr.len / raceLapSeconds;
  const pit = track.tr.pit;
  return pit.Lp / pit.limit + 7 + 2.5 - pit.Lp / raceSpeed;
}

function undercutGain(laps: number, raceLapSeconds: number): number {
  const life = tyreLifeLaps('S', laps, 0);
  const oldWear = Math.min(0.9, Math.max(0.55, 0.78 + 2 / life));
  const fresh = lapSecondsAtWear('S', 0, raceLapSeconds);
  const old = lapSecondsAtWear('S', oldWear, raceLapSeconds);
  return (old - fresh) * 2;
}

function wetCrossover(): number {
  let bestWet = 0;
  let bestDelta = Infinity;
  for (let index = 0; index <= 1000; index++) {
    const wet = index / 1000;
    const slick = tyreGrip({ c: 'S', wear: 0, fit: 0 }, wet);
    const wetGrip = tyreGrip({ c: 'W', wear: 0, fit: 0 }, wet);
    const delta = Math.abs(slick - wetGrip);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestWet = wet;
    }
  }
  return bestWet;
}

function paceModeEstimates(laps: number, raceLapSeconds: number): PaceModeEstimate[] {
  const names = ['save', 'race', 'push'] as const;
  const shares = [1, 0.5, 0];
  const estimates: PaceModeEstimate[] = [];
  for (const freeShare of shares) {
    for (let mode = 0; mode < names.length; mode++) {
      const paceSecondsPerLap = -raceLapSeconds * PACE_MARGIN[mode]! / 0.95 * freeShare;
      const wearCost = raceLapSeconds * 0.018 * (PACE_WEAR[mode]! - 1);
      estimates.push({
        mode: names[mode]!,
        freeShare,
        paceSecondsPerLap: round(paceSecondsPerLap),
        wearMultiplier: PACE_WEAR[mode]!,
        fuelMultiplier: PACE_FUEL[mode]!,
        riskMultiplier: PACE_RISK[mode]!,
        expectedSecondsPerRace: round((paceSecondsPerLap + wearCost) * laps)
      });
    }
  }
  return estimates;
}

function cornerTimeShare(track: BuiltTrack): number {
  let total = 0;
  let corner = 0;
  for (let index = 0; index < track.tr.n; index++) {
    const seconds = track.tr.step / Math.max(1, track.tr.idealPath.v[index]!);
    total += seconds;
    const lateralAcceleration = track.tr.idealPath.v[index]! ** 2 *
      Math.abs(track.tr.idealPath.k[index]!);
    if (lateralAcceleration > PHYS.g * 0.18) corner += seconds;
  }
  return Math.max(0.15, Math.min(0.85, corner / Math.max(1e-9, total)));
}

function upgradeSensitivity(track: BuiltTrack, raceLapSeconds: number) {
  const cornerShare = cornerTimeShare(track);
  const straightShare = 1 - cornerShare;
  const engine = raceLapSeconds * straightShare * (Math.pow(1.028, -1 / 3) - 1);
  const chassis = raceLapSeconds * straightShare * (Math.pow(0.955, 1 / 3) - 1);
  const handling = raceLapSeconds * cornerShare * (1 / Math.sqrt(1.01) - 1);
  return {
    cornerTimeShare: round(cornerShare),
    engineSecondsPerLevel: round(engine),
    chassisSecondsPerLevel: round(chassis),
    handlingSecondsPerLevel: round(handling),
    secondsPerNineThousand: {
      engine: round(-engine),
      chassis: round(-chassis),
      handling: round(-handling)
    }
  };
}

export function modelTrackStrategy(track: BuiltTrack): TrackStrategyModel {
  const laps = raceLapsFor(track.prof);
  const raceLapSeconds = track.prof.lapTime * RACE_PACE_F;
  const pitLossSeconds = pitLoss(track, raceLapSeconds);
  const bestSoft = bestPureSchedule('S', laps, raceLapSeconds, pitLossSeconds);
  const bestHard = bestPureSchedule('H', laps, raceLapSeconds, pitLossSeconds);
  const bestMixed = bestMixedSchedule(laps, raceLapSeconds, pitLossSeconds);
  const bestPure = Math.min(bestSoft.totalDeficitSeconds, bestHard.totalDeficitSeconds);
  const pureDeltaSeconds = bestSoft.totalDeficitSeconds - bestHard.totalDeficitSeconds;
  const mixedDeltaSeconds = bestMixed.totalDeficitSeconds - bestPure;
  const stopDifference = bestSoft.stops - bestHard.stops;
  const undercutGainSeconds = undercutGain(laps, raceLapSeconds);
  const paceModes = paceModeEstimates(laps, raceLapSeconds);
  const cleanSave = paceModes.find(item => item.freeShare === 1 && item.mode === 'save')!;
  const cleanPush = paceModes.find(item => item.freeShare === 1 && item.mode === 'push')!;
  const modeGap = cleanSave.paceSecondsPerLap - cleanPush.paceSecondsPerLap;
  const crossover = wetCrossover();
  return {
    trackId: track.def.id,
    trackName: track.def.name,
    laps,
    trackLengthMetres: round(track.tr.len),
    referenceLapSeconds: round(track.prof.lapTime),
    raceLapSeconds: round(raceLapSeconds),
    pitLossSeconds: round(pitLossSeconds),
    bestSoft,
    bestHard,
    bestMixed,
    pureDeltaSeconds: round(pureDeltaSeconds),
    mixedDeltaSeconds: round(mixedDeltaSeconds),
    stopDifference,
    undercutGainSeconds: round(undercutGainSeconds),
    wetCrossover: round(crossover),
    paceModes,
    traitEV: {
      tyre: { secondsPerRace: round(-pitLossSeconds * 0.5), cashPerRace: 0 },
      rain: { secondsPerRace: round(-raceLapSeconds * laps * 0.0025), cashPerRace: 0 },
      pay: { secondsPerRace: 0, cashPerRace: 5000 },
      wild: { secondsPerRace: round(raceLapSeconds * 0.00125), cashPerRace: 0 },
      hot: { secondsPerRace: round(-raceLapSeconds * laps * 0.0008), cashPerRace: 0 },
      metro: { secondsPerRace: round(-raceLapSeconds * laps * 0.0004), cashPerRace: 0 },
      fear: { secondsPerRace: round(raceLapSeconds * laps * 0.0005), cashPerRace: 0 }
    },
    upgradeSensitivity: upgradeSensitivity(track, raceLapSeconds),
    targets: {
      pureParity: Math.abs(pureDeltaSeconds) <= 4,
      mixedViable: mixedDeltaSeconds <= 3,
      distinctStops: stopDifference === 1,
      undercut: undercutGainSeconds >= 2 && undercutGainSeconds <= 5,
      wetCrossover: crossover >= 0.23 && crossover <= 0.33,
      paceModesVisible: modeGap >= 1.5
    }
  };
}

function distanceToBand(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return minimum - value;
  if (value > maximum) return value - maximum;
  return 0;
}

export function strategyObjective(tracks: readonly TrackStrategyModel[]): {
  total: number;
  components: Record<string, number>;
} {
  const components = {
    pureParity: 0,
    mixedViability: 0,
    stopTexture: 0,
    undercut: 0,
    wetCrossover: 0,
    paceVisibility: 0
  };
  for (const track of tracks) {
    components.pureParity += distanceToBand(track.pureDeltaSeconds, -4, 4) ** 2;
    components.mixedViability += Math.max(0, track.mixedDeltaSeconds - 3) ** 2;
    components.stopTexture += Math.abs(track.stopDifference - 1) ** 2 * 16;
    components.undercut += distanceToBand(track.undercutGainSeconds, 2, 5) ** 2;
    components.wetCrossover += distanceToBand(track.wetCrossover, 0.23, 0.33) ** 2 * 100;
    const cleanSave = track.paceModes.find(item => item.freeShare === 1 && item.mode === 'save')!;
    const cleanPush = track.paceModes.find(item => item.freeShare === 1 && item.mode === 'push')!;
    components.paceVisibility += Math.max(
      0, 1.5 - (cleanSave.paceSecondsPerLap - cleanPush.paceSecondsPerLap)
    ) ** 2;
  }
  return {
    total: round(Object.values(components).reduce((sum, value) => sum + value, 0)),
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [key, round(value)])
    )
  };
}

export function runStrategyModel(trackIds?: readonly string[]): StrategyModelReport {
  const ids = trackIds?.length
    ? [...trackIds]
    : ['prado', 'costa', 'nordwald', 'villa', 'anhembi', 'cerro'];
  const tracks = ids.map(trackId => modelTrackStrategy(prepareHeadlessTrack(trackId)));
  const objective = strategyObjective(tracks);
  return {
    schemaVersion: 1,
    balance: { ...strategyBalance() },
    objective: objective.total,
    objectiveComponents: objective.components,
    tracks
  };
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function main(): void {
  try {
    const rawTracks = argument('--tracks') ?? argument('--track');
    const report = runStrategyModel(rawTracks?.split(',').filter(Boolean));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.main) main();

export { STRATEGY_BALANCE_DEFAULTS };
