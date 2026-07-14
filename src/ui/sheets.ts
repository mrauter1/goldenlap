import { PTSTAB } from '../data/championship';
import { CHIEFS, DRIVERS, ENGINEERS, PHILS, SPONSORS } from '../data/personnel';
import { TEAM_DEFS } from '../data/teams';
import type { BuiltTrack } from '../core/model';
import {
  advanceRound,
  advanceTuning,
  finishSeason,
  openWorkshop,
  pickTeam as chooseTeam,
  repairCost,
  repairPart,
  returnToMenu,
  selectChief,
  selectEngineer,
  selectPhilosophy,
  selectSponsor,
  selectStartingTyre,
  staffCost,
  staffReady,
  startSeason,
  swapParts,
  toggleDriver,
  upgradeCost,
  upgradePart
} from '../game/management';
import type { CarPartKey, GameState } from '../game/model';
import { raceLapsFor } from '../game/weekend';
import type { TyreCompound } from '../session/model';
import type { AudioSystem } from './audio';
import type { DomElements } from './dom';
import type { EffectsSystem } from './effects';
import { escapeHtml, formatMoney, formatTime, ratingDots } from './format';

export interface SheetActionData {
  readonly [key: string]: string | undefined;
}

export interface SheetController {
  buildMenu(): void;
  show(html: string): void;
  hide(): void;
  isOpen(): boolean;
  pickTeam(teamIndex: number): void;
  action(action: string, data: SheetActionData): void;
  renderStaff(): void;
  renderGarage(): void;
  renderQualifyingBoard(): void;
  renderGrid(): void;
  renderResults(): void;
  renderWorkshop(): void;
  renderSeasonEnd(): void;
}

interface SheetCallbacks {
  startWeekend(): void;
  endQualifying(): void;
  startRace(): void;
}

interface SheetOptions {
  state: GameState;
  elements: DomElements;
  tracks: readonly BuiltTrack[];
  audio: AudioSystem;
  effects: EffectsSystem;
  callbacks: SheetCallbacks;
}

const PART_NAMES: Record<CarPartKey, readonly [string, string]> = {
  e: ['ENGINE', 'Power & acceleration'],
  h: ['AERO', 'Cornering grip'],
  c: ['CHASSIS', 'Drag & top speed']
};
const PART_KEYS = ['e', 'h', 'c'] as const satisfies readonly CarPartKey[];

function integer(data: SheetActionData, key: string): number {
  const value = Number(data[key]);
  return Number.isFinite(value) ? value : -1;
}

function partKey(data: SheetActionData): CarPartKey | null {
  const key = data.k;
  return key === 'e' || key === 'h' || key === 'c' ? key : null;
}

function tyreCompound(data: SheetActionData): TyreCompound | null {
  const compound = data.c;
  return compound === 'S' || compound === 'H' || compound === 'W' ? compound : null;
}

export function createSheetController(options: SheetOptions): SheetController {
  const { state, elements, tracks, audio, effects, callbacks } = options;

  function show(html: string): void {
    elements.sheetBody.innerHTML = html;
    elements.sheet.classList.add('on');
    elements.sheet.scrollTop = 0;
  }

  function hide(): void {
    elements.sheet.classList.remove('on');
  }

  function isOpen(): boolean {
    return elements.sheet.classList.contains('on');
  }

  function buildMenu(): void {
    elements.teamCards.innerHTML = '';
    TEAM_DEFS.filter(team => team.pick).forEach(team => {
      const teamIndex = TEAM_DEFS.indexOf(team);
      const card = document.createElement('button');
      card.className = 'tcard';
      card.type = 'button';
      card.innerHTML = `
        <div class="tlivery" style="background:linear-gradient(115deg,${team.body} 0 62%,${team.accent} 62% 74%,${team.body} 74%)">
          <span class="no">${team.country}</span></div>
        <div class="pad">
          <div class="tname">${escapeHtml(team.name)}</div>
          <div class="tmeta">${team.country} · TWO CARS · SIX ROUNDS</div>
          <div class="tdesc">${escapeHtml(team.desc)}</div>
          <div class="tbudget">BUDGET ${formatMoney(team.budget)}</div>
        </div>`;
      card.addEventListener('click', () => {
        audio.init();
        audio.resume();
        pickTeam(teamIndex);
      });
      elements.teamCards.appendChild(card);
    });
  }

  function pickTeam(teamIndex: number): void {
    chooseTeam(state, teamIndex);
    elements.menu.classList.add('off');
    state.phase = 'staff';
    renderStaff();
  }

  function renderStaff(): void {
    const team = TEAM_DEFS[state.teamI];
    if (!team) return;
    const moneyLeft = team.budget - staffCost(state);
    const driverCards = DRIVERS.map((driver, index) => {
      const selected = state.myDrivers.includes(index);
      const disabled = !selected && (state.myDrivers.length >= 2 || moneyLeft < driver.cost);
      return `<button class="opt${selected ? ' sel' : ''}${disabled ? ' dis' : ''}" data-act="drv" data-i="${index}">
        <div class="o-nm">${escapeHtml(driver.name)}</div>
        <div class="o-sub">DRIVER · ${driver.code}</div>
        <div class="stars">${ratingDots(driver.spd, 'SPEED')}${ratingDots(driver.foc, 'FOCUS')}</div>
        <span class="o-tr">${driver.tn}</span>
        <div class="inline-note">${escapeHtml(driver.td)}</div>
        <div class="o-cost" style="margin-top:8px">${formatMoney(driver.cost)}</div>
      </button>`;
    }).join('');
    const engineerCards = ENGINEERS.map((engineer, index) => `
      <button class="opt${state.eng === index ? ' sel' : ''}" data-act="eng" data-i="${index}">
        <div class="o-nm">${escapeHtml(engineer.name)}</div>
        <div class="o-sub">LEAD ENGINEER</div>
        <div class="stars">${ratingDots(engineer.exp, 'EXPERT')}${ratingDots(engineer.prec, 'PRECISE')}</div>
        <div class="inline-note">${escapeHtml(engineer.td)}</div>
        <div class="o-cost" style="margin-top:8px">${formatMoney(engineer.cost)}</div>
      </button>`).join('');
    const chiefCards = CHIEFS.map((chief, index) => `
      <button class="opt${state.chief === index ? ' sel' : ''}" data-act="chief" data-i="${index}">
        <div class="o-nm">${escapeHtml(chief.name)}</div>
        <div class="o-sub">CREW CHIEF</div>
        <div class="stars">${ratingDots(chief.skill, 'SKILL')}${ratingDots(chief.foc, 'FOCUS')}</div>
        <div class="inline-note">${escapeHtml(chief.td)}</div>
        <div class="o-cost" style="margin-top:8px">${formatMoney(chief.cost)}</div>
      </button>`).join('');
    const philosophyCards = PHILS.map((philosophy, index) => `
      <button class="opt${state.phil === index ? ' sel' : ''}" data-act="phil" data-i="${index}">
        <div class="o-nm">${escapeHtml(philosophy.name)}</div>
        <div class="o-sub">CAR DESIGN</div>
        <div class="inline-note">${escapeHtml(philosophy.td)}</div>
      </button>`).join('');
    const sponsorCards = SPONSORS.map((sponsor, index) => `
      <button class="opt${state.spon === index ? ' sel' : ''}" data-act="spon" data-i="${index}">
        <div class="o-nm">${escapeHtml(sponsor.name)}</div>
        <div class="o-sub">TITLE SPONSOR</div>
        <div class="inline-note">${escapeHtml(sponsor.td)}</div>
      </button>`).join('');
    show(`
      <div class="shtop">
        <div>
          <div class="sh-eyebrow">${escapeHtml(team.name)} · PRESEASON</div>
          <div class="sh-h1">Build the team</div>
          <div class="sh-sub">Sign two drivers, a lead engineer and a crew chief. Pick a design
          philosophy and a sponsor. What’s left is your development money.</div>
        </div>
        <div class="cash" id="cashRO">${formatMoney(moneyLeft)} LEFT</div>
      </div>
      <div class="stripe"></div>
      <div class="secH">DRIVERS — PICK TWO</div>
      <div class="gridopts">${driverCards}</div>
      <div class="secH">LEAD ENGINEER</div>
      <div class="gridopts">${engineerCards}</div>
      <div class="secH">CREW CHIEF</div>
      <div class="gridopts">${chiefCards}</div>
      <div class="secH">DESIGN PHILOSOPHY</div>
      <div class="gridopts">${philosophyCards}</div>
      <div class="secH">SPONSOR</div>
      <div class="gridopts">${sponsorCards}</div>
      <div class="btnrow">
        <button class="btn ghostbtn" data-act="backMenu">BACK</button>
        <button class="btn gold" data-act="startSeason" ${staffReady(state) ? '' : 'disabled'}>START THE SEASON</button>
      </div>`);
  }

  function renderResults(): void {
    const last = state.lastRes;
    const round = state.calendar[state.round];
    if (!last || !round) return;
    const rows = last.res.map(result => `
      <tr class="${result.isPlayer ? 'me' : ''}">
        <td class="pos">${result.dnf ? '—' : result.pos}</td>
        <td><span class="swatch" style="background:${result.color}"></span>${escapeHtml(result.name)}</td>
        <td class="small">${escapeHtml(result.teamName)}</td>
        <td class="mono">${result.dnf ? 'DNF' : result.pos === 1 ? formatTime(result.time) : `+${result.gap}`}</td>
        <td class="mono">${!result.dnf && result.pos <= 6 ? `+${PTSTAB[result.pos - 1]}` : ''}</td>
        <td class="small">${escapeHtml(result.note)}</td>
      </tr>`).join('');
    const incomeRows = last.inc.lines.map(line =>
      `<tr><td>${escapeHtml(line[0])}</td><td class="mono" style="text-align:right">${formatMoney(line[1])}</td></tr>`
    ).join('');
    const highlights = last.hl;
    const highlightBits: string[] = [];
    if (highlights?.fl)
      highlightBits.push(`<b style="color:#8E5FB8">FASTEST LAP</b> ${escapeHtml(highlights.fl.code)} ${formatTime(highlights.fl.t)}`);
    if (highlights?.climber)
      highlightBits.push(`<b>CHARGER</b> ${escapeHtml(highlights.climber.code)} +${highlights.climber.gain}`);
    if (highlights?.stops)
      highlightBits.push(`<b>MOST STOPS</b> ${escapeHtml(highlights.stops.code)} (${highlights.stops.n})`);
    show(`
      <div class="shtop">
        <div>
          <div class="sh-eyebrow">ROUND ${state.round + 1} OF 6 · ${escapeHtml(round.name)}</div>
          <div class="sh-h1">Classification</div>
          ${highlightBits.length ? `<div class="sh-sub" style="font-family:var(--mono);font-size:11px">${highlightBits.join(' &nbsp;·&nbsp; ')}</div>` : ''}
        </div>
        <div class="cash">${formatMoney(state.cash)}</div>
      </div>
      <div class="stripe"></div>
      <table class="tbl">
        <tr><th>P</th><th>DRIVER</th><th>TEAM</th><th>TIME</th><th>PTS</th><th>NOTES</th></tr>
        ${rows}
      </table>
      <div class="secH">INCOME</div>
      <table class="tbl" style="max-width:420px">${incomeRows}
        <tr><td style="font-weight:900">TOTAL</td><td class="mono" style="text-align:right;font-weight:900">${formatMoney(last.inc.total)}</td></tr>
      </table>
      <div class="btnrow"><button class="btn gold" data-act="toWorkshop">TO THE WORKSHOP</button></div>`);
  }

  function renderWorkshop(): void {
    const cars = state.cars;
    if (!cars) return;
    const carBlock = (carIndex: number): string => {
      const driver = DRIVERS[state.myDrivers[carIndex] ?? -1];
      const car = cars[carIndex];
      if (!driver || !car) return '';
      const rows = PART_KEYS.map(key => {
        const part = car.parts[key];
        const level = `<span class="lvl">${[0, 1, 2, 3].map(index => `<b class="${index < part.lvl ? 'f' : ''}"></b>`).join('')}</span>`;
        const reliability = Math.round(part.rel * 100);
        const reliabilityClass = part.rel < 0.35 ? 'crit' : part.rel < 0.65 ? 'warn' : '';
        const repair = repairCost(part.rel);
        const upgrade = part.lvl < 4 ? upgradeCost(state, part.lvl) : null;
        return `<tr>
          <td><b>${PART_NAMES[key][0]}</b><div class="small">${escapeHtml(part.id)} · ${PART_NAMES[key][1]}</div></td>
          <td>${level}</td>
          <td style="min-width:78px"><div class="pbar ${reliabilityClass}"><i style="width:${reliability}%"></i></div><div class="small">${reliability}%</div></td>
          <td><button class="btn ghostbtn" style="padding:8px 10px;font-size:10.5px" data-act="repair" data-ci="${carIndex}" data-k="${key}" ${part.rel > 0.98 || state.cash < repair ? 'disabled' : ''}>FIX ${formatMoney(repair)}</button></td>
          <td>${upgrade != null ? `<button class="btn" style="padding:8px 10px;font-size:10.5px" data-act="upgrade" data-ci="${carIndex}" data-k="${key}" ${state.cash < upgrade ? 'disabled' : ''}>UPG ${formatMoney(upgrade)}</button>` : '<span class="small">MAX</span>'}</td>
        </tr>`;
      }).join('');
      return `<div style="flex:1;min-width:320px"><div class="secH">CAR ${carIndex + 1} — ${escapeHtml(driver.name)}</div>
        <table class="tbl">${rows}</table></div>`;
    };
    const swapButtons = PART_KEYS.map(key =>
      `<button class="btn ghostbtn" style="padding:9px 14px;font-size:11px" data-act="swapPart" data-k="${key}">⇄ SWAP ${PART_NAMES[key][0]}S</button>`
    ).join(' ');
    const teamRows = [...TEAM_DEFS]
      .sort((left, right) => (state.teamPts[right.id] ?? 0) - (state.teamPts[left.id] ?? 0))
      .map((team, index) => `<tr class="${TEAM_DEFS.indexOf(team) === state.teamI ? 'me' : ''}">
        <td class="pos">${index + 1}</td>
        <td><span class="swatch" style="background:${team.body}"></span>${escapeHtml(team.name)}</td>
        <td class="mono">${state.teamPts[team.id] ?? 0}</td></tr>`).join('');
    const driverRows = Object.entries(state.drvPts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map((driver, index) => `<tr><td class="pos">${index + 1}</td><td>${escapeHtml(driver[0])}</td><td class="mono">${driver[1]}</td></tr>`).join('') ||
      '<tr><td colspan="3" class="small">NO POINTS SCORED YET</td></tr>';
    const next = state.round + 1 < state.calendar.length ? state.calendar[state.round + 1] : null;
    const team = TEAM_DEFS[state.teamI];
    if (!team) return;
    show(`
      <div class="shtop">
        <div>
          <div class="sh-eyebrow">BETWEEN ROUNDS · ${escapeHtml(team.name)}</div>
          <div class="sh-h1">Workshop</div>
          <div class="sh-sub">Two cars, six parts — each with its own level and its own wear. Worn parts
          fail mid-race. Repairs restore the part itself; pit-lane fixes during a race only patch the car
          up for the day, so the workshop bill still comes due. Swapped parts carry their level and wear
          with them.</div>
        </div>
        <div class="cash" id="cashRO">${formatMoney(state.cash)}</div>
      </div>
      <div class="stripe"></div>
      <div style="display:flex;gap:22px;flex-wrap:wrap">${carBlock(0)}${carBlock(1)}</div>
      <div class="btnrow" style="justify-content:flex-start;margin-top:2px">${swapButtons}</div>
      <div style="display:flex;gap:26px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px"><div class="secH">CONSTRUCTORS</div><table class="tbl">${teamRows}</table></div>
        <div style="flex:1;min-width:240px"><div class="secH">DRIVERS</div><table class="tbl">${driverRows}</table></div>
      </div>
      <div class="btnrow">
        ${next ? `<button class="btn gold" data-act="nextRound">NEXT — ${escapeHtml(next.name)} ▸</button>` :
          '<button class="btn gold" data-act="seasonEnd">SEASON FINALE RESULTS ▸</button>'}
      </div>`);
  }

  function renderSeasonEnd(): void {
    const teamOrder = [...TEAM_DEFS]
      .sort((left, right) => (state.teamPts[right.id] ?? 0) - (state.teamPts[left.id] ?? 0));
    const playerTeam = TEAM_DEFS[state.teamI];
    if (!playerTeam) return;
    const playerPosition = teamOrder.indexOf(playerTeam) + 1;
    const champion = playerPosition === 1;
    const teamRows = teamOrder.map((team, index) =>
      `<tr class="${TEAM_DEFS.indexOf(team) === state.teamI ? 'me' : ''}"><td class="pos">${index + 1}</td>
      <td><span class="swatch" style="background:${team.body}"></span>${escapeHtml(team.name)}</td>
      <td class="mono">${state.teamPts[team.id] ?? 0}</td></tr>`
    ).join('');
    const driverRows = Object.entries(state.drvPts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map((driver, index) => `<tr><td class="pos">${index + 1}</td><td>${escapeHtml(driver[0])}</td><td class="mono">${driver[1]}</td></tr>`).join('');
    if (champion) {
      audio.fanfare();
      effects.burstConfetti();
    }
    show(`
      <div class="shtop"><div>
        <div class="sh-eyebrow">SEASON 1976 · FINAL STANDINGS</div>
        <div class="sh-h1">${champion ? 'World champions!' : `P${playerPosition} in the championship`}</div>
        <div class="sh-sub">${champion
          ? `The golden era belongs to ${escapeHtml(playerTeam.name)}. Champagne everywhere.`
          : 'The board has thoughts. There’s always next season.'}</div>
      </div><div class="cash">${formatMoney(state.cash)}</div></div>
      <div class="stripe"></div>
      <div style="display:flex;gap:26px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px"><div class="secH">CONSTRUCTORS</div><table class="tbl">${teamRows}</table></div>
        <div style="flex:1;min-width:240px"><div class="secH">DRIVERS</div><table class="tbl">${driverRows}</table></div>
      </div>
      <div class="btnrow"><button class="btn gold" data-act="backMenu">NEW SEASON</button></div>`);
  }

  function renderGarage(): void {
    const session = state.S;
    const round = state.calendar[state.round];
    if (!session || session.mode !== 'quali' || !round) return;
    const built = tracks[round.trk];
    show(`
      <div class="shtop"><div>
        <div class="sh-eyebrow">ROUND ${state.round + 1} OF 6 · ${escapeHtml(round.name)} · QUALIFYING</div>
        <div class="sh-h1">The garage</div>
        ${built?.def.meta ? `<div class="sh-sub" style="font-style:italic">${escapeHtml(built.def.meta.blurb)}</div>` : ''}
        <div class="sh-sub">The session clock stops while you’re in here. Tuning is your race setup for
        the whole weekend — it applies to both cars. Land each needle in the green window for a
        <b>Golden Tune</b>; overshoot and that system is ruined. Completed flying laps sometimes teach the
        crew enough for an extra tuning point. Race-day forecast:
        <b>${round.rainP >= 0.5 ? 'RAIN LIKELY' : round.rainP >= 0.25 ? 'RAIN POSSIBLE' : 'MOSTLY DRY'}</b>.</div>
      </div><div class="cash">${session.over ? 'FLAG OUT' : `Q ${formatTime(Math.max(0, session.tEnd - session.t)).slice(0, -3)} LEFT`}</div></div>
      <div class="stripe"></div>
      <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1.2;min-width:280px"><div class="secH">SETUP TUNING <span class="small" id="qPts"></span></div><div id="qTune"></div></div>
        <div style="flex:1;min-width:250px"><div class="secH">CLASSIFICATION</div><table class="tbl" id="qBoard"></table>
          <div class="inline-note">Ending the session early calls both cars in; rivals still to run are given representative times.</div></div>
      </div>
      <div class="btnrow"><button class="btn ghostbtn" data-act="qEnd">END SESSION ▸</button><button class="btn gold" data-act="qResume">BACK TO THE PIT WALL ▸</button></div>`);
    renderTuneArea();
    renderQualifyingBoard();
  }

  function renderTuneArea(): void {
    const tuning = state.tune;
    const wrap = document.getElementById('qTune');
    const points = document.getElementById('qPts');
    if (!wrap || !tuning) return;
    if (points)
      points.textContent = `· ${tuning.pts} POINTS · BONUS ${tuning.bonus >= 0 ? '+' : ''}${(tuning.bonus * 100).toFixed(1)}% PACE`;
    const names = ['ENGINE', 'HANDLING', 'CHASSIS'] as const;
    wrap.innerHTML = tuning.g.map((gauge, index) => `
      <div class="qrow"><div class="qhead"><b class="small" style="color:var(--ink)">${names[index]}
        ${gauge.st === 'golden' ? '— <span style="color:#B8860B">GOLDEN TUNE</span>' : gauge.st === 'over' ? '— <span style="color:#B0452F">OVERTUNED</span>' : ''}</b>
        <button class="btn" style="padding:7px 14px;font-size:11px" data-act="tune" data-i="${index}" ${tuning.pts <= 0 || gauge.st ? 'disabled' : ''}>TUNE</button></div>
        <div class="gauge ${gauge.st}"><div class="win" style="left:${gauge.w0}%;width:${gauge.w1 - gauge.w0}%"></div><div class="ndl" style="left:calc(${Math.min(100, gauge.pos)}% - 2px)"></div></div>
      </div>`).join('');
  }

  function renderQualifyingBoard(): void {
    const table = document.getElementById('qBoard');
    const session = state.S;
    if (!table || !session || session.mode !== 'quali') return;
    const rows = [...session.entries].sort((left, right) =>
      (Number.isFinite(left.best) ? left.best : Infinity) -
      (Number.isFinite(right.best) ? right.best : Infinity)
    );
    const first = rows[0];
    const best = first && Number.isFinite(first.best) ? first.best : null;
    table.innerHTML = '<tr><th>P</th><th>DRIVER</th><th>TIME</th></tr>' + rows.map((entry, index) => `
      <tr class="${entry.isPlayer ? 'me' : ''}"><td class="pos">${index + 1}</td>
      <td><span class="swatch" style="background:${entry.lu.team.body}"></span>${escapeHtml(entry.name)}${entry.car ? '<span class="small"> ● ON TRACK</span>' : ''}</td>
      <td class="mono">${Number.isFinite(entry.best) ? index === 0 || best == null ? formatTime(entry.best) : `+${(entry.best - best).toFixed(2)}` : '—'}</td></tr>`).join('');
  }

  function renderGrid(): void {
    const round = state.calendar[state.round];
    const grid = state.grid;
    const lineup = state.weekLu;
    const qualifying = state.qualiBest;
    const cars = state.cars;
    const tyres = state.startTyre;
    if (!round || !grid || !lineup || !qualifying || !cars || !tyres) return;
    const rows = grid.map((lineupIndex, index) => {
      const entry = lineup[lineupIndex]!;
      const time = qualifying[lineupIndex]!;
      return `<tr class="${entry.isPlayer ? 'me' : ''}"><td class="pos">${index + 1}</td>
        <td><span class="swatch" style="background:${entry.team.body}"></span>${escapeHtml(entry.name)}</td>
        <td class="small">${escapeHtml(entry.team.name)}</td><td class="mono">${Number.isFinite(time) ? formatTime(time) : 'NO TIME'}</td></tr>`;
    }).join('');
    const tyrePick = [0, 1].map(carIndex => {
      const driver = DRIVERS[state.myDrivers[carIndex] ?? -1];
      if (!driver) return '';
      return `<div class="qrow"><div class="qhead"><b>${escapeHtml(driver.name)}</b><span>${(['S', 'H', 'W'] as const).map(compound =>
        `<button class="btn ${tyres[carIndex] === compound ? 'gold' : 'ghostbtn'}" style="padding:8px 13px;font-size:11px;margin-left:6px" data-act="styre" data-ci="${carIndex}" data-c="${compound}">${compound === 'S' ? 'SOFT' : compound === 'H' ? 'HARD' : 'WETS'}</button>`
      ).join('')}</span></div></div>`;
    }).join('');
    const swapRows = PART_KEYS.map(key => {
      const first = cars[0]!.parts[key];
      const second = cars[1]!.parts[key];
      const cell = (part: typeof first): string =>
        `<span class="mono" style="font-size:11px">${escapeHtml(part.id)} · L${part.lvl} · ${Math.round(part.rel * 100)}%</span>`;
      return `<div class="qrow"><div class="qhead"><b class="small" style="color:var(--ink)">${PART_NAMES[key][0]}</b><span>${cell(first)} <button class="btn ghostbtn" style="padding:7px 12px;font-size:10px;margin:0 8px" data-act="swapPart" data-k="${key}">⇄ SWAP</button> ${cell(second)}</span></div></div>`;
    }).join('');
    const built = tracks[round.trk];
    const firstDriver = DRIVERS[state.myDrivers[0] ?? -1];
    const secondDriver = DRIVERS[state.myDrivers[1] ?? -1];
    if (!firstDriver || !secondDriver) return;
    show(`
      <div class="shtop"><div>
        <div class="sh-eyebrow">ROUND ${state.round + 1} OF 6 · ${escapeHtml(round.name)} · ${built ? raceLapsFor(built.prof) : 0} LAPS</div>
        <div class="sh-h1">The grid</div>
        ${built?.def.meta ? `<div class="sh-sub" style="font-style:italic">${escapeHtml(built.def.meta.blurb)}</div>` : ''}
        <div class="sh-sub">About an hour of racing at 1× — use the time controls. Pick starting
        tyres: softs are fast and fragile, hards go the distance, wets only work in the rain. Race forecast:
        <b>${round.rainP >= 0.5 ? 'RAIN LIKELY' : round.rainP >= 0.25 ? 'RAIN POSSIBLE' : 'MOSTLY DRY'}</b>.</div>
      </div></div>
      <div class="stripe"></div>
      <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1.1;min-width:290px"><div class="secH">STARTING TYRES</div>${tyrePick}
          <div class="secH">PARTS — ${escapeHtml(firstDriver.name)} ⇄ ${escapeHtml(secondDriver.name)}</div>${swapRows}
          <div class="inline-note">Swapping moves the actual part — its level and wear travel with it.</div>
          <div class="btnrow" style="justify-content:flex-start"><button class="btn gold" data-act="startRace">LIGHTS OUT ▸</button></div>
        </div>
        <div style="flex:1;min-width:250px"><div class="secH">STARTING GRID</div><table class="tbl"><tr><th>P</th><th>DRIVER</th><th>TEAM</th><th>QUALI</th></tr>${rows}</table></div>
      </div>`);
  }

  function action(name: string, data: SheetActionData): void {
    if (name === 'drv') {
      toggleDriver(state, integer(data, 'i'));
      renderStaff();
    } else if (name === 'eng') {
      selectEngineer(state, integer(data, 'i'));
      renderStaff();
    } else if (name === 'chief') {
      selectChief(state, integer(data, 'i'));
      renderStaff();
    } else if (name === 'phil') {
      selectPhilosophy(state, integer(data, 'i'));
      renderStaff();
    } else if (name === 'spon') {
      selectSponsor(state, integer(data, 'i'));
      renderStaff();
    } else if (name === 'backMenu') {
      hide();
      returnToMenu(state);
      elements.menu.classList.remove('off');
      buildMenu();
    } else if (name === 'startSeason') {
      if (startSeason(state)) callbacks.startWeekend();
    } else if (name === 'tune') {
      const cue = advanceTuning(state, integer(data, 'i'));
      if (cue === 'up') audio.chime('up');
      else if (cue === 'down') audio.chime('down');
      else if (cue === 'step') audio.beep(520, 0.08, 'square', 0.1);
      renderTuneArea();
    } else if (name === 'qResume') hide();
    else if (name === 'qEnd') callbacks.endQualifying();
    else if (name === 'styre') {
      const compound = tyreCompound(data);
      if (compound) selectStartingTyre(state, integer(data, 'ci'), compound);
      renderGrid();
    } else if (name === 'swapPart') {
      const key = partKey(data);
      if (!key) return;
      swapParts(state, key);
      audio.chime('up');
      if (state.phase === 'workshop') renderWorkshop();
      else renderGrid();
    } else if (name === 'startRace') callbacks.startRace();
    else if (name === 'toWorkshop') {
      openWorkshop(state);
      renderWorkshop();
    } else if (name === 'repair') {
      const key = partKey(data);
      if (key && repairPart(state, integer(data, 'ci'), key)) renderWorkshop();
    } else if (name === 'upgrade') {
      const key = partKey(data);
      if (key && upgradePart(state, integer(data, 'ci'), key)) renderWorkshop();
    } else if (name === 'nextRound') {
      advanceRound(state);
      callbacks.startWeekend();
    } else if (name === 'seasonEnd') {
      finishSeason(state);
      renderSeasonEnd();
    }
  }

  elements.sheetBody.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-act]') : null;
    if (!target || !elements.sheetBody.contains(target)) return;
    const name = target.dataset.act;
    if (name) action(name, target.dataset);
  });

  return {
    buildMenu,
    show,
    hide,
    isOpen,
    pickTeam,
    action,
    renderStaff,
    renderGarage,
    renderQualifyingBoard,
    renderGrid,
    renderResults,
    renderWorkshop,
    renderSeasonEnd
  };
}
