#!/usr/bin/env node
// Fast structural checks for the racecraft implementation. Full behavioural
// acceptance remains in race-sim.js; this catches geometry/profile regressions
// without running a complete season.
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : '../index.html';
const url = 'file://' + path.resolve(__dirname, target);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  const warnings = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__GL && window.__GL.BUILT);
  const result = await page.evaluate(() => {
    const GL = window.__GL;
    const tracks = GL.BUILT.map(B => {
      const tr = B.tr, rl = tr.rline;
      let maxOff = 0, startMax = 0, pitMax = 0, shaped = 0;
      const pitA = ((tr.pit.sEntry - 80) % tr.len + tr.len) % tr.len;
      const pitB = (tr.pit.sExit + 30) % tr.len;
      const pitSpan = ((pitB - pitA) % tr.len + tr.len) % tr.len;
      for (let i = 0; i < tr.n; i++) {
        const s = i * tr.step, ao = Math.abs(rl.off[i]);
        maxOff = Math.max(maxOff, ao);
        const startD = Math.min(s, tr.len - s);
        if (startD <= 25) startMax = Math.max(startMax, ao);
        const pitW = ((s - pitA) % tr.len + tr.len) % tr.len;
        if (pitW <= pitSpan) pitMax = Math.max(pitMax, ao);
      }
      for (const c of tr.corners) {
        const d = Math.max(8, Math.round(45 / tr.step));
        const entry = rl.off[(c.apexI - d + tr.n) % tr.n] * c.side;
        const apex = rl.off[c.apexI] * c.side;
        const exit = rl.off[(c.apexI + d) % tr.n] * c.side;
        if (apex > entry + 0.35 && apex > exit + 0.35) shaped++;
      }
      const car = GL.makeCar(rl.x[0], rl.y[0], Math.atan2(rl.ty[0], rl.tx[0]));
      car.vx = 12; car.progIdx = 0;
      let soloMaxLat = 0, soloGrass = 0, soloMaxHeading = 0;
      const soloSteps = Math.ceil(rl.lapTime * 2.2 * 120);
      for (let q = 0; q < soloSteps; q++) {
        const surf = GL.trackSense(tr, car);
        const inp = GL.botStep(tr, B.prof, car, { margin: 0.95, muScale: 1, path: rl });
        GL.stepCar(car, inp, surf, 1 / 120, { pw: 1, mu: 1, dr: 1 });
        soloMaxLat = Math.max(soloMaxLat, Math.abs(surf.lat));
        if (surf.zone === 'grass') soloGrass++;
        const i = Math.max(0, car.progIdx);
        soloMaxHeading = Math.max(soloMaxHeading,
          Math.abs(((car.h - Math.atan2(rl.ty[i], rl.tx[i]) + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      }
      return {
        name: B.def.name,
        centerLap: B.prof.lapTime,
        lineLap: rl.lapTime,
        maxOff, startMax, pitMax,
        bound: tr.hw - 1.6,
        corners: tr.corners.length,
        shaped, soloMaxLat, soloGrass, soloMaxHeading
      };
    });

    const car = (x, y, h = 0) => GL.makeCar(x, y, h);
    const clearA = car(0, 0), clearB = car(0, 2.01);
    clearA.vx = clearB.vx = 40;
    const clearHits = GL.collideCars([clearA, clearB]);
    const grazeA = car(0, 0), grazeB = car(0, 1.95);
    grazeA.vx = 40; grazeB.vx = 39.5; grazeB.vy = -0.1;
    const beforeA = Math.hypot(grazeA.vx, grazeA.vy);
    const beforeB = Math.hypot(grazeB.vx, grazeB.vy);
    const grazeHits = GL.collideCars([grazeA, grazeB]);
    const grazeLoss = Math.max(beforeA - Math.hypot(grazeA.vx, grazeA.vy),
      beforeB - Math.hypot(grazeB.vx, grazeB.vy));
    const noseA = car(0, 0), noseB = car(4.71, 0);
    noseA.vx = noseB.vx = 20;
    const noseClear = GL.collideCars([noseA, noseB]).length === 0;
    return { tracks, collision: { clear: clearHits.length === 0, noseClear,
      grazeImp: grazeHits.length ? grazeHits[0].imp : 0, grazeLoss } };
  });
  await browser.close();

  let failed = errors.length > 0 || warnings.some(w => w.includes('Racing line slower'));
  for (const t of result.tracks) {
    const faster = t.lineLap <= t.centerLap + 1e-6;
    const faded = t.startMax < 1e-6 && t.pitMax < 1e-6;
    const bounded = t.maxOff <= t.bound + 1e-6;
    const corners = t.corners >= 2;
    failed ||= !faster || !faded || !bounded || !corners;
    console.log(`${t.name}: center ${t.centerLap.toFixed(3)}s · line ${t.lineLap.toFixed(3)}s · ` +
      `gain ${(t.centerLap - t.lineLap).toFixed(3)}s · off ${t.maxOff.toFixed(2)}/${t.bound.toFixed(2)}m · ` +
      `corners ${t.corners} (${t.shaped} out-in-out) · solo lat ${t.soloMaxLat.toFixed(2)}m grass ${t.soloGrass} heading ${t.soloMaxHeading.toFixed(2)} · ` +
      `${faster && faded && bounded && corners ? 'OK' : 'FAIL'}`);
  }
  const c = result.collision;
  const collisionOK = c.clear && c.noseClear && c.grazeImp > 0 && c.grazeImp < 2 && c.grazeLoss < 2;
  failed ||= !collisionOK;
  console.log(`Capsule: lateral clear ${c.clear} · nose clear ${c.noseClear} · graze impact ${c.grazeImp.toFixed(2)} · max speed loss ${c.grazeLoss.toFixed(2)} m/s · ${collisionOK ? 'OK' : 'FAIL'}`);
  if (warnings.length) warnings.forEach(w => console.error('warning:', w));
  if (errors.length) errors.forEach(e => console.error('error:', e));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
