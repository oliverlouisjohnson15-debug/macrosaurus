# 02 · Brands are a label, not a new exercise

Needs 03 (and ideally 01) merged first.

## Evidence

- **The matcher can't see past a brand.** `Training.resolveDetail(name)` (`app/training.js:1165–1200`)
  weights tokens by rarity. A brand word is in no library name, so it scores as maximally rare and
  drags every match under the 0.34 threshold (`:1200`). Run against the library today:

  | Typed | Resolves to |
  |---|---|
  | Hammer Strength Incline Press | **none** |
  | Hammer Strength tricep extension | **none** |
  | Hammer Strength Shoulder Press | **none** |
  | Prime Leg Curl | **none** |
  | Atlantis Seated Row | **none** |
  | Life fitness tricep extension | **none** |
  | Nautilus pullover / Cybex arm curl | **none** |
  | Hoist Pec Deck | Pec deck (loose 0.59) |
  | Technogym chest press | Machine chest press (loose 0.35) |

  "Hammer" is the worst case, because it is also a real movement word (hammer curl).
- **Duplicates.** The owner has saved one machine three times: "Hammer Strength Incline Press"
  (`cu_tmswumfx5y619`, variant of `machine_incline`), "Incline Hammer Strength Press"
  (`cu_tmu0rs7nagv3r`, variant of `smith_machine_incline_press`) and "Incline Hammer Strength Press"
  (`cu_tmuxqzdsuj4ss`, variant of `machine_incline`). The third has the **same name** as the second.
  `CustomExercise.save` (`app/src/train-session.jsx:2163`) only refuses a name equal to its *parent's*.
  It never checks the names you already have.
- **Wrong defaults.** A new exercise that isn't a variation gets `pattern: 'isolation'`,
  `profile: 'mid'` (`:2170`). "Atlantis Seated Row" (no parent) is stored as isolation, so it gets an
  isolation warm-up and fills isolation gaps.
- **Imported names keep the coach's labels.** The AI importer made customs called
  "M1: standing dumbbell curl", "A2: bodyweight decline crunch" and "M2: standing cable bilateral
  cross-body extension". Its own resolver already reads A1/A2 as superset letters
  (`training.js:2525`), but the label stays in the saved name, so "M1:" and "M2:" became two
  exercises.
- `CustomExercise` still uses `pixel-box` buttons and raw hex (`#05140a`, `#1a1200`), which are
  pre-reset styling.

## Design

A custom exercise gets two optional fields:

```js
{ ...existing, brand?: 'Hammer Strength', model?: 'Iso-Lateral Incline' }
```

- **Display name** = `name` as saved. The owner's own words stay theirs.
- **Matching** strips the brand first, so "Hammer Strength Incline Press" resolves through
  "Incline Press".
- **Duplicates** are judged on (parent movement, brand), not on spelling.

## Changes

1. **Engine: a brand list and a stripper** (`app/training.js`, near `resolve`).
   - `var BRANDS = ['hammer strength','life fitness','technogym','cybex','nautilus','matrix','precor',
     'hoist','prime','atlantis','panatta','gym80','pit shark','arsenal','newtech','watson','eleiko',
     'rogue','star trac','body solid','freemotion','keiser','primal','legend','booty builder',
     'iso-lateral','iso lateral']`. Keep it sorted, with a comment saying how to add one. ("Iso-lateral"
     is Hammer Strength's line name and carries no movement meaning.)
   - `function splitBrand(name)` returns `{ brand, rest }`, matching whole words only, case-insensitive,
     longest first. Strip a leading coach label `/^[A-Z]\d+\s*[:.)-]\s*/i` the same way.
   - `resolveDetail` scores `rest`. If `rest` is empty, return none.
   - **"Hammer" on its own is not a brand.** Only "hammer strength" is. Test: "Hammer curl" still
     resolves to Hammer curl, and "Hammer Strength Incline Press" resolves to Machine incline press
     (or Incline machine press, whichever the library calls it; assert on the id).
   - Tests: every row in the table above resolves to a sensible library id.

2. **Engine: `Training.findDuplicate(candidate, custom)`** returns an existing custom when **either**
   `norm(name)` matches, **or** both the parent (`variantOf`, or the `resolve` result when there is no
   parent) and the brand match. Tests built from the owner's three incline presses.

3. **`CustomExercise` asks before minting a twin** (`train-session.jsx:2147`).
   - On Save, run `findDuplicate`. If one exists, show an inline `Row` instead of saving:
     "You already have **{existing.name}**. Use that one?" with buttons [Use it] [Save as new]. [Use it]
     calls `onDone(existing.id)`.
   - **Brand field:** a `TextInput` under Name, placeholder "Brand, if it has one". Pre-fill it from
     `splitBrand(name).brand` as the person types the name, until they edit it themselves.
   - **Movement field** for a new exercise (not a variation): "What is it most like?" opens
     `ExercisePicker` and sets `variantOf`. When chosen, it seeds the muscles, equipment, pattern and
     profile from the parent, exactly as a variation does today (`variationOf`, `training.js:3113`).
     On open, pre-fill it from `resolve(splitBrand(name).rest)` when that is a `strong` match.
   - **No parent picked:** infer `pattern` from equipment plus the muscles' movement words, using the
     same rule the importer uses (find the function `blocksFromGrid` calls to type an unknown
     movement, and reuse it, don't write a new one). Fall back to `'compound'` when it involves 2+
     primary muscles, otherwise `'isolation'`. Never default blindly.
   - **Load spec** (from 03): a "Machine units" `Row` under Equipment when equipment is machine, cable
     or smith.
   - **Reset the styling.** Muscle toggles become `.ms-chip` / `.ms-chip.on`. The title loses `pf`.
     Remove `pixel-box` and the hex colours.

4. **The picker searches brand and name** (`ExercisePicker`, `train-session.jsx:1984`). Typing
   "hammer strength" lists every custom whose `brand` matches. The brand shows as a 13px detail line
   on custom rows.

5. **Merge two exercises (user-facing, not a migration).**
   - Engine: `Training.mergeExercise(training, fromId, intoId)`. It rewrites `exerciseId` and
     `baseExerciseId` across `logs[].sets`, every block's session items, `gym.machines` keys and
     `use` values, `prefs.machineLoads`, and `exerciseNotes` keys. Then it removes `fromId` from
     `custom` and returns a count summary. It's pure apart from the object passed in. Tests: logs
     merged, PRs recomputed across both, block items repointed, nothing pointing at `fromId` remains.
   - UI: `ExerciseDetail` (`app/src/train.jsx:979`), for a custom exercise only, gets a
     "Merge into…" `Row` that opens `ExercisePicker` restricted to customs with the same parent or
     equipment. Before running, show a `ConfirmDialog`: "Move {n} sets from {from} into {into}?
     {from} is deleted. This can't be undone."
   - **Prompt for the duplicates already there:** on `TrainHistory` (`train.jsx:854`), when
     `findDuplicate` finds pairs among `custom`, show one `Row` "3 machines look saved twice" that
     opens a list of the pairs, each with [Merge]. It never merges on its own (owner decision D3).

6. **Imports stop minting coach labels.** In the importer that creates `cu_auto_*` customs (search
   `cu_auto_` in `app/training.js`), name the custom from `splitBrand(sourceName).rest` with the label
   stripped. Keep the original on the line as `sourceName`, as the programmes already do.

## Verify

- `npm test`, with new cases in `tests/training.test.js` for `splitBrand`, `resolveDetail` on the
  brand table, `findDuplicate` and `mergeExercise`.
- `?demo`: create "Hammer Strength Incline Press". Movement pre-fills as the library incline machine
  press and Brand pre-fills as Hammer Strength. Create "Incline Hammer Strength Press": it offers the
  first one. Make two duplicates with [Save as new], then open History: the merge row appears, and
  merging moves the sets and the progress chart shows both sessions.
- Screens touched pass the dead-control sweep (`tests/train-buttons.test.js`).
