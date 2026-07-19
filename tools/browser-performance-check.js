#!/usr/bin/env node
'use strict';

// Measure production runtime work inside a genuine browser RAF callback.
// The raw artifact deliberately permits an absent historical baseline: the
// release manifest still requires that reference measurement from the same
// machine and will not infer it from this current-build capture.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { browserName, launchBrowser } = require('./lib/browser');
const { emitAuditEvent } = require('./lib/audit-events');

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function positiveInteger(name, fallback) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function optionalFinite(name) {
  const value = option(name, null);
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive finite number`);
  return parsed;
}

function percentile(values, fraction) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const html = option('--html', 'index.html');
const output = path.resolve(option(
  '--output',
  'output/playwright/browser-performance-current.json'
));
const warmups = positiveInteger('--warmups', 60);
const samples = positiveInteger('--samples', 360);
const width = positiveInteger('--width', 1400);
const height = positiveInteger('--height', 900);
const captureTotal = warmups + samples;
const captureDeadlineMs = positiveInteger(
  '--capture-deadline-ms',
  Math.max(30000, captureTotal * 300)
);
const baselineFrameTimeP95Ms = optionalFinite('--baseline-p95');
const realTimeTargetP95Ms = optionalFinite('--real-time-target-p95');
const maximumRegressionFraction = 0.1;
const url = `file://${path.resolve(__dirname, '..', html)}`;
const bundle = path.resolve(__dirname, '..', 'dist', 'goldenlap.js');

(async () => {
  emitAuditEvent('browser-performance', 'suite-start', {
    browser: browserName, warmups, samples, status: 'running'
  });
  if (!fs.existsSync(bundle))
    throw new Error('dist/goldenlap.js is missing; run bun run build first');
  emitAuditEvent('browser-performance', 'phase-start', {
    phase: 'launch', browser: browserName, status: 'running'
  });
  const browser = await launchBrowser({ args: ['--disable-gpu'] });
  const version = browser.version();
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const nativeRequest = window.requestAnimationFrame.bind(window);
    const raw = {
      enabled: false,
      callbackDurationsMs: [],
      frameIntervalsMs: [],
      previousTimestamp: null
    };
    Object.defineProperty(window, '__goldenlapFramePerformance', {
      value: raw,
      configurable: false,
      enumerable: false,
      writable: false
    });
    window.requestAnimationFrame = callback => nativeRequest(timestamp => {
      const started = performance.now();
      try {
        callback(timestamp);
      } finally {
        const finished = performance.now();
        if (raw.enabled) {
          raw.callbackDurationsMs.push(finished - started);
          if (raw.previousTimestamp != null)
            raw.frameIntervalsMs.push(timestamp - raw.previousTimestamp);
          raw.previousTimestamp = timestamp;
        }
      }
    });
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__GL && window.__GL.G && window.__GL.BUILT);
  emitAuditEvent('browser-performance', 'case-result', {
    phase: 'boot', caseId: html, status: 'green'
  });
  await page.evaluate(() => {
    const GL = window.__GL;
    GL.pickTeam(0);
    GL.sheetAction('drv', { i: 0 });
    GL.sheetAction('drv', { i: 1 });
    GL.sheetAction('eng', { i: 0 });
    GL.sheetAction('chief', { i: 0 });
    GL.sheetAction('phil', { i: 0 });
    GL.sheetAction('spon', { i: 0 });
    GL.sheetAction('startSeason');
    GL.startWeekend();
    GL.qualiEnd();
    GL.sheetAction('startRace');
    const session = GL.S;
    session.phase = 'run';
    session.goT = 0;
    for (const entry of session.entries)
      if (entry.state === 'grid') entry.state = 'run';
    GL.setScale(1, true);
    const raw = window.__goldenlapFramePerformance;
    raw.callbackDurationsMs.length = 0;
    raw.frameIntervalsMs.length = 0;
    raw.previousTimestamp = null;
    raw.enabled = true;
  });
  const deadline = Date.now() + captureDeadlineMs;
  let lastReported = -1;
  let timedOut = false;
  while (true) {
    const captured = await page.evaluate(() =>
      window.__goldenlapFramePerformance.callbackDurationsMs.length);
    const reportStep = Math.max(1, Math.floor(captureTotal / 20));
    if (captured >= captureTotal || captured - lastReported >= reportStep) {
      lastReported = captured;
      emitAuditEvent('browser-performance', 'progress', {
        phase: captured < warmups ? 'warmup' : 'samples',
        completed: Math.min(captured, captureTotal),
        total: captureTotal,
        browserErrors: errors.length,
        status: errors.length ? 'failed' : 'running'
      });
    }
    if (errors.length)
      throw new Error(`Browser error during frame capture: ${errors[0]}`);
    if (captured >= captureTotal) break;
    if (Date.now() >= deadline) {
      timedOut = true;
      emitAuditEvent('browser-performance', 'warning', {
        classification: 'measurement-incomplete',
        completed: captured,
        total: captureTotal,
        captureDeadlineMs,
        status: 'failed'
      });
      break;
    }
    await page.waitForTimeout(100);
  }
  const raw = await page.evaluate(() => {
    const capture = window.__goldenlapFramePerformance;
    capture.enabled = false;
    return {
      callbackDurationsMs: [...capture.callbackDurationsMs],
      frameIntervalsMs: [...capture.frameIntervalsMs],
      finite: window.__GL.S.entries.every(entry => !entry.car ||
        [entry.car.x, entry.car.y, entry.car.vx, entry.car.vy,
          entry.car.h, entry.spd].every(Number.isFinite)),
      simulatedSeconds: window.__GL.S.t
    };
  });
  const callbackDurationsMs = raw.callbackDurationsMs.slice(warmups, warmups + samples);
  // The first measured interval corresponds to the frame after the final
  // warmup callback, hence the one-sample offset.
  const frameIntervalsMs = raw.frameIntervalsMs.slice(
    Math.max(0, warmups - 1),
    Math.max(0, warmups - 1) + samples
  );
  const frameTimeP50Ms = percentile(callbackDurationsMs, 0.5);
  const frameTimeP95Ms = percentile(callbackDurationsMs, 0.95);
  const intervalP50Ms = percentile(frameIntervalsMs, 0.5);
  const intervalP95Ms = percentile(frameIntervalsMs, 0.95);
  const regressionFraction = baselineFrameTimeP95Ms == null
    ? null
    : frameTimeP95Ms / baselineFrameTimeP95Ms - 1;
  const gates = {
    runtimeFinite: raw.finite && errors.length === 0,
    sampleContract: !timedOut && callbackDurationsMs.length >= 300 && warmups >= 30,
    regression: baselineFrameTimeP95Ms == null
      ? 'baseline-not-supplied'
      : regressionFraction <= maximumRegressionFraction,
    realTime: realTimeTargetP95Ms == null
      ? 'target-not-supplied'
      : frameTimeP95Ms <= realTimeTargetP95Ms
  };
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: process.argv.join(' '),
    plan: 'racecraft_dynamic_corridor_plan.md',
    browser: { name: browserName, version, headless: true },
    environment: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpus: os.cpus().length,
      node: process.version,
      viewport: { width, height }
    },
    entry: { html, url, developmentBundleSha256: sha256(bundle) },
    warmups,
    samples: callbackDurationsMs.length,
    capture: {
      requested: captureTotal,
      completed: raw.callbackDurationsMs.length,
      timedOut,
      deadlineMs: captureDeadlineMs
    },
    maximumRegressionFraction,
    baselineFrameTimeP95Ms,
    realTimeTargetP95Ms,
    frameTimeP50Ms,
    frameTimeP95Ms,
    frameIntervalP50Ms: intervalP50Ms,
    frameIntervalP95Ms: intervalP95Ms,
    regressionFraction,
    simulatedSeconds: raw.simulatedSeconds,
    gates,
    errors,
    raw: { callbackDurationsMs, frameIntervalsMs }
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n');
  console.log(JSON.stringify({
    output: path.relative(process.cwd(), output),
    browser: artifact.browser,
    warmups,
    samples: artifact.samples,
    capture: artifact.capture,
    frameTimeP50Ms,
    frameTimeP95Ms,
    frameIntervalP50Ms: intervalP50Ms,
    frameIntervalP95Ms: intervalP95Ms,
    gates,
    errors
  }, null, 2));
  await browser.close();
  emitAuditEvent('browser-performance', 'suite-result', {
    browser: browserName,
    status: gates.runtimeFinite && gates.sampleContract ? 'green' : 'failed',
    frameTimeP50Ms,
    frameTimeP95Ms,
    gates,
    output: path.relative(process.cwd(), output)
  });
  process.exit(gates.runtimeFinite && gates.sampleContract ? 0 : 1);
})().catch(error => {
  emitAuditEvent('browser-performance', 'failure', {
    browser: browserName,
    status: 'failed',
    message: error && error.message || String(error)
  });
  console.error(error && error.stack || error);
  process.exit(2);
});
