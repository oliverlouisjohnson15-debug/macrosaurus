# 36 · After the reset: four fixes from the owner's first week on it

Written against: `a52eb01` (main, after Reset phases 1–7 merged).
Audit by reading the source on the rendered path. No screenshots were taken. Each plan says what to
check on screen before and after the change.

The owner raised four problems after the UI overhaul (35-reset) shipped. Each one traces to a
specific line of code:

| # | Owner's words | What the code actually does | Plan |
|---|---|---|---|
| 1 | "More easily see macros remaining on the food page when adding food" | The Diary's summary line shows **eaten** only (35-reset §2.7: "Today owns *left*, Food owns *eaten*"). The log sheet's "Left today" strip is plain text, and its kcal figure is **subtracted twice** after each one-tap + (a bug) | `01-macros-left.md` |
| 2 | "Now more difficult to copy meals" | Phase 3 removed the visible ⋯ on each meal. Meal actions now open only by tapping the meal **name**, and nothing shows that the name can be tapped. The copy sheet is still pre-reset dark styling (`#1E1E22`, `bg-white`) | `02-copy-meals.md` |
| 3 | "Cook page loads strangely with High protein, Quick… cut off" | **Premium users open on Discover, not Cook home** (`hubTab` defaults to `'discover'` when `isPremium`). Discover (`RecipeHub`) was never reset. It has a horizontally scrolling pill row that clips at the right edge, gradient cards, and a hand-rolled modal | `03-cook-in-food.md` |
| 4 | "The builder is hiding our ready-made programmes" | The row titled **"Ready-made programmes"** opens the *community* block library (`BlockLibrary`), not the four shipped Macrosaurus programmes. The shipped ones (`ProgrammeCards`) only appear when you have **no block at all**, or three levels down under Blocks → All blocks | `04-programmes.md` |

## Recommended order

1. **01** first. It fixes a real numeric bug in the log sheet and is the owner's top ask.
2. **03 step 1** (default Cook to home) is one line and removes most of the "loads strangely" report.
   Ship it with 01 if you want a quick win, then do the rest of 03.
3. **04**: small, and it fixes a mislabelled row.
4. **02**.

Each plan is one PR. They touch separate components and do not conflict, except that 01 and 02 both
edit `FoodLog` in `app/src/app.jsx` (different regions). Merge one before starting the other.

## Owner decisions taken in these plans (flag in each PR)

- **D1 · Food shows "left" again.** 35-reset §2.7 gave "left" to Today alone. The owner has now asked
  to see what's left while logging, which overrides that rule for Food. Plan 01 records the change in
  `DESIGN.md`.
- **D2 · A visible ⋯ comes back on meal headings.** This is one extra 44px control per meal. The
  content budget allows it, because the meal actions already exist and are only being made visible.
- **D3 · Discover's main-ingredient filters move into the search.** The pill row drops from 9 to 5,
  so it wraps instead of scrolling. Chicken, beef, fish and veggie are still reachable by typing.

## Shared rules for the executor

- Source: `app/src/app.jsx` (Food, Cook, log sheet), `app/src/train-tab.jsx` and `app/src/train.jsx`
  (Train). The visual spec is `/DESIGN.md`. Primitives: `Row`, `Section`, `Sheet`, `Seg`, `Pill`,
  `Btn`, `PipMeter`, `SubHeader`, and the `.ms-chip` / `.ms-chip.on` classes in `app/src/styles.css`.
- Do not add new primitives. Do not use `pixel-box`, `pixel-btn`, `pf`, hard-coded hex colours,
  gradients or text under 11px in anything you touch.
- After any source change, run `node build.mjs` (it regenerates `index.html` and `sw.js`) and then
  `npm test`. Both must pass. If a test selector changes, say so in the commit message.
- Check the result in `?demo` and `?demo&premium` at 390×844 and 320×640, in paper and dark.
