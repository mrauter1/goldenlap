import { ENGINEERS } from '../data/personnel';
import { TEAM_DEFS } from '../data/teams';
import { clamp } from '../shared/math';
import { random } from '../shared/rng';
import type { SpeedProfile } from '../core/model';
import { createEntry, spawnOnTrack } from '../session/entry';
import type {
  LineupEntry, QualifyingSession, RaceSession, SessionConfig
} from '../session/model';
import { QUALI_LEN, RACE_PACE_F, RACE_TARGET } from '../session/strategy';
import { carModifiers } from './management';
import type { GameState, TuningState } from './model';
import type { BuiltTrack } from '../core/model';

export function rivalLevel(tier: number): number {
  return clamp((tier - 0.9295) / 0.0056, 0, 4);
}

export function buildLineup(state: GameState): LineupEntry[] {
  const lineup: LineupEntry[] = [];
  const playerTeam = TEAM_DEFS[state.teamI]!;
  state.myDrivers.forEach((driverIndex, carIndex) => {
    // Imported lazily through the stable catalogue access below so random
    // calls remain in exactly the legacy order.
    const driver = requireDriver(driverIndex);
    let margin = 0.9115 + driver.spd * 0.0078 + (random() - 0.5) * 0.0025;
    if (driver.trait === 'wild') margin += (random() - 0.5) * 0.010;
    lineup.push({
      team: playerTeam,
      name: driver.name,
      code: driver.code,
      isPlayer: true,
      ci: carIndex,
      margin,
      focus: driver.foc / 5,
      trait: driver.trait
    });
  });
  for (const team of TEAM_DEFS) {
    if (team === playerTeam) continue;
    const creep = state.round * 0.0007;
    team.drv.forEach((driver, index) => {
      const tier = team.tier + creep + (index ? -0.0045 : 0.0045) +
        (random() - 0.5) * 0.0025;
      const level = rivalLevel(team.tier + creep);
      lineup.push({
        team,
        name: driver.n,
        code: driver.c,
        isPlayer: false,
        ci: -1,
        margin: tier,
        focus: 0.45 + random() * 0.3,
        trait: '',
        pw: 1 + 0.028 * level,
        dr: 1 - 0.045 * level,
        hMu: 1 + 0.010 * level
      });
    });
  }
  return lineup;
}

// This direct import stays at module scope; the helper isolates the inferred
// union element type and keeps buildLineup readable under noUnchecked access.
import { DRIVERS } from '../data/personnel';
function requireDriver(index: number): (typeof DRIVERS)[number] {
  const driver = DRIVERS[index];
  if (!driver) throw new Error(`Unknown driver index ${index}`);
  return driver;
}

export function createTuningState(state: GameState): TuningState {
  const engineer = ENGINEERS[state.eng]!;
  return {
    pts: 3 + engineer.exp,
    bonus: 0,
    g: [0, 1, 2].map(() => {
      const width = 12 + engineer.exp * 2.4;
      const start = 46 + random() * (92 - width - 46);
      return { pos: 8 + random() * 10, w0: start, w1: start + width, st: '' };
    })
  };
}

export function beginWeekend(state: GameState): void {
  state.tune = createTuningState(state);
}

export function raceLapsFor(profile: SpeedProfile): number {
  return clamp(Math.round(RACE_TARGET / (profile.lapTime * RACE_PACE_F)), 12, 99);
}

export function createQualifyingSession(
  state: GameState,
  built: BuiltTrack,
  config: SessionConfig
): QualifyingSession {
  const lineup = buildLineup(state);
  state.weekLu = lineup;
  const session: QualifyingSession = {
    mode: 'quali',
    trk: built.tr,
    prof: built.prof,
    config,
    events: [],
    entries: lineup.map(item => createEntry({
      lineup: item,
      teamIndex: Math.max(0, TEAM_DEFS.findIndex(team => team.id === item.team.id)),
      modifiers: item.isPlayer
        ? carModifiers(state, item.ci)
        : { pw: item.pw!, dr: item.dr!, hMu: item.hMu! }
    })),
    t: 0,
    tEnd: QUALI_LEN,
    scale: 1,
    prevScale: 1,
    wet: 0,
    evo: 0,
    phase: 'run',
    uiT: 0,
    trafT: 0,
    done: false,
    over: false,
    camI: -1,
    goT: 0,
    mile: {}
  };
  for (const entry of session.entries) {
    entry.state = 'box';
    if (!entry.isPlayer) {
      entry.plan = [
        { at: 40 + random() * 420, hot: random() < 0.6 ? 2 : 1 },
        { at: 900 + random() * 560, hot: random() < 0.7 ? 2 : 1 }
      ];
    }
  }
  session.camI = session.entries.findIndex(entry => entry.isPlayer);
  state.S = session;
  state.phase = 'quali';
  state.startTyre = ['S', 'S'];
  return session;
}

export function createRaceSession(
  state: GameState,
  built: BuiltTrack,
  rainProbability: number,
  config: SessionConfig
): RaceSession {
  const lineup = state.weekLu!;
  const session: RaceSession = {
    mode: 'race',
    trk: built.tr,
    prof: built.prof,
    config,
    events: [],
    entries: lineup.map(item => createEntry({
      lineup: item,
      teamIndex: Math.max(0, TEAM_DEFS.findIndex(team => team.id === item.team.id)),
      modifiers: item.isPlayer
        ? carModifiers(state, item.ci)
        : { pw: item.pw!, dr: item.dr!, hMu: item.hMu! }
    })),
    t: 0,
    scale: 1,
    prevScale: 1,
    wet: 0,
    evo: 0.5,
    phase: 'count',
    countT: 0,
    _lt: -1,
    laps: raceLapsFor(built.prof),
    chequered: false,
    finCount: 0,
    goT: 0,
    winT: 0,
    endT: 0,
    uiT: 0,
    trafT: 0,
    camI: -1,
    raining: false,
    rainAt: -1,
    rainEnd: -1,
    hitN: 0,
    hitHard: 0,
    hitOpenHard: 0,
    sbsT: 0,
    sbsPairs: Object.create(null) as RaceSession['sbsPairs'] & object,
    sbsEpisodes: [],
    _sbsStamp: 0
  };
  if (random() < rainProbability) {
    const duration = session.laps * built.prof.lapTime;
    session.rainAt = (0.1 + random() * 0.5) * duration;
    session.rainEnd = session.rainAt + (0.25 + random() * 0.5) * duration;
  }
  state.S = session;
  state.grid!.forEach((lineupIndex, gridIndex) => {
    const entry = session.entries[lineupIndex]!;
    spawnOnTrack(entry, session, 30 + gridIndex * 8.4, gridIndex % 2 === 0 ? 2.55 : -2.55, 0);
    entry.state = 'grid';
    entry.lat = gridIndex % 2 === 0 ? 2.55 : -2.55;
    entry.gridLat = entry.lat;
    entry.gridP = gridIndex + 1;
    if (entry.isPlayer) {
      entry.tyre.c = state.startTyre![entry.ci]!;
      const parts = state.cars![entry.ci]!.parts;
      entry.rel = { e: parts.e.rel, h: parts.h.rel, c: parts.c.rel };
    }
    if (!entry.isPlayer && session.rainAt >= 0 && session.rainAt < 60 && random() < 0.3)
      entry.tyre.c = 'W';
  });
  session.camI = session.entries.findIndex(entry => entry.isPlayer);
  state.phase = 'race';
  return session;
}

export function completeQualifying(state: GameState): QualifyingSession | null {
  const session = state.S;
  if (!session || session.mode !== 'quali' || session.done) return null;
  session.done = true;
  let ratio = 1.045;
  let count = 0;
  let total = 0;
  for (const entry of session.entries) {
    if (!entry.isPlayer && Number.isFinite(entry.best)) {
      total += entry.best * entry.lu.margin / session.prof.lapTime;
      count++;
    }
  }
  if (count >= 3) ratio = total / count;
  for (const entry of session.entries) {
    if (!entry.isPlayer && !Number.isFinite(entry.best)) {
      entry.best = session.prof.lapTime / entry.lu.margin * ratio * (1 + random() * 0.012);
      entry.synth = true;
    }
  }
  const grid = session.entries.map((_entry, index) => index);
  grid.sort((left, right) => {
    const first = session.entries[left]!;
    const second = session.entries[right]!;
    const firstTime = Number.isFinite(first.best) ? first.best : 9e8 - first.lu.margin * 1e5;
    const secondTime = Number.isFinite(second.best) ? second.best : 9e8 - second.lu.margin * 1e5;
    return firstTime - secondTime;
  });
  state.grid = grid;
  state.qualiBest = session.entries.map(entry => entry.best);
  for (const entry of session.entries) {
    if (!entry.isPlayer) continue;
    const parts = state.cars![entry.ci]!.parts;
    for (const key of ['e', 'h', 'c'] as const)
      parts[key].rel = clamp(parts[key].rel - entry.wearAcc[key], 0.02, 1);
  }
  state.S = null;
  state.phase = 'grid';
  return session;
}
