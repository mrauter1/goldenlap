#!/usr/bin/env node
// Fast structural checks for the racecraft implementation. Full behavioural
// acceptance remains in race-sim.js; this catches geometry/profile regressions
// without running a complete season.
const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./lib/browser');

const target = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : '../index.html';
const url = 'file://' + path.resolve(__dirname, target);
const metricPolicy = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'tests', 'fixtures', 'calibration', 'metric-policy.json'),
  'utf8'
)).policies.find(policy => policy.id === 'profile.marker_error_m');
if (!metricPolicy) throw new Error('Missing profile.marker_error_m policy');
const markerBounds = {
  normal: metricPolicy.normal.maximum,
  acceptable: metricPolicy.acceptable.maximum,
  absolute: metricPolicy.absolute.maximum
};

(async () => {
  const browser = await launchBrowser();
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
  const result = await page.evaluate(({ markerBounds }) => {
    const GL = window.__GL;
    const tracks = GL.BUILT.map(B => {
      const tr = B.tr, rl = tr.rline;
      let maxOff = 0, maximumNormalBound = 0, maximumLegalExcess = 0;
      let startMax = 0, pitMax = 0, shaped = 0, strict = 0;
      const pitA = ((tr.pit.sEntry - 80) % tr.len + tr.len) % tr.len;
      const pitB = (tr.pit.sExit + 30) % tr.len;
      const pitSpan = ((pitB - pitA) % tr.len + tr.len) % tr.len;
      for (let i = 0; i < tr.n; i++) {
        const s = i * tr.step, ao = Math.abs(rl.off[i]);
        maxOff = Math.max(maxOff, ao);
        const minimum = tr.surface.normalMinimum[i];
        const maximum = tr.surface.normalMaximum[i];
        maximumNormalBound = Math.max(maximumNormalBound, Math.abs(minimum), Math.abs(maximum));
        maximumLegalExcess = Math.max(maximumLegalExcess,
          minimum - rl.off[i], rl.off[i] - maximum, 0);
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
        if (entry < 0 && apex > 0 && exit < 0) strict++;
      }
      const car = GL.makeCar(rl.x[0], rl.y[0], Math.atan2(rl.ty[0], rl.tx[0]));
      car.vx = 12; car.progIdx = 0;
      const markers = tr.corners.flatMap(c => [
        { corner: c.id, role: c.planRole, phase: 'turn-in', index: c.turnInI,
          target: rl.off[c.turnInI], bestD: Infinity, error: Infinity, signed: Infinity },
        { corner: c.id, role: c.planRole, phase: 'apex', index: c.apexI,
          target: rl.off[c.apexI], bestD: Infinity, error: Infinity, signed: Infinity },
        { corner: c.id, role: c.planRole, phase: 'track-out', index: c.trackOutI,
          target: rl.off[c.trackOutI], bestD: Infinity, error: Infinity, signed: Infinity }
      ]);
      let soloMaxLat = 0, soloGrass = 0, soloMaxHeading = 0, soloFinite = true;
      let previousS = 0, unwrapped = 0;
      const soloSteps = Math.ceil(rl.lapTime * 2.8 * 120);
      for (let q = 0; q < soloSteps; q++) {
        const surf = GL.trackSense(tr, car);
        if (q > 0) {
          let delta = car.s - previousS;
          if (delta < -tr.len / 2) delta += tr.len;
          else if (delta > tr.len / 2) delta -= tr.len;
          if (delta > -2) unwrapped += Math.max(0, delta);
        }
        previousS = car.s;
        if (unwrapped >= tr.len * 0.95 && unwrapped <= tr.len * 2.05) {
          for (const marker of markers) {
            const markerS = tr.len + marker.index * tr.step;
            const distance = Math.abs(unwrapped - markerS);
            if (distance < marker.bestD) {
              marker.bestD = distance;
              marker.signed = surf.lat - marker.target;
              marker.error = Math.abs(marker.signed);
            }
          }
        }
        const inp = GL.botStep(tr, B.prof, car, { margin: 0.95, muScale: 1, path: rl });
        GL.stepCar(car, inp, surf, 1 / 120, { pw: 1, mu: 1, dr: 1, df: 1 });
        soloMaxLat = Math.max(soloMaxLat, Math.abs(surf.lat));
        if (surf.zone === 'grass') soloGrass++;
        const i = Math.max(0, car.progIdx);
        soloMaxHeading = Math.max(soloMaxHeading,
          Math.abs(((car.h - Math.atan2(rl.ty[i], rl.tx[i]) + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
        soloFinite &&= Number.isFinite(car.x) && Number.isFinite(car.y) &&
          Number.isFinite(car.h) && Number.isFinite(car.vx) && Number.isFinite(car.vy) &&
          Number.isFinite(inp.steer) && Number.isFinite(inp.throttle) && Number.isFinite(inp.brake);
      }
      const markerMaxError = Math.max(...markers.map(marker => marker.error));
      const markerErrors = markers.map(marker => marker.error).sort((a, b) => a - b);
      const markerPosition = (markerErrors.length - 1) * 0.95;
      const markerLower = Math.floor(markerPosition);
      const markerP95Error = markerErrors[markerLower] +
        (markerErrors[Math.min(markerErrors.length - 1, markerLower + 1)] -
          markerErrors[markerLower]) * (markerPosition - markerLower);
      const isolatedMarkerMaxError = Math.max(0, ...markers
        .filter(marker => marker.role === 'isolated').map(marker => marker.error));
      return {
        name: B.def.name,
        centerLap: B.prof.lapTime,
        lineLap: rl.lapTime,
        maxOff, startMax, pitMax,
        maximumNormalBound, maximumLegalExcess,
        corners: tr.corners.length,
        shaped, strict, soloMaxLat, soloGrass, soloMaxHeading, soloFinite,
        markerMaxError, markerP95Error, isolatedMarkerMaxError,
        markerFailures: markers.filter(marker => marker.error > markerBounds.normal)
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
  }, { markerBounds });
  await browser.close();

  let failed = errors.length > 0 || warnings.some(w => w.includes('Racing line slower'));
  for (const t of result.tracks) {
    const faster = t.lineLap <= t.centerLap + 1e-6;
    const faded = t.startMax < 1e-6 && t.pitMax < 1e-6;
    const bounded = t.maximumLegalExcess <= 1e-6;
    const corners = t.corners >= 2;
    const markerAbsoluteOK = t.markerMaxError <= markerBounds.absolute;
    const markerAcceptable = t.markerP95Error <= markerBounds.acceptable && markerAbsoluteOK;
    const markerNormal = t.markerP95Error <= markerBounds.normal && markerAbsoluteOK;
    const trajectory = markerAcceptable && t.soloGrass === 0 && t.soloFinite;
    failed ||= !faster || !faded || !bounded || !corners || !trajectory;
    console.log(`${t.name}: center ${t.centerLap.toFixed(3)}s · line ${t.lineLap.toFixed(3)}s · ` +
      `gain ${(t.centerLap - t.lineLap).toFixed(3)}s · off ${t.maxOff.toFixed(2)}/${t.maximumNormalBound.toFixed(2)}m ` +
      `(legal excess ${t.maximumLegalExcess.toFixed(3)}m) · ` +
      `corners ${t.corners} (${t.shaped} relative-apex, ${t.strict} strict ±45m) · ` +
      `marker p95/max ${t.markerP95Error.toFixed(2)}/${t.markerMaxError.toFixed(2)}m ` +
      `(isolated ${t.isolatedMarkerMaxError.toFixed(2)}m) · ` +
      `solo lat ${t.soloMaxLat.toFixed(2)}m grass ${t.soloGrass} heading ${t.soloMaxHeading.toFixed(2)} · ` +
      `${faster && faded && bounded && corners && trajectory
        ? markerNormal ? 'OK' : 'AMBER'
        : 'FAIL'}`);
    if (!markerNormal || !trajectory) {
      const worst = [...t.markerFailures].sort((a, b) => b.error - a.error).slice(0, 8);
      for (const marker of worst)
        console.log(`  ${marker.corner} ${marker.phase}: ${marker.error.toFixed(3)}m ` +
          `(signed ${marker.signed.toFixed(3)}m)`);
    }
  }
  const c = result.collision;
  const collisionOK = c.clear && c.noseClear && c.grazeImp > 0 && c.grazeImp < 2 && c.grazeLoss < 2;
  failed ||= !collisionOK;
  console.log(`Capsule: lateral clear ${c.clear} · nose clear ${c.noseClear} · graze impact ${c.grazeImp.toFixed(2)} · max speed loss ${c.grazeLoss.toFixed(2)} m/s · ${collisionOK ? 'OK' : 'FAIL'}`);
  if (warnings.length) warnings.forEach(w => console.error('warning:', w));
  if (errors.length) errors.forEach(e => console.error('error:', e));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
