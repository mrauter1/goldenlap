# Plan-Trust Following Implementation Report

## P0 — Reconciliation

Status: complete.

- Duel dynamics is present as the sole generation of racecraft authority:
  one wake, spacetime claims, overlap-only side agreements, stateless
  obligations, evaluator-owned cap candidates, and pit-entry destination
  flow.
- The legacy semantic path planner and the `priority.ts`,
  `corner-rights.ts`, and `obstacles.ts` lifecycles are absent. The orphaned
  deep-brake branch is also absent; no incomplete deletion was found.
- Baseline typecheck and module boundaries are green.
- The inherited clean benchmark is red at `14.545328147×` versus the
  `62.912×` floor. The implementation contract permits exactly two new
  invocations, after P-B and P-D, so P0 records the inherited red rather than
  consuming a third location in the schedule. P-B owns the first recheck
  because it deletes the hot-loop worst-case follow solver.
- Zero registered constants were added.

## P-A — Honest publication

Status: complete.

- Added the allocation-free `claimBoundsAtS` definition and replaced both
  distance-indexed station reads. Slot zero now remains measured, and any
  projection repairs curvature from the realized finite difference before
  lane speed is computed.
- Moved shared lane interpolation/physical-move geometry into `geometry.ts`
  so the corridor-owned station reader remains acyclic. Every remaining
  `stations[index]` read was audited and is time-sampled or explicitly maps
  time to a station.
- Physically honest deviation: the measured position is treated as the
  implicit time-zero station and interpolated to station one. Holding the
  measured envelope constant across that forward span bent a valid ideal
  line, contradicting both honest publication and the phase probe.
- Focused unit: 12/12 green. The one two-track solo probe was green on Prado
  and Costa: zero rear-loss, contact, hard-contact, lane-discontinuity,
  candidate-limit, materialization, and installed-bound failures. Build
  green. Prado still emitted one pre-existing expired-program reason canary;
  P-D owns the residue/invariant sweep rather than changing P-A geometry.
- Zero registered constants added.

## P-B — The leader is its published trajectory

Status: complete; two findings assigned forward.

- Claim stations now publish speed, and ordinary following derives one
  binding slow point from the leader's measured/published spacetime stations,
  both cars' execution noise, and one tick of possible divergence. Autopilot
  consumes that point inside its existing anticipatory integration.
- Deleted the worst-case reachability solver, transient reaction closure,
  span-maximum-curvature threat, human-reaction padding, instantaneous traffic
  clamp, follow escape authority, and the tests that specified those retired
  semantics. Pit/quali `queueFollowCap` remains a separate comfort policy.
- Focused units, typecheck, boundaries, and build were green. The one two-case
  probe held the hard-contact, overlap, candidate (6), and materialization (0)
  invariants. `near-touch-tow` remained red at `-0.711 m` minimum body
  clearance with no escape selected; P-C owns the commitment response. The
  tucked case also recorded one straight rear-loss episode; P-D owns the final
  invariant/canary sweep rather than tuning P-B from one seed.
- The scheduled benchmark was red: four samples at `13.374×`, `18.824×`,
  `19.248×`, and `19.518×` made the `62.912×` median gate unrecoverable.
  P-D owns the second and final measurement; no parameter was tuned.
- Zero registered constants added.

## P-C — The commitment deadline

Status: complete; focused behavioral findings retained.

- Added one derived deadline from the leader's first published deceleration
  beyond lift, the follower's physical full-clearance lateral time, and its
  own braking-profile speed-shed time. The deadline reuses the existing
  commitment record; no state or calibration key was added.
- Before the deadline the evaluator is unconstrained. At the next decision
  interval it must choose either the published in-line slow point or a viable
  inside/outside trajectory using the existing scalar cost, then holds that
  chosen plan until completion or a hard safety veto. Deleted launch-gap,
  draft-posture, emergency escape-permission, and orphan escape-cache logic.
- Focused units (7/7), typecheck, boundaries, and build were green. The one
  two-case probe had zero hard contact and respected candidate/materialization
  limits. `attack-launch` made one stable in-line selection but was red for no
  passing decision; `switchback` completed one of two attacks but was red
  because the selected move was not classified as a switchback. The
  attack-launch case also recorded two legal-door aborts and six half-pass
  canaries. These are P-C findings; no weights were tuned to seed 101.
- Zero registered constants added.

## P-D — Residue, observers, tally

Status: implementation complete; acceptance findings remain red.

- Removed the producerless cap/escape diagnostics and old time-gap buckets.
  The bounded headless surface now reports physical station-gap moments,
  per-corner in-line/offset commitment counts, reaction rate per lap, and
  light/hard contact counts. The station observer rejects stale or lapped
  owners using unwrapped progress and the existing traffic scan bound.
- A normal evaluator transition from a spatial plan to hold/brake now authors
  its recenter program explicitly, instead of letting maintenance misclassify
  that transition as expired authority. Active commitments also survive the
  deadline itself and end only on a physical pass, target loss, or hard veto;
  the retired deadline-plus-car-length abort caused the recorded half-pass
  churn. Focused units, typecheck, boundaries, diff hygiene, and the final
  build are green.
- The single full-field Prado probe was finite and classification-valid:
  maximum candidates `6`, materializations `0`, installed out-of-bounds `0`,
  hard contacts `0`, DNFs `0`, unexplained stalls `0`, and pit deadlocks `0`.
  It produced 38 passes from 114 attempts and 248 light contacts. It was red
  for 56 straight rear-loss observations, 185.21 reactions/lap, corner
  commitments overwhelmingly selecting in-line, and pre-correction
  observer/program-expiry residue. The obvious observer wrap and deliberate
  recenter-lifecycle defects were corrected after that probe; the phase probe
  was not rerun.
- The second and final benchmark invocation was red and unpinned: `5.583×`,
  `5.659×`, `8.101×`, and `12.371×` made the `62.912×` median gate
  unrecoverable. No parameter was tuned and no third invocation was taken.
- Structural deletion tally: 16 obsolete behavior helpers/authorities, 12
  dead session diagnostics, 18 retired focused-output keys, and five obsolete
  metric-policy entries were removed; three behavior definitions and two
  bounded observer records replace them. The inherited worktree had no P0
  commit, so Git cannot produce an honest plan-only numeric LOC delta; no
  synthetic line count is claimed. Zero registered constants were added.

## End audit

- `bun run test:invariants`: 50 passed, 3 red. Two unrelated track tests
  exceeded their five-second per-test timeout while audits ran concurrently;
  the remaining existing track-content failure is a `0.00710098 m` non-neutral
  ideal-line offset in the pit/start window. It is outside this plan's
  racecraft authority and was not spot-fixed.
- Headless parity was deliberately scheduled after the final build, but no
  fixture was written. Chromium was denied by the sandbox and both
  out-of-sandbox approval reviews timed out; the Firefox fallback reached its
  Playwright pipe but timed out under the same IPC/filesystem restrictions.
  The existing fixture remains untouched rather than recording an
  unverified headless-only snapshot.
