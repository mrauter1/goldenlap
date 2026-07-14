export interface TrackPalette {
  grass: string;
  stripe: string;
  road: string;
  edge: string;
  shadow: string;
  tree: string;
  tree2: string;
  bush: string;
  rock: string;
  dust: string;
}

export interface TrackDefinition {
  id: string;
  no: string;
  name: string;
  country: string;
  width: number;
  seed: number;
  meta: { archetype: string; blurb: string };
  pal: TrackPalette;
  pts: readonly (readonly [number, number])[];
}

export interface CalendarEventDefinition {
  trk: number;
  name: string;
  rainP: number;
}

export type Exhaustive<T extends never> = T;
