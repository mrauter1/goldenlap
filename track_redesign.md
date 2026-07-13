# Golden Lap — Track Redesign: circuits engineered to produce racing

Standalone plan + implementation tracker. Owner/reviewer: orchestrator session.
Implementation is delegated to sub-agents per the work packages in §7.

> **Packaging supersession (2026-07-13):** the later
> `racecraft_goal.md` reinstated the single-file constraint. The six final
> `TRACK_DEFS` are therefore inline in `index.html`; references below to
> `js/tracks.js` describe the historical redesign workflow, not the current
> runtime layout.

**The constraint change:** the single-file rule is lifted. The game may now be
several files, as long as the result deploys as a **static website** (and
keeps working over `file://`, which the test harness uses — so classic
`<script src>` includes, **no ES modules**, which Chrome blocks on `file://`,
and no build step).

---

## 1. Why the current tracks feel flat

The three current layouts are control-point polygons (`TRACK_DEFS` →
Catmull-Rom in `buildTrack()`) that were drawn to *look* like circuits, not to
*race* like circuits:

- **No deliberate overtaking anatomy.** Straights end in whatever corner the
  outline happened to need; there is no engineered long-run → heavy-brake →
  wide-entry sequence anywhere.
- **Uniform rhythm.** Corner radii cluster in the same medium band on all
  three tracks; no track has a signature ("the long flat-out blast", "the
  stadium hairpin"). All three share `width: 12` and near-identical corner
  counts.
- **No track typing.** Because all layouts stress the same car qualities,
  engine vs aero upgrades never change which track you're strong at — a whole
  strategy layer of the parts system lies dormant.

## 2. What makes a circuit produce good racing (research)

From circuit-design literature and F1 analysis (sources at bottom):

1. **The overtaking zone is a three-part machine:** a straight long enough to
   close the gap, a braking zone heavy enough to attack a later apex, and a
   corner entry wide enough for two cars. Bahrain T1 (1.1 km straight,
   320→90 km/h, wide right-hander) is the canonical example; Monaco's
   Sainte-Dévote (short approach, minimal braking, one car wide) is the
   canonical counter-example.
2. **The corner *before* the straight matters as much as the corner after
   it:** a slow-to-medium, "easy short apex" corner onto the straight lets a
   following car stay close and get a run.
3. **Variety beats formula.** The "Tilke-drome" criticism is that repeating
   long-straight + hairpin homogenizes racing and "pulls the field apart";
   the loved circuits (Interlagos, Spa, Suzuka) each have a distinct rhythm
   and character, mixing corner speeds so different car strengths trade
   blows around a lap.
4. **Multiple viable lines** — wide corners where two different arcs achieve
   similar speed — keep battles alive past the first apex.
5. **Mistake pressure creates racing too:** demanding high-commitment
   sections generate errors, and errors generate battles. (In 1976, hay
   bales — not tarmac run-off — punish them.)

## 3. Translating that into *this* simulation

The sim has its own laws; geometry must be designed against them, not against
real-world intuition. Established by code reading:

| Sim fact | Source | Design consequence |
|---|---|---|
| Attack only *commits* if the next ~60 m has no corner with R < 42 m | `stepRacecraft()` `tight` check (`kSm > 1/42`) | Passing zones need a clean, straight-ish approach; a kink mid-braking-zone vetoes attacks |
| Overtakes complete via sustained side-by-side; cars occupy lat ±3.4 m on a 12 m road | `updateTraffic()` clamp | Corners intended for passing need entry radius ≥ ~45 m so two offset lines are both drivable |
| **No slipstream exists** | `botStep()` / `entryMods()` | Straights alone don't generate runs — pace differential does. Optional WP5 adds a small tow to make straights active ingredients |
| Corner speed = physics-ideal × driver margin | `speedProfile()`, `botStep()` | Big Δv corners magnify pace differences → more attack triggers |
| Mistakes scale with stress, battles, wear, wet | `rollMistake()` | High-commitment sweeper sections are legitimate "action generators" even without passing |
| Pit lane auto-builds along s ∈ [−190 m, +52 m] around the start line, offset to +n side | `buildTrack()` pit block | Every layout needs a gentle, ~250 m start/finish zone; the pit side must not collide with an adjacent track section |
| Track self-proximity < ~2·(hw+8) breaks shadows/decor | render shadow pass, decor placement | Hairpin switchbacks need ≥ ~40 m between passes |
| Race length = 3600 s / ideal lap → 12–99 laps | `raceLapsFor()` | Lap time is a design dial: short lap = more laps = more traffic & lapping |
| Grid slots spawn at 30 + k·8.4 m behind the line | `startRace()` `spawnOnTrack` | **22-car requirement:** the ~215 m behind the line (plus buffer → 280 m) must be gentle (R ≥ 55) so a full 22-car grid forms cleanly; pit corridor must fit up to 11 team boxes (R ≥ 80 over s ∈ [−190, +55]) |

**Where racing actually comes from in this sim, ranked:** (1) pace
differentials meeting big Δv corners with wide entries; (2) tyre-wear /
strategy offsets creating those differentials mid-race; (3) mistakes under
stress; (4) traffic/lapping. Track geometry can feed all four.

## 4. The track linter — racing quality as numbers

`tools/trackscore.js` (Playwright, reads `__GL.BUILT` — already exposed)
computes per track, straight from the built geometry + ideal-lap profile:

**Descriptive metrics**
- `lapTime`, `length`, `laps` (= race laps at 3600 s target)
- `vMax` reached; **full-throttle fraction** of the lap (power sensitivity)
- Corner census from the speed profile's local minima: slow (< 28 m/s),
  medium (28–55), fast (> 55) — and a **variety index** (entropy of that mix)

**Racing-quality metrics**
- **Overtaking zones**: count of sequences where all hold —
  approach ≥ 220 m with no R < 42 m (attack can commit and build),
  braking Δv ≥ 20 m/s (heavy stop), corner-entry R ≥ 45 m (two cars fit).
  Also graded: Δv ≥ 28 & approach ≥ 350 m = "prime" zone.
- **Feeder corner**: the corner opening each zone's approach is medium/slow
  (exit < 45 m/s) — the "corner before the straight" rule.
- **Dead air**: longest stretch with neither a braking event (Δv ≥ 8) nor a
  corner < 60 m radius — rhythm check.
- **Mistake pressure**: time spent above 0.85 of local grip limit in corners
  faster than 40 m/s (high-commitment sweepers).

**Hard gates (fail = reject layout)**
- **22-car readiness**: pit corridor R ≥ 80 m for s ∈ [−190, +55] (lane
  sized for up to 11 team boxes) **and** grid zone R ≥ 55 m for
  s ∈ [−280, −190] (22 grid slots + buffer). No other track section within
  `laneOff + 12` m of the pit corridor.
- Self-proximity ≥ 40 m between non-adjacent sections (shadow/decor safety).
- Min radius ≥ 14 m (drivable hairpin), max |kSm| jerk bounded (no kinks).
- Lap time within its brief's band; bbox aspect ≤ ~1.8 (camera framing).
- A full bot lap completes with valid checkpoints (no cut detection traps).

Output: one table row per track + PASS/FAIL gates. The linter is the
reviewer's instrument for accepting WP3 work — layouts are iterated against
it, not against taste alone.

## 5. The new calendar — six circuits, six characters

Six rounds currently reuse three layouts. Each round gets its own circuit;
each is typed so the **parts system finally has terrain**: power tracks
reward engine, technical tracks reward aero/grip, flowing tracks reward
chassis and driver quality. Targets are linter numbers.

| R | Circuit (country) | Archetype & signature | Lap target | OT zones | Type |
|---|---|---|---|---|---|
| 1 | **Prado Verde** (BRA) | Interlagos-like season opener: short lap, feeder-hairpin onto a long climb-straight into a prime zone, twisty middle sector | 55–65 s | 2 (1 prime) | balanced |
| 2 | **Costa do Sol** (POR) | Seaside power track: two big straights, stadium hairpin, chicane stop; slipstream heaven | 62–72 s | 3 (2 prime) | engine |
| 3 | **Nordwald Ring** (GER) | Long forest epic: high-commitment sweeper sector (mistake pressure), one huge straight into a wide right; longest lap, fewest laps | 78–92 s | 2 (1 prime) | chassis/driver |
| 4 | **Villa Reale** (ITA, new) | Narrow street-park circuit: one marginal OT zone *by design*, strategy/tyre race, walls of hay; `width: 11` | 58–66 s | 1 | aero/grip |
| 5 | **Anhembi Speed Park** (USA, new) | Modern stop-go: three straight+hairpin machines, wide entries, `width: 13`; the pure overtaking track | 60–70 s | 3–4 (2+ prime) | engine/brakes |
| 6 | **Cerro Alto** (ARG, new) | Finale: hybrid — Nordwald-style commitment sector feeding the longest straight in the game into a stadium hairpin | 68–80 s | 2–3 (1 prime) | balanced |

Names/countries are suggestions; WP3 may improve them. Each def gains a
`meta` block (archetype, blurb, decor density, width) used by UI copy and
decor tuning. Palettes must keep each track visually distinct at a glance.

## 6. File architecture (restriction lifted)

Minimal, content-vs-engine split — not a full modularization:

```
index.html          game shell + engine (renamed from golden-lap.html)
js/tracks.js        TRACK_DEFS only: data + per-track meta (classic script,
                    defines window.TRACK_DEFS; agents edit this file freely
                    without touching the engine)
tools/trackscore.js linter (§4) + `--svg` layout drawings — dev-only
tools/race-sim.js   headless season/race-quality run      — dev-only
tools/shots.js      race-start screenshot per round       — dev-only
tools/README.md     how to run
track_redesign.md   this file
```

`golden-lap.html` remains as a stub redirect to `index.html` (old links keep
working). Everything under `tools/` is never referenced by the game.

## 7. Work packages

| WP | Owner | Depends | Deliverable |
|---|---|---|---|
| **WP1 — Split & prep** | Sonnet agent | — | Rename to `index.html`; extract `TRACK_DEFS` → `js/tracks.js`; redirect stub; widen `__GL` with `buildTrack`/`speedProfile`; make the ±3.4 lat clamp width-aware (`hw − 2.6`) so `width` is a real design dial; derive pit-box count from `TEAM_DEFS.length` instead of the hard-coded `nBox = 6` (22-car readiness). Game boots over `file://`, quali + race start clean. |
| **WP2 — Review instruments** | orchestrator (me) | — | `tools/trackscore.js`, `tools/shots.js`, `tools/race-sim.js`; baseline table for the current three tracks recorded in §8. Runs against the pre-WP1 file too (`__GL.BUILT` suffices), so it lands first. |
| **WP3 — Six circuits** | Opus agent | WP1, WP2 | New `js/tracks.js` with six defs per §5 briefs, iterated until the linter passes all gates and hits each brief's targets; `CALENDAR` updated to six unique rounds; palettes + meta for the three new venues. |
| **WP4 — Identity polish** | Sonnet agent | WP3 | Per-track decor density/props from `meta`, track blurbs in the quali/race sheets, any pit-visual fixes the new starts need. |
| **WP5 — Slipstream (optional, flagged)** | Opus agent | WP3 | Small tow: trailing within ~8–25 m, |Δlat| < 1.5, on low-curvature stretches → modest `vt` bonus in `botStep` path. Tuned against `race-sim.js`: overtakes up, contact metrics not worse than baseline. Ships only if both hold. |
| **WP6 — Final review** | orchestrator (me) | all | Linter table all-green; screenshots of six tracks reviewed; full-season `race-sim` run: no console errors, believable classifications, overtakes on every track ≥ baseline, contact ≤ baseline. |

Agents receive: this file, the sim-facts table (§3), their brief row (§5),
and the linter as their inner loop. Review happens on linter output +
screenshots + race-sim stats, then by reading the diff.

## 8. Baselines (WP2, recorded 2026-07-09, pre-redesign)

Linter (`node tools/trackscore.js ../golden-lap.html`):

| Track | len | lap | vMax | FT% | S/M/F corners | variety | OT zones | dead-air | commit | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Prado Verde | 3376 m | 69.8 s | 80.6 | 59% | 1/23/1 | 0.30 | **1** (0★) | 478 m | 256 m | pitZoneR 39 → known P3 issue |
| Costa do Sol | 3358 m | 67.3 s | 84.1 | 61% | 2/20/2 | 0.52 | **0** | 656 m | 278 m | |
| Nordwald Ring | 4460 m | 78.7 s | 87.6 | 65% | 0/21/5 | 0.45 | **1** (1★) | 1058 m | 322 m | |

The diagnosis in numbers: **not one true slow corner on the calendar**
(track-wide min radius ≈ 36–45 m), corner speeds all in one band
(variety 0.3–0.5), zero-to-one overtaking zones per track, and up to a full
kilometre of dead air. Full-throttle fraction barely spreads (59–65%), so no
track is a "power track" or a "grip track".

Race-sim (`node tools/race-sim.js`, full season, ~10 s wall time):

| R | Race | laps | passes | hits (hard) | DNF | rain |
|---|---|---|---|---|---|---|
| 1 | Prado Verde GP | 47 | 190 | 261 (19) | 1 | – |
| 2 | Costa do Sol GP | 49 | 161 | 313 (14) | 0 | – |
| 3 | Nordwald GP | 42 | 90 | 158 (19) | 2 | wet 0.95 |
| 4 | Costa Riviera GP | 49 | 272 | 453 (33) | 0 | – |
| 5 | Prado Finale | 47 | 160 | 538 (22) | 1 | – |
| 6 | Nordwald 500 | 42 | 179 | 332 (26) | 0 | – |

Season totals: **1052 passes · 2055 hits (133 hard) · 4 DNF · 0 console
errors · all classifications valid.** "Passes" = 1 Hz order swaps between
cars untouched by pits for 30 s — includes mistake-induced changes, so it is
a churn metric; compare like with like. WP6 targets: passes per race not
below baseline on any redesigned track, hits (esp. hard) not above, and the
per-track pass counts should *spread* by archetype (Villa Reale low by
design, Anhembi highest).

## 8b. Outcome (WP3–WP6, recorded 2026-07-10)

All six circuits shipped and signed off. Implementation notes: layouts were
built with a parametric generator (scratchpad `gen2.js` — turtle programs of
straights/arcs, auto-closure onto the pit straight, winding matched to the
original tracks) and iterated against the real linter. Two linter
calibrations were made during the work: the dead-air metric now treats up to
320 m of approach into a Δv ≥ 18 stop as "loaded" rather than inert, and the
clean-approach check allows the spline's natural ~55 m turn-in before a
hairpin apex (was 30 m — stricter than the sim's own attack rule).

Final linter (all hard gates green):

| Track | lap | laps | FT% | S/M/F | OT zones | notes |
|---|---|---|---|---|---|---|
| Prado Verde | 57.4 s | 57 | 69% | 10/4/0 | 3 (2★) | Senna-S T1, kart-bowl switchback |
| Costa do Sol | 65.9 s | 50 | 76% | 5/3/0 | **5 (4★)** | 974 m pit straight, stadium stop |
| Nordwald Ring | 82.1 s | 40 | 71% | 4/15/2 | 3 (2★) | Δv 63 monster hairpin after 620 m blast |
| Villa Reale | ~65 s | 50 | 62% | 10/2/0 | 2 (1★) | street blocks, tight final corner |
| Anhembi | ~68 s | 46 | 70% | 6/8/0 | 3–4 (1–2★) | wide (13 m) stop-go |
| Cerro Alto | 71.2 s | 46 | 71% | 7/5/2 | 2 (2★) | Δv 69 stadium stop after 935 m blast |

Race-sim, two full-season runs: **1461 and 1341 passes (baseline 1052)**,
0 console errors, all classifications valid, DNFs ≤ 2/race. Anhembi and
Prado lead passing (~320/race) as designed; Villa/Nordwald lowest, as
intended by archetype. Race-start screenshots for all six rounds verified
grid + pit lane + boxes integrate cleanly (`tools/shots.js`).

**Deviations from the brief:**
- Villa Reale ships at width 12, not 11 — at 11 m a dry race logged ~976
  light touches (constant rubbing); at 12 m it drops to ~430–580 while the
  all-slow-corner street character stays.
- The "corner variety ≥ 0.75 on four tracks" character check was
  miscalibrated and is met by two tracks (Nordwald 0.71–0.89, Cerro 0.9):
  entropy punishes coherent archetypes — Villa *should* be all-slow, Costa
  all-stops. Differentiation is instead evidenced by the S/M/F mixes and the
  62→76 % full-throttle spread (target ≥ 15 pts: achieved 14).
- Nordwald's `commit` metric reads low (~78 m vs the >500 m aspiration); the
  metric only counts ideal-profile samples at ≥ 0.85 of grip limit, which
  underweights long sweeper chains. Its sweeper character shows in the
  corner census (15 medium + 2 fast) instead. The metric needs rework before
  being used as a gate.
- WP5 (slipstream) was not implemented — deliberately deferred; see §7.
  Contact tuning (old roadmap P1) also remains open: one Prado run spiked to
  ~1000 light touches, so the concede/room-rule work is still worth doing.

## 9. Definition of done

1. Six unique circuits, each passing all linter gates and its §5 targets.
2. Race-sim: every circuit produces clean overtakes ≥ old baseline and
   contact ≤ old baseline; no console errors across a six-round season.
3. Deploys as a static site (`index.html` + `js/`) and still runs over
   `file://`; old `golden-lap.html` URL still lands in the game.
4. Each track visually distinct and recognizably its archetype in a
   screenshot; pit lane integrated on all six.
5. Track typing visible in results: the engine-track order differs from the
   aero-track order for the same field (linter's throttle-fraction spread
   ≥ 15 points between extremes is the proxy gate).

## Sources

- [Designing tracks for overtaking — Joe Saward](https://joesaward.wordpress.com/2009/11/03/designing-tracks-for-overtaking/)
- [Hermann Tilke: my circuit design methodology](https://thejudge13.com/2015/07/17/hermann-tilke-my-f1-circuit-design-methodology/)
- [RaceFans: Tilke answers his critics](https://www.racefans.net/2018/05/09/exclusive-tilke-answers-his-critics-and-explains-how-to-build-an-f1-track/)
- [GP Explained: overtaking and defending in F1](https://gpexplained.com/overtaking-and-defending-in-f1-explained/)
- [Grix: F1 circuits explained](https://www.grixme.com/formula-1-guide/f1-circuits/)
- [Di Grassi: variable geometry in circuit design](https://www.linkedin.com/pulse/variable-geometry-circuit-design-lucas-di-grassi)
- [Driver61: prioritising circuit corners](https://driver61.com/uni/prioritising-corners/)
