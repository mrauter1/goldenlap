# Racecraft Racing-Feel Implementation Report

Implementation source of truth:
`racecraft_racing_feel_diagnostics.md` and `racecraft_racing_feel_plan.md`,
both reread after their 2026-07-15 revision.

## Phase-A baseline

Captured before the Phase-B driving changes with
`bun run measure:racing-feel --seed 101`. This deliberately uses one dry,
one-lap race on each flagship track; it is a fast directional baseline, not a
replacement for the deferred calibration/validation populations.

| Track | Genuine passes | Contacts / hard / opening hard | Constrained s | Attacks / exact completions | Turn-in / room / expiry cancels | Follow gap <0.3 / 0.3–0.6 / 0.6–1.0 / >1.0 |
|---|---:|---:|---:|---:|---:|---:|
| Prado | 11 | 2 / 1 / 1 | 184.7 | 66 / 1 | 16 / 4 / 37 | 2.3% / 38.2% / 41.4% / 18.1% |
| Nordwald | 18 | 7 / 2 / 2 | 239.1 | 71 / 2 | 11 / 1 / 50 | 3.6% / 47.7% / 35.2% / 13.5% |
| Anhembi | 28 | 5 / 3 / 2 | 126.4 | 60 / 0 | 8 / 0 / 48 | 3.7% / 35.1% / 29.9% / 31.3% |

All three sessions completed with valid classifications, zero unexplained
stalls, and zero pit deadlocks. The baseline confirms the diagnostic: the
1 Hz order-change count looks healthy while exact attack completion is only
0–2 per race and expiry dominates the attack funnel.

## Implemented behavior

- **Measure:** bounded follow-gap, constrained-time, attributed attack-funnel,
  and genuine-pass metrics now flow through the production-backed headless
  summary, fast measurement command, race simulator, and statistical-policy
  surface.
- **Follow and aero:** race traffic uses one analytic brake-reachability law;
  queue spacing is confined to pit/start/qualifying queue control. Shared
  downforce-aware stopping helpers replaced the scattered guessed deceleration
  values. Tow reaches 28 m with lateral taper and close curved following now
  produces dirty-air loss.
- **Attack eligibility:** grip-aware pace, prospective traffic constraint,
  pressure, local underspeed, physical time-to-overlap, immediate-opponent
  attribution, and adaptive cooldowns replace the former distance trigger.
- **Attack execution:** one 2.35 m body-clearance definition, predictive
  turn-in overlap, a 2.5 m room corridor, derived lateral slew, tight-inside
  placement, linked-corner persistence, and intended-lane occupancy govern the
  move. An attributed attacker keeps its exact opponent as tactical reference
  after moving into a free lane; losing that reference was the final
  follow-cap handoff that prevented otherwise valid passes from completing.
- **Character and mistakes:** deterministic bounded line bias, cover/return
  defense, pressure stress, per-driver braking effort/prudence, and geometric
  run-wide state add visible variation without bypassing feasibility or
  protected-corridor authority.

The plan's prose says the follower uses `prudence × decel`, the leader uses
full deceleration, and equal cars reduce to reaction distance plus standoff.
Those statements cannot all hold algebraically: asymmetric braking retains a
large stopping-distance term. The implementation applies the same prudence
fraction to both predicted stops. This preserves the documented equal-car
result while remaining conservative through reaction time and the physical
standoff; unequal grip/downforce still changes the reachability cap.

## Fast post-implementation comparison

Captured once with the same command and seed as the baseline. These are raw
one-lap observations, not full-race totals or a population acceptance run.

| Track | Genuine passes | Contacts / hard / opening hard | Constrained s | Attacks / exact completions | Turn-in / room / expiry cancels | SBS median |
|---|---:|---:|---:|---:|---:|---:|
| Prado | 11 → 18 | 2 / 1 / 1 → 1 / 0 / 0 | 184.7 → 97.4 | 66 / 1 → 103 / 3 | 16 / 4 / 37 → 14 / 0 / 45 | 2.37 s |
| Nordwald | 18 → 25 | 7 / 2 / 2 → 6 / 0 / 0 | 239.1 → 125.6 | 71 / 2 → 119 / 7 | 11 / 1 / 50 → 25 / 0 / 51 | 1.53 s |
| Anhembi | 28 → 20 | 5 / 3 / 2 → 13 / 0 / 0 | 126.4 → 110.3 | 60 / 0 → 96 / 5 | 8 / 0 / 48 → 21 / 7 / 58 | 1.63 s |

All sessions completed with valid classification, zero hard contacts, zero
opening hard contacts, zero unexplained stalls, and zero pit deadlocks.
Light contacts are now explicitly uncapped; only suspension-damaging hard
contacts have a limit (30 per race). At production distances of 57, 40, and
45 laps respectively, the raw one-lap observations produce conservative
five-lap-settled equivalents of 205, 152, and 171 passes. A direct five-lap
Prado check also produced 18 passes and the same 205 equivalent, with 19 light
contacts and zero hard contacts. This projection is useful for fast
development checks but is not a claim that density stays constant for a whole
race; the full-game merge gate checks the actual total against the normal
minimum of 100. Aggregate follow time is concentrated in the 0.3–1.0 s
buckets; the plan's `<0.3 s` acceptance is specifically for pace-matched
straights and still needs its population/stratified gate before release.

## 2026-07-16 contact/pass correction

The first report conflated one-lap development probes with production races
and treated all contact as an aggression constraint. Both assumptions were
corrected:

- the fast report now emits raw observed passes, simulated/production laps,
  and a clearly named production-distance equivalent;
- the statistical pass policy evaluates that equivalent with normal ≥100 and
  acceptable ≥75, while the full-game strict gate requires ≥100 actual passes;
- contact becomes hard at the same impulse (>13) that damages suspension;
- light contact remains physically resolved and measured, but no longer adds
  stress, triggers a speed concession, releases corner rights, or fails any
  metric policy;
- hard contacts alone have an absolute cap of 30 per individual race.

Same-seed one-lap result after the correction:

| Track | Raw passes | Five-lap-settled production equivalent | Light / hard contacts | Exact completions |
|---|---:|---:|---:|---:|
| Prado | 18 | 205 | 1 / 0 | 3 |
| Nordwald | 19 | 152 | 2 / 1 | 4 |
| Anhembi | 19 | 171 | 13 / 0 | 4 |

This is a policy correction, not permission to weaken corridor, finite-state,
road-bound, liveness, or classification invariants.

## Phase G — light contact is racing

The post-implementation audit found three remaining ways a harmless rub could
still dissolve a battle. They are now removed without weakening hard-contact
handling:

- stable light contact no longer seeds the forced recovery-room state; hard
  contact or either car already being unstable still does;
- hit-pair telemetry records `lastHard`, and only that timestamp applies the
  0.8 s corner-rights acquisition cooldown;
- collision position correction now clears overlap by a 0.05 m numerical
  epsilon instead of manufacturing 0.30 m of controller-owned daylight.

Reducing the hidden collision clearance exposed a separate pit priority
inversion in the short race probe: a car holding an ingress/egress reservation
could be stopped by the generic pit follower while the rest of the lane waited
for that reservation. A crossing owner now completes its reserved movement;
through-lane cars still detect the physical crossing and yield. This preserves
collision honesty instead of restoring the old separation workaround.

The bounded five-lap Prado reproducer completed with a valid classification,
22 observed passes (250.8 production-distance equivalent), 25 light contacts,
zero hard contacts, a 2.43 s side-by-side median, zero unexplained stalls, and
zero pit deadlocks. This is directional implementation evidence; the deferred
population gates remain responsible for the hard-contact and DNF bands.

## Phases H, I, K, and J — physical continuity and overtaking IQ

The 2026-07-16 follow-up phases were landed in their required dependency
order (H → I → K → J):

- **Corner-aware following (H):** ordinary race traffic is now a structured
  moving slow point consumed by the anticipatory bot controller. The shared
  reachability calculation prices upcoming curvature, each driver's braking
  effort and grip, and learned reaction to the same leader. Brake input is
  limited by current friction-circle headroom. Flat caps remain only for
  queues, starts, pits, and non-race authorities that intentionally require
  them.
- **Sustainable side-by-side running (I):** one projected-body `alongside`
  predicate suppresses longitudinal follow/tuck/settling orders while bodies
  overlap. Dirty air tapers laterally, recovery thresholds now mean genuine
  instability, and the rights zipper has no minimum speed tithe: it restores
  the lateral causer to its protected corridor and asks for longitudinal
  concession only from a genuinely slower car.
- **Aerodynamic coupling (K):** dirty air no longer taxes global target speed;
  its small calibrated loss applies only to grip under actual lateral load.
  Tow drag reduction is a registered calibration parameter. Scalar lateral
  intent has no artificial acceleration floor and retains high-speed stability
  headroom.
- **Passing intelligence and sporting defense (J):** semantic corners carry a
  build-time pass score; a driver can stalk the better of the next two spots
  without burning pressure or cooldown. A covered attack can retain the same
  attack authority as a wide-entry/tight-exit switchback. Defensive cover is
  rejected when it cannot finish before braking, mirrors an already committed
  attacker, or squeezes meaningful overlap; return-to-line waits for physical
  daylight.

The end-to-end probe exposed a separate hard-invariant defect at pit exit:
state changed from `pitOut` to `run` at a fixed marker while the car and its
retained pit path could still project onto different road samples. The handoff
now occurs only when both the complete car footprint and retained command are
legal at the car's actual road projection. Pit authority has one authored exit
ramp of convergence distance and releases at the first legal sample. The
existing every-track overlapping qualifying-launch test covers the result.

Directional five-lap evidence after J (Prado, calibration seed 101):

| Result | Value |
|---|---:|
| Observed genuine passes | 54 |
| Production-distance equivalent | 615.6 |
| Attack initiations / attributed completions | 234 / 21 |
| Light / hard contacts | 439 / 1 |
| Side-by-side median | 1.77 s |
| Unexplained stalls / pit deadlocks | 0 / 0 |

The 9.0% attributed success fraction is inside the policy's acceptable band
but not its normal band. It is a single calibration seed, so it is a watch
signal rather than grounds for parameter fitting; the population gate owns
that distributional decision. Total/light contacts remain intentionally
uncapped, while the sole hard-contact cap remains 30.

## Verification scope

Completed in this implementation loop:

- `bunx tsc --noEmit`
- `bun run check:boundaries`
- 39 focused physics, traffic, path, corner-rights, and production-backed
  headless tests (all passing in 8.7 s)
- one same-seed, three-track measurement probe (8.6 s)
- contact/pass correction: 29 focused tests passed in 8.5 s, followed by a
  final 17-test subset in 3.5 s after the projection helper; type and boundary
  checks remained green
- one post-correction three-track lap and one five-lap Prado settling probe;
  an attempted production-length headless run was aborted when it exceeded
  the bounded development-loop budget
- Phase G: 17 focused contact, collision, and corner-rights tests plus three
  focused pit-reservation tests; one five-lap Prado behavior probe; final type
  and import-boundary checks
- Phases H/I/K/J: typecheck and module boundaries; 44 focused physics,
  traffic, path, rights, and calibration tests (one stale zipper expectation
  corrected to the new zero-tithe rule); both overlapping-launch and sampled
  pit-authority regressions; and one five-lap calibration-seed race. The
  simulator benchmark and invariant group are recorded separately when their
  bounded background runs complete.

The full statistical, browser, parity, motion-review, sensitivity,
invariant-population, and pinned-CPU benchmark gates remain required before
release. They were deliberately not run in this loop: they are too slow for
the requested implementation pass and would not justify one-seed parameter
tuning.

## Updated-plan adjustment and fast audit toolkit (2026-07-16)

The latest plan revision is now reflected in production and its focused audit
surface:

- tow is a smooth inverse-square wake over the existing bounded traffic scan,
  using speed/characteristic distance rather than a hard linear cutoff;
- attack reachability filters observed gap closure and adds only modeled pace,
  tow terminal-speed, and braking-character advantages—the former large
  `target speed − leader speed` proxy is gone;
- defense commitment is measured from the track racing line, not from the
  generated attack path that follows the attacker laterally;
- defense feasibility prices the same high-speed stability share and path
  follower convergence horizon used by the controller. The authored cover is
  established before `brakeI` and held through turn-in;
- the late-defense canary measures authored line-command change specifically
  from `brakeI` to `turnInI`, so physical settling and normal apex rotation are
  not mislabeled as reactive moves;
- train-pressure scenarios observe from the first constructed steady-state
  tick, preventing their own settling period from hiding attack initiations.

The focused Phase-J probe is green for anticipatory defense, committed-attacker
blocking, switchback completion, and passing-spot selection. G, the
straight-line I/K stability cases, and underspeed-train pressure are green.
The protected-corner result is acceptable but outside normal (+0.533 s versus
solo; normal ≤0.4 s, acceptable ≤1.0 s). Equal-wear H completion and the
one-second K tow-to-overlap target remain named findings rather than targets
for manual parameter fitting; details are in
`audit_toolkit_implementation_report.md`.

Final bounded verification supersedes the earlier pending-benchmark note:
typecheck and module boundaries are green; 46 touched tests pass; and the
pinned benchmark records 87.692× median full-race throughput against the
62.912× floor. Slow statistical, matrix, browser, and release suites were not
run.
