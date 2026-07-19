#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./lib/browser');

const ROOT = path.resolve(__dirname, '..');
const HISTORICAL_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'parity', 'manifest.json');
const PIVOT_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'parity', 'runtime-pivot.json');
const args = process.argv.slice(2);
const capture = args.includes('--capture');
const historical = args.includes('--historical');
const fixture = historical ? HISTORICAL_FIXTURE : PIVOT_FIXTURE;
const targetArg = args.find(arg => !arg.startsWith('--'));
const target = path.resolve(ROOT, targetArg || 'index.html');
const seed = 0x51A7E;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function differences(expected, actual, at = '$', out = []) {
  if (Object.is(expected, actual)) return out;
  if (typeof expected !== typeof actual || expected === null || actual === null) {
    out.push(`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return out;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      out.push(`${at}: collection shape changed`);
      return out;
    }
    if (expected.length !== actual.length) out.push(`${at}.length: expected ${expected.length}, got ${actual.length}`);
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) differences(expected[i], actual[i], `${at}[${i}]`, out);
    return out;
  }
  if (typeof expected === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      if (!(key in expected)) out.push(`${at}.${key}: unexpected key`);
      else if (!(key in actual)) out.push(`${at}.${key}: missing key`);
      else differences(expected[key], actual[key], `${at}.${key}`, out);
    }
    return out;
  }
  out.push(`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return out;
}

async function snapshot() {
  const errors = [];
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(`page: ${error}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(seedValue => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    let t = seedValue >>> 0;
    Math.random = () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
  await page.goto(`file://${target}`);
  await page.waitForFunction(() => window.__GL && window.__GL.BUILT);
  const result = await page.evaluate(() => {
    const GL = window.__GL;
    const round = value => Number.isFinite(value) ? Math.round(value * 1e8) / 1e8 : String(value);
    const hash = values => {
      let h = 2166136261 >>> 0;
      for (const value of values) {
        const token = typeof value === 'number' ? String(round(value)) : (JSON.stringify(value) ?? String(value));
        for (let i = 0; i < token.length; i++) {
          h ^= token.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
        h ^= 124;
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    };
    const api = Object.getOwnPropertyNames(GL).sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(GL, key);
      return {
        key,
        shape: descriptor && typeof descriptor.get === 'function' ? 'getter' : typeof GL[key],
        writable: descriptor ? !!descriptor.writable : false
      };
    });
    const tracks = GL.BUILT.map(B => {
      const tr = B.tr;
      const pit = tr.pit;
      const arrays = [
        ...tr.x, ...tr.y, ...tr.tx, ...tr.ty, ...tr.nx, ...tr.ny,
        ...tr.k, ...tr.kSm, ...tr.rline.off, ...tr.rline.x, ...tr.rline.y,
        ...tr.rline.tx, ...tr.rline.ty, ...tr.rline.t
      ];
      return {
        id: B.def.id,
        len: round(tr.len),
        n: tr.n,
        step: round(tr.step),
        samplesHash: hash(arrays),
        pitHash: hash(Object.keys(pit).sort().filter(key => typeof pit[key] !== 'function').flatMap(key => [key, pit[key]])),
        cornersHash: hash(tr.corners.flatMap(corner => Object.keys(corner).sort().flatMap(key => [key, corner[key]]))),
        profileHash: hash([...B.prof.v, ...B.prof.t, B.prof.lapTime]),
        lineLapTime: round(tr.rline.lapTime),
        centerLapTime: round(B.prof.lapTime)
      };
    });

    const gameBefore = {
      phase: GL.G.phase,
      round: GL.G.round,
      teamI: GL.G.teamI,
      menuDisplay: getComputedStyle(document.getElementById('menu')).display,
      teamCards: document.querySelectorAll('#teamCards .team-card, #teamCards button').length
    };
    GL.pickTeam(0);
    GL.sheetAction('drv', { i: 0 }); GL.sheetAction('drv', { i: 1 });
    GL.sheetAction('eng', { i: 0 }); GL.sheetAction('chief', { i: 0 });
    GL.sheetAction('phil', { i: 0 }); GL.sheetAction('spon', { i: 0 });
    GL.sheetAction('startSeason');
    const gameReady = {
      phase: GL.G.phase,
      round: GL.G.round,
      teamI: GL.G.teamI,
      drivers: [...GL.G.myDrivers],
      staff: [GL.G.eng, GL.G.chief],
      philosophy: GL.G.phil,
      sponsor: GL.G.spon,
      money: round(GL.G.cash)
    };
    const S = GL.S;
    for (let tick = 0; tick < 600; tick++) GL.stepSession(1 / 120);
    const live = GL.S || S;
    const session = {
      mode: live.mode,
      phase: live.phase,
      t: round(live.t),
      wet: round(live.wet),
      entryHash: hash(live.entries.flatMap(entry => [
        entry.di, entry.state, round(entry.prog || 0), round(entry.spd || 0),
        round(entry.lat || 0),
        round(entry.laneProgram?.points?.at(-1)?.eta ??
          entry.laneProgram?.bias ?? 0),
        entry.car ? round(entry.car.x) : null,
        entry.car ? round(entry.car.y) : null,
        entry.car ? round(entry.car.vx) : null
      ])),
      states: live.entries.reduce((acc, entry) => {
        acc[entry.state] = (acc[entry.state] || 0) + 1;
        return acc;
      }, {})
    };
    return {
      schema: 1,
      seed: 0x51A7E,
      numericNormalization: 'round-to-1e-8, FNV-1a UTF-16 token stream',
      api,
      data: {
        teams: GL.TEAM_DEFS.map(team => [team.id, team.name]),
        drivers: GL.DRIVERS.map(driver => [driver.code, driver.name]),
        calendar: GL.CALENDAR.map(event => [event.trk, event.name, event.rainP])
      },
      tracks,
      seeded: { gameBefore, gameReady, session },
      dom: {
        title: document.title,
        canvas: !!document.getElementById('cv'),
        hud: !!document.getElementById('hud'),
        sheet: !!document.getElementById('sheet'),
        menu: !!document.getElementById('menu')
      }
    };
  });
  await browser.close();
  if (errors.length) throw new Error(errors.join('\n'));
  return stable(result);
}

(async () => {
  const actual = await snapshot();
  if (capture) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  if (!fs.existsSync(fixture)) throw new Error(`Missing parity fixture: ${fixture}`);
  const expected = stable(JSON.parse(fs.readFileSync(fixture, 'utf8')).runtime);
  const diff = differences(expected, actual);
  if (diff.length) {
    console.error(`Parity mismatch (${diff.length} differences):`);
    diff.slice(0, 80).forEach(line => console.error(`- ${line}`));
    process.exitCode = 1;
  } else {
    console.log(`Parity OK: ${path.relative(ROOT, target)} matches ${path.relative(ROOT, fixture)}`);
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(2);
});
