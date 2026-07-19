# Racecraft Racing-Feel Plan — Closer Racing, More Overtaking

Companion to `racecraft_racing_feel_diagnostics.md` (root causes RC1–RC7).
Goal: racing that reads as physical and alive — followers pull close, a car
with a real pace advantage (tyres, mistakes ahead, slipstream) finds a way
past, battles persist across corners — while keeping the existing safety
invariants and the runtime budget (30 Hz traffic, ≤6 candidates, ≤1
materialization, 5 Hz corridor search, benchmark floor 80%).

Design rule for every change: the *physics* stays honest (brake-reachability,
body non-overlap, aerodynamic coupling); the *driver policy* is the heuristic
layer, and it must be expressed as risk/character parameters, never as
invented distances. Constants are legitimate only if they are body dimensions,
grip/braking capability, or reaction time — everything else is derived,
emergent, or per-driver character (diagnostics §5.5). No change touches the feasibility gate, corridor planner,
protected corridors, or pit machinery — those keep vetoing unsafe outcomes.

## Phase A — Measure what "fun" means (before changing behavior)

New bounded aggregates (same pattern as existing session counters; O(1) per
tick, capped histories):

1. **Follow-gap histogram**: when a car's `speedCapOwner` is a car ahead,
   record the time gap bucket (<0.3 s, 0.3–0.6, 0.6–1.0, ≥1.0). Cheap: gap is
   already `ds / leader.spd` in `stepRacecraft`.
2. **Constrained time**: per race, car-seconds where `vCap` is owned by
   traffic and below the car's own unconstrained target
   (`idealPath.v[i] * margin`); this is the "stuck in a train" quantity.
3. **Attack funnel**: initiations (`atkSeq` already exists), cancellations by
   cause (turn-in-tuck, exit-tuck, room-fail, expiry — the counters
   `tuckFailN`/`tuckExitN` exist but are not split per cause in the summary),
   and completions (order swap of the exact attacker/target pair within 5 s of
   an attack episode — a Map keyed by pair, bounded like `sbsPairs`).
4. **Genuine-pass filter**: in `runHeadlessRace`/`race-sim.js`, exclude order
   changes where either car is in a pit state or >3 s off its recent pace, so
   `passes` counts on-track passes.

Deliverable: new fields in `HeadlessRaceSummary.metrics`, wired through
`race-sim.js` and `run-statistical-suite.ts`; new metric-policy entries start
as observe-only (very wide bands) on the calibration seed set. Acceptance:
baseline report for the three flagship tracks recorded in the implementation
report before any Phase B change lands.

## Phase B — Delete the policy gap: brake-reachability is the only follow law (fixes RC1, RC5; diagnostics §5.1)

Principle: there is **no** legitimate follow gap. The only physical constraint
between two cars in a lane is non-overlap under worst-case braking. Whatever
spacing emerges must come from that law plus aerodynamics (tow, dirty air) and
driver risk policy — never from a distance controller.

1. **Replace `followCap` with a brake-reachability law** (`paths.ts:53-72`
   and all race call sites): delete `gapLaw` (`desiredGap`, `timeGap`,
   `gain`, `closingDamp`) entirely. New law: the follower's speed cap is the
   largest `v` such that after `reactionSeconds` of travel it can decelerate
   at `prudence × availableDecel(v)` and still stop behind the leader's
   worst-case stop (leader braking at full `availableDecel(v_l)`), keeping a
   standoff of `carLen + 0.5`. `availableDecel` is the expression the
   feasibility gate and controller already use
   (`mu·profMu·(g + min(kDf·v², dfMax)/m)` — ~15.5 m/s² low speed, ~27 m/s²
   at 60 m/s). With equal capability cars this reduces to
   `gap ≥ v·reactionSeconds + standoff`: cars naturally run ~0.15–0.25 s
   apart when pace-matched, and closer under tow. Pit-lane and start-queue
   call sites keep an explicit queue variant (they genuinely want spacing);
   the race path does not.
2. **One deceleration model** (diagnostics §5.1 last row): replace the six
   scattered assumed decels (5.2, 5.5, 6.0, 6.8, 9.0, 9.5 m/s²) with
   `prudence × availableDecel(v)` from a single helper in `core/physics`.
   `prudence` (default ~0.7) is the one honest policy knob — a driver-risk
   fraction, later a per-driver character parameter (Phase E).
3. **Remove the start leash** (`traffic.ts:384-397`): after the initial 4 s
   grid-lat hold, drop `a.spd + 3.0` and the 0.75 s gap; the brake law plus
   the corridor planner govern lap 1. Opening-lap racing is the single
   largest fun payoff in this plan. Light contact is uncapped; only damaging
   hard contacts contribute to the whole-race cap of 30.
4. **Reachable slipstream** (`traffic.ts:201-205`): extend tow range
   16 → 28 m, strength `(1 - ds/28)`, taper by lateral sep
   `clamp(1 - sep/2.5, 0, 1)`, cap 0.8. With (1) the pace-matched equilibrium
   (~10–15 m) sits inside the tow zone: the drag advantage builds, the
   follower closes, and the attack run creates itself — this is the physical
   engine of overtaking, not a scripted trigger.
5. **Dirty air** (new, symmetric to tow): within 0.9 s behind a leader with
   upcoming curvature > 1/120, set `e.dirtyT` (decaying like `tow`); consume
   in `entryMargin` as `margin -= dirtyAirMarginPenalty × dirty` (like
   `liftT`, `strategy.ts:68`). Default 0.008. Corners now *produce* a gap
   physically; straights erase it — the accordion, with zero policy distance.

Calibration keys (add to `RACECRAFT_CALIBRATION_DEFINITIONS`):
`reactionSeconds` [0.10, 0.35], `brakingPrudence` [0.55, 0.85], `towRangeM`
[16, 32], `dirtyAirMarginPenalty` [0, 0.015]. `timeGap`-family constants are
deleted, not tuned.

Acceptance: follow-gap histogram mode < 0.3 s when pace-matched on straights;
damaging hard contacts remain at or below 30 per race;
`race.side_by_side_median_seconds` does not regress.

## Phase C — Attack eligibility: see real pace, feel pressure (fixes RC1, RC2, RC3)

1. **Grip-aware pace index** (`traffic.ts:432`): replace the margin-only
   comparison with `paceIndex = entryMargin(...) * sqrt(entryMu(e, wet))` —
   both factors are already computed per entry and `sqrt(mu)` is exactly the
   controller's own speed scaling (`gripV`, `autopilot.ts:39`). A 6% tyre-grip
   delta (~3% pace) now registers as `faster`. Zero new state.
2. **Pressure accumulator** (new `Entry.pressT`): in `stepRacecraft`, when the
   follower's `vCap` is owned by the leader and sits below
   `idealPath.v[i] * margin * gripV * 0.985`, accumulate `pressT`; decay
   otherwise. When `pressT > pressureAttackSeconds` (default 3 s), treat the
   follower as `faster` regardless of closing speed, and reset on episode end.
   This is the direct fix for the "leader overslows → everyone overslows"
   train: the constraint itself becomes the attack evidence that RC1's
   equilibrium destroyed. Physically this is the driver noticing they are
   lapping under their car's capability.
3. **Underspeed leader window** (fills RC3's dead zone between racing and the
   0.52 obstacle threshold): if `a.spd < 0.92 × localExpected(a)` (reuse
   `expectedSpeed` from `obstacles.ts:41`) and the follower is not similarly
   capped, grant immediate attack eligibility and bypass the tight-corner hold
   (Phase D.3 controls how).
4. **Cooldowns proportional to outcome** (`traffic.ts:97,284; corner-rights.ts:702,823`):
   after a cancelled attack, set `atkCd = 1.5` only when the attacker lost
   touch (>1.0 s behind); if it is still within 1.0 s, use 0.5–0.7 s so
   battles chain across consecutive corners instead of resetting each lap.
   Keep the 1.5 s cooldown after damaging contact and three-car fallbacks.

Calibration keys: `pressureAttackSeconds` [1.5, 6], `underspeedLeaderFraction`
[0.85, 0.95]. Acceptance: constrained-time per race drops materially; attack
initiations rise on worn-tyre deltas in seeded scenarios; qualifying metrics
(priority.\*) unchanged (pressure and pace index are race-branch only).

## Phase D — Attack execution: allow drawing alongside (fixes RC4, RC7 balance)

1. **Lateral overlap decides whether the brake law applies at all**
   (`traffic.ts:462-465,496`): with Phase B the only longitudinal constraint
   is brake-reachability, and it should apply only while the two trajectories
   actually overlap laterally. Use **one** overlap definition everywhere —
   `sep < carWid + margin` (≈2.35, the feasibility gate's own number,
   `feasibility.ts:267`) — replacing the five inconsistent thresholds (2.2,
   2.3, 2.5, 3.4; diagnostics §5.3). Once an attacker is offline past that,
   no cap: it pulls level at whatever its car can do. The occupancy layer
   still rejects paths that converge on the leader (`feasibility.ts:330-340`).
   Delete the side-by-side `a.spd + 4.0` completion cap (`traffic.ts:310`)
   for the same reason — the corridor, not a speed leash, protects the pair.
2. **Predictive turn-in gate** (`enforceTurnInTucks`,
   `corner-rights.ts:699`): use the existing
   `longitudinalBodiesWillOverlap` (1 s closure prediction,
   `corner-rights.ts:170`) instead of instantaneous overlap. A fast-closing
   lunge — the signature overtaking move — currently gets cancelled at the
   moment it becomes interesting; with prediction it survives exactly when it
   would physically arrive, and corner-rights then handles the pair.
3. **Tight-corner attack rework** (`traffic.ts:452-461`): a tight corner ahead
   is where passes *happen*, not where they pause. Keep the hold only when the
   attack side is the outside of the upcoming corner; when the inside is free
   (`atkSide` sign matches `nc.side`), steer to a reduced inside target
   (`nc.side × 2.2`) and keep the braking-zone followCap. Corner-rights
   acquisition (`updateCornerRights`) then converts genuine arrivals into a
   protected two-wide corridor as designed.
4. **Exit persistence** (`traffic.ts:323-331`): raise the exit-tuck threshold
   from 2.7 m to 4.0 m when a linked corner in the same complex follows within
   120 m (reuse `nextLinkedCorner`, `corner-rights.ts:774`), so switchback
   attacks through complexes exist.
5. **Wheel-to-wheel spacing** (`corner-rights.ts:20`): reduce `ROOM_SEP`
   3.4 → `carWid + 0.5` = 2.5. Physical non-overlap is 2.0; 3.4 forces a
   metre of daylight, consumes road (three-wide currently needs 7.6 m usable),
   and reads as magnetic repulsion. Rescale the negotiation thresholds that
   were calibrated around the inflated value (acquire 2.1 / release 1.6,
   `traffic.ts:293-297`) proportionally. `rights.minimum_separation_m`
   policy bands must be re-derived (normal minimum drops with ROOM_SEP).
6. **Physical lateral slew** (`traffic.ts:367-371`): derive the scalar
   lateral step from the lateral-acceleration budget instead of the fixed
   0.07 m/tick: `latStep = min(0.20, headroom × availableAccel / spd × …)` so
   a car at speed can move laterally at 4–6 m/s when grip allows (and less
   mid-corner where the budget is spent). Moves stop looking slow-motion,
   feints/switchbacks become possible, and building attack separation takes
   ~0.5 s instead of ~1.5 s. The path-slew invariant
   (`path.maximum_target_slew_m`) is unaffected — it bounds authored path
   discontinuity, not scalar motion.

Acceptance: pass completions per attack rise into the
`race.pass_success_fraction` normal band from below and production races
produce at least 100 genuine passes. Light and side-by-side contact are
observe-only; only the 30 hard-contact cap constrains aggression.

## Phase E — Line variety and defense shape (fixes RC6, softens RC7)

1. **Per-driver line character**: at session creation derive a deterministic
   per-driver, per-corner lateral bias (amplitude ≤0.35 m, seeded from driver
   code like `rollFocus`). Apply in the idle branch by decaying `latTgt`
   toward the bias instead of 0 (`traffic.ts:230,497`); `botStep` already
   corrects speed for scalar offsets (`speedAt`, `autopilot.ts:38`). Cost:
   one lookup per tick; no path materialization.
2. **One-move-and-return defense**: extend the single defensive move
   (`traffic.ts:480-493`) with a second phase — after covering, return toward
   the normal entry line at turn-in (a real sporting shape). Defender takes
   corner-exit compromise: while `defT > 0`, apply a small margin penalty on
   that corner's exit (like `liftT`, smaller), giving the attacker the classic
   run-off-the-corner window. Move probability keeps its focus scaling.
3. **Pressure mistakes**: sustained pressure (`defT` active or attacker within
   0.5 s for >5 s) adds a bounded extra weight into `rollMistake`'s
   probability via `stress` (already partially wired through `battle`,
   `entry.ts:389`); tune rather than new machinery — organic overtaking
   windows come from defender errors, not raw pace alone.
4. **Per-driver braking character** (diagnostics §5.4): make the controller's
   braking-effort fraction (`autopilot.ts:83`, fixed 0.82) and Phase B's
   `brakingPrudence` per-driver, derived deterministically from the lineup
   (bounded ±0.06 around the default). A late-braker archetype now exists,
   and out-braking becomes a real, skill-expressed overtaking move. While
   `lungeT > 0`, temporarily raise the attacker's effort fraction toward its
   personal maximum — a lunge that actually brakes later (the current
   `margin +0.008` is invisible), priced by the existing lockup roll.
5. **Mistakes that run wide geometrically** (`incidents.ts:53-63`): a "runs
   wide" mistake currently only slows the car (`liftT`); the line never
   changes, so mistakes open no door. Add a short-lived scalar `latTgt` push
   toward the corner's outside (through the existing avoid/latTgt channel, so
   the surface envelope still clamps it) alongside the lift. A mistake now
   physically vacates the inside line — the most natural overtaking window
   in racing.

Acceptance: motion review (`review:motion`) shows visibly distinct lines per
driver; `race.dnfs_per_race` remains in policy and hard contacts remain ≤30.

## Phase G — Light contact is racing (post-implementation audit, 2026-07-16)

Principle (now also in `AGENTS.md` and metric policy): only **hard** contact —
impulse above `HARD_CONTACT_IMPULSE` (13), the level that damages suspension
and can cause a DNF — is limited or reacted to. Light wheel rub is measured,
physically resolved by the impulse, and otherwise **ignored by every
controller**. The collision lateral geometry is honest (capsule circles touch
at ~`carWid` = 2.0 m center-to-center), and corridor targets sit at
`ROOM_SEP` 2.5 m, so light rubs are a *normal consequence* of correct
side-by-side racing — a reaction chain that dissolves the battle on every rub
makes racing rigid by construction. Three such chains remain after the main
implementation:

1. **Recovery-room seeding on any contact** (`session.ts:275-282` →
   `traffic.ts:389-401`): any touch with lateral sep ≥ 1.1 and longitudinal
   < 4.5 sets `contactSeed`, and `recoveryRoom` then activates forced room
   regardless of the normal acquire/release hysteresis — both cars are
   repelled to `ROOM_SEP` until sep clears ~1.69 m. A light rub mid-battle
   forcibly separates the pair. Fix: seed recovery room only on
   `isHardContactImpulse` or when either car is `unstableCar`; a light rub
   between two stable cars leaves room state exactly as it was.
2. **Any contact blocks corner-rights acquisition for 0.8 s**
   (`corner-rights.ts:289-290`): a rubbing pair cannot form the protected
   two-wide corridor at the moment they most need it; without rights the
   occupancy cap and room logic resolve the convergence against the
   attacker. Fix: gate this block on hard contact only. Light contact
   between two cars committed to the same corner is evidence they *need* the
   corridor, not grounds to refuse it.
3. **The collision resolver manufactures daylight** (`collision.ts:42`): the
   positional resolution adds +0.30 m beyond contact, with a comment saying
   it deliberately lands lateral touches "above room's engage threshold" —
   separation policy hidden inside the physics resolver, exactly what the
   constants policy forbids. Fix: resolve with a numerical anti-overlap
   epsilon (~0.05 m) and let the impulse plus the controllers own
   separation. (Keep the restitution/damping as is — that part is physics.)

Acceptance: side-by-side episodes survive light contact (episode `contact`
flag no longer correlates with episode end); `race.hard_contacts_per_race`
stays ≤ 30 and `race.dnfs_per_race` in band; no change to hard-contact
handling (concede, damage, stress, rights release all stay gated on
`isHardContactImpulse`).

Watch item (not scheduled): in a pace-matched train the pressure trigger
(`pressureReady`) can be strangled by the `attackCanReach` gate —
`closingPotential` bottoms out at its 0.25 m/s floor when speed, pace, and
pressure deltas are all ~0, making `predictedTimeToOverlap` exceed the commit
window, so the pressure attack never launches. If train passing still feels
rare after Phase G, fold the tow speed advantage and braking-character delta
into `closingPotential` (both are real closing mechanisms the gate currently
ignores) rather than raising the floor.

## Phase H — Corner-aware following: the cap must respect the friction circle (analysis 2026-07-16)

Symptom: even a much faster car (pace + tyre delta) cannot pass — it closes
on the straight, then gets unsettled through corners while following, loses
the run, repeats. Root cause is provable from source and is **not** the
existence of the follow cap, but two places where the cap ignores cornering
physics:

- **The law assumes straight-line braking.** `followCap` prices both cars'
  stopping distances with `brakingDistance(speed, mu, effort)` — no
  curvature input. Mid-corner, longitudinal deceleration is limited to the
  friction-circle remainder `sqrt(a_max² − a_lat²)`; at 90% lateral load
  that is ~0.44·a_max. Worked example (25 m/s leader, follower +5 m/s,
  corner near the limit): the law admits the overspeed at 24 m gap, then as
  the gap closes demands ~10 m/s² of shedding where physics can deliver
  ~8 — the cap falls faster than the car can follow.
- **The controller obeys the cap blindly.** `botStep`'s own horizon loop is
  friction-circle aware (`room = sqrt(ge² − aLat²)`, `autopilot.ts:81-85`)
  for every slow-point on the *path* — but `vCap` bypasses it: `vt =
  min(pathTarget, vCap)` is a flat clamp with no distance context, and
  `brake = (v − vt)·0.8` fires immediately, mid-corner, at full lateral
  load. Braking there cuts front lateral capacity (`circK·Fx` in `stepCar`),
  slip rises, and the cascade completes: `unstableCar` (slipR > 0.28)
  denies room negotiation, `stepRecovery`'s `roomLoose` branch
  (slipR > 0.13 while `_roomActive`) gathers and slows the car, the attack
  dies, the gap reopens.

Scrapping `vCap` outright would not fix this: `botStep` has no other
traffic awareness, so the collision resolver would become the de facto
follow law (constant rear-end impacts in braking zones). The cap's *job* —
never occupy the same space — stays; its *form* changes:

1. **Traffic becomes a horizon slow-point, not a flat clamp.** Pass the
   leader to `botStep` as `(distance, speed)` and fold it into the existing
   anticipatory loop with the same friction-circle-aware `allow =
   sqrt(v_leader² + 2·effort·room·s)` treatment the path's corners already
   get. Traffic braking then happens *before* turn-in, on the straight,
   where longitudinal grip exists — the follower arrives settled instead of
   panic-braking at the apex. The flat `vCap` form remains only for
   pit-lane/queue callers.
2. **Corner-aware follow law.** Scale both stopping-distance terms in
   `followCap` by the longitudinal-headroom fraction at the maximum
   upcoming curvature over the closure distance
   (`upcomingMaximumCurvature` is already computed). This is honest in both
   directions: the follower cannot shed overspeed mid-corner (must arrive
   matched), and the leader cannot panic-stop mid-corner either (the
   threat the law prices is smaller, so matched-speed following gets
   closer). Equal-speed terms still cancel: following remains
   reaction + standoff bound.
3. **Brake input budgeted by the friction circle.** In `botStep`, clamp the
   brake command to the longitudinal headroom at the current lateral
   demand (the controller already computes both quantities). If a cap
   violation occurs mid-corner anyway, the car lifts and trail-brakes
   within physics; brief convergence is acceptable — light contact is
   racing (Phase G), and the collision layer prices the extreme case.
4. **Sustained-follow reaction.** `reactionSeconds` 0.18 models a surprise.
   A driver who has run within ~1 s of the same leader for >2 s is reading
   that leader's braking points; drop their effective reaction toward the
   calibration minimum (~0.10–0.12, per-driver character). Equal-pace
   following settles at ~0.25–0.35 s — visibly nose-to-tail.
5. **Re-tune the stabilizers after 1–3 land** (watch items, not up-front
   changes): `roomLoose` gathering thresholds (slipR > 0.13 while room is
   active) and the `unstableCar` room gate were calibrated when mid-corner
   cap-braking made side-by-side cars genuinely loose; once following is
   settled, these may be artificially slowing legal side-by-side running.

Acceptance: a car with a 1.5 s/lap pace advantage passes a healthy leader
within ~3 laps in ≥80% of seeded scenarios (add to §A attack funnel);
follow-gap histogram mode drops below 0.3 s in corners as well as
straights; slipR excursions while capped behind a leader fall to the
uncapped baseline; hard contacts stay ≤30.

## Phase I — Side-by-side must be sustainable (battle time-loss audit, 2026-07-16)

Battling pairs currently bleed so much time that the pack catches them —
some loss is realistic (~0.5–1 s/lap), but four mechanisms stack far past
that, and two of them are simply wrong:

1. **Dirty air applies to a car alongside (bug).** `e.dirtyT` is set from
   `timeGap` and curvature only (`traffic.ts:571-578`) — no lateral term —
   and a wheel-to-wheel opponent is a valid `ref` (sep < 2.35). Physically
   the wake is *behind* the leader; a car alongside is in clean air on its
   own side. Taper dirty air by lateral separation exactly as tow already
   is (`clamp(1 − sep/…, 0, 1)`); alongside cars race at full pace.
2. **The recovery damper treats limit cornering as an incident.**
   `stepRecovery`'s `roomLoose` branch fires at `slipR > 0.13` while
   `_roomActive` (`incidents.ts:134-136`) — but the tyre's rear slip peak is
   `slipPeakR = 0.10`: a car cornering at the limit lives at 0.10–0.15
   slip. Side-by-side cars are therefore *perpetually* gathered (yaw/vy
   damped 1.25×, heading dragged to road direction) — artificially slowed
   and straightened every corner they race. Raise the roomLoose slip/yaw
   thresholds to genuine instability (≈ the non-room thresholds), keeping
   only the wet scaling; Phase H's settled following removes the original
   reason these were so tight.
3. **The zipper taxes every predicted convergence.** `applyCornerRights`
   caps the trailing car to `min(spd) − max(0.5, closingRate·0.35)`
   whenever the corridor is predicted to close — a ≥0.5 m/s tithe on
   prediction, not on contact. Make the penalty proportional to actual
   convergence (0 at closingRate 0) so a stable side-by-side pair pays
   nothing.
4. **Battle stress compounding** (`+0.0035/s` while `battle`) lowers focus,
   raises flow noise and mistakes — fine as drama, but it should scale
   with genuine proximity duration, not with the `battle` flag that room
   negotiation sets liberally. Audit after 1–3 land.
5. **"Alongside" is a body-overlap state, but every yield decision tests
   longitudinal distance** — this is why a faster car that has pulled level
   decelerates and hands the place back, even on a straight. Four
   longitudinal-only tests each independently produce that surrender:
   - `followCap` keeps its full `carLen + 0.5` same-lane standoff whenever
     sep < 2.35: a car overlapped at ds ≈ 3 m computes `available ≈ 0` and
     is ordered back to 5.9 m — a hard deceleration command *while
     alongside* if the pair converges even slightly.
   - The exit-tuck fires at ds > 2.7 m (`traffic.ts:426-436`) — but ds is
     center-to-center; a car whose front axle is past the leader's rear
     axle (overlapped up to ds ≈ 5.4) is judged "failed to stay alongside"
     and tucked with a follow cap on the straight after every corner.
   - The room-fail tuck at ds ≥ 4.5 (`traffic.ts:377-384`) makes the same
     center-distance mistake at corner approach.
   - The rights **zipper concedes by `prog`** — trailing car yields — and
     rights persist after track-out while bodies overlap. Both cars'
     targets then settle toward the same racing line
     (`settleTowardLineCharacter`), so lateral convergence is *guaranteed*
     on the straight, the zipper fires, and the overtaker (nose marginally
     behind) is capped below the leader: the yield-on-the-straight the
     user observes, by construction.

   Fix with one shared predicate: `alongside(e, a)` ⇔ bodies overlap
   longitudinally (`longitudinalBodyProjection(...).overlap`). While
   alongside: no traffic-follow cap in any branch (brake-reachability is
   meaningless between overlapped bodies — lateral rules own the pair), no
   exit-tuck or room-fail tuck (an attempt you are currently level in
   cannot have "failed"), line-settling suspended (hold your side until
   bumper-clear), and the zipper tie-break becomes physical instead of
   positional — the car whose lateral motion causes the convergence yields
   laterally; longitudinal concession only for the genuinely slower car.
   Tucks and caps re-arm only once the pair is bumper-clear.

Acceptance: seeded two-car equal-pace battle loses ≤1 s/lap versus the same
cars running nose-to-tail; a full side-by-side corner costs each car ≤0.4 s
versus their solo line; a faster car that draws level on a straight
completes the pass (no deceleration-yield while overlapped, measured as
brake input while `alongside` with higher own pace); pack-catches-battle
rate drops on the §A metrics.

## Phase J — Pick the spot, counter the block: overtaking IQ and sporting defense (2026-07-16)

### J.1 Attack spot selection

Attacks launch wherever eligibility happens to trigger — `atkSide` points at
whatever corner is nearest (`traffic.ts:632-641`) with no evaluation of
whether that corner can host a pass. Wasted attempts are the cost: a lift, a
cooldown, and defender/attacker both losing time. Fix, precomputed at track
build (zero runtime cost): a per-corner **pass score** from quantities the
profile already has — approach speed (tow-assisted delta available on the
preceding straight), braking-zone length (`brakeI→turnInI` distance ×
approach speed), corner tightness, and usable width inside. At attack
eligibility, if the best spot within the next ~2 corners is not the current
one, enter a **stalking state**: hold in tow at reduced gap (no cooldown
burn, pressure maintained, `pressT` frozen not reset) and launch at the
chosen corner's approach. Underspeed-leader and obstacle attacks stay
immediate — those are opportunity, not planning.

### J.2 The switchback

`defenseCoversAttack` flips a covered attacker to the *outside of the same
line* (`traffic.ts:648-651`) — the lowest-percentage move in racing, so
every successful cover ends the attempt. The classic counter is missing:
enter wide, rotate early, exit tight, pass on the run to the next corner.
Add a `switchback` attack shape (anchor plan: outside entry, inside-of-exit
line, completion window extending to the next straight) selected when the
defender has committed inside and a linked corner or straight follows.
This is also what makes defense a *choice with a cost* (J.3) rather than a
win button.

### J.3 Sporting defense rules

The defender's cover move is currently legal-by-luck: it can start at any
moment before the brake point, mirror an already-committed attacker, and
squeeze to 2.24 m regardless of where the attacker's nose is — forcing the
lift/brake the user observes. Encode the real rulebook; each rule is an
O(1) check on state that already exists:

1. **The move must complete before braking.** Initiate cover only if the
   lateral distance is coverable before `brakeI` at the physical lateral
   speed (`dBrake / spd > |Δlat| / latSpeed`). A car that left it too late
   holds its line — moving *in* the braking zone is the "sudden change of
   direction" the user names, and it currently forces the attacker's
   emergency response.
2. **No reacting to a committed attacker.** If the attacker's lateral
   velocity toward a side exceeds a small threshold or its offset from the
   racing line has crossed ~1 m, the defender may no longer move toward
   that side (one move, made on *anticipation*, is legal; mirroring is
   not). `claimDefenseResponse` already enforces one response per episode —
   this adds *when* it may happen.
3. **Return-to-line needs daylight.** The existing cover→return shape
   (`traffic.ts:188-199`) must check that returning leaves
   ≥ `LATERAL_BODY_CLEARANCE` to the attacker — returning across a nose
   under braking is the second classic foul.
4. **Leave a car width once the attacker is meaningfully alongside.** The
   rights corridor handles full overlap; the gap is the pre-rights band —
   attacker's front axle past the defender's rear axle
   (`longitudinalBodyProjection` clearance < −carLen/2) with lateral sep
   < ~3 m: from there the defender's lateral authority toward the attacker
   is frozen (may hold, may not close).
5. **Defense frequency is character, not constant**: keep the focus-scaled
   probability, but let sustained `underPressure` and low `focusNow` skew
   toward mistimed moves (rule-1 violations *attempted* but blocked → the
   defender simply loses the entry instead), so defense quality
   differentiates drivers the way braking character does.

Acceptance: attack attempts per completed pass drops (funnel §A);
forced-lift events on the attacker (brake spike while `atkT > 0` and
defender `defPhase = 'cover'`) fall materially; defended-but-legal battles
produce switchback completions; no increase in hard contacts.

## Phase K — Aerodynamic coupling: slipstream dominates, dirty air fades (2026-07-16)

Principle check, and it lands cleanly on the user's instinct: in the wake of
another car there is *less drag everywhere* and *less downforce where
downforce matters*. On a straight, lateral demand is ~0, so the wake is pure
gain — the slipstream. The downforce loss only exists in corners, and this
car model is a low-downforce period machine (`dfMax/m` ≈ 0.73 g vs 1 g of
mechanical grip): its era raced nose-to-tail slipstream battles precisely
because wake grip loss was small. "Strong tow, negligible dirty air" is not
a gameplay fudge here — it is the honest physics of the car being modeled.

1. **Fix dirty air's sign and channel.** Today `dirtyT` feeds
   `entryMargin`, which scales *every* speed target — including straights,
   where the penalty is physically backwards. Dirty air must never touch
   straight-line speed. Per the simplicity principle: set the default to ~0
   (keep `dirtyAirMarginPenalty` as a registered key, bounds tightened to
   [0, 0.006], default 0–0.002). If any effect is kept, it applies as a
   *cornering-grip* term gated on actual lateral demand (curvature ×
   v² above a threshold) — never on margin globally. The accordion feel
   this was buying comes instead from tyre deltas, pressure, and the tow
   cycle.
2. **Make the slipstream the headline force.** Current maximum effect is a
   10.4% drag cut (`tow ≤ 0.8` × 0.13 in `entryMods`) ≈ +2.8 m/s at top
   speed. Raise the drag-reduction coefficient to a swept calibration key
   (`towDragReduction`, bounds ~[0.10, 0.25]) with the balance target
   solved in the §9 tool: **full tow from ~1 s back must complete a pass
   within one long straight** against an equal car. The lateral taper
   (already implemented) is the natural governor: pulling out of the wake
   forfeits the tow, so the run must be timed — that, not a penalty, is
   what prevents perpetual leapfrogging.
3. **A car must never lose the rear on a straight while alongside.** The
   observed spins are commands, not aerodynamics: the alongside
   deceleration orders (Phase I.5's four yield mechanisms) arrive
   simultaneously with high-rate lateral separation targets (room logic
   commands up to ~6 m/s of lateral at top speed), and braking + steering
   at 80 m/s exceeds the rear's share of the friction circle
   (`brakeBias` puts 42% of brake force on the rear while the lateral
   transient loads it). Fixes, on top of I.5 (no braking while
   overlapped): the scalar lateral step already computes an
   acceleration-headroom budget — remove its 0.25 m/s² *floor* (which
   guarantees lateral motion even with zero headroom) and reserve a
   stability margin at high speed (command no more than ~60% of remaining
   lateral capacity above ~55 m/s, so steering transients stay below the
   rear slip peak). Room separation on a straight is not an emergency; it
   can take three car lengths.

Acceptance: zero rear-loss events (slipR > peak) while `alongside` on
straights across the seeded scenario set; tow-assisted pass completion on
the longest straight of each flagship track in the §A funnel; lap-time
delta from running 0.5 s behind through a fast corner ≤0.05 s (dirty air
effectively gone); hard contacts within cap.

## Phase F — Calibration, validation, rollout

1. Add all new keys to `RACECRAFT_CALIBRATION_DEFINITIONS` with bounds,
   rationale, owner; sweep on the **calibration** seed population
   (`analyze:racecraft:sensitivity`), review on **validation**, lock on
   **release** — the seed discipline in
   `superseded/RACECRAFT_DIAGNOSTICS.md` §Interpreting.
2. Order of landing: A → B → C → D → E → G → H → I → K → J, one phase per
   verification cycle. H before I (settled following is why I's damper
   thresholds can relax); I before K (the alongside-yield fixes remove the
   braking half of the straight-line spins K finishes off); K before J
   (spot selection needs the real tow magnitude to score straights).
   (`verify:fast` during development, `verify` before merging a phase).
   B/C/D each move hard-contact risk in a known direction; land them separately so
   the statistical suite attributes any amber band to one phase.
3. `race.passes_per_race` has a production-distance normal minimum of 100
   (acceptable ≥75). Total/light contact and side-by-side contact are
   observe-only. `race.hard_contacts_per_race` has the sole contact cap of 30,
   enforced on every individual race as well as the population.
4. Runtime proof: every change is O(1) inside loops that already run
   (`stepRacecraft`, tow/room scans bounded at 60/160 m); no new corridor
   searches, candidates, or materializations. Confirm with `benchmark:sim`
   (80% floor, pinned-CPU reference protocol) after Phases B and D.

## Non-goals

- No second vehicle model, no per-frame planner work, no new path modes.
- No changes to pit, priority/blue-flag, or qualifying traffic behavior
  beyond the shared followCap signature (their call sites keep explicit
  time gaps).
- No weakening of hard invariants (out-of-bounds, slew, corridor, candidate
  and materialization limits stay zero-tolerance).

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Hard-contact count exceeds 30 | B.1, D.1, D.2 | Feasibility gate stays untouched; calibrate `reactionSeconds`/`brakingPrudence` only against damaging impacts, never against light rubbing |
| Rear-end contacts when a leader mistakes mid-train | B.1 | The brake law prices the leader's *full* braking capability; the follower's `prudence < 1` and reaction margin are the buffer — sweep them against `race.hard_contacts_per_race` |
| Opening lap becomes a wreck-fest without the leash | B.3 | Opening impacts are reported for diagnosis; the whole-race hard cap and DNF policy gate the outcome, while light contact remains unlimited |
| Trains replaced by constant DRS-style passing | B.2, C.2 | `pressureAttackSeconds` and tow cap are calibration-bounded; pass_success band has an upper limit (0.8) that fails release if exceeded |
| Turn-in prediction admits hopeless lunges | D.2 | `longitudinalBodiesWillOverlap` bounds closure at 1 s + 4 m/s²; corner-rights zipper still resolves convergence; lockup roll (`traffic.ts:471-476`) already prices lunges |
| Per-driver bias breaks marker/profile checks | E.1 | Bias applies to scalar `latTgt` only, never to authored paths; `path.maximum_target_slew_m` policy still enforced |
| Headless/browser parity drift | all | All changes deterministic through `shared/rng`; parity fixtures re-recorded once per phase |
| Rubbing pairs stay interlocked after G removes the separation reflex | G.1, G.3 | Hard-contact gates unchanged; `unstableCar` still seeds recovery; zipper still resolves genuine corridor convergence; watch `race.dnfs_per_race` and hard-contact cap |
