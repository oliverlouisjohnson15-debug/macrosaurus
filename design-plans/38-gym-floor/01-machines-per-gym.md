# 01 · Your gym remembers which machine you use

Needs 03 merged first, because it uses `gym.machines`.

## Evidence

- A gym stores `name`, `type`, `bench`, `pullupBar` and `equipment` only (`GymEditor`,
  `app/src/train.jsx:2264–:2270`). The owner's one gym is "Bodybuilding gym", type `bodybuilding`.
- The plans name generic machines: Stego writes "Machine fly", "Machine shoulder press" and
  "Machine row (wide grip)". The owner's gym has a Hoist fly, a Hammer Strength shoulder press and a
  Hammer Strength upper back row. These are saved as custom exercises with `variantOf` set to those
  exact library ids.
- Swapping offers two scopes. In the session, "Just today" or "The rest of the block"
  (`app/src/train-session.jsx:1645–:1660`, via `swapExercise` at `:631`). In the preview, the same
  two (`doSwap`, `app/src/train-build.jsx:1879`). Neither survives into the next block or a new
  programme, so the owner re-swaps every block. Switching from Brachio to Stego on 5 Oct meant
  starting again.
- `missingHere` (`app/src/train-core.jsx:150`) already asks "what has this gym not got?". Nothing
  asks "what does this gym have **instead**?".

## Design

`gym.machines[planExerciseId].use = myExerciseId`. "At this gym, when a plan says *Machine fly*, I
use *Hoist machine fly*."

- It's applied when a session's items are built, never written into the block. The block keeps the
  author's movement, so a different gym (or no gym) still gets the plan as written, and plan 05's
  coverage maths still reads the original movement.
- It's one level deep: a `use` that points at another mapped id is not followed further. No chains,
  no loops.
- It applies to library ids **and** to custom ids.
- The way back stays available: the item keeps `baseExerciseId` = the plan's movement, so the
  existing "back to the plan's movement" control in the picker still works (`replacedRow`,
  `train-session.jsx:~620`).

## Changes

1. **Engine: `Training.atGym(exerciseId, gym)`** returns `gym.machines[id].use` if that exercise
   exists in the library or `custom`, otherwise `id`. Also add
   **`Training.applyGym(items, gym, custom)`**, which maps a list of session items. A mapped item
   gets `exerciseId = use`, `baseExerciseId = original`, `basePlanNote = planNote`,
   `planNote = null`, `alts = null` and `gymMapped: true`, with the target, sets, warm-ups, technique
   and superset group all kept. Use `Training.replaceExercise`'s rules (`app/training.js`) so this
   behaves exactly like a manual swap. Tests: unmapped passthrough, mapped, mapped to a missing
   custom (falls back to the original), and target preserved.

2. **Session start applies it** (`app/src/train-session.jsx`).
   - In the `!existing` branch that builds items from `session.exercises` (`:218–:224`), run the
     rows through `Training.applyGym` **before** `Training.prefillSets`. Prefill then reads the
     branded machine's own history (and its parent's via `variantOf`, `training.js:1584–:1590`, when
     it has none).
   - A resumed session (`existing`) is not re-mapped. The log already says what was lifted.
   - `missingHere` runs on the mapped items, so a mapped machine is never reported missing.

3. **The swap sheet asks a third question**, in both places.
   - In `train-session.jsx` `swapScope` `ActionSheet` (`:1645`), add as the **first** action when a
     gym is set and the replacement is a machine, cable or smith movement:
     `{ label: 'Always at ' + gym.name, sub: 'Every plan that asks for ' + from.name + ' gets ' + to.name + ' here.' }`.
     It writes `gym.machines[from].use = to` and also does what "The rest of the block" does today,
     so this block's later sessions match.
   - Also offer the swap sheet when `reach <= 1`, if a gym is set. Today it's skipped then
     (`:644`), but "always at this gym" is still a real question with one session left.
   - In `SessionPreview`'s `doSwap` (`train-build.jsx:1879`), add the same `scope === 'gym'`.
   - Toast: "{to} is your {from} at {gym} now."

4. **The plan screens show your machine.** Wherever a session's movements are listed before it
   starts, show the mapped name, plus a 13px detail line "for {plan name}": `SessionPreview`
   (`train-build.jsx:1813`), TrainHome's Next card (`app/src/train-tab.jsx:266`), and the builder's
   week view. Use `Training.applyGym(Training.sessionItems(s), gym, t.custom)`; the block isn't
   changed.

5. **The gym editor lists them** (`GymEditor`, `train.jsx:2264`). Add a `Section` "Machines here"
   with one `Row` per mapping: title = your machine, sub = "instead of {plan name} · {unit spec from
   03}". Tapping a row opens an `ActionSheet` with "Stop using it here" (deletes the entry) and
   "Machine units" (the sheet from 03). Show nothing when there are no mappings.

6. **The picker puts this gym's machines first.** `ExercisePicker` (`train-session.jsx:1984`) with a
   `basedOn` lists that movement's variants (`siblings`, `:1996`). Order the ones mapped at the
   current gym first, with the label "at {gym}".

7. **One-off: seed the owner's gym from their history.** Build `Training.suggestGymMachines(logs,
   blocks, custom)` as a pure function. Wherever a log shows a plan line (`baseExerciseId` set) swapped
   to the same custom exercise **in 2 or more sessions**, propose a mapping. Show it once on Train
   home as a `BuddySays` card: "You always swap Machine fly for Hoist machine fly. Remember that for
   Bodybuilding gym?" with Yes / Not now. It's dismissible for good (`prefs.sawGymSeed`).

## Verify

- `tests/training.test.js`: `atGym`, `applyGym`, `suggestGymMachines`.
- `tests/train-resume.test.js`: a resumed session is never re-mapped.
- `?demo`: in a Stego session, swap Machine fly for a custom "Hoist machine fly" and pick
  "Always at …". Finish. Open the next Stego session: it lists Hoist machine fly with "for Machine
  fly" under it. Prefill shows last session's Hoist weights. Start a new Brachio block: no mappings
  fire unless Brachio asks for Machine fly. Switch to a second gym: it shows the plain plan.
