# Racecraft Trajectory Revamp — Implementation Report

Implementation date: 2026-07-16. The work follows
`racecraft_trajectory_revamp_plan.md` in the mandatory order L0 → L1 → L2 →
L3 → L4 → L4b → L5. Each phase has its own verification cycle; findings owned
by a later phase are recorded rather than tuned against one seed.

## Status and evidence index

| Phase | Status | Primary evidence |
|---|---|---|
| L0 — golden references and audit metrics | complete | L0 audit recorded; deterministic checks 189/189 green; fast stats 0 red |
| L1 — lane program under ideal line | complete | golden traces and 36/36 controller probes bit-exact; parity fixtures green |
| L2 — single lateral authority | complete; verification exceptions open | zero pin/hop/safety faults; golden laps exact; performance and timing exceptions recorded below |
| L3 — corner line library | complete; phase check has one recorded host-timing exception | 158/158 controller-validated lines; profile validation green; physical cost distribution amber |
| L4 — maneuver lane edits | complete; pinned performance exception open | battle economy 1.53–2.26%; zero lane-hop/materializations/safety faults; benchmark exception recorded below |
| L4b — tow threat and door rule | complete; audit amber | tucked loss 0.235–0.389%; all near-touch/door canaries green; 72 green / 3 amber / 0 red |
| L5 — population lock | complete | full `verify` exited zero; normal population 276 green / 21 amber / 0 red / 85 inconclusive; attributed completion 345/1,359 |

## L0 — Golden references

The reference was captured before behavior edits against Git HEAD
`2f85a025175ca5d43901c919626a7257df02bcbd` and the already-dirty working
tree. To make that otherwise-uncommitted state identifiable, the relevant
pre-change SHA-256 prefixes were: `headless-sim.ts 82e3fc41`,
`autopilot.ts 81213924`, `racing-line.ts 1a5a4b9f`, `paths.ts 2556d480`,
`traffic.ts 161a84ca`, `session.ts a73bb1b1`, and `audit-effects.ts e8eeda21`.
Calibration seeds were `11,29,47,71,89`.

### Ideal-line and driven-lap references

Two 120 Hz driven laps completed with zero invalid laps, off-course time, or
grass time. Results were seed-independent; the seed-bearing summary checksum
changed while the physical trajectory did not.

| Track | Driven laps (s) | Max / mean path error (m) | Ideal trajectory checksum | Summary checksums for seeds 11,29,47,71,89 |
|---|---:|---:|---|---|
| Prado | 68.566666667 / 67.591666667 | 1.257576957 / 0.179870124 | `d15f2280` | `8bb42c1d`, `45af2380`, `af290f14`, `1f3c35f3`, `398c2b16` |
| Nordwald | 94.066666667 / 92.600000000 | 1.072317159 / 0.142323390 | `32373fbb` | `414c02af`, `133474a6`, `a6b6830e`, `4fde8689`, `b7fb9f68` |
| Anhembi | 84.983333333 / 84.150000000 | 1.186807824 / 0.146898411 | `2fcd81e9` | `b11528b2`, `49cd1d3f`, `d493459b`, `c5d3f3c4`, `d7119c41` |

The ideal-trajectory checksum is FNV-1a over full `{x,y,off,k,v}` arrays
rounded to `1e-9`; geometry came from `derivePathGeometry`.

### Battle economy, tow, and lane churn

The pre-change `I,K` focused audit ran 60 cases in 3.797 s. Every alongside
straight case was green with zero braking-while-alongside and rear-loss
canaries. All 15 tow cases were red.

| Track | Solo / side-by-side corner (s) | Battle loss | Minimum tow bumper clearance | Maximum tow | Path materializations / topology switches per active car-minute | Maximum target slew |
|---|---:|---:|---:|---:|---:|---:|
| Prado | 8.733333333 / 9.266666667 | 6.107% | 28.371696399 m | 0.661154172 | 12.6012 / 4.9880 | 0.121561363 m |
| Nordwald | 6.833333333 / 7.200000000 | 5.366% | 34.387293815 m | 0.666011986 | 9.8629 / 4.5785 | 0.464979596 m |
| Anhembi | 6.733333333 / 7.233333333 | 7.426% | 28.937404467 m | 0.757937882 | 11.8080 / 6.1050 | 0.470556174 m |

These references establish the intended later-phase ownership: L2 owns lane
churn, L3/L4 own the 1–3% corner economy, and L4b owns the ≤3 m tow gap.
The one-lap composition probe projected 285.0, 172.8, and 228.6 passes for
Prado, Nordwald, and Anhembi respectively; those are explicitly short-run
production-distance projections, not population evidence. Completion was
17.18%, 14.67%, and 11.90%, and mean hard contacts were 0.8, 0.4, and 0.4.

### L0 instrumentation added

`audit-effects` now exposes a dedicated L0 set with a flying-lap tucked-follow
probe and percentage-based battle economy. Runtime summaries report normalized
`battleLapLossFraction`, lane-target discontinuity metres/events,
non-maneuver discontinuities, and discontinuity metres per active car-minute.
The counters are bounded O(1) aggregates and do not affect simulation state.

The first machine-readable L0 run completed all 30 cases in 7.450 s and was
red, as expected for the pre-revamp behavior. Prado tucked loss was
0.533–0.925% (green); Nordwald was 2.837–3.165% and Anhembi 2.402–6.255%
(red). Battle loss remained 6.107%, 5.366%, and 7.426%. The new effective
lane-hop counter was zero on Prado and Nordwald; Anhembi exposed one
0.268452710 m non-maneuver authority handoff per case, about 0.090206
m/car-minute. L2 owns that finding; L3/L4 own battle economy.

Commands used for the golden references:

```sh
bun tools/audit-effects.ts --phase I,K --tracks prado,nordwald,anhembi \
  --seed-set calibration --budget-ms 120000
bun tools/audit-effects.ts --phase L0 --tracks prado,nordwald,anhembi \
  --seed-set calibration --budget-ms 120000
# runSingleCar(..., { laps: 2 }) and runHeadlessRace(..., { laps: 1 })
# for calibration seeds 11,29,47,71,89 on all three tracks
```

## Deliberate fixture recordings

None in L0. In L1, after the compatibility proof, both pivot fixtures were
deliberately recorded exactly once:

- `tests/fixtures/parity/headless-pivot.json` records the clean, pair, pit,
  priority, and classification snapshots after the lane-buffer routing and
  the new bounded audit counters;
- `tests/fixtures/parity/runtime-pivot.json` records the current browser API,
  track/profile hashes, and seeded five-second session snapshot.

The freshly recorded fixtures passed `test:headless-parity:raw` and
`test:browser:smoke:raw`; the latter checked both `index.html` and
`golden-lap.html` through direct `file://` loading.

L2 deliberately re-recorded `headless-pivot.json` once after the scalar
writers had all moved to pinned lane edits. Browser and headless snapshots
then matched within `5e-8`, and the freshly recorded clean, pair, pit,
priority, and classification fixture passed. The runtime pivot's only six
differences were the current deterministic pit-geometry hashes; those six
hashes were deliberately accepted without changing any API, line, profile,
or seeded-session field. This is recorded separately because the pit path is
outside the racecraft lateral revamp and remains its dedicated authority.

L4 changed the deterministic racecraft surface and therefore deliberately
captured parity after each supposedly final stabilization point. There were
four headless captures and three runtime captures, rather than concealing the
later corrections behind the first recording:

1. the core attack/tuck/rights conversion and removal of racecraft path
   materialization;
2. the exact unwrapped pre-launch anchor fix for production-distance attacks;
3. the priority/protected-corridor and sub-sample launch fixes found by the
   phase gate;
4. the final headless capture after retaining an expired rights hold as an
   ideal-relative bias while clamping its evaluated samples to the protected
   corridor. The runtime pivot was already exact at this point and was not
   rewritten a fourth time.

The final fixture passed browser/headless comparison at `5e-8`; the runtime
pivot matched exactly. These additional recordings are a deliberate deviation
from the expected one final L4 capture: each preceding capture was invalidated
by a subsequently discovered zero-tolerance invariant or acceptance failure.

L4b deliberately re-recorded `headless-pivot.json` once after the shared
reachability response horizon, location-priced threat, lateral escape, and
door-rule counters changed the deterministic focused-session surface. Browser
and headless output matched before the capture; the old fixture then reported
98 expected behavioral/trajectory differences. The newly recorded fixture
passed `tools/headless-parity.ts` at `5e-8`. The runtime pivot remained exact
and was not rewritten.

L5 deliberately re-recorded `headless-pivot.json` three times. The first capture
followed correction of the alongside canary to count only traffic-owned
braking, rather than ordinary braking for the next corner on a straight
approach. Browser and headless were identical after rebuilding; the old
fixture then differed only in the pair and priority `brakeWhileAlongside`
counters and their two checksums. The second capture followed the pit-only
final-to-first closure correction found by the full browser follow-up matrix.
It changed exactly nine fields, all inside the pit scenario: its checksum,
lateral/progress/speed snapshot, progress, controller demand, curvature, slew,
and minimum path speed. The freshly recorded fixture passed browser/headless
comparison and the fixture check immediately. No runtime-pivot field changed.
The later priority-corridor correction described in the L5 safety section
remained exact against both pivots, so it did not itself require another
recording. The third capture followed the behavior-neutral committed-attempt
summary schema described below. Browser and headless matched exactly before
recording, and the newly recorded fixture passed the exact parity check. The
runtime pivot remained unchanged.

### L0 phase-end verification

The exact `bun run verify:fast` command was run. Typecheck, the 55-module
bundle, boundaries, 112 unit tests, and 77 invariant tests passed. It then
stopped on the pre-existing `Profile cerro verified lap provenance drifted`
check; L3 owns the profile/provenance schema and will resolve it. The skipped
tail was run independently against the same stable L0 snapshot:

- fast statistics: exit 0, 59 green / 1 amber / 0 red / 22 inconclusive;
  the only amber was the already-observed rights minimum-separation band;
- headless parity: the checked-in pivot was already stale against the L0
  golden snapshot (200 differences, including clean Prado 68.6667 → 68.5667
  s and the newly exposed audit metrics); the deliberate one-time fixture
  recording remains assigned to L1;
- browser smoke runtime parity: the existing fixture was stale for all six
  track line/corner hashes (16 differences). L1 will capture both parity
  surfaces after proving its ideal-line output against the L0 checksums.

Per the audit contract, these named later-phase findings do not invalidate the
L0 instrumentation or authorize tuning them away here.

## L1 — Lane program under the ideal line

L1 added a bounded `LaneProgram` (`LanePoint[]`, maximum eight points) and a
per-entry fixed-capacity `LaneSampleBuffer` reused at the 30 Hz traffic tick.
`botStep` now reads the local lane span through the same offset, curvature,
distance, and speed accessors as a sampled path. No lane-buffer array is
allocated after an entry's first evaluation.

Non-empty programs use smootherstep interpolation and the plan's Frenet
curvature approximation, with the denominator clamped at `0.5`. Their local
speed profile is derived from the existing surface, grip, downforce, braking,
drag, and engine models by one backward and one forward pass. Program edits
are pinned to the car's measured current offset and reject an unpinned first
point with zero tolerance.

### L1 compatibility evidence

The required behavior-preserving gate compared the L1 output with the frozen
L0 references before proceeding:

- the Prado, Nordwald, and Anhembi two-lap times, maximum/mean path errors,
  marker errors, final states, and seed-11 summary checksums matched the L0
  table exactly;
- a direct probe across all three tracks, four progress indices, and residual
  offsets `-2`, `0`, and `1.75` compared the reconstructed legacy authority
  against the empty lane buffer: all 36 controller outputs were bit-exact by
  `Object.is`, with zero maximum input or buffer delta;
- the L1 `audit-effects` run completed 30/30 cases in 2.539 s and reproduced
  every L0 classification and metric. That includes the expected later-phase
  red findings and Anhembi's existing `0.268452710 m` non-maneuver handoff.

The compatibility audit command was:

```sh
bun tools/audit-effects.ts --phase L1 --tracks prado,nordwald,anhembi \
  --seed-set calibration --budget-ms 120000
```

The targeted edit checks passed: typecheck, module boundaries, the new lane
program tests (3 tests / 1,840 assertions), and the paths/traffic tests
(25 tests / 607,067 assertions).

The exact L1 `bun run verify:fast` phase-end command passed typecheck/bundle,
boundaries (59 TypeScript files), 115 unit tests (744,371 assertions), and 77
invariant tests (742,312 assertions). It stopped at the same pre-existing
`Profile cerro verified lap provenance drifted` finding assigned to L3. The
skipped tail was checked independently: both parity surfaces were green, and
fast statistics exited 0 with 59 green / 1 amber / 0 red / 22 inconclusive.
The amber minimum-separation observation is unchanged from L0.

### L1 staged compatibility choice

The plan says both that L1 must be bit-comparable and that the legacy
`sqrt(1 - k*lat)` correction is deleted in L1. Those statements conflict for
nonzero residual offsets. L1 keeps that exact correction only in the empty
compatibility branch so the hard bit-comparison is meaningful; non-empty lane
programs already use their real deformed geometry. The compatibility branch
is removed with the last racecraft materialized/scalar authority in L4, which
implements the physically honest requirement without weakening L1's hard
gate.

## L2 — Single lateral authority

Room, avoidance, defense cover/return, qualifying/blue-flag yield, priority,
and obstacle outputs now install bounded lane edits relative to the ideal
line. Every replacement pins its first point to the measured car position at
zero tolerance. The lane program is the sole non-pit lateral authority for
these modes; compatibility `lat`/`latTgt` fields are telemetry only. Attack,
tuck, switchback, and side-by-side rights remain on the explicitly planned
legacy path authority until L4.

Converting a compact plan's sparse absolute-road anchors directly into two
eta anchors exposed one real L2 bug: as the ideal line curved underneath the
interpolation, a nominal `2.8 m` priority-pass hold reached `5.484839479 m`
and the beneficiary lost ground. The conversion now retains semantic anchors
and uses the remaining fixed eight-point budget to bisect the longest spans.
This keeps the absolute compact shape represented without per-tick allocation
or a second lateral authority. In the Prado seed-101 probe the beneficiary
changed from `21.106 m` less progress than the yielder and `54.885 m` behind
to `28.739 m` more progress and `5.252 m` behind after eight seconds. The
priority episode remained active and incomplete; L4 owns the remaining
rights/path handoff because side-by-side rights are deliberately not converted
until that phase.

### L2 behavior and safety evidence

The three L0 single-car references remained exact after L2: both driven lap
times, path/marker errors, ideal-line checksums, final state, and seed-11
summary checksums were unchanged for Prado, Nordwald, and Anhembi. The final
L2 effect audit completed all 45 calibration cases in `11.849 s`. Across the
whole set, maximum pin error, unpinned edits, lane-hop, non-maneuver
discontinuities, protected/priority crossings, installed out-of-bounds
violations, and hard contacts were all zero. Candidate evaluation stayed at
or below four and the L2-allowed legacy maneuver materialization maximum was
one. Two Prado candidates were safely rejected as non-finite; no non-finite
state was installed.

The audit remained red on 33 later-owned behavior findings, which were
recorded rather than tuned to one seed. Mean tucked loss was `1.850%` Prado,
`3.581%` Nordwald, and `4.743%` Anhembi. Battle loss was `6.513%`, `5.366%`,
and `7.426%`. Defense seeds 11/29/47/71 were green on all tracks; seed 89
exhausted the assertion window on all three, with one Anhembi rights
violation. L3/L4 own corner economy and real alternate lines; L4b owns tucked
following and near-touch tow.

Targeted checks passed after each L2 edit: typecheck, boundaries, lane,
traffic, paths, priority, and corner-rights tests. The final focused paths and
priority run passed 36/36 tests with 607,192 assertions. The exact phase-end
`verify:fast` attempt passed build/typecheck and boundaries, then stopped in
units on nine wall-clock limits while the pinned benchmark was running. A
focused uncontended rerun cleared six; the three reproduced timing-only misses
were overlapping qualifying launches (`17.709 s` vs `15 s`), controlled
profile optimization (`29.242 s` vs `15 s`), and track-profile round-trip
(`5.446 s` vs `5 s`). No semantic assertion failed. The concurrently run
invariant suite likewise emitted timeout-only failures and no invariant
fault; targeted implicated suites were green.

### L2 performance-gate exception

The frozen pinned floor is `62.912x`. Current-tree pinned samples varied
widely with host/power state; the stable full-protocol median was `21.605x`
and a later same-workload sequence was `15.160x`, `21.527x`, `26.484x`.
Pooling diagnostics, caching immutable compact-plan sampling and body
extents, and avoiding repeated static validation did not reveal a single
remaining local sink. Profiling attributed the cost across traffic,
path-sync/feasibility, lane evaluation, rights, and the legacy materializer
that L4 is already specified to delete. The hard performance gate is
therefore not claimed green. On 2026-07-16 the user explicitly directed that,
if no obvious sink remained, optimization stop for now and implementation
proceed. L2 is marked implementation-complete with this merge-blocking
exception carried visibly to the L4 benchmark cycle.

## L3 — Corner line library

Each semantic corner now carries a committed `inside` and `outside` line.
Every line stores six forward-sorted eta control points relative to the ideal
line, its own brake index, apex speed, corner time, and full-lap time loss.
The library lives in the track-profile artifact, so the existing
track/physics/surface fingerprints invalidate ideal and alternate geometry
together. Runtime track construction validates exact corner coverage,
forward span, ideal joins, legal surface, finite metadata, and attaches the
compact records; it performs no search and materializes no racecraft path.

The offline workflow runs two deterministic constrained coordinate-pattern
passes per corner using the production path materializer and the existing
surface/grip/downforce speed profile. Inside candidates stay in the inside
two-wide corridor through their compromised exit; outside candidates use the
outside entry/apex and a cutback exit. Corridor extents and the search
resolution derive from the authored surface envelope and `PHYS.carWid`; no
runtime or behavioral calibration key was added. As with the ideal-profile
optimizer, analytical winners are production-controller finalists. A failed
winner backs off toward its deterministic safe incumbent until the remaining
lateral interval is below `PHYS.carWid / 16`.

Generation covered 79 corners / 158 lines with 9,779 analytical evaluations
and 163 controller finalist runs. Exactly one winner—Prado C06 inside—was
finite, on-road, and within the marker bound but invalidated checkpoint order;
the deterministic backoff selected a valid line. No other finalist required
backoff. The generated library is stable JSON and the one-track optimizer now
regenerates (or, only for the explicit short-budget fixture, seeds) its corner
library whenever ideal anchors change, preventing stale alternates from being
carried across an ideal-profile edit.

### L3 validation evidence

The new corner-line unit suite passed 2/2 tests and 1,095,447 assertions over
all tracks: exact coverage/attachment, at least one-car-width apex distinction,
finite legal materialization, stored timing reproduction, and corrupt-library
rejection. The profile/optimizer/audit-toolkit touched tests also passed. The
extended `validate:profiles` gate passed in `21.65 s`: all six profiles matched
their runtime provenance; all 158 alternate lines completed a valid production
controller lap with zero off-course/grass exposure; the maximum alternate
marker error was `1.571281713 m`, below the existing `2.2 m` absolute policy.
The maximum alternate lap ratio was below the existing `1.03` absolute policy.

The deliberately refreshed verified-lap provenance is:

| Track | Previous profile value (s) | L3 verified value (s) |
|---|---:|---:|
| Prado | 67.595833334 | 67.587500000 |
| Costa | 75.958333333 | 75.966666667 |
| Nordwald | 92.608333333 | 92.608333334 |
| Villa | 75.691666667 | 75.700000000 |
| Anhembi | 84.150000000 | 84.154166667 |
| Cerro | 83.279166667 | 83.295833334 |

This resolves the L0/L1 Cerro provenance failure and records all six values
from the same deterministic generation pass rather than changing Cerro alone.

The L3 `audit-effects` probe completed 15/15 flagship cases in `3.369 s`,
with no red failures or deadlines and an overall amber physical finding:

| Track | Lines | Physical loss range / mean (s) | Typical 0.2–0.8 s | Faster than committed ideal | Minimum apex separation | Maximum lap ratio |
|---|---:|---:|---:|---:|---:|---:|
| Prado | 24 | −0.281191266…1.202150220 / 0.323355 | 13/24 | 4 | 2.2484375 m | 1.02125084 |
| Nordwald | 40 | −0.703417108…2.158053137 / 0.382924 | 16/40 | 10 | 2.0000000 m | 1.02695696 |
| Anhembi | 26 | −0.282155047…1.955018873 / 0.333006 | 12/26 | 7 | 2.0000000 m | 1.02765589 |

Cached-versus-recomputed timing drift stayed below `5e-10`. The headless
pivot remained green without re-recording because L3 does not consume the
lines yet. The runtime pivot deliberately recorded exactly six changed
corner hashes—the new nested libraries—and no API, pit, profile timing, or
seeded-session difference.

The exact L3 `verify:fast` attempt passed build/typecheck, boundaries, and
all 131 unit tests (1,839,143 assertions). The invariant rung then passed
76/77 tests and stopped only because the track-profile round-trip took
`5.449 s` against its `5.000 s` wall-clock limit; no assertion or invariant
failed, and later rungs were not reached by the short-circuit. The implicated
file was immediately rerun in isolation: 4/4 tests and 30,290 assertions
passed, with the round-trip completing in `4.646 s`. This is recorded as a
host-timing exception rather than a semantic green full ladder.

### L3 physically honest plan interpretation

The plan says real alternate lines cost their true time, “typically
0.2–0.8 s.” The constrained production model shows both outliers above that
range and lines faster than the currently committed clean profile. Adding an
artificial minimum loss would contradict the same sentence's true-time
requirement and the constants policy. L3 therefore keeps the measured timing
and reports the distribution amber. L4 will consume those actual line speeds;
L5 population evidence, not a single seed or a synthetic penalty, determines
whether the clean ideal profiles later need a separate optimizer pass.

## L4 — Maneuvers as lane programs

Attack, tuck, switchback, defense, corner-rights, priority, obstacle, and
rejoin outputs now share the fixed lane-program authority. Attack plans retain
the leader's exact unwrapped eta samples until a launch point computed backward
from the selected alternate line's own brake marker and the shared physical
lateral-move law. Switchbacks use the cached outside line and count completion
only after full bumper clearance between track-out and the following braking
zone. Corner-rights points are projected into their arbitrated corridor. Pit
alone still materializes its dedicated sampled path; the racecraft
materialization counter is now identically zero.

The phase gate exposed three hard correctness defects that the focused happy
paths had not shown. Straight priority pull-offs could cross after the ideal
line bent toward the yielding car; the pull-off now derives its side opposite
the actual next-corner turn-in and uses the shared physical move distance.
An exact attack anchor could be lost when it fell between 2 m samples or just
beyond the local ring; pre-launch points now keep exact unwrapped progress and
the first segment-closing anchor beyond the ring. Finally, a finite rights
program could expire while its semantic corridor remained live. The held eta
remains ideal-relative—the physically honest continuation and the one that
preserves real-line economy—while every evaluated sample is still clamped to
the absolute protected corridor. Re-authoring the terminal point as a fixed
absolute lane was rejected because it created a false 4–16% battle penalty;
the final approach has zero corridor crossings and keeps the original 1–3%
economy result.

### L4 behavior and safety evidence

The final calibration audit ran 60 cases over seeds `11,29,47,71,89` on the
three flagship tracks: 35 green and 25 red behavioral findings owned by L4b
or L5. All 15 attack-launch cases were green, with zero commanded or executed
early departures. All 15 side-by-side cases were green:

| Track | Solo corner (s) | Pair corner (s) | Battle loss |
|---|---:|---:|---:|
| Prado | 8.966666667 | 9.833333333 | 1.5320% |
| Nordwald | 7.100000000 | 8.333333333 | 1.5406% |
| Anhembi | 6.966666667 | 8.566666667 | 2.2634% |

Anhembi selected and completed the real-line switchback in 5/5 cases;
Nordwald selected it in 5/5 but did not gain full bumper clearance before the
next brake zone; Prado did not select it. Those track-dependent vocabulary
findings remain visible for L5 rather than being forced with a single-seed
policy. The 15 tucked-follow cases remained red with mean loss `3.7176%`,
`1.3283%`, and `1.6621%` respectively; continuous tuck authority was never
lost, and L4b owns the reachability threat that creates the excess loss.

Across the full L4 audit, maximum lane pin error, unpinned edits, lane-hop,
non-maneuver discontinuities, protected-corridor crossings, priority path
crossings, rights violations, out-of-bounds installs, early departures,
unexplained stalls, pit deadlocks, contacts, and hard contacts were all zero.
Maximum candidate evaluation was three and racecraft path materializations
were zero. The invariant suite passed 81/81 tests and 197,703 assertions; all
158 cached alternate profiles remained valid.

Fast population statistics finished with 58 green / 3 amber / 0 red / 21
inconclusive results. The amber observations were rights minimum separation
(`2.1519 m`) and Prado side-by-side medians (`1.7000 s` dry, `1.5667 s` wet).
The one-race production-distance projections were `307.8` dry and `182.4`
wet passes, both above 100; hard contacts were `0` and `1`, and DNFs were zero.
These are fast-tier projections, not substitutes for L5's full population
lock.

### L4 performance-gate exception

The frozen pinned floor remains `62.912x`. The required protocol produced
`14.8519x`, `21.2607x`, `26.3257x`, and `40.8878x`; a supplemental seven-run
median reached `47.656852x`, or `75.7516%` of the floor. No invariant failed,
and removing racecraft materialization plus a one-pass lane evaluator did not
materially change the full-race ceiling. No isolated hot loop justified
another speculative rewrite. Per the user's explicit instruction, performance
work stopped and this result remains red rather than being relabeled or tuned
around the host.

## L4b — Tow-tuck threat and door rule

The shared follow law now prices the leader's plausible longitudinal threat by
track location: production drag plus rolling resistance on open straights,
ramping to the existing full-braking capability through corner approach. A
free adjacent corridor adds the physically derived swerve-escape cap, including
driver response and one-car-width move time; no free lane leaves the original
brake-behind cap in sole authority. The corridor result is cached at the
existing 5 Hz topology cadence. Defense uses that same reachability law and
rejects both an occupied door (less than one physical car length of bumper
clearance) and a door the attacker cannot safely answer before the move ends.
Rejected attempts hold the current line.

The phase also corrected lifecycle details exposed by the focused probes.
Tucks retain native unwrapped leader eta and revision provenance, do not invent
a lane edit when both cars already share a lane, and keep a completed program's
terminal bias instead of repinning at each finite buffer horizon. A designated
tow leader wholly ahead is longitudinal occupancy, not a false lateral blocker.
The discrete response horizon includes the already-derived `TRAF_DT` scheduling
latency in addition to physical driver reaction; this removed a one-step
high-speed overlap without adding a comfort gap or distance constant.

### L4b behavior and safety evidence

The final calibration audit ran 75 cases over seeds `11,29,47,71,89` on Prado,
Nordwald, and Anhembi: 72 green, 3 amber, 0 red, and no failures. All 15
tucked-follow cases completed a controlled flying lap with continuous tuck,
positive minimum clearance, and no tuck lane edits:

| Track | Tucked lap-time loss |
|---|---:|
| Prado | 0.389% |
| Nordwald | 0.277% |
| Anhembi | 0.235% |

All 15 near-touch cases reached the plan's at-most-3 m straight-line bumper
gap with a free adjacent lane and reopened across the physical braking-zone
window. All 30 occupied-door and closing/reachability canaries converted the
attempt to a line hold; executed door slams and `defenseDoorViolations` were
zero. Maximum lane pin error, unpinned edits, lane-hop, non-maneuver
discontinuities, racecraft materializations, protected-corridor crossings,
out-of-bounds installs, early departures, unexplained stalls, pit deadlocks,
contacts, and hard contacts were zero in this focused phase set.

The three amber cases were the seed-89 anticipatory-defense regression on each
flagship track: the discretionary move did not complete inside the assertion
window. This is the same later-outcome finding visible before the L4b safety
work, not a door-rule violation; the other 12 anticipatory cases completed.
No calibration key was retuned, and no parameter was fit to this or any other
single seed.

The audit runner itself was corrected to use the production 120 Hz physics
cadence. Its former 30 Hz shortcut drove inputs at 15 Hz and manufactured
reachability overshoot absent from the shared browser/headless runtime.
Tucked economy suppresses random lap-boundary flow rolls in the constructed
comparison so it measures traffic/lateral cost, and near-touch reopening is
measured over `brakeI` through `turnInI`, not at one sample.

The exact `bun run verify:fast` phase gate exited zero: typecheck, both bundles,
module boundaries, 151 unit tests, invariants, all six track profiles, headless
parity, direct-file browser smoke, and fast statistics passed. Fast statistics
reported 58 green / 3 amber / 0 red / 21 inconclusive; the production-distance
pass projections were 364.8 in both dry and wet Prado races, hard contacts were
zero, and DNFs were zero. The initially failing priority unit case was a stale
test selector that treated the next brake target as active-corner authority;
the fixture now selects the same approach-to-track-out window used by priority,
with no production change.

## L5 — Population lock and maneuver vocabulary

The final audit surface adds constructed inside-pass, outside-pass,
switchback, over-under, and drag-pass scenarios. The corner cases select from
the cached physical line library by pass-score metadata; the drag case starts
at physical bumper clearance on the longest derived straight and obtains its
overspeed from the production tow/drag model. No scenario injects a lateral
path, pass completion, or synthetic time loss. The focused calibration and
validation populations produced the same classification: 39 green / 36 amber
/ 0 red over 75 cases for each five-seed set. Calibration used
`11,29,47,71,89`; the independent validation review used
`101,211,307,401,503`. Release seeds were not used.

The all-seed flagship hosts were:

| Vocabulary | Physical host(s) | Result over five seeds |
|---|---|---:|
| Inside pass | Nordwald `nordwald-c09` (pass score `1,958,812.055`); Anhembi `anhembi-c01` (`4,383,644.488`) | 10/15 green |
| Outside pass | Nordwald `nordwald-c09` | 5/15 green |
| Switchback | Nordwald `nordwald-c09` | 5/15 green |
| Over-under | Nordwald `nordwald-c09`; Anhembi `anhembi-c12` (`3,565,244.075`) | 10/15 green |
| Drag pass | Prado `prado-c08` (`3,896,558.655`) | 9/15 green; Anhembi also completed 4/5 |

The remaining combinations are amber track-dependent vocabulary findings, not
safety failures. They remain visible instead of forcing every maneuver onto a
corner whose physical line, following straight, or braking window cannot
complete it. No calibration value was changed for L5.

The final calibration replay of every effects phase ran 510 cases: 378 green,
132 amber, and zero red cases. Its overall status remains red solely because
the inherited Phase-H equal-wear aggregate reported faster-behind pass rates
of 40% on Prado, 20% on Nordwald, and 0% on Anhembi against its 80% target.
Fresh-versus-worn completed 15/15. Equal-wear conversion belongs to the intent
layer retained by this revamp, so the lateral output was not distorted to hide
that finding.

### L5 acceptance evidence against L0

| Quantity | L0 golden reference | Final trajectory result |
|---|---:|---:|
| Tucked lap loss, Prado / Nordwald / Anhembi | 0.53–0.93% / 2.84–3.17% / 2.40–6.26% | 0.389% / 0.277% / 0.235% |
| Battle loss, Prado / Nordwald / Anhembi | 6.107% / 5.366% / 7.426% | 0.457% amber-low / 1.020% / 1.462% |
| Minimum tow bumper clearance | 28.372 / 34.387 / 28.937 m | 1.201 / 3.000 / 0.057–0.764 m, reopening in every braking window |
| Racecraft materializations | 9.86–12.60 per active car-minute | 0 |
| Lane-hop outside maneuvers | one 0.268 m Anhembi handoff; other flagships 0 | 0 on every case |

Across all 510 cases, maximum lane pin error, unpinned edits, lane-hop,
non-maneuver discontinuities, protected-corridor crossings, attack
pre-launch departures, executed door slams, and racecraft materializations
were zero. At most four maneuver candidates were evaluated. Maximum contacts
in one focused case were 26 and all were light; maximum hard contacts were
zero. The final battle replay is intentionally not padded to make Prado pay a
minimum one-percent penalty: the line library's measured physical time takes
precedence over a synthetic lower-bound cost, while Nordwald and Anhembi sit
inside the requested 1–3% band.

### L5 integration canaries and motion review

The browser follow-up matrix is green for all line, lane-mode, rights, pit,
priority, and runtime checks. It covered six line libraries, six lane-mode
sets, 16 rights combinations plus 12 driven rights cases, 180 foreign-box pit
trials, six double stacks, six pit merges, 24 priority matrix cases, and 12
driven priority lifecycles. There were zero browser errors, illegal priority
decisions, priority path crossings, hard contacts, or failed releases/rejoins.

Three constructed qualifying catches were recorded as distribution outliers:
Prado straight `4.117 s`, wet Costa approach `5.700 s`, and wet Villa straight
`4.342 s`. The wet Costa approach also waited `12.000 s` for its first safe
passing opportunity and released at `12.550 s`; this remains an explicit
distribution warning, not a crossing or failed lifecycle. The harness reads
the loss reference values from
`metric-policy.json` and leaves the registered `test:stats:full` p95 metrics
as the population owner instead of turning one deterministic geometry into a
safety failure. Two Nordwald corner cases released through the already-defined
`inactive` lifecycle after `1.342 s`; both rejoined with no crossing, illegal
decision, off-course flag, or hard contact. The audit emits both findings as
bounded warnings.

Migrating the old path-era browser assertions to lane-program diagnostics
exposed one real pit compatibility defect: the compact pit authority ended at
its final anchor without the former behind-car closure, so a queued car could
stop before completing its lateral transition. The pit-only materializer now
adds the final-to-first closure interval. Pit remains the sole dedicated
sampled-path system; racecraft materializations stay zero. All 180 foreign-box
trials had zero delay/failures, all double stacks retained at least
`3.428 m` queue clearance and serviced/rejoined both cars, and all merges
waited and rejoined without contact. The three-wide browser canary now obtains
its exact `2.5 m` separation from the shared physical definition, and the
Cerro rejoin lifecycle accepts the physically reachable braking topology;
the separate obstacle-runoff case still owns lateral bypass.

The explicit motion matrix captured six clean-line tracks, 55 scenario stills,
and 60 three-frame sequences at slow motion and 1x, with no capture or browser
failure. Twenty reproducible contact sheets were built under
`output/playwright/l5-trajectory-motion`. Review of clean-line, attack,
defense, side-by-side, and rejoin sheets at both cadences showed one smooth
transition with no visible lane hop, path snap, or road departure.

### L5 normal-tier safety correction

The first full normal-tier run passed its deterministic, browser, follow-up,
UI, and production-smoke rungs, then exposed one real zero-tolerance fault in
the focused population: wet Costa qualifying priority, corner phase, seed
`1352` recorded two negotiated-order path crossings. The yielding car's
12-station free-interval route had been installed into the lane program's
seven available future points by retaining only the first seven. That dropped
the terminal station and made the completed program hold the corner-apex eta
after the ideal line bent back across the passing lane.

Persistent priority corridors now losslessly collapse only consecutive
equal-offset hold stations. A persistent route that still cannot fit is not
installed as a truncated route. Priority authority is also refreshed before
its terminal point is consumed; the runway is derived from `PHYS.carLen`, car
speed, and the existing 5 Hz corridor-search interval. A committed beneficiary
plan is rebuilt on the same refresh boundary, so both sides retain the
negotiated order until physical clearance. No calibration value or new policy
constant was added, and transient attack/obstacle topology search was left
unchanged.

Regression coverage includes the original Costa case and the independent wet
Nordwald high-closing-speed case (`2361`) found by the validation matrix. Both
complete and release with zero priority/protected-corridor crossings, at most
two candidates, zero racecraft materializations, and no hard contact. The
complete validation priority matrix then ran 120 cases across all six tracks,
dry/wet and straight/corner: zero crossing rows; maximum measured qualifying
loss was `3.556060387 s` and maximum obstruction was `3.566666667 s`. Those
distribution values remain behavioral observations; the crossing result is
the hard gate. The final invariant rerun passed 88 tests / 218,072 assertions,
and browser/headless parity stayed exact without another fixture recording.

The first post-correction L5 `verify:fast` gate exited zero: both bundles,
72-file module boundaries, 154 unit tests / 1,316,156 assertions, the same 88
invariants, all six profiles, headless parity, direct-file browser smoke, and
fast statistics passed. The statistical summary remained 58 green / 3 amber /
0 red / 21 inconclusive, with dry and wet Prado production-distance pass
projections of `364.8`, zero hard contacts, and zero DNFs.

### L5 attributed pass completion

The first normal population measured every attack-intent selection as a pass
attempt. That was no longer the manifest's promised committed-maneuver
exposure after L4 introduced brake-derived late launches: a selected attack
can remain tucked on the leader line until its launch point, then expire or be
vetoed without ever producing lateral attack authority. Raw intent selection
is still retained in `attackInitiations` and the per-corner registry. The
policy denominator now increments once when feasible attack authority reaches
its computed launch point, or when physical overlap/corner rights proves that
the battle launched. A completion is attributed only to one of those committed
episodes. This changes audit attribution, not intent, feasibility, trajectory,
or race behavior.

Across all six tracks, dry and wet, and five seeds per stratum, calibration
recorded `350 / 1,378 = 25.399%` attributed completions from `1,811` raw intent
selections. Independent validation recorded `345 / 1,359 = 25.386%` from
`1,774` raw selections. Both aggregate point estimates are inside the normal
band. Wilson classification remains deliberately visible at the stratum
level: calibration had 5 green / 7 amber strata and validation 4 green / 8
amber. Wet Costa validation was the only point estimate below 20%, at 19.40%;
it is recorded rather than tuned against its five held-out seeds. Both
populations had zero protected/priority crossings, door violations,
unpinned edits, racecraft materializations, and hard safety faults.

No calibration change was retained. A bounded sensitivity check of closing
speed and attack commitment produced mixed track results, and two candidate
launch-geometry changes improved selected calibration strata but regressed
held-out behavior; all were reverted. The final implementation changes only
the exposure definition and deterministic bounded counters. The resulting
summary-schema change was the third deliberate L5 headless parity recording;
browser and headless matched exactly before and after capture.

The final L5 `verify:fast` rerun exited zero after that attribution change:
both bundles, 72-file boundaries, 154 unit tests / 1,316,159 assertions, 88
invariant tests / 218,075 assertions, all six profiles, exact headless parity,
direct-file browser smoke, and fast statistics passed. Fast statistics again
reported 58 green / 3 amber / 0 red / 21 inconclusive, with `364.8` projected
passes in both Prado strata, zero hard contacts, and zero DNFs.

### L5 final merge gate

The sole final `bun run verify` command exited zero. It repeated typecheck,
both bundles, 72-file boundaries, all 154 unit tests and 88 invariant tests,
profile validation, and exact headless parity; the full browser suite,
follow-up matrix, 55 trajectory UI canaries, production build, and production
direct-file smoke were green.

The normal population covered 60 races, `2,440.264 car-km`, 348 focused
scenarios, and 48 boundary cases. It reported 276 green / 21 amber / 0 red /
85 inconclusive. Every one of the 14 zero-tolerance invariant rows was zero
over its complete exposure. Production-distance pass point estimates ranged
from `208` to `387.6` per race, and even the lowest empirical interval bound
was `128`, above the required 100. Attributed completion was
`345 / 1,359 = 25.386%`: four strata were statistically green and eight were
amber but inside the acceptable boundary. The maximum observed hard-contact
count was two in one race (20 total over 60 races), against the absolute cap
of 30 per race; light contact remained uncapped. Nine DNFs were observed over
the 60 races, with no red policy result.

The suite's overall `inconclusive` label reflects the normal tier's five races
per track/weather stratum versus the policy's larger minimum samples for 85
distribution rows; it is not a hidden failure. There were no red rows and no
hard-invariant exceptions.

## Plan deviations and conflict resolutions

None in L0. L1's bit-parity versus speed-hack conflict is resolved in the L1
section. L2 proceeds to L3 with the explicitly user-authorized performance
and host-timing exceptions above; neither result is relabeled green. L3
chooses measured physical timing over fabricating the plan's typical line
loss, and records the resulting amber distribution above. L4 made more than
one deliberate parity capture because later phase-gate discoveries invalidated
earlier snapshots; every capture is listed above. L4 also keeps an expired
rights hold ideal-relative while clamping evaluated samples, resolving the
conflict between a persistent absolute corridor and physically honest
post-corner geometry without weakening either the installed-path or crossing
invariant. L4b changes the focused audit cadence from a 30 Hz shortcut to the
contractual 120 Hz production cadence because preserving the shortcut would
contradict the shared-runtime requirement and produce physically false
reachability failures. Its controlled-flow tucked comparison and braking-zone
reopening window likewise isolate the acceptance quantities without changing
production behavior. L5 resolves the manifest's committed-maneuver exposure
against the retained intent counter by attributing attempts only after the
lane authority launches or physical protection is acquired; raw intent
selections remain available separately. This is a measurement correction,
not an intent or feasibility change, and its held-out amber strata are
recorded rather than tuned away.
