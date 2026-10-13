# 08 · Bring your history from Strong, Hevy or FitNotes

Needs 02 (brand stripping and `findDuplicate`) and 03 (load specs) merged first.

## Evidence

- `blocksFromFile` (`app/training.js:4542`) and `blocksFromSpreadsheet` (`app/src/train.jsx:1526`)
  import **plans**. Nothing imports **logged sets**.
- Someone switching from another app arrives with zero history. Every exercise starts blank, prefill
  has nothing to suggest, records fire on the first set of everything, and the stall detector has
  nothing to read.
- `35-reset/02-opengym.md` ranked this "Yes, the biggest switching cost" and marked it owner
  decision T1, because it adds new data to the training log.
- The log row shape the importer has to write is in `persist` (`app/src/train-session.jsx:335–:365`):
  `{ id, dateISO, blockId: null, sessionId: null, name, startedAt, notes, exerciseNotes, itemTargets,
  sets: [{ exerciseId, itemId, setIndex, type, weightKg, reps, rir, done }] }`.

## Formats (check each against a real export before building; do not guess columns)

| App | File | Columns we need |
|---|---|---|
| Strong | CSV, `;` or `,` | Date, Workout Name, Exercise Name, Set Order, Weight, Reps, (Distance, Seconds, RPE, Notes) |
| Hevy | CSV | title, start_time, exercise_title, set_index, set_type, weight_kg / weight_lbs, reps, rpe |
| FitNotes | CSV | Date, Exercise, Category, Weight (kgs / lbs), Reps, Distance, Time |

Ask the owner for one real export from each app (or a public sample). Commit them anonymised under
`tests/fixtures/history/`. The parser is written against those files, not this table.

## Design

1. **Engine: `Training.historyFromCsv(text, opts)`**, pure, in `app/training.js`. Add it next to
   `blocksFromFile`; plan 11 moves it into the import file later.
   - It detects the format by its header row and returns `{ logs, unknown: [names], format, range:
     { from, to }, sets: n }`.
   - Units: read from the column name. For FitNotes and Strong, which don't say, ask (see UI 2).
   - Set types: a Hevy `warmup` set becomes type `warmup`, `dropset` becomes `drop`, `failure`
     becomes `work`.
   - Rows are grouped into sessions by date plus workout name. Each session gets `id: 'imp_' + hash`,
     so re-importing the same file is idempotent.
   - Exercise names go through `splitBrand` (plan 02), then `resolveDetail`. A `strong` match maps
     straight to that exercise. A `loose` match or none goes into `unknown`.
   - Cardio rows (distance/time, no reps) map to `CARDIO` ids where possible and are otherwise
     dropped. Report the count.
2. **UI: a "Bring your history" flow** reached from `BlockPlace` "More" (`app/src/train-tab.jsx:843`),
   `TrainHistory` (`app/src/train.jsx:854`) when it has fewer than 5 logs, and Settings.
   - Step 1: pick a file. Show "Strong export, 412 sessions, Mar 2023 – Oct 2026".
   - Step 2: units, only if the file doesn't say.
   - Step 3: **match the names.** One `Row` per unknown name, with the detected match as its sub and
     a tap to change it through `ExercisePicker`. At the top: "Make the rest custom exercises", which
     creates customs with `variantOf` set to each loose match, routed through `findDuplicate` so
     nothing is duplicated. This step is where branded machines from another app turn into
     variations here.
   - Step 4: confirm. "Add 412 sessions to your history. Sessions already here on the same day are
     kept, and imported sets go alongside them."
3. **Merge rule:** imported logs are appended. An import never edits or deletes an existing log. A
   log whose `id` already exists is skipped, which is what makes it idempotent.
4. **Size:** the user's whole state is one JSONB row (`user_state.data`). Three years of history can
   be thousands of sets. Measure the resulting payload in the PR. If it adds more than about 1 MB,
   stop and raise it with the owner before shipping. Never truncate silently.

## Verify

- `tests/history-import.test.js`: one fixture per app. Session count, set count, units, set types,
  idempotent re-import, unknown names listed, brand-named rows resolved.
- After import in `?demo`: `ExerciseDetail` charts the imported history, prefill uses the last
  imported weight, and records don't fire on a set below the imported best.
