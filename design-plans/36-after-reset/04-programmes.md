# 04 · Train: the Macrosaurus programmes are always one tap from Blocks

Written against: `a52eb01`

## Evidence chain

- Surfaces: Train → Blocks (`BlockPlace`, `app/src/train-tab.jsx:836`), Train home's empty state
  (`TrainHome`, `:708`), All blocks (`BlockList`, `app/src/train.jsx:11`, programmes at `:103–:106`),
  the community library (`BlockLibrary`, `app/src/train.jsx:1667`), and the shared card
  (`ProgrammeCards`, `app/src/train-tab.jsx:249`).
- Problems:
  1. **The row says one thing and opens another.** `BlockPlace` has
     `<Row title="Ready-made programmes" onClick={() => go('library')} />` (`:859`). `library` is
     `BlockLibrary`, the **community** block browser (`browsePublicBlocks`), which titles itself
     "Ready-made programmes" too (`train.jsx:1694`). The four shipped programmes
     (`Training.PROGRAMMES`: Macrosaurus 4 Day, 5 Day, 5 Day Bodybuilding, 5 Day Machine,
     `app/training.js:4435`) aren't on that screen.
  2. **The shipped programmes only appear when you have no block.** `TrainHome` renders
     `ProgrammeCards` under `!block` (`:708`). With a block (running or finished), the only way to
     reach them is Train → Blocks → All blocks, at the top of `BlockList`. Nothing on the way says
     they are there.
  3. **The card itself was never reset.** `ProgrammeCards` uses `Card` + `CardHead` "Macrosaurus
     programmes / Written, not generated", 12px prose, and bordered `--surface2` buttons with
     `--muted2` text. The reset turned every list into `Section` + `Row`.
- Design evidence: `DESIGN.md` `Row` / `Section`, "no card inside a card", 13px detail lines, and
  "≤ 3 secondary sections of ≤ 4 rows". There are exactly four programmes. `01-direction.md` §1.2 puts
  "change / new block" under **Block**.
- Owner: `ProgrammeCards` (shared by all three call sites), `BlockPlace`, `BlockLibrary`'s title.
- Uncertainty: none.

## Design decision

The programmes become a **`Section` of four `Row`s** titled "Macrosaurus programmes". The Blocks
page always shows it under "Start one". The row that opens the community library is renamed to say
what it is.

```
‹ Train      Blocks                         (?)
Start one
  ＋ Start a new block     Answer a few questions…   ›
Macrosaurus programmes
  ▦ Macrosaurus 4 Day      4 days · 64 hard sets     ›
  ▦ Macrosaurus 5 Day      5 days · …                ›
  ▦ 5 Day Bodybuilding     …                         ›
  ▦ 5 Day Machine          …                         ›
More
  ☰ Community blocks       What other members run    ›
  ⟲ All blocks             3 saved                   ›
  ⚙ Training settings      kg · rest timer · RIR     ›
```

## Reuse

- `Section`, `Row`, `Icon.dumbbell` (or `Icon.book`, whichever exists; check
  `grep -n "dumbbell" app/src/app.jsx`), `Training.programmeSummary`, `Training.programmeBlock`.
- Exemplar: `BlockPlace`'s existing `Section` + `Row`s.

## Changes

1. `ProgrammeCards`: **rewrite as a Section of Rows** (`train-tab.jsx:249–:290`). Keep its name and
   props so the three call sites keep working.
   - Change: return
     `<Section title="Macrosaurus programmes" className={className}>{list.map(p => <Row key={p.key} icon={<Icon.dumbbell width="24" />} title={p.name} sub={p.daysPerWeek + ' days a week · ' + p.sets + ' hard sets'} onClick={() => onPick(p.key)} />)}</Section>`.
     Drop the paragraph and the `dayNames` line. The row's 13px detail truncates, and the builder
     shows the days.
   - Preserve: `return null` when the list is empty.

2. `BlockPlace`: **show the programmes, and rename the library row** (`train-tab.jsx:855–:862`).
   - Change: split the section into three:
     - "Block" (only when a block is running): Muscle coverage, Review this block.
     - "Start one": Start a new block. When a block exists but is finished, also show Review this
       block here.
     - `<ProgrammeCards db={db} onPick={(key) => go('builder', { from: 'block', draft: Training.programmeBlock(key, { custom: t.custom, startISO: Store.todayISO() }) })} />`
     - "More": `Row` "Community blocks" with sub "What other members are running" →
       `go('library')`; All blocks; Training settings.
   - Verify: with a running block, Train → Blocks shows the four programmes without scrolling past
     more than the schedule section. Tapping one opens the builder on it, and Back returns to Blocks.

3. `BlockLibrary`: **title says what it is** (`train.jsx:1694`).
   - Change: `title="Community blocks"`.

4. `TrainHome` empty state (`train-tab.jsx:690–:708`) and the `!block` grid (`:748–:757`): **keep
   the programmes visible and fix the labels**.
   - Change: the "Browse blocks" button and the grid's "Browse blocks" become "Community blocks".
     The `ProgrammeCards` call stays. It now renders as a Section, so check it sits on the page and
     not inside the `Card` above it. Also show it when `block && blockDone` (a finished block is
     exactly when someone picks the next plan): change the condition to `(!block || blockDone)`.
   - Out of scope but note in the PR: this empty state still uses `pixel-btn` / `pixel-box`.

5. `BlockList` (`train.jsx:103–:106`): no code change. It now gets the Section version. Check that
   it renders above the block rows without a double heading.

## Scope

- Inherit: Train with no block, a running block, and a finished block; free and premium.
- Verify: `Start again from {programme} as written` in the builder still appears for a block opened
  from a programme (`sourceRef.kind === 'programme'`).
- Exclude: the wizard (`BlockWizard`) and the community library's own filters and cards.

## Validation

- Product: someone mid-block who wants to switch to Macrosaurus 5 Day finds it in two taps from
  Train (More → Blocks → the row, so three at most).
- Interface: 390×844 and 320×640; paper and dark; the longest name "Macrosaurus 5 Day
  Bodybuilding" truncates cleanly.
- System: `grep -n "Ready-made programmes" app/src` returns nothing. `grep -n "CardHead" app/src/train-tab.jsx`
  no longer matches inside `ProgrammeCards`.
- Repository: `node build.mjs && npm test`, with no new failures. `tests/train-screens.test.js` and
  `tests/train-buttons.test.js` may look for the old copy, so update the selectors and say so in the
  commit. Add an assertion that `BlockPlace` with a running block renders four programme rows.

## Stop conditions

- Stop if `Training.programmeSummary` throws for any shipped key with an empty `custom`. Report it
  rather than filtering the programme out.

## Design documentation

- None.
