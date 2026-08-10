# The one-thing meter is drawn in the colour of the macro it names

Written against: 281b067

## Evidence chain

- Surface: `app/src/app.jsx` — `OneThingLine`, the "ONE THING LEFT" block at the top of the Today hero card, rendered by `Dashboard` above `MacroSummaryCard`. Reached on the TODAY tab.
- Problem: The block's meter is painted `var(--accent)` regardless of which macro it names, while the `MeterRow` siblings 40px below it in the same card are painted with that macro's own constant. In the light theme `--accent` is byte-identical to `--fat`, so a block whose own text reads "56g protein to go" draws a bar in exactly the fat colour, directly above a PROT bar drawn in red. The two bars carry the same value and disagree about what colour that value is.
- Design evidence: `app/src/styles.css` `.theme-light` defines `--accent: #F5C518` and `--fat: #F5C518` — the same value — against `--pro: #E5342A`. Measured at render (420×900, `?demo`, light): the one-thing pip-bar is 10 cells, 5 lit, `rgb(245,197,24)`; the PROT pip-bar directly beneath is 10 cells, 5 lit, `rgb(229,52,42)`. Identical fill, different hue. Sibling exemplars in the same card pass the macro constant explicitly: `MeterRow label="PROT" … color={PRO}`, `color={CARB}`, `color={FAT}`, and `label="FIBRE" … color={'var(--weight)'}`. In `:root/.theme-dark` `--accent` and `--pro` are both `#39FF14`, which is why the divergence is invisible in the default theme and only surfaces in the light one.
- Owner: `PipMeter` (`app/src/app.jsx:1841`) takes `color` from its call site; the macro constants `PRO` / `CARB` / `FAT` / `CAL` and the tokens `--weight` and `--hero` are the values every other meter on this card passes.
- Scope and affected surfaces: `app/src/app.jsx` — the single `PipMeter` call inside `OneThingLine`. No other consumer passes `var(--accent)` to a macro meter.
- Uncertainty: None. The token collision is literal in `styles.css` and the divergence is measured at render.

## Design decision

Pass the macro's own colour, keyed off the loop `Game.oneThing` already returns, so the one-thing meter resolves to the same constant as the `MeterRow` for the same quantity: `PRO` for `protein`, `var(--weight)` for `fibre` (matching the FIBRE row), and `var(--hero)` for `fuel` (matching the kcal hero numeral this card leads with). This resolves the root problem — a meter introduced without the card's macro-colour contract — rather than swapping one hardcoded hue for another, and it keeps working if a theme later changes a macro colour.

## Reuse

- `PRO` — the protein constant every protein meter on this card already passes.
- `var(--weight)` — the FIBRE row's colour.
- `var(--hero)` — the kcal hero numeral's colour.
- Exemplar: `app/src/app.jsx` `MacroSummaryCard`, the four `MeterRow` calls.

## Changes

1. `app/src/app.jsx` — `OneThingLine`
   - Change: introduce a `key → colour` map beside `ONE_THING_SUFFIX` (`protein: PRO`, `fibre: 'var(--weight)'`, `fuel: 'var(--hero)'`) and pass it to the `PipMeter` `color` prop instead of the literal `'var(--accent)'`.
   - Preserve: the kicker and CTA keep `var(--accent-ink)`; those are type on a card surface, which is what `--accent-ink` is for, and they are not claiming to be a macro.
   - Verify: at 420×900 `?demo` (light) the one-thing bar renders `rgb(229,52,42)` when the loop is protein, matching the PROT bar below it.

## Scope

- Inherit: the Today hero card, both themes.
- Verify: the `firstmeal` state renders no meter at all, so it needs no colour; the finished state renders no meter either.
- Exclude: the `--accent` used by the kicker, the "LOG ›" affordance and the card outline. Those are not macro carriers and are correct as they are.

## Validation

- Product: on a day with protein outstanding, the one-thing bar and the PROT bar read as the same measurement.
- Interface: TODAY tab at 420×900 in `.theme-light` and `.theme-dark`; the three loop states (`protein`, `fibre`, `fuel`), plus `firstmeal` and finished.
- System: confirm no second colour vocabulary for macros was introduced — the map reuses the constants the card already passes.
- Repository: `npm test` → 739 passing; `node build.mjs` → rebuilds `index.html`.

## Stop conditions

- Stop if `Game.oneThing` gains a loop key with no corresponding macro colour on this card, which would mean the map is inventing a colour rather than reusing one.

## Design documentation

- After acceptance and validation: none. This applies the existing macro-colour contract; it does not create one.
