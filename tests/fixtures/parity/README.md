# Migration parity fixtures

`manifest.json` freezes the pre-TypeScript runtime contract. Numeric arrays are
rounded to `1e-8` and hashed with the FNV-1a token stream documented by
`tools/parity-check.js`. Pit hashes include data fields, not function source
text, because bundling legitimately reformats function bodies. The browser RNG seed is `0x51A7E` and animation frames
are disabled; session snapshots advance exactly 600 fixed `1/120 s` ticks.

Regenerate only after an intentional, reviewed compatibility change:

```sh
node tools/parity-check.js --capture
```

The feature defects are deliberately excluded from this green fixture. Their
bad and corrected outcomes are owned by `tools/racecraft-followup-check.js`.
