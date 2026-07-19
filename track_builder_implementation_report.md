# Track Builder Implementation Report

Implementation snapshot: 2026-07-16. The stream completed T0 through T3 in
order. T4 and T5 remain pending because the mandatory racecraft sequencing
gate is closed.

Post-snapshot finding: the original geometric realizer places token waves on
a fixed stadium scaffold, so its T0 acceptance evidence proves safety and
determinism but not genuine route-topology diversity. The active
`track_builder_plan.md` therefore supersedes geometric completion with phases
R0–R5. This report remains the historical record for the retained generator,
quality, real-scale, CLI, and Studio infrastructure; it is not evidence that
the first realizer meets the revised topology contract.

## R0 — Topology characterization

`tools/characterize-trackgen-topology.ts` measured 60 seeds per archetype and
all six authored tracks using translation/rotation/scale-normalized route
metrics. The old generator produced many coordinate fingerprints, but retained
fixed structural sequences: every balanced seed had exactly eight curvature
sign runs and six secondary-principal-axis reversals. Its return-section pair
count ranged from 0–14 (mean 3.933), while all six authored definitions
measured zero under the same conservative detector. Power reference-route
distance ranged 0.016979–0.063045, balanced 0.020899–0.083344, and technical
0.024825–0.082992. This is the frozen counterexample: coordinate variation
does not establish topology variation.

The new topology unit fixtures distinguish a folded route from a convex
scaffold and prove route-distance invariance under translation, rotation, and
uniform scale. Focused typecheck, boundaries, and both tests were green. No
legacy definition or fixture changed.

## Outcome

The repository now has a deterministic, UI-free generator in
`src/game/trackgen/`, a bounded CLI quality loop, real-scale variable-width
track support, definition-file support in the offline validation tools, and a
second file-safe browser bundle for the Track Studio. The six authored tracks
retain their scalar-width geometry and legacy pit constants exactly.

No generated track was added to the production calendar. The active
`racecraft_trajectory_revamp_plan.md` marks L3–L5 incomplete and its
implementation report marks L3 in progress, with L2 verification exceptions
still open. Non-pit
`materializePathPlan`/full-track path work also remains present. Therefore the
T4 showcase probes would measure transitional racing behavior, which the
handoff explicitly forbids. `signatures/spa.json`,
`signatures/interlagos.json`, the two showcase definitions, their generation
artifacts, and T5 policy promotion are intentionally pending rather than
fabricated or tuned against the wrong behavior.

## T0 — Generator core

Implemented:

- deterministic rhythm grammars for power, balanced, and technical tracks;
- seeded realization through `shared/rng`, exact position/heading closure,
  variable-width authoring, and production-spline sampling shared with
  `buildTrack`;
- hard closure, closure-heading, curvature-rate, crossing, and clearance
  gates, plus length, speed, straight, corner-class, direction, complex,
  pit/grid, and pit-loss gates;
- `tools/generate-track.ts`, bounded known-bad tests, a warmed throughput
  test, and `tools/audit-trackgen.ts`;
- observe-only `trackgen.*` catalog entries. The invariant gates themselves
  remain zero-tolerance; observe-only applies only to population-policy
  promotion.

Final 10,000-seed audit (`bun tools/audit-trackgen.ts --seeds 10000`):

| Result | Value |
|---|---:|
| Accepted | 4,012 / 10,000 (40.12%) |
| Power | 2,817 / 3,334 (84.4931%) |
| Balanced | 339 / 3,333 (10.1710%) |
| Technical | 856 / 3,333 (25.6826%) |
| Candidate generation | 67,960.801 ms; 147.144 candidates/s |
| Strict invariant rechecks | 144,202.214 ms |
| Total audit | 212,205.087 ms |
| Accepted candidates escaping any hard invariant | **0** |

The strict recheck covers every accepted candidate at full separation stride,
so the 0 count includes closure, heading closure, curvature rate,
self-intersection, and minimum-clearance escapes. The audit tool reports
candidate-generation time separately from the intentionally more expensive
full invariant recheck; the 100 candidates/s target applies to Tier 0, not to
the redundant 10k proof.

Bun and Chromium initially differed by about 1e-10 in three derived policy
metrics despite identical plans and geometry. Those three cross-runtime
derived reports (average speed, lap time, and pit-loss fraction) are now
canonicalized to 1e-9, far below any gate resolution; the hard geometry
metrics retain their unrounded values. The final browser smoke deep-compares
the CLI and browser candidate for power seed 1 exactly.

## T1 — Quality loop

`generateAcceptedTrack` builds surviving candidates through the real
`buildTrack`, semantic-corner detection/refinement, `previewIdealLine`, and
the existing `corner.passScore`. It rejects or mutates within a caller-bounded
attempt count and emits a versioned generation artifact with definition and
provenance fingerprints. The Track Studio reuses the same draft analysis
rather than maintaining a UI-specific scoring path.

The 60-search acceptance probe (source seeds 1–20 for each archetype,
maximum 50 attempts) accepted all 60:

| Archetype | Mean attempts | Mean wall time | Tier-0 survivors passing Tier 1 | Pass-spot range |
|---|---:|---:|---:|---:|
| Power | 1.05 | 174.9 ms | 97.5% | 3–6 |
| Balanced | 16.10 | 263.6 ms | 52.5% | 4–6 |
| Technical | 4.75 | 100.3 ms | 65.0% | 2–7 |

Every accepted search is well below the 30 s budget. A Tier-0 survivor can
still fail semantic mapping; that is a bounded quality rejection, not a
safety bypass, and the search proceeds to the next deterministic attempt.

## T2 — Real-scale hardening

Implemented:

- optional cyclic `TrackDefinition.widthProfile`, sampled into
  `Track.halfWidth`, with local surface, curb, racing-line, renderer, pit,
  stand, grid, camera, and minimap geometry;
- optional `TrackDefinition.pit.class`. `grand` uses 64 m / 80 m ramps, an
  88 m first-box position, 14 m box spacing, and a 284 m six-team lane.
  An absent hint keeps today's 42 m / 46 m ramps, 58 m first-box position,
  10 m spacing, 186 m lane, and 52 m exit exactly;
- generated-track flow zones at approximately one per 300 m, while scalar
  legacy tracks retain 14 zones and their random-consumption surface;
- definition-file inputs for `optimize-track`, `benchmark-sim`, and
  `audit-effects`, all using the production headless track preparation path;
- width/pit provenance hashing that is conditional, so definitions without
  the new fields retain their prior fingerprints.

Legacy reconstruction evidence:

| Track | Geometry hash |
|---|---|
| Prado | `0eca6881` |
| Costa | `00abb0a0` |
| Nordwald | `4f7299ff` |
| Villa | `1efada7d` |
| Anhembi | `9aebae71` |
| Cerro | `6f7fb12f` |

Every legacy width sample and pit scalar also matched. Stored track profile
fingerprints remained `af35540f`, `d061be2c`, `bfd5fc5e`, `265d81d6`,
`2ac47c13`, and `445b4ff8`; physics remained `90f02c17` and surface remained
`11738317`. No parity or profile fixture was re-recorded. Profile validation
did observe Cerro two physics ticks away from its stored time
(83.295833 s versus 83.279167 s, tolerance one tick); this originates in the
concurrent racecraft stream and was not hidden by a track-builder fixture
rewrite.

The generated power seed-1 probe is 7.1 km with variable width and a grand
pit. A deliberately short 15 s / 24-evaluation optimizer exercise completed
in 19.295 s (4.295 s cleanup overrun), selected a normal profile, improved
the verified lap from 132.5750 s to 132.5125 s, and reported zero grass,
contacts, hard contacts, rights violations, path crossings, pit false
leaders, or pit deadlocks. This demonstrates that the unchanged 600–1,200 s
production budget has ample headroom at 7 km.

The required 7 km runtime benchmark was run and is red, not waived:

- full-field samples: 24.388x and 13.377x versus the frozen 62.912x floor;
- cold track preparation: 3,618.038 ms;
- diagnostic maximum: 4 candidates/update (limit 6) and 1 materialized
  path/selection (limit 1), with no hard-invariant failure.

The slowdown follows the still-present racecraft full-track path
materialization cost as sample count grows. Removing that remaining authority
belongs to trajectory-revamp L4 (L2 retains a recorded performance exception);
this stream was explicitly
forbidden to change racing behavior or its calibration. The failure is kept
visible as an external T2 gate rather than weakening the benchmark or adding
a generated-track special case.

The 7 km `audit-effects` integration probe completed all 19 cases with no
hard invariant, candidate-limit, or materialization-limit failure. Its red
battle-economy/tow/switchback/spot-selection outcomes are pre-revamp behavior
findings and are the reason T4 remains gated; they were not tuned in this
stream. The first cold flying-lap case also exceeded its 5 s case deadline,
while equivalent warmed cases completed normally.

## T3 — Track Studio

Implemented:

- `src/track-studio-main.ts`, explicitly registered as a composition root;
- `track-studio.html` and the independent generated
  `dist/track-studio.js` bundle (never committed), wired through
  `build:studio`, development/production builds, artifact freshness checks,
  and browser smoke;
- seeded archetype generation, deterministic corner-parameter and corner-order
  scrambles, draggable signature tokens, range editing, and signature JSON
  load/copy;
- the game render cache with variable road width, curbs, pit lane/boxes,
  start/grid markings, pan/zoom, seed comparison, draft line, semantic
  class/radius/pass labels, braking zones, longest-straight/full-throttle
  label, and curvature strip;
- generated and legacy gate panels, draft lap/average speed, five-class
  histogram, `TrackDefinition`/artifact export, definition import, all-six
  calendar import, and display-only loading of CLI deep-validation artifacts.
  No optimizer, headless race, or multi-minute workflow runs in-browser.

Final `tools/track-studio-check.js` result:

- status/exit: green / 0;
- browser/CLI exact determinism: power seed 1;
- 7 km interaction samples: 117.2, 255.3, 148.9, 260.6, 101.5, 168.4,
  151.0, and 98.0 ms; median 148.9 ms, p90 260.6 ms;
- all six authored tracks: valid draft line, 8–20 semantic corners, and
  1,196–2,202 production samples;
- visual probe: 830×606 canvas, meaningful opaque/color variation, six
  legacy validation rows, five histogram rows, and no browser errors.

The original plan target was p90 <150 ms. During implementation the user
explicitly directed the stream to stop optimizing once generation was under
30 seconds. The smoke therefore records both values and gates at the new
30,000 ms ceiling. The measured 260.6 ms p90 misses the original target but
is 115× below the accepted ceiling. No racing or generator acceptance policy
was changed for this deviation.

A follow-up Studio control revision replaced Previous/Next/Mutate with three
orthogonal signature operations: parameter ranges only, non-straight token
ordering only, or both. Straight slots and the visible generation seed stay
fixed, while every scramble remains reproducible through `shared/rng`. The
focused scramble suite passed 5/5, typecheck and boundaries stayed green, and
the Studio bundle rebuilt successfully. Browser automation was intentionally
omitted for this small revision at the user's direction.

The follow-up `verify:fast` also passed both bundles, boundaries, all five
scramble tests, all four Tier-0 tests, and the Tier-1 quality test before an
unrelated concurrent racecraft edit stopped the raw unit stage:
`REJOIN_DISTANCE` was undefined in `src/session/racecraft/paths.ts`. No
track-builder fixture was changed in response.

## Verification and fixture record

Focused checks on the final implementation:

- `bun run typecheck`: green;
- `bun run check:boundaries`: green (70 TypeScript files, acyclic imports,
  both script-only composition roots enforced);
- touched tests: 8/8 green across Tier 0, Tier 1, real-scale track, and flow
  suites;
- development build: both game and studio bundles green;
- browser smoke: green, including both legacy entrypoint parity checks and
  the Track Studio result detailed above.

Post-T3 `bun run verify:fast` passed typecheck, both bundles, and boundaries,
then stopped in the raw unit suite with 120 passing tests and eight timeouts
after 236.87 s. There were no assertion mismatches. The timeouts were owned by
priority (one), paths (one), pit (three), profile optimizer (one), semantic
racing line (one), and track profile (one). All T0/T1 trackgen tests and both
real-scale integration tests passed inside that run. Because the command is a
fail-fast chain, invariants, profile validation, parity, browser smoke, and
fast statistics were not reached there; those stages are being exercised
independently rather than changing unrelated timeout budgets.

The final stream-end `bun run verify` invocation passed typecheck, both
bundles, and boundaries (71 TypeScript files), then stopped in raw units after
168.18 s with 121 passing tests and seven failures. Five were core timing
failures: profile optimization (27,554.33 ms / 15,000 ms), three semantic or
explicit-line tests (10,123.55, 6,061.57, and 5,295.46 ms / 5,000 ms), and
TrackProfile round-trip (8,590.94 ms / 5,000 ms). Two short-budget optimizer
CLI tests received subprocess exit code 1 instead of 0 while the concurrent
trajectory L3 changes were landing. All session priority/path/pit tests, all
trackgen tests, and both legacy/generated track integration tests passed. The
fail-fast tail (invariants, profiles, parity, full browser/production checks,
and normal statistics) was not reached in that invocation.

An independently run tail on the preceding stable snapshot supplied the
remaining diagnostics without changing fixtures: invariants were 77/77 green;
Cerro profile provenance remained two ticks adrift; browser/headless execution
agreed but the external trajectory pivot fixture had 74 expected L2-era
differences; fast statistics stopped on a racecraft priority-path crossing.
The later focused browser smoke was fully green after restoring the legacy pit
shape and hashes. These external racecraft findings were not tuned in the
track-builder stream.

After the final full invocation produced fresh bundles, the parallel L3 stream
changed `src/core/corner-lines.ts` and `src/game/tracks.ts`. One explicitly
no-rebuild browser recheck therefore stopped at the stale-artifact guard before
parity or Studio cases; it was not retried. The last track-builder browser
snapshot immediately before those external edits was fully green, and `dist/`
is intentionally generated rather than committed.

No fixture was wholesale re-recorded by this stream. During final browser
verification, two new enumerable `PitGeometry` fields were found to alter all
six legacy pit hashes despite unchanged positions. The fields were removed,
and only the six pit hashes in the concurrently created runtime pivot were
restored to the immutable historical-manifest values. Every other trajectory
fixture field was preserved. No profile fixture, statistical policy, or
browser snapshot was changed. `dist/` remains generated and ignored. No
showcase track is committed while T4 is gated, so there is no committed
generated track lacking its required artifact. The temporary T2 probe
definition, artifact, optimizer report, and benchmark diagnostics were kept
outside the repository under `/tmp/goldenlap-trackgen-t2/`.

## Plan deviations and conflict resolution

1. **Studio latency:** the original 150 ms p90 target is retained as a miss;
   the user's explicit 30 s instruction supersedes it as the completion
   ceiling. Nothing is described as meeting 150 ms.
2. **T2 benchmark:** the benchmark is red because the trajectory revamp that
   owns full-track maneuver materialization is incomplete. The physically
   honest choice is to expose the finding and stop at the sequencing gate,
   not weaken safety, alter racecraft, or special-case generated tracks.
3. **T4 deliverables versus sequencing:** the request lists signatures and
   showcases but also says to leave T4/T5 pending when the revamp is not
   implemented. The explicit sequencing gate wins; those files are not
   created early.
4. **Invariant audit timing:** Tier-0 acceptance throughput and strict
   all-acceptance rechecks are reported separately. Combining them would
   incorrectly compare a redundant proof sweep with the milliseconds-tier
   generator budget.
5. **Fixture discipline:** Cerro's two-tick profile drift and the pre-existing
   trajectory changes were not normalized by re-recording fixtures. The only
   fixture edit restores six runtime-pivot pit hashes to the immutable legacy
   values after an accidental structural change was removed.

## Topology-first revision — R0 through R3

R0 characterized 60 seeds per archetype and all six authored definitions
before replacing the first realizer. The old balanced generator produced 53
coordinate fingerprints, yet every route still had exactly eight
curvature-sign runs and six secondary-axis reversals. That is the frozen
counterexample showing why coordinate jitter was not topology diversity.
Power/balanced/technical produced 31/53/48 structural fingerprints out of 60;
the generated convex-hull-fill ranges were 0.861–0.898, 0.853–0.900, and
0.903–0.935 respectively. The characterization command completed in 8.172 s.

R1 added the version-2 group/motif contract, native presets, deterministic v1
migration, and the shared three-way group scrambler. Every standard corner
has at least entry/apex/exit knots; compound S, chicane, double-apex, and
sweeper-chain groups retain independent signed lobes even when their net turn
cancels. Focused motif, migration, scramble, and determinism tests were green.
The phase-end `verify:fast` passed typecheck, both bundles, boundaries, and
159 unit tests; its only failure was an unrelated tucked-follow test taking
5.50 s against a 5 s host-sensitive timeout.

R2 replaced the stadium/wave path with bounded curvature interpolation and
exact piecewise-constant-curvature pose integration at an authored 12 m
control density. The route now advances from its current heading after every
group. Each lobe is normalized independently to its requested signed turn.
Closure is a damped least-squares solve over declared length, lobe-angle, and
shallow-bend variables followed by a two-length position refinement; it
reports every delta and re-integrates the route. The cyclic endpoint is
removed from control points only after solving—it is never copied to the
origin or moved after integration. Known-good closure, canceling-lobe
integration, and no-authority rejection tests are green.

Ordering was treated as topology rather than visual noise. Exhaustive
fixed-slot searches covered all 40,320 power orders and all 362,880 balanced
and technical orders over 20 calibration seeds. The selected power and
technical orders were crossing-free at full 12 m resolution for 20/20 seeds;
the selected balanced order was also 20/20. The search deliberately did not
claim clearance: pre-flex minimum spacing remained below the independent
four-road-width gate, so final production-spline clearance still rejects
unsafe candidates.

R3 moved all Tier-0 measurements to the active v2 production-sampled route.
The metric set now includes finite/duplicate checks, actual closure status,
group/lobe fidelity, shallow-straight coverage, closest separation groups,
PCA reversals, convex-hull fill, curvature-sign runs, return sections,
compactness, and a structural fingerprint. New `trackgen.*` catalog entries
remain observe-only. Generation artifacts are schema v2 and contain the
signature fingerprint, resolved plan, realized group spans/knots, complete
closure report, topology metrics, and final gate results. At the current
calibration snapshot, 20 sequential seeds yielded Tier-0 acceptance of 4/20
power, 11/20 balanced, and 2/20 technical candidates; all accepted candidates
had zero closure, curvature-rate, crossing, and clearance gate failures.
Accepted-track generation and Tier-1 draft analysis remain bounded to 50
deterministic attempts and the user-approved 30 s ceiling.
