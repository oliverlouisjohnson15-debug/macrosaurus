# 39 · Pick your kit: a general line in a programme is a slot you fill, not a movement we chose

Written against: `8205b55` (branch `ccr-27bdf7ad-iqy10n`, PR #167 open, not merged).

## The problem in one sentence

Olly's PPL Hybrid says **"Incline Press"**. That is not a movement. It is a *job* (press at an incline)
that a machine, a pair of dumbbells, a barbell or a Smith machine can do. Today the app silently turns it
into "Incline machine press", and the person finds out at the gym.

PR #167 made the first fix: these lines became either/or choices you can switch at the workout. That
is still wrong in two ways:

1. **The app still answers first.** The machine is selected until you tap something else, so the plan,
   the preview's time estimate, the volume maths and last week's weights all assume a machine nobody
   picked.
2. **It asks at the worst moment.** Mid-gym, between sets, a row of four small buttons on a card you
   are trying to log into. This is a setup decision. It belongs with "when do you start" and "which
   days", before the first session.

## Evidence

- **Choices today.** A line carries `choice: { key, label, options }` and an `exerciseId` that is
  already one of the options (`app/training.js`, programme templates; `blockChoices` at
  `training.js:4467`). Nothing records whether a person has *answered* it. `exerciseId` is always set,
  so every reader (prefill, volume, coverage, time estimate) treats the first option as the plan.
- **Where they surface.** The builder's "left up to you" section (`train-build.jsx:501`, only behind
  "Customise first") and `ChoiceToggle` in the session (`train-core.jsx:792`,
  `train-session.jsx:~1286`). There is no step in the normal start flow.
- **Start flow.** Programme preview → `StartProgrammeSheet` "When do you start?"
  (`train-tab.jsx:410`) → `startBlock` → `go('schedule', { fresh: true })` → `ScheduleDays`
  "Which days?" (`train-build.jsx`). That is two steps, and kit is not one of them.
- **Memory that already exists.** `gym.machines[planId].use` (`training.js:2813`, `atGym`,
  `applyGym`) maps "when a plan says X, at this gym I use Y". It is applied when a session is built
  and never written into the block. `Training.gymEquipment(gym)` + `missingHere`
  (`train-core.jsx:193`) know which kinds of kit a gym has.
- **Two different kinds of choice are being treated as one.**
  - *Author's either/or* (Quinton: "Pendulum squat or barbell back squat"). The author named two real
    movements and had a preference. A default is honest.
  - *General line* (Olly: "Incline Press", "Shrugs", "Shoulder Press"). The author named a job. No
    option is the author's. A default is us inventing the plan.

## Design decision

**A general line is a *slot*. A slot has no movement until the person fills it, and a programme
cannot start with an empty slot.** Filling slots is a step in the start flow called **Your kit**,
between "When do you start?" and "Which days?". Its answers are remembered, so the second programme
you start asks almost nothing.

Author either/or lines are *not* slots. They keep their default, appear on the same step under
"Already set", and stay switchable at the workout exactly as today.

This is the "forced wizard" option, kept cheap:

- It appears **only when a programme has slots** (Quinton's PPL Plus has none, so its flow is
  unchanged).
- Slots you have answered before are **pre-filled** from your memory, so it is one tap ("Next: your
  days") rather than seven.
- Options your current gym does not have are not offered. If that leaves exactly one, the slot fills
  itself and says so.

### Why forced, not optional

An optional step is skipped, and a skipped slot falls back to a guess, which is the bug we have now.
The cost of forcing it is a few taps once per kind of movement per person. The memory pays that back
on every later programme. The step can't be dismissed, but it is never more than one screen.

## The flow

```
Preview: PPL Hybrid                      Start this programme  (gold)
  └─ Sheet: When do you start?           Today | Next Monday
            Next: your kit               (gold; "Next: your days" when there are no slots)
     └─ Screen: Your kit                 step 2 of 3
          └─ Screen: Which days?         step 3 of 3    Start PPL Hybrid (gold)
```

### Screen: Your kit

A full screen (not a sheet). It is a step with a title, like "Which days?". It follows `DESIGN.md`:
one Section per group, Rows of at least 56px, a 24/700 step title, gold used once.

```
‹ Back                         Your kit                    2 of 3
─────────────────────────────────────────────────────────────────
Your kit                                                   (24/700)
PPL Hybrid leaves 7 lines up to you. Pick what you'll use;
you can change any of them later.                          (15/400)

Pick one                                            5 to go   ← Section, right = count
──────────────────────────────────────────────────────────────
[▦] Incline press                              Choose  ›
    Upper · 2 × 6–10
[▦] Flat press                                 Choose  ›
    Upper · 2 × 6–10
[▦] Shoulder press                   Dumbbells (usual) ›     ← pre-filled from memory
    Push · 3 × 10
[▦] Lateral raises                             Choose  ›
    Push · 3 × 10–15
[▦] Cable extension                            Choose  ›
    Push · 2 × 12
[▦] Shrugs                              Machine (gym) ›      ← only one option at this gym
    Pull · 3 × 10
[▦] Supinated curl                             Choose  ›
    Pull · 2 × 8–12

                 [ Pick 5 more ]   (B style, disabled)
        → once all filled:  [ Next: your days ]   (A, gold)
```

- **Row title** is the slot's own name, as the author wrote it ("Incline press"). **Detail** is where it
  appears and its prescription (`Upper · 2 × 6–10`, or `Upper, Push · …` when one slot key spans two
  days). **Trailing value** is the pick in short form ("Dumbbells", "Machine", "Barbell", "Smith") in
  `--text`, or **"Choose"** in `--link` while empty.
- **"(usual)"** marks a pre-filled answer from memory; **"(gym)"** marks one forced by the gym's kit.
  Both are 13/400 `--muted`. They tell the person the app filled it and why.
- **Count** on the Section's right: "5 to go", then "All set".
- **The button** says what is missing ("Pick 5 more") until every slot is filled. It never sits there
  disabled without saying why.
- When the programme also has author either/or lines, a second Section **"Already set"** lists them
  the same way with the author's default filled in and "(plan)" beside it. These rows don't count
  toward "to go".

### Sheet: choosing for one slot

Tapping a row opens a `Sheet` with a `Menu`:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            ───
Incline press                                 ✕      (20/700 sheet title)
Upper · 2 × 6–10                                      (13 muted)

 ▶ Machine          Incline machine press             ← ▶ cursor on the current pick
   Dumbbells        Incline dumbbell press
   Barbell          Incline barbell press
   Smith machine    Smith machine incline press
   ─────────────────────────────────────────
   Something else…  Search the library               ← text row, opens ExercisePicker
                                                        filtered to the slot's pattern

 [✓] Use this for incline press in other programmes   ← Toggle, on by default
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- Each `Menu` row is 44px or taller: the **kit** in 15/600 as the title, the real movement name as
  13/400 detail. People choose by kit ("I'll use dumbbells"), and the movement name confirms what that
  means.
- Choosing a row fills the slot and closes the sheet. There is no separate confirm, so the fastest path
  is one tap per slot.
- **Not at this gym**: when a gym is set, options it lacks are shown last, dimmed, with the detail
  "Not at Bodybuilding gym". They stay selectable, because people train at more than one gym and the
  equipment list is often incomplete.
- **Something else…** opens the existing `ExercisePicker` seeded with the slot's movement pattern (the
  options' shared `pattern`, e.g. `horizPress` with an incline profile), so a branded machine or a
  custom exercise can fill a slot. A custom exercise saved with `variantOf` = one of the options counts
  as that kit.
- **The toggle** writes the answer to memory (below). Turning it off answers this programme only.

### After the start: where a slot shows up

| Surface | Before (PR #167) | After |
|---|---|---|
| Programme preview, unstarted | "Incline press: machine, dumbbell, barbell or Smith" | **"Incline press"** with a 13px `--muted` "your pick" after it |
| Programme preview of *your* running block | the machine | **"Incline dumbbell press"** (the answer) |
| Session card header | "Incline machine press" + 4 chips + a label line | **"Incline dumbbell press"**, with a one-line subtitle under the title: `Incline press · Dumbbells · Change` (Change in `--link`) |
| Session "Change" | (chips) | the same choosing sheet, plus the existing scope question: **Just today** / **The rest of PPL Hybrid**. Locked once a set is ticked, as now |
| My programme → new row | — | **"Your kit"** Row in the programme's More list: detail "7 picks · change any", opens the Your kit screen in edit mode (no step counter, button "Save") |
| Customise first (builder) | "left up to you" section | the same Section/Rows as Your kit, so there is one design for this, not two |

The four chips go. A row of buttons on the logging card was the wrong control for a decision you make
once.

## Data model

### 1. Slots are a library, not strings in one programme

A new table in `app/training.js`, next to `EXERCISES`:

```js
var SLOTS = {
  incline_press:  { name: 'Incline press',  options: [
      { kit: 'Machine',   id: 'machine_incline' },
      { kit: 'Dumbbells', id: 'db_incline' },
      { kit: 'Barbell',   id: 'bb_incline' },
      { kit: 'Smith',     id: 'smith_machine_incline_press' } ] },
  flat_press:     { name: 'Flat press',     options: [ machine_press, db_bench, bb_bench, smith_bench ] },
  shoulder_press: { name: 'Shoulder press', options: [ machine_ohp, db_ohp, seated_machine_press, bb_ohp ] },
  lateral_raise:  { name: 'Lateral raises', options: [ db_lateral, cable_lateral, machine_lateral ] },
  cable_extension:{ name: 'Cable extension',options: [ overhead_ext_cable, rope_pushdown, triceps_pressdown ] },
  shrugs:         { name: 'Shrugs',         options: [ shrug_db, shrug_machine, shrug_bb, smith_shrug ] },
  supinated_curl: { name: 'Supinated curl', options: [ db_curl, ez_curl, cable_curl, bayesian_curl ] },
};
```

Slots are shared across programmes and keyed by **job**, not by programme. That is what makes memory
work: "Flat press → Dumbbells" in PPL Hybrid also answers a flat press in any other programme. The
option order is display order and carries no preference.

### 2. A programme line names a slot instead of a movement

```js
{ slot: 'incline_press', target: {...}, warmups: 3, sourceName: 'Incline Press' }   // no exerciseId
```

`programmeBlock` expands it into a block line:

```js
{ exerciseId: <answer or null>, slot: { key: 'incline_press', answered: <bool>, by: 'memory'|'gym'|'you'|null }, ... }
```

**`exerciseId` may be `null` on an unanswered slot, but only in a block that has not started.**
That is the rule everything else depends on, so it gets a guard:

- `Training.unfilledSlots(block)` returns the unanswered slot lines.
- `startBlock` (`train-tab.jsx:~80`) routes to `kit` when `unfilledSlots(blk).length`, otherwise to
  `schedule` as today.
- `ScheduleDays`' Start button and `Training.programmeBlock(..., { startISO })` both refuse a block
  with unfilled slots. **Stop condition:** if any engine reader is found handling a null `exerciseId`
  some other way, fix the reader rather than defaulting the slot.
- Readers that run on an unstarted block (the preview's minutes and sets, `blockWeekVolume`,
  `coverage`) count an unfilled slot by its **slot's shared muscles**, which all its options share
  (same `primary`). Add `Training.slotMuscles(key)` and use it in the volume path when `exerciseId`
  is null. That way the preview's "81 sets/wk" and coverage stay right before you pick.

### 3. Memory

`tr.prefs.kit = { incline_press: 'db_incline', flat_press: 'machine_press', ... }`. It is written when
the toggle is on and read by `programmeBlock` to pre-fill (`by: 'memory'`).

Layering, from most to least specific, applied when a session is built:

1. **Gym** (`gym.machines[answer].use`, existing): "at this gym the dumbbell incline is the Hoist
   one". Unchanged.
2. **Block** (`slot.answered` + `exerciseId`): what this programme was started with.
3. **Person** (`prefs.kit`): only used to pre-fill a new block, never read live.

A gym can also force a slot (`by: 'gym'`) when `gymEquipment` leaves exactly one option. That is a
pre-fill too, shown with "(gym)", and still changeable.

### 4. Existing data

- Author either/or lines (`choice`) stay exactly as they are. `blockChoices` keeps working, and the
  builder's section shows them under "Already set".
- **PR #167's choices on PPL Hybrid are replaced by slots.** PPL Hybrid is not merged into anyone's
  running block yet (#167 is unmerged; #166 shipped it with fixed machines). A block someone already
  started from #166 keeps its `exerciseId`s. Migration: when a block has `sourceRef.name === 'pplh5'`
  and no `slot` fields, mark those seven lines as `slot: { key, answered: true, by: 'you' }`. They
  then show the slot subtitle and Change, and nobody is asked again mid-programme.

## Changes

1. **Engine** (`app/training.js`)
   - `SLOTS`, `slotOf(key)`, `slotMuscles(key)`, `unfilledSlots(block)`,
     `fillSlot(block, key, exerciseId, { fromWeek })`. `fillSlot` is `applyChoiceFrom`'s rule, and it
     fills every line with that key from `fromWeek` on.
   - `programmeBlock`: expand `slot` lines, pre-fill from `opts.kit` and `opts.gym`.
   - `templateOf` / sharing: a shared block keeps `slot` on its lines, so a community copy of
     PPL Hybrid asks its new owner too.
   - Volume, coverage and minutes estimates: handle `exerciseId == null` via `slotMuscles`.
   - PPL Hybrid template: the seven general lines become `slot:` lines. Revert #167's `choice`
     fields on them.
   - Migration for already-started pplh5 blocks (Data model §4).
2. **Your kit screen** (`app/src/train-build.jsx`, new `KitStep`, next to `ScheduleDays`): Section +
   Rows, `SlotSheet` (Sheet + Menu + Toggle + "Something else…"), step counter, and the gold button
   that says what's missing. It has two modes: `fresh` (a step; Next goes to `schedule`) and `edit`
   (Save, from My programme).
3. **Start flow** (`app/src/train-tab.jsx`): a `kit` screen route. `startBlock` routes there when
   slots are unfilled. The `StartProgrammeSheet` button reads "Next: your kit" when
   `programmeHasSlots(key)`. Back from Which days? goes to Your kit when the programme has slots.
4. **Session** (`app/src/train-session.jsx`): replace `ChoiceToggle` on slot lines with the subtitle
   line + Change → `SlotSheet` → existing scope `ActionSheet` (Just today / Rest of programme).
   Author either/or lines keep `ChoiceToggle`. Remove the label line added in #167.
5. **Preview** (`train-tab.jsx` programme preview): show the slot name + "your pick" for unfilled
   slots and the answer for filled ones. Remove #167's long label.
6. **My programme**: add the "Your kit" Row (only when the block has slots).
7. **Builder**: render slots + either/or through the same Section as Your kit.

## Validation

- **Product (the case that started this):** start PPL Hybrid fresh, with no memory and no gym. You
  can't reach Which days? until seven slots are picked. The button counts down. Each pick is one tap.
  The first session shows exactly the kit you picked, with no machine you didn't choose.
- **Memory:** start PPL Hybrid a second time. All seven are pre-filled "(usual)", and the step is one
  tap.
- **Gym:** with a gym that has no barbell, the barbell options are last and dimmed, labelled
  "Not at <gym>". With a gym that has one shrug option, Shrugs is pre-filled "(gym)".
- **No slots:** PPL Plus, Express Four and the others start exactly as today (When → Which days). No
  new step, and the button reads "Next: your days".
- **Mid-programme change:** Change on a slot in week 2 → "The rest of PPL Hybrid" changes weeks 2–4
  and leaves week 1's log and plan alone (`fillSlot` `fromWeek`).
- **Preview before start:** sets/week and coverage are unchanged whether or not slots are filled.
- **Interface:** 390×844 and 320×640; paper and dark; the longest slot detail ("Upper, Push · 2 ×
  8–12") truncates cleanly. The sheet's Menu rows are at least 44px. There is exactly one gold
  button per screen.
- **Repository:** `node build.mjs && npm test` with no new failures (the one known
  `cycle-strip` check-in test fails on `main` too), and the design detector reports 0. New tests:
  - `programmeBlock('pplh5')` has 7 unfilled slots and null `exerciseId`s, and `startBlock` routes
    to kit.
  - Filling all seven unlocks Which days?. A filled slot with the toggle on writes `prefs.kit`.
  - The second `programmeBlock('pplh5', { kit })` has 0 unfilled.
  - The gym filter and auto-fill.
  - `fillSlot` from week 2 leaves week 1.
  - Volume with unfilled slots equals volume with any filled answer.
  - Migration of a #166-started pplh5 block marks the slots answered and changes no `exerciseId`.
  - PPL Plus start flow is unchanged.

## Scope

- In: shipped programmes (PPL Hybrid now; any future programme that writes `slot:`), the start flow,
  My programme, the builder, the session, the preview.
- Out (follow-ups):
  - Spreadsheet/community **imports** that write general names. The importer could later map
    "Incline Press" → `slot: 'incline_press'` with an alias table like the exercise resolver's.
  - Slots for programmes other than PPL Hybrid. Express Four etc. name real movements, so this
    doesn't apply.
  - Per-slot **rep/rest differences by kit**: a barbell incline might want longer rest than a machine.
    Your Rest between sets setting already covers rest.

## Stop conditions

- An engine path that cannot treat a null `exerciseId` on an unstarted block without a default. Stop
  and report it; don't paper over it with `options[0]`, which is today's bug.
- `ExercisePicker` cannot be seeded by pattern without a change wider than a prop. If so, ship
  "Something else…" in a follow-up rather than widening this.

## What to do with PR #167

Don't merge it. Its one useful part (the seven lines are choices, not fixed machines) is superseded by
slots. Close it once this plan's PR is up, or merge it only if PPL Hybrid needs to be usable at the gym
before this is built. That is a judgement for Olly.

## Rough size

Engine + tests about 1 day. Your kit screen + sheet about 1 day. Session/preview/My programme/builder
wiring about half a day. Total about 2.5 days of focused work, in three PRs (engine → screens →
session/cleanup) or one if done together.

## As built (differences from the plan above)

- **Not forced (Olly's call after the plan).** Your kit is offered between "When do you start?" and
  "Which days?", and "Next: your days" is always available ("The N you leave will be asked at the
  gym"). An unpicked line opens in the session as **What are you using?**: the kit as four 56px
  buttons, plus "Something else". Its set rows stay hidden until something is picked. A pick made
  there or on Your kit fills that line from this week to the end of the programme and is
  remembered, so it is all defined during week one and set after that unless changed.
- **No null `exerciseId`.** A template slot line keeps its first option as a placeholder, and
  `slot.answered` says whether anyone picked it. Every option in a slot shares the placeholder's
  muscles, so volume, coverage and the time estimate need no special path. The placeholder is never
  shown as a pick: the preview says "Incline press · your pick", the home card "Opens with Incline
  press", and the session card and its sticky bar say "Incline press" until it is answered.
- **Session Change** applies from this week to the rest of the programme, like an author's "or" line.
  There is no Just today / Rest of programme question: a one-off swap is still Replace in the
  movement's More menu.
- **No step counter**, matching Which days?, which never had one. The start sheet and the preview
  footer say what is coming ("Next: your kit", "Three quick questions: when, your kit, and which
  days"). My programme's Your kit row says "N of 7 still to pick, here or at the gym" until done.
- **No home banner and no gate.** Nothing stops a session starting with lines unpicked; they are
  answered on the card.
- PR #167's label line over `ChoiceToggle` and its preview label are reverted. Author either/or lines
  are as they were before #167.
- Also fixed on the way: `templateOf` now carries `setsOptional`, so sharing or re-running a
  programme keeps its "2-3 sets" lines.
