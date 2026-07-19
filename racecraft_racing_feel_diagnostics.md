# Racecraft Racing-Feel Diagnostics — Static Root-Cause Analysis

Date: 2026-07-15. Scope: why racing feels mechanical — followers hold too much
distance, followers overslow when the leader overslows instead of attacking,
lines look rigid, and overtaking is rare. This document is a static code
analysis (no new instrumentation); every claim cites the mechanism in source.
The companion plan is `racecraft_racing_feel_plan.md`.

`superseded/RACECRAFT_DIAGNOSTICS.md` (the tooling reference) still describes
the seeded inspection commands.

## 1. Architecture recap (what decides what)

Per 30 Hz traffic tick (`updateTraffic`, `src/session/racecraft/traffic.ts:78`):

1. Every active entry resets `vCap = Infinity` and decays its intent timers
   (`atkT`, `defT`, `tuckT`, `closeT`, `atkCd`, `tow`).
2. Each car picks one **reference car ahead** (≤60 m and lateral sep <2.2 m, or
   an obstacle ≤160 m) and runs `stepRacecraft` (`traffic.ts:377`), which sets
   the scalar lateral target and a longitudinal `vCap` via `followCap`
   (`src/session/racecraft/paths.ts:53`).
3. Corner rights, priority, and the corridor planner then arbitrate protected
   paths (`syncRacecraftPaths`, `paths.ts:1203`), with feasibility/occupancy
   gates (`feasibility.ts`) and ≤6 candidates at 5 Hz search cadence.
4. The driving controller (`botStep`, `src/core/autopilot.ts:20`) tracks the
   installed path at `speedAt(i) * margin * gripV`, clamped by `vCap`.

Key scalar inputs: `entryMargin` (`src/session/strategy.ts:49`) is the driver
"how close to the limit" fraction (0.86–0.968); `entryMu`
(`strategy.ts:26`) is physical grip (tyre compound/wear, damage); `flowOff`
adds ±0.02 per-zone margin noise per lap.

The safety layers (feasibility, corridor planner, corner-rights invariants,
zero-tolerance out-of-bounds checks) are sound and worth keeping unchanged.
Every root cause below is in the *intent* layer — when a car decides to
follow, attack, or give up — not in the safety machinery.

## 2. Root causes

### RC1 — The attack trigger is self-suppressing: the follow cap erases the closing-speed evidence the attack needs

Attack eligibility (`stepRacecraft`, `traffic.ts:432-435,443`) requires
`faster`, which is either:

- (a) closing speed `e.spd - a.spd > 2.5 m/s` sustained ~0.55 s
  (`attackClosingSpeedMps`, accumulated into `closeT` at `traffic.ts:433-434`,
  decayed at `traffic.ts:99`), or
- (b) `entryMargin` advantage > 0.002 (`traffic.ts:432`).

But the generic follow cap (`traffic.ts:496`) pins the follower to
`followCap(..., timeGap = 0.45)`, whose gap law converges to
**speed = leader speed** at the desired gap (`paths.ts:66`). Once a follower
settles behind a leader, its closing speed is regulated to ~0 by construction,
so trigger (a) can never fire again from equilibrium. The system only attacks
during the brief arrival transient — and even that is damped by the
`- closing * 0.35` term (`paths.ts:65-66`), which bleeds off approach momentum
early (part of the "mechanical" look: cars decelerate to the gap instead of
arriving with overspeed and using it).

### RC2 — The pace comparison is grip-blind: fresh tyres never register as "faster"

Trigger (b) compares `entryMargin` only (`traffic.ts:432`). `entryMargin`
(`strategy.ts:49-73`) contains skill, pace mode, track evolution, wet, and
traits — **not tyre grip, fuel weight, or damage**. Tyre state enters the
simulation exclusively through `entryMu → tyreGrip` (`strategy.ts:19-28`),
which scales real corner speed in `botStep` (`gripV = sqrt(muScale)`,
`autopilot.ts:39,72`). Concretely: a soft-tyre car at wear 0 has grip 1.0; a
worn car at wear 1.0 has ~0.90 — several seconds a lap of genuine pace — yet
`entryMargin` sees them as equal, so the faster car never becomes attack-
eligible via (b), and RC1 blocks route (a). The single strongest real-world
overtaking driver (tyre delta) is invisible to the overtaking heuristic.

### RC3 — The "overslowing leader" dead zone: between ~55% and ~95% of expected speed there is no tool but patience

The user-observed symptom directly. When a leader loses pace (mistake `liftT`
drops its margin 0.045, `strategy.ts:68`; or it is itself stuck in traffic):

- The follower's `vCap` tracks `leader.spd` via the gap law → the follower
  overslows too, and the car behind it likewise: the slowdown propagates down
  the train by construction.
- Trigger (b) does fire during leader mistakes (margin −0.045 > 0.002), but
  execution hits the **tight-corner suppression** (`traffic.ts:452-461`): if
  any curvature > 1/42 exists 6–30 m ahead, the attacker holds line and simply
  follows at a 0.35 s gap. Mistakes overwhelmingly matter in/near corners
  (`rollMistake` converts straight-line rolls to a small lift,
  `incidents.ts:49-52`), so the response to "leader ran wide" is usually
  "close to 0.35 s and wait".
- The obstacle system only unlocks a pass-around below **~0.52× expected
  speed** (`obstacleCandidateReason`, `obstacles.ts:64-72`, plus closing >3
  m/s). A leader at 60–95% of expected speed is too fast to be an obstacle and
  too protected to be attacked: the exact dead zone the user describes.

### RC4 — An attacker still gap-follows the car it is passing

During a committed attack, while lateral separation < 2.3 m the attacker keeps
a followCap of 0.18–0.38 s **behind its target** (`traffic.ts:462-465`).
Passing therefore requires first building ≥2.3 m of lateral separation — at a
lateral slew of at most ~2.1 m/s with a 1.3 s time constant
(`traffic.ts:367-371`) — while longitudinally forbidden from drawing level.
Unless the raw pace delta is large, the attacker ends up bumper-tucked, then:

- **Turn-in enforcement** cancels any attack whose bodies do not *currently*
  overlap at turn-in (`enforceTurnInTucks`, `corner-rights.ts:684-708`, uses
  the instantaneous `longitudinalBodiesOverlap`, not the predictive
  `longitudinalBodiesWillOverlap` that exists three functions above) →
  `tuckT 0.8`, `atkCd 1.5`.
- **Exit check** tucks the follower if it is >2.7 m behind shortly after the
  apex (`traffic.ts:323-331`) → `atkCd 1.0`.
- **Room-negotiation failure** at ds ≥ 4.5 near braking → `tuckT 0.6`,
  `atkCd 1.5` (`traffic.ts:281-287`).
- Natural expiry of `atkT` also imposes `atkCd ≥ 1.0` (`traffic.ts:95-97`).

The observable pattern is the mechanical yo-yo: close in, get tucked at
turn-in, drop to the 0.40 s tuck gap, cooldown, re-detect, repeat every corner
without ever completing a pass. Cooldowns are flat constants unrelated to how
close the attempt came or how aggressive the driver is.

### RC5 — Slipstream is unreachable from the following equilibrium; no dirty air

`tow` requires ds < 16 m, sep < 1.5 m, radius > 230 m (`traffic.ts:201-204`)
and yields at most a 9.1% drag cut (`entryMods`, `strategy.ts:79`). But the
generic follow equilibrium is `0.45 s × speed` ≈ 20–30 m at straight speeds —
outside the 16 m tow window. So in steady running the slipstream is ~0 and
there is no physical mechanism pulling a follower closer on straights.
Symmetrically there is no dirty-air penalty in corners. Together these remove
the accordion dynamic (catch on the straight, hang back slightly in corners)
that makes real racing read as alive, and they are why the fixed 0.45 s gap
looks like formation flying.

### RC6 — One line, fixed offsets: every car draws the same arcs

- All cars drive `track.idealPath` exactly when not in a discrete mode
  (`stepEntry`, `entry.ts:309-317`); `flowOff` perturbs *speed margin* only,
  never the line.
- Every discrete mode uses fixed constants: attack side ±2.8 / ±3.0 m
  (`traffic.ts:447`), attack/defend corner-plan fractions
  0.58/0.80/0.28 and 0.43/0.62/0.10 (`cornerPathPlan`, `paths.ts:490-492`),
  defense offset `side*2.8*0.8` (`traffic.ts:488-489`), avoidance 3.2 m,
  rights apex targets 0.72/0.54 of usable width (`paths.ts:551-554`).
- The generic non-battle branch decays `latTgt` to exactly 0 —
  the leader's own line — every tick (`traffic.ts:497`, `traffic.ts:230`).

There is no per-driver line character, no small stochastic variation, and no
"return to line" defense shape, so all maneuvers look like the same three
templates.

### RC7 — Every tie-break favors the car ahead

- The corner-rights zipper always caps the **trailing** car
  (`applyCornerRights`, `corner-rights.ts:439-465`).
- The three-car resolution tucks everyone but the two nearest the apex
  (`corner-rights.ts:566-581`).
- Exit-side room resolution tucks the follower (`traffic.ts:323-331`).
- Defense gets a free reaction per attack episode (`claimDefenseResponse`,
  `traffic.ts:48`, applied at `traffic.ts:480-493`) while the attack must
  survive four separate cancellation triggers (RC4).

Individually each rule is defensible; combined, side-by-side episodes resolve
to "leader keeps position" unless the pace delta is large — consistent with a
pass-success band that had to be set as low as 0.2 (`metric-policy.json`,
`race.pass_success_fraction`).

## 3. Symptom → cause map

| Symptom | Primary causes |
|---|---|
| Followers keep too much distance | RC5 (no pull toward tow range), RC1 (0.45 s equilibrium everywhere, closing damped) |
| Follower overslows when leader overslows instead of passing | RC3 (dead zone), RC1 (no closing evidence), RC2 (grip-blind pace) |
| Few overtakes | RC1 + RC2 (attacks rarely start), RC4 (attacks rarely finish), RC7 (ties go to leader) |
| Lines look rigid / robotic | RC6 (single line, fixed offsets), RC1 (asymptotic arrival) |
| Battles look mechanical (yo-yo) | RC4 (tuck/cooldown cycle), RC7 |

## 4. Measurement gaps (why current metrics didn't flag this)

- `race.passes_per_race` counts **any** 1 Hz running-order change
  (`countOrderPasses`, `src/game/headless-sim.ts:700-711`), so pit-stop cycles
  and mistake shuffles inflate it; a race with zero genuine on-track passes can
  still clear the ≥8 band.
- `passSuccesses = min(passes, passAttempts)` (`headless-sim.ts:845`) is a
  clamp, not a join; it cannot attribute a completed pass to an attack.
- Nothing measures the *distribution of following time gaps*, time spent
  vCap-constrained behind a slower car, attack-failure taxonomy
  (turn-in-tuck vs exit-tuck vs expiry), or time-alongside per pass attempt —
  exactly the quantities the symptoms live in. (`sbsT` and episode durations
  exist but only start above 1.6–2.1 m separation, `traffic.ts:144`.)

## 5. Arbitrary-constant audit

The follow gap is one instance of a general pattern: policy constants that
pretend to be physics. The physical yardsticks from `src/core/physics.ts` are
`carWid 2.0`, `carLen 5.4`, and available deceleration
`mu·profMu·(g + min(kDf·v², dfMax)/m)` ≈ **15.5 m/s² at low speed, ~27 m/s² at
60 m/s** — the same expression the feasibility gate and controller already
use. Judged against those, the constants fall into four families.

### 5.1 Longitudinal policy caps (should be brake-reachability only)

The only physical constraint between two cars in the same lane is: the
follower must be able to stop behind the leader's worst-case stop, after a
reaction delay, minus a body-length standoff. Everything below adds an
*additional* invented restraint:

| Constant | Where | What it does |
|---|---|---|
| `timeGap` 0.45 / 0.40 / 0.35 / 0.55 / 0.65 / 0.75 + `gain 1.6` + `closingDamp 0.35` + `desiredGap ≥ 5` | `followCap`, `paths.ts:53-72`; call sites `traffic.ts:169,191,237,330,387,395,427,460,464,496` | The comfort-distance controller. Regulates followers to leader speed at an invented distance; erases closing evidence (RC1) |
| `a.spd + 3.0` start leash + 0.75→0.45 gap blend, first 16 s | `traffic.ts:384-397` | No car may run >3 m/s faster than the car ahead through the start. Lap 1 — the best overtaking window in real racing — is processed in grid order |
| `a.spd + 4.0 − wet` side-by-side cap | `traffic.ts:310` | A car already alongside may complete the pass at most 4 m/s faster |
| Zipper `closingPenalty ≥ 0.5`, exact-0 cap below 5 m/s | `corner-rights.ts:451-459` | Trailing car always concedes; low-speed pairs park |
| Assumed decelerations 5.2, 5.5, 6.0, 6.8, 9.0, 9.5 m/s² | `feasibility.ts:34`, `pit.ts`, `traffic.ts:166,409`, `paths.ts:60`, `entry.ts:306` | Six different guesses at braking ability, all 2–4× below the car's real 15–27 m/s². Every one inflates following/queueing distance; none derives from `PHYS` |

### 5.2 Attack gating thresholds (should be pace/pressure-driven)

| Constant | Where | Effect |
|---|---|---|
| closing > 2.5 m/s sustained 0.55 s (`closeT` rates 1.35/0.35) | `config.ts:27`, `traffic.ts:99,433` | Attack evidence the follow cap itself suppresses (RC1) |
| detection distance 30 m (sweep bounds only [20, 45]) | `config.ts:28` | A pass may only be *planned* from ~0.5 s back; real passes are set up from 1–2 s over a full straight |
| `atkCd` 1.0 / 1.5 flat, commit 3 s | `traffic.ts:97,284`, `corner-rights.ts:702,823` | Battle rhythm quantized to identical retry cycles regardless of driver or how close the attempt came |
| tight gate: radius < 42 m within 6–30 m | `traffic.ts:452-458` | Attacks suppressed exactly where passes happen |
| alongside window ds < 8.5 && sep > 2.3 | `traffic.ts:437` | "Alongside" defined by magic box, not body overlap |
| rights acquisition only approach→turn-in (approach = brake − 40 m) | `corner-rights.ts:728-744` | A run gained mid-corner or at exit can never earn a protected corridor |
| exit tuck: >2.7 m behind within 45 m past apex; room fail at ds ≥ 4.5 | `traffic.ts:281-287,323-331` | Attempts must complete inside one corner or are cancelled |

### 5.3 Geometry constants (should come from the actual free road)

| Constant | Where | Effect |
|---|---|---|
| `ROOM_SEP 3.4` | `corner-rights.ts:20` | Physical non-overlap is 2.0 m (carWid); the planner's own occupancy gate uses 2.35 (`feasibility.ts:267`). 3.4 forces a full metre of daylight mid-battle, consumes road (three-wide needs 7.6 m usable), and makes side-by-side look magnetic-repulsion rather than wheel-to-wheel |
| lateral slew `latRate 0.025`, `latStep 0.070` (≤2.1 m/s, τ ≈ 1.3 s) | `traffic.ts:367-371` | Physical lateral capability at speed is ~4–6 m/s (grip-limited). Every move looks slow-motion; feints/switchbacks impossible; building the 2.3 m attack separation takes seconds |
| attack side ±2.8/±3.0, defense 2.24, avoid 3.2, pit-pass −2.8 | `traffic.ts:110,189,447,488` | Canned move geometry regardless of where the free road is |
| corner-plan fractions 0.58/0.80/0.28 (attack), 0.43/0.62/0.10 (defend), rights apex 0.72/0.54 | `paths.ts:490-492,551-554` | Three template arcs shared by all 20 drivers |
| overlap definitions 2.2 / 2.3 / 2.5 / 2.35 / 3.4 | ref gate `traffic.ts:198`, alongside `:437`, generic `:496`, feasibility, ROOM_SEP | Five inconsistent answers to "when are two cars laterally clear?" — the signature of accreted heuristics rather than one model |

### 5.4 Driver-model uniformity (variance is where "alive" comes from)

| Constant | Where | Effect |
|---|---|---|
| braking effort fixed 0.82 for everyone | `autopilot.ts:83` | No late-braker archetype; out-braking — *the* overtaking move — cannot exist as a skill expression |
| lunge = margin +0.008 | `strategy.ts:70` | A "lunge" brakes ~0.8% later: invisible. Lunges are pure diagnostics |
| margin band 0.86–0.968 scales the whole lap uniformly | `strategy.ts:49-73` | No per-zone skill (braking vs cornering vs traction), so no natural attack/defend asymmetry between drivers |
| mistakes are speed-only (`liftT`) | `incidents.ts:53-63` | "Runs wide" never actually runs wide — geometry unchanged, so a mistake opens no door |
| defense: one dice roll 0.35 + 0.4·focus, one response per episode, fixed 4 s | `traffic.ts:485-492` | Defense is a coin flip, not a behavior |
| tow: <16 m, sep <1.5, radius >230 m, ≤9% drag | `traffic.ts:201-204`, `strategy.ts:79` | Dead code in steady running (RC5) |
| flow ±0.02, 14 zones, speed-only | `strategy.ts:30-43` | Pace noise exists; line noise doesn't |

### 5.5 The principle

Only three families of constants are legitimately physical here: body
dimensions (`carWid`, `carLen`), grip/braking capability (already in `PHYS`
and the surface model), and reaction time. Everything else should either be
**derived** from those (safe speed, lateral slew, standoffs, queue spacing),
**emerge** from aerodynamic coupling (tow/dirty air) and driver risk policy,
or be an explicit, per-driver **character** parameter (braking effort,
aggression, line bias) rather than one global magic number.

## 6. What already works and must not regress

- The feasibility/occupancy gate, corridor planner beam, protected-corridor
  and path-slew invariants, pit reservations, and priority machinery are
  robust and cheap (≤6 candidates, ≤1 materialization, 5 Hz search). All
  proposed behavior changes live in the scalar intent layer above them, so the
  planner keeps vetoing anything unsafe.
- The zipper as a *last-resort* convergence resolver is correct; the problem
  is only how often pairs reach it with no earlier competitive option.
- Runtime budgets: 30 Hz traffic with neighbor scans bounded at 60/160 m,
  benchmark floor 80% of the frozen pinned-CPU baseline (`benchmark:sim`).
