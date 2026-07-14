import type { MessageKind, Session, SessionEvent } from './model';

export function emitSessionEvent(session: Session, event: SessionEvent): void {
  session.events.push(event);
}

export function emitToast(
  session: Session,
  message: string,
  kind: MessageKind = ''
): void {
  emitSessionEvent(session, { type: 'toast', message, kind });
}

export function emitHudDirty(session: Session, carIndex?: number): void {
  emitSessionEvent(
    session,
    carIndex === undefined ? { type: 'hud-dirty' } : { type: 'hud-dirty', carIndex }
  );
}

export function requestTuningPoint(session: Session): boolean {
  const pending = session.pendingTuningLearn ?? 0;
  if (session.config.tuningPoints + pending >= 9) return false;
  session.pendingTuningLearn = pending + 1;
  emitSessionEvent(session, { type: 'hud-dirty', tuningDelta: 1 });
  return true;
}
