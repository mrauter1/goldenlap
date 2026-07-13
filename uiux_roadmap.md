# Golden Lap — UI/UX Roadmap: "10× more fun", not more complex

> **STATUS (2026-07-10): fully implemented, including the auto-director** —
> a TV toggle in the race topbar: the camera hunts the closest battle
> (weighted toward the front), preempts to spins/crashes/hard contact, falls
> back to pit stops or the leader, and holds shots ~7 wall-clock seconds so
> 4×/8× stays watchable. Clicking a driver or grabbing the camera hands
> control back. Verified via race-sim (0 errors), a headless quali session,
> a live 8× director run (3 clean cuts in 20 s, click-to-follow disables),
> and desktop + mobile screenshots. Deviations: the desktop tower widened
> 288→344 px to fit the tyre column; mobile shows position + tyre pip +
> name + interval (as §layout-budget specified, resolving better_roadmap
> G2); the fastest-lap highlight also landed (G3).

Companion to `better_roadmap.md`. Analyzed 2026-07-09 against the current
source. Scope: presentation and decision-support only — no new simulation
mechanics.

## The core insight

The simulation already models almost everything a race strategist would want
to know, **deterministically**, and then hides it:

- Tyre life is a closed formula: softs last `0.30 × race laps`, hards
  `0.55 ×`, scaled by pace (`PACE_WEAR = [0.7, 1, 1.42]`) and the TYRE-trait
  driver (×0.8). The game knows exactly how many laps a set has left — the
  player sees only a shrinking bar.
- Rain is **scheduled at lights-out**: `S.rainAt` / `S.rainEnd` are fixed in
  `startRace()`. A perfectly honest forecast is free — the player currently
  gets a one-word chip ("DRY") that flips to "RAIN!" with zero warning.
- Gaps, battles (`e.battle` is already computed every traffic tick), pit-lane
  time loss (`pit.limit`, lane length, `pitTime()`), fuel-laps remaining —
  all sitting in state, none surfaced.

So the player is *watching* a strategy game rather than *playing* one: they
can't plan a stop, anticipate rain, or judge whether a pass is developing.
The 10× fun lever is **turning hidden state into decisions the player can
see coming**. Every item below is a read-out or a highlight, not a mechanic.

Fun model for prioritization: **anticipation** (I can see it coming) →
**agency** (I chose) → **consequence** (I can tell my choice mattered).
Items are ranked by how much of that loop they unlock per line of code.

---

## Tier 1 — strategy becomes visible (do these first)

### 1.1 Interval to car ahead in the timing tower  *(user ask)*

**Now:** the GAP column shows delta to leader only (`updateRaceHUD()`,
`dp = leader.prog - e.prog`). Mid-race the player can't tell if P5 is
catching P4 — the single most dramatic number in racing.

**Change:** compute the same `prog` delta against `ordered[i-1]` instead and
show interval by default; keep gap-to-leader on the leader row ("LEAD") and
on hover/desktop as a secondary. An interval that **shrinks lap after lap is
a story**; a gap to leader is a spreadsheet.

**Cost:** tiny — same conversion already used (`dp / max(28, e.spd)`).
Bonus: tint the interval green when it shrank since last lap (store previous
interval per row), so closing battles pop out of the tower at a glance.

### 1.2 Tyre compound + age in the timing tower  *(user ask)*

**Now:** tyre state is invisible for all 10 rivals; `rivalPitAI()` decisions
look random. Undercuts/overcuts can't be read at all.

**Change:** add a slim column: compound letter on a colored pip (S red /
H sky / W blue — match the retro palette) + laps on the set. Needs one new
field: stamp `e.tyre.fit = e.cross` in `servePit()`, `pitLaunch()` and at
race start; age = `e.cross - e.tyre.fit`. Suddenly "P3 is on 20-lap softs
and I'm on fresh hards" is a readable, plannable situation — that sentence
*is* the strategy game.

**Mobile:** pip only (no age number) — 12 px, fits the 172 px tower.

### 1.3 Rolling weather forecast  *(user ask)*

**Now:** `R.rainP` is shown as pre-weekend text, then the race gives zero
warning. Rain arriving unannounced feels arbitrary; rain you can see coming
three laps out is the best strategy moment in the game.

**Change:** since `S.rainAt`/`S.rainEnd` are fixed, render a forecast in the
topbar weather chip, expressed in laps (players think in laps, not minutes:
divide by `S.prof.lapTime`):
- Beyond ~20 sim-minutes out: fuzzy — "RAIN EXPECTED ~L14" (round to ±2
  laps so it still feels like a forecast, not an oracle).
- Inside ~5 minutes: countdown — "RAIN IN 3 LAPS", chip pulses.
- While raining: "DRYING ~L22" using the known `S.rainEnd` + the drying rate
  (`-0.018/s` on `S.wet`), so the slicks-gamble moment is plannable too.

**Cost:** small; pure display of existing schedule. This single chip creates
the pit-window mind-game the whole tyre system was built for.

### 1.4 Tyre life expectancy + degradation on the ops card  *(user ask)*

**Now:** the TYRE bar shows `1 - wear` with no units. Players can't answer
the only question that matters: *does this set make it to the flag?*

**Change:** the exact laps-left is already computable from the sim's own
formula: `lifeLaps` (per compound, from `stepEntry`) and
`lapsLeft = (1 - wear) × lifeLaps / PACE_WEAR[pace]`. Show on the bar:
`TYRE S · 12 LAPS · ~8 LEFT`. When `lapsLeft < lapsToFlag`, tint the label
amber — an ambient "you will need to stop" signal with zero extra UI. The
per-lap deg number itself can stay hidden; "laps left at current pace" *is*
degradation-per-lap, in the unit players actually reason in — and because it
uses `PACE_WEAR[pace]`, switching SAVE/RACE/PUSH visibly moves the estimate,
which finally makes the pace buttons feel consequential.

### 1.5 Fuel in laps, not a bar

Same logic as 1.4: burn rate is deterministic
(`1/(S.laps × lapT × 1.3) × PACE_FUEL[pace]`), so show `FUEL · 21 LAPS` and
go amber when it won't reach the flag. Running dry currently arrives as a
total surprise ("OUT OF FUEL — crawling home") — with this it becomes a
choice the player made by staying on PUSH.

### 1.6 Pit-stop cost + rejoin projection in the pit menu

**Now:** "CONFIRM — BOX THIS LAP" gives no idea what the stop costs. Pit
timing is the game's central decision and it's taken blind.

**Change:** the menu already knows everything: lane traversal
(lane length at `pit.limit` vs racing that distance) + `pitTime()` expected
service. Show `COST ~24s` and, one step better, scan `S.order` progs to show
`REJOIN ~P9, BEHIND KOV` — that's `prog - 24s × speed` compared against the
field, ~10 lines. This converts every stop from a leap of faith into a
gamble the player understands — and makes the undercut *discoverable*.

---

## Tier 2 — the race tells its story

### 2.1 Battle highlighting in the tower

`e.battle` is already set for cars within ~15 m. Draw a thin accent bracket
linking adjacent tower rows that are in a battle. The tower stops being a
list and starts being a war map: the player sees *where the race is
happening* and can click straight into it (rows are already click-to-follow).

### 2.2 Position-change arrows

Store position at lap start; show `▲2`/`▼1` beside the position number,
fading a few seconds after each change. Momentum becomes visible — charging
drivers and fading tyres are readable without reading numbers. (Race only;
cheap; pairs with 2.1.)

### 2.3 Fastest-lap purple + personal-best green

Already in `better_roadmap.md` as G3 — folded into this tier: purple the
session-best BEST cell, and flash a row's LAST cell green when it's a
personal best. The flash is what makes a driver "coming alive" on fresh
tyres legible in the corner of the eye.

### 2.4 Per-part CAR readout

**Now:** the CAR bar shows `minRel(e)` — worst of engine/suspension/body,
unlabeled. Players can't tell *what* is failing or whether a PATCH (+3.5 s)
is worth it.

**Change:** split the bar into three slim segments (E / H / C) from
`e.rel`. When suspension is failing (`hFail`), the H segment goes red and
the pit menu's PATCH row shows what it will fix. Reads in the same
footprint; makes reliability a visible risk dial instead of a mystery DNF.

### 2.5 Race ticker upgrades

The toast feed already narrates well. Two cheap upgrades: prefix each toast
with the lap number (`L14 · KOV spins!`), and when a toast concerns a
followable car, make it clickable to jump the camera there. Drama becomes
navigable.

---

## Tier 3 — qualifying becomes a game of timing

Qualifying has the right bones (live session, out/hot/in laps, traffic
yielding) but gives the player nothing to time their runs *with*.

### 3.1 "Time for N more runs" indicator

Out lap + flying lap + in lap ≈ `3 × prof.lapTime`. Show on each garage
card: `TIME FOR 2 RUNS` → `LAST CHANCE — SEND NOW` → `NO TIME`. This is the
entire tension of a quali session, computed from two numbers the game
already has.

### 3.2 Track-clear advisory on SEND OUT

Count cars within ~1 out-lap of the pit exit and their state: button
subtitle reads `TRACK CLEAR` / `TRAFFIC — 3 CARS MID-LAP`. Mistiming a
release into traffic stays possible (that's the game); doing it blind stops
feeling unfair.

### 3.3 Live delta on the flying-lap status

**Now:** `FLYING · 42.1` (elapsed only). The one thing a fan watches in
quali is the delta. There are no sector times, but the lap-validity
checkpoints (`lap.nextCp` advancing through `track.cps`) are perfect
mini-sector marks: record timestamps per checkpoint on the car's best lap,
compare on the current lap, show `FLYING · −0.24`. Green/red per update.
This is the only Tier-3 item needing new data (one array per entry), and it
makes every hot lap watchable to the end.

### 3.4 Projected grid slot

While a player car is on a hot lap, show `ON PACE FOR P3` (compare live
delta-adjusted best against `S.order`). Cheap once 3.3 exists; turns the
last two minutes of quali into theatre.

---

## Tier 4 — moments & juice (small, high-charm)

- **Rain transition:** when the forecast chip hits zero, brief full-screen
  darkening + the existing rain render ramps in. The moment deserves more
  than a toast. (Respect `REDUCED`.)
- **Post-race highlights card:** `compileResults()` already collects notes,
  stops, grid vs finish. Add three lines to the results sheet: biggest
  climber, fastest lap, most stops. Gives every race a headline even when
  the player finishes P8.
- **Auto-director (optional toggle):** when following no one specific, cut
  the camera to the best `e.battle` pair, incidents, and pit entries.
  Makes 8× speed watchable as a highlights reel instead of ant-farming.
  Largest item on this list — keep last.

---

## Layout budget (where it all fits)

- **Topbar:** forecast lives inside the existing `#tWx` chip (1.3) — no new
  chip on mobile, extended text on desktop.
- **Tower (desktop):** one new column (tyre pip + age, 1.2), interval
  replaces gap (1.1), brackets/arrows are overlays (2.1/2.2) — width grows
  ~30 px.
- **Tower (mobile, 172 px):** position, pip, name, interval. Nothing else.
  This also resolves `better_roadmap.md` G2 (LAST/BEST on mobile) — the
  interval + pip carry more information per pixel than lap times; keep
  LAST/BEST to the player's own ops cards.
- **Ops card:** all Tier-1 additions are relabels of existing bars (1.4,
  1.5, 2.4) or live inside the already-toggling pit menu (1.6). No new
  panels anywhere.

## Anti-goals (traps that add complexity, not fun)

- **No sector-time walls, telemetry graphs, or full strategy sheets** — the
  ops card + tower must stay glanceable; anything needing a pause to read is
  out of character for the game.
- **No new player verbs.** Tyre choice, pace, pit, send/box are enough; the
  entire roadmap makes those five decisions *informed*, not numerous.
- **No probabilistic forecast UI** (percentage meters, radar maps). One
  fuzzy-then-precise line of text is the retro-correct amount of weather
  tech for 1976.
- **Don't surface rival intent** (e.g., "KOV pitting next lap"). Reading
  rivals through their tyre age (1.2) is the fun; announcing it kills it.

## Suggested order of attack

1.3 forecast → 1.4/1.5 tyre & fuel laps → 1.1 interval → 1.2 tyre column →
1.6 pit cost/rejoin → 2.1–2.3 tower drama → 3.1/3.2 quali timing → 2.4/2.5 →
3.3/3.4 → Tier 4. Each step is independently shippable and testable with the
`better_roadmap.md` P0 harness (assert the new fields render and the
laps-left estimate matches the sim's own wear formula within ±1 lap).
