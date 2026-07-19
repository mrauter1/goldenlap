# Racecraft Trajectory Revamp — One Continuous Lane, Real Alternate Lines

Active plan for the racing-feel stream, superseding
`superseded/racecraft_racing_feel_plan.md` (implemented; its intent-layer
work — brake reachability, pressure, sporting defense, alongside rules,
light-contact policy — is kept). This plan replaces the **lateral geometry
architecture** underneath that intent layer, because the remaining symptoms
are structural, not tunable:

- attackers move to a "completely different lane" 4–5 car lengths back
  instead of sitting tucked in the tow;
- cars visibly hop between fixed lanes;
- battling cars lose ~10% lap time where 1–3% is the realistic cost;
- consequently followers never arrive close enough, and overtakes stay rare.

## 1. Why the current architecture cannot be tuned into correctness

Five structural defects, each verified in source:

1. **Two competing lateral authorities.** A car's lateral target is either a
   scalar offset on the shared ideal path (`lat`/`latTgt`) *or* an installed
   full-track `SampledPath` from a `PathPlan` — and authority flips between
   them constantly. Every `installPlan` zeroes the scalar channel
   (`paths.ts:1057-1058`) and may step the effective target by up to 0.5 m,
   with installs chained as fast as every 0.35 s. The pursuit controller
   converging on step-changed targets *is* the visible, unnatural
   lane-hopping.
2. **Offline geometry is a parallel shift, not a line.** The scalar channel
   prices an offset with `v·√(1 − k·lat)` clamped at 0.75
   (`autopilot.ts:59`) — up to 25% slower — and materialized plans blend a
   handful of anchors with smootherstep, which near a corner produces the
   ideal line *translated sideways*: wrong entry angle, wrong apex, wrong
   exit. Nobody in the sim knows what a real inside line is, so being
   offline costs several times what it should. That is the ~10% battle
   loss, and no constant fixes it — the *lines themselves* are wrong.
3. **Attacks leave the racing line immediately.** The moment an attack
   fires (up to 60 m back), `atkSide` is set and the corner plan pulls the
   car offline through the whole approach (`traffic.ts:1004-1012` and the
   `setTargetAbsLat(tr, e, target)` that follows). A real attacker stays in
   the tow on the racing line and makes **one late move** timed to arrive
   at the brake point. "Stalking" was added but only defers *which corner*
   — not the premature line change on the chosen one.
4. **Mode churn is lane churn.** attack → tuck → rejoin → ideal are
   different full-track paths with different keys; every semantic
   transition re-anchors geometry. Even with slew guards, each handoff is a
   target step plus a `REJOIN_DISTANCE` blend — the fixed-lane look.
5. **The cost structure kills the incentive to race.** Because offline =
   naive geometry = huge loss, every heuristic downstream (feasibility
   demand caps, corner speed, zipper, exit tucks) correctly concludes the
   move is bad — and cancels it. The intent layer got smarter (pressure,
   stalking, switchback) but executes onto geometry that loses seconds.

## 2. What other racing games do (and what we adopt)

- **Authored/precomputed alternate lines per corner** (GTR2/rFactor
  lineage, Codemasters F1): each corner carries an inside ("overtaking")
  and outside line with their *own* brake points and apex speeds; AI blends
  between whole lines. → **Adopt at build time**: we already have a racing-
  line optimizer and semantic corners; extend it to emit per-corner
  inside/outside variants with correct entry/exit geometry.
- **Continuous lateral-offset channel over one reference line**
  (TORCS/K1999 bots, Forza-style AI, and the Frenet-frame local planning
  standard in autonomous driving): the car's trajectory is `ideal(s) +
  η(s)` where η is a smooth function the AI edits locally; curvature and
  speed are evaluated from the *actual deformed line*. → **Adopt as the
  runtime representation** — it merges the two lateral authorities into
  one and prices every move honestly.
- **Late, committed overtaking moves** (every competent racing AI): stay on
  line in the tow; the pass is one lateral transition whose start time is
  computed backward from the brake point. → **Adopt as the only legal
  attack shape.**
- **Full per-car line re-optimization every frame** (GT Sophy-class
  learned policies): → **Reject** — violates the runtime budget and
  determinism; our corridor/feasibility layer already covers the safety
  half of what it buys.

## 3. Target architecture

One lateral channel per car: a **lane program** — a short, piecewise-smooth
lateral offset profile `η(s)` over the next ~300–400 m, relative to the
ideal line. No racecraft `SampledPath`s, no modes-as-paths, no scalar
`lat`/`latTgt` duality (pit lane keeps its dedicated path system).

### 3.1 Data model

```
LanePoint  { s: number; eta: number }            // few per car, sorted
LaneProgram{ points: LanePoint[]; reason: string } // empty ⇒ racing line + bias
```

- Evaluation `η(s)`: smootherstep between points (same interpolant as
  today), `η'` continuous by construction; first point is always pinned at
  the car's current offset — **edits can never step the target** (this
  invariant replaces `path.maximum_target_slew_m`).
- **Local geometry**: curvature of the deformed line via the standard
  Frenet offset formula `k_lane(s) ≈ (k0(s) − η''(s)) / (1 − k0(s)·η(s))`
  (clamped; `k0` is the precomputed ideal-path curvature). Speed limit from
  the existing closed-form grip/downforce model at `k_lane`. This replaces
  both the `√(1 − k·lat)` hack and path materialization — an offset line
  is now exactly as fast as its real geometry allows, no more, no less.
- **Ring buffer**: at the 30 Hz traffic tick, each car evaluates its lane
  into a fixed-size scratch buffer (offset, curvature, speed for the next
  ~300 m) reused across ticks — `botStep` reads it exactly like it reads
  path arrays today, so the 120 Hz cost is unchanged.

### 3.2 Corner line library (build time)

For each semantic corner, precompute two alternates alongside the ideal
line, using the existing profile-optimizer machinery: **inside** (later
brake point candidate, tight apex, compromised exit) and **outside** (wide
entry, cutback exit). Store each as η control points over the corner span
plus its brake index and apex speed. These are *real* optimized lines —
driving one costs its true time (typically 0.2–0.8 s for one corner), which
is the 1–3% battle economy the game needs. Validated at build by the
existing marker/lap-ratio policies.

### 3.3 Maneuvers become lane edits

| Intent | Lane program |
|---|---|
| Clean air | empty — racing line + per-driver bias (unchanged) |
| Tuck / tow | track the leader's η while behind — **default attack posture; no line change at 4–5 car lengths, ever** |
| Attack | stay in tow; write the target corner's inside (or outside) line points; the transition start `s` is computed backward from the corner's brake point via `physicalLateralMoveSeconds` — one late move |
| Switchback | outside-line points for this corner + inside-of-exit points, completion on the following straight |
| Defend | one cover edit (J.3 legality rules unchanged — they already gate on move-time vs brake point), then the return edit |
| Corner rights | arbitration clamps each car's lane points to its corridor — records/zipper/assignment machinery unchanged |
| Avoid / obstacle / yield | lateral shift points with rejoin points |

The intent state machines (attack/pressure/stalking/defense/rights/priority)
survive as-is; only their *output* changes from "install path / set scalar"
to "edit lane points". The feasibility and corridor layers already consume
arbitrary `sampleAtIndex` functions — they evaluate the candidate lane
directly; occupancy, protected-corridor, road-bound, and candidate-count
invariants keep their meaning.

### 3.4 Tow-tuck threat model and the door rule (2026-07-16)

Target picture: cars **almost touching** nose-to-tail in the tow, then one
pull-out to pass — and a defender who cannot slam the door on a car that is
already there or already has the run. Two physical refinements deliver it;
neither is a comfort constant:

1. **Context-aware threat in the follow law.** The reachability law prices
   the leader's *full braking* everywhere, but full braking mid-straight is
   not a plausible threat — the worst plausible straight-line event is a
   lift (drag deceleration, ~5–7 m/s² at speed, computable from `kDrag`).
   Price the leader's assumed deceleration by location: lift-level far from
   any brake point, ramping to full braking effort across the approach to
   the next corner's braking zone (distance-to-`brakeI` is already in the
   follow context). Result: the gap closes to near-touch on the straight
   and *opens naturally* approaching the braking zone — which is exactly
   the real pattern, and exactly when the attacker must either commit to
   the pull-out or drop back.
2. **The lateral escape term.** What actually lets real drivers tuck at
   <5 m at top speed is that their safe response to a slowing leader is a
   *swerve, not a stop*. When the corridor planner shows a free adjacent
   lane, the reachability cap becomes
   `max(brake-behind cap, swerve-escape cap)`: near-zero gaps are safe as
   long as a one-car-width lateral move (`physicalLateralMoveSeconds`, the
   law the controller already uses) completes within the time the gap
   would close under the plausible threat. No free lane (boxed in, wall of
   cars, pit approach) ⇒ the brake-behind law stands alone, and the gap is
   honest again.
3. **The door rule — defense legality closes the loop.** A defensive move
   is legal only if the *attacker still has a safe response after it*.
   Concretely, the cover/return edit is rejected (car holds its line) when
   either: longitudinal bumper clearance to the attacker is under one car
   length — the space being closed is already occupied by intent — or the
   attacker's closing speed is high enough that, by the time the move
   completes, the attacker's brake-reachability envelope would be violated
   (they physically cannot react within their reaction + prudence budget).
   This extends the existing J.3 rule set (move-before-braking, no
   mirroring, alongside squeeze) with the same shared physics: **one
   reachability law now governs following, escape, and what counts as a
   foul** — no new constants beyond the one-car-length occupancy band.

The slipstream consequence is free: with towRange anchored to the wake
model, near-touch tucking sits at maximum tow — the pull-out has genuine
overspeed, so the pass chance is real, and forfeiting the tow by pulling
out early (scale, §symptom 3) is self-punishing rather than rule-punished.

### 3.5 The maneuver vocabulary this unlocks

The point of real alternate lines + honest costs is that classic maneuvers
stop being scripts and become *situations* — the line library gives each
one a true time profile, and the intent layer only has to pick when the
profile fits. Emergent (no new mechanism beyond this plan):

- **Slipstream drag pass** — near-touch tow (§3.4) + pull-out with genuine
  overspeed; completed on the straight, no corner needed.
- **Inside dive / out-braking** — the inside line's *later brake point* is
  in the library; a braking-character or tyre advantage converts it. Costs
  a slower exit, which is honest and sets up the counter.
- **Around the outside** — the maneuver the old parallel-shift geometry
  made impossible (outside was longer *and* uniformly slow). A real
  outside line carries more entry/exit speed; with corridor protection
  through track-out (already in corner rights), long-radius and
  double-apex corners become genuine outside-pass spots — the pass-score
  can even say which.
- **Switchback / cutback** — already an intent shape (J.2), now executed
  on real geometry: wide entry, early rotation, drive out of the corner
  underneath a defender who bought the inside with a compromised exit.
- **The over-under** — emerges from exit-speed differentials plus tow: the
  defender covers the inside, the attacker takes the fast exit line and
  completes into the *next* braking zone. Needs nothing new — it is the
  switchback whose completion window spans a straight.
- **Defensive inside + undercut-exit trade** — defending the inside is
  self-priced by the library (slower exit), so covering repeatedly leaks
  lap time: sustained defense collapses on its own, as in real racing.
- **Three-wide** — corridor assignment already supports it; honest lines
  and the alongside rules make it survivable instead of instantly zipped.

Explicit-intent additions (small policy, worth doing once the above is
observed working): the **feint** — a deliberate half-move to draw the
defender's one legal cover to the wrong side, then the real move the other
way. It is a lane edit followed by a second edit, gated by the attacker's
focus/aggression character, and it is only meaningful *because* the
defender's single-move rule (J.3) makes commitment irreversible. Audit
scenarios should assert each vocabulary item occurs and completes at
plausible rates on the tracks whose geometry supports it (pass-score
metadata says which).

### 3.6 What gets deleted

- Racecraft `PathPlan` materialization (`materializePathPlan` for non-pit),
  `entry.path` for racecraft, the mode-keyed install/rejoin/blend machinery,
  and full-track offset arrays per maneuver.
- The scalar `lat`/`latTgt` channel as a *second* authority (it becomes the
  lane program's pinned first point).
- The `√(1 − k·lat)` speed correction.
- `REJOIN_DISTANCE` blending (a rejoin is just trailing lane points that
  return to η = bias).

## 4. Migration phases

- [x] **L0 — Golden references.** Record seeded lap times, battle deltas, and
  trajectory traces on the current build (three flagship tracks) as the
  comparison baseline; extend `audit-effects` with a `lane-hop` metric
  (lateral-target discontinuity per minute) and a `battle-economy` metric
  (battling lap delta vs clean, target ≤3%; tucked following ≤1%).
- [x] **L1 — Lane program under the ideal line.** Introduce the program +
  ring buffer with empty programs (bias only); route `botStep` through the
  buffer. Behavior must be bit-comparable to today's ideal-line driving
  (parity fixtures re-recorded once). Deletes the speed hack.
- [x] **L2 — Single authority.** Re-express the scalar-channel writers (room,
  avoid, defense cover/return, yield) as lane edits with the pinned first
  point. Lane-hop metric should collapse here. Implementation and safety are
  complete; the pinned performance floor and host-timing exceptions remain
  explicitly open in the implementation report under the user's direction to
  proceed rather than continue speculative optimization.
- [x] **L3 — Corner line library** at build time + validation policies.
- [x] **L4 — Attack/tuck/switchback as lane edits** with launch timing
  computed from the brake point; rights corridors clamp lane points; delete
  racecraft path materialization and mode machinery. The implementation and
  safety/behavior gates are complete; the pinned benchmark remains a recorded
  red exception under the user's direction to stop speculative optimization
  and proceed.
- [x] **L4b — Tow-tuck threat model and door rule (§3.4).** Location-priced
  leader threat (lift on straights → full braking into brake zones), the
  lateral-escape term using corridor free lanes, and the two door-rule
  legality checks added to the defense gate. The implementation, 75-case
  calibration audit, parity capture, and fast phase gate are complete; the
  three amber anticipatory-defense observations are recorded behavioral
  findings rather than safety failures.
- [x] **L5 — Re-run the full audit suite**; re-tune only the calibration keys
  whose meaning shifted (tow is unchanged; dirty air unchanged; defense
  legality only gains the door rule). Population gates on passes, battle
  economy, hard-contact cap, DNFs. Add the §3.5 vocabulary scenarios
  (inside, outside, switchback, over-under, drag pass) to `audit-effects`
  and record which flagship corners host each, per pass-score metadata. The
  calibration and validation vocabulary audits each completed 75 cases with
  39 green / 36 amber / 0 red; the final normal population completed 60 races
  with 0 red rows, ≥128 passes at every empirical lower bound, and
  `345 / 1,359 = 25.386%` attributed completion. The committed-attempt
  denominator excludes intent selections that never reached their computed
  launch or physical protection; raw intent counters remain unchanged. No
  calibration change was retained.

Each phase lands separately (verification ladder as usual); L1/L2 are
behavior-preserving by design, so parity is checkable mechanically.

## 5. Performance budget (must hold; likely improves)

- 30 Hz per car: lane evaluation into the ring buffer is O(buffer)
  ≈ O(300) with array reuse — comparable to today's per-tick work; program
  edits are O(points) with ≤8 points.
- 120 Hz `botStep`: reads the buffer exactly as it reads arrays today —
  unchanged.
- Deleted: per-install O(track.n) materialization and validation sweeps.
- Corridor search stays 5 Hz, candidates ≤6, materializations 0 (< the old
  ≤1 bound; the invariant tightens).
- Gate: `benchmark:sim` ≥ existing pinned floor after L2 and L4.

## 6. Acceptance (the user's numbers, as policy)

- Tucked following on a straight or through corners: ≤1% lap-time loss vs
  clean air (dirty air stays ~0 by Phase K's decision).
- In-tow gap on straights with a free adjacent lane: bumper clearance
  reaches ≤3 m at top speed (near-touch tow), reopening on braking-zone
  approach (§3.4.1–2).
- Door rule: zero executed defensive moves with bumper clearance < 1 car
  length or against a violated attacker reachability envelope (§3.4.3 —
  counter, must be 0; attempts convert to holds).
- Attacking or defending through a corner: 1–3% on that lap; >3% only with
  hard contact or a rolled mistake.
- No attacker leaves the tow line before its computed launch point
  (audited: lateral offset from leader's line while `atkT > 0` and before
  launch `s`).
- Lane-hop metric ≈ 0 outside genuine maneuvers; trajectory traces show
  single smooth transitions (motion review).
- Passes: production-distance ≥100 stays; attributed completion fraction
  moves into the normal band.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Frenet curvature approximation diverges at large η·k0 | clamp `1 − k0·η ≥ 0.5` (η ≤ half the turn radius — always true on road width); L1 validates lane-vs-materialized geometry numerically against `derivePathGeometry` |
| L2 regressions in room/avoid emergencies | scalar writers are re-expressed one at a time with per-writer probes; the emergency scalar path (`installIdeal(..., preserveScalarAuthority)`) is the last converted |
| Corner library slows track builds past the profile budget | two extra optimizer passes per corner, bounded by the existing 10–20 min workflow budget; library is cached with profile provenance |
| Deterministic parity breaks | L1 is bit-comparable by construction; later phases re-record fixtures deliberately, once each |
| The zipper/rights corridors assume materialized paths somewhere | audit call sites in L0; feasibility already samples functions, corner-rights operates on offsets — expected clean |
