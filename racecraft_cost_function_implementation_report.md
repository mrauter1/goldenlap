# Racecraft Cost Function Implementation Report

## P0 — Reconciliation

Status: complete.

The one permitted reconciliation read was
`superseded/racecraft_plan_trust_implementation_report.md`.

### Inherited structures

- **Claims with published speed:** present in `RacecraftClaimStation` and
  produced by `prepareClaim`. The speed source is not yet honest:
  `publishedSpeed` reads the pit/lane/ideal reference and omits the selected
  follow constraint, margin, and controller result. P-B owns the replacement.
- **Slow-point following:** present through `publishedFollowConstraint`,
  `EntryTrafficSlowPoint`, and `botStep`'s anticipatory integration. The same
  selected `brake-behind` reason can also install `vCap`, and partial throttle
  has a separate cap channel. P-C owns deletion of the duplicate authorities.
- **Commitment deadline:** present through the `racecraftCommitment` lifecycle,
  physical lateral/speed-shed deadline helpers, sticky selection, and
  commitment observers. P-C owns its deletion after recourse and the
  difference tie-band replace it.
- **Snapshot state:** claim maps and a ledger rebuild exist, but immutable
  arbitration snapshots do not. Cars are processed leader-first and
  `reserveRacecraftClaim` rewrites centres during the same epoch. P-B owns
  simultaneous snapshot/evaluate/select/publish semantics.
- **Observers:** bounded station-gap moments, commitment counts,
  reactions/lap, candidate/materialization maxima, and light/hard contact
  counts exist. P-D owns deletion of retired-authority diagnostics and adds
  selected-candidate `J` decomposition.

### Audited cadence baseline

- Physics: 120 Hz (`H_STEP = 1/120`).
- Driver/autopilot input: 60 Hz (every other physics substep).
- Declared traffic cadence: 30 Hz (`TRAF_DT = 1/30`).
- Actual traffic cadence: 24 Hz. Resetting `trafT = TRAF_DT` discards the
  countdown residue and fires every fifth physics step.
- Actual scheduled deliberation cadence: 8 Hz per car through the three-slot
  stagger, rather than the declared 10 Hz.

P-A owns the accumulating timer correction before any behavior probe.

### Baseline checks

- `bun run typecheck`: green.
- `bun run check:boundaries`: green (79 TypeScript files, acyclic imports).
- Inherited benchmark: red. The allowed P0 reconciliation report records a
  final unpinned range of `5.583×`–`12.371×` against the `62.912×` floor.
  No P0 benchmark invocation was consumed; the plan permits the next runs
  only after P-B and in P-D.
- No behavior or source authority changed in P0.

## P-A — Free the lane

Status: complete. The required probe is recorded below; it stayed red against
the phase's derived lap-time/outside-zone expectations, so symptom 1 is not
fully cleared yet. The red result remains owned by P-A as acceptance debt;
P-B/P-C may remove downstream speed authorities, and P-D must recheck the
acceptance outcome without tuning to this seed.

### Landed changes

- Traffic now runs at the declared 30 Hz. `stepSession` accumulates `trafT`
  residue instead of resetting to `TRAF_DT`, so the three-slot deliberation
  stagger is a true 10 Hz rather than the audited 8 Hz.
- `reactionSeconds` was deleted as a global racecraft authority. The only
  surviving concept is the measured/policy horizon derived from the true
  deliberation interval, and `AGENTS.md` now states that there is no separate
  reaction-latency term.
- A car no longer clamps its own lane to its own claim. The claim envelope
  remains readable for other systems, but lane authority now comes only from
  the authored program, side agreements during physical overlap, and the legal
  surface.
- Slot zero of the control lane is again the authored reference at the car's
  current `s`, so `botStep` sees real cross-track error instead of a
  self-zeroed reference.
- Multi-point lane/path interpolation now preserves slope through Hermite
  segments; two-point transitions keep smootherstep easing. Lane geometry
  writes analytic Frenet curvature from the authored offset family, and a
  surface-projected slot keeps authored curvature so projection cannot mint
  phantom speed authority.
- Dead installed-bound/self-clamp residue was deleted, including the removed
  `racecraftInstalledLaneOutOfBounds` field and tests that asserted the old
  self-clamp behavior.
- The retired headless `pathOutOfBoundsViolations` summary metric was deleted
  end-to-end after the installed-bound observer removal, so the audit layer no
  longer carries a fake-zero contract for a non-existent counter.
- `tests/fixtures/parity/headless-pivot.json` was deliberately re-recorded on
  July 19, 2026 after the P-A runtime shift, and the refreshed fixture matches
  both the rebuilt browser bundle and the headless source path.

### Audited cadence consumers

After the timer fix, the existing `TRAF_DT`-based consumers stand as elapsed
time authorities:

- claim execution-noise decay
- claim trust's recent-contact window
- claim/conflict EWMAs
- opportunity sigma / pressure timing
- focused headless timing helpers
- lateral feel/switchback timing

One hidden `1 / 30` literal remained in `corridor-planner.ts`; it was
replaced with `TRAF_DT`. No consumer required re-tuning.

### P-A probe

Recorded on July 19, 2026.

Harness: a custom headless free session on Prado and Costa with two active
entries launched far enough apart that the tracked car remained effectively
traffic-free for the recorded lap. The minimum gap stayed `179.86644941743043`
m on Prado and `167.06548441757514` m on Costa, both well outside the
60 m traffic neighborhood. To avoid launch-lap contamination, the recorded lap
is the second completed lap. Outside-zone brake/lift applications are counted
as rising edges of `(inp.brake > 0.05 || inp.throttle < 0.05 || liftT > 0.05)`
while `track.brakingThreat[index] <= 1e-9`. Lane out-of-bounds episodes are
counted as rising edges of `!normalLateralIsLegal(...)`.

- Prado:
  `lapTimes [69.51666666668586, 72.03333333333067]`,
  `settledLapTime 72.03333333333067`,
  `profileLapTime 57.422317505246816`,
  `idealLapTime 56.569542397740214`,
  `botMargin 0.9514999999999999`,
  `literalPlanBound 54.63733510624234`,
  `reciprocalMarginBound 60.349256442718676`,
  `outsideApplications 42`,
  `outsideBrakeApplications 13`,
  `outsideThrottleLiftApplications 42`,
  `outsideIncidentLiftApplications 0`,
  `rearLossStraight 0`,
  `laneOutOfBoundsEpisodes 0`,
  `minimumGap 179.86644941743043`,
  `simulatedSeconds 143.175`.
- Costa:
  `lapTimes [77.10000000002523, 79.46666666664431]`,
  `settledLapTime 79.46666666664431`,
  `profileLapTime 65.91122313690197`,
  `idealLapTime 64.25599818857707`,
  `botMargin 0.9514999999999999`,
  `literalPlanBound 62.71452881476222`,
  `reciprocalMarginBound 69.27085983909824`,
  `outsideApplications 31`,
  `outsideBrakeApplications 12`,
  `outsideThrottleLiftApplications 31`,
  `outsideIncidentLiftApplications 0`,
  `rearLossStraight 0`,
  `laneOutOfBoundsEpisodes 0`,
  `minimumGap 167.06548441757514`,
  `simulatedSeconds 158.19166666666666`.

### Deviations / approximations

- The recorded probe is an approximation of "solo two-car-free": it uses two
  active entries because that was the smallest existing full-session harness
  that exposed the required counters without introducing new production code,
  and the cars never entered each other's traffic scan.
- The phase's literal lap-time comparator (`speedProfile` lap time × bot
  margin) is red on both tracks. The phase did not retain a same-harness
  pre-change baseline, so the result establishes acceptance debt but does not
  by itself distinguish a remaining regression from a comparator-definition
  error.
- The zero outside-zone brake/lift requirement is also red (`42` on Prado,
  `31` on Costa). Rear-loss and lane out-of-bounds stayed at zero on both
  tracks.
- An independent post-phase audit found that the first curvature pass had
  treated eta as offset from the ideal path even though the authored geometry
  is a centreline-normal offset, and that corner candidates still passed
  through the old anchor surrogate. Both were corrected before P-B: lane
  geometry now evaluates the full centreline Frenet expression using total
  offset (`ideal.off + eta`), and corner-family control samples the validated
  alternate line directly at track resolution after one physical acquisition
  segment. The required P-A probe was not rerun.
- The slope-matched statement applies to non-pit lane/tactical programs. Pit
  motion deliberately retains its dedicated sampled-path interpolation and
  remains the only full-path materialization authority.
- The custom P-A probe harness was not retained as a source file. Its complete
  numeric output is recorded above, but exact command-level reproduction is a
  report limitation.

## P-B — Claims become data

Status: implemented. The single required probe is recorded below. The leader
authority checks are green, but the close-follow equilibrium/pass outcome is
red and remains owned by P-B/P-C.

### Landed changes

- Claims now publish an immutable, double-buffered snapshot containing
  measured origin/time, `(s, y, v)` stations, base execution error, and
  measured lateral/longitudinal divergence growth. Divergence is the EWMA of
  forecast residual growth after the base-error envelope, measured against the
  preceding snapshot.
- Claim speed starts at measured vehicle speed and rolls the installed
  longitudinal program through the existing grip, braking, drive, drag, and
  margin laws. The rollout includes the lane speed law, the active slow point,
  and—until P-C deletes the duplicate channels—the live `vCap` and throttle
  cap. Station position integrates the same trapezoidal speed rollout.
- Trust revocation now keeps two different objects: measured
  `epsilon + rho*t` remains the expected-error description, while hard
  feasibility receives a grip-limited reachable tube capped by the authored
  emergency surface. Revocation no longer substitutes a constant-speed,
  constant-lateral ghost.
- Arbitration uses one pre-update claim/decision snapshot. Due decisions are
  staged, no later car can read an earlier same-epoch selection, all selections
  are installed after evaluation, and the next claim snapshot is published
  only after installation.
- Deleted in this phase: pair priority, conflict owner/adapter state,
  adapter-rung selection, same-tick claim reservation, ghost interval routing,
  corridor-authored candidate deformation, the defense gate/door tree, and
  all corresponding model, headless, audit, sensitivity, and test semantics.
  Dead `PathPlan.corridor` sampling was removed rather than retained.
- Physical-overlap side agreements, claim trust, slow-point following,
  pit/quali queue caps, pit reservations, and blue-flag relations remain.
  The sporting one-move rule is now a candidate-set legality predicate backed
  by the existing per-attacker bookkeeping.
- Removing ghost routing also removed its accidental stopped-car escape
  generator. P-B replaces it with two surface-authored emergency candidates;
  claims are feasibility/cost inputs and do not author either geometry.
- Candidate hard-contact checks now project ego from the candidate's own
  longitudinal program estimate. The incumbent/ego claim can no longer invent
  or erase a candidate conflict, and claim conflict can no longer manufacture
  a tactical speed cap.

### Verification before the phase probes

- `bun run typecheck`: green.
- `bun run check:boundaries`: green (81 TypeScript files, acyclic imports).
- Touched session/tool tests: 35 green, including immutable snapshot,
  measured divergence, honest longitudinal publication, one-move legality,
  light/hard contact, side agreement, slow-point, and retired-metric coverage.
- A production full-field deterministic race completed after the stopped-ego
  acquisition edge case was fixed; candidate/materialization limits remained
  within contract.

### P-B close-follow probe

Recorded on July 19, 2026. One invocation only: Prado,
`faster-behind`, seed `101`, production `1/120 s` physics cadence,
`stopWhenDecided = true`.

- Verdict: red — `no pass within three laps`.
- Simulated time: `210.783333333 s` (`25,294` steps).
- Leader maximum authored-line deviation: `0 m`, versus `0.2 m` measured
  execution noise (green).
- Leader follower-attributed brake/lift events: `0` (green).
- Ending body clearance: `177.800679446 m`; derived follow-body floor:
  `0.213413643 m` (red: the follower did not settle at the floor).
- Hard contacts: `0`; claim-envelope invariant violations: `0`.
- Maximum candidates: `6`; materialized paths: `0`.
- Five attack initiations/committed attempts produced zero completions.
  Reactions were `551`, non-blue lift samples `239`, and program-reason
  violations `10`.
- Checksum: `68b18b72`.

The probe isolates the reported leader-yield defect successfully: the leader
neither moved nor braked for the car behind. It also exposes remaining
longitudinal/decision churn in the superseded evaluator, which P-C replaces
with the seconds objective and one longitudinal authority.

### Approximations and deviations

- The emergency seed freezes its target surface sample while deriving one
  acquisition transition. Choosing the authorized side endpoint rather than a
  claim-shaped minimum-clearance path overstates lateral displacement and time
  loss, so the error is conservative against selecting an escape. P-C replaces
  these seeds with the analytic all-station lambda intersection.
- P-B's candidate hard-feasibility timing uses the existing candidate
  horizon-distance estimate with a constant-acceleration interpolation. It is
  exact at the current state and horizon endpoint; intermediate error is
  sign-indefinite for changing curvature/speed limits. The bounded rival tube
  still owns the damaging-contact veto. P-C replaces this estimate with each
  candidate's installed speed-law rollout.
- The probe uses the existing `faster-behind` production scenario and stops on
  its existing verdict. It records the required leader authority and safety
  quantities, but its final clearance is after the full three-lap failed-pass
  window rather than a dedicated steady tucked window; that biases the
  equilibrium-gap measurement upward.

### P-B benchmark

One invocation only, recorded July 19, 2026:

- Provisional four-sample median: `9.994x`.
- Recorded floor: `62.912x` (`15.89%` of the floor).
- Result: red, `median-gate-mathematically-unreachable`; the runner stopped
  after four sub-gate samples because the seven-sample median could no longer
  recover.
- Workload samples: `10.1052x`, `9.6565x`, `9.8822x`, `10.1107x`.
- The benchmark did not print candidate/materialization maxima or a checksum
  before its early failure. The phase probe independently recorded `6 / 0`.

The O(n²) conflict ledger and ghost routing are gone, but the floor is not
recovered. P-C must keep the evaluator bounded and P-D records the final
benchmark without tuning against this run.

### P-B phase gate

The single `bun run verify:fast` invocation was red:

- Green: typecheck, both bundles, module boundaries.
- Unit aggregate: `146` passed, `4` failed. Two failures were track-profile
  optimizer/ideal-line expectations outside the P-B diff; two were timeouts
  in the profile authority and release-worker tests.
- The deterministic chain short-circuited before invariants, profile
  validation, parity, browser smoke, and fast statistics. No retry or
  additional statistical tier was run.

The touched P-B tests and production full-field check recorded above remain
green. The four aggregate failures are retained for P-D reconciliation rather
than being hidden by a rerun.

## P-C — The evaluator

Status: implemented. The single required probe is recorded below. The
seconds-valued evaluator, source-class prediction, lateral response vocabulary,
and single longitudinal authority are landed. The probe is green on ordinary
attack launch, a completed faster-car pass, lateral-dominant concession, hard
contact, and both hard runtime budgets. It is red on the dedicated switchback,
the completed-silent-corner-span assertion, and decision churn. The tucked-gap
assertion was not reached because the faster car completed its pass rather than
settling behind; that is recorded as an unobserved/red assertion, not silently
reinterpreted.

### Landed changes

- The retired tactical evaluator was replaced by one bounded argmin in
  seconds. Candidate cost is true path time plus the exact per-hazard
  bill/recourse partition, integrated by nine deterministic, coherent
  relative-error trajectories. The Gaussian station calculation is only a
  conservative continuous-segment screen; no complement or conditional is
  applied to its score.
- Relative uncertainty contains both cars' measured source-class execution
  noise and divergence. Snapshot trajectory overlap defines `region(h)`;
  prospective responsibility uses each car's earliest feasible family arrival
  there. No contest term reads `corner.apexI`: corner and alternate-line
  metadata survive only as offline family geometry.
- The response family always contains lateral re-aims when the surface and
  agreement permit them, including a priced emergency-surface member. Hard
  feasibility asks only whether one member remains viable for the next
  deliberation interval against the matching prediction at mean and measured
  ±sigma support. Grass/runoff counts as recourse; barriers remain absolute.
- Candidate geometry is analytic and compact: ideal, validated inside/outside
  corner-family blends, mandatory surface-bounded straight offsets,
  brake-behind, and recenter, with at most six members. Lambda is generated
  once from the all-station clearance intersection. Sustained
  apex-parameterized line grids are authored offline; online arc search and
  per-station lateral freedom do not exist.
- The selected candidate owns one longitudinal program. Rival slow points are
  composed into the sampled lane speed law by backward induction using every
  sample's curvature, surface, drag, and braking headroom. `botStep` has no
  traffic parameter or one-shot target branch, and racecraft no longer writes
  independent `vCap` or throttle-cap authorities.
- Claim revocation now switches prediction source, never prediction scale:
  tracked publication; a re-derived production argmin for a controlled car
  that breaks publication; ballistic physics only for a measured spin or
  persistent stall. Contact and mishap flags do not revoke trust, and a
  published emergency arc remains trusted while off-surface. Re-derived state
  caches the winning family at a real decision epoch and only re-anchors that
  one seed at intermediate 30 Hz publications. Pit synchronization is the
  corresponding non-race re-derivation authority: a broken pit publication
  rolls the freshly synchronized sampled pit program rather than invoking a
  race-only candidate family.
- Deleted with their replacements: the reachable lateral/longitudinal tube,
  `physicalReach`, emergency tube cap, proximity risk and its pace/risk
  multiplier, bespoke commitment/deadline and opportunity/rung authorities,
  duplicate longitudinal writers, and tests specifying those semantics. No
  worst-case occupancy object survives.
- Physical contact loss is a committed 102-knot table measured through the
  production collision/recovery code by
  `tools/measure-contact-loss.ts`. Continuous oriented-body sweeps use signed
  closing speed, so a separating overlap is not priced as a future impact.
- The exact next-observation recourse calculation reuses only
  decision-local invariants: ego state at the next epoch, unchanged advanced
  entries/claims, and invariant response cores. Each quadrature node replaces
  the observed rival and still evaluates the complete bounded response family.
  This changes work reuse, not the objective.

### P-C verification before the phase probe

- `bun run typecheck`: green.
- `bun run check:boundaries`: green (86 TypeScript files, acyclic imports).
- Focused tests: evaluator `13/13`, corridor/claim prediction `7/7`,
  cost-function primitives `6/6`, contact `5/5`, traffic `6/6`,
  lane/path `28/28`, relations `4/4`, and autopilot `2/2`.
- The formerly broken headless diagnostic assertion no longer references
  `racecraftCommitAbortReasons`; typecheck therefore covers the user-reported
  build failure.
- The production-backed tucked-follow test satisfies all ten behavioral
  assertions but remains red on its inherited 20 s test timeout:
  `40.476 s` test body (`40.87 s` wall). P-S owns the measured runtime,
  not a timeout increase or a mathematical shortcut.

### P-C probe

Recorded on July 19, 2026. One Bun invocation ran Prado seed `101` at the
production `1/120 s` step for `attack-launch`, `switchback`,
`faster-behind`, and `side-by-side-corner`, each with the existing
`stopWhenDecided` condition.

- `attack-launch`: green, feasible passing space selected after
  `9.675 s`; `3 / 0 / 226` lateral/brake/inline contest selections,
  `6` light and `0` hard contacts, candidates/materializations `6 / 0`,
  checksum `709a0311`.
- `switchback`: red, “switchback not selected” after `8.383333333 s`;
  one ordinary attack nevertheless completed. Contest selections were
  `37 / 25 / 80`, with `7` light and `0` hard contacts,
  candidates/materializations `5 / 0`, checksum `85d52f65`.
- `faster-behind`: green, one of two attacks completed after
  `55.308333333 s`. The leader deviation and follower-attributed braking
  stayed exactly zero. The mandatory straight member was selected `39` times.
  Ending clearance was `-5.398791506 m` during the completed pass, versus the
  derived follow floor `0.214800922 m`; because the follower did not settle,
  the phase's settled-gap assertion is unobserved/red rather than a
  multi-car-length standoff. There were `3` light and `0` hard contacts,
  candidates/materializations `6 / 0`, checksum `907e3a4b`.
- `side-by-side-corner`: green on the scenario verdict and both cars completed
  the corner under a stable agreement. It recorded `2.916666667 s` of
  hazard-silent side-by-side cornering, but the span remained open at probe
  termination (`0` completed silent spans) and `4.966666667 s` still carried
  contest terms, so the stricter silent-span assertion is red. There was
  `1` light and `0` hard contact, candidates/materializations `5 / 0`,
  checksum `61bf7e63`.
- Across the invocation, lateral concessions dominated braking `69 / 27`;
  light/hard contacts were `17 / 0`; maximum candidates were `6` and
  materializations `0`. Decision switches/reactions were `419 / 780`, a red
  churn signal assigned to P-S's certificate scheduler.

### Approximations, deviations, and blockers

- The lambda clearance seed freezes station timing while solving affine
  lateral intervals. Its timing error is sign-indefinite; every seed still
  receives the full continuous sweep, seconds objective, and hard-feasibility
  evaluation.
- The continuous Gaussian screen is conservative: segment/body expansion can
  admit a pair that exact quadrature later clears, costing runtime, but it
  cannot screen out a mean crossing between stations.
- Body motion is piecewise continuous between publication stations. Increasing
  station count refines both geometry and sweep timing; P-D owns the required
  `K = 24` convergence observation.
- Relative-error covariance is not yet measured by the runtime, so the
  specified measured fallback `Cov = 0` is used. This is sign-indefinite for a
  pair sharing road disturbances and is recorded rather than replaced by a
  tuned correlation.
- The incident system exposes contact class and consequence but no prospective
  sporting-penalty/fault-seconds model suitable for `phi * l_sport`. No
  coefficient was invented: retrospective cost is the measured physical loss,
  while arrival-asymmetric `r` prices prospective contested-space recourse.
- Emergency surface exposure uses the measured surface mu/drag and utilization
  law. The tree has no authored barrier envelope distinct from the emergency
  surface bounds, so treating every point inside that envelope as viable may
  overstate escape space where future track content adds a physical barrier.
- A newly observed prediction class begins at the physical execution-noise
  floor until residuals measure that class. This can initially understate or
  overstate the class's eventual variance; it never borrows or inflates another
  source's width.

### P-C phase gate and integration reconciliation

The single `bun run verify:fast` invocation was red:

- Green: typecheck, both browser bundles, and module boundaries.
- Unit aggregate: `167` passed, `12` failed over `3,590,063` assertions in
  `514.00 s`.
- Three integration failures belonged to P-C prediction/path plumbing:
  controlled qualifying/pit entries without a race-derived program and one
  pit plan mixing a continuous first-anchor `s` with wrapped later anchors.
  These were corrected after the gate without rerunning it: non-track
  `box`/`none` entries no longer publish traffic claims, broken pit
  publications use the synchronized pit program, and sampled pit anchors use
  one consistent wrapped-index coordinate system.
- Focused post-gate checks are green: pit `10/10`, paths `10/10`, traffic
  `6/6`, corridor `7/7`, the deterministic pair/pit/priority/classification
  matrix, typecheck, and boundaries.
- The other gate reds were recorded rather than hidden: optimizer
  short-budget exit, ideal-line pit neutrality (`0.0071009778 m` versus
  `<1e-9`), and seven evaluator-amplified timeouts (follow-loss, wet
  obligation, full field, release worker, anticipatory defense, pass-score
  host, plus the worker's killed child). Because the deterministic chain uses
  `&&`, invariants, profile validation, parity, browser smoke, and fast
  statistics did not run. Runtime failures pass to P-S; unrelated geometry/
  CLI expectations remain P-D reconciliation items.
- The explicit phase-end `bun run build` is green: strict typecheck plus the
  67-module game and 29-module Track Studio bundles.

## P-S — Interaction-density scaling

Status: implemented; both required measurements red and recorded.

### Required pre-change instrumentation

The one permitted profiling capture was run before P-S source changes against
the exact planner/benchmark scene: Prado, seed `503`, 22 cars, `900` steps,
dry, with performance diagnostics and Bun CPU-profile Markdown enabled.

- Result: red/incomplete. The single process ran for roughly `3.5 min` and was
  killed with exit `137` before the scene returned or Bun flushed either CPU
  profile artifact.
- Consequently there is no honest coarse bucket attribution, simulated-time
  result, or candidate/materialization total from this mandated capture. No
  retry, smaller substitute scene, or estimated percentage was used.
- The failure itself is a measured result: the current all-car fixed-cadence
  evaluator cannot complete even the bounded pre-change profiling workload
  inside the available memory/runtime envelope. P-S proceeds only with
  formula-proved off-switches and records each one; it does not tune against
  the failed capture.

### Certificate scheduler and proved off-switches

- One `RacecraftDecisionCertificate` is now the only deliberation gate.
  Bootstrap, interaction-neighbor changes, prediction-source revisions,
  discrete authority changes, and schedule expiry are its bounded break
  reasons. The fixed decision slot, `racecraftDecisionNeedsRefresh`, raw
  contact timestamp trigger, leader-speed heuristic, and parallel tactical
  timers were deleted.
- Active interactions retain the declared `0.1 s` deliberation ceiling.
  No beta-drift, live-feasibility, or continuous-cost bound exists in the
  tree, so no longer certificate was asserted. A settled car with no
  interaction neighbor has an unbounded ideal certificate: the exact
  neighbor-set check is what invalidates it.
- Incumbency is keyed by semantic family identity, excluding moving progress,
  sampled indices, anchors, object identity, and generated plan keys. This
  removes the prior guaranteed refresh of otherwise unchanged hold and
  brake-behind programs.
- The exact objective and corollary 9 exposed one P-C/tree conflict:
  candidate-wide normal-surface utilization risk made `J(ideal) > 0` with no
  hazards. That legacy free-standing term was deleted. The measured
  utilization/mistake consequence remains only for an emergency-surface
  continuation, where the Concession section explicitly prices it.
- Queue refresh is elapsed-time based rather than tied to a decision slot.
  Lane spans are retained until their authority revision changes or their
  physical controller coverage is exhausted.
- The side-agreement acquisition sweep now walks only the track-sorted,
  body-diagonal-bounded overlap window. Release work scales with the live
  agreement set. A wraparound-overlap regression proves that the bounded
  walk does not mistake adjacency for only the nearest pair.
- One epoch interaction graph now unions both endpoints of every exact
  directed neighbor, sporting-obligation, and live-agreement edge. Claims are
  prepared only for that demand set. A new boundary edge prepublishes both
  endpoints before simultaneous evaluation; steady edges consume the prior
  immutable snapshot and publish staged selections after installation.
  Undemanded entry claims and publication-only re-derived families are
  removed, and evaluator reads no longer fall back to stale entry storage.
- Settled solitude now bypasses `evaluationClaimsAt`, seed construction,
  feasibility, speed-law composition, and scoring. Its decision has zero
  candidates and no claim, lane buffer, or racecraft longitudinal program.
  A car still carrying lateral authority keeps its pinned physical recenter
  lane until measured settlement, then drops the buffer. A solitary published
  emergency excursion likewise remains installed from measured tracking and
  control state without manufacturing a self-claim.
- The same bounded epoch neighbor lists now feed traffic obligation/
  participant checks, while an epoch `activeByCode` map replaces repeated
  full-field lookups in stale side-by-side cleanup. Tier-1 evaluator scans
  remain full-context work and run only for active interactions.
- Headless summaries expose Tier-0 checks/acceptances, zero-hazard dominance,
  Tier-1 deliberations, acceptance fraction, and bounded certificate-break
  counts for the required scaling measurement.

Focused checks after both tranches: typecheck and module boundaries green;
the complete touched evaluator/traffic/paths/lane/corridor set `66/66`; the
targeted headless summary contract `1/1`. The explicit phase build is green
(67-module game bundle and 29-module Track Studio bundle).

### Deliberate blockers (no approximation substituted)

- Incremental claim publication is not behavior-equivalent yet. The current
  publication deliberately reanchors to measured position and speed and
  updates class-local residual noise each tick. Aging a cached worldline and
  appending one tail changes its mean unless the measured residual is carried
  by a separately proved representation. No such representation exists, so
  no claim revision key or hidden envelope was invented.
- Incremental lane geometry is possible for a fixed analytic family, but its
  speed samples depend on continuously changing wetness, tyre state, dirty
  air, flow/margin, aero/power, and measured speed. Backward induction lets
  one appended tail alter every retained earlier speed. Without exact dynamic
  input revisions plus backward propagation to a fixed point, head-drop/
  tail-append would retain a stale longitudinal authority; it was not
  substituted silently.
- Cross-epoch seed/feasibility memoization cannot be keyed by claim source
  revision alone. Pinned acquisition also depends on measured ego progress,
  lateral position and speed, agreements, obligations, one-move authority,
  surface/grip state, and the installed longitudinal program. Immutable
  family/track geometry already uses the safe caches; no incomplete cache key
  was minted.
- Bufferless direct ideal control uses the existing static ideal-path
  controller branch, whereas an ideal lane buffer previously carried the
  lane writer's dynamic speed samples. Geometry authority is identical, but
  the longitudinal difference can be positive or negative with wetness,
  tyre/aero state, and power. This plan-mandated mode is therefore recorded as
  a sign-indefinite behavior deviation and is owned by the one P-S behavior
  probe; no compensating coefficient was added.

### Required behavior-invariance measurement

The one permitted four-scenario P-S probe invocation completed. Tier 0
accepted `8,326 / 11,832` car-ticks (`70.3684922%`), leaving `3,506` Tier-1
deliberations. Candidate/materialization maxima remained green at `6 / 0`;
contacts improved from the P-C baseline `17 / 0` light/hard to `11 / 0`,
and lateral concession share improved from `69 / 96` (`71.88%`) to
`77 / 92` (`83.70%`).

Behavioral equivalence is nevertheless red:

- attack-launch selected space at `1.208333333 s` versus `9.675 s`;
- faster-behind still completed a pass, but at `179.641666667 s` versus
  `55.308333333 s` (`3.25x`), with `7 / 1` attacks and `27` pull-outs;
- switchback remained red, while the side-by-side-corner scenario remained
  green;
- switches rose `419 -> 795` and reactions `780 -> 1,109`; silent
  side-by-side time fell `2.916666667 -> 1.925 s`, and all four deterministic
  checksums changed.

Certificate breaks were: expiry `2,389`, prediction-source `1,026`,
authority `81`, bootstrap `8`, and neighbor-set `2`. The result assigns the
failure to P-S: the proved-looking off-switch package is not behaviorally
invisible in the current tree. No tolerance was widened and the single probe
was not retried.

### Required post-change scaling measurement

The one permitted post-change Prado/seed-503/grid-22/900-step profiled run
exited red after `107.9654865 s` with
`MER analytic lane edit pin error 0.36157579330392764`. The invariant fired
before `runHeadlessRace` returned, so simulated seconds, performance
diagnostics, candidate/materialization counts, Tier-0/Tier-1 totals, and
certificate breaks are unavailable; none were inferred and the run was not
retried.

The CPU profile did flush and attributes outermost subsystem time as:
evaluator+feasibility `96.2187%`, lane `1.2715%`, claims `0.4991%`,
collisions `0.0171%`, physics `0.0128%`, and other `1.9809%`. The direct
profile call tree independently reports `evaluateRacecraftDecision` at
`95.3%` and `updateTraffic` at `96.2%`. This is the measured P-S scaling
result: interaction gating avoids roughly 70% of Tier-1 car-ticks in the
focused cases, but the surviving evaluator remains the runtime owner and the
full-field scene still violates the analytic lane pin invariant.

### Phase gate

The one permitted `bun run verify:fast` invocation was red. Build/typecheck,
both bundles, and module boundaries were green; raw unit tests were
`185 passed / 6 failed`:

1. profile-optimizer short-budget CLI exit `1` instead of `0`;
2. ideal-line pit neutrality `0.0071009777777777785 m` instead of `<1e-9`;
3. tucked-follow authority-loss observer `1` instead of `0`;
4. full-field `FER` analytic lane pin error `1.2372041913367866 m`;
5. release worker `PRA` analytic lane pin error `0.3140082353074831 m`
   plus its timeout;
6. L5 pass-score-host audit timeout after the underlying ten cases completed
   amber.

The chained command therefore did not reach invariants, profile validation,
headless parity, browser smoke, or fast statistics. P-D owns the residue and
final gate; this P-S gate was not retried.

## P-D — Residue, observers, tally

Status: implemented; final evidence mixed/red and recorded. The phase is
structurally landed, but the plan's performance and behavioral acceptance is
not met.

### Resolution controls and convergence surface

- Numerical resolution is now a scoped, non-calibration input with production
  defaults `K = 12` and tensor-nine quadrature. `MANEUVER_PREDICTION.samples`
  reads the active station resolution, while the objective and its Gaussian
  screen read the active quadrature rule and its derived support.
- The doubled rule is an exact 18-unique-point polar cubature: two-point
  Gauss-Laguerre in radial `u = r²/2`, crossed with two interlaced nine-angle
  rings. Tests cover normalized weight, zero means/covariance, unit variances,
  fourth and mixed-fourth moments, sixth marginal moments, and the derived
  support `sqrt(4 + 2sqrt(2))`.
- The separate nine-node measured-noise support used by one-interval hard
  viability is unchanged. The resolution override therefore changes numerical
  integration and its conservative screen, not the measured safety object.
- `tools/racecraft-convergence-check.ts` owns one invocation containing
  exactly the two normative P-B close-follow measurements: K24/tensor-nine
  and K12/polar-18. It has no default-resolution third run and reports
  incomplete simulation honestly.

### Residue and observer schema

- Deleted the unused candidate-cache type/entry field/conditioned-clone
  residue and the retired `maneuverCommitSeconds` sensitivity artifact.
- Deleted `AttackEpisode.committedAt` and the duplicate committed-attempt /
  committed-completion session and headless fields. Canonical pass attempts
  and successes now derive from attack initiations and completions; live
  attack episodes and per-corner observers remain.
- Deleted the retired half-pass and pass-prediction-Brier metric policies.
  The old claim-allocation diagnostic was also corrected: the implementation
  only validates one publication's finite, body-containing interval, so the
  field/policy is now `racecraftClaimEnvelopeViolations` /
  `invariant.racecraft_claim_envelope`. No overlap ledger semantics remain.
- Deleted `racecraftProgramReasonViolations` and its invariant policy. The
  counter incremented when a binding expired and the same function correctly
  installed its physical recenter, so ordinary program lifecycle was being
  reported as a violation. `racecraftExpiredPrograms` remains as the bounded
  lifecycle observer.
- README and AGENTS now name this plan as active. AGENTS also describes
  one-interval viability and physical-overlap agreements without reintroducing
  corner-rights/priority authority, and treats decision cadence as resolution
  rather than reaction latency.

### Analytic-lane pin invariant

The P-S full-field failures were a certificate lifecycle defect, not an
analytic geometry edit. Recenter/deferred authority could remove the selected
analytic plan, then seal its stale decision; a later Tier-0 acceptance tried to
reinstall the aged acquisition anchor. Certificate validation and installation
now share one execution-eligibility predicate. An uninstalled executable
family whose first anchor no longer matches measurement breaks as `authority`;
an already-installed family may age normally. The invariant and its `1e-9`
tolerance were not changed.

Focused validation is green for typecheck, module boundaries, config/cost/
evaluator resolution tests (`35/35`), the analytic authority regression
(`25/25` evaluator file), config/statistics cleanup tests, and the claim/
lane publication tests. The larger audit-toolkit touched-test invocation
completed all ten L5 cases amber but exceeded its pre-existing five-second
test timeout; no behavior assertion failed. The explicit `bun run build` is
green (67-module game and 29-module Track Studio bundles).

### Convergence spot-check

The one permitted convergence invocation completed both normative P-B
close-follow variants. Both were individually green: pass completed, leader
command deviation and follower-attributed leader brakes `0`, hard contacts and
claim-envelope violations `0`, and candidate/materialization maxima `6 / 0`.
Their endpoint-clearance difference was `0.012667286 m`, below the reported
`0.2 m` leader execution noise.

The convergence verdict is nevertheless red. K24/tensor-nine completed in
`160.816666667 s`; K12/polar-18 completed in `27.358333333 s`, a
`133.458333334 s` difference (`5.88x`) with no temporal-noise source that can
explain it. K24 versus polar-18 also recorded `5` versus `2` attack
initiations and `1,022` versus `155` reactions; these counts are
duration-confounded but consistent with the timing divergence. The run also
exposed the retired program-reason counter described above (`8` versus `2`);
because it counted correct expiry/recenter transitions, it is not treated as
invariant evidence and was deleted rather than tuned. Selected total J means
were `0.084866691 s` and
`0.080674642 s`; checksums were `722a157c` and `9fc0146b`. The run changes one
resolution axis per case relative to the production default, so it establishes
non-convergence but cannot attribute it between station and quadrature
resolution without a prohibited extra run.

### Parity fixture

The first sandboxed parity-record attempt could not launch Chromium. The
required escalated run then exposed a genuine Bun/browser mismatch: a generated
lambda plan key differed only at its twelfth printed significant digit.
Generated keys are categorical identity while the exact decision variable
already lives in `lineBlend`, so the floating value was removed from the key;
the invariant geometry and objective were unchanged. After rebuilding, the
headless/browser comparison passed and
`tests/fixtures/parity/headless-pivot.json` was deliberately re-recorded with
the P-D observer schema. It was refreshed once more after deleting the false
program-reason observer; all five clean/pair/pit/priority/classification
scenarios matched.

### Full-field probe

The one permitted production-grid Prado/seed-101/dry/one-lap probe completed
in `96.4` simulated seconds (`~127.9 s` wall), finite, with a valid `12/12`
classification and checksum `75bd82c7`. The analytic-lane correction is green:
maximum pin error, unpinned edits, and target discontinuities were all zero.
Complexity budgets were also green at maximum `6` candidates and `0`
materializations; DNFs, unexplained stalls, and pit deadlocks were zero.

The behavioral acceptance is red:

- `400` contacts (`399` light, `1` hard/opening) rather than zero hard contact;
- `12,826` reaction events, or `534.416666667` per completed car-lap;
- Tier 0 accepted `14,996 / 30,565` checks (`49.06%`), leaving `15,569`
  Tier-1 deliberations and `86,331` candidate evaluations;
- the one-lap race took `96.4 s` against profile/ideal references
  `57.422317505 s` / `56.569542398 s`;
- `39` order passes and `46 / 213` observed attack completions/initiations
  occurred, with `182.066666667` side-by-side car-seconds.

Mean selected-J terms were own time `0.338544672 s`, bill `0.006483054 s`,
recourse `-0.005869124 s`, risk utility `0.000946010 s`, tie band
`0.002262429 s`, and total `0.340182021 s`. This run confirms the lifecycle
invariant fix while rejecting the acceptance claims for contact, reaction
cadence, and lap time. It was not retried.

### P-D benchmark

The one permitted P-D invocation failed and was not retried. Its command
initially overlapped the tail of the full-field probe during setup/warmup; the
reported workload samples ran after that probe had completed. The runner was
un-pinned on the available `0-11` logical CPUs and stopped after four of seven
samples because median recovery was mathematically impossible:

- throughput samples: `1.157098888x`, `1.159037493x`, `1.055512971x`,
  `1.167521626x`;
- frozen floor: `62.912x`;
- wall times: `86,912.768 ms`, `86,767.397 ms`, `95,277.528 ms`,
  `86,136.877 ms`;
- result: red, `median-gate-mathematically-unreachable`.

The runner terminated before emitting candidate/materialization maxima. The
P-D full-field probe independently recorded those hard budgets at `6 / 0`.
Compared with P-B's provisional `9.994x` median, P-D is materially slower,
not recovered; no threshold, resolution, seed, or behavior constant was
changed in response.

### Final gates

The final invariant suite was invoked once and failed after `264.74 s`:
`47 / 50` tests passed across the seven invariant files (`301,764`
assertions). The three failures were:

1. the ideal line was `0.007100978 m` from neutral through the pit/start
   interval, above the exact `< 1e-9 m` invariant;
2. the focused evaluator-follow scenario recorded one
   `auditTuckedAuthorityLost` sample rather than zero;
3. the production full-field test exceeded its `60 s` timeout (the test
   process reported `212.582 s` for that case).

These are retained as red findings. No assertion, timeout, seed, or
implementation constant was changed, and the suite was not retried.

The single final `bun run verify` invocation also failed and was not retried.
Typecheck, both bundles, and module boundaries passed. `test:unit:raw` then
finished `188 / 194` green in `391.31 s` and stopped the `&&` chain with six
failures:

1. the short-budget TrackProfile optimizer CLI exited `1` instead of `0`;
2. the same `0.007100978 m` pit/start neutrality failure;
3. the same one-sample tucked-follow authority loss;
4. the production full-field test exceeded `60 s` (`211.056 s` reported);
5. the bounded release worker exceeded `20 s`, returned no exit code, and
   left one process for the harness to kill (`94.023 s` reported);
6. the L5 audit test exceeded `5 s` (`9.605 s` reported). Its underlying
   ten cases completed amber with zero audit failures, but no observed
   switchback/over-under selection and no required pass clearance.

Because unit tests failed, that invocation did not reach its invariant,
profile-validation, parity, browser, production, or normal-statistics stages.
The separately mandated invariant and parity results above are the only final
evidence for those surfaces.

### Structural tally

The live-tree residue scan is zero for every named retired authority and
alias: self-claim bounds, owner/adapter priority, ghost corridor authors,
defense vetoes, reachable tubes/physical reach, one-shot traffic braking,
racecraft throttle/vCap channels, bespoke commitment state, the candidate
cache, committed attack aliases, and the retired overlap/half-pass/Brier
observer names. The tracked diff deletes the former `corner-rights` and
`priority` modules (`1,119` source lines) and their tests (`1,081` lines),
in addition to the in-file authority deletions.

The net-line acceptance cannot honestly be marked green. Against the
repository's current Git base, the selected tracked racecraft scope is
`2,355` additions / `3,430` deletions (`-1,075`). A current explicit minimum
scope consisting of the untracked racecraft source, headless runtime, touched
session tests, convergence/statistics tools, and their aggregation test
contains `18,630` lines, for a visible net `+17,555` before even counting
untracked fixtures or documents. Those files already existed untracked when
this continuation began, so Git cannot attribute that total to P-C/P-S/P-D;
nevertheless, the available evidence does not prove a net deletion and the
status remains red rather than inferred.

## P-S/P-D continuation after the performance amendment

Status: P-S reopened; implementation is green on focused checks, with its
single behavior/scaling recheck still pending. P-D final gates have not been
re-run.

### Analytic-lane pin reconciliation

The reported `0.314008235`, `0.361575793`, and `1.237204191 m` failures are
owned by the P-D execution-eligibility correction already in the tree.
Certificate validation and installation share
`racecraftSelectedLaneIsExecutable`; an executable but uninstalled analytic
family whose measured acquisition anchor has aged breaks as `authority`
before installation. An installed identical family may age because that is
execution, not a new edit. The focused stale-anchor regression is green, as
are typecheck and module boundaries. No pin tolerance or invariant was
changed, and no full-field run was spent re-proving evidence already recorded
above at zero pin error.

### Noise-grained publication revisions

Claim identity is now extensional at a common epoch rather than object- or
tick-based. `racecraftClaimsSharePublication` compares source/trust class,
station grid, physical body footprint, wrap-safe longitudinal state, lateral
state, speed over one refresh, and one tail sample against the predecessor's
aged measured envelope. Matching reanchors retain `publicationRevision`;
departures increment a monotonic per-entry revision, including demand
removal/re-entry.

Claim aging and identity live in one shared module consumed by publication
and evaluation. Certificates now record `claimRevisions`; ordinary authority
sealing cannot absorb a post-snapshot publication, while explicit retained
emergency renewal can. Focused results are green: claim identity `3/3`,
evaluator `26/26` before the performance edits, and corridor/relations
`12/12`. The historical `prediction-source` break label is now
`claim-revision`.

### Difference tie-band and certificate limit

The switch tie-band now evaluates the complete prescribed maximum of the
candidate-minus-incumbent cost-difference change. Perturbations move only the
rival centre by its measured `±σ` at each base binding station; candidate and
incumbent receive the same perturbation, and no early witness truncates the
reported maximum. A retained incumbent receives the same computed diagnostic
β as a winning challenger. The arithmetic primitive and focused evaluator
suite are green.

No β-derived certificate lifetime was issued. An independent formula audit
rejected the tempting original-claim-envelope clause as an argmin theorem:
isolated endpoint samples do not bound simultaneous multi-hazard drift,
changing σ, ego-state drift, interior/binding-station switches, feasibility
or recourse regime changes, or every alternative. A sound extension needs a
robust margin for every challenger over that full joint domain. No such bound
exists in the tree and deriving one would require either unbounded
combinatorics or a new unmeasured approximation. Per the stop-and-record
rule, active interaction certificates retain the declared `0.1 s` ceiling.

### Tier-1 work and deterministic micro-attribution

The pre-change evidence remains the flushed profile above:
evaluator+feasibility `96.2187%`, with `evaluateRacecraftDecision` at `95.3%`.
Static call attribution found that a Gaussian-clear hazard previously paid
up to `135` hard-support sweeps per candidate before reaching its screen.

The evaluator now records bounded deterministic work counters for candidate
families/seeds, spatial speed-law samples, terminal-continuation steps,
hazards, screens, viability, quadrature, recourse, unimpeded-arrival
families, conditioned families, and β evaluations. The counters are exposed
in both race and focused headless diagnostics; they do not time or alter the
simulation.

Work ordering now follows the formula's off-switches:

- hazard discovery precedes the candidate family;
- no interaction neighbor returns the zero-candidate ideal decision before
  seed construction;
- every candidate/hazard is Gaussian-screened once and cached;
- a screen-clear hazard reaches neither one-interval viability, quadrature,
  recourse, nor responsibility;
- responsibility is lazy, and its candidate-independent unimpeded arrival
  family is built once per entry/evaluation epoch and reused across hazards;
- `brake-behind` is evaluated only when its composed backward-sweep speed law
  actually adds a constraint; the shorter collision screen is deliberately
  not used as a longitudinal-reachability proof.

The focused screen-order regression proves nonzero screens with all clears
and exactly zero viability, quadrature, and conditioned-family work. The
current focused evaluator file is green `27/27`; traffic is green `6/6`,
typecheck and module boundaries are green. A touched headless-tool run
reached its pre-existing five-second tucked-follow timeout after its first
three tests passed; that timeout remains for the requested final unit-test
reconciliation rather than being widened.

## P-CE — Certainty equivalence and contact dynamics

Status: implemented; the single probe and benchmark invocations are recorded
below. P-CE lands before P-BE and the reopened P-S/P-D gates.

### Deterministic hazard and contact core

- Claims and conditioned predictions are point stations only. The
  sigma-trajectory quadrature, Gaussian overlap probability, covariance,
  persistence, CE risk utility, growth envelopes, reachable tubes, and
  sigma-scaled clearance gates are deleted. Candidate contact uses the same
  continuous four-circle body sweep as production collision, with a cheap
  axis bound before the exact sweep.
- Hazard regions are the snapshot spacetime overlap of the two point
  trajectories. No racecraft objective or responsibility code reads
  `corner.apexI`; corner metadata remains geometry seed material only.
- Hard viability is one decision interval deep and uses the derived
  `d_1int` kinematic displacement. Its response family includes normal
  lateral re-aims and the emergency surface; no worst-case horizon object
  survives.
- Asphalt minimum-overlap lambda members are always retained and priced.
  Emergency members enter only after normal response slack expires. Straight
  members sample the local surface envelope per anchor.

### Bounded response family and candidate budget

- The nested conditioned-family evaluator is deleted. A deliberation performs
  at most six full seed evaluations; deferred `Q` responses reuse the already
  evaluated family and condition only their point programs after the shared
  prefix. Residual contact is checked against every snapshot hazard, and
  `Delta_next` is subtracted exactly once in deferred slack.
- The normal family has at most five distinct members. The labelled
  `recenter` duplicate was removed because it authored the same acquisition
  geometry as `ideal`; an in-flight recenter remains available as the
  incumbent. The sixth slot is consequently available for the one jointly
  solved emergency response without exceeding the hard budget.
- Emergency direction is selected only after both surface components pass
  dense emergency-surface and protected-agreement checks. If an agreement is
  acquired while the measured car state is already outside its corridor, a
  candidate may monotonically consume that pre-existing violation; it may
  never deepen it, cross to the opposite side, or leave again after re-entry.
  This preserves a legal recovery without weakening the agreement.
- A candidate-created contest not present in the snapshot receives full
  prospective responsibility. It cannot manufacture a cheap new collision by
  choosing geometry outside the frozen snapshot region.

### Contact duration and agreement release

- The deterministic sweep retains every connected production-body contact
  episode. Overlapping circle-pair intervals are one body contact, while a
  real separation followed by re-contact starts another episode; each episode
  receives its own measured strike plus its own measured sustained-contact
  loss. This matches production's new impulse at every re-contact instead of
  underpricing several contacts as one. The sustained-pressure measurement is
  nonlinear
  (`0.052 s/s` near `0.1 s`, rising to about `0.198 s/s` by `2.4 s`), so a
  scalar `ell_grind` would silently underprice long grinding. The
  implementation preserves the measured duration curve instead. Relative to
  a scalar fit this is conservative against persistent contact and avoids an
  unmeasured reducer.
- Point claims and candidate stations carry explicit body heading relative to
  the local track tangent. Published and re-derived programs use their
  analytic controlled-line heading; ballistic rollout publishes the simulated
  car heading. Contact and contested-region sweeps consume those headings
  directly, so a spinning body's footprint is never inferred from its
  velocity direction.
- Each sampled sweep segment holds body orientation at the shortest-arc
  midpoint of its endpoint headings. Refining point stations converges this
  approximation, but its geometric error has no uniform one-sided direction;
  it is therefore recorded rather than described as conservative.
- Runtime diagnostics retain only current and maximum continuous production
  contact episode duration per pair. Agreement release uses the sporting
  body-clearance quantity, independent of tracking noise.

### Publication identity and trust audit

- Publication identity is extensional at a common epoch: a re-anchor that
  remains within its predecessor's frozen detection class keeps the same
  revision, including a changed installed authority whose complete point
  trajectory carries no detectable new information. Internal authority
  identity cannot manufacture external prediction information.
- Trust detection is frozen per actual lateral plus longitudinal control-law
  generation and rejection is irreversible inside that generation. The
  longitudinal generation changes when executed speed samples change, not
  merely when the named slow-point owner changes.
- A temporary audit proved the discarded auxiliary one-tick probe was not the
  publication it attempted to certify: it caused false revocations while
  missing real predecessor-claim breaches. It is deleted. Detection now uses
  the exact prior-claim residual for that exact generation; the same sample
  trains only a future source-class EWMA. Noise remains confined to
  divergence detection and the difference tie-band.
- Claim progress interpolation now treats local wrap/seam corrections as
  signed distances, preventing a sub-metre seam from amplifying into an
  almost-full-lap forecast.

#### Trust-support blocker found during P-CE audit

The surviving detector is not mathematically valid yet. It uses an EWMA of
absolute prior-claim residuals directly as a breach boundary. Even under a
stationary Gaussian model, `E|e|` rejects about `42.5%` of valid samples
(`36.8%` for Laplace error); starting from zero with the derived `1/3` update
weight also leaves the boundary below every repeated equal residual. A
breach-causing sample currently trains the next authority generation, so a
real departure can widen the class it just contradicted.

No replacement threshold was minted. The tree does not declare a bounded
stable-publication domain: speed, front slip/steer, initial program error,
path derivatives, and generic track width are not all bounded by the trust
contract, while an emergency publication may legitimately remain off
surface. Consequently, a sampled maximum would overclaim coverage. A proposed
three-traffic-sample bootstrap was also rejected: even for exchangeable
continuous residuals, the fourth valid sample exceeds the first three's
maximum with probability `1/4`, before accounting for speed/curvature/surface
heteroscedasticity.

The source-selection fallback deletes the invalid inference: a stable
installed authority is no longer declared lost merely because one residual
exceeds an EWMA mean. Such a point divergence still advances the publication
revision and immediately forces deliberation; instability, loss of control,
and unpublished off-surface motion still switch the prediction source. This
has a conservative performance error (extra revision breaks), not an
optimistic geometry error, and avoids pretending that an unmeasured support
bound exists. Direct installed-program error was not substituted: it omits
aged-worldline progress integration and station interpolation. No tuned
multiplier or quantile was introduced.

The rollout audit closed that avenue: a first-interval rollout still needs
epsilon for coupled contact, wake, and other post-publication disturbances,
while its analytic tail later ages into the detection window. Full-horizon
production rollout plus incremental tail state would cost hundreds of extra
physics/controller steps per interacting car-second and still would not
derive the light-contact boundary. The trust-support blocker therefore
stands.

A separate five-second Prado/faster-behind diagnostic after this deletion
recorded `0` prediction-source revisions and `0` untrusted samples (previously
`53` and `212`), so source churn is removed. It also recorded `311`
point-divergence revisions in `316` Tier-0 checks, only `2` Tier-0 accepts,
and `314` deliberations. This confirms the deliberate error direction:
publication identity remains conservative and P-S cannot claim its scheduler
theorem until a support domain or coverage criterion is supplied. Maximum
public candidates/materializations were `5 / 0`; `1,069` full seed
evaluations across `314` separate arbitrations stayed within the per-
arbitration budget.

### Objective blockers found during P-CE audit

- The incident layer exposes collision consequences but no sporting-fault
  model or penalty-seconds API. Therefore `phi * ell_sport` and off-surface
  advantage cannot be assigned honest seconds. They remain zero by absence
  of a modeled consequence, not by a newly invented price. Adding a sporting
  tariff requires a declared rule source outside this phase.
- The plan says `Q` contains residual contest exposure but does not define a
  recursive terminal value. The P-CE implementation target is the
  deterministic residual-contact bill of each complete bounded response
  against every snapshot hazard, without recursively running another argmin;
  recursion would silently introduce an unbounded horizon or an authored
  terminal approximation.

### P-CE probe

Recorded on July 19, 2026. The one permitted invocation ran the inherited
`attack-launch`, `switchback`, `faster-behind`, and
`side-by-side-corner` scenes plus a one-lap full-field Prado race, all at the
production `1/120 s` physics step and seed `101`. Every scene completed:
checksums were `25b57757`, `33ece627`, `e98c3ecf`, `8103c164`, and
`771db624`, respectively.

- The four focused scenes recorded no grass exposure and no
  prediction-source break. Their emergency-selection counts were
  `3 / 21 / 24 / 8`, all with zero attribution failures. Full-field recorded
  `1.404816197` emergency-authorized and `4.009052615` non-emergency grass
  car-seconds, `464` emergency selections, zero emergency-attribution
  failures, and `38` prediction-source breaks. The attribution rule is green,
  while "rare grass" and near-zero full-field source churn remain red
  observations; no threshold was added and no retry was made.
- Maximum continuous contact was zero in three focused scenes and exactly one
  physics step (`0.008333333 s`) in `faster-behind` and full-field. Persistent
  grinding is therefore absent in this invocation.
- Straight pull-outs were selected `689` times across the invocation. Their
  local-envelope fractions spanned `0.049565862` through `1` with mean
  `0.568891189`, and signed offsets spanned `-5.903737304 m` through
  `6.576405826 m`; the old horizon-minimum width truncation is absent.
- Focused concessions were lateral/brake/inline `88 / 0 / 132`: lateral
  concession dominates braking whenever adaptation occurs. Attempt/completion
  counts were `4/4`, `0/0`, `26/25`, `18/18`, and `682/579` by scene.
  Those counts are observations, not an endorsement of the very high
  full-field attack rate; P-BE owns its economics.
- The `faster-behind` endpoint followed a completed pass
  (`-5.372309692 m` body clearance versus a `0.086673188 m` derived floor),
  so the settled tucked-follow gap was not observed and is recorded red,
  rather than mislabelling a pass endpoint as equilibrium.
- Candidate/materialization maxima were `5/0` in every focused scene and
  `6/0` full-field.

### Verification and benchmark

Typecheck, module boundaries, and the focused claim, corridor, lane,
evaluator, traffic, collision, contact, contact-loss, cost-function,
relations, and path tests are green after the changes above. The old
headless-tool expectation that a tucked authority never breaks is still red
and is deliberately not weakened; acquisition continuity and publication
churn own that finding.

After the final contact/response integration, the directly touched suites
recorded evaluator + cost `35/35`, collision + contact-loss `13/13`, claim
`8/8`, corridor `9/9`, and relations `4/4`; the dedicated P-CE observer
aggregation test recorded `2/2`. `bun run typecheck`,
`bun run check:boundaries`, diff checking, and `bun run build` were green.
The official phase probe and isolated benchmark each completed once and are
recorded in this section.

The one permitted isolated `bun run benchmark:sim` invocation stopped itself
after sample `4/7` with
`median-gate-mathematically-unreachable`; it was not retried. Recorded
throughputs were `0.924607650x`, `1.136630261x`, `1.154860596x`, and
`1.213666350x` (calculated median `1.145745428x`) against the frozen
`62.912x` floor. Because the runner proved the median could no longer recover,
it emitted neither final candidate/materialization maxima nor evaluator
attribution. The benchmark is red and owned by the post-P-BE P-S performance
recheck; no threshold or implementation constant was changed in response.

## P-BE — Battle economics and emergent daylight

Status: in progress. P-BE lands after P-CE and before the reopened P-S/P-D
gates.

### Reconciliation and measured-proximity blocker

- The fixed daylight authority is deleted. `LATERAL_BODY_CLEARANCE`, its
  `ROOM_*` derivatives, and the diagnostic `carWid + 0.8` window no longer
  exist. Traffic occupancy and agreement partition use sporting body geometry;
  agreement release uses projected bumper clearance, and contact cleanup uses
  the production four-circle body.
- The plan's written position-value expression is dimensionally incomplete:
  `(seconds/lap) * seconds` is not seconds. Under the governing principle the
  implemented expression is
  `V = w * max(0, deltaP_secondsPerLap) * T_reopp / T0`, where `T0` is the
  derived ideal reference-lap duration. Pace evidence is the O(1)
  observation-time EWMA of actual time / ideal time advanced over the same
  progress, with decay horizon equal to the measured re-opportunity interval.
  This deviation removes a unit error; it introduces no scale or tuned key.
- The required production parallel-hold measurement was implemented over
  fourteen long-straight sectors on all seven shipped tracks, using the
  production path follower, 120 Hz physics, 60 Hz control, collision resolver,
  matched no-contact controls, episode-start counting, and doubled
  clearance/exposure grids. It did **not** produce a stationary contact-rate
  curve. Contacts appeared only at planned daylight
  `0 / 0.083333 / 0.166667 m`; the doubled-exposure counts were `8 / 2 / 1`
  over `67.2` aggregate seconds, and all rows at or above `0.25 m` were
  exactly zero. Doubling exposure from `2.4` to `4.8 s` changed the
  zero-daylight rate from `0.208333/s` to `0.119048/s`
  (`0.089286/s` absolute), so the rate is non-convergent and trends toward
  zero as the launch transient is diluted.
- The cause is structural: production has no independent lateral execution
  disturbance. Identical stable parallel commands are deterministic and
  common-mode, so the requested approximately `0.3 m` empirical knee cannot be
  measured without injecting a noise process. Corollary 10 forbids using such
  noise as prediction geometry. The harness and non-convergence evidence are
  retained, but no contact-rate interpolation or clearance tariff is
  published. `proximitySeconds` consequently remains absent/zero by missing
  measured source, not by a silent fallback. This is the phase's explicit
  stop-and-record blocker; the later probe must report daylight acceptance red
  unless another physical source is supplied.
