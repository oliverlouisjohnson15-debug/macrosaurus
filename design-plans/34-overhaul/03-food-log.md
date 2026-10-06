# 03 · Food log: the diary first, the totals as one compact card

Written against: `c3686f3` · Depends on: `01-foundation.md` (`PageBar`, `CardHead`)

## Evidence chain

- Surface: the Food tab, `FoodLog` (`app/src/app.jsx:13352`, render from about `:13720`), at 390×844 in `?demo`.
- Problems (rendered):
  1. **The first meal starts at ≈465px.** Above it: `PageHeader` ("YOUR FOOD DIARY / FOOD LOG"),
     which repeats the active nav label FOOD; the day picker; and a "Day total" card whose top half
     is a 34px "1101 KCAL LEFT" with a 20-cell hero meter.
  2. **The Day total is Today's hero, copied.** The comment above it (`:13767`) says "Slim
     remaining-at-a-glance while you log; the full hero + Balance live on the Today tab". The
     comment inside it (`:13771`) says it "leads with the same 34px figure and the same hero meter
     as Today's energy band, so the number … looks identical on both pages". The two comments
     contradict each other, and the rendered card follows the second, so the Food tab opens on the same
     card as Today.
  3. **A one-entry meal says its numbers twice.** Breakfast's header reads "425 KCAL / P27 C59 F9",
     and its only entry reads "425 / P27 C59 F9". The same happens for Snacks (94 / P1 C21 F0).
  4. **An empty meal takes two rows to say one thing.** Dinner renders "Nothing logged yet." (`:13912`)
     and then the "+ ADD FOOD" row.
- Design evidence: `00-README` rules 1, 2, 4 and L1 (the log is the hero of the log tab). The
  code's own first comment (`:13767`) says the Food tab's total should be slim.
- Owner: `FoodLog`. The Day total IIFE (`:13768`–`:13832`), `MealHeadMacros` (`:13336`) and its call
  site in the meal header (`:≈13889`), the empty-meal row (`:13912`).
- Uncertainty: none for the changes. The sticky total in **Not now** below is the owner's call.

## Design decision

The Food tab is the **diary**. Its hero is the first meal, not a copy of Today. The day's totals
become one compact card in the same row-per-instrument shape the macros already use there. Each
figure is said once per screen.

```
PageBar     YOUR FOOD DIARY
day picker  ◀  Today ▾  ▶   ≡
DAY TOTAL .................... 1101 LEFT OF 2236   ← CardHead
  KCAL ▮▮▮▮▮▮▮▮▯▯▯▯▯  1101 left
  PROT ▮▮▮▮▮▯▯▯▯▯     56g left
  CARB …               FATS …    (DENS for premium)
BREAKFAST ............ 425 KCAL       ← single entry: no P/C/F on the header
  Porridge, banana & whey   425  P27 C59 F9
  + ADD FOOD
```

## Reuse

- `PageBar` (01), `CardHead` (`:3767`), `PipMeter` (`:4110`) with `small`, and the existing
  one-line macro row markup inside the Day total (`:13790`–`:13801`), which becomes the KCAL row too.
- Exemplar: the macro rows already in this card. KCAL takes the identical row shape, with
  `color: var(--hero)` (or `var(--danger)` when over) and `ink` the matching ink token.

## Changes

1. `FoodLog` — **`PageBar`** (`:13725`)
   - Change: `<PageBar context="Your food diary" />`.
   - Verify: no "FOOD LOG" title.

2. `FoodLog` — **compact Day total** (`:13775`–`:13786`)
   - Change: replace the hand-rolled bar with
     `<CardHead title="Day total" right={(over ? Math.abs(Math.round(rem)) + ' over' : Math.round(rem) + ' left') + ' of ' + et.eff.kcal} />`.
     Delete the 34px figure block and the full-width hero `PipMeter`. Put a **KCAL** row first in
     the existing row list, built exactly like the PROT/CARB/FATS rows: label `KCAL`,
     `<PipMeter value={tot.kcal} target={et.eff.kcal} color={over ? 'var(--danger)' : 'var(--hero)'} small />`,
     and figure `Math.round(rem) + ' left'` / `Math.abs(Math.round(rem)) + ' over'` in the pixel face
     at 10px, colour `var(--good-ink)` or `var(--danger-ink)`.
   - Also change the premium-only DENS label (`:13817`) from `text-[8px]` to `text-[9px]` (01 §6).
   - Preserve: the per-date behaviour (paging back a day totals that day), density for premium,
     no upsell for free users (already the case; keep it).
   - Fix the contradiction: delete the inner comment's "same 34px figure" paragraph and keep the
     "slim remaining-at-a-glance" one.
   - Verify: the Day total card is ≤ 150px tall for a free user. The first meal card's top is
     ≤ 340px CSS at 390×844.

3. Meal header — **no P/C/F when the meal has one entry** (the `MealHeadMacros` call, `:≈13889`)
   - Change: `{me.length > 1 && <MealHeadMacros macros={ms} />}`. Also hide the header's kcal
     figure when `me.length === 1`, because the entry row directly below carries the same number.
     Keep the header's kcal for 0 entries (the existing empty treatment) and ≥2 entries.
   - Preserve: drag-to-reorder on the title bar, the meal ≡ menu, the rename pencil, and the
     dragged-meal ghost (`:≈13990`, which also calls `MealHeadMacros` and keeps its current rule).
   - Verify: Breakfast (one entry) shows "BREAKFAST" and the ≡ only. A meal with two entries shows
     the totals.

4. Empty meal — **one row** (`:13912`)
   - Change: remove the "Nothing logged yet." row. The "+ ADD FOOD" row is the empty state. Its
     comment already calls it "an invitation, not a report".
   - Verify: an empty Dinner card is the title bar plus one row.

## Not now (owner's call)

- **A sticky Day total** that pins under the app header while the diary scrolls. MacroFactor keeps
  macros visible during logging, but whether its log does this could not be checked from this
  environment. Worth a canvas, not a commit.
- **Timeline instead of meals** (decision D1 in the README). These plans keep meals.

## Scope

- Inherit: every date in the log, both themes, premium and free, the first-ever-entry card.
- Verify: meal drag-and-drop (the header is the grip; hiding its figures must not shrink the grip
  target below 44px tall), the entry drag ghost, `CopyToModal`, Save-as-meal.
- Exclude: `LogSheet` and `EditEntryModal` (plan 04), the calendar card's legacy classes (shimmed,
  not visible as a problem).

## Validation

- Product: someone opening Food at lunchtime sees at least one full meal card and the day's totals
  without scrolling.
- Interface: 390×844 and 320×640. Days with 0, 1 and many entries per meal. Over target on kcal and
  on one macro. Paper and dark.
- System: "Day total" uses `CardHead` (`grep -n "Day total" app/src/app.jsx` shows a `CardHead` call
  and no hand-rolled bar).
- Repository: `node build.mjs`; `npm test` → no new failures.

## Stop conditions

- Stop if a test or the buddy's copy refers to the Day total's big figure as the place to look.
  Report it.

## Design documentation

- None beyond the 00-README rule "say each number once per screen".

## Status

**Done, 2026-10-06.** The first meal card now starts at ≈340px CSS at 390×844 (it was ≈465px).
One departure from change 2: the title bar keeps "of 2236 kcal" and the new KCAL row says
"1101 left". Putting "1101 left of 2236" on the bar as well would have said the number twice on
one card. An empty meal's add row also lost its top rule, so the card no longer draws a double line
under the title bar. A new test in `tests/meal-header-macros.test.js` pins the one-food rule.
