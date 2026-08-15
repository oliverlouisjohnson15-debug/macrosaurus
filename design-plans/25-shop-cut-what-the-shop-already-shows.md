# The Shop stops explaining what it is already showing

Written against: `be2657fa7150cce376225f4e14eb8f294163fd53`

## Evidence chain

- Surface: the Play hub's **Shop** tab — `ShopView` (`app/src/app.jsx:9045-9210`), rendered at
  `app/src/app.jsx:8870`.
- Problem: three blocks of prose state facts the surrounding interface already carries. Two are panel
  `footer`s that restate their own panel's right-hand status, and one is a header paragraph describing
  where Amber comes from — described differently from the way the buddy describes it elsewhere in the
  same product. Together they are the first thing a user reads on the tab and none of them is load
  bearing.
- Design evidence:
  - `app/src/app.jsx:9308-9310` — `PlayPanel`'s own contract: "the app's standard card: ink title bar,
    **one** status on the right, a divided interior… one job each, so nothing on it is decoration."
  - `app/src/app.jsx:9183` — the Habitat panel's right status is already `"Kept for good"`; its footer
    (`:9184`) is "Bought once and they stack. Nothing here is ever swapped out, so this is what Amber
    is for."
  - `app/src/app.jsx:9144` — the stall panel's title is "This week's stall" and its right status is
    `stallLeft + ' days left'`; its footer (`:9145`) is "Six rotate in each Monday. Nothing leaves the
    catalogue, it only leaves the stall." The second half is demonstrated by the panel directly below
    it, "Everything else", whose right status is `ownedCount + ' of ' + totalItems` (`:9154`).
  - `app/src/app.jsx:9140` — "Amber comes from logging your days, the daily hunt and whatever your
    buddy forages. Spend it here." The buddy's own nudge (`:6776`) tells the same user Amber comes
    from "logging each day, more for winning fights". `Game.AMBER_REWARDS` (`app/game.js:766`) pays
    all four sources, so both lines are partial and they disagree with each other.
  - `design-plans/20-ui-review.md` §2.3 — recognition over recall; the countable presentation does the
    work, so a card carries one number rather than three.
- Owner: `app/src/app.jsx` — `ShopView`.
- Scope and affected surfaces: the Shop tab only. `ShopView` has one call site
  (`app/src/app.jsx:8870`); its `onBack` branch (`:9135`) is unused from there.
- Uncertainty: none.

## Design decision

Delete the three blocks. Each one's content is either already stated by the panel's own status bar or
demonstrated by the adjacent panel, and the Amber explainer additionally contradicts the buddy's
account of the same currency. Removing them is a smaller change than reconciling them, and the tab
loses no information a user can act on.

Do **not** replace the Amber explainer with a corrected list of earn sources. The Battle tab already
states every source at the point it is earned ("+10 Amber" on the log panel `:9843`, "Hunt · N Amber"
`:9879`, "5 each" on the ladder `:9901`, "Clears for … 60 Amber · 25 first time" `:9817`), which is
where a reward is legible. A second, static list on another tab is the thing that drifted.

## Reuse

- `PlayPanel` (`app/src/app.jsx:9311`) — `footer` is already optional; it renders only when
  `footer != null`. Omitting the prop is the supported path, not a special case.
- Exemplar: the "Everything else" panel (`app/src/app.jsx:9154`) — same component, title plus one
  right-hand status, no footer.
- Exemplar for a heading with a wallet chip and no explanatory paragraph: the Battle tab's wallet
  strip (`app/src/app.jsx:9773-9778`).

No new primitive is required.

## Changes

1. `app/src/app.jsx:9140`
   - Change: delete the whole `<div className="text-[10px] text-[#8A8A90] mb-4 leading-snug">…</div>`.
     Move its `mb-4` onto the heading row above it (`:9136`), which currently carries `mb-1`, so the
     spacing to the first panel is unchanged.
   - Preserve: the `<h2>Amber Shop</h2>` and the `<Spark /> {amber} Amber` wallet chip (`:9137-9138`).
   - Verify: the tab opens on the heading, the balance, and "This week's stall" — no paragraph.

2. `app/src/app.jsx:9144-9145`
   - Change: remove the `footer` prop from the stall `PlayPanel`, leaving `title` and `right`.
   - Preserve: the `right={stallLeft + (stallLeft === 1 ? ' day left' : ' days left')}` status,
     including its singular form.
   - Verify: the stall panel ends at its last row, with no grey band beneath it.

3. `app/src/app.jsx:9183-9184`
   - Change: remove the `footer` prop from the Habitat `PlayPanel`, leaving
     `title="Habitat upgrades" right="Kept for good"`.
   - Preserve: `right="Kept for good"` — this is the surviving statement of the fact, so it must not
     be dropped as well. Each habitat row keeps its own `h.desc` and its `Game.habitatProgress` label
     ("Bought, kept for good" / "Affordable now" / "420 of 800 · about 13 days"), which is where the
     panel does its real explaining.
   - Verify: the habitat panel ends at its last row.

4. `index.html`
   - Change: rebuild with `node build.mjs` and commit the regenerated bundle.
   - Preserve: nothing hand-edited; `index.html` is generated.
   - Verify: `grep -c "Amber comes from logging your days" index.html` → `0`.

## Scope

- Inherit: the Shop tab in the Play hub (`app/src/app.jsx:8870`).
- Verify: `PlayPanel`'s other `footer` consumers on the Battle tab — the egg panel (`:9759`), the
  fighter "Says" panel (`:9825`), the log-prompt "Says" panel (`:9844`) and the charges panel
  (`:9857`). **All four stay.** Each says something its panel does not otherwise say: the first three
  are the buddy's voice, and "Earned by today, spent in tonight's fight" is the only statement of the
  charges' lifecycle on that panel.
- Exclude: the buddy nudge copy at `app/src/app.jsx:6776-6779` — it is the buddy's voice on the Today
  surface, governed by the nudge ladder, and is not part of this surface; the shelf blurbs in
  `Game.COSMETIC_KIND_META` (`app/game.js:798`), which label collapsed shelves whose contents are not
  visible; per-item `desc` strings in `Game.COSMETICS` and `Game.HABITAT`.

## Validation

- Product: open Play → Shop with a balance of 0, a mid balance, and one above the top habitat price.
  The tab still answers "what can I buy, what does it cost, how far off am I" without the deleted
  prose.
- Interface: Shop tab at 390px and 320px, both themes, across: no items owned; some owned and worn;
  all stall items owned; a gated item visible but unaffordable; `stallLeft === 1` (singular "day
  left"); an account with no `amber_ledger` entries, where `earnPerDay` falls back to 30 (`:9062`).
- System: confirm no replacement paragraph or footer has been added, and that the Habitat panel's
  "Kept for good" status survives.
- Repository: `npm test` → all suites pass. `node build.mjs` → succeeds (use `build.mjs`, not esbuild
  — see `design-plans/19-handover.md`). `grep -n "footer=" app/src/app.jsx` → four matches, all in
  `FightModal`, none in `ShopView`.

## Stop conditions

- Stop if removing the stall footer leaves a user unable to tell that rotated-out items remain
  purchasable — check the "Everything else" panel is still directly below it and still shows
  `ownedCount + ' of ' + totalItems`. If that panel has moved or lost its status, report it rather
  than restoring the footer.
- Stop if scope must widen beyond `ShopView`.

## Design documentation

- After acceptance and validation: record in the next handover — "A `PlayPanel` footer must not
  restate the panel's own right-hand status. The footer is for the buddy's voice or for the one fact
  the panel's status and rows cannot carry."
