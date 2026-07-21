# Directional Racecraft Publication and Apex-Gated Corner Ownership

## Revised implementation plan for Golden Lap

Status: superseded historical design evidence for the rejected `adv` baseline.

Target repository: `mrauter1/goldenlap`

This file records the rejected `adv` design for racecraft planning,
arbitration, publication, ownership, decision cadence, battle economics
integration, and racecraft performance resolution. The prior
`superseded/racecraft_cost_function_plan.md` and its implementation report are
historical evidence only. They do not remain a second source of requirements.

The first directional implementation landed in commit `a605ebf`. It established
the main architecture: front-to-back directional planning, immutable
publications, direct ideal/direct follow modes, apex-gated ownership, strict
nominal-contact feasibility, the analytic `(s, v²)` speed-envelope core,
bounded reactive safety, and deletion of nested counterfactual response
search. This revision keeps those ideas and corrects the following integration
points:

1. Tactical publication, normal-follow recomposition, side/ownership state,
   and ownership validity all move to each car's assigned approximately 10 Hz
   decision slot. There is no 30 Hz tactical heartbeat.
2. Predictive reactive safety uses one implementation behind a session-fixed
   resolution setting: 30 Hz when enabled, 10 Hz when disabled. Disabling the
   faster setting never disables a check; it schedules the same check at
   10 Hz. The default is 10 Hz.
3. Hard racing room remains exactly `PHYS.carWid`. A continuous soft
   near-rub cost below `0.15 m` makes planned zero-daylight running
   unattractive without making legal space unavailable.
4. The implemented pace-weighted position value, measured attack-transition
   loss, capability braking effort, utilization risk, and tow-in-rollout
   survive. Ownership answers “may I?”; battle economics answers “is it worth
   it?”
5. The landed analytic speed envelope is retained. New or revised module
   interfaces use continuous progress/time quantities so later analytic
   lateral and conflict representations can replace sampled internals without
   changing arbitration semantics.
6. An immutable ownership assertion is publication evidence, not an
   irrevocable right. Every consumer derives a fresh, temporary ownership view
   at its decision slot; a mistake, lost conflict, hard infeasibility, or a
   defender's successful reclaim can remove ownership on that tick.
7. Near-rub exposure is billed separately per rival and connected alongside
   episode before the nonlinear measured grind-loss curve is applied.
8. Empty side envelopes and uncontrolled cars have explicit physical fallback
   contracts; neither condition may be hidden by deleting geometry or
   republishing stale tactical intent.

The implementation must follow `AGENTS.md`. Golden Lap is greenfield: delete
the superseded traffic-epoch renewal fields, off-slot authority mutation,
tests, counters, and comments with their replacements. Do not retain an old
30 Hz path as a compatibility mode.

## 1. Governing model

The decision layer treats current measured state and immutable published
trajectories as reality. It does not model probability distributions or
unobserved future choices. A car reacts to a new fact when its next assigned
decision slot arrives; no candidate simulates another car's future defense,
concession, abort, or re-aim.

The model has four distinct clocks:

```text
120 Hz physics:
  integrate bodies and resolve actual physical contact

60 Hz driver/control:
  execute the installed lateral and longitudinal authority

10 or 30 Hz predictive reactive safety:
  run one symmetric hard-contact prediction/veto pass and retain its result
  until the next pass

~10 Hz per-car staggered decision slot:
  observe, deliberate, compose normal following, publish, create/reclassify
  ownership, and acquire/release tactical side geometry
```

The existing 30 Hz traffic loop may continue to update non-authoritative
bookkeeping such as wake strength, timers, diagnostics, and pit traffic. It
may carry a pending-reason bit already raised by an exact engine event or a
scheduled pass, but it must not run a separate racecraft relation detector
solely to create earlier tactical knowledge. It must not publish a tactical
trajectory, mutate normal longitudinal authority, create/reclassify/remove
ownership, choose a line, or create an extra decision.

Decision cadence is a resolution contract, not a guaranteed minimum human
reaction delay. Because decision slots are staggered, a car may see another
car's publication anywhere from nearly immediately to one decision interval
later. The hard guarantee is one tactical decision per car per interval and
no same-tick recursive response.

## 2. Product behavior

For each car at its assigned decision slot:

1. Read current measured state and the latest immutable publications.
2. Advance consumed publications mathematically to the evaluation time; do
   not ask their owners to republish.
3. Apply uncontrolled, pit, fixed-obstacle, and physical-rule constraints.
4. If measured longitudinal body overlap or a live side constraint exists,
   run side-by-side constrained evaluation before any direct mode.
5. Otherwise, validate any published apex-ownership assertions targeting this
   car and evaluate one batched ownership response for the actionable views.
6. Otherwise, if there is no relevant forward occupancy, publish direct ideal.
7. If the car's free ideal program will not catch the forward publication,
   publish direct ideal.
8. If it will catch but no ordinary side trajectory can be committed before
   backward braking reachability binds, publish direct follow: ideal lateral
   line plus the fastest physically safe following-speed envelope.
9. If an attack might be executable, open the bounded evaluator. The full
   objective, including battle economics, decides attack versus follow.
10. Every normally selected trajectory with predicted swept-body contact is
    infeasible except an apex-entitled attack or the corresponding successful
    same-corner reclaim.
11. Publish the selected time-indexed trajectory once, then make it visible to
    followers processed later in the same ordered pass.
12. A leader ignores harmless rear cars. A rear car affects the leader only
    through an already-published assertion whose freshly validated view is
    apex-entitled/shared.
13. A leader may reclaim at its next assigned decision slot by physically
    reaching the same apex gate first. Otherwise it selects the fastest
    non-contacting result from the remaining feasible set.
14. The attacker never predicts the leader's response and never calculates a
    tactical abort. It reads whatever the leader later publishes at its own
    next decision slot.

Between decision slots, the installed authority remains authoritative.
Predictive reactive safety may temporarily veto throttle/apply braking, but
it cannot author a pass, concession, reclaim, ownership transfer, side
agreement, or publication.

## 3. Cadence and the user-selectable safety resolution

### 3.1 One strategic clock

The following operations occur only at the owning/consuming car's assigned
approximately 10 Hz decision slot:

- rebase and extend its tactical publication;
- compose or replace a direct-follow longitudinal envelope;
- open the opportunity/full evaluator;
- create, reclassify, or omit an outgoing ownership assertion;
- derive a current view from an incoming ownership assertion for use by the
  consumer;
- reclaim, concede, attack, follow, or select another lateral family;
- acquire/release tactical side geometry and consume its revision;
- clear or replace an installed tactical authority.

Exact engine events may set a bounded pending-reason bit earlier, but the bit
is only a notification latch, not a periodic 30 Hz racecraft detector. It
cannot change authority before the slot.

Delete `tightenDirectFollowOffSlot` and every equivalent path. A direct-follow
program installed at a decision slot must be backward-reachable and valid
through the next decision interval, including the declared staleness. An
unexpected leader deviation inside that interval is handled by the latest
reactive-safety snapshot; the normal follow law is recomposed at the
follower's next slot.

### 3.2 Predictive reactive-safety resolution

Extend the numerical resolution profile with:

```ts
export interface RacecraftResolution {
  stationSamples: number;
  reactiveSafetyIntervalTrafficTicks: 1 | 3;
}
```

`RacecraftResolution` is a value type, not mutable process-global runtime
authority. Resolve it before session creation, copy it into `SessionConfig`,
and store one frozen/readonly resolved value on `SessionBase`. Qualifying,
race, browser, and headless runtime code must read only the owning session's
value:

```ts
export interface SessionConfig {
  // ...other session inputs...
  racecraftResolution: Readonly<RacecraftResolution>;
}

export interface SessionBase {
  // ...other session state...
  readonly racecraftResolution: Readonly<RacecraftResolution>;
}
```

The exact field placement may follow the existing model layout, but the
state-ownership rule is mandatory: changing UI defaults or constructing
another session cannot change a running session. Delete the mutable global
`activeResolution` runtime path after callers migrate. A test override may
help construct a session with an explicit value; it must not mutate shared
authority underneath a live session.

`reactiveSafetyIntervalTrafficTicks` is consumed numerically:

```text
1 traffic tick  -> 30 Hz predictive reactive safety
3 traffic ticks -> 10 Hz predictive reactive safety
```

The default is `3`. Add a user-facing checkbox:

```text
[ ] High-frequency predictive racecraft safety (30 Hz)
```

- unchecked resolves to `3` and therefore 10 Hz;
- checked resolves to `1` and therefore 30 Hz;
- the setting applies to the next session and is fixed for that session;
- the session records the resolved numeric profile, not merely a preset name;
- headless sessions accept the same explicit resolved value;
- parity fixtures pin the default resolved profile.

This is a resolution axis, not two feature implementations. Presets may seed
the checkbox later, but no runtime code may branch on a preset name or an
“enabled” label. One function owns all predictive safety logic. The scheduler
calls it at the resolved interval and retains the resulting per-entry/pair
snapshot until the next scheduled call.

When the setting is unchecked, every check that would have run at 30 Hz still
runs at 10 Hz. There may be no fast-only collision predicate, reachability
bound, pair type, or cleanup operation. A structural test must prove that both
profiles execute the same named pass and differ only in invocation cadence.

The 120 Hz physical collision resolver, body integration, hard-contact
classification, and physical overlap response are outside this setting and
must remain unchanged. The checkbox controls anticipatory racecraft safety,
not world physics.

### 3.3 Safety snapshot semantics

Move `prepareRacecraftReactiveSafety` out of the per-physics-step call site.
At each scheduled safety pass:

1. sample actual active-body state once;
2. run the bounded symmetric pair pass;
3. create the next immutable/current safety snapshot;
4. atomically replace the prior snapshot;
5. let 60/120 Hz control read that snapshot without rescanning pairs.

The pass receives the resolved safety interval so its reachability math is
self-aware. A positive veto remains active until the next pass re-evaluates
it; a hazard appearing just after a pass waits until the next pass. This is
the intended, measurable resolution difference. No hidden timer compensates
for the selected cadence.

## 4. Publications are reality

### 4.1 Immutable time-indexed data

A publication is a time-indexed trajectory, not a sensor sample requiring a
heartbeat. Consumers call the existing evaluation-time advancement machinery
(`racecraftClaimAtEvaluationEpoch` or its representation-independent
successor) to read it at the current time.

At a car's decision slot:

- rebase/extend its horizon from current measured state;
- retain exact semantic identity where the publication contract permits;
- otherwise advance `publicationRevision`;
- insert the immutable result immediately into the ordered write map.

Off-slot cars retain their last immutable publication. They do not roll it
forward and republish at 30 Hz. A 2.4-second horizon updated every 0.1 seconds
has ample coverage; mathematical ageing supplies intermediate states.

Measured divergence from an installed authority is visible to safety from
actual state and to the decision layer at the next consuming car's slot. It
does not authorize an off-slot tactical rewrite.

### 4.2 Publication order

Maintain deterministic front-to-back planning components. On each traffic
epoch:

1. seed the write map from the last immutable map;
2. find entries whose decision slot is due;
3. process due entries head-to-tail inside their components;
4. replace and expose each due entry's publication immediately;
5. leave off-slot entries' publications unchanged;
6. commit the resulting map.

A due follower therefore reads a due leader's new publication when the leader
was processed earlier in the same ordered pass. If the leader is off-slot,
the follower reads its aged previous publication. A newly created rear
assertion never recursively reopens an already-processed leader.

### 4.3 Fresh occupancy for uncontrolled sources

An installed tactical publication stops being intent authority when its source
becomes uncontrolled, ballistic, spinning, or otherwise has tactical authority
revoked. Do not keep consuming that old authored line merely because its
publication revision is the latest one in the map.

At each consumer's decision slot, derive a temporary fixed/ballistic occupancy
projection for such a source from its current measured pose and motion using
the existing physical bounds. This projection:

- is safety/occupancy data, not a tactical publication;
- is local to the consuming evaluation and is never inserted into the
  publication map;
- carries no ownership assertion, line choice, concession, or publication
  revision;
- may constrain feasibility but cannot choose a maneuver.

The scheduled predictive-safety pass independently reads the uncontrolled
body's actual state when it samples the world. This preserves freshness at the
chosen 10/30 Hz safety resolution without creating an off-slot tactical
heartbeat. Actual body integration and contact remain 120 Hz.

## 5. Apex-gated corner ownership

### 5.1 Common gate and classification

Use the existing `Corner` gates:

- `brakeI` supplies physical braking context;
- `turnInI` begins the only region where apex entitlement may authorize a
  conflicting trajectory;
- `apexI` defines one common cross-track gate perpendicular to the reference
  tangent;
- `exitI` ends the ownership region.

For attacker `A`, leader `L`, and gate `G`:

```text
tA = A candidate's physically feasible continuous arrival time at G
tL = L publication's continuous arrival time at G
delta = tL - tA
```

The timing band is derived from decision/trajectory numerical resolution, not
from the optional 10/30 Hz safety setting and not from aggression:

- `delta > band`: attacker-owned;
- `abs(delta) <= band`: shared;
- `delta < -band`: leader-owned and a conflicting attack is infeasible.

The attacker must prove:

- its trajectory is feasible under actual grip, surface, steering, braking
  capability, candidate-selected effort, and speed;
- it can complete the authored corner through `exitI`;
- it targets the immediately relevant leader and corner;
- first swept-body conflict lies in `[turnInI, exitI]`;
- it reaches the common apex gate first or inside the shared band.

Capability effort and tow on the tucked prefix participate in the attack
rollout and apex arrival. A default/leader braking effort must not make a
physically possible lunge appear impossible.

The selected attacker trajectory plus its published assertion is the complete
authored fact. Do not add a separate contest proposal, reservation trajectory,
or conditional policy.

The attacker must not calculate leader observation time, concession
feasibility, likely response, or attacker abort availability.

### 5.2 Approach protection

Ownership is not retroactive:

- same-line rear contact before turn-in is infeasible;
- crossing the leader's swept approach body before turn-in is infeasible;
- future apex priority cannot force a straight-line or pre-turn-in lane
  change;
- a valid existing defensive publication remains reality.

A genuine dive moves into a clear side corridor, brakes within capability,
and creates its first intended conflict only from turn-in onward.

### 5.3 Assertions are immutable; ownership is revocable

Remove `validatedEpoch` from the ownership data, IDs, certificates, keys,
diagnostics, and tests. Rename the durable concept from a claim to a published
assertion so immutability cannot be mistaken for permanent entitlement.

A `RacecraftCornerOwnershipAssertion` is immutable only as evidence authored
by one attacker publication revision against one source-leader publication
revision. It means “this published trajectory established this classification
against that published trajectory when authored.” It is not an irrevocable
right, reservation, lock, or self-renewing state.

Suggested durable shape:

```ts
export interface RacecraftCornerOwnershipAssertion {
  assertionId: string;
  attackerCode: string;
  targetCode: string;
  cornerId: string;
  side: -1 | 1;
  authoredOutcome: 'attacker-owned' | 'shared';
  apexProgress: number;
  attackerPublicationRevision: number;
  sourceLeaderPublicationRevision: number;
  selectedPlanNumericId: number;
  selectedFamilyNumericId: number;
}
```

Construct `assertionId` deterministically from attacker/target codes,
attacker/source publication revisions, corner, plan, and family identities.
Do not include floating values, traffic epochs, or wall-clock time. Authored
relative apex/conflict times do not belong in the durable assertion because
they become stale as the publications age.

Every consumer decision derives a temporary current-time view:

```ts
export interface ValidatedCornerOwnership {
  assertionId: string;
  evaluatedAtSessionTimeSeconds: number;
  outcome: 'attacker-owned' | 'shared' | 'leader-owned' | 'inactive';
  attackerApexArrivalSessionTimeSeconds: number | null;
  leaderApexArrivalSessionTimeSeconds: number | null;
  firstConflict:
    | { sessionTimeSeconds: number; progressMetres: number }
    | null;
  reason:
    | 'current'
    | 'source-replaced'
    | 'attacker-diverged'
    | 'conflict-ended'
    | 'corner-ended'
    | 'hard-infeasible';
}
```

The exact discriminated-union layout may vary, but its lifetime and authority
may not: `ValidatedCornerOwnership` is consumer-local, computed once from
current measured state plus both publications aged to the evaluation time,
used during that decision, and then discarded. It is never published,
revisioned, renewed, or retained as next-tick authority. The evaluator must
consume this fresh view and must never treat authored relative timing evidence
as current.

An incoming assertion can produce an actionable attacker-owned/shared view
only when:

- the authoritative attacker publication carries that assertion;
- attacker publication revision and selected plan/family match;
- target and corner match;
- the current leader publication revision still equals
  `sourceLeaderPublicationRevision`;
- the attacker still follows/can physically complete the asserted program;
- the newly recomputed scoped conflict and apex entitlement still hold;
- the corner has not ended and hard feasibility has not revoked the
  interaction.

If the attacker makes a mistake, diverges from the asserted program, loses the
gate, becomes hard-infeasible, or loses the conflict, validation returns
leader-owned/inactive on that consumer tick. If the leader selects and
publishes a candidate that physically reclaims the common gate, that new
leader revision invalidates the old assertion immediately for later consumers.
The attacker may establish ownership again only by publishing a new assertion
revision at its next decision slot.

Concession, reclaim, selected-authority replacement, lost conflict, and corner
exit therefore make old evidence non-actionable without mutating it. No 30 Hz
removal pass is needed because no tactical consumer may act between decision
slots. Stale assertions are ignored diagnostically. Do not add a consumption
marker, last-resolved state, cooldown, or heartbeat replacement.

### 5.4 Scheduled ownership response

At the leader's next assigned decision slot:

1. derive one fresh `ValidatedCornerOwnership` for every incoming assertion;
2. sort them deterministically;
3. discard inactive/leader-owned views and evaluate the actionable views in
   one bounded evaluator invocation;
4. allow a candidate to retain a same-attacker/same-corner scoped conflict
   only if it physically reclaims the common apex outside the band;
5. otherwise require it to avoid contact with every attacker publication;
6. select the fastest valid result through the ordinary objective;
7. publish once and continue head-to-tail.

Near ties do not grant either car unrestricted use of the corner. Preferential
line value may remain, while measured body overlap activates the exact
one-width side constraint.

There is no classification hysteresis. Current ownership can change only when
a consumer decision slot observes a new publication, measured-state fact, or
feasibility result. A flip is therefore a legitimate re-evaluation, not a
30 Hz feedback loop. Keep an ownership-classification-flip counter as an
observable, not a failure gate or control mechanism.

## 6. Side-by-side geometry and the near-rub preference

### 6.1 Exact hard racing room

Measured side-by-side status begins when the oriented longitudinal body
predicate reports `clearance < 0`. Preserve every overlapping/live-agreement
counterpart; a three-wide middle car has two constraints.

On acquisition:

- preserve measured left/right lateral order;
- use the selected attack side only to break a numerical centre tie;
- use stable entry code only as the final storage tie-breaker;
- create persistent geometry independently of family certification;
- constrain each car to leave exactly one usable `PHYS.carWid` on the occupied
  side.

The first participating car whose decision slot observes acquisition/release
commits the shared pair record once. That may set a pending reason for the
counterpart, but the counterpart retains its installed authority until its own
slot. Predictive safety bridges the interval without choosing side geometry.

For separator `etaS`, lower/upper centres, and `W = PHYS.carWid`:

```text
etaLower <= etaS - W / 2
etaUpper >= etaS + W / 2
etaUpper - etaLower >= W
```

Intersect those inequalities with the ordinary drivable centre envelope.
Never widen the hard constraint to `carWid + 0.15`, collapse an infeasible
intersection onto the separator, or silently reduce `W`.

The side constraint filters feasibility only. It must not choose a line,
braking response, lift, tuck, or concession. Family certification may prove
that a trajectory fits; certification failure must not delete the geometry or
enable a direct mode.

If the exact side-constrained drivable envelope is empty at a decision slot:

1. retain the side agreement and its measured left/right order;
2. keep the full `PHYS.carWid` separator constraint;
3. disable direct ideal and direct follow for that evaluation;
4. return an explicit no-feasible-tactical-candidate result and materialize no
   replacement path;
5. latch `AuthorityInfeasible` for the next assigned decision slot;
6. until then, use only the existing bounded emergency/reactive-safety
   authority: throttle veto/braking and protected physical-overlap corridors,
   never a newly chosen tactical line.

Never respond to an empty intersection by deleting the agreement, reducing
body width, collapsing both cars onto the separator, or fabricating a
concession. The next decision evaluates the current measured geometry again.

Release at `clearance >= 0`, using the same measured predicate everywhere.
Add no hysteresis.

### 6.2 Soft proximity cost below 0.15 m

The legal boundary remains exact body-edge contact. Add one declared sporting
preference:

```text
D = 0.15 m
E(c, r) = maximal connected alongside episodes between candidate c and rival r
g(c, r, t) = signed lateral body-edge gap during one episode
w(g) = max(0, 1 - max(0, g) / D)
T_equivalent(c, r, e) = integral over episode e of w(g(c, r, t)) dt
J_proximity(c) = sum over rivals r and episodes e in E(c, r) of
                 L_grind(T_equivalent(c, r, e))
```

`L_grind` is the existing measured sustained light-contact loss curve. The
linear exposure ramp is declared sporting policy, not falsely described as a
measured contact probability. Its endpoints are honest:

- at `g >= 0.15 m`, the preference is zero;
- at body-edge contact, one second counts as one contact-equivalent second;
- between them, pressure increases continuously as daylight disappears.

This has the intended behavior:

- no discontinuity at `0.15 m`;
- a brief tight crossing costs very little;
- persistent planned rubbing costs increasingly;
- legal zero-daylight remains feasible when the track or fight requires it;
- the argmin normally leaves some visible air when the time cost is small.

Apply the cost once to every candidate with predicted alongside exposure,
regardless of whether it is labelled attack, defense, or shared. Apply the
nonlinear measured curve separately to each rival and each maximal connected
episode. Do not concatenate distinct rivals or episodes into one equivalent
duration before applying `L_grind`; the existing contact-loss contract treats
connected episodes independently.

This preference models sustained near-rub exposure, not an impact. Do not add
the contact model's initial-strike bill when an episode begins. Sum the
resulting scalar once into `J`; `battleSpendSeconds` reports that same scalar
as a decomposition diagnostic and must not add it to `J` again. The detailed
horizon keeps each episode duration inside the measured grind curve's support;
if a future representation can exceed that support, extend the measurement
before extrapolating.

Register `nearRubClearanceMetres = 0.15` as an explicit sporting-policy
quantity in the racecraft configuration definitions with unit, bounds,
rationale, and owner. Do not restore
`SPORTING_RACING_ROOM_DAYLIGHT_METRES`; there is no hard daylight widening.

## 7. Deliberate-mode objective and battle economics

Ownership and economics are separate:

```text
ownership / physical rules: which candidates are feasible?
battle economics:          which feasible candidate is worth selecting?
```

For every deliberate evaluation preserve the implemented honest-seconds
decomposition:

```text
J(c) =
  own trajectory time
  + physical/rule bills not already present in own time
  + utilization/mistake exposure
  + J_proximity
  + strategic economic term

stay-behind strategic term = V
attack strategic term      = measured attack-transition loss
                             + separately measured contest loss

V = w(pace) * max(0, measuredPaceDifferential) *
    reopportunitySeconds / referenceLapSeconds

B (diagnostic battle spend) =
    measured attack-transition loss
    + J_proximity
    + separately measured, non-duplicated contest loss
```

The existing pace weights, EWMA pace evidence, reopportunity measurement,
reference-lap normalization, and self-limiting evidence loop survive. A failed
attack changes pace evidence; no cooldown or sticky attack intent is added.

The existing measured attack-transition loss applies only when entering a new
attack family, not on every 10 Hz record while continuing it.

There is no counterfactual response `Q`, hypothetical concession price, or
future-abort cost. At present a contest term without a separate measured,
non-duplicated source is zero. Do not resurrect deleted response simulation
under the name “battle spend.”

Attack/side families retain braking effort as a candidate degree of freedom up
to physical capability. Effort is priced through the existing utilization
mistake law. The opportunity screen, terminal feasibility, and apex arrival
must use capability effort and include tow on the aligned prefix.

## 8. “Cannot pass,” direct follow, and horizon

“Cannot pass” means:

> No ordinary physically executable side trajectory can establish lateral
> clearance for longitudinal overlap before the follower's backward-reachable
> braking constraint binds.

It does not mean the pass fails to finish inside the prediction horizon. The
result creates no timer, cooldown, sticky follow intent, or long-lived state.

A direct-follow publication has:

```text
lateral authority: ideal racing line
speed authority:   min(own ideal envelope, leader-safe envelope)
```

The leader-safe envelope uses `PHYS.carLen`, oriented body projection,
physical divergence allowance, actual grip/curvature/downforce/surface,
candidate braking effort, leader publication, and tow while aligned. It has no
comfort gap, time gap, follow cap, or speed leash.

Keep the 2.4-second detailed horizon unless convergence evidence changes it.
The horizon answers binding, side acquisition, apex entitlement, first
conflict, and immediate viability. It need not contain pass completion.
Authored terminal continuation may prove completion through a relevant
apex/exit without simulating another driver's future choice.

The opportunity gate is conservative in favor of racing: uncertainty opens
the evaluator.

### 8.1 Opportunity-gate algorithm

At a due decision slot, classify in this order:

1. uncontrolled/pit/fixed physical authority;
2. every measured-overlap/live-side constraint;
3. every actionable incoming validated ownership view;
4. ordinary forward opportunity.

For ordinary forward opportunity:

1. build the cheap unconstrained ideal projection;
2. find the nearest publication that can occupy the available corridor;
3. compose the leader-constrained analytic speed envelope;
4. if it never lowers the free envelope, return direct ideal;
5. otherwise record the first backward-reachability binding progress/time;
6. screen ordinary inside/outside acquisition using physical lateral motion,
   surface legality, capability effort, and available corridor;
7. if both sides are proved unavailable, return direct follow;
8. if either side is viable or uncertain, open deliberate evaluation.

The screen may produce false positives. It must not suppress a viable attack.
Measured-overlap/live-side counterparts remain geometry/safety hazards but are
excluded from direct-follow and slow-point ownership. After those exclusions,
a third car may become the real forward occupancy.

## 9. Strict nominal-contact rule

For controlled cars, predicted swept-body contact makes a candidate
infeasible except:

1. an attacker-owned/shared candidate satisfying the exact
   apex/turn-in/exit rule; or
2. the leader's successful reclaim against that same attacker and corner.

Every other nominal contact is infeasible, including approach rear contact,
pre-turn-in lateral crossing, losing-apex conflict, unrelated-car conflict,
and a trajectory unable to complete the corner.

Actual physical contact, uncontrolled/ballistic cars, and unavoidable
emergency behavior remain physics/safety cases. A knowingly colliding
ordinary candidate may never remain selectable because another hypothetical
candidate might rescue it later.

## 10. Architecture

### 10.1 Three explicit graphs

1. **Physical safety graph — symmetric**
   - actual/predicted hard-closing body pairs;
   - fixed/uncontrolled occupancy;
   - pit physical conflicts;
   - protected overlap corridors.
   - sampled by the resolved 10/30 Hz predictive-safety pass where applicable;
     actual collision physics remains 120 Hz.

2. **Forward planning graph — directional**
   - `leader -> follower` when the follower must consume the leader
     publication;
   - normally nearest binding forward occupancy per available corridor;
   - a second occupancy when the immediate car vacates the corridor;
   - sporting obligations explicitly;
   - never a measured-overlap/live-side counterpart as mutual follow
     authority.

3. **Corner-ownership graph — exceptional reverse awareness**
   - `attacker -> leader` only for an actionable freshly validated published
     apex assertion;
   - evaluated only at the leader's decision slot;
   - never created merely because a rear car is nearby.

Use distinct types and APIs. Safety graph membership must never feed tactical
candidate generation implicitly.

### 10.2 Planning order

Build bounded local components from physical track adjacency and process
heads to tails:

- use wrapped track position for adjacency;
- use total progress/lap state where race order matters;
- rotate across the largest valid seam gap;
- use stable code only as a deterministic non-sporting tie-breaker;
- use an explicit deterministic fallback for a closed component;
- preserve blue flags, qualifying priority, pit rules, fixed obstacles, and
  uncontrolled overrides.

### 10.3 Multi-car trains

Do not assume rank adjacency is always the binding forward dependency:

- when middle car B pulls out, rear car C may read front car A;
- scan remains bounded by 60 m traffic / 160 m obstacles;
- only nearest binding occupancy per corridor supplies normal following;
- additional occupancies remain bounded safety hazards;
- a side-by-side pair follows neither counterpart but may each read a third
  forward car;
- a three-wide middle car intersects both side constraints without multiplying
  the candidate budget.

## 11. Representation and module interfaces

The analytic `(s, v²)` speed-envelope core in `src/core/speed-envelope.ts` is
landed architecture and must not be reverted to station-sampled longitudinal
authority. `longitudinal-program.ts` remains the single composer for direct
and evaluated speed laws.

All cross-module signatures speak continuous domain quantities:

```text
progress metres
time seconds
speed
lateral offset
trajectory/publication identity
```

Station indices, sample slots, typed-array offsets, and buffer positions are
private implementation details. In particular:

- longitudinal APIs expose `speedAt(progress)`, binding progress/time, and
  envelope composition—not “binding station” as authority;
- ownership APIs expose continuous gate crossing and first conflict—not
  nearest station comparisons;
- publication consumers request state at time/progress;
- arbitration never depends on whether a trajectory is currently sampled,
  segmented, or analytic.

Sequence remaining analytic work after the cadence/ownership/objective
corrections:

1. retain and verify the landed speed-envelope representation;
2. replace continuous-conflict sampled sweeps with segment-pair intersection,
   verified against the current sweep before deletion;
3. represent lateral programs as short analytic segment lists;
4. publish those segments directly and delete sampled trajectory/publication
   stations;
5. let control read analytic lateral authority and delete the lane buffer;
6. consolidate surviving arbitration code only after behavior is green.

This resumes the useful P-X direction without carrying the old plan's
superseded snapshot, recourse, beta-recheck, or responsibility machinery.
The prior P-X resource-kill record remains historical evidence, not a reason
to undo the landed speed envelope or a gate that blocks this revised sequence.

## 12. Data-model changes

Required changes:

- remove `validatedEpoch` and epoch-renewal identity from
  the retired `RacecraftCornerOwnershipClaim`;
- replace that durable type with `RacecraftCornerOwnershipAssertion` and keep
  current-time `ValidatedCornerOwnership` consumer-local;
- add the resolved `RacecraftResolution`, including
  `reactiveSafetyIntervalTrafficTicks`, to `SessionConfig` and immutable
  session state; delete mutable process-global runtime authority;
- store the latest immutable predictive-safety snapshot/generation on the
  session and bounded per-entry contributors;
- add `nearRubClearanceMetres` to the registered sporting-policy surface;
- keep bounded pending-reason bits for next-slot work;
- keep publication and selected plan/family revisions as assertion provenance;
- keep direct modes free of standing all-candidate argmin snapshots.

Suggested pending reasons remain:

```ts
export const enum RacecraftPendingDecisionReason {
  SideGeometry = 1 << 0,
  Ownership = 1 << 1,
  ForwardPublication = 1 << 2,
  Obligation = 1 << 3,
  AuthorityInfeasible = 1 << 4,
  NormalExpiry = 1 << 5
}
```

Pending reasons are current bounded state, not a history. Multiple changes
coalesce into one next-slot evaluation.

Add/update bounded diagnostics:

- publications authored per car and off-slot publication attempts;
- ownership assertions created/reclassified/omitted at decision slots;
- validated ownership outcomes/reasons and stale assertions ignored;
- ownership classification flips;
- maximum ownership wait to leader decision;
- direct ideal/direct follow/full deliberation counts;
- off-cadence tactical authority mutations, required zero;
- off-slot normal-follow recompositions, required zero;
- reactive-safety pass invocations by resolved interval;
- reactive-safety interventions and maximum pairs per pass;
- physics-step predictive-safety scans, required zero;
- near-rub equivalent duration and cost by bounded rival/connected episode;
- selected candidates inside `<0.15 m` and at exact legal width;
- battle objective decomposition;
- nested response-program evaluations, required zero;
- candidate/materialization maxima.

Do not retain the old renewal counters under new names.

## 13. Implementation phases and single master status

| Phase | Status |
|---|---|
| D0 — Directional base, direct modes, apex ownership, analytic speed envelope, nested-response deletion | landed in `a605ebf`; cadence details superseded by this revision |
| R0 — Documentation/data-contract reconciliation | specification complete; code/docs pending |
| R1 — Decision-slot publication and assertion-derived ownership | pending |
| R2 — 10/30 Hz predictive-safety resolution and UI checkbox | pending |
| R3 — Near-rub cost and explicit battle-objective integration | pending |
| R4a — Analytic continuous-conflict internals | pending after R1–R3 |
| R4b — Analytic lateral segment programs | pending after R4a |
| R4c — Direct segment publication and sampled-publication deletion | pending after R4b |
| R4d — Analytic controller consumption and lane-buffer deletion | pending after R4c |
| R4e — Surviving arbitration consolidation | pending after R4d |
| R5 — Deletion, focused verification, performance comparison, playable build | pending |

This table is the only active racecraft implementation status. Do not update a
second table in a superseded document.

### Phase R0 — reconcile authority and observability

1. Update `AGENTS.md` runtime language:
   - tactics/publications/ownership/normal follow are approximately 10 Hz;
   - predictive reactive safety is a session-fixed 10/30 Hz resolution axis;
   - actual collision physics remains 120 Hz.
2. Record this plan as the only active racecraft implementation authority.
3. Replace traffic-epoch renewal counters with the diagnostics in Section 12.
4. Add the resolved safety interval to headless/session summaries.
5. Do not change behavior in the instrumentation/documentation commit.

### Phase R1 — one tactical clock

1. Publish/rebase an entry only at its assigned decision slot.
2. Preserve off-slot immutable publications/assertions and age their referenced
   trajectories on read.
3. Replace the retired durable claim type with the immutable assertion plus
   temporary validated-view contract from Section 5.3.
4. Remove `validatedEpoch`, renewal/revalidation passes, and renewal keys.
5. Derive incoming ownership at the consumer's decision slot using current
   measured state, publication revisions, and freshly recomputed aged
   conflict/entitlement; never consume authored relative times.
6. Make attacker error/hard infeasibility and a successful defender reclaim
   revoke the old assertion's authority on the next consuming decision.
7. Build temporary current-state occupancy for uncontrolled sources; do not
   consume their stale tactical publication as intent.
8. Remove `tightenDirectFollowOffSlot` and every off-slot normal-authority
   mutation.
9. Make direct-follow envelopes safe through the decision interval.
10. Move tactical side acquisition/release and mode routing to decision-slot
   consumption; safety may only latch a pending reason.
11. Preserve front-to-back visibility for due entries and prohibit recursion.
12. Batch multiple actionable ownership views against one leader into one
    due-slot evaluator call.
13. Implement the explicit empty-side-envelope result without weakening or
    deleting the agreement.
14. Delete stale tests/comments requiring every-entry traffic-tick
    publication or prior-epoch renewal.

### Phase R2 — predictive-safety resolution setting

1. Extend the resolution value type and require the resolved value in session
   construction/state.
2. Move predictive-safety preparation out of the physics-step loop.
3. Schedule the one shared pass every one or three traffic ticks.
4. Retain one immutable/current result between passes.
5. Keep the physical collision resolver and overlap physics at 120 Hz.
6. Add the pre-session checkbox and thread its resolved value into qualifying,
   races, headless runs, and parity metadata.
7. Apply changes only to newly created sessions.
8. Verify every named safety predicate runs in both modes.
9. Add no fast-only helper, fallback, or behavior branch.
10. Delete mutable global runtime resolution; tests and tools construct
    sessions with explicit profiles.

### Phase R3 — near-rub economics and preserved battle value

1. Add the registered `0.15 m` sporting threshold.
2. Compute continuous body-edge gap only during predicted alongside time in
   the existing bounded hazard/conflict work.
3. Split exposure by rival and maximal connected alongside episode.
4. Convert each episode's ramp-weighted duration independently through the
   measured sustained grind-loss curve, without an initial-strike bill.
5. Sum the episode costs once into the candidate objective and report the same
   scalar in diagnostic battle spend without adding it again.
6. Keep the hard separator at exactly `PHYS.carWid`.
7. Reassert the pace-weighted position value, measured attack-transition
   loss, evidence loop, capability effort, utilization risk, and tow rollout.
8. Ensure ownership classification never replaces attack-vs-follow economics.
9. Ensure no deleted counterfactual contest/response term returns.

### Phases R4a–R4e — analytic-ready continuation

Each subphase is independently attributable and closes with touched tests
before the next representation changes:

1. **R4a — conflict:** make the revised ownership/publication/longitudinal APIs
   representation-independent, preserve the landed analytic speed envelope,
   and replace sampled continuous-conflict sweeps with verified segment-pair
   intersection.
2. **R4b — lateral programs:** represent lateral authority as bounded analytic
   segment lists while preserving evaluator behavior.
3. **R4c — publication:** publish analytic segments directly, migrate
   consumers, and delete sampled trajectory/publication stations.
4. **R4d — control:** make control consume analytic lateral authority and
   delete the lane buffer.
5. **R4e — consolidation:** remove surviving sampled/arbitration scaffolding
   only after the behavior and performance evidence is green.

Do not begin R4a before R1–R3 are green. Delete each sampled internal in the
same subphase as its proven replacement. Do not change ownership, objective,
or cadence semantics to make an optimization pass.

### Phase R5 — deletion and evidence

1. Delete superseded epoch-renewal fields, off-slot tightening, counters,
   tests, and comments.
2. Delete any remaining all-program incremental beta recheck or nested
   tactical response residue if reachable.
3. Run touched unit tests and one focused causal probe while iterating.
4. At coherent phase completion, run `verify:fast`.
5. Run one benchmark comparison covering both resolved safety rates because a
   hot loop moved; each profile must independently meet the performance floor.
6. Build the browser artifact.
7. Because UI is implicated, run only the browser smoke check needed to prove
   the checkbox is visible, persists into the next session, and reports the
   resolved value.

## 14. Required focused tests

### Decision cadence and publication

1. Each active controlled entry authors at most one tactical publication in
   its assigned three-traffic-tick interval.
2. An off-slot entry retains object/revision identity and consumers age it to
   their evaluation time.
3. A due follower sees a due leader's earlier same-pass publication.
4. A rear publication never recursively reopens an already-processed leader.
5. Forward, side, obligation, authority, and ownership changes coalesce into
   one next-slot evaluation.
6. No off-slot direct-follow recomposition or lateral authority change occurs.
7. A direct-follow envelope remains safe until the next slot under the
   declared reachability assumptions.
8. Start-line seam and entry-array permutation remain deterministic.
9. An uncontrolled source is represented from current measured occupancy at
   the consumer slot; its stale tactical line is not consumed or republished.

### Ownership

1. Continuous common-gate crossing is stable under sampled refinement.
2. Earlier feasible attacker plus first conflict after turn-in produces
   attacker-owned/shared.
3. Pre-turn-in rear/crossing conflict is infeasible regardless of apex time.
4. Losing the gate or failing corner completion is infeasible.
5. Assertion identity contains semantic revisions and no epoch heartbeat.
6. An unchanged publication pair remains actionable across intervening
   traffic ticks without renewal.
7. Durable assertions contain provenance, not relative timing values consumed
   as current authority.
8. Validation recomputes apex times, first conflict, and outcome from current
   measured state plus aged publications on every consumer decision.
9. A source-leader revision mismatch makes the old assertion inactive without
   mutating it.
10. Attacker divergence/mistake or hard infeasibility revokes the validated
    ownership view at the next consumer decision.
11. A successful defender reclaim publishes a new revision and makes the prior
    assertion non-actionable for later consumers.
12. A failed reclaim remains infeasible; changing revision cannot erase
    ownership without a non-contacting concession or physical reclaim.
13. Concession, lost conflict, lost entitlement, and corner exit are observed
    at the next consumer decision without a 30 Hz removal pass.
14. The leader responds at most once per assigned slot and batches all
    actionable views.
15. The attacker performs no leader-response/abort calculation.
16. Classification flips are counted but do not trigger hysteresis.

### Predictive safety profiles

1. The 30 Hz profile invokes the shared pass once per traffic tick.
2. The 10 Hz profile invokes the same pass once per three traffic ticks.
3. The latest safety result remains authoritative between invocations.
4. Every registered safety predicate/pair type is exercised in both modes.
5. Predictive pair scanning does not occur in the physics-step loop.
6. Actual collisions are still resolved at every physics step in both modes.
7. Safety never changes publication, ownership, decision mode, or lateral
   family.
8. The checkbox affects only a newly created session and the session records
   the numeric value.
9. Identical seed/profile combinations remain deterministic.
10. Creating or changing another session/profile cannot alter a running
    session's resolved safety cadence.
11. Runtime safety and planning code never reads mutable process-global
    resolution authority.

### Side-by-side and proximity

1. Hard centre separation is exactly at least `PHYS.carWid`; `0.15 m` never
   widens the feasible envelope.
2. Family-certification failure preserves measured geometry.
3. Side counterparts are never mutual direct-follow targets.
4. Three-wide geometry intersects both separators.
5. Proximity cost is zero at and above `0.15 m`.
6. Proximity cost is continuous and monotone below `0.15 m`.
7. One second at exact body-edge contact maps to one contact-equivalent second
   before applying the measured grind curve.
8. A brief near-rub costs less than persistent near-rub.
9. Two rivals and two disconnected episodes are each passed separately
   through `L_grind`; their durations are not concatenated before the
   nonlinear curve.
10. Starting a near-rub episode adds no initial-contact strike bill.
11. The term is charged once and visible as the same scalar in the objective
    and battle-spend decomposition.
12. An empty exact side envelope retains geometry and width, disables direct
    modes, materializes no tactical replacement, and enters only bounded
    emergency/reactive safety until the next slot.
13. `clearance >= 0` releases tactical side geometry with no hysteresis.

### Battle objective

1. Stay-behind candidates carry position opportunity value when the measured
   pace differential is positive.
2. A new attack family carries measured transition loss; continuation does
   not repay it every slot.
3. Capability effort can make a physically possible late-braking attack
   feasible and is priced by utilization risk.
4. Tow on the tucked prefix affects arrival feasibility.
5. Ownership alone cannot make an uneconomic attack win.
6. No response-program, residual-hazard, or hypothetical concession term is
   evaluated.

### Hard budgets

1. Maneuver candidates remain at most six.
2. Materialized paths remain at most one.
3. No unbounded assertion, validation, safety, or decision history is
   introduced.
4. Off-cadence tactical mutations are exactly zero.
5. Nested response-program evaluations are exactly zero.

## 15. Focused scenarios and comparison evidence

Retain the causal scenes already provided by the directional implementation:

- `attack-launch`;
- `faster-behind`;
- `switchback`;
- `side-by-side-corner`;
- `apex-owned-divebomb`;
- `apex-reclaim`;
- `persistent-apex-claim`;
- `concession-clears-claim`;
- `pre-turn-in-cut`;
- `near-tie-room`;
- `side-by-side-order-swap`;
- `three-wide`;
- `two-wide-third-car`;
- `train-no-ownership-claim`;
- `feint-no-conflict`;
- `empty-side-envelope`;
- `uncontrolled-spin-occupancy`.

Update ownership scenes to assert immutable revision-keyed publication
evidence plus fresh consumer-local validation rather than traffic-epoch
renewal. Add explicit attacker-mistake and defender-reclaim cases that prove
the authored assertion remains unchanged while its current authority is lost.

Add one profile comparison harness that runs the same seed/scenario set with:

```text
reactiveSafetyIntervalTrafficTicks = 1
reactiveSafetyIntervalTrafficTicks = 3
```

Record in one report:

- actual predictive-safety pass count and pair checks;
- interventions and duration held active;
- hard/light contacts and maximum closing impulse;
- attack, pass, side-by-side, and near-rub exposure;
- lap time and battle loss;
- evaluator/candidate/materialization counts;
- wall time/realtime ratio and subsystem attribution;
- pinned-baseline percentage for each resolved profile;
- deterministic checksum per resolved profile.

The two profiles are allowed to differ in anticipatory interventions and
light-rubbing outcomes; that is the resolution choice being exposed. Both
must preserve physical invariants, deterministic replay under the same
profile, candidate/materialization budgets, and the qualitative ability to
race/pass. Each profile must independently meet the benchmark floor; a fast
10 Hz result cannot average away a failing 30 Hz result. Do not tune either
profile against one seed.

## 16. Performance acceptance

The structural contract is:

> Tactical work scales with assigned decision slots and executable attacks,
> not with every physics step, traffic heartbeat, rear car, hypothetical
> response, or residual hazard. Predictive safety runs once at the selected
> 10/30 Hz resolution through one shared bounded implementation.

Acceptance requires:

1. zero tactical publications and normal-follow mutations off-slot;
2. zero ownership heartbeat work;
3. zero predictive pair scans at 120 Hz;
4. approximately three times as many predictive-safety passes at the 30 Hz
   setting as the 10 Hz setting over equal simulated time;
5. no missing safety predicate in the 10 Hz setting;
6. clean-air leaders and non-closing followers perform zero full
   deliberations after setup;
7. blocked followers with no viable side use direct follow without lateral
   candidate evaluation;
8. harmless rear cars create no leader deliberation;
9. ownership creates at most one batched leader deliberation per assigned
   slot;
10. response-program and nested residual-hazard evaluation remain zero;
11. candidate/materialization hard limits remain green;
12. `bun run benchmark:sim` remains at least 80% of the frozen pinned-CPU
    baseline for the 10 Hz and 30 Hz resolved profiles independently.

If either benchmark profile is red, optimize the measured surviving hot path.
Do not restore 30 Hz publication, skip safety predicates in the 10 Hz setting,
or change behavior through an unlabelled approximation.

## 17. Behavioral acceptance

The implementation is acceptable when:

- publications, ownership, side-state decisions, and normal following change
  only at assigned decision slots;
- consumers correctly age immutable publications between those slots;
- the optional 30 Hz safety setting adds observation opportunities without
  creating a second tactical reaction channel;
- unchecked 10 Hz safety still runs every safety check, only less often;
- actual collision physics remains continuous at the physics cadence;
- direct follow uses ideal lateral authority and binds only through physical
  backward reachability;
- viable attacks open deliberation before following destroys the opportunity;
- battle frequency responds to measured pace advantage and pace mode;
- capability effort and tow allow legitimate late-braking lunges;
- apex entitlement changes feasibility but never bypasses attack economics;
- leaders ignore harmless rear cars and respond only to actionable freshly
  validated apex assertions;
- an authored assertion is immutable evidence while current ownership can be
  lost at the next consumer tick through attacker error, infeasibility, lost
  conflict, or a physical defender reclaim;
- the attacker never simulates the leader's future choice;
- ordinary predicted contact is infeasible;
- exact `PHYS.carWid` racing room remains available;
- the soft sub-`0.15 m` term normally prevents persistent zero-daylight
  optimization without forbidding a necessary squeeze;
- side agreements constrain geometry but do not prescribe behavior;
- empty side envelopes preserve the agreement and invoke only bounded
  emergency/reactive safety until the next decision;
- uncontrolled cars constrain consumers through fresh measured occupancy, not
  stale tactical publications;
- multi-car trains and three-wide cases remain bounded and deterministic;
- light rubbing may occur, hard-contact policy and zero-tolerance invariants
  remain intact.

Population outcomes remain governed by the repository metric policy. The
profile comparison documents intended resolution differences; it may not
silently redefine pass/contact policy bands.

## 18. Verification order

For each implementation phase, follow `AGENTS.md` and run only touched tests:

```sh
bun run typecheck
bun run check:boundaries
bun test tests/unit/session/traffic.test.ts
bun test tests/unit/session/corner-ownership.test.ts
bun test tests/unit/session/reactive-safety.test.ts
bun test tests/unit/session/evaluator.test.ts
```

Use the directly relevant subset for smaller edits.

Because step ordering and session-fixed resolution affect determinism, run the
headless parity check once after those surfaces are coherent and deliberately
re-record fixtures if the approved default change requires it.

At final handoff:

```sh
bun run verify:fast
bun run benchmark:sim
bun run build
```

Run the benchmark harness once per resolved safety profile and report both
results independently against the pinned baseline.

Run the minimal browser smoke check for the new UI setting after the build.
Do not run the full merge/release suite unless requested.

## 19. Deletion and documentation checklist

Delete:

- traffic-epoch ownership renewal/revalidation;
- `validatedEpoch` and all keys/tests/counters derived from it;
- the durable `RacecraftCornerOwnershipClaim` shape and any authored relative
  timing fields consumed as live ownership;
- mutable process-global `activeResolution` runtime authority;
- off-slot direct-follow tightening/recomposition;
- every-entry 30 Hz tactical republishing;
- 120 Hz predictive-safety pair scanning;
- 30 Hz tactical side/ownership routing that mutates authority;
- any hard `0.15 m` racing-room widening;
- any duplicate charge of the new proximity term;
- nested counterfactual response/residual-hazard machinery;
- all-program incremental beta recheck if any residue remains;
- tests/comments asserting old snapshot/heartbeat behavior.

Update:

- `AGENTS.md` runtime cadence contract;
- `src/session/racecraft/config.ts` resolution and sporting definitions;
- session creation/config and headless options;
- the pre-session UI/settings surface;
- headless summaries and bounded diagnostics;
- module comments around assertions/current ownership views, scheduling,
  safety, and publication.

Do not edit superseded plans to make them appear current. Their historical
records stay intact. This file and its status table own all remaining work.

## 20. Codex handoff prompt

> Implement the pending phases of
> `racecraft_directional_planning_implementation_plan.md`. Read `AGENTS.md`
> first and treat this root plan as the sole active racecraft authority.
> Preserve the landed directional architecture, apex-gated ownership, direct
> modes, battle economics, analytic speed envelope, strict ordinary
> nominal-contact veto, and deletion of counterfactual response search. Make
> each car's assigned approximately 10 Hz slot the only clock that can publish,
> compose normal following, acquire/release tactical side state, or
> create/reclassify/consume ownership. Age immutable publications on read;
> remove `validatedEpoch`, traffic-heartbeat renewal, every-entry 30 Hz
> republishing, and off-slot direct-follow tightening. Replace durable claims
> with immutable `RacecraftCornerOwnershipAssertion` publication evidence and
> derive a temporary `ValidatedCornerOwnership` at every consumer decision
> from current measured state plus aged publications. Never consume authored
> relative times as current. Attacker error, infeasibility, lost conflict, and
> a defender's physical reclaim revoke current authority on that tick without
> mutating the old assertion; continuing ownership requires a new attacker
> assertion revision. Add one session-owned, fixed resolution value and
> checkbox:
> unchecked schedules the shared predictive reactive-safety pass at 10 Hz;
> checked schedules the same pass at 30 Hz. No check may exist only in the
> faster mode. Resolve the value into `SessionConfig`/session state and delete
> mutable process-global runtime resolution. Move that pass out of the 120 Hz
> physics loop, retain its latest snapshot between invocations, and leave
> actual collision physics at 120 Hz.
> Keep hard side-by-side room exactly `PHYS.carWid`; add the continuous
> sub-`0.15 m` near-rub exposure cost through the existing measured grind-loss
> curve separately per rival and connected alongside episode, with no initial
> strike bill and exactly once in J. An empty side envelope retains the exact
> agreement, disables direct modes, materializes no tactical replacement, and
> uses only bounded emergency/reactive safety until the next decision.
> Uncontrolled cars supply temporary occupancy from current measured state,
> never stale republished tactical intent. Preserve pace-weighted position
> value, measured attack-transition loss, capability effort, utilization risk,
> and tow on the tucked rollout. Ownership decides feasibility, never whether
> an attack is economically worthwhile. Use continuous progress/time
> interfaces and keep the landed `(s, v²)` envelope; execute R4a–R4e as
> separate conflict, lateral,
> publication, controller, and consolidation subphases only after cadence and
> objective semantics are green. Work phase by phase, delete
> superseded fields/tests with their replacements, run typecheck, boundaries,
> and touched unit tests per edit, then one focused profile comparison,
> `verify:fast`, one benchmark comparison, build, and the minimal browser smoke
> check for the checkbox. Report exact deletions, behavioral evidence,
> performance for both safety rates independently against the floor, and any
> blocker.
