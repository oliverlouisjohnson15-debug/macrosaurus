# 02 · Copying a meal: a visible door, a one-tap "Copy to today", and a restyled copy sheet

Written against: `a52eb01`

## Evidence chain

- Surface: Food → Diary meal headings (`FoodLog`, `app/src/app.jsx` about `:14049–:14062`), the meal
  actions sheet (about `:14073–:14085`), the day ⋯ dropdown (about `:13968–:13976`), and
  `CopyToModal` (`:14374`).
- Problems:
  1. **The way in is invisible.** Before phase 3 (`8f24e64^`), every meal title bar had a ⋯ button
     (`aria-label="Meal options"`). Phase 3 removed it, and the meal **name** is now the button. It
     is styled as a plain 15/700 heading, so nothing marks it as tappable. Copying a meal used to be
     ⋯ → Copy to… → Today (3 taps) and is now an undiscoverable tap on the name, then the same
     two steps.
  2. **The most common copy, yesterday's meal into today, takes the most steps.** You have to page
     back a day, tap the name, choose Copy to…, then Today.
  3. **The copy sheet was never reset.** `CopyToModal` uses `bg-[#1E1E22]`, `bg-[#262629]`,
     `bg-white text-black`, `text-[#5A5A62]`, `pf … uppercase` labels and `pixel-box`. On paper those
     render as near-black tiles on a cream sheet. The day ⋯ dropdown has the same problem
     (`bg-[#1E1E22]`, `hover:bg-[#262629]`) and holds "Copy this day to…".
- Design evidence: `DESIGN.md` says every icon sits on a 44px target or beside a label, with no
  icon-only actions lacking an `aria-label`. Sentence case and no uppercase labels. `Seg`, `Row`,
  `Sheet`, `.ms-chip`. The 35-reset mockup `food-meal.html` shows the meal-actions sheet with "Copy
  to…" first.
- Owner: `FoodLog` meal heading + `mealMenu` sheet + day menu; `CopyToModal`.
- Uncertainty: D2 in the README (one more control per meal).

## Design decision

Bring back an **explicit ⋯ on each meal heading**, placed beside the existing +. It opens the same
sheet. On any day that is not today, put **"Copy to today"** at the top of that sheet as a one-tap
row. Restyle the copy sheet and the day menu to the reset system so they read as part of the app.

```
Breakfast                    425 kcal   [⋯] [+]
───────────────────────────────────────────────
sheet: Breakfast
  ⧉ Copy to today        Into breakfast      ← only when viewing another day
  ⧉ Copy to…             Another meal or day
  ★ Save as meal
  …
```

## Reuse

- `Icon.more`, the 44px button markup already used by the meal's + (`w-11 h-11 … color: var(--link)`),
  `Row`, `Sheet`, `Seg`, `.ms-chip` / `.ms-chip.on`, `SheetLabel`.
- Exemplar: the meal-actions `Sheet` (already reset). The day menu becomes the same kind of sheet.

## Changes

1. **Meal heading ⋯** (heading block, about `:14055–:14060`).
   - Change: before the + button, add
     `<button data-no-mealdrag onClick={() => setMealMenu({ id: m.id })} aria-label="Meal options" className="w-11 h-11 flex items-center justify-center" style={{ color: 'var(--link)' }}><Icon.more width="24" /></button>`.
     Change the name button's `aria-label` from "Meal options" to `'Rename or move ' + m.name`, and
     keep its onClick (tap the name still opens the sheet, so muscle memory from the last week keeps
     working).
   - Preserve: hold-to-drag on the heading (`data-no-mealdrag` keeps the ⋯ out of it), the + target,
     and the one-entry rule that hides kcal on the heading.
   - Verify: at 320px a long meal name truncates before the ⋯ is squeezed. ⋯ and + are each 44×44.
   - Tests: `tests/food-log-menus.test.js` finds the meal menu by `aria-label="Meal options"`. That
     label now belongs to the ⋯, so the test should still pass. If it doesn't, update the selector
     and note it in the commit.

2. **"Copy to today"** (meal sheet, about `:14076`).
   - Change: when `me.length > 0 && date !== today`, render as the **first** row:
     `<Row icon={<Icon.copy width="24" />} title="Copy to today" sub={'Into ' + (todayMealSameName ? todayMealSameName.name : mealsForDay(db, today)[0].name).toLowerCase()} onClick={() => { copyEntriesTo(me, today, targetId); setMealMenu(null); }} />`.
     `targetId` is today's meal whose name matches `m.name` (case-insensitive). If none matches, use
     the meal with the same index in `mealsForDay(db, today)`, or failing that the first one.
     `copyEntriesTo` already toasts with Undo.
   - Also: when `date === today`, render "Copy to tomorrow" in the same slot with the same logic.
     This is for people who prep meals ahead.
   - Verify: page to yesterday, ⋯ on Breakfast, Copy to today. You get a toast "N items copied to
     today" with Undo, and today's Breakfast has them. That is 3 taps from Diary, not 4, and every
     step is visible.

3. **`CopyToModal` restyle** (`:14374–:14420`). Presentation only; keep the props and behaviour.
   - Count line: `text-[13px]`, `var(--muted)`, kcal in `num`. Remove the `#5A5A62` separator.
   - "Quick copy to" and "Or pick a day": `SheetLabel` (sentence case, no `pf`, no `uppercase`).
   - Quick buttons: three `.ms-chip` buttons in a `flex gap-2` row, each `flex-1 justify-center`.
     When it is the source date, the chip is `disabled` with `opacity: .5`.
   - Calendar cells: `min-h-[44px]`, no `pixel-box`, background `var(--card)`. Today gets the
     `.ms-chip.on` ring. The source day gets `color: var(--muted)`. The logged-day dot uses
     `var(--link)` (not `--accent`, because gold is reserved for the A button). Month arrows become
     44px `--link` buttons with `aria-label`s.
   - Legend text: 12px `var(--muted)`.
   - Verify: on paper, no element in the sheet has a background darker than `--sunk`.
     `grep -n "1E1E22\|262629\|5A5A62\|bg-white text-black" app/src/app.jsx` returns nothing between
     `function CopyToModal` and the closing `}` of that function.

4. **Day ⋯ becomes a sheet** (about `:13968–:13976`).
   - Change: replace the absolutely positioned dark dropdown with
     `<Sheet title={dateLabel} onClose={() => setDayMenu(false)}>` holding `Row`s "Add a meal"
     (`Icon.plus`) and "Copy this day to…" (`Icon.copy`, only when `day.length > 0`), then the
     existing help sentence as 13px muted text. Its icon becomes `Icon.more width="24"` in
     `var(--link)`.
   - Preserve: the page-level `onClick` that closes menus. It can drop `dayMenu` once this is a
     sheet.

## Scope

- Inherit: every Diary date, paper and dark.
- Verify: copying from the edit-entry sheet (single food) still uses `CopyToModal` and looks right.
  Meal drag-and-drop still starts from the heading but not from ⋯ or +.
- Exclude: Saved meals in the log sheet. Copying recipes.

## Validation

- Product: "Have yesterday's breakfast again" takes ≤ 3 visible taps from the Diary.
- Interface: 390×844 and 320×640; long meal names; meals with 0, 1 and many entries; paper and dark.
- System: no new hard-coded colours (`node tools/…` audit if present, else the grep in step 3).
- Repository: `node build.mjs && npm test`, with no new failures. Extend
  `tests/food-log-menus.test.js`: with a past date selected, the meal sheet shows "Copy to today",
  and tapping it adds the entries to today under the matching meal.

## Stop conditions

- Stop if adding ⋯ makes the heading drop below 44px for a drag grab at 320px. Report the measured
  width rather than shrinking the targets.

## Design documentation

- None. This brings the meal back in line with existing `DESIGN.md` rules.

## Status

**Done, 2026-10-09.** ⋯ is back on every meal heading (the name still opens the sheet). The meal sheet leads with Copy to today (another day) or Copy to tomorrow (today), into the same-named meal. `CopyToModal`, the day menu (now a Sheet) and the diary's own month picker are restyled with no dark tiles. Tests added to `tests/food-log-menus.test.js`.
