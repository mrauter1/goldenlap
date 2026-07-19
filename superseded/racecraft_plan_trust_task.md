Implement `racecraft_plan_trust_plan.md` end to end, P0 → P-D, in order.

Context: play-testing the duel-dynamics build surfaced two symptoms —
cars losing the rear and fishtailing on corner exit / straights /
high-speed corners, and followers overslowing into corners so the gap
balloons at every entry. Both were root-caused by static analysis; the
plan's "Why this plan exists" section documents the exact defects with
file and function names. Read that section and the "Governing principle"
section before touching code. The principle section is normative, not
commentary: when an implementation choice is ambiguous, resolve toward
"assume rivals execute their published plans, bounded by measured
execution noise, re-verified every tick," and toward net deletion.

Rules of engagement:

1. The plan is self-contained. Do not re-read superseded plans. Read
   `superseded/racecraft_duel_dynamics_implementation_report.md` once,
   for P0 reconciliation only.
2. P-A lands before anything else: plan-trust is meaningless while
   publication is corrupted, and every later phase builds on honest
   claim stations.
3. Zero new registered constants. Every gap, margin, or deadline must be
   derived from published profiles, execution noise, or `TRAF_DT`. If
   you cannot derive it, the design is wrong — stop, record the blocker
   in the implementation report, do not mint a key.
4. Delete, don't shadow. Each authority named in a deletion list is
   removed in the same phase its replacement lands — two authorities
   over one concern is how the previous generation's bugs happened.
   Tests that encode deleted worst-case behavior are deleted, not
   ported.
5. Per edit: typecheck + the single touched test file. Per phase: run
   the phase probe once; record green, or red with the owning phase; do
   not tune against the probe; continue. No statistical tiers, no
   sweeps, never tune against a single seed.
6. Budgets are hard: candidates ≤6, materializations 0, cadences
   120/60/30/10/5 Hz unchanged, benchmark at its recorded floor (run
   once after P-B and once after P-D).
7. If the plan and the tree conflict, resolve to the physically honest
   reading and document the deviation with reasoning in the
   implementation report.
8. The user is the outer loop, in parallel: at each phase end — `bun run
   build`, post a 3–5 line summary (what changed, what to watch for
   while playing), then continue immediately into the next phase. Never
   wait for a verdict; fold play-testing feedback in when it arrives.
9. Maintain `racecraft_plan_trust_implementation_report.md` as you go:
   reconciled P0 status at the top, then short per-phase entries (probe
   result, diff scope, deliberate expectation changes, deviations with
   reasoning). Update the plan's status table as each phase lands.

Definition of done: all phases landed and recorded, status table
complete, the plan's acceptance list is credible on-screen, net lines
deleted, all invariants zero, benchmark at its floor.
