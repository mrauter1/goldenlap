# Golden Lap

Golden Lap is a self-contained browser team-management and race simulation.
The authored logic lives in strict TypeScript. The game and its separate Track
Studio are generated as browser IIFEs so direct `file://` use remains supported.

## Setup and build

Use Bun 1.3.14 and Node 22.22.1:

```sh
bun install
bunx playwright install chromium
bun run build
```

After building, open `index.html` or `golden-lap.html` to play, or
`track-studio.html` to generate and inspect circuits. The generated
`dist/goldenlap.js` and `dist/track-studio.js` are required and intentionally
not committed.

The same deterministic generator is available from the terminal:

```sh
bun tools/generate-track.ts --archetype power --seed 101
bun tools/generate-track.ts --archetype balanced --seed 101 --output-dir /tmp/goldenlap-track
```

## Verification

```sh
bun run verify
```

Focused commands are `bun run typecheck`, `bun run test:unit`,
`bun run test:browser`, and `bun run test:season`. Each public browser command
rebuilds first; the `:raw` variants are internal orchestration steps and reject
a missing or stale artifact.

Fast simulation audits do not build or launch a browser:

```sh
bun run audit:effects --phase J --track prado --seed-set calibration
bun run audit:balance --track prado
bun run audit:balance:matrix --track prado --seed-set calibration
```

Audit progress is NDJSON on stderr and the final machine-readable result is one
JSON document on stdout. Effect probes and balance optimization have explicit
per-case and wall-clock budgets; hard invariants abort immediately.

Current design documents live at the repository root:
`racecraft_racing_feel_diagnostics.md` (root causes and the constants audit)
and `racecraft_cost_function_plan.md` (the active improvement plan). `AGENTS.md`
records the engineering principles for automated contributors. Historical
plans, reports, and the older tooling references
(`RACECRAFT_DIAGNOSTICS.md` for seeded liveness/planner/obstacle/priority
inspection, `NEW_TRACK_WORKFLOW.md` for the bounded profile workflow) are in
`superseded/`.

For a minified static deployment, run `bun run build:prod` and publish the HTML
entry or entries you need with their corresponding files in `dist/`. No
server, CDN, runtime package lookup, storage, or network request is needed.
