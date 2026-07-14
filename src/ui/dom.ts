export interface DomElements {
  hud: HTMLElement;
  tRaceB: HTMLElement;
  tRaceN: HTMLElement;
  tLap: HTMLElement;
  tLapB: HTMLElement;
  tWx: HTMLElement;
  tWxT: HTMLElement;
  tClockB: HTMLElement;
  tGarage: HTMLButtonElement;
  tDir: HTMLButtonElement;
  sp0: HTMLButtonElement;
  sp1: HTMLButtonElement;
  sp4: HTMLButtonElement;
  sp8: HTMLButtonElement;
  tower: HTMLElement;
  ops: HTMLElement;
  feed: HTMLElement;
  banner: HTMLElement;
  flash: HTMLElement;
  sheet: HTMLElement;
  sheetBody: HTMLElement;
  menu: HTMLElement;
  teamCards: HTMLElement;
}

export interface DomRegistry {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  miniCv: HTMLCanvasElement;
  miniCtx: CanvasRenderingContext2D;
  el: DomElements;
}

export interface ViewportController {
  readonly state: { width: number; height: number; dpr: number };
  bind(): void;
}

function required<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Golden Lap boot failed: missing required element #${id}`);
  if (!(element instanceof constructor))
    throw new Error(`Golden Lap boot failed: #${id} has the wrong element type`);
  return element;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Golden Lap boot failed: canvas #${canvas.id} has no 2D context`);
  return context;
}

export function createDomRegistry(): DomRegistry {
  const cv = required('cv', HTMLCanvasElement);
  const miniCv = required('mini', HTMLCanvasElement);
  return {
    cv,
    ctx: context2d(cv),
    miniCv,
    miniCtx: context2d(miniCv),
    el: {
      hud: required('hud', HTMLElement),
      tRaceB: required('tRaceB', HTMLElement),
      tRaceN: required('tRaceN', HTMLElement),
      tLap: required('tLap', HTMLElement),
      tLapB: required('tLapB', HTMLElement),
      tWx: required('tWx', HTMLElement),
      tWxT: required('tWxT', HTMLElement),
      tClockB: required('tClockB', HTMLElement),
      tGarage: required('tGarage', HTMLButtonElement),
      tDir: required('tDir', HTMLButtonElement),
      sp0: required('sp0', HTMLButtonElement),
      sp1: required('sp1', HTMLButtonElement),
      sp4: required('sp4', HTMLButtonElement),
      sp8: required('sp8', HTMLButtonElement),
      tower: required('tower', HTMLElement),
      ops: required('ops', HTMLElement),
      feed: required('feed', HTMLElement),
      banner: required('banner', HTMLElement),
      flash: required('flash', HTMLElement),
      sheet: required('sheet', HTMLElement),
      sheetBody: required('sheetBody', HTMLElement),
      menu: required('menu', HTMLElement),
      teamCards: required('teamCards', HTMLElement)
    }
  };
}

export function createViewportController(canvas: HTMLCanvasElement): ViewportController {
  const state = { width: 0, height: 0, dpr: 1 };
  let bound = false;
  const resize = (): void => {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
  };
  return {
    state,
    bind(): void {
      if (bound) return;
      bound = true;
      window.addEventListener('resize', resize);
      resize();
    }
  };
}
