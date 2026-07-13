#!/usr/bin/env node
// Screenshot each round's race start (grid + pit lane + boxes in one frame).
// Usage: node tools/shots.js [outdir]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.resolve(__dirname, '../index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__GL && window.__GL.G);
  await page.evaluate(() => {
    const GL = window.__GL;
    GL.pickTeam(0);
    GL.sheetAction('drv', { i: 0 }); GL.sheetAction('drv', { i: 1 });
    GL.sheetAction('eng', { i: 0 }); GL.sheetAction('chief', { i: 0 });
    GL.sheetAction('phil', { i: 0 }); GL.sheetAction('spon', { i: 0 });
    GL.sheetAction('startSeason');
  });
  const n = await page.evaluate(() => window.__GL.CALENDAR.length);
  for (let r = 0; r < n; r++) {
    const id = await page.evaluate(() => {
      const GL = window.__GL;
      for (let i = 0; i < 300; i++) GL.stepSession(1 / 30);
      GL.qualiEnd();
      GL.sheetAction('startRace');
      return GL.TRACK_DEFS[GL.CALENDAR[GL.G.round].trk].id;
    });
    await page.waitForTimeout(700); // let the renderer draw the grid
    await page.screenshot({ path: path.join(out, `start-${String(r + 1).padStart(2, '0')}-${id}.png`) });
    // run the race out, then hop to the next round
    const done = await page.evaluate(() => {
      const GL = window.__GL, S = GL.S;
      S.phase = 'run'; S.goT = S.t;
      S.entries.forEach(e => { if (e.state === 'grid') e.state = 'run'; });
      let g = 0;
      while (GL.S && g++ < 400000) GL.stepSession(1 / 30);
      GL.sheetAction('toWorkshop');
      if (GL.G.round + 1 < GL.CALENDAR.length) { GL.sheetAction('nextRound'); return false; }
      return true;
    });
    if (done) break;
  }
  console.log('shots in', out, errors.length ? `ERRORS: ${errors.join(' | ')}` : '(no errors)');
  await browser.close();
})();
