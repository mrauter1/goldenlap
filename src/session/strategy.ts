import { clamp } from '../shared/math';
import type { CarModifiers } from '../core/model';
import type { Entry, PaceMode, RaceSession, Session, TyreState } from './model';

export const H_STEP = 1 / 120;
export const TRAF_DT = 1 / 30;
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

export function tyreGrip(tyre: TyreState, wet: number): number {
  const wear = Math.min(tyre.wear, 1.15);
  if (tyre.c === 'W') return (0.915 - Math.pow(wear, 1.7) * 0.06) * (1 - wet * 0.05);
  const base = tyre.c === 'S' ? 1.0 - Math.pow(wear, 1.7) * 0.10 : 0.976 - Math.pow(wear, 1.7) * 0.05;
  return base * (1 - wet * 0.36);
}

export function entryMu(entry: Entry, wet: number): number {
  return entry.mods.hMu * tyreGrip(entry.tyre, wet) * (entry.hFail ? 0.93 : 1);
}

export function rollFocus(entry: Entry): void {
  const base = 0.35 + entry.lu.focus * 0.5;
  entry.focusNow = clamp(base + (Math.random() - 0.5) * 0.26 - entry.stress * 0.35, 0.12, 1);
  const amplitude = 0.0035 + (1 - entry.focusNow) * 0.011;
  entry.flow = [];
  for (let zone = 0; zone < FLOW_ZONES; zone++)
    entry.flow.push(clamp((Math.random() + Math.random() - 1) * amplitude, -0.02, 0.02));
}

export function flowOff(entry: Entry, session: Session): number {
  if (!entry.flow || !entry.car) return 0;
  const index = Math.floor((entry.car.s / session.trk.len) * FLOW_ZONES) % FLOW_ZONES;
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
  if (entry.liftT > 0) margin -= 0.045;
  if (entry.yieldT > 0) margin -= 0.035;
  if (entry.lungeT > 0) margin += 0.008;
  if (entry.state === 'fin') margin = 0.90;
  return clamp(margin, 0.86, 0.968);
}

export function entryMods(entry: Entry, wet: number): CarModifiers {
  return {
    pw: entry.mods.pw * (entry.fuel <= 0 ? 0.25 : 1) * (entry.pace === 2 ? 1.008 : entry.pace === 0 ? 0.97 : 1),
    mu: entryMu(entry, wet),
    dr: entry.mods.dr * (1 - 0.13 * (entry.tow || 0)) * (entry.cFail ? 1.18 : 1)
  };
}

export function tyreAge(entry: Entry): number {
  return Math.max(0, entry.cross - (entry.tyre.fit || 0) - 1);
}

export function tyreLapsLeft(entry: Entry, session: RaceSession): number {
  const lifeLaps = Math.max(2,
    entry.tyre.c === 'S' ? 0.30 * session.laps :
    entry.tyre.c === 'H' ? 0.55 * session.laps :
    (session.wet > 0.3 ? 0.45 * session.laps : 0.10 * session.laps));
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
