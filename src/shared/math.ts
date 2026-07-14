export const TAU = Math.PI * 2;

export function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function normAng(angle: number): number {
  while (angle > Math.PI) angle -= TAU;
  while (angle < -Math.PI) angle += TAU;
  return angle;
}
