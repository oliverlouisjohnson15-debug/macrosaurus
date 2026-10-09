# 01 · See what's left while you log: Diary and log sheet

Written against: `a52eb01`

## Evidence chain

- Surfaces: Food → Diary (`FoodLog`, `app/src/app.jsx:13593`; summary line at about `:14000–:14018`)
  and the + log sheet (`LogSheet`, `app/src/app.jsx:14747`; "Left today" strip at about `:14788–:14791`).
- Problems:
  1. **Bug: after a one-tap +, the log sheet's kcal left falls by twice the food.**
     `left.kcal = day.target.kcal - day.rest.kcal - added.reduce(...)` (`:14761`). `day` comes from
     `dayContextFor(db, target.date)` and is recomputed from `db` on every render. `addEntry`
     (`:22202`) has already pushed the entry into `db.log_entries`, so `day.rest` includes it, and the
     sheet then subtracts `added` on top. The P/C/F figures don't subtract `added`, so they are
     correct. On screen, kcal and macros disagree after the first +.
  2. **The Diary shows eaten, not left.** The summary reads "1,135 of 2,236 kcal · P76 · C150 · F22"
     with one kcal meter. To see protein left you have to switch to Today. This follows 35-reset
     `01-direction.md` §2.7 ("Food owns *eaten*"), and the owner has now overruled that (README D1).
  3. **The log sheet's strip has no meters.** "Left today 1101 kcal · P55 C107 F48" is one line of
     text in `--surface2`. When P/C/F go negative they are clamped to 0 and give no "over" signal.
- Design evidence: `DESIGN.md` defines `Banner` as "a `--sunk` strip for live context inside a sheet
  ('Left today', rest timer)" and `HP` as the meter. The macro text colours are the `--*-ink` tokens.
  Each number appears once per screen (§2.7 / content budget).
- Owner: `FoodLog` summary IIFE, and `LogSheet`'s `left` and strip.
- Uncertainty: D1 is a product decision (see README). Everything else is determined.

## Design decision

The amount left is the number you need while logging, so both surfaces lead with it. Each surface
uses the same compact block: a **"left" headline for kcal plus a 4-row mini meter grid** for
kcal/P/C/F. Each row is a label, a small `PipMeter`, and "N left" or "N over". Eaten moves to
secondary text on the Diary so no number is said twice.

```
Diary                                 Log sheet (Banner, --sunk)
1,101 kcal left       1,135 of 2,236   Left today            1,101 kcal
P  ▮▮▮▮▮▯▯▯▯▯  55 g left              P ▮▮▮▮▯▯  55 g   C ▮▮▮▯▯ 107 g   F ▮▮▯▯ 48 g
C  ▮▮▮▮▮▮▯▯▯▯  107 g left
F  ▮▮▮▮▮▮▮▮▯▯  48 g left
```

## Reuse

- `PipMeter` (`app/src/app.jsx:4716`) with `small` and `cells={10}`. Colours: fill `var(--pro)`,
  `var(--carb)`, `var(--fat)`, `var(--cal)`; over `var(--danger)`. Text uses `var(--pro-ink)`,
  `var(--carb-ink)`, `var(--fat-ink)`, `var(--good-ink)`, `var(--danger-ink)`.
- Banner background: `var(--sunk)` if it is defined in `app/src/styles.css`. Otherwise keep the
  current `var(--surface2)`. Check with `grep -n "\-\-sunk" app/src/styles.css`.
- Exemplar: the Diary summary line already pairs a `num` figure with a muted unit and a `PipMeter`.
  Use its markup as the template for each row.

## Changes

1. `LogSheet`: **fix the double subtraction** (`:14761`).
   - Change: `kcal: Math.round(day.target.kcal - day.rest.kcal)`. Remove the `added.reduce(...)` term.
   - Preserve: the "Added N · X kcal" footer strip, which still sums `added`.
   - Verify: open + on a meal and note kcal left. Tap a recent's + for a 425 kcal food. Kcal left
     drops by exactly 425, and P/C/F drop by that food's macros.

2. `LogSheet`: **strip becomes a Banner with meters** (`:14788–:14791`).
   - Change: line 1 is "Left today" (or "Over today") on the left and the kcal figure in `num` 16px
     on the right. Line 2 is a 3-column grid. Each cell holds the macro letter in its ink colour,
     the figure plus " g" (or " g over" in `--danger-ink` when negative, never clamped to 0), and a
     `PipMeter small` under it with value = eaten and target = day target for that macro.
   - Keep it `flex-none` above the scroll area so it stays visible while the results scroll.
     Height ≤ 76px at 390px wide.
   - Preserve: hidden when `day` is null.
   - Verify: at 320×640 the three cells fit with no wrapping and no text under 11px.

3. `FoodLog`: **summary leads with "left"** (`:14000–:14018`).
   - Change: headline row: `{left} kcal left` (or `{over} kcal over`) in `num` 16px, `--good-ink` or
     `--danger-ink`. On the right, muted 13px: `{eaten} of {target}`. Under it, three rows
     (P, C, F), each a single flex line: 13px/600 label in ink colour, `PipMeter small` (flex-1),
     and "N g left" or "N g over" at 13px, right-aligned, tabular. Keep the existing kcal meter
     under the headline.
   - Keep the premium Density row exactly as it is, after the macro rows.
   - Past and future days use the same `et` they use now. The label reads "left" for today and
     future days and "under" for past days ("212 kcal under", "10 g over").
   - Preserve: day paging, swipe, calendar, and the `.lg:` two-column layout.
   - Verify: the first meal heading is at most 360px from the top of the viewport at 390×844. If
     it isn't, drop the per-macro meters on the Diary and keep the figures only. Say so in the PR.

4. `DESIGN.md`: **record D1.**
   - Change: in the Content budget line, replace "Today owns *left*, Food owns *eaten*" with
     "Today and Food both lead with *left*; Food's diary also shows eaten as secondary text."
     Make the same edit in `design-plans/35-reset/01-direction.md` §2.7 and §1.3 row "Diary:
     day-total panel…", with a note "(changed by 36-after-reset/01)".

## Scope

- Inherit: every date in the Diary; every log-sheet mode (Food, Quick add, Estimate, Drink), since
  the strip sits above them all.
- Verify: `ConfirmFood` and `EditEntryModal` still show their own "After this" `DayImpact` row. It is
  a projection, not a repeat, so leave it.
- Exclude: Today's hero, the Day-in-detail sheet, Progress.

## Validation

- Product: open + at lunch and tap two foods' +. The strip's kcal and P/C/F fall by exactly those
  foods, and you can see protein left without leaving the sheet.
- Interface: 390×844 and 320×640; paper and dark; 0 entries, normal day, and over on kcal and on
  one macro; free and premium (Density row).
- System: `grep -n "added.reduce" app/src/app.jsx` finds only the footer strip.
- Repository: `node build.mjs && npm test`, with no new failures. Add a test in
  `tests/render.test.js` style: render `LogSheet`, call the + path twice, and assert kcal left =
  target − eaten (this pins the bug).

## Stop conditions

- Stop if `dayContextFor` turns out to be memoised on anything other than `db` (then `added` was
  deliberate). Report it rather than changing the memo.

## Design documentation

- Step 4 above.
