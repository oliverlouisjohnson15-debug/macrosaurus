# Canvas 29 · Progress on Today

Design canvas for getting Progress out of Settings. **Option A is the chosen direction.**

Page 1 (Option A): Today as it ships, the strip in place, the same after dark, and the strip's
four states. Page 2 keeps the two options not taken, as the record of the decision.

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

## Option A, as drawn

A "This cycle" strip between the buddy box and Today's plan: `CardHead` carrying the verdict,
one row of trend weight + the 90-day spark + a chevron, and a footer that appears only when it
has something to add. 94px at rest, leaving the plan card clear of the fold (~683px of the
693px usable). It grows to 158px when the check-in is due, 143px on a thin read, and 115px on a
fresh account with nothing to say yet.

It does not make Progress a destination — the settings-overview card stays its only front door.
Option C on page 2 is the unfinished half of that.

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
