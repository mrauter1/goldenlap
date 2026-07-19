# Game Balance Plan — Strategy Parity and Decision Quality

Active plan for the *balance* work stream (the racing-feel stream lives in
`racecraft_racing_feel_plan.md`). Scope: the numbers behind decisions the
player and AI make — tyres, pace, pits, drivers, upgrades — so every choice
is a real choice.

## 0. Balance principles

1. **Parity of expected value, not identity of outcome.** Two viable
   strategies should have near-equal expected race time but *different
   variance and texture* (soft = aggression, traffic, undercut windows;
   hard = track position, consistency). Balance bands, not exact equality:
   within the noise that racecraft and mistakes decide (~±4 s per race).
2. **Closed-form first, simulation second.** Every balance area below has a
   cheap analytic model. Solve parameters on paper/solver, then *validate*
   with seeded headless races. Never hand-tune against full-sim win rates —
   that overfits one seed population and takes hours.
3. **A dominated option is a bug.** If one compound, pace mode, upgrade path,
   or staff pick is best in ≥80% of situations, the others are UI noise.
4. **Same discipline as racecraft**: targets become observe-only
   metric-policy bands on calibration seeds first; lock on validation;
   release seeds only for the final suite.

## 1. Current state: soft tyres are strictly dominated in the dry

Reference race (Prado-class: 68 s lap, ~2 750 m, laps =
`round(3600/(lapTime·1.10))` ≈ 48, pit loss = `Lp/limit + service + 2.5 −
Lp/raceSpeed` = 186/14 + 7 + 2.5 − 5.1 ≈ **17.7 s**).

Model (all from `strategy.ts` / `autopilot.ts`): lap time scales ≈
`1/(margin·√grip)`; grip-to-lap-time sensitivity ≈ 0.5·Δgrip on a
corner-dominated lap. Compound grip: S `1.0 − 0.10·w^1.7`,
H `0.976 − 0.05·w^1.7`; wear per lap `1/lifeLaps`, life S = 0.30·laps
(14.4), H = 0.55·laps (26.4). Average wear penalty over an L-lap stint:
`coeff·(L/life)^1.7 / 2.7`.

| Strategy | Compound deficit | Wear loss | Stops | Total vs ideal |
|---|---|---|---|---|
| S 3-stop (4×12) | 0 | ~0.92 s/lap → 44 s | 3×17.7 = 53 s | **~98 s** |
| S 2-stop (3×16) | 0 | ~1.51 s/lap → 73 s | 35 s | ~108 s |
| H 1-stop (2×24) | 0.82 s/lap → 39 s | ~0.54 s/lap → 26 s | 18 s | **~83 s** |
| H 2-stop (3×16) | 39 s | ~13 s | 35 s | ~88 s |

**Hard-only wins by ~15 s** — roughly the whole pit-loss budget. The soft's
fresh-grip advantage (2.4% grip ≈ 0.8 s/lap) never repays even one extra
stop. The rival AI already knows this implicitly: `rivalPitAI`
(`pit.ts:499`) fits hards whenever >42% of the race remains and softs only
as an end-of-race tyre. Every dry race is therefore the same puzzle with the
same answer.

### 1.1 The parity condition and its levers

Let `d` = fresh S-over-H pace (s/lap), `P` = pit loss, `W_c(n)` = wear cost
of compound c on its best n-stop schedule. Parity:
`48·d + W_H(n_H*) + n_H*·P ≈ W_S(n_S*) + n_S*·P` with `n_S* − n_H* ≥ 1`
(strategies must stay *different*). Reaching the band from today's numbers,
any mix of:

- **Widen the fresh compound gap**: H fresh 0.976 → ~0.965 alone closes it
  (`d` ≈ 1.1 s/lap). Softs must *feel* fast.
- **Soften the soft's wear cost**: S coefficient 0.10 → ~0.07, or life
  0.30 → 0.35 (fewer stops for the same pace).
- **Cheapen the stop**: service 7 s → ~5.5 s and/or lane limit 14 → 16 m/s
  (also strengthens undercuts, §5).

Do not solve with one lever only: the compound gap sets racing-feel (tyre
delta drives overtaking), wear shape sets stint drama, pit loss sets
undercut power. Solve the three jointly in the §9 tool, then pick the
solution that also satisfies §2/§5 targets.

**Targets** (observe-only bands first): best-S vs best-H expected total
within ±4 s at every track; each pure strategy wins 30–70% of paired-seed
headless races; at least one mixed strategy within 3 s of the best pure one;
optimal S schedule keeps ≥2 more stops than optimal H nowhere and ≥1 more
everywhere (distinct textures preserved).

### 1.2 Degradation shape (drama knob, solve alongside parity)

`w^1.7` is a gentle ramp; end-of-life S loses ~5% pace (3.4 s/lap) — a cliff
that arrives *after* the AI has already boxed (wear 0.78). The interesting
zone (tyre-delta overtaking, "can I stretch this stint one more lap?") is
barely visited. Consider a steeper late shape (exponent ~2.2–2.5 with
rebalanced coefficient) so the last 15% of life costs visibly but playable —
the gamble must exist on screen, not beyond the box threshold.

## 2. Wet crossover

Slick grip ×`(1 − 0.36·wet)` vs wets `0.915·(1 − 0.05·wet)` — crossover at
wet ≈ 0.27 (UI says "above 1/3", close enough). AI switches at wet > 0.42
(to wets) and < 0.15 (to slicks): the 0.15–0.42 hysteresis window is the
drama zone and is currently generous. Targets: staying out on slicks between
crossover and 0.42 must be a genuine gamble (recoverable ~half the time via
`rain` trait / focus), and wets in the window must not be strictly dominant
— check wet-tyre dry-death (life 0.10·laps) prices the early switch. Add a
paired-seed rain scenario to the §9 matrix.

## 3. Pace modes (push / race / save) — save is currently dominant

Nominal deltas (`PACE_MARGIN` ±1.3/−1.6% margin, `pw` ×1.008/×0.97): push ≈
+0.9 s/lap, save ≈ −1.2 s/lap in clean air. Three mechanisms erase the pace
cost and leave only save's benefits, which is why save reads as strictly
best:

1. **Traffic caps eat the delta.** The pace delta only exists where the car
   is free: in any train the follow law's `vCap` sets speed, and a saving
   car pinned behind a leader loses *nothing* — while its 0.7× wear and
   0.55× risk accrue every lap. The denser the racing (which the racing-feel
   stream deliberately increases), the more of the race is capped, the more
   save dominates. Push has the mirror image: paying 1.42× wear and 2× risk
   for pace the cap won't let you use.
2. **The signal drowns in flow noise.** Per-zone `flowOff` amplitude
   (`0.0035 + (1−focus)·0.011`, up to ±0.02 margin) is the *same order* as
   the ±0.013/0.016 mode delta — sector pace visibly wobbles more from flow
   than from the mode switch, so the mode doesn't *feel* like it does
   anything even when it does.
3. **The wear benefit is a whole pit stop.** Save's 0.7× wear stretches
   effective S life from 14.4 to ~20.6 laps — enough to delete one ~18 s
   stop from the schedule, dwarfing the pace cost of the laps actually run
   free. Risk is no counterweight (2× of a tiny base, mostly minor lifts).

Rebalance direction — make modes *tactical stances*, not a lap-time slider:

- **Couple pace mode to racecraft, where the cap lives.** Push should raise
  braking commitment (`brakingEffort`/`brakingPrudence` toward the driver's
  personal maximum), attack eligibility and defense willingness; save should
  lower them. Then pushing in a train does what it does in real racing —
  creates the pass — and saving surrenders track position gracefully.
  Positions, not lap times, become the visible price of save; this only
  bites once the racing-feel stream lets followers actually pass (the two
  streams gate each other here).
- **Price save's stop savings.** Rebalance the wear multipliers so save
  buys ~2–3 laps of S-stint stretch (meaningful timing flexibility), not a
  deleted stop: e.g. wear 0.7 → ~0.85, with §1's parity solve treating the
  mode multipliers as inputs. Push wear stays expensive — it must genuinely
  force the earlier stop it threatens.
- **Widen and symmetrize the felt pace gap** (target ≥1.5 s/lap between
  push and save in clean air, applied to both grip margin and power so it
  shows on straights too), and either reduce flow amplitude or scale it so
  mode deltas exceed zone noise. The mode switch must be visible on the
  very next sector.
- **Make push risk legible**: concentrate the 2× risk into battle/braking
  contexts (lockup on attack lunges already exists — weight it by pace
  mode) instead of a flat background roll, so the gamble is on screen when
  the player chose it.

Targets: in clean air, mode deltas visible per-sector above noise; in a
train, push raises pass probability measurably (§9 matrix with forced
modes); full-race save finishes within EV of full-race race-pace *only*
when tyre timing flexibility pays (specific races, not all); full-race push
≈ 10–15% ruin probability. EV curves per mode × context (free vs capped
share) become a standard §9.1 tool output.

## 4. Fuel

Tank = 1.3× race at normal pace; push ×1.3 drains it exactly at the flag —
sustained push is fuel-capped, conserve banks margin. Good bones, keep.
Known gap (candidate, not scheduled): fuel level has zero pace effect until
empty (`entryMods` only gates `pw` at 0), so there is no burn-off dynamic
and no light-car undercut texture. If added, a margin term of ~0.5–0.8 s/lap
tank-to-empty is the conventional scale — run it through §9 before adopting.

## 5. Pit loss and the undercut

Pit loss (~18 s) is also the undercut currency: fresh-tyre out-lap gain is
~1–2 s/lap (grip delta at stint end), so today an undercut needs the rival
to stay out 9+ laps — undercuts barely exist; strategy resolves off-line
instead of on it. Parity work in §1 (cheaper stops, wider tyre deltas)
mechanically strengthens undercut windows; target: a well-timed undercut
against a 2-lap-older rival gains 2–5 s (works, but answerable by covering),
never >8 s (mandatory, no counterplay). Player pit crew spread
(7.6 − 0.55·pitSkill, +3.5 fix) vs AI flat 7 s: verify chief choices
(fast/risky vs steady) map to actual stop-time variance, not just mean —
if `_mishap` risk isn't wired to chief focus yet, that's the missing half of
that trade.

## 6. Driver market and traits

`margin = 0.9115 + spd·0.0078 ± 0.00125` → one spd point ≈ 0.55 s/lap;
roster spans spd 2–5 (≈1.7 s/lap) for $5k–$40k. Balance target:
$-per-second-per-lap roughly monotone (paying double should buy less than
double), and each trait's expected seasonal value within ~±30% of its price
delta when used in its niche: `tyre` (+20% life) is worth roughly a pit stop
per race *only if* §1 makes stops matter; `rain` scales with rain frequency
(check calendar rain probability × wet-mistake EV); `pay` (+$5k/race) vs
`rookie` cost gap; `wild` (±0.010 quali variance) is only worth something if
grid position converts to points (§8). Compute each trait's EV in the §9
tool; adjust prices, not traits, where possible — traits are texture.

## 7. Upgrade economy

Per level: engine +2.8% power, chassis −4.5% drag, handling +1.0% grip; cost
9/12/16/22 (×0.75–1.25 philosophy). Lap-time value per dollar differs by
path and track (power/drag pay on straights, grip in corners: lap-time ∝
(power/drag)^⅓ on straights, √grip in corners). Target: across the season
calendar the three paths land within ~±30% $/second; per-track divergence is
*good* (buy handling for street tracks) if the UI communicates it. Add
per-track sensitivity (Δlap per level) to the §9 tool output so prices can
be set against the calendar average.

## 8. Qualifying weight vs race pace

Quali margin (`entryMargin` quali branch) and race margin come from the same
`lu.margin`, so grids restate pace order and — with balanced strategies
removed as a differentiator (§1 fixes this) — races risk processions.
Levers that already exist: `wild` trait variance, tuning bonus (±0.004/
gauge), evo, `flowOff`. Target (needs racing-feel passes to be meaningful):
winner-from-pole rate 35–60% across seeds; a spd-5 driver starting P6 in a
spd-3 field reaches the podium in most seeds. If processions persist, add
bounded quali variance before touching race pace.

## 9. Tooling and method (build first)

1. **`tools/strategy-model.ts`** — the closed-form model of §1: lap-time(w),
   stint cost, pit loss per track, optimal n-stop schedule per compound and
   mix, pace-mode EV, undercut gain, trait EV. Pure math over `PHYS`, track
   profiles, and `strategy.ts` constants — no simulation, runs in
   milliseconds, prints the parity table per track. This is the balance
   solver; every § above defines its outputs.
2. **Strategy matrix** — extend the headless runner with a forced-strategy
   option (compound sequence + box laps per entry) and run paired seeds:
   same field, strategy A vs B swapped between runs. Win rates and time
   deltas per track validate the solver (which ignores traffic). Reuse
   `run-season-matrix.js` patterns; bounded runs, calibration seeds.
3. **Policy bands** — add observe-only entries (strategy time delta, pure-
   strategy win rate, undercut gain) to `metric-policy.json`; promote to
   enforced bands only after §1 lands and the racing-feel stream stabilizes
   contact/pass metrics.

## 10. Order of work

§9.1 tool → §1 tyre parity (the headline fix) → §5 pit/undercut (same
solve) → §2 wet crossover → §3 pace modes → §6/§7 economy (needs season-
level EV from the tool) → §8 only if processions persist after racing-feel
Phase G. One area per verification cycle; `verify:fast` plus the strategy
matrix on calibration seeds is the loop — full stats tiers only at stream
end.

## Non-goals

- No refuelling, no new compounds, no new part types — balance the existing
  decision set before widening it.
- No AI strategy rewrite: `rivalPitAI` stays reactive; once §1 gives softs a
  real use, its existing compound rule (`lapsLeft > 0.42·laps ? H : S`)
  should be revisited *only* if the strategy matrix shows the AI leaving
  >5 s on the table against the solver's schedule.
- Racecraft/contact behavior is the other stream; nothing here touches
  traffic, corridors, or contact handling.
