# Golden Lap — Racecraft Diagnostics Reference

This reference describes the bounded diagnostics added by
`racecraft_dynamic_corridor_plan.md`. They explain decisions and verify hard
invariants; they are not a second behavior controller and do not move or reset
cars when a fault is detected.

## Quick commands

Inspect one seeded production-headless race:

```sh
bun tools/diagnose-race-liveness.ts --track villa --seed 1011111
```

Add `--wet 0.65` for wet conditions and `--classification` for the larger
classification trace. Diagnose qualifying priority on the calibration,
validation, or release populations with:

```sh
bun tools/diagnose-priority-loss.ts --seed-set validation
```

The browser exposes the active production session as `window.__GL.S`. This is
the same session used by the game; the test facade does not maintain a shadow
copy.

## Per-entry fields

| Field | Meaning |
|---|---|
| `pathMode`, `pathTopology`, `pathModeSince` | Current semantic intent, chosen hold/left/right/brake topology, and commitment start. |
| `pathPlan`, `pathSwitchReason`, `pathCommitUntil` | Compact committed plan, why it changed, and its minimum hold time. |
| `maneuverDecision` | Last bounded selection event: selected id, reason, every compact candidate, hard rejections, separation, planner time, and materialization count. |
| `speedCapOwner`, `speedCapReason`, `vCap` | Authority currently limiting speed. Exact zero must have a physically valid owner and reason. |
| `stationaryDuration`, `stationaryCause`, `unexplainedStallAt` | Liveness state. `unexplained` is a hard invariant failure, not an automatic recovery request. |
| `pitPhase`, `pitReservationKey`, `pitWaitReason`, `pitWaitOwner` | Forward-only pit phase and any current physical conflict. Travel/merge cars must not own their old box crossing. |
| `obstacleCode`, `obstacleReason`, `emergencyEligibility` | Persisted obstacle assessment and whether runoff could become eligible if normal routes fail. |
| `emergencyAuthorization`, `obstacleMinimumSeparation`, `obstacleRejoinReason` | A runoff grant actually selected for this finite episode, its observed clearance, and rejoin result. |
| `priorityYield`, `priorityRejoinAt`, `cornerRightsRejoinAt` | Blue/qualifying preference and post-episode progressive rejoin state. |

Candidate `rejections` are hard constraints: `non-finite`, `road-bound`,
`controller-demand`, `protected-corridor`, `predicted-occupancy`,
`priority-suppression`, `priority-crossing`, `pit-reservation`,
`surface-authorization`, or `rejoin-occupied`. A rejected candidate is evidence
that the safety gate worked; it is not itself an out-of-bounds or collision
violation.

## Session aggregates

The session records bounded counters and short histories rather than an
unbounded per-frame log:

- `maneuverMaximumCandidates` must be at most 6;
- `maneuverMaximumPathsMaterialized` must be at most 1;
- `maneuverInstalledPathOutOfBounds`, `maneuverProtectedCrossings`,
  `priorityPathCrossings`, `unexplainedStalls`, and invalid pit ownership are
  zero-tolerance invariants;
- `maneuverRejectedByConstraint`, `maneuverMaterializationsByMode`, and
  `maneuverSwitchReasons` explain population behavior;
- `obstacleEpisodes` records declaration, topology, emergency justification,
  minimum separation, clearance, and rejoin reason;
- `pitReservations`, `pitDeadlocks`, `cornerRightsHistory`, and
  `priorityHistory` expose authority lifecycles and release causes;
- planner time, searches, updates, materializations, and retained state feed the
  scaling benchmark.

Histories are deliberately capped or episode-bounded. Growth with race
duration is checked separately from event counts by `bun run benchmark:sim`.

## Streaming audit events

Long-running statistics, race-worker, benchmark, browser, and track-optimizer
commands emit newline-delimited JSON events to **stderr** while they run. Their
existing final JSON or human-readable result remains on stdout, so scripts can
consume either channel independently. Every event has `schemaVersion: 1`,
`source: "goldenlap-audit"`, a `suite`, and one of `suite-start`,
`phase-start`, `case-start`, `case-result`, `progress`, `warning`, `failure`,
or `suite-result`.

Hard invariants abort at the first failing case and emit the seed/scenario plus
the precise failure list. Statistical rates continue through their required
sample count, while each race reports its current band early. The headless
benchmark reports every sample and aborts once more than half of the planned
race samples are below the throughput floor, because the median can no longer
recover. It writes an explicit `complete: false` failure artifact before exit,
so a prior completed benchmark cannot be mistaken for the current attempt.
Browser frame capture polls progress and stops immediately on a page or console
error instead of waiting for the full frame count.

On the reference WSL machine, use `bun run benchmark:sim:reference`. Its hybrid
i5-1235U exposes materially different logical-CPU performance classes: the
same deterministic race measured roughly 86.6x on CPU 0 and 39.2–53.9x on
CPUs 2–11. The release artifact therefore records `/proc/self/status` affinity
and is rejected unless it was captured on exactly one pinned CPU. This makes
the frozen-baseline comparison reproducible without changing its 80% floor.

Example event:

```json
{"schemaVersion":1,"source":"goldenlap-audit","suite":"statistics","event":"case-result","phase":"race","caseId":"prado/dry/101/0","status":"green","contacts":2,"contactBand":"normal","failures":[]}
```

## Interpreting outcomes

Hard invariant records are true bugs on their first occurrence. Population
rates such as pass success, curb exposure, contacts, yield loss, or obstacle
clearance use the machine-readable normal, acceptable, and absolute bands in
`tests/fixtures/calibration/metric-policy.json`. Outside normal but inside
acceptable is amber; it is not silently promoted to green and it does not fail
release. An absolute violation is red regardless of how statistically rare it
is.

Total contacts use `0–12` as the normal per-race band and `13–20` as the
acceptable band. They are a relative population outcome, not a zero-tolerance
safety invariant. A larger individual count emits an immediate warning but
does not truncate the population; the registered aggregate and confidence
interval determine its final status. The policy's absolute boundary applies to
that aggregate, while hard-contact, opening-contact, and side-by-side-contact
rates retain their own registered policies.

The release population is held out from calibration. Use calibration seeds to
develop, validation seeds to review a frozen choice, and release seeds only for
the final locked suite.
