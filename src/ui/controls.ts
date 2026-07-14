import { clamp } from '../shared/math';
import type { GameState } from '../game/model';
import type { AudioSystem } from './audio';
import type { CameraController } from './camera';
import type { DomElements } from './dom';
import type { SheetController } from './sheets';

export interface ControlsController {
  bind(): void;
  setScale(scale: number, force?: boolean): void;
}

interface ControlsOptions {
  state: GameState;
  canvas: HTMLCanvasElement;
  elements: DomElements;
  audio: AudioSystem;
  camera: CameraController;
  sheets: SheetController;
}

interface PointerPoint { x: number; y: number }
interface DragState extends PointerPoint { moved: boolean }

const DRAG_THRESHOLD = 5;

export function createControlsController(options: ControlsOptions): ControlsController {
  const { state, canvas, elements, audio, camera, sheets } = options;
  let bound = false;

  function setScale(scale: number, force = false): void {
    const session = state.S;
    if (!session) return;
    let next = scale;
    if (next === 0 && session.scale === 0 && !force) next = session.prevScale || 1;
    if (next !== 0) session.prevScale = next;
    session.scale = next;
    const buttons: ReadonlyArray<readonly [HTMLButtonElement, number]> = [
      [elements.sp0, 0],
      [elements.sp1, 1],
      [elements.sp4, 4],
      [elements.sp8, 8]
    ];
    for (const [button, value] of buttons) button.classList.toggle('on', value === next);
  }

  function bindKeyboard(): void {
    window.addEventListener('keydown', event => {
      audio.init();
      const session = state.S;
      if (!session || (state.phase !== 'race' && state.phase !== 'quali')) return;
      if (event.key === '1') setScale(1);
      else if (event.key === '2') setScale(4);
      else if (event.key === '3') setScale(8);
      else if (event.key === ' ') {
        setScale(0);
        event.preventDefault();
      } else if (event.key === 'g' || event.key === 'G') {
        if (state.phase === 'quali' && session.mode === 'quali' && !session.done) {
          if (sheets.isOpen()) sheets.hide();
          else sheets.renderGarage();
        }
      } else if (event.key === 'c' || event.key === 'C') {
        const players = session.entries
          .map((_entry, index) => index)
          .filter(index => session.entries[index]!.isPlayer && session.entries[index]!.car);
        if (players.length) {
          const current = players.indexOf(session.camI);
          camera.followEntry(session, players[(current + 1) % players.length]!);
        }
      } else if (event.key === 'f' || event.key === 'F') camera.toggleFree();
      else if (event.key === '0') camera.resetZoom();
    });
  }

  function bindCamera(): void {
    const points = new Map<number, PointerPoint>();
    let drag: DragState | null = null;
    let pinchDistance = 0;
    let pinchScale = 1;

    canvas.addEventListener('pointerdown', event => {
      if (!state.S) return;
      canvas.setPointerCapture(event.pointerId);
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size === 1) drag = { x: event.clientX, y: event.clientY, moved: false };
      else if (points.size === 2) {
        const pair = [...points.values()];
        pinchDistance = Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.y - pair[1]!.y) || 1;
        pinchScale = camera.view.ppm;
        drag = null;
      }
    });

    canvas.addEventListener('pointermove', event => {
      if (!points.has(event.pointerId) || !state.S) return;
      const previous = points.get(event.pointerId)!;
      const current = { x: event.clientX, y: event.clientY };
      points.set(event.pointerId, current);
      if (points.size >= 2) {
        const pair = [...points.values()];
        const distance = Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.y - pair[1]!.y) || 1;
        camera.setFreeZoom(pinchScale * distance / Math.max(1, pinchDistance));
        return;
      }
      if (!drag) return;
      if (!drag.moved && Math.hypot(current.x - drag.x, current.y - drag.y) < DRAG_THRESHOLD)
        return;
      drag.moved = true;
      camera.panPixels(current.x - previous.x, current.y - previous.y);
    });

    const release = (event: PointerEvent): void => {
      const session = state.S;
      const single = points.size === 1 && points.has(event.pointerId);
      if (session && single && drag && !drag.moved) {
        const nearest = camera.nearestCarAt(session, event.clientX, event.clientY);
        if (nearest >= 0) camera.followEntry(session, nearest);
      }
      points.delete(event.pointerId);
      if (points.size < 2) pinchDistance = 0;
      if (points.size === 0) drag = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', event => {
      if (!state.S) return;
      event.preventDefault();
      camera.zoomBy(Math.exp(clamp(-event.deltaY, -240, 240) * 0.0016));
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      if (state.S) camera.resetZoom();
    });
  }

  function bind(): void {
    if (bound) return;
    bound = true;
    elements.sp0.addEventListener('click', () => setScale(0));
    elements.sp1.addEventListener('click', () => setScale(1));
    elements.sp4.addEventListener('click', () => setScale(4));
    elements.sp8.addEventListener('click', () => setScale(8));
    elements.tDir.addEventListener('click', () => camera.toggleDirector());
    elements.tGarage.addEventListener('click', () => {
      if (state.phase === 'quali' && state.S?.mode === 'quali' && !state.S.done)
        sheets.renderGarage();
    });
    bindKeyboard();
    bindCamera();
    window.addEventListener('pointerdown', () => {
      audio.init();
      audio.resume();
    }, { passive: true });
  }

  return { bind, setScale };
}
