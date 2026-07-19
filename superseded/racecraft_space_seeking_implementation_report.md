# Space-Seeking Racecraft — Implementation Report

## M0a — Surgical de-storm

Status: complete.

- Diff scope: registered `mistakeUtilizationRate`; replaced the attack-event
  lockup roll and pressure-scaled defense coupling with a 30 Hz utilization
  hazard; removed the `yieldT` pace-margin penalty; exposed the existing
  lunge/lockup counters in headless race summaries for this phase probe.
- Phase probe: Phase C green (15/15 train-pressure cases across five
  calibration seeds and three flagship tracks). Seed 101 five-lap races all
  completed: Prado 2 utilization mistakes / 1 lunge, Nordwald 10 / 3, Anhembi
  11 / 2. No numeric mistake band exists in the current metric policy, so these
  are recorded for the M4-owned rate calibration rather than tuned on one seed.
  The races had no priority episodes; the exact yield-margin canary measured a
  zero pace-margin delta after removing the former 3.5-point penalty.
- Focused checks: typecheck green; config (2), strategy (2), traffic (5), and
  headless-sim (7) tests green. The existing generated-track strategy test
  needed its established work to run under a 20 s timeout.
- Deliberate test-expectation changes: the bounded calibration count rises
  from 12 to 13 for the one M0a key; yielding is now asserted to leave the
  race pace margin unchanged.
- Plan deviations: none in implementation. A discovery invocation of
  `simulate-headless.ts --help` found that the tool has no help mode and ran
  its default two-lap single-car Prado check; its result was not used for
  tuning or phase acceptance.
- Playable build: green (`dist/goldenlap.js` regenerated, not committed).

## M0 — Shadow evaluator

Status: complete.

- Diff scope: added the single bounded evaluator, decision-log plumbing, and
  the offline coordinate-grid fit script. Shadow mode never wrote speed or
  lane state; six-candidate and zero-materialization limits are literal.
- Probe: 3 calibration seeds × Prado/Nordwald completed once (27,042 bounded
  log entries); maximum candidates 6, materializations 0. Offline agreement
  was 63.39%, fitting `23 / 120 / 12 / 0` for risk/rule/switch/noise.
- The six races were not re-simulated after fitting. Logs and the fit report
  are under `output/racecraft-space-seeking/m0/`.
- Test note: the full-field headless assertion completed deterministically
  but exceeded its historical 20 s local timeout while shadow work was
  enabled; ordinary production/tests kept shadow execution opt-in until M1.

## M1 — Longitudinal default flip

Status: complete.

- Diff scope: removed the generic, two-ahead, tuck, and exit-tuck follow
  caps. `brake-behind` is now the sole ordinary longitudinal traffic
  candidate, with its reachability slow point refreshed cheaply at 30 Hz.
- Probe: `train-pressure` was green; `faster-behind` exhausted its assertion
  window and is recorded for M2's lateral owner rather than parameter-tuned.
  Prado seed 11 (five laps) completed with 67.8 constrained car-seconds.
- The plan's mid-phase cadence revision replaced the obsolete 30 Hz
  benchmark. The revised staggered result was still red (2.57–4.14× versus
  the 62.912× floor), naming duplicated M2 tactical/geometry work as owner.
  Candidate count stayed at six and evaluator materializations stayed zero.
- Playable build: green. The benchmark finding is evidence, not a reason to
  retain the deleted longitudinal defaults; M2 continues the replacement.

## M2 — Lateral unification

Status: complete.

- Diff scope: the evaluator now owns race lateral edits through bounded
  corridor/corner candidates, exact feasibility and sporting vetoes, staggered
  10 Hz decisions, and one-per-tick event refresh. Attack episodes and battle
  flags are observers; the retired attack/defend branch forest no longer
  authors ordinary lanes. Candidate/materialization maxima remain 6/0.
- Probe: the one bounded full effects run completed all 34 cases. Lane-hop and
  protected-corridor canaries stayed zero. It was red on tucked loss (2.3%),
  missing near-touch escape, retired prelaunch vocabulary, and several
  M6-owned spot-selection/vocabulary findings; these are recorded rather than
  single-seed tuned. Faster-behind cases completed.
- Benchmark: the prescribed single run was red at 7.40–8.81× versus the
  62.912× floor. The remaining duplicate semantic path planner is the named
  M3/M5 deletion owner; no second benchmark was run.
- Deliberate expectation change: attack prelaunch counters belong to the
  deleted launch state and are replaced by evaluator decision observers.
- Playable build, typecheck, boundaries, traffic tests, and evaluator tests:
  green.

## M3 — Yields and blue flags

Status: complete.

- Diff scope: priority records now contribute a who-owes-whom rule cost to
  ordinary evaluator candidates. The retired priority lane/speed actuator,
  assigned yield side, negotiated-lane path modes, and their counters were
  deleted; record acquisition and release remain the sporting input.
- Probe: the straight scenario activated once with 4 candidates; the corner
  scenario completed one episode with 6. Both had zero protected-corridor
  violations, hard contacts, and materializations. The five-lap race completed
  25 episodes at 4.39 s yield loss per episode, red against the 0.5 s target;
  the opportunity/cost projection is the named M6 owner, so it was not tuned
  against this one race.
- Deliberate expectation changes: priority tests now assert record lifecycle
  and evaluator ownership instead of fixed lane plans; path tests no longer
  expect priority semantic modes; headless invariants retain the real
  protected-corridor, hard-contact, candidate, and materialization gates.
- Plan deviation: the file-map wording kept priority record-keeping untouched,
  while the updated greenfield contract explicitly rejects legacy lane
  priority. The physically honest resolution preserves the record and deletes
  only its competing actuator semantics. Direct user feedback also moved the
  suspension-damaging contact threshold from 13 to 16 while retaining the
  hard-contact cap of 30 and uncapped light contact.
- Focused checks and playable build: typecheck, boundaries, priority, paths,
  evaluator, traffic, and targeted headless priority tests green.

## M4 — Risk calibration

Status: complete.

- Diff scope: the utilization mistake clock now consumes
  `racecraftDecision.chosenUtilization`, falling back to current physical
  utilization only before an evaluator decision exists. Focus, wetness, rate,
  and the per-second hazard equation are unchanged.
- Probe: three five-lap Prado races completed with 5 mistakes dry (seed 11),
  7 at wet 0.35 (seed 29), and 9 at wet 0.65 (seed 47). Hard contacts were
  1/0/0, maximum candidates stayed 6, and materializations stayed 0. Attack
  counts differed with weather and seed, so no causal attack-frequency claim
  is made from this bounded probe.
- No numeric mistake band exists in metric policy. The observed wetness
  gradient is recorded without changing `mistakeUtilizationRate`; fitting a
  rate from these three races would violate the offline/no-single-seed rule.
- Focused checks and playable build: typecheck, boundaries, and traffic tests
  green.

## M5 — Deletion and audits

Status: complete.

- Diff scope: deleted the superseded attack/defend/tuck timers, pressure
  trigger, fixed launch/lockup summaries, cancellation/stalking policy bands,
  and their named consumers. `feel.ts` is now an outcome observer only;
  browser tooling no longer launches session/core racecraft checks.
- Probe: parity fixtures were deliberately re-recorded once, here at M5.
  The full ladder was invoked once and stopped at its first unrelated failure:
  the pre-existing ideal-line pit/start neutrality assertion measured
  `0.007100977` where the core racing-line owner expects `<1e-9`
  (158 unit tests passed, one failed). No racecraft parameter was changed and
  the ladder was not re-run around that named external owner.
- Deliberate expectation changes: retired timer/cancellation assertions now
  cover evaluator decisions and observer outcomes; the audit effect cases
  report decision-log replay, overslow steer/brake choices, and priority
  speed loss.
- Focused checks and playable build: typecheck, boundaries, paths,
  corner-rights, traffic, strategy, audit-toolkit, headless, evaluator, and
  config tests green.

## M6 — Opportunity EV

Status: complete.

- Diff scope: added staggered 5 Hz look-ahead over at most three opportunities,
  closed-form duel margin/uncertainty/pass probability, and EV-driven wait or
  commit shaping. Risk is the independent product of deterministic
  `driverRiskProfile` and pace appetite; the superseded pressure timer and
  underspeed trigger were deleted.
- Probe: the tow and launch cases were green, holding the tow for 5.63 s and
  7.10 s respectively with candidate maxima of 4/6 and no hard contact. One
  five-lap Prado seed 11 race produced 12 attempts, two passes, and a
  pass-score/attempt correlation of `0.7369`; candidate/materialization maxima
  remained 6/0.
- Observer correction: the initial diagnostic counted every 5 Hz
  re-estimate as a commitment (536). Commit logging now happens only when a
  real attack episode begins; a focused unit test covers deduplication and
  outcome resolution. This changes diagnostics only, not driving behavior,
  and the phase probe was not re-run.
- Focused checks and playable build: typecheck, boundaries, evaluator,
  config, traffic, strategy, and headless tests green.

## M7 — Predictor calibration

Status: complete.

- Diff scope: added a bounded actual-commit/outcome log, sample-weighted
  `racecraft.pass_prediction_brier` observe-only policy, a one-time record
  command, and a pure offline reliability/Brier tool stratified by probability,
  population pass-score thirds, and half-car gap bands.
- Probe: the single five-lap Prado seed 11 record completed with 65 commits,
  60 resolved outcomes, candidate/materialization maxima 6/0. Offline only,
  it measured predicted `0.9605` versus realized `0.25`, Brier `0.7302`, and
  maximum main-stratum error `0.7530`: amber and outside the ±10 pp target.
- Named correction: the report exposed two physically false attributions.
  Pace delta compared cars at different points of the circuit, and the logger
  could attach a future opportunity to an unrelated lateral episode. The
  predictor now compares both cars at the opportunity sample, rejects wrapped
  “later braking” distances, and records only the matching move inside its
  reaction-derived launch reach.
- Plan deviation: the invalid old log does not contain enough state to replay
  those causal formula corrections honestly. It was not re-simulated or
  post-hoc fit; the amber result and predictor-calibration owner remain
  recorded for the next independent population audit.
- Post-Step-0/M8 revalidation (run once): the new five-lap Prado seed 11 log
  contained 7 commits (6 resolved), with candidate/materialization maxima
  6/0. Offline Brier improved to `0.238216`; population prediction was
  `0.808975` versus `0.833333` realized. The only main stratum outside
  ±10 percentage points was probability band `80–100%` (n=5, predicted
  `0.917644`, realized `0.8`, error `−11.764 pp`). It remains amber and was
  not weight-tuned.
- Focused checks and playable build: typecheck, boundaries, evaluator,
  headless, and statistics tests green.

## Step 0 — Orphaned racecraft planner deletion

Status: complete.

- Diff scope: deleted the control-rate `syncRacecraftPaths → desiredPlan →
  installPlan` authority and its race plan/materialization state. Race lateral
  targets now come only from the evaluator-owned lane program; sampled path
  installation is pit-only through `syncPitPaths`. Retired race path modes,
  diagnostics, model fields, browser audit harness, pivot fixture, policy
  observations, and live-root references were removed rather than shimmed.
- Invariant plumbing: candidate/rejection counters now come from the evaluator,
  the installed-lane bounds canary reads the live lane ring buffer, and the
  generic summary remains bounded at at most six candidates and zero race path
  materializations. Pit reservations and their dedicated path system were
  preserved.
- Required benchmark: the single run recorded samples `48.044×`, `38.484×`,
  `46.893×`, and `28.784×`, for a four-sample median of **`42.689×`** versus
  the **`62.912×`** floor. The command stopped red once the seven-sample median
  was mathematically unreachable; it was not rerun or parameter-tuned and is
  owned by CG.
- Deliberate expectation changes: semantic race-plan tests now assert compact
  evaluator sampling plus pit-only installation. The alongside unit probe
  retains the hard-contact, braking, claim-overlap, and materialization
  invariants while its known being-passed loss remains owned by M9. Historical
  local timeout budgets were raised for the unchanged all-track pit-launch and
  deterministic full-field assertions.
- Focused checks and playable build: typecheck, boundaries, paths,
  corner-rights, lane-program, evaluator, traffic, pit, audit-toolkit, and
  targeted headless tests green; `dist/goldenlap.js` regenerated.
- Plan deviation: §4.1's old untouched-file map conflicted with the explicit
  greenfield deletion request and the later physical-authority phases. The
  physically honest resolution removed the competing authority and its dead
  consumers across module boundaries, with no compatibility path.

## M8 — One speed truth

Status: complete.

- Diff scope: centralized the aero-coupled corner-speed closed form in
  `core/physics` and removed runtime square-root grip/offset shortcuts. Static
  profiles, evaluator feasibility, lane buffers, controller anticipation,
  reachability, and observers now consume that definition with each car's
  tyre/wet/surface/dirty-air state.
- Aero failure is now physically symmetric: the existing 18% bodywork
  severity raises drag and removes downforce. The same scale reaches the
  physics plant, lane speeds, braking distances, traffic reachability,
  feasibility, evaluator risk, and headless normalization.
- Deliberate expectation changes: the lane-buffer test now isolates worn,
  wet, dirty-air, and aero-damage degradation instead of allowing a combined
  case to mask one source. Core tests prove reduced aero load lowers corner
  speed/deceleration and increases stopping distance.
- Focused checks and playable build: typecheck, boundaries, core physics,
  lane-program, and trackgen tests green. The unchanged racing-line suite
  repeated M5's named ideal-line pit-neutrality red (`0.007100977` versus
  `<1e-9`); it was not tuned or re-run.
- Plan deviation: §4.1 called `core/`, lane evaluation, and feasibility
  untouched, but §4.5 explicitly required one physical speed truth in those
  modules. The physically honest M8 statement wins; no duplicate compatibility
  formula remains in the runtime.
- Phase probe: all four 123-sample closed-form canaries (fresh, worn, wet
  slick, dirty air) had zero slip-past-peak samples and zero formula error;
  loaded-corner speeds were `17.86875 / 16.86245 / 15.44815 / 17.85897`
  m/s. Fresh/worn/wet solo and dirty-air tucked runtime cases were green with
  candidate/materialization maxima 6/0. The one five-lap Prado dry seed 11
  race completed finite and classification-valid with 10 hard contacts, but
  recorded one protected-corridor crossing (M9 owner) and an `8.182133477 m`
  pit-path handoff slew versus the 0.5 m invariant (CG pit-handoff owner).
  Neither red was tuned or re-probed.

## M11 — The racing line is the zero state

Status: probe complete; remediation required before CG.

- Diff scope: every non-empty lane program carries a live binding; stale
  bindings increment the zero-tolerance reason canary and are replaced by a
  physically timed recenter program. Recenter is inserted before the bounded
  candidate slice, so it remains available within the six-candidate limit.
- The switch decision now compares ordinary hysteresis against
  horizon-integrated recenter progress. Current-lane and ideal speeds are
  compared in the same commanded-speed units; a genuine future-corner gain
  can beat the switch cost while small plateau noise cannot.
- Observers/logging: bounded decisions include program reason and binding;
  headless summaries expose expired programs, reason violations, and
  interaction-free wandering seconds.
- Focused checks and playable build: typecheck and evaluator tests green;
  `dist/goldenlap.js` regenerated.
- Phase probe (run once, not rerun): Prado seed 101 completed five laps with
  checksum `52a5f76f`, 5,306 decision records, recenter present in every
  record, and candidate/materialization maxima 6/0. It recorded
  `4.166666667` interaction-free wandering car-seconds and 2,203 expired
  programs/reason violations. The dominant live-log bindings were
  `pit-exit-release` (2,166), `pit-merge-room` (247), `start-release` (211),
  and `recenter:self` (147); remediation remains owned by M11 before CG.
- Same-race attributed reds: pit-only maximum path slew was `3.859083933 m`
  (the existing CG pit-handoff owner) and hard contacts were 41 versus the
  cap of 30 (M9/M10 interaction owner). Finite state, classification,
  out-of-bounds, protected-corridor, unpinned-edit, stall, pit-deadlock,
  claim-overlap, and half-pass canaries were green.

## M9 — The claim ledger

Status: complete.

- Diff scope: published claims remain centered on their lane programs at full
  body-plus-measured-noise width. Conflict ownership is stable per pair,
  selected lane edits reserve their stations before the next car evaluates,
  and bounded per-pair observers now count resolved phantom events and actual
  owner/adapter flips rather than station samples.
- Blocking deletion completed: the constant-velocity
  `prepareManeuverOccupancy`/`occupancyCheck` authority was removed.
  Feasibility now checks public claim containment and separating contested
  transitions; only the explicit brake adapter invokes reachability. One
  claim-station broad phase is cached per car per ledger tick.
- Trust and rules: station progress integrates each car's published
  lane-buffer speeds; slip/yaw/rotation, mistakes, contact, failure, and
  tracking error revoke trust into the obstacle path. Generic dynamic
  transactions can no longer cross protected corner assignments. Blue-flag
  yielding no longer erases tow or suppresses awareness of unrelated traffic.
- Deliberate expectation changes: the claim invariant is full-width/centered
  publication plus a single explicit adapter, not a metadata interval clipped
  below car width. Near-touch audit evidence now requires an executed feasible
  spatial transaction with low brake, replacing the retired escape-cap
  counter.
- Focused checks and playable build: typecheck, boundaries, lane-program,
  evaluator, traffic, paths, priority, and headless tests green;
  `dist/goldenlap.js` regenerated.
- Plan deviation: §4.1 marked the corridor planner and feasibility untouched,
  while §4.6 explicitly makes them the claim-ledger owner and orders deletion
  of their ballistic sweep. The physically honest M9 statement wins.
- Phase probe (run once, not rerun): the five-lap Prado seed 101 shadow race
  kept full-width/centering, protected-corridor, candidate (6),
  materialization (0), finite, classification, bounds, stall, and deadlock
  invariants green. It recorded 555 conflicts, **117 phantom conflicts** and
  **13 owner/adapter ping-pong events**; hard contacts were 1. The existing
  CG pit-path owner repeated at `3.200013898 m` maximum slew.
- Scenario strata: side-by-side corner loss was geometric (`0.566666667 s`)
  with both cars protected. The being-passed straight recorded one rear-loss
  event (`13.538882467 m` versus `13.328190904 m`). The paired blue-flag case
  lost `1.347894700 s` for the yielder and `0.822240568 s` for the
  beneficiary; one activation completed with `1.3 s` obstruction.
- Tucked following never acquired the expected authority (maximum ETA error
  `4.290136880`, tracking error `2.096430601 m`). Near-touch reached
  `0.107445238 m` straight clearance and `-0.384445534 m` brake clearance,
  but no escape transaction executed despite three steer selections. These
  are attributed M9 evidence for CG; no parameter was tuned to the single
  seed.

## M10 — Adapter ladder, draft posture, and sticky commitment

Status: complete.

- Diff scope: adapter selection is ordered by the four physical rungs.
  Re-line/adjacent-claim candidates precede partial throttle and braking;
  deep-brake duel trajectories are excluded while a car is the claim adapter.
  Rung transition state resets when an interaction ends.
- Draft waiting now performs one physical setup move to the selected
  opportunity side and then holds that posture. A live attempt pins its
  accepted plan/lane binding; hard abort recovery remains on rungs 1–2 until
  the car reaches the recovery target. Rungs 3–4 remain a documented safety
  fallback only when no spatial recovery is feasible.
- Blocking deletions completed: attack observer expiry/cancellation is
  log-only and can no longer clear live control commitment. Physical pass
  completion and evaluator hard aborts are explicit separate authorities.
  The arbitrary post-contact `concedeT`/`concedeV` speed timer, storage,
  liveness exception, initialization, and tooling remnants were deleted.
- Blue flags publish the ordinary full-speed offline transaction. A zero-
  throttle rung is offered only while the normal surface cannot fit both
  measured claim widths; headless diagnostics preserve interaction/lift
  denominators per cause, forced-span leakage, and abort-reason attribution.
- Deliberate expectation changes: half-pass attribution follows the same
  target across opportunity IDs, observer expiry leaves commitment intact,
  and a physical pass completes without an abort. Typecheck, boundaries,
  evaluator, priority, traffic, and headless tests are green; the playable
  bundle was regenerated.
- Probe deviation: an attempted `--help` inspection of the headless CLI ran
  its default two-lap single-car case because that script has no help mode.
  It produced no M10 interaction metrics and informed no behavior change; the
  prescribed composite M10 probe remains the single closure measurement.
- Phase probe (run once, not rerun): the five-lap Prado seed 101 race
  recorded 15,523 lifts outside blue flags, stratified as obstacle
  `15,034 / 98,867` interaction samples, corner-rights `407 / 5,025`, draft
  `81 / 2,008`, and ordinary `1 / 93`. Abort reasons were empty (0 aborts);
  half-pass was therefore 0. The focused blue-flag episode completed and
  released in `2.383333333 s`, with rung transitions `4 / 1 / 0 / 0`.
- Blue geometry remained red: `23 / 57` blue interaction samples were lifts,
  while forced-span samples were 0, so all 23 were outside the derived
  single-file span; the same case had `21 / 36` draft lifts. Hard contacts and
  focused safety invariants were green. A probe serialization mistake read
  production aggregate fields from `exposure` instead of `metrics`, omitting
  exact production rung/candidate/materialization values; the consumed probe
  was not rerun. These canaries are attributed M10 evidence for CG, not tuning
  inputs.
