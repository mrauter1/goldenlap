#!/usr/bin/env node
// Deterministic edge-case checks that the fast season harness does not label:
// full qualifying flow, every pit lane, blue flags, slow obstacles, recovery,
// and preservation of the documented additive browser API.
const path = require('path');
const { chromium } = require('playwright');

const url = 'file://' + path.resolve(__dirname, '..', 'index.html');

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    let t = 0x51A7E;
    Math.random = () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  });
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
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // Let qualifying run for its full authored duration. Observe states while
  // the session exists; qualiEnd intentionally clears G.S at completion.
  const qp = await newPage(browser);
  qp.on('pageerror', e => errors.push('quali: ' + String(e)));
  qp.on('console', m => { if (m.type() === 'error') errors.push('quali: ' + m.text()); });
  const quali = await qp.evaluate(() => {
    const GL = window.__GL;
    const seen = new Set(), liveStates = new Set();
    let yieldSeen = false, hotSeen = false, guard = 0, peakCars = 0;
    while (GL.S && guard++ < 90000) {
      GL.stepSession(1 / 30);
      const S = GL.S;
      if (!S) break;
      for (const e of S.entries) {
        seen.add(e.state);
        if (e.car) liveStates.add(e.state);
        if (e.yieldT > 0) yieldSeen = true;
        if (e.lapLive && e.state === 'run') hotSeen = true;
      }
      peakCars = Math.max(peakCars, S.entries.filter(e => e.car).length);
    }
    return {
      guard,
      phase: GL.G.phase,
      states: [...seen].sort(),
      liveStates: [...liveStates].sort(),
      yieldSeen, hotSeen, peakCars,
      classified: Array.isArray(GL.G.qualiBest) && GL.G.qualiBest.length === 12 &&
        GL.G.qualiBest.filter(Number.isFinite).length >= 10 &&
        Array.isArray(GL.G.grid) && GL.G.grid.length === 12 && new Set(GL.G.grid).size === 12
    };
  });
  await qp.close();

  const page = await newPage(browser);
  page.on('pageerror', e => errors.push('edge: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('edge: ' + m.text()); });
  const edge = await page.evaluate(() => {
    const GL = window.__GL;
    const apiNames = ['pickTeam', 'sheetAction', 'qualiEnd', 'startRace', 'setScale',
      'stepSession', 'startWeekend', 'compileResults', 'buildTrack', 'racingLine',
      'speedProfile', 'buildCorners', 'nextCorner', 'makeCar', 'trackSense',
      'stepCar', 'botStep', 'collideCars'];
    const apiOK = apiNames.every(k => typeof GL[k] === 'function') && GL.G && GL.BUILT.length === 6;

    function beginRace(round) {
      GL.G.S = null;
      GL.G.round = round;
      GL.startWeekend();
      GL.qualiEnd();
      GL.sheetAction('startRace');
      const S = GL.S;
      S.phase = 'run'; S.goT = 0; S.t = 20; S.scale = 0;
      S.entries.forEach(e => { if (e.state === 'grid') e.state = 'run'; });
      return S;
    }
    function isolate(S, keep) {
      S.entries.forEach(e => {
        if (keep.includes(e)) return;
        e.state = 'dnf'; e.car = null;
      });
    }
    function place(S, e, s, speed, lat, cross, yaw) {
      const tr = S.trk;
      const i = Math.round((((s % tr.len) + tr.len) % tr.len) / tr.step) % tr.n;
      const h = Math.atan2(tr.ty[i], tr.tx[i]);
      e.car = GL.makeCar(tr.x[i] + tr.nx[i] * lat, tr.y[i] + tr.ny[i] * lat, h + (yaw || 0));
      e.car.vx = speed; e.car.s = i * tr.step; e.car.progIdx = i;
      e.spd = speed; e.lat = lat - (tr.rline.off[i] || 0); e.latTgt = e.lat;
      e.latNow = lat; e.cross = cross; e.prog = cross * tr.len + e.car.s;
      e.rlap.started = true;
      return i;
    }

    const pits = [];
    for (let r = 0; r < GL.CALENDAR.length; r++) {
      const S = beginRace(r), tr = S.trk;
      const e = S.entries.find(x => x.isPlayer);
      isolate(S, [e]);
      place(S, e, tr.pit.sEntry - 18, 18, 0, 1, 0);
      e.pitArm = { comp: 'H', fix: false };
      const seen = new Set([e.state]);
      let guard = 0, rejoined = false;
      while (GL.S && guard++ < 30000) {
        GL.stepSession(1 / 120);
        seen.add(e.state);
        if (seen.has('pitOut') && e.state === 'run' && e.stops >= 1) { rejoined = true; break; }
      }
      pits.push({
        track: tr.def.id, states: [...seen], stops: e.stops,
        rejoined, guard, finite: !!e.car &&
          [e.car.x, e.car.y, e.car.h, e.car.vx, e.car.vy].every(Number.isFinite)
      });
    }

    // Blue flag: a car one lap ahead approaches a lapped car 20 m ahead.
    let S = beginRace(0), tr = S.trk;
    let fast = S.entries[0], lapped = S.entries[1];
    isolate(S, [fast, lapped]);
    place(S, fast, 100, 36, 0, 2, 0);
    place(S, lapped, 120, 31, 0, 1, 0);
    S.trafT = 0;
    GL.stepSession(1 / 120);
    const blue = {
      yielded: lapped.yieldT > 0,
      lappedTarget: (tr.rline.off[Math.max(0, lapped.car.progIdx)] || 0) + lapped.latTgt,
      fastTarget: (tr.rline.off[Math.max(0, fast.car.progIdx)] || 0) + fast.latTgt
    };

    // Slow obstacle: a 3 m/s car 30 m ahead must trigger a committed pass side.
    S = beginRace(0); tr = S.trk;
    fast = S.entries[0]; const slow = S.entries[1];
    isolate(S, [fast, slow]);
    place(S, fast, 100, 40, 0, 1, 0);
    place(S, slow, 130, 3, 1.0, 1, 0);
    slow.fuel = 0;
    S.trafT = 0;
    GL.stepSession(1 / 120);
    const obstacle = {
      avoid: fast.avoidT > 0,
      side: fast._avoidSide,
      target: (tr.rline.off[Math.max(0, fast.car.progIdx)] || 0) + fast.latTgt,
      capped: Number.isFinite(fast.vCap)
    };

    // Recovery: introduce 0.7 rad yaw at moderate speed and verify it settles.
    S = beginRace(0); tr = S.trk;
    const rec = S.entries[0]; isolate(S, [rec]);
    place(S, rec, 500, 16, 0, 1, 0.7);
    const yaw = e => {
      const i = Math.max(0, e.car.progIdx);
      let d = e.car.h - Math.atan2(tr.ty[i], tr.tx[i]);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d);
    };
    const yaw0 = yaw(rec);
    for (let i = 0; i < 600; i++) GL.stepSession(1 / 120);
    const recovery = {
      yaw0, yaw1: yaw(rec), speed: rec.spd,
      finite: !!rec.car && [rec.car.x, rec.car.y, rec.car.h, rec.car.vx, rec.car.vy].every(Number.isFinite)
    };

    return { apiOK, pits, blue, obstacle, recovery };
  });

  const qualiOK = quali.phase === 'grid' && quali.classified && quali.hotSeen && quali.yieldSeen &&
    ['pit', 'pitIn', 'pitOut', 'run'].every(s => quali.liveStates.includes(s));
  const pitsOK = edge.pits.length === 6 && edge.pits.every(p => p.rejoined && p.stops >= 1 && p.finite &&
    ['pitIn', 'pit', 'pitOut', 'run'].every(s => p.states.includes(s)));
  const blueOK = edge.blue.yielded && edge.blue.lappedTarget > 2.4 && edge.blue.fastTarget < -2.2;
  const obstacleOK = edge.obstacle.avoid && Math.abs(edge.obstacle.target) > 2.5;
  const recoveryOK = edge.recovery.finite && edge.recovery.yaw1 < edge.recovery.yaw0 * 0.55 && edge.recovery.speed > 2;
  const ok = qualiOK && pitsOK && edge.apiOK && blueOK && obstacleOK && recoveryOK && !errors.length;
  console.log(JSON.stringify({ ok, qualiOK, pitsOK, blueOK, obstacleOK, recoveryOK, quali, edge, errors }, null, 2));
  await page.close();
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
