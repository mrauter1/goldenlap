export interface PhysicsConstants {
  m: number; g: number; L: number; a: number; b: number; Iz: number;
  mu: number; muRearBonus: number; kDf: number; dfMax: number; dfFront: number;
  power: number; Fmax: number; tc: number; revForce: number;
  brakeForce: number; brakeBias: number; circK: number;
  kDrag: number; kRoll: number; kDragLat: number;
  slipPeakF: number; slipPeakR: number; slipSharp: number;
  steerMax: number; steerFade: number; steerLerp: number;
  yawDamp: number; vTop: number; profMu: number; brkFrac: number;
  colRadius: number; colR2: number; carLen: number; carWid: number;
}

export const PHYS: Readonly<PhysicsConstants> = {
  m: 720, g: 9.81, L: 3.10, a: 1.62, b: 1.48, Iz: 1720,
  mu: 1.70, muRearBonus: 1.08,
  kDf: 2.35, dfMax: 5200, dfFront: 0.477,
  power: 520000, Fmax: 13000, tc: 0.82, revForce: 5200,
  brakeForce: 26500, brakeBias: 0.58, circK: 0.72,
  kDrag: 0.72, kRoll: 140, kDragLat: 1.6,
  slipPeakF: 0.13, slipPeakR: 0.10, slipSharp: 1.8,
  steerMax: 0.44, steerFade: 20, steerLerp: 11,
  yawDamp: 900, vTop: 89,
  profMu: 0.93, brkFrac: 0.92,
  colRadius: 1.5, colR2: 1.0, carLen: 5.4, carWid: 2.0
};

export const SURF = {
  road: { mu: 1.00, drag: 0 },
  curb: { mu: 0.94, drag: 2.5 },
  grass: { mu: 0.52, drag: 30 }
} as const;
