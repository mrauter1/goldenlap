# Golden Lap — New Track Profile Workflow

The normal workflow prepares one new or changed track in a bounded 10–20
minute window. The result is the best profile validated within the supplied
budget; it is not a claim that the mathematical global optimum was found.

## Add and validate geometry

1. Add one `TrackDefinition` to `src/data/tracks.ts`. Keep its `id` unique and
   provide a closed, finite point sequence, width, palette, and metadata.
2. Run the optimizer with the 15-minute default:

   ```sh
   bun run optimize:track -- --track <track-id> --budget-seconds 900 --write
   ```

3. Inspect `output/track-optimizer/<track-id>/report.md` and `report.json`.
   The report records fingerprints, baseline and selected lap metrics,
   rejected finalists, stage timing, provisional traffic characterization,
   deadline status, and every search simplification.
4. Validate all committed profiles without rerunning optimization:

   ```sh
   bun run validate:profiles
   ```

5. Run `bun run verify:fast`, then `bun run verify` before treating the track
   as integrated. Release candidates also run `bun run verify:release`.

## Time and safety contract

- Supported budgets are 600–1200 seconds; 900 seconds is the default.
- One process owns one monotonic deadline and may use at most five seconds of
  cleanup beyond it.
- Search ends before the validation reserve. The safe deterministic heuristic
  is validated first and remains an incumbent throughout.
- Broad search is analytical; only at most eight finalists use production
  physics and robustness laps. Traffic characterization is bounded and may be
  reported provisional.
- The optimizer uses only an in-memory per-process cache. Starting a new
  command is a cold run; there is no hidden disk cache.
- An invalid geometry, unsafe heuristic, stale fingerprint, or invalid finalist
  is red. The command never writes that profile.

If the search cannot finish inside 20 minutes, reduce semantic variables,
retain the safe incumbent, and validate fewer finalists. Do not add full-grid
races to the inner loop, per-track controllers, or a more elaborate optimizer
without the evidence gate in `racecraft_dynamic_corridor_plan.md`.

## Non-production proof fixture

`tools/fixtures/new-track.ts` is intentionally absent from the production
catalog and committed profiles. It exercises missing-profile, cold search,
explicit write, generated-source bundle, controller validation, and stale
fingerprint rejection:

```sh
bun run optimize:track -- \
  --track new-track-fixture \
  --budget-seconds 900 \
  --write \
  --output-dir output/track-optimizer/new-track-fixture/cold-900 \
  --profile-file output/track-optimizer/new-track-fixture/cold-900/track-profiles.ts

bun tools/validate-new-track-workflow.ts \
  --report output/track-optimizer/new-track-fixture/cold-900/report.json \
  --profile-source output/track-optimizer/new-track-fixture/cold-900/track-profiles.ts
```

Fixture writes require `--profile-file`; this guard prevents test data from
entering `src/data/track-profiles.ts`.
