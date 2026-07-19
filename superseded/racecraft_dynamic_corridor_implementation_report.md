# Golden Lap — Dynamic Corridor Implementation Report

Status: behavior implemented and statistically validated; release gates not all
passed

Authoritative plan: `racecraft_dynamic_corridor_plan.md`

Implementation date: 2026-07-15

## Outcome

Phases 0–7 and the behavioral parts of phase 8 are implemented. The two
confirmed liveness defects are fixed, authored curbs are one shared legal
surface, local traffic planning is bounded and explainable, stopped/overslow
obstacles have a staged normal/emergency/brake solution, and competitive paths
are projected into actual free intervals without replacing the proven semantic
state machines.

The locked release simulation passed with zero red and zero inconclusive
results over 216 races, 1,272 focused scenarios, 192 boundary cases, and
8,780.412 car-km. It classified 151 metrics green and 15 amber, with every
amber inside its registered acceptable population band. A genuine Firefox 146
run passed the functional racecraft acceptance matrix, including all 12
physical protected-path trials, and produced moving all-track evidence for
every required scenario category. The cold new-track fixture still satisfies
the 600/900/1200-second contracts with a verified acceptable incumbent.

Long-running statistics, race workers, browser checks, visual capture,
optimization, and benchmarks now emit phase/case events while running. Hard
invariants fail immediately; population outliers remain visible without
censoring the run; and a required median benchmark aborts once recovery is
mathematically impossible.

Final release is not claimed. The exact-source, one-CPU reference benchmark
failed fast after four of seven race samples fell below the unchanged 62.912x
floor, so no passing current median or current scaling report exists. Pinned
Chromium exits before page creation because its sandbox-host shutdown syscall is
denied (`Operation not permitted`) in the managed process sandbox. Firefox
functional behavior passes, but its exact Chromium-derived parity fixture has
21 numeric geometry/hash differences. Finally, the historical same-machine
pre-change browser p95 and retained real-time target do not exist in the
workspace. The release writer therefore rejects the explicitly incomplete
benchmark artifact and no successor release manifest or Chromium visual review
is claimed.

## Preservation and reference environment

- Git HEAD: `2f85a025175ca5d43901c919626a7257df02bcbd`
- Branch: `main`
- Existing dirty worktree: preserved; unrelated changes were not reset
- Commit/push: not performed
- OS: Linux 5.15.167.4 WSL2, x86_64
- CPU: 12th Gen Intel Core i5-1235U
- Bun: 1.3.14
- Node.js: 22.22.1
- TypeScript: 5.9.3

## Phase audit

| Phase | Status | Primary evidence |
|---|---|---|
| 0 — Successor baseline and reproductions | Complete | Pit seed 1 at about 444.708 s and Prado seed 1 at about 44.808 s identified explicit stale reservation/rights cap owners; baseline race throughput 78.64x. |
| 1 — Pit liveness | Complete | Boundary, adjacent-order, sequential, same-team, foreign-box, through-lane, merge, stale-owner, every-team/every-track tests pass. |
| 2 — Corner-rights liveness | Complete | Far holder cannot command zero, real overlap still stops safely, natural track-out releases, and unexplained-stall invariant is active. |
| 3 — Shared surfaces and legal curbs | Complete | Render, physics, planning, profiles, and validation use one authored surface map; curb `mu = 0.94`, drag `2.5`. |
| 4 — Bounded corridor core | Complete | Compact station sampler, free intervals, deterministic topology selection, at most 5 observed candidates and 1 materialized path. |
| 5 — Obstacle/runoff avoidance | Complete | Both-side, forced-side, curb, justified runoff, one-grant, no-route brake, and rejoin cases pass. |
| 6 — Competitive integration | Complete with planned simplification | Proven attack/defence/rights/priority anchors are projected into free intervals; dynamic obstacle planning remains fully staged. |
| 7 — Surface-aware profiles | Complete | Six fresh dry/wet profiles and cold 600/900/1200-second fixture validate. |
| 8 — Population, visual, release audit | Partially complete; release blocked | Unit/invariant/profile/release-statistics pass, streaming/fail-fast audit events are active, and Firefox functional/visual evidence exists. Headless throughput, default Chromium, browser baseline/target, exact compatibility, and final-manifest gates remain open. |

## Architecture delivered

### Liveness and authority ownership

`src/session/pit.ts` now advances pit-out state from geometry, not from a
self-latching phase predicate. A box crossing reservation is renewable only
while its owner is committed to or physically occupies that crossing. Rear
clearance releases it, and travel/merge states cannot reacquire it. Qualifying
launches retain their assigned box coordinate and wait there when release is
unsafe. Pit wait reason, owner, age, progress, and deadlock diagnostics remain
inspectable; no teleport was introduced.

`src/session/racecraft/corner-rights.ts` separates lateral rights from speed
authority. Rights remain through physical track-out, while convergence caps
require projected longitudinal interaction. Exact zero is limited to immediate
occupied-envelope conflict. A distant holder therefore cannot prevent the
trailer reaching the release marker. Failure/obstacle transitions have explicit
release causes.

A protected path now distinguishes strict corridor ownership from acquisition.
If a car is already outside its newly assigned corridor, `corridorEntryIndex`
permits one bounded, monotonic transition from the current steering target to
the first future strict anchor; every later sample is clamped to the intersection
of the authored legal surface and the protected corridor. Pair and three-wide
targets stay inside the durable road envelope. Authored curbs can enlarge an
optional outer corridor, but a target can never depend on a curb continuing at
the next sample. This removes the held-out Villa curb-only target failure without
forbidding curb use.

`src/session/racecraft/liveness.ts` records a hard unexplained-stall failure only
after the grace period and excludes legitimate grid, pit, blockage, failure,
recovery, off-course, finish, and safe-braking causes. It never moves the car.

### One authored surface authority

`src/core/surface.ts` owns per-sample/per-side road, authored-curb, legal-normal,
and emergency bounds plus deterministic footprint exposure. `src/core/track.ts`
builds the same identity-bearing curb data consumed by rendering. Production
physics, compact feasibility, racing-line speed calculation, profile
optimization, and validation all use effective road/curb/grass exposure from
that authority.

Curbs are legal to ideal, attack, defence, rights, priority, and obstacle paths.
An uncurbed edge still ends at the road. Fractional footprint blending removes
the old discontinuous full-car curb classification. Normal grass exposure is a
hard rejection; emergency exposure requires a recorded finite authorization.
Surface geometry and coefficients participate in profile provenance, so stale
road-only profiles fail freshness checks.

### Bounded local corridor planning

`src/session/racecraft/corridor-planner.ts`, `feasibility.ts`, `preference.ts`,
and `paths.ts` implement a local deterministic planner around the existing
`PathPlan`/`SampledPath` representation:

- 12 compact prediction stations over the registered 2.4-second horizon;
- legal intervals intersected with rights/priority constraints;
- predicted nearby committed occupancy subtracted from those intervals;
- hold/left/right/brake topology with stable ordering and side commitment;
- hard constraint rejection before lexicographic progress/surface/continuity/
  controller ranking;
- no search for clean-air cars;
- 30 Hz safety validation and a measured 5 Hz full-search cadence;
- at most six evaluated candidates by invariant (five observed at worst);
- compact evaluation for every candidate and full materialization only for the
  winner.

Every decision exposes candidate ids, topology, surface authority, rejection
reasons, predicted separation, exposure, controller demand, cap owner/reason,
selection reason, planner time, and materialization count. Session aggregates
and bounded histories are described in `RACECRAFT_DIAGNOSTICS.md`.

### Obstacles and emergency surface use

`src/session/racecraft/obstacles.ts` classifies failure, recovery, stationary,
closing-demand, and persistently overslow episodes. A noisy slow sample does not
itself authorize grass. Declaration stores emergency eligibility; it does not
grant authority.

`syncRacecraftPaths` first evaluates every feasible road/curb progress route. It
evaluates the bounded runoff routes only when all normal progress routes fail,
and it always retains braking. Emergency authority is granted only if an
emergency candidate actually wins, is recorded as `collision-avoidance` or
`obstruction-bypass`, and can be granted only once per finite episode. It ends
after legal re-entry and clearance. Passing side, minimum separation, and rejoin
reason remain recorded.

This ordering corrected an early implementation that counted eligibility as an
authorization. Before correction, otherwise avoidable episodes produced about
2–8 grants per race. In the locked release population the rates fell to 0–1.8
per race by stratum, with no red result.

### Competitive and priority paths

Attack, defence, side-by-side rights, blue flags, and qualifying priority keep
their semantic ownership, but their intended anchors are clipped/projected into
the currently free legal intervals. The resulting paths can use authored curbs,
cannot cross protected or time-coincident priority corridors, and retain one
side through commitment. Protected-path installation reports the exact sample,
lateral target, and legal interval on any authorization failure. Defence remains
one response per attack sequence.

Priority speed loss is based on speed at acquisition rather than repeatedly
ratcheting at 30 Hz. A priority episode cannot swap the assigned pair sides, and
post-release rejoin time is measured separately from the preference episode.
Blue-flag traffic yields to a car one lap ahead; qualifying in/out laps give
preference to an eligible flying lap while retaining pit-entry authority.

## Deterministic evidence

The final standalone suites passed:

| Command | Result |
|---|---|
| `bun run typecheck` | Pass |
| `bun run check:boundaries` | Pass; 57 TypeScript modules, acyclic imports, browser separation |
| `bun run test:unit:raw` | Pass; 89 tests, 742,404 assertions |
| `bun run test:invariants` | Pass; 66 tests, 742,264 assertions |
| `bun run build` | Pass; 54 browser modules, 483,814-byte development IIFE; SHA-256 `8a753922915b9999729b7365922300f9863e745e921458b4ccac8aeeb423526f` |
| `GOLDENLAP_BROWSER=firefox bun run test:prod` | Production build/artifact pass; 239,473-byte minified IIFE; Firefox exact parity then reports 21 cross-engine differences |
| `bun run validate:profiles` | Pass; all six profiles fresh and stable dry/wet |

The exhaustive 16-case rights acquisition test received a local 15-second
correctness timeout after one host-loaded run exceeded Bun's generic five-second
default. It completed the rerun in 4.084 seconds. No production deadline or
performance threshold changed; performance remains governed by the separate
frozen-baseline benchmark.

The unit/invariant matrix includes:

- egress before/at/after clearance, both adjacent entry orders, all team/track
  sequential releases, real crossing waits, same-team stacking, and stale
  cleanup;
- projected rights overlap, far-leader positive progress, linked complexes,
  three-wide/tuck, wet, natural release, and explained/unexplained stops;
- exact render/surface identity, authored versus uncurbed bounds, continuous
  footprint grip, and surface-aware speed profile;
- compact/materialized sampling equivalence, hard rejections, commitment,
  nearly equal topology stability, dry/wet finite evaluation, and bounds;
- obstacle both-sides, forced side, authored curb, selected justified runoff,
  one grant per episode, mandatory brake, and progressive rejoin;
- persistent blue/qualifying priority, canonical flying/in/out phases,
  pit-entry precedence, corner interaction, stable sides, release, and rejoin.

The locked release report contains zero occurrences for non-finite state,
invalid classification, installed out-of-bounds path, stale profile,
candidate/materialization limit, unexplained stall, pit deadlock, false pit
leader, protected crossing, illegal priority decision, priority path crossing,
repeated defence, and soft-contact concede invariants.

## Surface-aware profile evidence

| Track | Dry lap (s) | Wet lap (s) | Curb exposure | Grass exposure |
|---|---:|---:|---:|---:|
| Prado | 67.595833 | 75.016667 | 3.179684 | 0 |
| Costa | 75.958333 | 84.966667 | 0 | 0 |
| Nordwald | 92.608333 | 104.658333 | 4.228507 | 0 |
| Villa | 75.691667 | 82.875000 | 0 | 0 |
| Anhembi | 84.150000 | 94.100000 | 3.813905 | 0 |
| Cerro | 83.279167 | 92.091667 | 7.962180 | 0 |

The non-production cold fixture used an in-memory per-process cache with
`warm: false`, returned the same verified acceptable incumbent, never reached a
deadline, and had zero overrun:

| Declared budget | Evaluations | Actual optimizer wall time | Result |
|---:|---:|---:|---|
| 600 s | 509 | 3.763 s | Acceptable |
| 900 s | 509 | 4.708 s | Acceptable |
| 1,200 s | 509 | 4.991 s | Acceptable |

`bun run validate:new-track-fixture` independently verified a 69.795833 s lap,
stable dry laps of 70.825/69.791667/69.8 s, a 77.883333 s wet lap, safe stale
fallback, and release rejection of stale provenance.

## Statistical evidence

| Tier | Races | Focused | Boundary | Car-km | Green | Amber | Red | Inconclusive |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Normal | 60 | 348 | 48 | 2,440.481 | 39 | 18 | 0 | 109 |
| Release | 216 | 1,272 | 192 | 8,780.412 | 151 | 15 | 0 | 0 |

Normal is intentionally provisional at its smaller sample count; its 109
inconclusive classifications are undersampling labels, not failures or release
evidence. It completed in 174.090 s with no red result. The non-provisional
release run used six workers, completed in 325.634 s, and produced:

- report fingerprint `fnv1a32:ee020973`;
- policy fingerprint `fnv1a32:f9aceae4`;
- scenario fingerprint `fnv1a32:8015e8f6`.

The 15 release ambers are explicitly inside acceptable boundaries: overall
rights minimum separation, qualifying corner yield loss, eight per-stratum
pass-success intervals, two side-by-side median durations, Costa-wet pass
count, Cerro-wet grass exposure, and Villa-wet emergency authorization rate.
No amber represents an impossible state. Release seeds were not used to choose
those bands.

### Contact policy

Race contact count is deliberately a population metric, not a disguised hard
invariant. The registered and streamed bands are:

- `0–12`: normal;
- `13–20`: acceptable;
- above `20`: immediate `outside-acceptable` outlier warning;
- aggregate population-rate absolute maximum: `30`.

An individual outlier above 20 remains in the population so the audit is not
censored. It does not abort a run by count alone. Non-finite state, illegal
protected-corridor crossing, stale liveness ownership, impossible path bounds,
or another physically impossible cause is still a separate immediate red. In
the conclusive release population, all 12 track/weather contact-rate strata
were green; means ranged from 2.778 to 10.389 contacts per race.

## Performance and complexity evidence

Current artifact: `output/benchmarks/dynamic-corridor-final.json`

- Frozen pre-change full-race throughput: 78.64x
- Required 80% floor: 62.912x
- CPU affinity: exactly CPU 0 (`logicalCpus: 1`, `pinned: true`)
- Requested sample contract: two warmups and seven race samples
- Completed race throughputs: 25.054x, 31.771x, 36.867x, and 46.121x
- Result: `complete: false`, `status: failed`
- Fail-fast reason: four sub-gate samples made a passing seven-sample median
  mathematically unreachable

The tool now writes this partial failure artifact before exiting, so an old
completed JSON cannot be mistaken for current evidence. Auxiliary single/pair,
planner-scaling, and duration workloads were intentionally skipped after the
release-critical race median became unrecoverable. `bun run evidence:release`
therefore stops with `Release benchmark is incomplete: race median cannot
recover to 62.912x after 4 sub-gate samples`.

Earlier diagnostic artifacts ranged widely with host state. A completed
15-sample unpinned confirmation reported 51.556x, while individual exact-source
CPU-affinity probes both exceeded and fell far below the gate. The current
four-sample series also accelerated materially during one run. This is strong
evidence that host scheduling/power state is significant, but it is not a
release waiver and does not prove the current build meets the frozen floor.
The threshold remains unchanged. Deterministic tests still enforce at most six
candidates and one full path per selection; the last completed scaling probe
observed five and one, with retention bounded by grid size, but a current
passing reference performance/scaling artifact is still required.

The genuine Firefox callback-work sampler captured 60 warmups and 300 measured
frames (360 callbacks total) with finite state and no browser error. Callback
work p50/p95 was 25/59 ms; frame-interval p50/p95 was 183.54/400.20 ms under the
same power-constrained host state. Because the required pre-change same-machine
p95 and retained real-time target were not supplied, its regression and
real-time fields explicitly say `baseline-not-supplied` and
`target-not-supplied`; it is diagnostic, not release evidence. Headless timings
are not substituted for either missing value.

## Streaming and fail-fast audit behavior

`run-statistical-suite`, `run-race-stratum`, `benchmark-sim`, `optimize-track`,
the browser coordinator, functional acceptance, UI capture, browser performance,
and contact-sheet generation emit newline-delimited `goldenlap-audit` events.
Events identify suite, phase, case, progress, result, warning/failure, and the
registered classification needed to interpret the result.

The normal-tier rerun demonstrated the distinction in live output: a
13-contact race emitted `contactBand: acceptable`; 23-, 28-, and 50-contact
races emitted immediate `outside-acceptable` warnings; and the population run
continued to its 60-race conclusion with zero red invariant. The pinned
benchmark demonstrated mathematical fail-fast: it stopped after sample four,
before auxiliary workloads, because four failures already made the median gate
unrecoverable. Browser capture uses a bounded deadline and writes a partial
artifact on timeout rather than waiting indefinitely or throwing away the
completed samples.

## Simplification and pivot log

| Decision | Evidence | Outcome |
|---|---|---|
| Fix finite pit state/reservation ownership rather than redesign pit geometry | Root cause was a self-latching predicate and stale renewable claim | Adopted |
| Gate rights speed authority by reachability without adding a new crawl controller | Positive progress followed once distant authority was removed | Adopted |
| Use compact station sampling and winner-only materialization | Candidate allocation dominated early planner work | Adopted |
| Run full search at 5 Hz, keep safety validation at 30 Hz | 0.2 s cadence passed; 0.3 s increased contacts | Adopted/reverted slower cadence |
| Project proven competitive anchors into free intervals | Full replacement added complexity without established visual benefit; plan phase-6 gate explicitly permits projection | Adopted planned simplification |
| Stage road/curb before runoff and grant only the selected emergency path | Declaration-time grants produced unrealistic authorization rates | Adopted |
| Event-only replanning | Contacts rose from 1 to 14 in the probe | Reverted |
| Incremental local materializer | Full-grid throughput regressed | Removed |
| Smaller priority pass offset | Calibration loss distribution worsened | Reverted |
| Model-derived priority transition distance | Calibration p95 worsened | Reverted |
| Add a second spline/trajectory/controller or per-track racecraft constants | Existing interpolation and global controller passed deterministic/headless gates | Rejected as unnecessary |

The retained solution uses model geometry and registered policy rather than a
manual parameter sweep. Rejected experiments were removed rather than layered
onto the final controller.

## Browser and release blocker

### Genuine Firefox evidence

Firefox 146.0.1 executed the rebuilt development bundle in a real browser. The
acceptance harness reported `line`, `paths`, `rights`, `pit`, `priority`, and
`runtime` true, with no console/page errors. All 12 physical corner-rights
trials kept both the protected targets and fully sampled paths legal through
acquisition, release, and rejoin, with zero hard contacts. The pit matrix ran
180 foreign-stopped-box cases with zero contact or blockage. The priority matrix
ran 12 blue, 12 qualifying, and 12 driven trials with zero illegal decision,
path crossing, or hard contact; maximum measured rejoin was 11.833 s and
maximum qualifying loss was 2.008 s.

One Nordwald blue-priority corner trial detected its first safe opportunity at
1.6 s but completed release at 14.675 s, a 13.075-second tail. It yielded safely,
kept separation, and made no illegal crossing or contact. The harness therefore
emits a `distribution-outlier` warning and continues; it does not misclassify a
plausible safe-pass delay as an impossible-state failure.

`output/playwright/firefox-dynamic-motion/racecraft-capture-index.json` records:

- six all-track clean-line captures and 55 staged scenario captures;
- 60 category/track motion captures, each at native 1x and 0.25x, for 120
  sequences and 360 individual moving frames;
- simulation advancement from 0.15 to 1.067 seconds per sequence, finite car
  state throughout, zero motion failures, and zero browser errors;
- clean line, authored curb, attack, defence, side-by-side, blue priority,
  qualifying priority, obstacle/runoff, rejoin, and pit-flow coverage on all
  six tracks.

Twenty regenerated contact sheets (every category at both speeds) were
manually inspected after the final geometry change. No visible teleport, path
crossing, oscillatory switch, illegal grass use, discontinuous rejoin, or pit
blockage was observed. The generated capture index intentionally remains
`reviewed: false`: this Firefox-specific review does not impersonate the
successor release visual manifest, which requires the default compatibility
browser, both HTML entry paths, the exact bundle digest, and the performance
baseline. The structured record is explicitly named
`firefox-review-not-release.json` and sets `releaseEligible: false`.

Firefox exact-hash parity is not claimed. `tools/parity-check.js` reports the
same 21 track/racing-line differences for development and minified bundles,
showing that this is a Firefox-versus-fixture numeric divergence rather than a
minifier semantic change. Functional racecraft acceptance passes, but the exact
Chromium-derived fixture still has to be exercised in Chromium.

The production command built a valid 239,473-byte minified artifact before
stopping at those same 21 Firefox parity differences. The reviewed development
bundle was then restored byte-for-byte at 483,814 bytes and SHA-256
`8a753922915b9999729b7365922300f9863e745e921458b4ccac8aeeb423526f`.

### Default Chromium blocker

The following required commands reach pinned Chromium headless shell revision
1208 and fail before page creation:

| Command | Result |
|---|---|
| `bun run test:headless-parity:raw` | Blocked at Chromium launch; no parity comparison claimed |
| `bun run test:browser:smoke:raw` | Built artifact valid, then Chromium fatal `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted` |
| `bun run test:prod` | Typecheck and minified build pass; same Chromium launch failure |

An unsandboxed escalation was requested once and rejected by the managed
approval policy. No sandbox bypass was added to repository code.

`output/playwright/visual-review.json` belongs to the superseded optimization
plan and cannot prove current curb, obstacle/runoff, rejoin, or dynamic-corridor
behavior. It was not overwritten or relabeled. With the current benchmark,
`bun run evidence:release` stops earlier and correctly reports `Release
benchmark is incomplete: race median cannot recover to 62.912x after 4 sub-gate
samples`. After that gate is satisfied, `tools/write-release-evidence.ts` will
additionally require:

- the successor plan id and the exact current development bundle digest;
- real native-1x and slow-motion evidence on all six tracks for clean lines,
  curb use, attack/defence, side-by-side, priority, obstacle/runoff, rejoin, and
  pit flow;
- both `index.html` and `golden-lap.html` entry paths;
- a raw browser-performance artifact with at least 30 warmups and 300 measured
  frames, the reference baseline, the 10% regression limit, and the retained
  real-time p95 target;
- the dynamic planner scaling artifact and its 80% throughput, six-candidate,
  one-materialization, and bounded-retention gates.

The browser capture harness has been exercised in Firefox and is ready for the
default-browser review. It stages the actual
production materializer, obstacle classifier/lifecycle, and corridor selector
through a non-enumerable diagnostic test surface, captures every built-in track
for line, curb, attack, defence, side-by-side, both priority modes,
obstacle/runoff, rejoin, and pit flow, and writes an explicitly unreviewed
`racecraft-capture-index.json`. It does not self-certify visual quality.

When those checks pass it writes
`output/release/racecraft-dynamic-corridor-manifest.json`. It does not overwrite
or reinterpret the historical optimization manifest.

## Remaining release procedure

On a quiescent reference machine that can launch the repository-pinned
Chromium:

1. Rerun `bun run benchmark:sim:reference -- --samples 7 --warmups 2 --output
   output/benchmarks/dynamic-corridor-final.json`. It must complete and meet
   62.912x. The benchmark now fails fast and writes an explicit partial artifact
   if the median cannot recover. Preserve the attempt; if it remains below the
   floor on a stable host, profile and simplify the production hot path rather
   than changing the baseline or gate.
2. Run `bun run test:headless-parity:raw`, `bun run test:browser:smoke:raw`, and
   `bun run test:prod`. Resolve any exact parity difference that appears after
   Chromium can actually create a page.
3. Capture and inspect the required successor scenarios at native 1x and slow
   motion on every track, covering both file entry paths.
4. Record the current development bundle SHA-256 and successor plan id in
   `output/playwright/visual-review.json`.
5. Establish the missing pre-change browser p95 from a preserved optimization-
   implementation build on the same reference machine, then capture at least
   300 current frames. Record the raw artifact and confirm current p95 is no
   more than 10% above that baseline and retains the real-time target. Do not
   substitute a headless-session timing or invent a baseline.
6. Run `bun run evidence:release`; preserve the generated dynamic-corridor
   manifest with the other release artifacts.

## Definition-of-done audit

The behavioral, liveness, surface, bounded-search-complexity, statistical,
profile, and new-track questions in the plan can be answered yes. A genuine
browser has also executed and the Firefox functional/visual matrix passes. The
headless throughput, exact default-browser compatibility, browser regression,
successor visual-manifest, and final release questions cannot yet be answered
yes. Accordingly this report does not mark the plan fully implemented and the
active goal must not be marked complete.
