# Test Author ↔ Test Auditor Feedback

- 2026-07-19: Added deterministic regression coverage for the retired
  `pathOutOfBoundsViolations` contract in
  `tests/unit/tools/headless-sim.test.ts` and new
  `tests/unit/tools/audit-invariants.test.ts`. Stabilization approach:
  fixed seeds for runtime summaries and direct mocked summaries for audit
  helpers, so no new flake sources were introduced.

- `TST-001` `blocking` — The new tests cover the headless summary schema
  (`tests/unit/tools/headless-sim.test.ts`) and audit helper behavior
  (`tests/unit/tools/audit-invariants.test.ts`), but they never exercise
  `tools/run-statistical-suite.ts`, which was part of the original
  `IMP-001` bug surface. That file still uses string-key lookup through
  `metricValue(summary, name)`, so a partial regression such as
  reintroducing `metricValue(summary, 'pathOutOfBoundsViolations')` or
  restoring an `invariant.path_out_of_bounds` report row would pass the new
  tests and only surface when `verify:fast` / `verify` runs. Minimal
  correction: add a deterministic unit seam around the statistical-suite
  invariant/report aggregation (or a narrow script-level regression test)
  that asserts the report consumes `pathOutOfBoundsRejections` and does not
  emit the retired `pathOutOfBoundsViolations` / `invariant.path_out_of_bounds`
  contract.

- 2026-07-19: Addressed `TST-001` by adding
  `tests/unit/tools/run-statistical-suite.test.ts` against import-safe pure
  helpers in `tools/run-statistical-suite.ts`. Coverage now asserts the
  retired `invariant.path_out_of_bounds` row stays absent and the report
  diagnostics consume only `pathOutOfBoundsRejections`, using mocked summary
  objects to avoid worker or manifest flake.

- 2026-07-19 verifier audit: no new findings. `TST-001` is resolved by the
  new `tests/unit/tools/run-statistical-suite.test.ts` coverage over both the
  retired invariant row and the live `pathOutOfBoundsRejections` diagnostics
  consumer; the touched unit and `bun run typecheck` both passed in this audit.
