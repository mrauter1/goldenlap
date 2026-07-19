# Audit Toolkit Implementation Report

Source of truth: `audit_toolkit_plan.md`, implemented after rereading the
repository-level `AGENTS.md` engineering and audit-orchestration rules.

## Delivered

- `bun run audit:effects` runs cached, production-backed G/H/I/K/J/C scenario
  probes for faster-following, overlap, tow, protected corners, light rubbing,
  defense legality, switchbacks, passing-spot selection, and train pressure.
  It supports named seed sets, custom seeds/tracks, per-case deadlines, a suite
  wall budget, early verdicts, and optional abort-on-red.
- `bun run audit:balance` is the millisecond Tier-0 strategy report. The tyre
  and wear values used by production are registered once with bounds,
  rationale, and temporary candidate overrides.
- `bun run audit:balance --optimize tyres|racecraft|all` performs bounded
  coordinate descent only over registered keys. Every simulated candidate is
  Tier-1 gated; hard invariants abort the search. Its artifact says
  `complete:false` until a run really finishes and remains incomplete after a
  wall-budget abort.
- `bun run audit:balance:matrix` runs 5–10-lap, paired-seed soft/hard strategy
  assignments with swapped drivers, lap-stratified output, per-case deadlines,
  and immediate hard-invariant failure.
- Full races expose opening-lap and steady-state strata plus the new attack,
  defense, stability, battle-loss, and per-corner pass counters. The
  statistical aggregator consumes these counters. New population metrics are
  observe-only until calibrated; total and light contacts are explicitly
  uncapped, while hard contacts alone fail above 30.
- Every audit writes unbuffered `goldenlap-audit` NDJSON events to stderr and
  exactly one final JSON result to stdout. No audit builds the browser bundle
  or launches a browser.

## Current targeted findings

Prado, seed 11, is a smoke sample rather than a population conclusion:

| Probe | Result |
|---|---|
| G light rub | Green: one light contact, battle survives, no forced-room seed |
| H fresh versus worn | Green: pass completes inside three laps |
| H equal wear | Amber seed miss; aggregate 80% criterion remains red with only this seed |
| I faster car alongside on straight | Green: clean pass, no brake/rear-loss canary |
| I full protected corner | Amber: +0.533 s versus solo; acceptable ≤1.0 s, outside normal ≤0.4 s |
| K rear stability | Green |
| K one-second tow-to-overlap | Red: gains distance but does not overlap before braking |
| J defense, switchback, spot selection | Green for all four focused cases |
| C underspeed train | Green: multiple followers attack immediately |

The K target should be revisited as an acceptance-model question before any
more drag tuning: requiring an equal car one second behind to erase roughly a
full second on one straight is not generally achievable through plausible drag
reduction alone. The H equal-wear miss is a real attack-completion finding and
remains owned by Phase H. Neither finding justifies unbounded parameter search.

Tier-0 Prado currently reports the existing tyre imbalance rather than hiding
it: hard-only beats soft-only by 13.709 s, mixed is 13.329 s from the best pure
strategy, the stop difference of two is acceptable but outside normal, and the
5.602 s undercut is acceptable but outside normal. Those are inputs for a
deliberate balance pass, not toolkit failures.

## Verification performed

- TypeScript typecheck and strict module-boundary check: green.
- Metric-policy JSON parse: green.
- 46 focused tests across traffic, paths, headless simulation, audit toolkit,
  statistical policy, and worker serialization: green in 8.34 s.
- G/I/J/C CLI smoke: 0 failures in 0.48 s; overall amber only for the accepted
  +0.533 s protected-corner tail.
- A forced 1 ms optimizer budget wrote an amber artifact with
  `complete:false`, `reason: wall budget exceeded`, and no partial candidate
  presented as complete.
- Pinned-CPU benchmark: median race throughput 87.692× versus the 62.912×
  minimum; planner candidate maximum 4/6 and path materialization maximum 1.

The slow matrix population, statistical/release suites, browser checks, and
full verification command were intentionally not run in this implementation
loop. They remain phase/release gates and were not needed to validate the
toolkit mechanics.
