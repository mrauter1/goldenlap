import { PACE_NAMES } from '../data/championship';
import { clamp } from '../shared/math';
import {
  boxQualifyingCar,
  cancelPitCall,
  playerEntry as findPlayerEntry,
  sendQualifyingCar,
  setPace,
  setPitCall,
  validCompound
} from '../session/commands';
import type {
  Entry,
  MessageKind,
  PitArm,
  QualifyingSession,
  RaceSession,
  Session,
  TyreCompound
} from '../session/model';
import { sessionOrder } from '../session/standings';
import { fuelLapsLeft, projectPitStop, tyreAge, tyreLapsLeft } from '../session/strategy';
import type { GameState } from '../game/model';
import type { CameraController } from './camera';
import type { DomElements } from './dom';
import { escapeHtml, formatTime } from './format';

interface PitSelection { comp: TyreCompound; fix: boolean }
interface EntryUiState {
  previousPosition?: number;
  positionDelta?: number;
  positionDeltaAt?: number;
  intervalLap?: number;
  intervalPrevious?: number;
  intervalReference?: number;
  lapSeen?: number;
  personalBestAt?: number;
  qualifyingState?: string;
}
interface SessionHudState {
  session: Session;
  lapDisplay: number;
  header: HTMLElement;
  headerFree: boolean | null;
  towerRows: Map<Entry, HTMLElement>;
  ops: Array<HTMLElement | null>;
  entry: Map<Entry, EntryUiState>;
}

export interface HudController {
  build(session: Session): void;
  clear(): void;
  update(session: Session): void;
  playerEntry(carIndex: number): Entry | null;
  refreshOps(carIndex: number): void;
  qualifyingSend(carIndex: number): void;
  qualifyingBox(carIndex: number): void;
  toast(message: string, kind?: MessageKind): void;
  banner(tone: MessageKind, title: string, subtitle: string, duration?: number): void;
  clearBanner(): void;
  showLights(count: number, go?: boolean): void;
}

interface HudOptions {
  state: GameState;
  elements: DomElements;
  camera: CameraController;
}

const TYRE_PIP: Record<TyreCompound, string> = {
  S: '#D4574E',
  H: '#EDE7D5',
  W: '#5B8DBE'
};

function requiredQuery<T extends Element>(
  root: ParentNode,
  selector: string,
  constructor: { new(): T }
): T {
  const element = root.querySelector(selector);
  if (!element || !(element instanceof constructor))
    throw new Error(`HUD element missing or invalid: ${selector}`);
  return element;
}

export function createHudController(options: HudOptions): HudController {
  const { state, elements, camera } = options;
  const pitSelections: [PitSelection, PitSelection] = [
    { comp: 'S', fix: false },
    { comp: 'S', fix: false }
  ];
  let current: SessionHudState | null = null;
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  let cameraHintShown = false;

  function playerEntry(carIndex: number): Entry | null {
    return findPlayerEntry(state.S, carIndex);
  }

  function toast(message: string, kind: MessageKind = ''): void {
    const chip = document.createElement('div');
    chip.className = `chip toast${kind ? ` ${kind}` : ''}`;
    const session = state.S;
    const lapDisplay = current?.session === session ? current.lapDisplay : 0;
    const text = session?.mode === 'race' && session.phase === 'run' && lapDisplay
      ? `L${lapDisplay} · ${message}`
      : message;
    chip.textContent = text;
    const subject = session?.entries.find(entry => text.includes(entry.code));
    if (session && subject?.car) {
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', () => camera.followEntry(session, session.entries.indexOf(subject)));
    }
    elements.feed.appendChild(chip);
    requestAnimationFrame(() => chip.classList.add('on'));
    while (elements.feed.children.length > 5) elements.feed.firstElementChild?.remove();
    setTimeout(() => {
      chip.classList.remove('on');
      setTimeout(() => chip.remove(), 350);
    }, 4200);
  }

  function banner(
    tone: MessageKind,
    title: string,
    subtitle: string,
    duration = 3000
  ): void {
    elements.banner.className = `on${tone ? ` ${tone}` : ''}`;
    requiredQuery(elements.banner, '.bt', HTMLElement).textContent = title;
    requiredQuery(elements.banner, '.bs', HTMLElement).textContent = subtitle;
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      elements.banner.className = '';
      bannerTimer = null;
    }, duration);
  }

  function clearBanner(): void {
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = null;
    elements.banner.className = '';
  }

  function showLights(count: number, go = false): void {
    if (go) {
      elements.flash.innerHTML = '<div class="go green">GO!</div>';
      setTimeout(() => { elements.flash.innerHTML = ''; }, 900);
      return;
    }
    let html = '<div class="lights">';
    for (let index = 0; index < 3; index++)
      html += `<div class="lt${index < count ? ' on' : ''}"></div>`;
    elements.flash.innerHTML = `${html}</div>`;
  }

  function build(session: Session): void {
    elements.tower.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'trow hd';
    elements.tower.appendChild(header);
    const towerRows = new Map<Entry, HTMLElement>();
    for (const entry of session.entries) {
      const row = document.createElement('div');
      row.className = `trow${entry.isPlayer ? ' me' : ''}`;
      row.innerHTML = `<span class="p"></span><span class="pd"></span><span class="sw" style="background:${entry.lu.team.body}"></span>
        <span class="nm">${escapeHtml(entry.code)}</span><span class="ty"><i class="pip"></i><span class="ta"></span></span>
        <span class="gp"></span><span class="lp"></span><span class="bp"></span>`;
      row.addEventListener('click', () => camera.followEntry(session, session.entries.indexOf(entry)));
      elements.tower.appendChild(row);
      towerRows.set(entry, row);
    }
    elements.ops.innerHTML = '';
    const ops: Array<HTMLElement | null> = [null, null];
    current = {
      session,
      lapDisplay: 1,
      header,
      headerFree: null,
      towerRows,
      ops,
      entry: new Map()
    };
    refreshTowerHeader();
    if (!cameraHintShown) {
      cameraHintShown = true;
      toast('Drag to pan · scroll or pinch to zoom · click a driver to follow', 'info');
    }
    for (const carIndex of [0, 1]) {
      const panel = document.createElement('div');
      panel.className = 'chip opcar';
      panel.id = `op${carIndex}`;
      elements.ops.appendChild(panel);
      ops[carIndex] = panel;
      buildOpsPanel(carIndex);
    }
    elements.feed.innerHTML = '';
    elements.tLap.style.display = session.mode === 'race' ? '' : 'none';
    elements.tGarage.style.display = session.mode === 'quali' ? '' : 'none';
    elements.tDir.style.display = session.mode === 'race' ? '' : 'none';
    camera.setDirector(false);
  }

  function clear(): void {
    current = null;
    elements.hud.classList.remove('on');
    elements.flash.innerHTML = '';
    clearBanner();
  }

  function entryUi(entry: Entry): EntryUiState {
    if (!current) return {};
    let visual = current.entry.get(entry);
    if (!visual) {
      visual = {};
      current.entry.set(entry, visual);
    }
    return visual;
  }

  function refreshTowerHeader(): void {
    if (!current || current.headerFree === camera.view.free) return;
    current.headerFree = camera.view.free;
    current.header.innerHTML = camera.view.free
      ? '<span class="qstat" style="opacity:.85">FREE CAM — CLICK A DRIVER TO FOLLOW ▸</span>'
      : '<span class="p">P</span><span class="pd"></span><span class="sw" style="background:transparent"></span>' +
        '<span class="nm">DRIVER</span><span class="ty" style="opacity:.8">TYR</span>' +
        `<span class="gp">${current.session.mode === 'race' ? 'INT' : 'GAP'}</span><span class="lp">LAST</span><span class="bp">BEST</span>`;
  }

  function qualifyingStateKey(entry: Entry, session: QualifyingSession): string {
    return `${entry.car ? 1 : 0}|${entry.state}|${entry.boxArm ? 1 : 0}|${session.over ? 1 : 0}`;
  }

  function refreshOps(carIndex: number): void {
    if (current?.session === state.S) buildOpsPanel(carIndex);
  }

  function qualifyingSend(carIndex: number): void {
    const session = state.S;
    if (!session) return;
    const entry = sendQualifyingCar(session, carIndex);
    if (!entry) return;
    toast(`${entry.code} leaves the garage`, 'info');
    refreshOps(carIndex);
  }

  function qualifyingBox(carIndex: number): void {
    const session = state.S;
    if (!session) return;
    const entry = boxQualifyingCar(session, carIndex);
    if (!entry) return;
    toast(`${entry.code} is coming in`, 'info');
    refreshOps(carIndex);
  }

  function buildOpsPanel(carIndex: number): void {
    const session = state.S;
    const panel = current?.ops[carIndex];
    const entry = playerEntry(carIndex);
    if (!session || !panel || !entry || current?.session !== session) return;
    if (session.mode === 'quali') {
      const onTrack = !!entry.car;
      const busy = entry.state === 'pit' || entry.state === 'pitIn' || entry.boxArm;
      const disabled = (!onTrack && (session.over || session.done)) || (onTrack && busy);
      panel.innerHTML = `
        <div class="opline"><span class="sw" style="background:${entry.lu.team.body}"></span>
          <span class="nm">${escapeHtml(entry.name)}</span><span class="ps" id="opPos${carIndex}">—</span></div>
        <div class="bars">
          <div class="bar" id="obT${carIndex}">TYRE ${entry.tyre.c}<div class="tk"><div class="fl"></div></div></div>
          <div class="bar" id="obFc${carIndex}">FOCUS<div class="tk"><div class="fl"></div></div></div>
          <div class="bar" id="obB${carIndex}" style="grid-column:1 / -1">BEST ${Number.isFinite(entry.best) ? formatTime(entry.best) : '—'}<div class="tk" style="visibility:hidden"><div class="fl"></div></div></div>
        </div>
        <div class="oprow"><div class="qstat" id="qst${carIndex}"></div>
          <button class="pitb" id="qbtn${carIndex}" ${disabled ? 'disabled' : ''}>${onTrack ? 'BOX' : 'SEND OUT'}</button></div>`;
      requiredQuery(panel, `#qbtn${carIndex}`, HTMLButtonElement).addEventListener('click', () => {
        if (!entry.car) qualifyingSend(carIndex);
        else qualifyingBox(carIndex);
      });
      entryUi(entry).qualifyingState = qualifyingStateKey(entry, session);
      const status = panel.querySelector(`#qst${carIndex}`);
      if (status) status.textContent = qualifyingStatus(entry, session);
      return;
    }

    const selection = pitSelections[carIndex] ?? pitSelections[0];
    const dead = entry.state === 'dnf' || entry.state === 'fin';
    const pitting = entry.state === 'pit' || entry.state === 'pitIn' || entry.state === 'pitOut';
    panel.innerHTML = `
      <div class="pitmenu chip" id="pm${carIndex}">
        <div class="pm-h">PIT CALL — TYRES</div>
        <div class="small" id="pmProj${carIndex}" style="opacity:.9;margin:2px 0 5px;font-family:var(--mono);font-size:10px"></div>
        <div class="oprow">${(['S', 'H', 'W'] as const).map(compound => `<div class="seg" style="flex:1">
          <button class="${selection.comp === compound ? 'on' : ''}" data-pc="${compound}">${compound === 'S' ? 'SOFT' : compound === 'H' ? 'HARD' : 'WET'}</button></div>`).join('')}</div>
        <div class="oprow"><div class="seg"><button class="${selection.fix ? 'on' : ''}" data-pf="1">PATCH REPAIRS +3.5s ${selection.fix ? '✓' : ''}</button></div></div>
        <div class="oprow"><button class="pitb" style="flex:1" data-call="1">CONFIRM — BOX THIS LAP</button></div>
      </div>
      <div class="opline"><span class="sw" style="background:${entry.lu.team.body}"></span>
        <span class="nm">${escapeHtml(entry.name)}</span><span class="ps" id="opPos${carIndex}">—</span></div>
      <div class="bars">
        <div class="bar" id="obT${carIndex}">TYRE ${entry.tyre.c}<div class="tk"><div class="fl"></div></div></div>
        <div class="bar" id="obF${carIndex}">FUEL<div class="tk"><div class="fl"></div></div></div>
        <div class="bar" id="obS${carIndex}">STRESS<div class="tk"><div class="fl"></div></div></div>
        <div class="bar" id="obR${carIndex}">CAR E·H·C<div class="tks"><div class="tk"><div class="fl"></div></div><div class="tk"><div class="fl"></div></div><div class="tk"><div class="fl"></div></div></div></div>
        <div class="bar" id="obFc${carIndex}" style="grid-column:1 / -1">FOCUS<div class="tk"><div class="fl"></div></div></div>
      </div>
      <div class="oprow"><div class="seg" id="seg${carIndex}">${PACE_NAMES.map((pace, index) =>
        `<button class="${entry.pace === index ? 'on' : ''}" data-pace="${index}">${pace}</button>`).join('')}</div>
        <button class="pitb${entry.pitArm ? ' armed' : ''}" id="pit${carIndex}" ${dead || pitting ? 'disabled' : ''}>
        ${dead ? entry.state === 'fin' ? 'FINISHED' : 'OUT' : pitting ? 'IN PITS' : entry.pitArm ? 'BOXING' : 'PIT'}</button></div>`;
    panel.querySelectorAll<HTMLElement>('[data-pace]').forEach(button => {
      button.addEventListener('click', () => {
        setPace(entry, Number(button.dataset.pace));
        buildOpsPanel(carIndex);
      });
    });
    const menu = requiredQuery(panel, `#pm${carIndex}`, HTMLElement);
    requiredQuery(panel, `#pit${carIndex}`, HTMLButtonElement).addEventListener('click', () => {
      if (dead || pitting) return;
      if (entry.pitArm) {
        cancelPitCall(entry);
        buildOpsPanel(carIndex);
      } else menu.classList.toggle('on');
    });
    menu.querySelectorAll<HTMLElement>('[data-pc]').forEach(button => {
      button.addEventListener('click', () => {
        const compound = validCompound(button.dataset.pc);
        if (compound) selection.comp = compound;
        buildOpsPanel(carIndex);
        document.getElementById(`pm${carIndex}`)?.classList.add('on');
      });
    });
    menu.querySelector<HTMLElement>('[data-pf]')?.addEventListener('click', () => {
      selection.fix = !selection.fix;
      buildOpsPanel(carIndex);
      document.getElementById(`pm${carIndex}`)?.classList.add('on');
    });
    menu.querySelector<HTMLElement>('[data-call]')?.addEventListener('click', () => {
      const arm: PitArm = { comp: selection.comp, fix: selection.fix };
      setPitCall(entry, arm);
      buildOpsPanel(carIndex);
    });
  }

  function setBar(id: string, fraction: number, invert = false): void {
    const node = document.getElementById(id);
    const fill = node?.querySelector<HTMLElement>('.fl');
    if (!node || !fill) return;
    const normalized = clamp(fraction, 0, 1);
    fill.style.width = `${Math.round(normalized * 100)}%`;
    const bad = invert ? normalized : 1 - normalized;
    node.classList.toggle('warn', bad > 0.45 && bad <= 0.72);
    node.classList.toggle('crit', bad > 0.72);
  }

  function setBar3(id: string, values: readonly number[]): void {
    const node = document.getElementById(id);
    if (!node) return;
    const fills = node.querySelectorAll<HTMLElement>('.fl');
    values.forEach((value, index) => {
      const fill = fills[index];
      if (!fill) return;
      const normalized = clamp(value, 0, 1);
      fill.style.width = `${Math.round(normalized * 100)}%`;
      fill.style.background = normalized < 0.35 ? '#D4574E' : normalized < 0.6 ? '#E9B44C' : '';
    });
  }

  function qualifyingStatus(entry: Entry, session: QualifyingSession): string {
    if (!entry.car) {
      if (session.over) return 'SESSION OVER';
      const left = session.tEnd - session.t;
      const runTime = 2.3 * session.prof.lapTime + 20;
      const runCount = Math.floor(left / runTime);
      const onTrack = session.entries.filter(other => other.car && other.state !== 'pit').length;
      const traffic = onTrack === 0 ? 'TRACK CLEAR' : `${onTrack} ON TRACK`;
      if (runCount <= 0) return left > runTime * 0.75 ? 'LAST CALL — SEND NOW' : 'NO TIME FOR A RUN';
      return `TIME FOR ${runCount} RUN${runCount > 1 ? 'S' : ''} · ${traffic}`;
    }
    if (entry.state === 'pit') return 'IN THE BOX';
    if (entry.state === 'pitIn') return 'PIT LANE';
    if (entry.state === 'pitOut') return 'PIT EXIT';
    if (entry.boxArm || entry.lapPhase === 'in') return 'IN LAP';
    if ((entry.lapPhase === 'flying' || entry.lapLive) && entry.lineT >= 0) {
      let text = `FLYING · ${formatTime(session.t - entry.lineT).slice(0, -1)}`;
      if (entry._dLive != null) {
        text = `FLYING ${entry._dLive >= 0 ? '+' : '−'}${Math.abs(entry._dLive).toFixed(2)}`;
        if (Number.isFinite(entry.best)) {
          const projected = entry.best + entry._dLive;
          let position = 1;
          for (const other of session.entries)
            if (other !== entry && Number.isFinite(other.best) && other.best < projected) position++;
          text += ` · ~P${position}`;
        }
      }
      return text;
    }
    return 'OUT LAP';
  }

  function update(session: Session): void {
    if (!current || current.session !== session) return;
    refreshTowerHeader();
    if (session.mode === 'race') updateRace(session);
    else updateQualifying(session);
  }

  function updateQualifying(session: QualifyingSession): void {
    const ordered = sessionOrder(session);
    const first = ordered[0];
    const pole = first && Number.isFinite(first.best) ? first.best : null;
    ordered.forEach((entry, index) => {
      const row = current?.towerRows.get(entry);
      if (!row) return;
      elements.tower.appendChild(row);
      requiredQuery(row, '.p', HTMLElement).textContent = String(index + 1);
      requiredQuery(row, '.gp', HTMLElement).textContent = Number.isFinite(entry.best)
        ? index === 0 || pole == null ? 'POLE' : `+${(entry.best - pole).toFixed(2)}`
        : '—';
      requiredQuery(row, '.lp', HTMLElement).textContent = entry.lastLap ? formatTime(entry.lastLap) : '—';
      const best = requiredQuery(row, '.bp', HTMLElement);
      best.textContent = Number.isFinite(entry.best) ? formatTime(entry.best) : '—';
      requiredQuery(row, '.pip', HTMLElement).style.background = entry.car ? TYRE_PIP[entry.tyre.c] : 'transparent';
      requiredQuery(row, '.ta', HTMLElement).textContent = entry.car ? String(tyreAge(entry)) : '';
      best.classList.toggle('fastest', index === 0 && Number.isFinite(entry.best));
      row.classList.toggle('live', !!entry.car);
      row.classList.toggle('cam', !camera.view.free && session.entries.indexOf(entry) === session.camI);
      const position = entry.isPlayer ? document.getElementById(`opPos${entry.ci}`) : null;
      if (position) position.textContent = `P${index + 1}`;
    });
    elements.tClockB.textContent = session.over ? 'FLAG' : formatTime(Math.max(0, session.tEnd - session.t)).slice(0, -3);
    elements.tWx.classList.remove('rain');
    elements.tWxT.textContent = session.evo > 0.75 ? 'RUBBERED IN' : session.evo > 0.3 ? 'TRACK EVOLVING' : 'GREEN TRACK';
    for (const carIndex of [0, 1]) {
      const entry = playerEntry(carIndex);
      if (!entry) continue;
      const visual = entryUi(entry);
      const stateKey = qualifyingStateKey(entry, session);
      if (visual.qualifyingState !== stateKey) buildOpsPanel(carIndex);
      const tyre = document.getElementById(`obT${carIndex}`);
      if (tyre?.firstChild) tyre.firstChild.textContent = `TYRE ${entry.tyre.c} `;
      setBar(`obT${carIndex}`, 1 - entry.tyre.wear);
      setBar(`obFc${carIndex}`, entry.focusNow);
      const best = document.getElementById(`obB${carIndex}`);
      if (best?.firstChild)
        best.firstChild.textContent = `BEST ${Number.isFinite(entry.best) ? formatTime(entry.best) : '—'} `;
      const status = document.getElementById(`qst${carIndex}`);
      if (status) status.textContent = qualifyingStatus(entry, session);
    }
  }

  function updateRace(session: RaceSession): void {
    const ordered = sessionOrder(session);
    const leader = ordered.find(entry => entry.state !== 'dnf') ?? null;
    camera.directorTick(session, ordered, leader);
    let fastest = Infinity;
    for (const entry of session.entries)
      if (Number.isFinite(entry.best)) fastest = Math.min(fastest, entry.best);
    const now = Date.now();
    ordered.forEach((entry, index) => {
      const row = current?.towerRows.get(entry);
      if (!row) return;
      const visual = entryUi(entry);
      elements.tower.appendChild(row);
      requiredQuery(row, '.p', HTMLElement).textContent = entry.state === 'dnf' ? '–' : String(index + 1);
      if (entry.state !== 'dnf') {
        if (visual.previousPosition != null && visual.previousPosition !== index + 1) {
          visual.positionDelta = visual.previousPosition - (index + 1);
          visual.positionDeltaAt = now;
        }
        visual.previousPosition = index + 1;
      }
      const delta = requiredQuery(row, '.pd', HTMLElement);
      const showDelta = !!visual.positionDelta && visual.positionDeltaAt != null &&
        now - visual.positionDeltaAt < 4500 && entry.state !== 'dnf';
      delta.textContent = showDelta
        ? `${visual.positionDelta! > 0 ? '▲' : '▼'}${Math.abs(visual.positionDelta!)}`
        : '';
      delta.className = `pd${showDelta ? visual.positionDelta! > 0 ? ' up' : ' dn' : ''}`;
      let gapText = '';
      let distanceAhead = Infinity;
      let closing = false;
      const inPit = entry.state === 'pit' || entry.state === 'pitIn' || entry.state === 'pitOut';
      if (entry.state === 'dnf') gapText = 'OUT';
      else if (entry.state === 'fin') gapText = 'FIN';
      else if (inPit) gapText = 'PIT';
      else if (entry === leader) gapText = 'LEAD';
      else {
        const ahead = ordered[index - 1];
        if (ahead?.car && ahead.state !== 'dnf') {
          distanceAhead = ahead.prog - entry.prog;
          if (distanceAhead >= session.trk.len)
            gapText = `+${Math.floor(distanceAhead / session.trk.len)}L`;
          else {
            const interval = Math.max(0, distanceAhead / Math.max(28, entry.spd));
            gapText = `+${interval.toFixed(1)}`;
            if (visual.intervalLap !== entry.cross) {
              if (visual.intervalReference == null) delete visual.intervalPrevious;
              else visual.intervalPrevious = visual.intervalReference;
              visual.intervalReference = interval;
              visual.intervalLap = entry.cross;
            }
            closing = visual.intervalPrevious != null && visual.intervalReference != null &&
              visual.intervalReference < visual.intervalPrevious - 0.15 && interval < 12;
          }
        }
      }
      const gap = requiredQuery(row, '.gp', HTMLElement);
      gap.textContent = gapText;
      gap.classList.toggle('closing', closing);
      requiredQuery(row, '.pip', HTMLElement).style.background = TYRE_PIP[entry.tyre.c];
      requiredQuery(row, '.ta', HTMLElement).textContent = entry.state === 'dnf' ? '' : String(tyreAge(entry));
      if (visual.lapSeen !== entry.cross) {
        if (entry.lastLap && Number.isFinite(entry.best) && entry.lastLap <= entry.best + 1e-9)
          visual.personalBestAt = now;
        visual.lapSeen = entry.cross;
      }
      const last = requiredQuery(row, '.lp', HTMLElement);
      const best = requiredQuery(row, '.bp', HTMLElement);
      last.textContent = entry.lastLap ? formatTime(entry.lastLap) : '—';
      best.textContent = Number.isFinite(entry.best) ? formatTime(entry.best) : '—';
      last.classList.toggle('pb', visual.personalBestAt != null && now - visual.personalBestAt < 5000);
      best.classList.toggle('fastest', Number.isFinite(entry.best) && entry.best === fastest);
      const ahead = ordered[index - 1];
      const duel = !!(ahead && entry.battle && ahead.battle && entry.state === 'run' &&
        ahead.state === 'run' && distanceAhead < 40);
      row.classList.toggle('duel', duel);
      if (duel) current?.towerRows.get(ahead)?.classList.add('duel');
      else if (!entry.battle) row.classList.remove('duel');
      row.classList.toggle('out', entry.state === 'dnf');
      row.classList.toggle('cam', !camera.view.free && session.entries.indexOf(entry) === session.camI);
      const position = entry.isPlayer ? document.getElementById(`opPos${entry.ci}`) : null;
      if (position) position.textContent = entry.state === 'dnf' ? 'DNF' : `P${index + 1}`;
    });
    const lapsDone = leader
      ? Math.max(0, Math.min(session.laps, (leader.state === 'fin' ? leader.finLaps : leader.cross - 1) + 1))
      : 1;
    if (current?.session === session) current.lapDisplay = Math.max(1, lapsDone);
    elements.tLapB.textContent = `${Math.max(1, lapsDone)}/${session.laps}`;
    elements.tClockB.textContent = formatTime(Math.max(0, session.t - session.goT)).slice(0, -3);
    elements.tWx.classList.toggle('rain', session.wet > 0.15 ||
      (session.rainAt >= 0 && session.rainAt - session.t < 120 && session.t < session.rainAt));
    const averageLap = leader?.lastLap || session.prof.lapTime * 1.1;
    let weather: string;
    if (session.raining) {
      const lapsUntilEnd = Math.ceil(Math.max(0, session.rainEnd - session.t) / averageLap);
      weather = lapsUntilEnd > 4 ? 'RAIN' : lapsUntilEnd > 1 ? `RAIN · ENDS ~${lapsUntilEnd} LAPS` : 'RAIN · STOPPING';
    } else if (session.rainAt >= 0 && session.t < session.rainAt) {
      const lapsUntilRain = (session.rainAt - session.t) / averageLap;
      if (lapsUntilRain > 8) weather = `RAIN ~LAP ${Math.round((lapsDone + lapsUntilRain) / 2) * 2}`;
      else if (lapsUntilRain > 1) weather = `RAIN IN ~${Math.round(lapsUntilRain)} LAPS`;
      else weather = 'RAIN IMMINENT';
    } else weather = session.wet > 0.3 ? 'WET' : session.wet > 0.05 ? 'DRYING' : 'DRY';
    elements.tWxT.textContent = weather;
    for (const carIndex of [0, 1]) {
      const entry = playerEntry(carIndex);
      if (!entry) continue;
      const lapsToFlag = Math.max(0, session.laps - (entry.cross - 1));
      const tyreLeft = tyreLapsLeft(entry, session);
      const fuelLeft = fuelLapsLeft(entry, session);
      const tyre = document.getElementById(`obT${carIndex}`);
      if (tyre?.firstChild)
        tyre.firstChild.textContent = `TYRE ${entry.tyre.c} ${tyreAge(entry)}L · ~${tyreLeft}${tyreLeft < lapsToFlag && entry.state !== 'fin' ? '⚠' : ''} `;
      setBar(`obT${carIndex}`, 1 - entry.tyre.wear);
      const fuel = document.getElementById(`obF${carIndex}`);
      if (fuel?.firstChild)
        fuel.firstChild.textContent = `FUEL · ${fuelLeft} LAPS${fuelLeft < lapsToFlag && entry.state !== 'fin' ? ' ⚠' : ''} `;
      setBar(`obF${carIndex}`, entry.fuel);
      setBar(`obS${carIndex}`, entry.stress, true);
      setBar3(`obR${carIndex}`, [entry.rel.e, entry.rel.h, entry.rel.c]);
      setBar(`obFc${carIndex}`, entry.focusNow);
      const pitMenu = document.getElementById(`pm${carIndex}`);
      if (pitMenu?.classList.contains('on')) {
        const projection = projectPitStop(entry, session, pitSelections[carIndex]?.fix ?? false);
        const projectionElement = document.getElementById(`pmProj${carIndex}`);
        if (projectionElement)
          projectionElement.textContent = `COST ~${Math.round(projection.loss)}s · REJOIN ~P${projection.pos}${projection.behind ? ` BEHIND ${projection.behind.code}` : ''}`;
      }
    }
  }

  return {
    build,
    clear,
    update,
    playerEntry,
    refreshOps,
    qualifyingSend,
    qualifyingBox,
    toast,
    banner,
    clearBanner,
    showLights
  };
}
