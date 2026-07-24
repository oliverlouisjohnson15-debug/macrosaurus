# Replace Unicode ✓/✦ with pixel-art glyphs

Written against: 50eb0a5 (Dashboard mobile deep-dive → app-wide)

## Evidence chain

- Surface: `app/src/app.jsx` — everywhere the UI drew a checkmark (`✓`) or a shiny/amber sparkle (`✦`) inside Press Start 2P text, including the Today status strip (`✦ 90`), the Recovery "Move" dial (`✓`), fibre-goal line, Save button, recipe/shopping checkboxes, and the Play hub (shiny markers, Amber currency, shop prices).
- Problem: `✓` (U+2713) and `✦` (U+2726) are not in Press Start 2P, so the browser substituted them from a fallback font — smaller and misaligned against the blocky pixel text.
- Design evidence: measured advance widths in Press Start 2P (monospaced): real glyphs `0`/`A` = 40px; `✓` and `✦` = 24.09px, proving font substitution. The design system comment at `app/src/app.jsx:58` states "pixel-art glyphs (no emoji)" and provides the `PX_ICONS` + `PixelGlyph` system.
- Owner: `PX_ICONS` / `PixelGlyph` (`app/src/app.jsx:27`, `:59`).
- Scope and affected surfaces: 35 sites (17 `✓`, 18 `✦`) across Dashboard, Food, Cook, Progress, You, and Play.
- Uncertainty: None on the mechanism; glyph shapes tuned by rendered preview at 14px and 72px.

## Design decision

Add two pixel-art glyphs to `PX_ICONS` — `check` and `star` — and two inline wrappers (`Tick`, `Spark`) that render them via `PixelGlyph` with `color="currentColor"`, inheriting the surrounding text colour and aligning inline. Replace every `✓`/`✦` literal with `<Tick/>`/`<Spark/>`. This brings the symbols into the pixel system and removes all font fallback.

## Reuse

- Primitive: `PixelGlyph` (`app/src/app.jsx:59`)
- New glyphs: `PX_ICONS.check`, `PX_ICONS.star` (6×6, consistent with the existing 6-wide glyph grid)
- New wrappers: `Tick`, `Spark` (inline-block, `vertical-align: middle`, `currentColor`)

New primitives justified: the existing `PX_ICONS` had no check or star, and the two symbols recur in ~35 places with per-site colours, so a shared `currentColor` glyph is the correct owner. Sizes are passed per call to match local text (8–22px).

## Changes

1. `app/src/app.jsx` `PX_ICONS` — add `check: ['......','.....#','....##','#..##.','.###..','..#...']` and `star: ['#.##.#','.####.','######','######','.####.','#.##.#']`.
2. `app/src/app.jsx` after `PixelGlyph` — add `Tick`/`Spark` inline wrappers.
3. 17 `✓` sites → `<Tick size={…}/>`; 18 `✦` sites → `<Spark size={…}/>`. In ternaries returning a string, the branch becomes a fragment (`<>…</>`); where the symbol fed a renderable prop (`StatDial` `big`, `Chip` value) the component is passed directly.
   - Preserve: all surrounding copy, colours (via `currentColor`), and conditionals.
   - Verify: no `✓`/`✦` literal remains except in the explanatory comment.

## Scope

- Inherit: every checkmark/sparkle across the app.
- Verify: colour still comes from the parent (e.g. `var(--fat)` for shiny, `var(--good)` for done, `var(--on-accent)` on accent chips).
- Exclude: `COSMETIC_EMOJI` values (game cosmetics deliberately use emoji) — only the `✦` fallback in that expression was swapped.

## Validation

- Product: view Today (status strip), hit a step goal (Move dial), save a setting (SaveBar), open a recipe/shopping checkbox, open the Play shop.
- Interface: mobile 390px, dark and light theme; glyphs inherit text colour and sit inline.
- System: `PixelGlyph` renders both new kinds; no parallel Unicode symbol remains.
- Repository: `grep -nE "✓|✦" app/src/app.jsx` → only the descriptive comment line.

## Stop conditions

- Stop if a site needs a coloured glyph different from its text colour (none found; all inherit correctly).

## Design documentation

- After acceptance: optionally note in design guidance that `✓`/`✦` are drawn via `PX_ICONS.check`/`.star`, not Unicode.
