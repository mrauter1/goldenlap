import { describe, expect, test } from 'bun:test';

import type { Car } from '../../../src/core/model';
import { makeCar } from '../../../src/core/physics-engine';
import {
  detectSemanticCorners,
  legacyRacingLine,
  racingLine,
  refineSemanticCorners,
  speedProfile
} from '../../../src/core/racing-line';
import { buildTrack } from '../../../src/core/track';
import { TRACK_DEFS } from '../../../src/data/tracks';
import { createEntry, launchFromPit, stepEntry } from '../../../src/session/entry';
import type {
  Entry, LineupEntry, QualifyingSession, RaceSession, Session
} from '../../../src/session/model';
import {
  claimPitReservation,
  notePitProgress,
  occupiesPitTravelLane,
  pitIngressStartW,
  pitEgressEndW,
  pitOccupancy,
  pitQueuePoint,
  pitSweptOccupanciesOverlap,
  pitTrafficReference,
  planPitMotion
} from '../../../src/session/pit';
import { syncPitPaths } from '../../../src/session/racecraft/paths';
import { stepSession } from '../../../src/session/session';

type ActiveEntry = Entry & { car: Car };

const TEAM = { id: 'pit-test', name: 'Pit Test', body: '#000', accent: '#fff' } as const;

function lineup(code: string): LineupEntry {
  return {
    team: TEAM,
    name: code,
    code,
    isPlayer: false,
    ci: 0,
    margin: 0,
    focus: 0.7,
    trait: ''
  };
}

function activeEntry(code: string, teamIndex: number): ActiveEntry {
  const value = createEntry({
    lineup: lineup(code),
    teamIndex,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  value.car = makeCar(0, 0, 0);
  return value as ActiveEntry;
}

function raceSession(trackIndex: number): RaceSession {
  const track = buildTrack(TRACK_DEFS[trackIndex]!, 6);
  const profile = speedProfile(track);
  detectSemanticCorners(track, profile);
  refineSemanticCorners(track, legacyRacingLine(track));
  const idealPath = racingLine(track);
  const idealProfile = speedProfile(track, idealPath);
  idealPath.v = idealProfile.v;
  track.idealPath = idealPath;
  track.idealTiming = { t: idealProfile.t, lapTime: idealProfile.lapTime };
  if (!track.corners) throw new Error('Corner build failed');
  return {
    trk: track as RaceSession['trk'],
    prof: profile,
    entries: [],
    config: {
      playerWearRate: 1,
      engineerPrecision: 1,
      pitSkill: 1,
      pitFocus: 1,
      tuneBonus: 0,
      tuningPoints: 0
    },
    events: [],
    t: 20,
    scale: 1,
    prevScale: 1,
    wet: 0,
    evo: 0,
    phase: 'run',
    uiT: 0,
    trafT: 0,
    goT: 0,
    camI: 0,
    mode: 'race',
    countT: 0,
    _lt: 0,
    laps: 10,
    chequered: false,
    finCount: 0,
    winT: 0,
    endT: 0,
    raining: false,
    rainAt: -1,
    rainEnd: -1
  };
}

function qualifyingSession(trackIndex: number): QualifyingSession {
  const base = raceSession(trackIndex);
  return {
    trk: base.trk,
    prof: base.prof,
    entries: [],
    config: base.config,
    events: [],
    t: 20,
    tEnd: 1_000,
    scale: 1,
    prevScale: 1,
    wet: 0,
    evo: 0,
    phase: 'run',
    uiT: 0,
    trafT: 0,
    goT: 0,
    camI: 0,
    mode: 'quali',
    done: false,
    over: false,
    mile: {}
  };
}

function placePit(
  session: Session,
  entry: ActiveEntry,
  state: 'pitIn' | 'pit' | 'pitOut',
  w: number,
  lateral: number,
  speed: number
): void {
  const point = session.trk.pit.posAt(w, lateral);
  entry.state = state;
  entry.pitW = w;
  entry.latNow = lateral;
  entry.lat = lateral;
  entry.spd = speed;
  entry.car.x = point.x;
  entry.car.y = point.y;
  entry.car.h = point.h;
  entry.car.vx = speed;
  entry.car.vy = 0;
  entry.car.s = (session.trk.pit.sEntry + w + session.trk.len) % session.trk.len;
  entry.car.progIdx = point.i;
}

describe('pit swept occupancy and reservations', () => {
  test('a stopped foreign box is never a travel-lane leader on any track or box pairing', () => {
    for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex++) {
      const session = raceSession(trackIndex);
      for (let travellerTeam = 0; travellerTeam < 6; travellerTeam++) {
        for (let stoppedTeam = 0; stoppedTeam < 6; stoppedTeam++) {
          if (travellerTeam === stoppedTeam) continue;
          const traveller = activeEntry(`T-${trackIndex}-${travellerTeam}-${stoppedTeam}`, travellerTeam);
          const stopped = activeEntry(`S-${trackIndex}-${travellerTeam}-${stoppedTeam}`, stoppedTeam);
          const stoppedW = session.trk.pit.boxWAt(stoppedTeam);
          placePit(session, traveller, 'pitIn', stoppedW - 20, session.trk.pit.laneOff, 14);
          traveller.pitPhase = 'travel';
          placePit(session, stopped, 'pit', stoppedW, session.trk.pit.boxOff, 0);
          stopped.pitPhase = 'stopped-box';
          session.entries = [traveller, stopped];

          expect(occupiesPitTravelLane(stopped, session)).toBe(false);
          expect(pitTrafficReference(traveller, session)).toBeNull();
          const occupancy = pitOccupancy(stopped, session);
          expect(occupancy?.stationary).toBe(true);
          expect(occupancy?.crossing).toBe(false);
        }
      }
    }
  });

  test('a real egress crossing remains a finite physical conflict', () => {
    const session = raceSession(0);
    const traveller = activeEntry('TRAVEL', 0);
    const crossing = activeEntry('CROSS', 1);
    const boxW = session.trk.pit.boxWAt(1);
    placePit(session, traveller, 'pitIn', boxW - 13, session.trk.pit.laneOff, 14);
    traveller.pitPhase = 'travel';
    placePit(session, crossing, 'pitOut', boxW + 2, session.trk.pit.laneOff + 1.2, 3);
    crossing.pitPhase = 'egress';
    session.entries = [traveller, crossing];

    const reference = pitTrafficReference(traveller, session);
    expect(reference?.entry).toBe(crossing);
    expect(reference?.reason).toBe('physical-crossing');
    expect(Number.isFinite(reference?.distance)).toBe(true);
  });

  test('a reserved crossing owner proceeds while through traffic yields to it', () => {
    const session = raceSession(0);
    const crossing = activeEntry('CROSSING-OWNER', 1);
    const ahead = activeEntry('LANE-AHEAD', 0);
    const behind = activeEntry('LANE-BEHIND', 2);
    const boxW = session.trk.pit.boxWAt(crossing.ti);

    placePit(session, crossing, 'pitOut', boxW + 2, session.trk.pit.laneOff + 1.2, 3);
    crossing.pitPhase = 'egress';
    session.entries = [crossing];
    expect(claimPitReservation(crossing, session, 'egress', boxW).granted).toBe(true);

    placePit(session, ahead, 'pitIn', boxW + 12, session.trk.pit.laneOff, 14);
    ahead.pitPhase = 'travel';
    placePit(session, behind, 'pitIn', boxW - 12, session.trk.pit.laneOff, 14);
    behind.pitPhase = 'travel';
    session.entries = [crossing, ahead, behind];

    expect(pitTrafficReference(crossing, session)).toBeNull();
    expect(pitTrafficReference(behind, session)).toMatchObject({
      entry: crossing,
      reason: 'physical-crossing'
    });
  });

  test('through-lane traffic blocks a box release and stale claims expire safely', () => {
    const session = raceSession(1);
    const release = activeEntry('RELEASE', 2);
    const traveller = activeEntry('LANE', 0);
    const boxW = session.trk.pit.boxWAt(2);
    placePit(session, release, 'pit', boxW, session.trk.pit.boxOff, 0);
    release.pitPhase = 'stopped-box';
    placePit(session, traveller, 'pitIn', boxW - 18, session.trk.pit.laneOff, 14);
    traveller.pitPhase = 'travel';
    session.entries = [release, traveller];

    const denied = claimPitReservation(release, session, 'egress', boxW);
    expect(denied.granted).toBe(false);
    expect(denied.reason).toBe('travel-lane');
    expect(denied.owner).toBe(traveller);

    traveller.state = 'run';
    const granted = claimPitReservation(release, session, 'egress', boxW);
    expect(granted.granted).toBe(true);
    expect(session.pitReservations?.size).toBe(1);
    session.t += 2.1;
    release.state = 'run';
    expect(claimPitReservation(traveller, session, 'ingress', boxW).granted).toBe(true);
    expect(session.pitReservations?.size).toBe(1);
  });

  test('egress ends once after rear-envelope clearance and cannot reacquire the old box claim', () => {
    const session = raceSession(0);
    const release = activeEntry('FINITE-EGRESS', 2);
    const boxW = session.trk.pit.boxWAt(release.ti);
    const clearW = pitEgressEndW(release, session);
    placePit(session, release, 'pitOut', boxW, session.trk.pit.boxOff, 0);
    release.pitPhase = 'egress';
    session.entries = [release];

    expect(claimPitReservation(release, session, 'egress', boxW).granted).toBe(true);
    expect(session.pitReservations?.size).toBe(1);

    placePit(session, release, 'pitOut', clearW + 0.01, session.trk.pit.laneOff, 5);
    release.pitPhase = 'egress';
    const cleared = planPitMotion(release, session);
    expect(cleared.phase).toBe('travel');
    expect(session.pitReservations?.size ?? 0).toBe(0);
    expect(release.pitReservationKey).toBeUndefined();

    release.pitPhase = cleared.phase;
    const next = planPitMotion(release, session);
    expect(next.phase).toBe('travel');
    expect(session.pitReservations?.size ?? 0).toBe(0);
    expect(release.pitReservationKey).toBeUndefined();
  });

  test('overlapping qualifying launches clear every team box on every track', () => {
    for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex++) {
      for (const reverse of [false, true]) {
        const session = qualifyingSession(trackIndex);
        const entries = Array.from({ length: 6 }, (_, teamIndex) =>
          activeEntry(`Q-${trackIndex}-${teamIndex}-${reverse ? 'R' : 'F'}`, teamIndex));
        session.entries = reverse ? entries.reverse() : entries;
        for (const entry of session.entries) launchFromPit(entry, session);

        const deadline = session.t + 55;
        while (session.t < deadline && session.entries.some(entry => entry.state !== 'run'))
          stepSession(session, 1 / 120);

        expect(session.entries.every(entry => entry.state === 'run')).toBe(true);
        expect(session.pitDeadlocks ?? []).toHaveLength(0);
        expect(session.pitReservations?.size ?? 0).toBe(0);
        for (const entry of session.entries) {
          expect(entry.pitW).toBeNull();
          expect(entry.pitReservationKey).toBeUndefined();
          expect(entry.pitPhase).toBeUndefined();
        }
      }
    }
  }, 45_000);

  test('sequential qualifying launches never inherit an earlier box reservation', () => {
    for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex++) {
      const session = qualifyingSession(trackIndex);
      session.entries = Array.from({ length: 6 }, (_, teamIndex) =>
        activeEntry(`SEQ-${trackIndex}-${teamIndex}`, teamIndex));
      for (const entry of session.entries) entry.state = 'box';

      let next = 0;
      const deadline = session.t + 70;
      while (session.t < deadline) {
        if (next < session.entries.length && session.t >= 20 + next * 0.6) {
          launchFromPit(session.entries[next]!, session);
          next++;
        }
        stepSession(session, 1 / 120);
        if (next === session.entries.length && session.entries.every(entry => entry.state === 'run'))
          break;
      }

      expect(next).toBe(session.entries.length);
      expect(session.entries.every(entry => entry.state === 'run')).toBe(true);
      expect(session.pitDeadlocks ?? []).toHaveLength(0);
      expect(session.pitReservations?.size ?? 0).toBe(0);
    }
  }, 15_000);

  test('a same-team double stack queues off the lane then advances to the box', () => {
    const session = raceSession(2);
    const serviced = activeEntry('SERVICE', 3);
    const incoming = activeEntry('INCOMING', 3);
    const boxW = session.trk.pit.boxWAt(3);
    const queue = pitQueuePoint(incoming, session);
    const ingressStart = pitIngressStartW(incoming, session, true);
    placePit(session, serviced, 'pit', boxW, session.trk.pit.boxOff, 0);
    serviced.pitPhase = 'stopped-box';
    placePit(session, incoming, 'pitIn', (ingressStart + queue.w) / 2,
      session.trk.pit.laneOff, 2);
    incoming.pitPhase = 'decelerate';
    session.entries = [serviced, incoming];

    const ingress = planPitMotion(incoming, session);
    expect(ingress.phase).toBe('ingress');
    expect(ingress.queued).toBe(true);
    expect(ingress.stopW).toBe(queue.w);
    expect(queue.off - session.trk.pit.laneOff).toBeGreaterThan(5);

    placePit(session, incoming, 'pitIn', queue.w, queue.off, 0);
    incoming.pitPhase = 'queued';
    const waiting = planPitMotion(incoming, session);
    expect(waiting.phase).toBe('queued');
    expect(waiting.speedCap).toBe(0);
    expect(occupiesPitTravelLane(incoming, session)).toBe(false);
    expect(pitSweptOccupanciesOverlap(
      pitOccupancy(serviced, session)!,
      pitOccupancy(incoming, session)!
    )).toBe(false);

    serviced.state = 'pitOut';
    serviced.pitPhase = 'egress';
    serviced.pitW = boxW + 9;
    const advancing = planPitMotion(incoming, session);
    expect(advancing.phase).toBe('ingress');
    expect(advancing.queued).toBe(false);
    expect(advancing.stopW).toBe(boxW);
    expect(Number.isFinite(advancing.speedCap)).toBe(true);
    expect(advancing.speedCap).toBeGreaterThanOrEqual(0);
  });

  test('a stationary wait produces an explicit deadlock diagnostic', () => {
    const session = raceSession(3);
    const waiting = activeEntry('WAIT', 0);
    const owner = activeEntry('OWNER', 0);
    placePit(session, waiting, 'pitIn', 40, session.trk.pit.laneOff, 0);
    waiting.pitPhase = 'decelerate';
    waiting.pitWaitReason = 'travel-lane';
    waiting.pitWaitOwner = owner.code;
    session.entries = [waiting, owner];

    notePitProgress(waiting, session);
    session.t += 4.1;
    notePitProgress(waiting, session);
    expect(session.pitDeadlocks?.length).toBe(1);
    expect(session.pitDeadlocks?.[0]).toMatchObject({
      code: 'WAIT',
      phase: 'decelerate',
      reason: 'travel-lane',
      owner: 'OWNER'
    });
  });

  test('a sampled pit path remains the sole lateral authority through box release', () => {
    const session = raceSession(0);
    const entry = activeEntry('PATH-OWNER', 0);
    const pit = session.trk.pit;
    const boxW = pit.boxWAt(entry.ti);
    const travelW = boxW - 12;
    placePit(session, entry, 'pitIn', travelW, pit.off(travelW), 8);
    entry.pitPhase = 'travel';
    entry.car.vx = Math.cos(entry.car.h) * entry.spd;
    entry.car.vy = Math.sin(entry.car.h) * entry.spd;
    session.entries = [entry];

    syncPitPaths(session, session.entries);
    expect(entry.pathMode).toBe('pit');
    expect(entry.path).toBeDefined();

    // The pit path already contains the absolute lane offset. A controller
    // tick must not copy that offset into the additive legacy scalar too.
    entry.botTick = 0;
    stepEntry(entry, session, 0.01, () => {});
    expect(entry.state).toBe('pitIn');
    expect(entry.lat).toBe(0);

    // Model the completed stop without replacing the scalar just verified,
    // then release through the same state transition used by a race session.
    const stopped = pit.posAt(boxW, pit.boxOff);
    entry.state = 'pit';
    entry.pitPhase = 'stopped-box';
    entry.pitW = boxW;
    entry.pitT = 0;
    entry.latNow = pit.boxOff;
    entry.spd = 0;
    entry.car.x = stopped.x;
    entry.car.y = stopped.y;
    entry.car.h = stopped.h;
    entry.car.vx = 0;
    entry.car.vy = 0;
    entry.car.s = (pit.sEntry + boxW) % session.trk.len;
    entry.car.progIdx = stopped.i;
    stepEntry(entry, session, 0.01, () => {});
    expect(entry.state as Entry['state']).toBe('pitOut');

    expect(() => syncPitPaths(session, session.entries)).not.toThrow();
    expect(entry.pathMode).toBe('pit');
    expect(entry.lat).toBe(0);
    expect(entry.pathMaxSlew ?? Infinity).toBeLessThanOrEqual(0.500001);
  });
});
