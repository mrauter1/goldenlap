import { CHIEFS, DRIVERS, ENGINEERS, PHILS } from '../data/personnel';
import { TEAM_DEFS } from '../data/teams';
import { random } from '../shared/rng';
import type { CarPartKey, GameState } from './model';
import type { TyreCompound } from '../session/model';

export type TuningCue = 'up' | 'down' | 'step' | 'none';

export function pickTeam(state: GameState, teamIndex: number): void {
  state.teamI = teamIndex;
  state.cash = TEAM_DEFS[teamIndex]!.budget;
  state.myDrivers = [];
  state.eng = -1;
  state.chief = -1;
  state.phil = -1;
  state.spon = -1;
  state.round = 0;
  state.drvPts = {};
  state.teamPts = {};
  for (const team of TEAM_DEFS) state.teamPts[team.id] = 0;
}

export function toggleDriver(state: GameState, driverIndex: number): void {
  const selectedIndex = state.myDrivers.indexOf(driverIndex);
  if (selectedIndex >= 0) state.myDrivers.splice(selectedIndex, 1);
  else if (state.myDrivers.length < 2) state.myDrivers.push(driverIndex);
}

export function selectEngineer(state: GameState, engineerIndex: number): void {
  state.eng = engineerIndex;
}

export function selectChief(state: GameState, chiefIndex: number): void {
  state.chief = chiefIndex;
}

export function selectPhilosophy(state: GameState, philosophyIndex: number): void {
  state.phil = philosophyIndex;
}

export function selectSponsor(state: GameState, sponsorIndex: number): void {
  state.spon = sponsorIndex;
}

export function returnToMenu(state: GameState): void {
  state.phase = 'menu';
}

export function selectStartingTyre(
  state: GameState,
  carIndex: number,
  compound: TyreCompound
): void {
  if (!state.startTyre) return;
  state.startTyre[carIndex] = compound;
}

export function openWorkshop(state: GameState): void {
  state.phase = 'workshop';
}

export function advanceRound(state: GameState): void {
  state.round++;
}

export function finishSeason(state: GameState): void {
  state.phase = 'seasonEnd';
}

export function staffCost(state: GameState): number {
  let cost = 0;
  for (const index of state.myDrivers) cost += DRIVERS[index]!.cost;
  if (state.eng >= 0) cost += ENGINEERS[state.eng]!.cost;
  if (state.chief >= 0) cost += CHIEFS[state.chief]!.cost;
  return cost;
}

export function staffReady(state: GameState): boolean {
  return state.myDrivers.length === 2 && state.eng >= 0 && state.chief >= 0 &&
    state.phil >= 0 && state.spon >= 0 &&
    TEAM_DEFS[state.teamI]!.budget - staffCost(state) >= 0;
}

export function startSeason(state: GameState): boolean {
  if (!staffReady(state)) return false;
  state.cash = TEAM_DEFS[state.teamI]!.budget - staffCost(state);
  const philosophy = PHILS[state.phil]!;
  state.cars = [0, 1].map(carIndex => ({
    parts: {
      e: { kind: 'e', id: `GL-E${carIndex + 1}`, lvl: philosophy.freeE, rel: 1 },
      h: { kind: 'h', id: `GL-A${carIndex + 1}`, lvl: 0, rel: 1 },
      c: { kind: 'c', id: `GL-C${carIndex + 1}`, lvl: 0, rel: 1 }
    }
  }));
  return true;
}

export function carModifiers(
  state: GameState,
  carIndex: number
): { pw: number; dr: number; hMu: number } {
  const parts = state.cars![carIndex]!.parts;
  return {
    pw: 1 + 0.028 * parts.e.lvl,
    dr: 1 - 0.045 * parts.c.lvl,
    hMu: 1 + 0.010 * parts.h.lvl
  };
}

export function recalculateTuningBonus(state: GameState): void {
  const tuning = state.tune;
  if (!tuning) return;
  let bonus = 0;
  for (const gauge of tuning.g) {
    if (gauge.st === 'golden') bonus += 0.004;
    else if (gauge.st === 'over') bonus -= 0.003;
  }
  tuning.bonus = bonus;
}

export function advanceTuning(state: GameState, gaugeIndex: number): TuningCue {
  const tuning = state.tune;
  const gauge = tuning?.g[gaugeIndex];
  if (!tuning || !gauge || tuning.pts <= 0 || gauge.st === 'over' || gauge.st === 'golden')
    return 'none';
  tuning.pts--;
  const precision = ENGINEERS[state.eng]!.prec;
  gauge.pos = Math.min(100, gauge.pos + 8 + random() * (24 - precision * 3));
  if (gauge.pos > gauge.w1) gauge.st = 'over';
  else if (gauge.pos >= gauge.w0) gauge.st = 'golden';
  recalculateTuningBonus(state);
  if (gauge.st === 'golden') return 'up';
  if (gauge.st === 'over') return 'down';
  return 'step';
}

export function upgradeCost(state: GameState, level: number): number {
  return Math.round([9, 12, 16, 22][level]! * PHILS[state.phil]!.upg);
}

export function repairCost(reliability: number): number {
  return Math.max(1, Math.ceil((1 - reliability) * 9));
}

export function swapParts(state: GameState, key: CarPartKey): void {
  const cars = state.cars!;
  const first = cars[0]!.parts[key];
  cars[0]!.parts[key] = cars[1]!.parts[key];
  cars[1]!.parts[key] = first;
}

export function repairPart(state: GameState, carIndex: number, key: CarPartKey): boolean {
  const part = state.cars![carIndex]!.parts[key];
  const cost = repairCost(part.rel);
  if (state.cash < cost || part.rel > 0.98) return false;
  state.cash -= cost;
  part.rel = 1;
  return true;
}

export function upgradePart(state: GameState, carIndex: number, key: CarPartKey): boolean {
  const part = state.cars![carIndex]!.parts[key];
  const cost = upgradeCost(state, part.lvl);
  if (state.cash < cost || part.lvl >= 4) return false;
  state.cash -= cost;
  part.lvl++;
  return true;
}
