# Golden Lap — Model-Based Racecraft and Fast Track Optimization Plan

Status: superseded on 2026-07-15; retained as the historical plan for the
completed optimization implementation

Successor: `racecraft_dynamic_corridor_plan.md`

Do not use this document to authorize or sequence new racecraft work. Its
implemented optimizer, headless runner, profiles, statistics, and verification
framework remain part of the repository baseline, but its road-only path bounds,
fixed-template preference, and remaining behavioral prescriptions are replaced
by the successor plan.

Plan date: 2026-07-14

## Authority and relationship to the previous plan

This document is the implementation plan for the racecraft pivot requested
after work began on `racecraft_followup_plan.md`.

The useful results of the previous plan are retained:

- strict TypeScript modules under `src/`;
- a Bun-built, file-compatible browser IIFE;
- script-free compatibility HTML;
- pure core and session layers with browser code isolated under `src/ui/`;
- semantic corners, sampled paths, path-aware control, pit reservations,
  corner-rights state, blue-flag state, qualifying priority, and their current
  tests and diagnostics;
- the `window.__GL` compatibility surface and development/production browser
  checks.

This plan supersedes the previous plan wherever it prescribed manual
constant-by-constant tuning, one fixed hard threshold for stochastic outcomes,
or full-race simulation as the primary way to discover a racing line. It also
supersedes the execution order of the old behavioral Phases 7–13. The old plan
remains authoritative only for packaging, modularity, compatibility, and the
functional race rules that are not contradicted here.

Do not reset or discard the current worktree. Audit each existing implementation
against this plan and reuse it when it already satisfies the new contract.

## Problem statement

The current implementation can be made to pass individual scenarios by
adjusting lookahead distances, rejoin distances, lateral offsets, braking
horizons, and similar constants. That process has three weaknesses:

1. It fits a small set of examples instead of deriving behavior from geometry,
   vehicle capability, and predicted interactions.
2. It encourages track-specific or scenario-specific magic numbers that do not
   generalize.
3. It treats every sampled outlier as a hard failure even when the outcome is
   plausible and the population remains realistic.

The replacement is a deliberately bounded hybrid system:

- offline or development-time optimization finds the best validated clean-air
  profile for each track within a strict wall-clock budget;
- production racecraft selects from a small set of smooth maneuver candidates;
- rules and physical occupancy eliminate infeasible candidates;
- the existing controller follows the selected path and speed envelope;
- deterministic tests enforce invariants, while stochastic checks judge rates
  and distributions against normal and acceptable bands.

The objective is not a perfect racing simulator or a proof of the global
mathematical optimum. The objective is a robust, explainable, maintainable game
simulation that produces believable behavior and can prepare a new track in
10–20 minutes on the reference development machine.

## Required outcomes

1. A pure headless runner uses the production geometry, controller, physics,
   session, collision, and racecraft code without Playwright, DOM, Canvas, or a
   second implementation of the simulation.
2. Each track has a compact, versioned `TrackProfile` containing the control
   anchors and provenance needed to materialize its clean-air line. Braking,
   turn-in, apex, track-out, curvature, and speed information are derived from
   that line and the production vehicle model.
3. A single command optimizes one new or changed track, validates the result,
   characterizes a bounded set of traffic scenarios, and produces a profile
   and report in no more than 20 minutes. The normal default budget is 15
   minutes and the supported range is 10–20 minutes.
4. The optimizer always starts from a safe deterministic heuristic and returns
   the best validated profile found within the budget. It never claims to have
   proven a global optimum.
5. Runtime racecraft uses the existing `PathPlan`/`SampledPath` contract to
   generate a small number of phase-varying follow, attack, defend,
   side-by-side, yield, pass, tuck, and pit candidates. It does not introduce a
   second path hierarchy.
6. Candidate feasibility uses predicted space-time occupancy and explicit race
   rules. An existing protected corridor, pit conflict, or occupied vehicle
   envelope is a constraint rather than a suggestion in a weighted score.
7. Blue flags, qualifying preference, corner rights, and pit behavior retain
   persistent state and physical release rules. Their timing and performance
   are calibrated statistically instead of fitted to one deterministic run.
8. Verification classifies metrics as invariant, normal, acceptable, or
   target. A normal-band excursion is amber and does not fail the build. An
   acceptable-band violation or an invariant violation is red and does fail.
9. Track, weather, driver, and traffic results are reported with appropriate
   distribution models and confidence intervals. The system does not assume
   that counts, rates, minima, and lap-time residuals are all Gaussian.
10. Every phase has a measured simplification gate. When the preferred solution
    is too slow or too complex, implementation must take the listed fallback
    rather than escalating toward an unbounded ideal.

## Non-goals

The first implementation does not include:

- reinforcement learning;
- a neural racing policy;
- a full nonlinear model-predictive controller;
- a general computational-geometry or polygon-clipping framework;
- a distributed optimizer or external service;
- live optimization when the game starts;
- separate controller constants for every track;
- full-grid races inside the inner racing-line search loop;
- a guarantee that a 20-minute run found the mathematical global optimum;
- an attempt to make every collision impossible. Plausible driver errors and
  racing incidents are allowed at realistic rates.

Any proposal to add one of these requires evidence that the bounded solution
cannot meet an explicit acceptance gate, a written complexity decision in the
implementation report, and user approval if it changes scope materially.

## Minimum sufficient implementation

The simplest compliant route is the default, not merely an emergency fallback:

1. Keep the existing production physics, controller, `SampledPath`,
   `PathPlan`, semantic-corner, rights, priority, and pit state machines.
2. Add a pure single-car/focused-session headless adapter around that code.
3. Store compact semantic line anchors and materialize them through the current
   path functions.
4. Search those anchors with one deterministic bounded pattern search.
5. Use analytical evaluation for the broad search and production physics only
   for a small finalist set.
6. Keep the current phase-varying maneuver plans when safe; add commitment and
   conservative Frenet-interval feasibility rather than replacing them.
7. Add only empirical quantiles, Wilson intervals, Poisson intervals, and the
   four-state metric classifier.
8. Keep full Playwright races for integration and visual checks only.

If this route meets the acceptance gates, do not implement oriented-box
prediction, a second race profile, CMA-ES, disk caches, a generalized candidate
framework, or a fully headless weekend runner.

## Guiding principles

### Physical and geometric quantities before magic numbers

Values should be derived whenever possible:

- following distance from speed and reaction time;
- detection distance from closing speed and time horizon;
- braking point from the backward speed-envelope pass;
- clearance from projected vehicle half-extents and uncertainty;
- rejoin distance from allowed lateral acceleration and jerk;
- path lookahead from speed and controller response;
- track-out hold from the semantic corner and occupied corridor.

The remaining calibratable values must have names, units, valid ranges, and one
documented owner. They may not be duplicated as unrelated constants in several
modules.

### One trajectory representation

`SampledPath` remains the controller-facing representation and `PathPlan`
remains the session-facing plan. Optimizer anchors and maneuver candidates are
materialized through the same production path functions. Tooling may add pure
metadata, but it must not create a parallel path engine.

### Hard constraints before preferences

Candidate selection is lexicographic:

1. reject invalid geometry, track-limit violations, protected-corridor
   violations, unavoidable predicted overlaps, and rule violations;
2. reject candidates outside the acceptable stability and control envelope;
3. compare safe candidates by progress or expected time loss;
4. use smoothness, robustness, and continuity with the current plan as
   tie-breakers.

A large progress benefit can never compensate for a hard rule or occupancy
violation.

### Optimize locally, validate broadly

The racing-line search uses cheap single-car evaluation. Only finalists receive
full production-physics validation. Pairwise traffic scenarios characterize
the best race-profile finalists. Full-grid races are an integration and
population check, not an inner-loop objective.

### Model uncertainty explicitly

Driver variation is expressed through meaningful, slowly varying properties
such as reaction time, path-tracking error, aggression, risk tolerance, focus,
grip use, and wet-weather skill. Independent random lateral decisions on every
traffic tick are not a substitute for a behavioral model.

## Target architecture

The initial implementation should add the minimum number of surfaces below.
Existing files should own the behavior when their responsibility already
matches.

```text
src/core/model.ts
  TrackProfile, profile provenance, trajectory-evaluation types

src/core/racing-line.ts
  profile materialization, path geometry, speed envelope, semantic markers

src/core/autopilot.ts
  one global path follower and longitudinal controller

src/data/track-profiles.ts
  compact committed generated profile data keyed by track id

src/game/tracks.ts
  build geometry, attach/validate a stored profile, derive line and speed

src/session/racecraft/paths.ts
  materialize runtime maneuver candidates through PathPlan/SampledPath

src/session/racecraft/traffic.ts
  behavior intent, candidate arbitration, and controller-facing selection

src/session/racecraft/corner-rights.ts
  protected side-by-side constraints and release

src/session/racecraft/priority.ts
  blue-flag and qualifying constraints, queueing, and release

src/session/pit.ts
  pit occupancy and space-time reservations

src/session/racecraft/config.ts
  only if needed: global, dimensioned, bounded racecraft calibration values

tools/optimize-track.ts
  one-track CLI, deadline owner, orchestration, output

tools/lib/headless-sim.ts
  production-code single-car and session runners

tools/lib/profile-search.ts
  bounded search implementation

tools/lib/profile-evaluate.ts
  multi-fidelity objective and finalist validation

tools/lib/track-characterize.ts
  bounded pair scenarios and rate collection

tools/lib/statistics.ts
  empirical quantiles, Wilson/binomial, and Poisson summaries

tools/benchmark-sim.ts
  reproducible throughput benchmark and optimizer forecast

tools/validate-track-profiles.ts
  fingerprint, deterministic, controller, and freshness validation

tests/unit/core/track-profile.test.ts
tests/unit/core/profile-optimizer.test.ts
tests/unit/session/maneuver-feasibility.test.ts
tests/unit/tools/statistics.test.ts
tests/fixtures/calibration/metric-policy.json
tests/fixtures/calibration/scenario-manifest.json
```

Do not split a listed file further merely to match the diagram. Split only
when a file has two independently testable responsibilities or boundary checks
would otherwise be violated.

## TrackProfile contract

The compact runtime profile contains data, not executable logic. Its initial
shape is conceptually:

```ts
interface TrackProfile {
  schemaVersion: 1;
  trackId: string;
  trackFingerprint: string;
  physicsFingerprint: string;
  optimizerVersion: string;
  status: 'normal' | 'acceptable';
  anchors: Array<{
    sFraction: number;
    lateral: number;
  }>;
  metrics: {
    estimatedLapTime: number;
    verifiedLapTime: number;
    maximumTrackingError: number;
    offCourseSeconds: number;
    robustnessScore: number;
  };
  provenance: {
    seed: number;
    budgetSeconds: number;
    evaluations: number;
    search: string;
  };
}
```

The exact TypeScript shape may be refined before Phase 3 exits, but these
properties are mandatory:

- schema version;
- track and physics fingerprints;
- normalized longitudinal anchors and lateral offsets;
- validation status and metrics;
- deterministic search seed and evaluation count;
- enough provenance to identify stale results.

Avoid embedding thousands of fully sampled points in source. Store a compact
periodic anchor representation and materialize the sampled arrays at track
build time. The materialized path must still use the existing typed numeric
arrays.

`src/data/track-profiles.ts` is a committed generated-data file. The optimizer
updates only the selected track entry using a stable serializer. A no-write run
must leave the worktree unchanged. Generated reports and evaluation caches live
under ignored `output/track-optimizer/`.

Fingerprints are deterministic content hashes over explicitly listed profile-
relevant track, physics, controller, and schema inputs. They never contain wall
time, filesystem metadata, absolute paths, or a generated timestamp.

If a new track has no stored profile, the game must build the deterministic
safe heuristic line and expose a diagnostic warning. A missing profile must not
make development impossible, but production/release validation must reject a
missing or stale profile.

## Headless simulation contract

The headless runner imports production TypeScript directly under Bun. It must:

- use `buildTrack`, `racing-line`, `botStep`, `makeCar`, `stepCar`, session
  stepping, collision handling, and racecraft modules rather than copies;
- use the repository's seeded random source rather than replacing random calls
  ad hoc;
- support fixed-step single-car laps, pair scenarios, and bounded full-session
  runs;
- disable UI event consumers without removing or reordering simulation events;
- emit stable JSON summaries;
- accept a hard deadline or maximum simulated-step count;
- have no dependency on a built browser bundle.

Deterministic parity does not require every floating-point intermediate to be
bit-identical if the current browser façade changes representation. It does
require identical state transitions, event order, lap validity,
classification, path choice, and random-call order, plus explicitly frozen
numeric tolerances for continuous state.

The existing Playwright tools remain responsible for file boot, UI, rendering,
and end-to-end parity. Once headless parity is proven, statistical simulation
must not launch a browser.

## Per-track optimization workflow

The public command is:

```sh
bun run optimize:track -- --track <track-id> --budget-seconds 900 --write
```

Supported normal budgets are 600–1200 seconds. The default is 900 seconds.
Without an explicit development-only override, the CLI rejects a value above
1200 seconds. The process must stop within five seconds after its deadline and
must reserve time for validation rather than spending the entire budget in
search.

The search also accepts a deterministic maximum-evaluation cap. Normal runs
stop at the earlier of the evaluation cap and wall deadline. Unit and CLI tests
use an injected monotonic clock or a test-only short budget plus a small
evaluation cap; they must not wait 10 minutes. Reproducibility claims compare
equal seeds and equal evaluation caps, while wall-budget runs separately prove
the user-facing time contract.

The command performs these stages.

The command **optimizes** line anchors, the resulting trajectory, and the
derived braking/speed profile. It **measures** contact, crash, overtake,
priority, and pit rates. Those measured rates may break a tie between similarly
fast race-profile finalists, but the command does not create per-track attack,
defense, collision, or priority policy constants. Global racecraft calibration
across all tracks owns those policies.

### Stage A — geometry and heuristic baseline

Maximum allocation: 60 seconds.

1. Build and fingerprint the track.
2. Validate finite geometry, width, pit geometry, semantic corners, and closed
   sampling.
3. Produce the existing deterministic outside–apex–outside/complex-aware line.
4. Derive its path geometry and speed envelope.
5. Run at least one production-physics lap after warm-up.

If the heuristic violates an invariant, optimization stops red because search
must not conceal invalid track construction.

### Stage B — reduced-cost profile search

Normal allocation: up to 50–60% of the total budget. Search stops early when
the final-validation reserve is reached.

1. Derive bounded lateral decision variables from semantic turn-in, apex,
   track-out, and linked-complex anchors.
2. Cap the initial decision space at 36 scalar variables. Group secondary
   complex anchors or reduce knots rather than exceeding this cap.
3. Reject candidates outside usable road bounds before materialization.
4. Evaluate feasible candidates using production path geometry and the
   analytical speed envelope.
5. Use a deterministic bounded pattern/coordinate search with seeded restarts
   and successive halving as the initial algorithm.
6. Keep a small Pareto set for lap time, smoothness, tracking demand, and
   robustness rather than one opaque weighted score.

An implementation may add CMA-ES only after the initial search demonstrably
fails the quality gate on at least two existing tracks while evaluator
throughput remains within budget. Bayesian optimization is not part of the
initial implementation.

### Stage C — high-fidelity finalist validation

Reserve at least 20% of the total budget.

1. Validate no more than the best eight reduced-cost candidates.
2. Run one warm-up lap and at least two measured laps using production physics
   and the global controller.
3. Apply a small fixed robustness matrix covering grip, initial lateral error,
   and speed error.
4. Reject off-course, non-finite, unstable, or untrackable candidates.
5. Select lexicographically: invariants, acceptable stability, robust lap time,
   then smoothness.

The safe heuristic remains a candidate. Search is never allowed to replace it
with a faster but invalid result.

### Stage D — bounded traffic characterization

Use no more than the remaining 10–15% of the budget and never steal the time
reserved to serialize a valid profile.

Run a fixed stratified sample of pair or small-pack scenarios against the best
race-profile finalists. Record, without claiming high precision:

- eligible catch count;
- attack and pass attempts;
- pass completion per eligible catch and per attempt;
- contact and hard-contact counts per side-by-side exposure;
- abort/tuck outcomes;
- blue-flag obstruction time;
- qualifying traffic time loss;
- pit conflict and false-blocking observations.

These results characterize the track and can choose between otherwise similar
race-profile finalists. They do not tune global racecraft rules independently
for each track.

If the sample is too small for a useful confidence interval when the deadline
arrives, the profile can still be written if deterministic validation is
acceptable. The report marks the stochastic characterization `provisional`,
and the full statistical suite owns release confidence.

### Stage E — output

The CLI writes:

- the selected compact profile when `--write` is supplied;
- `output/track-optimizer/<track-id>/report.json`;
- `output/track-optimizer/<track-id>/report.md`;
- optional candidate diagnostics needed to reproduce the decision.

The report includes wall time per stage, evaluation count, seed, baseline and
selected metrics, rejected-finalist reasons, confidence intervals, status,
fingerprints, and any simplification fallback taken.

Exit behavior:

- exit 0: all invariants pass and the selected profile is normal or acceptable;
- exit 1: an invariant or acceptable boundary fails, or no valid profile exists;
- exit 2: command/configuration/tool failure;
- amber normal-band excursions are reported but do not make exit status
  nonzero.

## Search objective and profile families

Do not search independent braking-point or apex-number knobs. Search the
compact line. Derive:

- curvature and path distance;
- speed limits;
- acceleration and braking envelope;
- braking onset;
- turn-in, apex, and track-out semantic observations;
- controller tracking demand;
- predicted and verified lap time.

The runtime recognizes two profile intents:

1. `qualifying`: fastest robust clean-air profile.
2. `race`: a profile within a small, globally configured lap-time tolerance of
   qualifying that improves robustness and maneuver feasibility when evidence
   supports a distinct choice.

Initially `race` aliases `qualifying`. Store a distinct race profile only after
bounded characterization shows a statistically meaningful advantage. Do not
create wet, tyre-saving, driver-specific, or setup-specific stored profile
families until evidence shows that runtime derivation from grip and pace
modifiers is insufficient.

## Runtime maneuver planning

The runtime planner remains intentionally small.

### Intent layer

The existing session logic determines a bounded intent:

- ideal/follow;
- attack left or right;
- defend;
- protected inside or outside;
- blue-flag or qualifying yield;
- priority pass;
- abort/tuck;
- pit path.

Intent state owns commitment, hysteresis, queueing, and release. It does not
directly steer the vehicle.

### Candidate layer

For each allowed intent, `paths.ts` creates at most a small fixed number of
smooth `PathPlan` candidates using current position, semantic corner anchors,
stored ideal profile, and usable road bounds. The normal target is no more
than six candidates for one car at one traffic update.

Candidates should use bounded lateral acceleration and jerk when moving
between corridors. Existing phase-varying plans may be retained if they meet
this contract.

### Feasibility layer

The initial prediction model samples vehicle oriented bounds or conservative
lateral/longitudinal intervals over a short horizon using current speed and a
bounded acceleration assumption. It rejects candidates that:

- leave usable road;
- conflict with an active protected corridor;
- intersect an occupied predicted envelope without a safe braking resolution;
- cross a priority beneficiary's committed path at the same time;
- violate pit crossing or merge reservations;
- require controller demand beyond the acceptable envelope.

Do not build a general polygon engine initially. If sampled rectangles are too
expensive, use conservative Frenet interval overlap. If constant-acceleration
prediction is insufficient, add one bounded braking branch before considering
a more complex predictor.

### Selection and control

Among feasible candidates, select expected progress/time loss, then continuity
with the current committed plan, then smoothness. Retain the selected plan for
its commitment window unless it becomes infeasible or a higher-priority rule
activates.

The existing `botStep` remains the controller. Controller tuning is global.
Per-track controller tuning is prohibited in the initial implementation.

## Race-rule constraints

The existing rules are retained and expressed as feasibility constraints:

- corner rights reserve inside/outside usable corridors from acquisition
  through physical release after track-out;
- a third car receives a corridor only when the actual width allocation is
  feasible; otherwise the rearmost car tucks;
- blue-flag and qualifying yielding suppress attack, defense, lunge, and tow,
  retain state through order/lateral changes, and release after physical
  clearance;
- queued priority beneficiaries share a compatible yield side without a
  return-to-line weave;
- an in-lap car committed to pit entry retains the pit path while priority
  traffic receives the road-side candidate;
- a stopped foreign car in a non-overlapping box is not a lane obstacle;
- same-team queues, box crossings, pit release, and merge traffic remain real
  occupancy conflicts.

Whether a pass takes 0.7 or 1.1 seconds longer is a statistical/performance
metric. Selecting an illegal defensive candidate under a blue flag is an
invariant violation.

## Statistical verification model

### Four classes

Every reported metric must be registered in
`tests/fixtures/calibration/metric-policy.json` with its unit, scope,
aggregation, distribution treatment, sample minimum, normal boundary,
acceptable boundary, any absolute boundary, rationale, and owning verifier.

1. **Invariant** — must never occur in any deterministic or stochastic run.
   One occurrence is red.
2. **Normal** — expected operating band. Leaving it is amber and does not fail
   if acceptable bounds and invariants still pass.
3. **Acceptable** — broader realistic safety/quality band. A statistically
   supported violation is red.
4. **Target** — optimization direction without pass/fail semantics.

### Initial invariant examples

- non-finite car, path, profile, session, or classification state;
- invalid lap/classification transitions;
- a generated path outside its legal usable-road bound;
- stale/mismatched profile used silently;
- planned crossing of an active protected corner corridor;
- priority state released solely because lateral separation changed the normal
  traffic reference;
- a new attack/defense/lunge decision while explicitly yielding;
- a foreign stopped pit-box car selected as a moving-lane leader when its
  physical envelope does not intersect the lane;
- drive-through overlap without collision or occupancy resolution;
- browser error, missing public API, or broken file entry;
- optimizer exceeding its hard deadline by more than five seconds.

A contact or crash is not automatically an invariant violation. A collision
caused by an already-rejected trajectory, invalid geometry, or ignored
protected corridor is.

### Distribution treatment

- continuous approximately symmetric residuals may use mean/standard
  deviation only after shape is inspected;
- pass/no-pass, contact/no-contact, and rule-compliance rates use binomial
  counts and Wilson intervals;
- crash/contact event counts per exposure use Poisson intervals unless
  overdispersion requires an empirical or negative-binomial treatment;
- lap times and time loss report median plus empirical 90th/95th/99th
  percentiles;
- minimum separation and other extremes use empirical tolerance bounds, not a
  normal assumption;
- track, weather, phase, and scenario class are separate strata before any
  aggregate is formed.

Implement Wilson, simple Poisson, and empirical quantile helpers locally.
Do not add a statistics dependency for the initial scope.

### Green, amber, red, and inconclusive

- **green:** invariants pass and the registered confidence/quantile result is
  inside the normal band;
- **amber:** invariants pass and the result is outside normal but inside the
  acceptable band;
- **red:** an invariant fails, the observed result exceeds an absolute bound,
  or the appropriate confidence result is outside acceptable;
- **inconclusive:** the confidence interval crosses an acceptable boundary.

An inconclusive per-track characterization increases samples only while budget
remains. At deadline it becomes provisional output, not fabricated certainty.
The larger release suite must resolve it before the relevant population claim
is considered proven.

Normal and acceptable values must be anchored to design intent, physical
limits, and a locked calibration dataset. They may not be widened because the
current implementation produced a bad sample. Calibration seeds and final
validation seeds must be disjoint.

### Verification tiers

`verify:fast` runs on ordinary development changes:

- typecheck and module boundaries;
- unit tests;
- deterministic invariants and focused race-rule scenarios;
- profile fingerprint/freshness validation;
- a small locked statistical smoke sample;
- development file boot.

`verify` additionally runs:

- all six track-profile controller validations;
- deterministic line, maneuver, pit, rights, priority, edge, and UI checks;
- the normal six-track dry/rain season sample;
- production file boot.

`verify:release` additionally runs:

- the larger disjoint stochastic scenario and season sample;
- confidence/quantile classification for every registered population metric;
- bundle/report manifests and visual-review evidence.

Only red results fail. Amber results are visible in terminal and JSON reports
and remain valid release outcomes unless a product decision explicitly
promotes that normal boundary to an acceptable boundary.

## Explainability and diagnostic contract

Every selected or rejected maneuver must be diagnosable without adding
per-frame production logging. Bounded diagnostic records should include:

- intent and selected candidate id;
- candidate path/corridor;
- objective rank;
- rejection constraint and conflicting car/reservation when applicable;
- active speed-cap reason;
- acquisition, commitment, handoff, and release reason;
- predicted and actual minimum separation.

Track optimization reports include the equivalent reasons for rejected
profiles. Checks should identify why a car braked or why a candidate lost,
rather than prompting another blind constant adjustment.

## Complexity budget and mandatory simplification gates

The initial solution has this complexity budget:

- one production physics implementation;
- one trajectory/path representation;
- one initial search algorithm;
- no new runtime dependency;
- at most three profile-evaluation fidelity levels;
- at most six runtime candidates per car per traffic update;
- no full-grid race in the line-search inner loop;
- global controller and global racecraft calibration values;
- fixed, short prediction horizon using sampled bounds or Frenet intervals.

At every phase exit, record elapsed tool time, new architectural surfaces,
runtime cost, test coverage, and whether the preferred approach met its gate.
Use the following fallbacks automatically when their trigger is proven.

| Trigger | Required simplification |
|---|---|
| Headless full-weekend parity requires browser/UI reconstruction | Keep single-car and focused session scenarios headless; retain Playwright only for full-weekend integration. |
| Evaluator forecast cannot finish one track within 20 minutes | Remove full physics from the broad search, reduce variables/anchors, use successive halving, and validate only finalists. |
| Search still exceeds 20 minutes after one evaluator optimization pass | Reduce decision variables to semantic anchors/complex groups and use the safe heuristic as the incumbent; do not add a more elaborate optimizer. |
| Pattern search fails quality on at least two tracks but evaluator throughput is healthy | Permit one bounded CMA-ES implementation or small pinned dependency after recording evidence. |
| Stored qualifying and race profiles are not meaningfully different | Store and use one profile for both. |
| Per-track controller tuning appears necessary | First fix global path tracking or widen only the evidence-backed normal band; do not add track-specific controller knobs. |
| Sampled oriented-box prediction is too slow at traffic cadence | Replace it with conservative Frenet longitudinal/lateral intervals. |
| Constant-acceleration prediction misses braking conflicts | Add one conservative braking branch; do not jump to full MPC. |
| General candidate generation destabilizes current racecraft | Keep the existing phase-varying PathPlans and add only feasibility rejection plus commitment. |
| Traffic characterization cannot reach narrow confidence within the per-track budget | Emit provisional intervals and defer population proof to `verify:release`; do not lengthen track optimization past 20 minutes. |
| Full statistical suite is too slow for per-commit use | Keep invariant and small stratified samples in `verify:fast`; run the locked large sample in `verify:release` or scheduled CI. |
| Disk caching adds invalidation complexity without measured benefit | Use an in-memory evaluation cache only. |
| A proposed abstraction has only one implementation and no independent test boundary | Keep it as a function/data type in the current owner rather than adding a framework. |

One bounded corrective iteration is allowed after a preferred approach first
misses its measured gate. If the second measured attempt still fails, take the
listed fallback. Do not continue tuning the preferred approach indefinitely.

If a listed fallback would violate an invariant, the 20-minute hard budget, or
a required user-visible race rule, stop and request a material product decision
instead of silently weakening the requirement.

## Implementation phases

### Phase 0 — Freeze the pivot baseline

1. Preserve the current worktree and inventory what is implemented, partially
   implemented, and failing.
2. Record current tool versions, bundle hashes, test modes, profile/trajectory
   metrics, and known Phase 12 failures.
3. Map every current deterministic assertion to invariant, normal,
   acceptable, target, or obsolete.
4. Keep old baseline fixtures immutable; add a pivot manifest rather than
   rewriting historical evidence.

Exit gate:

- strict TypeScript and module boundaries run;
- current build/file boot status is recorded;
- no production behavior changed;
- every old racecraft threshold has an explicit new classification;
- the implementation report identifies reusable current modules.

Simplification gate: do not reproduce every old browser fixture in the new
headless system. Preserve only externally observable parity and still-relevant
invariants.

### Phase 1 — Metric policy and statistical primitives

1. Add the locked metric-policy and scenario manifests.
2. Implement local empirical quantile, Wilson interval, Poisson interval, and
   stratified aggregation helpers.
3. Teach tool output to classify green/amber/red/inconclusive without changing
   production behavior.
4. Reclassify existing season and follow-up metrics. Keep rule violations hard;
   move plausible timing/rate variation to normal and acceptable bands.
5. Add unit tests using known small samples and edge cases.

Exit gate:

- statistic tests are deterministic and finite;
- one normal excursion proves amber exit 0;
- one acceptable violation proves red nonzero exit;
- one invariant occurrence fails immediately;
- changing calibration data cannot change locked validation data.

Simplification gate: use only the four local statistical primitives above. Do
not build a generic statistics framework.

### Phase 2 — Pure headless runners and performance benchmark

1. Add single-car and focused session runners that import production code.
2. Add deterministic browser/headless parity fixtures for representative
   clean laps, pair interactions, pit flow, priority, and classification.
3. Add `benchmark:sim` with warm-up, repeated samples, median and spread.
4. Forecast the evaluation count possible in 10, 15, and 20 minutes.
5. Remove browser launches from statistical tools once parity is proven.

Exit gate:

- no DOM/browser imports in the headless runner dependency graph;
- no duplicate physics, controller, collision, or racecraft implementation;
- fixed seeds reproduce the same summary;
- browser/headless state transitions and events match;
- measured throughput supports a credible one-track plan under 20 minutes.

Apply the headless-parity simplification fallback if full-weekend composition
is the only blocker.

### Phase 3 — TrackProfile schema and safe baseline

1. Add the compact profile schema, fingerprints, stable serializer, and
   materializer.
2. Convert the current semantic line into a deterministic heuristic profile.
3. Generate baseline entries for all six tracks without yet claiming
   optimization improvement.
4. Make runtime track construction attach a matching profile or use the
   explicit development fallback.
5. Add missing/stale profile diagnostics and release rejection.

Exit gate:

- all six compact profiles round-trip deterministically;
- materialization stays within usable road bounds and produces finite geometry
  and speed arrays;
- heuristic and serialized-profile behavior match within frozen tolerance;
- a missing profile works only through the explicit development fallback;
- stale fingerprints fail profile validation.

Simplification gate: store only qualifying/clean profile data initially. Add a
separate race profile only after Phase 5 produces evidence that it matters.

### Phase 4 — Bounded per-track optimizer

1. Implement the staged CLI and central deadline.
2. Implement bounded semantic-anchor variables and cheap rejection.
3. Implement deterministic pattern search, seeded restarts, Pareto retention,
   and successive halving.
4. Validate finalists in production physics and select against the safe
   heuristic incumbent.
5. Add short-budget CLI tests and deadline/watchdog tests.
6. Run full-budget generation for each existing track once and record results.
7. Add a controlled suboptimal-profile fixture for which the selected profile
   must make a clear verified improvement, proving that search is not a no-op.

Exit gate:

- the command supports one track, no-write, write, seed, JSON output, and a
  600–1200 second budget;
- it stops within five seconds of the deadline;
- it never writes an invalid profile;
- every existing track returns at least the safe acceptable baseline within
  20 minutes on the reference machine;
- the controlled suboptimal fixture improves by its frozen expected margin;
- the existing-track report shows meaningful verified improvement on at least
  one track or supplies measured controller-noise/convergence evidence that the
  heuristic incumbent could not be improved; merely returning the heuristic
  without exploring is a failure;
- repeated runs with the same seed and evaluation cap select the same profile;
- independent wall-budget runs satisfy the deadline and record any difference
  caused by completing different evaluation counts;
- output distinguishes best-found from globally optimal;
- no track-specific search or controller constant is added.

Apply evaluator/variable/search simplifications before considering a more
advanced search algorithm.

### Phase 5 — Production profile and controller integration

1. Use the selected profile for runtime ideal path construction.
2. Derive the speed profile, braking points, and semantic observations from the
   same materialized path.
3. Validate the global controller over all profiles and the fixed robustness
   perturbations.
4. Compare predicted versus actual lap time and marker tracking.
5. Keep browser rendering and `window.__GL` diagnostics compatible.

Exit gate:

- clean-air cars complete stable laps on all tracks, dry and wet;
- each isolated corner visibly opens, approaches the inside apex, and unwinds;
- linked complexes use the optimized compromise rather than contradictory
  independent anchors;
- profile/controller invariants are red-free;
- normal excursions are reported amber rather than hidden;
- file boot and production bundle smoke remain green.

Simplification gate: if profile-following instability remains isolated to the
controller, fix the one global controller. Do not compensate by distorting
individual track profiles.

### Phase 6 — Bounded maneuver candidates and feasibility

1. Inventory existing phase-varying PathPlans and retain the safe ones.
2. Add a bounded candidate interface without replacing `PathPlan` or
   `SampledPath`.
3. Add road-bound, controller-demand, protected-corridor, and predicted-
   occupancy feasibility checks.
4. Add commitment/hysteresis and explicit rejection diagnostics.
5. Test left/right, straight/approach/corner, wet/dry, order flips, abort, and
   three-car feasibility.

Exit gate:

- no more than six candidates are evaluated per car at one traffic update;
- candidates and predictions remain finite and inside the measured traffic
  cadence budget;
- planned protected-corridor crossings are zero invariants;
- attack, defense, side-by-side, yield, pass, and tuck paths vary by phase;
- no plan switches without an intent, infeasibility, or release reason;
- current safe racecraft behavior does not regress beyond acceptable bands.

Apply the existing-PathPlan-plus-feasibility fallback before designing a more
general trajectory planner.

### Phase 7 — Rules, priority, and pit integration

1. Express corner-rights assignments as feasibility constraints.
2. Express blue flags and qualifying preference as intent suppression,
   compatible yield/pass candidates, queueing, and physical release.
3. Express pit lane, box crossing, queue, release, and merge conflicts as
   occupancy/reservation constraints.
4. Remove redundant local caps or lateral commands only after equivalent
   constraint behavior is proven.
5. Run complete deterministic detection-to-release scenarios.

Exit gate:

- every eligible rule scenario creates the correct persistent state;
- no illegal attack/defense/lunge occurs while yielding;
- corner rights survive sort/order/timer changes through release;
- stopped non-overlapping foreign boxes never become lane leaders;
- real same-team, crossing, and merge conflicts still wait safely;
- all rule invariants are green;
- pass delay, qualifying loss, obstruction, and contact are classified through
  normal/acceptable policies rather than one brittle sample.

Simplification gate: retain conservative braking and current persistent state
machines if the predictive candidate system cannot improve them without
violating the traffic-cadence budget.

### Phase 8 — Racecraft calibration and track characterization

1. Build a stratified deterministic scenario generator for eligible catches,
   side-by-side exposure, priority, and pits.
2. Use common random numbers when comparing policies or profile finalists.
3. Centralize only meaningful global calibration values with units and bounds.
4. Use sensitivity analysis to remove parameters with negligible effect.
5. Calibrate against the calibration set and validate on disjoint seeds.
6. Add a bounded deterministic near-contact boundary sweep for invariant
   discovery and unbiased sampling for rate estimation.

Exit gate:

- no per-track racecraft magic constants;
- each reported rate has exposure, sample count, stratum, and interval;
- plausible individual incidents may be amber/green, while implausible rates
  are red;
- pass production, contact, hard contact, off-course, side-by-side time,
  priority loss, and pit waits are within acceptable population bands;
- candidate/policy changes are validated on held-out scenarios.

Simplification gate: calibrate a small global parameter set only. If sensitivity
shows more than eight materially independent racecraft values, revisit the
model before adding an optimizer dimension.

### Phase 9 — New-track workflow and 20-minute proof

1. Document how to add a `TrackDefinition` and run the optimizer.
2. Add a non-production new-track fixture to exercise missing-profile,
   optimization, write, freshness, and validation flows.
3. Run a fresh one-track optimization without a warm cache on the reference
   machine at 600, 900, and 1200 second budgets.
4. Confirm reports identify convergence, quality, provisional statistics, and
   fallback status.
5. Add a command that validates every committed profile without reoptimizing.

Exit gate:

- `bun run optimize:track -- --track <id> --budget-seconds 900 --write` is the
  documented default;
- the cold 1200-second run stops on time and returns a normal or acceptable
  profile for the fixture;
- a 600-second run returns at least the safe acceptable incumbent or a clear
  red geometry/profile error;
- no browser is launched;
- the generated profile immediately builds into the file-compatible bundle;
- stale profile detection works after changing track geometry or physics.

The hard budget cannot be waived to obtain a green test. Apply the documented
simplifications or retain the safe baseline.

### Phase 10 — Integration, visual review, and release gates

1. Add the final package scripts and ordered verification pipeline.
2. Run deterministic invariants before stochastic suites.
3. Run all six tracks, dry/rain, calibration and held-out seeds through the
   appropriate verification tier.
4. Perform 1x visual review of optimized clean lines, linked complexes,
   attacks, defenses, protected corners, priority yielding, pit flow, and
   representative amber incidents.
5. Record bundle size/hash, module graph, tool versions, benchmark results,
   profile fingerprints, metric policy, full matrix, and simplification
   decisions.
6. Create `racecraft_optimization_implementation_report.md`.

Exit gate:

- `bun run verify:fast`, `bun run verify`, and `bun run verify:release` have
  the documented behavior;
- all invariants and acceptable boundaries are green;
- amber normal excursions are visible and correctly non-failing;
- development and minified file boots are green;
- optimizer and profile validation commands are reproducible;
- the season and scenario reports contain no inconclusive claim required for
  release;
- visual evidence is reviewed at 1x;
- the definition of done below is proven item by item.

## Required package scripts

The implementation may refine names only before Phase 0 exits. The intended
public contracts are:

| Script | Contract |
|---|---|
| `benchmark:sim` | Benchmark production headless single, pair, and session throughput. |
| `optimize:track` | Optimize one selected track under a central wall-clock budget. |
| `validate:profiles` | Validate all profile fingerprints, geometry, controller behavior, and committed data. |
| `test:invariants` | Run deterministic geometry, trajectory, rule, pit, and state invariants. |
| `test:stats:fast` | Run the small locked stratified stochastic sample and classify results. |
| `test:stats:full` | Run the disjoint release-size population sample and confidence checks. |
| `verify:fast` | Build, boundaries, unit, invariants, profiles, fast stats, and development smoke. |
| `verify` | `verify:fast` plus all deterministic browser checks, normal season sample, and production smoke. |
| `verify:release` | `verify` plus full statistics, report manifests, and release evidence. |

Existing public build/test scripts remain valid unless explicitly folded into
these ordered commands. Browser-dependent scripts still reject a stale bundle.

## Performance budgets

Performance is a contract, not an afterthought.

- Track optimization default: 900 seconds.
- Track optimization supported range: 600–1200 seconds.
- Absolute normal-mode track deadline: 1200 seconds plus at most five seconds
  cleanup.
- Search must reserve at least 20% for high-fidelity validation.
- Runtime candidate count: at most six per active car per traffic update.
- Runtime feasibility must fit the existing traffic cadence with headroom;
  benchmark the 95th percentile, not only the mean.
- `verify:fast` should remain suitable for ordinary development. If full
  statistics violate that goal, use the mandated tiering fallback rather than
  reducing statistical release coverage.

The implementation report records the reference machine CPU, runtime versions,
worker count, and measured medians. Wall-time claims without this provenance
are not completion evidence.

Parallel work may use a bounded local worker pool after deterministic serial
results are proven. The default worker count must leave one logical CPU free
and produce the same selected result for a fixed evaluation budget. Do not add
parallelism before profiling shows evaluation throughput is the budget blocker.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Search overfits six existing tracks | Calibration/validation split, bounded semantic variables, and a new-track fixture. |
| Optimizer exploits an analytical approximation | Production-physics finalist validation and safe heuristic incumbent. |
| Fastest line is fragile | Fixed perturbation matrix and lexicographic robustness gate. |
| New profile changes braking and controller behavior inconsistently | Derive geometry, speed, braking, and semantic observations from the same materialized path. |
| Tool and browser simulations diverge | Import production code, freeze random/event order, and keep parity fixtures. |
| Statistics normalize an existing bug | Anchor acceptable bounds to design/physical intent and use disjoint locked validation. |
| Rare catastrophic bugs evade Monte Carlo | Deterministic invariants and bounded near-contact boundary scenarios. |
| A single plausible crash fails every build | Rate/exposure policies with appropriate intervals and broader acceptable bands. |
| A high crash rate hides behind individually plausible events | Population acceptable bounds and release-size samples. |
| Runtime prediction becomes a physics engine inside the physics engine | Short conservative occupancy prediction with explicit simplification gates. |
| Per-track optimization becomes per-track racecraft tuning | Profiles own line anchors only; racecraft values remain global. |
| The 20-minute goal is met by skipping validation | Central deadline reserves validation time and rejects invalid output. |
| Advanced algorithms consume the project | Pattern search first; evidence gate before CMA-ES; no RL/MPC initial scope. |
| Reports claim precision from too few samples | Provisional status and deferred release confidence. |
| Existing good work is lost in the pivot | Audit/reuse first and preserve old fixtures as historical evidence. |

## Definition of done

The pivot is complete only when all of the following are proven:

- The strict TypeScript module, boundary, file-bundle, HTML, and public API
  guarantees retained from `racecraft_followup_plan.md` still pass.
- The headless runner imports production simulation code and has no DOM,
  browser, duplicate physics, duplicate controller, or duplicate racecraft
  implementation.
- Browser/headless parity is frozen for representative clean, traffic, pit,
  priority, event, lap, and classification behavior.
- All committed tracks have compact, matching, versioned profiles with
  provenance and stable serialization.
- A missing profile has an explicit development fallback, and release checks
  reject missing or stale profiles.
- Clean-air path geometry, speed profile, braking onset, semantic markers, and
  controller target all derive from the same materialized profile.
- The one-track optimizer starts from a safe heuristic, uses staged fidelity,
  reserves validation time, never writes invalid output, and stops within the
  20-minute hard budget.
- On the reference machine, every existing track and the new-track fixture
  returns at least an acceptable validated profile within 1200 seconds without
  a warm cache.
- Optimizer reports say `best validated within budget`, not `global optimum`,
  and include all required timing, provenance, rejection, and status evidence.
- Runtime attack, defense, protected side-by-side, yield, pass, tuck, and pit
  paths are phase-varying, bounded, committed, and feasibility checked.
- Corner rights, blue flags, qualifying priority, and pit occupancy retain the
  required persistent and physical behavior with zero invariant violations.
- No per-track controller or racecraft magic constants are introduced.
- Crash, contact, pass, side-by-side, priority-loss, and pit-wait metrics are
  normalized by meaningful exposure and reported with appropriate intervals.
- Normal excursions are amber and non-failing; acceptable or invariant
  violations are red and failing; inconclusive population claims are not
  presented as complete.
- The full held-out scenario and six-track dry/rain season suites are inside
  acceptable population bands without weakening rule or state invariants.
- The required simplification fallback is taken whenever a measured trigger is
  reached, and every such decision is recorded.
- `verify:fast`, `verify`, and `verify:release` pass according to their stated
  contracts.
- Development and minified bundles boot through both file entry paths with no
  browser errors, and representative behavior has been visually reviewed at
  1x.
- `racecraft_optimization_implementation_report.md` maps every phase and every
  definition-of-done item to files, commands, measured results, profiles,
  statistical classifications, performance budgets, and simplification
  decisions.

Do not declare completion from a small green sample, from the optimizer merely
timing out, or from absence of an obvious error. Completion requires the
current-state evidence named above.
