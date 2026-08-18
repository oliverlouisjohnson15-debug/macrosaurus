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

### 5. Generate last-set intensity techniques  — half a day
The published programmes add drop sets, myo-reps, lengthened partials and weighted static holds to
about 40% of movements in the SECOND block of a cycle, and add nothing else: that is how the method
progresses between blocks when there are no sets to add. We import and display them
(`target.technique`) but cannot produce them.

- `nextBlock` is the home: when `block.style` is min-max and the block completed, the next one is the
  same skeleton plus techniques.
- Which movements: isolation and machine work, never the heavy free-weight compounds - a drop set on
  a squat is how people get hurt, and the sheets never do it.
- Which technique: match the movement. Drop sets suit machines and cables; myo-reps suit small
  isolation; lengthened partials suit anything with a stretched position; static holds suit grip.
- The runner already renders it. The session's time estimate should account for it.

### 6. A shared block should stay the block that was shared — half a day
`publishBlock` (train.jsx) sends `templateOf(block)`, which drops `choice`, `alts` and `technique`,
and there is no `p_style` column at all. Adopting a min-max block therefore hands somebody a
volume-model block with min-max movements: the worst of both. Needs a Supabase column, the fields
carried through `templateOf`, and `adoptTemplate` to build in the author's style.

### 7. Keep the warm-up sets an imported plan prescribes — an hour
The sheets say 0-1, 1-2 or 2-4 warm-up sets per movement. `tools/minmax-import.mjs` reads the column
and throws it away, and the app recomputes its own from load. The author's number is better
information than our guess, and it is already parsed.

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
