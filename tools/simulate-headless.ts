import {
  prepareHeadlessTrack,
  runFocusedSession,
  runSingleCar,
  type FocusedScenario
} from './lib/headless-sim';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function numberArgument(name: string, fallback: number): number {
  const raw = argument(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

try {
  const trackId = argument('--track') ?? 'prado';
  const seed = numberArgument('--seed', 101);
  const scenario = argument('--scenario');
  const built = prepareHeadlessTrack(trackId);
  const summary = scenario
    ? runFocusedSession(built, {
        scenario: scenario as FocusedScenario,
        seed,
        simulatedSeconds: numberArgument('--seconds', 8),
        maxSteps: numberArgument('--max-steps', 100_000),
        ...(argument('--phase') === null
          ? {}
          : { phase: argument('--phase') as 'straight' | 'approach' | 'corner' }),
        ...(argument('--gap') === null
          ? {}
          : { initialGapM: numberArgument('--gap', 20) }),
        ...(argument('--closing') === null
          ? {}
          : { closingSpeedMps: numberArgument('--closing', 8) }),
        ...(argument('--attacker-grip') === null
          ? {}
          : { attackerGripScale: numberArgument('--attacker-grip', 1.06) }),
        ...(argument('--deadline-ms') === null
          ? {}
          : { deadlineMs: numberArgument('--deadline-ms', 0) })
      })
    : runSingleCar(built, {
        seed,
        laps: numberArgument('--laps', 2),
        maxSteps: numberArgument('--max-steps', 100_000),
        ...(argument('--deadline-ms') === null
          ? {}
          : { deadlineMs: numberArgument('--deadline-ms', 0) })
      });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.reason === 'complete' ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
