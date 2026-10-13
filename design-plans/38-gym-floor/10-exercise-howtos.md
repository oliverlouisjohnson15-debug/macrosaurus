# 10 · How to do it, and how this machine is set up

## Evidence

- `CUES` (`app/training.js:814`) holds hand-written setup notes, deliberately not one per exercise:
  "most movements have no gotcha worth a sentence". `PROFILE_WHY` explains where a movement is
  hardest. Both show in the `?` sheet (`TrainHelp`, `app/src/train-session.jsx:1782`).
- The four programmes use **59** distinct movements (**133** counting their alternatives). Only
  **20** of those 133 have a cue.
- `planNote` covers some of the gap: it's the author's note on the line. But it disappears the moment
  a line is swapped (`replacedRow`), and it never applies to a custom machine.
- **Branded machines have a problem nobody else covers:** setup. Seat height, back pad, pin position
  and handle choice differ by brand and are the first thing a person forgets. The owner's only place
  for this is the session note, which is per session, not per machine.
- Exercise text is available under MIT from hasaneyldrm/exercises-dataset, cleared in
  `35-reset/02-opengym.md`. Its media is not (owner decision D5: text only).

## Changes

1. **Write cues for all 59 programme movements** that lack one, in `CUES`. Follow the existing rule:
   one or two sentences, only the thing people get wrong that costs them the target muscle, in the
   house voice. Where a movement truly has no gotcha, leave it out and list it in the PR as
   deliberately skipped. Have the owner read the list before merge; these are training claims.
2. **Machine setup notes, per gym.** Extend plan 01's `gym.machines[exerciseId]` with
   `setup?: string` (max 120 chars).
   - In the session, the movement's `⋯` menu gets "Machine setup". It opens a `Sheet` with a
     `TextInput` and placeholder "Seat 4, back pad 2, neutral handles".
   - Once set, the setup line shows under the movement name in the session as a 13px detail line,
     **before** the first set is ticked, and hides after that. You need it while adjusting the
     machine, not mid-set.
   - With no gym set, store it on the custom exercise (`setup`). Library exercises without a gym:
     `prefs.machineSetup[exerciseId]`. Resolution order is the same as plan 03's load spec, and it
     reuses the same resolver shape.
3. **Steps from the dataset (optional, owner decision).** A build-time script,
   `tools/import-exercise-text.mjs`, reads the dataset's JSON, matches names with `resolveDetail`,
   and writes `app/exercise-steps.json` (`{ id: [step, step, …] }`, English only, strong matches
   only). It's loaded lazily the way `foods-uk.json` is (`app/src/app.jsx:14665`). `ExerciseDetail`
   (`app/src/train.jsx:979`) shows a collapsed `Section` "Steps" when an entry exists. Commit the MIT
   notice. Skip this step if the owner would rather keep only hand-written text.
4. **A custom exercise with a parent shows the parent's cue** under "From {parent name}:", the same
   way `lastReference` borrows a parent's history (`app/training.js:1576`). A Hoist pec deck gets the
   pec deck cue.

## Verify

- A test that every programme movement either has a cue or is in an explicit `NO_CUE` list in the
  test (so a new programme line forces a decision).
- `?demo`: add a setup note to Machine fly at the demo gym. The next session shows it under the name
  until the first tick. A second gym doesn't show it.
