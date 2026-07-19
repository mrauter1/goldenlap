# Duel Dynamics Plan Review

The behavioral direction is coherent, but the current plan has four blocking
contract contradictions:

- **P0/M12 disposition is ambiguous.** The plan is self-contained and names
  evaluator/claims/EV as retained foundations, yet says to “finish any
  incomplete phase item.” The orphaned M12 deep-brake branch had no completed
  report or active specification. The plan must explicitly say either “delete
  orphaned M12” or provide its completion contract. Under the current wording,
  deletion is the only self-contained greenfield reading. See
  `racecraft_duel_dynamics_plan.md:3`.

- **The file map cannot support the specified work.** It says “nothing else”
  and keeps pit/priority untouched, but P-B needs session model state, P-C
  needs observer/model surfaces, and P-D explicitly deletes logic owned by
  `priority.ts`, `obstacles.ts`, traffic, and model state. Expand the map or
  narrow those phases. See `racecraft_duel_dynamics_plan.md:181`.

- **P-D conflicts with the safety contract.** Side agreements begin only at
  body overlap, while corner rights provide negotiated protection before
  overlap. Folding corner-rights authority into side agreements without a
  pre-overlap replacement would weaken the safety layer, contrary to
  `AGENTS.md:163`. Clarify that protected-corridor authority remains, or define
  an equivalent pre-overlap negotiation.

- **Scope is contradictory.** P-D is fully specified and “Beyond” says nothing
  beyond P-D, but the status table—updated by me from your prior explicit
  scope—says this session ends at P-C. The revised plan must state whether P-D
  is now scheduled. See `racecraft_duel_dynamics_plan.md:134`.

## Two smaller corrections

- `executionNoiseMargin` is not an existing scalar. Claims use a dynamic
  per-car `claimExecutionNoiseMetres`, derived in
  `src/session/racecraft/corridor-planner.ts:118`. P-A should explicitly reuse
  that value, including its derived fallback.

- P0 requires the benchmark to be green before P-A, while the contract permits
  runs only after P-A and P-C. Specify whether there are two or three benchmark
  invocations.

Implementation is paused mid-P0. I had started deleting the orphaned M12
branch before your review request, so the current tree is temporarily not
typecheckable; no probe or build was run.
