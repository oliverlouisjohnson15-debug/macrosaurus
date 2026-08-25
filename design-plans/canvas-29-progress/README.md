# Canvas 29 · Progress on Today

Design canvas for getting Progress out of Settings. Six artboards: Today as it ships, three
options, the proposed strip's four states, and the strip after dark.

**The finding.** `app/src/app.jsx:17964` records why Progress left the tab bar, and why that was
safe: *"nothing daily is lost, because the verdict, the weight spark and the weekly check-in
prompt all live on the StatusCard there."* `StatusCard` no longer exists — that comment is its
last mention in the file. The demotion was paid for with a Today presence that was later deleted.

## Files

- `build.mjs` — generates all six `.dc.html` artboards. Every colour is a literal lifted from
  `app/src/styles.css`; every icon is the app's own pixel glyph. Re-run: `node build.mjs`
- `icons.json` — the 24×24 `PX_ICONS` glyphs from `app.jsx`, as SVG rects.
- `canvas.json` — artboard layout and the sticky notes.
- `*.dc.html` — the artboards (generated; edit `build.mjs`, not these).

## Rebuilding the canvas

```
node build.mjs
node "<design skill>/seed-canvas.mjs" \
  --template "<design skill>/payload.template.html" \
  --out progress-on-today.html --title "Progress on Today" \
  --artboard Main.dc.html --artboard TodayNow.dc.html --artboard OptionB.dc.html \
  --artboard OptionC.dc.html --artboard BandStates.dc.html --artboard Dark.dc.html \
  --canvas canvas.json
```
