# implementation_notes.md

## Files changed

- `AGENTS.md`
- `racecraft_cost_function_plan.md`
- `racecraft_cost_function_implementation_report.md`
- `src/game/headless-sim.ts`
- `src/session/model.ts`
- `src/session/session.ts`
- `src/session/racecraft/cadence.ts`
- `src/session/racecraft/config.ts`
- `src/session/racecraft/corridor-planner.ts`
- `src/session/racecraft/evaluator.ts`
- `src/session/racecraft/feel.ts`
- `src/session/racecraft/geometry.ts`
- `src/session/racecraft/interpolation.ts`
- `src/session/racecraft/lane-program.ts`
- `src/session/racecraft/paths.ts`
- `tests/unit/session/evaluator.test.ts`
- `tests/unit/session/lane-program.test.ts`
- `tests/unit/session/paths.test.ts`
- `tests/unit/session/pit.test.ts`
- `tests/unit/session/racecraft-config.test.ts`
- `tests/unit/session/session.test.ts`
- `tests/fixtures/parity/headless-pivot.json`
- `tools/lib/audit-invariants.ts`
- `tools/run-statistical-suite.ts`

## Checklist mapping

- P-A timer accumulation first:
  `src/session/session.ts`, `tests/unit/session/session.test.ts`
- Audit `TRAF_DT` consumers:
  `src/session/racecraft/cadence.ts`,
  `src/session/racecraft/corridor-planner.ts`,
  `src/session/racecraft/evaluator.ts`,
  `src/session/racecraft/feel.ts`,
  `src/game/headless-sim.ts`,
  `AGENTS.md`,
  `racecraft_cost_function_implementation_report.md`
- Remove/re-scope `reactionSeconds` and reconcile `AGENTS.md`:
  `src/session/racecraft/config.ts`,
  `src/session/racecraft/corridor-planner.ts`,
  `tests/unit/session/racecraft-config.test.ts`,
  `AGENTS.md`
- Remove own-claim lane authority:
  `src/session/racecraft/lane-program.ts`,
  `src/session/racecraft/evaluator.ts`,
  `tests/unit/session/lane-program.test.ts`
- Restore authored slot-zero cross-track reference:
  `src/session/racecraft/lane-program.ts`,
  `tests/unit/session/lane-program.test.ts`
- Replace multi-point smootherstep with slope-matched interpolation and
  analytic authored curvature:
  `src/session/racecraft/interpolation.ts`,
  `src/session/racecraft/geometry.ts`,
  `src/session/racecraft/paths.ts`,
  `src/session/racecraft/lane-program.ts`,
  `src/session/racecraft/evaluator.ts`,
  `tests/unit/session/paths.test.ts`,
  `tests/unit/session/pit.test.ts`
- Delete dead installed-bound/self-clamp semantics and tests:
  `src/session/model.ts`,
  `src/game/headless-sim.ts`,
  `src/session/racecraft/lane-program.ts`,
  `tests/unit/session/lane-program.test.ts`,
  `tools/lib/audit-invariants.ts`,
  `tools/run-statistical-suite.ts`,
  `tests/fixtures/parity/headless-pivot.json`
- Required P-A probe and status/report updates:
  `racecraft_cost_function_plan.md`,
  `racecraft_cost_function_implementation_report.md`

## Assumptions

- The remaining `claimBoundsAtS` helper and its direct unit assertions stay in
  scope because claims are still published data and corridor/safety readers
  still need that interpolation; only self-use as lane authority was deleted.
- The recorded P-A probe uses a two-entry free-session approximation because
  there was no existing single-car full-session probe that exposed the exact
  requested counters without writing new production hooks.
- The parity fixture was re-recorded deliberately after the reviewer fix
  because raw headless parity showed the stored pivot snapshot still reflected
  the pre-fix P-A runtime, while browser and headless already agreed with each
  other.

## Expected side effects

- Traffic logic now executes on the declared 30 Hz cadence, so per-car
  deliberation returns to the intended 10 Hz stagger.
- Lane slot zero is authored rather than measured, so cross-track feedback is
  active again and the controller will pull back toward the authored line.
- Projected lane positions can still satisfy surface/legal vetoes, but they no
  longer inject fake curvature into the speed law.
- Headless audits/statistics no longer expose a fake-zero installed-bound
  violation counter; the remaining road-bound signal is the surviving
  rejection metric.
- The stored headless parity pivot now reflects the current P-A runtime rather
  than the pre-fix snapshot.

## Deduplication / centralization decisions

- Added `src/session/racecraft/cadence.ts` so every consumer that needs the
  three-tick decision interval reads the same authority.
- Added `src/session/racecraft/interpolation.ts` so Hermite and two-point
  smootherstep sampling are shared between lane evaluation and compact path
  sampling instead of re-implemented in each call site.
