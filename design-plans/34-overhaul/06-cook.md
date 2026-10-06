# 06 · Cook: recipes on the first screen, and every Cook sub-screen with the house bar

Written against: `c3686f3` · Depends on: `01-foundation.md` (`PageBar`, `Pill wide`)

## Evidence chain

- Surface: the Cook tab, `Recipes` (`app/src/app.jsx:21227`, list render from `:21380`), its
  sub-screens, and `RecipeDetail` (`:20406`), at 390×844 in `?demo` (free tier, Cookbook tab).
- Problems (rendered):
  1. **No recipe on the first screen.** The first recipe card's top is at ≈740px, under the bottom nav
     and the FAB. Above it, in order: `PageHeader` "COOK / RECIPES" with a three-icon toolbar
     (fridge, meal plan, shopping), a "Cook from your fridge" hero card (≈85px), `ChefCard`
     "COMMUNITY COOKBOOK · LVL 1" (≈150px), the Discover/Cookbook switch, a full-width "IMPORT A
     RECIPE FROM A VIDEO" button, a full-width "Build one from ingredients" button, search and filter,
     and the "COOK FOR YOUR GAP" heading.
  2. **The fridge has two doors side by side.** The toolbar camera (`:21384`) and the hero card
     (`:21398`) both call `setScreen('fridge')`. The buddy also offers it on Today
     (`nudge_fridge`, `:7966`, "Cook from my fridge"), so the hero is not the only way to discover it.
  3. **Cook's sub-screens are the last place with the old back link.** Shopping list (`:20734`),
     Meal plan (`:20959`, followed by a `PageHeader`), Fridge (`:21163`), Import (`:20240`) and Build
     (`:20159`) each open with a grey `← Recipes` / `← Back` text link and a hand-set `text-lg` title.
     `SubHeader`'s own comment (`:3832`) says that pattern is what it replaced: "the design does not
     leave you with a back link floating on the page". Recipe detail, one tap away, uses `SubHeader`.
  4. **Hand-rolled house controls.** `ChefCard` re-types `CardHead` (`:20795`). The Discover/Cookbook
     switch re-types `Pill` as a grid (`:21411`).
  5. **Recipe detail says the serving's calories three times.** The photo chip "310 KCAL / SERVING"
     (`:20510`), the PER SERVING tile "310 KCAL", and the sentence under the tiles, "A serving is
     310 kcal. You have 1101 kcal …" (`:20548`).
- Design evidence: `00-README` rules 1, 2, 5, 6 and L1. `SubHeader`'s comment. The `Pill` comment.
  `19-handover.md` ("Recipe … matched against the rendered design"), which means Recipe detail's
  structure is verified and only its copy changes here.
- Owner: `Recipes` list view, `ChefCard` (`:20783`), `ShoppingListView` (`:20670`), `PlannerView`
  (`:20932`), `FridgeScan` (`:21101`), `RecipeImport` (`:20187`), `RecipeBuilder` (`:20134`),
  `RecipeDetail` (`:20406`).
- Uncertainty: moving `ChefCard` below the recipes changes where a gamified element sits. It is a
  reward to see, not a task to do, so the move follows `00-README` L5. Flag it in the PR.

## Design decision

Cook is a **recipe browser**. Its hero is the recipes. Ways to get recipes in become one compact
row. The contributor level becomes a footer you scroll to. Every screen you go into from Cook gets
the same purple bar as Recipe detail.

```
PageBar   COOK                                [📅] [🛒] [📷]
[ DISCOVER 🔒 | COOKBOOK ]                     ← Pill wide
[ IMPORT FROM VIDEO ] [ BUILD FROM INGREDIENTS ]  ← one row, accent + ghost
[ search your recipes…            ] [⚙]
COOK FOR YOUR GAP  ……  recipe cards           ← first recipe ≤ 480px
…list…
COMMUNITY COOKBOOK · LVL 1 ……… 3 SHARED       ← compact ChefCard, last
  Contributor ▮▮▮▮▮▯▯▯▯▯ 2 to Regular
```

## Reuse

- `PageBar`, `Pill` with `wide` (01 §7), `CardHead` (`:3767`), `SubHeader` (`:3831`), `Btn`
  (`:3689`), `PipLine`, `ShareTip` (unchanged, still for an empty cookbook).
- Exemplar: `RecipeDetail`'s `SubHeader` call for every Cook sub-screen.

## Changes

1. `Recipes` — **`PageBar` with the toolbar** (`:21380`–`:21396`)
   - Change: `<PageBar context="Cook" actions={[plan, shopping (with its count badge), fridge]} />`,
     reusing each button's current handler, `aria-label` and icon. Order: meal plan, shopping list,
     fridge. The two destinations come first and the tool last.
   - Verify: no "RECIPES" title. Three icon buttons on the right, as now.

2. `Recipes` — **delete the fridge hero card** (`:21396`–`:21406`)
   - Preserve: the toolbar camera and the buddy's `nudge_fridge` on Today, which are the two remaining
     ways in.
   - Verify: one fridge entry on the Cook page.

3. `Recipes` — **`Pill wide` for Discover/Cookbook** (`:21409`–`:21418`)
   - Change: `<Pill wide value={hubTab} onChange={setHubTab} options={[{ v: 'discover', l: <>Discover{!isPremium && <Icon.lock …/>}</> }, { v: 'mine', l: 'Cookbook' }]} />`
     in an `mb-4` wrapper. `Pill`'s label is already a node, so the lock glyph carries over.
   - Verify: identical look to the You Settings/Account switch after 01.

4. `Recipes` Cookbook branch — **one row for the two ways in** (both the empty `:≈21424`–`:21425`
   and the non-empty `:≈21430` copies of the Import/Build buttons)
   - Change: `<div className="grid grid-cols-2 gap-2.5 mb-4"><Btn kind="accent" onClick={…import}>Import from video</Btn><Btn kind="ghost" onClick={…build}>Build from ingredients</Btn></div>`.
     If "Build from ingredients" wraps to two lines at 320px, that is fine. Do not shrink the type.
   - Preserve: `ShareTip` and the empty-state card for an empty cookbook, below this row.
   - Verify: one row, one gold control.

5. `Recipes` — **`ChefCard` moves last and gets `CardHead`** (`:21407` and `:20783`)
   - Change: render `<ChefCard db={db} />` after the recipe list / rails, in the Cookbook branch
     only. In `ChefCard`, replace the hand-rolled bar with
     `<CardHead title={'Community cookbook · Lvl ' + bt.level} right={shared + ' shared'} />`.
     Put the rank name and "N to Next" on one line, then the `PipLine`. Keep the explanatory
     sentence only while `shared === 0`, since it explains a system the person has not used yet.
   - Verify: `ChefCard` is ≤ 100px tall once something has been shared, and it is the last card on
     the Cookbook tab.

6. **Cook sub-screens get `SubHeader`** (`ShoppingListView :20734`, `PlannerView :20959`–`:20961`,
   `FridgeScan :21163`–`:21164`, `RecipeImport :20240`–`:20241`, `RecipeBuilder :20159`–`:20160`)
   - Change: replace each back link + title with
     `<SubHeader back={onBack /* or onCancel */} backLabel="Cook" title="Shopping list" />`
     (titles: "Shopping list", "Meal plan", "From your fridge", "Import a recipe", "Build a recipe").
     Move any toolbar these screens have (for example the shopping list's clear/share) into
     `actions`. Remove `PageHeader` from `PlannerView`. Keep any sub-line under the old title as the
     screen's first muted paragraph, the way `SubScreen`'s `intro` does.
   - Preserve: `useBackClose` wherever it is registered. Do not add a second registration
     (`19-handover.md` gotcha).
   - Verify: every screen reachable from Cook opens with the purple bar. `grep -n "arrow_left width=\"16\" /> Recipes\|arrow_left width=\"16\" /> Back" app/src/app.jsx`
     → nothing in these five components.

7. `RecipeDetail` — **say the serving's kcal once in the sentence** (`:20548`)
   - Change: drop "A serving is N kcal. " from the start of the fit sentence. It now begins
     "You have 1101 kcal and 56 g protein left today, so 3 servings still fit."
   - Preserve: the photo chip and the PER SERVING tiles. Both are in the verified Recipe design.
   - Verify: the sentence no longer repeats the tile.

## Scope

- Inherit: Cook in free and premium, Discover and Cookbook, empty and full cookbook, all five
  sub-screens, Recipe detail.
- Verify: share-to-import (`importUrl`) still lands on the Import screen with its bar. Opening the
  fridge from Today's nudge (`openFridge`) still lands on Fridge.
- Exclude: Discover's content (`RecipeHub`), `CookMode` (full-screen cooking), recipe cards' own
  layout, the filter sheet.

## Validation

- Product: someone opening Cook sees at least one recipe they could cook without scrolling, and
  can still import one in a single tap.
- Interface: 390×844 (first recipe card top ≤ 480px CSS) and 320×640. Paper and dark, free and
  premium, empty cookbook.
- System: `grep -n "<PageHeader" app/src/app.jsx` no longer lists Meal plan. `ChefCard` and the hub
  switch render through `CardHead` / `Pill`.
- Repository: `node build.mjs`; `npm test` → no new failures.

## Stop conditions

- Stop if the shopping list or planner relies on its back link's position for a drag gesture or
  sticky element. Report it rather than restructuring that screen.

## Design documentation

- Record: "Every screen you go into uses `SubHeader`. As of 34/06, no floating back links remain in
  Cook."

## Status

**Done, 2026-10-06.** At 390×844 the "Cook for your gap" rail starts at 344px CSS and the first
recipe card at ≈390px (it was ≈740px; the target was ≤480px). The fridge hero is gone; the toolbar
camera and the buddy's nudge remain. Discover/Cookbook is `Pill wide`. Import and Build share one
row. `ChefCard` uses `CardHead`, comes last on the Cookbook tab, and only shows its explanatory
sentence before anything has been shared. Shopping list, Meal plan, From your fridge, Build and
Import all open with `SubHeader` ("‹ Cook"). On the shopping list, Share became the bar's icon
action and "Clear ticked" a quiet `TextBtn`. Recipe detail's sentence no longer repeats the
serving's kcal.
