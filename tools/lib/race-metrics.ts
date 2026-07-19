// Lap one begins with the whole field compressed. Short probes are therefore
// padded to a five-lap settling horizon before their pass rate is projected
// over production distance. A five-lap (or longer) probe uses its observed
// rate directly; a full race returns the actual count.
export const PASS_RATE_SETTLING_LAPS = 5;

export function productionDistanceEquivalentPasses(
  passes: number,
  simulatedLaps: number,
  productionLaps: number
): number {
  if (!Number.isFinite(passes) || passes < 0)
    throw new Error('passes must be finite and non-negative');
  if (!Number.isInteger(simulatedLaps) || simulatedLaps <= 0)
    throw new Error('simulatedLaps must be a positive integer');
  if (!Number.isInteger(productionLaps) || productionLaps <= 0)
    throw new Error('productionLaps must be a positive integer');
  const rateLaps = Math.max(
    simulatedLaps,
    Math.min(productionLaps, PASS_RATE_SETTLING_LAPS)
  );
  return passes * productionLaps / rateLaps;
}
