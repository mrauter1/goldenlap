import { clamp } from '../../shared/math';
import { TRAF_DT } from '../strategy';
import { racecraftCalibration } from './config';

export const UTILIZATION_MISTAKE_LIFT_SECONDS = 1.2;

export function utilizationMistakeProbability(
  gripUtilization: number,
  focus: number,
  wet: number,
  seconds = TRAF_DT
): number {
  const hazard = racecraftCalibration().mistakeUtilizationRate *
    clamp(gripUtilization, 0, 1) *
    (1 - clamp(focus, 0, 1)) *
    (1 + clamp(wet, 0, 1)) *
    Math.max(0, seconds);
  return 1 - Math.exp(-hazard);
}
