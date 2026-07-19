# Golden Lap — Racecraft Optimization Implementation Report

Status: implementation complete; all public release gates pass

Report date: 2026-07-14

Authoritative plan: `racecraft_optimization_plan.md`

## Scope and preservation policy

This report records the implementation and verification evidence for the
model-based racecraft and fast track-optimization pivot. The current TypeScript
module split, file-compatible IIFE, semantic-line work, dynamic paths, corner
rights, pit reservations, blue flags, and qualifying priority are treated as
candidate reusable implementation. Historical parity fixtures are retained
unchanged; pivot fixtures and policies are additive.

No unrelated worktree changes may be reset or overwritten. No commit or push
is part of this goal.

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| 0 — Pivot baseline | Complete | `tests/fixtures/calibration/pivot-baseline.json`; commands below |
| 1 — Metric policy/statistics | Complete | policy/manifest fixtures, evaluator, and 8 unit tests |
| 2 — Headless runners/benchmark | Complete | production runner, five-scenario parity, benchmark |
| 3 — TrackProfile baseline | Complete | 6 compact profiles, freshness/fallback validation |
| 4 — Bounded optimizer | Complete | staged CLI, deterministic search, six normal-budget runs |
| 5 — Runtime profile integration | Complete | all-profile dry/wet validation; browser line checks |
| 6 — Maneuver feasibility | Complete | bounded candidate/path invariants and acceptance matrix |
| 7 — Rules/priority/pit integration | Complete | rights, blue/quali, and pit lifecycle matrices |
| 8 — Calibration/characterization | Complete | six global dimensions; held-out normal suite red-free |
| 9 — New-track workflow proof | Complete | cold 600/900/1200 fixture runs and workflow validator |
| 10 — Integration/release | Complete | all three verification tiers; release manifest and 1x review |

## Phase 0 — Pivot baseline

### Source and reference environment

- Git HEAD: `2f85a025175ca5d43901c919626a7257df02bcbd`
- Branch: `main`
- OS: Linux 5.15.167.4 WSL2, x86-64
- CPU: 12th Gen Intel Core i5-1235U, 6 cores / 12 logical CPUs
- Bun: 1.3.14
- Node.js: 22.22.1
- TypeScript: 5.9.3
- Playwright: 1.58.2

### Reusable current implementation

- `src/core/racing-line.ts` owns semantic corners, sampled path geometry, and
  analytical speed/timing profiles.
- `src/core/autopilot.ts` and `src/core/physics-engine.ts` provide a pure
  controller and vehicle simulation already imported by the tuning probes.
- `src/session/racecraft/paths.ts` already materializes and caches the required
  phase-varying path modes through `PathPlan` and `SampledPath`.
- `src/session/racecraft/corner-rights.ts` owns persistent protected corridors.
- `src/session/racecraft/priority.ts` owns persistent blue-flag and qualifying
  priority records and physical-clearance release.
- `src/session/pit.ts` owns swept occupancy, queues, crossing reservations, and
  merge conflicts.
- `tools/trajectory-tune.ts` and `tools/controller-tune.ts` already demonstrate
  direct headless use of production core code, but are ad hoc probes rather
  than the required reusable runner/optimizer.

### Baseline commands and observed results

| Command | Result |
|---|---|
| `bun run typecheck` | Pass: zero TypeScript errors |
| `bun run check:boundaries` | Pass: 47 TS files, acyclic imports, browser separation, script-free entries |
| `bun run test:unit:raw` | Pass: 33 tests, 0 failures, 649,161 assertions |
| `bun run build` | Pass: 44-module development IIFE, approximately 0.35 MB plus 0.67 MB map |
| `node tools/racecraft-followup-check.js --mode acceptance --summary` | Expected fail: line, paths, rights, pit, and runtime pass; priority aggregate fails |
| `bun run test:prod` | Expected fail after successful minified build/artifact check: old migration parity differs in 18 intentional semantic track values |

Development bundle SHA-256 before the production build:
`913169b2d1eeae453c02899289ad3833e30301edcb902db5f45ce6c0480b76ab`.

### Known behavioral baseline

All deterministic priority rule invariants observed by the current follow-up
tool pass: eligible detection, reason/beneficiary, one activation, physical
release, decision suppression, path crossing, corridor rights, hard contact,
off-course state, and first-safe blue-flag opportunity. The old aggregate gate
fails because it mixes those invariants with four per-trial performance
thresholds:

| Track/scenario | Observation | Old hard threshold | Pivot classification |
|---|---:|---:|---|
| Prado qualifying, straight | 0.892 s added loss | 0.5 s | normal/acceptable distribution |
| Costa blue flag, approach | did not return to ideal inside 10 s | 10 s | normal/acceptable timing; state/rule cause remains invariant-audited |
| Nordwald qualifying, straight | 0.750 s added loss | 0.5 s | normal/acceptable distribution |
| Cerro qualifying, approach/wet | 1.625 s added loss | 0.5 s | normal/acceptable distribution |

The full threshold ownership map is frozen in
`tests/fixtures/calibration/pivot-baseline.json`. It separates state/rule/
geometry invariants from performance, rate, and timing populations. Old
baseline-mode assertions are historical evidence only.

### Historical parity status

`tests/fixtures/parity/manifest.json` captures the pre-semantic-line migration
contract and remains immutable. The current production bundle differs in each
track's corner/sample hash and line lap time, yielding 18 differences. Phase 2
must add pivot parity rather than rewriting this historical source. Until the
runner supports selecting the correct parity generation, `test:prod` stops at
that known mismatch before its final smoke stage.

### Phase 0 exit audit

- [x] Strict TypeScript ran.
- [x] Module boundaries ran.
- [x] Development build status recorded.
- [x] Current file-based browser runtime recorded through the follow-up tool.
- [x] Production build/artifact status and parity blocker recorded.
- [x] Existing implementation inventory recorded.
- [x] Every legacy threshold family classified.
- [x] Historical fixtures preserved.
- [x] Phase 0 report and pivot manifest pass syntax/check review.

## Phase 1 — Metric policy and statistical primitives

`tests/fixtures/calibration/metric-policy.json` is the machine-readable owner
of normal, acceptable, absolute, invariant, and target semantics. It includes
units, scope, aggregation, population/distribution assumptions, minimum sample
counts, rationale, and owner for every declared metric. The disjoint
calibration, validation, and release seeds plus track/weather/scenario strata
are frozen in `tests/fixtures/calibration/scenario-manifest.json`.

`tools/lib/statistics.ts` supplies dependency-free empirical quantiles, Wilson
binomial intervals, approximate Garwood Poisson-rate intervals, stratification,
and policy classification. Absolute violations and invariants remain hard red;
ordinary distributions distinguish green, amber, red, and inconclusive.
Undersampled distributions are inconclusive, while an absolute violation is
never hidden by sample count.

`tools/evaluate-metrics.ts` provides the CI-facing policy evaluator. Fixture
evidence confirms exit 0 for green, amber, and inconclusive observations, exit
1 for red, and exit 2 for malformed input or tool failure.

### Phase 1 verification

| Command | Result |
|---|---|
| JSON parse of `tests/fixtures/calibration/*.json` | Pass: 7 documents |
| `bun test tests/unit/tools/statistics.test.ts` | Pass: 8 tests, 29 assertions |
| `bun run typecheck` | Pass |
| evaluator with green fixture | Pass: green, exit 0 |
| evaluator with amber fixture | Pass: amber, exit 0 |
| evaluator with inconclusive fixture | Pass: inconclusive, exit 0 |
| evaluator with red fixture | Expected policy failure: red, exit 1 |

### Phase 1 exit audit

- [x] Invariant, distribution, and target policies are machine-readable.
- [x] Normal, acceptable, and absolute boundaries are distinct.
- [x] Calibration, validation, and release populations are disjoint.
- [x] Confidence/rate primitives have deterministic unit coverage.
- [x] Insufficient evidence is inconclusive rather than red or green.
- [x] CI exit semantics distinguish product failure from tool failure.

## Phase 2 — Pure headless runners and benchmark

`src/game/headless-sim.ts` is the production-code adapter; the required
`tools/lib/headless-sim.ts` path is a thin re-export. The adapter directly uses
track construction, ideal-line materialization, `botStep`, `makeCar`,
`trackSense`, `stepCar`, `raceTick`, `stepSession`, collision handling, pit
logic, and racecraft. It supports fixed-step single-car laps and bounded named
pair, pit, priority, and classification sessions with injected deadlines and
maximum-step caps. Summaries are stable JSON with deterministic checksums.

Gameplay randomness now goes through `src/shared/rng.ts`. Its default source
still calls the host `Math.random`, preserving browser seed hooks and random
call order, while headless runs isolate a repository `mulberry32` stream.

The hidden symbol `Symbol.for('goldenlap.headlessParity')` exposes the same
production runner to browser verification without adding or changing any
frozen string-key test API. `tests/fixtures/parity/headless-pivot.json` freezes
clean, pair, pit, priority, and classification outcomes. Discrete state and
event order are exact; continuous state has an explicit `5e-8` cross-engine
tolerance. The largest observed Bun/browser delta before applying that policy
was approximately `1.5e-8`.

### Phase 2 verification

| Evidence | Result |
|---|---|
| all-track single-lap probe, seed 101 | 6/6 complete, valid, finite, zero grass |
| focused unit coverage | deterministic pair/pit/priority/classification plus limits |
| `bun run test:unit:raw` | Pass: 44 tests, 649,210 assertions |
| `bun tools/headless-parity.ts` | Pass: all five scenarios match browser and fixture |
| `bun run check:boundaries` | Pass: 48 files, no forbidden browser dependency |
| `bun run typecheck` | Pass |

Reference Prado benchmark, seven measured samples after two warm-ups:

| Workload | Median wall time | P10–P90 | Median simulated/wall throughput |
|---|---:|---:|---:|
| one production lap | 49.00 ms | 37.65–59.63 ms | 1,419x |
| 8 s pair scenario | 9.08 ms | 8.14–12.65 ms | 881x |
| 60 s active focused session | 75.47 ms | 65.99–90.21 ms | 795x |

Cold track preparation was 122.9 ms. With 20% of the wall budget reserved for
validation, the measured one-lap rate forecasts approximately 9,796 candidate
evaluations in 10 minutes, 14,694 in 15 minutes, and 19,592 in 20 minutes.
This is ample headroom; later optimizer stages must impose smaller evaluation
caps to avoid spending budget merely because it exists.

### Phase 2 exit audit

- [x] Production-code runner has no DOM, UI, bundle, or browser dependency.
- [x] Physics, controller, collision, pit, and racecraft are not duplicated.
- [x] Fixed seeds reproduce identical summaries and checksums.
- [x] Clean, pair, pit, priority, and classification parity pass.
- [x] Deadline and step-cap exits are unit-tested.
- [x] Throughput supports a credible bounded workflow well below 20 minutes.

## Phase 3 — Compact TrackProfile baseline

The `TrackProfile` contract now includes schema/fingerprint identity,
normalized longitudinal anchors and lateral offsets, validation status and
metrics, optimizer version, deterministic seed/evaluation provenance, and
search description. The committed generated data lives in
`src/data/track-profiles.ts`.

The baseline conversion stores only the anchors that actually constructed the
semantic incumbent: four neutral start/pit anchors plus primary turn-in, apex,
and track-out anchors. The six tracks use 22–34 anchors each, versus roughly
1,400–2,200 materialized samples. `materializeTrackProfile` reconstructs the
typed `Float64Array` path through the same periodic smootherstep authority,
then derives curvature, distance, and speed arrays.

Fingerprints cover explicit geometry, pit sizing, materializer/speed-profile
versions, production physics, fixed step, and the global path follower.
Matching profiles are attached at track build. Missing and stale profiles use
an explicit deterministic development fallback and diagnostic; release-mode
construction rejects either condition.

`tools/lib/profile-io.ts` provides stable serialization and a brace-aware
single-entry source update, preserving every byte outside the selected track.
`tools/validate-track-profiles.ts` is the release freshness/controller gate.

### Phase 3 verification

| Evidence | Result |
|---|---|
| compact profile unit tests | 6/6 deterministic round-trips; maximum path delta ≤ `1e-8` |
| profile source update test | selected entry only; repeated serialization is byte-stable |
| missing/stale tests | development fallback works; release mode throws |
| invalid anchors | duplicate and road-bound violations rejected pre-materialization |
| `bun run validate:profiles` | 6/6 matched, finite, valid production laps, zero off-course |
| `bun run test:unit:raw` | Pass: 49 tests, 679,504 assertions |
| `bun run typecheck` | Pass |

### Phase 3 exit audit

- [x] All committed tracks have compact matching profiles.
- [x] Profiles and source-entry serialization round-trip deterministically.
- [x] Materialized geometry/speed arrays are finite and road-bounded.
- [x] Serialized and heuristic paths agree within frozen tolerance.
- [x] Missing/stale development fallback is explicit and diagnosed.
- [x] Release validation rejects missing/stale profiles.
- [x] One qualifying/clean profile serves both intents; no unjustified race profile was added.

## Phase 4 — Bounded per-track optimizer

`bun run optimize:track -- --track <id> --budget-seconds 900 --write` now owns
one central deadline and supports one track, 600–1200 second normal budgets,
seed, deterministic evaluation cap, JSON output, no-write default, and stable
single-entry writes. A development-only short-budget flag exists for tests.
Reports are emitted under ignored `output/track-optimizer/<id>/` in JSON and
Markdown and state explicitly that the result is best-found within budget, not
globally optimal.

The initial search is the bounded design from the plan: at most 36 non-neutral
semantic anchors, early road/sign/outside-apex-outside rejection, analytical
production path/speed evaluation, deterministic coordinate pattern stages,
seeded restarts, a 16-member Pareto limit, and successive halving. It uses an
in-memory cache and no new dependency. No more than eight finalists receive a
warm-up plus two measured production laps and the fixed grip/lateral/speed
robustness matrix. The incumbent is validated first and always remains a
candidate. Candidate nominal time may not exceed the registered 1.01
acceptable ratio to the incumbent.

The final 10% is reserved for serialization/reporting; the broad search ends
at 68% and high-fidelity validation at 90%. Stage A is independently capped at
60 seconds. Pair, wet-pair, blue-flag, wet-blue-flag, pit, and classification
characterization is intentionally provisional at this per-track sample size.

### Full normal-budget generation evidence

Each committed track was invoked with a 600-second budget, seed 101, and a
600-evaluation cap. All stopped by bounded convergence far before the wall
limit:

| Track | Status | Variables | Evaluations | Wall | Verified gain | Result |
|---|---|---:|---:|---:|---:|---|
| Prado | normal | 21 | 276 | 4.25 s | 0.054 s | selected |
| Costa | normal | 18 | 205 | 3.79 s | 0.292 s | selected |
| Nordwald | normal | 24 | 409 | 6.99 s | 0.250 s | selected |
| Villa | normal | 30 | 505 | 4.69 s | 0.000 s | incumbent retained |
| Anhembi | acceptable | 27 | 457 | 5.25 s | 0.708 s | selected; marker error is amber |
| Cerro | normal | 24 | 402 | 5.29 s | 0.271 s | selected |

Villa is useful negative evidence: seven analytical finalists improved the
predicted envelope but exceeded the acceptable nominal-time ratio, so the safe
incumbent won. The committed generated data now contains the validated result
for each track with 600-second provenance.

The controlled 1.5x-wide Prado fixture proves the search is not a no-op: two
equal seed/cap runs selected identical anchors and produced a 0.375 s verified
gain (frozen minimum 0.300 s).

### Phase 4 exit audit

- [x] CLI supports track, budget, seed, evaluation cap, JSON, no-write, and write.
- [x] Normal budgets outside 600–1200 seconds are rejected.
- [x] Search/validation/report reserves share one deadline and watchdog.
- [x] Search variables never exceed 36 and preserve semantic path direction.
- [x] Pareto retention, restarts, halving, and in-memory cache are bounded.
- [x] No more than eight finalists use production physics.
- [x] Safe incumbent cannot be displaced by invalid/unacceptable output.
- [x] Same seed and cap reproduce the selected profile.
- [x] Controlled suboptimal profile improves by the frozen margin.
- [x] Six normal-budget invocations complete far below 1200 seconds.
- [x] Five tracks show measured improvement; Villa records convergence/gate evidence.
- [x] Reports distinguish provisional characterization and best-found status.

## Phase 5 — Production profile and controller integration

Track construction now selects one matching `TrackProfile`, materializes its
periodic anchor path, and derives curvature, semantic observations, the speed
envelope, and braking behavior from that same authority. There is no separate
qualifying line, race line, or controller-specific copy. `src/game/tracks.ts`
attaches the profile and `src/core/racing-line.ts` owns materialization and
derived data; runtime cars consume `track.idealPath` through the production
controller.

The controller handoff was audited rather than compensated per track. That
audit found that `src/session/entry.ts` zeroed the residual lateral command
whenever an ideal path existed, which is true for every normal car. The fix
reserves zero residual only for a dynamic `PathPlan`; the shared ideal path now
receives recovery, room, and avoidance residuals. A direct regression test
locks this authority boundary. `installIdeal` also translates an active scalar
target when an emergency or room-control command takes authority from a
maneuver path, preventing a discontinuous zero target.

All six stored profiles complete dry and wet production laps with zero
off-course seconds. Current verified dry lap times range from 67.708 s at
Prado to 92.883 s at Nordwald; wet validation ranges from 75.242 s to
105.192 s. Maximum tracking error is 0.596–0.828 m. The analytical browser
line check shows every profile faster than its centerline reference by
0.658–1.870 s, finite and road-bounded, with isolated marker errors below
0.78 m. The browser captures confirm outside-entry, inside-apex, and unwind
shape, including linked-complex compromises.

### Phase 5 verification

| Evidence | Result |
|---|---|
| `bun run validate:profiles` | 6/6 matching, finite, dry/wet laps, zero off-course |
| `node tools/racecraft-check.js` | 6/6 lines faster than centerline; all geometry/controller gates pass |
| profile/controller unit coverage | round-trip, stale/missing, authority handoff, and residual-command regressions pass |
| development and production browser checks | both file entry paths boot and preserve parity/API behavior |

### Phase 5 exit audit

- [x] One compact profile owns line, curvature, markers, speed, and braking.
- [x] Clean-air dry and wet laps are stable on all six tracks.
- [x] Isolated corners and linked complexes use bounded racing-line geometry.
- [x] Controller fixes are global; no per-track controller constants exist.
- [x] Profile validation has zero red invariants; Anhembi marker error remains
  explicitly acceptable rather than hidden.
- [x] Development and minified file boots remain green.

## Phase 6 — Bounded maneuver candidates and feasibility

The implementation retains the existing `PathPlan`/`SampledPath` hierarchy.
`src/session/racecraft/paths.ts` materializes attack, defend, inside/outside
side-by-side, yield, priority-pass, tuck, pit, recovery, and ideal-rejoin
shapes. Competitive paths close their unused periodic section smoothly within
the protected corridor; noncompetitive priority paths rejoin the ideal line
locally. Rejoin episodes carry lifecycle identities so a newly released right
cannot reuse stale geometry.

`src/session/racecraft/feasibility.ts` rejects out-of-road, controller-demand,
occupied-envelope, and protected-corridor conflicts before preference ranking.
It uses bounded future path anchors and conservative longitudinal/lateral
occupancy rather than adding a polygon engine. Discretionary plans have a
commitment window and every switch/rejection records a bounded reason. The
headless race summary also exposes candidate-rejection and path-mode time
diagnostics, making bad behavior attributable without per-frame logging.

### Phase 6 verification

| Evidence | Result |
|---|---|
| path unit matrix | all required modes finite, bounded, cached, and phase-varying |
| feasibility regression | road/occupancy crossing candidate rejected with reason |
| lifecycle regressions | stale rejoin prohibited; emergency/scalar authority preserved |
| left/right, dry/wet matrix | finite at production traffic cadence |
| browser acceptance | 6 line tracks and 6 path-mode tracks pass |

### Phase 6 exit audit

- [x] Candidate enumeration is capped at six per active car/update.
- [x] The existing path representation remains the sole trajectory authority.
- [x] Protected-corridor crossings are hard feasibility failures.
- [x] Attack, defense, protected-side, yield, pass, tuck, and pit geometry vary
  by phase and close smoothly.
- [x] Commitment, infeasibility, release, and arbitration reasons are explicit.
- [x] No generalized candidate or computational-geometry framework was added.

## Phase 7 — Rules, priority, and pit integration

`src/session/racecraft/corner-rights.ts` owns persistent side assignments and
physical clearance; `paths.ts` turns them into non-crossing corridors. Rights
survive ordering, timer, and linked-corner changes, release only after
track-out plus bumper clearance held for 0.5 s, and then use an explicit rejoin
plan. Feasible three-wide cases receive three corridors; an infeasible late
arrival is tucked. Defense now remembers the monotonically increasing episode
per attacker, so interleaved A/B/A traffic cannot create a second defensive
move against A.

`src/session/racecraft/preference.ts` is the canonical owner of qualifying lap
phase and completed-race-lap preference. Blue flags require an actual completed
lap advantage; the first start-line crossing is explicitly not a lap. Flying
qualifying laps receive preference over in/out laps. `priority.ts` retains
queueing, stable yield sides, suppression of attack/defense, and release only
after physical clearance. Rights remain above priority during an already
protected corner.

Pit behavior remains in `src/session/pit.ts`: travel lane, team queue, box
crossing, egress, and merge occupancy are distinct. A stopped foreign car whose
envelope does not intersect the travel lane is never selected as a leader;
same-team double stacks and real crossing/merge conflicts still wait. The pit
sampled path is the sole lateral authority through release.

### Phase 7 deterministic evidence

| Matrix | Result |
|---|---|
| rights acquisition | 16/16 cases pass |
| physical rights/release | 12/12 safe, 12/12 released and rejoined, 0 hard contacts |
| linked and three-wide | linked handoff passes; both feasible and fallback cases pass |
| pit foreign boxes | 180 trials, 0 failures, 0 added delay |
| pit conflicts | 6 double stacks and 6 merge cases, 0 contacts |
| blue flag | 12/12 detection-to-release cases pass |
| qualifying priority | 12/12 in/out versus flying-lap cases pass |
| driven priority | 12/12, 0 path crossings, 0 illegal decisions, 0 hard contacts |

### Phase 7 exit audit

- [x] Persistent rights, blue flags, qualifying preference, and pit reservations
  acquire, hand off, and release physically.
- [x] Yielding suppresses new attack/defense decisions without dropping an
  already protected corridor.
- [x] Side-by-side cars keep space through the braking zone and corner exit.
- [x] Lapped cars give way only to a car at least one completed lap ahead.
- [x] In/out-lap qualifying cars give preference to flying-lap cars.
- [x] Foreign stopped boxes do not block the travel lane; real pit conflicts do.
- [x] Timing/loss observations are population metrics, while illegal state and
  corridor behavior remain invariants.

## Phase 8 — Racecraft calibration and statistical characterization

`src/session/racecraft/config.ts` contains six global, named, dimensioned,
bounded calibration values. The common-random-number sensitivity sweep uses 48
focused scenarios across Prado/Anhembi, dry/wet, and calibration seeds only.
It retained attack closing speed, detection distance, attack commitment,
prediction horizon, blue-flag time-to-catch, and qualifying time-to-catch.
Generic maneuver commitment had zero measured effect and predicted braking
deceleration stayed below the locked 0.05 materiality threshold, so both were
removed rather than becoming extra knobs. No validation seed was used by that
analysis and there are no per-track racecraft values.

`tools/run-statistical-suite.ts` runs deterministic boundary cases, focused
scenarios, and production full-field races using the policy and disjoint seed
manifest. Rates carry exposure, strata, and Wilson/Poisson intervals; lap-time
and separation distributions use empirical quantiles/tolerance bounds. The
fast and normal tiers permit amber and provisional inconclusive results but
never red. The final held-out normal population contains 60 races and 348
focused scenarios over 2,414.007 car-km and 78,898.53 car-s, including 2,602
pass attempts, 1,351 side-by-side episodes, 153 priority episodes, 60 pit
conflicts, and 48 deterministic boundary cases. It classifies 41 green, 14
amber, 72 inconclusive, and 0 red; the inconclusive strata have five races
against the release minimum of 18 and are correctly not presented as proof.

The worker pool is capped at six by default. An 11-worker normal run was
terminated by the operating system with exit 143; six workers complete the
same deterministic population in about 88–103 seconds while leaving machine
headroom. Explicit worker overrides remain available.

### Phase 8 exit audit

- [x] Six, not more than eight, material global calibration dimensions remain.
- [x] Sensitivity used calibration seeds only and removed two negligible knobs.
- [x] Every population record carries sample count, exposure/stratum, and an
  appropriate interval or empirical bound.
- [x] Plausible incidents are rate observations; impossible state/rule/geometry
  behavior is still a red invariant.
- [x] Fast and normal held-out suites contain zero red results.
- [x] Normal/acceptable/absolute/inconclusive semantics are machine-readable
  and covered by deterministic tests.

## Phase 9 — New-track workflow and bounded-time proof

`NEW_TRACK_WORKFLOW.md` documents the supported sequence: add a
`TrackDefinition`, run the 900-second no-write optimizer, inspect its JSON/MD
report, rerun with `--write`, validate all profiles, and build/test the bundle.
The CLI accepts the full supported 600–1200 second range and never launches a
browser. Missing/stale development behavior and release rejection are covered
independently.

`bun run validate:new-track-fixture` constructs a non-production track without
a stored profile, checks the explicit fallback, and performs cold independent
600, 900, and 1200 second budget runs with no disk/warm cache. Each run returned
the same acceptable candidate after 319 evaluations in approximately 2.0–2.1
seconds, improved the verified lap by 0.0875 s, left its central deadline
unreached, and stated that it was best found rather than globally optimal. The
1200-second write/build proof emits a valid temporary profile source without
altering the committed production registry.

The latest benchmark measures a 38.9 ms single-lap p95, 67.2 ms focused
session p95, and 1.043 s full-race p95 after warm-up. With 20% reserved for
validation, its median-rate forecast is 14,818, 22,227, and 29,636 single-lap
evaluations in 600, 900, and 1200 seconds respectively. Actual bounded convergence is far
faster; the deadline remains a hard maximum rather than a target to consume.

### Phase 9 exit audit

- [x] The documented default is `bun run optimize:track -- --track <id>
  --budget-seconds 900 --write`.
- [x] Independent cold 600/900/1200 runs return an acceptable profile far below
  the hard budget and without a browser or warm cache.
- [x] Reports contain provenance, timing, fallback/convergence, and bounded
  optimality language.
- [x] Profile validation works without reoptimization and rejects stale inputs.
- [x] The generated fixture profile immediately passes the temporary build
  workflow without changing committed track data.

## Phase 10 — Integration, visual review, and release gates

The final package pipeline orders deterministic failures before stochastic
classification. `verify:fast` builds the development IIFE, checks boundaries,
runs the full unit/invariant/profile/parity set and browser smoke, then executes
the small statistical sample. `verify` adds the complete browser acceptance/UI
suite, production/minified file smoke, and the normal six-track dry/wet sample.
`verify:release` reruns that current-state evidence, executes the disjoint
216-race release population, and writes a fingerprinted manifest.

Final deterministic evidence is 70/70 unit tests and 52/52 focused invariant
tests. Module boundaries cover 53 TypeScript files with an acyclic graph,
strict browser separation, and script-free HTML entries. Exact headless/browser
parity passes for clean, pair, pit, priority, and classification scenarios.
Both `index.html` and `golden-lap.html` pass development and production file
boot without page/console errors.

### Statistical tier evidence

| Tier | Population | Green | Amber | Inconclusive | Red | Result |
|---|---|---:|---:|---:|---:|---|
| fast | locked smoke strata | 14 | 2 | 21 | 0 | pass, provisional |
| normal | 60 races / 348 focused | 41 | 14 | 72 | 0 | pass, provisional |
| release | 216 races / 1,272 focused | 114 | 13 | 0 | 0 | pass, conclusive |

The release population represents 8,637.198 car-km, 278,024.63 car-s, 9,349
pass attempts, 4,964 side-by-side episodes, 544 priority episodes, 216 pit
conflicts, and 192 deterministic boundary cases. Six workers complete it in
262.702 seconds. Thirteen registered results are outside their normal band but
inside the acceptable band, so the overall status is amber as designed. There
are no red or inconclusive release claims. Policy and scenario fingerprints are
`fnv1a32:548083d0` and `fnv1a32:8015e8f6`.

### Bundle, manifest, and visual evidence

`output/release/racecraft-optimization-manifest.json` is valid with fingerprint
`fnv1a32:e703bb80`. It records all six profile fingerprints, three independent
cold fixture runs, benchmark and sensitivity data, tool versions, statistical
exposure, and bundle evidence:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| development IIFE | 433,058 | `4fd2db6a9fa98e33c90d9eaecbcddf46ff430c6c7f8f762f61b58ac0423120e9` |
| production IIFE | 215,575 | `bce1f3e782a8d5e6e0e4f83f17c724dda31bcd288804b8cae3ae58e948e065eb` |
| `index.html` | 17,458 | `af51ce2151210c255d4af02edc7780a081c867427decf8ba5c3bf30a1b7923b3` |
| `golden-lap.html` | 271 | `b3a2e0e3ca8593f9b85490d129ee53eef958b32a3400f639df939eeea7f5f983` |

Native 1x review covers optimized clean lines, linked complexes, attack,
defense, protected corners, blue-flag yield, qualifying preference, pit flow,
recovery, and the 390 px mobile HUD through both file entry paths. Every
category in `output/playwright/visual-review.json` passes. The official managed
Playwright wrapper could not launch in this environment, so the same
repository-pinned Playwright checks were run with its installed Chromium; this
environmental fallback is recorded rather than weakening the visual scope.

### Phase 10 exit audit

- [x] `verify:fast`, `verify`, and `verify:release` pass their public contracts.
- [x] All invariants and acceptable boundaries pass; normal excursions remain
  visible amber results.
- [x] The release population has zero red and zero inconclusive claims.
- [x] Development and minified bundles boot through both file paths.
- [x] Optimizer/profile validation, benchmark, sensitivity, and evidence
  commands are reproducible.
- [x] Representative production behavior has been reviewed at native 1x.
- [x] The release manifest records profiles, tools, bundles, populations,
  performance, and simplification authority.

## Simplification decision log

| Phase | Trigger/evidence | Decision | Result |
|---|---|---|---|
| Baseline | Full browser statistical execution is unnecessary for profile search | Preserve Playwright for integration; build pure focused runners in Phase 2 | Complete; parity proven |
| 2 | Full-weekend headless reconstruction would couple UI setup to optimization while focused production sessions cover required behavior | Use single-car and focused-session fallback; keep complete weekend checks in Playwright | Complete; no lost rule/event coverage in pivot fixture |
| 4 | Measured search completes every track in under 7 seconds and the controlled fixture passes | Keep bounded pattern search; do not add CMA-ES or a dependency | Complete; complexity gate avoided |
| 4 | Villa analytical gains require more than 1% nominal verified loss | Retain the safe incumbent under the registered acceptable ratio | Complete; no false optimization claim |
| 4 | Per-track characterization has only two pair trials | Mark intervals provisional and defer population confidence to release suite | Complete; optimizer stays bounded |
| 5 | A controller problem appeared track-dependent because recovery/room commands vanished on every authored ideal path | Correct the one global residual/path authority boundary in `entry.ts`; add a direct regression | Complete; held-out passes rose without per-track tuning |
| 5 | Qualifying and race clean profiles have no measured material difference | Keep one stored profile for both and derive every speed/marker observation from it | Complete; no duplicate profile hierarchy |
| 6 | A generalized planner would duplicate working phase-varying `PathPlan` geometry | Retain those plans; add conservative feasibility, commitment, and diagnostics | Complete; all required modes pass with one representation |
| 6 | Full polygon/oriented-box prediction was unnecessary at traffic cadence | Use conservative Frenet longitudinal/lateral bounds plus one braking branch | Complete; bounded occupancy checks pass without a geometry framework |
| 6 | Periodic path closure could bend a competitive plan across another lane after its active corner | Close only the unused section inside the protected corridor; keep local ideal rejoin explicit | Complete; zero planned corridor crossings |
| 7 | Rights release could reuse an earlier rejoin episode and multi-car A/B/A traffic could repeat a defense | Give release episodes identities and remember the last defense episode per attacker | Complete; both lifecycle regressions are locked |
| 7 | Raw start-line crossing count falsely treated the opening crossing as a completed lap | Centralize completed-lap semantics as `max(0, crossings - 1)` | Complete; no first-lap false blue flag |
| 7 | Pit travel and sampled pit paths could both issue lateral authority | Make the sampled pit path the sole lateral owner; retain reservations for speed/wait constraints | Complete; 180 foreign-box trials and conflict cases pass |
| 7 | A browser acceptance fixture moved a released car after the lifecycle ended | Fix the fixture to observe the physical rejoin instead of widening a production threshold | Complete; 12/12 driven priority lifecycles pass |
| 8 | Two proposed calibration values had zero/below-0.05 material effect | Remove them; retain only the six sensitivity-backed global dimensions | Complete; complexity budget is below eight |
| 8 | The legacy browser season was still running after 14 minutes | Run population seasons through the parity-proven production headless runner; keep browser checks focused/visual | Complete; normal suite now completes in about 90 seconds |
| 8 | Automatic 11-worker statistics was OS-terminated with signal/exit 143 | Cap the default local pool at six; preserve explicit override | Complete; deterministic result is stable with machine headroom |
| 10 | The installed Playwright wrapper could not launch its managed browser in this environment | Use the repository-pinned Playwright Chromium fallback after confirming the same file entry/check scripts | Complete; automated and native 1x review evidence recorded |

## Definition-of-done audit

Every item is mapped to the phase evidence above and the fingerprinted release
manifest.

- [x] Retained TypeScript/module/file/API guarantees pass.
- [x] Production-code headless runner and browser/headless parity pass.
- [x] Compact matching profiles exist for every committed track.
- [x] Missing/stale profile behavior is proven.
- [x] Line, speed, braking, markers, and controller share one profile authority.
- [x] Optimizer stages, validation reserve, deadline, and safe incumbent pass.
- [x] Every existing track and the fixture finish within 1200 seconds cold.
- [x] Optimizer provenance and best-within-budget reporting pass.
- [x] Runtime maneuver paths are bounded, committed, and feasibility checked.
- [x] Rights, priority, and pit invariants pass.
- [x] No per-track controller/racecraft constants exist.
- [x] Exposure-normalized statistical metrics and intervals pass.
- [x] Amber/red/inconclusive semantics pass.
- [x] Held-out scenario and season populations are acceptable.
- [x] All triggered simplifications are recorded.
- [x] `verify:fast`, `verify`, and `verify:release` pass.
- [x] Development/minified file boot and 1x visual review pass.
