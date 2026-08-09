# Train's completion ticks join the pixel system

Written against: c0fa09d

## Evidence chain

- Surface: `app/src/train.jsx`, rendered via `TrainTab` from `app/src/app.jsx:14110`. Reached from the TRAIN tab of the bottom nav.
- Problem: Train draws every completion tick as a Unicode `✓` literal. Press Start 2P has no glyph for it, so all of them fall back to `ui-monospace` / `Courier New` mid-sentence, on the same screens where the app's own pixel glyphs render correctly.
- Design evidence: `design-plans/05-pixel-symbol-glyphs.md` decided "Replace every `✓`/`✦` literal with `<Tick/>`/`<Spark/>`… This brings the symbols into the pixel system and removes all font fallback." That decision is built: `Tick` and `Spark` exist at `app/src/app.jsx:79-80` over `PixelGlyph`/`PX_ICONS`, and `app/src/app.jsx` retains zero `✓` literals outside one explanatory comment (`:77`). The Train tab was built afterwards and reintroduced six.
- Measured at render (390×844, `?demo&premium&dark`, TRAIN tab): 3 spans whose `textContent` is `✓`, computed `font-family: "Press Start 2P", ui-monospace, "Courier New", monospace`, `font-size: 11px`, no child `<svg>`. 16 sibling glyphs on the same page render as `<svg>`.
- Owner: `Tick` — `app/src/app.jsx:79`. Renders `PixelGlyph kind="check" color="currentColor"`, so it inherits the surrounding colour and needs no colour decision at any call site.
- Scope and affected surfaces: `app/src/train.jsx` at `:427` (Train home session list), `:1049` (session player exercise header), `:1157` (set tick), `:2037` (block builder day list), `:4022` and `:4026` (gym editor bench / bar state). No other file.
- Uncertainty: None. The literals and the owner are both directly citable, and the fallback is measurable at render.

## Design decision

Replace all six `✓` literals with `<Tick/>`. Because `Tick` takes `currentColor`, every existing `color` on the enclosing span keeps working unchanged; only the glyph source changes. At `:4022` and `:4026` the tick sits inside a running string, which is the case `Tick` was built for (`display: inline-block; vertical-align: middle`).

Sites where the surrounding type is larger than the default 11px should pass `size` so the glyph matches its neighbours: `:1049` and `:2037` sit in a `text-[13px]` span, so `<Tick size={13} />`.

## Reuse

`Tick` (`app/src/app.jsx:79`). No new primitive, no new token, no colour change.

## Verification

At 390×844, `?demo&premium&dark`, on the TRAIN tab and inside a started session: `document.querySelectorAll('span')` filtered to `textContent === '✓'` returns zero, and each former site contains an `<svg>`.
