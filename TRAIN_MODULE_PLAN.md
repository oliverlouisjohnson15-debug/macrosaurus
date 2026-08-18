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

### 8. Let somebody write "last set to failure" by hand — an hour
The block editor's RIR stepper edits `target.rir` only. A movement added by hand to a min-max block
cannot express the 1/0 pair the rest of the block uses, so it silently prescribes something else.

### 9. Stop storing twelve copies of the same week — one to two days, needs care
Both imported programmes are **269KB** in the state blob. That blob is rewritten whole on every
save, and the comment at `app/src/app.jsx:17268` blames exactly this churn for growing the database
to 1.4GB. A twelve-week block stores twelve near-identical weeks; weeks 2 to 6 of a min-max block
differ from each other in nothing at all.

Shape of the fix: store the week-1 template plus the per-week rules (which week is the intro, which
carries techniques), and expand on read. The editing model has to keep working - somebody can edit
one week of a block today - so an edited week becomes an explicit override rather than the default.
Needs a migration for blocks already saved, and it must be reversible.

### 10. Split train.jsx — one day
6,028 lines and about forty components. The session player alone is a thousand. Four files - player,
wizard, block editor, library and sharing - would make everything above safer to change. No
behaviour change, so it wants doing on a quiet day and reviewing as a pure move.

### 11. Some tests that render — one day
1,032 engine tests, zero that mount a component. Items 1, 2 and 3 above were all invisible to the
suite and all visible in about ten seconds of using the app. A handful of jsdom smoke tests -
session player renders a min-max block, wizard preview redraws on each answer, coverage screen draws
a block of each style - would catch that class.

### 12. A style contract test — half a day
The two styles now fork in about fifteen places. One matrix - every style, day count and shape,
asserting each style's invariants - would have caught both #2 and #4 the day they were written.

### 13. Today's prescription on the Train tab — half a day
The home screen shows last session and week progress; what you are about to do is one tap away. On a
method whose whole psychology is "one set, make it count", the next session's top set and its RIR
pair belong on the tab.

### 14. Make rest days real — half a day
The min-max week prescribes rest days, `MINMAX_SPLITS` encodes which weekdays they are, and the home
screen has no concept of one. A prescribed rest day currently looks identical to a day you skipped,
which is both discouraging and wrong.

### 15. Announce the intro week — an hour
Week 1 of a block is deliberately easier, and nothing says so until you open a movement and read the
RIR. It is the week people quit a programme over, thinking it is too soft.

---

## Not on the list, deliberately

- **Rewriting the exercise library as data.** It is a pipe-delimited table in `training.js` and it
  reads fine. Moving it to JSON would be a day of churn for no capability.
- **A general plan-import format.** `blocksFromFile` is deliberately narrow. Anything wider is a
  format to maintain forever, and the AI importer already covers the messy cases.
