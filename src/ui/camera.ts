import { clamp } from '../shared/math';
import type { Entry, Session } from '../session/model';
import type { CameraView } from './render';

export interface CameraViewport { width: number; height: number }

export interface CameraController {
  readonly view: CameraView;
  reset(): void;
  isDirectorOn(): boolean;
  setDirector(enabled: boolean): void;
  toggleDirector(): void;
  followEntry(session: Session, index: number): void;
  directorTick(session: Session, ordered: readonly Entry[], leader: Entry | null): void;
  cameraCandidate(entryIndex: number): void;
  toggleFree(): void;
  resetZoom(): void;
  engageFree(): void;
  panPixels(deltaX: number, deltaY: number): void;
  setFreeZoom(scale: number): void;
  zoomBy(factor: number): void;
  nearestCarAt(session: Session, screenX: number, screenY: number): number;
}

interface CameraOptions {
  viewport(): CameraViewport;
  directorButton?: HTMLButtonElement;
}

interface DirectorEvent { entryIndex: number; at: number }

const PPM_MIN = 0.22;
const PPM_MAX = 8;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.6;

export function createCameraController(options: CameraOptions): CameraController {
  const view: CameraView = { x: 0, y: 0, ppm: 2.6, init: false, free: false, zoom: 1 };
  let directorOn = false;
  let directorHold = 0;
  let directorEvent: DirectorEvent | null = null;

  function reset(): void {
    view.init = false;
    view.free = false;
    view.zoom = 1;
  }

  function isDirectorOn(): boolean {
    return directorOn;
  }

  function setDirector(enabled: boolean): void {
    directorOn = enabled;
    options.directorButton?.classList.toggle('gold', enabled);
    if (enabled) {
      view.free = false;
      view.zoom = 1;
      directorHold = 0;
    }
  }

  function toggleDirector(): void {
    setDirector(!directorOn);
  }

  function followEntry(session: Session, index: number): void {
    if (index < 0 || index >= session.entries.length) return;
    session.camI = index;
    if (directorOn) setDirector(false);
    if (view.free) {
      view.free = false;
      view.zoom = 1;
    }
  }

  function cameraCandidate(entryIndex: number): void {
    directorEvent = { entryIndex, at: Date.now() };
  }

  function directorTick(
    session: Session,
    ordered: readonly Entry[],
    leader: Entry | null
  ): void {
    if (!directorOn || view.free || session.phase !== 'run') return;
    const now = Date.now();
    if (directorEvent && now - directorEvent.at < 5000) {
      const entry = session.entries[directorEvent.entryIndex];
      if (entry?.car && directorEvent.entryIndex !== session.camI) {
        session.camI = directorEvent.entryIndex;
        directorHold = now + 6000;
      }
      directorEvent = null;
      return;
    }
    if (now < directorHold) return;
    let best = -1;
    let bestDistance = Infinity;
    for (let index = 1; index < ordered.length; index++) {
      const ahead = ordered[index - 1]!;
      const behind = ordered[index]!;
      if (ahead.state !== 'run' || behind.state !== 'run' || !behind.battle || !ahead.battle)
        continue;
      const score = ahead.prog - behind.prog + index * 3;
      if (score < bestDistance) {
        bestDistance = score;
        best = session.entries.indexOf(behind);
      }
    }
    if (best < 0) {
      const pitEntry = session.entries.findIndex(entry => entry.state === 'pitIn' || entry.state === 'pit');
      best = pitEntry >= 0 ? pitEntry : leader ? session.entries.indexOf(leader) : -1;
    }
    if (best >= 0 && best !== session.camI) {
      session.camI = best;
      directorHold = now + 7000;
    } else directorHold = now + 2500;
  }

  function toggleFree(): void {
    view.free = !view.free;
    if (!view.free) view.zoom = 1;
  }

  function resetZoom(): void {
    if (view.free) view.free = false;
    view.zoom = 1;
  }

  function engageFree(): void {
    if (!view.free) {
      view.free = true;
      view.zoom = 1;
    }
  }

  function panPixels(deltaX: number, deltaY: number): void {
    engageFree();
    view.x -= deltaX / view.ppm;
    view.y -= deltaY / view.ppm;
  }

  function zoomBy(factor: number): void {
    if (view.free) view.ppm = clamp(view.ppm * factor, PPM_MIN, PPM_MAX);
    else view.zoom = clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  }

  function setFreeZoom(scale: number): void {
    engageFree();
    view.ppm = clamp(scale, PPM_MIN, PPM_MAX);
  }

  function nearestCarAt(session: Session, screenX: number, screenY: number): number {
    const viewport = options.viewport();
    let best = -1;
    let bestDistance = 22 * 22;
    session.entries.forEach((entry, index) => {
      if (!entry.car) return;
      const x = (entry.car.x - view.x) * view.ppm + viewport.width / 2;
      const y = (entry.car.y - view.y) * view.ppm + viewport.height / 2;
      const distance = (x - screenX) ** 2 + (y - screenY) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  return {
    view,
    reset,
    isDirectorOn,
    setDirector,
    toggleDirector,
    followEntry,
    directorTick,
    cameraCandidate,
    toggleFree,
    resetZoom,
    engageFree,
    panPixels,
    setFreeZoom,
    zoomBy,
    nearestCarAt
  };
}
