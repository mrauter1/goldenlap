import { readFileSync } from 'node:fs';

import { prepareHeadlessTrack, runFocusedSession } from './lib/headless-sim';

interface Manifest {
  tracks: string[];
  weather: Array<'dry' | 'wet'>;
  seedSets: { calibration: number[]; validation: number[]; release: number[] };
}

const manifest = JSON.parse(readFileSync(
  'tests/fixtures/calibration/scenario-manifest.json', 'utf8'
)) as Manifest;
function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const requested = process.argv.includes('--release')
  ? 'release'
  : argument('--seed-set') ?? 'validation';
if (requested !== 'calibration' && requested !== 'validation' && requested !== 'release')
  throw new Error('--seed-set must be calibration, validation, or release');
const seedSet = requested;
const seeds = manifest.seedSets[seedSet];
const replicates = seedSet === 'release' ? 3 : 1;
const rows = [];
for (let trackIndex = 0; trackIndex < manifest.tracks.length; trackIndex++) {
  const trackId = manifest.tracks[trackIndex]!;
  const built = prepareHeadlessTrack(trackId);
  for (let weatherIndex = 0; weatherIndex < manifest.weather.length; weatherIndex++) {
    const weather = manifest.weather[weatherIndex]!;
    const wet = weather === 'wet' ? 0.65 : 0;
    for (const baseSeed of seeds) {
      for (let replicate = 0; replicate < replicates; replicate++) {
        const seed = baseSeed + replicate * 1_000_003 + trackIndex * 1_009 + weatherIndex * 101;
        const side: -1 | 1 = ((seed >>> 1) & 1) === 0 ? -1 : 1;
        const closing = [3, 8, 14][Math.abs(seed) % 3]!;
        const gap = [18, 35, 70][Math.abs(seed >>> 2) % 3]!;
        for (const phase of ['straight', 'corner'] as const) {
          const options = {
            scenario: 'priority' as const,
            phase,
            side,
            closingSpeedMps: closing,
            initialGapM: Math.min(gap, 35),
            priorityReason: 'qualifying' as const,
            qualifyingYieldPhase: replicate % 2 ? 'in' as const : 'out' as const,
            simulatedSeconds: 20,
            stopOnPriorityRelease: true
          };
          const active = runFocusedSession(built, { ...options, seed: seed + 31, wet });
          const control = runFocusedSession(built, {
            ...options,
            seed: seed + 31,
            wet,
            priorityDisabled: true,
            stopOnPriorityRelease: false,
            simulatedSeconds: Math.max(0.2, active.simulatedSeconds)
          });
          const activeProgress = active.metrics.secondProgressMetres ?? 0;
          const controlProgress = control.metrics.secondProgressMetres ?? 0;
          rows.push({
            trackId,
            weather,
            phase,
            baseSeed,
            replicate,
            seed: seed + 31,
            closing,
            gap: Math.min(gap, 35),
            duration: active.simulatedSeconds,
            obligationObserved: active.metrics.obligationObserved,
            activeProgress,
            controlProgress,
            lossSeconds: Math.max(0, controlProgress - activeProgress) /
              Math.max(1, controlProgress / active.simulatedSeconds),
            obligationYieldLossSeconds:
              active.metrics.obligationYieldLossSeconds,
            laneEditReasons: active.diagnostics.laneEditReasons,
            activeSpeeds: active.entries.map(entry => entry.speed),
            controlSpeeds: control.entries.map(entry => entry.speed),
            activeLateral: active.entries.map(entry => entry.lateral),
            controlLateral: control.entries.map(entry => entry.lateral)
          });
        }
      }
    }
  }
}
rows.sort((left, right) => right.lossSeconds - left.lossSeconds);
console.log(JSON.stringify({ seedSet, count: rows.length, rows }, null, 2));
