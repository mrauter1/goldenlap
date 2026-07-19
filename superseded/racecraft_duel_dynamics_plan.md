# Duel Dynamics — One Wake, Spacetime Claims, Reactive Minimalism

Active plan for the racing-feel stream, superseding
`superseded/racecraft_space_seeking_plan.md` (implemented: the evaluator,
claim machinery, EV opportunity layer, and their phases are the foundation
this plan corrects and completes). This plan is **self-contained** — do not
re-read superseded plans.

It exists because play-testing the implemented build surfaced three symptom
clusters, each traced to a hole in the model the optimizer was handed —
the engine is working; three pieces of racing knowledge are missing:

1. **Followers park touching the leader's bumper and never pull out.**
   The escape-speed branch bypasses the standoff (`cap = max(brakeCap,
   escapeCap)` with no floor), light contact is costless, the wait posture
   was specified as *minimum gap* (a pass trap: zero gap = speed-matched =
   zero launch energy), and the wake model overtaxes the first meter of
   pull-out (lateral taper independent of distance — no side draft).
2. **Side-by-side cars converge onto the same line and interlock.** The
   racing-line zero state is track-relative (a single-car principle applied
   to a multi-car world), conflict resolution is memoryless (re-derived
   each tick → converge-trim-reconverge), and reason-expiry mid-pass
   actively recenters a passer into its victim.
3. **Reactions overshoot — cars park instead of losing minimum time.**
   Safety caps bind the chosen candidate unconditionally instead of
   defining the brake-behind option, so the reactive channel restores
   safety with no regard for cost.

Design standard for every fix here: it lands as a correction to **one
existing definition**, at most **one new piece of bounded state** in the
whole plan, derived constants only, net deletions.

## P0 — Reconcile before building

Read `superseded/racecraft_space_seeking_implementation_report.md` and the
tree; confirm which phases actually landed (the previous session was
mid-stream). Finish any incomplete deletion or phase item **before** P-A —
in particular: no duplicate authority (the legacy path planner must be
gone), benchmark at or above its recorded floor, canaries live. Record the
reconciled status at the top of the implementation report. This is the
consolidation-gate discipline: from here on, symptoms have one generation
of code to blame.

The unreported M12 deep-brake branch is not landed foundation. Delete its
candidate, state, braking override, diagnostics, and tests completely; do not
complete it from the superseded plan.

## P-A — One wake, honest stations

1. **The wake becomes one physical object.** New single definition in
   `core/physics`: `wakeEffect(ds, sep, speed) → { drag, grip }`. Strength
   falls off longitudinally (keep the existing form); a **plume half-width
   grows with `ds`**; the follower's effect is `strength ×
   bodyOverlapFraction(sep, width(ds))`. Tow consumes `drag`
   (`entryMods`), dirty air consumes `grip` (`entryDynamicMu`). This
   **deletes** the two independent lateral tapers (`towWakeStrength`'s
   `1 − sep/2.5` and the dirty-air taper) — one wake, two effects. Side
   draft emerges from the product: near the tail, strength ≈ 1, so partial
   overlap still yields a meaningful tow — pulling out is no longer
   over-taxed in its first meter. One registered constant with bounds and
   rationale: `wakeSpreadRate` (plume growth per metre).
2. **The gap floor is the noise constant's second job.** In the escape
   branch (`lateralEscapeSpeedCap` path, `paths.ts`): `usableGap =
   distance − (carLen + executionNoiseMargin)` — the *same* margin the
   claims already use (reuse the existing constant; do not mint one). At
   or under the floor the cap equals leader speed: match, never close.
   Expected equilibrium: followers station at ~0.5–1 m of bumper gap.
3. **The launch station replaces the minimum-gap station.** One closed-form
   function in the opportunity (M6) module:
   `optimalLaunchGap(follower, leader, opportunity)` — the gap that
   maximizes arrival overspeed at the commit point, using the wake-drag
   profile over the closing run (closed form or a ≤5-point scan, at the
   existing tactical cadence). The wait posture's hold/brake-behind
   candidate targets `g*`. The minimum-gap station logic is **deleted**.
   Hang-back-and-run becomes what waiting is.
4. While here, verify the shift/pull-out candidate is not taxed at the
   transition moment (no cap or claim penalty binding a candidate whose
   trajectory diverges from the leader — see P-C rule, which owns the
   general fix).

Probe (once, at phase end): side-draft scenario (partial-overlap tow > 0
near the tail), station-gap distribution (mode in 0.5–1 m, zero touching),
pull-out rate behind a slower leader on a straight with a free lane.

## P-B — Spacetime claims and parallel running

1. **Codify physical co-presence instead of binary prohibition**:
   *trajectories may overlap; contact is an outcome with severity and cost.*
   Conflict requires **co-presence** (the corridor stations already project
   ego and rivals at the same time sample — this is correct; keep it). At
   the first predicted body contact, use the same relative-normal-speed
   contact definition as the collision solver. A predicted
   suspension-damaging contact is infeasible. A predicted light contact
   remains feasible and pays a continuous progress/risk cost derived from
   its physical contact response, normalized by the existing hard-contact
   threshold and existing evaluator weights. It is never a zero-cost choice,
   but it may honestly cost less than a large lift or parking maneuver. The
   blanket `predicted-occupancy` veto is deleted; ordinary claim overlap is
   evidence to price and react to, not proof of damaging contact. Explicit
   pit reservations, wrong-side protected allocations, and damaging-contact
   predictions remain hard vetoes. Audit every claim/veto path against this
   rule: nothing static or persistent may forbid a crossing whose
   participants are never co-present. Add it as a scenario probe (a
   switchback whose trajectories cross must complete).
2. **The side agreement — the plan's one new piece of state.**
   `sideAgreements: pairKey → { side, since }`, created when two cars come
   alongside (body overlap), released at bumper-clear plus hysteresis.
   While live: priority between the pair is stable (no adapter
   flip-flopping at near-equal progress), and both cars' claims and zero
   states are biased to their agreed sides. Bounded by the number of
   overlapped pairs, deterministic, dropped at release. The conflict
   resolves **once per episode, not once per tick** — this kills the
   interlocked-tie failure at its root.
3. **The zero state becomes claim-relative.** An empty program evaluates
   to the bias line **clamped to the car's current claim** (and to the
   agreed side while an agreement is live). Recentering into occupied
   space is not a candidate. The side agreement **is a live reason** under
   the program-reason invariant — so "offset while alongside" needs no
   exception, and reason-expiry mid-pass hands the offset to the
   agreement instead of steering the passer into its victim.

Probe: tie canary (mutual-steer-in episodes = 0 across the side-by-side
scenario set), crossing scenario completes, no same-line convergence while
alongside, being-passed lap loss ≈ 0; a predicted light-contact candidate
remains feasible with positive cost while an otherwise-equivalent
suspension-damaging candidate is vetoed.

## P-C — Reactive minimalism

1. **Caps are candidate inputs, never overrides.** The rule that ends
   parking: a reachability or emergency cap defines the `brake-behind`
   candidate's speed; the slow-point handed to `botStep` binds **only
   while the chosen candidate's trajectory remains behind the leader**.
   Choose a swerve, and the cap is moot. Vetoes stay hard; unconditional
   speed authority outside the evaluator is deleted.
2. **The reactive channel gets its objective stated**: restore separation
   at minimum time loss — smallest sufficient action first (swerve within
   claim → partial lift → brake sized to just clear, never to zero),
   while allowing a positively priced light rub when it loses less time than
   every avoidance candidate. Damaging contact remains infeasible. Reactions
   are auto-expiring and return authority to the active channel immediately.
   Implementation shape: the existing event-triggered evaluator run *is* the
   reactive channel; this phase removes the last paths where safety acts
   outside it.
3. **Two observers**: reaction rate per lap and emergency-lift count —
   reactions are the residue of prediction failures, so reaction rate is a
   standing model-quality metric, not just a behavior stat.

Probe: parking events (near-zero speed without physical blockage) = 0
across the scenario set; reaction rate recorded as baseline; the M3-era
yield-loss red re-measured (owner here if it persists).

## P-D — Obligations are relations, not lifecycles

The governing distinction: **protocol defines who owes what** (one-line
trigger predicates — the rulebook, legitimate); **the formula decides
how** (rule-cost + claims + the reactive channel's minimum-loss
objective). Any state machine deciding *how* an obligation is discharged
is legacy. One **non-impedance relation** replaces four mechanisms:

`owes(A, B)` ⇒ A pays rule-cost for candidates impeding B's predicted
line, and discharges reactively at minimum time loss. Triggers:

1. **Blue flag** — A is a lap down and B closes within the catch window
   (predicate only; the acquisition/yield-side/hold-distance/rejoin
   lifecycle is deleted).
2. **Qualifying traffic** — A on an out/in-lap, B on a flying lap
   (`applyQualifyingTrafficSafety` and the parallel qualifying-priority
   lifecycle are deleted; same relation, different trigger).
3. **Damaged car** — A has a failure; its reduced capability is already
   in grip/margin; the forced offline-lane targeting and caps are
   deleted.
4. **Pit approach** — pit intent becomes a *destination constraint* on
   the lane program (end at the pit-entry offset); the evaluator routes
   there through ordinary claims; the 180 m peel targets, merge-busy
   scans, and hold-point machinery are deleted. Merge-out is a claim
   request under normal priority. (Pit-lane internals — reservations,
   boxes, speed limit — remain protocol.)

Additionally: **obstacles collapse into the contract system.** A car
deviating beyond credibility from any program has its contract revoked;
its claim becomes its actual predicted occupancy (for a stopped car, a
fixed region), and everyone routes around it via ordinary co-presence
candidates. The obstacle episode lifecycle
(candidate/persistent/declared/cleared, expected-speed thresholds,
avoid timers) is deleted; what survives is the one-line hazard predicate
and emergency runoff authorization as a veto-relaxation rule. Any
remaining corner-rights record lifecycle found during P0 is folded into
the same formula and deleted here. There is no replacement pre-overlap
right: predicted co-presence, continuous light-contact cost, and the
damaging-contact veto make avoidance emerge from candidate optimization.
The side agreement still begins only at actual longitudinal body overlap,
stabilizes the lateral order that physically exists, and releases at
bumper-clear plus execution-noise hysteresis.

Probe: blue-flag scenario (beneficiary passes at full speed, yielder
loses ≤0.5 s, lift only in geometric single-file spans); qualifying
traffic scenario; a stopped-car scenario (field routes around, no
episode counters); pit approach/merge scenario (no peel machinery, no
deadlock). Deletion tally reported — this phase should be strongly
net-negative in lines.

## Implementation contract

- **File map**: `core/physics` (wakeEffect), `core/collision` (one shared
  predicted/actual contact-severity and response definition), `paths.ts`
  (gap floor and dedicated pit-path ownership), evaluator + opportunity
  module (launch gap, zero state, side agreements, cap-as-candidate,
  pit-entry destination, and light-contact cost), `strategy.ts` (wake
  consumers), `traffic.ts`, `corridor-planner.ts`, `feasibility.ts`,
  `model.ts`, `entry.ts`, the headless observer surfaces, and their tests.
  P-D deletes `priority.ts`, `corner-rights.ts`, and `obstacles.ts`; it may
  remove their dead integration fields wherever found. Pit-lane internals
  (`pit.ts` reservations, boxes, speed limit, and dedicated in/out path)
  remain untouched; only the road approach and merge-hold double authority
  are removed. If sharing the existing hard-contact classification requires
  moving it, move it rather than duplicating it.
- **Constants**: one new registered key (`wakeSpreadRate`); everything
  else reuses existing constants (`executionNoiseMargin`, tow/drag model,
  clearance definitions, and the existing suspension-damaging contact
  threshold). A second new constant is a design failure.
- **Budgets unchanged and enforced**: candidates ≤6, materializations 0,
  cadences 120/60/30/10/5 Hz, benchmark at its recorded floor (run once
  after P-A and once after P-C).
- **Per edit**: typecheck + the single touched test file. **Per phase**:
  the one probe above, run once. For this implementation session, the user's
  explicit sequencing instruction defers every probe and benchmark until all
  P0–P-D implementation is complete. No statistical tiers,
  browser checks, or sweeps; never tune against a single seed; a red
  probe with a named owner is recorded and passed over.
- **The user is the outer loop, in parallel**: at each phase end — `bun
  run build`, post a 3–5 line summary (what changed, what to watch for
  while playing), continue immediately into the next phase. Never wait
  for a verdict. Fold feedback in via the fast loop when it arrives.
- Update the status table below as phases land; append short per-phase
  entries to `racecraft_duel_dynamics_implementation_report.md` (probe
  result, diff scope, deliberate expectation changes, deviations with
  reasoning — conflicts resolve to the physically honest reading,
  documented).

## Status

| Phase | Status |
|---|---|
| P0 — Reconcile | complete; build/boundaries/parity green, benchmark red and attributed |
| P0 blocking audit — benchmark floor | red: 14.545× clean median vs 62.912× floor (P0 owner) |
| P0 blocking deletion — orphaned, unreported deep-brake authority | complete |
| P0 blocking remediation — stale lane-program bindings | complete |
| P-A — One wake, honest stations | complete; probe red on pull-out, station mode unmeasured (P-A owner) |
| P-B — Spacetime claims, parallel running | complete; probe red on convergence/ping-pong/crossing (P-B owner) |
| P-C — Reactive minimalism | complete; probe green, reaction baseline recorded |
| P-D — Obligations as relations | complete; probe red on blue-flag loss, stopped routing unmeasured (P-D owner) |
| P-D blocking deletion — corner-rights lifecycle and protected-corridor authority | complete |
| P-D blocking deletion — priority records and qualifying safety lifecycle | complete |
| P-D blocking deletion — obstacle episodes and avoid timers | complete |
| P-D blocking deletion — pit peel, merge scan, and merge hold | complete |
| Final deterministic audit | parity/build/boundaries green; invariant script red on track-owned fixture/timeout |

## Acceptance (user-visible, on-screen)

- Followers sit ~0.5–1 m off the bumper — close, never touching — and
  visibly drop back to the launch gap before making a run.
- Pull-outs happen: a faster car in the tow attempts the pass instead of
  parking; side draft keeps partial tow through the move.
- Side-by-side pairs run parallel arcs — no mutual steer-in, no ties;
  crossing maneuvers (switchbacks) complete.
- No car parks without a physical blockage; reactions are brief and
  cheap; blue-flag yields cost the yielder ≤0.5 s.
- Hard contacts ≤30; light contact is uncapped, positively priced, never a
  blanket feasibility veto, and never triggers concession or forced recovery;
  all invariants zero, no performance regression.

## Beyond this plan

The evidence-gated backlog and destination discipline from the superseded
plan carry forward unchanged (symmetric EV; the bias registry on the
ruleCost channel with protocol/IOU classification and table-share
observer; the design razor — joint-game degree of freedom AND reads on
screen; candidates activate only on canary evidence plus the user's
play-testing). Nothing beyond P-D is scheduled.
