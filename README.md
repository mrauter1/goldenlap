# Golden Lap

Golden Lap is a self-contained browser team-management and race simulation.
The authored logic lives in strict TypeScript and is delivered as one generated
browser IIFE so direct `file://` play remains supported.

## Setup and build

Use Bun 1.3.14 and Node 22.22.1:

```sh
bun install
bunx playwright install chromium
bun run build
```

After building, open `index.html` or `golden-lap.html` directly. The generated
`dist/goldenlap.js` is required and is intentionally not committed.

## Verification

```sh
bun run verify
```

Focused commands are `bun run typecheck`, `bun run test:unit`,
`bun run test:browser`, and `bun run test:season`. Each public browser command
rebuilds first; the `:raw` variants are internal orchestration steps and reject
a missing or stale artifact.

For a minified static deployment, run `bun run build:prod` and publish
`index.html`, `golden-lap.html`, and `dist/goldenlap.js` together. No server,
CDN, runtime package lookup, storage, or network request is needed.
