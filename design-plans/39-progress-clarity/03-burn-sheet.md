# The burn sheet opens on what you burn, then how it has moved

Written against: `08f70a2`

## Evidence chain

- Surface: Progress → "What you burn" row (called "Energy" before plan 01) → `Sheet`, which renders
  `ExpenditureCard` with a `plan` render prop. Both are in `app/src/app.jsx` (`function Goals`,
  `function ExpenditureCard`). `ExpenditureCard` has no other caller in the app. It is rendered
  directly by `tests/cycle-strip.test.js`.
- Problem: everything below can be seen in source.
  1. **Two titles and a card in a sheet.** The sheet is titled `Energy` and its only child is a
     `Card` with a `CardHead` titled `What you burn`. That's two names for one screen and a framed
     card inside a framed sheet.
  2. **The burn isn't shown at rest on a free account.** On free accounts `bal` is null, so the
     sheet opens with `PremiumTease`, then a collapsed "How your burn was worked out" toggle with
     only the `low–high` range beside it. The figure `est.tdee` (which the row outside promises:
     "You burn about 2,550 kcal a day") appears only inside the expanded maths. On Premium it's
     the third of three tiles, below the balance bars.
  3. **Burn over time is a 120×40 `MiniSpark`** with no axis, no dates, no values and no tap, so
     you can't actually read how expenditure has moved.
  4. **The same figure several times.** The `CardHead` right slot shows the daily balance
     (`fmtSignedKcal(bal.avgAte - est.tdee) + ' / day'`), which the sentence underneath also
     states ("You ran a 450 kcal deficit a day"). The burn is in the tile and again in the maths.
  5. **Fill colour as text.** The "Ate" figure is coloured `var(--hero)`, which is `#2E7D6B`, the
     kcal *fill* (`app/src/styles.css`). On paper the kcal text colour is `#1F6153`.
- Design evidence (`DESIGN.md`): *"No card inside a card"*; *"Each number appears once per
  screen"*; *"On paper, text never uses a fill colour"*; Silkscreen (`.num`) for tracked numbers
  with units in Plex; `Section` is "a 15/700 heading over a 2px ink rule … No title bars and no
  boxes"; `Seg` replaces `Pill`. Precedent: `design-plans/32-settings-subscreen-one-title.md`
  (one title per screen, owned by the bar).
- Owner: `ExpenditureCard` and the `plan` render prop passed to it in `Goals`.
- Scope and affected surfaces: the burn sheet, in all three states (waiting for data, "still
  settling", and read), on free and Premium.
- Uncertainty: none on the structure. The section names are new copy.

## Design decision

The sheet is named once by its own title. Its body reads top to bottom as the owner's question
asks it:

1. **What you burn**: the figure, big, with its likely range and confidence.
2. **Burn over time**: a real chart using the same `LineChart` as weight, one point per check-in
   plus today.
3. **How it was worked out**: the existing disclosure.
4. **Eating vs burn**: the Premium balance bars and the deficit sentence, or the Premium tease.
5. **Your target**: what the plan does with that burn.
6. The forecast and data-coverage footnotes, as now.

No card frame. Groups are `Section`s.

## Reuse

- `Section`, `Seg`, `LineChart`, `BalanceBars`, `PremiumTease`, `MiniStat`, `fmtShortDay`.
- `.num` for figures (exemplar: `ProgressHero`'s `num text-[34px]` rate with a Plex unit beside it).
- Tokens: `--muted`, `--text`, `--hero` (as a **line** colour only), `--good-ink`, `--fat-ink`.
- Exemplar for sections inside a screen: `Goals` (`<Section title="Your plan">`).

## Changes

1. `ExpenditureCard`: drop the frame in all three return branches
   - Change: replace each `<Card className="p-0 mb-4 overflow-hidden"><CardHead …/><div className="p-4|p-5">…</div></Card>`
     with a plain `<div>` holding the body (the `Sheet` already pads). Remove the `title` prop and
     its default, and remove `title="What you burn"` from the call in `Goals`.
   - Move each `CardHead` right-slot text into the body:
     - waiting: a 15/600 first line with the same string (`N days to go` / `1 day to go` /
       `Almost there`), above the existing paragraph;
     - implausible: a 15/600 first line `Still settling`;
     - read: dropped (the confidence goes into step 2, and the balance is already in the
       sentence in step 5).
   - Verify: the sheet shows one title, "What you burn", and no framed card inside it.
2. `ExpenditureCard` read state: lead with the burn
   - Change: the first block is a 13px `--muted` label `You burn about`, then
     `<span className="num text-[32px] leading-none">{est.tdee.toLocaleString()}</span>` with a
     Plex 13px `kcal a day` beside it, then a 12px `--muted` line
     `Likely {est.low}–{est.high} · {confLabel}` (numbers via `toLocaleString()`).
   - Remove the `low–high` span from the "How your burn was worked out" row (it moves here).
   - Verify: on a free account the figure is visible without tapping anything.
3. `ExpenditureCard` read state: burn over time as a chart
   - Change: replace the `MiniSpark` block with
     `<Section title="Burn over time">`. Build the series with dates:
     `(db.checkins || []).filter(c => c && afterFloor(db, c.date))` mapped to
     `{ date: c.date, value: <same tdee lookup as now> }`, dropping nulls, then append
     `{ date: today, value: est.tdee }`, then `.slice(-12)`. If there are 2 or more points, render
     `<LineChart points={pts} trend={null} color="var(--hero)" decimals={0} unitLabel="kcal" />`.
     Otherwise render one 12px `--muted` line: `This builds with each weekly check-in.` (don't
     let `LineChart` show its own weight-specific empty message).
   - Preserve: the existing tdee lookup (`c.tdee`, falling back to the target row's
     `estimatedTDEE`) and the fresh-start floor.
   - Verify: with several check-ins, the chart shows dated points and tapping one shows its value
     in kcal.
4. `ExpenditureCard` read state: keep the maths disclosure
   - Change: place the existing "How your burn was worked out" toggle and its expanded text
     directly after step 3, unchanged apart from step 2's removal.
5. `ExpenditureCard` read state: eating vs burn
   - Change: wrap the Premium block in `<Section title="Eating vs burn" right="Last 28 days">`.
     Swap `Pill` for `Seg` (same `options`), and drop the separate `28 days` label. Keep
     `BalanceBars`. Replace the three-tile grid with **two** tiles, `Ate` and `Target` (the burn is
     already stated in step 2): 12px `--muted` label above a `num text-[22px]` figure, default text
     colour, so not `--hero`. Keep the "You ran a … deficit" sentence as it is. When `!bal`, the
     section holds `PremiumTease` as now.
   - Verify: on Premium, the burn figure appears once on the sheet; on free, the tease sits in
     this section.
6. `ExpenditureCard` and `Goals`: your target
   - Change: in `ExpenditureCard`, wrap every `plan` output (all three states) in
     `<Section title="Your target">`. In `Goals`' render prop, remove the outer
     `mt-3 pt-3 border-t …` wrapper and the `So your target is` label; keep the kcal figure,
     macros, the gap sentence and the safety-floor warning. Render the kcal figure as `num`
     `text-[22px]` with Plex `kcal a day`.
7. `ExpenditureCard`: footnotes
   - Change: keep `Next weekly check-in: …` and `Resting on … fully logged` as the last two lines,
     with the `borderTop` divider on the first one removed (the Section above already ends with a
     rule).
8. `tests/cycle-strip.test.js`, test `'the burn card keeps its frame while it waits'`
   - Change: the assertion `r.has('Energy')` checked the `CardHead` title, which this plan
     removes on purpose (the sheet owns the name now). Replace it with
     `assert.ok(r.has('days to go'), …)` so the test still proves the waiting state keeps its
     countdown. Leave every other assertion in the file alone. They must still pass unchanged
     (`'3 days to go'`, `'4/7'`, `'days apart'`, `'last 14 days'`,
     `'How your burn was worked out'`).

## Scope

- Inherit: the burn sheet in every state, free and Premium (`window.MISPREMIUM`).
- Verify: the sheet still scrolls inside `maxHeight: 92vh` at 390×844 with the chart added, and
  the `Goals` render prop still shows "Set your goal" when there is no base target.
- Exclude: `burnEstimate`, `energyBalance`, `E.liveExpenditure`, `BalanceBars` internals, and the
  check-in flow's own expenditure copy.

## Validation

- Product: open the sheet and within one glance read "You burn about 2,550 kcal a day", then see
  how that has moved across check-ins on a dated chart.
- Interface: `/?demo` at 390×844, paper and dark, toggling Premium if the demo allows
  (`window.MISPREMIUM`). Check a fresh account (waiting state), an account with one check-in (no
  chart, the one-line note), and an account with many.
- System: no `Card`/`CardHead`/`Pill`/`MiniSpark` left inside `ExpenditureCard`; no new
  components.
- Repository: `npm test` → all pass (with step 8's one assertion change). `node build.mjs` →
  `index.html` regenerated.

## Stop conditions

- Stop if `ExpenditureCard` has gained another caller since `08f70a2` (`grep -n "<ExpenditureCard" app/src/*.jsx`).
  Removing its frame would then change that surface too.
- Stop if any test other than the one named in step 8 fails because of a removed string. Report
  it rather than editing the test.

## Design documentation

- None. This applies existing DESIGN.md rules.
