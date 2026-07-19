Implement `racecraft_cost_function_plan.md` end to end, P0 → P-D, in order.

Context: play-testing the plan-trust build surfaced three symptoms — a
35 s/lap solo collapse with random lifts, leaders yielding line and speed
to cars behind them, and rigid scalloped trajectories — and a runtime audit
added a fourth defect: the traffic cadence actually runs at 24 Hz against a
declared 1/30 s constant. All four are root-caused in the plan's "Why this
plan exists" section with file and function names. Read that section and
"Governing principle" before touching code; both are normative. When an
implementation choice is ambiguous, resolve toward "rights become prices,
prediction becomes probability, the decision is one argmin in seconds,"
and toward net deletion.

Rules of engagement:

1. The plan is self-contained. Do not re-read superseded plans. Read
   `superseded/racecraft_plan_trust_implementation_report.md` once, for P0
   reconciliation only.
2. Phase order is normative and each phase's deletion list is part of the
   phase. P-A's first item is the traffic-timer accumulation fix — no
   probe result means anything while the cadence is mislabeled. P-A lands
   before P-B; claims-as-data (P-B) lands before the evaluator (P-C).
3. The mathematics in §"The objective" is exact where marked exact. Do not
   reintroduce what it explicitly deletes: no persistence probability, no
   O/M⁰/M⁺ decomposition, no (1−Pnear)·P̃ products, no complements or
   conditionals applied to a max_k score, no mean-plus-σ risk term, no
   separate reaction latency. If a bounded approximation is needed beyond
   what the plan grants (the quadrature, the frozen-geometry λ seed, the
   Gaussian screen), record it in the implementation report with its
   error direction — do not silently substitute.
4. Derive or measure, never tune. Sources: physical, measured, sporting,
   character; resolution parameters must pass the convergence test. If a
   quantity can be neither derived nor measured, stop, record the blocker,
   do not mint a key. Zero new tuned constants.
5. Delete, don't shadow. Each authority named in a deletion list dies in
   the same phase its replacement lands. Tests encoding deleted semantics
   are deleted, not ported.
6. Per edit: typecheck + the single touched test file. Per phase: run the
   phase probe once; record green, or red with the owning phase; never
   tune against a probe or a seed. Probe assertions are derived bounds,
   not tuned thresholds.
7. Budgets are hard: candidates ≤ 6 (λ seeds replace the old left/right
   seeds, they do not append), materializations 0, cadences as declared
   after the P-A fix, benchmark at its recorded floor (run once after P-B
   and once in P-D).
8. If the plan and the tree conflict, resolve to the governing principle
   and document the deviation with reasoning in the implementation
   report. That includes AGENTS.md: P-A updates its reaction-time
   paragraphs; the tree must not end the plan disagreeing with itself.
9. The user is the outer loop, in parallel: at each phase end — `bun run
   build`, post a 3–5 line summary (what changed, what to watch for while
   playing), then continue immediately into the next phase. Never wait
   for a verdict; fold play-testing feedback in when it arrives.
10. Maintain `racecraft_cost_function_implementation_report.md` as you
    go: P0 reconciliation and the audited-cadence baseline at the top,
    then short per-phase entries (probe result, diff scope, deliberate
    expectation changes, approximations with error direction, deviations
    with reasoning). Update the plan's status table as each phase lands.

Definition of done: all phases landed and recorded, status table complete,
the plan's acceptance list is credible on-screen, net lines deleted, all
invariants zero, benchmark at its floor, and the convergence spot-checks
(K = 24 stations, doubled quadrature nodes) recorded within noise.
