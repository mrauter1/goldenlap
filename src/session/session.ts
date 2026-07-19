import { collideCars, isHardContactImpulse } from '../core/collision';
import { clamp, normAng } from '../shared/math';
import { random } from '../shared/rng';
import { damagePart, lapWear } from './incidents';
import { launchFromPit, stepEntry } from './entry';
import { rivalPitAI } from './pit';
import { emitHudDirty, emitSessionEvent, emitToast, requestTuningPoint } from './events';
import {
  unstableCar, updateTraffic
} from './racecraft/traffic';
import { roomPairKey } from './racecraft/geometry';
import { setTargetAbsLat, targetAbsLat } from './racecraft/paths';
import { formatSessionTime, rollFocus, TRAF_DT } from './strategy';
import type { Car } from '../core/model';
import type {
  Entry, HitPairMetric, HitSample, QualifyingSession, Session
} from './model';

type ActiveEntry = Entry & { car: Car };

export type RaceCountdownCue =
  | { kind: 'light'; stage: 1 | 2 | 3 }
  | { kind: 'go' };

/**
 * Advance the wall-clock start sequence without involving browser concerns.
 * The caller renders the returned cue immediately so light/audio ordering stays
 * identical to the legacy loop.
 */
export function advanceRaceCountdown(
  session: Session,
  frameDelta: number
): RaceCountdownCue | null {
  if (session.mode !== 'race' || session.phase !== 'count') return null;
  session.countT += frameDelta;
  const stage = session.countT < 0.55 ? 0 : session.countT < 1.35 ? 1 :
    session.countT < 2.15 ? 2 : 3;
  if (stage !== session._lt && (stage === 1 || stage === 2 || stage === 3)) {
    session._lt = stage;
    return { kind: 'light', stage };
  }
  if (session.countT < 2.9) return null;
  session.phase = 'run';
  session.goT = session.t;
  for (const entry of session.entries)
    if (entry.state === 'grid') entry.state = 'run';
  return { kind: 'go' };
}

export function onLine(entry: Entry, session: Session, valid: boolean): void {
  entry.cross++;
  const lapTime = entry.lineT >= 0 ? session.t - entry.lineT : 0;
  entry.lineT = session.t;
  rollFocus(entry, session.trk);
  if (session.mode === 'quali') {
    const wasFlying = entry.lapPhase === 'flying' || entry.lapLive;
    if (wasFlying && lapTime > 0) {
      entry.lastLap = lapTime;
      if (valid) {
        if (entry.isPlayer && random() < 0.35 && requestTuningPoint(session))
          emitToast(session, 'The crew learned something — +1 tuning point', 'info');
        if (lapTime < entry.best) {
          entry.best = lapTime;
          entry._bestCps = entry._curCps;
          if (entry.isPlayer) emitToast(session, `${entry.code} — ${formatSessionTime(lapTime)}`, 'info');
        }
      }
      entry._curCps = [];
      entry._cpSeen = 0;
      entry._dLive = null;
      if (entry.isPlayer) {
        const base = session.config.playerWearRate * 0.35;
        for (const key of ['e', 'h', 'c'] as const) damagePart(entry, key, base);
        if (session.over && !entry.boxArm) {
          entry.boxArm = true;
          emitToast(session, `${entry.code} — flag is out, boxing`, 'info');
          emitHudDirty(session, entry.ci);
        }
      } else {
        entry.hotLeft--;
        if (entry.hotLeft <= 0 || session.over || entry.tyre.wear > 0.8) entry.boxArm = true;
      }
    }
    entry.lapPhase = entry.boxArm ? 'in' : 'flying';
    entry.lapLive = entry.lapPhase === 'flying' && entry.state === 'run';
    return;
  }

  if (entry.cross >= 2) {
    if (lapTime > 0) entry.lastLap = lapTime;
    if (valid && lapTime > 0 && lapTime < entry.best) entry.best = lapTime;
    if (valid && lapTime > 0) {
      if (entry._battleLapSeconds > 0 && entry._recentCleanLap > 0) {
        session.battleLapDeltaSum = (session.battleLapDeltaSum ?? 0) +
          (lapTime - entry._recentCleanLap);
        session.battleLapReferenceSum = (session.battleLapReferenceSum ?? 0) +
          entry._recentCleanLap;
        session.battleLapSamples = (session.battleLapSamples ?? 0) + 1;
      } else if (entry._battleLapSeconds <= 0) {
        entry._recentCleanLap = lapTime;
      }
    }
    entry._battleLapSeconds = 0;
    lapWear(entry, session);
    if (entry.state === 'dnf') return;
    rivalPitAI(entry, session);
  }
  const completed = entry.cross - 1;
  if (!session.chequered && completed >= session.laps) {
    session.chequered = true;
    session.winT = session.t;
    emitSessionEvent(session, {
      type: 'banner', tone: 'gold', title: 'CHEQUERED FLAG', subtitle: `${entry.name} WINS`
    });
    if (entry.isPlayer) {
      emitSessionEvent(session, { type: 'audio', cue: 'fanfare' });
      emitSessionEvent(session, { type: 'effect', kind: 'confetti' });
    } else {
      emitSessionEvent(session, {
        type: 'audio', cue: 'beep', frequency: 660, duration: 0.3,
        wave: 'triangle', gain: 0.14
      });
    }
  }
  if (session.chequered && entry.state === 'run') {
    entry.state = 'fin';
    entry.finT = session.t;
    entry.finPos = ++session.finCount;
    entry.finLaps = completed;
    if (entry.isPlayer) emitHudDirty(session, entry.ci);
  }
}

export function stepSession(
  session: Session,
  step: number
): void {
  session.t += step;
  if (session.mode === 'race' && session.rainAt >= 0) {
    const rainingNow = session.t >= session.rainAt && session.t <= session.rainEnd;
    if (rainingNow && !session.raining) {
      session.raining = true;
      emitSessionEvent(session, {
        type: 'banner', tone: '', title: 'RAIN',
        subtitle: 'THE TRACK IS GETTING WET — WETS COME ALIVE ABOVE 1/3 WET'
      });
      emitToast(session, 'RAIN! The track is getting wet', 'info');
      emitSessionEvent(session, {
        type: 'audio', cue: 'beep', frequency: 330, duration: 0.4, wave: 'sine', gain: 0.12
      });
    }
    if (!rainingNow && session.raining && session.t > session.rainEnd) {
      session.raining = false;
      emitToast(session, 'The rain has stopped', 'info');
    }
    session.wet = clamp(session.wet + (session.raining ? 0.05 : -0.018) * step, 0, 0.95);
  }

  const running = session.entries.reduce(
    (count, entry) => count + (entry.car && entry.state !== 'pit' && entry.state !== 'dnf' ? 1 : 0),
    0
  );
  if (session.wet > 0.12) session.evo = Math.max(0, (session.evo || 0) - 0.03 * step);
  else session.evo = Math.min(
    1,
    (session.evo || 0) + running * step * (session.mode === 'quali' ? 1.05e-4 : 5e-5)
  );

  if (session.mode === 'quali') {
    stepQualifyingFlow(session);
    if (session.completionQueued || session.done) return;
  }

  const collisionEntries: ActiveEntry[] = [];
  for (const entry of session.entries) {
    if (!entry.car || entry.state === 'grid' || entry.state === 'dnf') continue;
    stepEntry(entry, session, step, onLine);
    const postState = entry.state as Entry['state'];
    if (entry.car && postState !== 'pit' && postState !== 'dnf' && postState !== 'fin')
      collisionEntries.push(entry as ActiveEntry);
  }

  session.trafT -= step;
  while (session.trafT <= 0) {
    session.trafT += TRAF_DT;
    updateTraffic(session);
  }
  processCollisions(session, collisionEntries, step);
  finishRaceIfReady(session);
}

function stepQualifyingFlow(session: QualifyingSession): void {
  const remaining = session.tEnd - session.t;
  for (const milestone of [900, 300, 60]) {
    if (!session.mile[milestone] && remaining <= milestone && remaining > 0) {
      session.mile[milestone] = 1;
      emitToast(
        session,
        milestone >= 120
          ? `${milestone / 60} minutes left in qualifying`
          : 'ONE MINUTE LEFT IN QUALIFYING',
        'info'
      );
    }
  }
  if (!session.over && session.t >= session.tEnd) {
    session.over = true;
    emitSessionEvent(session, {
      type: 'banner', tone: 'gold', title: 'CHEQUERED FLAG',
      subtitle: 'LAPS ALREADY STARTED WILL COUNT'
    });
    for (const entry of session.entries) {
      if (entry.car && !entry.lapLive && !entry.boxArm) {
        entry.boxArm = true;
        entry.lapPhase = 'in';
        entry.lapLive = false;
        if (entry.isPlayer) emitHudDirty(session, entry.ci);
      }
    }
  }
  if (!session.over) {
    for (const entry of session.entries) {
      if (entry.isPlayer || entry.state !== 'box' || !entry.plan?.length) continue;
      if (session.t >= entry.plan[0]!.at) {
        entry.hotLeft = entry.plan[0]!.hot;
        entry.plan.shift();
        launchFromPit(entry, session, 'S');
      }
    }
  } else {
    const onTrack = session.entries.some(entry => entry.car);
    if ((!onTrack || session.t > session.tEnd + 280) && !session.completionQueued) {
      session.completionQueued = true;
      emitSessionEvent(session, { type: 'session-complete', kind: 'qualifying' });
    }
  }
}

export function requiresContactRecovery(
  hardContact: boolean,
  firstUnstable: boolean,
  secondUnstable: boolean
): boolean {
  return hardContact || firstUnstable || secondUnstable;
}

export function recordContinuousContactStep(
  pair: HitPairMetric,
  contactStep: number,
  stepSeconds: number
): void {
  if (pair.lastContactStep === contactStep) return;
  if (pair.lastContactStep !== contactStep - 1)
    pair.contactEpisodes++;
  pair.continuousContactSeconds =
    pair.lastContactStep === contactStep - 1
      ? pair.continuousContactSeconds + stepSeconds
      : stepSeconds;
  pair.maximumContinuousContactSeconds = Math.max(
    pair.maximumContinuousContactSeconds,
    pair.continuousContactSeconds
  );
  pair.lastContactStep = contactStep;
}

function processCollisions(
  session: Session,
  entries: ActiveEntry[],
  stepSeconds: number
): void {
  const contactStep = (session._contactStep ?? 0) + 1;
  session._contactStep = contactStep;
  const impacts = collideCars(entries.map(entry => entry.car));
  for (const impact of impacts) {
    const first = entries[impact.i]!;
    const second = entries[impact.j]!;
    session.hitN = (session.hitN || 0) + 1;
    const hitPairs = session.hitPairs ??
      (session.hitPairs = Object.create(null) as Record<string, HitPairMetric>);
    const hitKey = roomPairKey(first, second);
    const pair = hitPairs[hitKey] ?? (hitPairs[hitKey] = {
      n: 0,
      hard: 0,
      max: 0,
      side: 0,
      room: 0,
      sumImp: 0,
      sumSep: 0,
      sumDs: 0,
      continuousContactSeconds: 0,
      maximumContinuousContactSeconds: 0,
      lastContactStep: -1,
      contactEpisodes: 0
    });
    const separation = Math.abs(first.latNow - second.latNow);
    const hardContact = isHardContactImpulse(impact.imp);
    const forward = (second.car.s - first.car.s + session.trk.len) % session.trk.len;
    const longitudinal = Math.min(forward, session.trk.len - forward);
    pair.n++;
    pair.max = Math.max(pair.max, impact.imp);
    pair.sumImp += impact.imp;
    pair.sumSep += separation;
    pair.sumDs += longitudinal;
    recordContinuousContactStep(pair, contactStep, stepSeconds);
    if (separation > 1.8) pair.side++;
    const roomKey = roomPairKey(first, second);
    if (session.roomPairs?.[roomKey]) pair.room++;
    if (hardContact) {
      pair.hard++;
    }
    if (separation > 1.8) session.hitSide = (session.hitSide || 0) + 1;
    else session.hitRear = (session.hitRear || 0) + 1;

    const recoveryContact = requiresContactRecovery(
      hardContact,
      unstableCar(session.trk, first),
      unstableCar(session.trk, second)
    );
    if (recoveryContact && separation >= 1.1 && longitudinal < 4.5) {
      const roomPairs = session.roomPairs ??
        (session.roomPairs = Object.create(null) as NonNullable<Session['roomPairs']>);
      const hitRoom = roomPairs[roomKey] ?? {};
      hitRoom.seen = session._roomStamp || 0;
      hitRoom.contactSeed = true;
      roomPairs[roomKey] = hitRoom;
    }

    if (hardContact)
      recordHardImpact(session, first, second, impact.imp, separation, roomKey);
    first._hitT = second._hitT = session.t;
    const sideBySide = session.sbsPairs?.[hitKey];
    if (sideBySide) sideBySide.contact = true;

    if (hardContact) {
      first.stress = clamp(first.stress + impact.imp * 0.012, 0, 1);
      second.stress = clamp(second.stress + impact.imp * 0.012, 0, 1);
    }
    if (impact.imp > 5) {
      const cameraEntry = session.entries[session.camI];
      if (cameraEntry?.car &&
          Math.hypot(cameraEntry.car.x - first.car.x, cameraEntry.car.y - first.car.y) < 160)
        emitSessionEvent(session, { type: 'audio', cue: 'thud', strength: impact.imp / 20 });
      if ((first.isPlayer || second.isPlayer) && hardContact)
        emitToast(session, `${first.code} and ${second.code} bang wheels!`, 'bad');
      if (hardContact) {
        const entryIndex = session.entries.indexOf(first);
        emitSessionEvent(session, { type: 'camera-candidate', entryIndex, kind: 'incident' });
      }
    }
    if (session.mode === 'race' && hardContact) {
      damagePart(first, 'h', impact.imp * 0.004);
      damagePart(second, 'h', impact.imp * 0.004);
    }
  }
}

function recordHardImpact(
  session: Session,
  first: ActiveEntry,
  second: ActiveEntry,
  impulse: number,
  separation: number,
  roomKey: string
): void {
  session.hitHard = (session.hitHard || 0) + 1;
  const index = Math.max(0, first.car.progIdx);
  if (separation > 1.8) session.hitHardSide = (session.hitHardSide || 0) + 1;
  else session.hitHardRear = (session.hitHardRear || 0) + 1;
  if (session.roomPairs?.[roomKey]) session.hitHardRoom = (session.hitHardRoom || 0) + 1;
  const curvature = Math.abs(session.trk.idealPath?.k[index] ?? session.trk.kSm[index]!);
  if (curvature > 1 / 130) session.hitHardCorner = (session.hitHardCorner || 0) + 1;
  session.hitMax = Math.max(session.hitMax || 0, impulse);

  const forward = (second.car.s - first.car.s + session.trk.len) % session.trk.len;
  const sample: HitSample = {
    t: session.t,
    imp: impulse,
    a: first.code,
    b: second.code,
    stateA: first.state,
    stateB: second.state,
    pitWA: first.pitW != null && Number.isFinite(first.pitW) ? first.pitW : -1,
    pitWB: second.pitW != null && Number.isFinite(second.pitW) ? second.pitW : -1,
    dAB: forward,
    ds: Math.min(forward, session.trk.len - forward),
    sep: separation,
    spdA: first.spd,
    spdB: second.spd,
    latA: first.latNow,
    latB: second.latNow,
    tgtA: targetAbsLat(session.trk, first),
    tgtB: targetAbsLat(session.trk, second),
    dh: Math.abs(normAng(first.car.h - second.car.h)),
    rA: first.car.r,
    rB: second.car.r,
    yawA: roadYawError(session, first),
    yawB: roadYawError(session, second),
    slipA: Math.abs(first.car.slipR),
    slipB: Math.abs(second.car.slipR),
    brakeA: first.inp.brake,
    brakeB: second.inp.brake,
    liftA: first.liftT,
    liftB: second.liftT,
    recA: first.recT,
    recB: second.recT,
    failA: first.hFail,
    failB: second.hFail,
    prevA: first._hitT != null && Number.isFinite(first._hitT) ? session.t - first._hitT : -1,
    prevB: second._hitT != null && Number.isFinite(second._hitT) ? session.t - second._hitT : -1,
    k: curvature,
    room: !!session.roomPairs?.[roomKey],
    off: !!(first.car.offCourse || second.car.offCourse),
    atk: first.battle || second.battle
  };
  const samples = session.hitSamples ?? (session.hitSamples = []);
  samples.push(sample);
  samples.sort((left, right) => right.imp - left.imp);
  if (samples.length > 20) samples.length = 20;
  if (session.mode === 'race' && !session.entries.some(entry => entry.cross >= 2))
    session.hitOpenHard = (session.hitOpenHard || 0) + 1;

  for (const entry of [first, second]) {
    if (!unstableCar(session.trk, entry)) continue;
    const entryIndex = Math.max(0, entry.car.progIdx);
    const desired = Math.atan2(session.trk.ty[entryIndex]!, session.trk.tx[entryIndex]!);
    entry.car.h = normAng(entry.car.h + normAng(desired - entry.car.h) * 0.35);
    entry.car.r *= 0.3;
    entry.car.vy *= 0.55;
    setTargetAbsLat(
      session,
      entry,
      session.trk.idealPath?.off[entryIndex] ?? 0,
      'contact-recovery'
    );
  }
}

function roadYawError(session: Session, entry: ActiveEntry): number {
  const index = Math.max(0, entry.car.progIdx);
  return Math.abs(normAng(
    entry.car.h - Math.atan2(session.trk.ty[index]!, session.trk.tx[index]!)
  ));
}

function finishRaceIfReady(session: Session): void {
  if (session.mode !== 'race') return;
  const alive = session.entries.filter(entry =>
    entry.state === 'run' || entry.state === 'pitIn' || entry.state === 'pit' || entry.state === 'pitOut'
  ).length;
  if (!session.chequered && alive === 0 && session.phase === 'run') {
    session.phase = 'end';
    session.endT = session.t;
    emitSessionEvent(session, {
      type: 'banner', tone: 'bad', title: 'RACE OVER', subtitle: 'NO CARS LEFT RUNNING'
    });
  }
  if (session.chequered && session.phase === 'run' &&
      (alive === 0 || session.t > (session.winT ?? session.t) + 120)) {
    for (const entry of session.entries) {
      if (entry.state === 'run' || entry.state === 'pitIn' || entry.state === 'pit' || entry.state === 'pitOut') {
        entry.state = 'fin';
        entry.finT = session.t;
        entry.finPos = ++session.finCount;
        entry.finLaps = entry.cross - 1;
      }
    }
    session.phase = 'end';
    session.endT = session.t;
  }
  if (session.phase === 'end' && session.t > (session.endT ?? session.t) + 4 &&
      !session.completionQueued) {
    session.completionQueued = true;
    emitSessionEvent(session, { type: 'session-complete', kind: 'race' });
  }
}
