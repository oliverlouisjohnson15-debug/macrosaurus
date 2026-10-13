# 38 · The gym floor: branded machines, programme balance, records that count

Written against: `77a0345` (main, after #146).
Evidence comes from reading the source and from the owner's own account data (the
`user_state.data.training` row in Supabase project `wnbksotvcjqfslrttjxy`, read-only, 12 Oct 2026):
32 sessions since 17 Aug, Brachio from 7 Sep, Stego from 5 Oct, and 37 custom exercises.

The owner's words: *"I'm struggling with branded machines."* They also asked for the programmes to be
reviewed through a classic-physique bodybuilder's eyes, and for the earlier Train improvement list to
be included.

## What the data shows

| # | Problem | Evidence | Plan |
|---|---|---|---|
| 1 | Every session the owner swaps the plan's generic machine for the branded one at their gym. Nothing remembers that choice | A gym holds only `name/type/bench/pullupBar/equipment` (`app/src/train.jsx:2266`). The swap sheet offers "Just today" or "The rest of the block" (`app/src/train-session.jsx:1645`), so the choice is lost when the next block starts | `01-machines-per-gym.md` |
| 2 | One machine saved as three exercises, so its history is split three ways | "Hammer Strength Incline Press", "Incline Hammer Strength Press" ×2, with parents `machine_incline` ×2 and `smith_machine_incline_press`. Logged as 2 / 3 / 4 sets under three ids | `02-brands-and-duplicates.md` |
| 3 | Brand words break the name matcher | `Training.resolveDetail("Hammer Strength Incline Press")` → **none**. The same for "Prime Leg Curl", "Atlantis Seated Row", "Life fitness tricep extension", "Nautilus pullover" and "Cybex arm curl". Rare tokens are weighted up (`app/training.js:1165–1200`), so a brand name swamps the score | `02` |
| 4 | A new exercise that isn't a variation is saved as an isolation movement | `pattern: seed ? seed.pattern : 'isolation'` (`app/src/train-session.jsx:2170`). The owner's "Atlantis Seated Row" is stored as `isolation` | `02` |
| 5 | Logged weights from lb-stack machines and pin-number machines are wrong | The owner's logs show 29.3, 11.3, 36.3 and 41 kg, which are 65, 25, 80 and 90 lb stacks converted to kg. Machine preacher's max is **4**, which is a pin number. Pendulum squat at 30 next to hack squat at 170 means one is per side. Units are global (`app/src/train-core.jsx:129`) and load steps are hard-coded kg (`loadUnit`, `app/training.js:1692`) | `03-machine-units.md` |
| 6 | Brachio's 29 lines all have a fixed rep target, so the progression engine swings between "add load" and "10% off" | `repLow === repHigh`. In `progressExercise`'s min-max branch (`app/training.js:1963`), hitting 6 of 6 adds load and getting 5 of 6 takes 10% off. Nothing sits in between | `04-progression-fixed-reps.md` |
| 7 | The programmes undertrain the V-taper | Weekly hard sets for side delts: Raptor 5, T-Rex 6, Brachio **3**, Stego 5. Forearms are the most-trained muscle in Raptor (9.5) and T-Rex (10.5). Brachio has **no calves** and no hinge. Stego has biceps (11) above chest and quads | `05-programme-balance.md` |
| 8 | Bodyweight sets and sets over 12 reps never count as records or progress | `e1rm` returns 0 for weight ≤ 0 or reps > 12 (`app/training.js:1469`). `prKind` returns null for weight ≤ 0 (`:1533`). A rep PR only counts at your all-time heaviest weight (`:1535`). The owner's hanging leg raises (0 kg) and pull-ups (logged as 98 kg, i.e. bodyweight typed in) show this | `06-records.md` |
| 9 | The rest alert can stay silent with the phone locked | The alert fires from an in-page interval (`train-session.jsx:313`, `restAlert` at `:1953`). Its own comment admits iOS may never deliver it | `07-rest-alert-and-wake-lock.md` |
| 10 | The screen sleeps mid-session | Wake lock exists only for Cook (`app/src/app.jsx:20870`) | `07` |
| 11 | No way to bring in history from Strong / Hevy / FitNotes | `blocksFromFile` imports plans, not logged sets (`app/training.js:4542`) | `08-history-import.md` |
| 12 | Coverage is numbers only, with no picture | `CoverageBars` (`app/src/train-core.jsx:345`) is text bars. There is no muscle map and no activity heatmap | `09-muscle-map-and-heatmap.md` |
| 13 | "How do I do this?" is answered for only a handful of lifts | `CUES` (`app/training.js:814`) covers a small set on purpose. The MIT-licensed exercises-dataset text was already cleared in `35-reset/02-opengym.md` | `10-exercise-howtos.md` |
| 14 | Known debts, written down and left | `TRAIN_AUDIT.md` "Deliberately not done". `training.js` is 6,555 lines | `11-debts-and-split.md` |

## Recommended order (one PR each)

1. **03 Machine units**, then **01 Machines per gym**. These are what hurts in the gym today.
   03 changes the shape of a custom exercise, and 01 and 02 build on that shape.
2. **02 Brands and duplicates**, including the merge tool the owner uses on their three incline presses.
3. **06 Records** and **04 Fixed reps**. Small engine fixes with tests.
4. **05 Programme balance**.
5. **07 Rest alert and wake lock**. The wake lock is tiny; the push is a spike first.
6. **08 History import**, then **09 Muscle map**, then **10 How-tos**.
7. **11 Debts and the split**, last, as it moves code that every other plan touches.

01, 02 and 03 all touch `CustomExercise` (`app/src/train-session.jsx:2147`) and the custom-exercise
shape. Do them in the order 03 → 01 → 02, and merge each before starting the next.

## Owner decisions to confirm (flag in each PR)

- **D1 · The author programmes are not edited.** Raptor and T-Rex are generated from the author's
  spreadsheets and verified cell by cell (`tools/verify-programmes.mjs`). Brachio's movements, sets
  and reps are the author's, transcribed from screenshots (`app/training.js`, comment above the
  `bb5` entry). Plan 05 does **not** change their lines. It adds an opt-in, clearly labelled
  "Macrosaurus additions" layer and the priority-muscle setting on top. Stego is ours, so it is edited
  directly.
- **D2 · Fixed reps get a hidden window.** Plan 04 lets the engine treat Brachio's "6" as 6–8 for
  progression only. The written number shown to the user stays 6.
- **D3 · Existing data is never rewritten silently.** Duplicate machines are merged by a
  user-facing "Merge into…" action (plan 02 §5), and lb/pin history is re-labelled only when the
  person confirms (plan 03 §5). No migration touches existing logs.
- **D4 · Rest push needs a server piece.** Plan 07 starts with a spike to find out whether a delayed
  web push from an edge function is reliable enough. If it isn't, ship only the wake lock.
- **D5 · Exercise media stays text-only.** The GIFs need a Gym visual licence (35-reset decision T2).

## Shared rules for the executor

- Engine: `app/training.js` (pure, no React, `module.exports = Training`). UI: `app/src/train*.jsx`.
  Store and migrations: `app/store.js`. Visual spec: `/DESIGN.md`.
- Every number lives in `training.js`, with a unit test in `tests/training.test.js` (or a new
  `tests/<topic>.test.js`). UI only reads it.
- Write comments the way the surrounding code does: say *why*, in full sentences.
- UI uses the reset primitives: `Row`, `Section`, `Sheet`, `ActionSheet`, `Seg`, `Pill`, `Btn`,
  `Field`. Do not add new primitives. In anything you touch, do not use `pixel-box`, `pixel-btn`,
  `pf`, hard-coded hex colours or text under 11px. (Note: `CustomExercise` still uses `pixel-box`.
  Plan 02 resets it.)
- New stored fields must be optional and default safely. Old data has to load unchanged. Add a
  `store.test.js` case for every new field's default.
- After any source change, run `node build.mjs` (it regenerates `index.html` and `sw.js`) and then
  `npm test`. Both must pass.
- Check the result in `?demo` at 390×844 and 320×640, in paper and dark.
- Do not put a model name in commits, code or PRs.

## What was built (13 Oct 2026)

Every plan except two parts was implemented on `ccr-887ef22b-b97l4d`, one commit each, with the full
suite green after each (1,697 tests at the end, up from 1,569).

| Plan | Status | Notes |
|---|---|---|
| 03 Machine units | Done | `Training.loadSpecFor`; kg / lb / pin / plates a side; a "Machine units" sheet on the movement menu |
| 01 Machines per gym | Done | `gym.machines[x].use`; "Always at <gym>" on the swap sheet; gym editor lists them. Deviation: "Always at" does **not** also rewrite the rest of the block, because the gym mapping already covers later sessions and the block stays as the author wrote it |
| 02 Brands and duplicates | Done | `splitBrand`, `findDuplicate`, `mergeExercise`; new-exercise sheet rebuilt. Merged movements are tombstoned, and the store now filters tombstoned customs |
| 04 Fixed reps | Done | `progressionWindow` |
| 06 Records | Done, one deviation | Pure bodyweight work does not get an estimated-1RM record (it would fire whenever the scale went up); weighted bodyweight work and reps at the same added load do |
| 05 Programme balance | Done | Stego edited; additions layer and priority muscle for the other three. The review screen's "keep this priority?" question is **not** built |
| 07 Wake lock | Done | Part B (server rest alert) not built: needs timing on a real iPhone |
| 08 History import | Done | Fixtures are written to the apps' documented layouts with invented data, **not** real exports |
| 09 Muscle map and calendar | Done | The figure is drawn in-house, so no third-party artwork or licence |
| 10 How-tos and setup notes | Done | The optional dataset-steps item is not built |
| 11 Debts | Part A done | The engine split is deferred, with the reasons in that plan's Status section |
