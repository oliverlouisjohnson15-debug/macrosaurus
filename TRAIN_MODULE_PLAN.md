# Train module: the work after min-max

Written 18 Aug 2026, from a review of the whole Train module after the min-max build. Items 1 to 4
are done and are recorded here so the reasoning survives; 5 onward are the queue, in the order I
would do them.

The rule this list is written to: a recommendation is only on it if there is a file and a line
behind it. Anything that reads like good practice but has no evidence in this codebase is not here.

---

## Done

### 1. The app stopped promising four weeks it no longer builds ✔
`Build a 4-week block` was the Train tab's main button while the default had become a six-week
min-max block that neither builds week-on-week nor backs off. Six visible strings said four weeks.
`plannedWeeks(prefs)` / `plannedShape(prefs)` in train.jsx now answer that question once, and the
empty state describes whichever style is actually about to be built.

### 2. Coverage bars judge a block by its own landmarks ✔
`TrainHome` and `CoverageScreen` measured the running block against `prefs.style` rather than
`block.style`. Somebody running an imported min-max block while the wizard sat on the volume model
was told a complete six-set chest week was short on chest. Both now pass `block.style`, matching the
builder, the review screen and the rerun screen.

### 3. A stall has a button ✔
The plateau check set `swap` on the session item and nothing read it: you were told to change the
movement and left to find the swap tool yourself. The note now carries the verb, and the picker
offers the plan's own substitutions, or `substituteFor()` when the plan wrote none.

### 4. A finished block cannot talk the method out of its own numbers ✔
`tuneTargets` raised MAV by two whenever a muscle sat high without stalling. On min-max, whose bands
ARE the method, that turned 4-to-10 into 6-to-14 over three blocks. It no longer raises on a
to-failure style. Two related faults came out with it:

- the review screen wrote the **whole** tuned table into `volumeTargets`, so finishing any block
  stamped seventeen muscles' worth of numbers over the person's settings. It now writes only what
  changed (`Training.targetChanges`).
- there was **one** override table for both styles. A ceiling learned at failure (mrv 8) applied to
  the volume model (mrv 22) would have crippled it. Min-max now keeps its own,
  `training.volumeTargetsMinmax`.
- the stall reduction was a flat minus two, which is a tenth of a 22 ceiling and nothing at all
  against an 8 one once the floors clamped it. It is proportional now, so the one adjustment a
  min-max block genuinely earns actually happens.

---

## The queue

### 5. Generate last-set intensity techniques ✔
Done. `Training.applyTechniques` decorates a built block; `techniqueFor` decides which technique a
movement can carry, and the rule is about what is safe to fail twice on: nothing on a loaded
free-weight compound, nothing at all on core work (a plank has no rep to extend and no weight to
drop), a hold on grip work, partials where the movement has a stretched position, drop sets on
guided kit, myo-reps on the rest. Applied from the END of a session, never the opener, to about four
movements in ten - the published share is 43%, ours lands at 38.

`nextBlock` now carries a min-max block forward INTACT rather than regenerating it: the same
movements in the same order, plus the techniques. The published programmes run the same twelve
movements for twelve weeks and change nothing else, and regenerating would quietly reshuffle
exercise selection on a style whose progression depends on running one lift long enough to load it.
A third block is plain again - twelve weeks is two blocks, not an endless ramp. The session estimate
counts a technique as the two and a half minutes it costs, and the builder says plainly what the
block adds.

Writing the test for this turned up a real trap behind it: `generateBlock({ style: 'minmax' })` with
no explicit targets built against the VOLUME model's landmarks - a 22-set chest ceiling on a method
that caps at 8 - because `defaultTargets` was being called without the style. Every caller in the app
passed targets, so nothing showed. `targetsFor(opts)` is now the single answer to "which landmarks
does this call use", and it cannot be asked without the style.

### 6. A shared block stays the block that was shared ✔
Done, without a migration. The library's template column is jsonb and has always held a bare array
of days, so the payload is versioned in place: an array is the old shape and still reads, an object
carries `{ v: 2, style, days }`. `templateOf` now keeps the parts of a movement that belong to its
author rather than to the week it sat in - the slot they left open, the substitutions they wrote,
the technique they asked for, the effort pair - and `SharedBlockPreview` adopts in the author's
style, judged against the adopter's own landmarks for that style.

### 7. Keep the warm-up sets an imported plan prescribes ✔
Done. The converter reads the column it was already parsing and the loader carries it; `warmupSets`
takes an optional count and slices from the TOP of the ramp, because somebody asked for two warm-up
sets wants the two nearest their working weight, not the two lightest. All 210 movements in the 5x
programme now carry the count their author wrote. The session line says whose number it is.

### 8. Let somebody write "last set to failure" by hand ✔
Done, and the stepper was the smaller half of it. `Training.newItemFor` now prescribes a movement the
way the block it is being added to prescribes movements, so a line dropped into a min-max block
arrives at 1/0 with that block's rep window instead of with the volume model's ramp - three reps in
reserve in week one, walking down, in the middle of a block where everything else goes to failure.
Both the block editor and the mid-session add use it. The prescription sheet shows two steppers where
a movement runs a pair, and `setExerciseTarget` keeps the pair honest: the last set can be harder
than the ones before it, never easier.

### 9. Stop storing twelve copies of the same week ✔
Done. Measured first: 83% of a stored block is weeks two onward repeating week one, and the only
things that vary are the ids, the week number and one or two target fields.

`packBlock` keeps week one as a template and stores every later week as a generic diff against it -
generic on purpose, because a named list of "fields that vary" would rot the first time a new one is
added. `unpackBlock` rebuilds. The safety property is the point: **packBlock unpacks its own output
and compares it to what it was given, and hands back the original block untouched if they differ by
so much as a key**. A block it cannot reproduce is simply stored the way it always was, which is why
a week somebody edited into a different shape declines to pack rather than guessing.

Packing happens at the storage boundary - `packState` / `unpackState` around cloudSave, cloudLoad,
localSave and localLoad - and nowhere else. Every screen, the engine and the merge all go on seeing
blocks with every week present, so this changed what is written to disk rather than how the app
thinks.

Both imported programmes: **317KB to 96KB, 70% smaller**, and that saving is paid back on every
single write, because the blob is rewritten whole each time.

One known consequence, worth remembering rather than fixing: a browser tab still running an older
bundle would read a packed block as a block with no sessions - an empty Train tab until it refreshes.
It cannot lose data (the merge unions by id and writes back what it read), and the service worker
version bump ends it on the next load.

### 10. Split train.jsx ✔
Done, and done in a way that could be checked rather than trusted. The file was cut at five natural
boundaries into `train-core` (helpers and the small shared pieces), `train-tab` (the router and the
home screen), `train-session` (the player and everything you reach for while in one), `train-build`
(preview, wizard, editor) and what remains in `train.jsx` (the shelf, coverage, review, library,
importing, gyms, write-ups). The cuts are contiguous line ranges, so concatenating the parts gives
back the original byte for byte - and the built bundle, with comments stripped, is **identical to the
one before the split**. That is the whole safety argument: no code moved relative to any other code.

The source list moved to `app/src/manifest.json`, read by both build.mjs and the render harness, so
there are not two lists to drift apart.

### 11. Some tests that render ✔
Done. `tests/helpers/app.js` does what the build does - same sources, same order, same Babel
transform - then evaluates the result in a jsdom context and hands back the scope. The app has no
imports, so every component is a function declaration in one shared scope, which is what makes the
harness four lines of setup rather than a bundler. Rendered with react-dom/server: effects do not
run, which suits tests about what a screen SAYS.

Nine of them, each pinned to a way this module has actually been wrong - the block a tab claims to be
running, the weeks a build button offers, a session asking for reps in reserve on a style that has
none, a coverage bar measured against the other style's landmarks, an open slot asked about before
the block starts. react, react-dom and jsdom are devDependencies; nothing ships with them.

### 12. A style contract test ✔
Done: `tests/style-contract.test.js`, a matrix over every style, day count and shape. What is true of
any block, then what makes each style itself, then that neither can read the other's landmarks.

### 13. Today's prescription on the Train tab ✔
Done. The next session's opener, with its sets, its rep window, what it asks for at the end of the
set and any technique on it, plus what follows.

### 14. Rest days are real ✔
Done. `Training.restDaysOfWeek` names them, the week line says which days they are, and when today is
one the tab says so instead of leaving a week that is going exactly to plan looking like one that is
slipping.

### 15. The intro week announces itself ✔
Done. A banner in the same place the deload one lives, saying the week is meant to feel easy and why.

---

## Where this leaves the module

Every item on the list is done. What was found ALONG the way, and would not have been found by
working from the list, is worth more than the list was:

- one override table serving both styles, so finishing a min-max block would have handed its 4-to-10
  numbers to the volume model as if they were the same units
- `generateBlock({ style: 'minmax' })` with no explicit targets building against the volume model's
  ceilings, because `defaultTargets` was being called without the style
- the stall reduction being a flat two sets, which is nothing at all against a ceiling of eight
- the spreadsheet reader mis-parsing self-closing cells, shifting every column after them left - reps
  landing in the rest column, on any xlsx import
- a second min-max block being regenerated rather than carried forward, which would have reshuffled
  exercise selection on a style whose progression depends on running one lift long enough to load it

The next honest piece of work is not on a list yet: nothing here has been run by a person in a gym.

---

## Found in gym use

Written 20 Aug 2026. The list above ends by saying "nothing here has been run by a person in a gym."
It has been now, and three reports came back: stuck in live sessions, no way to read a week other
than this one, and too many buttons to find the right one. All three were navigation, not features.
The audit and the plan behind the fix are in `design-plans/28-train-navigation-remap.md`.

- **Stepping out of a session is not ending it.** `training.open` used to be deleted whenever the
  player closed, so leaving threw away the record that you were mid-session - and while the record
  existed, `openScreen` pulled you back into the player on every mount, which made Train home
  unreachable during a session. `SessionPlayer` now takes both `onExit` (step out, keep it) and
  `onFinish` (end it, clear it); the record carries a `steppedOut` mark, and `openScreen` auto-opens
  only a session you did NOT choose to leave. `openRecord` is the ungated reader the tab's resume
  banner uses. The dead-pointer sweep that leaving used to perform by accident is now explicit in the
  effect - without it a pointer at a deleted block would sit in the store forever.
- **`TrainHome` can show any week of the running block**, using the same week picker the builder
  draws. Reading ahead no longer means opening the editor that rewrites the whole programme. The week
  you are IN keeps the Next card, the start button and the deload/intro/rest notes; a week that has
  not happened reports its session count instead of `0 / 4 done` over an empty meter.
- **`CardHead`'s `right` slot must carry a verb when it is a link.** It draws with no chevron, so
  `"2 / 4 done"` with an `onRight` was a progress readout that silently navigated - to a screen the
  labelled `Blocks` button on the same page already reached. This belongs with the chevron rule
  already stated at `train-tab.jsx:235`.
- **A live session on the home screen opens the player, not the preview.** "Looking is not starting"
  is right for a session you have not begun; a session you are standing in the middle of is not
  looking, and routing it through the preview cost two taps to resume.

---

## Not on the list, deliberately

- **Rewriting the exercise library as data.** It is a pipe-delimited table in `training.js` and it
  reads fine. Moving it to JSON would be a day of churn for no capability.
- **A general plan-import format.** `blocksFromFile` is deliberately narrow. Anything wider is a
  format to maintain forever, and the AI importer already covers the messy cases.
