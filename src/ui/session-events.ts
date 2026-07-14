import type {
  MessageKind, Session, SessionAudioWave, SessionEvent
} from '../session/model';

export interface SessionEventHandlers {
  toast(message: string, kind: MessageKind): void;
  banner(tone: MessageKind, title: string, subtitle: string): void;
  refreshOps(carIndex: number): void;
  beep(frequency: number, duration: number, wave: SessionAudioWave, gain: number): void;
  chime(kind: 'up' | 'down'): void;
  thud(strength: number): void;
  fanfare(): void;
  confetti(): void;
  addSkid(x0: number, y0: number, x1: number, y1: number, alpha: number): void;
  addDust(x: number, y: number, vx: number, vy: number, big: boolean): void;
  applyTuningDelta(delta: 1): void;
  cameraCandidate(entryIndex: number, kind: 'incident' | 'pit' | 'battle'): void;
  completeQualifying(session: Session): void;
  completeRace(session: Session): void;
}

function unreachable(event: never): never {
  throw new Error(`Unhandled session event: ${JSON.stringify(event)}`);
}

export function drainSessionEvents(
  session: Session,
  handlers: SessionEventHandlers
): void {
  while (session.events.length) {
    const event = session.events.shift()!;
    consumeSessionEvent(session, event, handlers);
  }
  session.pendingTuningLearn = 0;
}

function consumeSessionEvent(
  session: Session,
  event: SessionEvent,
  handlers: SessionEventHandlers
): void {
  switch (event.type) {
    case 'toast':
      handlers.toast(event.message, event.kind);
      return;
    case 'banner':
      handlers.banner(event.tone, event.title, event.subtitle);
      return;
    case 'audio':
      switch (event.cue) {
        case 'beep':
          handlers.beep(event.frequency, event.duration, event.wave, event.gain);
          return;
        case 'chime':
          handlers.chime(event.kind);
          return;
        case 'thud':
          handlers.thud(event.strength);
          return;
        case 'fanfare':
          handlers.fanfare();
          return;
      }
      return unreachable(event);
    case 'effect':
      switch (event.kind) {
        case 'skid':
          handlers.addSkid(event.x0, event.y0, event.x1, event.y1, event.alpha);
          return;
        case 'dust':
          handlers.addDust(event.x, event.y, event.vx, event.vy, event.big);
          return;
        case 'confetti':
          handlers.confetti();
          return;
      }
      return unreachable(event);
    case 'hud-dirty':
      if (event.tuningDelta !== undefined) handlers.applyTuningDelta(event.tuningDelta);
      if (event.carIndex !== undefined) handlers.refreshOps(event.carIndex);
      return;
    case 'camera-candidate':
      handlers.cameraCandidate(event.entryIndex, event.kind);
      return;
    case 'session-complete':
      if (event.kind === 'qualifying') handlers.completeQualifying(session);
      else handlers.completeRace(session);
      return;
  }
  return unreachable(event);
}
