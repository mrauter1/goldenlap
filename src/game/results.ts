import { DRIVERS, SPONSORS } from '../data/personnel';
import { PRIZE, PTSTAB } from '../data/championship';
import { clamp } from '../shared/math';
import { formatSessionTime } from '../session/strategy';
import type { Entry, Session } from '../session/model';
import type {
  GameState, IncomeLine, RaceHighlights, RaceIncome, RaceResultRow
} from './model';

export function calculateRaceIncome(state: GameState, results: RaceResultRow[]): RaceIncome {
  const lines: IncomeLine[] = [];
  let total = 0;
  const playerRows = results.filter(result => result.isPlayer);
  for (const result of playerRows) {
    const prize = result.dnf ? 1 : (PRIZE[result.pos - 1] || 1);
    lines.push([
      `PRIZE — ${result.name} P${result.pos}${result.dnf ? ' (DNF)' : ''}`,
      prize
    ]);
    total += prize;
  }
  const sponsor = SPONSORS[state.spon]!;
  lines.push([`SPONSOR — ${sponsor.name}`, sponsor.race]);
  total += sponsor.race;
  let targetHit: boolean | null = false;
  if (sponsor.cond === 'both')
    targetHit = playerRows.length === 2 && playerRows.every(result => !result.dnf);
  if (sponsor.cond === 'top5')
    targetHit = playerRows.some(result => !result.dnf && result.pos <= 5);
  if (sponsor.cond === 'podium') {
    const podiums = playerRows.filter(result => !result.dnf && result.pos <= 3).length;
    if (podiums) {
      lines.push([`SPONSOR BONUS ×${podiums}`, sponsor.bonus * podiums]);
      total += sponsor.bonus * podiums;
      targetHit = null;
    }
  }
  if (targetHit === true) {
    lines.push(['SPONSOR BONUS', sponsor.bonus]);
    total += sponsor.bonus;
  }
  for (const driverIndex of state.myDrivers) {
    const driver = DRIVERS[driverIndex]!;
    if (driver.trait === 'pay') {
      lines.push([`BACKERS — ${driver.name}`, 5]);
      total += 5;
    }
  }
  return { lines, total };
}

export function applyResults(state: GameState, results: RaceResultRow[]): void {
  for (const result of results) {
    if (!result.dnf && result.pos <= 6) {
      const points = PTSTAB[result.pos - 1]!;
      state.drvPts[result.name] = (state.drvPts[result.name] || 0) + points;
      state.teamPts[result.teamId] = (state.teamPts[result.teamId] || 0) + points;
    }
  }
  const income = calculateRaceIncome(state, results);
  state.cash += income.total;
  state.lastRes = { res: results, inc: income, round: state.round };
}

export function classifyRace(
  state: GameState,
  session: Session
): { results: RaceResultRow[]; highlights: RaceHighlights } {
  const finishers = session.entries.filter(entry => entry.state === 'fin')
    .sort((left, right) =>
      right.finLaps - left.finLaps || left.finT - right.finT || right.prog - left.prog
    );
  const retired = session.entries.filter(entry => entry.state !== 'fin')
    .sort((left, right) => right.prog - left.prog);
  const winner = finishers[0]!;
  let fastest: Entry | null = null;
  for (const entry of session.entries) {
    if (Number.isFinite(entry.best) && (!fastest || entry.best < fastest.best)) fastest = entry;
  }
  if (fastest) fastest.notes.unshift(`FASTEST LAP ${formatSessionTime(fastest.best)}`);

  const results: RaceResultRow[] = [];
  finishers.forEach((entry, index) => {
    const lapsDown = winner.finLaps - entry.finLaps;
    results.push({
      name: entry.name,
      code: entry.code,
      teamName: entry.lu.team.name,
      teamId: entry.lu.team.id,
      color: entry.lu.team.body,
      isPlayer: entry.isPlayer,
      pos: index + 1,
      dnf: false,
      time: entry.finT - session.goT,
      gap: lapsDown > 0
        ? `${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`
        : (entry.finT - winner.finT).toFixed(1),
      note: entry.notes.join(' · ')
    });
  });
  retired.forEach((entry, index) => {
    results.push({
      name: entry.name,
      code: entry.code,
      teamName: entry.lu.team.name,
      teamId: entry.lu.team.id,
      color: entry.lu.team.body,
      isPlayer: entry.isPlayer,
      pos: finishers.length + index + 1,
      dnf: true,
      time: 0,
      gap: '',
      note: entry.notes.join(' · ')
    });
  });

  for (const entry of session.entries) {
    if (!entry.isPlayer) continue;
    const parts = state.cars![entry.ci]!.parts;
    for (const key of ['e', 'h', 'c'] as const)
      parts[key].rel = clamp(parts[key].rel - entry.wearAcc[key], 0.02, 1);
  }

  const highlights: RaceHighlights = {};
  if (fastest) highlights.fl = { code: fastest.code, t: fastest.best };
  let bestGain = 0;
  finishers.forEach((entry, index) => {
    const gain = entry.gridP - (index + 1);
    if (gain > bestGain) {
      bestGain = gain;
      highlights.climber = { code: entry.code, gain };
    }
  });
  let mostStops: Entry | null = null;
  for (const entry of session.entries)
    if (!mostStops || entry.stops > mostStops.stops) mostStops = entry;
  if (mostStops && mostStops.stops >= 2)
    highlights.stops = { code: mostStops.code, n: mostStops.stops };
  return { results, highlights };
}
