# Ticks on a filled `--good` badge use `--on-accent`, not white

Written against: 281b067

## Evidence chain

- Surface: `app/src/app.jsx` — every completion tick drawn as a pixel glyph inside a badge filled with `var(--good)`: the Today one-thing line's finished state, the buddy habitat's hatch tasks, the getting-started checklist, the recipe ingredient checkboxes, the "what I have in" toggle, the pantry toggle, and the shopping list. Reached on TODAY (first-run and finished-day states) and throughout COOK.
- Problem: the badge is filled `var(--good)` and the glyph inherits `color: '#fff'` through `Tick`'s `currentColor`. In the default dark theme `--good` is `#39FF14`, so a white tick on it measures **1.36:1** — the glyph is not visible and the badge reads as a plain filled square. The light theme is better but still low at **3.12:1**.
- Design evidence: `app/src/styles.css` — `:root, .theme-dark { --good: #39FF14; --on-accent: #05140a; }` and `.theme-light { --good: #17A398; --on-accent: #1a1a1a; }`. Contrast computed from those exact values: `--good`/white = 1.36:1 dark, 3.12:1 light; `--good`/`--on-accent` = **13.94:1** dark, **5.58:1** light — better in both themes. `design-plans/01-on-accent-token.md` already decided this class of problem for the accent fill: "Replace every hardcoded on-accent foreground with `var(--on-accent)`… This resolves the root problem (foreground constants that ignore the theme token) rather than each symptom." `--good` is the same situation: a theme-varying fill carrying a hardcoded foreground constant, and in the dark theme `--good` and `--accent` are the same value.
- Owner: `app/src/styles.css` token `--on-accent`; `Tick` (`app/src/app.jsx:79`) renders `PixelGlyph … color="currentColor"`, so each call site's `color` is what decides the glyph.
- Scope and affected surfaces: `app/src/app.jsx` at the seven badges that pair a `var(--good)` fill with `color: '#fff'`.
- Uncertainty: None on the mechanism or the values. The badge still reads as "done" from the fill alone, so this is a legibility fix, not a broken state.

## Design decision

Extend the decision already recorded in `01-on-accent-token.md` from `--accent` fills to `--good` fills: a glyph sitting on a theme-varying brand fill takes `var(--on-accent)`. Applying it at every site rather than only the newest one keeps a single presentation for a completion tick, which is what stops a second variant appearing the next time one is written.

Explicitly not changed: `app/src/app.jsx:12590`, whose `#fff` is deliberate and carries its own comment explaining that the `.theme-light .text-white` remap would otherwise paint it dark on a dark scrim. That is a different problem with a documented reason.

## Reuse

- `var(--on-accent)` — `app/src/styles.css` (`#05140a` dark / `#1a1a1a` light).
- Exemplar: `design-plans/01-on-accent-token.md` and the accent-filled controls it governs.

## Changes

1. `app/src/app.jsx` — the seven tick badges filled with `var(--good)`
   - Change: replace `color: '#fff'` with `color: 'var(--on-accent)'` on each.
   - Preserve: the unticked state keeps `background: 'transparent'` with a `var(--border)` outline, so only the filled state changes; badge geometry, border and glyph size are untouched.
   - Verify: at render the glyph inside a filled badge computes to `rgb(5,20,10)` in dark and `rgb(26,26,26)` in light, and the tick is visible against the fill.

## Scope

- Inherit: TODAY (one-thing finished state, hatch list, getting-started checklist) and COOK (ingredients, have-in toggle, pantry, shopping list).
- Verify: the light theme, where `--good` is teal rather than neon.
- Exclude: `app/src/app.jsx:12590` (documented deliberate `#fff`), and every tick that is not on a filled `--good` badge — the trophy list ticks inherit their row colour and are unaffected.

## Validation

- Product: a completed task shows a tick that can actually be read, in both themes.
- Interface: TODAY at 420×900 in `.theme-light` and `.theme-dark`, first-run and finished-day; COOK ingredient and shopping lists.
- System: confirm no site keeps a hardcoded foreground on a `--good` fill.
- Repository: `npm test` → 739 passing; `node build.mjs` → rebuilds `index.html`.

## Stop conditions

- Stop if a site turns out not to be a tick on a filled brand colour, which would mean the `--on-accent` contract does not govern it.

## Design documentation

- After acceptance and validation: extend `design-plans/01-on-accent-token.md` to state that the rule covers `--good` fills as well as `--accent` fills.
