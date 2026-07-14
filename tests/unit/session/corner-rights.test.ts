import { describe, expect, test } from 'bun:test';

import type { Car, LegacyCorner } from '../../../src/core/model';
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
import type { Entry, LineupEntry, RaceSession } from '../../../src/session/model';
import {
  applyCornerRights,
  longitudinalBodiesOverlap,
  longitudinalBodyProjection,
  ROOM_SEP,
  updateCornerRights
} from '../../../src/session/racecraft/corner-rights';
import { syncRacecraftPaths } from '../../../src/session/racecraft/paths';
import { TRAF_DT } from '../../../src/session/strategy';

type ActiveEntry = Entry & { car: Car };

const TEAM = { id: 'rights-test', name: 'Rights Test', body: '#000', accent: '#fff' } as const;

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

function activeEntry(code: string): ActiveEntry {
  const entry = createEntry({
    lineup: lineup(code),
    teamIndex: 0,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  entry.state = 'run';
  entry.car = makeCar(0, 0, 0);
  return entry as ActiveEntry;
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

function place(
  session: RaceSession,
  entry: ActiveEntry,
  index: number,
  lateral: number,
  longitudinalOffset = 0,
  speed = 30,
  yaw = 0
): void {
  const track = session.trk;
  const i = ((Math.round(index) % track.n) + track.n) % track.n;
  const heading = Math.atan2(track.ty[i]!, track.tx[i]!);
  entry.car.x = track.x[i]! + track.nx[i]! * lateral;
  entry.car.y = track.y[i]! + track.ny[i]! * lateral;
  entry.car.h = heading + yaw;
  entry.car.vx = speed;
  entry.car.vy = 0;
  entry.car.s = ((i * track.step + longitudinalOffset) % track.len + track.len) % track.len;
  entry.car.progIdx = i;
  entry.spd = speed;
  entry.latNow = lateral;
  entry.lat = lateral - track.idealPath.off[i]!;
  entry.latTgt = entry.lat;
  entry.cross = 2;
  entry.prog = entry.cross * track.len + entry.car.s;
}

function between(trackN: number, from: number, to: number, fraction: number): number {
  const span = (to - from + trackN) % trackN;
  return (from + Math.max(0, Math.round(span * fraction))) % trackN;
}

function cornerFixture(
  side: -1 | 1,
  predicate: (corner: LegacyCorner) => boolean = corner => corner.isolated
): { trackIndex: number; cornerId: string } {
  for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex++) {
    const session = raceSession(trackIndex);
    const corner = session.trk.corners.find(candidate => candidate.side === side && predicate(candidate));
    if (corner) return { trackIndex, cornerId: corner.id };
  }
  throw new Error(`No ${side > 0 ? 'left' : 'right'} corner fixture`);
}

function acquirePair(
  session: RaceSession,
  corner: LegacyCorner,
  index: number,
  attackerInside: boolean
): { attacker: ActiveEntry; defender: ActiveEntry } {
  const attacker = activeEntry('ATT');
  const defender = activeEntry('DEF');
  const attackerLateral = (attackerInside ? 1 : -1) * corner.side;
  place(session, attacker, index, attackerLateral, -1);
  place(session, defender, index, -attackerLateral, 1);
  attacker.atkT = 3;
  attacker.atkCorner = corner.apexI;
  attacker.atkSide = corner.side * 2.8;
  defender.defT = 4;
  defender.defCorner = corner.apexI;
  defender.defAbs = corner.side * 2.2;
  session.entries = [defender, attacker];
  updateCornerRights(session, [defender, attacker]);
  return { attacker, defender };
}

describe('persistent semantic corner rights', () => {
  test('uses wrap-aware oriented body extents and bumper clearance', () => {
    const session = raceSession(0);
    const first = activeEntry('A');
    const second = activeEntry('B');
    place(session, first, session.trk.n - 1, -1, 0);
    place(session, second, 0, 1, 0);
    first.car.s = session.trk.len - 1;
    second.car.s = 1;
    const wrapped = longitudinalBodyProjection(session.trk, first, second);
    expect(wrapped.signedDistance).toBeCloseTo(2, 6);
    expect(wrapped.overlap).toBe(true);
    expect(longitudinalBodiesOverlap(session.trk, first, second)).toBe(true);

    second.car.s = (first.car.s + 6.05) % session.trk.len;
    const clear = longitudinalBodyProjection(session.trk, first, second);
    expect(clear.overlap).toBe(false);
    expect(clear.clearance).toBeCloseTo(0.65, 5);
    first.car.h += Math.PI / 2;
    const yawed = longitudinalBodyProjection(session.trk, first, second);
    expect(yawed.firstHalfExtent).toBeLessThan(clear.firstHalfExtent);
  });

  test('latches roles and corridors through every side/order/timer/wet acquisition case', () => {
    for (const side of [-1, 1] as const) {
      const fixture = cornerFixture(side);
      for (const wet of [0, 0.7]) {
        for (const phase of ['approach', 'brake'] as const) {
          for (const attackerInside of [false, true]) {
            const session = raceSession(fixture.trackIndex);
            session.wet = wet;
            const corner = session.trk.corners.find(candidate => candidate.id === fixture.cornerId)!;
            const index = phase === 'approach'
              ? between(session.trk.n, corner.approachI, corner.brakeI, 0.35)
              : between(session.trk.n, corner.brakeI, corner.turnInI, 0.5);
            const { attacker, defender } = acquirePair(session, corner, index, attackerInside);
            const record = [...session.cornerRights!.values()][0]!;
            expect(session.cornerRights?.size).toBe(1);
            expect(record.acquiredPhase).toBe(phase);
            expect(record.inside).toBe(attackerInside ? attacker : defender);
            expect(record.outside).toBe(attackerInside ? defender : attacker);
            expect(record.defenseCancelled).toBe(true);
            expect(attacker.defT).toBe(0);
            expect(defender.defT).toBe(0);
            expect(record.requiredSeparation).toBeLessThanOrEqual(ROOM_SEP);
            expect(corner.side * (record.insideTarget - record.outsideTarget))
              .toBeCloseTo(record.requiredSeparation, 8);
            expect(session.cornerRightsAssignments?.size).toBe(2);

            const insideIdentity = record.inside;
            const outsideIdentity = record.outside;
            attacker.atkT = 0;
            defender.defT = 0;
            const apexIndex = between(session.trk.n, corner.turnInI, corner.apexI, 0.6);
            place(session, attacker, apexIndex, attacker.latNow, 1);
            place(session, defender, apexIndex, defender.latNow, -1);
            session.t += 0.1;
            updateCornerRights(session, [attacker, defender]);
            applyCornerRights(session);
            expect(session.cornerRights?.size).toBe(1);
            expect(record.inside).toBe(insideIdentity);
            expect(record.outside).toBe(outsideIdentity);
            expect(record.violationCount).toBe(0);
            expect(Number.isFinite(attacker.vCap)).toBe(true);
            expect(Number.isFinite(defender.vCap)).toBe(true);
          }
        }
      }
    }
  });

  test('acquires independently of attack intent and releases when racing state ends', () => {
    const fixture = cornerFixture(1);
    const session = raceSession(fixture.trackIndex);
    const corner = session.trk.corners.find(candidate => candidate.id === fixture.cornerId)!;
    const first = activeEntry('FIRST');
    const second = activeEntry('SECOND');
    place(session, first, corner.approachI, corner.side, -1);
    place(session, second, corner.approachI, -corner.side, 1);
    session.entries = [first, second];

    expect(first.atkT).toBe(0);
    expect(second.defT).toBe(0);
    updateCornerRights(session, [first, second]);
    const record = [...session.cornerRights!.values()][0]!;
    expect(session.cornerRights?.size).toBe(1);
    expect(record.attackerCode).toBeNull();
    expect(record.defenderCode).toBeNull();
    expect(record.defenseCancelled).toBe(false);

    second.state = 'dnf';
    session.t += TRAF_DT;
    updateCornerRights(session, [first, second]);
    expect(session.cornerRights?.size).toBe(0);
    expect(session.cornerRightsAssignments?.size).toBe(0);
    expect(session.cornerRightsHistory?.at(-1)?.release).toBe('state');
  });

  test('predicts convergence and reduces speed before roles cross', () => {
    const fixture = cornerFixture(1);
    const session = raceSession(fixture.trackIndex);
    const corner = session.trk.corners.find(candidate => candidate.id === fixture.cornerId)!;
    const { attacker, defender } = acquirePair(session, corner, corner.brakeI, true);
    const record = [...session.cornerRights!.values()][0]!;
    record.inside.latNow = corner.side * 0.75;
    record.outside.latNow = -corner.side * 0.75;
    attacker.vCap = defender.vCap = Infinity;
    session.t += 0.1;
    updateCornerRights(session, [attacker, defender]);
    applyCornerRights(session);
    expect(record.closingRate).toBeGreaterThan(0);
    expect(record.predictedSeparation).toBeLessThan(1.5);
    expect(attacker.vCap).toBeLessThan(Infinity);
    expect(defender.vCap).toBeLessThan(Infinity);
    expect(record.violationCount).toBe(0);
  });

  test('hands an alongside pair through a linked complex without dropping protection', () => {
    let selected: { trackIndex: number; firstId: string; nextId: string } | null = null;
    for (let trackIndex = 0; trackIndex < TRACK_DEFS.length && !selected; trackIndex++) {
      const session = raceSession(trackIndex);
      for (const first of session.trk.corners) {
        if (!first.complexId) continue;
        const candidates = session.trk.corners
          .filter(candidate => candidate.id !== first.id && candidate.complexId === first.complexId)
          .map(candidate => ({
            candidate,
            distance: ((candidate.turnInI - first.trackOutI + session.trk.n) % session.trk.n) *
              session.trk.step
          }))
          .filter(value => value.distance > 0.5 && value.distance < session.trk.len / 2)
          .sort((left, right) => left.distance - right.distance);
        if (candidates[0]) {
          selected = { trackIndex, firstId: first.id, nextId: candidates[0].candidate.id };
          break;
        }
      }
    }
    if (!selected) throw new Error('No linked-corner fixture');
    const session = raceSession(selected.trackIndex);
    const first = session.trk.corners.find(corner => corner.id === selected!.firstId)!;
    const pair = acquirePair(session, first, first.brakeI, true);
    const record = [...session.cornerRights!.values()][0]!;
    const afterTrackOut = (first.trackOutI + 1) % session.trk.n;
    place(session, pair.attacker, afterTrackOut, pair.attacker.latNow, -1);
    place(session, pair.defender, afterTrackOut, pair.defender.latNow, 1);
    session.t += 0.1;
    updateCornerRights(session, [pair.attacker, pair.defender]);
    expect(session.cornerRights?.size).toBe(1);
    expect(record.cornerId).toBe(selected.nextId);
    expect(record.handoffs).toBe(1);
    expect(session.cornerRightsHandoffs).toBe(1);
    expect(session.cornerRightsHistory?.length).toBe(0);
  });

  test('releases only after track-out plus 0.5 m bumper clearance for 0.5 s, then rejoins ideal', () => {
    const fixture = cornerFixture(-1);
    const session = raceSession(fixture.trackIndex);
    const corner = session.trk.corners.find(candidate => candidate.id === fixture.cornerId)!;
    const pair = acquirePair(session, corner, corner.brakeI, false);
    syncRacecraftPaths(session, [pair.attacker, pair.defender]);
    expect(new Set([pair.attacker.pathMode, pair.defender.pathMode]))
      .toEqual(new Set(['side-inside', 'side-outside']));

    const afterTrackOut = (corner.trackOutI + 2) % session.trk.n;
    place(session, pair.attacker, afterTrackOut, pair.attacker.latNow, -3.2);
    place(session, pair.defender, afterTrackOut, pair.defender.latNow, 3.2);
    const clearTicks = Math.ceil(0.5 / TRAF_DT);
    for (let step = 0; step < clearTicks - 1; step++) {
      session.t += TRAF_DT;
      updateCornerRights(session, [pair.attacker, pair.defender]);
      expect(session.cornerRights?.size).toBe(1);
    }
    session.t += TRAF_DT;
    updateCornerRights(session, [pair.attacker, pair.defender]);
    expect(session.cornerRights?.size).toBe(0);
    expect(session.cornerRightsHistory?.at(-1)?.release).toBe('track-out-clear');

    syncRacecraftPaths(session, [pair.attacker, pair.defender]);
    expect(pair.attacker.pathMode).toBe('tuck');
    expect(pair.defender.pathMode).toBe('tuck');
    for (const entry of [pair.attacker, pair.defender]) {
      if (entry.pathPlan?.mode !== 'tuck') throw new Error('Missing rejoin path');
      const end = entry.pathPlan.anchors.at(-1)!.index;
      place(session, entry, end, session.trk.idealPath.off[end]!);
      entry.tuckT = 0;
    }
    syncRacecraftPaths(session, [pair.attacker, pair.defender]);
    expect(pair.attacker.pathMode).toBe('ideal');
    expect(pair.defender.pathMode).toBe('ideal');
  });

  test('tucks a non-overlapping attempt at turn-in', () => {
    const fixture = cornerFixture(1);
    const session = raceSession(fixture.trackIndex);
    const corner = session.trk.corners.find(candidate => candidate.id === fixture.cornerId)!;
    const attacker = activeEntry('ATT');
    const leader = activeEntry('LEAD');
    place(session, attacker, corner.turnInI, corner.side, -4.5);
    place(session, leader, corner.turnInI, -corner.side, 4.5);
    attacker.atkT = 3;
    attacker.atkCorner = corner.apexI;
    session.entries = [attacker, leader];
    updateCornerRights(session, [attacker, leader]);
    expect(session.cornerRights?.size).toBe(0);
    expect(attacker.atkT).toBe(0);
    expect(attacker.tuckT).toBeGreaterThan(0);
    expect(attacker._tuckWith).toBe(leader.code);
    expect(attacker._tuckCorner).toBe(corner.apexI);
  });

  test('allocates feasible three-wide corridors and tucks the rearmost infeasible arrival', () => {
    const fixture = cornerFixture(-1);
    for (const feasible of [true, false]) {
      const session = raceSession(fixture.trackIndex);
      const corner = session.trk.corners.find(candidate => candidate.id === fixture.cornerId)!;
      const front = activeEntry('FRONT');
      const middle = activeEntry('MIDDLE');
      const rear = activeEntry('REAR');
      const laterals = feasible
        ? [-2 * corner.side, 0, 2 * corner.side]
        : [-0.4 * corner.side, 0, 0.4 * corner.side];
      place(session, front, (corner.brakeI + 1) % session.trk.n, laterals[0]!, 0.6);
      place(session, middle, corner.brakeI, laterals[1]!, 0);
      place(session, rear, (corner.brakeI - 1 + session.trk.n) % session.trk.n, laterals[2]!, -0.6);
      rear.atkT = 3;
      rear.atkCorner = corner.apexI;
      session.entries = [front, middle, rear];
      updateCornerRights(session, [front, middle, rear]);
      if (feasible) {
        expect(session.cornerRightsAssignments?.size).toBe(3);
        expect(session.cornerRightsThreeCarFallbacks ?? 0).toBe(0);
        const targets = [...session.cornerRightsAssignments!.values()]
          .map(assignment => corner.side * assignment.target).sort((a, b) => a - b);
        expect(targets[1]! - targets[0]!).toBeCloseTo(ROOM_SEP, 8);
        expect(targets[2]! - targets[1]!).toBeCloseTo(ROOM_SEP, 8);
      } else {
        expect(session.cornerRightsAssignments?.size).toBe(2);
        expect(session.cornerRightsThreeCarFallbacks).toBe(1);
        expect(rear.tuckT).toBeGreaterThan(0);
        expect(session.cornerRights?.size).toBe(1);
        expect(session.cornerRightsHistory?.filter(item => item.release === 'three-car-tuck').length)
          .toBe(2);
      }
    }
  });
});
