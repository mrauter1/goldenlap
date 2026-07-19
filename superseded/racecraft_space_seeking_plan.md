# Space-Seeking Racecraft — Steer by Default, Brake by Exception

Active plan for the racing-feel stream, superseding
`superseded/racecraft_trajectory_revamp_plan.md` (implemented — its lane
program, corner line library, and honest local geometry are the *foundation
this plan builds on and keeps*). What this plan replaces is the **decision
layer**: the tangle of intent state machines and longitudinal caps that
decide *when* a car may use that geometry.

## 1. The fundamental inversion

Every remaining symptom — over-braking followers, conservative brake
distances, overslowing instead of steering around a slow leader,
overslowing blue-flag yields, mistake storms in battles — shares one root:

> The engine's primitive interaction is **"follow by default; maneuver by
> exception."** Real racecraft is the opposite: **a driver continuously
> steers toward the fastest free space; braking for another car is the
> last resort, used only when no space exists.**

Because maneuvering is the exception, every maneuver needs permission
machinery: attack episodes, sequence numbers, cooldowns, stalking states,
tuck timers, close-gates, alongside case-analysis, an escape term bolted
onto a brake law, yield speed penalties. Each patch added realism in one
case and machinery everywhere. Meanwhile the *default* stayed "brake to
match the car ahead" — so a faster car closing on an overslowing leader
brakes (unnatural), a blue-flag yielder slows itself by a flat −3.5%
margin (`strategy.ts:232`) instead of just conceding the line (unnatural),
and the brake law must be conservative because braking is the only default
tool. The concrete mistake storm has the same shape: lockups are rolled
**per attack event** (6% per lunge, `traffic.ts:1223-1229`) — priced when
attacks were rare, absurd now that attacks are constant.

The fix is not another state: it is inverting the primitive.

## 2. The design: one local evaluator per car

Each car periodically evaluates a **small fixed set of local motion
candidates** and picks the one with the best single scalar cost. That is
the whole decision layer. Racecraft — overtaking, avoiding, yielding,
defending, tucking, giving room — *emerges* from cost shaping and
legality vetoes, not from state machines.

### 2.0 Decision cadence: ~10 Hz staggered, not 30 Hz

The legacy 30 Hz traffic tick exists because the old design used
*decisions as a control law* (the follow cap was recomputed continuously).
The evaluator separates the two, so the cadences separate too:

- **Decisions** (candidate build + occupancy sweeps + cost evaluation —
  the expensive part) run at **~10 Hz per car, staggered round-robin**
  (~⅓ of cars per 30 Hz tick): a 3× cut in the hot-loop cost, which is
  what makes the game feel slow at high time-scale. A tactical choice
  ("take the inside line") persists for seconds; re-deciding it 30 times
  a second was waste.
- **Decision staleness is folded into `reactionSeconds`** — a ≤100 ms
  old picture of the leader is not a hazard, it *is* the driver's
  perception latency, already priced by the reachability law. This makes
  the cadence physically honest rather than a corner cut.
- **Event-triggered re-evaluation** (immediate, off-cycle): the installed
  candidate fails its cheap feasibility re-check, a contact occurred, a
  corridor/rights assignment changed, or the car ahead's speed dropped
  beyond a threshold. Bounded: one off-cycle evaluation per car per tick
  maximum.
- **Control stays continuous and cheap**: `botStep` at 60 Hz keeps
  consuming the ring buffer and the cached reachability slow-point
  (refreshed cheaply every 30 Hz tick from current positions — a scalar
  update, not a decision); lateral intent integration and timer decay
  stay in the 30 Hz tick. Safety never waits for a decision.

This is the same split the codebase already proved with the corridor
planner (5 Hz search + 30 Hz cheap feasibility pass) — applied to the
whole decision layer.

### 2.1 Candidates (≤6, preserving the existing bound)

1. **hold** — current lane program continued at its physics speed;
2. **shift-left / shift-right** — one lane quantum into the adjacent
   *free interval* (the corridor planner's `buildCorridorStations` already
   computes exactly these);
3. **corner-inside / corner-outside** — the corner line library's
   alternates, offered only inside a corner's approach window;
4. **brake-behind** — stay in lane at the follow-reachability speed. The
   old default becomes *one candidate among six*, chosen only when it
   scores best — i.e., when no space is free.

Each candidate is a short lane-program edit (pinned first point, as today)
plus the max speed the free space and local geometry allow along it over
the existing prediction horizon (~2.4 s).

*Later phases extend this set within the same ≤6 bound: §4.8 adds the
always-offered **recenter** candidate (return to the racing line at the
physical lateral rate), and §4.9 adds the contextual **deep-brake duel
candidate** (the lunge — commitment as a dimension, not just space).*

### 2.2 One cost function

`cost = −progress + w_risk·risk + w_rule·ruleCost + w_switch·switchCost`

- **progress**: predicted track distance over the horizon along the
  candidate (uses the lane geometry speeds — honest since the revamp).
- **risk**: proximity to other cars' predicted envelopes (the occupancy
  sweep already computes minimum separations), surface exposure
  (curb/grass, already computed), and **grip utilization** — the fraction
  of the friction circle the candidate demands. Perceived through
  per-driver noise scaled by focus (drivers mis-estimate risk — organic
  variation), and **weighted by risk appetite composed of two factors**:
  `effective risk weight = costRiskWeight × driverRiskProfile ×
  paceRiskAppetite[pace]`. `driverRiskProfile` is each driver's
  **independent base aggression** — deterministic per-driver character
  like `brakingEffort` (seeded from the lineup, bounded ~±15%, no
  per-driver keys). `paceRiskAppetite` is a **slight** pace-mode shift
  around that base (registered triple, tight bounds ~[0.90, 1.10]:
  push nudges every driver a little braver, save a little more
  conservative — it modulates the driver's profile, never replaces it).
  The push/race/save buttons are thereby the aggression dial into the
  racecraft brain while drivers keep distinct risk personalities — which
  is precisely why no separate stakes model is needed (§4.3).
- **ruleCost**: sporting legality as costs and vetoes — illegal defense
  moves (all J.3 + door rules) are *vetoes on the defender's candidates*;
  a blue-flag yielder pays a large cost for candidates occupying the
  beneficiary's predicted line (so it drifts offline **at full speed** —
  overslowing yields disappear by construction); corner-rights corridors
  clamp which candidates exist at all (safety layer unchanged).
- **switchCost**: small hysteresis so decisions don't dither — this one
  term replaces commit timers, cooldowns, and episode holds.

Hard vetoes stay hard: feasibility (occupancy, road-bound,
controller-demand, protected corridors) rejects candidates exactly as it
rejects plans today — the safety layer keeps its role and its invariants.

*Note (M9, §4.6): once the claim ledger lands, the proximity component of
the risk term applies only to contested space and contract violations —
inside an allocated claim, proximity risk is zero by contract. §4.6
supersedes this section's proximity-risk description accordingly.*

### 2.3 Why the user-visible symptoms fall out immediately

- **"If the car ahead overslows, change direction and pass"**: the moment
  a leader is slow, `shift-left/right at full speed` outscores
  `brake-behind` whenever an interval is free. Steering *is* the default
  collision response; braking happens only boxed-in — which is also why
  the brake law can finally shed its conservatism: it no longer has to be
  the only line of defense against every surprise.
- **Close following**: the risk term prices real proximity, not a
  worst-case stop; with an escape candidate always on the menu, near-touch
  tow is the natural equilibrium (the L4b escape logic becomes *native*
  instead of bolted on).
- **Blue flags**: the yielder never slows; it takes the cheap offline
  candidate. Delete the `yieldT` margin penalty and the yield speed caps;
  keep only the priority record (who owes whom) as the cost input.
- **Mistake storm**: delete per-event lockup rolls. Error probability
  becomes **per second, proportional to sustained grip utilization ×
  (1 − focus) × wetness** — a driver who chooses aggressive candidates
  runs closer to the limit and organically carries more risk; a
  conservative driver doesn't. Mistakes self-balance with behavior
  forever, no recalibration when attack frequency changes.

### 2.4 What racecraft becomes

- **Attack**: not a state — a faster car's progress term makes offside
  candidates attractive exactly when a pass is on. The corner line
  library's pass-scores shape *where* (inside line candidate near a good
  corner scores well), tow shapes *when*.
- **Defense**: the defender's cost function values the space the attacker
  wants (position-holding term scaled by aggression/stakes), subject to
  the legality vetoes. One move, made early, emerges because a late move
  is vetoed and an early move is cheap.
- **Setup passes (switchback, over-under)**: choosing the outside-line
  candidate *this* corner because its exit-progress term wins over the
  next straight — multi-corner craft emerges from the horizon, not from
  scripted shapes.
- **Attack episodes/funnel metrics survive as *observers*** — derived
  from decision streams for the audits — not as control state.

## 3. What gets deleted (the simplification the user asked for)

- Intent state: `atkT/atkCd/atkSeq/atkSide/atkCorner`, `closeT`,
  `stalkCorner/stalkTarget`, `tuckT/_tuckWith/_tuckCorner`, `lungeT`,
  attack-shape switches, `defT` phase machinery (legality rules stay, as
  vetoes), the alongside case-analysis in `stepRacecraft`, exit/room/
  turn-in tuck logic, adaptive cooldowns.
- The per-event lockup/lunge rolls, and the `yieldT`/blue-flag slowdown
  channel.
- Most of `stepRacecraft` itself: the traffic tick becomes
  *(1) update shared observations (tow, dirty air, pressure-as-stress),
  (2) build candidates, (3) evaluate, (4) write lane edits + speed*.
- Kept unchanged: lane program + ring buffer, corner line library,
  corridor planner (it *is* the candidate generator), feasibility vetoes
  and every zero-tolerance invariant, corner-rights corridors and the
  contact policy (light contact uncapped, hard ≤30), pit and priority
  record-keeping, all of `core/` physics, the balance stream.

## 4. Migration phases

Phase status (updated during implementation):

- **Step 0 — complete**
- **M0a — complete**
- **M0 — complete**
- **M1 — complete**
- **M2 — complete**
- **M3 — complete**
- **M4 — complete**
- **M5 — complete**
- **M6 — complete**
- **M7 — complete**
- **M8 — complete**
- **M11 — probe complete; remediation required before CG**
- **M9 — complete; one-shot closure probe recorded**
- **M9 blocking deletion — complete: ballistic pairwise occupancy/prediction
  sweep removed; claim containment and contested-transition checks own
  feasibility**
- **M10 — complete; one-shot closure probe recorded**
- **M10 blocking deletion — complete: observer expiry/cancellation records
  outcomes without mutating live commitment authority**
- **M10 blocking deletion — complete: hard-contact `concedeT`/`concedeV`
  speed authority must be removed in favor of contract revocation and the
  adapter ladder**
- **M12 — in progress**
- **CG — pending**
- **CG blocking evidence — benchmark `42.689× < 62.912×`; pit-path handoff
  slew `8.182133477 m > 0.5 m`; M11 stale-program canary `2,203 > 0` and
  wandering `4.166666667 car-s`; M11 probe hard contacts `41 > 30`**
- **CG attributed canaries — M9 phantom conflicts `117`, claim ping-pong
  `13`, straight rear-loss events `1`, priority losses `1.348 s` yielder /
  `0.822 s` beneficiary, tucked authority not acquired, and near-touch
  escape transaction missing; M10 outside-blue lifts `15,523` dominated by
  obstacle handling, blue lifts outside forced geometry `23/57`; recorded by
  stratum, not single-seed tuned**

- **M0a — Surgical de-storm (land first; independent of the evaluator).**
  Two small diffs with immediate user-visible effect: (1) replace the
  per-event lockup roll (`traffic.ts:1223-1229`) and the battle-scaled
  mistake couplings with the per-second **utilization clock** of §2.3
  (probability ∝ grip utilization × (1 − focus) × wet, one registered
  rate key); (2) delete the flat `yieldT` margin penalty
  (`strategy.ts:232`) — the priority yield *line* machinery already
  routes the yielder offline and remains untouched. Probe: one 5-lap
  seeded race per flagship track; mistakes count drops to band, yield
  episodes stop showing the −3.5% pace dip.
- **M0 — Shadow evaluator.** Build candidates + cost, log the chosen
  candidate *without acting on it* into a bounded **decision log** (one
  JSON per seeded race). Weight fitting is **offline against the log** —
  a scripted grid/coordinate pass over the few registered weight keys
  maximizing outcome-agreement with current behavior — never by repeated
  re-simulation. Record the log once per seed (3 seeds × 2 tracks is
  enough); fit; done. Proves the ≤6 candidate budget.
- **M1 — Longitudinal default flip.** The evaluator owns speed: replace
  the generic/two-ahead/tuck follow-cap applications with
  `brake-behind`-as-candidate. Attack machinery still writes lateral
  intent. Acceptance: overslow trains gone (constrained-time drops),
  steering-around-slow-leader observed in the underspeed scenarios.
- **M2 — Lateral unification.** Evaluator owns lane edits; intent
  machines demoted to cost inputs, then deleted. Acceptance: attack
  funnel metrics (now observers) hold or improve; lane-hop stays ≈0.
- **M3 — Yields and blue flags.** Cost-based yielding replaces the yield
  speed caps (the margin penalty is already gone from M0a). Acceptance:
  beneficiary passes at full speed; yielder lap loss ≤0.5 s per episode;
  `priority.*` policies re-baselined.
- **M4 — Risk calibration.** Couple the M0a utilization clock to the
  evaluator's chosen-candidate utilization (one line once M2 lands) and
  sweep its rate key. Acceptance: mistakes per race in band, correlated
  with aggression/wetness, independent of attack frequency.
- **M5 — Deletion + audits.** Remove dead state/fields; extend
  `audit-effects` with evaluator-native probes (decision-agreement
  regression, steer-vs-brake ratio on overslow leaders, yield-speed
  canary); full ladder; re-record parity once.

Order: M0a → M0 → M1 → M2 → M3 → M4 → M5 → M6 (§4.2) → M7 (§4.4) →
M8 (§4.5) → M11 (§4.8, pulled early: independent bug-class fix) →
M9 (§4.6) → M10 (§4.7) → M12 (§4.9) → CG (§4.10, the consolidation
gate — after it, nothing is scheduled: the backlog is evidence-gated),
**implemented continuously —
never pause to wait for the user's verdict on a finished phase**. The
user's play-testing is an independent, parallel audit stream: each phase
end produces a playable build and a short summary, and implementation
immediately continues into the next phase. User feedback is folded in
when it arrives, like any audit result (adjust the implicated phase,
re-probe, continue); it is not a gate.

## 4.1 Implementation contract (read once, follow exactly — this is the fast path)

This section exists so implementation is fast and cheap in tokens and
wall-clock: no rediscovery, no redoing, no audit loops.

**File map (create/touch only these for the core work):**

- New: `src/session/racecraft/evaluator.ts` — candidate construction +
  cost + selection + decision-log record. Pure over existing inputs.
- Touched: `traffic.ts` (per-phase branch removal only — do not
  reorganize the file), `config.ts` (new keys), `strategy.ts` (M0a),
  `model.ts` (decision-log/observer types; field deletions only at M5),
  `feel.ts` (observers at M2), `audit-effects` + `lib/headless-sim`
  (probes/log plumbing).
- Untouched, by contract: `core/` physics and geometry, `lane-program.ts`
  evaluation, `corridor-planner.ts`, `feasibility.ts` veto logic,
  `corner-rights.ts` corridor math, pit, priority record-keeping. If a
  phase seems to need edits there, stop and re-read §3 — the plan says it
  doesn't.

**Reuse table (do not rebuild these — they exist):** free lateral
intervals per station → `buildCorridorStations`; per-candidate safe speed
→ `followReachability`/`trafficReachabilitySpeedCap`; lateral move timing
→ `physicalLateralMoveSeconds`; corner alternates + pass scores → corner
line library; occupancy sweep + separation → `evaluateManeuverPlanCompact`
internals; grip utilization → `longitudinalGripHeadroomFraction` family.
The evaluator is glue over these, ~300 lines, not a subsystem.

**Calibration keys, named now (register with bounds; do not invent
others):** `costRiskWeight`, `costRuleWeight`, `costSwitchHysteresis`,
`riskPerceptionNoise`, `mistakeUtilizationRate` (M0a). Aggression reuses
the existing per-driver character surface.

**Consumers of deleted state (update these deliberately at the phase that
deletes; do not discover by breakage):** `entry.battle`/`atkT` → UI HUD
battle flag + camera candidates (`ui/hud.ts`, `session/events`);
`atkSeq/attackEpisodes` → attack-funnel metrics in `feel.ts` +
`headless-sim` summary + `race-metrics`; `tuckT/defT` → unit tests in
`tests/unit/session/{traffic,corner-rights,paths}.test.ts` (expectations
change *by design* — update them with the phase, note it in the report);
`lungeT/lockupN` → `race-sim.js` log line.

**Verification recipe per phase (run once at phase end, in the
background; nothing else):**

| Phase | The one probe | Budget |
|---|---|---|
| M0a | `audit:effects --phase C` + one 5-lap race per flagship (mistake count, yield dip) | ~1 min |
| M0 | decision-log script on 3 seeds × 2 tracks + offline fit report | ~2 min |
| M1 | `train-pressure` + `faster-behind` scenarios + constrained-time from one 5-lap race; `benchmark:sim` once | ~3 min |
| M2 | full `audit:effects` scenario suite + lane-hop canary; `benchmark:sim` once | ~3 min |
| M3 | priority scenarios + yield-loss counter from one race | ~1 min |
| M4 | mistake-band check on 3 seeds | ~1 min |
| M5 | full ladder (`verify`), parity re-record, stats tier | once |
| M6 | tow-hold/commit scenarios + attempt-vs-pass-score distribution from one 5-lap race | ~2 min |
| M7 | offline reliability/Brier report from recorded commit logs (no simulation) | ~1 min |
| M8 | worn/wet/dirty overshoot-canary scenarios + one 5-lap race | ~1 min |
| M9 | shadow phantom-conflict report; then side-by-side / being-passed / lapped-car scenarios | ~2 min |
| M10 | lift-rate + rung-distribution observers from one 5-lap race + blue-flag scenario | ~1 min |
| M11 | wandering canary + program-reason inspection from one 5-lap race decision log | ~1 min |
| M12 | deep-brake commit distribution vs pass-scores + lockup correlation from one 5-lap race | ~2 min |

Per edit inside a phase: `typecheck` + the single touched test file. Never
run the statistical tiers, browser checks, matrix, or sensitivity sweeps
before M5. Never re-run a 10k sweep. Never tune a weight by re-simulating
races — weights are fitted offline against the recorded decision log
(M0), then swept once with the registered sensitivity tool at M5 if a
band is amber.

**The user is the outer loop, running in parallel** (AGENTS.md
§Verification): the per-phase probes above are for *phase closure*, and
closing a phase never waits for the user. At each phase end: `bun run
build`, post the 3–5 line summary, and **continue immediately** into the
next phase — the user play-tests the posted build while implementation
advances. When user feedback arrives, treat it exactly like an audit
result: adjust the implicated behavior with the fast loop (change,
typecheck + touched test, rebuild, post), then resume the current phase.
Skip probes for changes the user will judge by playing; run them only at
phase closure or when an invariant might be touched.

**Do-not list (each item is a known token sink):** no refactors outside
the file map; no new metrics beyond the named probes; no re-reading of
superseded plans (this document is self-contained); no speculative
handling of states the plan deletes; no single-seed parameter fitting —
a red probe with a named owner is recorded in the report, not chased with
tuning; if two plan statements conflict, implement the physically honest
one, note it in the report, and continue.

## 4.2 M6 — The opportunity layer: pass probability as the decision heuristic

The evaluator is deliberately myopic (~2.4 s): it knows the inside line
gains progress *now*, but not that attempting here succeeds 20% of the
time while the corner after next offers 60%. M6 adds the tactical brain
the user described: **look ahead, estimate the probability of getting past
the car(s) in front at each upcoming opportunity, and commit where
expected value is best, scaled by aggression.** It is a clear, inspectable
heuristic — an EV table over the next few opportunities — not a search.

### Design (closed form, no simulation)

Per car with a live target ahead (the existing tactical reference), over
the next **N = 3 opportunities** (the upcoming corners' pass-scored
braking zones plus "tow pass on this straight"):

1. **Duel projection** — deterministic kinematics from existing
   quantities: current gap, pace delta (`paceIndex`), tow terminal-speed
   advantage, braking-character delta, the inside line's later brake
   point (corner library). Yields the *pass margin* `m(o)` (metres of
   overlap achievable) at each opportunity `o`.
2. **Margin → probability** — `P(o) = Φ(m(o) / σ)`, where σ is **derived,
   not tuned**: the aggregate of known variance sources — focus-scaled
   perception noise, flow-noise amplitude, and the defender's response
   uncertainty (its defense probability × covered-line effect). Drivers
   with better focus estimate their chances more sharply; that is
   character, for free.
3. **Expected value** —
   `EV(o) = P(o)·positionValue − (1 − P(o))·failCost(o)`, where
   `failCost` is the measured battle-economy cost of a failed attempt at
   that corner (offline-line delta + re-tuck, from the corner library)
   and `positionValue` is one registered key (seconds-equivalent of track
   position). **"Wait" is always an option**: EV(wait) = the best later
   opportunity discounted by the chance the window closes (tyre delta
   shrinking, tow lost). Multi-car trains discount `positionValue` by the
   next car ahead being immediately blocking (target's own constrained
   state — already tracked).
4. **Aggression is the commit threshold** — commit to the argmax
   opportunity when `EV > θ(aggression)`; aggressive drivers accept lower
   P, patient drivers wait for the fat opportunity. The defender runs the
   mirror estimate to size its (legal) response.

### Integration and what it subsumes

The chosen opportunity becomes a **commitment target** that shapes the
evaluator's candidate costs: before the commit point, `hold` (in tow)
gains the EV bonus — *patience becomes rational*, and visible "setting up
a move over two corners" emerges; at the commit point, the corresponding
line candidate carries it. The pressure accumulator's attack-trigger role
is subsumed (waiting is now chosen, not forced); `pressT` survives only
as a stress input. No new state machine: the commitment is one cached
`(target, opportunity, side, EV)` tuple, re-estimated at tactical cadence
and dropped when stale.

### Cost (near zero) and cadence

Closed-form math over ≤3 opportunities per car-with-target — no sweeps,
no materialization, no extra candidates. Runs at **tactical cadence
(~2–5 Hz, staggered)**, cached per duel pair, invalidated when the gap or
target changes materially. Strictly below the decision cadence, per the
"decisions are cheaper than control" rule.

### Keys and acceptance

Keys: `positionValueSeconds` [1, 8], `commitEvThreshold` bounds expressed
per driver via the same composed appetite
(`driverRiskProfile × paceRiskAppetite[pace]` — a brave driver on push
commits at lower P; a cautious one on save waits for the fat
opportunity; one concept, one definition); σ and failCost are derived. Acceptance: attack
attempts concentrate at high-pass-score corners (attempt distribution vs
pass-score correlation in the funnel observers); attempt success fraction
rises while attempt count per completed pass falls; patient drivers
measurably wait (tow-hold time before commit correlates negatively with
aggression); no hot-loop regression in `benchmark:sim`.

## 4.3 Deferred and rejected (not scheduled)

**Deferred, deliberately**: a stakes model (strategy/race-phase-aware
position value), team/pit-wall orders, and per-duel opponent memory. The
pace buttons (push / race / save) are the stakes and aggression lever —
wired directly into the evaluator's risk weight and M6's commit threshold
via `paceRiskAppetite` (§2.2, §4.2) — so an AI-side stakes model would
duplicate that agency, and M6's σ already varies attack sides through
perception noise without dedicated memory. Revisit only if post-M7 play
shows bots fighting meaninglessly on divergent strategies or visibly
repeating beaten moves.

**Deliberately rejected** (for the record, per budget and determinism):
game-tree/minimax duel search, learned policies, per-frame replanning.
The EV table over ≤3 opportunities with honest inputs is the ceiling of
complexity this game needs.

## 4.4 M7 — Predictor calibration (audit phase)

A dedicated audit phase whose product is a **better look-ahead
predictor**, not new behavior. M6's estimates must match reality or the
EV layer is fantasy:

1. **Record**: at every commit, log predicted P(pass), the margin `m`,
   σ, the opportunity's pass-score, and the realized outcome (bounded
   per-race log, same pattern as the M0 decision log).
2. **Calibrate offline**: per race and per population run, compare
   predicted probability against realized frequency (reliability curve /
   Brier score, stratified by corner class and gap band). This is pure
   post-processing of logs — never re-simulation.
3. **Improve the predictor from the misfit**: systematic bias in a
   stratum names its own fix — e.g., margins too optimistic in tight
   corners ⇒ the duel projection under-prices the defender's line;
   σ too small in traffic ⇒ add the known variance source that's
   missing. Each fix is a change to the *derived* margin/σ formulas,
   validated by the same log replay before touching the sim.
4. **Policy**: a `racecraft.pass_prediction_brier` observe-only band;
   promoted once stable. The audit runs with the normal Tier-2 probes —
   no extra simulation cost.

Acceptance: reliability curve within ±10 percentage points across the
main strata; improvements to the predictor demonstrated on replayed
logs before and after.

## 4.5 M8 — One speed truth: plan-vs-plant unification

Cars on worn tyres, in dirty air, or in the wet overshoot corners because
predictions of speed and grip diverge from the physics whenever grip
leaves the reference point. One principle fixes the class: **everything
that predicts or commands speed calls the one true corner-speed function
with the car's current dynamic grip.** The true function already exists
(the closed form with aero coupling in `feasibility.ts:596-608`); the
divergences are shortcuts around it:

1. **Delete the `√μ` corner-speed scaling** (`gripV`, `autopilot.ts:64`):
   it ignores the grip→downforce feedback (less grip → slower → less
   downforce → less usable grip), over-commanding degraded cars by 2–5%
   exactly at entry to aero-window corners — where slip past the tyre
   peak makes a small overspeed a *miss*, not a drift. Fix: move the
   closed form to `core/physics` as the single definition and evaluate it
   with `entryDynamicMu` **when filling the lane ring buffer** — botStep
   reads corrected speeds with zero added 60 Hz cost, and braking
   anticipation self-corrects because `vj` comes from the same source.
2. **Feasibility evaluates the actual car, not a reference car**: the
   controller-demand check uses `PHYS.mu·profMu` with no `entryMu` — it
   approves lines a worn car cannot drive. Pass the car's dynamic grip.
3. **One wet definition**: the independent wet coefficients in
   feasibility/racecraft (×(1−0.18·wet), ×(1−0.28·wet)) are replaced by
   values derived from the tyre-grip pipeline (`tyreGrip` → `entryMu`),
   so plan and plant agree in rain for both compounds.
4. **Dirty air enters the plan where it will act**: evaluate the
   dirty-air grip loss at the *buffer's corner samples* (load from the
   buffer's own curvature), not gated on current-index load — so
   anticipatory braking sees the corner-grip loss before arrival.
5. **Delete the legacy `√(1 − k·lat)` scalar-offset correction** still
   live on the scalar path (emergency/recovery cars).
6. Small, optional: `cFail` should cost downforce (corner speed), not
   only drag — aero damage currently slows straights and spares corners,
   which is backwards.

Side effect worth naming: degraded cars' grip utilization stops being
pinned at ~1, so the M0a mistake clock stops maxing out for them — the
"worn cars make tons of errors" impression falls with the same fix.

Acceptance: overshoot canary (slip-past-peak while on-line, stratified by
wear/dirtyT/wet) drops to the fresh-car baseline; degraded cars hit their
brake points in the worn/wet scenario probes; mistake rate for degraded
cars returns to the model line.

## 4.6 M9 — The claim ledger: allocation over avoidance

Why multiple cars still overslow each other (side-by-side, lapped
traffic, being passed): every interaction channel models the other car as
a **ballistic hazard** (constant-velocity + fat margins) and prices risk
per car independently. Two consequences: every conflict is paid twice
(both hedge), and hedging is self-reinforcing (each car's caution looks
like danger to the other). Racing's actual foundation is a **public
contract**: space is allocated, one party owns it, the other adapts, and
everyone drives their allocation at full commitment. The fix is to make
that contract a first-class object.

**Five rules:**

1. Every car holds a **claim** — a lateral interval over its short
   horizon from its published lane program ± half car width ± an
   **execution-noise margin** (derived from measured controller tracking
   error, ~0.2–0.3 m — the one new constant, and it is derived).
2. Claims never overlap. The ledger is built once per control tick for
   all cars; overlaps resolve by **priority** (ahead owns its line;
   overlapped cars own their sides; rights/blue-flag/pit records
   override). **Exactly one adapter per conflict, ever.**
3. Inside your claim you are safe **by contract**: zero proximity risk,
   no caps, 100% commitment.
4. Wanting more space is a **transaction**: a pass claims *free* space
   (never forces the holder out); sporting rules become transaction
   rules (a claim edit closing on an attacker within a car length, or
   moving in the braking zone, is rejected).
5. **Trust is contingent**: a car deviating from its program beyond the
   noise bound (instability, mistake, contact, damage) has its contract
   revoked and becomes a hazard via the existing obstacle machinery —
   hedging is event-driven, never standing.

**Machinery mapping (this is a reorganization, not a subsystem):** the
corridor planner's stations/free intervals *are* the ledger — they
subtract claims (program-based, noise margins) instead of predicted
envelopes; the pairwise occupancy sweep shrinks to claim-containment plus
contested-transition checks; prediction of others reads their published
lane programs (the sim has perfect intention information — fat margins
were insuring against fiction); zipper, corner-rights corridors, and
blue-flag routing unify into the one priority rule set; the reachability
slow-point survives only for the brake-adapter role and true emergencies.

**Migration (shadow-first, like M0):** (a) build the ledger read-only and
count **phantom conflicts** (predicted-overlap events where both programs
in fact stayed disjoint) — the empirical case for everything after;
(b) switch prediction to program-based margins; (c) zero proximity risk
inside claims; (d) unify priority rules; (e) delete the redundant
pairwise machinery.

Acceptance: being-passed lap loss ≈ 0; side-by-side loss = geometric only
(≤ the corner library's alternate-line delta); passing a lapped car costs
the passer ~0 and the yielder ≤0.5 s; phantom-conflict count → ~0 after
(b); no ping-pong (alternating lateral reactions between a pair across
consecutive decisions ≈ 0); hard contacts stay ≤30.

## 4.7 M10 — The adapter ladder, the draft posture, sticky commitment

**The adapter's action ladder** (in order; each rung only if the previous
is infeasible):

1. **Re-line within the claim** — free, solves most interactions;
2. **Claim-request an adjacent line** — the corner library's alternate at
   its honest speed (two cars cannot share an apex; taking the other line
   is a line change, not a yield);
3. **Partial throttle** — momentum/draft management, not a lift;
4. **Brake** — effectively "the contract was violated ahead of me."

**Lifting is a canary, not a prohibition.** Bots lift today because of
phantom risk; M9 removes the motive and the cost function already
penalizes lifting (loses draft and time). Hard-forbidding lifts would
mask upstream bugs — a bot that *wants* to lift is a diagnostic. Track
**lift rate per interaction, stratified by cause**, expected ≈ 0 outside
blue flags; a nonzero stratum is a defect report with a location.

**Blue flags**: the yielder's claim is pinned offline at full speed; a
lift occurs only where geometry forces single-file (chicane, narrow
span) — necessarily brief because it is tied to that geometric span, not
a timer.

**The draft is an active posture**: M6's "wait" is station-keeping at the
contract-minimum gap, *positioned* for the chosen opportunity (e.g.,
holding the exit line of the corner before the best straight so the run
starts the instant the window opens). Readiness is valued by the
evaluator, not a leftover state.

**Commitment is sticky**: the EV decision re-evaluates at *opportunity
boundaries*, not mid-move. A committed attempt runs to completion or to a
hard abort only (veto, contract violation, door legally closed) — and the
abort action is itself rung 1–2: re-line and re-slot into the draft,
never a lift. The half-pass (commit → wobble out → re-commit on the same
target within seconds) is a zero-tolerance canary.

Acceptance/observers: rung-distribution per interaction (mass on rungs
1–2); lift rate ≈ 0 outside blue flags; blue-flag lifts bounded by
geometric span length; commit-abort rate bounded and aborts attributable
to hard causes; half-pass canary ≈ 0.

## 4.8 M11 — The racing line is the zero state (schedule immediately after M8; independent of M9/M10)

Symptom: cars occasionally take absurd lines — hugging the outside for a
whole lap. This cannot happen in a well-formed version of the design
(`empty program = racing line + bias`), so it is diagnostic. Two causes,
which compound:

1. **Stale programs — offsets outliving their reason.** Every offset
   exists *for* something (avoid, yield, room, pass). If the interaction
   ends and nothing expires the program, the car drives a contract with a
   dead counterparty. Fix: every non-empty `LaneProgram` is bound to a
   **live reason** (interaction/claim identity); when the reason dies the
   program empties by construction. New zero-tolerance invariant and
   audit canary: *non-empty program without a live reason = 0*. (Under
   M9 this strengthens naturally: in clean air, a non-empty program is an
   invariant violation.)
2. **The greedy plateau trap.** On a straight, a parallel offset line has
   identical progress; the offline penalty appears only at corners, where
   the outside library alternate is locally decent. Per-quantum shift
   gains are each smaller than the **constant** switch hysteresis, so a
   car a few quanta from home is permanently trapped on a 1–2 s/lap lazy
   line where every local decision was defensible. Fixes: (a) a
   **recenter candidate always in the set** — return to bias at the
   physical lateral rate; (b) hysteresis compared against
   **horizon-integrated** gain (the corner ahead at full line speed), not
   instantaneous gain — a plateau can never out-tax a genuinely better
   home.

Acceptance: wandering canary ≈ 0 (car-seconds spent >1.5 lane quanta
offline with no live interaction); clean-air lap-time distribution
tightens; the two-minute confirmation probe is reading wandering cars'
program reasons in the decision log.

## 4.9 M12 — Duel commitment candidates: the lunge (after M10)

Diagnosis: **the candidate set spans space, but not commitment.** Four of
six candidates are lateral; every candidate's speed assumes the standard
braking profile. A lunge is not a line choice — it is a commitment
choice: same lane, brake 10–20 m later, convert overspeed into overlap
*inside the braking zone*, accept the compromised arc that entry leaves.
The corner library cannot contain it: its inside line is clean-optimal,
and a lunge is deliberately suboptimal geometry that is only optimal
*given the opponent*. When the old `lungeT` machinery was deleted, the
courage dimension died with it and nothing replaced it — hence no more
late dives into heavy braking zones after long straights, and visually
rigid lines (everyone draws from the same opponent-blind geometry set).

Design — one continuous parameter, closed form:

1. **Deep-brake candidate** parameterized by brake-point delta `Δb`:
   entry speed from `brakingDistance`, tightest available arc from the
   corner-speed closed form (run deep, shallow apex, compromised exit —
   all priced honestly), pass condition "alongside-or-ahead at turn-in
   given both cars' braking". Solve 1-D for the **smallest `Δb` that
   achieves overlap** (no heroism beyond what the pass needs), capped at
   the driver's personal maximum commitment.
2. **Opponent-frame placement**: duel candidates position relative to the
   opponent's claim edge ("half a car inside his line at turn-in"), not
   track-frame quanta.
3. **Offered contextually** — approaching a pass-scored braking zone with
   overlap achievable (per M6's margin) — swapping out a generic shift
   candidate, so the ≤6 bound holds.
4. **Risk is already priced**: deep braking = high utilization → the M0a
   mistake clock charges lockup probability organically, scaled by focus
   and wet. Aggression and pace mode buy `Δb` through the composed risk
   appetite. No dice rolls return.
5. **M6 is the trigger, this is the trajectory**: the opportunity layer
   already computes pass margins and braking-character deltas per zone —
   it knows *when* a lunge is on; this family lets it *express* one.
6. **The defensive counterpart comes free**: a `Δb`-deep cover entry
   ("park on the apex") from the same family, subject to the one-move and
   door rules — restoring braking-zone chess: attacker shows deep,
   defender covers deep, switchback opens on the exit.

Acceptance: deep-brake commits reappear, concentrated at heavy braking
zones after long straights (per pass-score metadata); lockup incidence
correlates with `Δb` and wet; half-pass canary stays 0; hard contacts
within cap.

## 4.10 Consolidation gate, destination, and the evidence-gated backlog

**After M12, stop adding. The next phase is the consolidation gate (CG):**
every scheduled deletion actually completed (no half-removed legacy — a
stale interaction from partially deleted machinery can masquerade as a
new-design defect); full verification ladder green once on the clean
tree; the decision log and every canary (lift rate, wandering, phantom
conflicts, half-pass, table share) live and *green-or-attributed*. The
gate's product is a trustworthy baseline: from here on, symptoms have
one generation of code to blame.

**The destination (bind direction, not schedule):**

- **Symmetric EV everywhere** — every party to an interaction runs the
  same cost arithmetic (the rational concede is the canonical test: a
  defender with low P(hold) lets the faster car go because the numbers
  say so, never because of a white-flag rule).
- **The bias registry, on the existing channel** — no new table
  subsystem. `ruleCost` terms *are* the decision table; govern them with
  metadata: every term registered with provenance, classification
  (**protocol** — models the sporting rulebook, permanent — vs **IOU** —
  stands in for emergence we could not yet afford, carries an expiry
  condition), bounded magnitude below the veto layer, decision-log
  attribution. **Table share** (fraction of decisions shaped by bias
  terms) is a standing observer: protocol-only share is healthy; rising
  IOU share is the smell alarm. Hard budget: ≤10 IOU terms, adding one
  deletes one.
- **The design razor** for any proposed addition: does it restore a
  degree of freedom the *joint game* actually uses (courage, line shape,
  information drivers really have, one-depth response bounded by
  irreversibility)? And does it *read on screen* at 20-car top-down
  scale? Both, or it is not built.

**Evidence-gated backlog** (candidates, deliberately unscheduled — the
canaries choose, not this document):

| Candidate | Activation evidence |
|---|---|
| A — apex-timing as second line parameter | duels stall at entry-covered corners; switchback/over-under completion low despite M12 |
| B — one-depth opponent response (feint, tow denial) | M7 calibration stable ≥2 phases AND defenders' cover rate makes shown-side attacks unprofitable in the logs |
| C — target's projected traffic in duel EV | attackers observably burn attempts into trains; EV(wait) mispredicts when target hits traffic |
| D — lateral surface state (rain lines, spatial evo) | scheduled only with the balance stream's wet work; requires M8's live-speed evaluation (library speeds become state-dependent) |
| Rational-concede verification | not a build item: an observer on CG — if concessions do NOT emerge from symmetric EV, that is a defect in the symmetry, not a missing feature |

Each activation is judged from canary data on the post-CG baseline, with
the user's play-testing as the legibility gate. A candidate activated
without its evidence is a plan violation.

## 5. Performance budget

The evaluator **replaces** existing per-tick work and runs it less often:
today's arbitration evaluates up to 6 candidate plans with 12-sample
occupancy sweeps at 30 Hz per car; the evaluator keeps the same candidate
count and machinery but at ~10 Hz staggered (§2.0) — a net ~3× reduction
of the hot loop, plus `stepRacecraft`'s branch forest goes away entirely.
Budgets enforced: ≤6 candidates (now literal), ≤1 off-cycle re-evaluation
per car per tick, 0 materializations, control cadences unchanged
(120/60/30 Hz), `benchmark:sim` floor after M1 and M2 — expect it to
*rise*; record the new median as the reference.

## 6. Acceptance (headline)

- A faster car closing on an overslowing leader **steers, not brakes**, in
  ≥90% of seeded underspeed scenarios with a free interval.
- Follow gaps: near-touch in tow (≤3 m bumper at top speed with a free
  lane); no follower brake application above 0.3 while an adjacent
  interval is free and the leader is ≥5% under pace.
- Blue-flag yield costs the yielder ≤0.5 s and the beneficiary ~0 s.
- Mistakes per race within band and independent of attack frequency.
- Battle economy holds (≤3% per contested corner, from the revamp).
- Hard contacts ≤30, light contact uncapped, all invariants zero.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Cost weights are a new tuning surface | few (4–6) registered calibration keys with bounds; M0 shadow mode fits them against *current good behavior* before anything changes; sensitivity sweep before lock |
| Dithering between near-equal candidates | switchCost hysteresis + deterministic tie-break; lane-hop canary stays zero-tolerance |
| Emergent behavior loses the sporting shape (weaving defense) | legality vetoes are hard, not costs; defense probes (J-suite) keep their green bars as regression gates |
| Deleting intent state breaks consumers (UI battle flags, audits) | M2 derives `battle`/episode observers from decisions before deletion; audits migrate in the same phase |
| Shadow-mode agreement is unmeasurable noise | agreement metric defined on *outcomes* (chosen lateral direction + speed class), not exact values |
