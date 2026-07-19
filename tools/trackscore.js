#!/usr/bin/env node
// Golden Lap track linter — scores every track in __GL.BUILT against the
// racing-quality metrics and hard gates in track_redesign.md §4.
// Usage: node tools/trackscore.js [path-to-html] [--json]
const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./lib/browser');

const target = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : fs.existsSync(path.join(__dirname, '..', 'index.html')) ? '../index.html' : '../golden-lap.html';
const asJson = process.argv.includes('--json');
const url = 'file://' + path.resolve(__dirname, target);

// Mirrors of PHYS constants used by speedProfile (not exported by the game).
const PHYS = { mu: 1.70, profMu: 0.93, kDf: 2.35, dfMax: 5200, m: 720, g: 9.81 };

// Gates (see track_redesign.md §4)
const GATES = {
  minRadius: 14,          // drivable hairpin
  selfProx: 40,           // m between non-adjacent sections
  pitZoneR: 80,           // min radius through the pit corridor s ∈ [-190,+55]
  gridZoneR: 55,          // min radius through the 22-car grid zone s ∈ [-280,-190]
  aspectMax: 1.85,
  lapMin: 50, lapMax: 95, // sane band; per-brief bands checked by reviewer
};

function analyze(PHYS) {
  const out = [];
  const B = window.__GL.BUILT;
  const RACE_TARGET = 3600, RACE_PACE_F = 1.10;
  for (const built of B) {
    const tr = built.tr, prof = built.prof, def = built.def;
    const N = tr.n, step = tr.step, len = tr.len;
    const v = prof.v, kSm = tr.kSm;
    const R = i => 1 / Math.max(Math.abs(kSm[i]), 1e-9);
    const muP = PHYS.mu * PHYS.profMu;
    const gEff = s => muP * (PHYS.g + Math.min(PHYS.kDf * s * s, PHYS.dfMax) / PHYS.m);

    // --- corners: local minima of v (with plateau handling) ---
    const corners = [];
    for (let i = 0; i < N; i++) {
      const p = (i - 1 + N) % N, q = (i + 1) % N;
      if (v[i] <= v[p] && v[i] < v[q] && R(i) < 200) {
        if (corners.length && (i - corners[corners.length - 1].i) * step < 25) {
          if (v[i] < corners[corners.length - 1].v) corners[corners.length - 1] = { i, v: v[i], r: R(i) };
          continue;
        }
        corners.push({ i, v: v[i], r: R(i) });
      }
    }
    const slow = corners.filter(c => c.v < 28).length;
    const med = corners.filter(c => c.v >= 28 && c.v <= 55).length;
    const fast = corners.filter(c => c.v > 55).length;
    const tot = Math.max(1, corners.length);
    const H = [slow, med, fast].map(x => x / tot).filter(p => p > 0)
      .reduce((a, p) => a - p * Math.log2(p), 0) / Math.log2(3); // 0..1

    // --- braking events + overtaking zones ---
    // A braking event: local max of v down to next local min.
    const zones = [];
    let vMax = 0, deadMax = 0, dead = 0;
    for (let i = 0; i < N; i++) vMax = Math.max(vMax, v[i]);
    const brakes = [];
    for (let c = 0; c < corners.length; c++) {
      const apex = corners[c].i;
      const prevApex = corners[(c - 1 + corners.length) % corners.length].i;
      // walk back from apex to the local max before it (not past previous apex)
      let j = apex, guard = 0;
      while (guard++ < N && v[(j - 1 + N) % N] >= v[j] - 1e-9) {
        j = (j - 1 + N) % N;
        if (j === apex || j === prevApex) break;
      }
      const dv = v[j] - corners[c].v;
      if (dv < 8) continue;
      // clean approach: walk back from brake-start while R >= 42 m (not past previous apex)
      let a = j, runLen = 0; guard = 0;
      while (guard++ < N && R((a - 1 + N) % N) >= 42) {
        a = (a - 1 + N) % N; runLen += step;
        if (a === apex || a === prevApex) break;
      }
      // sim rule: kSm < 1/42 must hold through the braking zone until the
      // spline's natural turn-in (~55 m before apex on tight corners)
      let cleanToApex = true;
      for (let q = j; q !== apex; q = (q + 1) % N) {
        const distToApex = ((apex - q + N) % N) * step;
        if (distToApex <= 55) break;
        if (R(q) < 42) { cleanToApex = false; break; }
      }
      brakes.push({ apex, dv, runLen });
      // feeder corner: previous corner's speed
      const prev = corners[(c - 1 + corners.length) % corners.length];
      const feederOk = prev.v < 45;
      if (dv >= 20 && runLen >= 220 && cleanToApex) {
        zones.push({
          s: Math.round(apex * step), dv: +dv.toFixed(1), run: Math.round(runLen),
          apexV: +corners[c].v.toFixed(1), apexR: Math.round(corners[c].r),
          feederOk, prime: dv >= 28 && runLen >= 350
        });
      }
    }

    // --- dead air: longest stretch with no braking (dv>=8) and no R<60 ---
    const evt = new Uint8Array(N);
    for (const b of brakes) { // mark braking span
      let j = b.apex, guard = 0;
      while (guard++ < N && v[(j - 1 + N) % N] >= v[j]) { j = (j - 1 + N) % N; evt[j] = 1; }
      evt[b.apex] = 1;
      // a straight charging into a heavy stop is anticipation, not dead air:
      // mark up to 320 m of the approach as "loaded"
      if (b.dv >= 18) {
        const ext = Math.min(Math.round(320 / step), Math.round(b.runLen / step));
        for (let q = 1; q <= ext; q++) evt[(j - q + N) % N] = 1;
      }
    }
    for (let i = 0; i < N; i++) if (R(i) < 60) evt[i] = 1;
    for (let i = 0; i < 2 * N; i++) { // circular
      if (evt[i % N]) dead = 0; else { dead += step; deadMax = Math.max(deadMax, dead); }
      if (i >= N && dead >= len) break;
    }
    deadMax = Math.min(deadMax, len);

    // --- mistake pressure: distance near the grip limit in fast corners ---
    let commit = 0, throttleFrac = 0;
    for (let i = 0; i < N; i++) {
      const aLat = v[i] * v[i] * Math.abs(kSm[i]);
      if (v[i] > 40 && R(i) < 130 && aLat / gEff(v[i]) > 0.85) commit += step;
      if (v[i] > 0.985 * Math.min(89, vMax)) throttleFrac += 0; // placeholder, below
    }
    // full-throttle fraction: where the profile is accel-limited (v rising) or at vTop
    let ft = 0;
    for (let i = 0; i < N; i++) {
      const q = (i + 1) % N;
      if (v[q] > v[i] + 1e-6 || v[i] > 87) ft += step;
    }

    // --- gates ---
    let minR = Infinity; for (let i = 0; i < N; i++) minR = Math.min(minR, R(i));
    // self-proximity between non-adjacent samples (>=80 m apart along s)
    const skip = Math.round(80 / step);
    let selfProx = Infinity;
    const cell = 48, hh = new Map();
    for (let i = 0; i < N; i++) {
      const key = Math.floor(tr.x[i] / cell) + ':' + Math.floor(tr.y[i] / cell);
      (hh.get(key) || hh.set(key, []).get(key)).push(i);
    }
    for (let i = 0; i < N; i++) {
      const cx = Math.floor(tr.x[i] / cell), cy = Math.floor(tr.y[i] / cell);
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const arr = hh.get(ix + ':' + iy); if (!arr) continue;
        for (const j of arr) {
          const d = Math.abs(i - j), circ = Math.min(d, N - d);
          if (circ < skip) continue;
          const dx = tr.x[i] - tr.x[j], dy = tr.y[i] - tr.y[j];
          selfProx = Math.min(selfProx, Math.hypot(dx, dy));
        }
      }
    }
    // pit corridor curvature (lane sized for up to 11 team boxes) and the
    // 22-car grid zone behind it
    let pitZoneMinR = Infinity, gridZoneMinR = Infinity;
    const back = Math.round(190 / step), fwd2 = Math.round(55 / step);
    for (let d = -back; d <= fwd2; d++) pitZoneMinR = Math.min(pitZoneMinR, R((d + N) % N));
    const gback = Math.round(280 / step);
    for (let d = -gback; d < -back; d++) gridZoneMinR = Math.min(gridZoneMinR, R((d + N) % N));
    const bw = tr.bbox.x1 - tr.bbox.x0, bh = tr.bbox.y1 - tr.bbox.y0;
    const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));

    out.push({
      id: def.id, name: def.name, width: def.width,
      len: Math.round(len), lapTime: +prof.lapTime.toFixed(1),
      laps: Math.max(12, Math.min(99, Math.round(RACE_TARGET / (prof.lapTime * RACE_PACE_F)))),
      vMax: +vMax.toFixed(1), ftFrac: +(ft / len).toFixed(2),
      corners: { slow, med, fast, variety: +H.toFixed(2) },
      zones, nZones: zones.length, nPrime: zones.filter(z => z.prime).length,
      deadAir: Math.round(deadMax), commit: Math.round(commit),
      minR: +minR.toFixed(1), selfProx: +selfProx.toFixed(1),
      pitZoneMinR: Math.round(pitZoneMinR), gridZoneMinR: Math.round(gridZoneMinR),
      aspect: +aspect.toFixed(2),
      shape: { x: Array.from(tr.x).map(v2 => +v2.toFixed(1)), y: Array.from(tr.y).map(v2 => +v2.toFixed(1)), hw: tr.hw, pitFrom: -190, pitTo: 55 }
    });
  }
  return out;
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__GL && window.__GL.BUILT);
  const rows = await page.evaluate(analyze, PHYS);
  await browser.close();

  const gate = r => {
    const fails = [];
    if (r.minR < GATES.minRadius) fails.push(`minR ${r.minR} < ${GATES.minRadius}`);
    if (r.selfProx < GATES.selfProx) fails.push(`selfProx ${r.selfProx} < ${GATES.selfProx}`);
    if (r.pitZoneMinR < GATES.pitZoneR) fails.push(`pitZoneR ${r.pitZoneMinR} < ${GATES.pitZoneR}`);
    if (r.gridZoneMinR < GATES.gridZoneR) fails.push(`gridZoneR ${r.gridZoneMinR} < ${GATES.gridZoneR} (22-car grid)`);
    if (r.aspect > GATES.aspectMax) fails.push(`aspect ${r.aspect} > ${GATES.aspectMax}`);
    if (r.lapTime < GATES.lapMin || r.lapTime > GATES.lapMax) fails.push(`lapTime ${r.lapTime} outside ${GATES.lapMin}-${GATES.lapMax}`);
    return fails;
  };
  if (asJson) { console.log(JSON.stringify(rows, null, 2)); }
  else {
    for (const r of rows) {
      const fails = gate(r);
      console.log(`\n■ ${r.name} (${r.id})  ${fails.length ? '✗ FAIL' : '✓ gates pass'}`);
      console.log(`  len ${r.len} m · lap ${r.lapTime}s · ${r.laps} laps · vMax ${r.vMax} · full-throttle ${Math.round(r.ftFrac * 100)}%`);
      console.log(`  corners S/M/F ${r.corners.slow}/${r.corners.med}/${r.corners.fast} · variety ${r.corners.variety} · commit ${r.commit} m · dead-air ${r.deadAir} m`);
      console.log(`  OT zones ${r.nZones} (${r.nPrime} prime): ${r.zones.map(z =>
        `[s${z.s} Δv${z.dv} run${z.run}${z.prime ? '★' : ''}${z.feederOk ? '' : ' no-feeder'}]`).join(' ') || '—'}`);
      console.log(`  gates: minR ${r.minR} · selfProx ${r.selfProx} · pitZoneR ${r.pitZoneMinR} · gridZoneR ${r.gridZoneMinR} · aspect ${r.aspect}`);
      for (const f of fails) console.log(`  ✗ ${f}`);
    }
  }
  // --svg: dump a layout drawing per track for visual review
  if (process.argv.includes('--svg')) {
    const dir = process.argv[process.argv.indexOf('--svg') + 1] || __dirname;
    for (const r of rows) {
      const { x, y, hw } = r.shape;
      const minX = Math.min(...x) - 40, minY = Math.min(...y) - 40;
      const w = Math.max(...x) - minX + 40, h = Math.max(...y) - minY + 40;
      const pts = x.map((v, i) => `${(v - minX).toFixed(1)},${(y[i] - minY).toFixed(1)}`).join(' ');
      const zoneMarks = r.zones.map(z => {
        const i = Math.min(x.length - 1, Math.round(z.s / (r.len / x.length)));
        return `<circle cx="${(x[i] - minX).toFixed(1)}" cy="${(y[i] - minY).toFixed(1)}" r="${z.prime ? 14 : 9}" fill="none" stroke="${z.prime ? '#c33' : '#e90'}" stroke-width="4"/>`;
      }).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">
<rect width="100%" height="100%" fill="#e8e4d8"/>
<polygon points="${pts}" fill="none" stroke="#615D6E" stroke-width="${2 * hw}" stroke-linejoin="round"/>
<polygon points="${pts}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="6 6" opacity=".6"/>
<circle cx="${(x[0] - minX).toFixed(1)}" cy="${(y[0] - minY).toFixed(1)}" r="7" fill="#111"/>
${zoneMarks}
<text x="12" y="26" font-family="monospace" font-size="20">${r.name} · lap ${r.lapTime}s · OT ${r.nZones}(${r.nPrime}★)</text>
</svg>`;
      fs.writeFileSync(path.join(dir, `track-${r.id}.svg`), svg);
      console.log(`  svg → ${path.join(dir, `track-${r.id}.svg`)}`);
    }
  }
  if (errors.length) { console.error('\nPAGE ERRORS:', errors); process.exit(2); }
  const anyFail = rows.some(r => gate(r).length);
  process.exit(anyFail ? 1 : 0);
})();
