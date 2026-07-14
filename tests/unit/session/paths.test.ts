import { describe, expect, test } from 'bun:test';

import { botStep } from '../../../src/core/autopilot';
import type { Car, PathMode } from '../../../src/core/model';
import { derivePathGeometry } from '../../../src/core/racing-line';
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
import type {
  CornerRightsRecord,
  Entry,
  LineupEntry,
  PathPlan,
  PriorityRecord,
  RaceSession
} from '../../../src/session/model';
import {
  materializePathPlan,
  syncRacecraftPaths
} from '../../../src/session/racecraft/paths';

type ActiveEntry = Entry & { car: Car };

const TEAM = { id: 'path-test', name: 'Path Test', body: '#000', accent: '#fff' } as const;

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

function entry(code: string, teamIndex = 0): ActiveEntry {
  const value = createEntry({
    lineup: lineup(code),
    teamIndex,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  value.state = 'run';
  value.car = makeCar(0, 0, 0);
  return value as ActiveEntry;
}

function session(trackIndex = 0): RaceSession {
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

function placeAtIndex(sessionValue: RaceSession, value: ActiveEntry, index: number, speed = 28): void {
  const track = sessionValue.trk;
  const i = ((index % track.n) + track.n) % track.n;
  const offset = track.idealPath.off[i]!;
  const geometry = derivePathGeometry(track, track.idealPath);
  value.car.x = track.x[i]! + track.nx[i]! * offset;
  value.car.y = track.y[i]! + track.ny[i]! * offset;
  value.car.h = Math.atan2(geometry.ty[i]!, geometry.tx[i]!);
  value.car.vx = speed;
  value.car.vy = 0;
  value.car.s = i * track.step;
  value.car.progIdx = i;
  value.spd = speed;
  value.latNow = offset;
  value.lat = 0;
  value.latTgt = 0;
}

function ahead(sessionValue: RaceSession, index: number, metres: number): number {
  return (index + Math.round(metres / sessionValue.trk.step)) % sessionValue.trk.n;
}

describe('phase-varying sampled race paths', () => {
  test('materializes every required mode with one finite geometry/speed authority', () => {
    const modes: Exclude<PathMode, 'ideal'>[] = [
      'attack', 'defend', 'side-inside', 'side-outside', 'blue-yield',
      'qualifying-yield', 'priority-pass', 'tuck', 'pit'
    ];
    for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex++) {
      const race = session(trackIndex);
      const track = race.trk;
      const start = 100;
      for (const mode of modes) {
        const plan: PathPlan = mode === 'pit'
          ? {
              mode,
              key: `test:${track.def.id}:${mode}`,
              anchors: [
                { index: start, offset: track.idealPath.off[start]! },
                { index: ahead(race, start, 25), offset: track.pit.laneOff },
                { index: ahead(race, start, 60), offset: track.pit.boxOff }
              ]
            }
          : {
              mode,
              key: `test:${track.def.id}:${mode}`,
              anchors: [
                { index: start, offset: track.idealPath.off[start]! },
                { index: ahead(race, start, 25), offset: 2.1 },
                { index: ahead(race, start, 60), offset: -1.4 }
              ]
            };
        const path = materializePathPlan(track, plan);
        expect(path.mode).toBe(mode);
        expect(path.off.length).toBe(track.n);
        expect(path.k.length).toBe(track.n);
        expect(path.ds.length).toBe(track.n);
        expect(path.v.length).toBe(track.n);
        for (let index = 0; index < track.n; index++) {
          expect(Number.isFinite(path.off[index])).toBe(true);
          expect(Number.isFinite(path.k[index])).toBe(true);
          expect(Number.isFinite(path.ds[index])).toBe(true);
          expect(Number.isFinite(path.v[index])).toBe(true);
          expect(path.ds[index]!).toBeGreaterThan(0);
          expect(path.v[index]!).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('attack and defense use distinct phase shapes and rebuild only on a plan transition', () => {
    const race = session();
    const corner = race.trk.corners.find(candidate => candidate.isolated) ?? race.trk.corners[0]!;
    const attacker = entry('ATTACK');
    const defender = entry('DEFEND');
    placeAtIndex(race, attacker, corner.approachI);
    placeAtIndex(race, defender, corner.approachI);
    attacker.atkT = 3;
    attacker.atkCorner = corner.apexI;
    attacker.atkSide = corner.side * 2.8;
    defender.defT = 4;
    defender.defCorner = corner.apexI;
    defender.defAbs = corner.side * 2.2;
    race.entries = [attacker, defender];

    syncRacecraftPaths(race, race.entries);
    expect(attacker.pathMode).toBe('attack');
    expect(defender.pathMode).toBe('defend');
    expect(attacker.path).toBeDefined();
    expect(defender.path).toBeDefined();
    expect(attacker.pathMaxSlew).toBeLessThanOrEqual(0.5);
    expect(defender.pathMaxSlew).toBeLessThanOrEqual(0.5);
    const attackOffsets = [corner.turnInI, corner.apexI, corner.trackOutI]
      .map(index => attacker.path!.off[index]!);
    const defendOffsets = [corner.turnInI, corner.apexI, corner.trackOutI]
      .map(index => defender.path!.off[index]!);
    expect(attackOffsets).not.toEqual(defendOffsets);
    expect(new Set(attackOffsets.map((value, index) =>
      (value - defendOffsets[index]!).toFixed(6))).size).toBeGreaterThan(1);
    expect(attacker.path!.v[corner.apexI]!).toBeLessThanOrEqual(race.trk.idealPath.v[corner.apexI]!);

    const attackPath = attacker.path;
    const attackBuilds = attacker.pathBuildN;
    syncRacecraftPaths(race, race.entries);
    expect(attacker.path).toBe(attackPath);
    expect(attacker.pathBuildN).toBe(attackBuilds);
    if (!attacker.path) throw new Error('Attack path was not retained');
    const input = botStep(race.trk, race.prof, attacker.car, { path: attacker.path });
    expect(Number.isFinite(input.steer)).toBe(true);
    expect(Number.isFinite(input.throttle)).toBe(true);
    expect(Number.isFinite(input.brake)).toBe(true);
  });

  test('rights, priority, tuck, and pit arbitration select their explicit cached paths', () => {
    const race = session();
    const corner = race.trk.corners.find(candidate => candidate.isolated) ?? race.trk.corners[0]!;
    const inside = entry('INSIDE');
    const outside = entry('OUTSIDE');
    placeAtIndex(race, inside, corner.approachI);
    placeAtIndex(race, outside, corner.approachI);
    inside.latNow = corner.side * 0.8;
    outside.latNow = -corner.side * 0.8;
    const rights: CornerRightsRecord = {
      key: 'INSIDE|OUTSIDE',
      cornerId: corner.id,
      complexId: corner.complexId,
      inside,
      outside,
      insideCode: inside.code,
      outsideCode: outside.code,
      attackerCode: inside.code,
      defenderCode: outside.code,
      acquiredAt: race.t,
      acquiredPhase: 'approach',
      insideTarget: corner.side * 1.7,
      outsideTarget: -corner.side * 1.7,
      requiredSeparation: 3.4,
      lastSeenStamp: 1,
      clearFor: 0
    };
    race.cornerRights = new Map([[rights.key, rights]]);
    race.entries = [inside, outside];
    syncRacecraftPaths(race, race.entries);
    expect(inside.pathMode).toBe('side-inside');
    expect(outside.pathMode).toBe('side-outside');
    expect(inside.pathPlan?.mode === 'side-inside' ? inside.pathPlan.corridor : null).toBeDefined();
    expect(outside.pathPlan?.mode === 'side-outside' ? outside.pathPlan.corridor : null).toBeDefined();

    race.cornerRights.clear();
    const yielding = inside;
    const beneficiary = outside;
    yielding.priorityYield = { reason: 'blue-flag', beneficiary: beneficiary.code };
    const priority: PriorityRecord = {
      key: `${yielding.code}>${beneficiary.code}`,
      reason: 'blue-flag',
      yielding,
      beneficiary,
      acquiredAt: race.t,
      lastSeenAt: race.t,
      lastGap: 35,
      filteredClosing: 7,
      closingAge: 0,
      timeToCatch: 5,
      yieldSide: -(race.trk.hw - 2),
      detectedPhase: 'straight',
      holdUntilI: null,
      clearFor: 0,
      minimumGap: 35,
      maximumGap: 35,
      obstructionTime: 0,
      pathCrossings: 0,
      lastLateralOrder: 0,
      suppressionApplied: false,
      illegalDecisionActive: false
    };
    race.priorityRecords = new Map([[priority.key, priority]]);
    syncRacecraftPaths(race, race.entries);
    expect(yielding.pathMode).toBe('blue-yield');
    expect(beneficiary.pathMode).toBe('priority-pass');

    race.priorityRecords.clear();
    delete yielding.priorityYield;
    yielding.tuckT = 0.6;
    syncRacecraftPaths(race, [yielding]);
    expect(yielding.pathMode).toBe('tuck');
    const tuckPath = yielding.path;
    const tuckBuilds = yielding.pathBuildN;
    placeAtIndex(race, yielding, ahead(race, yielding.car.progIdx, 4));
    syncRacecraftPaths(race, [yielding]);
    expect(yielding.path).toBe(tuckPath);
    expect(yielding.pathBuildN).toBe(tuckBuilds);

    const pitCar = entry('PIT', 2);
    const pitW = 20;
    const pitIndex = Math.round(((race.trk.pit.sEntry + pitW) % race.trk.len) / race.trk.step) % race.trk.n;
    placeAtIndex(race, pitCar, pitIndex, 14);
    pitCar.state = 'pitIn';
    pitCar.pitW = pitW;
    pitCar.pitPhase = 'travel';
    pitCar.latNow = race.trk.pit.off(pitW);
    pitCar.lat = pitCar.latNow;
    syncRacecraftPaths(race, [pitCar]);
    expect(pitCar.pathMode).toBe('pit');
    expect(pitCar.path).toBeDefined();
    expect(pitCar.pathMaxSlew).toBeLessThanOrEqual(0.5);
  });
});
