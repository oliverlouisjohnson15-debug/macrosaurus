# 03 · Every machine logs in the units it actually shows

Do this first. Plans 01 and 02 build on the `gym.machines` map introduced here.

## Evidence

- Units are one global setting: `prefs.units` is `'kg'` or `'lb'`. `toDisplayWeight` and
  `fromDisplayWeight` (`app/src/train-core.jsx:129–131`) convert every weight with that one setting.
- Load steps are hard-coded in kg: `loadUnit(ex)` returns 2 for dumbbells and 2.5 for everything else
  (`app/training.js:1692`). `loadStep`, `backOffLoad` and the "10% lighter" branch of
  `progressExercise` (`:1696`, `:1714`, `:1985`) all round to those steps.
- In the owner's data:
  - Overhead cable triceps extension max 29.3, Bayesian curl 11.3, seated machine lateral 36.3,
    machine lateral 41. These are lb stacks (65 / 25 / 80 / 90 lb) typed into a kg app, or converted
    by hand.
  - Machine preacher max **4**. That's a pin position, but it's stored as 4 kg.
  - Pendulum squat 30 next to hack squat 170. Plate-loaded, entered per side.
- What goes wrong:
  1. The progression engine tells someone on a 10 lb stack to add 2.5 kg, a step the machine can't
     make.
  2. "Pin 4" is counted as 4 kg in tonnage, e1RM and the strength stats (`StatSheet`,
     `app/src/train.jsx:2672`, which compares against bodyweight multiples).
  3. A per-side entry halves the true load.

## Design

Each exercise resolves to a **load spec**:

```js
// unit:    'kg' | 'lb' | 'pin'   - what the machine's own numbers are
// step:    smallest jump the machine can make, in `unit` (kg 2.5, lb 5, pin 1, dumbbell kg 2)
// perSide: true when you enter plates on one side of a plate-loaded machine
{ unit: 'lb', step: 10, perSide: false }
```

It resolves in this order, so the most specific answer wins:

1. `gym.machines[exerciseId].load`. **This** machine at **this** gym, because the same "machine
   preacher curl" is a pin stack in one gym and a plate-loaded Hammer Strength in another.
2. `customExercise.load`, the default saved with a custom exercise.
3. The default for its equipment: `{ unit: prefs.units, step: dumbbell ? 2 : 2.5 (kg) or 5 (lb),
   perSide: false }`.

### Storage

- Sets keep `weightKg`, so every existing log, test and chart keeps working.
  - For `kg` and `lb` specs, `weightKg` is a true kilogram figure, converted from lb on entry exactly
    as `fromDisplayWeight` does today.
  - For `pin`, `weightKg` holds the **pin number**, and the set also carries `unit: 'pin'`. Every
    reader that sums or compares kilograms skips sets with `unit === 'pin'` (see Changes 4).
  - For `perSide`, `weightKg` holds the **total** (entered value × 2, plus `base` if set). The input
    and the plate sheet show per side. Totals are what make the pendulum and hack squat comparable,
    and what tonnage needs.
- New shape on a gym: `gym.machines = { [exerciseId]: { load?: LoadSpec } }`. Plan 01 adds `use` to
  the same entry. It's optional; a gym without it behaves exactly as today.
- New optional field on a custom exercise: `load?: LoadSpec`.

## Changes

1. **Engine: `Training.loadSpecFor(exerciseId, opts)`** in `app/training.js`, next to `loadUnit`.
   - `opts = { gym, custom, units }`. Returns a full spec with defaults filled in. Pure.
   - `loadUnit(ex, spec)` takes an optional spec. When one is given, it returns `spec.step` converted
     to kg (`lb` → `step / 2.20462`; `pin` → `step` in pin numbers). Without one, it behaves exactly
     as today.
   - Thread `spec` through `loadStep`, `backOffLoad` and `progressExercise` (`opts.spec`) and
     `prefillSets` (`opts.spec`). Every caller that doesn't pass one gets today's numbers.
   - Rounding for lb: round in lb to `step`, then convert. That way a suggestion lands on a number
     printed on the stack (e.g. 70 lb, never 69.4).
   - Tests: lb stack with step 10 → next load is +10 lb; pin step 1 → +1; perSide plate machine with
     step 2.5 per side → +5 total; no spec → identical results to today for every existing test.

2. **Session: show and enter in the machine's unit** (`app/src/train-session.jsx`).
   - When building `items` (`:190–:224`), resolve `spec` once per item with `Training.loadSpecFor`
     (`gym` is already in scope via `missingHere(items, gym, …)` at `:289`).
   - The weight input (`:1266`) uses a new `fromMachine(v, spec)` / `toMachine(kg, spec)` pair in
     `train-core.jsx` beside `fromDisplayWeight`. Its suffix label reads `kg`, `lb`, `pin`, or
     `kg a side` / `lb a side`.
   - `PlateSheet` (`:1918`) is hidden for `pin`. For `perSide` it shows one side only.
   - The movement's `⋯` menu gets a row **"Machine units"** with the current spec as its sub
     ("lb stack · 10 lb jumps"). It opens a small `Sheet`:
     - `Seg` for kg / lb / pin
     - a step `Seg` whose choices depend on the unit (kg: 1 / 1.25 / 2.5 / 5; lb: 2.5 / 5 / 10 / 15;
       pin: 1)
     - a "Plates, one side" toggle, shown only for kg/lb
     - a line saying where it's saved: "Saved for this machine at {gym name}". It writes to
       `gym.machines[exerciseId].load`. With no gym, it writes to the custom exercise's `load`, or to
       a new `prefs.machineLoads[exerciseId]` for library exercises. Add that last one to the
       resolution order between 1 and 2.
   - When a spec is changed mid-session, convert the sets already typed so the numbers on screen
     don't jump.

3. **Everywhere a weight is shown for a lift.** Use `toMachine(kg, spec)` and the spec label instead
   of `toDisplayWeight(kg, units)`. Call sites: `PastSets` (`train-session.jsx:1803`), `ExerciseDetail`
   (`train.jsx:979`), `TrainProgress` (`train.jsx:2878`), `PRFlash` (`train.jsx:2495`) and
   `SessionSignOff` (`train.jsx:2552`). History screens resolve the spec with the **current** gym; a
   set logged as `unit: 'pin'` always shows as a pin.

4. **Readers that sum kilograms skip pin sets.** `tonnage` and `setVolume` (`training.js:1475–1480`),
   the strength stats (`:2126–:2200`), and any bodyweight-multiple comparison. Records and e1RM
   *within* a pin exercise still work, because they only compare that exercise with itself.

5. **Repair the owner's history (optional, owner says yes or no).** A one-off function,
   `Training.relabelLoads(logs, exerciseId, spec, { fromISO })`, rewrites past sets of one exercise:
   it marks pin sets, or re-converts kg values that were really lb. It's offered only from the
   "Machine units" sheet: "Your last N sessions on this machine look like {lb}. Convert them?"
   Detection rule: ≥ 3 logged values whose kg→lb conversion lands within 0.3 lb of a multiple of 5.
   Always ask; never convert silently.

## Verify

- `npm test` passes, including new `tests/machine-units.test.js` covering resolution order, steps,
  rounding and the pin exclusions.
- In `?demo`: open a session, set Machine preacher curl to pin, step 1. Enter 4, finish, and the
  next prescription says pin 5 after a top-of-window set. Tonnage on the sign-off excludes it.
- Set Overhead cable triceps extension to lb, step 5. Typing 65 shows 65 lb; Past sets shows 65 lb.
  After a reload it still shows 65 lb.
- Pendulum squat with plates per side: type 30, Past sets shows "30 kg a side", and tonnage counts 60.
