import { describe, expect, test } from 'bun:test';

import type { Car, LegacyCorner, Track } from '../../../src/core/model';
import { PHYS } from '../../../src/core/physics';
import { makeCar } from '../../../src/core/physics-engine';
import {
  detectSemanticCorners,
  legacyRacingLine,
  nextCorner,
  racingLine,
  refineSemanticCorners,
  speedProfile
} from '../../../src/core/racing-line';
import { buildTrack } from '../../../src/core/track';
import { TRACK_DEFS } from '../../../src/data/tracks';
import { boxQualifyingCar } from '../../../src/session/commands';
import { createEntry, launchFromPit } from '../../../src/session/entry';
import type {
  Entry, LineupEntry, QualifyingSession, RaceSession, Session
} from '../../../src/session/model';
import {
  applyPriorityRecords,
  qualifyingLapPhase,
  updatePriorityRecords
} from '../../../src/session/racecraft/priority';
import { idxInWindow, updateCornerRights } from '../../../src/session/racecraft/corner-rights';
import { syncRacecraftPaths } from '../../../src/session/racecraft/paths';
import { onLine } from '../../../src/session/session';
import { TRAF_DT } from '../../../src/session/strategy';

type ActiveEntry = Entry & { car: Car };

const TEAM = { id: 'test', name: 'Test', body: '#000', accent: '#fff' } as const;

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

function entry(code: string): ActiveEntry {
  const value = createEntry({
    lineup: lineup(code),
    teamIndex: 0,
    modifiers: { pw: 1, dr: 1, hMu: 1 }
  });
  value.state = 'run';
  value.car = makeCar(0, 0, 0);
  return value as ActiveEntry;
}

function session(mode: 'race' | 'quali'): Session {
  const track = buildTrack(TRACK_DEFS[0]!, 6);
  const profile = speedProfile(track);
  detectSemanticCorners(track, profile);
  refineSemanticCorners(track, legacyRacingLine(track));
  const idealPath = racingLine(track);
  const idealProfile = speedProfile(track, idealPath);
  idealPath.v = idealProfile.v;
  track.idealPath = idealPath;
  track.idealTiming = { t: idealProfile.t, lapTime: idealProfile.lapTime };
  if (!track.corners) throw new Error('Corner build failed');
  const base = {
    trk: track as RaceSession['trk'],
    prof: profile,
    entries: [] as Entry[],
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
    phase: 'run' as const,
    uiT: 0,
    trafT: 0,
    goT: 0,
    camI: 0
  };
  if (mode === 'quali') {
    return {
      ...base,
      mode,
      done: false,
      over: false,
      tEnd: 1200,
      mile: {}
    } satisfies QualifyingSession;
  }
  return {
    ...base,
    mode,
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
  } satisfies RaceSession;
}

function place(
  sessionValue: Session,
  value: ActiveEntry,
  s: number,
  speed: number,
  cross: number,
  lateral = 0
): void {
  const track = sessionValue.trk;
  const wrapped = ((s % track.len) + track.len) % track.len;
  const index = Math.round(wrapped / track.step) % track.n;
  value.car.x = track.x[index]! + track.nx[index]! * lateral;
  value.car.y = track.y[index]! + track.ny[index]! * lateral;
  value.car.h = Math.atan2(track.ty[index]!, track.tx[index]!);
  value.car.vx = speed;
  value.car.vy = 0;
  value.car.s = wrapped;
  value.car.progIdx = index;
  value.spd = speed;
  value.cross = cross;
  value.prog = cross * track.len + wrapped;
  value.latNow = lateral;
  value.lat = lateral - (track.idealPath.off[index] ?? 0);
  value.latTgt = 0;
}

function active(entries: Entry[]): ActiveEntry[] {
  return entries.filter((value): value is ActiveEntry => value.car != null);
}

function placePairAtGap(
  sessionValue: Session,
  beneficiary: ActiveEntry,
  yielding: ActiveEntry,
  gap: number,
  yieldingSpeed: number,
  closing: number,
  baseS = 100,
  lateral = 0
): void {
  place(sessionValue, beneficiary, baseS, yieldingSpeed + closing,
    sessionValue.mode === 'race' ? 2 : 1, -lateral);
  place(sessionValue, yielding, baseS + PHYS.carLen + gap, yieldingSpeed, 1, lateral);
}

function straightIndex(track: Track): number {
  const corners = track.corners ?? [];
  for (let index = 0; index < track.n; index += 2) {
    const protectedPhase = corners.some(corner =>
      idxInWindow(track, index, corner.approachI, corner.trackOutI));
    if (!protectedPhase) return index;
  }
  throw new Error(`Track ${track.def.id} has no straight fixture`);
}

function phaseIndex(corner: LegacyCorner, phase: 'approach' | 'corner'): number {
  return phase === 'approach' ? corner.approachI : corner.turnInI;
}

describe('persistent priority records', () => {
  test('blue-flag state survives an order change and releases only after clearance', () => {
    const race = session('race');
    const beneficiary = entry('FAST');
    const yielding = entry('LAP');
    race.entries = [beneficiary, yielding];
    place(race, beneficiary, 100, 36, 2);
    place(race, yielding, 132, 29, 1);

    updatePriorityRecords(race, active(race.entries));
    expect(race.priorityRecords?.size).toBe(1);
    const record = [...race.priorityRecords!.values()][0]!;
    expect(record.reason).toBe('blue-flag');
    expect(record.beneficiary).toBe(beneficiary);
    expect(record.yielding).toBe(yielding);
    applyPriorityRecords(race);
    expect(yielding.priorityYield).toEqual({ reason: 'blue-flag', beneficiary: 'FAST' });
    expect(yielding.atkT).toBe(0);
    expect(yielding.defT).toBe(0);

    place(race, beneficiary, 134, 32, 2);
    place(race, yielding, 132, 29, 1);
    for (let count = 0; count < 20; count++) {
      race.t += TRAF_DT;
      updatePriorityRecords(race, active(race.entries));
    }
    expect(race.priorityRecords?.size).toBe(1);

    place(race, yielding, 200, 29, 1);
    place(race, beneficiary, 200 + PHYS.carLen + 2.5, 34, 2);
    for (let count = 0; count < Math.ceil(0.5 / TRAF_DT) + 1; count++) {
      race.t += TRAF_DT;
      updatePriorityRecords(race, active(race.entries));
    }
    expect(race.priorityRecords?.size).toBe(0);
    expect(race.priorityHistory?.at(-1)?.release).toBe('physical-clearance');
  });

  test('qualifying grants flying laps priority over out and in laps only', () => {
    for (const phase of ['out', 'in'] as const) {
      const qualifying = session('quali');
      const beneficiary = entry(`FLY-${phase}`);
      const yielding = entry(`YIELD-${phase}`);
      beneficiary.lapPhase = 'flying';
      beneficiary.lapLive = true;
      yielding.lapPhase = phase;
      yielding.lapLive = false;
      if (phase === 'in') yielding.boxArm = true;
      qualifying.entries = [beneficiary, yielding];
      place(qualifying, beneficiary, 100, 36, 1);
      place(qualifying, yielding, 140, 28, 1);
      updatePriorityRecords(qualifying, active(qualifying.entries));
      expect(qualifying.priorityRecords?.size).toBe(1);
      expect([...qualifying.priorityRecords!.values()][0]!.reason).toBe('qualifying');
    }

    const bothFlying = session('quali');
    const first = entry('FLY-A');
    const second = entry('FLY-B');
    first.lapPhase = second.lapPhase = 'flying';
    first.lapLive = second.lapLive = true;
    bothFlying.entries = [first, second];
    place(bothFlying, first, 100, 36, 1);
    place(bothFlying, second, 140, 28, 1);
    updatePriorityRecords(bothFlying, active(bothFlying.entries));
    expect(bothFlying.priorityRecords?.size ?? 0).toBe(0);
  });

  test('rejects distant or non-closing catches and queues sequential beneficiaries', () => {
    const race = session('race');
    const first = entry('FAST-1');
    const second = entry('FAST-2');
    const yielding = entry('LAPPED');
    race.entries = [first, second, yielding];
    place(race, first, 100, 28, 2);
    place(race, second, 70, 35, 2);
    place(race, yielding, 250, 30, 1);
    updatePriorityRecords(race, active(race.entries));
    expect(race.priorityRecords?.size ?? 0).toBe(0);

    place(race, first, 135, 36, 2);
    place(race, second, 115, 37, 2);
    place(race, yielding, 170, 29, 1);
    updatePriorityRecords(race, active(race.entries));
    expect(race.priorityRecords?.size).toBe(2);
    applyPriorityRecords(race);
    expect(yielding.priorityYield?.beneficiary).toBe('FAST-1');
  });

  test('keeps the legacy lapLive facade aligned with canonical phases', () => {
    const value = entry('PHASE');
    value.lapPhase = 'out';
    value.lapLive = false;
    expect(qualifyingLapPhase(value)).toBe('out');
    value.lapPhase = 'flying';
    value.lapLive = true;
    expect(qualifyingLapPhase(value)).toBe('flying');
    value.lapPhase = 'in';
    value.boxArm = true;
    value.lapLive = false;
    expect(qualifyingLapPhase(value)).toBe('in');
  });

  test('keeps the canonical qualifying lifecycle aligned from pit exit through boxing', () => {
    const qualifying = session('quali');
    const value = entry('LIFECYCLE');
    value.isPlayer = true;
    value.ci = 0;
    value.state = 'box';
    value.hotLeft = 99;
    qualifying.entries = [value];

    launchFromPit(value, qualifying);
    expect(value.state as Entry['state']).toBe('pitOut');
    expect(value.lapPhase).toBe('out');
    expect(value.lapLive).toBeFalse();
    expect(qualifyingLapPhase(value)).toBe('out');

    value.state = 'run';
    qualifying.t = 30;
    onLine(value, qualifying, true);
    expect(value.lapPhase).toBe('flying');
    expect(value.lapLive).toBeTrue();
    qualifying.t += 80;
    onLine(value, qualifying, true);
    expect(value.lapPhase).toBe('flying');
    expect(value.lapLive).toBeTrue();

    expect(boxQualifyingCar(qualifying, 0)).toBe(value);
    expect(value.lapPhase).toBe('in');
    expect(value.lapLive).toBeFalse();
    expect(qualifyingLapPhase(value)).toBe('in');
  });

  test('applies the blue and qualifying closing/TTC gates with wet scaling', () => {
    function detects(
      mode: 'race' | 'quali',
      gap: number,
      closing: number,
      wet: number
    ): boolean {
      const value = session(mode);
      value.wet = wet;
      const beneficiary = entry('BENEFICIARY');
      const yielding = entry('YIELDING');
      value.entries = [beneficiary, yielding];
      if (mode === 'quali') {
        beneficiary.lapPhase = 'flying';
        beneficiary.lapLive = true;
        yielding.lapPhase = 'out';
        yielding.lapLive = false;
      }
      placePairAtGap(value, beneficiary, yielding, gap, 30, closing);
      updatePriorityRecords(value, active(value.entries));
      return value.priorityRecords?.size === 1;
    }

    const cases: ReadonlyArray<{
      mode: 'race' | 'quali'; gap: number; closing: number; wet: number; expected: boolean;
    }> = [
      { mode: 'race', gap: 119.9, closing: 30, wet: 0, expected: true },
      { mode: 'race', gap: 120.1, closing: 40, wet: 0, expected: false },
      { mode: 'race', gap: 54.9, closing: -1, wet: 0, expected: true },
      { mode: 'race', gap: 55.1, closing: 0, wet: 0, expected: false },
      { mode: 'race', gap: 54.9, closing: -1.01, wet: 0, expected: false },
      { mode: 'race', gap: 149.9, closing: 30, wet: 1, expected: true },
      { mode: 'race', gap: 149.9, closing: 30, wet: 0, expected: false },
      { mode: 'quali', gap: 179.9, closing: 36, wet: 0, expected: true },
      { mode: 'quali', gap: 180.1, closing: 50, wet: 0, expected: false },
      { mode: 'quali', gap: 74.9, closing: -1, wet: 0, expected: true },
      { mode: 'quali', gap: 75.1, closing: 0, wet: 0, expected: false },
      { mode: 'quali', gap: 224.9, closing: 36, wet: 1, expected: true },
      { mode: 'quali', gap: 224.9, closing: 36, wet: 0, expected: false }
    ];
    for (const scenario of cases)
      expect(detects(scenario.mode, scenario.gap, scenario.closing, scenario.wet))
        .toBe(scenario.expected);
  });

  test('rejects cars off the racing surface and tracks one activation per eligible pair', () => {
    for (const invalid of ['beneficiary-off', 'yielding-off', 'outside-road'] as const) {
      const race = session('race');
      const beneficiary = entry('FAST');
      const yielding = entry('LAPPED');
      race.entries = [beneficiary, yielding];
      placePairAtGap(race, beneficiary, yielding, 35, 29, 7);
      if (invalid === 'beneficiary-off') beneficiary.car.offCourse = true;
      if (invalid === 'yielding-off') yielding.car.offCourse = true;
      if (invalid === 'outside-road') yielding.latNow = race.trk.hw + 0.31;
      updatePriorityRecords(race, active(race.entries));
      expect(race.priorityRecords?.size ?? 0).toBe(0);
      expect(race.priorityActivations ?? 0).toBe(0);
    }

    const race = session('race');
    const beneficiary = entry('FAST');
    const yielding = entry('LAPPED');
    race.entries = [beneficiary, yielding];
    placePairAtGap(race, beneficiary, yielding, 35, 29, 7);
    updatePriorityRecords(race, active(race.entries));
    updatePriorityRecords(race, active(race.entries));
    expect(race.priorityRecords?.size).toBe(1);
    expect(race.priorityActivations).toBe(1);
    expect(race.blueFlagActivations).toBe(1);
    expect(race.qualifyingPriorityActivations ?? 0).toBe(0);
  });

  test('selects stable phase-aware yield paths for left/right corners in dry and wet', () => {
    for (const side of [-1, 1] as const) {
      for (const wet of [0, 0.7]) {
        for (const phase of ['approach', 'corner'] as const) {
          const race = session('race');
          race.wet = wet;
          const corner = race.trk.corners.find(candidate =>
            candidate.side === side &&
            nextCorner(race.trk, phaseIndex(candidate, phase))?.id === candidate.id);
          if (!corner) throw new Error(`Missing ${side} corner fixture`);
          const beneficiary = entry(`FAST-${side}-${wet}-${phase}`);
          const yielding = entry(`LAP-${side}-${wet}-${phase}`);
          race.entries = [beneficiary, yielding];
          const index = phaseIndex(corner, phase);
          const yieldingS = index * race.trk.step;
          place(race, yielding, yieldingS, 29, 1);
          place(race, beneficiary, yieldingS - PHYS.carLen - 32, 36, 2);
          yielding.atkT = 3;
          yielding.defT = 3;
          yielding.lungeT = 1;

          updatePriorityRecords(race, active(race.entries));
          applyPriorityRecords(race);
          syncRacecraftPaths(race, race.entries);
          const record = [...(race.priorityRecords?.values() ?? [])][0];
          expect(record?.detectedPhase).toBe(phase);
          expect(record?.yieldSide).toBe(
            (phase === 'approach' ? -corner.side : corner.side) *
              (race.trk.hw - PHYS.carWid / 2 - 0.6)
          );
          expect(record?.holdUntilI).toBe(corner.trackOutI);
          expect(yielding.pathMode).toBe('blue-yield');
          expect(beneficiary.pathMode).toBe('priority-pass');
          expect(yielding.pathPlan?.key).toContain(phase);
          expect(yielding.atkT).toBe(0);
          expect(yielding.defT).toBe(0);
          expect(yielding.lungeT).toBe(0);
          expect(yielding.pathMaxSlew ?? 0).toBeLessThanOrEqual(0.500001);
        }
      }
    }
  });

  test('uses the exact ideal authority when safe and stable opposite corridors mid-corner', () => {
    const straightRace = session('race');
    const straightBeneficiary = entry('FAST-STRAIGHT');
    const straightYielding = entry('LAPPED-STRAIGHT');
    straightRace.entries = [straightBeneficiary, straightYielding];
    const straight = straightIndex(straightRace.trk);
    const yieldingS0 = straight * straightRace.trk.step;
    const beneficiaryS0 = yieldingS0 - PHYS.carLen - 32;
    const beneficiaryI0 = ((Math.round(beneficiaryS0 / straightRace.trk.step) %
      straightRace.trk.n) + straightRace.trk.n) % straightRace.trk.n;
    place(straightRace, straightYielding, yieldingS0, 29, 1,
      straightRace.trk.idealPath.off[straight]!);
    place(straightRace, straightBeneficiary, beneficiaryS0, 36, 2,
      straightRace.trk.idealPath.off[beneficiaryI0]!);
    updatePriorityRecords(straightRace, active(straightRace.entries));
    applyPriorityRecords(straightRace);
    syncRacecraftPaths(straightRace, straightRace.entries);
    expect(straightBeneficiary.pathMode).toBe('priority-pass');
    expect(straightBeneficiary.path?.off).toBe(straightRace.trk.idealPath.off);
    expect(straightBeneficiary.path?.k).toBe(straightRace.trk.idealPath.k);
    expect(straightBeneficiary.path?.ds).toBe(straightRace.trk.idealPath.ds);
    expect(straightBeneficiary.path?.v).toBe(straightRace.trk.idealPath.v);

    const race = session('race');
    const corner = race.trk.corners.find(candidate =>
      candidate.isolated && nextCorner(race.trk, candidate.turnInI)?.id !== candidate.id) ??
      race.trk.corners.find(candidate => candidate.isolated) ?? race.trk.corners[0]!;
    const beneficiary = entry('FAST-IDEAL');
    const yielding = entry('LAPPED-CORNER');
    race.entries = [beneficiary, yielding];
    const index = corner.turnInI;
    const lateral = race.trk.idealPath.off[index]!;
    const yieldingS = index * race.trk.step;
    place(race, yielding, yieldingS, 29, 1, lateral);
    place(race, beneficiary, yieldingS - PHYS.carLen - 32, 36, 2,
      race.trk.idealPath.off[
        Math.round((yieldingS - PHYS.carLen - 32 + race.trk.len) % race.trk.len /
          race.trk.step) % race.trk.n
      ]!);

    updatePriorityRecords(race, active(race.entries));
    applyPriorityRecords(race);
    syncRacecraftPaths(race, race.entries);

    const record = [...(race.priorityRecords?.values() ?? [])][0]!;
    expect(record.detectedPhase).toBe('corner');
    expect(record.holdUntilI).toBe(corner.trackOutI);
    expect(beneficiary.pathMode).toBe('priority-pass');
    expect(beneficiary.pathPlan?.key).toEndWith(':corner-side');
    expect(Math.sign(beneficiary.path!.off[corner.trackOutI]!))
      .toBe(-Math.sign(record.yieldSide));
    expect(yielding.path?.off[corner.apexI]).toBeCloseTo(lateral, 9);
    expect(yielding.path?.off[corner.trackOutI]).toBeCloseTo(record.yieldSide, 9);
  });

  test('preserves an existing off-line side and the authored pit-entry path', () => {
    const offLineRace = session('race');
    const fast = entry('FAST-OFF');
    const offLine = entry('LAPPED-OFF');
    offLineRace.entries = [fast, offLine];
    const index = straightIndex(offLineRace.trk);
    const lateral = offLineRace.trk.hw - 2.1;
    const yieldingS = index * offLineRace.trk.step;
    place(offLineRace, offLine, yieldingS, 29, 1, lateral);
    place(offLineRace, fast, yieldingS - PHYS.carLen - 35, 36, 2, -lateral);
    updatePriorityRecords(offLineRace, active(offLineRace.entries));
    applyPriorityRecords(offLineRace);
    syncRacecraftPaths(offLineRace, offLineRace.entries);
    const offLineRecord = [...offLineRace.priorityRecords!.values()][0]!;
    expect(offLineRecord.detectedPhase).toBe('straight');
    expect(offLineRecord.yieldSide).toBe(
      offLineRace.trk.hw - PHYS.carWid / 2 - 0.6
    );
    expect(offLine.pathMode).toBe('blue-yield');

    const pitRace = session('race');
    const pitFast = entry('FAST-PIT');
    const pitYield = entry('LAPPED-PIT');
    pitRace.entries = [pitFast, pitYield];
    placePairAtGap(pitRace, pitFast, pitYield, 35, 29, 7,
      pitRace.trk.pit.sEntry - 100);
    pitYield.pitArm = { comp: 'H', fix: false };
    updatePriorityRecords(pitRace, active(pitRace.entries));
    applyPriorityRecords(pitRace);
    syncRacecraftPaths(pitRace, pitRace.entries);
    const pitRecord = [...pitRace.priorityRecords!.values()][0]!;
    expect(pitRecord.detectedPhase).toBe('pit-entry');
    expect(pitYield.pathMode).toBe('pit');
    expect(pitYield.pathPlan?.key).toStartWith('pit:approach:');
    expect(pitFast.pathMode).toBe('priority-pass');

    const inLapCorner = session('quali');
    const flying = entry('FLYING');
    const inLap = entry('IN-LAP');
    inLapCorner.entries = [flying, inLap];
    const corner = inLapCorner.trk.corners.find(candidate => {
      const s = candidate.turnInI * inLapCorner.trk.step;
      const distanceToPit =
        (inLapCorner.trk.pit.sEntry - s + inLapCorner.trk.len) % inLapCorner.trk.len;
      return candidate.isolated && distanceToPit >= 220;
    });
    if (!corner) throw new Error('Missing qualifying in-lap corner fixture');
    const cornerS = corner.turnInI * inLapCorner.trk.step;
    place(inLapCorner, inLap, cornerS, 29, 1);
    place(inLapCorner, flying, cornerS - PHYS.carLen - 35, 36, 1);
    flying.lapPhase = 'flying';
    flying.lapLive = true;
    inLap.lapPhase = 'in';
    inLap.lapLive = false;
    inLap.boxArm = true;
    updatePriorityRecords(inLapCorner, active(inLapCorner.entries));
    applyPriorityRecords(inLapCorner);
    syncRacecraftPaths(inLapCorner, inLapCorner.entries);
    const cornerRecord = [...inLapCorner.priorityRecords!.values()][0]!;
    expect(cornerRecord.detectedPhase).toBe('corner');
    expect(inLap.pathMode).toBe('qualifying-yield');
    expect(inLap.pathPlan?.key).toContain(':corner');
  });

  test('keeps active corner rights above priority and brakes until oriented lanes separate', () => {
    const race = session('race');
    const beneficiary = entry('FAST');
    const yielding = entry('LAPPED');
    race.entries = [beneficiary, yielding];
    const corner = race.trk.corners.find(candidate => candidate.isolated) ?? race.trk.corners[0]!;
    const s = corner.brakeI * race.trk.step;
    place(race, beneficiary, s - 1, 36, 2, corner.side * 1.7);
    place(race, yielding, s + 1, 29, 1, -corner.side * 1.7);
    updateCornerRights(race, active(race.entries));
    expect(race.cornerRights?.size).toBe(1);
    updatePriorityRecords(race, active(race.entries));
    applyPriorityRecords(race);
    syncRacecraftPaths(race, race.entries);
    expect(race.priorityRecords?.size).toBe(1);
    expect([beneficiary.pathMode, yielding.pathMode].sort())
      .toEqual(['side-inside', 'side-outside']);

    race.cornerRights?.clear();
    race.cornerRightsAssignments?.clear();
    beneficiary.vCap = Infinity;
    yielding.vCap = Infinity;
    beneficiary.latNow = -1.5;
    yielding.latNow = 1.5;
    const index = beneficiary.car.progIdx;
    const roadHeading = Math.atan2(race.trk.ty[index]!, race.trk.tx[index]!);
    beneficiary.car.h = roadHeading + Math.PI / 2;
    applyPriorityRecords(race);
    expect(beneficiary.vCap).toBeFinite();

    beneficiary.vCap = Infinity;
    beneficiary.car.h = roadHeading;
    applyPriorityRecords(race);
    expect(beneficiary.vCap).toBe(Infinity);
  });

  test('suppresses new decisions once, then hands queued beneficiaries over without weaving', () => {
    const race = session('race');
    const first = entry('FAST-1');
    const second = entry('FAST-2');
    const yielding = entry('LAPPED');
    race.entries = [first, second, yielding];
    place(race, yielding, 200, 29, 1);
    place(race, first, 200 - PHYS.carLen - 25, 36, 2);
    place(race, second, 200 - PHYS.carLen - 45, 37, 2);
    updatePriorityRecords(race, active(race.entries));
    applyPriorityRecords(race);
    syncRacecraftPaths(race, race.entries);
    expect(race.priorityRecords?.size).toBe(2);
    expect(race.priorityMaximumQueue).toBe(2);
    expect(yielding.priorityYield?.beneficiary).toBe('FAST-1');
    const sides = [...race.priorityRecords!.values()].map(record => record.yieldSide);
    expect(new Set(sides).size).toBe(1);
    const modes = [yielding.pathMode];

    yielding.atkT = 2;
    yielding.defT = 2;
    yielding.lungeT = 1;
    applyPriorityRecords(race);
    expect(race.priorityIllegalDecisions).toBe(1);
    expect(yielding.atkT).toBe(0);
    expect(yielding.defT).toBe(0);
    expect(yielding.lungeT).toBe(0);
    applyPriorityRecords(race);
    expect(race.priorityIllegalDecisions).toBe(1);

    place(race, yielding, 200, 29, 1, yielding.latNow);
    place(race, first, 200 + PHYS.carLen + 2.5, 34, 2, first.latNow);
    place(race, second, 165, 37, 2, second.latNow);
    const releaseTicks = Math.round(0.5 / TRAF_DT);
    for (let count = 0; count < releaseTicks; count++) {
      race.t += TRAF_DT;
      updatePriorityRecords(race, active(race.entries));
      applyPriorityRecords(race);
      syncRacecraftPaths(race, race.entries);
      modes.push(yielding.pathMode);
      if (count < releaseTicks - 1)
        expect(yielding.priorityYield?.beneficiary).toBe('FAST-1');
    }
    expect(race.priorityRecords?.size).toBe(1);
    expect(yielding.priorityYield?.beneficiary).toBe('FAST-2');
    expect(race.priorityHandoffs).toBe(1);
    expect(modes).not.toContain('ideal');
    expect(yielding.pathMode).toBe('blue-yield');
    expect(race.priorityHistory?.at(-1)?.release).toBe('physical-clearance');
  });

  test('uses speed difference before one second of closing history and releases at exactly 0.5 s', () => {
    const race = session('race');
    const beneficiary = entry('FAST');
    const yielding = entry('LAPPED');
    race.entries = [beneficiary, yielding];
    placePairAtGap(race, beneficiary, yielding, 35, 29, 7);
    updatePriorityRecords(race, active(race.entries));
    const record = [...race.priorityRecords!.values()][0]!;

    beneficiary.spd = 31;
    yielding.spd = 29;
    yielding.car.s += 0.8;
    race.t += TRAF_DT;
    updatePriorityRecords(race, active(race.entries));
    expect(record.filteredClosing).toBeCloseTo(2, 9);

    place(race, yielding, 250, 29, 1);
    place(race, beneficiary, 250 + PHYS.carLen + 2.5, 34, 2);
    const releaseTicks = Math.round(0.5 / TRAF_DT);
    for (let count = 0; count < releaseTicks - 1; count++) {
      race.t += TRAF_DT;
      updatePriorityRecords(race, active(race.entries));
    }
    expect(race.priorityRecords?.size).toBe(1);
    race.t += TRAF_DT;
    updatePriorityRecords(race, active(race.entries));
    expect(race.priorityRecords?.size).toBe(0);
    const history = race.priorityHistory?.at(-1);
    expect(history?.release).toBe('physical-clearance');
    expect(history?.minimumGap).toBeDefined();
    expect(history?.detectedPhase).toBeDefined();
  });
});
