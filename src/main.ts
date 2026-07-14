import { CALENDAR } from './data/championship';
import { TEAM_DEFS } from './data/teams';
import { createGameState } from './game/model';
import { buildTrackCatalog } from './game/tracks';
import { installTestApi } from './test-api';
import { createAudioSystem } from './ui/audio';
import { createCameraController } from './ui/camera';
import { createControlsController } from './ui/controls';
import { createDomRegistry, createViewportController } from './ui/dom';
import { createEffectsSystem } from './ui/effects';
import { createHudController } from './ui/hud';
import { createRenderer } from './ui/render';
import {
  createApplicationRuntime,
  type ApplicationRuntime
} from './ui/runtime';
import { createSheetController } from './ui/sheets';

const game = createGameState(CALENDAR);
const tracks = buildTrackCatalog();
const dom = createDomRegistry();
const viewport = createViewportController(dom.cv);
viewport.bind();
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const audio = createAudioSystem();
const effects = createEffectsSystem(reducedMotion, () => viewport.state);
const renderer = createRenderer({
  context: dom.ctx,
  miniContext: dom.miniCtx,
  effects,
  teams: TEAM_DEFS,
  viewport: () => viewport.state,
  debugLine: () => !!window.__GL?.debugLine
});
const camera = createCameraController({
  viewport: () => viewport.state,
  directorButton: dom.el.tDir
});
let runtime!: ApplicationRuntime;
const sheets = createSheetController({
  state: game,
  elements: dom.el,
  tracks,
  audio,
  effects,
  callbacks: {
    startWeekend: () => runtime.startWeekend(),
    endQualifying: () => runtime.endQualifying(),
    startRace: () => runtime.startRace()
  }
});
const hud = createHudController({ state: game, elements: dom.el, camera });
const controls = createControlsController({
  state: game,
  canvas: dom.cv,
  elements: dom.el,
  audio,
  camera,
  sheets
});
runtime = createApplicationRuntime({
  state: game,
  tracks,
  elements: dom.el,
  audio,
  effects,
  renderer,
  camera,
  controls,
  hud,
  sheets
});

controls.bind();
sheets.buildMenu();
installTestApi({ state: game, tracks, renderer, sheets, hud, controls, runtime });
runtime.startFrameLoop();
