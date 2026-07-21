import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import {
  prepareHeadlessTrack,
  runFocusedSession,
  runSingleCar
} from './lib/headless-sim';

const root = resolve(import.meta.dir, '..');
const fixturePath = resolve(root, 'tests/fixtures/parity/headless-pivot.json');
const printOnly = process.argv.includes('--print');
const record = process.argv.includes('--record');
const target = resolve(root, process.argv.find(argument =>
  !argument.startsWith('--') && argument !== process.argv[0] && argument !== process.argv[1]
) ?? 'index.html');
const trackId = 'prado';
const seed = 101;
const requestedBrowser = (process.env.GOLDENLAP_BROWSER ?? 'chromium').toLowerCase();
const browserType = requestedBrowser === 'firefox'
  ? firefox
  : requestedBrowser === 'webkit'
    ? webkit
    : chromium;

function localSnapshot(): object {
  const built = prepareHeadlessTrack(trackId);
  return {
    schemaVersion: 1,
    trackId,
    seed,
    clean: runSingleCar(built, { laps: 1, seed }),
    pair: runFocusedSession(built, { scenario: 'pair', seed }),
    pairSafety30: runFocusedSession(built, {
      scenario: 'pair',
      seed,
      predictiveSafetyHz: 30
    }),
    pit: runFocusedSession(built, { scenario: 'pit', seed }),
    priority: runFocusedSession(built, { scenario: 'priority', seed }),
    classification: runFocusedSession(built, { scenario: 'classification', seed })
  };
}

interface ComparisonOptions {
  numericTolerance: number;
  ignoreChecksums: boolean;
}

function differences(
  expected: unknown,
  actual: unknown,
  at = '$',
  output: string[] = [],
  options: ComparisonOptions = { numericTolerance: 0, ignoreChecksums: false }
): string[] {
  if (options.ignoreChecksums && at.endsWith('.checksum')) return output;
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Number.isFinite(expected) && Number.isFinite(actual) &&
        Math.abs(expected - actual) <= options.numericTolerance) return output;
    if (Object.is(expected, actual)) return output;
    output.push(`${at}: expected ${expected}, got ${actual}`);
    return output;
  }
  if (Object.is(expected, actual)) return output;
  if (typeof expected !== typeof actual || expected === null || actual === null) {
    output.push(`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return output;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      output.push(`${at}: collection shape differs`);
      return output;
    }
    if (expected.length !== actual.length)
      output.push(`${at}.length: expected ${expected.length}, got ${actual.length}`);
    for (let index = 0; index < Math.min(expected.length, actual.length); index++)
      differences(expected[index], actual[index], `${at}[${index}]`, output, options);
    return output;
  }
  if (typeof expected === 'object') {
    const expectedObject = expected as Record<string, unknown>;
    const actualObject = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(expectedObject), ...Object.keys(actualObject)]);
    for (const key of [...keys].sort()) {
      if (!(key in expectedObject)) output.push(`${at}.${key}: unexpected key`);
      else if (!(key in actualObject)) output.push(`${at}.${key}: missing key`);
      else differences(expectedObject[key], actualObject[key], `${at}.${key}`, output, options);
    }
    return output;
  }
  output.push(`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return output;
}

async function browserSnapshot(): Promise<object> {
  const errors: string[] = [];
  const browser = await browserType.launch(requestedBrowser === 'chromium'
    ? { args: ['--no-sandbox'] }
    : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(`page: ${error}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
    });
    await page.goto(`file://${target}`);
    await page.waitForFunction(() => !!window.__GL);
    const snapshot = await page.evaluate(({ requestedTrack, requestedSeed }) => {
      const api = window.__GL as object;
      const runner = (api as Record<symbol, (track: string, seed: number) => object>)[
        Symbol.for('goldenlap.headlessParity')
      ];
      if (!runner) throw new Error('Missing hidden headless parity runner');
      return runner(requestedTrack, requestedSeed);
    }, { requestedTrack: trackId, requestedSeed: seed });
    if (errors.length) throw new Error(errors.join('\n'));
    return snapshot;
  } finally {
    await browser.close();
  }
}

try {
  const local = localSnapshot();
  const browser = await browserSnapshot();
  const numericTolerance = 5e-8;
  const environmentDifferences = differences(local, browser, '$', [], {
    numericTolerance,
    ignoreChecksums: true
  });
  if (environmentDifferences.length) {
    console.error(`Browser/headless mismatch (${environmentDifferences.length} differences)`);
    for (const difference of environmentDifferences.slice(0, 80)) console.error(`- ${difference}`);
    process.exit(1);
  }
  const document = {
    schemaVersion: 1,
    numericTolerance,
    scenarios: [
      'clean',
      'pair',
      'pairSafety30',
      'pit',
      'priority',
      'classification'
    ],
    snapshot: local
  };
  if (record) {
    writeFileSync(fixturePath, `${JSON.stringify(document, null, 2)}\n`);
    console.log(
      'Recorded headless parity: clean, pair (10/30 Hz safety), pit, priority, and classification'
    );
  } else if (printOnly) {
    console.log(JSON.stringify(document, null, 2));
  } else {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as object;
    const fixtureDifferences = differences(fixture, document);
    if (fixtureDifferences.length) {
      console.error(`Pivot fixture mismatch (${fixtureDifferences.length} differences)`);
      for (const difference of fixtureDifferences.slice(0, 80)) console.error(`- ${difference}`);
      process.exit(1);
    }
    console.log(
      'Headless parity OK: clean, pair (10/30 Hz safety), pit, priority, and classification match'
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(2);
}
