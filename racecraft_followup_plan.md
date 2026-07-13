# Golden Lap — TypeScript Modularization and Racecraft Follow-up Plan

Status: analysis and implementation plan only. No gameplay behavior is changed
by this document.

Analysis date: 2026-07-13

Current implementation surface: index.html, 4,702 lines. Its inline script
occupies lines 285–4,700. golden-lap.html is a compatibility redirect and also
contains a small inline redirect script. The target implementation moves all
executable application logic to strict TypeScript source modules under src/,
leaves index.html as markup, styles, and one deferred generated-bundle
reference, and makes golden-lap.html a script-free static redirect.

## Goal

Deliver six outcomes:

1. The HTML files contain no authored executable logic. Production logic is
   split into strict, boundary-checked TypeScript modules, composed from one
   entry point, and bundled into one file://-compatible browser artifact.
2. A car in clean air follows a deliberate racing line: it opens to the
   outside before turn-in, reaches the inside near the apex, and unwinds to the
   outside on exit. Linked corners may deliberately compromise one phase to
   prepare the next corner, but the compromise must be explicit in the corner
   plan.
3. An attacker and defender that are already longitudinally overlapping in the
   braking zone are assigned stable inside/outside corridors. Both leave a
   car-width of usable road through turn-in, apex, and track-out, even if their
   running order flips or an attack/defense timer expires.
4. A car travelling through the pit lane is not stopped by a rival car parked
   in its box. Same-team stacking, a car crossing into or out of a box, and the
   pit-exit merge remain real conflicts and are handled deliberately.
5. A lapped car recognizes a faster car that is at least one lap ahead,
   abandons normal attack/defense behavior, and gives way predictably under
   blue flags until the faster car is safely through.
6. In qualifying, a car on an out lap or in lap yields the racing line and
   preference to an approaching car on a flying lap, without making a sudden
   move across that car's braking or corner path.

## Constraints and non-goals

- The prior single-file and no-build constraints are explicitly superseded by
  this plan. A build is now required after checkout and before every browser
  test or local launch.
- index.html keeps the existing markup and CSS in this scope, but contains no
  inline gameplay JavaScript. It loads dist/goldenlap.js with one deferred
  classic script tag.
- golden-lap.html remains as the old entry-point alias, but uses only its meta
  refresh and fallback link; its inline location.replace script is removed.
- Source code is authored as ES modules in TypeScript. Bun bundles those
  modules as a browser-targeted IIFE so the built game still opens through
  file:// without an HTTP server.
- Keep the physics/autopilot core and the session engine independent from DOM,
  Canvas, Audio, and browser-global state. New path inputs to botStep remain
  optional and usable by pure unit tests.
- The TypeScript migration is behavior-preserving. No pit, line, racecraft,
  blue-flag, or qualifying-priority fix may land in the temporary migration
  shell or be accepted as an incidental refactor change.
- Preserve starts, damaged-car avoidance, pit strategy, rain, recovery,
  classification, mobile layout, and fixed-step 1x/4x/8x play. Strengthen
  qualifying and blue-flag behavior through the explicit priority work below.
- Do not make every car use an outside-inside-outside line while battling.
  Clean-air driving uses the ideal line; attack, defense, and side-by-side
  driving use intentionally compromised paths.
- Guarantee safe, believable two-wide cornering first. If a third car reaches
  the same turn-in without enough road for three corridors, the trailing car
  must tuck in instead of receiving a conflicting pair-wise target.

## Architecture decision — TypeScript modules with a generated browser bundle

### Breaking compatibility change

The source checkout is no longer directly runnable before a build. This is the
only intentional packaging break:

- Before migration, index.html contains and executes all JavaScript itself.
- After migration, bun run build must create dist/goldenlap.js before
  index.html can start.
- After that build, direct file:// execution remains supported.
- Runtime behavior, both HTML entry paths, DOM ids, controls, save/reset
  behavior, and the window.__GL browser-test contract remain compatible.

No native browser module graph is loaded at runtime. This avoids file:// CORS
restrictions while still keeping the authored source modular.

### Fixed toolchain

The initial migration pins these versions rather than using floating ranges:

| Tool | Version | Responsibility |
|---|---:|---|
| Bun | 1.3.14 | package manager, lockfile owner, TypeScript-aware browser bundler, unit-test runner |
| @types/bun | 1.3.14 | TypeScript declarations for bun:test and Bun tooling |
| Node.js | 22.22.1 | CommonJS runner for the existing tools/*.js browser harnesses |
| TypeScript | 5.9.3 | strict no-emit static type checking |
| Playwright | 1.58.2 | local browser integration dependency used by tools/ |

package.json must keep type set to commonjs, or omit type, so the existing
CommonJS tools/*.js scripts continue to run under Node. TypeScript source uses
ES imports because tsconfig.json controls its module syntax independently.
It is private, declares packageManager as bun@1.3.14, has no runtime
dependencies, and pins devDependencies exactly to typescript 5.9.3 and
playwright 1.58.2 plus @types/bun 1.3.14, with no caret/tilde ranges.
package.json engines and .nvmrc pin the browser-tool runner to Node 22.22.1.

Committed architecture/tooling files:

- package.json;
- bun.lock;
- tsconfig.json;
- .nvmrc;
- .gitignore;
- README.md with build, file launch, test and static-deploy commands;
- src/ TypeScript sources;
- tests/unit/ TypeScript tests;
- tools/check-built-artifact.js;
- tools/check-module-boundaries.js;
- tools/run-browser-checks.js;
- tools/run-season-matrix.js.

Generated and ignored:

- node_modules/;
- dist/goldenlap.js;
- dist/goldenlap.js.map;
- output/ and tool screenshot/trace artifacts;
- Bun build metadata or temporary profiles.

dist/ is never hand-edited or committed. The deployable static artifact is
index.html, the script-free golden-lap.html redirect, dist/goldenlap.js, and
any future explicitly referenced static assets. Source maps are development
artifacts and are excluded from the production package.

### Required package scripts

These public script contracts are fixed:

| Script | Contract |
|---|---|
| typecheck | Run tsc -p tsconfig.json --noEmit |
| build:bundle | Bundle src/main.ts to dist/goldenlap.js with Bun target browser, format iife, external source map, and unresolved imports rejected |
| build | Run typecheck, then build:bundle |
| build:prod | Run typecheck, then create the same IIFE with minification and no source map |
| check:boundaries | Run node tools/check-module-boundaries.js |
| test:unit:raw | Run bun test tests/unit without rebuilding |
| test:unit | Run build and boundary checks before test:unit:raw |
| test:browser:raw | Run node tools/run-browser-checks.js against built index.html |
| test:browser | Run build before test:browser:raw |
| test:season:raw | Run node tools/run-season-matrix.js for the complete seeded dry/rain matrix |
| test:season | Run build before test:season:raw |
| test:prod | Run build:prod, then node tools/run-browser-checks.js --smoke --expect-production |
| verify | Run one development build, boundary checks, the three raw test suites, then test:prod |

No browser-dependent public test command may silently reuse a stale bundle.
tools/check-built-artifact.js fails when the bundle is missing or older than
index.html, golden-lap.html, package/lock/config files, or any src/**/*.ts
input. Both raw browser and season runners call it. Raw scripts exist only so
verify can build once rather than recursively rebuilding; the raw unit runner
does not consume a browser bundle.

Clean-checkout setup is bun install followed once by bunx playwright install
chromium for browser-test machines. The built game itself has no package or
network dependency.

The canonical bundle invocation is:

    bun build src/main.ts --target=browser --format=iife
      --outfile=dist/goldenlap.js --sourcemap=external --reject-unresolved

Production packaging repeats the build with minification and excludes the map.
Both development and minified bundles must pass the browser smoke check.
The production smoke mode checks file:// boot, the public API, one rendered
frame, both HTML entry paths, absence of a sourceMappingURL, and absence of
console/page errors; it does not rerun the season matrix.

### TypeScript compiler contract

tsconfig.json covers src/**/*.ts and tests/unit/**/*.ts and uses:

- target ES2022;
- module ESNext;
- moduleResolution Bundler;
- lib ES2022 and DOM;
- types bun so tests/unit imports from bun:test are type-checked;
- strict true;
- noImplicitAny true;
- noUncheckedIndexedAccess true;
- exactOptionalPropertyTypes true;
- useUnknownInCatchVariables true;
- noFallthroughCasesInSwitch true;
- noEmit true.

The final source admits no ts-ignore, ts-expect-error, or ts-nocheck. During
migration, one temporary src/legacy-main.ts file may use ts-nocheck under the
strict restrictions in the migration phases below.

### Target source tree and ownership

    src/
      main.ts                         browser composition root and boot only
      globals.d.ts                    Window.__GL declaration
      test-api.ts                     typed compatibility adapter
      shared/
        math.ts                       clamp, lerp, angles, numeric helpers
        rng.ts                        deterministic RNG contract/default adapter
        types.ts                      shared ids, readonly authoring shapes and exhaustive utility types
      data/
        tracks.ts                     readonly circuit authoring data
        championship.ts               calendar, points, prizes
        personnel.ts                  teams, drivers, staff, sponsors
      core/
        model.ts                      Car, Track, Path, Corner, lap/core types
        physics.ts                    stepCar and physical constants
        track.ts                      buildTrack, sensing, spatial lookup
        racing-line.ts                corner detection, paths, speed profiles
        lap.ts                        checkpoints and crossing rules
        autopilot.ts                  botStep and path-following contract
        collision.ts                  car collision detection/response
      session/
        model.ts                      Entry, Session, events and session types
        entry.ts                      one-entry fixed-step orchestration
        strategy.ts                   tyres, fuel, pace and pit decisions
        pit.ts                        pit state, occupancy and reservations
        incidents.ts                  failures, mistakes and recovery
        session.ts                    session lifecycle and fixed-step update
        racecraft/
          paths.ts                    attack/defend/yield/corridor plans
          traffic.ts                  awareness, following and arbitration
          corner-rights.ts            latched overlap/corridor state
          priority.ts                 blue-flag and qualifying preference
      game/
        model.ts                      GameState and application-facing types
        management.ts                 selection, upgrades and economy commands
        weekend.ts                    quali/race setup and transitions
        results.ts                    classification, points and season results
      ui/
        dom.ts                        checked DOM lookup and element registry
        sheets.ts                     menu/management/garage/result sheets
        hud.ts                        qualifying/race HUD
        render.ts                     canvas track/car renderer and caches
        camera.ts                     director, pan, zoom and follow state
        effects.ts                    dust, skids, banners and toasts
        audio.ts                      WebAudio adapter
        controls.ts                   keyboard, pointer and button binding

    tests/
      unit/
        core/                         pure math/track/physics/path tests
        session/                      pit/racecraft/priority state tests
      fixtures/
        parity/                       seeded pre-migration snapshots/checksums

    tools/
      check-built-artifact.js
      check-module-boundaries.js
      run-browser-checks.js
      run-season-matrix.js
      race-sim.js
      racecraft-check.js
      racecraft-edge-check.js
      racecraft-followup-check.js
      racecraft-ui-check.js
      trackscore.js

File splits may become smaller if a module exceeds roughly 500 lines, but
ownership may not be merged across the layer boundaries below.

### Dependency direction and boundary enforcement

Allowed production imports form one acyclic direction. In this diagram,
A -> B means A may import B:

    data    -> shared
    core    -> shared
    session -> shared, core
    game    -> shared, data, core, session
    ui      -> shared, data, core, session, game
    main    -> every layer through its public exports

Normative rules:

- shared imports no other production layer.
- data imports shared types only and exports readonly authoring definitions.
- core imports shared only and receives authoring definitions as arguments; it
  imports no data values, session, game, ui, DOM, Canvas, Audio, window,
  document, GameState, or mutable singleton.
- session imports shared and core; all driver/team/track inputs arrive through
  typed construction arguments. It imports no data values, game or ui and
  reads no window/document state.
- game owns GameState and application commands. It may call session services
  but imports no ui.
- ui may read application/session state and issue typed game commands. It does
  not calculate physics, pit occupancy, racecraft, scoring, or classification.
- main.ts creates dependencies, installs ports, binds controls, installs the
  test API, and starts requestAnimationFrame. It contains no domain algorithm.
- test-api.ts is the only compatibility adapter allowed to span layers. Only
  main.ts imports it; no other production module may depend on it.
- Cross-layer imports target named public modules, never another layer's
  private implementation file through a path escape.
- Circular imports are forbidden even when the bundler could execute them.

tools/check-module-boundaries.js scans imports and fails on a forbidden edge,
cycle, DOM token in core/session, any inline script body in either root HTML
file, any executable script reference other than index.html's one deferred
dist/goldenlap.js tag, any migration suppression outside the one temporary
shell, or any suppression remaining after the strict architecture gate.

### Typed state contracts

The canonical discriminated unions are:

- GamePhase: menu, staff, quali, grid, race, results, workshop, seasonEnd.
- SessionMode: quali or race.
- SessionPhase: count, run, or end.
- EntryState: none, box, grid, run, pitIn, pit, pitOut, fin, or dnf.
- QualifyingLapPhase: out, flying, or in; absent outside qualifying.
- PathMode: ideal, attack, defend, side-inside, side-outside, blue-yield,
  qualifying-yield, priority-pass, tuck, or pit.
- PitPhase: travel, decelerate, ingress, stopped-box, queued, egress, or merge.
- PriorityReason: blue-flag or qualifying.

Required interfaces and ownership:

- Car: pose, body-frame velocity, yaw/steer/slip, speed/progress cache, and
  off-course state; owned by core physics and embedded in an Entry.
- Track: immutable sampled centreline geometry, width, checkpoints, pit
  geometry, authoring definition, semantic corners, ideal SampledPath and
  centreline/ideal timing profiles; render caches are not stored on Track.
- SampledPath: four equal-length Float64Array values named off, k, ds and v,
  plus optional phase metadata. off is absolute road-normal offset; k is signed
  path curvature; ds is distance to the next cyclic sample; v is target speed.
  botStep consumes only this materialized core type. World x/y and tangent
  samples are pure derivations of Track plus off; cumulative t and lapTime live
  in a separate PathTiming value. UI may cache a Path2D, but those derivations
  are not additional path authorities.
- PathTiming: an N + 1 cumulative-time Float64Array named t plus lapTime; it is
  computed from exactly the k, ds and v data in its paired SampledPath.
- PathPlan: a session-owned discriminated value containing PathMode, corner or
  complex id, transition anchors and optional corridor bounds. paths.ts
  materializes it to SampledPath when the plan changes; it is never sampled
  from mutable session state inside botStep.
- Corner: stable id, cyclic phase indices, side, severity, complex id and
  planned lateral anchors.
- Entry: driver/team identity, EntryState, optional QualifyingLapPhase and Car,
  tyre/fuel/reliability, completed laps/progress, strategy, path plan, pit
  state, racecraft timers and diagnostic counters; owned by session.
- Session: SessionMode/SessionPhase, Track reference, entries, fixed-step time,
  weather, race/qualifying state, pair states, pit reservations, events and
  metrics; owned by session.
- GameState: GamePhase, player selections, economy/championship state, round,
  runtime calendar and optional Session; owned by game.

Optional state is represented explicitly with null/undefined and narrowed at
module boundaries. State-specific payloads use discriminated unions rather
than a bag of fields whose meaning depends on string checks.

### Runtime ports, events, and state ownership

GameState has one owner created in main.ts. Normal gameplay mutations go
through typed game commands. The test-api direct-write proxies described below
are the sole compatibility exception and are covered by mutation-forwarding
tests; they do not permit another module to import or own GameState. Session
functions receive Session and typed dependencies; they do not import a global
G object. The default RNG port calls Math.random so the current Playwright seed
override preserves call order during migration. Moving or consolidating random
calls is a behavior change and is forbidden before the parity gate.

Session owns an ordered SessionEvent[] queue. Its exhaustive event union
contains:

- toast: message and info/bad/default kind;
- banner: tone, title and subtitle;
- audio: cue id and optional strength;
- effect: skid/dust/contact kind plus world position and magnitude;
- hud-dirty: optional car index;
- camera-candidate: entry index and event kind;
- session-complete: qualifying/race result payload.

The application step wrapper drains this queue synchronously, in insertion
order, before stepSession returns. That preserves current browser/test timing
even when one animation frame advances several fixed steps. Pure session unit
tests inspect the queue without a UI. UI consumes events; simulation never
calls DOM functions directly. RNG is the only injected session port during the
migration.

Renderer caches live in ui/render.ts keyed by track id or Track identity.
They are not added to the pure Track model. Mutable calendar weather used by
tests is a runtime GameState copy; readonly authoring data remains unchanged.

### window.__GL compatibility contract

src/test-api.ts defines GoldenLapTestApi and installs it during boot. The
following current keys remain available with compatible behavior:

- G, TEAM_DEFS, DRIVERS, BUILT, CALENDAR;
- pickTeam, sheetAction, qualiSend, qualiBox, qualiEnd, startRace, setScale;
- playerEntry, entryMargin, stepSession, startWeekend, compileResults,
  raceLapsFor;
- buildTrack, racingLine, speedProfile, buildCorners, nextCorner;
- makeCar, trackSense, stepCar, botStep, collideCars, PHYS, TRACK_DEFS;
- getter S;
- optional debugLine used by visual tooling.

Compatibility façades may reconstruct legacy BUILT render-cache fields,
mutable calendar views, and the current rline.x/y/tx/ty/t/lapTime diagnostic
shape from Track, SampledPath and PathTiming. These views are cached once per
track, but internal core types stay clean. New diagnostics are additive.
Existing names are removed only in a separately approved breaking change.

Compatibility includes the direct writes used by current tools: G.S, G.round,
CALENDAR[*].rainP, Session phase/time/scale fields, Entry state/timers and Car
placement. A façade must forward those reads/writes to the live runtime rather
than return a detached snapshot. Production UI does not use this mutation
surface.

Boot sets window.__GL before the first requested animation frame. Playwright
continues to load file://.../index.html, wait for window.__GL, and override
requestAnimationFrame/Math.random before bundle execution exactly as today.

### Migration parity contract

Architecture migration and behavior correction use separate gates:

- Green regression fixtures capture behavior that must not change.
- Defect characterizations explicitly assert the current bad outcome in
  baseline mode and later flip to acceptance mode in the owning feature phase.
- A migration phase may not make a defect acceptance test pass by accident.
  Such a delta is investigated and either reverted or moved into its feature
  phase with the corresponding design and review.

Parity fixtures include:

- exact window.__GL key list and callable/getter shape;
- script-free golden-lap.html redirect behavior and direct file:// index boot;
- checksums of track samples, pit geometry, racing-line/profile arrays and
  corner tables on all six tracks;
- seeded snapshots of game/session initialization;
- seeded car/session state after fixed tick counts in qualifying and racing;
- seeded race summary metrics and classifications;
- initial menu, weekend, garage, grid, race HUD and results DOM smoke flows;
- file:// boot, canvas render, mobile bounds, pause and 1x/4x/8x controls;
- console/page errors and finite-state checks.

Floating-point arrays compare by a documented checksum over normalized values
or tight tolerances where bundling/transpilation can change representation;
the tolerance is frozen with the fixture and never widened to make a phase
pass. Random call order must remain identical.

### Runtime and delivery invariants

- The production bundle is one self-contained IIFE: no code splitting, dynamic
  import, eval, runtime package lookup, network fetch, or CDN dependency.
- Physics remains fixed at 1/120 s and traffic planning at 1/30 s. Module
  boundaries do not add asynchronous work inside either loop.
- SampledPath materialization occurs on track construction or path-plan
  transitions, never per physics tick.
- Development source maps do not ship. Browser errors in a development build
  must still map to TypeScript sources.
- Existing desktop/mobile browser behavior and reduced-motion handling remain
  unchanged. The build introduces no worker, storage, cookie, telemetry, or
  external service.
- Phase 6 records development/minified bundle size and boot time. Phase 13
  fails an unexplained regression over 20% from that modular baseline.

## Evidence from the current build

### 1. The generated line is not explicitly outside-inside-outside

For each detected corner, the current racing-line offset was sampled 45 metres
before the apex, at the apex, and 45 metres after it. The offset was multiplied
by the corner side, so positive means inside and negative means outside. A
strict outside-inside-outside result requires negative, positive, negative.

| Track | Detected corners | Strict outside-inside-outside | Current relative-only check | Samples near lateral clamp |
|---|---:|---:|---:|---:|
| Prado Verde | 11 | 0 | 4 | 28.42% |
| Costa do Sol | 7 | 0 | 4 | 10.85% |
| Nordwald | 19 | 0 | 2 | 24.61% |
| Villa Reale | 11 | 0 | 11 | 21.74% |
| Anhembi | 8 | 0 | 4 | 12.86% |
| Cerro Alto | 13 | 0 | 10 | 17.28% |

The existing tools/racecraft-check.js labels a corner shaped when the apex is
only 0.35 m farther inside than its two samples. It does not require either
sample to be outside. That is why the previous report could call 11/11 Villa
Reale corners shaped while the strict test finds 0/11.

The most obvious saturation case is Prado Verde: some corners remain at
+4.4 m, the inside clamp, throughout approach, apex, and exit. A faster
theoretical lap time does not prove that the path has a recognizable racing
line.

### 2. Braking-zone room is not a persistent right

A deterministic Prado Verde scenario placed two cars at a real braking point
with:

- longitudinal gap: 2.00 m;
- lateral separation: 2.00 m;
- both attack timers disabled, representing cars that are already alongside
  rather than a new AI attack decision.

After a traffic update, no room state was created and neither car was marked
room-active. Their absolute lateral targets simply began decaying toward the
normal line.

The current force-room branch requires all of the following in the same 30 Hz
traffic tick:

- the cars appear in the expected behind/ahead order after sorting;
- the nominal attacker still has atkT greater than zero;
- the next brake point is under 15 m away;
- longitudinal gap is under 4.5 m;
- lateral separation is already greater than 1.8 m.

The pair state then records only a corner apex and contact-recovery flag.
It does not record who owns the inside/outside corridor, whether overlap was
established in the braking zone, or how long the right must survive. A sort
order flip, timer expiry, small suspension movement, or temporary drop below
the lateral hysteresis can therefore remove the protection before track-out.

### 3. A stopped foreign pit-box car is treated as the lane leader

Pit geometry has a 3.2 m lateral difference between the moving lane
(laneOff = half-width + 4.6 m) and the stationary box line
(boxOff = half-width + 7.8 m). The traffic scan at updateTraffic, however,
selects the nearest positive pitW from pitIn, pit, or pitOut entries without
checking lateral occupancy.

In a deterministic scenario:

- the travelling car began at pitW 70 m and 14 m/s;
- a rival car was stopped at pitW 78 m on the box line;
- the lateral separation was 3.2 m and the moving lane was clear;
- the travelling car's first computed traffic cap was -0.29 m/s and the
  minimum cap reached -4.79 m/s;
- it stopped about 5.1 m behind the rival and did not pass in ten seconds.

The current pit edge test uses one isolated moving car. updateTraffic only
enters its neighbour loop when at least two non-parked entries exist, so that
test cannot expose this field-dependent blockage.

There is a second geometry concern: pitIn currently targets boxOff starting
16 m before its stop. Since boxes are only 10 m apart, an incoming car may
cross the working area of an earlier team before reaching its own box. Merely
ignoring stopped cars in the traffic scan would hide the false leader but
would not make this crossing safe.

### 4. Blue flags and qualifying preference are transient pair branches

The current build contains both behaviors, but neither is represented as a
persistent priority state:

- The blue-flag branch runs when the selected follower is one or more laps
  ahead of its selected traffic reference and is within 55 m. It refreshes a
  0.4 s yield timer and assigns fixed absolute offsets to both cars.
- The qualifying branch classifies a flying car with lapLive and not boxArm.
  When that car catches the selected non-flying reference, it refreshes the
  same short yield behavior and assigns another pair of fixed offsets.

Both branches depend on the yielding car remaining the selected traffic
reference. Once lateral separation changes, a different nearby car becomes
the reference, or sorted order changes during the pass, the preference can
stop refreshing before the pass is complete. The fixed left/right offsets
also do not account for the next corner, the new ideal path, an active
side-by-side corridor, or a car already committed to pit entry.

The existing edge test checks only that one blue-flag traffic tick moves the
two target offsets in opposite directions. It does not prove that the lapped
car stays out of the way until clearance. The qualifying flow test observes
that yielding occurred at least once, but does not verify an out-lap or in-lap
car against a complete flying-lap pass or measure the time lost by the flying
car.

## Root causes and required architectural changes

### Racing line

racingLine() runs a 300-sweep local chord relaxation with a four-sample
stencil, then clamps the result to the road. It has no concepts of approach,
turn-in, apex, track-out, exit, or linked-corner compromise. buildCorners()
runs only after this line exists and stores just apexI, vApex, brakeI, and
side, so it cannot guide line construction.

The initialization pipeline is therefore backwards for an authored racing
line:

1. build track;
2. generate line without corner semantics;
3. generate line speed profile;
4. infer a minimal corner table from that result.

The replacement needs a preliminary centerline profile, a semantic corner map,
then the line, then a final line profile and optional corner refinement.

### Per-car paths

botStep() currently evaluates every future target as:

    idealLineOffset[sample] + one scalar lateral offset

That can translate a fixed line, but it cannot describe:

- an ideal outside-to-inside-to-outside line;
- an inside attack that must stay inside on exit while another car is outside;
- a defensive entry that covers the inside and then unwinds;
- separate inside and outside side-by-side corridors.

The controller needs a phase-varying path sampler, with curvature and speed
consistent with the sampled geometry. Continuing to use ideal-line curvature
for a dynamically bent path would make the inside car carry the wrong corner
speed and recreate avoidable contact.

### Corner rights

Attack and defense timers may initiate a move, but legal room cannot be a
timer. It is an event-latched pair state acquired from physical overlap in a
specific corner phase and released only after a defined track-out/clear
condition.

Targets must derive from fixed inside/outside roles and road corridors, not
from whichever car happens to have the smaller latNow in one tick.

### Pit traffic

Pit following must operate on swept corridor occupancy in pit-local
coordinates: longitudinal pitW plus lateral pit offset. Longitudinal proximity
alone is insufficient. Stopped box cars, moving-lane cars, box crossers,
same-team queue cars, and merge traffic are different occupancies.

### Blue flags and qualifying priority

Giving way is a right-of-way protocol, not a momentary steering suggestion.
Detection must be independent of the normal braking reference, and the
yielding car must remember the beneficiary and reason until a physical
clearance condition is met.

The yielding path must also be phase-aware. On a straight, the slower car can
leave the ideal line early and hold a predictable side. In a braking zone or
mid-corner, it is safer to hold the current corridor through the apex and
clear the ideal line on exit than to dart across the priority car's path.
Normal attacks, defensive moves, and tow decisions must be suppressed while
a car is yielding.

## Target data model

The following names and information are canonical. Renaming one requires an
explicit plan/document update rather than an undocumented implementation
choice.

### Semantic corner record

Each track corner should contain:

- id;
- approachI;
- brakeI;
- turnInI;
- apexI;
- trackOutI;
- exitI;
- side;
- vApex and severity;
- complexId and whether the corner is isolated;
- entry, apex, and exit lateral targets chosen by the line planner.

Indices remain cyclic track-sample indices. Helpers must compare them with
wrap-aware distances rather than ordinary numeric ordering.

### Path contract

The optional botStep path input is one SampledPath with equal array lengths:

- off[index]: absolute lateral offset from the sampled centreline;
- k[index]: signed curvature of that same path;
- ds[index]: distance from index to the next cyclic path sample;
- v[index]: target speed derived from k/ds for that same path.

The ideal line is a persistent SampledPath. A compact session PathPlan is
materialized and cached only when a car acquires/changes a mode, corner,
complex, corridor split or transition anchor. Materialization recomputes all
four arrays; per-tick mutable callbacks are not part of the core contract.
This removes the architectural choice between arrays and runtime samplers and
ensures steering and speed use identical geometry. botStep knows nothing about
entries, sessions, attack state, or the DOM.

Each active car should expose a diagnostic path mode such as:

- ideal;
- attack;
- defend;
- side-inside;
- side-outside;
- blue-yield;
- qualifying-yield;
- priority-pass;
- tuck;
- pit.

### Latched corner-rights record

Store pair state by a stable, order-independent car key:

- cornerId and complexId;
- inside car code and outside car code;
- initiating attacker/defender codes for telemetry only;
- overlap acquisition time and phase;
- phase-indexed corridor anchors fixed at acquisition (or at an explicit linked-
  corner hand-off), rather than a split recomputed from each tick's ordering;
- required centre separation;
- last-seen stamp and clear-since time;
- release reason.

Attack/defense timers must not be consulted to decide whether this state
continues.

### Pit occupancy record

Pit-local helpers should provide:

- current pitW and lateral offset;
- phase: travel, decelerate, ingress, stopped-box, queued, egress, or merge;
- swept longitudinal/lateral envelope over a short horizon;
- box or crossing reservation, if any;
- explicit wait reason for diagnostics.

### Priority/yield record

Store right-of-way state independently from the currently selected braking
reference:

- reason: blue flag or qualifying flying-lap preference;
- yielding car code and beneficiary car code;
- activation time, distance, and track phase;
- chosen safe side or phase-aware yield path;
- whether the beneficiary has established overlap or passed;
- last-seen stamp, clear-since time, and release reason.

A yielding car may have another priority car approaching after the first.
Track those beneficiaries in approach order so completing one pass does not
briefly return the car to attack/defense mode in front of the next one.

## Implementation plan

### Phase 0 — Freeze migration parity and defect characterizations

1. Run every current structural, edge, UI, track and seeded season tool against
   the inline-script build and save its green result. Capture both index.html
   boot and the current golden-lap.html redirect as packaging parity.
2. Add tests/fixtures/parity with the API, checksum, fixed-tick, DOM-flow and
   race-summary fixtures defined by the migration parity contract. Record the
   exact comparison tolerance and random seed beside every numeric fixture.
3. Add tools/racecraft-followup-check.js with two explicit modes:
   - baseline mode passes only when it reproduces the documented current
     defects;
   - acceptance mode passes only when the corrected feature behavior occurs.
   Migration phases run baseline mode. Each feature phase flips only its own
   scenario to acceptance mode.
4. Extend tools/racecraft-check.js for the pre-semantic baseline:
   - keep the existing relative-apex metric for historical comparison;
   - add the strict side-normalized sign check at apex plus/minus 45 m used by
     the evidence table;
   - do not label the relative metric outside-inside-outside;
   - defer semantic phase-marker and complex assertions to Phase 8, when those
     fields exist.
5. Add a braking-zone two-car characterization that records:
   - longitudinal overlap is recognized at the physical car-body threshold;
   - rights survive an order flip;
   - rights survive atkT and defT reaching zero;
   - the pair remains protected through track-out.
6. Add a pit characterization with a realistic active field, a traveller, and a
   stopped foreign box car. Record time to fixed pitW checkpoints, minimum
   speed, selected traffic leader, wait reason, and whether it passed.
7. Add complete blue-flag pass characterizations. Start with the lap-ahead car behind,
   run through detection, yield, overlap, clearance, and release, and record
   any defensive move or obstruction time by the lapped car.
8. Add qualifying characterizations in which a flying-lap car catches one car on an
   out lap and one on an in lap. Compare the flying car's sector/lap loss with
   a clear-track control and verify preference until the pass is complete.
9. Save the evidence table above, the exact window.__GL key list, all current
   source/tool versions and the built-track checksums in the fixture manifest.

Exit gate: all green regressions pass. The line, braking-zone-rights and pit
defects pass in baseline mode and fail in acceptance mode for the documented
reason. Every blue-flag/qualifying matrix result, including any simple case
that already succeeds, is frozen as parity evidence and its unmet acceptance
cases are identified. Nothing in Phase 0 changes production behavior.

### Phase 1 — Scaffold TypeScript and externalize the monolith atomically

1. Add the pinned package.json, bun.lock, tsconfig.json and .gitignore contracts
   from the architecture section.
   Add README.md so a clean checkout has one canonical build/run/test path.
2. Add package scripts and the build-before-test runner. Install dependencies
   only through bun install so bun.lock is authoritative.
3. Move the existing script body, without cleanup or behavior edits, into the
   one permitted src/legacy-main.ts migration shell. It may contain the only
   ts-nocheck in the repository.
4. Add src/main.ts as a minimal composition entry that calls the legacy boot
   once after the deferred script loads.
5. Build the IIFE, replace the inline script with:

       <script defer src="./dist/goldenlap.js"></script>

   and verify index.html contains no other script body.
6. Remove the inline location.replace script from golden-lap.html, retaining
   its meta refresh and fallback link. Verify both file:// entry paths reach a
   working menu without an inline executable body.
7. Keep the current browser guard, boot order, requestAnimationFrame scheduling
   and window.__GL installation order unchanged inside the shell.
8. Run the full parity fixture set and all green tools. Run every defect in
   baseline mode.

Exit gate:

- file:// index.html boots from a clean bun run build;
- missing dist/goldenlap.js fails visibly in browser/console rather than
  silently presenting a non-functional menu;
- all parity fixtures match, all green tools pass and all defect baselines are
  unchanged;
- no source file other than legacy-main.ts has a TypeScript suppression.

Rollback gate: if any parity mismatch cannot be explained without changing
behavior, restore the inline entry and fix the externalization before
extracting a module.

### Phase 2 — Extract shared utilities, immutable data, and pure core

Extract in this order, running parity after each bullet:

1. shared/math.ts and shared/rng.ts;
2. data/tracks.ts, data/championship.ts and data/personnel.ts;
3. core/model.ts and exact types for Car, Track, SampledPath, PathTiming and
   Corner;
4. core/physics.ts and core/collision.ts;
5. core/track.ts and core/lap.ts;
6. core/racing-line.ts and core/autopilot.ts.

Rules:

- legacy-main.ts imports the extracted symbols; it may not duplicate them.
- Preserve function evaluation order, typed-array types, numeric constants,
  Math.random call order and object construction order.
- Core functions receive all inputs explicitly and export no mutable singleton.
- Track render cache moves nowhere yet; the legacy adapter owns it until
  ui/render.ts exists.
- Add Bun unit tests around every pure module using the frozen parity fixtures.
- Extend the boundary checker as each directory becomes real.

Exit gate:

- shared/data/core satisfy the final dependency rules;
- core has zero DOM/window/document/GameState references;
- pure unit tests and browser parity pass;
- the legacy shell is smaller by the full extracted core/data sections;
- defect tests still pass only in baseline mode.

Rollback gate: revert only the latest extraction unit when its output,
floating-point trace or random sequence differs; do not widen fixture
tolerances.

### Phase 3 — Extract the session engine and racecraft baseline

1. Define session/model.ts with exact Entry, Session, EntryState, SessionMode,
   SessionPhase, QualifyingLapPhase, timer, pair-state, metric and strategy
   types. During migration, map the existing lapLive/boxArm behavior exactly;
   do not alter qualifying phase transitions yet.
2. Move tyre/fuel/pace strategy to session/strategy.ts.
3. Move existing pit state transitions, unchanged, to session/pit.ts.
4. Move incidents, failures, mistakes and recovery to session/incidents.ts.
5. Move one-entry stepping to session/entry.ts and fixed-step lifecycle to
   session/session.ts.
6. Move the current, still-defective racecraft implementation into
   session/racecraft/paths.ts, traffic.ts, corner-rights.ts and priority.ts.
   This is ownership extraction, not the later feature rewrite.
7. Replace direct UI calls with the typed event/port contract. The legacy shell
   consumes the events and invokes the same UI/audio effects at the same point
   in the tick.
8. Remove the G read from helpers such as followCap; pass Session/wet values
   without changing their numeric result.

Exit gate:

- session imports no game/ui/browser module and contains no DOM tokens;
- fixed-step state snapshots, event order, random call order, contacts, laps,
  pit transitions and race summaries match the frozen baseline;
- all session unit and boundary tests pass;
- all feature defects remain unchanged in baseline mode.

Rollback gate: event timing is behavior. Any reordered toast, strategy action,
audio cue, collision effect or completion callback must be restored before
continuing.

### Phase 4 — Extract GameState and application commands

1. Define game/model.ts and create one GameState in the composition root.
2. Move team/staff selection, economy and upgrade commands to
   game/management.ts.
3. Move qualifying/race setup and round transitions to game/weekend.ts.
4. Move classification, points, prizes and season completion to
   game/results.ts.
5. Replace cross-module mutation entry points with typed application commands.
   Preserve current command ordering and externally visible sheetAction
   behavior through the compatibility adapter.
6. Store the runtime mutable calendar in GameState while data/championship.ts
   remains readonly.

Exit gate:

- game imports no ui and owns all normal gameplay GameState mutation; the
  test-api compatibility proxies are the only direct-write exception;
- session receives state/dependencies rather than importing G;
- management screens, weekend transitions, results and economy parity pass;
- window.__GL exposes compatible G and CALENDAR views;
- the defect baseline is unchanged.

Rollback gate: move management, weekend and results ownership separately.
Revert the latest ownership move if command order, rendered state, economy,
classification or compatibility writes differ.

### Phase 5 — Extract browser adapters and establish the composition root

1. Move checked DOM lookup to ui/dom.ts. Missing required ids throw a boot
   error naming the id.
2. Move audio, effects, sheets, HUD, renderer, camera and controls to their
   target modules without changing markup, CSS or event timing.
3. Move render caches from BUILT/Track to ui/render.ts and supply a legacy
   BUILT façade from test-api.ts.
4. Have ui modules consume state/events and issue application commands. Remove
   every simulation/scoring rule found in UI during extraction to its owning
   module, preserving behavior.
5. Complete src/main.ts as the only composition root: create data/catalog,
   GameState, ports and adapters; bind controls; install window.__GL; build the
   menu; request the first frame.
6. Implement GoldenLapTestApi and globals.d.ts with the exact compatibility
   surface in the architecture section.
7. Delete src/legacy-main.ts once its last responsibility moves. Do not retain
   an empty compatibility shell.

Exit gate:

- neither root HTML file has an inline script body and no legacy-main.ts
  remains;
- main.ts contains composition/boot only;
- all browser flows, screenshots, controls, render output and test API
  compatibility pass through file://;
- all defects remain in baseline mode.

Rollback gate: extract one browser responsibility at a time. A DOM, screenshot,
event-listener or frame-order mismatch blocks the next responsibility.

### Phase 6 — Enforce strict architecture and freeze the modular baseline

1. Enforce the already-configured complete strict tsconfig contract and remove
   the temporary legacy shell, leaving no transitional relaxation or
   suppression.
2. Fail on every ts-ignore, ts-expect-error, ts-nocheck, implicit any,
   forbidden import, cycle, DOM token in core/session, root-HTML inline script,
   tracked generated bundle, stale/missing post-build bundle, and missing
   public test-API key.
3. Run bun run verify. Its development stage runs typecheck, boundaries, all
   unit/browser tools and the complete seeded season matrix; its final
   test:prod stage builds the minified bundle and runs the dedicated
   file-boot/API/render smoke suite.
4. Record the final module graph, bundle hash/size, API manifest and parity
   summary as the post-migration baseline.

Architecture acceptance:

- every target responsibility has one owning module;
- dependency direction is acyclic and boundary-checked;
- no production module reads an undeclared browser/game singleton;
- dist is reproducible from the committed lockfile and never required from
  version control;
- development and production bundles boot from file://;
- behavior fixtures match the pre-migration baseline;
- every defect/priority scenario has exactly its Phase 0 outcome, proving the
  refactor did not conceal, fix or regress behavior accidentally.

No feature implementation begins until this entire gate is green.

Rollback gate: strictness or boundary failures are fixed in the owning module;
parity fixtures and layer rules are never relaxed to declare the migration
complete.

### Phase 7 — Fix pit-lane occupancy and box access independently

This is the first behavior-changing phase. It targets session/pit.ts and
session/racecraft/traffic.ts and remains independent from the racing-line work.

1. Add one pit-local lateral-coordinate helper used by pit launch, pit entry,
   traffic following, box release, and tests. Avoid separate ad-hoc estimates.
2. Replace the updateTraffic pit scan with occupancy overlap:
   - follow a pitIn or pitOut car that actually occupies the travel lane;
   - ignore a stationary pit car whose box envelope does not overlap the
     traveller's swept envelope;
   - treat ingress/egress cars as short-lived crossing conflicts, not permanent
     lane leaders;
   - clamp every pit traffic speed cap to a finite value of at least zero.
3. Split pit entry into longitudinal phases:
   - decelerate while staying on the travel line;
   - begin the lateral S-curve only after clearing the preceding box envelope;
   - cross into the working lane at low speed near the car's own box;
   - stop at its own box or a declared same-team queue point.
4. Keep a same-team double stack out of the travel lane. Use a working-lane or
   apron queue target with enough longitudinal clearance from neighbouring
   stopped cars.
5. Use a small, stamped reservation for box ingress/egress:
   - through-lane traffic has priority over a car releasing from a box;
   - an incoming car claims only its own crossing segment;
   - stale claims expire;
   - the release check uses swept envelopes rather than only a 16 m
     longitudinal window.
6. Add a deadlock diagnostic, not a silent teleport: if pitW makes no progress
   for a configured interval, log the occupancy owner and wait reason. Clear a
   stale reservation only when no physical envelope still blocks the path.

Phase acceptance:

- For every foreign-box/target-box pairing on all six tracks, time to each
  checkpoint before the traveller's own ingress differs from an empty-lane
  control by at most 0.25 s.
- No travelling car reaches a standstill because of a non-overlapping stopped
  foreign box car.
- pit trafCap is never negative or NaN.
- Same-team double stacks wait intentionally, keep the travel lane clear, then
  both receive service and rejoin.
- Simultaneous ingress, box release, and pit-exit merge cases finish without
  contact, deadlock, or state loss.
- The pit characterization runs in acceptance mode; line, corner-rights and
  priority characterizations remain in baseline mode.

### Phase 8 — Build a semantic corner map before generating the line

Primary ownership: core/racing-line.ts and core/model.ts. Track authoring data
remains in data/tracks.ts.

1. Reorder track initialization:
   - buildTrack;
   - centerline speedProfile;
   - preliminary semantic corner detection from smoothed signed curvature and
     the centerline braking profile;
   - the still-legacy racing-line construction, with unchanged numeric output;
   - racing-line speedProfile;
   - refine brake/apex timing without changing semantic corner identity.
   Phase 9, not this phase, begins consuming semantic anchors to change the
   line.
2. Segment signed-curvature regions:
   - merge tiny same-sign gaps caused by sampling noise;
   - split on meaningful direction reversal;
   - reject gentle bends that do not require a deliberate corner phase;
   - place apex near the strongest curvature/speed minimum;
   - derive turn-in and track-out from the curvature envelope;
   - derive brakeI from the preliminary speed fall, not from a fixed distance.
3. Treat the Phase 0 legacy candidate set as a deterministic minimum-coverage
   oracle, not as the new algorithm. That set uses the current exact gates: a
   local speed minimum below 0.93 * PHYS.vTop, no sample lower by more than
   0.03 m/s within plus/minus eight samples, at least one eight-sample endpoint
   over 0.35 m/s faster, and a 30 m merge radius retaining the slower minimum.
   Every frozen candidate must map to one semantic corner or an explicitly
   named member of a complex. The semantic detector may add curvature-defined
   corners, but may not silently drop a frozen candidate.
4. Group corners into complexes when the available transition distance is too
   short to complete one exit and the next entry independently.
5. Give every phase and complex a stable id so battle state and tests do not
   key only on a sample index that may move during tuning.
6. Add a debug overlay for phase markers and complex membership, disabled by
   default and enabled through the typed test API.
7. Replace the fixed plus/minus-45 m line characterization with semantic
   turnInI/apexI/trackOutI samples, report isolated corners separately from
   complexes, and record declared-target error plus actual trajectory error.

Phase acceptance:

- Every frozen legacy speed-minimum candidate maps to exactly one semantic
  corner/complex member, and every added semantic corner has a recorded
  curvature region and speed-profile reason.
- No corner has cyclic phase ordering errors.
- Left/right side agrees with signed curvature at the apex.
- Rebuilding the same track produces identical ids and markers.
- Linked esses and double-apex regions are represented as complexes rather
  than contradictory independent anchors.

### Phase 9 — Replace local chord relaxation with an explicit ideal line

Primary ownership: core/racing-line.ts, with pure validation tests under
tests/unit/core/.

1. For each isolated corner, define side-normalized targets:
   - approach/turn-in: outside;
   - apex: inside, with an edge margin for the car body;
   - track-out/exit: outside.
2. For each complex, reconcile adjacent anchors before interpolation:
   - preserve the most important apex based on severity and exit speed;
   - sacrifice exit width only when needed to set up the next turn;
   - store the compromised target so behavior and tests agree on intent.
3. Interpolate each cyclic anchor interval with quintic smootherstep
   q(u) = 6u^5 - 15u^4 + 10u^3 and linear interpolation between the two anchor
   offsets. This gives zero first/second lateral derivative at phase anchors
   and cannot overshoot their offset range. Validate slope/lateral acceleration
   in world geometry, then shrink that interval's anchor amplitudes toward the
   centreline if validation finds a road-edge violation, self-intersection, or
   steering discontinuity.
4. Recompute x/y, tangent, curvature, segment distance, and speed profile from
   the resulting path. Do not reuse centerline or old-line curvature.
5. Preserve a smooth neutral hand-off through the authored start and pit
   corridors, but do not let the fade erase a nearby corner's semantic target.
   Resolve any overlap explicitly in the corner/complex plan.
6. Keep the existing centreline profile as a fallback and diagnostic
   comparison, not as proof of shape quality.

Use a normalized signed offset for static acceptance:

    z = corner.side * pathOffset / usableHalfWidth

where usableHalfWidth is track.hw - PHYS.carWid / 2 - 0.6 m, preserving the
current 1.6 m centre-to-edge safety allowance for a 2.0 m-wide car. Track
construction rejects a non-positive usableHalfWidth.

Initial targets for isolated corners:

- z at turn-in is at most -0.45;
- z at apex is at least +0.55;
- z at track-out is at most -0.35.

These are starting gates, not tuning constants. Edge margin, stability, and
actual trajectory take priority; any relaxed target must be recorded as a
complex compromise rather than silently passing.

Phase acceptance:

- Every isolated corner passes its outside-inside-outside sign and target
  tolerance.
- Every complex matches its declared anchor plan.
- A solo bot follows the planned line within 0.75 m at phase markers, records
  zero grass samples, and has finite heading/velocity for a full lap.
- The line profile is no slower than the centerline profile unless a documented
  safety constraint requires it; no result is accepted solely because its lap
  time is lower.
- Visual overlays on all six tracks show entry opening, apex, and unwind at
  representative isolated corners.
- The strict line characterization runs in acceptance mode; rights and
  priority characterizations remain in baseline mode.

### Phase 10 — Add phase-varying race paths

Primary ownership: session/racecraft/paths.ts and core/autopilot.ts. The core
path contract stays session-agnostic.

1. Extend botStep with the optional sampled path contract. Preserve current
   behavior when it is absent.
2. Build and validate path geometry for:
   - normal ideal line;
   - pre-overlap inside attack;
   - pre-overlap defensive cover;
   - side-by-side inside corridor;
   - side-by-side outside corridor;
   - blue-flag and qualifying yield;
   - priority-car pass;
   - smooth tuck/rejoin.
3. Transition from the car's current absolute lateral position with the same
   quintic interpolation contract as Phase 9, then materialize/cache a complete
   SampledPath. Do not instantaneously reinterpret a line-relative scalar when
   the mode changes and do not rebuild arrays every physics tick.
4. Compute steering lookahead, cross-track error, curvature speed, and
   anticipatory braking from that same materialized SampledPath.
5. Keep setTargetAbsLat-like helpers for emergency avoidance and pit hand-off,
   but prevent them from overwriting an active corner-rights corridor.
6. Instrument time and distance in each path mode plus maximum target slew.

Phase acceptance:

- Clean-air cars select ideal mode and reproduce the Phase 9 trajectory.
- Attack and defense scenarios produce visibly and numerically different
  phase targets, rather than parallel translations of the ideal line.
- No path switch creates a target jump over 0.5 m at the current position or
  an unbounded steering/speed request.
- An inside path uses its own tighter curvature speed; it never inherits the
  ideal path's faster corner cap.
- Every SampledPath has track.n finite values in each off/k/ds/v array and is
  rebuilt only when its PathPlan discriminant or anchor/corridor data changes.

### Phase 11 — Latch braking-zone corner rights and enforce corridors

Primary ownership: session/racecraft/corner-rights.ts and traffic.ts.

1. Define longitudinal body overlap from car geometry and wrap-aware signed
   progress. Do not infer overlap from sorted order or a lateral threshold.
2. Acquire rights when two racing-surface cars first have body overlap from
   approachI through turnInI for the same next semantic corner. A pair already
   overlapping before brakeI therefore enters the braking zone with rights
   latched; acquisition does not depend on a fresh attack timer or sorted
   order. Acquisition is allowed whether the nominal attacker is inside or
   outside.
3. At acquisition:
   - assign inside/outside roles from corner side and actual lateral order;
   - choose a feasible corridor split within road-edge margins;
   - store the pair state;
   - cancel any new defensive squeeze, while retaining the prior move for
     telemetry.
4. Through turn-in, apex, and track-out, each car follows the best available
   path clamped to its half of the road:
   - the outside car must leave the inside corridor open at the apex;
   - the inside car must not track out through the outside corridor;
   - target centre separation starts from the current ROOM_SEP tuning but is
     reduced only if road width makes that physically necessary.
5. Add a predictive safety layer. If actual lateral motion is converging faster
   than the path can separate the cars, reduce speed or hold line; do not
   reverse roles or push both targets based on one tick's latNow ordering.
6. Make defense legal only before body overlap. One committed move may select
   the defensive path; after rights acquisition it cannot close the occupied
   corridor.
7. If no overlap exists by turn-in, the attempted passer tucks behind via the
   explicit tuck path. This remains distinct from a rights release.
8. Release rights only when:
   - both cars have passed trackOutI; and
   - their oriented bodies no longer overlap, have at least 0.5 m of bumper
     clearance, and remain clear for 0.5 s; or
   - one car leaves the racing state.
   If the pair remains alongside into a linked complex, hand the state to the
   next corner instead of dropping protection between apexes.
9. Resolve multi-car conflicts before applying pair paths. Allocate three
   corridors only when usable width and entry geometry pass a feasibility
   check; otherwise require the rearmost car to tuck.

Deterministic corner-rights matrix:

- attacker inside and attacker outside;
- left and right corners;
- overlap acquired before brakeI and midway through the braking zone;
- exact 2.0 m lateral separation, which currently falls through;
- running-order flip before apex;
- atkT expiry and defT expiry before apex;
- dry and wet grip;
- isolated corner and linked complex;
- no-overlap-at-turn-in tuck;
- three-car arrival fallback.

Phase acceptance:

- Zero corridor-rights violations from acquisition through release.
- Pair state survives every order/timer scenario above.
- Neither car's target crosses the occupied corridor boundary.
- No hard contact is caused by a planned squeeze; light incidental contact
  retains the existing severity behavior.
- Cars return smoothly to ideal mode after a resolved corner.
- Corner-rights characterizations run in acceptance mode; priority
  characterizations remain in baseline mode.

### Phase 12 — Formalize blue flags and qualifying flying-lap priority

Primary ownership: session/racecraft/priority.ts, paths.ts and traffic.ts.

1. Detect priority independently from the normal one/two-ahead braking
   reference:
   - qualifying phase is canonical rather than inferred ad hoc: pit exit to
     the first start-line crossing is out; a timed lap from that crossing is
     flying and may remain flying across consecutive timed laps; committing
     to the pits changes it to in until pit entry; the legacy lapLive façade
     is true exactly in flying and boxArm forwards the existing pit commitment;
   - blue flag: an active racing-surface car is at least one completed lap
     behind an approaching car;
   - qualifying: the beneficiary is on a flying lap and the car ahead is on an
     out lap or an in lap;
   - require a closing trend or a bounded hard-proximity case, so unrelated
     cars elsewhere on the circuit do not create state.
2. Acquire a persistent priority/yield record early enough to plan a move.
   Define bumper gap as the wrap-aware free distance from the beneficiary's
   front to the yielding car's rear. Filter its decrease with a 1.0 s
   exponential time constant at the traffic cadence; before one second of
   history, use beneficiary speed minus yielding-car speed. Compute
   time-to-catch as gap / max(0.5, filtered closing). Initial gates are:
   - blue flag: gap is at most 120 m and either filtered closing is at least
     0.5 m/s with time-to-catch at most 4.0 s, or gap is at most 55 m and the
     pair is not opening faster than 1.0 m/s;
   - qualifying: gap is at most 180 m and either filtered closing is at least
     0.5 m/s with time-to-catch at most 5.0 s, or gap is at most 75 m and the
     pair is not opening faster than 1.0 m/s;
   - multiply the outer distance, hard-proximity distance and time windows by
     1 + 0.25 * Session.wet; keep the closing thresholds unchanged.
   Phase 13 may tune these values, but fixed proximity must not be the only
   trigger and all phase acceptance bounds remain hard.
3. Select behavior from track phase:
   - on a straight, the yielding car leaves the ideal line early, holds one
     predictable side, and lifts only as much as needed;
   - before a braking zone, it avoids crossing the beneficiary's planned
     turn-in path;
   - if already committed mid-corner, it holds its corridor through the apex
     and clears the ideal line at track-out;
   - on an in lap already committed to pit entry, it keeps the authored pit
     path while the flying/lap-ahead car receives the road-side passing path.
4. While yielding:
   - cancel or suppress new attack, defense, lunge, and tow decisions for the
     yielding car;
   - do not force the priority car off the ideal line when a safe clear route
     exists;
   - retain predictive follow braking until the two lateral envelopes are
     actually separate;
   - never interpret the priority rule as permission to drive through an
     occupied side-by-side corridor.
5. Apply one explicit behavior-arbitration order:
   - incident recovery and pit/merge physical safety;
   - already-active corner-rights corridors;
   - blue-flag or qualifying priority;
   - normal attack, defense, tow, and following.
   This lets priority prevent a new battle while preserving predictable space
   if the cars are already alongside in a corner.
6. Release the record only when the beneficiary's rear bumper is at least
   2.0 m ahead of the yielding car's front bumper for 0.5 s, or when either car
   leaves the relevant active state. Do not release merely because lateral
   separation made the yielding car disappear from the normal traffic
   reference.
7. If another lap-ahead or flying-lap car is close behind, hand the yielding
   car directly to the next queued beneficiary. Do not return to the ideal
   line between them.
8. Do not grant special preference between two cars that are both on flying
   laps. They keep normal non-defensive qualifying traffic safety; the explicit
   yield requirement applies to out-lap/in-lap versus flying-lap cases.

Deterministic blue-flag matrix:

- catch on a straight, before braking, and mid-corner;
- left and right corners;
- dry and wet;
- lapped car already off line;
- lapped car preparing for pit entry;
- order/lateral-reference change during the pass;
- active corner-rights state at detection;
- two lap-ahead cars arriving in sequence.

Deterministic qualifying matrix:

- flying car catches an out-lap car;
- flying car catches an in-lap car;
- catch on a straight, before braking, and mid-corner;
- in-lap car already committed to pit entry;
- two flying cars approach the same non-flying car;
- both cars are on flying laps, which must not create a false yield;
- reference/order change while the flying car passes.

Phase acceptance:

- Every eligible catch creates exactly one priority record with the correct
  reason and beneficiary.
- The yielding car makes zero new attack, defense, or lunge decisions until
  release.
- The state survives lateral separation and order changes and releases only
  after physical clearance.
- Straight scenarios clear the ideal line before overlap; corner scenarios
  produce no path crossing, squeeze, hard contact, or off-course excursion.
- A flying-lap car's added loss versus the same clear-track scenario is at
  most 0.5 s for a straight catch and 1.0 s for a catch first detected in a
  corner. Record both rather than hiding them in an average.
- A lap-ahead race car completes the pass at the first safe opportunity, with
  no defensive response from the lapped car.
- Sequential beneficiaries pass without a return-to-line weave between them.
- Blue-flag and qualifying characterizations both run in acceptance mode.

### Phase 13 — Integrate, tune, and lock regression gates

1. Flip every remaining defect characterization to acceptance mode. Baseline
   mode remains available as historical evidence but is no longer part of the
   green gate.
2. Run the deterministic follow-up checks first; do not tune through a failing
   invariant.
3. Run bun run verify, including structural, boundary, unit, edge, UI, track,
   development-bundle, minified-bundle smoke and season tools.
4. Treat verify's season stage as the canonical full six-track dry/rain,
   three-seed matrix used by the prior racecraft task; rerun it after any
   tuning change rather than accepting a partial sample.
5. Preserve the existing racecraft bounds:
   - hits under 300 per race;
   - hard hits under 6;
   - zero soft-contact concedes;
   - healthy pass production;
   - side-by-side median at least 1.5 s and contact fraction under 20%;
   - valid classifications, finite state, and zero browser errors.
6. Add the new summary metrics:
   - ideal-line phase pass/total by track;
   - actual phase-marker trajectory error;
   - path-mode time and battle path diversity;
   - corner-rights acquisitions, violations, releases, and release reasons;
   - minimum actual separation during protected corners;
   - foreign-box false leaders and unintended pit wait time;
   - same-team queue and box-crossing wait reasons;
   - blue-flag activations, late detections, obstruction time, illegal
     defensive decisions, and release reasons;
   - qualifying out/in-lap yields, flying-lap time loss, path crossings, and
     queued beneficiaries.
7. Inspect debug captures at 1x. Fixed-step 8x stability is necessary, but it
   cannot replace visual review of approach, apex, track-out, or pit flow.
8. Record final parameter values, module graph, tool versions, bundle hash and
   size, test-API manifest, and the complete acceptance matrix in this document
   or a companion implementation report.

## Verification ownership

The source tree above is the canonical production-ownership map. Verification
is divided as follows:

- tests/unit/core/
  - math, physics, track, line, path, lap, autopilot and collision invariants;
  - frozen numeric parity during migration and semantic acceptance afterward.
- tests/unit/session/
  - pit occupancy/reservations, path arbitration, corner rights, priorities,
    state transitions and release reasons without a browser.
- tests/fixtures/parity/
  - immutable migration checksums/snapshots plus a manifest recording seeds,
    tolerances, source version and intended comparison mode.
- tools/check-module-boundaries.js
  - import layers, cycles, DOM contamination, inline scripts, suppressions and
    generated-artifact policy.
- tools/check-built-artifact.js
  - reject a missing/stale bundle for every browser-dependent raw runner;
  - in production mode, also reject a sourceMappingURL in the bundle.
- tools/racecraft-check.js
  - built-browser semantic line and actual trajectory checks.
- tools/racecraft-edge-check.js
  - preserve broad qualifying, pit, blue-flag, obstacle, and recovery coverage;
  - replace one-tick blue-flag assertions with complete detection-to-release
    passes;
  - verify out-lap and in-lap preference against flying-lap cars.
- tools/racecraft-followup-check.js
  - deterministic overlap/order/timer and multi-car scenarios;
  - foreign-box, same-team stack, and crossing scenarios;
  - blue-flag and qualifying priority arbitration scenarios;
  - explicit baseline and acceptance modes.
- tools/race-sim.js
  - aggregate new rights/path/pit/priority metrics without weakening existing
    gates.
- tools/run-browser-checks.js
  - one ordered entry for structural, track, edge, follow-up and UI checks;
  - call check-built-artifact.js before launching Playwright;
  - support --smoke --expect-production for both file:// entry paths, API boot,
    first render, source-map exclusion and console/page-error checks.
- tools/run-season-matrix.js
  - call check-built-artifact.js before launching any race process;
  - invoke race-sim.js for seeds 1, 2 and 3 in forced dry and forced rain;
  - aggregate all 36 races and fail on any Phase 13 bound.

index.html owns markup and inline CSS only. src/test-api.ts owns diagnostics and
the additive window.__GL surface. Feature tests import production TypeScript
only through public pure-module exports or exercise the built browser; they do
not reach private files to bypass a layer contract.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Externalizing the script changes boot or random-call order | Freeze API, fixed-tick, RNG and DOM fixtures first; switch to the IIFE atomically and block extraction on parity. |
| The temporary legacy shell becomes permanent | Allow one named shell only, prohibit feature edits there, track its shrinking size and make deletion a Phase 5 exit gate. |
| TypeScript migration hides defects by incidentally changing behavior | Run defect baseline mode after every extraction and forbid acceptance deltas before the owning feature phase. |
| Modules recreate the monolith through cycles or shared globals | Enforce the fixed layer graph, no mutable core/session singleton, a cycle scan and one composition root. |
| Session extraction reorders UI/audio effects | Use typed ordered events/ports and treat event order as parity, with one-responsibility rollback checkpoints. |
| Browser tools execute a stale bundle | Ignore dist, build before every public test command and reject an absent/outdated bundle in the browser runner. |
| file:// stops working after introducing ES modules | Bundle authored ES modules into one classic browser IIFE and smoke-test development and minified artifacts through file://. |
| Compatibility façades contaminate core types | Keep façades in test-api.ts only; renderer caches and mutable calendar views never enter Track/data authoring types. |
| Strictness is postponed indefinitely | Pin the final tsconfig now and make zero suppressions/implicit-any a hard gate before all behavior work. |
| Corner detection and line generation become circular | Use the explicit two-pass pipeline: centerline profile and semantic corners first, final line/profile second. |
| A strict out-in-out rule harms linked corners | Group complexes and validate declared compromise anchors rather than pretending every apex is isolated. |
| Dynamic target and speed model disagree | Derive offset, curvature, distance, and speed from the same path contract. |
| Pair states fight in a three-car pack | Run a corridor-feasibility allocation before applying pair targets; tuck the rearmost car when three-wide is infeasible. |
| Ignoring parked pit cars causes physical box collisions | Combine lateral occupancy filtering with later, low-speed ingress and explicit crossing reservations. |
| Pit reservations create a new deadlock | Stamp/expire claims, expose wait reasons, and test every box pairing with simultaneous ingress/egress. |
| A yielding car crosses the priority car in a braking zone | Choose the yield path from semantic corner phase; hold the current corridor through the apex when moving aside would be less safe. |
| Blue-flag or qualifying state disappears after lateral separation | Store beneficiary-keyed priority state outside normal braking-reference selection and release it only after physical clearance. |
| Several priority cars make the yielding car weave | Queue beneficiaries and hold one compatible yield path until the queue is clear. |
| Existing aggregate metrics hide the reported defects | Make deterministic phase, rights, and pit scenarios hard gates before season statistics. |
| A faster path is visually wrong | Treat lap time, semantic phase signs, actual trajectory, and visual overlay as independent gates. |

## Definition of done

The work is complete only when all of the following are true:

- package.json, bun.lock and tsconfig.json pin the documented toolchain and a
  clean bun install followed by bun run verify succeeds.
- index.html contains markup, CSS and one deferred dist/goldenlap.js reference,
  with no inline executable logic; golden-lap.html is a script-free redirect.
- All production logic lives in the documented TypeScript ownership tree with
  acyclic, boundary-checked imports.
- strict tsc reports zero errors, implicit-any sites or suppression directives;
  src/legacy-main.ts no longer exists.
- Core/session code has no DOM, Canvas, Audio, window, document or GameState
  singleton dependency; UI owns no simulation or classification rule.
- Development and minified bundles boot through file:// from index.html, the
  old golden-lap.html entry still redirects successfully, window.__GL is
  installed before the first frame, and the frozen migration parity suite
  passes.
- dist remains generated/ignored, and the static deployment package contains
  both root HTML files and the built bundle rather than relying on an
  uncommitted local artifact.
- Clean-air cars visibly and measurably open outside, touch or approach the
  inside apex, and unwind outside on every isolated corner across all tracks.
- Linked corners follow a documented complex plan with no contradictory
  anchors.
- Attack, defense, inside, and outside modes are phase-varying paths rather
  than one fixed line plus a scalar translation.
- Cars overlapping in the braking zone receive stable inside/outside rights
  that survive sorting and timer changes through track-out.
- A stopped rival in a non-overlapping pit box never becomes a moving-lane
  leader; same-team queues and real crossings still wait safely.
- Lapped cars recognize lap-ahead traffic, make no defensive move, give way on
  a predictable path, and remain in blue-flag yield state until the faster car
  is physically clear.
- Qualifying cars on out laps or in laps give the racing line and preference to
  flying-lap cars, including through reference/order changes and pit-entry
  preparation.
- The deterministic defect scenarios, existing edge checks, UI checks, and
  complete dry/rain season matrix all pass without weakening prior safety,
  contact, classification, or the new build/deployment guarantees.
