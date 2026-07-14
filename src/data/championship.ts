import type { CalendarEventDefinition } from '../shared/types';

export const CALENDAR = [
  { trk: 0, name: 'PRADO VERDE GP', rainP: 0.15 },
  { trk: 1, name: 'COSTA DO SOL GP', rainP: 0.25 },
  { trk: 2, name: 'NORDWALD GP', rainP: 0.55 },
  { trk: 3, name: 'VILLA REALE GP', rainP: 0.35 },
  { trk: 4, name: 'ANHEMBI GP', rainP: 0.15 },
  { trk: 5, name: 'GRAN PREMIO CERRO ALTO', rainP: 0.60 }
] as const satisfies readonly CalendarEventDefinition[];
export const PTSTAB = [9, 6, 4, 3, 2, 1];
export const PRIZE = [20, 15, 11, 8, 6, 4, 3, 2, 1, 1, 1, 1];
export const PACE_NAMES = ['SAVE', 'RACE', 'PUSH'];
