# Golden Lap — Better Roadmap

Supersedes `ROADMAP.md`. Reviewed 2026-07-09 against the current source
(`golden-lap.html`, 3,579 lines) and the brief (`task.md`).

## What changed vs the old roadmap, and why

1. **The verification harness no longer exists.** The old roadmap's acceptance
   criteria all depend on scratchpad scripts (`e2e.js`, `shots.js`, `probe.js`,
   `geo.js`) that were deleted with the session that created them. Even the
   baseline claim ("passes a full 6-round season, max jump ~1.4 m, solvent
   economy") is currently unverifiable. Rebuilding the harness **as versioned
   files in this repo** is now the first item (P0); nothing that touches the
   simulation should land before it.
2. **The old P1–P5 survive review.** I spot-checked every code reference in the
   old roadmap against the source (the 0.8 s `concedeT` at the collision
   handler, the 2.4 m room rule in `updateTraffic()`, the `S.t - S.goT < 7`
   start-rush branch, `S.rainAt`/`S.rainEnd` scheduling, the 760 px media
   block, the even-odd road-shadow fill). All are accurate. Those items carry
   over with their approaches intact, renumbered P1–P5 below.
3. **Three gaps vs the brief were added** (G1–G3): the mobile timing tower
   drops the LAST/BEST columns the brief explicitly requires, tuning is
   team-scoped in a way the UI never explains, and the fastest-lap highlight
   is promoted from "nice to have" because the data already exists and it is
   nearly free.
4. **One old concern was closed during review:** the brief's worry about the
   weather UI misleading players in qualifying is already handled — the quali
   and race sheets both label the forecast "Race-day forecast", and
   `stepSession()` documents that qualifying runs dry by design. No work item.

## Constraints (unchanged)

The **game** stays a single-file vanilla HTML/CSS/JS artifact: no
dependencies, no build step, session-only, retro style, playable on desktop
and mobile. The **repo** may now also contain dev-only tooling (P0) — test
scripts never referenced by `golden-lap.html` itself.

## Sequencing

```
P0 (harness + baseline)  →  P1 (contact)  →  P2 (wet verification)
                          →  P3, P4, P5, G1, G2, G3   (independent, any order)
```

P2 runs after P1 because P1 changes traffic dynamics and would invalidate a
wet-race sign-off done before it. Everything else is independent once P0 is in.

---

## P0 — Check the verification harness into the repo  ★ do this first

**Why.** Every acceptance criterion below is defined in terms of automated
observation. The scripts that did this observing are gone; until they are
recreated *inside the repo*, the roadmap is a list of unverifiable claims.

**Where.** New `tools/` directory next to `golden-lap.html` (dev-only; the
game file does not reference it). Driven by Playwright against
`file://…/golden-lap.html` using the existing `window.__GL` test API, which
already exposes `G`, `S`, `CALENDAR`, `pickTeam`, `sheetAction`, `qualiSend`,
`qualiBox`, `qualiEnd`, `startRace`, `setScale`, `startWeekend`,
`compileResults`, and `raceLapsFor` — enough to drive a full season headless.

**Contents.**
- `tools/e2e.js` — full 6-round season at high speed. Asserts: no console
  errors; no teleporting (max per-tick positional jump < 3 m); valid
  classification every round (no duplicate/missing positions); economy never
  hard-locks the player; season-end screen reachable.
- `tools/e2e.js` wet case — force rain by setting
  `__GL.CALENDAR[G.round].rainP = 1` before `startRace()` (works today, no
  game change needed) and run a full race. See P2 for what it must assert.
- Contact metrics — read `S.hitN` / `S.hitHard` (already instrumented in
  `stepSession()`) at race end and report them; P1 turns the report into an
  assertion.
- `tools/geo.js` — pit-lane geometry probe for all three tracks: box positions
  on the paved apron, no phantom pockets, entry/exit ramps connected.
- `tools/shots.js` — screenshot capture: each track's pit area during a
  session, the mobile viewport (390 px) ops card and timing tower, a hairpin
  close-up per track. These are the evidence for P3/P4/P5/G2.
- `tools/README.md` — one-paragraph run instructions (`npx playwright …`).

**Acceptance.**
- `node tools/e2e.js` passes from a fresh checkout (given Playwright
  installed) and prints the contact metrics.
- The first passing run is recorded in this file as the new baseline, so
  later regressions are attributable.

---

## P1 — Tame opening-lap and traffic contact  ★ highest gameplay impact

**Symptom.** At lights-out the field packs together and throws 3–4 "bang
wheels" incidents; a full race logs ~1700 light touches (≈23 hard). The brief
wants contact to "feel like an incident, not the normal way cars interact."
(Numbers are from the pre-harness-loss baseline; P0 re-measures them first.)

**Where.** `stepRacecraft()` (start-rush branch `S.t - S.goT < 7`), the
wheel-to-wheel room rule in `updateTraffic()` (2.4 m separation targets), and
`collideCars()` restitution / the fixed 0.8 s `concedeT` applied in
`stepSession()`'s hit loop.

**Approach.**
- Start rush: raise the `vCap` follow gap and suppress lateral moves
  (`latTgt`) for the first ~5 s so cars hold grid columns instead of fanning
  into each other.
- Room rule: widen the 2.4 m lateral separation target and add hysteresis so
  two cars don't oscillate across each other every `TRAF_DT` tick.
- Post-contact: scale `concedeT` by impact (`hh.imp`) instead of the flat
  0.8 s floor, so a real bang makes the trailing car back out longer rather
  than immediately re-attacking.
- If those aren't enough: a soft "personal space" steering bias (repel from
  the nearest car within ~4 m) applied in `stepEntry` before `botStep`, so
  avoidance happens through steering rather than collision resolution.

**Acceptance (asserted by the P0 harness).**
- Full race: **< ~400 total touches, < 8 hard hits**, opening lap contributing
  no more than 1–2 hard hits.
- Overtakes still happen: log position changes between two mid-pack cars over
  10 laps and assert at least one clean pass.
- No new stuck/oscillating states: max positional jump stays < 3 m in e2e.

---

## P2 — Verify the wet race end-to-end

**Symptom.** No automated season has ever rolled a wet race, so wet-tyre
crossover, the drying track, and rain pit strategy are implemented but
unobserved.

**Where.** `startRace()` rain scheduling (`S.rainAt`/`S.rainEnd`),
`stepSession()` weather ramp (`S.wet` ±), `tyreGrip()` (wets beat slicks past
the crossover), `rivalPitAI()`, `entryMargin()` wet terms, and `rollMistake()`
for the RAIN MASTER trait.

**Approach.** Use the P0 forced-rain hook (`CALENDAR[round].rainP = 1`) and
run a full race after P1 has landed. Watch that rivals on slicks pit for wets
as `S.wet` climbs, lap times lengthen in the wet, the track visibly dries
afterward, and the `trait === 'rain'` driver makes measurably fewer wet
mistakes.

**Acceptance.**
- The forced-wet race finishes with a believable classification, at least
  some cars switching to wets, and no console errors.
- The case is permanent in `tools/e2e.js` — every future run covers rain.

---

## P3 — Visual pass on Costa and Nordwald pit lanes

**Symptom.** Pit geometry passes the numeric probe on all three tracks, but
only Prado's lane has been eyeballed in a browser.

**Where.** `buildTrack()` `track.pit` block; `buildRender()` `pitLane` /
`pitWall` / `pitBoxes` / `boxPads` paths.

**Approach.** Use `tools/shots.js` (P0) to frame a car in the lane at Costa
(`trk:1`) and Nordwald (`trk:2`) during qualifying. Check the lane sits flush
against the road, boxes don't clip scenery, and entry/exit ramps merge
cleanly given local curvature near the start line. Nordwald is longest and
tightest — most likely to need a tweak.

**Acceptance.** Screenshots of all three pit lanes look integrated: no
floating lane, no lane crossing the racing surface, boxes on the paved apron.

---

## P4 — Mobile ops-card pace button clipping

**Symptom.** On a ~390 px screen the pace segment renders "SAVE RACE PUS" —
the PUSH label clips in the narrow ops card.

**Where.** `.opcar` / `.seg button` CSS in the `@media (max-width:760px)`
block (line ~201); ops markup in `buildOpsPanel()`.

**Approach.** Shrink pace-button font/padding on mobile, or shorten labels on
very narrow widths, or let the pace segment wrap above the PIT button.

**Acceptance.** At 360–414 px all three pace labels are fully legible and PIT
stays tappable. Evidence: the P0 mobile screenshot.

---

## P5 — Hairpin road-shadow smear (cosmetic)

**Symptom.** Where the track passes near itself, the road's drop-shadow fill
(`rgba(38,32,52,0.17)`, offset (2.4, 3.6), even-odd) overlaps and darkens a
patch of grass. Pre-existing.

**Where.** `render()` road-shadow pass — the translated
`ctx.fill(rd.road, 'evenodd')` before the road itself.

**Approach (pick one).** Clip the shadow fill to the road ring; or reduce
shadow alpha/offset at tight sections; or bake the shadow into a per-track
prerender that respects self-overlap.

**Acceptance.** No dark blob on grass at hairpins on any track (P0 hairpin
screenshots); road still reads as raised. Lowest priority.

---

## G1 — Explain (or fix) team-scoped tuning  *(new — brief §10)*

**Symptom.** Tuning lives on `G.tune` (created per-weekend in
`startWeekend()`) and one shared `G.tune.bonus` is added to **both** player
cars in `entryMargin()`. The brief permits team-attached tuning, but requires
that "the player should understand what the tuning work improved and why" —
today nothing in the tune UI says the setup work applies to both cars, and a
player reasoning in the new independent-car model will assume it is per-car.

**Where.** `G.tune` in `startWeekend()`, `doTune()` / `tuneBonusRecalc()`,
`renderTuneArea()`, `entryMargin()`.

**Approach (cheap first).** Add one line of copy to the tune area: setup work
is a team program applied to both cars this weekend. Optionally (larger):
split tune points per car. Recommend the copy fix only — per-car tuning
doubles a minigame that is deliberately lightweight.

**Acceptance.** The tune UI states the scope of the bonus; no mechanical
change required.

---

## G2 — Mobile timing tower drops LAST/BEST  *(new — brief §7)*

**Symptom.** The brief's timing-panel requirements include latest lap and
fastest lap. The 760 px media block hides both columns
(`.trow .lp,.trow .bp{display:none}`), leaving position/driver/gap only. The
brief does let mobile "prioritize legibility", so this may be a deliberate
trade — but it's currently an undocumented one that fails a literal reading
of the acceptance goals.

**Where.** `@media (max-width:760px)` tower rules; row markup in the tower
build (`.gp` / `.lp` / `.bp` spans).

**Approach.** Cheapest compliant option: on mobile, alternate the single
right-hand column between GAP and LAST every few seconds, or show LAST for
the focused/player rows only. Avoid widening the tower — 172 px is already a
quarter of a 390 px screen.

**Acceptance.** On a 390 px viewport the player can see their drivers' latest
lap without leaving the race view; tower width unchanged; P0 mobile
screenshot as evidence.

---

## G3 — Fastest-lap purple in the timing tower  *(promoted from nice-to-have)*

`e.best` is already tracked per entry and `compileResults()` already tags the
race's fastest lap in the notes — this is a render-only change in the tower
update path (`.bp` cell) plus one CSS rule. High visibility for near-zero
risk, which is why it's promoted from the old roadmap's nice-to-have list.

**Acceptance.** The current session-fastest lap's BEST cell renders in the
accent/purple style on desktop; updates live when beaten.

---

## Dropped / closed

- **Weather-forecast framing in qualifying** — already correct in the code
  (forecast labelled race-day; quali runs dry by design). Closed on review.
- **Sector/gap interval refinement on mobile** — superseded by G2, which
  addresses the same screen with a concrete requirement from the brief.
- **Reduced-motion audit** — kept as a one-line check inside P0's e2e run
  (banners/confetti already respect `REDUCED`; assert quali transitions do
  too) rather than a standalone item.

## Definition of done for "100%"

1. `tools/` harness exists in the repo and `e2e.js` passes from a fresh
   checkout, including the permanent forced-wet case (P0, P2).
2. Full-race contact within P1 targets, with overtaking still observed.
3. All three pit lanes visually verified via checked-in screenshots (P3).
4. Mobile at 360–414 px: ops card legible (P4) and latest-lap visible in the
   tower (G2).
5. No hairpin shadow smear (P5); fastest lap highlighted (G3); tune scope
   explained (G1).
6. No console errors anywhere in a full season on desktop and mobile
   viewports.
