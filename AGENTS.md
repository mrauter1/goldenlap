# AGENTS.md — Engineering principles for Golden Lap

Golden Lap is a self-contained browser team-management and race simulation:
strict TypeScript, bundled into one IIFE (`dist/goldenlap.js`, never
committed) so direct `file://` play works with no server or network. This
file is the contract for automated contributors: what to preserve, what to
improve, and how changes are judged.

## Commands

```sh
bun install && bunx playwright install chromium   # once
bun run build            # typecheck + bundle (browser checks need it first)
bun run verify:fast      # end of a work phase: deterministic checks + fast stats
bun run verify           # merge gate only: full deterministic + normal stats
```

Toolchain: Bun 1.3.14, Node 22.22.1.

## Verification: match cost to the change — do not run the full loop per edit

The suites exist on a cost ladder. Escalate only when the cheaper rung cannot
answer the question; most iterations need only the first two rungs.

**Validate coherent changes, not individual patches.** For a small task, run
`bun run typecheck`, `bun run check:boundaries`, and the directly touched unit
test once after the logical change is complete. For a large task or refactor,
do not run them after every patch and do not run them while the tree is
intentionally compile-incomplete. Batch related edits and run the three checks
only at a substantial compile-ready boundary where the result informs the
next implementation step, before a playable/phase handoff, and at task
finish. Several patches to one subsystem normally form one validation
boundary. A red check is rerun only after code relevant to that failure has
changed.

Run the touched test directly —
`bun test tests/unit/session/traffic.test.ts` (or the relevant file). Unit
tests do not need the bundle; skip `bun run test:unit` (it rebuilds) in favor
of `bun run test:unit:raw` or a single file. Boundary checks are mandatory at
the logical boundaries above; they are not a reason to interrupt every local
edit.

**Behavior change in `session`/`core` (tens of seconds):** after the owning
behavior is implemented, one targeted probe beats a suite. A seeded headless
race or scenario
(`bun tools/simulate-headless.ts --track prado --seed 101`, or a small script
against `runHeadlessRace`) answers "did the behavior move the way I intended"
directly. `bun run test:invariants` covers the zero-tolerance rules. Headless
and browser share one code path, so **never launch the browser to verify
session/core logic**. If a pending implementation step can invalidate the
probe, implement that step first and defer the probe.

**End of a phase / before handing work back:** `bun run verify:fast`. This is
the first rung that runs statistics; run it once per coherent change set, not
per edit.

**Merge gate only:** `bun run verify` (adds the full browser suite, prod
build, and normal-tier stats). Run once, when the phase is otherwise done.

**Only when specifically implicated:**
- `bun run benchmark:sim` — only after touching hot loops (traffic tick,
  planner cadence, feasibility sampling) or adding per-tick work.
- Browser checks (`test:browser`, `test:browser:smoke:raw`) — only for `ui/`
  changes or runtime-integration concerns; prefer the smoke variant.
- `bun run test:headless-parity` — only when determinism surfaces changed
  (rng use, step ordering, state layout) or fixtures need re-recording.
- `bun run validate:profiles` — only when tracks/profiles/racing-line change.
- `bun run test:stats:normal` / `test:season` — only when a metric-policy
  band is genuinely in question after `verify:fast` flagged something.

**Almost never (release evidence or explicit tuning tasks only):**
`verify:release`, `test:stats:full`, `benchmark:sim:reference` (pinned-CPU
protocol), `optimize:track`, `analyze:racecraft:sensitivity` (only when
sweeping a registered calibration key), `review:motion`,
`browser-performance-check`.

Two habits that waste the most time: rebuilding the bundle for changes no
browser check will consume, and running a statistical tier to answer a
question one seeded race already answers. Statistics are for *population*
claims (bands, rates); use single seeds for causality while iterating.

**The user is the outer loop — do not over-audit small changes.** The
working mode of this project is fast iteration: the user play-tests and
says what works, what doesn't, and what's next. For small or
user-requested behavioral changes, the correct loop is: make the change,
`typecheck` + the one touched test file, `bun run build` so the game is
playable, hand back. Do **not** run probe suites, seeded-race batteries,
or audits to pre-validate a change the user is about to judge by playing —
that spends the iteration budget answering a question the user will answer
better and faster. Audits earn their cost in exactly three cases: a
zero-tolerance invariant might be affected, the user asked for numbers, or
a phase/merge gate is closing. When in doubt between auditing and handing
back sooner, hand back sooner.

A playable phase handoff is a valid stopping point. Post the build and a short
summary of what changed and what to watch, then stop before beginning a later
behavioral phase unless the user explicitly requested uninterrupted
multi-phase execution. Even for an explicitly multi-phase task, close and
validate the current phase before starting the next; never pull later-phase
tests forward merely because the full roadmap is in scope. When play-test
feedback arrives, fold it in like an audit result with a fast loop on the
implicated behavior.

## Audit orchestration — dependencies first, then parallelize independent work

Audits (scenario probes, balance reports, optimizers, statistical tiers —
see `audit_toolkit_plan.md`) are probes, not gates on thinking. Typecheck,
boundary checks, and directly touched unit tests are ordinary verification,
not audits, and run inline at the logical boundaries above.

- **Order audits after their implementation dependencies.** Before
  dispatching an audit, identify the next tasks to be implemented. If any of
  them can change the code, data, fixture, controller, or semantics the audit
  measures, implement those dependent tasks first. Run the audit only when
  the next work cannot invalidate its result. Do not compensate for bad
  ordering by repeatedly auditing an implementation that is still changing.
- **Audits run in a subagent or background process.** Once their dependencies
  are complete, dispatch them and continue only with implementation work that
  cannot affect their result. Do not run a supposedly parallel audit beside
  edits to its subject.
- **Never idle-wait on an audit while there is genuinely independent work.**
  Waiting is acceptable when all remaining work depends on its result.
  Choosing dependency order correctly matters more than manufacturing
  parallelism.
- **Use results to probe, adjust, or pivot** when they arrive: green →
  continue the current line; amber → finish the edit in flight, then adjust
  the implicated parameter and re-probe; red → stop the affected line only,
  fix or hand the finding to its owning phase, re-probe. A red audit with a
  named owner is a finding, not an emergency stop for unrelated work.
- **One audit answers one question.** Start with one seed, one track, the
  shortest useful window, and the smallest existing scenario. Do not turn an
  implementation check into a track/seed/gap/duration matrix, progressive
  time-window loop, multi-lap race, or parameter sweep. Those belong to an
  explicitly owned later comparison, balance, or release phase. One focused
  rerun is appropriate after a relevant fix; repeated exploratory reruns mean
  the question or owning phase is wrong.
- **Temporary instrumentation stays bounded.** Prefer an existing counter or
  one narrowly scoped diagnostic. If answering a question requires multiple
  custom bundles, repeated source transforms, or a new sweep harness, stop and
  either add one proper bounded diagnostic in the owning implementation phase
  or defer the audit.
- **Keep audits cheap so this stays true:** the audit ladder (Tier 0
  closed-form → Tier 1 scenarios → Tier 2 seeded races → Tier 3 statistics)
  exists so the answer you need is usually seconds away — escalate tiers
  only when the cheaper one cannot answer.

## Test ownership and deferral

Tests and audits belong to the phase that provides all behavior they depend
on:

- Give every nontrivial integration scenario, comparison, population check,
  and benchmark an owning phase and an earliest runnable phase.
- During a phase, run only tests whose required production authority is
  implemented and whose result can affect that phase's next decision.
- Add focused unit coverage alongside the implementation it specifies. Do not
  pre-build or repeatedly run end-to-end tests for controllers, UI, analytic
  representations, multi-car outcomes, or performance work owned by a later
  phase.
- A later-phase test that would currently be red is pending evidence, not a
  current regression or blocker. Record it briefly under its owner and
  continue the present phase.
- Pass completion, long train escape, multi-track robustness, population
  bands, and full-race economics are not substitutes for a causal unit or
  micro-scenario. Run them only when their complete dependency chain and
  owning phase are ready.
- Phase plans should list their minimal blocking checks separately from final
  acceptance evidence. An unphased catalog of desirable scenarios is not an
  instruction to run all of them immediately.

## Greenfield: plans outrank legacy — discard, don't preserve

This is a **greenfield project**. There are no external users, no saved
games, no API consumers, and no backward-compatibility obligations of any
kind. Legacy behavior has zero preservation value:

- **When the active plan or a user request conflicts with existing
  behavior, the existing behavior loses — delete it and clean up.** Do not
  build shims, compatibility branches, feature flags, adapters, or keep
  old semantics running "just in case" alongside the new design. Carrying
  legacy (old lane-priority rules, retired state machines, superseded
  caps and timers) is the single biggest drag on implementation speed and
  a source of double-authority bugs.
- **Superseded plans describe history, not obligations.** Anything in
  `superseded/` is context for *why*, never a constraint on *what*. Only
  the active plan documents at the root bind.
- **Deletion is part of the implementation, not cleanup for later.** Dead
  state fields, unreachable branches, and orphaned counters left behind by
  a behavior change are defects of that change. Tests that encode retired
  behavior are updated or deleted *with* the change and noted in the
  report — they are not regressions to satisfy.
- **What "legacy" does NOT mean**: the zero-tolerance invariants,
  determinism discipline, module boundaries, the physics core, and
  whatever the *active* plans explicitly say to keep. Those are
  principles, not legacy. Parity fixtures are recordings, not contracts —
  re-record them deliberately when behavior legitimately changes.
- Decision rule when unsure: ask "does the active plan need this?" If no
  plan needs it and the new design contradicts it, remove it now.
  Preserving it "to be safe" is the unsafe choice here.

## Architecture and layering

`src/` layers are enforced by `tools/check-module-boundaries.js` — each layer
may import only itself and the layers listed after it:

- `shared` → shared
- `data` → data, shared
- `core` (physics, racing line, track, surface) → core, shared
- `session` (race/quali runtime; `session/racecraft/` is the behavior stack)
  → session, core, shared
- `game` (weekend flow, headless sim) → game, session, core, data, shared
- `ui` → everything above

Within racecraft there are two strata, and the distinction is the single most
important rule in this codebase:

1. **Decision layer** (the space-seeking evaluator and its cost inputs —
   see the active racing-feel plan): decides what a driver *wants*.
   Behavior and "fun" changes belong here. Remnants of the older intent
   machinery (attack/defend/tuck timers, follow-cap branches) are legacy
   scheduled for deletion, not a design to extend or preserve.
2. **Safety layer** (`feasibility.ts`, `corridor-planner.ts`,
   one-interval hard-contact viability, protected physical-overlap corridors,
   pit reservations, out-of-bounds invariants): decides what is *allowed*.
   It carries no decision authority and vetoes unsafe decisions. Never
   weaken it to make a behavior change land; if the safety layer blocks a
   desired behavior, the decision is wrong or physical overlap needs a
   negotiated drivable-arc agreement, not a bypass.

## Physical honesty — the constants policy

The racing must feel physics-based. Judged root causes and the audit of
constants that violated this are in `racecraft_racing_feel_diagnostics.md`;
the active plan is `racecraft_cost_function_plan.md`. The rule:

- Only two families of constants are legitimately physical: **body
  dimensions** (`PHYS.carLen`, `PHYS.carWid`), **grip/braking capability**
  (`PHYS` + surface model — available deceleration is
  `mu·profMu·(g + min(kDf·v², dfMax)/m)`). Decision cadence is a resolution
  parameter, not a separate reaction-latency term.
- Everything else must be **derived** from those (safe following speed,
  lateral slew, standoffs), **emergent** from modeled physics (slipstream,
  dirty air), or an explicit per-driver **character** parameter — never a
  global magic distance, speed leash, or comfort gap.
- One concept, one definition. Do not add a sixth assumed deceleration or a
  fifth lateral-overlap threshold; find the existing model and reuse or fix
  it. Duplicated near-constants are how the current problems accreted.
- Behavioral policy quantities go in `RACECRAFT_CALIBRATION_DEFINITIONS`
  (`src/session/racecraft/config.ts`) with unit, bounds, rationale, and
  owner, so `bun run analyze:racecraft:sensitivity` can sweep them. A tuned
  value with no registered definition is a smell.

## Determinism and parity

- All randomness flows through `shared/rng` (`random()`, seeded); never use
  `Math.random`. Headless and browser runtimes must produce identical races —
  `bun run test:headless-parity` checks recorded fixtures. If a legitimate
  behavior change shifts parity, re-record fixtures deliberately and say so.
- The browser exposes the live session as `window.__GL.S`; the headless sim
  (`src/game/headless-sim.ts`) drives the same `stepSession`. Keep them one
  code path — no browser-only or headless-only behavior.

## Runtime budgets (hard)

- Physics at 120 Hz, driver input every other substep, traffic
  bookkeeping/control at 30 Hz (`TRAF_DT`). **Decisions are cheaper than
  control**: expensive per-car deliberation (candidate evaluation ~10 Hz
  staggered, corridor topology search 5 Hz) runs below the control rate,
  with staleness priced into the three-tick deliberation interval and
  event-triggered re-evaluation for surprises. Do not put decision-grade work in a
  control-rate loop.
- Per arbitration update: at most **6** maneuver candidates evaluated and at
  most **1** path materialized — both are zero-tolerance invariants.
- Neighbor scans stay bounded (60 m traffic / 160 m obstacles). New per-tick
  work must be O(1) per nearby pair inside loops that already run.
- `bun run benchmark:sim` must hold ≥80% of the frozen pinned-CPU baseline
  (see `benchmark:sim:reference` for the affinity protocol).
- Session diagnostics use bounded counters and capped histories — never an
  unbounded per-frame log.

## How changes are judged

- **Hard invariants** (non-finite state, installed path out of bounds, path
  target slew >0.5 m, protected-corridor crossing, unexplained stall, pit
  deadlock, candidate/materialization limits) are bugs on first occurrence.
  Diagnostics explain faults; they never move, reset, or slow cars.
- **Population outcomes** (passes, side-by-side time, pass success,
  curb/grass exposure…) are judged against
  `tests/fixtures/calibration/metric-policy.json` bands: normal / acceptable
  (amber, not silently promoted) / absolute (red regardless of rarity). Light
  wheel-to-wheel contacts are measured but uncapped and never make a driver
  concede. Only suspension-damaging contacts are classified as hard, with an
  absolute cap of 30 per race. A normal production race has at least 100
  genuine on-track passes; short headless probes must label any
  production-distance projection explicitly.
- **Seed discipline**: develop on calibration seeds, review frozen choices on
  validation seeds, run release seeds only for the final locked suite. Never
  tune against the release population.
- Land one behavioral phase per verification cycle so the statistical suite
  can attribute any band shift to one change.

## What "better" means here

The product goal is racing that reads as alive: followers pulled close by
slipstream (no policy follow gap — brake-reachability is the only
longitudinal law), genuine pace differences (tyres, mistakes, pressure)
converting into attacks, passes that can complete, distinct driver character,
and battles that persist across corners. Light rubbing is part of that racing;
the hard-contact cap and safety invariants guard the dangerous outcomes. When
adding capability, prefer removing an arbitrary constraint over adding a
compensating mechanism.

## Conventions

- Strict TypeScript; the build rejects unresolved imports. Match the existing
  comment style: comments state constraints the code cannot show (why a rule
  exists, what invariant it protects), not narration.
- `dist/` is generated, required for browser checks, and intentionally not
  committed. Public browser commands rebuild first; `:raw` variants reject a
  stale artifact.
- Current design docs live at the repo root; superseded plans, reports, and
  the older tooling references (`RACECRAFT_DIAGNOSTICS.md`,
  `NEW_TRACK_WORKFLOW.md`) live in `superseded/` — treat them as history and
  keep exactly one active plan document per work stream at the root
  (racing feel: `racecraft_cost_function_plan.md`; parameter balance:
  `game_balance_plan.md`; audit infrastructure: `audit_toolkit_plan.md`;
  track content: `track_builder_plan.md`).
