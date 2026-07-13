# Golden Lap — AI Racecraft Improvement Plan

Scope: better racing lines, believable side-by-side racing, attacking and
defending, and — explicitly — **small side-by-side touches or bumps must not
make a car overslow**. Analysis done 2026-07-13 against `index.html` (3,814
lines). All line references are to `index.html`.

---

## How the AI drives today (architecture recap)

- `speedProfile()` (line 578) computes a curvature-limited speed profile **on
  the track centerline**. There is no racing line anywhere in the sim.
- `botStep()` (line 831) is a pure-pursuit controller: it chases a lookahead
  point on the centerline shifted by a lateral offset `latT`, and brakes for
  the centerline profile ahead, scaled by `margin` and capped by `vCap`.
- `updateTraffic()` (line 2901, 30 Hz) sorts cars by track position `s`. Each
  car reacts to exactly **one** other car: the next one ahead in `s`. It sets
  `e.latTgt` (desired lateral offset) and `e.vCap` (speed ceiling), which feed
  `botStep` via `stepEntry` (line 2706).
- `stepRacecraft()` (line 2962) is the per-pair brain: quali yielding, blue
  flags, start rush, attack (`atkT`/`atkSide`), one covering move for the
  defender (`defT`), and "sit at a respectful distance" following.
- `collideCars()` (line 877) resolves car-vs-car contact as **one circle per
  car, radius 1.5 m** (touch at 3.0 m center distance), impulse with e=0.2
  plus a blanket 0.985 velocity damp. The game layer (line 2858) then sets
  `concedeT = 0.8` on the **slower** car for *any* impact, and while
  `concedeT > 0` the car is capped at `spd − 2` every traffic tick (line 2957).

## Root causes found (ranked by impact)

### R1 — Followers are never allowed to match the leader's speed
Every follow branch floors `vCap` **above** the car ahead's speed:

```
2984:  e.vCap = a.spd + Math.max(0.8, (ds - 5) * 1.6);   // quali traffic
2992:  e.vCap = a.spd + Math.max(1.5, (ds - 6) * 1.8);   // start rush
3000:  e.vCap = a.spd + Math.max(1.6, (ds - 4) * 2.0);   // blue flags
3026:  e.vCap = a.spd + Math.max(2.0, (ds - 4) * 2.2);   // attacking
3036:  e.vCap = a.spd + Math.max(0.8, (ds - 7) * 1.9);   // "respectful distance"
```

A follower's ceiling is always ≥ `a.spd + 0.8`, so it *creeps into the car
ahead until they collide* (at 3.0 m, see R2), gets shoved and slowed by the
concede rule, drops back, and repeats. This is the engine behind the ~1,700
touches/race baseline and much of the "bump → overslow" feel.

### R2 — Collision geometry contradicts the side-by-side room rule
Cars are 5.4 × 2.0 m but collide as circles of radius 1.5 m → they "touch"
at **3.0 m** center distance. The wheel-to-wheel room rule (line 2938) and
every alongside branch target **2.4 m** lateral separation. Two cars running
legitimately side by side are therefore *permanently inside collision*:
constant penetration resolution, stress gain, and `concedeT` on the slower
car every tick. Side-by-side racing is structurally impossible to do cleanly.

### R3 — Post-contact penalty ignores severity and compounds
Line 2866: any impact, however feather-light, sets `concedeT = 0.8` on the
slower car. Line 2957 then applies `vCap = max(6, spd − 2)` **recomputed from
current speed every traffic tick**, so over 0.8 s the car ratchets down ~2 m/s
per tick-window toward 6 m/s — a light brush can bleed 10+ m/s. This is the
user-visible "small touch makes one car overslow" bug. Also, "slower car
concedes" is wrong for side impacts: the attacker/overlapping car behind
should be the one to back out.

### R4 — No racing line
Bots drive the centerline. Corners are taken middle-of-road, so (a) laps look
wrong, (b) there is no meaningful "inside/outside" for attack and defense,
(c) being "off line" costs nothing, so defending has no trade-off.

### R5 — Offset speed error in corners
When a car corners 2–3 m off center (side by side, attacking), its true path
radius differs from the centerline radius, but its target speed still comes
from the centerline profile. The inside car carries too much speed, drifts
outward into its neighbour mid-corner → contact that neither "driver" chose.

### R6 — Attack/defense are not corner-aware
`atkSide` is just "opposite of where the defender sits" (line 3014). The
attacker doesn't target the inside of the next corner, the defender doesn't
cover it, there's no overlap/corner-rights concept, and no slipstream — so
passes only ever come from raw pace difference plus collision luck.

### R7 — Single-neighbour myopia
Each car reacts only to the next car ahead in `s`. When that car is actually
*alongside* (ds ≈ 0), the car two ahead — the one it's really catching — is
invisible until the alongside car is cleared. Three-wide situations and
accordion braking are handled by collision, not by driving.

---

## Work packages

Ordered so each lands on a measurable baseline. WP0/WP1/WP2 are the direct
fix for the user's complaint; WP3–WP6 build the positive racecraft. The game
stays single-file vanilla JS; only `tools/` grows.

### WP0 — Measure first (extend `tools/race-sim.js`)
Add metrics so every later WP is an observed delta, not a vibe:
- **Overslow events**: car decelerating > 3 m/s² while within 6 m of another
  car and the largest recent impact was < 4 (i.e. slowed by contact plumbing,
  not by braking for a corner).
- **Side-by-side seconds**: total time any pair sustains `|Δs| < 6 m` and
  `|Δlat| > 1.8 m` — and how many of those episodes end in contact.
- Keep: passes, `hitN`, `hitHard`, DNFs, classification sanity.
- Record a baseline row per track in this file before any sim change.

### WP1 — Contact plumbing: capsule collider + severity-scaled response
*Files: `collideCars()` (877), hit loop in `stepSession()` (2858).*
1. Replace the single circle with a **2-circle capsule** per car: circles of
   r ≈ 1.0 at local x = ±1.35. Lateral touch then happens at ~2.0 m (the real
   car width) and nose-to-tail at ~4.7 m. The existing 2.4 m room rule
   instantly gains ~0.4 m of genuine air. `collideCars` keeps its signature;
   it just tests 4 circle pairs per car pair and applies the impulse at the
   deepest contact (with a torque-free approximation, as now).
2. **Severity gates**: `imp < 2` → cosmetic only (no `concedeT`, minimal
   stress, no damping). `imp ≥ 4` → `concedeT = clamp(imp * 0.08, 0.3, 1.5)`.
3. **Concede the right car**: the car that is *behind* (by `s`) backs out,
   not the slower one — in a side-by-side bump the slower car is often the
   one being muscled.
4. **Fix the ratchet**: on contact, latch `e.concedeV = spd_at_contact − 2`
   once; while `concedeT > 0`, `vCap = min(vCap, max(12, e.concedeV))`. The
   penalty becomes "lift for a moment", not "decelerate continuously".
5. Drop the blanket 0.985 damp for grazing contact — scale restitution and
   damping by how head-on the closing velocity is (`|rel·n|` vs tangential).

**Acceptance (WP0 harness):** overslow events ≈ 0 for impacts < 4; total
touches down ≥ 50% from baseline; side-by-side episodes can last 2 s+ with
zero contact; no new stuck states.

### WP2 — Signed follow law (hold a gap instead of nudging bumpers)
*File: `stepRacecraft()` / `updateTraffic()`.*
Replace every `a.spd + Math.max(floor, …)` with one shared helper:

```
followCap(e, a, ds, dGap) = a.spd + (ds − dGap) * k   // k ≈ 1.6
   clamped to [a.spd − 8, +∞)
```

with `dGap` a *time* gap (≈ 0.35 s × speed, min 5 m) for normal following,
smaller (≈ 0.2 s) when attacking, larger in the start rush and behind pit-in
cars. Followers can finally settle at the leader's speed at a real distance.
The DRS-train look disappears and so does the bumper-tapping loop from R1.

**Acceptance:** average following distance in a train ≥ 5 m; touches down
again from WP1 level (target: < 300/race, < 6 hard — roadmap P1 numbers);
passes still ≥ baseline (pace deltas must still convert into overtakes;
retune attack `dGap` if passes drop).

### WP3 — A real racing line
*Files: `buildTrack()` (331), `speedProfile()` (578), `botStep()` (831).*
1. In `buildTrack`, precompute `lineOff[i]`: a curvature-minimizing lateral
   offset, clamped to ±(hw − 1.6), via the standard iterative smoothing pass
   (a few hundred relaxation sweeps over the ~1–2k sample points; runs once
   per track at boot, milliseconds). Out-wide → apex → out-wide falls out
   naturally.
2. Build the speed profile **on the line** (resample the offset path, rerun
   the existing forward/backward passes). Keep the centerline profile too.
3. `botStep` pursues `line + latT`: traffic offsets become offsets *relative
   to the racing line*, still clamped to the road edge. Pit states are
   untouched — `pitIn`/`pitOut` already override `lat` in centerline space
   (line 2664) before `botStep` is called.
4. **Off-line speed correction** (fixes R5): blend target speed between the
   line profile and a conservative centerline profile by `|latT|` — being
   2.5 m off line in a corner costs real lap time and forces earlier braking.
   This one term makes side-by-side sort itself out at corner exit and makes
   defending off-line a genuine trade-off.

Watch-outs: `spawnOnTrack` grid slots, checkpoints (`cpR` 13.5 m), start-line
crossing, and `stepRecovery` all live in centerline space and are unaffected;
the minimap and skid effects don't care. Qualifying gains the line for free.

**Acceptance:** line profile lap time ≤ centerline lap time on all 6 tracks;
`trackscore.js`/screenshots show out-in-out through the tightest corners; no
increase in off-course excursions or recovery triggers.

### WP4 — Corner-aware attacking and defending
*Files: `buildTrack()` (corner table), `stepRacecraft()`.*
1. Precompute a **corner table** per track: braking-zone start, apex index,
   and inside sign (from `kSm`) for every corner the profile brakes for.
2. **Slipstream**: within ~14 m and `|Δlat| < 1.5` of the car ahead on a
   straight, reduce drag (`entryMods.dr × ~0.88`). Passes now *build* over a
   straight instead of teleporting out of margin math.
3. **Attack**: when within ~1 s of the defender approaching a corner, set
   `atkSide` to the corner's **inside**; keep the existing 3 s commitment.
   Late-braking attempt: small margin bonus in the braking zone with a
   focus/stress-weighted chance of a lockup (reuse `liftT`) — drama with a
   cost, as the brief asks.
4. **Corner rights / overlap rule**: if the attacker's nose overlaps the
   defender (`ds < 4`) at the braking-zone start, the defender's `latTgt` is
   clamped to leave one car width on the attack side; if no overlap by then,
   the attacker tucks back (`latTgt → line`, keep the tow) instead of
   half-lunging.
5. **Defend**: replace the random sidestep (line 3029) with one deliberate
   move to cover the *inside* before the braking zone (focus-gated, still one
   move per `defT` window — no weaving). Off-line cost from WP3 makes this a
   real decision rather than a free block.

**Acceptance:** passes per race stay in a healthy band (harness); manual
review of 2–3 recorded battles shows: tow → move to inside → either overlap
and side-by-side through the corner, or bail and retry. No weaving.

### WP5 — Side-by-side negotiation polish
*File: `updateTraffic()` room rule (2938).*
- Raise the room-rule separation to 2.6 m (capsules touch at 2.0 → ~0.6 m of
  air) and add hysteresis: engage at `|Δlat| > 2.1`, release below 1.6, so
  pairs stop oscillating across each other every 33 ms tick.
- Resolve at corner exit: the car that is behind by more than half a car at
  exit yields and tucks in behind (sets a short `concedeT`-style tuck, no
  speed penalty) instead of grinding alongside down the next straight.
- Both cars keep their own off-line speed penalty (WP3), so the outside car
  naturally emerges ahead or behind based on geometry, not collisions.

### WP6 — Start rush + multi-car awareness
*Files: `stepRacecraft()` start branch (2989), `updateTraffic()`.*
- Start: hold grid columns — freeze `latTgt` at the grid offset for the
  first ~4 s, use the WP2 follow law with a bigger `dGap`, no attack moves
  until the field passes turn 1's exit.
- Multi-car: let each car consider the **two** nearest cars ahead within
  60 m; brake for the nearest one whose lane overlaps (`|Δlat| < 2.2`),
  apply the room rule to an alongside one. Fixes the invisible-leader case
  when the sorted-next car is beside you.

### WP7 — Retune + lock in acceptance
Full-season harness runs on all 6 tracks (dry + forced rain):
- touches < 300/race, hard hits < 6, opening lap ≤ 2 hard hits
- overslow events ≈ 0 for impacts below the severity gate
- ≥ 8 clean passes per race average across the season (pace-mixed field)
- side-by-side episodes: median duration ≥ 1.5 s, < 20% end in contact
- classification/DNF sanity unchanged; no console errors; 8× stable
- record final numbers in this file as the new baseline

---

## Sequencing & effort

```
WP0 (harness metrics, ~1 session)
 └→ WP1 + WP2 (contact & following — the user's bug, ~1–2 sessions)
     └→ WP3 (racing line, the big one, ~2 sessions)
         └→ WP4 + WP5 (attack/defend/side-by-side, ~2 sessions)
             └→ WP6 → WP7 (start, awareness, retune, ~1 session)
```

WP1+WP2 alone fix the reported overslow bug and can ship independently.
WP3 is the prerequisite for WP4/WP5 being meaningful (inside/outside and
off-line cost don't exist without a line). Nothing here touches the
management layer, pit-lane flow, or session structure.
