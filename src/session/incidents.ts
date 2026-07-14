import { nextCorner } from '../core/racing-line';
import { clamp, normAng } from '../shared/math';
import { emitHudDirty, emitSessionEvent, emitToast } from './events';
import { minRel, PACE_RISK, REF_LAPS } from './strategy';
import type { Entry, PartKey, RaceSession, Session } from './model';

export function dnf(entry: Entry, reason: string, session: Session): void {
  const car = entry.car!;
  entry.state = 'dnf';
  entry.notes.push(reason);
  const track = session.trk, index = Math.max(0, car.progIdx);
  let side = ((car.x - track.x[index]!) * track.nx[index]! +
    (car.y - track.y[index]!) * track.ny[index]!) >= 0 ? 1 : -1;
  if (track.pit.inLane(index * track.step)) side = -1;
  car.x = track.x[index]! + track.nx[index]! * side * (track.hw + 7.5);
  car.y = track.y[index]! + track.ny[index]! * side * (track.hw + 7.5);
  car.vx = car.vy = car.r = 0;
  emitToast(session, `${entry.code} — ${reason}`, 'bad');
  if (entry.isPlayer) {
    emitSessionEvent(session, { type: 'audio', cue: 'chime', kind: 'down' });
    emitHudDirty(session, entry.ci);
  }
}

export function damagePart(entry: Entry, key: PartKey, amount: number): void {
  const before = entry.rel[key];
  entry.rel[key] = Math.max(0.02, entry.rel[key] - amount);
  entry.wearAcc[key] += before - entry.rel[key];
}

export function rollMistake(entry: Entry, session: RaceSession): void {
  const car = entry.car!;
  const slick = entry.tyre.c !== 'W';
  const lengthFactor = REF_LAPS / session.laps;
  let probability = 0.0011 * lengthFactor * PACE_RISK[entry.pace] *
    (1.65 - entry.lu.focus * 1.1) * (1 + entry.stress * 1.2) *
    (1 + session.wet * (slick ? 2.6 : 0.35)) * (minRel(entry) < 0.3 ? 1.7 : 1) *
    (entry.tyre.wear > 0.95 ? 1.8 : 1);
  if (entry.lu.trait === 'metro') probability *= 0.6;
  if (entry.lu.trait === 'fear') probability *= 1.25;
  if (entry.lu.trait === 'rain') probability /= 1 + session.wet * 1.6;
  if (Math.random() >= probability) return;
  const track = session.trk;
  const index = Math.max(0, car.progIdx) % track.n;
  const curvature = Math.abs(track.idealPath?.k[index] ?? track.kSm[index]!);
  const corner = nextCorner(track, index);
  const brakeDistance = corner ? ((corner.brakeI - index + track.n) % track.n) * track.step : Infinity;
  if (curvature < 1 / 230 && brakeDistance > Math.max(38, entry.spd * 2.0)) {
    entry.liftT = Math.max(entry.liftT, 0.45);
    return;
  }
  const roll = Math.random();
  if (roll < 0.65) {
    entry.liftT = 2.2;
    if (entry.isPlayer)
      emitToast(session, `${entry.code} runs wide — ${entry.stress > 0.55 ? 'driver is rattled' : slick && session.wet > 0.25 ? 'slicks on a wet track' : 'lost a tenth'}`);
  } else if (roll < 0.94) {
    entry.liftT = Math.max(entry.liftT, 3.0);
    entry.stress = Math.min(1, entry.stress + 0.12);
    entry.notes.push('locked a brake');
    if (entry.isPlayer) emitToast(session, `${entry.code} locks a brake and runs wide`, 'bad');
  } else {
    if (Math.random() < 0.45) {
      dnf(entry, 'CRASHED OUT', session);
    } else {
      damagePart(entry, 'h', entry.rel.h * 0.5);
      entry.hFail = true;
      const barrierIndex = Math.max(0, car.progIdx);
      let side = entry.latNow >= 0 ? 1 : -1;
      if (track.pit.inLane(barrierIndex * track.step)) side = -1;
      car.x = track.x[barrierIndex]! + track.nx[barrierIndex]! * side * (track.hw + 1.5);
      car.y = track.y[barrierIndex]! + track.ny[barrierIndex]! * side * (track.hw + 1.5);
      car.h = Math.atan2(track.ty[barrierIndex]!, track.tx[barrierIndex]!);
      car.vx *= 0.2;
      car.vy *= 0.2;
      car.r = 0;
      entry.notes.push('hit the barriers');
      emitToast(session, `${entry.code} hits the hay bales — damage, needs to box`, 'bad');
    }
  }
}

export function lapWear(entry: Entry, session: RaceSession): void {
  const lengthFactor = REF_LAPS / session.laps;
  if (entry.isPlayer) {
    const base = session.config.playerWearRate *
      (1.22 - session.config.engineerPrecision * 0.044) * lengthFactor;
    damagePart(entry, 'e', base * (entry.pace === 2 ? 1.5 : 1));
    damagePart(entry, 'h', base);
    damagePart(entry, 'c', base * 0.8);
  } else {
    damagePart(entry, 'e', 0.009 * lengthFactor);
    damagePart(entry, 'h', 0.009 * lengthFactor);
    damagePart(entry, 'c', 0.007 * lengthFactor);
  }
  for (const key of ['e', 'h', 'c'] as const satisfies readonly PartKey[]) {
    if (entry.rel[key] < 0.32 && Math.random() < (0.32 - entry.rel[key]) * 0.55) {
      if (key === 'e') {
        dnf(entry, 'ENGINE FAILURE', session);
        return;
      }
      if (key === 'h' && !entry.hFail) {
        entry.hFail = true;
        emitToast(session, `${entry.code} — suspension failing, needs the pits`, 'bad');
      }
      if (key === 'c' && !entry.cFail) {
        entry.cFail = true;
        emitToast(session, `${entry.code} — bodywork flapping, losing top speed`, 'bad');
      }
    }
  }
}

export function stepRecovery(entry: Entry, session: Session, step: number): void {
  if (entry.state !== 'run') {
    entry.recT = 0;
    return;
  }
  const car = entry.car!;
  const track = session.trk;
  const index = Math.max(0, car.progIdx);
  const desiredHeading = Math.atan2(track.ty[index]!, track.tx[index]!);
  const turn = normAng(desiredHeading - car.h), error = Math.abs(turn);
  const wet = session.wet || 0;
  const roomLoose = !!entry._roomActive &&
    (error > 0.14 - 0.02 * wet || Math.abs(car.r) > 0.52 - 0.08 * wet ||
      Math.abs(car.slipR) > 0.13 - 0.02 * wet);
  const loose = roomLoose || error > 0.34 - 0.08 * wet ||
    Math.abs(car.r) > 0.8 - 0.15 * wet || Math.abs(car.slipR) > 0.18 - 0.04 * wet;
  if (loose && car.spd >= 22) {
    const amount = Math.max(
      clamp((error - (roomLoose ? 0.10 : 0.25)) / (roomLoose ? 0.35 : 0.55), 0, 1),
      clamp((Math.abs(car.r) - (roomLoose ? 0.40 : 0.60)) / (roomLoose ? 0.85 : 1.2), 0, 1));
    const gather = (1 + 0.6 * wet) * (roomLoose ? 1.25 : 1);
    car.r *= 1 / (1 + step * (2.2 + 3.2 * amount) * gather);
    car.vy *= 1 / (1 + step * (1.0 + 2.0 * amount) * gather);
    car.h = normAng(car.h + clamp(turn, -0.8, 0.8) * step * (0.28 + 0.38 * amount) * gather);
    if (error > 0.48 || Math.abs(car.r) > 1.0) {
      entry.atkT = 0;
      entry.atkCd = Math.max(entry.atkCd, 1.0);
      entry.latTgt = 0;
    }
  }
  if (error > 0.55 && car.spd < 22) {
    car.r *= 1 / (1 + step * 4.5);
    car.h = normAng(car.h + clamp(turn, -1.2, 1.2) * step * 0.9);
    car.vy *= 1 / (1 + step * 3.0);
  }
  const stuck = car.spd < 2.4 && (error > 2.0 || car.offCourse);
  entry.recT = stuck ? entry.recT + step : 0;
  if (entry.recT > 1.1) {
    car.h = normAng(car.h + clamp(normAng(desiredHeading - car.h), -1, 1) * Math.min(1, step * 1.6));
    car.vx = Math.max(car.vx, 3.5);
    if (error < 0.4 && !car.offCourse) entry.recT = 0;
  }
}
