# Golden Lap — Racecraft Implementation Task

Companion documents: `racecraft_goal.md` (objective + acceptance, read first),
`racecraft_plan.md` (analysis and rationale). This file is the code-level
implementation spec. All line numbers refer to `index.html` as of 2026-07-13
(3,814 lines); re-verify with grep before editing — they will drift as you work.

Ground rules (from `task.md`, unchanged):
- `index.html` stays a single-file vanilla HTML/CSS/JS game. No dependencies,
  no build step. Dev tooling lives only in `tools/`.
- Do not break: pit-lane flow (`pitIn`/`pitOut`/`pit` states), qualifying
  (out lap / hot lap / in lap and yielding), the `window.__GL` test API,
  mobile layout, 4×/8× time scale stability.
- The physics core (`stepCar`, `speedProfile`, `botStep`, `collideCars`) is
  deliberately game-layer-agnostic (usable headless). Keep it that way:
  extend signatures with optional parameters, don't couple them to `G`/`S`.

---

## Phase 0 — Instrumentation and baseline (do first, no behavior change)

### 0.1 In-game counters
`stepSession()` already tracks `S.hitN` / `S.hitHard` (line ~2860). Add,
in the same places (no per-frame allocation):

- `S.concedeN` — number of times the hit loop applies a concede.
- `S.concedeSoftN` — concedes applied with `hh.imp < 4` (these are the
  "small touch overslowed a car" events; after Phase 1 this must be 0 by
  construction, so the *baseline* number is the evidence).
- In `updateTraffic()`: side-by-side tracking. For each sorted pair with
  `ds < 6` and `|a.latNow - e.latNow| > 1.8` and both `state === 'run'`,
  accumulate `S.sbsT += TRAF_DT`. Maintain `S.sbsPairs = {}` keyed by
  `codeA|codeB` with `{t0, contact}`; when a pair stops qualifying, push the
  episode duration into `S.sbsEpisodes` (a small array of numbers) and
  whether a hit occurred during it (set a flag from the hit loop when both
  cars of a hit are a current sbs pair). Cap the array at 200 entries.

### 0.2 Harness metrics (`tools/race-sim.js`)
Extend the per-race report with: `concedeN`, `concedeSoftN`, `sbsT`,
`sbsEpisodes.length`, median episode duration, fraction of episodes with
contact. Keep existing pass counting unchanged so numbers stay comparable.

### 0.3 Baseline run
`node tools/race-sim.js` (all 6 rounds, dry) and once with `--rain`.
Record the table (per round: laps, passes, hits, hard, concedeSoft, sbs
stats, DNFs) at the bottom of this file under "Baseline". Every later phase
re-runs this and appends its own table. Do not proceed until the baseline
runs clean (exit 0, no console errors).

---

## Phase 1 — Contact: capsule collider + severity-scaled response

Fixes: side-by-side cars grinding (collision diameter 3.0 m > 2.4 m room
target) and light touches triggering a compounding slow-down.

### 1.1 Capsule collider — `collideCars()` (line ~877)
Keep the signature `collideCars(list, R)` and the return shape
`[{i, j, imp}]`. Replace the single-circle test:

- Each car gets two circle centers in world space:
  `(x ± 1.35·cos h, y ± 1.35·sin h)`, radius `PHYS.colR2 = 1.0` (add to
  `PHYS`; keep `colRadius` for callers that pass explicit `R`, e.g. tests).
- Coarse reject first: center distance² > `(2·2.35)²` → skip pair.
- Test the 4 circle pairs; resolve only the **deepest** overlapping pair per
  car pair per tick (position split + impulse exactly as the current code,
  along the circle-pair normal, applied to the car centers — no torque).
- `imp` stays `|rel·n|` of the resolved pair.

Result: lateral touch at ~2.0 m (real car width), nose-to-tail at ~4.7 m.

### 1.2 Graze-aware impulse — same function
Compute the tangential component of relative velocity at contact. Scale the
blanket damping (currently `0.985` on both cars) so that a fully tangential
graze applies no damping:
`damp = 1 - 0.015 * (|rel·n| / (|rel| + 1e-6))`. Restitution `e = 0.2` stays.

### 1.3 Severity-gated concede — hit loop in `stepSession()` (line ~2858)
Replace the current block (`slow.concedeT = Math.max(slow.concedeT, 0.8)`):

```js
if (hh.imp >= 2){
  A.stress = clamp(A.stress + hh.imp * 0.012, 0, 1);   // unchanged formula,
  B2.stress = clamp(B2.stress + hh.imp * 0.012, 0, 1); // now gated
}
if (hh.imp >= 4){
  // the car BEHIND (by s, wrap-aware) backs out, not the slower one
  const dsAB = ((B2.car.s - A.car.s) % len + len) % len;
  const behind = dsAB < len / 2 ? A : B2;
  behind.concedeT = Math.max(behind.concedeT, clamp(hh.imp * 0.08, 0.3, 1.5));
  behind.concedeV = Math.max(8, behind.spd - 2);   // latched ONCE at contact
}
```
`imp < 2`: cosmetic only — no stress, no concede (thud/toast thresholds at
5/8 stay as they are).

### 1.4 Non-ratcheting concede effect — `updateTraffic()` (line ~2957)
Replace `e.vCap = Math.min(e.vCap, Math.max(6, e.spd - 2))` with
`e.vCap = Math.min(e.vCap, e.concedeV)`. Add `concedeV: 0` to `mkEntry()`
(line ~1987). The penalty becomes "hold 2 m/s below contact speed for a
moment", not "decelerate 2 m/s per tick toward 6".

### 1.5 Verify
Harness: `concedeSoftN === 0`; total hits down ≥ 50% vs baseline; median
side-by-side episode ≥ 1.5 s; passes not collapsed (> 0.5× baseline).
Manual: watch a midfield battle at 1×; a wheel-bang should read as a wobble
+ brief lift, never as one car parking.

---

## Phase 2 — Signed follow law

Fixes root cause R1: every follow branch floors `vCap` above the leader's
speed, so followers creep into contact forever.

### 2.1 Helper (place above `stepRacecraft`)
```js
// speed ceiling that settles e at a time-gap behind a
function followCap(e, a, ds, tGap, k){
  const dGap = Math.max(5, a.spd * tGap);
  return Math.max(a.spd - 8, a.spd + (ds - dGap) * (k || 1.6));
}
```

### 2.2 Replace every positive-floor branch
Current sites (grep `a.spd + Math.max`): 2931, 2981, 2984, 2992, 3000, 3023,
3026, 3036. Mapping:

| Site | Context | Replacement |
|---|---|---|
| 3036 | similar-pace following | `followCap(e, a, ds, 0.45)` |
| 3026 | attacking, committed | `followCap(e, a, ds, 0.18, 2.2)` |
| 3023 | attack held (tight corner) | `followCap(e, a, ds, 0.35)` |
| 3000 | lapped car ahead (blue flag) | `followCap(e, a, ds, 0.30, 2.0)` |
| 2992 | start rush | `followCap(e, a, ds, 0.55)` |
| 2984/2981 | quali traffic / hot-lap catch | `followCap(e, a, ds, 0.35)` |
| 2931 | car peeling into pit lane | `followCap(e, a, ds, 0.40)` |

Keep each branch's distance/separation *conditions*; only the cap formula
changes. The slow/parked-obstacle branch (line ~2967, `a.spd < max(8, …)`)
keeps its own formula — passing a crawling car is not gap-holding.

### 2.3 Verify
Harness: hits < 400 total and < 8 hard per race (old roadmap P1 targets),
opening lap ≤ 2 hard hits; passes within [0.7×, 1.5×] of baseline — if they
dropped below, shrink the attack `tGap` before touching anything else.
Manual: a train of cars should hold visible daylight, not bumper-tap.

---

## Phase 3 — Racing line

The largest change. Core-section work; keep every new function usable
headless (no `G`/`S`/DOM access).

### 3.1 Naming hazard
`track.line` is **already taken** (start/finish segment, line ~414). Name
the new structure `track.rline`.

### 3.2 Line computation — new core function `racingLine(track)`
Iterative curvature-minimizing relaxation over lateral offsets:

```
off[i] initialised to 0, i over track.n samples (closed loop)
repeat R = 300 sweeps:
  for each i:
    p = point(i-S, off), q = point(i+S, off)      // S ≈ 4 samples
    target = lateral offset that puts point(i) on the chord p→q
    off[i] += 0.25 * (target - off[i])
    off[i] = clamp(off[i], -(hw-1.6), +(hw-1.6))
smooth off with the same ±3 box filter used for kSm
```
(`point(i, off)` = centerline + normal·off; the chord projection is the
classic "pull the line straight" relaxation — cheap and stable. ~300 sweeps
× ~2k samples × 6 tracks at boot is a few ms each; measure, and if boot cost
is noticeable, drop to 150 sweeps — quality degrades gracefully.)

Then **fade the line to the centerline around the pit corridor** so pit
entry/exit geometry is unchanged: multiply `off` by a smoothstep window that
is 0 from `pit.sEntry − 80 m` through `pit.sExit + 30 m` and 1 elsewhere.
Also fade to 0 over ±25 m around `s = 0` so grid spawn columns (±2.55 in
centerline space, line ~2412) and the start-line crossing stay honest.

### 3.3 Line geometry + profile
From `off[]`, compute per-index (same index space as the centerline —
do **not** resample, everything else keys off `progIdx`):
- line points `lx, ly`; per-segment arc length `lds[i] = |P(i+1) − P(i)|`
- line heading and curvature `lk[i]` (same ±1 central difference + ±3 box
  smooth as `buildTrack` uses for `kSm`)

Generalize `speedProfile(track)` → `speedProfile(track, path)` where `path`
is optional `{k, ds}` (defaults: `kSm`, uniform `step`). Internals: replace
`track.kSm[i]` with `path.k[i]` and the uniform `ds` with `path.ds[i]` in
both sweeps and the time integration. **No caller change needed** for the
existing centerline call in `BUILT` (line ~1514).

Store: `track.rline = { off, k, ds, v, t, lapTime }`. Build it in `BUILT`
next to `prof` (keep `buildTrack` itself unchanged apart from nothing —
`racingLine` + profile can be composed in the `BUILT` map).

Sanity assert (dev-only, console.warn): `rline.lapTime <= prof.lapTime`
on every track. If a track violates it, the relaxation is broken — stop.

### 3.4 Driving the line — `botStep()` (line ~831)
Add optional `prm.path = {off, k, v}` (when absent: current behavior,
zeros/`kSm`/`prof.v` — the pit lane and any headless tests keep working).
With a path:
- pursuit target: `track.x[ti] + track.nx[ti] * (path.off[ti] + latT)` —
  `latT` becomes an offset **relative to the line**;
- cross-track error term (`latE`): measure against `path.off[i] + latT`;
- target speed and the anticipatory braking loop read `path.v` / `path.k`
  instead of `prof.v` / `track.kSm`;
- **off-line speed correction** (fixes R5): everywhere a `path.v[j]` is
  read, scale it by
  `Math.sqrt(clamp(1 - path.k[j] * latT, 0.75, 1.05))`
  (offset toward the inside of the local curve tightens the radius → lower
  allowed speed; outside gains a hair, capped).

### 3.5 Wiring — `stepEntry()` (line ~2706)
For non-pit-lane driving, pass
`path: tr.rline ? { off: tr.rline.off, k: tr.rline.k, v: tr.rline.v } : undefined`
in the `botStep` call. Pit-lane branches (`pitIn`/`pitOut`) pass **no path**
(they steer absolute centerline offsets through `pit.off(w)` — unchanged).
Since the line fades to 0 through the pit corridor (3.2), the hand-off at
state changes is seam-free.

Traffic semantics: `e.lat`/`e.latTgt` are now *relative to the line*. The
clamp in `updateTraffic` (line ~2954, `latMax = hw - 2.6`) must become
absolute: clamp `e.lat` so that `|rline.off[i] + e.lat| ≤ hw − 2.0`. Grid
start offsets (`e.lat = ±2.55` at spawn) are near `s=0` where the line is
faded to 0, so they remain valid as-is.

Quali gains the line automatically (same call path).

### 3.6 Debug overlay (small, worth it)
Behind `window.__GL.debugLine = true`, stroke the racing line polyline in
`render()` (one Path2D, built lazily per track). Used by `tools/shots.js`
screenshots to eyeball apexes. Off by default; zero cost when off.

### 3.7 Verify
- Console: the `rline.lapTime <= prof.lapTime` warning fires on no track.
- Harness: lap times improve or hold (leader best within [0.95×, 1.02×] of
  old numbers); passes and hits within Phase-2 targets; no rise in `dnfs`
  or recovery events; pit stops still work on all 6 tracks (the harness
  already exercises them via rival pit AI).
- Screenshots: out-in-out visible at the tightest corner of at least 3
  tracks with the debug overlay on.

---

## Phase 4 — Corner-aware attack & defense

### 4.1 Corner table (computed with `rline`, stored `track.corners`)
Scan `rline.v` for local minima below `0.93 · vTop`: each is an apex. Walk
back from the apex while `v` is monotonically decreasing → `brakeI`. Record
`{ apexI, brakeI, side: Math.sign(rline.k[apexI]), vApex }`. Merge corners
whose apexes are < 30 m apart (keep the slower). Helper
`nextCorner(track, i)` → the first corner with `brakeI` ahead of sample `i`
(wrap-aware, precompute a per-sample lookup array for O(1)).

### 4.2 Slipstream — `updateTraffic()` + `entryMods()` (line ~2054)
In the pair loop: if `ds < 16`, `|Δlat| < 1.5`, both `spd > 30`, and the
follower's local `|rline.k| < 1/230` (a straight), set
`e.tow = clamp(1 - ds / 18, 0, 0.7)`, decaying `e.tow *= 0.8` per traffic
tick otherwise. In `entryMods`: `dr: e.mods.dr * (1 - 0.13 * (e.tow || 0)) * …`.
Add `tow: 0` to `mkEntry`.

### 4.3 Attack (rework the `faster && ds < 30` branch, line ~3012)
- Side selection: `const nc = nextCorner(tr, i0)`. If the corner's braking
  point is within ~2.5 s at current speed, attack the **inside**:
  `insideAbs = nc.side * 2.8` (absolute road offset), so
  `e.latTgt = insideAbs - rline.off[i0]`, i.e. `e.atkSide` stores the
  *absolute* target, converted at use. If no corner is near (long straight),
  keep today's "opposite of defender" side and use the tow.
- Keep the 3 s commitment (`atkT`) and the existing tight-corner hold-off,
  but the hold-off only applies when the attacker has **no overlap**
  (`ds > 4.5`).
- Late-braking spice: while `atkT > 0` and the car is inside the corner's
  braking window (`i` between `brakeI` and `apexI`), add `+0.008` to margin
  (via a new `e.lungeT` consumed in `entryMargin`) and roll a lockup with
  probability `0.06 · (1 − e.focusNow)` per corner: on failure set
  `e.liftT = 1.2` (runs wide, existing machinery).

### 4.4 Corner rights (overlap rule)
In the pair loop, when `nextCorner` braking starts within 15 m for the
leader and the chaser has overlap (`ds < 4.5`, `sep > 1.8`): clamp the
**defender's** `latTgt` so `|defLat − atkLat| ≥ 2.6` stays true through the
corner (don't let the defender squeeze). If the chaser has *no* overlap at
`brakeI`: end the attack (`atkT = 0`, `latTgt → 0` i.e. back to the line,
keep `tow`).

### 4.5 Defend (replace the random sidestep, line ~3028)
When a faster car is 8–25 m behind, a corner's `brakeI` is within ~120 m,
and `defT ≤ 0`: with probability `0.35 + a.lu.focus * 0.4`, move once to
cover the inside (`latTgt = insideAbs * 0.8 − rline.off[i]`), `defT = 4`.
The move is only legal **before** the attacker has overlap (4.4 wins
otherwise). After the apex, decay `latTgt` back to 0 (the line). One move
per `defT` window — no weaving. Off-line cost (3.4) makes this a real
trade-off automatically.

### 4.6 Verify
Harness: passes within [0.8×, 1.6×] of Phase-2 numbers; hard hits still
< 6; new counter `S.lungeN` (optional) sane. Manual (the real test): follow
a battle for 3+ laps at 1× — expect tow on the straight → move inside →
either side-by-side through the corner or a tuck-back and retry. No weaving,
no drive-through-each-other, no attacker faceplanting the same corner every
lap.

---

## Phase 5 — Side-by-side negotiation polish

### 5.1 Room rule hysteresis — `updateTraffic()` (line ~2938)
Engage the mutual-room push at `|Δlat| > 2.1` (as now) but once engaged for
a pair, keep it until `|Δlat| < 1.6` or `ds > 12` (store engagement on the
pair via a small `e._roomWith = a.code` field; clear when released). Raise
the separation target from 2.4 to **2.6** (capsules touch at 2.0 → 0.6 m of
air).

### 5.2 Corner-exit resolution
When a room-engaged pair passes a corner's apex (leader's `progIdx` crosses
`apexI`) and one car is behind by more than half a car (`ds > 2.7`), the
behind car yields: `latTgt → 0` (back to the line), a 0.6 s `followCap`
tuck at `tGap 0.4` — **no** speed dump. This turns "grind alongside for the
whole straight" into "loser slots into the leader's gearbox with a tow",
which is exactly the retry loop 4.2 feeds.

### 5.3 Verify
Harness: side-by-side episodes — median ≥ 1.5 s, < 20% end in contact
(vs baseline's near-100%). Manual: two-wide through a corner resolves at
exit without contact most of the time.

---

## Phase 6 — Start rush + multi-car awareness

### 6.1 Start (`stepRacecraft` start branch, line ~2989)
For `S.t − S.goT < 4`: `latTgt` = grid column (spawn `lat`, which is
centerline-space; the line is faded near `s=0` so it's compatible), follow
law `followCap(e, a, ds, 0.55)`; **no attack/defend moves**. From 4 s to
~8 s, blend to normal racecraft. Delete the ad-hoc `±0.35` lateral jitter.

### 6.2 Two-ahead awareness (`updateTraffic` pair loop)
For each car, also fetch `list[(k + 2) % n]`. Choose the *braking
reference*: the nearest car ahead within 60 m whose lane overlaps
(`|Δlat| < 2.2`); apply `stepRacecraft` against it. If the immediately-next
car is alongside-but-not-in-lane, it is handled by the room rule only, and
the car two ahead becomes the braking reference. Guard `n >= 3`.

### 6.3 Verify
Harness: opening lap ≤ 2 hard hits; no first-corner pileups in 6/6 races;
three-car trains brake smoothly at 8× (watch for accordion oscillation —
if present, raise `followCap` `tGap` for the third car by +0.1).

---

## Phase 7 — Retune and lock in

1. Full harness matrix: all 6 rounds dry + all 6 forced rain, at least 3
   seeds (vary via re-runs; the sim uses `Math.random`).
2. Targets (final, from `racecraft_goal.md`): hits < 300/race, hard < 6,
   `concedeSoftN = 0`, passes ≥ 8/race average, sbs median ≥ 1.5 s with
   < 20% contact, 0 console errors, classification OK everywhere, DNFs in
   [0, 5] per race.
3. Tune only these knobs, in order: `followCap` gaps → attack `tGap`/margin
   bonus → defend probability → room separation. One knob per run.
4. Append the final metric table + chosen parameter values to this file.
5. Manual sweep: one full weekend played by hand at 1×/4×/8× on desktop and
   a 390 px viewport; quali yield behavior, pit stops, blue flags, rain
   race, and the finish all eyeballed.

---

## Parameter reference (initial values — tune in Phase 7)

| Name | Value | Where |
|---|---|---|
| capsule circle radius / spacing | 1.0 / ±1.35 | `PHYS.colR2`, `collideCars` |
| concede gate / duration | imp ≥ 4 / `clamp(imp·0.08, 0.3, 1.5)` | hit loop |
| stress gate | imp ≥ 2 | hit loop |
| followCap default k / clamp | 1.6 / `a.spd − 8` | helper |
| follow tGap: normal / attack / start | 0.45 / 0.18 / 0.55 s | call sites |
| line clamp / fade zones | ±(hw−1.6) / pit −80..+30 m, start ±25 m | `racingLine` |
| off-line speed factor clamp | [0.75, 1.05] | `botStep` |
| tow: range / strength | 16 m / dr × (1 − 0.13·tow) | traffic, `entryMods` |
| attack side window / overlap | 2.5 s to corner / ds < 4.5 | `stepRacecraft` |
| lunge margin / lockup chance | +0.008 / 0.06·(1−focus) | `entryMargin`, attack |
| defend window / probability | 8–25 m, brakeI < 120 m / 0.35 + 0.4·focus | defend |
| room: engage / release / sep | 2.1 / 1.6 / 2.6 m | room rule |

## Edge-case checklist (walk before each phase's commit)

- [x] Pit entry/exit on all 6 tracks (line fades to centerline there).
- [x] Quali: out-lap yield to a flying car still works (same follow law).
- [x] Blue flags: lapped car still moves over and is passed cleanly.
- [x] `dnf()` parked cars: capsules must not fling passers-by (parked cars
      are excluded from `collList` already — confirm unchanged).
- [x] Crawling car (out of fuel, `pw 0.25`): the slow-obstacle branch still
      routes traffic around it.
- [x] `stepRecovery` (line ~2618): heading target is centerline — fine, but
      confirm a recovered car rejoins the *line* without a new spin.
- [x] Checkpoints (`cpR = 13.5`) still caught at max line offset.
- [x] 8× speed: no oscillation in follow law or room rule (integration is
      fixed-step `H_STEP`; traffic at `TRAF_DT` — unchanged frequencies).
- [x] `window.__GL` API surface unchanged; `tools/race-sim.js` runs green.

## Baseline

Recorded 2026-07-13 after Phase-0 instrumentation. `--dry` and `--rain`
force the weather for every round; both runs completed with zero page/console
errors and valid classifications. `SBS contact` is the fraction of the retained
(maximum 200) side-by-side episodes that contained a collision impulse.

### Forced dry

| Round | Laps | Passes | Hits | Hard | Concede soft | SBS time | SBS episodes | Median | SBS contact | DNF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Prado Verde | 57 | 232 | 394 | 20 | 367 | 814.7 s | 200 | 2.35 s | 14% | 0 |
| Costa do Sol | 50 | 271 | 301 | 12 | 283 | 536.2 s | 182 | 1.82 s | 20% | 2 |
| Nordwald | 40 | 141 | 457 | 21 | 425 | 595.7 s | 200 | 1.68 s | 17% | 0 |
| Villa Reale | 50 | 196 | 516 | 10 | 497 | 841.8 s | 200 | 2.68 s | 14% | 0 |
| Anhembi | 45 | 398 | 496 | 35 | 447 | 809.7 s | 200 | 0.85 s | 11% | 0 |
| Cerro Alto | 46 | 192 | 452 | 8 | 437 | 614.2 s | 200 | 2.22 s | 18% | 0 |

### Forced rain

| Round | Laps | Passes | Hits | Hard | Concede soft | SBS time | SBS episodes | Median | SBS contact | DNF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Prado Verde | 57 | 213 | 783 | 47 | 720 | 933.2 s | 200 | 1.97 s | 8% | 1 |
| Costa do Sol | 50 | 224 | 625 | 21 | 591 | 694.9 s | 200 | 1.22 s | 5% | 0 |
| Nordwald | 40 | 189 | 470 | 27 | 435 | 584.8 s | 200 | 1.10 s | 6% | 1 |
| Villa Reale | 50 | 156 | 756 | 6 | 740 | 870.2 s | 200 | 1.58 s | 13% | 2 |
| Anhembi | 45 | 266 | 312 | 30 | 270 | 637.1 s | 200 | 0.92 s | 11% | 1 |
| Cerro Alto | 46 | 202 | 520 | 26 | 481 | 437.7 s | 200 | 1.32 s | 15% | 2 |

---

## Final lock-in — 2026-07-13

Packaging constraint restored: all six track definitions are inline in
`index.html`; there is no external script, stylesheet, runtime dependency, or
build step. The core section now reads no `window`, `document`, `G`, or `S`
state. The prior `js/tracks.js` split from the older track-redesign plan was
removed as part of the final audit.

Final behavior was verified with the strict harness in six complete seeded
seasons: `--dry` and `--rain` for seeds 1, 2, and 3. Each invocation ran the
whole six-round season, including the qualifying-to-grid transition, race,
pit strategy, finish, results, workshop, and next-round transition. The strict
runner treats the target inequalities literally (`hits < 300`, `hard < 6`,
and SBS contact `< 20%`).

### Final deterministic matrix

The table records the per-season total/average passes and the worst per-race
value for every bounded metric. All 36 individual classifications were valid;
all had `concedeSoftN = 0`, `defRepeatN = 0`, and zero page/console errors.

| Seed | Weather | Passes total / avg | Lowest passes | Max hits | Max hard | Max opening hard | Min SBS median | Max SBS contact | Max DNF |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | dry | 1,135 / 189.2 | 139 | 65 | 3 | 1 | 2.25 s | 19.0% | 3 |
| 1 | rain | 1,304 / 217.3 | 127 | 58 | 3 | 1 | 2.28 s | 12.5% | 0 |
| 2 | dry | 1,079 / 179.8 | 139 | 73 | 2 | 1 | 2.30 s | 15.5% | 0 |
| 2 | rain | 1,040 / 173.3 | 154 | 50 | 2 | 0 | 2.67 s | 12.5% | 1 |
| 3 | dry | 1,320 / 220.0 | 170 | 58 | 1 | 0 | 2.15 s | 17.0% | 1 |
| 3 | rain | 1,124 / 187.3 | 102 | 57 | 2 | 0 | 2.43 s | 15.5% | 1 |
| **All 36 races** | — | **7,002 / 194.5** | **102** | **73** | **3** | **1** | **2.15 s** | **19.0%** | **3** |

This compares with the Phase-0 baseline maxima of 783 touches, 47 hard hits,
and 720 soft concedes. The final matrix has 1,316 touches total (36.6/race),
22 hard hits total (0.61/race), and zero soft concedes.

### Racing-line and contact checks

`node tools/racecraft-check.js` independently compared centerline and racing-
line profiles, ran a solo line-following stability probe, inspected the line
shape around detected corners, and exercised clear/graze capsule cases.

| Track | Center lap | Line lap | Gain | Shaped out–in–out corners | Result |
|---|---:|---:|---:|---:|---|
| Prado Verde | 57.422 s | 55.075 s | 2.347 s | 4 / 11 | pass |
| Costa do Sol | 65.911 s | 63.864 s | 2.047 s | 4 / 7 | pass |
| Nordwald | 82.105 s | 78.828 s | 3.277 s | 2 / 19 | pass |
| Villa Reale | 64.912 s | 63.237 s | 1.675 s | 11 / 11 | pass |
| Anhembi | 71.974 s | 69.576 s | 2.399 s | 4 / 8 | pass |
| Cerro Alto | 71.246 s | 69.408 s | 1.839 s | 10 / 13 | pass |

All solo probes recorded zero grass samples. The capsule check reported clear
lateral and nose cases, while a deliberate graze measured impact 0.10 and only
0.12 m/s maximum speed loss. `node tools/trackscore.js` also passed every
track's minimum-radius, self-proximity, pit/grid-corridor, aspect, and lap-time
gate.

### Final parameter values

| Area | Final value |
|---|---|
| Capsule | two circles/car, radius `1.0`, centers `±1.35 m`; `0.03 m` contact slop; `0.30 m` resolution clearance; restitution `0.2` |
| Contact effects | stress at `imp >= 2`; concede at `imp >= 4`; hard at `imp > 8`; concede duration `clamp(imp*0.08, 0.3, 1.5)` on the car behind, with event-latched cap `max(8, speed-2)` |
| Follow law | `dGap=max(5, leaderSpeed*tGap*(1+0.45*wet))`; default `k=1.6`; lower clamp `leaderSpeed-8`; closing damping `0.35+0.35*wet`; braking-distance ceiling uses `6.8*(1-0.24*wet) m/s²` |
| Follow windows | normal `tGap=0.45`, active through 45 m; attack `0.38 / 0.28 / 0.18 s` as lateral separation crosses `1.5 / 2.1 m`; start `0.75 -> 0.45 s` |
| Start | hold grid columns for 4 s; blend into normal line/racecraft through 16 s; start-only closing ceiling `leaderSpeed+3` |
| Racing line | 300 chord-relaxation sweeps, span 4 samples, relaxation `0.25`, 7-sample smoothing, clamp `±(hw-1.6)`; pit fade `entry-80 .. exit+30 m`, start fade `±25 m` |
| Off-line cost | path-relative curvature speed factor clamped to `[0.75, 1.05]` |
| Tow / attack | tow inside 16 m with drag multiplier `1-0.13*tow`; 3 s attack commitment; corner window up to `speed*3.2`; overlap at `ds < 4.5 m`; lunge `+0.008`; lockup roll `0.06*(1-focus)` |
| Defense | 8–25 m window, brake point inside 120 m, probability `0.35+0.4*focus`; attack-sequence key enforces one move/window |
| Room rule | engage/release `2.1 / 1.6 m`; target separation `3.4 m`; contact recovery held to `2.3 m`; damaged/healthy neighbours use opposite lanes until 12 m longitudinal separation |
| SBS accounting | engage/release hysteresis `2.1 / 1.6 m`, so one battle is not split by lateral threshold chatter; retained sample remains 200 episodes |
| Lateral stability | active-room target rate `0.052`, max step `0.110` per traffic tick, multiplied by `1-0.18*wet`; early room-specific yaw/slip gathering |
| Frequencies | unchanged: physics `1/120 s`, traffic `1/30 s` |

Judgment-call deviations from the starting values:

- Room target is 3.4 m rather than 2.6 m. Rotated 5.4 m capsules still grazed
  at roughly 2.0 m centerline separation during high-speed lane changes; the
  wider target brought SBS contact below 20% without suppressing passes.
- The post-start blend ends at 16 s rather than ~8 s. The first 4 s still hold
  the authored grid columns; the longer smooth release prevents accordion
  impacts while cars fan into the first braking zone.
- The signed follow law includes closing-rate and physical braking-distance
  terms in addition to the requested equilibrium gap. This prevents a fast
  follower from discovering a sharply braking leader only inside 30 m.
- Room state is pair-keyed rather than stored as one `_roomWith` value, because
  three-car packs require one car to negotiate with more than one neighbour.
  Contact-seeded and damaged-car recovery are explicit states, not hidden speed
  penalties.

### Browser, visual, and edge sweep

`node tools/racecraft-ui-check.js output/playwright` used the real DOM controls.
Over equal 350 ms wall intervals, 1x/4x/8x advanced 0.49/1.55/3.01 simulated
seconds, all vehicle values stayed finite, and pause worked. At 390×844 the
document width remained exactly 390 px and all four time buttons stayed inside
the viewport. This complements the full fixed-step seasons: time scale only
changes how many unchanged `1/120 s` steps the animation loop consumes.

The debug overlay was visually inspected at tight corners on three tracks:

- `output/playwright/racecraft-line-01-prado.png`
- `output/playwright/racecraft-line-02-costa.png`
- `output/playwright/racecraft-line-03-nordwald.png`

Each capture visibly shows outside entry, inside apex, and outside unwind on
pavement. `output/playwright/racecraft-mobile-hud.png` records the mobile pass.

`node tools/racecraft-edge-check.js` supplied the remaining explicit checks:

- [x] Full qualifying observed out/hot/in flow, yielding, pit service, and a
      complete unique grid (the two unsent player cars correctly show NO TIME).
- [x] Pit entry -> box -> pit exit -> track rejoin completed with finite state
      on all six tracks.
- [x] Blue flag moved the lapped car to +3.01 m and the passing car to -2.8 m.
- [x] A 3 m/s crawling car triggered a committed -3.2 m avoidance path and a
      finite braking cap.
- [x] A car introduced at 0.70 rad yaw recovered to 0.03 rad with finite state.
- [x] DNF/finished cars remain excluded from the collision list.
- [x] Rain, wear, fuel, pit strategy, finishes, classifications, and season
      transitions completed in the 36-race matrix.
- [x] The existing `window.__GL` functions remain present; new core helpers are
      additive. Mobile, pause, 1x, 4x, and 8x checks produced zero browser errors.
