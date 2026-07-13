#!/usr/bin/env node
// Browser/UI acceptance for racecraft_goal.md: real time-control clicks,
// mobile HUD bounds, and three visual racing-line debug captures.
// Usage: node tools/racecraft-ui-check.js [output-directory]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'output', 'playwright'));
fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');

async function prepareRace(page) {
  return page.evaluate(() => {
    const GL = window.__GL;
    for (let i = 0; i < 300; i++) GL.stepSession(1 / 30);
    GL.qualiEnd();
    GL.sheetAction('startRace');
    const S = GL.S;
    S.phase = 'run';
    S.goT = S.t;
    S.entries.forEach(e => { if (e.state === 'grid') e.state = 'run'; });
    GL.setScale(0, true);
    return { round: GL.G.round, name: GL.CALENDAR[GL.G.round].name };
  });
}

async function finishAndAdvance(page) {
  return page.evaluate(() => {
    const GL = window.__GL;
    GL.setScale(0, true);
    let guard = 0;
    while (GL.S && guard++ < 400000) GL.stepSession(1 / 30);
    if (GL.S) throw new Error('Race did not terminate within the fixed-step guard');
    GL.sheetAction('toWorkshop');
    if (GL.G.round + 1 >= GL.CALENDAR.length) return false;
    GL.sheetAction('nextRound');
    return true;
  });
}

async function placeCameraCarAtCorner(page) {
  return page.evaluate(() => {
    const GL = window.__GL, S = GL.S, tr = S.trk;
    window.__GL.debugLine = true;
    GL.setScale(0, true);
    const candidates = (tr.corners || []).slice();
    const corner = candidates.sort((a, b) => {
      const ak = Math.abs(tr.rline.k[a.apexI]);
      const bk = Math.abs(tr.rline.k[b.apexI]);
      return bk - ak || Math.abs(tr.rline.off[b.apexI]) - Math.abs(tr.rline.off[a.apexI]);
    })[0];
    if (!corner) throw new Error('No corner available for debug capture');
    const e = S.entries.find(x => x.isPlayer && x.car) || S.entries.find(x => x.car);
    const ci = S.entries.indexOf(e), c = e.car, i = corner.apexI;
    const saved = {
      x: c.x, y: c.y, h: c.h, vx: c.vx, vy: c.vy, r: c.r, steer: c.steer,
      s: c.s, progIdx: c.progIdx, latNow: e.latNow, camI: S.camI
    };
    c.x = tr.rline.x[i]; c.y = tr.rline.y[i];
    c.h = Math.atan2(tr.ty[i], tr.tx[i]);
    c.vx = c.vy = c.r = c.steer = 0;
    c.s = i * tr.step; c.progIdx = i;
    e.latNow = tr.rline.off[i];
    S.camI = ci;
    window.__racecraftSavedCar = { e, c, saved };
    return {
      corner: corner.apexI,
      offset: tr.rline.off[i],
      curvature: tr.rline.k[i],
      track: tr.def.name,
      id: tr.def.id
    };
  });
}

async function restoreCameraCar(page) {
  await page.evaluate(() => {
    const q = window.__racecraftSavedCar;
    if (!q) return;
    Object.assign(q.c, {
      x: q.saved.x, y: q.saved.y, h: q.saved.h,
      vx: q.saved.vx, vy: q.saved.vy, r: q.saved.r,
      steer: q.saved.steer, s: q.saved.s, progIdx: q.saved.progIdx
    });
    q.e.latNow = q.saved.latNow;
    window.__GL.S.camI = q.saved.camI;
    delete window.__racecraftSavedCar;
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
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

  const first = await prepareRace(page);
  const scales = [];
  for (const id of ['sp1', 'sp4', 'sp8']) {
    const before = await page.evaluate(() => window.__GL.S.t);
    await page.locator('#' + id).click({ force: true });
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({
      t: window.__GL.S.t,
      scale: window.__GL.S.scale,
      finite: window.__GL.S.entries.every(e => !e.car ||
        [e.car.x, e.car.y, e.car.vx, e.car.vy, e.car.h, e.spd].every(Number.isFinite))
    }));
    scales.push({ id, scale: after.scale, advanced: after.t - before, finite: after.finite });
  }
  await page.locator('#sp0').click({ force: true });
  const paused = await page.evaluate(() => window.__GL.S.scale === 0);
  const scaleOK = scales.every((q, i) => q.scale === [1, 4, 8][i] && q.advanced > 0 && q.finite) && paused;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobile = await page.evaluate(() => {
    const ids = ['sp0', 'sp1', 'sp4', 'sp8'];
    const rects = ids.map(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      controlsInView: rects.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight),
      rects
    };
  });
  await page.screenshot({ path: path.join(out, 'racecraft-mobile-hud.png') });
  await page.setViewportSize({ width: 1400, height: 900 });

  const captures = [];
  for (let r = 0; r < 3; r++) {
    if (r > 0) await prepareRace(page);
    const info = await placeCameraCarAtCorner(page);
    await page.waitForTimeout(900);
    const file = `racecraft-line-${String(r + 1).padStart(2, '0')}-${info.id}.png`;
    await page.screenshot({ path: path.join(out, file) });
    captures.push({ ...info, file });
    await restoreCameraCar(page);
    if (r < 2 && !(await finishAndAdvance(page))) throw new Error('Season ended before three captures');
  }

  const ok = scaleOK && mobile.scrollWidth <= mobile.width && mobile.controlsInView && !errors.length;
  console.log(JSON.stringify({ ok, first, scales, paused, mobile, captures, errors }, null, 2));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
