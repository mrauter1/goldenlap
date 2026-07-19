# Track Builder Plan — Topology-First Procedural Circuits

Active plan for the *track content* stream. The repository already contains a
deterministic generator, quality loop, real-scale track support, CLI, and
Track Studio. Those foundations remain useful, but the first geometric
realizer is structurally insufficient: it places curvature-shaped waves on a
fixed stadium scaffold, so changing a signature cannot produce a genuinely
different route topology.

This revision replaces that realizer with a closed chain of compound shape
groups. Each group expands into multiple curvature knots, updates the moving
track pose, and joins its neighbours with continuous tangent and curvature.
Corners may have any required number of knots; nominal straights are usually
subtly bent rather than perfectly collinear. The result must support concave,
folded, multi-apex, increasing-radius, decreasing-radius, and flowing layouts
without special-casing any one example such as a hairpin.

The historical T0–T3 implementation evidence remains in
`track_builder_implementation_report.md`. The R phases below supersede only
generated-track geometry and the parts of the grammar, gates, search, and
Studio that describe it. Existing authored tracks and racing behaviour are
outside this revision.

## Implementation status — 2026-07-16

| Phase | Status | Exit condition |
|---|---|---|
| Baseline T0–T3 | Implemented, geometric acceptance superseded | Keep deterministic core, Tier-1 integration, real-scale support, CLI, and Studio; do not treat the wave/stadium realizer as complete |
| R0 — Contract and characterization | Complete | 60 seeds/archetype and all six authored tracks characterized; balanced generated routes retain exactly eight curvature-sign runs and six secondary-axis reversals despite 53 coordinate fingerprints |
| R1 — Shape grammar and motif library | Complete | Versioned compound groups resolve deterministically into valid multi-knot curvature programs |
| R2 — Pose integration and closure | Complete | Groups create genuine heading-changing geometry; bounded flex solving closes sampled position and heading without endpoint snapping |
| R3 — Gates, search, and artifacts | Complete | Hard invariants, token fidelity, topology metrics, low-angle-straight policy, and bounded acceptance are enforced on production-sampled geometry |
| R4 — CLI and Track Studio migration | Complete | Each runtime is seed-repeatable; CLI/browser share schema, provenance inputs, and scramble semantics without requiring bit-identical floating-point geometry |
| R5 — Hardening and verification | Active | 10,000-seed and 1,000-per-archetype audits are running; legacy parity is unchanged and phase verification has trackgen green with attributed concurrent racecraft failures |
| T4 — Signatures and showcase | Pending — two gates | Requires R5 and the racecraft trajectory revamp to be complete before headless showcase acceptance is tuned |
| T5 — Calendar integration | Pending | Requires accepted T4 showcases and deliberate observe-only policy promotion |

Order: R0 → R1 → R2 → R3 → R4 → R5 → T4 → T5. R4 may begin after the
R1 schema is stable, but it cannot complete before R3. T4 remains behind the
existing racecraft sequencing gate: geometry may be developed and validated
now, but showcase racing probes must measure final racing behaviour.

## 0. Problem statement and completion definition

The current `generateControlPoints` implementation always constructs:

1. a bottom straight;
2. a fixed semicircular end cap;
3. one upper branch whose primary coordinate moves monotonically while token
   waves alter the other coordinate;
4. a second fixed end cap; and
5. a return to the origin.

Corner angle and class currently change wave amplitude and placement, not the
integrated route heading. Complex tokens are also reduced to wave shapes.
Consequently all seeds share one macro topology, two hairpin-like end caps are
present regardless of the signature, and parameter or ordering scrambles can
only rearrange oscillations.

The revision is complete only when all of the following are true:

- every resolved group changes or preserves the moving pose according to its
  own signed curvature program;
- a corner is a span of three or more knots, not a single point, radius, or
  Gaussian displacement;
- compound shapes may contain multiple apexes and curvature sign changes;
- nominal straights normally contain deliberate, full-throttle low-angle
  curvature, with locally near-collinear geometry reserved only where grid,
  pit, or a signature explicitly requires it;
- signatures can generate concave and folded routes with nearby return
  sections while preserving clearance and avoiding intersections;
- closure is measured from realized geometry and solved through bounded flex
  degrees of freedom, never declared or achieved by snapping the endpoint;
- the same signature, seed, generator version, and options repeat exactly
  within Bun and exactly within the browser; the two runtimes share schema,
  provenance inputs, and scramble semantics but need not produce
  bit-identical floating-point geometry;
- all accepted candidates satisfy the final production spline, not merely an
  intermediate control polygon;
- the six existing authored tracks rebuild bit-identically and no racing,
  profile, physics, or calibration behaviour changes in this stream.

## 1. Locked decisions

### 1.1 Geometry and authoring

- **Topology first.** The route is formed by integrating a cyclic sequence of
  shape groups. There is no global oval, polar-angle sort, monotone-axis
  branch, baseline-plus-wave scaffold, or post-hoc lateral displacement of a
  predetermined loop.
- **Groups, not atomic corners.** A rhythm element owns a complete local
  shape. Standard corner motifs contain at least entry, one or more interior
  shape knots, and exit. Complexes contain as many knots and curvature lobes
  as their geometry requires.
- **No shape-specific special case is the architecture.** A large heading
  reversal, multi-apex turn, sweeper, chicane, or shallow bend is produced by
  the same knot and integration machinery. Named motifs are authoring
  templates, not alternate realizers.
- **Ellipse-like, circular, and asymmetric curves are outcomes.** The core
  primitive is a smooth signed-curvature profile. It is not constrained to a
  literal circle or ellipse, because arbitrary conic fragments do not by
  themselves guarantee tangent or curvature continuity at joins.
- **Straights are a driving classification.** A nominal straight means the
  car can remain at full throttle for the intended duration. It need not be a
  mathematically straight line. Eligible straight groups normally receive a
  shallow bend or bow whose curvature stays below the full-throttle limit.
- **Grid and pit honesty.** One reserved group provides the locally stable
  interval required by the pit lane and 20-car grid. Curvature may ease in
  outside that interval; the reserved interval itself may be near-collinear
  when the real geometry requires it.
- **2D remains 2D.** No elevation, banking, image tracing, or CV pipeline is
  introduced.

### 1.2 Product and runtime

- Tracks remain **offline-generated, validated, and committed**. There is no
  in-game or per-career generation.
- Generated tracks remain 3–8 km, variable-width, and compatible with the
  existing `TrackDefinition` and `buildTrack` pipeline.
- The generator core remains UI-free under `src/game/trackgen/`, importable by
  `tools/generate-track.ts` and the Studio composition root.
- All random choices use `shared/rng`; `Math.random` is forbidden.
- This stream consumes `previewIdealLine`, semantic corners, pass scores,
  profiles, and audit metrics. It does not change racing behaviour or tune
  racecraft calibration.
- Existing tracks with scalar width and no pit hint retain exactly their
  current geometry, pit constants, random-consumption surface, profiles, and
  parity identity.

## 2. Geometry vocabulary and data contract

The authoring schema distinguishes four levels so semantic corners are not
confused with implementation points.

### 2.1 Signature group

A `RhythmGroupSpec` is one draggable, reorderable authoring unit:

- `nominal-straight` — a long full-throttle connector, normally with a subtle
  bend profile;
- `corner` — one signed-turn motif such as single-apex, double-apex,
  increasing-radius, decreasing-radius, or long sweeper;
- `complex` — a linked sequence such as S, chicane, sweeper-chain, or a
  custom compound motif;
- `transition` — an explicit connector used where adjacent groups should
  flow without first returning to zero curvature.

Every group declares bounded length and shape parameters, whether it may
participate in closure solving, and whether it owns the grid/pit reservation.
Only one group may own that reservation.

### 2.2 Motif

A motif is a reusable template that expands a group into ordered shape knots.
The initial library must contain:

- shallow bow and shallow S for nominal straights;
- single-apex symmetric;
- early-apex and late-apex asymmetric;
- increasing-radius and decreasing-radius;
- double-apex;
- long sweeper and sweeper-chain;
- S and chicane; and
- a declarative custom compound motif.

The library does not encode a special hairpin path. A tight or large-angle
turn is the same single- or multi-apex motif resolved with different length,
turn, and curvature parameters.

### 2.3 Shape knot

A resolved `ShapeKnot` is ordered by distance within its group and carries at
least:

```ts
interface ShapeKnot {
  s: number;       // metres from group entry, strictly increasing
  kappa: number;   // signed target curvature, 1/m
}
```

A group also records one or more ordered `TurnLobe`s. Each lobe identifies a
knot span and its target signed heading change. A single-apex corner normally
has one lobe; an S, chicane, or other compound shape has several. This avoids
trying to characterize a compound whose positive and negative turns cancel
with one near-zero net angle.

Implementations may cache tangent or curvature-derivative data, but those are
derived values rather than additional authoring authorities. Standard corner
groups resolve to at least three knots. A compound group may use any bounded
count necessary to represent its curvature lobes.

Knots describe curvature, not independent positions. A deterministic smooth
interpolant produces `κ(s)` between them. This prevents control-point
overshoot from silently changing the intended turn and makes the physical
meaning explicit:

```text
heading change = integral of κ(s) ds
x change       = integral of cos(heading(s)) ds
y change       = integral of sin(heading(s)) ds
```

### 2.4 Realized group and route

A `ResolvedShapeGroup` records sampled length, ordered turn-lobe targets,
knots, entry/exit curvature, flex bounds, and provenance back to the signature
group. A `RealizedRoute` records the ordered groups, integrated control
points, actual entry/exit poses, closure solve report, width profile, and
per-group sample spans.

Semantic corners remain outputs of `detectSemanticCorners`. A motif may
produce one or several semantic corners, and adjoining motifs may be detected
as one linked complex. Tier-0 fidelity compares the realized curvature lobes
and heading changes with the plan; it does not require a fragile one-token to
one-semantic-corner identity.

## 3. Versioned signature schema

`RhythmSignature.schemaVersion` advances to 2. Version 2 stores ordered
groups and motif parameters rather than the current wave tokens. Standard
motifs expose designer-facing quantities—length, ordered signed-turn lobes,
knot spacing, curvature balance, and entry/exit flow—while the resolver
produces the low-level curvature knots.

Normative shared fields are:

```ts
interface ShapeKnotSpec {
  at: NumericRange;                // normalized group distance, [0, 1]
  curvatureWeight: NumericRange;   // signed, dimensionless motif shape
}

interface TurnLobeSpec {
  firstKnot: number;
  lastKnot: number;
  angleDegrees: NumericRange;      // signed; one range cannot cross zero
}

interface ClosureLobeFlexSpec {
  lobe: number;
  angleDeltaDegrees: NumericRange;
}

interface ClosureFlexSpec {
  lengthDeltaMetres?: NumericRange;
  lobes?: readonly ClosureLobeFlexSpec[];
  shallowBendBiasDelta?: NumericRange;
}

interface RhythmGroupSpec {
  id: string;
  kind: 'nominal-straight' | 'corner' | 'complex' | 'transition';
  motif: string;                   // validated motif-library identifier
  lengthMetres: NumericRange;
  knots?: readonly ShapeKnotSpec[]; // required for custom compounds
  lobes: readonly TurnLobeSpec[];
  radiusClass?: TrackCornerClass;
  movable: boolean;
  role?: 'grid-pit' | 'landmark';
  flex?: ClosureFlexSpec;
}

interface RhythmSignatureV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  archetype: TrackArchetype;
  winding: 'clockwise' | 'counter-clockwise';
  groups: readonly RhythmGroupSpec[];
}
```

`NumericRange` retains its existing `[minimum, maximum]` contract. Standard
motifs supply their knot specifications from the versioned library; a custom
compound stores them explicitly. Motif-specific convenience fields, if any,
are discriminated unions in `types.ts` and compile into these shared fields;
they may not create a second geometry authority.

Rules:

- parameter ranges are finite, ordered, unit-labelled in code, and validated
  before RNG is consumed;
- the first/last knot positions are exactly 0/1; interior position ranges are
  non-overlapping so every resolved order is strictly increasing;
- a corner motif has at least three resolved knots;
- every lobe references a valid contiguous knot span, lobe order is stable,
  and a signed lobe-angle range does not cross zero;
- adjacent groups agree on boundary curvature, or an explicit transition
  group is inserted by the deterministic resolver;
- signatures provide at least two flex groups and at least three independent
  closure variables across connector length, shallow-bend bias, or an
  explicitly flexible transition;
- the grid/pit group is never used to absorb large closure corrections;
- the signature's expected winding, curvature-lobe sequence, and broad
  radius-class coverage are validated before realization.

A deterministic v1 adapter exists only for loading old Studio/CLI signature
JSON during migration. It maps each old token to a documented v2 default
motif and emits an explicit migration warning. Presets become native v2
before R4 completes. New artifacts never claim v1 and v2 outputs are
equivalent.

## 4. Deterministic realization pipeline

### 4.1 Resolve groups

Starting from the signature seed, resolve every parameter range in stable
group and knot order. Record the resolved values in the candidate artifact.
No later stage draws randomness implicitly; retries derive their attempt seed
through the existing deterministic attempt sequence.

Nominal-straight resolution follows these rules:

- eligible groups select a shallow bow, shallow S, or explicitly true
  straight according to named archetype policy;
- more than half of eligible non-pit straight groups in an accepted route
  must have measurable non-zero curvature;
- shallow bends stay inside the physical full-throttle curvature envelope
  and use small heading deflections; the exact policy ranges are named in the
  preset and calibrated against existing real-scale definitions;
- the grid/pit group reserves the required low-curvature distance before any
  bend is added outside it; and
- a signature may deliberately request a completely straight landmark
  section, but this is not the default for every connector.

### 4.2 Expand motifs

Expand each group into three or more knots where required. Interpolate signed
curvature with a bounded monotone cubic or equivalent smootherstep-based
scheme that does not overshoot the adjacent knot values. Normalize each
ordered turn lobe so its integral matches that lobe's resolved signed heading
change while preserving the motif's relative curvature shape. The group's
net turn is the sum of its lobes; a near-zero-net S therefore remains
well-conditioned rather than dividing by a cancelled integral.

Boundary behaviour is explicit:

- straight-to-corner normally transitions `0 → signed κ → 0`;
- flowing same-direction groups may share non-zero boundary curvature;
- an S or chicane crosses smoothly through zero curvature;
- curvature and its finite rate remain bounded at every join; and
- post-generation coordinate smoothing is forbidden if it changes motif
  angle, lobe order, or radius class. Smoothness is created in curvature
  space before pose integration.

### 4.3 Integrate the moving pose

Begin from the canonical start pose `(0, 0, 0)`. Integrate each group's
curvature over arc length with a fixed deterministic step and midpoint (or a
documented numerically equivalent) update. Every sample advances position
along the current heading; every non-zero curvature sample updates heading.

This is the operation missing from the first implementation. A large turn,
for example, naturally makes the following group travel back toward an
earlier part of the route. Alternating signed groups create infield and
folded sections without a separate topology trick.

Intermediate calculations remain full precision. Resolved scalars and final
portable control points are canonicalized once at the generator boundary to
the precision required for exact Bun/browser JSON parity, well below all
geometry gate resolutions.

The integrated `(x, y, heading)` at every shape-knot boundary is retained in
the debug/provenance route. Those spatial knot points, plus only the
intermediate samples required to preserve curvature, form the cyclic control
chain passed onward. Thus a three-knot corner visibly has entry, interior
shape, and exit points even though curvature—not independently draggable
coordinates—is the single geometric authority.

### 4.4 Solve closure

Compute the actual residual from the integrated final pose:

```text
r = [end.x - start.x, end.y - start.y,
     normalized(end.heading - start.heading)]
```

Use a deterministic, bounded damped least-squares solve over only declared
flex variables. Candidate variables are connector lengths, shallow-bend
biases, and explicitly flexible transition angles. Core motif knots, corner
order, radius identity, the pit/grid reservation, and authored landmark
groups are not closure variables.

Solver contract:

- stable variable order and fixed iteration cap;
- deterministic finite-difference or analytic Jacobian;
- bounds applied on every proposed update;
- accept only monotonically improving residual steps under the documented
  damping rule;
- reject singular, non-finite, out-of-bounds, or non-convergent candidates;
- report residual before and after, iterations, variable deltas, and the
  largest relative group distortion; and
- never set `endPose = startPose`, overwrite the final point, rotate one
  branch, or distribute an unreported correction after the solve.

At least one final re-integration is performed from the solved parameters.
Closure gates inspect that result and then inspect the production-sampled
closed spline independently.

### 4.5 Produce final geometry

Convert the integrated route to cyclic `TrackDefinition.pts` at a density
that preserves the knot program through `sampleTrackCenterline`. Resampling
may remove redundant collinear samples but may not reshape the route. Apply
the existing variable-width and pit policies by group span, then run all
Tier-0 measurements on the exact production sampler used by `buildTrack`.

### 4.6 Failure and retry semantics

- Invalid schema, unordered knot ranges, unknown motifs, impossible lobe
  references, or insufficient closure authority fail before consuming RNG.
- A valid but unsolved or gate-failing candidate returns structured rejection
  diagnostics and advances to the next deterministic attempt; it does not
  throw away provenance or silently fall back to v1.
- Exhausting the configured attempt bound is a normal search failure. The CLI
  preserves `0 = accepted`, `1 = valid input but rejected/exhausted`, and
  `2 = malformed input or configuration`; failures include the best rejection
  summary. No partial `TrackDefinition` is presented as accepted.
- The Studio bounds the same attempt count, displays the current rejection and
  closure report, and retains the last valid rendered candidate instead of
  clearing it or entering an unbounded retry loop.
- Only accepted candidates produce commit-eligible definition/artifact pairs.
  Rejected debug artifacts may be exported for diagnosis but carry an
  explicit rejected status.

## 5. Gates and policy metrics

### 5.1 Zero-tolerance invariants

Every accepted candidate must have:

- finite points, segment lengths, headings, and curvature;
- no duplicate/zero-length segment;
- realized position closure and heading closure within the existing hard
  numerical tolerances;
- continuous tangent with no unmodelled heading step at a group boundary;
- maximum curvature rate within `TRACKGEN_MAX_CURVATURE_RATE` after
  production sampling;
- zero centreline self-intersections;
- minimum non-adjacent-section clearance of at least four local road widths;
- no spline-introduced crossing or clearance escape; and
- a valid pit/grid reservation on the realized route.

These invariants remain zero tolerance: zero escapes across the 10,000-seed
R5 sweep. Failed candidates are rejected; no repair step may hide a failure.

### 5.2 Plan-faithfulness gates

For every group, record and gate:

- realized length versus resolved length;
- integrated signed heading change versus target;
- ordered curvature-lobe signs and apex count versus motif;
- entry/exit curvature continuity;
- realized minimum/characteristic radius versus intended class;
- flex distortion versus its declared bounds; and
- semantic-corner coverage at route level without requiring one-to-one token
  identity.

The fixed two-hairpin allowance in the first implementation is removed.
Corner counts and classes come only from realized geometry.

### 5.3 Topology and diversity metrics

Add observe-only `trackgen.topology.*` metrics before promoting any band:

- convex-hull fill / concavity;
- principal-axis direction-reversal counts;
- heading-distribution coverage;
- signed-curvature run and lobe entropy;
- count and length of safely separated parallel or returning sections;
- route compactness and aspect ratio;
- eligible-straight micro-bend share;
- normalized structural route fingerprint and duplicate rate across a seed
  population—the fingerprint omits local knot jitter and encodes global turn
  runs, concavity, direction reversals, and return-section relationships; and
- pairwise route distance after translation, rotation, reflection policy,
  and scale normalization.

No single aesthetic scalar becomes a universal hard gate. R0 measures these
metrics on the six authored tracks and known circuit-like synthetic fixtures;
R3 sets archetype-specific normal and acceptable bands using calibration
seeds, then freezes choices before validation seeds. Release seeds are not
used for tuning.

Population acceptance must demonstrate that outputs are not transformed
copies of one scaffold. R0 freezes maximum structural-fingerprint duplicate
rate, maximum single-bucket concentration, and minimum occupied-bucket counts
before the new realizer is tuned. The 1,000-seed per-archetype R5 probe must
pass those frozen bands for concavity, reversal, return-section, and
curvature-lobe structure. Values are derived from authored/synthetic
references rather than invented as aesthetic magic constants or selected
after viewing validation outcomes.

### 5.4 Existing physical and racing-quality gates

Retain:

- 3–8 km archetype length and average-speed envelopes;
- 55–150 s reference lap envelope;
- longest **full-throttle** section ≥8 s acceptable and ≥10 s normal;
- five broad radius classes represented without one class dominating;
- both turn directions and at least one linked complex;
- pit-loss fraction, grid fit, and variable-width constraints;
- Tier-1 `buildTrack`, semantic-corner, `previewIdealLine`, pass-score,
  rhythm-variance, and width-utilization checks; and
- finalist-only headless and profile workflows after the racecraft sequencing
  gate opens.

Low-angle bends are judged by the closed-form speed envelope rather than by
requiring `κ = 0`. A shallow curve that remains at `PHYS.vTop` is part of a
full-throttle section.

All new policy catalog entries begin observe-only. Closure, curvature-rate,
intersection, and clearance remain invariants rather than population policy.

## 6. Search, mutation, and scrambling

The bounded search continues to derive candidate attempt seeds
deterministically. Mutation operates on the resolved plan, never by applying
coordinate noise to final points.

Allowed mutations include:

- group length within its declared range;
- total signed turn and curvature scale within motif bounds;
- interior knot spacing and relative apex weight;
- entry/exit flow and transition length;
- shallow-bend amplitude and sign for eligible straight groups;
- whole-group ordering in declared movable slots; and
- archetype-approved width/pit parameters.

Disallowed mutations include endpoint snapping, arbitrary point jitter,
post-spline deformation, undeclared closure corrections, and changes to
racing calibration.

Studio button semantics after migration:

- **Scramble Parameters** changes group parameters and interior knot values,
  preserving group identity, ordering, straight slots, and the grid/pit role;
- **Scramble Corner Ordering** moves complete corner/complex groups among
  movable non-straight slots, preserving every moved group's internal knots
  and keeping reserved straight groups fixed; and
- **Scramble** performs both operations from one deterministic RNG stream and
  runs generation once.

The same starting signature, visible seed, scramble revision, and operation
must produce the same resulting signature. A changed signature receives a
new provenance identity.

## 7. CLI, artifacts, and Track Studio

### 7.1 CLI and artifacts

`tools/generate-track.ts` continues to consume the shared UI-free generator.
The v2 artifact records:

- generator and signature schema versions;
- source seed, attempt seed, and signature fingerprint;
- resolved groups and shape knots;
- per-group target and realized length/turn/radius/lobe summary;
- closure residuals, iteration count, and flex deltas;
- topology and diversity metrics;
- final Tier-0 and Tier-1 gates;
- definition and provenance fingerprints; and
- display-only status for headless and profile workflows.

Add a debug JSON mode for integrated poses, group spans, knots, and closure
iterations. It is a tool artifact, not part of `TrackDefinition` and not
loaded by the game.

Artifacts are versioned rather than silently re-recorded. The v1 generator
may exist behind a tool-only migration switch during R1–R4, but it is removed
from the active path before R5. Rollback is source-control rollback, not a
permanent dual generator.

### 7.2 Track Studio

Keep the existing independent `file://`-safe bundle and render pipeline. The
Generate panel becomes group-oriented:

- drag complete rhythm groups;
- expand a group to edit length, target turn, knot spacing, curvature/apex
  balance, entry/exit flow, flex bounds, and shallow-bend parameters;
- visualize interior knots without exposing them as unrelated draggable
  global points;
- mark fixed, movable, flex, and grid/pit groups distinctly;
- show target versus realized turn/radius and closure distortion per group;
- overlay control points, tangents, curvature knots, group boundaries,
  safely separated return sections, and the existing racing analysis; and
- retain JSON import/export and all-six existing-track import.

The Studio runs only generation, Tier 0, and the fast draft analysis. It
displays CLI artifacts for deeper workflows and never launches multi-minute
validation in-browser. The user-approved interaction ceiling is 30 s per
accepted candidate; milliseconds-tier generation remains the engineering
target and all timings are reported honestly.

## 8. Compatibility and fixture policy

- The six authored `TrackDefinition`s do not pass through trackgen and must
  retain their existing geometry, scalar-width behaviour, pit constants,
  profile fingerprints, and parity hashes exactly.
- `TrackDefinition` runtime shape does not change for the revamp; only the
  offline points produced for a new generated definition change.
- Existing v1 generated candidates are not calendar content and receive no
  false bit-parity promise. Any v1 trackgen snapshot replacement is a
  deliberate generator-version change recorded in the implementation report.
- No headless/runtime parity fixture is re-recorded unless a generated track
  is deliberately committed after T4. Unrelated concurrent racecraft drift is
  never normalized by this stream.
- CLI and browser each gain direct repeatability fixtures covering all three
  archetypes, compound motifs, shallow straights, scrambles, and at least one
  closure retry. At the user's explicit direction on 2026-07-17, cross-runtime
  floating-point geometry is not required to be bit-identical: the runtimes
  must agree on schema, seed, signature identity, provenance inputs, and
  scramble semantics.
- Generation artifacts for committed tracks are mandatory and immutable
  provenance inputs.

## 9. Expected code ownership

The revamp stays inside the existing layering contract:

- `src/game/trackgen/types.ts` — v2 signature, group, knot, lobe, realized
  route, closure report, and topology metric types;
- `src/game/trackgen/motifs.ts` — declarative motif library and deterministic
  motif expansion;
- `src/game/trackgen/curvature.ts` — bounded curvature interpolation, lobe
  normalization, and pose integration;
- `src/game/trackgen/closure.ts` — bounded deterministic flex solve with no
  knowledge of UI or racing behaviour;
- `src/game/trackgen/topology.ts` — rotation/translation/scale-normalized
  structural measurements and fingerprints;
- `src/game/trackgen/grammar.ts` and `presets.ts` — schema validation,
  resolution, v1 migration, and native v2 archetype presets;
- `src/game/trackgen/geometry.ts` — orchestration from resolved groups to
  final cyclic control points; the baseline/wave scaffold is removed;
- `src/game/trackgen/gates.ts`, `candidate.ts`, and `quality.ts` — final-spline
  invariants, fidelity/topology gates, bounded search integration, and
  unchanged consumption of racing-quality APIs;
- `src/game/trackgen/scramble.ts` — deterministic whole-group parameter and
  ordering operations;
- `tools/generate-track.ts` and `tools/audit-trackgen.ts` — versioned CLI,
  debug artifacts, invariant sweep, and diversity reporting;
- a focused characterization tool under `tools/` for R0 reference evidence;
- `src/ui/track-studio.ts` and `track-studio.html` — group editor and
  diagnostic overlays only; and
- focused `tests/unit/game/` and `tests/unit/tools/` fixtures for motifs,
  integration, closure, gates, determinism, artifacts, and Studio-facing
  pure operations.

No session or racecraft module is an implementation target. Core sampling and
racing-line modules are read-only consumers unless a genuine, separately
approved generic bug is discovered; this plan grants no authority to change
their behaviour.

Generator constants follow the repository constants policy. Physical speed
and grip decisions reuse `PHYS` and the surface model. Geometry policies such
as motif bounds, flex distortion, shallow-bend eligibility, and topology
bands have one named typed definition with unit, rationale, and phase owner;
they are not duplicated as literals across the realizer, gates, Studio, and
tests.

## 10. Phased implementation and verification

### R0 — Contract and characterization

Work:

- add a source-level and geometric characterization of the fixed stadium
  scaffold, including its monotone branch and baked-in end caps;
- capture representative seeds for each archetype and measure normalized
  topology similarity, concavity, reversals, curvature lobes, and straight
  collinearity;
- measure the same topology metrics on the six authored tracks and synthetic
  single-, multi-apex, folded, and shallow-straight fixtures;
- freeze legacy geometry/pit/profile hashes and the current public CLI,
  artifact, and Studio import surfaces; and
- specify executable counterexamples for heading-changing groups, a 3+ knot
  compound corner, low-angle nominal straights, genuine closure residual
  measurement, and ordering-sensitive topology. Record their expected
  failure against the old realizer in the characterization output; do not
  leave the checked-in unit suite red between phases.

Exit evidence: a checked-in characterization fixture/report section, named
metric definitions, captured old-realizer counterexamples, and a green
existing verification ladder. Each counterexample becomes a normal unit test
in the same R1/R2 edit that implements its new surface.

### R1 — Shape grammar and motif library

Work:

- implement schema v2 group/knot types and validation;
- implement deterministic v1-to-v2 loading adapter;
- implement motif expansion and native v2 archetype presets;
- update parameter and ordering scramblers to operate on whole groups; and
- unit-test every motif's knot count, lobe signs, boundary curvature,
  parameter bounds, and deterministic resolution.

Exit evidence: all motif and schema tests green; no UI or production geometry
switch required yet; typecheck and boundaries green; `verify:fast` once at
phase end.

### R2 — Pose integration and closure

Work:

- replace baseline/wave control-point generation with curvature interpolation
  and moving-pose integration;
- implement bounded flex closure with diagnostic reports;
- generate shallow-bend nominal straights and preserve the grid/pit interval;
- remove baked-in corner counts and hard-coded end caps;
- sample through the production spline before accepting closure or curvature;
  and
- add known-good and known-bad synthetic geometry fixtures.

Exit evidence: exact closure for all known-good fixtures, honest rejection of
unsolvable fixtures, correct cumulative heading for multi-knot groups, no
post-solve endpoint snap, and unchanged legacy reconstruction. Run targeted
closure/curvature audits in a background worker while R3 begins.

### R3 — Gates, search, and artifacts

Work:

- add plan-faithfulness and topology metrics;
- update intersection/clearance checks to report group spans;
- update bounded mutation/search for v2 groups;
- version generation artifacts and debug output;
- add observe-only metric-policy catalog entries; and
- establish calibration-seed archetype bands without viewing release seeds.

Exit evidence: every archetype finds an accepted candidate in at most 50
attempts; end-to-end accepted-candidate time is ≤30 s; Tier-0 throughput is
reported separately in candidates/s; all invariant and artifact tests green;
`verify:fast` at phase end.

The former 100-candidates/s goal remains a reported optimization target, not
a completion blocker, following the user's explicit instruction that
generation below 30 s is acceptable. No quadratic search is accepted merely
because the ceiling is generous.

### R4 — CLI and Track Studio migration

Work:

- switch CLI and Studio to native v2 presets;
- add group/knot controls and overlays;
- wire the three scramble operations to the shared group scrambler;
- retain legacy definition import and display-only deep artifacts;
- extend browser smoke with within-runtime repeatability, CLI/browser v2
  schema/provenance compatibility, and exact shared scramble semantics; and
- remove or clearly reject stale v1 artifact editing.

Exit evidence: all three archetypes and all six existing tracks render and
validate in Studio; button semantics are asserted; each runtime repeats
exactly and both expose compatible schema/provenance inputs; interaction stays
below 30 s; boundaries and both builds green; browser smoke and `verify:fast`
at phase end.

### R5 — Hardening and stream gate

Work:

- run 10,000 seeds with full-stride invariant rechecks in a background
  process;
- run the frozen 1,000-seed-per-archetype diversity probe;
- verify bounded acceptance on calibration and then validation seeds;
- verify existing-track bit parity and profile provenance;
- verify 7 km optimizer and runtime surfaces once without changing racecraft;
- run the full AGENTS.md verification ladder; and
- update `track_builder_implementation_report.md` with all numbers, fixture
  changes, and deviations.

Exit evidence:

- zero closure, heading, non-finite, curvature-rate, intersection, or
  clearance escapes across 10,000 seeds;
- structural duplicate rate, bucket concentration, and occupied-bucket counts
  pass the bands frozen during R0 for every archetype;
- every accepted candidate satisfies motif and shallow-straight fidelity;
- exact deterministic repeatability within CLI and within browser fixtures,
  plus compatible cross-runtime schema/provenance and scramble semantics;
- six existing tracks bit-identical with no deliberate parity/profile
  re-record;
- accepted generation ≤30 s per track; and
- full verification result recorded, with unrelated failures attributed but
  never hidden.

### T4 — Signatures and showcase

Only after R5 and the racecraft trajectory revamp are complete:

- author native v2 `signatures/spa.json` and
  `signatures/interlagos.json` as rhythm references, not coordinate traces;
- generate one power showcase near 7 km and one balanced showcase near
  4.5 km;
- run every Tier-0/Tier-1 gate, finalist headless probes, full profile
  workflow, camera/minimap review, and audit-effects vocabulary scenarios;
  and
- commit each definition with its complete generation artifact.

The signatures may guide topology and rhythm, but acceptance is not tuned to
copy their map silhouette.

### T5 — Calendar integration

- add the two accepted tracks to the season calendar;
- promote only evidenced `trackgen.*` policy bands from observe-only;
- run parity, season, browser, production, normal statistics, and release
  evidence as required; and
- document which semantic corners host the audited racing scenarios.

## 11. Verification ladder and audit orchestration

Per AGENTS.md:

- every code edit: `bun run typecheck`, `bun run check:boundaries`, and only
  touched unit tests;
- geometry changes: targeted deterministic generation, known-bad gate, and
  production-spline probes;
- determinism changes: per-runtime candidate fixtures and cross-runtime
  schema/provenance/scramble compatibility; headless parity only when runtime
  surfaces are implicated;
- Studio changes: build Studio and run browser smoke, not the full browser
  suite per edit;
- phase end: `bun run verify:fast` once;
- R5 stream end: `bun run verify` once; and
- headless race, optimizer, 10,000-seed, diversity, and statistical work run
  in subagents or background processes while independent implementation
  continues.

Use calibration seeds while developing, frozen validation seeds when choices
are locked, and release seeds only at the final release tier. Do not tune
geometry or policy against release outcomes.

## 12. Acceptance matrix

| Concern | Required evidence |
|---|---|
| Geometry semantics | Multi-knot groups integrate their intended signed turn and lobe sequence; no fixed scaffold or baked-in corners |
| Straights | More than half of eligible non-pit straight groups have a measurable shallow bend while remaining full-throttle; pit/grid interval remains valid |
| Closure | Actual integrated and production-sampled position/heading residuals pass hard tolerances without snapping |
| Safety geometry | Zero non-finite, duplicate-segment, curvature-rate, crossing, or clearance escapes in 10,000 seeds |
| Topology diversity | Frozen structural-duplicate, bucket-concentration, and occupied-bucket bands pass over 1,000 seeds per archetype |
| Plan fidelity | Per-group length, turn, radius class, lobe order, and flex distortion gates pass |
| Racing utility | Existing speed, lap, straight, corner, pass-score, width, pit, and profile gates pass; final headless probes wait for T4 |
| Determinism | Exact same-version repeatability within CLI and within browser; compatible cross-runtime schema/provenance and exact shared scramble semantics |
| Compatibility | Six authored tracks rebuild bit-identically; no racecraft/calibration or legacy fixture normalization |
| Performance | Accepted track ≤30 s; Tier-0 throughput and closure iterations reported; no in-game runtime cost added |
| Studio | Group editing, overlays, imports, exports, and three scramble semantics covered by smoke checks |
| Provenance | Versioned artifact contains resolved knots, solve report, metrics, fingerprints, and deep-validation status |

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Closure solver erases authored character | Solve only declared connectors/transitions, bound every delta, gate per-group distortion, reject instead of repairing |
| Multi-knot curves become noisy | Bound knot count and curvature rate, interpolate without overshoot, inspect production-sampled curvature rather than smoothing coordinates later |
| All routes still share one topology | Remove global scaffold, add normalized population-distance evidence and frozen topology buckets |
| Shallow bends destroy overtaking or pit fit | Gate full-throttle duration physically, reserve a local pit/grid interval, and expose bend parameters per group |
| Catmull-Rom changes the integrated shape | Emit sufficient control density and gate closure, curvature, lobes, and clearance after the production sampler |
| Aesthetic topology metrics overfit one circuit style | Keep them observe-only first, calibrate across authored/synthetic references, use several orthogonal metrics rather than one silhouette score |
| Acceptance rate collapses | Validate signature feasibility before RNG, provide enough bounded flex variables, reject early at cheap stages, retain ≤50 deterministic attempts |
| Schema v1/v2 provenance becomes ambiguous | Version signatures and artifacts, deterministic migration warning, native-v2 presets, remove active dual path before R5 |
| Geometry work accidentally changes racing | Keep changes inside offline trackgen/Studio/tool surfaces; consume existing line/pass/audit APIs without modifying them |
| Concurrent racecraft work dirties verification | Preserve unrelated edits, attribute failures with focused evidence, never re-record their fixtures from this stream |

## 14. Non-goals

- No coordinate tracing of Spa, Interlagos, or another real circuit.
- No freehand spline editor; custom motifs remain declarative bounded knot
  groups.
- No elevation, banking, scenery generation, or image/CV pipeline.
- No runtime/in-game procedural generation.
- No racecraft behaviour, safety-layer, physics, tyre, profile, or calibration
  changes.
- No weakening of closure, curvature-rate, intersection, clearance, or
  existing racing invariants to improve acceptance.
- No permanent v1/v2 dual realizer and no generated-track special case in
  runtime code.
