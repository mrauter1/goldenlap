# Plan-Trust Following — Published Trajectories, the Commitment Deadline, One Prediction

Active plan for the racing-feel stream, superseding
`superseded/racecraft_duel_dynamics_plan.md` (implemented: the one-wake
model, spacetime claims, side agreements, stateless obligations, and the
lane-program/claim machinery are the foundation this plan corrects and
completes). This plan is **self-contained** — do not re-read superseded
plans. Read `superseded/racecraft_duel_dynamics_implementation_report.md`
only for P0 reconciliation.

## Why this plan exists

Play-testing the duel-dynamics build surfaced two symptoms:

1. **Cars lose the rear on corner exit and under acceleration and start
   swerving** — on straights and high-speed corners, nearly always.
2. **Followers overslow to the car ahead in some corners**, making close
   racing impossible: the gap balloons at every corner entry.

Static analysis traced each to a concrete defect, and the design review
behind those defects found the real cause — a surviving piece of the
**wrong epistemics**:

**Symptom 1 — corrupted publication.** `evaluateUniformBias`
(`src/session/racecraft/lane-program.ts`) clamps lane samples to
`claim.stations[slot]`, but `slot` is a distance index (one per
`track.step`) while claim stations are **time samples** (12 over the
2.4 s horizon — see `MANEUVER_PREDICTION` in `feasibility.ts` and station
construction in `corridor-planner.ts`). Every other consumer converts
time→index; this one call site indexes raw. Consequences: the near-field
lane of every default-state car is pinned within ±executionNoise of its
own predicted lateral **at the wrong time** (slot j ≈ 2–3·j m ahead gets
the bound for ≈ 0.2·(j+1)·speed m ahead); the claim centres are then
rebuilt from the already-clamped lane (`publishedLateralRaw` reads the
lane buffer), closing a feedback loop; slot 0 is clamped even though the
first sample must be the measured car position; the distortion is written
with `secondDerivative = 0`, so `lane.k`/`lane.v` never price it; and the
clamp vanishes abruptly where stations run out (~slot 12), inside the
steering lookahead range. The controller chases a laterally-jumping
target at full throttle; drive consumes the rear friction circle; the
slip guard bang-bangs the throttle; the car fishtails. The mismatch
scales with speed, which is why it presents on exits, straights, and
fast corners.

**Symptom 2 — worst-case following.** `trafficReachabilitySpeedCap`
(`src/core/physics.ts`) composes the leader's **current** speed, the
**maximum** curvature anywhere in the follower→leader span
(`upcomingMaximumCurvature`), and corner-limited braking applied to the
**entire** stop (the headroom-fraction inequality is algebraically
"both cars brake at hf·a for their whole stopping distance"). The moment
a leader is near its lateral limit mid-corner — every leader, every
corner — the follower's cap collapses to roughly the leader's current
speed regardless of gap, and `botStep` applies it as an instantaneous
target (`vt = trafficAllow`). The follower brakes to apex speed when the
*leader* reaches the corner, not at its own braking point. On top, a
fictional human `reactionSeconds` pads the envelope for agents that
observe perfectly and re-decide every tick.

**The design finding.** The claim system already publishes every car's
chosen trajectory (`publishedLateral`/`publishedSpeed` read the actual
lane program), measures how faithfully it is executed
(`executionNoiseMetres`), and revokes trust when execution diverges
beyond credibility (contract revocation → actual-occupancy claims). The
follow cap is the one subsystem that never adopted this ontology: it
models the leader as a panic-braking hazard — an adversarial assumption
smuggled into a cooperative-information world. That is the underlying
reason both close racing and honest stations were unreachable.

## Governing principle

**Assume every rival executes its published plan, bounded by its
measured execution noise, re-verified every tick.** Corollaries, each of
which this plan enforces somewhere concrete:

- **The decision tick is the reaction time.** The only latency anywhere
  is one arbitration interval (`TRAF_DT`). Simulated human reaction
  seconds in safety envelopes are deleted. Driver imperfection expresses
  itself through the channels built for it — execution noise, focus,
  mistake probability, margin — never through inflated standing margins.
- **The equilibrium gap is derived, not asserted.** How far can reality
  diverge from a published plan before the next tick observes it? At
  30 Hz an unplanned full brake diverges ~½·a·dt² ≈ 2 cm in position
  before it is re-planned against. Bumper gap = carLen + execution noise
  + one-tick divergence ≈ the 0.5–1 m station target, with zero free
  parameters.
- **Predicted conflict far enough ahead is a trajectory problem, not a
  braking problem.** The response ladder is: change line (costs ~zero
  time) → change speed profile at the location where it binds → brake
  now (only when prediction failed). Urgency — time-to-conflict versus
  time-to-complete-each-response — decides which rungs are feasible; the
  evaluator's existing cost decides among the feasible ones.
- **Brake asymmetry is a commitment deadline, not a gap.** A dead-tyre
  follower may sit at 0.5 m as long as, by the leader's braking point,
  the trajectories do not overlap — offset to either side, or slowed in
  line. `t_commit = t_leaderBrakes − max(t_lateralMove, t_shed)`.
  Until then, tucking in is free; at t_commit the choice is made and
  priced. This *is* the anatomy of an out-braking move.
- **Surprise is priced, not prevented.** Trust revocation handles cars
  that stop being predictable; light contact keeps its positive finite
  cost; the suspension-damaging veto stays hard. A follower at 0.5 m
  accepts that the leader's mistake becomes its problem — that residual
  risk is the sport, and the incidents it occasionally produces are
  authentic, not model failures.

Design standard unchanged from the superseded plan: every fix lands as a
correction to **one existing definition**, derived constants only, **zero
new registered keys**, net deletions.

## P0 — Reconcile before building

Read `superseded/racecraft_duel_dynamics_implementation_report.md` and
the tree; confirm the duel-dynamics phases actually landed (one wake,
side agreements, cap-as-candidate wiring, P-D deletions of `priority.ts`
/ `corner-rights.ts` / `obstacles.ts`, pit destination flow). Finish any
incomplete deletion before P-A. Benchmark at or above the recorded
floor; typecheck clean. Record the reconciled status at the top of the
new implementation report (`racecraft_plan_trust_implementation_report.md`).

## P-A — Honest publication (prerequisite for everything)

Plan-trust only works if published plans are geometrically true. This
phase is a bug-fix phase; behavior *changes* only by removing corruption.

1. **One definition of "claim bounds at a longitudinal position."** Add a
   single helper (owned by `corridor-planner.ts`, since it owns station
   construction): given a claim and a track position `s`, interpolate
   `minimum`/`maximum`/`centre` between the two stations bracketing `s`
   (stations carry `s`); before the first station, bounds are the car's
   measured lateral ± execution noise; beyond the last station, the
   claim does not speak — unbounded. `evaluateUniformBias` uses this
   helper at each slot's `s` instead of `stations[slot]`. The evaluator's
   zero-state read (`evaluator.ts`, currently `stations[0]`) uses the
   same helper at the car's own `s`. No other consumer changes.
2. **Slot 0 is the measured position, never moved** — parity with
   `evaluateDeformedProgram`'s existing rule.
3. **Distortion is priced.** `evaluateUniformBias` writes the realized
   `secondDerivative` by finite difference over the realized slot
   offsets (the repair pass in `evaluateDeformedProgram` already shows
   the form) so any residual clamp deformation appears in `lane.k` and
   therefore in `lane.v`. A clamp that bends the lane must slow it.
4. Verify no other distance-indexed read of time-sampled stations exists
   (audit every `stations[` site).

Probe (once, at phase end): lone-car laps on two tracks — lane buffer
must equal the ideal line (max |off − ideal.off| ≈ 0 outside deliberate
programs), steering activity and lap time at parity with the recorded
benchmark; the rear-loss/fishtail episodes are gone; `trackingError`
distribution collapses to the execution-noise floor.

## P-B — The leader is its published trajectory

The core swap. Ordinary following stops being a worst-case speed cap and
becomes a non-overlap condition against the leader's published stations.

1. **Derive the follow constraint from the leader's claim.** For
   follower F behind leader L: each of L's stations (time, `s`,
   published speed, centre ± noise) yields a candidate slow point at
   `distance = alongTrack(station.s − F.s) − carLen − noiseMargin`
   (reuse the existing execution-noise margin; no new constant) with
   `speed = L's published speed at that station`, plus L's current
   position as the degenerate station. The **binding** one under the
   existing braking-allowance math becomes `F.trafficSlowPoint`. This is
   how "the leader will brake at the corner" reaches the follower as a
   slow point located *at the corner*, and "the leader is accelerating
   away" dissolves into no constraint at all.
2. **botStep consumes the leader inside the anticipatory horizon.** The
   traffic slow point enters the same backward integration the path
   slow points already use (`allow = sqrt(v_sp² + 2·effort·room·d)`).
   The instantaneous clamp (`vt = trafficAllow` when below current
   speed) is **deleted**. At `d` → floor gap the formula degenerates to
   match-the-leader's-published-speed, which preserves the gap-floor
   station behavior; the existing one-step throttle ceiling may stay for
   station-keeping smoothness.
3. **Deletions.** `trafficReachabilitySpeedCap`, its bisection and
   `transientReactionClosure` (`core/physics.ts`); the headroom-fraction
   gap inequality; `upcomingMaximumCurvature`'s role in following; the
   worst-case `leaderStoppingDistance` threat interpolation in
   `followReachability`; the human `reactionSeconds` term in
   `followReachabilityResponseSeconds` — `TRAF_DT` is the only latency.
   The registered `reactionSeconds` key survives only where it models
   something real (claim-noise decay); its follow-envelope consumers go.
   `queueFollowCap` (pit/quali comfort spacing) is a different regime —
   untouched.
4. **Trust fallback, unchanged machinery.** When L's claim is untrusted
   or revoked, its stations already degrade to actual predicted
   occupancy (current lateral, measured speed, wider noise) — the
   consumer in (1) reads the same station form and needs no special
   case. The reactive evaluator run and the damaging-contact veto remain
   the parachute for divergence inside one tick.
5. **Brake asymmetry emerges.** The binding station sits where L's
   published profile brakes; F's own profile solves F's own, possibly
   earlier, braking point. No standing gap term exists anywhere in the
   system after this phase.

Probe: two-car scenario set — gap time-series through corner entry (the
bumper gap at the leader's braking point ≈ the straightaway gap; no
ballooning); station-gap distribution mode in 0.5–1 m; overslow observer
(`followCapDeficit`-family) ≈ 0 while gap exceeds the noise floor;
lap-time loss while following a same-pace leader ≈ 0; hard contacts
within the existing bound. Run the shared benchmark once here.

## P-C — The commitment deadline

With following free until it binds, racecraft is the decision at the
deadline.

1. **One derived quantity owns the attack/stay decision.**
   `t_commit = t_leaderBrakes − max(t_lateralMove, t_shed)`, where
   `t_leaderBrakes` is read from L's published stations (first station
   whose planned deceleration exceeds lift), `t_lateralMove` is the
   existing `physicalLaneEscapeSeconds` to full body clearance plus both
   cars' execution noise, and `t_shed` is F's own profile math to shed
   the closing speed in line. No new constants: every term is derived
   from published profiles and existing noise.
2. **Before `t_commit`**: no constraint beyond P-B non-overlap — tucking
   at the floor gap is free, on dead tyres or fresh.
3. **At `t_commit` the evaluator must hold a chosen candidate**: (a)
   in-line — adopt the P-B slow point, keep position for the exit; or
   (b) offset inside/outside — a lateral program reaching clearance by
   `t_leaderBrakes`, carrying F's own braking point deeper and arriving
   alongside, where the existing co-presence/side-agreement machinery
   takes over and the widening-wake model prices the tow lost per metre
   of offset. Selection uses the existing evaluator cost — no new
   weights. Commitment stability: after `t_commit` the choice may not
   flip-flop tick-to-tick (the side agreement and program-reason
   invariant already provide the memory; use them, add no state).
4. **Deletions.** `lateralEscapeSpeedCap`'s role as emergency
   *permission* — its escape-time math is repurposed as `t_lateralMove`;
   the binary `alongside()` early-return in the (now deleted) follow-cap
   path — continuous co-presence subsumes it; `leaderThreatDeceleration`
   worst-case reading — replaced by L's published profile.

Probe: out-braking attempt rate behind a slower leader at corners with a
viable side (must be > 0 and complete without hard contact); switchback
episode completes; commitment stability (no candidate oscillation after
`t_commit`); being-passed lap loss ≈ 0.

## P-D — Residue, observers, tally

1. Sweep dead code: old cap diagnostics that no longer have a producer,
   orphaned fields on `TrafficSlowPoint`/`Entry`, tests that encoded the
   worst-case envelope's behavior (delete, don't port).
2. Observers (bounded, headless-surface): station-gap distribution;
   commitment decisions per corner (in-line vs offset counts);
   reaction rate per lap (existing — reactions are the residue of
   prediction failures, and under plan-trust that residue is the
   standing model-quality metric); contact rates by severity.
3. Deletion tally reported — this plan should be net-negative in lines.

Probe: full-field race scenario — invariants zero, hard contacts within
bound, no parking, benchmark at floor.

## Implementation contract

- **File map**: `corridor-planner.ts` (claim-bounds-at-s helper, station
  reads), `lane-program.ts` (uniform-bias fix, secondDerivative),
  `evaluator.ts` (zero-state read, commitment candidate, stability),
  `traffic.ts` (station-derived slow points, `t_commit`, deletion of the
  follow-cap path), `paths.ts` (followReachability replacement),
  `core/physics.ts` (delete reachability/transient-closure; keep
  `brakingSpeedCap`, `brakingDistance`, wake), `core/autopilot.ts`
  (traffic as horizon slow point; delete the instantaneous clamp),
  `strategy.ts`, `session/model.ts`, `entry.ts`, headless observer
  surfaces, and their tests. Pit internals and `queueFollowCap` remain
  untouched.
- **Constants**: **zero** new registered keys. Reused: `TRAF_DT`,
  execution-noise margins, `wakeSpreadRate`, existing evaluator weights,
  the hard-contact threshold. Any new constant is a design failure; any
  gap or deadline must be derived from published profiles, noise, or the
  tick.
- **Budgets unchanged and enforced**: candidates ≤6, materializations 0,
  cadences 120/60/30/10/5 Hz, benchmark at its recorded floor (run once
  after P-B and once after P-D).
- **Per edit**: typecheck + the single touched test file. **Per phase**:
  the one probe above, run once. No statistical tiers or sweeps; never
  tune against a single seed; a red probe with a named owner is recorded
  and passed over, not tuned away.
- **The user is the outer loop, in parallel**: at each phase end — `bun
  run build`, post a 3–5 line summary (what changed, what to watch for
  while playing), continue immediately into the next phase. Never wait
  for a verdict. Fold feedback in via the fast loop when it arrives.
- Update the status table below as phases land; append short per-phase
  entries to `racecraft_plan_trust_implementation_report.md` (probe
  result, diff scope, deliberate expectation changes, deviations with
  reasoning — conflicts resolve to the physically honest reading,
  documented).

## Status

| Phase | Status |
|---|---|
| P0 — Reconcile | complete; inherited benchmark red recorded for P-B recheck |
| P-A — Honest publication | complete; two-track solo probe green |
| P-B — Leader as published trajectory | complete; near-touch escape red → P-C; benchmark floor red → P-D |
| P-C — Commitment deadline | complete; single-seed attack/switchback reds recorded to P-C |
| P-D — Residue, observers, tally | implementation complete; final audit findings recorded |

## Acceptance (user-visible, on-screen)

- No car loses the rear or fishtails on corner exit, straights, or
  high-speed corners in ordinary running; lone-car laps are at parity
  with the recorded benchmark.
- Followers tuck to ~0.5–1 m and **stay there through corner entry** —
  the gap no longer balloons at every corner; each car brakes at its own
  braking point.
- Out-braking moves happen: followers visibly commit inside or outside
  before the braking zone, or visibly settle in line for the exit —
  chosen per corner, stable once chosen.
- A leader's mistake with a follower at close range may produce contact;
  light contact stays priced and battle-preserving, damaging contact
  stays vetoed; hard contacts within the existing bound; no parking
  without physical blockage.
- Net lines deleted; zero new constants; all invariants zero; no
  performance regression.

## Beyond this plan

The evidence-gated backlog carries forward unchanged (symmetric EV, bias
registry, the design razor — joint-game degree of freedom AND reads on
screen). Nothing beyond P-D is scheduled.
