# Golden Lap — Racecraft Liveness, Legal Curbs, and Dynamic Corridor Plan

Status: ready for implementation

Plan date: 2026-07-15

Supersedes for all new racecraft work: `racecraft_optimization_plan.md`

Historical implementation evidence: `racecraft_optimization_implementation_report.md`

## Authority and baseline

This is the authoritative implementation plan for racecraft work after the
completed model-based optimization pivot. The previous optimization plan is
retained as history because its headless simulation, track profiles, optimizer,
bounded feasibility checks, statistical policy, and verification tiers were
implemented and remain useful. Its instructions to keep road-only paths or to
prefer the current fixed maneuver templates no longer govern new work.

The following implemented surfaces are the baseline and must be reused rather
than rebuilt:

- strict TypeScript modules and the Bun-built browser IIFE;
- production `TrackProfile`, semantic corners, `PathPlan`, and `SampledPath`;
- the global `botStep` path follower and production vehicle physics;
- pure headless single-car, focused-session, and full-race runners;
- bounded maneuver feasibility and decision diagnostics;
- corner-rights, blue-flag, qualifying-priority, and pit state records;
- the 10–20 minute new-track optimization workflow;
- invariant/normal/acceptable/target metric classification;
- deterministic, statistical, parity, browser, and production verification.

`racecraft_followup_plan.md` remains historical authority only for packaging,
module boundaries, browser compatibility, and functionality not contradicted
here. Do not reset or discard the current worktree. Reuse current implementation
that satisfies this contract and change only what the plan requires.

## Objective

Replace the remaining rail-like and occasionally non-live racecraft behavior
with a bounded, explainable local corridor planner while first correcting two
confirmed deterministic deadlocks:

1. qualifying cars can remain in pit egress forever and repeatedly reserve an
   old box crossing;
2. persistent corner rights can command a healthy car to zero speed because of
   a car that is already hundreds of metres away.

The completed system must let cars use the space that is actually available:

- follow the optimized ideal line in clean air;
- open corner entry, approach the apex, legally use a curb, and unwind on exit;
- select smooth attack, defence, and side-by-side trajectories from free space;
- retain protected racing room while two cars remain physically interactive;
- pass stopped or severely overslow obstacles on either available side;
- use a curb as ordinary legal racing surface;
- use limited grass/runoff only as an explicitly justified emergency escape;
- brake and stop when no collision-free path exists;
- rejoin progressively without crossing another car.

The goal is believable, visually smooth, deterministic-under-seed behavior with
fixed runtime complexity. It is not a general autonomous-driving stack or a
claim of globally optimal multi-agent racing.

## Fixed product decisions

These decisions are closed for the initial implementation:

1. Cars do not remain bound to one ideal line. The ideal profile is the clean-air
   attractor; active traffic may produce a different local trajectory.
2. Curbs are always legal where the track actually authors a curb. They are not
   emergency-only and may be used by the ideal line, attack, defence,
   side-by-side, yielding, priority passing, and obstacle avoidance.
3. The existing curb coefficients are the initial physical contract:
   `mu = 0.94` and `drag = 2.5`. Do not tune them before surface-aware paths and
   measurements exist.
4. An edge without an authored curb ends at the road edge. Physics, rendering,
   planning, and validation must use the same per-side curb availability.
5. Grass/runoff is not a normal overtaking surface. It becomes eligible only
   for a declared stopped/persistently overslow obstruction when no safe
   road-or-curb route exists and the bounded excursion plus rejoin is feasible.
   Authorization may prevent an imminent collision or bypass an otherwise
   persistent blockage; it may not be granted for an ordinary competitive pass.
6. Safety and rules are hard constraints. Progress, surface preference, and
   visual smoothness rank only already-safe candidates.
7. Corner rights protect lateral space; they do not grant a distant car an
   unconditional zero-speed authority over another car.
8. A pit reservation represents a current physical conflict and has one finite
   lifecycle. It is not a renewable lock tied forever to the owner's old box.
9. Runtime planning remains local, bounded, deterministic, and dependency-free.
10. `PathPlan` and `SampledPath` remain the only session-facing and
    controller-facing trajectory representations.
11. The global physical controller remains shared by every track. Do not hide
    planner defects with per-track controller constants.
12. A true impossible-state/liveness violation is red immediately. Plausible
    rates and timings continue to use normal and acceptable population bands.
13. Race contact counts use a normal band through 12 contacts and an acceptable
    band through 20. An individual race above 20 is surfaced immediately as an
    outlier, but count alone is not an impossible-state invariant. The aggregate
    population rate retains an absolute maximum of 30; illegal corridor
    crossings, non-finite state, stale locks, and other impossible causes remain
    separate fail-fast invariants regardless of contact count.

## Required outcomes

The implementation is complete only when all of the following are true:

1. Every pit-out car progresses monotonically from egress to travel to merge;
   no cleared car reacquires its old box reservation.
2. Sequential and overlapping qualifying releases on every track finish without
   an unexplained pit deadlock.
3. Corner-rights speed restrictions apply only while longitudinal interaction
   or a short-horizon collision remains physically relevant.
4. A healthy car cannot remain stationary on the racing surface because of a
   distant rights-holder or stale racecraft state.
5. Authored curbs are part of the legal normal trajectory envelope and carry the
   same small grip/drag penalty in physics, prediction, speed profiling, and
   optimization.
6. The clean-air optimizer may select a curb when its geometric benefit exceeds
   the surface penalty, while still completing the one-track workflow inside
   the existing 10–20 minute budget.
7. A bounded local planner produces smooth road/curb candidates from predicted
   free intervals for obstacle avoidance, attacks, defence, and protected
   side-by-side running.
8. A stopped or severely overslow car can be passed when a collision-free
   road, curb, or authorized runoff route exists.
9. Cars do not oscillate between sides, weave repeatedly under one defensive
   response, or snap back to the ideal line after passing.
10. No runtime update evaluates more than six candidates for one car, and only
    the selected candidate is materialized as a full sampled path.
11. Existing blue-flag, qualifying-priority, pit, collision, recovery, wet,
    classification, file-launch, and browser-test contracts remain valid.
12. Deterministic invariants are red-free and stochastic outcomes are classified
    using the existing normal/acceptable/absolute policy.

## Non-goals

The initial implementation does not include:

- reinforcement learning or a neural policy;
- global A*, graph search, or whole-track live replanning;
- a full nonlinear model-predictive controller;
- per-candidate production-physics rollouts at runtime;
- an unbounded continuous optimizer inside the game loop;
- a general polygon-clipping or computational-geometry engine;
- per-track racecraft or controller constants;
- a per-wheel suspension or tyre-contact model;
- team strategy or game-theoretic multi-lap planning;
- intentional routine overtaking through grass;
- guarantees that all racing contacts disappear.

Plausible errors and contacts may occur inside registered distributions. A
planner-selected path through a known occupied envelope, stale lock, impossible
state, non-finite trajectory, or permanent unexplained stop is never merely a
statistical outlier.

## Confirmed defects and reproduction evidence

### Qualifying pit-egress lock

`src/session/pit.ts` currently branches on
`entry.pitPhase === 'egress' || w < egressEnd`, returns `egress` from that
branch, and `src/session/entry.ts` writes the returned phase back. A car that
started egress therefore remains egress after clearing the geometric end. It
releases its claim near the end, calls the same branch on the next update, and
can reacquire the original box reservation.

Reservations span a wider longitudinal range than the 10 m box spacing, which
is reasonable while adjacent crossings are physically active but becomes a
deadlock when the owner continually renews a cleared claim. The separate
feasibility speed cap can also command zero for the same stale reservation, and
qualifying launch code may move a car rearward from its actual box into another
claim.

Production-session reproduction, seed 1 at approximately 444.708 s:

- BRA owned `egress:BRA`, approximately `w = 81..103`;
- GIR at approximately `w = 93.04` and MER at `w = 112.60` were held at
  `vCap = 0` with BRA as reservation owner;
- there were no collisions at the snapshot.

This is a state/reservation liveness bug, not an unfortunate traffic sample.

### Healthy cars stopped by corner rights

`src/session/racecraft/corner-rights.ts` retains a record until both cars pass
track-out. Its low-speed zipper applies a zero speed cap when lateral corridors
are closing, but it has no longitudinal-overlap or reachability gate. Once one
car gets far ahead and the trailing car slows before track-out, the zero cap
prevents the trailing car from reaching the release marker. Followers then
correctly brake for the new obstacle and a queue forms.

Production-race reproduction, Prado seed 1 at approximately 44.808 s:

- MER was healthy and stopped at approximately `s = 985.76` before track-out at
  `s = 1021.74`;
- the other car in the active rights pair was at approximately `s = 1211.78`;
- MER had no failure, recovery, off-course, or pit state;
- other cars subsequently stopped behind the artificial obstacle.

This is an unconditional authority/release feedback loop, not random damage.

### Planned paths cannot currently use rendered curbs

The physics defines road, curb, and grass and already gives curb a small
penalty. Rendering authors curb polygons only at selected corner samples, from
roughly `hw - 0.25` to `hw + 1.15`. Physics currently treats a generic lateral
band as curb even where no curb polygon exists, while path construction and
feasibility clamp planned car centres well inside the road. The three systems
therefore disagree.

The successor must make authored surface geometry the common authority. Merely
relaxing one road-bound check is insufficient.

## Design principles

### Liveness before optimization

First remove self-latching states and unconditional zero-speed authorities.
Dynamic planning must not be used to route around a broken state machine.

### One owner for each command

- Pit motion owns pit phase and pit progress speed caps.
- Corner rights own competitive corridor constraints.
- Priority records own blue-flag and qualifying preference.
- The corridor planner owns local trajectory selection.
- Feasibility validates and explains; it must not independently recreate a
  second conflicting state machine.
- The controller follows the selected path and speed envelope.

### Geometry and predicted occupancy before magic numbers

Use car extents, authored road/curb boundaries, current speed, braking ability,
prediction uncertainty, and collision horizon. Any remaining calibration value
must have a name, unit, bounded range, one owner, and a sensitivity result.

### Discrete topology, continuous-looking motion

Choose a stable topological intent such as hold, follow, pass left, or pass
right. Then form one smooth trajectory through the selected free corridor.
Do not use a pure attractive/repulsive potential field: it can oscillate, become
trapped by symmetric forces, and change sides without commitment.

### Hard constraints before preferences

Reject illegal or unsafe candidates first. Among survivors, rank progress/time
loss, surface exposure, continuity, and smoothness. No weighted score may trade
a collision or protected-corridor crossing for lap time.

### Search only when interaction requires it

Clean-air cars retain the stored ideal profile. Full local search is for active
traffic, priority, side-by-side, or obstacle episodes. Selected paths are
committed and reused until geometry changes materially.

### Diagnostics before tuning

Every zero speed cap, rejected candidate, state wait, emergency surface grant,
and path switch must identify its owner and reason. Do not respond to an opaque
failure by adjusting unrelated parameters.

## Target architecture and ownership

The exact file split may move a pure helper to an adjacent core module, but
ownership must remain equivalent and module boundaries must remain acyclic.

```text
src/core/model.ts
  surface-map and path metadata types

src/core/surface.ts (new, or one equivalent pure core owner)
  authored road/curb limits, footprint exposure, legal envelopes

src/core/track.ts
  build per-sample/per-side curb availability from the same authoring used by rendering

src/core/physics.ts
  authoritative road/curb/grass coefficients

src/core/physics-engine.ts
  sense the shared surface map and apply effective surface coefficients

src/core/racing-line.ts
  surface-aware line materialization and analytical speed envelope

src/core/autopilot.ts
  unchanged global path follower except for consuming the selected speed authority

src/session/pit.ts
  finite pit phases, physical reservation lifecycle, wait diagnostics

src/session/entry.ts
  apply pit plan; do not reposition launches into another box region

src/session/racecraft/corner-rights.ts
  persistent lateral rights, longitudinally relevant speed intervention, release

src/session/racecraft/corridor-planner.ts (new)
  free-interval construction, topology search, compact candidate generation/ranking

src/session/racecraft/paths.ts
  PathPlan sampling, winning-path materialization/cache, smooth rejoin

src/session/racecraft/feasibility.ts
  bounded hard-constraint prediction and diagnostics

src/session/racecraft/traffic.ts
  obstacle assessment, intent arbitration, planner cadence, commitment

src/session/racecraft/priority.ts
  blue/quali constraints and release; no trajectory implementation

src/session/racecraft/config.ts
  only globally owned, dimensioned calibration values

src/game/headless-sim.ts
  liveness, surface, obstacle, battle, and full-race characterization

src/data/track-profiles.ts
  regenerated surface-aware profiles and updated provenance

tools/optimize-track.ts
  include surface-aware search and keep the 10–20 minute contract

tools/benchmark-sim.ts
  planner-specific and full-session runtime/allocation measurements

tools/run-statistical-suite.ts
  new liveness, curb, emergency, avoidance, and battle populations
```

New focused tests belong under existing `tests/unit/core`,
`tests/unit/session`, and `tests/unit/tools` ownership. Browser scenarios extend
the existing browser harnesses rather than creating a second UI test system.

## Shared surface contract

### Authored geometry

Track construction must expose, for every centreline sample and each side:

- road outer edge;
- whether a curb is authored;
- curb inner and outer edges when present;
- the normal legal outer edge (`road` or `curb`);
- the emergency outer bound when runoff is authorized.

Rendering and physics must consume this same metadata. `track.curbs` may retain
render polygons, but they must be derived from or carry the same sample and side
identity used by sensing and planning. Remove the current situation in which
rendering has intermittent curbs while physics assumes a continuous curb band.

### Vehicle envelope and legality

Path legality is based on the car's lateral envelope, not only its centre:

- without a curb, the predicted outer envelope must remain inside the road edge;
- with a curb, it may extend to the authored curb outer edge;
- prediction uncertainty is added once by feasibility, not duplicated as
  unrelated construction margins;
- normal candidates with grass exposure are rejected;
- emergency candidates may use only their explicitly granted runoff envelope.

Replace duplicated `hw - 1`, `hw - 1.6`, `hw - 2`, and `hw + 1.3` policy
constants with shared queries. Numerical lookup tolerance may remain separate
from legal geometry and must never silently enlarge the legal surface.

### Effective surface penalty

Use a deterministic footprint-overlap approximation across the car width to
derive road, curb, and grass exposure at a sample. This is not a per-wheel
model. Blend effective grip and drag from the exposed fractions so a tyre first
touching a curb does not cause a discontinuous full-car coefficient change.

The same effective coefficients must inform:

- production physics;
- local candidate controller-demand and speed prediction;
- `speedProfile` and clean-air line evaluation;
- track-profile optimization and validation;
- diagnostics and statistical reporting.

The initial curb values stay fixed at `mu = 0.94`, `drag = 2.5`. Grass retains
its existing strong penalty. Any later coefficient change requires a registered
sensitivity study and held-out validation, not visual guesswork.

### Profile provenance

Surface-map geometry and surface coefficients are profile inputs. Add them to
the profile fingerprint/provenance and bump the schema if required. Existing
profiles must fail freshness validation rather than silently using road-only
timing. Regenerate every built-in track through the existing workflow.

## Pit finite-state and reservation contract

### Phase progression

For a pit-out car, geometry and physical clearance determine forward-only phase
transitions:

| Current region | Required phase | Exit condition |
|---|---|---|
| stopped in assigned box | stopped-box | service complete and release claim granted |
| crossing from box toward lane | egress | rear envelope clears the crossing region |
| established in travel lane | travel | reaches merge approach |
| pit-exit approach | merge | merge completes and state becomes run |

`pitPhase === 'egress'` may describe current state but may not, by itself, keep
the car in egress after the geometric exit condition. Once travel begins, that
car is ineligible to reacquire its old box-egress reservation.

### Reservation lifecycle

An ingress or egress reservation:

1. is requested before crossing a conflicting lane;
2. names one physical conflict interval and owner;
3. is renewed only while the owner remains committed to or physically occupies
   that crossing;
4. releases after the owner's rear envelope clears it;
5. cannot be recreated by a later travel/merge phase;
6. expires if the owner becomes inactive or abandons the maneuver;
7. reports wait reason, owner, age, and progress.

Overlapping adjacent reservations may serialize two real crossings. They may
not block a car that has already physically passed its own crossing.

### Launch and speed authority

- Launch a qualifying car from its assigned box coordinate.
- If release is unsafe, hold it in the box and request release normally.
- Do not shift its longitudinal spawn backward through other teams' box regions.
- `planPitMotion` owns the pit progress speed cap and declared waits.
- Feasibility may reject invalid geometry or report a reservation conflict, but
  must not add a second stale zero-speed lock for the same state.
- The deadlock watchdog remains diagnostic. Do not teleport a car to conceal a
  failed state transition.

## Corner-rights liveness contract

Corner rights and speed negotiation are separate responsibilities:

- The rights record preserves assigned inside/outside corridors from acquisition
  through the normal physical release.
- Both cars continue to receive their protected paths even when one is ahead.
- A zipper/convergence speed intervention is eligible only when longitudinal
  body envelopes overlap or are predicted to overlap inside the bounded horizon.
- A zero cap is eligible only when positive movement would immediately violate
  a physical occupied envelope. Lateral closeness alone is insufficient.
- Once forward clearance exists, the trailing car receives a finite positive
  progress envelope and may reach track-out while retaining its corridor.
- The normal release remains both cars past track-out plus the registered
  physical-clearance hold.
- A failure, recovery, off-course event, or persistent declared obstacle ends
  competitive rights with an explicit incident/obstacle release reason.

The update must use existing wrap-aware projected body clearance. Do not add a
hand-tuned distance whose only purpose is to make the reproduced seed pass.

## Dynamic corridor planner

### Planner role

The planner converts an intent plus hard constraints into a small collection of
compact `PathPlan` candidates. It does not replace behavior intent, rule state,
the controller, or clean-air profile optimization.

Add an explicit `obstacle-avoid` `PathMode`. Its compact plan/decision metadata
must include the obstacle code, topology (`left`, `right`, or `brake`), and
surface authorization (`normal` or `emergency`). Attack, defence, rights, and
priority plans retain their existing semantic modes. Do not encode emergency
authority in an opaque timer or infer it later from lateral position.

Intent priority is:

1. unavoidable physical safety, failure recovery, and pit physical constraints;
2. valid competitive corner rights;
3. blue-flag and qualifying preference;
4. obstacle avoidance;
5. attack or defence;
6. follow/ideal.

Emergency avoidance may end rights involving a newly declared obstacle, but it
may not silently cross an unrelated healthy car's protected corridor. If no
safe authorized path exists, braking is the correct result.

### Prediction stations and free intervals

Reuse the current fixed short horizon (initially 2.4 s) and 12 prediction
samples. At each station:

1. project the ego car along its current speed/braking envelope;
2. obtain the legal lateral interval from the shared surface map;
3. intersect it with any protected rights or priority corridor;
4. project nearby cars' committed paths and conservative body envelopes;
5. subtract occupied intervals and prediction uncertainty;
6. retain the resulting free interval components.

Only nearby entries whose longitudinal envelopes can interact inside the
horizon participate. Use the existing longitudinal ordering/spatial data; do
not compare every car against every full-track sample.

### Topology and candidate bound

Connect free intervals through the horizon with a narrow deterministic beam.
The initial topologies are:

- hold/continue or follow/brake;
- pass left;
- pass right.

Keep at most the best candidate per topology and a beam width no greater than
four. Normal road/curb candidates are evaluated first. If all progress routes
are infeasible and collision prediction justifies emergency authority, add at
most left runoff, right runoff, and brake candidates. Across all stages, never
record or evaluate more than six candidates for one car in one traffic update.

### Compact sampling and materialization

Candidate search must not allocate a full-track `SampledPath` for every option.

1. Generate sparse anchors/gates in the existing `PathPlan` representation.
2. Add a pure bounded sampler that evaluates the compact plan at prediction
   stations using the same interpolation semantics as materialization.
3. Unit-test sampled compact offsets against the materialized winner.
4. Run feasibility and ranking on compact samples.
5. Materialize and cache only the selected candidate.

The current path materializer and global controller remain the production
trajectory and control authority. If the existing interpolation passes the
continuity/visual gates, do not add a second spline engine. Optional tangent
metadata is allowed only after a measured continuity failure proves it needed.

### Feasibility and selection

Hard-reject a candidate for:

- non-finite or non-forward geometry;
- normal-path grass exposure or exceeding the authorized emergency envelope;
- predicted occupied-envelope penetration without a safe braking resolution;
- protected-corridor or priority-path violation;
- pit crossing/merge conflict;
- controller demand outside the acceptable envelope;
- a rejoin that crosses an occupied path;
- a surface authorization inconsistent with its intent.

Rank feasible candidates lexicographically:

1. expected progress or time loss appropriate to the intent;
2. road/curb/runoff exposure, preferring road but allowing useful curb;
3. continuity with the committed topology and path;
4. lateral acceleration/jerk and controller margin;
5. stable deterministic candidate id.

Do not collapse safety, progress, and surface legality into one opaque weighted
sum. A curb may win over road when its geometric benefit is real; grass may not
win without emergency authorization regardless of time gain.

### Cadence, commitment, and coordination

- Traffic safety validation remains at 30 Hz.
- Full candidate generation runs at most 10 Hz for an interacting car, or
  immediately when its current path becomes infeasible or a higher-priority
  state activates.
- Clean-air cars do not search.
- Retain the current short commitment guard initially; a committed path remains
  until completion, infeasibility, or higher authority.
- Publish committed paths so later decisions predict them.
- Use deterministic entry order and stable tie-breaking.
- Do not switch pass side merely because two candidates exchange a small score
  advantage.

## Obstacle and emergency-avoidance contract

### Obstacle assessment

Replace the current absolute slow-car heuristic with an explicit assessment
that records reason and predicted consequence. A car is an obstacle candidate
when one or more are true:

- failure, off-course, unstable, or active recovery state;
- effectively stationary on or crossing the racing surface;
- relative closing and predicted braking demand imply the normal following
  solution cannot remain inside the safety envelope;
- speed is materially below the local path expectation and the ego car will
  reach it within the prediction horizon.

A legitimately slow car negotiating a slow corner is ordinary traffic unless
closing prediction makes it an actual obstruction. Persist non-incident
classification briefly before granting emergency authority so one noisy speed
sample cannot authorize leaving the legal surface.

### Route hierarchy

For a declared obstacle:

1. search both sides inside road plus authored curb;
2. if a normal route is safe, use it;
3. otherwise retain safe braking as the mandatory fallback;
4. for an imminent collision or a persistent declared obstruction that would
   otherwise leave traffic blocked, search limited runoff/grass;
5. choose runoff only when the complete excursion and rejoin are safer than the
   registered obstruction-bypass envelope requires;
6. if no bypass candidate is safe, brake/stop rather than force a pass.

Emergency grass expansion is the minimum lateral extent required to clear the
obstacle envelope and is capped to one car width beyond the normal outer
surface unless future track metadata explicitly provides a smaller runoff or
barrier. Every grant records either `collision-avoidance` or
`obstruction-bypass`. It is not an invitation to shortcut a corner.

### Passing and rejoining

- Commit to one side until the ego rear envelope has cleared the obstacle front
  plus prediction uncertainty.
- Account for other cars already committed to the same escape route.
- Apply surface-aware speed and controller limits throughout the excursion.
- Begin rejoin only when the target road/curb interval remains free over the
  prediction horizon.
- Rejoin with a bounded lateral transition; never snap to the ideal line.
- End emergency authorization after full legal-surface re-entry and clearance.
- Record obstacle, selected side, surface exposure, minimum separation, and
  rejoin reason.

## Competitive racecraft integration

### Attack

The attack intent requests free-space candidates rather than one fixed lateral
percentage. The planner may select either side based on predicted progress,
surface availability, braking geometry, and committed occupancy. Once a side
is committed, hysteresis prevents a late weave unless that path becomes unsafe.

### Defence

Defence remains one legal response to one attack sequence. The planner chooses
a feasible defensive corridor before the braking/turn-in commitment boundary.
It may use an authored curb but may not use grass, cross an occupied envelope,
or make a second reactive move.

### Side-by-side

Persistent inside/outside assignments remain the hard legal intervals. The
planner chooses a smooth path within each assignment using the actual free
space and curb availability. It cannot optimize one car through the other's
protected corridor. Three-wide allocation continues only when all three
physical envelopes fit; otherwise the designated trailing attempt tucks.

### Priority traffic

Blue-flag and qualifying records continue to decide who yields and when.
The planner finds the least-loss safe path inside that rule decision. A priority
beneficiary receives a compatible pass corridor; neither path may cross at the
same predicted time. Pit-entry commitment remains higher than a discretionary
yield location.

## Diagnostics and liveness monitoring

Every active entry must expose, through session diagnostics and the existing
test API where appropriate:

- current intent, topology, path mode, and commitment age;
- every evaluated candidate and hard rejection reason;
- predicted minimum longitudinal/lateral/Euclidean separation;
- road, curb, and grass exposure estimate;
- selected speed-cap value, owner, and reason;
- active rights/priority/pit reservation owner and release condition;
- obstacle classification, side choice, and emergency authorization;
- stationary duration and declared cause;
- compact-planner and materialization timing/counters.

Add an unexplained-stall diagnostic. It activates only after a car remains below
the registered crawl threshold for the registered grace period while excluding
grid/countdown, pit box/declared pit wait, physical nearby blockage, failure,
incident/recovery, off-course recovery, finish, and deliberate safe braking for
an occupied envelope. A recorded unexplained stall is an invariant failure.

Do not automatically move or reset the car when this diagnostic fires.

## Verification policy

### Hard invariants — zero tolerance

The following are true bugs and fail on the first occurrence:

- pit-out egress persists after the rear envelope clears its egress region;
- a travel/merge car owns or reacquires its former box reservation;
- an active pit reservation has no committed/physically relevant owner;
- a finite pit wait has no possible state transition after its owner clears;
- a distant non-interacting rights-holder produces a zero speed cap;
- a healthy running car records an unexplained stall;
- a planner selects a path through a predicted occupied envelope when a safe
  rejection/braking outcome was available;
- a normal candidate exposes the car envelope to grass;
- an emergency candidate has no recorded collision-avoidance or persistent-
  obstruction-bypass justification;
- a path crosses an unrelated protected corridor;
- a car rejoins through an occupied predicted interval;
- candidate, path, speed, surface, or diagnostic values are non-finite;
- more than six candidates are evaluated for one car/update;
- more than one full candidate path is materialized for one selection event;
- physics, renderer, planner, and validator disagree about authored curb
  availability at a sampled location;
- a stored profile has stale surface geometry or coefficient provenance.

### Normal and acceptable distributions

These are population outcomes, not single-sample invariants:

- lap-time residual by track/weather/driver stratum;
- curb exposure distance and frequency;
- emergency grass excursion frequency, duration, and maximum extent;
- attack frequency, pass attempt rate, pass success, and time-to-complete;
- defence frequency and added time loss;
- side-by-side duration and clearance;
- obstacle clearance time and follower delay;
- pit release delay and queue duration when a real conflict exists;
- contact, spin, recovery, and DNF rates;
- blue-flag and qualifying-yield time loss;
- planner search frequency, candidate rejection mix, and selected topology;
- controller-demand and minimum-separation quantiles.

Each metric must name its population, unit, aggregation, sample minimum, normal
band, acceptable band, absolute bound if any, and rationale in the existing
machine-readable policy. An excursion outside normal but inside acceptable is
amber and does not fail. Absolute safety/liveness violations remain red even in
a small sample. For race contacts specifically, `0–12` is normal, `13–20` is
acceptable, and an individual result above 20 emits an outlier event while the
registered aggregate rate—not a single race—is compared with the absolute 30
boundary.

### Deterministic scenario matrix

At minimum, add scenarios for:

Pit:

- an egress car just before, exactly at, and just after clearance;
- two adjacent simultaneous releases in both entry orders;
- sequential qualifying launches for all teams on every track;
- a car already ahead of its own crossing while an earlier box is occupied;
- same-team queue, foreign stopped box, through-lane traffic, and merge traffic;
- stale/abandoned owner cleanup without teleportation.

Corner rights:

- low-speed longitudinal overlap requiring a real stop;
- leader physically clear while trailer remains before track-out;
- leader 100+ m ahead with the trailer allowed positive progress;
- both cars naturally drive through track-out and release after the hold;
- linked complexes, wraparound, order flip, wet, and three-wide cases;
- failure/obstacle transition releases competitive rights explicitly.

Surfaces:

- authored inside and outside curb are legal for normal paths;
- an uncurbed edge rejects the same outside-road path;
- footprint exposure blends road/curb grip continuously;
- normal grass exposure is rejected and emergency exposure is authorized;
- candidate speed/controller demand reflects curb grip;
- ideal profile may use a useful curb and remains stable dry/wet;
- render/physics/planner sample maps match.

Obstacle avoidance:

- stopped centre car with both road sides free;
- one side blocked, forcing the other side;
- road blocked but authored curb route free;
- road/curb blocked and a justified runoff route free;
- no route free, requiring collision-free braking;
- multiple followers and committed escape paths;
- obstacle inside an active battle/rights episode;
- slow legitimate cornering that must not trigger emergency authority;
- progressive rejoin with traffic beside and behind.

Competitive planning:

- attacks from both sides on straights and every corner phase;
- defence before and after its legal commitment boundary;
- dry/wet and road/curb alternatives;
- side-by-side inside/outside routes through isolated and linked corners;
- priority yield/pass with curb availability and pit-entry interaction;
- commitment stability under nearly equal left/right scores.

## Performance and complexity budget

Before behavior changes, rerun and freeze the current benchmark on the reference
machine. The successor has these hard architectural limits:

- one physics implementation and one path representation;
- no new runtime dependency;
- 30 Hz safety validation;
- at most 10 Hz full local search per interacting car;
- zero search for clean-air cars;
- 12 prediction samples over the existing short horizon initially;
- beam width at most four;
- at most six evaluated candidates per car/update;
- only the winner receives full-track materialization;
- nearby interacting vehicles only;
- one global planner/controller calibration surface.

Acceptance performance gates:

- focused planner benchmark reports p50/p95 and allocation counts for 1, 2, 6,
  12, and 22 interacting cars;
- full-grid headless throughput remains at least 80% of the frozen pre-change
  baseline;
- browser frame-time p95 regresses by no more than 10% on the reference machine
  and retains the existing real-time target;
- no sustained per-traffic-update allocation growth or cache growth with race
  duration;
- the new-track default workflow finishes within 15 minutes and never exceeds
  the supported 20-minute hard deadline;
- all performance reports include environment, warmups, samples, p50, p95, and
  raw artifact paths.

Performance failures trigger simplification; they never justify removing a
safety or liveness invariant.

## Implementation phases

### Phase 0 — Freeze successor baseline and reproductions

1. Record Git/worktree state and preserve all existing changes.
2. Run typecheck, module boundaries, unit/invariant suites, headless parity,
   current fast statistics, current benchmark, and available browser smoke.
3. Add deterministic diagnostic reproductions for the pit and race stalls
   without changing behavior; record the expected failures and causal cap owner.
4. Capture current curb masks, physics classification, road bounds, profile
   fingerprints, and representative visual frames.
5. Register successor metrics and scenario identifiers without weakening any
   existing invariant.

Exit gate:

- both reported bugs reproduce through production session code;
- their zero-speed/reservation owners are explicit;
- baseline performance and behavior artifacts are stable and seeded;
- unrelated existing failures, if any, are separated from successor work.

Simplification gate: if a full browser is unavailable, use production headless
state plus the existing browser artifacts for baseline and record the missing
visual environment. Browser verification remains mandatory before final release.

### Phase 1 — Correct pit liveness

1. Add geometry-boundary unit tests for egress completion.
2. Remove the self-latching egress predicate and encode forward-only transition
   guards.
3. Tie reservation renewal/release to committed physical occupancy.
4. Prevent post-egress reacquisition.
5. Launch from the assigned box and hold there when release is unsafe.
6. Remove duplicate reservation speed authority while retaining diagnostics and
   feasibility rejection.
7. Run adjacent, sequential, all-team, all-track, merge, and queue scenarios.

Exit gate:

- all pit deterministic scenarios finish;
- no egress/travel/reservation invariant fires;
- deliberate queues retain correct owner/reason and clear naturally;
- no teleport or longitudinal spawn displacement is introduced;
- unrelated pit timing remains within acceptable bands.

Simplification gate: if reservation geometry needs later refinement, first ship
the finite phase transition and no-reacquisition rule while retaining the
current conservative overlap. Do not redesign all pit geometry to fix a stale
state.

### Phase 2 — Correct corner-rights liveness

1. Add far-leader/blocked-trailer and natural-drive-through regressions.
2. Gate zipper speed intervention by projected longitudinal overlap/reachability.
3. Restrict exact zero to immediate physical conflict.
4. Allow finite forward progress once clearance exists without dropping the
   protected lateral path.
5. Add explicit obstacle/incident release reason where competitive rights end.
6. Add unexplained-stall diagnostics and seeded full-race liveness checks.

Exit gate:

- the reproduced Prado stop cannot recur;
- nearby low-speed pairs remain collision-safe;
- far-separated rights pairs cannot command zero;
- both cars naturally reach track-out and release;
- existing rights, three-wide, linked-corner, and wet invariants remain green.

Simplification gate: if a positive crawl controller branch is unnecessary after
longitudinal gating, omit it. The minimum correction is the physically relevant
cap gate, not a new low-speed controller.

### Phase 3 — Unify surfaces and make curbs legal

1. Introduce the shared per-sample/per-side surface map.
2. Generate render curb polygons and planner/physics curb availability from the
   same source.
3. Replace duplicated lateral policy bounds with envelope queries.
4. Add footprint exposure and effective grip/drag.
5. Make path construction, feasibility, controller-demand prediction, and speed
   profiles surface-aware.
6. Permit every normal path mode to use an authored curb.
7. Keep grass forbidden without emergency authorization.
8. Add surface geometry/coefficient provenance to profiles.

Exit gate:

- surface agreement invariants pass on every sample of every track;
- normal candidates can use authored curbs and cannot use uncurbed grass;
- physics response is continuous at road/curb contact within the declared
  footprint approximation;
- dry/wet single-car laps are stable;
- curb coefficient changes are not introduced without evidence.

Simplification gate: if fractional footprint blending materially expands scope,
use one shared conservative centre/envelope classification for the first pass,
but physics, planner, optimizer, and validation must still agree. Do not keep
separate boundary constants.

### Phase 4 — Add the bounded corridor-planner core

1. Add compact `PathPlan` sampling equivalent to materialization.
2. Build legal/free intervals from surface and rule constraints.
3. Project nearby committed occupancy at the existing 12 stations.
4. Connect hold/left/right interval topologies with a bounded beam.
5. Implement hard rejection and lexicographic ranking.
6. Materialize/cache only the winner and record allocation/timing counters.
7. Add deterministic ordering, commitment, and side-switch protection.
8. Benchmark worst-case 22-car interaction before integrating new behaviors.

Exit gate:

- compact samples agree with winner materialization;
- candidate and beam bounds are hard-green;
- every decision is reproducible and reasoned;
- existing controller follows selected plans without target discontinuity;
- headless/browser performance remains within budget.

Simplification gate: if compact sampling cannot meet the materialized path
within tolerance, evaluate at most three locally materialized candidates at a
lower replanning cadence as a temporary measured fallback. Never materialize six
full paths at 30 Hz. Do not add a second trajectory representation.

### Phase 5 — Integrate stopped/overslow obstacle avoidance

1. Replace the opaque slow-obstacle predicate with reasoned assessment.
2. Generate road/curb left/right routes and safe-brake fallback.
3. Add emergency authorization only after normal routes fail and either an
   imminent collision or a persistent declared blockage justifies it.
4. Add bounded runoff candidates using shared surface exposure.
5. Coordinate multiple followers through committed path prediction.
6. Hold pass topology through physical clearance and perform a checked rejoin.
7. Integrate failure, recovery, and rights release without suppressing hard
   protected corridors for unrelated cars.

Exit gate:

- every deterministic obstacle scenario selects the expected safe topology;
- a pass occurs whenever a feasible route exists;
- braking occurs when no safe route exists;
- emergency grass use always has a recorded justification and bounded extent;
- no rejoin crossing or unexplained follower queue occurs;
- false obstacle classification remains within its registered acceptable band.

Simplification gate: if general runoff handling is not yet safe, restrict grass
authorization to deterministic stopped-car cases with a fully free rejoin and
retain road/curb plus braking for overslow traffic. Do not authorize routine
grass passing to satisfy an overtake-rate target.

### Phase 6 — Integrate dynamic attacks, defence, and side-by-side paths

1. Route attack intents through free-space left/right candidates.
2. Route defence through one legal committed corridor.
3. Use rights assignments as hard intervals while allowing useful curb.
4. Preserve three-wide feasibility/tuck rules.
5. Route blue/quali priority through compatible yield/pass intervals.
6. Compare visual and population behavior against fixed-template controls.
7. Remove a fixed template only after the dynamic replacement passes its
   deterministic and acceptable-band gates.

Exit gate:

- path modes visibly respond to actual available space;
- opening, apex, and exit behavior remains natural in clean and contested laps;
- side-by-side room violations remain zero;
- no repeated defensive weaving or left/right oscillation occurs;
- pass/contact/time-loss populations are normal or acceptable;
- performance remains within budget.

Simplification gate: if fully dynamic competitive planning adds cost without a
measurable visual/safety benefit, retain dynamic planning for obstacles and use
the free-interval planner only to project existing attack/defence/rights anchors
into safe available corridors. Document the measured decision; do not fall back
to blind fixed offsets that cross occupancy.

### Phase 7 — Re-optimize and validate track profiles

1. Bump/fingerprint surface-aware profile inputs.
2. Update the safe baseline heuristic to permit useful authored curbs.
3. Run the one-track workflow for every built-in track with the existing
   deadline and deterministic seed policy.
4. Validate road/curb exposure, stability, controller demand, line semantics,
   and dry/wet robustness.
5. Re-run the cold new-track fixture at 10, 15, and 20 minute budgets or the
   existing equivalent bounded proof.
6. Commit only profiles whose provenance and validation are current.

Exit gate:

- every profile is fresh and surface-aware;
- every track completes stable dry/wet laps;
- curbs may be selected but grass exposure remains zero in clean-air profiles;
- the normal workflow finishes within 15 minutes and hard-stops by 20;
- fallback profile behavior remains safe when a profile is missing/stale.

Simplification gate: if surface-aware broad search exceeds budget, keep the same
decision variables and use analytical surface penalties in the broad stage;
reserve production surface physics for finalists. Reduce evaluations before
adding a more elaborate optimizer.

### Phase 8 — Population calibration, visual review, and release

1. Run targeted unit/invariant suites after every phase.
2. Run deterministic parity, profile validation, and browser smoke.
3. Run fast statistics during iteration, normal held-out statistics before
   integration, and the release population once configuration is frozen.
4. Review 1x and slow-motion captures for each track: clean line, curb use,
   attack, defence, side-by-side, priority, obstacle/runoff, rejoin, and pit flow.
5. Run the planner/full-grid/browser performance gates.
6. Update implementation report, release manifest, workflow documentation, and
   diagnostics reference.
7. Do not calibrate on validation/release seeds.
8. Every long-running race, statistical, optimizer, benchmark, and browser
   audit emits machine-readable phase/case progress as it runs. Abort as soon as
   a hard invariant is observed or a required median gate is mathematically
   unrecoverable; distribution warnings continue so the population is not
   censored.

Exit gate:

- all deterministic invariants and compatibility checks pass;
- no release metric is red or inconclusive;
- amber results are explained and remain inside acceptable bounds;
- browser visuals show smooth committed trajectories and legal curb use;
- no unexplained stalls or pit deadlocks occur in the locked release population;
- performance and 20-minute workflow contracts pass;
- the implementation report records every simplification gate taken or rejected.

## Mandatory review and pivot gates

After each phase, record:

- files and architectural surfaces added;
- behavior before/after with seeded evidence;
- invariants added and their owners;
- runtime/allocation delta;
- stochastic metrics affected;
- whether the preferred solution met its gate;
- whether the required simplification was applied.

Stop and simplify when:

| Proven condition | Required response |
|---|---|
| A root bug is fixed by a finite state/authority correction | Do not redesign the whole subsystem. |
| Candidate materialization dominates runtime | Sample compact plans and materialize only the winner; reduce cadence before changing physics. |
| Full dynamic battle planning gives no material visual/safety improvement | Keep obstacle dynamics and project existing competitive anchors into free intervals. |
| Footprint surface blending becomes a separate tyre-model project | Use one shared conservative surface classification and defer per-wheel detail. |
| Emergency runoff creates more contacts or unsafe rejoins than braking | Restrict authorization to narrower proven scenarios; never force the pass. |
| Statistical tuning improves calibration seeds but not held-out strata | Revert the tuning and inspect model/metric ownership. |
| Track optimization approaches 20 minutes | Reduce broad evaluations/fidelity; keep the safe incumbent and finalist validation. |
| Browser frame or headless throughput breaches its gate | Reduce planner cadence/active set/beam within fixed safety constraints. |

No simplification may weaken a hard collision, protected-space, surface
authorization, liveness, finite-value, provenance, or deadline invariant.

## Required commands and evidence

Use existing public scripts where possible. The final implementation report must
include, at minimum, results for:

```text
bun run typecheck
bun run check:boundaries
bun run test:unit:raw
bun run test:invariants
bun run validate:profiles
bun run test:headless-parity:raw
bun run test:browser:smoke:raw
bun run test:prod
bun run test:stats:fast
bun run test:stats:normal
bun run test:stats:full
bun run benchmark:sim
bun run validate:new-track-fixture
bun run evidence:release
```

If a script name changes, retain an equivalent public contract and document it.
Do not report a browser gate as passed from headless evidence. Browser tooling
may require installing its pinned browser distribution on the verification
machine; that environment issue is not permission to delete the gate.

## Definition of done

The work is done when a clean implementation audit can answer yes to every item:

- Are pit states forward-progressing and reservations physically finite?
- Can a rights record protect lateral room without freezing a distant car?
- Does every healthy stationary car have a legitimate, inspectable cause?
- Do physics, rendering, planning, profiles, and validation agree on curbs?
- Can normal lines use curbs with the small grip penalty and never use grass?
- Can stopped/overslow obstacles be passed on road, curb, or justified runoff?
- Does the car brake safely when no path exists?
- Do attack, defence, and side-by-side paths use actual free space smoothly?
- Are path changes committed, non-oscillatory, and safe to rejoin?
- Are runtime search, allocations, browser frames, and track optimization bounded?
- Are true impossible states red while realistic rate variation uses registered
  normal and acceptable bands?
- Do all compatibility, deterministic, statistical, visual, and release gates
  pass with reproducible artifacts?

Only then mark this plan implemented and supersede it with a later plan if new
work is authorized.
