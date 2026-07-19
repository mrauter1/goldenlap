# test_strategy.md

## Behavior-to-test coverage map

- Traffic timer accumulation and true 30 Hz / 10 Hz cadence:
  covered by `tests/unit/session/session.test.ts`.
- Removal of `reactionSeconds` as racecraft authority:
  covered by `tests/unit/session/racecraft-config.test.ts`.
- Removal of own-claim lane authority and restoration of authored slot-zero
  reference:
  covered by `tests/unit/session/lane-program.test.ts` and
  `tests/unit/session/evaluator.test.ts`.
- Slope-matched multi-point interpolation plus authored-curvature retention:
  covered by `tests/unit/session/lane-program.test.ts`,
  `tests/unit/session/paths.test.ts`, and `tests/unit/session/pit.test.ts`.
- Removal of retired installed-bound summary contract:
  covered by `tests/unit/tools/headless-sim.test.ts` and
  `tests/unit/tools/audit-invariants.test.ts`.
- Removal of retired installed-bound statistical-suite consumers:
  covered by `tests/unit/tools/run-statistical-suite.test.ts`.

## Added in test phase

- `tests/unit/tools/headless-sim.test.ts` now asserts both focused-session and
  full-race summaries expose `pathOutOfBoundsRejections` and do not expose the
  retired `pathOutOfBoundsViolations` key.
- `tests/unit/tools/audit-invariants.test.ts` adds direct regression coverage
  for the audit helper contract:
  the stale `pathOutOfBoundsViolations` key is ignored even if present on a
  mock summary, while active invariant failures like
  `hard-contact-cap` and `lane-edit-unpinned` still fire.
- `tests/unit/tools/run-statistical-suite.test.ts` adds direct coverage for
  the remaining string-key consumer in `tools/run-statistical-suite.ts`:
  the retired `invariant.path_out_of_bounds` row stays absent, and report
  diagnostics continue to consume only `pathOutOfBoundsRejections`.

## Determinism and flake control

- All new runtime-backed assertions reuse fixed seeds from existing headless
  tests; no new timing windows or asynchronous polling were added.
- The audit helper tests use direct mocked summaries, so they are pure,
  deterministic, and isolate the summary-contract regression without invoking
  browser or filesystem flows.
- The statistical-suite aggregation test uses direct mocked summary objects and
  imported pure helpers only; no workers, manifests, or full audit runs are
  invoked, so the coverage stays deterministic and cheap.
