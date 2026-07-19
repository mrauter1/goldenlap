# Racecraft: one cost function — priced decisions in seconds

Supersedes `superseded/racecraft_plan_trust_plan.md`. This plan is
self-contained; do not re-read superseded plans except where P0 says so.

## Why this plan exists

Play-testing the plan-trust build produced three symptoms. All three were
root-caused by static analysis; every phase below exists to remove one of
these mechanisms and replace it with the priced-decision design in §"The
objective".

### Symptom 1 — massive overslow (Prado 1:42 vs 1:07) with random lifts

`evaluateUniformBias` (`src/session/racecraft/lane-program.ts`) clamps every
future lane slot of a car to its **own** published claim envelope via
`claimBoundsAtS`. A claim is a publication of intent for others to read;
using it as a constraint on the car's own lane is circular authority, with
three destructive consequences:

- **Chord scalloping.** Claims have 12 stations ~0.2 s apart (4–12 m).
  `claimBoundsAtS` interpolates linearly between stations and the clamp
  allows only ±executionNoise (floor 0.2 m) around that chord. A racing
  line's lateral sweep deviates from a 10 m chord by more than 0.2 m in
  medium corners, so the clamp bites every corner even at steady state,
  flattening out-in-out into a polyline of chords.
- **Phantom slow points.** Every clamp engagement triggers
  `repairProjectedLaneGeometry`, whose finite differences convert a 0.2 m
  kink over the 2 m track step into ~0.05 m⁻¹ of fake curvature — a phantom
  20 m-radius corner — which `writeLaneSpeedSamples` converts into a ~17 m/s
  speed sample that `botStep` brakes for from 100+ m away. Stations re-anchor
  at `car.s` every tick, so the kinks slide and flicker: the random lifting,
  the lap-time collapse, and most of the 185 reactions/lap.
- **Erased tracking error.** Lane slot 0 is written as `entry.latNow` and
  `botStep` measures cross-track error against it, so `latE ≈ 0` at every
  refresh. The reference re-roots at the car instead of pulling the car to
  the reference; steering runs on pursuit + feedforward only, lags the
  corner-entry sweep, and stays wide.

### Symptom 2 — leaders slowing and swerving for the car behind

`pairPriority` (`src/session/racecraft/corridor-planner.ts`) resolves
'ahead' only when claim stations differ by more than `carLen/2` **at the
conflicting station**. Close-following pairs are inside that band at every
station, so priority falls through to a lateral-closing tie-break — and on
corner approach it is the **leader's** published line that sweeps laterally
(out-in-out), so the leader reads as "closing", loses priority, becomes
`claimAdapterTo`, and gets corridor-projected around the follower's claim.
Compounding it, `buildCorridorStations` projects rivals as unconstrained
ghosts (`otherS = s + spd·t`): a faster follower's ghost sweeps *through*
the leader, occupying the leader's own lane 1.5–2.4 s ahead. Priority is
exactly inverted.

### Audited defect 4 — the control cadence is mislabeled

Verified by direct arithmetic and runtime audit: the traffic timer in
`src/session/session.ts` (`trafT = TRAF_DT` reset, discarding countdown
residue) fires every **5th** 120 Hz physics step, so traffic actually runs
at **24 Hz** while `TRAF_DT = 1/30` is used as the elapsed-time constant in
every consumer (EWMA decays, mistake clocks, closing-velocity estimates,
pressure timers) — a systematic 25% timing error. The 3-slot deliberation
stagger therefore runs at 8 Hz, not 10. `botStep` runs at 60 Hz (every
other physics substep). No cadence may be source-tagged as current behavior
until this is reconciled.

### Symptom 3 — rigid, unnatural trajectories with excessive outside arch

Three geometry authors compound: `routeForTopology` builds staircase routes
by clamping per-station offsets into free intervals (±1.25 m reachability,
±0.75 m step preference); plans are resampled down to ≤8 lane points and
interpolated with **piecewise smootherstep, which has zero slope at both
ends of every segment**, so multi-point programs move-flatten-move-flatten
with sign-swinging curvature; and the corner seeds that *start* from the
correct primitive (`corner.alternateLines`, real apex geometry) are then
deformed through the interval clamps. Lines are authored as clamped
polylines, not apex arcs.

## Governing principle

**Rights become prices, prediction is the rival's best plan, and the
decision is one argmin in seconds.**

Corollaries, normative wherever the plan or the tree is ambiguous:

1. **Two categories only.** Constraints are what physics and the rulebook
   forbid (surface, friction circle, sporting regulations, protected
   corridors during physical overlap). Everything tactical — priority,
   yielding, attacking, defending, urgency — is a cost term in one scalar
   objective. No preference may be expressed as a gate, veto, owner/adapter
   verdict, or authority ordering.
2. **Claims are data, never authority.** A car's published claim constrains
   nobody's geometry — not rivals' and above all not its own. Claims enter
   the system exclusively as point-trajectory prediction inputs (position,
   speed) to conflict geometry and hard-safety checks.
3. **The decision tick is the reaction time.** No separate reaction latency
   exists anywhere. Latencies in the model are the deliberation interval
   (existing 3-tick stagger) and physical actuation (controller settle),
   both already in the tree.
4. **Priority emerges from arrival asymmetry.** The car with the earlier
   feasible arrival at a contested region bears less responsibility to
   resolve the contest and less fault if it goes wrong. No car ever adapts
   to a trailing ghost.
5. **Urgency emerges from slack.** A far conflict with a cheap surviving
   response prices near zero; a near conflict with only braking left prices
   its full bill. There is no distance weight and no temporal discount.
6. **Derive or measure, never tune.** Every quantity is sourced physical,
   measured, sporting, or character; resolution parameters (station count,
   horizon, candidate budget) are allowed but refining them must only
   converge behavior, never change it qualitatively. If a quantity can be
   neither derived nor measured, stop, record the blocker in the
   implementation report, and do not mint a key. Structures and functional
   forms answer to the same standard through this plan's why/how text.
7. **A point's headroom never spans a distance.** Any speed law that
   brakes for a target must be composed by per-sample backward induction
   over the actual geometry between here and the target — never by a
   one-shot `√(v² + 2·a·d)` with the target's own headroom applied across
   the span. This flaw has now shipped three times (span-max curvature in
   `trafficReachabilitySpeedCap`, phantom-curvature clamping, and the
   slow-point one-shot in `botStep`); it is a named violation from here on.
8. **Prediction is never adversarial.** Every car is predicted to do the
   best thing it can from its measured state: its published plan while it
   tracks it; a re-derived optimal program when publication is broken; the
   ballistic physics rollout when the state shows no control authority (a
   classification read from the state — spin, stall — never assumed). A
   spinning car has *less* agency than a driven one — physics owns it,
   and physics is narrow. Every prediction is a point trajectory. No
   grip-limited "reachable tube" and no worst-case envelope exists
   anywhere in the system: divergence is handled by re-observation at
   the decision cadence, never by inflating the present.
9. **Compute nothing whose result is already known.** A decision's output
   is a trajectory valid for seconds; between genuine events a car only
   executes. The formulas prove their own off-switches — β proves when
   re-deciding cannot change the answer, slack proves when waiting is
   free, zero-hazard dominance proves when the ideal line is optimal,
   and publication proves execution needs no thought. Steady-state
   racecraft cost must scale with the number of *active interactions*,
   never with cars × frequency. Skipping is legal exactly where a
   theorem already gives the answer — and only there: no situational
   gate may masquerade as an optimization (corollary 1 applies to the
   scheduler too).
10. **Noise detects; it never predicts.** This is certainty equivalence:
    with re-observation at the decision cadence and a surviving response
    guaranteed by slack, the optimal policy plans against point
    predictions and lets feedback absorb execution error — a margin acts
    always, feedback acts only when needed. The empirical record is
    unanimous: every use of measured noise to inflate geometry (envelope
    clamps, conflict windows, σ-scaled clearance gates, growth-widened
    stations) shipped a bug; every use for detection or hysteresis
    (trust thresholds, the tie-band) worked. Measured noise is therefore
    whitelisted to exactly two roles — divergence *detection* (is the
    car still on its publication?) and the tie-band's *scale* — and is
    forbidden as a length in any geometric test. Real drivers do not
    integrate over an opponent's error distribution; they assume the
    opponent's best line and adjust when observation says otherwise.

Each deliberation, for each car i, over at most six candidates c:

```
c* = argmin { J_i(c) : c ∈ C_i, c passes hard feasibility }
keep incumbent c⁰ unless J_i(c*) + β(c*, c⁰) < J_i(c⁰)

J_i(c) = ΔT_i(c) + Σ_h C_ih(c)
```

### The certainty-equivalent per-hazard core

For hazard h (one per rival pair reachable within the horizon), sweep both
oriented bodies deterministically along their **point trajectories** —
ego on the candidate program, the rival on its predicted program
(corollary 8: published plan / re-derived optimal / ballistic). One
geometric outcome results: no intersection, a near intersection (first
contact before `Δ_next + t_act`, when no new decision can intervene), or
a future intersection.

```
C_ih(c) = 1_near · X_ih                        ← the bill
        + 1_future · r_ih · min_{a ∈ A_i(c)} Q_i(a | c)     ← the contest
        + 0 when trajectories do not intersect  ← most pairs, most of the
                                                  time: silent

X_ih = ℓphys(Δv_n) + φ_ih · ℓsport(h)      retrospective consequence
Q_i(a|c) = incremental continuation cost of response a after c:
           incremental ΔT (never re-counting the shared prefix or
           acquisition) + residual contest + sporting exposure. Response
           feasibility comes from slack at the predicted intersection
           time; the cheapest response's expiry is the commitment
           deadline.
```

There is no expectation, no distribution, and no persistence estimate —
the entire probabilistic apparatus of earlier drafts (Gaussian station
overlaps, sigma-trajectory quadrature, covariance of paired residuals,
persistence probabilities, O/M⁰/M⁺ decompositions, CE_θ risk utilities
over outcome distributions) is **deliberately deleted**, not deferred.
Under certainty equivalence those objects priced an execution error that
feedback corrects within one deliberation interval; they were also the
measured owner of the runtime (96% evaluator share) and the source of
every geometry-inflation bug (corollary 10). What replaces them:

- **Divergence is handled at observation time, not prediction time.** If
  the rival departs its predicted trajectory beyond the detection
  threshold, trust machinery swaps the prediction source and an event
  trigger re-evaluates — the adjustment happens *at that later step,
  never before*.
- **Urgency still has its gradient** — it was always supplied by time,
  not probability: as a predicted intersection approaches, cheap
  responses expire (slack) and the contest term rises toward the bill.
- **The value of waiting survives structurally**: candidates that
  resolve h now pay their ΔT; candidates that defer carry
  `r · min_a Q(a)` — the deferred response priced at today's response
  set. The tie-band β and the switch cost keep deferral from chattering.

Broken publication changes the prediction's **source, never its scale**
(corollary 8): while a car tracks its publication, the publication is the
prediction; when tracking breaks but the car is under control, substitute
the re-derived optimal program from its measured state (what its own
evaluator would publish from there — recovering drivers rejoin and
re-optimize, and predicting anything else is predicting a mistake that
has not happened); when the measured state shows no control authority
(spin, stall), substitute the ballistic physics rollout, which is
*narrower* than a driven plan, not wider. Every source yields a point
trajectory; the matching measured noise class serves only as that
source's divergence-detection threshold (corollary 10). There is no
reachable tube and no worst-case object anywhere; a prediction can be
wrong for at most one deliberation interval before observation corrects
it, and that exposure is exactly what the viability veto bounds — using
the one-interval *physical* divergence (½·a·Δ_next², centimetres), a
derived kinematic bound, not measured noise.

### Own time

```
ΔT_i(c) = ∫0^SH ( q_c(s)/v_c(s) − q_ref(s)/v_ref(s) ) ds  +  ΔT_term

q(s) = sqrt( (1 − κ0·η)² + η′² )     (true arc length; the lane buffer's
                                      ds already computes the (1−κ0η) part)
ΔT_term = [v_ref(SH) − v_c(SH)]₊² / ( 2 · ā · v_ref(SH) )
```

Caveats are part of the norm: ΔT_term assumes the reference holds speed
while the candidate closes the deficit at ā; where ā → 0 (near top speed)
or the horizon ends far from the next braking zone, use the exact
continuation from the speed-profile integrator instead. The surplus clamp
is conservative, not neutral — a surplus entering a long straight has
value; the continuation integrator prices that case. The acquisition
transition is inside the integral; no separate transition term.

### Responsibility and fault — related, never identical

```
region(h) = the spacetime overlap of the two published swept trajectories
            (from the arbitration snapshot), per hazard — NEVER a corner
            feature, never corner.apexI

r_ih = Φ( (τ_i − τ_j) / σq )             prospective responsibility
       (smooth in the ETA gap; lives inside the contest term)
φ_ih = the incident system's fault model  retrospective sporting fault
       (arrival asymmetry is one input; overlap state, deviation from the
        published plan, and contact direction are others; lives inside X)

τ_x(h) = earliest unimpeded feasible arrival of car x at region(h), best
         over x's line family — a property of the car's state and the
         snapshot, NOT of the candidate being evaluated
σq   = the arrival-time quantization the decision cadence imposes:
       arrival differences finer than one deliberation interval cannot be
       acted on, so r smooths over ~Δt_d — derived, not measured. (A step
       function is forbidden: it reintroduces churn at τ_i = τ_j.)
```

**There is no apex in these formulas.** A corner is not a capacity-one
resource with a canonical point someone must win: it admits multiple
non-overlapping arcs, each with its own apex. Contest exists only where
two chosen trajectories actually intersect in spacetime, and the region
definition above makes the contest **migrate to wherever the geometry
pinches**: the braking zone at entry, the shared arc if both want the same
line, or — the common side-by-side case — the **exit, where two different
arcs converge**. Cars on non-overlapping arcs through the same corner
have no region, no hazard, and no contest term: side-by-side cornering is
an ordinary argmin outcome. Anchoring region(h) to the published snapshot
keeps τ non-manipulable within the epoch. Corner metadata
(`corner.apexI`, alternate-line records) remains legitimate as family
seed material and must never appear as a contest anchor inside J.

r answers "who must adapt"; φ answers "who pays if it goes wrong". They
need not be equal and never sum by construction. Later feasible arrival at
region(h) ⇒ more responsibility to resolve and more fault exposure; the
earlier car holds its line because holding is cheap, not because a rule
says so. Rear car carries both for longitudinal contact; the car outside
its published envelope carries them laterally.

### Slack

At a decision epoch, per response a:

```
t_comp(adjust δ) = physical lateral move law incl. steering-rate dynamics
t_comp(shed Δv)  = real variable-grip braking profile (backward
                   integrator; Δv/(η·a) only as a seed)

S_now(a)  = t_h − ( t_act + t_comp(a) )       act-now feasible iff ≥ 0
S_wait(a) = S_now(a) − Δ_next                 survives one wait iff ≥ 0
```

Δ_next is the **guaranteed** time to the next evaluation for this car
(scheduled slot; event triggers may come sooner but are never assumed).
The deliberation delay appears exactly once — in S_wait — and nowhere
inside t_comp. There is no separate reaction latency anywhere (corollary
3), and no uncertainty margin in expected-cost slack — the vetoes check
one-interval viability with the derived physical displacement `d_1int`
(§Hard feasibility).

### Concession is lateral; the surface is bigger than the track

When a true contest resolves, the conceding car should almost never
concede by braking — it concedes by **changing trajectory**: re-aiming to
the non-overlapping arc (the corridor-constrained λ of the family), which
costs tenths of a second, versus whole seconds for a lift-and-tuck. This
must be *emergent from the prices*, never a rule — but the response set
must make it possible:

- A_h always contains the lateral re-aim members (λ within the current
  corridor / agreement bounds) alongside the longitudinal ones. If an
  implementation's only concession response is brake-behind, concession
  degenerates to braking and the implementation is wrong. Lateral
  responses also usually have shorter t_comp than a meaningful speed
  shed, so they survive longer in slack terms — late concessions stay
  lateral too.
- **Off-surface escape is a valid response, priced, never vetoed.** The
  emergency lateral envelope (grass, runoff) is part of the avoidance
  response space. Its price is fully derived: ΔT from the measured
  surface mu/drag at the excursion offsets (the surface-exposure model
  exists), instability risk through the existing utilization/mistake law
  at the reduced mu, and the sporting cost of any advantage gained on
  rejoin (incident system). Only barriers and physics are absolute. A
  car executing a *published* excursion keeps its claim trust — see the
  P-C trust-revocation item; an escape that revoked the escaper's own
  trust would price avoidance into a panic it did not cause.
- The expected emergent ordering — small re-aim < wide arc < lift <
  grass excursion ≈ hard brake — is an *acceptance signal*, not an
  authored ladder: if probes show brake-heavy concessions, some lateral
  price is inflated (acquisition cost, off-line ΔT, or a missing family
  member), and that mispricing is the bug to find.

### Character (risk utility removed)

Under certainty equivalence there is no outcome distribution inside J, so
the CE_θ risk utility is vestigial and is **removed** (its θ_i trait with
it). Driver character continues to express through the channels that
already exist and remain honest: braking effort η_i, focus and the
mistake law, and the sporting layer. If a per-driver *chosen clearance*
preference (how much room this driver likes to leave) is ever wanted, it
enters as a priced character preference in seconds — a deliberate future
item, never a noise statistic, and never before play-testing shows the
uniform behavior is insufficient.

### Hysteresis tie-band

Switch decisions depend on uncertainty in the **difference** of candidate
costs (common-mode noise cancels):

```pseudocode
tieBand(c, c0):
    # deterministic ±σ perturbations of rival centres at active hazards'
    # binding stations; no sampling
    return max over perturbations e of
        | (J(c;e) − J(c0;e)) − (J(c;0) − J(c0;0)) |
```

### Candidate family (geometry)

```
η_λ(s) = (1−λ)·η_ideal(s) + λ·η_alt(s)     λ ∈ [0,1], alt ∈ {inside, outside}
         (Frenet offsets of validated G2 lines; a linear blend of G2 offset
          profiles is G2)
candidate(λ) = acquisition(current authored state → η_λ) ⊕ η_λ
v_c(s) = min( v_ref·margin, cornerSpeedForGrip(κ_c(s), μdyn(s)) )
κ_c    = analytic curvature of the family member — NEVER finite-differenced
         from clamped or resampled offsets
```

Away from corner approaches the family's `alt` members are **surface-
bounded parallel offsets of the ideal line** (the straight-line lateral
move: pull out of the tow, hold an offset lane, rejoin). This member is
not optional decoration — it is the only plan shape that can express the
fundamental overtaking move, and without it no evaluator can produce
side-by-side racing. The overtake is then an emergent sequence of cheap
decisions: tuck (free at matched speed) → pull out when the tow-boosted
closing speed makes the longer path profitable → alongside (physical
overlap forms a side agreement, which bounds both cars) → arrival
asymmetry `r` decides the contested region. Side-by-side running is the
stable intermediate state of that sequence, priced by closing
probability — it must never be priced by proximity.

**Under a side agreement the family is evaluated within the corridor:**

```
λ*_corridor = argmin over λ of J(candidate(λ))
              subject to η_λ(s) inside the agreement corridor for all s
```

The corridor-constrained optimum **is** the different-apex line: clamp
the blend to the inside half of the road and the best feasible λ has a
later, tighter apex with its own honest speed law; clamp to the outside
and it has the wide arc. Corner sharing is constrained optimization over
the family that already exists — never a special mode, never a
hand-authored "side-by-side line".

**Vocabulary, and how it is allowed to grow.** Basis arcs are authored
offline to the *drivable extremes* of the surface (the deepest defensible
inside line uses the inside edge at its apex; it never rides the edge —
edges are constraints, not paths), and per corner complex where lines
couple (`complexId`). Rivals do not change the family of good arcs; they
change which member is feasible and what it costs — that dependence
enters through the analytic seed and J, never through arc search. If
probes show the vocabulary is too poor (the symptoms: a brake-heavy
concession mix, or attacks aborting for lack of a viable arc), the
remedies are, in order:

1. densify the family into an apex-parameterized grid per corner
   (turn-in, apex placement, exit — λ becomes interpolation in that
   grid; same runtime cost);
2. constraint-driven single-shot generation: the rival clearance selects
   the apex parameter in closed form, one arc is fitted through it
   inside the grid's precomputed validity envelope, and J is evaluated
   once — generation without search, one candidate slot.

Online *search* over arcs is forbidden — not only for cost: a
search-optimized arc reshapes every epoch as rivals drift, wobbling the
car's own publication, inflating everyone's measured divergence, and
destabilizing the pricing that depends on it. The family's quantization
is what makes intent stable and publishable — a feature, not a
limitation. And per-station lateral freedom never returns under any
symptom.

λ is **seeded analytically, evaluated once, never searched online**. The
seed intersects the clearance intervals in λ of **every** station × hazard
(affine under frozen station timing and acquisition span — the freeze is
the approximation, recorded as such): single-station clearance is invalid
(clearing one peak can create another; opposing rivals can make the
intersection empty). Empty intersection ⇒ no clearing λ exists; seed at
the minimum-total-risk λ and let J price it, or drop the side. The seeded
candidate always undergoes full feasibility + cost evaluation. Seeds
replace the previous generation's left/right topology seeds, preserving:

```
C_i = { holdIncumbent, ideal, inside(λ*), outside(λ*), brakeBehind,
        recenter }                                   (≤ 6, budget intact)
```

### One longitudinal authority, honest publication

The selected candidate installs exactly **one compact longitudinal
program**: the candidate's own lane speed law with the rival-derived slow
point **composed into it by one per-sample backward sweep** (corollary 7):

```
seed v[j_sp] = min(lane.v[j_sp]·margin, v_slowpoint), then backward:
v[j] = min( lane.v[j]·margin,  √( v[j+1]² + 2·effort·room_j·ds_j ) )
```

with `room_j` from each sample's own curvature and speed — never the slow
point's headroom across the whole span. Once composed, the program **is**
the lane speed law; `botStep`'s separate `traffic` parameter and its
one-shot branch are deleted with this (the controller's existing
per-sample anticipation executes the composed law unchanged). Control
between deliberations re-derives inputs from the program; it never makes
a new tactical decision. All duplicate channels for the same decision —
candidate `speedCap` installation as `vCap`, racecraft `vCap` writes,
`racecraftThrottleCap` as an independent authority — are deleted.

**Publication honesty:** a car's claim stations must publish the speed it
will actually run — the selected program rolled forward (lane speed law ∧
follow constraint ∧ margin), not the unconstrained lane profile.
`publishedSpeed` currently ignores the slow point, caps, and margin
(`corridor-planner.ts`), so followers' claims overstate their speed and
rivals mispredict; this is a defect this plan fixes, not a detail.

### Hard feasibility (vetoes — physics and rulebook only)

```
surface:   tactical candidates stay inside the NORMAL lateral envelope;
           avoidance responses may use the EMERGENCY envelope (grass,
           runoff) — priced, never vetoed (§Concession). Only barriers
           are absolute.
drivable:  speed law within the friction circle (true by construction;
           off-surface segments use the measured surface mu)
agreement: protected corridor bounds while physical overlap exists — and
           racing room is a drivable-arc guarantee, not a width number:
           the corridor must leave each car a feasible family member with
           a real speed law through the corner. An agreement that leaves
           width but no viable arc is invalid and must widen.
no-trap:   viability, one interval deep: from the candidate's state at
           the next decision epoch, at least one response must avoid
           hard contact (the collision code's damage class) against
           every rival's point prediction plus the derived one-interval
           physical displacement d_1int — where the response space counts
           the emergency envelope (a car with grass on its side is not
           trapped). Bounded by re-decision —
           there are many ticks in which to avoid even a spinning car —
           never by horizon-length reach. No reachable tube exists
           (corollary 8).
sporting:  one defensive move per attack; pit-entry destination; blue-flag
           obligations and off-track advantage priced as literal penalty
           seconds
```

### Cadence and snapshot semantics

Target cadences, valid only after the P-A timer fix (audited defect 4):

```
physics:    120 Hz          botStep: 60 Hz (every other substep)
traffic:    Δt_c = 1/30 s   — timer must ACCUMULATE (trafT += TRAF_DT),
                              not reset, so the constant is the truth
deliberate: Δt_d = 3·Δt_c per car is the CEILING, reached only in live
            traffic; the actual rate follows the derived schedule of
            §Performance (solitary cars deliberate seconds apart). Event
            triggers — trust transition, incumbent infeasible, proximity
            boundary crossing, S_wait(cheapest) < 0 — interrupt the
            schedule immediately and are never batched or deferred.
control between deliberations: execute the installed program only

per arbitration epoch:
  1. snapshot all claims
  2. evaluate every car due this epoch against the snapshot
  3. select all due plans
  4. publish all selections after evaluation completes
No car reads a claim published earlier in the same loop — processing order
must never become hidden priority (the current leader-first sort is exactly
that). `reserveRacecraftClaim`'s same-tick centre rewrite is deleted with
this.
```

### Performance: the formulas contain their own off-switches

Corollary 9 made operational. The racecraft layer is two tiers:

```
Tier 0 — the sensor: every traffic tick, every car, O(1):
  advance dead-reckoned state; check the standing decision's validity
  CERTIFICATE: neighbor set unchanged ∧ gaps inside their derived bands
  ∧ no trust transitions ∧ schedule not expired.

Tier 1 — full deliberation: only on certificate break or schedule
  expiry: J, swept-body intersections, candidates, tie-band — the
  complete §Objective.

t_next = min( time for any gap to reach the interaction boundary at the
                maximum closing rate,
              time for accumulated input drift to exhaust β,
              min over hazards of S_wait(cheapest response),
              the claim-horizon refresh bound )
```

Every certificate clause is a theorem, never a threshold: β proves small
drift cannot flip the argmin; slack proves no response is needed before
t_next; the interaction boundary is the existing scan range. The
certificate is also the single gate for event triggers — re-evaluate
only when it actually breaks, which is simultaneously the decision-churn
fix (triggers firing on diagnostic wiggle are certificate-intact and get
ignored).

**The solitude short-circuit:** a car with no rival inside interaction
range has zero hazards, so `J(ideal) = 0` is optimal by construction —
no candidates, no evaluator, no lane buffer (the controller runs off the
ideal path directly, a mode that exists), and **no claim**: claims are
computed on demand, only for cars with a neighbor in scan range — nobody
reads a solitary car's publication.

Supporting disciplines: claims and lane buffers advance incrementally
(drop head, append tail) while the program is unchanged, with full
rebuild only when Tier 1 ran; all pair work walks the sorted-by-s
adjacency (hazards per car stay at the existing neighbor bound; no O(n²)
sweeps); a cheap axis-aligned bound check is the only cost for pairs
whose point trajectories cannot intersect;
candidates are skipped only under dominance proofs (zero hazards ⇒
hold/ideal wins; no live slow point ⇒ no brake-behind; no contest ⇒ no
attack alternates); seeds and feasibility memoize on claim revision
counters. The reactive tail stays bounded by the existing budgets — when
one spin triggers several simultaneous Tier-1 evaluations, that spike is
the bounded, non-deferrable case the budgets exist for.

The target invariant, stated for probes: **steady-state racecraft cost
scales with active interactions, not with cars × Hz.** A spread field
resolves the large majority of car-ticks in Tier 0.

### Glossary

| Symbol | Meaning | Source |
|---|---|---|
| Δt_c, Δt_d, Δ_next | traffic tick 1/30 s; deliberation 3·Δt_c; guaranteed time to next evaluation | physical / resolution / derived |
| t_act | actuation latency (steering-rate + controller settle, priced once inside t_comp) | physical |
| W, L | body width, length | physical |
| ε_x | tracking-error EWMA — divergence DETECTION threshold and β scale only; never a length in geometry (corollary 10) | measured |
| ℓphys(Δv) | seconds lost given single contact | measured (in-sim) |
| ℓgrind | seconds lost per second of sustained contact | measured (in-sim) |
| ℓsport(h) | expected penalty seconds given fault | sporting |
| r, Φ, σq | responsibility; normal CDF; arrival quantization ~Δt_d | derived |
| φ | fault share from the incident system's model | sporting |
| τ_x | earliest feasible arrival at contested region | derived |
| ā, a_max | drive accel; grip-limited accel | physical |
| η_i (braking effort) | existing brakingPrudence | character |
| d_1int | one-interval physical divergence ½·a·Δ_next² (viability bound) | derived |
| K=12, T=2.4 s | stations, horizon | resolution — convergence test |
| β | tie-band | derived |
| λ | line-family blend | decision variable, analytic all-constraint seed |

Deleted from earlier drafts (do not resurrect): ρy/ρs divergence growth,
Cov_ij, the quadrature node rule and sigma-trajectories, P̃, O/M⁰/M⁺,
CE_θ and θ_i, claim station envelopes (min/max/width invariants), and
every σ-scaled clearance or conflict window.

Observations: (G1) conflict is deterministic swept-body intersection of
point trajectories; there is no probability object to take complements
of. (G2) the contest term is evaluated for every candidate that leaves a
hazard unresolved; resolving candidates *are* the recourse of the
others — never double-count, and never charge a response's full-horizon
ΔT (incremental continuation only). (G3) nothing in J is a tuned weight:
priority = r/φ asymmetry, urgency = slack + the near indicator,
anticipation vs reaction = large-slack vs zero-slack terms of one sum,
commitment = cheapest-response expiry plus β, equilibrium gap = body
clearance plus the one-interval physical divergence bound. (G4) light
contact is priced per strike (ℓphys) AND per second while maintained
(ℓgrind, same measurement methodology) — staying in contact is never
free, which is what makes separation the argmin and grinding impossible
to prefer.

## Phases

Implementation status as of July 19, 2026:

- P0: complete.
- P-A: implemented; the required probe is recorded in
  `racecraft_cost_function_implementation_report.md` and remains red against
  the phase's derived lap-time/outside-zone expectations.
- P-B: implemented; the required probe is recorded in
  `racecraft_cost_function_implementation_report.md`. Leader line/brake
  authority is green, while the equilibrium/pass outcome remains red for P-C.
- P-C: implemented; the required probe and its remaining reds are recorded.
- P-S: reopened after the performance amendment; the ordered implementation
  is landed on focused checks and the single behavior/scaling recheck is
  pending.
- P-D: reopened; its final unit, invariance, parity, and benchmark gates wait
  on the P-S recheck.

Order is normative: each phase's replacement is meaningless while the
previous phase's corrupted authority still writes.

### P0 — Reconcile

Read `superseded/racecraft_plan_trust_implementation_report.md` once.
Record in the new implementation report which of its structures exist in
the tree (claims with published speed, slow-point following, commitment
deadline, snapshot state, observers). Record the audited actual cadences
(physics 120 Hz, botStep 60 Hz, traffic 24 Hz vs `TRAF_DT = 1/30`,
deliberation 8 Hz) as the baseline P-A must fix. Baseline: typecheck,
module boundaries, note the inherited benchmark state. No behavior
changes.

### P-A — Free the lane

The lane is the car's control reference. Nothing may bend it except its own
authored program and the legal surface.

- Fix the traffic timer first (audited defect 4): accumulate
  (`trafT += TRAF_DT`) instead of resetting, so traffic actually runs at
  the declared 30 Hz and deliberation at 10 Hz. Audit every consumer that
  uses `TRAF_DT` as elapsed time (EWMA decays, mistake clocks, closing
  velocity, pressure timers) — after the fix the constant is the truth, so
  they stand; record any that assumed the wrong cadence.
- Re-scope `reactionSeconds`: it survives only as the EWMA decay horizon in
  `prepareClaim`, which is not a reaction time. Replace that usage with a
  decay derived from Δt_d (or a declared measured horizon), delete the
  calibration key, and update the AGENTS.md paragraph that still describes
  reaction time as priced into follow reachability — the plan and AGENTS.md
  must not disagree about whether reaction latency exists (it does not;
  corollary 3).
- Delete the self-claim clamp: `evaluateUniformBias` loses its `claim`
  parameter and all `claimBoundsAtS` reads of the car's own claim
  (including the `maintainRacingLineZeroState` read). Bounds on a car's
  lane come only from side agreements (the existing `corridor` parameter)
  and the surface envelope.
- Restore cross-track feedback: the control lane's slot 0 is the **authored
  reference** at the car's current s (program/bias over the ideal line),
  never `entry.latNow`. `botStep`'s `latE` must measure the true error to
  the reference. Publication keeps the measured-position time-zero rule —
  `prepareClaim` is unchanged here; control and publication part ways.
- Replace multi-point piecewise-smootherstep lane interpolation with
  slope-matched interpolation (Catmull-Rom on eta) — zero-end-slope easing
  remains only for genuine two-point transitions, where it is physically
  correct. Corner/tactical geometry stops being resampled through ≤8
  points: family members are sampled analytically at track resolution
  (§candidate family), with analytic curvature. Finite-difference curvature
  repair remains only for the surface-projection safety branch, and any
  slot it rewrites must be excluded from phantom speed authority (a
  projected slot keeps the *authored* curvature for the speed law; the
  projection is a position veto, not a curvature source).
- Delete `recordInstalledLaneBounds` reads that became dead, and every test
  that encodes the self-clamp.

Probe (once): solo two-car-free run on Prado and Costa. Record lap time vs
the profile lap time (`speedProfile` lapTime × bot margin — derived bound,
not a tuned threshold), count of brake/lift applications outside the
profile's own deceleration zones (must be zero), rear-loss episodes, lane
out-of-bounds. This probe owns symptom 1.

### P-B — Claims become data; priority authority dies

- Claims publish `(ŝ, ŷ, v̂, ε, ρy, ρs)` per station. Add the ρ
  measurement (EWMA of divergence growth, same mechanism as the existing
  tracking-error EWMA).
- Publication honesty: `publishedSpeed` must roll the car's **selected
  program** forward (lane speed law ∧ follow constraint ∧ margin), not the
  unconstrained lane profile — a following car's claim currently overstates
  its speed and every rival mispredicts it. Station positions integrate
  the same honest speed.
- Delete `pairPriority`, conflict owner/adapter resolution,
  `claimAdapterTo` and `adapterRung` authority, and the ghost-occupancy
  authoring in `buildCorridorStations`/`routeForTopology`/
  `corridorCandidates` — candidates stop being reshaped by anyone's claim
  before scoring. The defense gate tree (`defenseMoveBlockReason`,
  `evaluatorDefenseVeto`, door-block accounting) is deleted; the sporting
  one-move rule survives as a legality constraint on candidate sets
  (`claimDefenseResponse` bookkeeping may stay for it), and everything else
  those gates encoded (braking-zone, squeeze, mirror) is now priced by P,
  r, and O.
- Install snapshot semantics for the arbitration epoch and delete
  `reserveRacecraftClaim`'s same-tick centre rewrite.
- Keep: trust machinery (extended with ρ), side agreements (physical
  overlap only), `publishedFollowConstraint` + slow-point execution,
  `queueFollowCap` (pit/quali comfort policy), blue-flag obligations.
- Delete the tests that specify owner/adapter and ghost-corridor
  semantics.

Probe (once): two-car close-follow on Prado — a faster follower closes onto
a leader and sits. Record: leader line deviation from its solo lap
(≈ 0 within execution noise — leaders never move for trailing cars), leader
lift/brake events attributable to the follower (zero), follower equilibrium
gap (reaches the derived floor: carLen + noise + one-tick divergence), hard
contact (zero). This probe owns symptom 2.

### Addendum after P-B — play-test findings that P-C must own

Play-testing the post-P-B hybrid (old evaluator alive, new claims/snapshot
in) reproduced the P-B probe's reds: a faster car stalls 6+ car lengths
behind a leader, and no side-by-side racing occurs anywhere. Static
analysis found four mechanisms; the leader-authority half is green (leader
line deviation 0 m, zero follower-attributed leader brakes), so these are
the whole remaining story:

1. **A distance weight survives in the old evaluator.**
   `applyCandidateGeometryRisk` prices `proximity =
   carLen/(carLen + predictedMinimumSeparation)` — cost for predicted
   nearness regardless of relative speed, scaled by
   `driverRiskProfile · paceRiskAppetite` (aggression discounting safety —
   both patterns this plan forbids). Nothing prices the tow benefit, so
   the argmin equilibrates tens of metres back.
2. **The conflict window makes nearness mean conflict.**
   `claimTransactionCheck` flags conflict inside
   `carLen + margin + noises + growth·t + reachableLongitudinal`, so any
   tucked candidate reports separation ≈ 0 and feeds mechanism 1.
3. **The slow-point one-shot** in `botStep` (corollary 7's third
   violation) brakes for a leader's corner station across the whole
   approach at the station's own headroom — the follower loses metres at
   every corner entry it can only partly recover.
4. **Light contact revokes trust.** `claimIsTrusted` fails on
   `recentContact`/`_mishap`, swapping the rival to the grip-limited
   reachable tube (20+ m at late stations) for a tick — every brush
   explodes the windows and spikes avoidance/churn.

Mechanisms 1 and 3 were not on any deletion list; they are now (P-C).
Mechanism 4 is a P-B correction executed in P-C. Mechanism 2 dissolves
when the screen stops being a cost source (P-C's quadrature).

### P-C — The evaluator

- Implement J exactly as §"The objective": the exact per-hazard core
  (bill + recourse) evaluated by the deterministic error-trajectory
  quadrature, station Gaussians as the screen only; r inside Q, φ inside X
  and delegated to the incident system's fault model; ℓphys measured
  curve; CE_θ risk utility on soft outcomes; slack as S_now/S_wait with
  Δ_next appearing exactly once; difference tie-band β.
- Candidate set: the six listed members, λ* seeded by the all-constraint
  clearance-interval intersection (empty ⇒ minimum-total-risk seed or drop
  the side), each seed fully evaluated once. Candidate geometry from the
  family, acquisition via the physical move law. **The family's straight
  member (surface-bounded parallel offsets — pull-out-of-tow, offset lane,
  rejoin) is mandatory**; without it no overtake can be expressed
  (addendum).
- Single longitudinal authority: selected candidate → one compact
  longitudinal program — the lane speed law with the slow point
  **composed by the per-sample backward sweep** (corollary 7; addendum
  mechanism 3) — executed closed-loop. Delete `botStep`'s `traffic`
  parameter and one-shot branch, candidate `speedCap` installation as
  `vCap`, racecraft `vCap` writes, and `racecraftThrottleCap` as an
  independent channel (partial-throttle behavior, if selected, expresses
  through the candidate's own speed law).
- Delete `applyCandidateGeometryRisk`'s `proximity` term and the
  `driverRiskProfile · paceRiskAppetite` risk multiplier with it (addendum
  mechanism 1). Nearness is never a cost; contact probability from
  relative closing motion and measured noise is (≈ 0 for a tucked follower
  at matched speed — the equilibrium gap must fall out at the derived
  floor already computed by the P-B probe, ~0.21 m body clearance).
  Character enters through CE_θ only.
- Correct trust revocation (addendum mechanism 4): remove
  `recentContact` and `_mishap` from `claimIsTrusted` — a car still
  tracking its published line after a brush is still predictable.
  `offCourse` revokes only when it *contradicts the publication*: a car
  executing its published emergency arc on the grass is tracking its
  plan and stays trusted; without this, every deliberate priced
  excursion detonates neighborhood-wide avoidance against a perfectly
  predictable car. Trust means tracking your publication, wherever the
  publication goes. Revocation keys on tracking-error breach,
  instability, and unpublished off-surface only — and revocation swaps
  the prediction's *source* (re-derived optimal program, or ballistic
  rollout for a car without control authority), never its scale
  (corollary 8).
- Delete the P-B reachable-tube machinery: `reachableLateralMetres`,
  `reachableLongitudinalMetres`, the `physicalReach` branch in
  `prepareClaim`, the tube term in the conflict window, and the
  emergency-surface tube cap. Their replacement is the prediction-source
  law above plus the one-interval viability veto (§Hard feasibility).
  No worst-case object survives P-C anywhere in the tree.
- Contested regions are hazard-defined (§Responsibility): τ, r, and φ
  anchor to region(h) from the snapshot overlap, never to `corner.apexI`.
  Audit every surviving read of `corner.apexI`/alternate-line metadata:
  seed material for the family is legal; a contest anchor inside J is the
  fixed-apex assumption re-entering and must be deleted.
- The response space includes lateral re-aim members (corridor-constrained
  λ) and the priced emergency-surface escape (§Concession). Concession
  must be able to be lateral; brake-behind is one response among several,
  never the designated yield.
- Delete the bespoke commitment-deadline machinery (`racecraftCommitment`
  lifecycle beyond what the sporting one-move rule needs): commitment is
  now the recourse crossover plus β; the deadline is where S_wait of the
  cheapest response crosses zero. Delete opportunity/rung scoring that
  duplicates J.
- ℓphys: measure the consequence curve once from the existing collision
  code (headless, scripted contacts across Δv; record recovery seconds) and
  commit it as a measured table with its measurement script. Re-measure
  whenever collision physics changes.

Probe (once): the attack/switchback pair cases from the previous
generation's probe set. Record: passes attempted/completed, the settled
tucked follow gap (must reach the derived body-clearance floor, not a
multi-car-length standoff), straight-line pull-outs selected (> 0 —
the family's straight member is exercised), in-line vs offset
commitments, the **concession mix** (contested resolutions classified
lateral vs brake — lateral must dominate; a brake-heavy mix means a
lateral price is inflated, per §Concession), any side-by-side corner
spans completed without contest terms firing, light/hard contact counts,
candidate count ≤ 6, materializations 0, decision switches per lap
(β working: no churn). This probe owns symptom 3's tactical side and
close-racing viability.

### P-S — Interaction-density scaling (after P-C, before P-D)

Implements §Performance. Sequencing rationale: the certificates guard the
*new* evaluator's entry points — building them around machinery P-C
deletes would be wasted work, so P-S lands immediately after P-C.

- **Instrument first.** One profiling run of the benchmark scene with
  coarse subsystem buckets (physics / lane / claims /
  evaluator+feasibility / collisions / other). Record the attribution in
  the report and direct the work by measurement, not conjecture. This
  diagnostic run is separate from the official benchmark budget, which
  stays with P-D.
- Land Tier 0 / Tier 1 with the derived schedule and the certificate as
  the single gate for all event triggers (§Performance). Certificate
  clauses are theorems only — any clause that cannot be derived from β,
  slack, the scan boundary, or publication tracking is a design error;
  stop and record it.
- Land the solitude short-circuit including on-demand claims and the
  bufferless ideal-path controller mode for solitary cars.
- Incremental claim/lane advance and seed/feasibility memoization apply
  **only where a behavior-equivalent representation exists**; a recorded
  blocker (dynamic inputs make the cache key or aged mean dishonest) is
  the correct outcome, not a failure. The mandatory substitutes that need
  no such representation: the on-demand claim set, and **noise-grained
  revision keys** — a republished claim that matches its predecessor's
  aged prediction within its own measured noise is the *same*
  publication (same revision, no certificate break, memoized consumers
  stay valid). Reanchoring to the measured state every tick is honest
  publication; treating every reanchor as new information is not.
- Adjacency-only pair work (delete the `updateSideAgreements` O(n²)
  sweep); dominance-proof candidate skipping. Because the evaluator is
  the measured runtime owner, Tier-1 *per-call* cost is in scope, not
  just Tier-1 frequency: screen-first ordering (no quadrature, recourse,
  or feasibility for hazards the screen clears), dominance exits before
  candidate construction, and a micro-attribution of
  `evaluateRacecraftDecision` from the flushed CPU profile to direct the
  remainder.
- The reactive path is never batched or deferred; its cost stays bounded
  by the existing budgets.

Probe (once, two measurements): (a) **behavior invariance** — rerun the
P-C probe seed with Tier 0 and certificates active; outcomes must match
the P-C run within measured noise. The off-switches must be behaviorally
invisible; any divergence beyond noise means a certificate clause is not
actually a theorem — that clause is the bug, not the tolerance.
(b) **scaling** — the instrumented scene again, recording per-subsystem
cost and the fraction of car-ticks resolved in Tier 0 (expected: a large
majority in a spread field, approaching none only in dense packs).

### P-D — Residue, observers, tally

- Delete dead diagnostics of the removed authorities; keep the bounded
  headless surface reporting: station-gap moments, per-corner commitment
  counts, reactions/lap, contact counts, J-term decomposition for the
  selected candidate (so play-test anomalies can be attributed to a term).
- Convergence spot-check (resolution rule): run the P-B probe once at
  K = 24 stations; behavior must match the default within noise.
- Full-field probe (once): Prado race. Finite, classification-valid,
  candidates ≤ 6, materializations 0, hard contacts 0, DNFs/stalls/pit
  deadlocks 0, reactions/lap at the deliberation cadence (≈ 10/s only under
  event triggers, not steady state), passes occur, lap times within the
  derived bound of profile times.
- Benchmark: run once here and once after P-B (two invocations total).
  Deleting the per-slot claim reads, the repair double-pass, the O(n²)
  conflict ledger, and the defense gates is expected to recover the floor;
  if not, record where the time went — do not tune.
- Structural tally: deletion counts by category, invariants, status table.

### Addendum after P-S/P-D — the noise verdict and four mechanisms

Play-testing the implemented tree produced: followers overcorrecting onto
the grass for conflicts that would not have materialized (or where a mild
asphalt offset was plainly better), width still unused when attacking or
avoiding, and pairs grinding in persistent light contact on the same line
while bleeding real time. Static analysis found four mechanisms:

1. **Emergency replaces asphalt** (`buildCandidateSeeds`): when the λ
   seed does not fully clear, the computed minimum-total-overlap asphalt
   candidate is *discarded* and a grass-authorized escape takes its
   candidate slot — the plan said "seed at the minimum-total-risk λ and
   let J price it". In contested moments the lateral vocabulary
   collapses to {hold, ideal, grass, grass, brake-behind}.
2. **σ-inflated clearance gates** (`clearanceLambda`,
   `emergencyEscapePlan`): "clears" demands `carWid + quadratureSupport·σ`
   (~3σ of both cars' noise + growth) at stations gated by a σ-widened
   longitudinal window — a near-worst-case *gate* where a *price*
   belongs. Clearing is nearly unattainable in close racing, which is
   what feeds mechanism 1. This was corollary 8's disease re-entering
   through the seed, and it generalizes: see corollary 10.
3. **Width truncated at the generator** (`straightFullPlan`): one eta =
   the tightest legal edge offset over the entire horizon — a downstream
   corner truncates the pull-out width available on the straight.
4. **Sustained contact is priced as free** (`MEASURED_CONTACT_LOSS` is
   single-strike: a brush = 0.005 s) while `collideCars` applies impulse
   plus velocity damping every physics step of maintained overlap — the
   sim bleeds real speed that the bill never mentions, so staying in
   contact wins the argmin. Compounded by side agreements releasing at
   the noise floor (~0.2 m), flickering across a pass and letting both
   cars re-converge onto the same line.

The general lesson is corollary 10: every noise-as-geometry use has
shipped a bug (self-clamp scalloping, growth conflict windows, this
clearance gate, reanchor certificate breaks, envelope invariants,
noise-floor agreement release); every noise-as-detection use has worked.

### P-CE — Certainty equivalence and contact dynamics

Implements corollary 10 and the revised §Objective, and closes the four
addendum mechanisms.

- **Delete the probabilistic apparatus** per the glossary's deleted list:
  sigma-trajectory quadrature and its node rule, Gaussian station
  overlaps as probability, ρy/ρs divergence-growth EWMAs, Cov machinery,
  CE_θ/θ_i, claim station envelopes (stations become point samples —
  min/max fields and width invariants go), and every σ-scaled clearance
  or conflict window. Conflict is deterministic swept-body intersection
  of point trajectories; a cheap bound check screens pairs. Viability
  uses the one-interval physical divergence d_1int, derived kinematics.
- **Noise whitelist enforcement**: after the deletions, audit every
  remaining read of ε/tracking noise — legal only in divergence
  detection (trust) and the tie-band scale. Any ε appearing in a
  geometric comparison is a violation; record and delete.
- **Emergency never replaces asphalt** (mechanism 1): the min-risk λ
  seed is always pushed and priced; emergency-surface members enter the
  set only as responses to a live hazard whose cheapest normal response
  is expiring (slack-gated), always fully priced (surface mu/drag ΔT,
  instability via the mistake law, rejoin advantage via sporting).
- **Seed clearance is body geometry** (mechanism 2): clearance tests use
  W plus the sporting body-clearance where agreements apply — no σ, no
  support factors. Residual conflict is J's to price on point
  trajectories.
- **Per-anchor eta in the straight member** (mechanism 3): offsets from
  the local envelope at each anchor; the pull-out uses the straight's
  width and narrows where the track does.
- **Measure and price ℓgrind** (mechanism 4): seconds lost per second of
  maintained contact, measured with the existing methodology
  (sustained-pressure variant of `tools/measure-contact-loss`); a
  candidate predicted to remain in contact is billed
  `ℓgrind × predicted contact duration`. Separation becomes the argmin;
  persistent light contact becomes unaffordable, exactly and only
  because it is genuinely expensive.
- **Agreement hysteresis from body clearance** (mechanism 4): side
  agreements release at the sporting body-clearance, not the noise
  floor; the racing-room drivable-arc guarantee holds through the whole
  overlap episode.
- One benchmark invocation after landing (the deletions are expected to
  collapse the evaluator's 96% runtime share; record the new
  attribution).

Probe (once): the P-C probe set plus the full-field Prado scene. Record:
grass excursions (must be rare and each attributable to a live hazard
with expiring normal responses), pull-out offset distribution (spans the
local envelope, not a fixed extreme), maximum continuous contact
duration (bounded — no grinding), concession mix (lateral-dominant),
passes attempted/completed, settled follow gap at the derived floor,
candidates ≤ 6, materializations 0, and the certificate-break profile
(prediction-source breaks near zero under point-trajectory publication
equivalence).

### Addendum — battle economics, verified by calculation

Play-testing the certainty-equivalent build: the leader escapes and laps
~4 s faster than a pack that stays bunched; side-by-side cars run at zero
daylight and rub constantly; no inside lunges ever happen after long
straights. Focused calculation (not simulation) verified five mechanisms:

1. **Rubbing is the pack's pace killer.** `collideCars` damps both cars'
   full velocity every contact step at 120 Hz: even mostly-parallel
   grinding (normal ratio 0.02–0.05) costs 3.5–8.6% of speed per second
   of continuous contact — 1.8–4.3 m/s at racing speed against
   14.4 m/s² of drive. One or two cumulative contact-seconds per lap is
   the observed gap. The physics is correct and stays; the *pricing*
   that would make cars avoid it is what's missing.
2. **Zero-daylight planning is a certainty-equivalence hole.** Planned
   lines one body-width apart predict zero contact while relative
   execution error σ_rel ≈ 0.28 m makes them touch ~50% of the time.
   Touch probability: 0.2 m → 24%, 0.3 m → 14%, 0.4 m → 8%. The knee is
   ~0.3–0.4 m; a decreed 0.5 m would waste width on 12–13 m roads.
3. **The tyre-burn hypothesis is refuted.** Wear is
   `PACE_WEAR[pace]/lifeLaps` only; AI pace never changes; battles
   cannot burn tyres. Post-escape deficits have only weak carriers
   (stress decays within ~a lap; grind impulses 0.5–2 m/s are far below
   the hard-contact 16) — watch, don't fix.
4. **Attacks are free at initiation.** Horizon reach at 75 m/s is
   180 m; the braking zone is ~168 m: an attack launched on a long
   straight resolves entirely beyond the horizon — tow gain priced,
   corner contest invisible. Each failed attempt costs ~0.4–0.7 s
   (measured-class quantity), several per lap in a pack.
5. **The lunge is impossible at fixed effort.** From 70 m/s, leader at
   effort 0.82 to a 25 m/s apex: 168.1 m. A tow-boosted attacker
   (73 m/s) on the tighter line at the *same* effort needs 190.5 m —
   22.4 m earlier, always. At capability effort 0.96: 162.7 m — 5.4 m
   later. One degree of freedom flips the maneuver from impossible to
   routine.

### P-BE — Battle economics and emergent daylight

Implements the addendum's fixes. J's structure is untouched; it gains a
position-value/battle-spend term and two missing degrees of freedom.
Sequenced first inside the phase: the incremental β re-check, which is
the performance-critical path.

- **Publication identity needs no validity boundary — the incremental
  β re-check closes the trust-support blocker.** The P-CE audit proved
  no honest statistical boundary for "same publication" exists (E|e|
  rejects ~42% of valid samples; support bounds overclaim), and the
  conservative fallback collapsed the scheduler (311/316 revision
  breaks, 2 Tier-0 accepts, benchmark 1.15×). The resolution replaces
  the unanswerable question "is this the same publication?" with the
  answerable "does this divergence change any consumer's decision?" —
  the tie-band's jurisdiction. A point divergence still advances the
  revision, but a consumer holding a valid certificate first performs
  an **incremental re-check**: rebind only the affected hazard's
  binding quantities against the new point trajectory; if the
  candidate-minus-incumbent difference moves less than β, the
  certificate survives and no deliberation occurs. Full deliberation
  only when β is exhausted. This is the β-drift clause the P-S
  scheduler theorem was always missing; P-S may claim its theorem once
  it lands. Detection lives with the consumer, priced by β — no
  distributional claim anywhere.

- **Proximity: measured, and the measurement spoke.** The mandated
  parallel-hold measurement was run and **falsified the requesting
  analysis**: production lateral execution is deterministic and
  common-mode (no independent disturbance process), the contact rate at
  ≥ 0.25 m planned daylight is exactly zero, and sub-0.25 m counts are
  non-convergent launch transients. Therefore **no contact-rate tariff
  exists** — `proximitySeconds` stays absent by missing measured
  source (the correct stop-and-record outcome), and observed rubbing
  is transient/episodic: predicted transients are priced by the
  deterministic sweep + ℓgrind episodes; unpredicted ones are handled
  by divergence detection. The harness is retained: if lateral
  disturbance processes are ever added to physics (wake buffet,
  mistake jolts), re-measure and revisit. Visible daylight is
  therefore a **sporting quantity**: racing-room daylight = 0.15 m,
  declared sporting content (same source class as penalty rules),
  entering only through the agreement partition geometry (each car's
  corridor boundary sits half the daylight from the contact line) —
  never a cost term, never a clearance gate.
- **Position value, pace-weighted, opportunity-scoped.**

  ```
  V_ij = w(pace_i) · max(0, Δp̂_ij) · T_reopp / T0
  Δp̂_ij  = EWMA-measured pace differential vs rival j (s/lap), decay
           horizon = T_reopp
  T_reopp = measured mean time between passing opportunities (≈ one lap)
  T0      = derived ideal reference-lap duration (T_reopp/T0 = laps per
            opportunity, so V is honest seconds — unit repair recorded
            in the implementation report, accepted)
  w(save)=½, w(race)=1, w(push)=2 — declared strategy content: the pace
  setting's racecraft meaning, same source class as brakingPrudence
  ```

  Candidates that stay behind a slower rival carry +V as opportunity
  cost; attack candidates shed it and carry the battle spend:
  `B = ℓattempt (measured, ~0.4–0.7 s) + priced contest + proximity`.
  Attack iff the argmin says w·Δp̂·T_reopp beats B — push attacks on a
  ~0.3 s/lap edge, save needs ~1 s/lap. The scope is one opportunity
  (deferring a pass costs one T_reopp, not the race), which keeps V in
  honest seconds. Defense prices symmetrically with the rival's Δp̂
  sign. **Persistence self-limits with no cooldown**: failed attempts
  are pace evidence, Δp̂ shrinks, V shrinks, the battle ends.
- **Region-anchored contest evaluation.** The contest term of an attack
  candidate is evaluated at its contested region even when the region
  lies beyond the 2.4 s horizon — the horizon truncates geometry
  sampling, never the bill. (Addendum item 4.)
- **Effort as a candidate degree of freedom.** Attack/side candidates
  are evaluated at braking effort up to the physical maximum, priced
  through the existing utilization→mistake law; τ_x is computed at
  **capability** effort (τ is capability by definition); the attack
  rollout includes the tow on the tucked prefix so the arrival-speed
  surplus is visible to feasibility. (Addendum item 5.)
- One probe (once): grid pack scenario on Prado. Record: pack lap-time
  deficit to a clean-air leader (target: within ~1 s once rubbing and
  free attacks are priced), touches/lap and mean planned daylight
  (≥ the 0.15 m sporting racing-room under agreements; transient
  touches momentary), attacks/lap and completion rate (falls to
  economic levels; completed passes correlate with measured Δp̂), inside
  lunges after the two long straights (> 0 — the maneuver exists),
  budgets 6/0, and the J decomposition attributing candidate choices to
  V/B/proximity terms.

### P-R — Resolution profiles (after P-BE and the reopened gates)

Corollary 6's resolution category, turned into the product's performance
settings. A performance setting is a named point on the resolution
ladder; the convergence discipline is the guarantee that behavior stays
racecraft at every point. The formulas are already self-aware of their
resolution (slack subtracts the actual Δ_next; β widens with coarser
evaluation), so lower settings produce steadier, marginally more
conservative racing — a coherent driving style, never a degraded
simulation.

- **One `ResolutionProfile` record**, threaded through the existing
  config surfaces (`racecraftResolution()`, the `MANEUVER_PREDICTION`
  getter, the stagger modulus). Axes, each with an enumerated safe
  range:

  ```
  deliberationTicks   2 | 3 | 4 | 6     (Δt_d = n·Δt_c ceiling)
  stations, horizon   16/2.4 | 12/2.4 | 8/2.0
  candidateBudget     6 | 5 | 4         (drop lowest dominance-priority)
  hazardBudget        3 | 2             (nearest first)
  interactionRange    60 | 45 m
  sweepDensity        fine | coarse
  ```

  Presets (`quality` / `balanced` / `fast`) are named default vectors —
  **pure data**. Every axis is individually exposed: selecting a preset
  fills the vector; any axis may then be overridden (the settings
  surface offers preset + advanced per-axis toggles). A session records
  the exact resolved vector, not the preset name, so replays and
  parity are exact under overrides.
- **Presets are data, never predicates.** No branch anywhere may test a
  preset name or compare profile values for control flow beyond
  consuming them as numbers. Grep-level enforcement joins the module
  boundary checks.
- **Decision resolution only, never world physics.** Presets must not
  touch the physics step, tyre model, collision resolver, grip, or any
  world constant. The product reason is outcome comparability: a
  championship must be the same championship on every machine. The
  gate: `run-season-matrix` per preset — championship-level statistics
  (finishing distributions, lap-time spreads) must be statistically
  indistinguishable across presets. A preset that shifts season
  outcomes is rejected.
- **Determinism and parity**: profile fixed at session start; no
  mid-race switching. Parity fixtures pin `balanced`. An optional
  advisory governor may *suggest* a preset for the next session from
  the last session's measured realtime ratio — it never switches one
  mid-race.
- **The comparison instrument**: a per-preset headless report (and dev
  overlay) with realtime ratio, Tier-0 acceptance fraction,
  deliberations/s, per-subsystem time buckets, and the standard
  behavior metrics (attacks/lap, passes, touches, lap-time spread) —
  one table, presets side by side, so preset placement is decided by
  measurement.
- Probe (once per preset): the standard probe scene asserting the
  qualitative invariants (passes happen, lunges exist, no grinding,
  budgets hold, no new symptom class vs `quality`) and recording the
  quantitative deltas as the preset's documented character; plus the
  season-matrix comparability gate above.

**Approved future exception — the background race resolver.** Skipping
sessions and simulating seasons needs ~1000× real time, which no
resolution point can reach; that is a different fidelity *class* (no
trajectories — finishing order, gaps, pit outcomes, incidents, tyre
states). It is approved under the fidelity-class exception protocol
(Implementation contract) and is deliberately **not** part of P-R: it
is its own future phase/plan, calibrated from the full simulation by
measurement (pass probability vs measured Δp̂ per track, lap-time
distributions by tyre state and traffic, incident rates per
battle-second — `run-season-matrix` is the harness), with a CI
consistency test against full-sim distributions re-run whenever
racecraft changes.

## Implementation contract

- **Fidelity-class exceptions.** "Logic lives in one place for every
  performance configuration" may be broken only when all four hold:
  (1) the fork is a different fidelity *class*, not a cheaper version
  of the same class; (2) it is calibrated from the primary simulation
  by measurement, never authored; (3) a consistency test against the
  primary simulation's measured distributions runs in CI; (4) the
  exception is recorded here. Currently approved: the background race
  resolver (see P-R).

- **Zero new tuned constants** (governing principle 6). Sources allowed:
  physical, measured, sporting, character; resolution with the convergence
  test. The escape hatch is stop-and-record, never mint.
- **Delete, don't shadow.** Each authority named in a phase's deletion list
  dies in that phase. Tests encoding deleted semantics are deleted, not
  ported.
- **Budgets are hard:** candidates ≤ 6, materializations 0, cadences
  unchanged, benchmark floor as recorded.
- Per edit: typecheck + the touched test file. Per phase: the one probe,
  run once; record green or red with the owning phase; never tune against
  a probe or a seed.
- The user is the outer loop, in parallel: at each phase end `bun run
  build`, post a 3–5 line summary (what changed, what to watch while
  playing), continue immediately. Fold play-test feedback in when it
  arrives.
- Maintain `racecraft_cost_function_implementation_report.md`: P0
  reconciliation at top, per-phase entries (probe result, diff scope,
  deviations with reasoning), update the status table as phases land.
- If the plan and the tree conflict, resolve toward the governing
  principle and document the deviation.

## Status

| Phase | Status |
|---|---|
| P0 — Reconcile | complete |
| P-A — Free the lane | complete (probe red; recorded) |
| P-B — Claims become data | implemented (probe red; recorded) |
| P-C — The evaluator | implemented (probe mixed/red; recorded) |
| P-S — Interaction-density scaling | in progress (amended implementation green; recheck pending) |
| P-D — Residue, observers, tally | reopened (final gates pending P-S recheck) |
| P-CE — Certainty equivalence and contact dynamics | implemented (probe mixed/red; benchmark red and recorded) |
| P-BE — Battle economics and emergent daylight | in progress (measured proximity source blocked; recorded) |
| P-R — Resolution profiles | pending |

## Acceptance

- Solo lap times at the derived profile bound on all shipped tracks; zero
  brake/lift events outside profile deceleration zones; zero rear-loss on
  straights.
- A leader's line and speed are indistinguishable from its solo lap while a
  follower sits behind (within execution noise). Leaders never yield to
  trailing ghosts.
- A follower on strong tyres can sit at the derived equilibrium gap and
  attempt passes; passes complete; light contact occurs and is cheap; hard
  contact is absent.
- Side-by-side racing happens — on straights and **through corners**, each
  car on its own arc with its own apex, contest terms silent while the
  arcs don't overlap, the battle resolving where the arcs converge.
- When a true contest resolves, the conceding car predominantly changes
  trajectory rather than braking; grass excursions are rare, each
  attributable to a live hazard, and occur without hard contact.
- No persistent contact: light touches are momentary, separation follows
  immediately (ℓgrind pricing), and no pair grinds along the same line.
- Side-by-side pairs show visible daylight (the 0.15 m sporting
  racing-room through agreement partitions; the measurement proved no
  physical tariff exists — see the P-BE proximity record).
- Battles are economic: attack frequency tracks the measured pace
  differential and the pace setting (push attacks on small edges, save
  holds station); a bunched pack laps within ~1 s of a clean-air leader.
- Inside lunges after long straights exist as a working overtaking move:
  tow, late pull-out, capability-effort braking, apex arrival first.
- On-screen lines are smooth apex arcs — no scalloping, no staircase, no
  mid-corner flattening.
- Decision churn at the deliberation cadence, not above it; benchmark at
  its floor; all invariants zero; net lines deleted.
- Resolution presets ship as data with per-axis overrides; every preset
  passes the qualitative probe invariants and the season-matrix
  comparability gate; parity stays pinned to `balanced`.
