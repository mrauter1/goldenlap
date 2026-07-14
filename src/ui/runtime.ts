import type { BuiltTrack } from '../core/model';
import { CHIEFS, ENGINEERS, PHILS } from '../data/personnel';
import { applyResults, classifyRace } from '../game/results';
import type { GameState } from '../game/model';
import {
  beginWeekend,
  completeQualifying,
  createQualifyingSession,
  createRaceSession
} from '../game/weekend';
import {
  advanceRaceCountdown,
  stepSession as stepSessionEngine
} from '../session/session';
import type { Session, SessionConfig } from '../session/model';
import { H_STEP } from '../session/strategy';
import { clamp } from '../shared/math';
import type { AudioSystem } from './audio';
import type { CameraController } from './camera';
import type { ControlsController } from './controls';
import type { DomElements } from './dom';
import type { EffectsSystem } from './effects';
import type { HudController } from './hud';
import type { Renderer } from './render';
import { drainSessionEvents, type SessionEventHandlers } from './session-events';
import type { SheetController } from './sheets';

export interface ApplicationRuntime {
  startWeekend(): void;
  endQualifying(): void;
  startRace(): void;
  stepSession(step: number): void;
  compileResults(session: Session): void;
  startFrameLoop(): void;
}

interface RuntimeOptions {
  state: GameState;
  tracks: readonly BuiltTrack[];
  elements: DomElements;
  audio: AudioSystem;
  effects: EffectsSystem;
  renderer: Renderer;
  camera: CameraController;
  controls: ControlsController;
  hud: HudController;
  sheets: SheetController;
}

export function createApplicationRuntime(options: RuntimeOptions): ApplicationRuntime {
  const {
    state, tracks, elements, audio, effects, renderer, camera, controls, hud, sheets
  } = options;
  let accumulator = 0;
  let previousTimestamp = 0;
  let frameStarted = false;

  function currentTrack(): BuiltTrack {
    const event = state.calendar[state.round];
    const built = event ? tracks[event.trk] : undefined;
    if (!event || !built) throw new Error(`No track configured for round ${state.round}`);
    return built;
  }

  function sessionConfig(): SessionConfig {
    const philosophy = PHILS[state.phil];
    const engineer = ENGINEERS[state.eng];
    const chief = CHIEFS[state.chief];
    if (!philosophy || !engineer || !chief)
      throw new Error('Cannot start a session before team staff and philosophy are selected');
    return {
      playerWearRate: philosophy.wear,
      engineerPrecision: engineer.prec,
      pitSkill: chief.skill,
      pitFocus: chief.foc,
      tuneBonus: state.tune?.bonus ?? 0,
      tuningPoints: state.tune?.pts ?? 0
    };
  }

  function prepareSession(session: Session, qualifying: boolean): void {
    const event = state.calendar[state.round]!;
    sheets.hide();
    elements.hud.classList.add('on');
    hud.build(session);
    elements.tRaceB.textContent = `R${state.round + 1}`;
    elements.tRaceN.textContent = qualifying ? `${event.name} · QUALIFYING` : event.name;
    effects.clearSkids();
    effects.clearDust();
    camera.reset();
    controls.setScale(1, true);
  }

  function startQualifying(): void {
    const built = currentTrack();
    renderer.ensureTrack(built.tr);
    const session = createQualifyingSession(state, built, sessionConfig());
    prepareSession(session, true);
    hud.banner('', 'QUALIFYING', '30 MINUTE SESSION · SET A TIME');
    sheets.renderGarage();
  }

  function startWeekend(): void {
    beginWeekend(state);
    startQualifying();
  }

  function endQualifying(): void {
    if (!completeQualifying(state)) return;
    hud.clear();
    sheets.renderGrid();
  }

  function startRace(): void {
    const event = state.calendar[state.round];
    if (!event) throw new Error(`No calendar event for round ${state.round}`);
    const session = createRaceSession(state, currentTrack(), event.rainP, sessionConfig());
    prepareSession(session, false);
    hud.showLights(0);
  }

  function compileResults(session: Session): void {
    const { results, highlights } = classifyRace(state, session);
    state.S = null;
    hud.clear();
    state.phase = 'results';
    applyResults(state, results);
    if (state.lastRes) state.lastRes.hl = highlights;
    sheets.renderResults();
  }

  const eventHandlers: SessionEventHandlers = {
    toast: hud.toast,
    banner: hud.banner,
    refreshOps: hud.refreshOps,
    beep: (frequency, duration, wave, gain) => audio.beep(frequency, duration, wave, gain),
    chime: kind => audio.chime(kind),
    thud: strength => audio.thud(strength),
    fanfare: () => audio.fanfare(),
    confetti: () => effects.burstConfetti(),
    addSkid: (x0, y0, x1, y1, alpha) => effects.addSkid(x0, y0, x1, y1, alpha),
    addDust: (x, y, vx, vy, big) => effects.addDust(x, y, vx, vy, big),
    applyTuningDelta: delta => {
      if (state.tune) state.tune.pts = Math.min(9, state.tune.pts + delta);
    },
    cameraCandidate: entryIndex => camera.cameraCandidate(entryIndex),
    completeQualifying: session => {
      if (state.S === session) endQualifying();
    },
    completeRace: session => compileResults(session)
  };

  function stepSession(step: number): void {
    const session = state.S;
    if (!session) return;
    session.config.tuneBonus = state.tune?.bonus ?? 0;
    session.config.tuningPoints = state.tune?.pts ?? 0;
    stepSessionEngine(session, step);
    drainSessionEvents(session, eventHandlers);
  }

  function handleCountdown(session: Session, frameDelta: number): void {
    const cue = advanceRaceCountdown(session, frameDelta);
    if (!cue) return;
    if (cue.kind === 'light') {
      hud.showLights(cue.stage);
      audio.beep(392, 0.14, 'square', 0.15);
      return;
    }
    hud.showLights(0, true);
    audio.beep(660, 0.5, 'square', 0.2);
    const event = state.calendar[state.round];
    const laps = session.mode === 'race' ? session.laps : 0;
    hud.banner('', 'LIGHTS OUT', `${event?.name ?? ''} · ${laps} LAPS`);
  }

  function frame(timestamp: number): void {
    requestAnimationFrame(frame);
    const frameDelta = clamp((timestamp - previousTimestamp) / 1000 || 0, 0, 0.1);
    previousTimestamp = timestamp;
    const session = state.S;
    const live = !!session && (state.phase === 'race' || state.phase === 'quali');
    if (!session || !live) {
      accumulator = 0;
      audio.update(frameDelta, null, false, 0);
      return;
    }
    if (session.phase === 'count') handleCountdown(session, frameDelta);
    else if (!sheets.isOpen()) {
      accumulator = Math.min(accumulator + frameDelta * session.scale, H_STEP * 40);
      let guard = 0;
      while (accumulator >= H_STEP && guard < 44 && state.S) {
        stepSession(H_STEP);
        accumulator -= H_STEP;
        guard++;
      }
    } else accumulator = 0;

    const active = state.S;
    if (!active) {
      audio.update(frameDelta, null, false, 0);
      return;
    }
    effects.stepDust(frameDelta * Math.max(1, active.scale));
    renderer.render(active, frameDelta, camera.view);
    active.uiT -= frameDelta;
    if (active.uiT <= 0) {
      active.uiT = 0.25;
      hud.update(active);
    }
    const cameraEntry = active.entries[active.camI];
    audio.update(
      frameDelta,
      cameraEntry?.car ?? null,
      active.phase !== 'count' && active.scale > 0 && active.scale < 4 && !sheets.isOpen(),
      active.wet
    );
  }

  function startFrameLoop(): void {
    if (frameStarted) return;
    frameStarted = true;
    requestAnimationFrame(frame);
  }

  return {
    startWeekend,
    endQualifying,
    startRace,
    stepSession,
    compileResults,
    startFrameLoop
  };
}
