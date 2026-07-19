import type { Entry, QualifyingLapPhase } from '../model';

export function qualifyingLapPhase(entry: Entry): QualifyingLapPhase | null {
  if (entry.boxArm || entry.pitArm || entry.state === 'pitIn' || entry.state === 'pit')
    return 'in';
  if (entry.lapPhase) return entry.lapPhase;
  return entry.lapLive ? 'flying' : 'out';
}

export function completedRaceLaps(entry: Entry): number {
  // The first start-line crossing begins lap one; it does not complete a lap.
  // Keep this aligned with fuel/strategy and classification semantics.
  return Math.max(0, entry.cross - 1);
}
