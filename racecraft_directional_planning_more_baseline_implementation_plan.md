# Directional racecraft from the `more` baseline

Status: active only when implementation starts from commit `011466d`
(`more`, 2026-07-19). This document is the implementation authority for that
baseline.

The existing
`racecraft_directional_planning_implementation_plan.md` is intentionally
retained as the design record for the later `adv` tree. It is not an
executable patch against `more`: it assumes that the directional scheduler,
opportunity gate, corner-ownership modules, analytic speed envelope, and
30 Hz publication behavior from `adv` already exist.

Do not cherry-pick or transplant the `adv` implementation wholesale. Rebuild
the directional design from the `more` behavior baseline using this plan.

## 1. Decision

Keep the racing behavior and battle economics present at `more`, while
replacing its measured runtime owner:

```text
candidate
  × hazard
    × hypothetical rival response
      × residual response/hazard resolution
```

with:

```text
bounded ego candidates
  × immutable current rival publications
```

The optimization does not depend on suppressing ordinary attack or defensive
candidates. It comes from deleting recursive/counterfactual response
evaluation, publishing decisions directionally, and allowing each car to
react once at its next real decision slot.

The implementation must therefore preserve all of the following together:

- faster followers can pull out from an already constrained following state;
- inside and outside lines remain ordinary candidates;
- leaders can respond to a committed attack at their next decision slot;
- a leader may use one pre-braking defensive move to close an optional line
  completely when the attacker has adequate notice and cannot establish
  alongside status inside that notice window;
- an attacker that is already alongside, or whose committed publication
  reaches alongside inside the notice window, receives exact racing room;
- attackers can continue, abandon, or switch sides after observing that real
  response;
- battle economics decides whether those actions are worth their time;
- corner ownership answers only whether a scoped conflicting corner
  trajectory is entitled;
- no car simulates another car's unobserved future decision;
- no same-pass or same-tick recursive tactical reopening exists.

An implementation that is fast because cars remain in direct-follow is a
failed implementation.

## 2. Baseline contract

Before changing production behavior, verify that the implementation worktree
is based on `011466d`. A descendant containing only this plan or other
explicitly preserved documentation is acceptable. If directional production
modules from `adv` are already present, stop and reconcile the baseline rather
than attempting a second implementation over them.

At `more`, preserve these implemented capabilities:

- the true 30 Hz traffic clock and approximately 10 Hz three-slot
  deliberation cadence;
- immutable trajectory claims and honest longitudinal publication;
- the bounded six-candidate evaluator;
- alternate inside/outside path families and physical side agreements;
- deterministic swept-contact evaluation;
- certainty-equivalent prediction: current facts and publications, never
  sampled future noise;
- pace-weighted position value and self-limiting pace evidence;
- measured attack-transition loss;
- symmetric attack/defense battle economics;
- candidate braking effort up to physical capability;
- tow on the tucked prefix;
- utilization/mistake pricing;
- one-move defensive legality;
- physical light-contact behavior and the hard-contact invariant;
- fixed traffic/obstacle scan bounds;
- headless/browser determinism and shared runtime code.

The following `more` mechanics are superseded and must not survive under new
names:

- simultaneous symmetric tactical snapshot evaluation;
- hypothetical response-program generation;
- conditioned rival responses;
- recourse `Q`, residual-hazard response, or hypothetical concession prices;
- continuous/quantized responsibility as a substitute for processing order
  or corner entitlement;
- nested candidate × hazard × response loops;
- incremental beta re-checks whose purpose is to preserve a symmetric
  standing argmin after another car changes;
- publication identity heuristics based on traffic-heartbeat renewal;
- any attack/defend timer or sticky intent added to compensate for the new
  scheduler;
- a direct-follow test that requires lateral clearance before longitudinal
  braking begins.

## 3. Governing model

Five objects have separate authority:

| Object | Meaning | May do |
|---|---|---|
| Tactical publication | What this car has selected and will execute | Be consumed as immutable current trajectory evidence |
| Committed attack view | A consumer-local reading of a selected rear attack publication | Open defensive deliberation at the leader's next slot |
| Defensive-move commitment | Immutable provenance that the defender used its one move for this corner, including the selected cover envelope and authored notice evidence | Permit only the scoped approach-line closure described in Section 8 |
| Corner-ownership assertion | Evidence that one selected attack was apex-owned/shared against a specific leader publication | Permit only the scoped corner-conflict exception |
| Physical safety result | Immediate collision/reachability fact | Veto unsafe control; never choose a tactical line |

None is a prediction of another driver's future choice.

Claims/publications are data, not reservations. A committed attack is not
priority. A defensive commitment does not create corner ownership. Ownership
is not permanence. Safety is not racecraft intent.

## 4. Clocks and scheduling

Keep the world clocks explicit:

```text
120 Hz physics:
  integrate cars and resolve actual contact

30 Hz traffic/control bookkeeping:
  measured neighbor state, bounded pending-reason latches, ordinary control

approximately 10 Hz assigned per-car tactical slot:
  evaluate, select, install, and publish exactly once

10 or 30 Hz predictive reactive safety:
  one shared algorithm at a session-fixed resolution
```

### 4.1 One tactical clock

Only a car's assigned approximately 10 Hz slot may:

- open the maneuver evaluator;
- change direct/evaluated tactical mode;
- select or change a lateral family;
- compose or replace normal-follow longitudinal authority;
- create, replace, or abandon an attack;
- create a corner-ownership assertion;
- derive and consume committed-attack or ownership views;
- defend, concede, or reclaim;
- create, continue, or reset the defensive-move commitment for the current
  corner;
- author a tactical publication.

Exact traffic events coalesce bounded pending-reason bits for the next slot.
They never insert tactical work between slots.

Off-slot execution may consume the installed authority. It may not tighten,
loosen, recompose, reclassify, roll forward, or republish that authority.

### 4.2 Directional publication pass

For each traffic epoch:

1. take current measured physical state;
2. determine the entries whose assigned tactical slot is due;
3. order due entries deterministically front-to-back;
4. for each due entry:
   - read the latest publication map;
   - age consumed publications mathematically to the evaluation time;
   - evaluate at most once;
   - install at most one selected authority;
   - publish one new immutable revision immediately;
5. leave every off-slot publication unchanged;
6. never revisit an already processed entry.

A due follower may see a due leader's newly published trajectory. A leader
does not see a rear car's later same-pass decision. It sees that publication
at its next assigned slot.

This scheduling asymmetry is the reaction model:

```text
slot N:
  leader publishes
  attacker later reads it and publishes an attack

leader slot N+1:
  leader reads the committed attack and publishes hold/cover/concede/reclaim

attacker slot N+1:
  attacker reads the real response and continues/switches/follows
```

No actor is recursively re-evaluated inside any row of this sequence.

### 4.3 Pending reasons

Use a bounded bitset, not a queue or history:

```ts
export const enum RacecraftPendingDecisionReason {
  None = 0,
  MeasuredState = 1 << 0,
  ForwardPublication = 1 << 1,
  RearCommitment = 1 << 2,
  SideGeometry = 1 << 3,
  Ownership = 1 << 4,
  SportingObligation = 1 << 5,
  AuthorityInfeasible = 1 << 6
}
```

Exact names may vary. Semantics may not: a bit schedules work only at the
owner's next assigned slot and is cleared only after that slot consumes it.

## 5. Tactical publications

Replace the `more` simultaneous double-buffered arbitration snapshot with one
map of immutable selected publications.

A publication must contain enough continuous information to answer:

- state at a requested future time;
- progress, lateral centre, speed, and heading;
- selected plan/family identity and target leader/corner where applicable;
- the installed longitudinal program;
- whether the selected program is direct ideal, direct follow, staged attack,
  side-by-side, defense, ownership response, pit, or emergency;
- its optional immutable ownership assertion;
- its optional immutable defensive-move commitment;
- provenance and deterministic revision identity.

Suggested logical shape:

```ts
export interface RacecraftPublication {
  readonly ownerCode: string;
  readonly publicationRevision: number;
  readonly authoredAtSessionTimeSeconds: number;
  readonly selectedPlanNumericId: number | null;
  readonly selectedFamilyNumericId: number | null;
  readonly mode:
    | 'direct-ideal'
    | 'direct-follow'
    | 'staged-attack'
    | 'side-by-side'
    | 'defense'
    | 'ownership-response'
    | 'pit'
    | 'emergency';
  readonly targetCode: string | null;
  readonly cornerId: string | null;
  readonly trajectory: RacecraftTrajectoryProgram;
  readonly ownershipAssertion:
    | RacecraftCornerOwnershipAssertion
    | null;
  readonly defensiveCommitment:
    | RacecraftDefensiveMoveCommitment
    | null;
}
```

The exact storage representation may initially reuse the `more` station
publication. Cross-module interfaces must use metres and seconds, never
station indices or buffer positions. The later analytic phase may replace
sampled internals without changing arbitration semantics.

Consumers age an immutable publication on read. Owners do not roll it forward
and republish as a heartbeat.

A defensive commitment is publication lineage, not a timer or mutable
reservation. Its presence means the per-defender/per-corner move has been
used. A continuation may retain it only while remaining inside the originally
authorized selected trajectory envelope. Target changes, attacker publication
revisions, a temporary feint/abort, and ownership changes do not reset it.
Crossing the defended corner's `exitI` is the sole normal reset.

Uncontrolled, ballistic, or newly invalid cars produce temporary measured
occupancy for physical safety. That occupancy carries no selected family,
attack commitment, defensive commitment, ownership assertion, or tactical
revision.

## 6. Opportunity routing without an absorbing follow state

The direct modes are optimizations, not behavioral authorities.

At a due decision slot:

1. apply pit, fixed-obstacle, uncontrolled, sporting-obligation, and measured
   side-by-side routing;
2. derive current actionable ownership views;
3. derive any current committed rear attack view;
4. find relevant forward publications;
5. if no forward publication can constrain the car, return direct ideal;
6. otherwise test only whether both ordinary side-acquisition families are
   physically proved impossible;
7. return direct follow only with two impossibility certificates;
8. if either side is viable or uncertain, open the bounded evaluator.

### 6.1 Correct definition of “cannot pass”

“Cannot pass” means:

> No continuous physically legal side-acquisition program exists while the
> follower remains under the leader-safe longitudinal envelope until lateral
> body clearance is established.

It does not mean:

- the free ideal envelope has begun to bind;
- the follower has already had to brake;
- full clearance is unavailable at the first braking-binding station;
- the pass does not finish inside the detailed horizon;
- the current ideal-line projection would contact the leader if acceleration
  continued unchanged.

The first longitudinal binding time is a speed-law fact, not a deadline for
lateral movement.

### 6.2 Valid impossibility certificates

One side may be certified unavailable only when current physical facts prove
one of:

- no connected normal/legal car-centre corridor reaches a side-clear state;
- a fixed occupancy, live side agreement, or current immutable publication
  closes that complete corridor;
- the corridor ends before physical lateral dynamics can reach clearance,
  even while the follower brakes safely behind;
- hard feasibility makes every acquisition prefix on that side impossible.

If finite resolution, horizon, stale publication age, or ambiguous geometry
prevents proof, the side is uncertain and the evaluator opens.

The cheap gate may admit a candidate later rejected by full feasibility. It
must not reject a viable staged attack.

### 6.3 Required regression

A trusted leader publication, a faster follower already bound at the current
progress, and an open car-width side corridor must produce deliberate
evaluation. `bindingSeconds == 0` may never by itself produce direct follow.

## 7. Staged side acquisition

Every ordinary attack family is one ego program with two deterministic
stages. It is not a conditional response policy.

### 7.1 Acquisition prefix

Before continuous oriented body clearance:

- move laterally along the selected inside/outside family;
- retain the fastest leader-safe longitudinal envelope;
- include tow while aligned;
- remain behind the leader's current publication;
- require no hypothetical leader action;
- remain contact-free under strict ordinary feasibility.

Conceptually:

```text
v_prefix(s) = min(v_ego_free(s), v_leader_safe(s))
```

### 7.2 Clearance event

Define the first continuous time/progress at which the existing oriented-body
separator proves lateral body clearance. Use exact body dimensions and
headings. Do not substitute a station equality or a global clearance
near-constant.

The clearance event is a program transition, not a decision event. It does
not reopen the evaluator.

### 7.3 Attack suffix

After clearance:

- release the same-line following constraint against that leader;
- use the candidate's capability longitudinal envelope;
- keep tow only where the physical alignment model supplies it;
- evaluate current rival publications as fixed trajectories;
- apply full surface, contact, side, corner, and terminal feasibility;
- derive apex ownership when the scoped conflict rules apply.

If the family reconverges with the leader, ordinary contact infeasibility or
the apex-ownership rule resolves that future conflict.

The detailed horizon need not contain pass completion. It must either contain
the side-acquisition event or leave the side uncertain/open. A terminal
continuation may prove corner completion without simulating another car.

### 7.4 Candidate set

Ordinary follower deliberation includes at most:

- safe follow baseline;
- staged inside attack;
- staged outside attack;
- continuation of the currently selected family, if not identical to one of
  the above;
- required obligation/emergency member where applicable.

Defense and ownership contexts use their own bounded families. The global
hard maximum remains six evaluated candidates and one materialized path.

Only the selected path is materialized. Candidate evaluation uses analytic or
compact program geometry.

### 7.5 Direct follow after comparison

When an open side exists, safe follow is an ordinary candidate in the full
objective. If it wins, install the cheap direct-follow publication.

Direct follow may use ideal lateral authority only when the car has settled
lateral authority. A car already acquiring, holding, or leaving a side family
must evaluate continuation/recentering physically. Direct follow may not snap
or silently reset it to the ideal line.

## 8. Publication-driven defense and switchbacks

Restore the useful `more` defensive behavior without restoring symmetric
response evaluation.

### 8.1 Committed attack view

At a leader's decision slot, derive a consumer-local committed attack view
from a rear publication only when:

- the publication explicitly targets this leader;
- it selects a staged inside/outside or continuing attack family;
- it is current and physically feasible at the aged evaluation time;
- lateral acquisition is measurably progressing or clearance is established;
- it lies within the existing bounded traffic neighborhood;
- it is not merely an ideal/follow publication or a hypothetical candidate.

The view is discarded after the decision. It is not published, renewed,
reserved, or stored as authority.

An uncommitted rear car remains harmless. A committed attack may open
defensive deliberation, but it does not reserve an optional lane merely by
existing. Racing-room priority arises only from Section 8.5, current measured
side geometry, or Section 9 ownership.

### 8.2 Defensive candidates

Against the one most imminent committed attacker, evaluate a bounded set:

- hold/ideal;
- one physically legal cover of the committed side;
- the ordinary alternative/reclaim family when physically relevant;
- continuation of an already selected legal defense.

Every defensive candidate is checked against the attacker's one immutable
publication. The evaluator never generates the attacker's response to that
candidate.

All other nearby publications remain feasibility hazards. They do not
multiply the defensive candidate family.

### 8.3 One impeding move per defender and corner

The one-move rule is a hard sporting candidate constraint, never a cost.
Scope it to the defender and the next defended corner, not to an attacker:

- the first new selected movement that closes or reduces the committed
  attacker's selected-side corridor consumes the move;
- changing target attacker, seeing a new attacker revision, a feint/abort,
  losing/recovering ownership, or temporarily returning to a neutral line
  does not restore it;
- only crossing that corner's `exitI` resets the move for the next corner;
- continuation inside the selected cover publication's authorized trajectory
  envelope does not consume another move;
- any later expansion beyond that envelope toward an attacker is another
  impeding move and is infeasible;
- holding position, following ordinary track/racing-line curvature, moving
  away from the attacker, or another lateral change that does not reduce the
  attacker's selected corridor is not a defensive move;
- reactive collision avoidance may change direction as often as physical
  safety requires, but it neither consumes, restores, nor expands tactical
  defensive authority.

The move must begin physically before the defended corner's deceleration
phase. Publishing a future cover before braking is not enough if its lateral
encroachment begins only after braking starts. Derive braking start from the
installed continuous longitudinal program's first corner-braking binding
point, with `brakeI` identifying the relevant corner context; do not add a raw
acceleration threshold, reaction timer, or driver-intent latch.

After braking starts, the defender may hold, continue the already committed
cover without reversing or expanding it, or follow the ordinary racing line.
It may not initiate a new movement toward or across an attacker.

Carry the rule as immutable publication lineage, for example:

```ts
export interface RacecraftDefensiveMoveCommitment {
  readonly cornerId: string;
  readonly targetCodeAtCommitment: string;
  readonly coveredSide: -1 | 1;
  readonly sourceAttackerPublicationRevision: number;
  readonly authorizedDefenderPublicationRevision: number;
  readonly encroachmentStartSessionTimeSeconds: number;
  readonly noticeDeadlineSessionTimeSeconds: number;
  readonly authoredFirstConflictSessionTimeSeconds: number | null;
  readonly authoredFirstAlongsideSessionTimeSeconds: number | null;
  readonly authoredOutcome:
    | 'room-protected'
    | 'side-closure-authorized';
}
```

The exact representation may vary. Its authority may not. Authored times are
immutable provenance for the decision that was made, not heartbeat-renewed
predictions. Current side geometry, safety, and ownership are still evaluated
from current measured state and publications.

### 8.4 One-second defensive-block notice

Register:

```text
defensiveBlockNoticeSeconds = 1.0 s
```

in `RACECRAFT_CALIBRATION_DEFINITIONS` as an explicit sporting-safety policy,
not physics, a human reaction-delay model, or a performance-setting value.

The notice rule applies only when a new defensive candidate, relative to the
defender's current publication, newly creates or advances a conflict with the
fixed committed-attacker publication. Compute continuously:

```text
tEncroach =
  first time the new defender candidate, relative to the previous defender
  publication, physically begins reducing exact oriented-body clearance to
  the attacker's selected corridor on the covered side

tDeadline = tEncroach + defensiveBlockNoticeSeconds

tConflict =
  first time the new defender candidate and fixed attacker publication would
  violate the exact legal oriented-body separator

tAlongside =
  first time before any separator violation that the fixed attacker
  publication reaches a physically legal side-by-side state on that side
```

Use actual lateral-program transition time for `tEncroach`, not publication
time. An early publication followed by a late sudden cut must not manufacture
notice. World-heading changes from track curvature are irrelevant; compare
lateral encroachment relative to the previous defender publication.

If a prior defender publication already has the same future conflict, the new
candidate may inherit it only through a valid defensive commitment and only
inside that commitment's authorized envelope. Otherwise an existing conflict
is not retroactively legalized.

The fixed attacker publication is the only attacker program consulted. Do not
generate a capability-maximizing attacker, alternate attacker candidate, or
response. If continuous resolution cannot prove the required timing, it
cannot authorize a future nominal conflict.

For a full side closure:

```text
tConflict >= tDeadline
```

must hold. A conflict before the deadline is a sudden block and the defensive
candidate is infeasible. This notice gate is necessary, never sufficient:
one-move, pre-braking, ownership, track, terminal, and hard-safety constraints
all still apply.

### 8.5 Racing room is conditional, not a permanent optional lane

A legal defensive move may close the selected optional side completely. The
defender does not owe a vacant `PHYS.carWid` corridor on that side merely
because a committed attacker selected it.

Racing room is required when any of the following holds:

- the attacker is already in a measured legal side-by-side state;
- its fixed committed publication reaches `tAlongside <= tDeadline`;
- an actionable attacker-owned/shared corner-ownership view independently
  protects the relevant corner space.

Equality at the one-second deadline is room-protected. This is a deterministic
shared boundary, not a hysteresis band.

When room is protected, the defender may still execute its one move, but the
complete candidate must preserve the exact oriented physical separator from
the first protected alongside state onward. It may not finish by squeezing
the attacker out of that corridor.

When the attacker is not already alongside, does not reach legal alongside
until after the deadline, and has no applicable ownership protection, the
defender may occupy the covered side fully. No car-width lane must remain on
that side. The attacker's conflicting publication then yields to the
defender's real publication at the attacker's next assigned slot; the
attacker may follow/abort or select the other staged side. The defender never
simulates which response will win.

This closure authority is scoped to the selected committed attacker and the
pre-turn-in approach. Other nearby publications remain ordinary strict
feasibility hazards. It creates no apex ownership. Any first conflict inside
`[turnInI, exitI]` still requires the independent Section 9 ownership/reclaim
result. A successful reclaim that changes lateral direction must also satisfy
this section; reclaim is not permission to make a late move or squeeze a
timely alongside attacker.

### 8.6 Switchbacks emerge across slots

If a defender's later publication closes the attacker's selected side, the
attacker's next real slot evaluates:

- continuation;
- safe follow/abort;
- the opposite staged side family.

Selecting the opposite side is a switchback. It needs no response tree and no
special switchback state machine. Battle-family identity determines whether a
new measured transition loss is charged.

## 9. Corner ownership

Corner ownership is the only rule that permits a selected trajectory to keep
a scoped future **corner-space** conflict against the target's current
publication. Section 8's defensive closure may authorize only a sufficiently
announced approach-line conflict before `turnInI`; it neither creates nor
overrides corner ownership.

Use the existing track corner gates:

- `brakeI` for physical braking context;
- `turnInI` for the beginning of possible ownership conflict;
- `apexI` for one common cross-track timing gate;
- `exitI` for the end of the ownership region.

For attacker `A`, leader `L`, and common gate `G`:

```text
tA = continuous physically feasible arrival time of A's selected candidate
tL = continuous arrival time of L's current publication
delta = tL - tA
```

The timing band comes from decision/trajectory numerical resolution, not
aggression or the optional predictive-safety cadence:

- `delta > band`: attacker-owned;
- `abs(delta) <= band`: shared;
- `delta < -band`: leader-owned.

An assertion requires all of:

- selected staged inside/outside attack against the immediate relevant
  leader;
- actual grip, surface, steering, speed, braking effort, and tow;
- authored feasibility through corner exit;
- first swept-body conflict inside `[turnInI, exitI]`;
- attacker-owned/shared arrival at the common apex gate.

Future apex entitlement is not retroactive. Same-line rear contact and
pre-turn-in crossing without the independently legal Section 8 defensive
closure remain infeasible. Corner ownership itself never legalizes approach
contact.

### 9.1 Immutable assertion, revocable authority

Publish immutable evidence:

```ts
export interface RacecraftCornerOwnershipAssertion {
  readonly assertionId: string;
  readonly attackerCode: string;
  readonly targetCode: string;
  readonly cornerId: string;
  readonly side: -1 | 1;
  readonly authoredOutcome: 'attacker-owned' | 'shared';
  readonly attackerPublicationRevision: number;
  readonly sourceLeaderPublicationRevision: number;
  readonly selectedPlanNumericId: number;
  readonly selectedFamilyNumericId: number;
}
```

Do not store authored relative apex times as durable current authority.

Every consumer derives and discards a fresh view:

```ts
export interface ValidatedCornerOwnership {
  readonly assertionId: string;
  readonly evaluatedAtSessionTimeSeconds: number;
  readonly outcome:
    | 'attacker-owned'
    | 'shared'
    | 'leader-owned'
    | 'inactive';
  readonly attackerApexArrivalSessionTimeSeconds: number | null;
  readonly leaderApexArrivalSessionTimeSeconds: number | null;
  readonly firstConflict:
    | {
        readonly sessionTimeSeconds: number;
        readonly progressMetres: number;
      }
    | null;
  readonly reason:
    | 'current'
    | 'source-replaced'
    | 'attacker-diverged'
    | 'conflict-ended'
    | 'corner-ended'
    | 'hard-infeasible';
}
```

The exact TypeScript union may vary. Its authority may not.

The view is actionable only when publication revisions, target/corner,
selected plan/family, current conflict, apex result, and terminal feasibility
all still agree. An attacker mistake, divergence, lost gate, ended conflict,
hard infeasibility, corner exit, or a new successful leader reclaim makes the
old assertion inactive/leader-owned without mutating it.

There is no heartbeat, `validatedEpoch`, renewal pass, ownership timer,
consumption marker, or hysteresis.

### 9.2 Leader response

At the leader's next assigned slot:

1. derive all incoming ownership views once;
2. discard inactive/leader-owned views;
3. batch the actionable set into one evaluator invocation;
4. allow hold/avoid/concede candidates;
5. allow a same-attacker/same-corner reclaim only if the leader candidate
   physically wins the common apex outside the band;
6. apply the independent one-move, pre-braking, notice, and conditional-room
   constraints to any reclaim that changes the leader's lateral trajectory;
7. select once and publish once.

The attacker is not re-evaluated in response. It observes the result at its
next slot.

## 10. Battle economics

Preserve the `more` economics as a first-class part of deliberate evaluation.
Ownership answers “may I?” Economics answers “is it worth it?”

For each feasible candidate:

```text
J(c) =
  own trajectory time
  + non-duplicated physical/rule bills
  + utilization/mistake exposure
  + near-rub exposure
  + strategic position/battle term
```

Preserve:

```text
V = w(pace) * max(0, measuredPaceDifferential) *
    reopportunitySeconds / referenceLapSeconds
```

- A follower candidate that stays behind a genuinely slower rival carries
  `V`.
- A newly entered attack family carries measured attack-transition loss.
- Continuing the same active family does not repay that loss every slot.
- A failed attack changes measured pace evidence; no cooldown is added.
- Capability braking effort is a candidate degree of freedom and remains
  priced through utilization/mistake exposure.
- Tow on the aligned acquisition prefix participates in physical feasibility.

Restore/retain the `attack | defense` role:

- a leader ignoring a current committed attack may carry the symmetric
  position-at-risk value;
- a defensive family pays its own time, transition loss, effort exposure, and
  near-rub cost;
- a defense is selected only when its preserved position value exceeds its
  physical/economic spend.

Apply sporting feasibility before `J`. When Section 8 authorizes complete
side closure, the target's unchanged post-deadline publication is displaced
for that approach. Do not charge its resulting authorized nominal overlap or
near-rub suffix back to the defender as though the defender selected planned
rubbing; doing so would silently neutralize the legal cover. This exclusion
applies only to the committed target, after the notice deadline, and inside
the authorized envelope. Pre-deadline conflict, room-protected alongside
exposure, unrelated cars, and actual physical contact retain their ordinary
feasibility, cost, and safety treatment.

Each role compares ego candidates against one fixed rival publication. It
never evaluates a rival response program.

At present, contest cost without a separately measured, non-duplicated source
is zero. Delete `recourseSeconds`, `Q`, and any renamed equivalent rather than
feeding them into battle spend.

## 11. Exact racing room and near-rub preference

The hard separator is exactly the oriented physical body width:

```text
hard legal centre separation = PHYS.carWid
```

Delete the `more` hard sporting widening of `PHYS.carWid + 0.15 m`.

Add the declared soft preference only during predicted alongside exposure:

```text
D = 0.15 m
g(t) = lateral body-edge daylight
w(g) = max(0, 1 - max(0, g) / D)

T_equivalent =
  integral over one maximal connected alongside episode of w(g(t)) dt

J_near_rub =
  existing measured sustained grind-loss curve applied to T_equivalent
```

Apply the curve separately per rival and connected episode, then sum once.
Do not add an initial-strike bill for merely entering the near-rub range.

Register `nearRubClearanceMetres = 0.15` as sporting policy in
`RACECRAFT_CALIBRATION_DEFINITIONS` with units, bounds, rationale, and owner.
The price comes from the existing measured sustained contact-loss family.

This keeps zero daylight legal, makes a short squeeze cheap, and prevents
persistent planned rubbing from being the optimum.

Measured longitudinal overlap activates side geometry. Preserve every live
counterpart, including both constraints on a three-wide middle car. Side
geometry carries no attack/defense decision authority.

Neither a committed attack nor an unearned optional lane activates a blanket
car-width reservation. Section 8 may close that lane completely when its
notice and alongside tests pass. Once the attacker is measured alongside or
is protected by the one-second/ownership rules, this exact separator becomes
mandatory and the defender may not price its way through it.

## 12. Contact and safety

### 12.1 Strict nominal contact after correct composition

First construct the complete staged candidate. Then apply swept-contact
feasibility.

For controlled cars, predicted nominal body contact is infeasible except:

1. an attacker-owned/shared trajectory satisfying the exact scoped
   turn-in/apex/exit ownership rule; or
2. the corresponding leader's physically successful same-corner reclaim; or
3. one target-specific, pre-`turnInI` approach conflict created by a legal
   Section 8 defensive closure, only after its one-second deadline and only
   inside its immutable authorized envelope.

Ordinary pre-entitlement acquisition must remain contact-free against current
publications. The acquisition prefix achieves this by following safely while
moving laterally. The third exception is directional priority for the
attacker's next real decision, not permission to collide: it does not cover
pre-deadline contact, timely alongside room, another car, a second move, a
post-braking move, or corner space without the required ownership result.

Do not reject a side family by sweeping an unconstrained accelerate-and-move
surrogate that the candidate will never execute.

Actual light contact remains physical and does not force concession. Hard
contact remains capped/invariant-owned. The attacker failing to update does
not turn a closure assertion into collision immunity. Emergency/uncontrolled
behavior stays in the safety layer and may not create, expand, consume, or
reset a defensive commitment.

### 12.2 Predictive reactive-safety resolution

Expose one pre-session checkbox/performance setting:

```text
unchecked: shared predictive-safety pass every 3 traffic ticks (10 Hz)
checked:   shared predictive-safety pass every traffic tick (30 Hz)
default:   unchecked
```

Both modes run the exact same predicates and code. Disabling 30 Hz changes
only scheduling to 10 Hz; it may not disable any safety logic.

Predictive safety may:

- inspect current measured state and immutable publications;
- retain a bounded result until the next safety pass;
- immediately veto hard-closing control;
- latch a pending tactical reason.

It may not:

- author or republish a tactical trajectory;
- create/revoke ownership;
- choose inside/outside/defense/follow;
- tighten ordinary following authority off-slot;
- open the maneuver evaluator.

Actual collision physics remains 120 Hz in both modes.

## 13. Architecture from the `more` tree

Create or replace modules with these ownership boundaries:

- `planning-order.ts`
  - due-slot assignment;
  - deterministic front-to-back order;
  - bounded forward/rear/side context;
  - no evaluator logic.

- `opportunity.ts`
  - direct-ideal proof;
  - exact two-side impossibility certificates;
  - no objective, ownership response, or contact pricing.

- `defensive-legality.ts` (or one equivalently owned helper)
  - per-defender/per-corner move lineage and `exitI` reset;
  - continuous braking-start, encroachment-start, first-conflict, and
    first-alongside queries against one fixed committed publication;
  - one-second notice and conditional-room classification;
  - no attacker response construction, objective, scheduler, or safety
    mutation.

- `longitudinal-program.ts`
  - free, leader-safe, staged-prefix, and released attack envelopes;
  - continuous progress/time API;
  - capability effort and tow;
  - future home of the analytic `(s, v²)` envelope.

- `corner-ownership.ts`
  - common-gate crossing;
  - continuous first conflict;
  - immutable assertion construction;
  - consumer-local validation;
  - no scheduler or objective.

- `reactive-safety.ts`
  - one shared 10/30 Hz predictive safety implementation;
  - immutable bounded output;
  - no tactical authority.

- `diagnostics.ts`
  - bounded counters/histories only.

- `claim.ts` or a renamed `publication.ts`
  - immutable publication representation;
  - immutable defensive-move commitment and authorized-envelope provenance;
  - continuous state-at-time/progress reads;
  - publication aging;
  - no tactical selection.

- `evaluator.ts`
  - bounded ego candidate construction/evaluation;
  - staged attacks;
  - publication-driven defense;
  - defensive legality before objective scoring;
  - fixed-publication hazard sweeps;
  - battle economics;
  - no response program generation.

- `traffic.ts`
  - clocks, pending bits, ordered invocation, installation, publication;
  - no duplicate evaluator/objective implementation.

Cross-module signatures use:

- progress in metres;
- session-relative or program-relative time in seconds;
- speed or squared speed with explicit types;
- lateral centre/offset in metres;
- continuous conflict/gate results.

They never expose station indices, slot array positions, or typed-array buffer
offsets as semantic inputs.

## 14. Analytic and lossless optimization after behavior

Do not begin the analytic rewrite until the directional behavior phase passes
the staged-attack, defensive-notice/conditional-room, train, and no-recursion
focused cases.

Then retain the valuable `more` P-O work:

- branch-and-bound using honest lower bounds;
- rival geometry shared across ego candidates;
- allocation-free/monomorphic hot paths;
- structure-of-arrays storage;
- numeric hot-path identity;
- fused traffic passes where dependencies allow;
- hoisted and cheaper equivalent math.

Add the analytic core:

- a continuous piecewise `(s, v²)` speed-envelope representation;
- closed-form or bracketed continuous binding and gate crossing;
- compact lateral segment programs;
- direct segment publication;
- controller consumption without sampled lane-buffer authority where proven
  equivalent.

The analytic public API must own or immutably retain its output buffers.
Scratch-pool reuse may never alias an installed/public result. Geometry uses
orientation-aware body projection and exact heading. Cached dynamics must be
keyed only by immutable inputs.

Directional ordering means epoch-parallel evaluation is no longer generally
valid. Delete the `more` proposal that assumes every car reads one symmetric
epoch snapshot. Parallelism is allowed only for independent internal
candidate/hazard calculations whose deterministic merge order and data
ownership are proven.

Any optimization that changes candidate admission or the selected argmin is a
behavior change and must be specified as such. It is not “lossless.”

## 15. Deletion contract

Use `rg` against the `more` tree and delete the complete owning structures,
tests, diagnostics, and comments for:

- response-program interfaces and builders;
- conditioned/deferred rival response paths;
- response slack used only by recourse;
- recourse/residual-hazard fields and `Q` decomposition;
- responsibility weights/arrival quantization used as decision authority;
- simultaneous staged-install snapshot machinery;
- incremental beta re-check and its revision-support keys;
- traffic-heartbeat publication renewal;
- symmetric defense discovery based on another car's unselected candidates;
- any new direct-follow stickiness, cooldown, attack timer, or compatibility
  fallback introduced during implementation.

Keep:

- physical side agreements;
- pit reservations and sporting obligations;
- measured pace/opportunity evidence;
- attack-transition and contact-loss measurements;
- utilization/mistake law;
- hard-contact and protected-corridor safety;
- per-corner one-move, pre-braking, one-second-notice, and conditional-room
  sporting legality;
- deterministic claim/publication geometry that still serves the new
  publication contract.

Do not leave old and new authorities active together. Temporary scaffolding
may exist only within an unfinished local substep; it may not survive a phase
handoff.

## 16. Implementation phases and single status

| Phase | Status |
|---|---|
| M0 — Restore/record `more` baseline and reconcile documents | complete — HEAD `011466d`; baseline build green. Prado seed 101 `train-pressure` capsule: 4.975 simulated s, checksum `39727149`, 2 attacks/0 completions, 4.067 side-by-side s, defense/switchbacks 0, battle-lap loss unobserved (`0` samples), rear pair inline for the full capsule, 5 candidates/0 materializations, 600 evaluator calls, 389,912 speed-law samples, 541,797 continuation steps, 9,674 sweeps, 3 light/0 hard contact steps. Comparison-only, not a tuning target. The rejected `adv` plan moved to `superseded/`, all `:Zone.Identifier` files were removed, and this plan supersedes the cost plan's symmetric snapshot, recourse/Q, beta re-check, and epoch-parallel proposals while retaining its governing principles and battle-economics measurements. |
| M1 — Complete directional vertical slice with staged dynamics | complete — deterministic three-slot front-to-back evaluate/install/publish is live with one immutable publication per due car, no off-slot tactical mutation or backward reopening, certified direct follow only when both sides are physically impossible, and exact-width staged acquisition that falls back from spent corner geometry to a real open-side family. Fixed-publication economics, next-slot defense, later-slot switchbacks, immutable/revocable ownership, the baseline one-move defense, bounded proof/ownership/train diagnostics, and the six/one work limits are retained. Hypothetical/conditioned/residual response, recourse Q, beta re-check, simultaneous snapshot/install, heartbeat/off-slot recomposition, and their owning fields/tests/tools were deleted. Focused M1 units, typecheck, boundaries, and playable build are green. The full pre-braking/notice/conditional-room contract was specified later and assigned to M4; attempt-loss remeasurement, parity refresh, comparison, and statistics were deferred to M6 until M5 could no longer invalidate them. |
| M2 — Predictive-safety 10/30 Hz setting | complete — one shared frozen predicate inventory consumes measured state plus aged immutable publications at a session-fixed one- or three-traffic-tick interval, retains immutable results between passes, immediately vetoes hard-closing control, and only latches tactical work for the owner's real slot. Race, qualifying, headless, diagnostics, and browser/headless parity state carry the resolved value; the default-unchecked pre-session checkbox affects newly created sessions only. Focused units prove identical predicates and 3:1 scheduling without publication/decision mutation; typecheck, boundaries, build, and a real-browser UI/runtime flow are green. The public smoke command reached the known M1 parity-fixture drift before its remaining cases; fixture refresh remains explicitly M6-owned. |
| M3 — Exact width and soft near-rub economics | complete — live side agreements now use exactly `PHYS.carWid`; the former hard `+0.15 m` authority and owning names/tests are gone. Registered `nearRubClearanceMetres = 0.15 m` drives a continuous oriented-body daylight ramp integrated per rival and maximal connected alongside episode, with each equivalent duration passed separately through the measured sustained-grind curve and no strike bill. The scalar is exposed as `proximitySeconds`/battle spend and enters the complete objective once. Focused units, exact-envelope regressions, typecheck, boundaries, and playable build are green. A single Prado pair observation selected `0.066125816 s` proximity with total `J = own + proximity`, one light touch, and zero hard contact; the benchmark remains M6-owned because M5 will replace this hot-loop representation. |
| M4 — Defensive move, notice, and conditional racing room | complete — immutable per-defender/per-corner lineage now records physical encroachment onset, the installed-program braking binding, the exact one-second notice boundary, fixed-publication conflict/alongside timing, conditional exact room, and the original authorized cover envelope through `exitI`. New/expanded, post-braking, sudden, room-violating, ownership-violating, and hard-safety candidates are rejected without attacker response evaluation; non-impeding and safety-only motion create no authority. Only the target-specific post-notice/pre-turn-in displaced suffix bypasses nominal-publication conflict and near-rub pricing; corner ownership, unrelated cars, early contact, and hard safety remain strict. Focused timing, lineage, publication, cost, safety, ownership, one-call, typecheck, boundary, and playable-build evidence is green. The broader headless unit’s follow-loss case exposed the expected temporary hot-loop cost and remains M5-owned representation work, not M4 behavior evidence. |
| M5 — Analytic continuous internals and lossless hot-loop work | complete — longitudinal speed-squared envelopes, lateral C2 segments, timed conflict/ownership/defense queries, immutable publications, and controller consumption now share direct owned analytic programs; sampled tactical authority and its conversion path are gone while sampled pit/start/recovery authority remains isolated. Exact lower-envelope construction, linear breakpoint/travel traversal, allocation-free geometry writers, immutable rival-state sharing, pooled defensive queries, fused traffic passes, prepared publication/family geometry, reduced scalar progress roots, and proven infeasibility/off-switch bounds reduced the formerly timing-out focused follow-loss case to 16.01 s without changing its 7,649 steps or decisions; no approximate candidate pruning was introduced. The final pre-M6 900-step audit had zero recursive differences (checksum `186b6709`); its warmed profile was 8.990 s / 3.337x, 12.48% less wall time and 14.26% more throughput than the defensive-query profile. The closure boundary is green for 58 focused analytic/publication/controller tests (98,318 assertions), typecheck, module boundaries, and a fresh playable build. Final comparison, parity, population, and benchmark evidence remain M6-owned. |
| M6 — Consolidation, deletion audit, comparison, playable build | blocked — the owning implementation is complete: obsolete response/Q/renewal/simultaneous-authority state is absent, required zero-valued guard diagnostics remain, module boundaries and diff checks are green, the final 17-file focused batch is 88/88 green, and sampled racecraft authority remains isolated to pit/start/recovery consumers. The final authored-family attempt-loss measurement is complete over 1,803 opportunities / 81 straights with coefficient `0.06674665779269824 s`; its focused reproduction is green. The refreshed comparison is green (`d4719002` near-touch tow, `25672c9f` attack launch), with 5 candidates maximum, zero materializations, and zero off-slot publication, same-slot reopening, nested evaluation, or invariant failure. Browser/headless parity is freshly recorded and green, and the playable bundle is current. Acceptance is blocked by the inherited hard performance debt: the final official benchmark produced four 10.215x–10.521x samples against the 62.912x floor and aborted when the median became unrecoverable; the older cost-function baseline already recorded 5.583x–12.371x. The single `verify:fast` run reached 243 passing units and four failures; the M6-owned stale attempt-loss failure is fixed and its focused tests pass, while the independently reproduced TrackProfile round-trip, profile-optimizer measured-lap, and 20 s race-worker failures predate this migration. The full merge gate is withheld until those hard blockers are resolved. |

This is the only implementation status table for work starting from
`011466d`. The `more` cost-function plan remains the conceptual record, but
its phase table no longer schedules implementation after M0.

### M0 — Restore and record the baseline

1. Confirm the source baseline is `011466d`.
2. Preserve this plan and the later `adv` design record.
3. Make no production behavior change.
4. Build the baseline.
5. Run one targeted seeded race or existing focused pack scene and record a
   small behavior capsule:
   - attacks and passes;
   - side-by-side time;
   - defense/switchback activity;
   - battle lap loss;
   - maximum/long-lived single-file train observation;
   - candidate/materialization maxima;
   - evaluator/runtime attribution already available.
6. Record that the purpose is comparison, not a numerical tuning target.
7. Mark the symmetric snapshot, recourse/Q, beta re-check, and P-O
   epoch-parallelism portions of the `more` plan superseded by this document.
8. Keep its governing principles and battle-economics measurements.

### M1 — Directional vertical slice with staged dynamics

This is one coherent behavior phase. Do not land or hand back a partial
direct-follow-heavy intermediate.

Within the phase:

1. Introduce continuous publication and planning-order contracts.
2. Replace simultaneous snapshot/staged install with due-slot
   front-to-back evaluate/install/publish.
3. Move every tactical mutation to the approximately 10 Hz owner slot.
4. Add pending-reason bits and immutable off-slot publication aging.
5. Implement direct ideal and exact-certified direct follow.
6. Implement staged inside/outside acquisition before enabling the direct
   follow fast path in production.
7. Preserve the safe-follow baseline and full attack/defense economics.
8. Implement committed-attack views and next-slot defensive evaluation.
9. Implement apex ownership assertions and consumer-local validation.
10. Preserve side-by-side/multi-car geometry and physical safety.
11. Apply strict contact only after staged candidate composition.
12. Delete response/Q/residual/symmetric-authority machinery in the same
    phase.
13. Ensure at most six candidates, one materialized path, one evaluator call,
    and one publication per due car.
14. Build a playable bundle at the phase handoff.

M1 may not close unless:

- an already-bound faster follower on an open straight evaluates a staged
  side attack;
- safe follow remains a selectable economic baseline;
- a committed attack can provoke a next-slot defense;
- a later attacker slot can switch sides;
- no same-slot recursive evaluator call occurs;
- nested response evaluations are exactly zero.

### M2 — Predictive-safety resolution

1. Add a session-fixed resolved safety interval.
2. Schedule the same bounded safety pass every one or three traffic ticks.
3. Add the pre-session checkbox and thread the resolved value through race,
   qualifying, headless, and parity state.
4. Retain results immutably between passes.
5. Verify every predicate runs in both settings.
6. Prohibit safety from changing tactics/publications/ownership.
7. Apply changes only to newly created sessions.

### M3 — Exact width and near-rub economics

1. Replace the hard `carWid + 0.15 m` agreement widening with exact
   `PHYS.carWid`.
2. Add the registered `0.15 m` soft sporting threshold.
3. Compute ramp-weighted alongside exposure in existing bounded conflict
   work.
4. Split by rival and maximal connected episode.
5. Apply the measured sustained grind-loss curve separately per episode.
6. Add the scalar once to `J` and once as a decomposition diagnostic, without
   double charging.
7. Preserve legal zero-daylight and physical light rubbing.

### M4 — Defensive move, notice, and conditional racing room

This is one coherent behavior phase and must close before analytic internals
replace the conflict representation:

1. Register `defensiveBlockNoticeSeconds = 1.0 s` as sporting-safety policy.
2. Define the per-defender/per-corner immutable defensive commitment and
   reset it only after `exitI`.
3. Derive braking start from the installed longitudinal program and reject
   new defensive encroachment that begins after it.
4. Compare each new cover with the prior defender publication and one fixed
   committed-attacker publication to derive continuous `tEncroach`,
   `tDeadline`, `tConflict`, and `tAlongside`.
5. Reject second impeding moves and conflicts before the one-second deadline;
   preserve non-impeding movement and safety-only avoidance without granting
   authority.
6. Require exact racing room for current alongside, alongside reached at or
   before the deadline, and independently protected ownership; otherwise
   allow the covered optional side to close completely.
7. Add the narrowly scoped pre-turn-in contact-feasibility exception and
   displaced-publication cost treatment without weakening unrelated contact
   or safety checks.
8. Apply the same legality to any lateral defender reclaim and keep corner
   ownership independent.
9. Add only the focused Section 17 unit/scenario cases owned by this phase,
   then typecheck, check boundaries, and build the playable bundle.

M4 may not close unless:

- an already/timely alongside attacker keeps exact racing room;
- an attacker that reaches alongside only after the deadline can have its
  selected optional side closed completely;
- early publication followed by late encroachment fails the notice rule;
- a high closing-speed conflict inside one second is rejected;
- a new post-braking or second impeding move is rejected;
- a legal continuation and non-impeding change remain possible;
- the attacker reacts only at a real later slot, with zero response-program
  generation and zero same-slot tactical reopening.

Do not run population statistics or the final benchmark in M4. M5 will replace
the representation of these queries; M6 owns final population and performance
evidence after that dependency is complete.

### M5 — Analytic continuous internals

Sequence internally:

1. analytic longitudinal `(s, v²)` envelope;
2. continuous conflict/apex helpers;
3. compact analytic lateral segments;
4. direct segment publication;
5. controller consumption;
6. deletion of sampled authority made redundant by the preceding step;
7. branch-and-bound, geometry sharing, pooling/SoA/numeric identity, and pass
   fusion according to measured attribution.

After each representation tranche, run the focused standard scenes before
continuing. Do not change opportunity, ownership, or economic semantics to
make an optimization benchmark pass.

### M6 — Consolidation and handoff

1. Delete every superseded field, helper, counter, test, and comment.
2. Run `rg` audits for response/Q, renewal, off-slot publication, and duplicate
   authority.
3. Confirm module boundaries and determinism.
4. Run the focused comparison set.
5. Run the hot-loop benchmark because the evaluator/scheduler were changed.
6. Run `verify:fast` once for the coherent phase.
7. Run the full merge gate only when the implementation is otherwise done.
8. Build the playable bundle and provide a short user-facing comparison
   against `more`.

## 17. Focused behavioral contract

Add or preserve deterministic focused cases for:

### Launch and follow

1. `already-bound-open-side`
   - trusted leader;
   - faster follower;
   - binding at current progress;
   - open side corridor;
   - result: deliberate, not certified direct follow.

2. `staged-acquisition`
   - follower brakes safely behind while moving laterally;
   - no approach contact;
   - following constraint releases only after continuous body clearance.

3. `both-sides-physically-closed`
   - exact impossibility certificates on both sides;
   - result: direct follow with no maneuver candidates.

4. `equal-pace-economic-follow`
   - physically open side;
   - attempt spend exceeds position value;
   - follow wins without a cooldown.

5. `faster-behind-economic-attack`
   - positive measured pace differential;
   - staged side family is feasible;
   - attack can beat follow and complete.

### Sequential battle

6. `attack-defense-next-slot`
   - attacker publication cannot reopen the already processed leader;
   - leader sees it exactly at the next assigned slot;
   - leader evaluates one fixed attacker publication.

7. `defense-switchback-next-slot`
   - defender publishes a legal cover;
   - attacker later selects the opposite family;
   - no response tree or same-slot recursion.

8. `feint-no-defense`
   - rear car has no selected committed attack publication;
   - leader remains solo-equivalent.

9. `one-move-per-defender-corner`
   - the first impeding cover consumes the move for the defender/corner;
   - changing attacker, attacker revision, feint/abort, or ownership does not
     reset it;
   - a second impeding movement is infeasible;
   - crossing that corner's `exitI` permits one move for the next corner.

10. `post-braking-defense-rejected`
    - a newly initiated impeding move after braking starts is infeasible;
    - publishing before braking but beginning lateral encroachment after
      braking is also infeasible;
    - holding or continuing the already authorized envelope remains legal.

11. `non-impeding-and-safety-exceptions`
    - moving away, ordinary racing-line continuation, and other changes that
      do not reduce the attacker's corridor do not consume the move;
    - emergency avoidance may change direction but creates, expands, resets,
      and consumes no defensive commitment.

12. `defensive-notice-legal-closure`
    - first encroachment is continuous and physically observable;
    - first nominal conflict is more than one second later;
    - legal alongside is reached only after the deadline or never;
    - defender may close that selected optional side completely;
    - attacker responds only at its next assigned slot.

13. `sudden-defensive-block-rejected`
    - first nominal conflict is less than one second after encroachment;
    - the cover is infeasible, including when a large closing-speed
      differential caused the short interval.

14. `publication-time-does-not-manufacture-notice`
    - the cover is published early but physical encroachment begins late;
    - timing starts at encroachment, so a sub-one-second cut is rejected.

15. `already-alongside-racing-room`
    - measured legal side-by-side geometry exists when the defender moves;
    - the candidate must preserve the exact oriented separator and may not
      close that side.

16. `alongside-before-deadline-racing-room`
    - the fixed committed publication reaches legal alongside in less than
      one second;
    - the defender may cover only while preserving exact room from that event
      onward.

17. `alongside-after-deadline-side-closed`
    - the fixed committed publication cannot reach legal alongside until
      after the one-second deadline;
    - the defender may occupy the covered side fully without reserving a
      car-width lane there.

18. `notice-and-alongside-boundaries`
    - first conflict exactly one second after encroachment satisfies notice
      when alongside occurs later;
    - `tAlongside == tDeadline` is room-protected.

19. `authorized-defense-continuation`
    - a later publication inside the original selected cover envelope retains
      the commitment without a new move or notice interval;
    - expanding toward the attacker beyond that envelope is rejected.

20. `non-simultaneous-path-crossing`
    - geometric paths cross at different session times without a nominal
      separator violation;
    - no defensive-conflict exception or response work is opened.

### Ownership

21. `apex-owned-dive`
22. `shared-apex-room`
23. `leader-owned-rejection`
24. `defender-reclaim-next-slot`
25. `attacker-mistake-loses-current-authority`
26. `immutable-assertion-revocable-view`
27. `pre-turn-in-contact-without-defense-authority-rejected`
28. `defensive-closure-does-not-create-apex-ownership`
29. `reclaim-obeys-defensive-legality`
    - a reclaim that changes direction must also pass the one-move,
      pre-braking, notice, and conditional-room rules.

### Trains and multiple cars

30. `three-car-train-release`
   - a faster follower can leave an established train;
   - slowdown does not depend on 30 Hz tactical republishing.

31. `two-wide-third-car`
32. `three-wide-middle-two-constraints`
33. `empty-side-envelope-preserved`
34. `uncontrolled-occupancy-no-tactical-claim`

### Cadence and budgets

35. one tactical evaluation/publication per due car;
36. zero off-slot tactical mutation;
37. zero same-pass backward reopening;
38. zero nested response evaluations;
39. candidates `<= 6`;
40. materialized paths `<= 1`;
41. identical predicate inventory at 10 and 30 Hz predictive safety.

## 18. Diagnostics

Use bounded counters, including:

- tactical publications per car and off-slot publication attempts;
- deliberations and evaluator invocations per car/slot;
- direct-ideal and direct-follow decisions by exact proof reason;
- direct-follow attempts without two impossibility certificates;
- staged side candidates opened, rejected, selected, and cleared;
- time spent acquiring laterally while longitudinally constrained;
- committed attack views and defensive responses;
- defensive moves committed, continued, and reset at `exitI`;
- defensive candidates rejected by move-spent, post-braking,
  insufficient-notice, timely-alongside-room, ownership, and hard-safety
  reason;
- room-protected covers and fully authorized side closures;
- bounded minimum authored notice and first-alongside timing by outcome;
- authorized approach-conflict suffixes and any actual safety intervention
  before the attacker consumed the publication;
- switchback family changes;
- ownership assertions authored and current validation outcomes;
- defender reclaims and attacker-divergence invalidations;
- attack-transition, position-value, near-rub, and total selected `J`;
- single-file train length/duration and faster-car blocked time;
- safety-pass count and interventions by resolved interval;
- candidate/materialization maxima;
- nested response evaluations, required zero;
- same-slot tactical reopenings, required zero.

Diagnostics explain behavior. They may not move, reset, slow, or redirect a
car.

## 19. Verification discipline

Follow `AGENTS.md`:

- every edit: typecheck, boundary check, and directly touched unit tests;
- behavior iteration: one focused seeded scene rather than a statistical
  suite;
- end of coherent phase: `bun run verify:fast`;
- merge gate only: `bun run verify`;
- benchmark only after the hot scheduler/evaluator/analytic work;
- browser only for the setting UI/runtime integration;
- build at every playable handoff.

The user remains the primary racing-feel outer loop. Do not tune a constant to
make one seed imitate `more`. Preserve mechanisms and use comparisons to catch
lost behavior classes.

Population acceptance remains governed by the active metric policy and hard
invariants. In addition, the directional result must retain the qualitative
`more` behavior class:

- faster cars leave trains and attack;
- alternate lines appear before longitudinal overlap;
- side-by-side racing persists through corners;
- defenders react to real committed attacks;
- a legal pre-braking defense can fully close an optional side when the
  attacker cannot establish alongside inside one second;
- already/timely alongside attackers receive exact room, while late attackers
  must abort or use the exposed opportunity rather than reserve the closed
  line;
- switchbacks can emerge over consecutive slots;
- equal-paced cars do not battle continuously merely because space exists;
- battle time loss is visible in `J`;
- light rubbing is possible but persistent planned rubbing is disfavored;
- leaders remain solo-equivalent behind harmless rear cars.

## 20. Codex CLI handoff

Use this document itself as the implementation authority:

> Start from Golden Lap commit `011466d` (`more`). Read `AGENTS.md`,
> `racecraft_cost_function_plan.md`, its implementation report, and
> `racecraft_directional_planning_more_baseline_implementation_plan.md`.
> Treat the latter as the single implementation status and migration
> authority. Do not cherry-pick the `adv` implementation or assume its modules
> exist.
>
> Implement every phase completely. Preserve `more`'s dynamic inside/outside
> attacks, publication-backed defense, pace-weighted attack/defense economics,
> measured attempt loss, capability braking effort, and tow. Complete the
> one-move rule as specified here: one impeding move per defender/corner,
> physical onset before braking, immutable continuation lineage, and reset
> only after `exitI`. Replace symmetric snapshot/counterfactual response
> arbitration with one approximately 10 Hz front-to-back
> evaluate/install/publish pass. No car may be tactically reopened inside the
> same pass or simulate another car's future response.
>
> The opportunity gate must be false-negative safe. A follower may remain
> under the leader-safe longitudinal envelope while moving laterally; braking
> binding is not a deadline for side clearance. Direct follow without full
> evaluation requires exact impossibility certificates for both sides.
> Implement staged inside/outside candidates, next-slot publication-driven
> defense, emergent next-slot switchbacks, immutable apex-ownership assertions,
> and freshly derived consumer-local ownership views.
>
> Implement `defensiveBlockNoticeSeconds = 1.0 s` from physical lateral
> encroachment onset, not publication time. Against one fixed committed
> attacker publication, continuously derive first conflict and first legal
> alongside. Reject conflict before the deadline. Require exact racing room
> when the attacker is already alongside, reaches alongside at or before the
> deadline, or owns/shared the corner space; otherwise allow the defender to
> close the selected optional side completely and make the attacker react at
> its next real slot. Equality is room-protected. The closure creates no apex
> ownership and may not legalize a second move, moving under braking, or an
> unrelated-car conflict.
>
> Keep ordinary nominal contact infeasible only after constructing the correct
> staged candidate, with the scoped apex ownership/reclaim exceptions and the
> narrowly scoped post-notice pre-turn-in defensive-closure exception. Keep
> the hard separator at `PHYS.carWid` and add the specified soft 0.15 m
> near-rub cost. Do not charge an authorized displaced approach suffix back to
> the defender as planned rubbing. Add the session-fixed checkbox selecting
> the same predictive-safety algorithm at 10 or 30 Hz; no safety predicate may
> exist only at 30 Hz and safety may never choose tactics.
>
> Delete response programs, recourse/Q, residual response resolution,
> symmetric responsibility authority, incremental beta re-check, simultaneous
> staged publication, heartbeat renewal, and all tests/counters/state that
> exist only for them. Add no compatibility fallback, cooldown, or sticky
> intent replacement.
>
> Keep all cross-module APIs continuous and representation-agnostic. Only
> after the staged directional behavior and the complete defensive
> notice/conditional-room contract are green, implement the analytic `(s,
> v²)` envelope, continuous conflict/gate internals, compact lateral segments,
> direct publication/controller consumption, and lossless hot-loop
> optimizations. Preserve deterministic browser/headless parity, candidates
> `<= 6`, materializations `<= 1`, bounded scans, and the benchmark floor.
>
> Work phase by phase using the verification ladder in `AGENTS.md`. Build a
> playable bundle at each coherent handoff, continue with the next independent
> phase, maintain this document's single status table, and report deviations
> explicitly. Do not mark the plan complete if an already-bound faster
> follower with an open side corridor returns direct follow, if next-slot
> defense/switchback requires recursive response evaluation, if a late
> attacker permanently reserves an optional side, or if an already/timely
> alongside attacker can be squeezed by the notice rule.
