import { describe, expect, test } from 'bun:test';
import { prepareHeadlessTrack, runHeadlessRace } from '../../../tools/lib/headless-sim';

describe('bounded release race worker', () => {
  test('returns the same ordered summary as serial production simulation', () => {
    const seed = 1009;
    const serial = runHeadlessRace(prepareHeadlessTrack('prado'), {
      seed,
      laps: 1,
      wet: 0,
      includeLapStrata: true
    });
    const worker = Bun.spawnSync([
      'bun', 'tools/run-race-stratum.ts', '--track', 'prado',
      '--weather', 'dry', '--seeds', String(seed)
    ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(worker.exitCode).toBe(0);
    const summaries = JSON.parse(worker.stdout.toString());
    expect(summaries).toEqual([serial]);
  }, 20_000);
});
