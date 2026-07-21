#!/usr/bin/env node
// Headless race-quality probe. Scripts a weekend per round via window.__GL,
// fast-forwards the sim by calling stepSession() directly, and reports
// overtakes, contact, DNFs and classification sanity per race.
// Usage: node tools/race-sim.js [path-to-html] [--rounds 0,1,2] [--dry|--rain]
const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./lib/browser');

const args = process.argv.slice(2);
const target = args[0] && !args[0].startsWith('--')
  ? args[0]
  : fs.existsSync(path.join(__dirname, '..', 'index.html')) ? '../index.html' : '../golden-lap.html';
const url = 'file://' + path.resolve(__dirname, target);
const roundsArg = args.includes('--rounds') ? args[args.indexOf('--rounds') + 1] : null;
const forceRain = args.includes('--rain');
const forceDry = args.includes('--dry');
const debugHits = args.includes('--debug-hits');
const strict = args.includes('--strict');
const traceArg = args.includes('--trace') ? args[args.indexOf('--trace') + 1] : '';
const traceCodes = traceArg ? traceArg.split(',').filter(Boolean) : [];
const traceWindowArg = args.includes('--trace-window') ? args[args.indexOf('--trace-window') + 1] : '';
const traceWindow = traceWindowArg ? traceWindowArg.split(',').map(Number) : [0, Infinity];
const seedArg = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : null;
if (forceRain && forceDry) throw new Error('Choose only one of --dry or --rain');

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // The harness owns the fixed-step clock. Leaving the page's animation loop
  // live would both double-step the session and consume gameplay Math.random
  // calls at wall-clock-dependent times, defeating seeded verification.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  });
  if (Number.isFinite(seedArg)) await page.addInitScript(seed => {
    let t = seed >>> 0;
    Math.random = () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }, seedArg);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__GL && window.__GL.G, null, { polling: 50 });

  // menu → team → staff → season
  await page.evaluate(() => {
    const GL = window.__GL;
    GL.pickTeam(0);
    GL.sheetAction('drv', { i: 0 }); GL.sheetAction('drv', { i: 1 });
    GL.sheetAction('eng', { i: 0 }); GL.sheetAction('chief', { i: 0 });
    GL.sheetAction('phil', { i: 0 }); GL.sheetAction('spon', { i: 0 });
    GL.sheetAction('startSeason');
  });

  const nRounds = await page.evaluate(() => window.__GL.CALENDAR.length);
  const rounds = roundsArg ? roundsArg.split(',').map(Number) : [...Array(nRounds).keys()];
  const results = [];

  const lastWanted = Math.max(...rounds);
  for (let round = 0; round < nRounds; round++) {
    if (round > lastWanted) break;
    const skip = !rounds.includes(round);
    // qualifying: fast-forward a little so cars exist, then end it
    await page.evaluate(() => {
      const GL = window.__GL;
      for (let i = 0; i < 300; i++) GL.stepSession(1 / 30); // 10 s so the session is warm
      GL.qualiEnd();
    });
    // grid sheet → race
    await page.evaluate(({ rain, dry }) => {
      const GL = window.__GL;
      if (rain) GL.CALENDAR[GL.G.round].rainP = 1;
      if (dry) GL.CALENDAR[GL.G.round].rainP = 0;
      GL.sheetAction('startRace');
      // lights-out normally happens in the rAF loop; do it directly here
      const S = GL.S;
      S.phase = 'run';
      S.goT = S.t;
      S.entries.forEach(e => { if (e.state === 'grid') e.state = 'run'; });
    }, { rain: forceRain, dry: forceDry });

    if (skip) { // still must finish the race to advance the season
      await page.evaluate(() => {
        const GL = window.__GL;
        let guard = 0;
        while (GL.S && guard++ < 400000) GL.stepSession(1 / 30);
      });
    } else {
      const stat = await page.evaluate(({ traceCodes, traceWindow }) => {
        const GL = window.__GL;
        const S = GL.S;
        const info = { name: GL.CALENDAR[GL.G.round].name, laps: S.laps, passes: 0, rain: S.rainAt >= 0, trace: [] };
        let prev = null, guard = 0;
        const lastPit = {};
        const recentPace = {};
        const updateRecentPace = () => {
          const path = S.trk.idealPath || S.trk.rline;
          for (const e of S.entries) {
            if (e.state !== 'run' || !e.car) continue;
            const i = Math.max(0, e.car.progIdx) % S.trk.n;
            const ratio = e.spd / Math.max(8, path.v[i] * 0.9);
            const pace = recentPace[e.code] || { recentRatio: Math.max(0.2, ratio), slowSeconds: 0 };
            pace.recentRatio = Math.max(ratio, pace.recentRatio * Math.exp(-1 / 8));
            const materiallySlow = ratio < pace.recentRatio * 0.65 || e.hFail || e.car.offCourse;
            pace.slowSeconds = materiallySlow
              ? pace.slowSeconds + 1
              : Math.max(0, pace.slowSeconds - 2);
            recentPace[e.code] = pace;
          }
        };
        const orderNow = () => S.entries.filter(e => e.state === 'run' &&
          (!recentPace[e.code] || recentPace[e.code].slowSeconds <= 3))
          .sort((a, b) => b.prog - a.prog).map(e => e.code);
        while (GL.S && guard++ < 400000) {
          for (let k = 0; k < 30 && GL.S; k++) GL.stepSession(1 / 30); // 1 s sim
          if (!GL.S) break;
          if (traceCodes.length && S.t >= traceWindow[0] && S.t <= traceWindow[1]){
            for (const code of traceCodes){
              const e = S.entries.find(x => x.code === code);
              if (!e || !e.car) continue;
              const i = Math.max(0, e.car.progIdx);
              const roadH = Math.atan2(S.trk.ty[i], S.trk.tx[i]);
              const targetEta = e.laneProgram?.points?.at(-1)?.eta ??
                e.laneProgram?.bias ?? 0;
              info.trace.push({
                t: S.t, code, state: e.state, s: e.car.s, prog: e.prog, v: e.spd,
                lat: e.latNow, tgt: (S.trk.idealPath?.off[i] || 0) + targetEta,
                throttle: e.inp.throttle, brake: e.inp.brake,
                yaw: Math.abs(((e.car.h - roadH + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI),
                r: e.car.r, slip: Math.abs(e.car.slipR), lift: e.liftT,
                avoid: e.avoidT,
                decision: e.racecraftDecision?.selectedKind || 'none',
                rec: e.recT,
                hitAge: isFinite(e._hitT) ? S.t - e._hitT : -1
              });
            }
          }
          if (S.phase === 'run' && S.t - S.goT > 10) { // skip start scramble
            for (const e of S.entries) // remember when each car last touched the pits
              if (e.state === 'pit' || e.state === 'pitIn' || e.state === 'pitOut') lastPit[e.code] = S.t;
            updateRecentPace();
            const clean = c => !(lastPit[c] > S.t - 30); // no pit involvement in last 30 s
            const now = orderNow();
            if (prev) {
              for (let i = 0; i < now.length; i++) {
                const j = prev.indexOf(now[i]);
                for (let q = i + 1; q < now.length; q++) {
                  const pj = prev.indexOf(now[q]);
                  if (j >= 0 && pj >= 0 && pj < j && clean(now[i]) && clean(now[q])) info.passes++;
                }
              }
            }
            prev = now;
          }
          info.hitN = S.hitN || 0; info.hitHard = S.hitHard || 0;
          info.hitLight = Math.max(0, info.hitN - info.hitHard);
          info.hitOpenHard = S.hitOpenHard || 0;
          info.hitHardSide = S.hitHardSide || 0; info.hitHardRear = S.hitHardRear || 0;
          info.hitHardRoom = S.hitHardRoom || 0; info.hitHardCorner = S.hitHardCorner || 0;
          info.hitMax = S.hitMax || 0;
          info.hitSide = S.hitSide || 0; info.hitRear = S.hitRear || 0;
          info.hitPairs = S.hitPairs || {};
          info.sbsT = S.sbsT || 0;
          info.utilizationMistakes = S.utilizationMistakes || 0;
          info.racecraftMaximumCandidates = S.racecraftMaximumCandidates || 0;
          info.defensiveMoves = S.racecraftDefensiveMovesCommitted || 0;
          info.defensiveContinuations = S.racecraftDefensiveMovesContinued || 0;
          info.spinN = S.spinN || 0;
          info.hitSamples = S.hitSamples || [];
          info.wetPeak = Math.max(info.wetPeak || 0, S.wet || 0);
        }
        const episodes = (S.sbsEpisodes || []).slice();
        if (S.sbsPairs){
          for (const key in S.sbsPairs){
            const ep = S.sbsPairs[key];
            episodes.push({ t: Math.max(1 / 30, S.t - ep.t0), contact: ep.contact });
          }
        }
        const durations = episodes.map(ep => ep.t).sort((a, b) => a - b);
        info.sbsEpisodes = episodes.length;
        info.sbsMedian = durations.length
          ? durations.length % 2 ? durations[(durations.length - 1) / 2]
            : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
          : 0;
        info.sbsContact = episodes.length
          ? episodes.filter(ep => ep.contact).length / episodes.length : 0;
        const gaps = S.stationGapDistribution;
        info.stationGapMeanMetres = gaps && gaps.samples
          ? gaps.sumMetres / gaps.samples
          : 0;
        info.attackInitiations = S.attackInitiations || 0;
        info.attackCompletions = S.attackCompletions || 0;
        info.sbsReasons = episodes.reduce((a, ep) => {
          const k = ep.reason || 'active'; a[k] = (a[k] || 0) + 1; return a;
        }, {});
        const res = (GL.G.lastRes && GL.G.lastRes.res) || [];
        info.finishers = res.filter(r => !r.dnf).length;
        info.dnfs = res.filter(r => r.dnf).length;
        info.classOk = res.length > 0 && new Set(res.map(r => r.pos)).size === res.length;
        return info;
      }, { traceCodes, traceWindow });
      results.push(stat);
      console.log(`R${round + 1} ${stat.name}: laps ${stat.laps} · passes ${stat.passes} · contacts ${stat.hitN} (${stat.hitLight} light, ${stat.hitHard} hard: ${stat.hitHardRear} rear/${stat.hitHardSide} side, ${stat.hitHardRoom} room, ${stat.hitHardCorner} corner, max ${stat.hitMax.toFixed(1)}, ${stat.hitOpenHard} lap 1) · SBS ${stat.sbsT.toFixed(1)}s/${stat.sbsEpisodes} med ${stat.sbsMedian.toFixed(2)}s contact ${(stat.sbsContact * 100).toFixed(1)}% · attacks ${stat.attackCompletions}/${stat.attackInitiations} · station gap mean ${stat.stationGapMeanMetres.toFixed(2)}m · utilization mistakes ${stat.utilizationMistakes} · evaluator candidates max ${stat.racecraftMaximumCandidates} · def ${stat.defensiveMoves}/${stat.defensiveContinuations} moves/continuations · spins ${stat.spinN} · DNF ${stat.dnfs} · rain ${stat.rain ? 'yes(peak ' + (stat.wetPeak || 0).toFixed(2) + ')' : 'no'} · classification ${stat.classOk ? 'OK' : 'BROKEN'}`);
      if (debugHits) for (const h of stat.hitSamples)
        console.log(`  hit ${h.imp.toFixed(1)} @${h.t.toFixed(1)}s ${h.a}/${h.b} ${h.stateA}/${h.stateB} pit${h.pitWA.toFixed(1)}/${h.pitWB.toFixed(1)} dAB${h.dAB.toFixed(1)} ds${h.ds.toFixed(1)} sep${h.sep.toFixed(1)} lat${h.latA.toFixed(1)}/${h.latB.toFixed(1)} tgt${h.tgtA.toFixed(1)}/${h.tgtB.toFixed(1)} v${h.spdA.toFixed(1)}/${h.spdB.toFixed(1)} dh${h.dh.toFixed(2)} yaw${h.yawA.toFixed(2)}/${h.yawB.toFixed(2)} r${h.rA.toFixed(1)}/${h.rB.toFixed(1)} slip${h.slipA.toFixed(2)}/${h.slipB.toFixed(2)} brk${h.brakeA.toFixed(1)}/${h.brakeB.toFixed(1)} cap${h.capA.toFixed(1)}/${h.capB.toFixed(1)} lift${h.liftA.toFixed(1)}/${h.liftB.toFixed(1)} rec${h.recA.toFixed(1)}/${h.recB.toFixed(1)} fail${h.failA ? 1 : 0}/${h.failB ? 1 : 0} prev${h.prevA.toFixed(1)}/${h.prevB.toFixed(1)} k${h.k.toFixed(4)} room${h.room ? 1 : 0} off${h.off ? 1 : 0} atk${h.atk ? 1 : 0}`);
      if (debugHits) for (const [pair, h] of Object.entries(stat.hitPairs).sort((a, b) => b[1].n - a[1].n).slice(0, 10))
        console.log(`  pair ${pair}: ${h.n} touches · ${h.hard} hard · max ${h.max.toFixed(1)} · avg imp ${(h.sumImp / h.n).toFixed(2)} ds ${(h.sumDs / h.n).toFixed(1)} sep ${(h.sumSep / h.n).toFixed(1)} · side ${h.side} room ${h.room} · t ${h.first.toFixed(0)}-${h.last.toFixed(0)}`);
      if (debugHits) console.log(`  SBS ends ${JSON.stringify(stat.sbsReasons)}`);
      for (const q of stat.trace)
        console.log(`  trace ${q.t.toFixed(1)} ${q.code} ${q.state} s${q.s.toFixed(1)} p${q.prog.toFixed(1)} v${q.v.toFixed(1)} lat${q.lat.toFixed(1)} tgt${q.tgt.toFixed(1)} cap${q.cap.toFixed(1)} in${q.throttle.toFixed(1)}/${q.brake.toFixed(1)} yaw${q.yaw.toFixed(2)} r${q.r.toFixed(2)} slip${q.slip.toFixed(2)} lift${q.lift.toFixed(1)} avoid${q.avoid.toFixed(1)} decision=${q.decision} rec${q.rec.toFixed(1)} hit${q.hitAge.toFixed(1)}`);
    }
    // results sheet → workshop → next round (or season end)
    const done = await page.evaluate(() => {
      const GL = window.__GL;
      GL.sheetAction('toWorkshop');
      if (GL.G.round + 1 < GL.CALENDAR.length) { GL.sheetAction('nextRound'); return false; }
      return true;
    });
    if (done) break;
  }
  const strictErrors = [];
  if (strict){
    for (const r of results){
      if (r.hitHard > 30) strictErrors.push(`${r.name}: hard hits ${r.hitHard} > 30`);
      if (r.sbsMedian < 1.5) strictErrors.push(`${r.name}: SBS median ${r.sbsMedian.toFixed(2)} < 1.50`);
      if (r.dnfs < 0 || r.dnfs > 5) strictErrors.push(`${r.name}: DNF ${r.dnfs} outside 0..5`);
      if (!r.classOk) strictErrors.push(`${r.name}: invalid classification`);
    }
    const avgPasses = results.length ? results.reduce((a, r) => a + r.passes, 0) / results.length : 0;
    if (avgPasses < 100) strictErrors.push(`average passes ${avgPasses.toFixed(1)} < 100`);
  }
  if (errors.length) { console.error('\nPAGE/CONSOLE ERRORS:'); errors.slice(0, 10).forEach(e => console.error(' ', e)); }
  if (strictErrors.length) { console.error('\nSTRICT ACCEPTANCE FAILURES:'); strictErrors.forEach(e => console.error(' ', e)); }
  console.log(`\nTotal: ${results.reduce((a, r) => a + r.passes, 0)} passes over ${results.length} races · errors: ${errors.length}`);
  await browser.close();
  process.exit(errors.length ? 2 : strictErrors.length ? 3 : 0);
})();
