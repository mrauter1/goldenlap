import type { Entry, Session } from './model';

export function sessionOrder(session: Session): Entry[] {
  const ordered = [...session.entries];
  if (session.mode === 'quali') {
    ordered.sort((left, right) => {
      const leftTime = Number.isFinite(left.best) ? left.best : 9e8 - left.lu.margin * 1e5;
      const rightTime = Number.isFinite(right.best) ? right.best : 9e8 - right.lu.margin * 1e5;
      return leftTime - rightTime;
    });
  } else {
    ordered.sort((left, right) => {
      const leftState = left.state === 'fin' ? 0 : left.state === 'dnf' ? 2 : 1;
      const rightState = right.state === 'fin' ? 0 : right.state === 'dnf' ? 2 : 1;
      if (leftState !== rightState) return leftState - rightState;
      if (leftState === 0) return right.finLaps - left.finLaps || left.finT - right.finT;
      return right.prog - left.prog;
    });
  }
  return ordered;
}
