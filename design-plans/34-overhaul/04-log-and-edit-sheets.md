# 04 · Log and edit sheets: each route named once, every meal on one row, the speed counted

Written against: `c3686f3` · Depends on: nothing (01 is helpful but not required)

## Evidence chain

- Surface: the FAB's sheet, `LogSheet` (`app/src/app.jsx:14570`), and the entry editor,
  `EditEntryModal` (`:14086`), at 390×844 in `?demo`.
- Problems (rendered):
  1. **The AI route has two names on one sheet.** The tab strip reads FOOD · SCAN · **ESTIMATE**
     · MENU. Under "CAN'T FIND IT?", the first card reads "**Describe it to the AI** — Estimate a meal
     from text, voice or a photo" (`:14488`). That card calls `onAskAI`, which `LogSheet` wires to
     `setTab('describe')`, the **Estimate** tab. One destination, two labels, one of them a verb
     the tab strip does not use.
  2. **The meal chooser wraps 3 + 1.** In Edit entry, MEAL renders BREAKFAST · LUNCH · DINNER on
     one row and SNACKS alone, full width, on a second (`:≈14157`,
     `<Seg … options={meals.map(…)} />`). `Seg` (`:3914`) gives each button `min-w-[28%]` with a 10px
     gap, so four options cannot share a row. The full-width SNACKS reads as more important than
     the others.
  3. **The "Can't find it?" rows are a third dialect.** They are built from legacy classes
     (`bg-[#1E1E22] pixel-box`, `rounded-xl bg-[#F5C542]/15`, `text-[#8A8A90]`, `:14488`–`:14496`)
     instead of the sheet blocks (`SheetBox`, `SheetLabel`, `:3818`–`:3828`). The AI glyph is drawn
     in the fat **fill** colour (`color={FAT}`). The ink/fill rule (`design-plans/21`,
     design-system memory) says small glyphs take ink.
  4. **Copy-to's meal chips are a fourth control.** `CopyToModal` (`:≈14209`) hand-rolls
     `pixel-box … bg-white text-black` chips for the same choice the edit sheet makes with `Seg`.
- Design evidence: `00-README` L2 (MacroFactor's Food Logging Speed Index: logging is judged by
  counted actions); rule 6/L6 (one vocabulary); the `Seg` comment ("commit a setting … a row of
  things you can press"); the ink/fill rule.
- Owner: `LogSheet`, the "Can't find it?" block inside `FoodTab` (`:14384`, rows from `:14487`),
  `EditEntryModal`, `CopyToModal`, `Seg`.
- Uncertainty: none for the changes. The action counts in Validation are to be **measured**, not
  assumed.

## Design decision

The log sheet is the most-used surface in the app. MacroFactor's lesson is to count the actions
and make each route obvious, not to add routes. So this plan adds nothing. It names each route
once, puts every meal choice on one row, and moves the leftovers onto the sheet's own blocks.

## Reuse

- `Seg` (`:3914`), `SheetBox`, `SheetLabel`, `ChoiceRow` (`:3858`) for the "Can't find it?" rows,
  `PixelGlyph`, tokens `--fat-ink`, `--muted`, `--surface2`, `--card`.
- Exemplar for a row that leads elsewhere inside a sheet: `ChoiceRow`'s frame (`pixel-btn`,
  `borderWidth: 2`, `p-3`, bold title + one muted line), with a chevron in place of the radio.

## Changes

1. `FoodTab` "Can't find it?" — **one name for the AI route** (`:14490`)
   - Change: title "Estimate it instead", sub "From a description, your voice or a photo". This
     matches the ESTIMATE tab it opens.
   - Verify: the word "Describe" does not appear on the sheet's first screen. (The Estimate tab's
     own input may still say "describe what you ate". That is an instruction, not a route name.)

2. `FoodTab` "Can't find it?" — **the sheet's own blocks** (`:14487`–`:≈14505`)
   - Change: the divider label becomes `<SheetLabel>Can't find it?</SheetLabel>` between two 2px
     `var(--border)` rules. Each of the three rows becomes a `pixel-btn` row with `borderWidth: 2`,
     `background: var(--card)`, `p-3`, a 24px glyph in `--muted` (or `--fat-ink` for the AI sun), a
     13.5px semibold title, an 11.5px `--muted` sub, and `Icon.chevron` in `--muted`. Copy the
     shape from `ChoiceRow`. Remove the legacy hex classes.
   - Preserve: the order (Estimate, Manual, Drink) and every handler.
   - Verify: paper and dark render identically in structure to the edit sheet's rows. No `#1E1E22` or
     `#8A8A90` remains in this block.

3. `Seg` — **four options fit one row** (`:3914`)
   - Change: compute the minimum width from the count:
     `const minW = options.length >= 4 ? 'min-w-[22%]' : 'min-w-[28%]';` and use it in place of
     the fixed `min-w-[28%]`. When `options.length >= 4`, use `gap-2` instead of `gap-2.5`, and
     `px-1` instead of `px-2`.
   - Preserve: every 2- and 3-option `Seg` (units, theme, measure-in) renders exactly as before.
   - Verify: Edit entry shows BREAKFAST · LUNCH · DINNER · SNACKS on one row at 390px. At 320px,
     "BREAKFAST" still fits at 10px pixel face (if not, use the meal's first three letters, which
     the meal header already does when dragged: BRK/LUN/DIN/SNK as in `Sheets.dc.html`).

4. `CopyToModal` — **`Seg` for the meal choice** (`:≈14209`)
   - Change: replace the hand-rolled chips with
     `<Seg value={selMeal} onChange={setSelMeal} options={meals.map(m => ({ v: m.id, l: m.name }))} />`
     under a `SheetLabel` "Into".
   - Verify: Copy-to and Edit entry show the same meal control.

## Scope

- Inherit: `LogSheet` on every tab (Food, Recent, Manual, Scan, Estimate, Menu), food and drink
  modes, `EditEntryModal` from the Food log and from Today, `CopyToModal`.
- Verify: every other `Seg` consumer (`grep -n "<Seg " app/src/*.jsx`). Confirm none has four or
  more options that relied on wrapping.
- Exclude: what the sheet logs to by default. The FAB always opens on the first meal
  (`setAdding({ … mealId: meals[0].id })`, `app.jsx:22325`, `:22365`), although `LogSheet` has a
  `suggestMealId` fallback that is never reached from the FAB. That is behaviour, not presentation,
  and is tracked as a separate task.

## Validation

- Product: the Food Logging Speed Index tasks, **counted by hand before and after** on a demo
  account with a few recents. Record the table in the commit message:

  | Task (MacroFactor FLSI) | Actions before | Actions after |
  |---|---|---|
  | Log a recent food at its last portion | | |
  | Search and log a food with a portion change | | |
  | Log a barcode | | |
  | Quick-add kcal and macros by hand | | |

  This plan must not **increase** any row. (Count a tap, a typed field and a sheet change as one
  action each, as MacroFactor's index does.)
- Interface: 390×844 and 320×640, paper and dark, food and drink modes, a 3-meal and a 5-meal
  setup (Settings → Default meals).
- System: `grep -n "Describe it to the AI" app/src/app.jsx` → nothing. No hand-rolled meal-chip
  control remains in `CopyToModal`.
- Repository: `node build.mjs`; `npm test` → no new failures.

## Stop conditions

- Stop if someone has more than five meals configured and `Seg` would need a second row anyway.
  Then fall back to the 3-letter labels rather than shrinking the type.

## Design documentation

- None.

## Status

**Done, 2026-10-06.**
- The AI route is called "Estimate it instead" in all three places it appears: the Food tab's
  "Can't find it?", the Recent tab and the Scan tab. The plan only named the first; the other two
  had the same mismatch.
- All three places use a new `RouteRow` (ChoiceRow's frame with a chevron).
- At 390px, BREAKFAST wrapped inside a quarter-width button, so the stop condition's fallback was
  taken: with four or more meals, Edit entry and Copy-to show the design's BRK / LUN / DIN / SNK
  (`mealShort`).
- The speed table was not measured. No step was added, removed or reordered in any logging flow
  (the changes are labels and styling), so the action counts are unchanged by construction.
