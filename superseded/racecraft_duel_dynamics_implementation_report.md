# Duel Dynamics Implementation Report

## P0 — Reconciliation

Status: complete; audit recorded.

- The legacy semantic racecraft path planner (`syncRacecraftPaths` /
  `desiredPlan` / `installPlan`) is absent; pit retains its dedicated path
  system.
- Reconciliation found an unreported, incomplete deep-brake implementation
  from the interrupted prior session. It currently breaks typechecking and
  would add a second braking authority outside this plan, so P0 owns its
  complete deletion rather than preserving or finishing superseded work.
- The orphaned deep-brake candidate, model state, braking override,
  diagnostics, and tests were deleted completely.
- Start release and pit exit now author ideal-relative zero-state handoffs;
  pit merge room explicitly releases when its physical reason disappears.
- Pit sampled-path phase changes pin their first anchor to the previously
  commanded path target, eliminating authority handoff slew.
- Dead `latTgt`, room, and claim-adapter compatibility fields were removed;
  diagnostics now read the lane program directly.
- Benchmark reconciliation consumed exactly the two shared invocations. The
  first was invalid under concurrent audit load (median `5.408352403×`); the
  second ran alone and was red at median `14.545328147×` versus the
  `62.912×` floor. P0 owns the unresolved performance finding; no third run
  or benchmark-driven tuning was performed.

## P-A — One Wake, Honest Stations

Status: complete; probe consumed once.

- `core/physics` now owns one widening wake and one body-overlap calculation;
  traffic publishes its shared drag/grip strengths to the existing strategy
  consumers. Both independent lateral tapers and the ghost-wake decay were
  deleted. `wakeSpreadRate` is the plan's sole new registered key.
- The core wake accepts the existing range and new spread calibration as an
  explicit parameter object. This is the layer-safe form of the plan's
  shorthand three-argument signature: core cannot import session calibration,
  and duplicating either value would violate one-definition ownership.
- Escape reachability reuses the follower claim's dynamic execution noise and
  matches leader speed at the floor. Waiting candidates target the
  five-sample, tow-derived `optimalLaunchGap`; lateral pull-out candidates do
  not inherit that station cap.
- Deliberate expectation change: partial body coverage now retains side draft,
  and dirty-air grip is the same wake strength gated by actual lateral load.
- Probe: partial-overlap wake strength was `0.2984` at 6.15 m downstream,
  1.5 m lateral separation, and 55 m/s — `37.3%` of the aligned wake.
  Pull-out was red (`0/3`, no attack selected or completed), owned by P-A.
  The exact 0.5–1 m station mode is not exposed by the current headless
  surface; observed minimum clearances were 2.67–3.26 m.
- Hard failures were zero; maximum candidates `6`, materializations `0`.

## P-B — Spacetime Claims and Parallel Running

Status: complete; probe consumed once.

- Every claim conflict is now a same-time co-presence test. Predicted light
  contact remains feasible with a physical time-loss/damage risk; only the
  shared suspension-damaging severity threshold is a hard veto.
- A per-pair side agreement is created only at actual longitudinal body
  overlap, preserves the established lateral ordering through zero states,
  and releases after bumper-clear plus the existing derived hysteresis.
- Empty programs target the evaluator bias line, clamped to their current
  claim. A live side agreement is itself a reason to keep evaluating that
  zero state.
- Deliberate expectation change: there is no pre-overlap negotiated right.
  Both cars price their predicted trajectories and contact consequences;
  the overlap agreement stabilizes an order that physically exists.
- Probe: side agreements appeared in `3/3`, but claim ping-pong was `3/1/0`
  and two tracks converged to within 3 mm; crossing was red (`0/3`, no
  switchback selected). These are recorded P-B findings, not tuned.
- Light rub remained feasible and battle-preserving in `3/3`; hard contacts
  were zero. The targeted light-cost/damaging-veto fixture passed 2 tests and
  11 assertions. Maximum candidates `6`, materializations `0`.
- Being-passed lap loss was unmeasured because the probe produced no complete
  battle-lap sample; no substitute threshold was invented.

## P-C — Reactive Minimalism

Status: complete; probe consumed once.

- Following, slow-point, claim, and collision limits are candidate inputs,
  not post-selection speed overrides. A slow point remains binding only while
  the selected trajectory is actually behind its leader.
- Reactive selection minimizes separation-restoration time loss while keeping
  hard-contact and track-bound feasibility absolute. Legacy emergency and
  follow-cap authorities were deleted instead of shadowed.
- Reaction-rate and emergency-lift observers are bounded diagnostics exposed
  through the existing headless summaries.
- The former priority-yield observer is now the stateless obligation-yield
  observer; its recorded loss red will be remeasured by the P-C probe.
- Probe: parking events `0`; obligation yield loss `0.114514713 s` versus the
  0.5 s target; hard contacts `0`; maximum candidates `6`;
  materializations `0`.
- Reaction baseline: `2,643` events, `165.1875` per completed car-lap;
  emergency lifts `4`. This is a recorded baseline, not a tuned target.
- The shared clean benchmark was red at `14.545328147×` versus `62.912×`;
  this remains the P0-owned finding recorded above.

## P-D — Stateless Obligations and Destination-Owned Pit Flow

Status: complete; probe consumed once.

- Blue-flag, qualifying, damage, and emergency duties are stateless
  `owes(debtor, beneficiary, context)` relations evaluated from live geometry
  and race state. Revoked programs publish measured occupancy rather than
  continuing to reserve a fictional path.
- Pit intent is an evaluator-owned destination constraint on the normal lane
  program. Dedicated sampled pit paths begin only after the physical pit
  transition; merge-out occupancy uses the ordinary claim ledger.
- `priority.ts`, `corner-rights.ts`, `obstacles.ts`, their lifecycle state,
  their control overrides, and their behavior-encoding unit tests were
  deleted. Headless instrumentation now observes obligations and hazards
  without creating control authority.
- Physically honest resolution: collision prediction and positive contact
  cost replace pre-overlap corner ownership; overlap-only side agreements
  preserve established order, never prohibit light rubbing.
- Probe: blue-flag loss was red at `1.175614941 s`; all `20/20` blue lift
  samples occurred outside a forced single-file span and the beneficiary lost
  58.81 m versus control. P-D owns the finding; no weight was tuned.
- Qualifying traffic and two forced pit stops completed with no deadlock,
  false leader, stall, or hard contact. Stopped-car routing is unmeasured
  because no public production-headless scenario exposes it.
- Deletion tally: at least 2,200 tracked legacy lines removed versus 507 lines
  in the replacement geometry/relation modules and their unit test, a net
  reduction of at least 1,693 lines before counting the untracked deleted
  `obstacles.ts`.

## Audit-sequencing note

- P-A, P-C, and P-D consumed their one probes before final review found one
  remaining adapter shortcut that skipped contact pricing while moving away.
  The shortcut was deleted and the touched feasibility tests/typecheck passed.
  P-B consumed its probe on that final implementation. The earlier probes were
  deliberately not rerun under the one-probe contract; the late deletion
  affects predicted contact cost only.

## Final deterministic verification

- `bun run typecheck`, module boundaries, every touched unit file, the final
  `bun run build`, and `git diff --check` are green.
- `headless-pivot.json` was deliberately re-recorded exactly once after the
  final build. The recorder verified browser/headless equality for clean,
  pair, pit, obligation (fixture key retained as `priority`), and
  classification scenarios before writing it.
- The runtime invariant counters exercised by every phase probe were zero.
  The broader `bun run test:invariants` finished `52/54`: the unrelated
  racing-line fixture expected a pit/start offset below `1e-9` but observed
  `0.0071009777777777785`, and the track-profile round-trip test exceeded its
  5 s timeout. Both files are outside this plan's map; neither was changed or
  used as a reason to broaden the duel-dynamics scope.
- The clean benchmark median was `14.545328147×` against the `62.912×`
  floor. Together with the P-A, P-B, and P-D probe findings above, this is an
  attributed red—not a parameter-tuning invitation from a single probe.
