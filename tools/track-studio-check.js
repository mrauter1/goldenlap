#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { launchBrowser } = require('./lib/browser');

const root = path.resolve(__dirname, '..');

function cliCandidate(archetype, seed) {
  const result = spawnSync('bun', [
    'tools/generate-track.ts', '--archetype', archetype, '--seed', String(seed),
    '--tier0-only', '--json'
  ], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`CLI track generation failed (${result.status}): ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function cliSignature(archetype, seed, revision, mode) {
  const args = [
    'tools/generate-track.ts', '--archetype', archetype, '--seed', String(seed),
    '--signature-only', '--json'
  ];
  if (mode !== null)
    args.push('--scramble-mode', mode, '--scramble-revision', String(revision));
  const result = spawnSync('bun', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`CLI signature scramble failed (${result.status}): ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function parameterFingerprint(signature) {
  return JSON.stringify([...signature.groups].sort((left, right) =>
    left.id.localeCompare(right.id)).map(group => ({
    lengthMetres: group.lengthMetres,
    knots: group.knots,
    lobes: group.lobes
  })));
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

(async () => {
  const errors = [];
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
  page.on('pageerror', error => errors.push(`page: ${error}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`file://${path.join(root, 'track-studio.html')}`);
  await page.waitForFunction(() => window.__GL_STUDIO?.ready === true);

  const seed = 1;
  const expected = cliCandidate('power', seed);
  const actual = await page.evaluate(({ archetype, seed }) =>
    JSON.parse(JSON.stringify(
      window.__GL_STUDIO.generateSnapshot(archetype, seed)
    )), { archetype: 'power', seed });
  const repeated = await page.evaluate(({ archetype, seed }) =>
    JSON.parse(JSON.stringify(
      window.__GL_STUDIO.generateSnapshot(archetype, seed)
    )), { archetype: 'power', seed });
  assert.deepStrictEqual(repeated, actual,
    'the browser must be deterministic for the same archetype and seed');
  assert.equal(actual.schemaVersion, 2);
  assert.equal(actual.archetype, expected.archetype);
  assert.equal(actual.seed, expected.seed);
  assert.equal(actual.signatureId, expected.signatureId);

  const baseSignature = cliSignature('balanced', seed, 0, null);
  const scrambleCases = [
    { mode: 'both', button: 'scramble-all' },
    { mode: 'parameters', button: 'scramble-parameters' },
    { mode: 'ordering', button: 'scramble-ordering' }
  ];
  const scrambled = {};
  for (const item of scrambleCases) {
    const expectedSignature = cliSignature('balanced', seed, 0, item.mode);
    const apiSignature = await page.evaluate(({ seed, mode }) =>
      window.__GL_STUDIO.scrambleSnapshot('balanced', seed, 0, mode), {
      seed, mode: item.mode
    });
    assert.deepStrictEqual(apiSignature, expectedSignature,
      `${item.mode} scramble differs between CLI and browser`);
    const clickedSignature = await page.evaluate(({ seed, button }) => {
      window.__GL_STUDIO.generate('balanced', seed);
      document.getElementById(button).click();
      return JSON.parse(document.getElementById('signature-json').value);
    }, { seed, button: item.button });
    assert.deepStrictEqual(clickedSignature, expectedSignature,
      `${item.button} does not expose the shared ${item.mode} scramble`);
    scrambled[item.mode] = expectedSignature;
  }
  assert.deepStrictEqual(scrambled.parameters.groups.map(group => group.id),
    baseSignature.groups.map(group => group.id),
    'parameter scramble must preserve complete-group ordering');
  assert.notEqual(parameterFingerprint(scrambled.parameters), parameterFingerprint(baseSignature),
    'parameter scramble must alter group parameters');
  assert.notDeepStrictEqual(scrambled.ordering.groups.map(group => group.id),
    baseSignature.groups.map(group => group.id),
    'ordering scramble must move complete groups');
  assert.equal(parameterFingerprint(scrambled.ordering),
    parameterFingerprint(baseSignature),
    'ordering-only scramble must preserve group parameters');
  assert.notDeepStrictEqual(scrambled.both.groups.map(group => group.id),
    baseSignature.groups.map(group => group.id),
    'combined scramble must move complete groups');
  assert.notEqual(parameterFingerprint(scrambled.both), parameterFingerprint(baseSignature),
    'combined scramble must alter group parameters');

  const performance = await page.evaluate(() => {
    const api = window.__GL_STUDIO;
    const accepted = [];
    for (let seed = 1; seed < 100 && accepted.length < 9; seed++) {
      if (api.generateSnapshot('power', seed).tier0.accepted) accepted.push(seed);
    }
    if (accepted.length < 9) throw new Error('Could not find nine accepted power candidates');
    api.generate('power', accepted[0]);
    return accepted.slice(1).map(seed => api.generate('power', seed).elapsedMilliseconds);
  });
  const medianMilliseconds = percentile(performance, 0.5);
  const p90Milliseconds = percentile(performance, 0.9);
  const originalTargetMilliseconds = 150;
  const acceptedCeilingMilliseconds = 30_000;
  assert(p90Milliseconds < acceptedCeilingMilliseconds,
    `7 km studio interaction p90 ${p90Milliseconds.toFixed(1)} ms exceeds ` +
    `${acceptedCeilingMilliseconds} ms`);

  const imports = await page.evaluate(() => Array.from(
    { length: window.__GL_STUDIO.existingTrackCount },
    (_, index) => window.__GL_STUDIO.importExisting(index)
  ));
  assert.equal(imports.length, await page.evaluate(() =>
    window.__GL_STUDIO.existingTrackCount));
  for (const imported of imports) {
    assert(imported.valid, `${imported.id} did not produce a valid draft line`);
    assert(imported.samples > 0 && imported.lengthMetres > 0 && imported.corners > 0,
      `${imported.id} produced incomplete studio geometry`);
  }

  const visual = await page.evaluate(() => {
    const canvas = document.getElementById('track-view');
    const context = canvas.getContext('2d');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    let varied = 0;
    const red = pixels[0], green = pixels[1], blue = pixels[2];
    for (let index = 0; index < pixels.length; index += 4 * 997) {
      if (pixels[index + 3] > 0) opaque++;
      if (pixels[index] !== red || pixels[index + 1] !== green || pixels[index + 2] !== blue)
        varied++;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      opaque,
      varied,
      gateRows: document.querySelectorAll('#gate-list .gate').length,
      histogramRows: document.querySelectorAll('#corner-histogram .histogram-row').length
    };
  });
  assert(visual.width > 500 && visual.height > 300 && visual.opaque > 50 && visual.varied > 10,
    'studio canvas did not render meaningful track pixels');
  assert(visual.gateRows > 5 && visual.histogramRows === 5,
    'studio validation panels were not populated');

  await browser.close();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    status: 'green',
    runtimeDeterminism: {
      archetype: 'power',
      seed,
      browserRepeatExact: true,
      cliAndBrowserSchema: 2
    },
    scrambleParity: scrambleCases.map(item => item.mode),
    interactionMilliseconds: {
      samples: performance.map(value => Number(value.toFixed(3))),
      median: Number(medianMilliseconds.toFixed(3)),
      p90: Number(p90Milliseconds.toFixed(3)),
      originalTarget: originalTargetMilliseconds,
      acceptedCeiling: acceptedCeilingMilliseconds
    },
    existingTrackImports: imports,
    visual
  }, null, 2));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
