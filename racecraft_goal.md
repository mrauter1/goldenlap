# Golden Lap — Racecraft Goal Brief

*Hand-off brief for the implementing agent. Read this first, then follow
`racecraft_task.md` (code-level spec, phase by phase). Background analysis
lives in `racecraft_plan.md`.*

## Objective

Improve the driver AI of Golden Lap — a single-file, vanilla HTML/CSS/JS
racing team-management game (`index.html`, ~3.8k lines) — so that:

1. Cars drive a **real racing line** (out–in–out through corners), not the
   track centerline.
2. **Side-by-side racing works**: two cars can run alongside through corners
   and sort it out at exit without grinding into each other.
3. **Attacking and defending look deliberate**: slipstream down a straight,
   move to the inside for the next corner, one covering move from the
   defender, corner rights when the attacker has overlap, tuck-back and
   retry when the move fails.
4. **Hard requirement (user-reported bug): small side-by-side touches or
   bumps must not make either car overslow.** Today a feather-light brush
   triggers a compounding speed penalty that visibly parks the slower car.

The goal is *believable* racing, not sterile racing: contact should feel
like an incident, occasional mistakes and light bangs are welcome — but
contact must never be the default way cars interact, and never a hidden
brake.

## How the sim works (orientation)

Everything is in `index.html`. The core (marked `CORE BEGIN`/`CORE END`) is
game-layer-agnostic and must stay that way:

- `speedProfile(track)` (~line 578) — curvature-limited speed profile,
  computed **on the centerline**. There is currently no racing line.
- `botStep(track, prof, car, prm)` (~831) — pure-pursuit driver: chases a
  lookahead point offset laterally by `prm.lat`, brakes for the profile
  ahead scaled by `prm.margin`, obeys `prm.vCap`.
- `stepCar` (~685) — bicycle-model physics. Don't touch.
- `collideCars(list, R)` (~877) — car-vs-car contact, **one circle of
  radius 1.5 m per car** (cars are 5.4 × 2.0 m), impulse + positional split.

Game layer (browser-only IIFE):

- `stepSession(h)` (~2824) — fixed-step (1/120 s) session tick: steps each
  entry, runs collisions, applies post-contact effects.
- `updateTraffic(S)` (~2901, 30 Hz) — sorts cars by track position; each
  car reacts to the **one** car ahead via `stepRacecraft`, which sets
  `e.latTgt` (lateral offset target) and `e.vCap` (speed ceiling); a
  wheel-to-wheel "room rule" keeps alongside cars 2.4 m apart.
- `stepRacecraft(S, e, a, ds)` (~2962) — the per-pair brain: quali
  yielding, blue flags, start rush, attack/defend, following.
- `stepEntry` (~2633) — per-car tick; pit-lane states (`pitIn`/`pitOut`)
  override `lat` in centerline space. Qualifying and race share all of
  this.

Test API: `window.__GL` exposes the state and session functions headlessly.
`tools/race-sim.js` (Playwright + Node) already drives full seasons and
reports passes/hits/DNFs per race.

## Root causes to fix (verified in code)

1. **Followers can never match the leader's speed.** Every follow branch
   floors the cap above the car ahead:
   `e.vCap = a.spd + Math.max(0.8, (ds - 7) * 1.9)` and five similar sites.
   Cars creep into contact, get penalized, fall back, repeat — the sim logs
   ~1,700 touches per race.
2. **Collision geometry contradicts the room rule.** Circle collider
   touches at 3.0 m center distance, but side-by-side code targets 2.4 m
   lateral separation. Legitimate side-by-side running is *permanently in
   collision*.
3. **Post-contact penalty ignores severity and compounds.** Any impact sets
   `concedeT = 0.8` on the *slower* car (~2866); while active, the cap
   `vCap = max(6, spd − 2)` is recomputed from current speed every traffic
   tick (~2957), ratcheting the car down toward 6 m/s. This is the reported
   bug. Also the wrong car concedes: it should be the car behind, not the
   slower one.
4. **No racing line** → no inside/outside, so attack/defense have no
   geometric meaning and being off-line costs nothing.
5. **Off-line speed error**: a car cornering 2–3 m off center still uses
   the centerline speed profile, so the inside car carries too much speed
   and slides into its neighbour.
6. **No slipstream, corner-blind attacks, random defending, single-car
   awareness** (each car sees only the next car ahead in track order, even
   when that car is alongside rather than ahead).

## Deliverables (phases — implement in order)

Per `racecraft_task.md`:

- **Phase 0 — Instrumentation.** Add counters (`concedeSoftN`,
  side-by-side time/episodes) to the sim and surface them in
  `tools/race-sim.js`. Record a baseline table before any behavior change.
- **Phase 1 — Contact.** Two-circle capsule collider (lateral touch ≈ real
  2.0 m width); impacts below 2 are cosmetic; concede only at impact ≥ 4,
  duration scaled by impact, applied to the car *behind*, with a speed cap
  **latched once at contact** instead of ratcheting. Graze contacts stop
  damping velocity. *This phase alone must fix the reported bug.*
- **Phase 2 — Signed follow law.** One `followCap(e, a, ds, tGap)` helper
  that lets followers settle at the leader's speed at a real gap (may go
  below `a.spd`); replace all positive-floor sites.
- **Phase 3 — Racing line.** Precompute a curvature-minimizing lateral
  offset per track sample (`track.rline`; note `track.line` is already the
  start/finish segment), faded to the centerline around the pit corridor
  and the start line; build a speed profile on it (generalize
  `speedProfile` with an optional path); make `botStep` accept an optional
  path so traffic offsets become line-relative; scale allowed speed by
  offset-adjusted curvature so running off-line genuinely costs time. Pit
  lane, grid spawn, checkpoints, recovery stay in centerline space.
- **Phase 4 — Attack & defense.** Corner table from the line profile
  (braking point, apex, inside side); slipstream (drag reduction in the
  tow on straights); attackers target the inside of the upcoming corner
  with a committed move and occasional focus-gated late-braking lockups;
  corner rights (defender must leave a car's width if the attacker has
  overlap at the braking point; attacker tucks back if not); defender makes
  one deliberate inside-covering move per window — no weaving.
- **Phase 5 — Side-by-side polish.** Room rule to 2.6 m with hysteresis;
  at corner exit the car more than half a car behind yields into the tow —
  no speed dump.
- **Phase 6 — Start + awareness.** Hold grid columns for the first ~4 s
  with a wide follow gap and no attack moves; two-cars-ahead awareness with
  lane-overlap braking reference.
- **Phase 7 — Retune.** Full dry+rain harness matrix; tune only the listed
  knobs; append final numbers to `racecraft_task.md`.

## Hard constraints

- `index.html` remains a **single file, vanilla JS, no dependencies, no
  build step**; session-only (no persistence); retro visual style intact.
- Dev tooling only in `tools/` (Node + Playwright already used there).
- Do not break: pit-lane flow, qualifying (out/hot/in laps, yielding),
  blue flags, rain races, wear/fuel/pace systems, the `window.__GL` API,
  mobile layout, or 4×/8× time-scale stability.
- Keep core functions headless-usable: extend signatures with optional
  parameters; no `G`/`S`/DOM access inside CORE.
- Fixed-step determinism: physics at `H_STEP = 1/120`, traffic at
  `TRAF_DT = 1/30`. Don't change these frequencies.

## Testing protocol

1. **Baseline first** (Phase 0): `node tools/race-sim.js` — all six rounds
   dry, then `--rain`. Requires `npm i playwright` and a Chromium install
   (`npx playwright install chromium`). Record the metrics table.
2. **After every phase**: re-run the harness; compare against the phase's
   acceptance numbers in `racecraft_task.md`; walk the edge-case checklist
   there (pit lanes on all six tracks, quali yield, blue flags, crawling
   cars, recovery, 8× stability).
3. **Manual checks** where the spec says so: watch battles at 1× in a real
   browser (open `index.html`, pick a team, race). Racecraft quality is
   partly aesthetic; the harness numbers are necessary, not sufficient.
4. No console errors anywhere, ever — the harness exits nonzero on any.

## Acceptance criteria (final)

- **Bug fixed:** zero concede/slow-down events from impacts below the
  severity gate (`concedeSoftN = 0`); a light side-by-side brush costs
  neither car more than ~2 m/s momentarily.
- Contact: **< 300 total touches, < 6 hard hits per race** (baseline
  ~1,700 / ~23); opening lap ≤ 2 hard hits; no first-corner pileups.
- Racing line: line lap time ≤ centerline lap time on all six tracks;
  visible out–in–out at tight corners (debug overlay + screenshots).
- Overtaking: ≥ 8 clean passes per race on average across a season; passes
  emerge from tow → inside move → corner, not from collisions.
- Side-by-side: median episode ≥ 1.5 s; < 20% of episodes end in contact;
  exits resolve with the loser tucking in, unharmed.
- Defense: at most one covering move per attack window; no weaving.
- Full season (quali + race × 6, dry and forced rain) completes with valid
  classifications, sane DNF counts (0–5 per race), and zero console errors,
  at 1×, 4× and 8×.
- All previously green harness checks stay green.

## Judgment calls you may make

Parameter values in `racecraft_task.md` are starting points — tune them
against the harness, one knob at a time, and document final values. If a
phase's approach conflicts with something you find in the code that this
brief missed, prefer the *intent* stated here, keep the change minimal, and
note the deviation in `racecraft_task.md`. If passes collapse below target
after Phase 2, fix it by tightening the attack follow gap before touching
anything else. When in doubt between "sterile but safe" and "lively but
believable", choose lively: the brief's product bar is racing that *reads*
like racing.
