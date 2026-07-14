import type { LineupEntry, Session, TyreCompound } from '../session/model';
import type { CalendarEventDefinition } from '../shared/types';

export type GamePhase =
  | 'menu'
  | 'staff'
  | 'quali'
  | 'grid'
  | 'race'
  | 'results'
  | 'workshop'
  | 'seasonEnd';
export type CarPartKey = 'e' | 'h' | 'c';

export interface CarPart {
  kind: CarPartKey;
  id: string;
  lvl: number;
  rel: number;
}

export interface TeamCar {
  parts: Record<CarPartKey, CarPart>;
}

export interface TuningGauge {
  pos: number;
  w0: number;
  w1: number;
  st: '' | 'golden' | 'over';
}

export interface TuningState {
  pts: number;
  bonus: number;
  g: TuningGauge[];
}

export interface RaceResultRow {
  name: string;
  code: string;
  teamName: string;
  teamId: string;
  color: string;
  isPlayer: boolean;
  pos: number;
  dnf: boolean;
  time: number;
  gap: string;
  note: string;
}

export type IncomeLine = readonly [label: string, amount: number];
export interface RaceIncome { lines: IncomeLine[]; total: number }
export interface RaceHighlights {
  fl?: { code: string; t: number };
  climber?: { code: string; gain: number };
  stops?: { code: string; n: number };
}

export interface LastRaceResult {
  res: RaceResultRow[];
  inc: RaceIncome;
  round: number;
  hl?: RaceHighlights;
}

export interface GameState {
  phase: GamePhase;
  teamI: number;
  cash: number;
  myDrivers: number[];
  eng: number;
  chief: number;
  phil: number;
  spon: number;
  cars: TeamCar[] | null;
  round: number;
  drvPts: Record<string, number>;
  teamPts: Record<string, number>;
  tune: TuningState | null;
  grid: number[] | null;
  lastRes: LastRaceResult | null;
  S: Session | null;
  calendar: CalendarEventDefinition[];
  weekLu?: LineupEntry[];
  startTyre?: TyreCompound[];
  qualiBest?: number[];
}

export function createGameState(
  calendar: readonly CalendarEventDefinition[] = []
): GameState {
  return {
    phase: 'menu',
    teamI: -1,
    cash: 0,
    myDrivers: [],
    eng: -1,
    chief: -1,
    phil: -1,
    spon: -1,
    cars: null,
    round: 0,
    drvPts: {},
    teamPts: {},
    tune: null,
    grid: null,
    lastRes: null,
    S: null,
    calendar: calendar.map(event => ({ ...event }))
  };
}
