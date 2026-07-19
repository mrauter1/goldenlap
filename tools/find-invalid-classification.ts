import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';

interface ScenarioManifest {
  tracks: string[];
  weather: Array<'dry' | 'wet'>;
  seedSets: { release: number[] };
  replicates: { release: number };
}

interface InvalidSummary {
  trackId: string;
  seed: number;
  wetStratum: 'dry' | 'wet';
  classificationValid: boolean;
  reason: string;
  diagnostics: unknown;
}

interface Batch {
  trackId: string;
  weather: 'dry' | 'wet';
  seeds: number[];
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function derivedSeed(
  baseSeed: number,
  replicate: number,
  trackIndex: number,
  weatherIndex: number
): number {
  return baseSeed + replicate * 1_000_003 + trackIndex * 1_009 + weatherIndex * 101;
}

const manifest = JSON.parse(readFileSync(
  argument('--scenarios') ?? 'tests/fixtures/calibration/scenario-manifest.json',
  'utf8'
)) as ScenarioManifest;
const batches: Batch[] = [];
for (let trackIndex = 0; trackIndex < manifest.tracks.length; trackIndex++) {
  for (let weatherIndex = 0; weatherIndex < manifest.weather.length; weatherIndex++) {
    batches.push({
      trackId: manifest.tracks[trackIndex]!,
      weather: manifest.weather[weatherIndex]!,
      seeds: manifest.seedSets.release.flatMap(baseSeed =>
        Array.from({ length: manifest.replicates.release }, (_unused, replicate) =>
          derivedSeed(baseSeed, replicate, trackIndex, weatherIndex)))
    });
  }
}

const requested = Number(argument('--workers') ?? NaN);
if (Number.isFinite(requested) && (!Number.isInteger(requested) || requested <= 0))
  throw new Error('--workers must be a positive integer');
const workers = Math.min(
  batches.length,
  Number.isFinite(requested) ? requested : Math.max(1, availableParallelism() - 1)
);
const invalid: InvalidSummary[] = [];
let next = 0;

async function run(): Promise<void> {
  while (next < batches.length) {
    const batch = batches[next++]!;
    const child = Bun.spawn([
      'bun', 'tools/run-race-stratum.ts',
      '--track', batch.trackId,
      '--weather', batch.weather,
      '--seeds', batch.seeds.join(','),
      '--invalid-only'
    ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ]);
    if (exitCode !== 0)
      throw new Error(`${batch.trackId}/${batch.weather}: ${stderr}`);
    const batchInvalid = JSON.parse(stdout) as InvalidSummary[];
    invalid.push(...batchInvalid);
    console.error(`${batch.trackId}/${batch.weather}: ${batchInvalid.length ? 'invalid found' : 'valid'}`);
  }
}

await Promise.all(Array.from({ length: workers }, run));
console.log(JSON.stringify({ workers, batches: batches.length, invalid }, null, 2));
process.exit(invalid.length ? 1 : 0);
