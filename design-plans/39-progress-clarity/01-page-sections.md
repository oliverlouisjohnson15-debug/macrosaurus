# Progress puts weight and burn right under the chart

Written against: `08f70a2`

## Evidence chain

- Surface: Progress (`view === 'goals'`, rendered by `function Goals` in `app/src/app.jsx`).
  Reached from You → Progress, the Today band and the buddy.
- Problem: below the hero, `Goals` renders two Sections. `Your plan` holds Goal, Calories &
  macros, the check-in row and What's coming up (4 rows). `More` holds **Energy**, **Weigh-ins**,
  Your plan over time, Coaching, Weekly shape, Check-ins & weigh-ins, and Fresh start (up to 7
  rows). The burn, one of the two things the owner opens Progress to see, is a row titled
  "Energy" in a 7-row grab bag below the plan settings.
- Design evidence: `DESIGN.md`, "Content budget (every tab root)": *"At most 3 secondary sections
  of at most 4 rows, then 'All …'."* `More` breaks the 4-row limit.
- Owner: `function Goals` in `app/src/app.jsx` (the two `<Section>` blocks after `<ProgressHero>`).
- Scope and affected surfaces: Progress only. Every row keeps its current `onClick` destination.
- Uncertainty: the section names are new copy. They are plain descriptions of the rows they hold.

## Design decision

Split the rows by the question they answer, in reading order under the hero:

1. **Weight and burn**: what you burn, weigh-ins, your plan over time. This is the evidence
   behind the hero, so it comes first.
2. **Your plan**: unchanged (goal, calories & macros, check-in, what's coming up).
3. **Settings**: coaching, weekly shape, check-ins & weigh-ins, fresh start.

That makes three sections of at most four rows each, within budget, and the burn sits one row
under the chart.

## Reuse

- `Section`, `Row`, `PixelGlyph`, `Icon.*` as already used in `Goals`.
- Exemplar: the existing `Your plan` section in `Goals`.

## Changes

1. `function Goals`, the `<Section title="More">` block
   - Change: replace it with two sections. Put `<Section title="Weight and burn">` **directly
     after `<ProgressHero db={db} />`** and before `Your plan`, containing in order:
     - the Energy row, retitled `title="What you burn"`, with the `sub` changed to
       `'About ' + Math.round(est.tdee).toLocaleString() + ' kcal a day'` when
       `est.ok && !est.implausible`, otherwise keep `'Still learning what you burn'`;
     - the Weigh-ins row, unchanged (including its trailing "Weigh in" button);
     - the "Your plan over time" row, unchanged (still conditional on check-ins existing).
     After `Your plan`, add `<Section title="Settings">` containing `planRow('coaching')`,
     `planRow('weekly')`, `planRow('checkins')` and the Fresh start row, all unchanged.
   - Preserve: every `onClick`, the `open` state keys (`'energy'`, `'weighins'`, `'history'`),
     the Fresh start conditional on `onOpenSetting`.
   - Verify: Progress shows Hero → Weight and burn → Your plan → Settings, and no section has more
     than 4 rows.
2. `function Goals`, `{open === 'energy' && <Sheet title="Energy" …>`
   - Change: `title="What you burn"` so the sheet is named the same as the row that opens it.
     (Plan 03 removes the duplicate title inside the sheet.)
   - Verify: tap the row and the sheet title matches it.

## Scope

- Inherit: Progress on mobile and desktop (`lg:` layout uses the same JSX).
- Verify: `tests/cycle-strip.test.js` tests that render `A.Goals` still pass (they check the
  back label, not section names).
- Exclude: the hero (plan 02), the sheet contents (plan 03), and the Settings screens the rows open.

## Validation

- Product: open Progress and the burn is visible as a row with its figure, without scrolling past
  any settings rows.
- Interface: `/?demo` at 390×844 in paper and dark themes, on an account with check-ins (three
  rows in the first section) and on a fresh account (two rows, "Still learning what you burn").
- System: no new primitives. Only `Section` and `Row`.
- Repository: `npm test` → all pass. `node build.mjs` → `index.html` regenerated.

## Stop conditions

- Stop if `Goals` no longer has the `More` section or the rows have moved since `08f70a2`.
  Re-read and reconcile instead of forcing the edit.

## Design documentation

- None. This applies an existing DESIGN.md rule.
