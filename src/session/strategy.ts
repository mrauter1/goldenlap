import { clamp } from '../shared/math';
import { random } from '../shared/rng';
import type { CarModifiers, Track } from '../core/model';
import { compactLateralGeometryAtProgress } from
  '../core/lateral-program';
import { availableDeceleration } from '../core/physics';
import type {
  Entry, PaceMode, RaceSession, Session, TyreCompound, TyreState
} from './model';
import { racecraftCalibration } from './racecraft/config';

export const H_STEP = 1 / 120;
export const TRAF_DT = 1 / 30;
export const LIFT_MARGIN_PENALTY = 0.045;
export const START_BLEND_END = 16;
export const PACE_MARGIN: readonly [number, number, number] = [-0.016, 0, 0.013];
export const PACE_WEAR: readonly [number, number, number] = [0.7, 1, 1.42];
export const PACE_FUEL: readonly [number, number, number] = [0.82, 1, 1.3];
export const PACE_RISK: readonly [number, number, number] = [0.55, 1, 2.0];
export const QUALI_LEN = 1800;
export const RACE_TARGET = 3600;
export const RACE_PACE_F = 1.10;
export const REF_LAPS = 12;
export const FLOW_ZONES = 14;
export const GENERATED_FLOW_ZONE_METRES = 300;
const AERO_FAILURE_SEVERITY = 0.18;

export interface StrategyBalance {
  softFreshGrip: number;
  hardFreshGrip: number;
  wetFreshGrip: number;
  softWearCoefficient: number;
  hardWearCoefficient: number;
  wetWearCoefficient: number;
  wearExponent: number;
  softLifeFraction: number;
  hardLifeFraction: number;
  wetLifeFractionDry: number;
  wetLifeFractionWet: number;
}

export interface StrategyBalanceDefinition {
  key: keyof StrategyBalance;
  unit: 'fraction' | 'exponent';
  minimum: number;
  maximum: number;
  rationale: string;
  owner: string;
}

export const STRATEGY_BALANCE_DEFAULTS: Readonly<StrategyBalance> = Object.freeze({
  softFreshGrip: 1,
  hardFreshGrip: 0.976,
  wetFreshGrip: 0.915,
  softWearCoefficient: 0.10,
  hardWearCoefficient: 0.05,
  wetWearCoefficient: 0.06,
  wearExponent: 1.7,
  softLifeFraction: 0.30,
  hardLifeFraction: 0.55,
  wetLifeFractionDry: 0.10,
  wetLifeFractionWet: 0.45
});

export const STRATEGY_BALANCE_DEFINITIONS:
readonly StrategyBalanceDefinition[] = Object.freeze([
  {
    key: 'softFreshGrip', unit: 'fraction', minimum: 0.98, maximum: 1.02,
    rationale: 'Fresh soft compound grip multiplier.', owner: 'tyre balance'
  },
  {
    key: 'hardFreshGrip', unit: 'fraction', minimum: 0.94, maximum: 0.99,
    rationale: 'Fresh hard compound grip multiplier and compound pace gap.', owner: 'tyre balance'
  },
  {
    key: 'wetFreshGrip', unit: 'fraction', minimum: 0.88, maximum: 0.95,
    rationale: 'Fresh wet compound grip multiplier.', owner: 'wet tyre balance'
  },
  {
    key: 'softWearCoefficient', unit: 'fraction', minimum: 0.05, maximum: 0.13,
    rationale: 'Soft grip loss at unit wear before the wear exponent.', owner: 'tyre balance'
  },
  {
    key: 'hardWearCoefficient', unit: 'fraction', minimum: 0.025, maximum: 0.08,
    rationale: 'Hard grip loss at unit wear before the wear exponent.', owner: 'tyre balance'
  },
  {
    key: 'wetWearCoefficient', unit: 'fraction', minimum: 0.03, maximum: 0.10,
    rationale: 'Wet grip loss at unit wear before the wear exponent.', owner: 'wet tyre balance'
  },
  {
    key: 'wearExponent', unit: 'exponent', minimum: 1.5, maximum: 2.6,
    rationale: 'Shape of the late-stint degradation curve.', owner: 'tyre balance'
  },
  {
    key: 'softLifeFraction', unit: 'fraction', minimum: 0.25, maximum: 0.42,
    rationale: 'Soft nominal life as a share of race distance.', owner: 'tyre balance'
  },
  {
    key: 'hardLifeFraction', unit: 'fraction', minimum: 0.45, maximum: 0.70,
    rationale: 'Hard nominal life as a share of race distance.', owner: 'tyre balance'
  },
  {
    key: 'wetLifeFractionDry', unit: 'fraction', minimum: 0.06, maximum: 0.18,
    rationale: 'Wet tyre life on a dry track.', owner: 'wet tyre balance'
  },
  {
    key: 'wetLifeFractionWet', unit: 'fraction', minimum: 0.35, maximum: 0.60,
    rationale: 'Wet tyre life in wet conditions.', owner: 'wet tyre balance'
  }
]);

let activeStrategyBalance: Readonly<StrategyBalance> = STRATEGY_BALANCE_DEFAULTS;

export function strategyBalance(): Readonly<StrategyBalance> {
  return activeStrategyBalance;
}

function validateStrategyBalance(balance: Readonly<StrategyBalance>): void {
  for (const definition of STRATEGY_BALANCE_DEFINITIONS) {
    const value = balance[definition.key];
    if (!Number.isFinite(value) || value < definition.minimum || value > definition.maximum)
      throw new Error(
        `${definition.key} must be finite and within ` +
        `[${definition.minimum}, ${definition.maximum}] ${definition.unit}`
      );
  }
}

export function withStrategyBalance<T>(
  overrides: Partial<StrategyBalance>,
  run: () => T
): T {
  const previous = activeStrategyBalance;
  const candidate = Object.freeze({ ...previous, ...overrides });
  validateStrategyBalance(candidate);
  activeStrategyBalance = candidate;
  try {
    return run();
  } finally {
    activeStrategyBalance = previous;
  }
}

export function tyreLifeLaps(compound: TyreCompound, raceLaps: number, wet: number): number {
  const balance = strategyBalance();
  const fraction = compound === 'S'
    ? balance.softLifeFraction
    : compound === 'H'
      ? balance.hardLifeFraction
      : wet > 0.3 ? balance.wetLifeFractionWet : balance.wetLifeFractionDry;
  return Math.max(2, fraction * raceLaps);
}

export function tyreGrip(tyre: TyreState, wet: number): number {
  const balance = strategyBalance();
  const wear = Math.min(tyre.wear, 1.15);
  const wearShape = Math.pow(wear, balance.wearExponent);
  if (tyre.c === 'W')
    return (balance.wetFreshGrip - wearShape * balance.wetWearCoefficient) *
      (1 - wet * 0.05);
  const base = tyre.c === 'S'
    ? balance.softFreshGrip - wearShape * balance.softWearCoefficient
    : balance.hardFreshGrip - wearShape * balance.hardWearCoefficient;
  return base * (1 - wet * 0.36);
}

export function entryMu(entry: Entry, wet: number): number {
  return entry.mods.hMu * tyreGrip(entry.tyre, wet) * (entry.hFail ? 0.93 : 1);
}

/** Load-independent dirty-air loss; callers may reuse it across path samples. */
export function entryDirtyAirGripLoss(entry: Entry, session: Session): number {
  if (session.mode !== 'race' || !entry.car || entry.dirtyT <= 0) return 0;
  return racecraftCalibration().dirtyAirMarginPenalty *
    clamp(entry.dirtyT, 0, 1);
}

/** One dynamic-grip definition over a caller's already-computed base grip. */
export function dynamicMuAtSample(
  baseMu: number,
  dirtyAirGripLoss: number,
  speed: number,
  curvature: number,
  downforceScale = 1
): number {
  if (dirtyAirGripLoss <= 0) return baseMu;
  const lateralDemand = speed * speed * Math.abs(curvature);
  const load = clamp(lateralDemand / Math.max(1e-9,
    availableDeceleration(speed, baseMu, downforceScale)), 0, 1);
  return baseMu * (1 - dirtyAirGripLoss * load);
}

/** Dynamic grip at a specific planned sample; dirty air remains load-dependent. */
export function entryDynamicMuAt(
  entry: Entry,
  session: Session,
  speed: number,
  curvature: number
): number {
  return dynamicMuAtSample(
    entryMu(entry, session.wet),
    entryDirtyAirGripLoss(entry, session),
    speed,
    curvature,
    entryDownforceScale(entry)
  );
}

/** Dirty air changes cornering grip only; it never taxes straight-line pace. */
export function entryDynamicMu(entry: Entry, session: Session): number {
  const index = Math.max(0, entry.car?.progIdx ?? 0) % session.trk.n;
  const curvature = Math.abs(entry.pathPlan?.mode === 'pit' && entry.path
    ? entry.path.k[index]!
    : entry.racecraftLateralProgram
      ? compactLateralGeometryAtProgress(
          session.trk,
          entry.racecraftLateralProgram,
          entry.prog
        ).curvature
      : session.trk.idealPath?.k[index] ?? session.trk.kSm[index]!);
  return entryDynamicMuAt(entry, session, entry.spd, curvature);
}

export function flowZoneCount(track?: Pick<Track, 'len' | 'def'>): number {
  if (!track?.def.widthProfile) return FLOW_ZONES;
  return Math.max(1, Math.round(track.len / GENERATED_FLOW_ZONE_METRES));
}

export function rollFocus(entry: Entry, track?: Pick<Track, 'len' | 'def'>): void {
  const base = 0.35 + entry.lu.focus * 0.5;
  entry.focusNow = clamp(base + (random() - 0.5) * 0.26 - entry.stress * 0.35, 0.12, 1);
  const amplitude = 0.0035 + (1 - entry.focusNow) * 0.011;
  entry.flow = [];
  for (let zone = 0; zone < flowZoneCount(track); zone++)
    entry.flow.push(clamp((random() + random() - 1) * amplitude, -0.02, 0.02));
}

export function flowOff(entry: Entry, session: Session): number {
  if (!entry.flow || !entry.car) return 0;
  const count = entry.flow.length;
  if (count === 0) return 0;
  const index = Math.floor((entry.car.s / session.trk.len) * count) % count;
  return entry.flow[index]!;
}

export function minRel(entry: Entry): number {
  return Math.min(entry.rel.e, entry.rel.h, entry.rel.c);
}

export function entryMargin(
  entry: Entry,
  session: Session | null,
  tuneBonus: number,
  wet: number
): number {
  if (session?.mode === 'quali') {
    if (!entry.lapLive || entry.boxArm) return 0.882;
    let margin = entry.lu.margin + 0.014;
    if (entry.isPlayer) margin += tuneBonus;
    margin += (session.evo || 0) * 0.006;
    return clamp(margin, 0.86, 0.978);
  }
  let margin = entry.lu.margin + PACE_MARGIN[entry.pace];
  if (entry.isPlayer) margin += tuneBonus;
  if (entry.pace === 2 && entry.lu.trait === 'hot') margin += 0.006;
  margin += (session?.evo || 0) * 0.003;
  margin -= wet * 0.015;
  if (entry.lu.trait === 'rain') margin += wet * 0.010;
  if (entry.liftT > 0) margin -= LIFT_MARGIN_PENALTY;
  if (entry.state === 'fin') margin = 0.90;
  return clamp(margin, 0.86, 0.968);
}

export function entryMods(entry: Entry, wet: number, mu = entryMu(entry, wet)): CarModifiers {
  return {
    pw: entry.mods.pw * (entry.fuel <= 0 ? 0.25 : 1) * (entry.pace === 2 ? 1.008 : entry.pace === 0 ? 0.97 : 1),
    mu,
    dr: entryDragScale(entry),
    df: entryDownforceScale(entry)
  };
}

/** Current production drag scale, shared with finite-time escape reachability. */
export function entryDragScale(entry: Entry): number {
  const calibration = racecraftCalibration();
  return entry.mods.dr * (1 - calibration.towDragReduction * (entry.tow || 0)) *
    (entry.cFail ? 1 + AERO_FAILURE_SEVERITY : 1);
}

/** The same bodywork failure severity raises drag and removes aero load. */
export function entryDownforceScale(entry: Entry): number {
  return entry.cFail ? 1 - AERO_FAILURE_SEVERITY : 1;
}

export function tyreAge(entry: Entry): number {
  return Math.max(0, entry.cross - (entry.tyre.fit || 0) - 1);
}

export function tyreLapsLeft(entry: Entry, session: RaceSession): number {
  const lifeLaps = tyreLifeLaps(entry.tyre.c, session.laps, session.wet);
  let perLap = PACE_WEAR[entry.pace] / lifeLaps;
  if (entry.lu.trait === 'tyre') perLap *= 0.8;
  return Math.max(0, Math.floor((1 - entry.tyre.wear) / perLap));
}

export function fuelLapsLeft(entry: Entry, session: RaceSession): number {
  return Math.max(0, Math.floor(entry.fuel * session.laps * 1.3 / PACE_FUEL[entry.pace]));
}

export interface PitProjection {
  loss: number;
  pos: number;
  behind: Entry | null;
}

export function projectPitStop(
  entry: Entry,
  session: RaceSession,
  fix: boolean
): PitProjection {
  const pit = session.trk.pit;
  const service = entry.isPlayer
    ? 7.6 - session.config.pitSkill * 0.55 + (fix ? 3.5 : 0)
    : 7;
  const raceSpeed = session.trk.len / (session.prof.lapTime * 1.1);
  const loss = pit.Lp / pit.limit + service + 2.5 - pit.Lp / raceSpeed;
  const projectedProgress = entry.prog - loss * raceSpeed;
  let position = 1;
  let behind: Entry | null = null;
  let behindDistance = Infinity;
  for (const other of session.entries) {
    if (other === entry || !other.car || other.state === 'dnf' || other.state === 'fin') continue;
    if (other.prog <= projectedProgress) continue;
    position++;
    const distance = other.prog - projectedProgress;
    if (distance < behindDistance) {
      behindDistance = distance;
      behind = other;
    }
  }
  return { loss, pos: position, behind };
}

export function normalizePace(value: number): PaceMode {
  return value <= 0 ? 0 : value >= 2 ? 2 : 1;
}

export function formatSessionTime(time: number): string {
  if (!Number.isFinite(time)) return '—';
  const minutes = Math.floor(time / 60);
  const seconds = time - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}
