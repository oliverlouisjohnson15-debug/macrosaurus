# Handover — the icons

> **DONE, 2026-08-13 (sw 291).** The vector `Icon` set is retired; `Icon.name` is now a wrapper over
> the pixel art, so call sites did not have to move. The leaked emoji and the Unicode geometry
> standing in for icons (✕ ▾ ▲ ▼ ‹ › ⋯ ⌄ ● ■ ★ ♥ ♡ ☀ ☾ ✚ ✎ ↳ ▶ ← → ↑ 🔒 📸 🧍 🔦 ⚡) are all drawn
> from the set now, and `info` closed the last gap (`ⓘ`).
>
> It landed in two passes. The first (sw 277) was 55 glyphs on a **16x16** grid - not the 8x8 this
> doc assumed, because 8 had no room for a chevron, a camera or a recipe card, exactly the risk in
> step 3 below. The second (sw 291) replaced that with **56 glyphs on a 24x24 grid** for the detail,
> which forced the app's ladder from 16/24/32 to **24/48**: crisp pixel art needs the render size to
> be a whole multiple of the grid, so more detail is only buyable by drawing bigger. `check` and
> `star` render inline in prose at **12px**, which works only because those two are drawn on an even
> 2px sub-grid and halve exactly. The brief that produced it is `23-icon-brief-v2.md`, and
> `tests/pixel-icons.test.js` now enforces its geometry: the 2px margin, no corner-only joins, no
> 1x1 features, optical centring, exact mirrored pairs, and that the app never asks for an off-grid
> size.
>
> Master art: `design-exports/macrosaurus-icons-24.json` → `node tools/gen-px-icons.mjs` writes it
> into app.jsx. Still open: the app icon / maskable work in "The app icon" below. The rest of this
> file is the pre-work analysis, kept for the reasoning.

2026-08-11. Written for a chat picking up icon work on Macrosaurus. Everything here was checked
against the code and the shipped assets today, not recalled.

**Repo:** `/Users/oliverjohnson/Claude/Projects/Food Tracking App`, branch `buddy-talk` (level with
`main`, deployed as sw 276). Read `design-plans/19-handover.md` for how to build and deploy, and the
memory `macrosaurus-design-system` for the visual language you have to fit into.

---

## The one thing to understand before you start

**The designs do not contain an icon set.** Across all twelve `.dc.html` files in
`~/Downloads/undefined /` there is exactly **one** inline `<svg>`. Everything that looks like an icon
in those renders is an emoji or a Unicode geometric character standing in for one:

- Bottom nav: `▦` TODAY, `◇` FOOD, `▤` COOK, and two bars for TRAIN — literally single characters at 15px
- Food tiles: 🍗 🍎 🥚 🥣
- Elsewhere: 🦖 ×18, ☀/☾ ×15 each, ✳ ×10, ✕ ×9, 🏆, 📷, 💬, 🛒, 🎙, ⚙

So **this is a design job, not a matching job.** There is no source to diff against, which is the
opposite of every other screen in this project. Do not go looking for the icon spec — it does not
exist. What the designs *do* give you is the surrounding language (see "constraints" below), and
that turns out to be enough to derive from.

---

## What exists today: four systems, and that is the problem

| System | Where | Count | What it is |
|---|---|---|---|
| **`Icon`** | `app/src/app.jsx` ~line 2061 | 19 | Stroked/filled **SVG**, 24×24 viewBox, `strokeWidth` 1.8–2, **rounded** (`rx="2"`, circles, `strokeLinecap="round"`) |
| **`PX_ICONS` / `PixelGlyph`** | `app/src/app.jsx` ~line 30–70 | 22 | **8×8 pixel grids** as `'#'`/`'.'` strings, rendered as `<rect>`s |
| **`PixelEgg`** | `app/src/app.jsx` | 16 uses | The brand mark |
| **`SpriteSheet`** | `sprites/**` + `app/src/app.jsx` | 10 palettes × 3 groups × ~11 anims | The buddy. **Not an icon system — leave it alone.** |

Plus **emoji still leaking into the UI**: 📸 and 🧍‍♀️/🧍‍♂️ in the body-fat picker, 🔒 on the locked
Discover tab, `★` in the training history, `♥`/`♡` for bond hearts, `☀`/`☾` for the day/night
affinity meta.

### The central tension

`Icon` is a **rounded, stroked, web-app icon set** sitting inside a design system whose first rule is
*square everything*. `styles.css` globally forces `border-radius: 0` on every `.rounded-*` class —
but that is CSS, and it cannot reach an SVG's `rx="2"` attribute or `strokeLinecap="round"`. So the
reset that squares the entire app silently skips the icons.

Look at the Food screen and you can see both languages at once: the nav's rounded 2×2 grid glyph
above, the 8×8 pixel food tiles below. `PixelGlyph` already belongs; `Icon` does not.

### The obvious move, and its cost

Retire `Icon` and draw all 19 on the 8×8 grid, joining `PX_ICONS`. Arguments for: it is the Game
Boy's actual tile size, it is what `PixelGlyph` already does, and it is the only way the icons stop
being the one un-squared thing in the product.

Argument against, and it is real: **19 icons is not the whole job.** `chevron` (13 uses) and `cam`
(12) are the two heaviest, and a chevron on an 8×8 grid at 15px is a chunky arrow, not a hairline —
that changes how every disclosure row reads. Prototype `chevron`, `cam` and `recipe` first and look
at them at their real sizes before committing to the other sixteen. The `PX_ICONS` comment block
says it outright: *"Test at the real size, not zoomed in."*

---

## Constraints you must fit

From the memory `macrosaurus-design-system` — read it in full, but the icon-relevant parts:

- **Two faces only**: IBM Plex Mono for prose, Silkscreen for labels/numbers/chrome. Icons sit with
  the second.
- **Ink vs fill**: every brand colour has a fill (`--fat`) and an ink (`--fat-ink`). An icon drawn in
  a fill colour at small size will fail contrast — this exact bug was found and fixed twice today by
  measurement. Use `currentColor` and let the caller pass ink.
- **3px outer frame / 2px inner rule**, hard offset shadows in `--shadow` (ink, never black).
- **9px is the type floor.** There is no equivalent stated floor for icons; the practical one is that
  an 8×8 grid needs to land on whole pixels, so **16px and 24px render crisply, 15px and 18px do
  not.** Which brings us to:

### Sizes are currently a mess

Eleven distinct widths are passed to `Icon`: 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 32 px. The
commonest are 18 (×14), 16 (×9) and 15 (×9). If you move to a pixel grid this has to be rationalised
to a small set of multiples — **16 and 24, maybe 32** — or the art will blur.

---

## The app icon / favicon / OG

Separate job from the in-app icons, same session probably.

- Generated by **`gen-icons.mjs`** at the repo root (`node gen-icons.mjs`). Dependency-free PNG
  encoder; reads `sprites/female/olaf/egg/move.png` frame 0, composites on brand purple `#5B4FA6`,
  writes `icon-192.png`, `icon-512.png`, `favicon.ico` at the root **and the same trio under `web/`**.
- **The marketing OG image is separate**: `web/og.png` (1200×630), regenerated by `fix-og.mjs`. If the
  mark changes, run **both** scripts.
- **Cache-busting is a ritual, not optional.** Every icon URL carries `?v=NNN` in `index.html`,
  `web/index.html` and `manifest.webmanifest` — currently `v=124`. Bump it everywhere, plus the
  `og:image`/`twitter:image` tokens, or browsers keep the old favicon forever.

**Measured issue worth fixing:** the manifest declares both icons `"purpose": "any maskable"`. The
mark's bounding box on the 512 is **195×240 — 38% of the width, 47% of the height**. That is safely
inside the maskable safe zone (the centre 80%), so nothing gets cropped, but it means on Android,
where the mask is applied, the egg is small in a large field of purple. A maskable icon usually wants
the mark filling more like 60–70% of the safe zone. Either enlarge the mark or ship separate `any`
and `maskable` variants.

---

## Stale things I corrected today — do not be caught by them

- The memory `macrosaurus-logo` said the brand mark is a **green pixel T-rex**. It is not, and has not
  been since commit `c46f75c`: it is the **green egg**. I have updated that memory, but if you see the
  T-rex referenced anywhere else, it is wrong.
- **`PixelDino` is dead code** — defined in `app/src/app.jsx` around line 103, rendered nowhere.
  (It appears once in `index.html`, but that file is *generated*, so that is just the compiled
  definition.) Safe to delete; do it in its own commit.

---

## How to work

The harness from the UI pass is in the repo and applies directly:

```bash
node build.mjs                 # ALWAYS this, never esbuild — build.mjs uses Babel, which rejects
                               # a JSX comment in expression position that esbuild accepts
node tools/audit-ui.mjs        # contrast of every text node, tap targets, type sizes in use
```

Drive the built app locally with **`?demo`** on `index.html` — it fakes a signed-in session with
food, training and a buddy, so every screen is reachable without Supabase. Serve it over http (a
`python3 -m http.server` in the repo root is enough).

**Verify by screenshot at real size.** That is the rule this whole project runs on, and for icons it
matters more than anywhere else — an 8×8 glyph that reads beautifully at 4× is a smudge at 16px.

Tests: `npm test`. **788/789 is green** — `tests/checkin-cadence.test.js:86` has been failing since
commit `8ac9d26`, reproduces on `origin/main`, and is already live. It is not yours.

---

## Suggested order

1. **Delete `PixelDino`.** One commit, clears the confusion.
2. **Rationalise the sizes** to 16/24 (and 32 where it's a hero). Cheap, and it has to happen before
   any pixel art lands or the art will blur.
3. **Prototype `chevron`, `cam`, `recipe` on the 8×8 grid** and look at them at 16px next to the
   existing `PX_ICONS`. This is the decision point — if a pixel chevron ruins disclosure rows, the
   answer might be "square the SVG set instead" (drop `rx`, square the caps, go to a 2px stroke),
   which is a much smaller change and still resolves the tension.
4. **Then the remaining sixteen**, whichever way step 3 goes.
5. **Sweep the leaked emoji** — 📸, 🧍‍♀️/🧍‍♂️, 🔒, ★, ♥/♡, ☀/☾ — into whichever system wins.
6. **The app icon**: enlarge the mark for maskable, regenerate with both scripts, bump every `?v=`.

Steps 1–2 are safe and uncontroversial. Step 3 is where the actual design decision lives — **do not
skip straight to step 4.**

---

## Open questions for Olly

- **Pixel icons or squared-off vector?** Step 3 above should give him something to look at rather
  than a description. He has form for reacting to renders, not proposals.
- **Does the egg stay the mark?** It replaced the T-rex three weeks ago; worth confirming before
  anyone regenerates the icon set around it.
