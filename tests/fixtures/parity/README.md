# Migration parity fixtures

`headless-pivot.json` is the post-pivot production-code parity contract for a
clean lap plus focused pair, pit, priority, and classification scenarios. It
allows continuous state to differ by at most `5e-8` across JavaScript engines;
discrete state, events, ordering, validity, and classifications remain exact.

`runtime-pivot.json` is the additive browser/public-API contract after profile
and racecraft optimization. `manifest.json` remains the immutable historical
pre-TypeScript migration contract and is inspected only with
`node tools/parity-check.js --historical`.

It freezes the pre-TypeScript runtime contract. Numeric arrays are
rounded to `1e-8` and hashed with the FNV-1a token stream documented by
`tools/parity-check.js`. Pit hashes include data fields, not function source
text, because bundling legitimately reformats function bodies. The browser RNG seed is `0x51A7E` and animation frames
are disabled; session snapshots advance exactly 600 fixed `1/120 s` ticks.

Regenerate only after an intentional, reviewed compatibility change:

```sh
node tools/parity-check.js --capture
bun tools/headless-parity.ts --print
```

Behavior canaries are deliberately excluded from this parity fixture. They are
owned by the phase probes and the statistical audit ladder.
