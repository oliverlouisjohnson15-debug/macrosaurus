# 03 · Cook inside Food: always open on Cook home, and bring Discover into the reset

Written against: `a52eb01`

## Evidence chain

- Surface: Food → Cook (`Recipes`, `app/src/app.jsx:21359`) and its Discover page (`RecipeHub`,
  `:20970`; `ChefCard` `:20914`; `PublicRecipeCard` `:20950`).
- Problems:
  1. **Premium users never see Cook home first.** `const [hubTab, setHubTab] = useState(isPremium ?
     'discover' : 'mine')` (`:21370`). In the list render, `hubTab === 'discover'` draws
     `SubHeader "Discover"` + `RecipeHub` in place of the Cook home, and **without the Diary | Cook
     switch** (`FoodSwitch` is only in the other branch). So Food → Cook lands a premium user on a
     sub-page with a back arrow and no switch. That is the "loads strangely" report. The comment on
     that line predates Cook moving into Food, when Discover was a tab.
  2. **The pill row is cut off.** `RecipeHub` draws 8–9 filter pills (`For today`, `High protein`,
     `Quick`, `Breakfast`, `Chicken`, `Beef`, `Fish`, `Veggie`, `All`, `:21023`) in a
     `flex overflow-x-auto` row with a hidden scrollbar. At 390px the row clips mid-pill at the
     right edge and gives no sign that it scrolls.
  3. **Discover was never reset.** It still uses `pixel-box`, `pf … uppercase`, `text-[12px]`
     prose, `#F5C542` error text, a black **gradient** scrim on cards (`linear-gradient(transparent,
     rgba(0,0,0,0.9))`), a `#7CFF9B` protein figure, a hand-rolled `fixed inset-0` preview modal,
     and a nested `Card` for consent. `ChefCard` still uses `pf uppercase` and `CardHead`.
- Design evidence: `DESIGN.md`: no gradients; sentence case; Plex for labels, Silkscreen for tracked
  numbers only; `Sheet` for anything that rises; `.ms-chip` "for log routes and filters"; `Row` /
  `Section`; one gold A button per screen. `01-direction.md` §1.2: "Cook: fits-what's-left hero ·
  your recipes · Meal plan · Shopping list · **Discover** (a row)". The mockups
  `mockups-full/screens/cook.html` and `discover.html` are the visual target.
- Owner: `Recipes` (default tab), `RecipeHub`, `PublicRecipeCard`, `ChefCard`.
- Uncertainty: D3 in the README (main-ingredient pills move into search).

## Design decision

Food → Cook **always opens on Cook home**, the screen the reset designed. Discover stays one row
away. Discover itself becomes a reset page: a search `Field`, **one wrapping row of five
`.ms-chip` filters**, a two-column grid of recipe tiles with the caption *below* the image (no
scrim), and the preview as a `Sheet`.

```
‹ Cook        Discover
[🔍 Search recipes or creators        ]
[For today] [High protein] [Quick]
[Breakfast] [All]                         ← wraps, never scrolls
┌────────┐ ┌────────┐
│  img   │ │  img   │                     ← art, 3:4
└────────┘ └────────┘
Pesto pasta  Bean tacos                   ← 15/600, 2 lines max
540 kcal · 46 g  620 kcal · 31 g          ← 13 muted, kcal in num
…
Community cookbook · Lvl 1   3 shared     ← Section at the foot
```

## Reuse

- `SubHeader`, `Section`, `Row`, `Sheet`, `Btn` (A once: "Start cooking" in the preview sheet),
  `.ms-chip` / `.ms-chip.on`, the search-field markup from Cook home (`field-focus`, `Icon.search`,
  52px), `RecipeMacroStrip`, `RecipeImg`, `PipMeter` or `PipLine` (whichever `ChefCard` keeps).
- Exemplar: the Cook home list branch in `Recipes` (`:21516–:21574`), which is already reset.

## Changes

1. `Recipes`: **default to Cook home** (`:21370`).
   - Change: `useState('mine')`. Remove the stale comment.
   - Also: when `hubTab` is `'discover'` and the user taps the Food tab again, or the switch is
     used, return to `'mine'`. The minimum is to reset `hubTab` to `'mine'` in the effect that runs
     on mount.
   - Verify: `?demo&premium`, Food → Cook shows the Diary | Cook switch, the search, the "Fits
     what's left" hero, and Your recipes. Discover is the third row under More.

2. `RecipeHub`: **filters wrap** (`:21023–:21032`).
   - Change: `pills` becomes `For today` (when `remKcal > 0`), `High protein`, `Quick`, `Breakfast`,
     `All`. Remove the four `m:` pills. The `load()` branch for `m:` can stay, since it is harmless.
     Render with `<div className="flex flex-wrap gap-2 mt-3 mb-4">` and
     `<button className={'ms-chip' + (pick === k ? ' on' : '')} aria-pressed={pick === k}>`.
     Delete `chipStyle` and `chipCls`.
   - Search: replace `TextInput` with the Cook-home field markup (search icon, 52px, `field-focus`)
     and the placeholder "Search recipes, creators or ingredients".
   - Verify: at 320px every chip is fully visible, with no horizontal scroll on the page or in the row.

3. `PublicRecipeCard`: **caption below the art** (`:20950–:20967`).
   - Change: the image box keeps `aspectRatio: '3 / 4'` and `RecipeImg`. Remove the gradient div and
     the black kcal badge. Below the image: the title at 15/600, two-line clamp, `var(--text)`;
     then 13px `var(--muted)` with `<span className="num" style={{color:'var(--text)'}}>{kcal}</span> kcal · {protein} g protein`;
     then the creator at 12px muted and truncated. No `pixel-box`. The image gets no frame (it is
     art), and the button has a 44px+ target by size.

4. `RecipeHub`: **preview is a `Sheet`** (`:21037–:21055`).
   - Change: `<Sheet title={preview.title} onClose={() => setPreview(null)} wide>` holding a 16:9
     image, "via {creator}" (13px `var(--link)`), `RecipeMacroStrip`, `Section title="Ingredients"`
     with a plain list, `Section title="Method"` with numbered steps (the number in `var(--muted)`
     Plex, not `pf`). Footer: `Btn` A "Start cooking" (when steps exist) and `Btn kind="ghost"`
     "Save to cookbook". The help line is 13px muted. "Watch the original" uses `var(--link)`.
     Remove `BackClose` if `Sheet` already registers back-close (check `Sheet`'s implementation;
     do not register twice, per `19-handover.md`).

5. `RecipeHub`: **consent, errors, free upsell**.
   - Consent (`consent === undefined`): replace the nested `Card` with a `--sunk` strip. One
     13px sentence, then `Btn kind="ghost"` "Share mine" and a text button "Keep mine private".
     There is no gold here, because "Start cooking" is the screen's A.
   - Error: `color: var(--danger-ink)`, 13px.
   - Free upsell: replace the `pixel-box` + `pf` block with a `Section title="Every recipe, from everyone"`,
     one 15px sentence (keep the first sentence of the current copy), and `Btn` A "Try Premium free".
     Then a 13px muted line, "7 days free, then cancel anytime". Keep the blurred teaser grid.
     Replace its `pixel-box` "Unlock the library" pill with a `.ms-chip` that has `Icon.lock`.
   - "Your cookbook ›" link: 13px `var(--link)`, 44px tall.

6. `ChefCard`: **section, not card** (`:20914–:20935`).
   - Change: `<Section title={'Community cookbook · Lvl ' + bt.level} right={shared + ' shared'}>` then
     a row with the rank name (15/600) and "N to {next}" (13px muted, sentence case, no `pf`), then
     the meter. Keep the conditional explanatory sentence.
   - Verify: no `CardHead` and no `pf` left in `ChefCard`.

## Scope

- Inherit: free and premium; empty and full cookbook; Discover with results, with no results, and
  offline (error state).
- Verify: Today's "Cook from my fridge" nudge (`openFridge`) still lands on Fridge. Share-to-import
  (`importUrl`) still lands on Import. Recipe detail's back arrow returns to Cook home.
- Exclude: `RecipeFilterSheet` (it still uses `pixel-box` chips, so log it as a follow-up),
  `PlannerView`, `ShoppingListView`, `FridgeScan`, and `CookMode`. Note any of these you see still
  using pre-reset styles in the PR, but don't fix them here.

## Validation

- Product: a premium user taps Food → Cook and sees their own recipes and the "fits what's left"
  hero at once. Discover is one tap away and every filter is visible.
- Interface: 390×844 and 320×640; paper and dark; free and premium; long recipe titles; a missing
  thumbnail.
- System: `grep -n "linear-gradient\|pixel-box\|className=\"pf\| pf " app/src/app.jsx` returns
  nothing inside `RecipeHub`, `PublicRecipeCard` or `ChefCard`.
- Repository: `node build.mjs && npm test`, with no new failures. Add to `tests/recipes.test.js` or
  `tests/render.test.js`: render `Recipes` with `isPremium` and assert the Food switch and the
  "Your recipes" section are present on first render.

## Stop conditions

- Stop if `browsePublicRecipes` needs the `main` filter for any caller other than these pills.
  Report it before removing them.

## Design documentation

- None. Discover joins the existing system. If D3 is reversed, record "Discover filters: ≤ 5
  chips, wrapping" in `DESIGN.md` under `Chip` instead.

## Status

**Done, 2026-10-09.** Cook always opens on Cook home. Discover: five wrapping `.ms-chip` filters, a Field search, captions under the art (no gradient), the preview is a `Sheet`, consent/upsell/contributor level are Sections. Chicken/beef/fish/veggie pills removed (D3); `load()` still handles `m:` picks. Not touched, as planned: `RecipeFilterSheet` and the other Cook sub-screens still use pre-reset chips. Test added to `tests/render.test.js`.
