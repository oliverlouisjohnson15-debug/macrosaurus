# Phases: dated diet plans with a deadline

A **phase** is a diet block with a start date, an end date and an optional goal weight
by that end date. The weekly calorie shape, protein, steps, a drinking budget and what
happens next all belong to it. Example: *"Cut to 80 kg by 21 Dec, Fri/Sat high, Sunday
low, 175 g protein, 17.5k steps, one night out a month, then two weeks at maintenance."*

This doc is in two parts:

- **Part A** sets up the first real phase (Oliver, 9 Nov to 21 Dec 2026) with the app as
  it is today, with no code changes.
- **Part B** is the build plan, so anyone can set up the same kind of plan in a few taps.
  The app checks it against their own data, runs it, keeps it honest, and ends it with a
  review.

The design rule is that **phases are a scheduler on top of machinery the app already
has.** They don't run a second engine. The rate, protein, cycling, step goal, diet
break, weekly plans, the adaptive check-in and the off-plan handling are all built and
tested already. A phase writes those settings on the right dates and adds what's missing
today: a deadline, checkpoints, a strength brake, readiness ratings (hunger, energy,
sleep, gym), a drinking budget, a planned exit and an end-of-phase review.

---

## Part A: Oliver's phase, set up today

### The plan (agreed 9 Nov)

| | |
|---|---|
| Start | Mon 9 Nov (today). Starting Friday would need 1.0 kg/wk instead of 0.92 |
| End | Mon 21 Dec |
| Start weight | 7-day trend 85.57 kg |
| Goal | **80.0 kg, 7-day average, firm** |
| Required rate | 5.57 kg over 6 weeks = **0.92 kg/wk** (~1.1% BW, about a 1,010 kcal/day deficit) |
| Learned burn | 2,771 kcal/day (app); 2,600–2,770 from the last 4 weeks of intake against trend |
| Mon–Thu | 1,650 kcal · 175 P · ~115 C · ~55 F |
| Fri–Sat | 2,000 kcal · 175 P · ~180 C · ~65 F |
| Sun | 1,550 kcal · 175 P · ~90 C · ~55 F |
| Weekly total | ~12,150 kcal (avg ~1,735/day) |
| Steps | 17,500 every day, weekends included (last 4 wk avg 14.3k; Sept avg 20k+) |
| Training | Current programme unchanged, 5 sessions. Main lifts stop 1 rep short in weeks 4–6 |
| Alcohol | One night a month (was ~1,000 kcal/wk). Fri/Sat only, ~4 drinks inside the day, never 14–21 Dec |
| Final 4 days | Carbs ~80–100 g, fibre moderate, salt and water kept the same. Scale effect only, labelled as such |
| After | 22 Dec – 4 Jan at maintenance (~2,750, the app's learned burn), then a review |

### Checkpoints (7-day average, read at the Friday check-in)

| Date | Target | Date | Target |
|---|---|---|---|
| 16 Nov | 84.6 | 7 Dec | 81.8 |
| 23 Nov | 83.7 | 14 Dec | 80.9 |
| 30 Nov | 82.7 | 21 Dec | **80.0** |

**Friday rules, in this order:**
1. **More than 0.3 kg behind a checkpoint:** +2,000 steps/day first. Then −100 kcal.
   Never go below 1,500 kcal.
2. **Top sets down more than 5% for two weeks on two or more main lifts:** +150 kcal on
   Fri/Sat. This rule beats rule 1.
3. **Two readiness ratings (hunger, energy, sleep, gym) at 2/5 or below for two weeks
   running:** a recovery week. Steps back to 15k and calories held. Calories don't go up.
4. **Otherwise:** change nothing. A fast week 1 is water from lower carbs, so don't bank it.

Every Friday: waist at the navel, photos in the same light, and the four 1–5 ratings.

### Exact app settings (in this order)

| # | Where | Set to | What the app will do |
|---|---|---|---|
| 1 | Goal settings → rate | Cut, **0.92 kg/wk**, goal weight 80 (already set) | Shows the "above ~0.85 kg" warning (`rateGuidance`, `app/engine.js:50`). Accept it. Base becomes 2,771 − 1,012 ≈ **1,760** |
| 2 | Protein | **Fixed grams, 175** (`proteinManualG`) | Overrides the 2.4 g/kg-LBM mode (currently 170 g) |
| 3 | Calorie cycling | High **Fri + Sat**, low **Sun**, boost **15%**, low-day cut **11%** | `cyclingWeek` (`app/engine.js:706`): Fri/Sat ≈ 2,025, Sun ≈ 1,565, Mon–Thu ≈ 1,675. Written to `cyclingHistory` with today's date, so past days keep their targets |
| 4 | Step goal | **17,500** | |
| 5 | Check-in day | Friday (already) | Each check-in adjusts towards 0.92 kg/wk, by 100–350 kcal at most (`app/engine.js:1157`) |
| 6 | Weekly plans → **Festive period** | **22 Dec – 4 Jan**, rate "none" (hold) | `planKcalDelta` adds the whole rate back, so maintenance with no payback afterwards. Only "big days" marked inside the window get paid for by other days |
| 7 | Weekly plans → **A big day out** | The one night out, on a Fri or Sat | The other days in the window cover the extra, so the weekly total still lands |

**Where the app will differ from the table above:**
- **Fat.** The app's fat floor is 0.8 g/kg (~68 g). So it shows ~68 g fat and fewer carbs:
  Sunday carbs come out around 55–60 g. Calories and protein are what count. Part B adds
  a phase-only fat floor so the app can show the planned split.
- **Calories move.** The numbers will drift ±100–350 kcal at check-ins as the learned burn
  updates. That's intended. It's how a deadline actually gets hit.
- **Ahead of the plan.** The app doesn't know about the deadline or checkpoints yet. Track
  those by hand until Part B ships.

---

## Part B: the Phases feature

### B1. What's already there and reused (no rewrite)

| Need | Existing piece |
|---|---|
| Rate → deficit | `goalDailyDelta` (`app/engine.js:65`), `KCAL_PER_KG = 7700` |
| Safe-rate limit | `rateGuidance` (`app/engine.js:50`): 1% BW, 0.75% for lean users |
| Weekly shape | `cyclingWeek` / `cyclingHistory` (`app/engine.js:706`, write at `app/src/app.jsx:17227`) |
| Macro split + floors | `macrosFromKcal` (`app/engine.js:264`), `kcalFloor` 1,500 male / 1,200 other |
| Adaptive check-in | check-in pipeline (`app/src/app.jsx` ~6430), adjustment cap (`app/engine.js:1157`), off-plan weeks set aside |
| Maintenance block | `diet_break {start,end,returnGoal}` (`app/store.js:280`), `dietBreakActive` / `effectiveTarget` (`app/src/app.jsx:4000`, `:4102`), check-in hold (`:6455`) |
| One-off events | `week_plans` + presets `event` / `festive` (`app/src/app.jsx:5869`), `planDayDelta` (`app/engine.js:2132`) |
| Past days unchanged by edits | `targetOn` + effective-dated targets and cycling history |
| Goal ETA | `weeksToGoal` (`app/src/app.jsx:7128`) |
| Lift history | `training.logs[].sets[]` (weightKg, reps, exerciseId, done) |
| Readiness signals | `sleep[date]` (minutes, score), `steps[date]`, `log_entries[].is_alcohol` |
| AI | `supabase/functions/ai-proxy` (signed in, allowed models, usage metering) |
| Sync | `mergeStates` / `unionBy` by id (`app/store.js:698`) |

### B2. Data model

New top-level array in user state, defaulted in `app/store.js` next to `week_plans`:

```js
phases: [{
  id: 'ph_…',                          // stable id; merge key
  name: 'Phase 1 – Christmas cut',
  kind: 'cut' | 'maintain' | 'gain',
  start: '2026-11-09', end: '2026-12-21',          // local dates, inclusive
  deadline: { goalKg: 80, measure: 'avg' | 'scale', firm: true } | null,
  rateKgPerWeek: 0.92,                 // agreed at setup; only the deadline rule (B4.3) moves it
  shape: { highDays: [5,6], lowDays: [0], deltaPct: 0.15, lowPct: 0.11 },
  proteinG: 175 | null,                // null = keep the user's protein mode
  fatFloorGPerKg: 0.65 | null,         // phase-only floor, see B4.7
  stepGoal: 17500 | null,
  sessionsPerWeek: 5 | null,
  alcohol: { nightsPerMonth: 1 } | null,
  finish: { taperDays: 4, carbsG: 90 } | null,     // optional final-days carb taper, B4.8
  next: { kind: 'maintain', days: 14 } | null,     // then a review, never an automatic new cut
  applied: { start: '2026-11-09', end: null },     // transitions done (idempotent markers)
  restore: { rateKgPerWeek, proteinManualG, cycling, stepGoal, … },  // settings before the phase
  checks: [{ date, avgKg, targetKg, waistCm, ratings: {hunger, energy, sleep, gym}, action }],
  outcome: null | { endedOn, endAvgKg, endScaleKg, hit: bool, review: {…} },
  createdFrom: 'manual' | 'import',
  updated_at: ISO
}]
```

**Store work:**
- Default `phases: []`.
- Merge with `unionBy` by id, newer `updated_at` wins per phase. `checks` are unioned by
  `date` inside a phase.
- Add to the tombstone map (`deleted`) and the wipe groups (`app/store.js:404`, `:572`),
  following how `week_plans` is handled.

### B3. Engine (pure, in `app/engine.js`, unit-tested)

| Function | Returns |
|---|---|
| `phaseOn(phases, iso)` | The phase covering `iso`, or null. Overlap is refused at save time |
| `deadlineRate({ nowKg, goalKg, fromISO, endISO, measure })` | kg/wk needed. `measure: 'scale'` gives 0.5 kg of slack for daily water swings |
| `deadlineFeasibility({ profile, burnKcal, rate })` | `{ status: 'ok' \| 'aggressive' \| 'over-limit' \| 'infeasible', intakeKcal, pctBW, reachableKg, earliestISO }`. `infeasible` = intake would be under `kcalFloor` |
| `checkpoints({ startISO, endISO, startKg, goalKg, checkinDay })` | One target per check-in day, linear, the last one = goal |
| `shapeFromDayKcal(dayKcal[7], floor)` | `{ base, highDays, lowDays, deltaPct, lowPct }`, the inverse of `cyclingWeek`. Round-trip tested |
| `leanMassCheck({ weightKg, bfPct, goalKg, goalBfPct })` | Weight needed for a body-fat goal at current lean mass. For Oliver: 14% at 66.5 kg LBM is about 77 kg, not 80 |
| `strengthTrend(logs, sinceISO)` | Per main lift, weekly best e1RM (Epley) from done work sets. `{ exerciseId, weeks:[…], changePct }`. "Main" = the 4–6 most-trained compounds in the window |
| `phaseAction({ check, prevChecks, strength, ratings, profile })` | One action, in the rule order from Part A: `brake` (+150 on high days) → `recover` → `steps` (+2,000) → `kcal` (−100, floor-clamped) → `hold` |
| `taperMacros(target, finish)` | Carbs set to `finish.carbsG`, calories cut by the carbs removed, protein unchanged, never under the floor |

### B4. Rules and guardrails

1. **Kcal floor is never broken.** It's 1,500 for men and 1,200 otherwise. If a deadline
   would need less, the status is `infeasible` and setup shows `reachableKg` and
   `earliestISO`.
2. **Rate limits.**
   - Up to `rateGuidance.maxKg`: fine.
   - Up to 1.25% BW: allowed only after the user confirms, with the costs spelled out
     (hunger, strength, sleep).
   - Above 1.25% BW: refused, and setup offers the nearest workable date or weight.
   - Lean users (existing rule) are limited to 0.75% / 1.0%.
3. **Rate is recalculated each check-in, with limits on how far it moves.** At each
   check-in in a deadline phase: `rate = deadlineRate(trendNow, goal, today, end)`.
   - It can rise at most 0.1 kg/wk per check-in, and never past the cap the user accepted
     in rule 2.
   - When the cap is reached, the check-in says plainly what will happen: *"80.0 isn't
     reachable by 21 Dec within the limit you set. Projected 80.6."*
   - It never chases a single bad week. The trend is used, and off-plan weeks are already
     set aside.
4. **Steps before food when behind.** `phaseAction` prefers +2,000 steps until the step
   goal reaches 20k, then −100 kcal.
5. **Strength brake beats the deficit.** Two or more main lifts down more than 5% for two
   check-ins means +150 kcal on high days, even when behind.
6. **Readiness check.** Four 1–5 ratings at check-in (skippable, one tap each). Two at 2
   or below for two check-ins in a row starts a recovery week: the step goal falls back to
   the phase's base and calories are held.
7. **Phase-only fat floor.**
   - The default stays 0.8 g/kg.
   - A cut phase of 8 weeks or less can set 0.65 g/kg, so the planned split shows as planned.
   - The 0.5 g/kg hard minimum in `macrosFromKcal` stays.
   - Implementation: pass the floor through the `profile` that `macrosFromKcal` reads
     (`fatFloorGPerKg` override). It only applies while the phase is active.
8. **Final-days taper.**
   - Optional. Last `taperDays` of a deadline phase.
   - The screen labels it **"water and glycogen, not fat; it comes back"**.
   - No water restriction, diuretics or salt loading are ever suggested.
   - Not offered for phases without a deadline.
9. **Length limit and exit.**
   - A cut at 1% BW/wk or faster is limited to 8 weeks.
   - Every cut phase must have a `next`: maintenance of at least 7 days. Default 14.
   - After maintenance the app shows the review. It never starts the next cut by itself.
10. **Who can use it.** Deadline mode is hidden for under-18s (`profile.age`). If a
    pregnancy or eating-disorder flag is ever added, deadline mode respects it.
11. **Data needed.** Feasibility uses the learned burn when `expenditure.n ≥ 2` check-ins.
    Otherwise it uses the formula estimate and says it's an estimate.
12. **Past days never change.** Every setting a phase writes carries `effective_date =`
    the transition date. Ending a phase early writes `restore` from today forward only.
13. **Drinking budget.**
    - Nights are counted from `log_entries[].is_alcohol` by date.
    - Today shows nights left this month.
    - Planning a night creates an `event` week-plan on that date.
    - Warns if the night falls in the final 7 days of a deadline phase (water weight
      on the day).
14. **Events in the final week.** Any `week_plans` window overlapping the last 7 days of a
    deadline phase gets the same warning.
15. **Paused account.** The phase clock keeps running. On unpause the app shows the new
    required rate. The deadline doesn't move silently.
16. **Check-in day changed mid-phase.** Checkpoints are recalculated from the trend weight
    on the change date.

### B5. Running a phase: transitions

`applyPhaseTransitions(db, today)` runs on app open and after sync. It's idempotent,
using the `applied` markers.

- **Start** (`today ≥ start && !applied.start`):
  1. Snapshot the current settings into `restore`.
  2. Write rate, protein, the shape (as a `cyclingHistory` entry), the step goal and the
     fat floor, all with `effective_date = start`.
  3. Write a target with `source: 'phase-start'`, recalculated from the learned burn.
- **Taper** (`today ≥ end − taperDays + 1`): `effectiveTarget` applies `taperMacros` on
  those dates only.
- **End** (`today > end && !applied.end`):
  1. Record `outcome` from the 7-day trend and the last scale reading.
  2. If `next.kind === 'maintain'`, write
     `diet_break = { start: end+1, end: end+next.days, returnGoal }`. Everything
     downstream already works for this: maintenance targets, no cycling or carryover,
     check-ins held.
  3. Settings go back to `restore`, so maintenance runs on the user's normal protein and
     steps.
- **Review due**: the day after the maintenance block ends, or at `end + 1` when there's no
  `next`.

Because every transition is a dated write into existing fields, a device that hasn't
synced and runs the same transition writes the same values. The merge has nothing to
resolve.

### B6. UI

**Setup flow** (Goal settings → "Plan a phase"), six short screens:
1. **Goal and date.** Goal weight, end date, average or one weigh-in, firm or flexible.
   - Live: required rate, % BW, daily intake against the learned burn, feasibility badge,
     and `leanMassCheck` if a body-fat goal is entered.
   - Shows the cost of waiting to start: *"Starting Friday needs 1.0 kg/wk instead of 0.92."*
2. **Weekly shape.** Tap each weekday high, normal or low and see the calories per day.
   Optional "type my own numbers", which goes through `shapeFromDayKcal`. A hint from the
   user's own logs: *"Your Fridays average 2,720 and Sundays 2,120."*
3. **Protein, steps, sessions.** Prefilled from the profile and the last 4 weeks' averages.
4. **Drinking and events.** Nights per month, and known dates to add as week-plans now.
5. **After.** Maintenance length (7, 14 or 21 days) and the optional final-days taper.
6. **Review.** One table. **Start today** (default) or on a chosen date.

**Today:**
- A phase strip: *"Week 2 of 6 · 83.7 by Fri · on track"*.
- Nights out left this month.

**Progress:**
- The plan line from start to deadline, with checkpoint dots against the trend line.
- The strength trend for main lifts in the same date range.

**Check-in, phase-aware:**
- Checkpoint hit or missed.
- The single `phaseAction` with a one-line reason.
- The four ratings, waist and photo prompt.
- When behind and the limit is reached, the plain projection from B4.3.

**End-of-phase review:**
- Planned against actual for: weight (average and scale), waist, average kcal and
  protein, steps, sessions, alcohol nights, and the change in each main lift.
- **"Copy as AI prompt"** builds the summary pasted to another AI (what was done by hand
  on 9 Nov).
- Then "Plan next phase".

### B7. Importing a plan from an AI chat (last milestone)

The user pastes a plan from another AI.

1. A new ai-proxy task asks for **JSON matching the `phases` schema only** (B2).
2. The app checks the JSON against the B4 rules. Anything outside them is clamped or
   rejected, and the reason is shown.
3. A comparison screen, **Your plan says / Your data says / We'll use**, for example:
   - maintenance 2,500 vs learned burn 2,770
   - 14% BF at 80 kg vs lean mass → ~77 kg
   - Fri–Sun high vs your logs show Fri/Sat
4. The user accepts each row. The app's own data is the default whenever the two disagree.

---

## B8. Tests

Engine (new `tests/phases.test.js`):
- `deadlineRate`: Oliver's case gives 0.928 kg/wk. Scale slack. A past deadline throws.
- `deadlineFeasibility` across ok, aggressive, over-limit and infeasible. The floor is
  never crossed.
- `checkpoints`: dates fall on the check-in day, the last one equals the goal, and moving
  the check-in day mid-phase recalculates them.
- `shapeFromDayKcal` → `cyclingWeek` round-trips within ±5 kcal for 50 random weeks,
  including floor-limited ones.
- `strengthTrend`: unfinished sets ignored, an exercise swap isn't read as a drop, and
  deload weeks are handled.
- `phaseAction`: order of priority (brake > recover > steps > kcal > hold), and the 1,500
  floor.
- `taperMacros`: protein unchanged, carbs to target, floor respected.

Integration (jsdom, the same pattern as `tests/checkin-scenarios.test.js`):
- **Oliver's real 9 Nov state, anonymised:** set up the phase, then simulate 6 weeks of
  weigh-ins at 0.92 kg/wk. Expect the checkpoints hit, the end on 21 Dec, the maintenance
  `diet_break` written 22 Dec – 4 Jan, and the review due 5 Jan.
- Same, but 0.6 kg/wk actual. Expect rate steps of at most +0.1 per check-in, the cap
  reached, and the projection message.
- Two devices run `applyPhaseTransitions` on the same day, then merge. Expect identical
  state.
- Ending a phase early restores the settings from today, and past `targetOn` values are
  unchanged.
- An off-plan week inside a phase doesn't move the deadline rate.

Run: `npm test`. Rebuild `index.html` with `node build.mjs` before committing UI work.

## B9. Build order

| # | Milestone | Ships |
|---|---|---|
| M0 | Part A settings | Oliver's phase running today, tracked by hand |
| M1 | Engine functions (B3) and tests | Nothing visible yet |
| M2 | `phases` in the store, transitions (B5), deadline rate at check-in (B4.3), phase fat floor | Phases work end to end, created from a debug/admin entry |
| M3 | Setup flow (B6 screens 1–6) | Users can create phases |
| M4 | Today strip, Progress plan line, phase-aware check-in, strength brake, ratings | The phase runs itself week to week |
| M5 | End-of-phase review and "Copy as AI prompt" | The loop closes |
| M6 | AI import (B7) | Pasting a plan from any AI works |

## Open decisions

1. **Free or premium?** Suggestion: setup and running free, the AI import premium (it's
   the metered AI cost).
2. **Rate limits.** Is the 1.25% BW confirm-to-proceed limit right, or should
   deadline mode never go past 1%?
3. **Readiness ratings.** Ask at every check-in, or only inside a phase?
