import { launchFromPit } from './entry';
import { normalizePace } from './strategy';
import type { Entry, PitArm, Session, TyreCompound } from './model';

export function playerEntry(session: Session | null, carIndex: number): Entry | null {
  return session?.entries.find(entry => entry.isPlayer && entry.ci === carIndex) ?? null;
}

export function sendQualifyingCar(session: Session, carIndex: number): Entry | null {
  if (session.mode !== 'quali' || session.done || session.over) return null;
  const entry = playerEntry(session, carIndex);
  if (!entry || entry.state !== 'box') return null;
  entry.hotLeft = 99;
  entry.lapPhase = 'out';
  launchFromPit(entry, session, 'S');
  return entry;
}

export function boxQualifyingCar(session: Session, carIndex: number): Entry | null {
  if (session.mode !== 'quali') return null;
  const entry = playerEntry(session, carIndex);
  if (!entry?.car || entry.boxArm || entry.state === 'pit' || entry.state === 'pitIn') return null;
  entry.boxArm = true;
  entry.lapLive = false;
  entry.lapPhase = 'in';
  return entry;
}

export function setPace(entry: Entry, pace: number): void {
  if (entry.state === 'dnf' || entry.state === 'fin') return;
  entry.pace = normalizePace(pace);
}

export function setPitCall(entry: Entry, arm: PitArm): void {
  if (entry.state === 'dnf' || entry.state === 'fin' || entry.state === 'pit' ||
      entry.state === 'pitIn' || entry.state === 'pitOut') return;
  entry.pitArm = { ...arm };
}

export function cancelPitCall(entry: Entry): void {
  if (entry.state === 'run') entry.pitArm = null;
}

export function validCompound(value: string | undefined): TyreCompound | null {
  return value === 'S' || value === 'H' || value === 'W' ? value : null;
}
