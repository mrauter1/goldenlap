import { TAU, clamp, normAng } from '../shared/math';
import { mulberry32 } from '../shared/rng';
import {
  denseArray, numericArray,
  type CurbSegment, type Decoration, type DecorationType, type DenseArray,
  type NearestSample, type Track, type TrackCheckpoint, type TrackDefinition
} from './model';

export function buildTrack(def: TrackDefinition, pitTeams = 6): Track {
  const P = def.pts, n = P.length;
  // dense Catmull-Rom sampling
  const rx = denseArray<number>(), ry = denseArray<number>();
  for (let i = 0; i < n; i++){
    const p0 = P[(i - 1 + n) % n]!, p1 = P[i]!, p2 = P[(i + 1) % n]!, p3 = P[(i + 2) % n]!;
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(8, Math.ceil(segLen / 1.2));
    for (let k = 0; k < steps; k++){
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      rx.push(0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3));
      ry.push(0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3));
    }
  }
  // cumulative length (closed)
  const M = rx.length;
  const cum = numericArray(M + 1);
  for (let i = 0; i < M; i++){
    const j = (i + 1) % M;
    cum[i + 1] = cum[i]! + Math.hypot(rx[j]! - rx[i]!, ry[j]! - ry[i]!);
  }
  const total = cum[M]!;
  // uniform resample
  const N = Math.max(64, Math.round(total / 2.0));
  const step = total / N;
  const X = numericArray(N), Y = numericArray(N);
  let seg = 0;
  for (let i = 0; i < N; i++){
    const s = i * step;
    while (seg < M - 1 && cum[seg + 1]! < s) seg++;
    const span = Math.max(1e-9, cum[seg + 1]! - cum[seg]!);
    const f = (s - cum[seg]!) / span;
    const j = (seg + 1) % M;
    X[i] = rx[seg]! + (rx[j]! - rx[seg]!) * f;
    Y[i] = ry[seg]! + (ry[j]! - ry[seg]!) * f;
  }
  // tangents, normals, curvature
  const TX = numericArray(N), TY = numericArray(N);
  const NX = numericArray(N), NY = numericArray(N);
  const HD = numericArray(N), K = numericArray(N), kSm = numericArray(N);
  for (let i = 0; i < N; i++){
    const p = (i - 1 + N) % N, q = (i + 1) % N;
    const dx = X[q]! - X[p]!, dy = Y[q]! - Y[p]!;
    const l = Math.max(1e-9, Math.hypot(dx, dy));
    TX[i] = dx / l; TY[i] = dy / l;
    NX[i] = -TY[i]!; NY[i] = TX[i]!;
    HD[i] = Math.atan2(TY[i]!, TX[i]!);
  }
  for (let i = 0; i < N; i++){
    const p = (i - 1 + N) % N, q = (i + 1) % N;
    K[i] = normAng(HD[q]! - HD[p]!) / (2 * step);
  }
  for (let i = 0; i < N; i++){
    let acc = 0;
    for (let d = -3; d <= 3; d++) acc += K[(i + d + N) % N]!;
    kSm[i] = acc / 7;
  }
  // spatial hash
  const cell = 24, hash = new Map<string, DenseArray<number>>();
  for (let i = 0; i < N; i++){
    const key = Math.floor(X[i]! / cell) + ':' + Math.floor(Y[i]! / cell);
    let arr = hash.get(key);
    if (!arr){ arr = denseArray<number>(); hash.set(key, arr); }
    arr.push(i);
  }
  const hw = def.width / 2;
  const track = {
    def, n: N, step, x: X, y: Y, tx: TX, ty: TY, nx: NX, ny: NY,
    k: K, kSm, len: total, hw, cell, hash
  } as Track;
  // checkpoints (start line handled separately, by segment crossing)
  const spacing = Math.max(6, Math.round(45 / step));
  const cps = denseArray<TrackCheckpoint>();
  for (let i = spacing; i <= N - spacing; i += spacing){
    cps.push({ x: X[i]!, y: Y[i]!, i });
  }
  track.cps = cps;
  track.cpR = 13.5;
  // start/finish line segment (slightly wider than the road)
  track.line = {
    ax: X[0]! + NX[0]! * (hw + 1.5), ay: Y[0]! + NY[0]! * (hw + 1.5),
    bx: X[0]! - NX[0]! * (hw + 1.5), by: Y[0]! - NY[0]! * (hw + 1.5),
    tx: TX[0]!, ty: TY[0]!, x: X[0]!, y: Y[0]!
  };
  // grid slot ~20 m before the line
  const gi = (N - Math.max(4, Math.round(20 / step))) % N;
  track.grid = { x: X[gi]!, y: Y[gi]!, h: HD[gi]!, i: gi };
  // curbs
  const curbs = denseArray<CurbSegment>();
  const pushCurb = (i: number, sgn: number): void => {
    const j = (i + 1) % N;
    const i0 = hw - 0.25, i1 = hw + 1.15;
    curbs.push({
      p: [
        X[i]! + NX[i]! * sgn * i0, Y[i]! + NY[i]! * sgn * i0,
        X[j]! + NX[j]! * sgn * i0, Y[j]! + NY[j]! * sgn * i0,
        X[j]! + NX[j]! * sgn * i1, Y[j]! + NY[j]! * sgn * i1,
        X[i]! + NX[i]! * sgn * i1, Y[i]! + NY[i]! * sgn * i1
      ] as DenseArray<number>,
      red: (Math.floor(i * step / 3.2) % 2) === 0
    });
  };
  for (let i = 0; i < N; i++){
    const r = 1 / Math.max(Math.abs(kSm[i]!), 1e-9);
    if (r < 130){
      const sgn = kSm[i]! > 0 ? 1 : -1;
      pushCurb(i, sgn);
      if (r < 75) pushCurb(i, -sgn);
    }
  }
  track.curbs = curbs;
  // min radius
  let minR = Infinity;
  for (let i = 0; i < N; i++) minR = Math.min(minR, 1 / Math.max(Math.abs(kSm[i]!), 1e-9));
  track.minR = minR;
  // pit lane on the +n side: entry ramp before the line, six team boxes,
  // exit ramp merging back shortly after the line. Cars drive the whole thing.
  {
    // PIT_TEAMS sizes the lane; raise it (max 11) when the grid grows to 22 cars
    const rampIn = 42, rampOut = 46, boxW0 = 58, boxGap = 10, nBox = pitTeams;
    const Lp = rampIn + 16 + nBox * boxGap + 22 + rampOut;
    const sExit = 52;
    const sEntry = ((sExit - Lp) % total + total) % total;
    const laneOff = hw + 4.6, boxOff = hw + 7.8;
    const roadOff = Math.min(3.2, hw - 2.0);
    const sm = (u: number): number => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
    const wOf = (s: number): number => ((s - sEntry) % total + total) % total;
    const off = (w: number): number => {
      if (w < -80 || w > Lp) return 0;
      if (w < 0) return roadOff * sm((w + 80) / 80);
      if (w < rampIn) return roadOff + (laneOff - roadOff) * sm(w / rampIn);
      if (w > Lp - rampOut) return laneOff * sm((Lp - w) / rampOut);
      return laneOff;
    };
    track.pit = {
      sEntry, sExit, Lp, laneOff, boxOff, rampIn, rampOut, limit: 14,
      wOf, off,
      inLane: (s: number): boolean => wOf(s) < Lp,
      boxWAt: (ti: number): number => boxW0 + clamp(ti, 0, nBox - 1) * boxGap,
      posAt(w: number, o: number){
        const s = (sEntry + w) % total;
        const i = Math.round(s / step) % N;
        return { x: X[i]! + NX[i]! * o, y: Y[i]! + NY[i]! * o, h: HD[i]!, i };
      }
    };
  }
  // decorations (deterministic)
  const rng = mulberry32(def.seed);
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (let i = 0; i < N; i++){
    mnx = Math.min(mnx, X[i]!); mny = Math.min(mny, Y[i]!);
    mxx = Math.max(mxx, X[i]!); mxy = Math.max(mxy, Y[i]!);
  }
  track.bbox = { x0: mnx, y0: mny, x1: mxx, y1: mxy };
  const decor = denseArray<Decoration>();
  let tries = 0;
  while (decor.length < 130 && tries < 2600){
    tries++;
    const x = mnx - 60 + rng() * (mxx - mnx + 120);
    const y = mny - 60 + rng() * (mxy - mny + 120);
    const g = hashNearest(track, x, y, 6);
    if (g.i < 0) continue;
    const d = Math.sqrt(g.d2);
    if (d < hw + 8 || d > 92) continue;
    const t = rng();
    let type: DecorationType, r: number, solid: boolean;
    if (t < 0.52){ type = 'tree'; r = 2.8 + rng() * 2.6; solid = true; }
    else if (t < 0.83){ type = 'bush'; r = 1.3 + rng() * 1.2; solid = false; }
    else { type = 'rock'; r = 0.9 + rng() * 1.1; solid = true; }
    let ok = true;
    for (let q = 0; q < decor.length; q++){
      const o = decor[q]!, ddx = o.x - x, ddy = o.y - y, rr = o.r + r + 2;
      if (ddx * ddx + ddy * ddy < rr * rr){ ok = false; break; }
    }
    if (!ok) continue;
    decor.push({ type, x, y, r, solid, rot: rng() * TAU, vr: rng() });
  }
  // hay bales on the outside of the four tightest corners (1970s!)
  const peaks = denseArray<{ i: number; k: number }>();
  for (let i = 0; i < N; i++){
    const k = Math.abs(kSm[i]!);
    if (k > 1 / 48){
      let isMax = true;
      for (let d = -6; d <= 6; d++){
        if (Math.abs(kSm[(i + d + N) % N]!) > k){ isMax = false; break; }
      }
      if (isMax) peaks.push({ i, k });
    }
  }
  peaks.sort((a, b) => b.k - a.k);
  const chosen = denseArray<{ i: number; k: number }>();
  for (const p of peaks){
    let far = true;
    for (const c of chosen){
      const d = Math.abs(c.i - p.i);
      if (Math.min(d, N - d) < 60){ far = false; break; }
    }
    if (far){ chosen.push(p); if (chosen.length >= 4) break; }
  }
  for (const p of chosen){
    const sgn = kSm[p.i]! > 0 ? 1 : -1; // inside; bales go outside
    for (let j = -4; j <= 4; j++){
      const i = (p.i + j * 2 + N) % N;
      decor.push({
        type: 'bale',
        x: X[i]! - NX[i]! * sgn * (hw + 3.4),
        y: Y[i]! - NY[i]! * sgn * (hw + 3.4),
        r: 1.0, solid: true, rot: HD[i]!, vr: rng()
      });
    }
  }
  // keep the pit-lane corridor clear of scenery and hay bales
  track.decor = decor.filter(d => {
    const g = hashNearest(track, d.x, d.y, 6);
    if (g.i < 0) return true;
    if (!track.pit.inLane(g.i * step)) return true;
    const lat = (d.x - X[g.i]!) * NX[g.i]! + (d.y - Y[g.i]!) * NY[g.i]!;
    return lat < 0 || lat > track.pit.boxOff + 8;
  }) as DenseArray<Decoration>;
  return track;
}

export function hashNearest(track: Track, x: number, y: number, maxCells: number): NearestSample {
  const cell = track.cell;
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let best = -1, bd = Infinity;
  for (let r = 0; r <= maxCells; r++){
    for (let ix = cx - r; ix <= cx + r; ix++){
      for (let iy = cy - r; iy <= cy + r; iy++){
        if (r > 0 && ix > cx - r && ix < cx + r && iy > cy - r && iy < cy + r) continue;
        const arr = track.hash.get(ix + ':' + iy);
        if (!arr) continue;
        for (let q = 0; q < arr.length; q++){
          const i = arr[q]!;
          const dx = track.x[i]! - x, dy = track.y[i]! - y, d2 = dx * dx + dy * dy;
          if (d2 < bd){ bd = d2; best = i; }
        }
      }
    }
    if (best >= 0 && bd <= (r * cell) * (r * cell)) break;
  }
  return { i: best, d2: bd };
}

// ---------------------------------------------------------------- racing line / ideal lap
