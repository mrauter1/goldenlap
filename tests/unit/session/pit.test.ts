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
import { createEntry } from '../../../src/session/entry';
import type { Entry, LineupEntry, RaceSession, Session } from '../../../src/session/model';
import {
  claimPitReservation,
  notePitProgress,
  occupiesPitTravelLane,
  pitIngressStartW,
  pitOccupancy,
  pitQueuePoint,
  pitSweptOccupanciesOverlap,
  pitTrafficReference,
  planPitMotion
} from '../../../src/session/pit';

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
});
