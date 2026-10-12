# 06 · Records and progress count bodyweight, high reps, and reps at any weight

## Evidence

- `e1rm(weightKg, reps)` returns 0 when the weight is 0 or less, or the reps are over 12
  (`app/training.js:1469–:1474`).
- `prKind` returns null when the weight is 0 or less (`:1530–:1533`). The session's PR hook also
  requires `filled.weightKg > 0` (`app/src/train-session.jsx:512`).
- A "most reps" record only counts at your **all-time heaviest** weight (`:1535`). Beat your reps at
  any lighter weight and it doesn't register. Double progression lives at a working weight below the
  heaviest you've ever touched.
- The owner's data shows all three:
  - Hanging leg raise (7 sets) and dragon flag log 0 kg, so they can never set a record or chart.
  - Pull-up (wide) is logged at 98 kg. That's bodyweight typed into the weight box, because nothing
    else would make it count.
  - Lateral raises and similar movements done at 13–20 reps chart nothing.
- The session's PR check (`train-session.jsx:513–:521`) re-implements the "fold in this session's
  earlier sets" merge that `prsInLog` already does (`training.js:1549–:1554`). Two copies of the same
  rule will drift.

## Design

1. **Bodyweight movements use effective load.** For `equipment === 'bodyweight'` (and any exercise
   with `bodyweight: true`, for weighted dips and pull-ups that live under another equipment), the
   weight box means **added** load. It shows a `+` prefix and the suffix "kg added". It can be
   negative for an assisted machine, and then shows "kg assist".
   - Each set stores its added load in `weightKg`, as today, plus `bwKg`: the body weight on that
     day, snapshotted when the set is ticked. Snapshotting means a later weigh-in never rewrites old
     records.
   - Effective load = `bwKg + weightKg`. It's used for e1RM, records and progress. Tonnage stays
     on added load only, so a 3-hour plank day doesn't look like 10 tonnes.
   - Body weight comes from the latest weigh-in on or before the session date (find the store helper
     the nutrition side uses for the weight trend). Fall back to `db.profile.weightKg`, the same
     source `StatSheet` uses (`app/src/train.jsx:2678`). If neither exists, `bwKg` stays null and the
     set behaves as today.
2. **Above 12 reps, no e1RM, but records still count.** Keep the cap. Epley is unreliable past 12,
   and that's why the cap is there. A set over 12 can still set a **weight** record or a **reps at
   this weight** record. Progress charts for a movement whose sets are mostly over 12 reps plot
   "best set": the heaviest weight lifted for at least the line's `repLow`, labelled with its reps.
3. **Reps PRs at any weight you've used before.** `bestBefore` tracks `repsAt: { [weightKey]: reps }`,
   keyed to 0.01 kg. "Most reps at 60 kg" fires whenever this set beats the best reps ever done at
   60 kg, at least once before. A weight never used before is not a reps record. It's either a
   weight record or nothing, as today.

## Changes

1. **Engine** (`app/training.js`):
   - `function effectiveLoad(set, ex)` returns `(+set.bwKg || 0) + (+set.weightKg || 0)` for
     bodyweight movements, else `+set.weightKg || 0`. Export it.
   - `bestSet`, `computePRs`, `bestBefore`, `prsInLog` and `exerciseHistory` take an optional
     `custom` (to look up the exercise) and use `effectiveLoad` wherever they read a weight.
     `prKind(load, reps, best)` accepts a load of 0 or less only when it came from an effective load
     above 0.
   - `bestBefore` returns `repsAt`. `prKind` checks `repsAt[key(load)]` for the `reps` kind. The
     old `repsAtBest` stays, so existing callers work.
   - **One merge function:** `foldSessionSets(best, priorSets, custom)`, taken out of `prsInLog`.
     The session calls it instead of its inline copy (`train-session.jsx:513–:521`).
   - `exerciseHistory` returns `metric: 'e1rm' | 'bestSet'` per movement, by the rule in Design 2.
   - Tests: a bodyweight pull-up at +0 with bwKg 80 sets a record over a previous +0 at bwKg 78.
     15 reps at 20 kg is a reps record over 13 at 20 kg. 10 reps at 50 kg is a reps record when your
     heaviest is 60 kg. The heaviest-weight record behaves exactly as today.
2. **Session** (`app/src/train-session.jsx`):
   - The weight input for a bodyweight movement shows "+" and "kg added". It allows negative values,
     which display as "kg assist".
   - On tick, write `bwKg` onto the set.
   - The PR hook drops `filled.weightKg > 0` and calls `Training.prKind(Training.effectiveLoad(...), ...)`
     after `foldSessionSets`.
   - `PRFlash` (`app/src/train.jsx:2495`) words a bodyweight record as "Bodyweight + 10 kg × 8".
3. **Charts** (`ExerciseDetail`, `app/src/train.jsx:979–:1040`; `TrainProgress`, `:2878`): read
   `metric`. With `bestSet`, the headline is "60 kg × 15" and bars scale on weight. The label says
   "best set", not "est. 1RM".
4. **The owner's typed-bodyweight pull-up.** Any bodyweight-movement set logged before this ships
   with `weightKg` within 10% of the body weight on that date (or of `db.profile.weightKg`) is almost
   certainly bodyweight typed in. Do **not** rewrite it. In `PastSets`, show those sets as
   "98 kg (bodyweight?)" with a one-tap "That was my bodyweight" that sets `bwKg` to the value and
   `weightKg` to 0 for that one exercise's past sets. Owner decision D3: confirmed, never silent.

## Verify

- `npm test`, with the new cases above, plus `tests/train-resume.test.js` for a resumed session
  keeping `bwKg`.
- `?demo`: log hanging leg raises at +0 for 10, then 12 the next session. A reps record fires.
  Log a lateral raise 12 kg × 15, then 12 kg × 17: a reps record fires, and the exercise page charts
  "best set".
