# Audit Toolkit Plan — Fast, Targeted Effect and Balance Audits

Active plan for the *audit infrastructure* stream. It serves the other two
streams: verifying the racing-feel phases (G–K in
`racecraft_racing_feel_plan.md`) and checking/optimizing the balance
parameters (`game_balance_plan.md`). The governing idea: **every acceptance
criterion already written in those plans becomes one machine-checkable,
seeded, sub-second probe** — so audits are cheap enough to run continuously
and in the background (see `AGENTS.md` §Audit orchestration).

**Implementation status (2026-07-16): complete.** The commands, scenario
library, counters, lap strata, Tier-0 model, bounded optimizer, paired matrix,
event stream, and fail-fast invariant handling are implemented. Current red
and amber outputs are behavioral/balance findings, not missing toolkit work;
see `audit_toolkit_implementation_report.md`.

## 1. The audit ladder (cheapest tier that answers the question)

| Tier | Tool | Cost | Answers |
|---|---|---|---|
| 0 | `tools/strategy-model.ts` (closed form, §9.1 of the balance plan) | ms | Is the *math* balanced? Tyre parity, pace-mode EV, undercut gain, trait EV — no simulation at all |
| 1 | **Scenario probes** — `runFocusedSession` with new scenarios (2–4 cars, 5–60 sim-seconds, constructed states) | <1 s each | Does a specific *behavior* happen? Pass completion, no-yield-alongside, defense legality, rear stability |
| 2 | Single seeded full races (`runHeadlessRace`, 5–10 laps) | seconds | Do behaviors *compose*? Attack funnel, battle time loss, follow-gap histogram — **reported lap-stratified: lap 1 (start regime) separately from laps 2+, so steady-state metrics are never diluted or inflated by the start** |
| 3 | Statistical suite / strategy matrix (existing tiers) | minutes | Population bands, win rates — end of phase only |

Rule: a Tier-3 run to answer a Tier-1 question is the audit equivalent of
launching the browser to test session logic. Optimizers iterate on Tiers
0–1 and *confirm* on 2; Tier 3 locks.

## 2. Scenario probe library (`tools/audit-effects.ts`)

Extend `FocusedScenario` (currently `pair | pit | priority |
classification`) with constructed racing situations. Each scenario spawns a
minimal field in a prepared state, runs a bounded sim window, and asserts
the plan's acceptance criterion. One CLI:
`bun tools/audit-effects.ts --phase K --track prado --seed-set calibration`.

| Scenario | Construction | Assertion (source phase) |
|---|---|---|
| `faster-behind` | follower with +1.5 s/lap pace (margin+grip) spawned 1.5 s back, 3 laps | pass completed within 3 laps in ≥80% of seeds (H) |
| `alongside-straight` | pair spawned overlapped (clearance < 0, sep 2.6) at speed on the longest straight | overtaker never brakes while `alongside`; no `slipR > slipPeakR` excursion; pass or clean re-tuck only after bumper-clear (I.5, K.3) |
| `tow-run` | equal pair, follower 1.0 s back at straight start | legacy K.2 closure/tow-strength observation; its old physical-overlap verdict is amber because L4b's non-negative `near-touch-tow` case is now the normative safety/acceptance probe |
| `near-touch-tow` | equal pair constructed at the 3 m bumper boundary on the high-speed half of the longest straight, with one adjacent normal-surface lane free | bumper clearance remains non-negative and reaches ≤3 m before approach; the gap is larger by turn-in after the lift→brake threat ramp; the free-lane escape probe and maximum tow are both observed (trajectory L4b) |
| `side-by-side-corner` | pair spawned side-by-side at corner approach with rights | pair-minus-solo corner seconds, normalized by the clean ideal lap, stays in the 1–3% battle-economy band; episode survives ≥1 corner; no forced-room dissolution without hard contact (I, G, trajectory L4) |
| `light-rub` | side-by-side pair nudged into low-impulse contact | episode continues; no `contactSeed` room, no rights-acquisition block (G) |
| `defense-legality` | attacker closing on defender before a heavy braking corner; variants construct an anticipatory move, an occupied door (<1 car-length bumper clearance), and a high-closing reachability violation | anticipatory defense still completes before `brakeI`; both illegal door attempts become line holds; `defenseDoorViolations` remains zero; return leaves clearance (J.3, trajectory L4b) |
| `switchback` | defender covers inside, linked corner follows | attacker selects outside-entry/exit line; completion requires full bumper clearance after track-out and before the next brake zone (J.2, trajectory L4) |
| `spot-selection` | faster car eligible mid-complex, prime braking zone 2 corners ahead | attack launches at the high-`passScore` corner, stalking state in between (J.1) |
| `train-pressure` | 4-car equal-pace train, leader underspeed 8% | followers attack within `pressureAttackSeconds`+margin; no cascade overslow (C) |
| `solo-baseline` | each scenario's cars run alone, same seeds | supplies the reference lap/corner times the above compare against — computed once and cached per (track, profile-provenance) |
| `corner-line-library` | recompute every cached inside/outside line from compact η points | full semantic-corner coverage; ≥one-car-width apex distinction; exact brake/apex/time provenance; finite legal path; absolute profile lap-ratio policy; report the plan's typical 0.2–0.8 s cost band without inventing a penalty (trajectory L3) |
| `attack-launch` | seeded attacker tucked behind a leader from the derived longest-straight start | at least one prelaunch sample; zero commanded departures away from the leader before the alternate line's own brake-derived launch; pinned lane edits; zero racecraft materializations (trajectory L4) |
| `inside-pass` | closing attacker is committed to the highest-`passScore` corner's cached inside line with a physical grip/braking advantage | the inside profile is observed and gains full bumper clearance by corner exit; report the selected corner id and score (trajectory L5) |
| `outside-pass` | closing attacker takes the same scored corner's cached outside line while the defender owns the inside | the outside profile is observed and gains full bumper clearance by corner exit; unsupported track/corner pairings remain amber (trajectory L5) |
| `over-under` | near-touch attacker takes the outside exit after an inside cover; the host maximizes `passScore ×` the physical track-out-to-next-brake distance | attacker is not fully clear at track-out, then gains full clearance before the next brake point; report host provenance (trajectory L5) |
| `drag-pass` | near-touch pair starts on the derived longest straight; attacker carries only the overspeed computed by the production wake/drag law and pulls into the free lane | positive tow and a real lateral pull-out convert to full bumper clearance before braking; report the following corner's provenance (trajectory L5) |

The trajectory-revamp extensions use the same CLI and event stream. L0–L2
add lane-hop and normalized battle/tucked economy probes; L3 adds the
analytical `corner-line-library` case above; L4 adds brake-derived launch,
real-line switchback, and zero-materialization canaries. L4b adds the
location-priced full-lap tuck, `near-touch-tow`, and occupied/reachability
door canaries. L5 adds the focused maneuver-vocabulary cases with the owning
implementation phase, so an amber physical finding remains evidence rather
than a reason to fit one seed.

**Steady-state by construction.** Lap 1 is a different behavioral regime —
`startAge < START_BLEND_END` (16 s) runs a separate follow law, grid-lat
blending, and `recordTrafficFeel` suppression — so a probe that spawns a
fresh session and asserts immediately audits the *start profile*, not
racing. Every scenario above must construct a **flying mid-race state**:
`goT` set far enough in the past that `startAge > START_BLEND_END`, cars
spawned at speed on their lines, and assertion windows opening only after
one settling lap (or a fixed settling window for sub-lap probes). Realistic
non-lap-1 state matters too where it changes behavior: probes take tyre
wear and stress as scenario parameters (e.g. `faster-behind` runs both
fresh-vs-worn and equal-wear variants) instead of always auditing
lap-1-fresh cars. Lap-1/start behavior is audited *deliberately* by its own
scenarios (start pack, opening-lap contacts), never as a side effect.

Efficiency contract for every scenario: prepared track cached per process
(`prepareHeadlessTrack` once, scenarios share it); fixed small grids; hard
`maxSteps`/`deadlineMs`; **early exit on both verdicts** (assertion decided →
stop simulating); NDJSON audit events to stderr (existing
`goldenlap-audit` schema), single JSON verdict on stdout:
`{ audit, phase, status: green|amber|red, cases, failures[], seeds }`.
Target: a full phase's scenario set across 3 tracks × 10 seeds in **under a
minute**.

## 3. Instrumentation before scripts

The cheapest audit is a counter that already exists when any sim runs. The
plans' criteria need these bounded session counters (same pattern as
`attackCancellations`; O(1) per tick, no logs):

- `brakeWhileAlongsideN` — brake input > 0.2 while `alongside()` and own
  pace ≥ leader's (I.5 regression canary; must be ~0).
- `rearLossStraightN` — `slipR > slipPeakR` while `alongside` and upcoming
  curvature < 1/230 (K.3; must be 0).
- `defenseMoveInBrakingN` / `defenseMirrorN` — J.3 rule violations
  *attempted* (should convert to holds, so violations executed must be 0).
- `switchbackN`, `stalkingSeconds`, per-corner pass/attempt counts (J).
- `battleLapDeltaSum` — accumulated (battling lap time − recent clean lap)
  for cars in `battle` (I acceptance without a second run).

These flow automatically into scenario probes, full races, and the
statistical suite — one instrumentation, three tiers of consumers.

## 4. Balance audits (`tools/audit-balance.ts`)

1. **Tier-0 report**: run `strategy-model.ts` per track; print the §1
   parity table, pace-mode EV by context, undercut gain, trait EV against
   their target bands. Milliseconds; this is the default loop while editing
   constants.
2. **Optimizer** (`--optimize <area>`): search only registered calibration
   keys (`RACECRAFT_CALIBRATION_DEFINITIONS` bounds) plus the §1 tyre
   constants once they are registered. Objective: distance to target bands,
   evaluated on Tier 0; each candidate accepted only after the relevant
   Tier-1 scenarios stay green (via `withRacecraftCalibration` — bounded,
   synchronous, already proven by the sensitivity analyzer). Coordinate
   descent or small Latin-hypercube — the space is ≤ a dozen keys; a full
   optimization run must fit a **10-minute wall budget** with a written
   artifact (`complete: false` on abort, matching the benchmark pattern).
3. **Strategy matrix** (`--matrix`): the §9.2 paired-seed forced-strategy
   runner, Tier 2. Confirms the solver's winner on 10–20 paired seeds per
   track; not part of the optimization inner loop.

## 5. Wiring and discipline

- Verdict statuses reuse the metric-policy semantics (green/amber/red);
  new bands enter `metric-policy.json` observe-only first, enforcement only
  at phase lock (existing rule).
- Seeds: calibration set for iteration, validation for review, release only
  for the final suite — audits must print which set they used.
- `package.json`: `audit:effects`, `audit:balance`, `audit:balance:matrix`.
  None of them build the bundle; none launch a browser.
- Runtime safety: probes must not add production code paths — construction
  uses existing spawn/entry APIs; anything a scenario needs that production
  lacks is a smell to fix in the scenario, not a hook to add in `session/`.

## 6. Order of work

Instrumentation counters (§3) → `audit-effects.ts` with the G/H/I scenarios
(they audit already-implemented behavior) → K/J scenarios land *with* their
phases → `strategy-model.ts` + Tier-0 report (unblocks balance §1) →
optimizer → matrix. Each script lands with its own probe in green on the
current build or an explicit red list referencing the phase that will fix
it — a red audit with a named owner is a feature, not a blocker.
