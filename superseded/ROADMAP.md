# Golden Lap — Polish Roadmap to 100%

Status baseline: the game is functionally complete and passes a full 6-round
automated season with no console errors, no teleporting (max positional jump
~1.4 m), correct classification, and a solvent economy. Everything below is
polish — none of it blocks play. Items are ordered by impact on the brief's
"believable racing" goal.

All work stays within the constraints in `task.md`: single-file vanilla
HTML/CSS/JS, no dependencies, no build step, session-only, retro style.

Verification harness lives in the scratchpad (`e2e.js`, `shots.js`,
`probe.js`, `geo.js`), driven by Playwright against `file://.../golden-lap.html`
with `window.__GL` as the test API. Re-run `e2e.js` after every change.

---

## P1 — Tame opening-lap and traffic contact  ★ highest impact

**Symptom.** At lights-out the field packs together and throws 3–4 "bang
wheels" incidents; a full race logs ~1700 light touches (≈23 hard). The brief
wants contact to "feel like an incident, not the normal way cars interact."

**Where.** `stepRacecraft()` (start-rush branch `S.t - S.goT < 7`), the
wheel-to-wheel "room rule" loop in `updateTraffic()`, and `collideCars()`
restitution in the CORE block.

**Approach.**
- Widen the standoff distance in the start-rush branch: raise the `vCap`
  follow gap and forbid lateral moves (`latTgt`) for the first ~5 s so cars
  hold grid columns instead of fanning into each other.
- In `updateTraffic()`, increase the lateral separation target in the room
  rule from 2.4 m and add a small hysteresis so two cars don't oscillate
  across each other every 1/30 s tick.
- Give `collideCars()` a longer post-contact `concedeT` (currently 0.8 s) and
  scale it by impact, so a real bang makes the following car back out for
  longer rather than immediately re-attacking.
- Consider a soft "personal space" steering bias (repel from the nearest car
  within ~4 m) applied in `stepEntry` before `botStep`, so avoidance happens
  through steering, not collision resolution.

**Acceptance.**
- Instrument `S.hitN` / `S.hitHard` (already added). Target a full race under
  **~400 total touches and <8 hard hits**, with the opening lap contributing
  no more than 1–2.
- Faster cars must still complete clean passes — verify overtakes still happen
  (log position changes between two mid-pack cars over 10 laps).
- No new stuck/oscillating states: keep max positional jump < 3 m in `e2e.js`.

---

## P2 — Verify the wet race end-to-end

**Symptom.** The automated season never rolled a wet race, so wet-tyre
crossover, drying track, and rain pit strategy are implemented but unobserved.

**Where.** `startRace()` rain scheduling (`S.rainAt`/`S.rainEnd`), `stepSession`
weather ramp, `tyreGrip()`, `rivalPitAI()`, `entryMargin()` wet terms.

**Approach.**
- Add a test hook: force `R.rainP = 1` (or set `S.rainAt`/`S.rainEnd` directly
  via `window.__GL`) and run a full race.
- Watch that rivals on slicks pit for wets when `S.wet` climbs, that lap times
  lengthen in the wet, and that the track visibly dries afterward.
- Confirm the "RAIN MASTER" driver trait actually reduces wet mistakes
  (`rollMistake` divides by wet for `trait === 'rain'`).

**Acceptance.**
- A forced-wet race finishes with a believable classification, at least some
  cars switching to wets, and no console errors.
- Add this as a permanent case in `e2e.js` (Round with rain forced on).

---

## P3 — Visual pass on Costa and Nordwald pit lanes

**Symptom.** Pit-lane geometry is validated for all three tracks (0 phantom
pockets, valid box positions), but only Prado's lane has been eyeballed in the
browser.

**Where.** `buildTrack()` `track.pit` block; `buildRender()` `pitLane` /
`pitWall` / `pitBoxes` / `boxPads` paths.

**Approach.**
- Extend `shots.js` to capture the pit area of Costa (`trk:1`) and Nordwald
  (`trk:2`) during qualifying, camera framed on a car in the lane.
- Check the lane sits flush against the road, boxes don't clip scenery, and the
  entry/exit ramps merge cleanly given each track's local curvature near the
  start line. Nordwald is longest and tightest — most likely to need a tweak.

**Acceptance.**
- Screenshots of all three pit lanes look integrated (no floating lane, no lane
  crossing the racing surface, boxes on the paved apron).

---

## P4 — Mobile ops-card pace button clipping

**Symptom.** On a ~390 px screen the pace segment renders "SAVE RACE PUS" —
the PUSH label is clipped in the narrow ops card.

**Where.** `.opcar` / `.seg button` CSS under the `@media (max-width:760px)`
block; ops panel markup in `buildOpsPanel()`.

**Approach.**
- Shrink the pace-button font/padding on mobile, or shorten labels to
  `SAVE / RACE / PUSH` icons/initials on very narrow widths, or let the pace
  segment wrap above the PIT button.

**Acceptance.**
- At 360–414 px width all three pace labels are fully legible and the PIT
  button remains tappable.

---

## P5 — Hairpin road-shadow smear (pre-existing cosmetic)

**Symptom.** Where the track passes close to itself (hairpins), the road's own
drop-shadow fill (`rgba(38,32,52,0.17)`, offset (2.4, 3.6), even-odd) overlaps
and darkens a patch of grass. Confirmed via `probe.js`; predates this work.

**Where.** `render()` road-shadow pass (the translated `ctx.fill(rd.road,
'evenodd')` before the road itself).

**Approach (pick one).**
- Clip the shadow fill to the road ring so it can't bleed onto grass between
  passes, or
- Reduce shadow alpha / offset at tight sections, or
- Bake the shadow into a per-track prerender that respects self-overlap.

**Acceptance.**
- No visible dark blob on grass at hairpins on any track; road still reads as
  raised. Purely cosmetic — lowest priority.

---

## Nice-to-have (beyond the identified gaps)

- **Fastest-lap purple** highlight in the timing tower (data already tracked in
  `e.best`; `compileResults` already tags the fastest lap in notes).
- **Sector/gap-to-leader** interval refinement on mobile if space allows.
- **Reduced-motion** audit of the new banners/confetti already respects
  `REDUCED`; double-check quali transitions.

## Definition of done for "100%"

1. `e2e.js` passes including the new forced-wet race case.
2. Full-race contact within the P1 targets, overtakes still occur.
3. All three pit lanes visually verified.
4. Mobile ops card legible at 360 px.
5. No hairpin shadow smear.
6. No console errors anywhere in a full season on desktop and mobile viewports.
