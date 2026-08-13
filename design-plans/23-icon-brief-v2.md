# Brief for Claude Design — regenerate the Macrosaurus icon set (v2)

Paste the block below into a **new** Claude Design project. Attach
`design-exports/icons/macrosaurus-icons.pdf` (the current 16x16 set at real size) and
`design-exports/macrosaurus-icons-16.json` (the current art, in the format we need back).

Written 2026-08-12, against the set shipped as sw 277. Two decisions are baked in and should not be
reopened with Design: the grid moves **16x16 to 24x24**, and the app's icon ladder moves **16/24/32
to 24/48** to match, because crisp pixel art needs the render size to be a whole multiple of the
grid. More detail is only buyable by drawing the icons bigger on screen.

---

## The prompt

> **Draw the Macrosaurus icon set: 56 single-colour glyphs on a 24x24 pixel grid, built to a system
> rather than one at a time.**
>
> Macrosaurus is a food-and-training tracker built to look like a printed thing rather than a
> screen - and, underneath that, like a handheld game from 1998. A set already exists and ships;
> I've attached it. It was drawn on a 16x16 grid, glyph by glyph, without a system holding it
> together, and it shows: the glyphs are inconsistent in weight, several are near-duplicates of each
> other, and a few are quietly lopsided. I want the same 56 names redrawn at 24x24, with room for
> real character, and with the geometry actually correct.
>
> ### The world it lives in
>
> Warm paper, one ink, hard offset shadows, square everything, countable blocks instead of smooth
> fills. Page `#e7e3da`, panels printed on cream `#fffdf7`, one ink `#241f2e` for every rule in the
> design. Gold `#F0B429` is the primary action, chrome is purple `#5B4FA6`. Type is two faces only:
> IBM Plex Mono for prose, Silkscreen (a pixel face) for labels, numbers and chrome. **Icons belong
> with the second.** There is a dark theme and it is not a dimmed version of this - it keeps the
> app's original neon-on-black identity: black chrome, neon green `#3DFF62`, card `#0c0c11`.
>
> **Every glyph is a single-colour mask.** One colour, `currentColor`, inherited from whatever it
> sits in. No fills of its own, no baked outline, no shading, no second tone. That is not taste: the
> palette splits every brand colour into a *fill* (blocks and meters) and an *ink* (type and line
> art), because the gold that carries the whole theme measures 1.83:1 as type. A hardcoded colour
> would break dark mode and the contrast rule in one move.
>
> ### Be more imaginative than the set I'm attaching
>
> The current set is competent and boring - it is 56 generic pictograms. 24x24 is 2.25x the drawing
> area of 16x16, and I want that spent on **character, not clutter**. One telling detail per glyph,
> chosen because it is the thing that makes the object itself: the crust on the bread rather than a
> generic loaf-shape, the handle and the steam on the mug, the wear on the boxing glove, a dinosaur
> that looks like it has opinions. This is a game's iconography as much as an app's, and the buddy
> is a creature you raise, so the set is allowed personality. What it is not allowed is noise: if a
> detail does not survive at 24px, it is decoration and it should not be there.
>
> Do not adapt an existing icon library. I want these drawn, not sourced.
>
> ### Symmetry and precision - the part the current set fails
>
> I measured the shipping set and the numbers are the brief. Ink coverage runs from 12 lit pixels to
> 142, and glyph heights from 2 rows to 14, with no rule behind either - which is why it reads as 56
> separate drawings. `check` occupies 8 rows and `star` 13, and those two sit **side by side in the
> same line of running text**. Hold every glyph to all of this:
>
> 1. **Two clear pixels of margin on all four sides.** The live area is 20x20 inside the 24 box.
>    Nothing touches the edge.
> 2. **Exact symmetry, or none at all.** A vertically symmetric glyph is even-width and mirrored
>    perfectly about the seam between columns 11 and 12. Near-symmetry - one column heavier on one
>    side - is the single most common flaw in the current set and it reads as a mistake rather than
>    as style. Same for horizontal symmetry where the subject has it.
> 3. **Mirrored pairs are exact transforms of each other.** `arrow_left`/`arrow_right`,
>    `caret_up`/`caret_down`, `tri_up`/`tri_down`, `trend_up`/`trend_down`,
>    `heart_full`/`heart_empty` - each pair is one drawing, flipped or filled, never two drawings.
> 4. **No stray pixels.** Every lit pixel shares a full edge with another lit pixel. Nothing is
>    connected to the shape by a corner alone: a diagonal-only join reads as a break at small sizes
>    and as a jagged mistake when enlarged.
> 5. **Minimum feature size is 2px** in both directions - no 1px stems, no 1px gaps, no lone
>    highlight pixels. **No enclosed counter smaller than 3x3**, or it fills in.
> 6. **Diagonals are true 45 degrees**, stepped one pixel at a time, and every diagonal in the set
>    uses the same step. No 2:1 or 3:1 slopes mixed in.
> 7. **Corners are square.** No 1px chamfers, no rounded-off corners: the whole design language
>    forces `border-radius: 0` and an icon is the one place a soft corner can sneak back in.
> 8. **Optical centring.** The ink bounding box is centred in the canvas within one pixel, unless
>    the glyph is deliberately directional (arrows, chevron, play).
> 9. **Three weight classes, and every glyph declares one:**
>    - *Pictorial* (food, objects, the buddy): 18-22 rows tall, **180-270 lit pixels**.
>    - *Affordance* (chevron, close, check, star, arrows, carets, play): 14-18 rows tall,
>      **90-160 lit pixels**.
>    - *Marker* (dot, square, more): deliberately small, **30-140 lit pixels**.
>    Within a class every glyph should look like the same amount of ink. Between classes the
>    difference should be obvious and intended.
> 10. **The silhouette carries it.** If it is not recognisable as a solid black shape at 24px, no
>     amount of interior detail rescues it - interior detail is the first thing to die.
>
> ### Sizes
>
> The set ships at **24px and 48px only**, and **24px is the case that matters** - it is where
> almost every glyph is actually seen. Judge everything at 24px, never zoomed in. 48px is for the
> few hero placements (an empty-state illustration, the scanner).
>
> **Two exceptions, and they are strict.** `check` and `star` render inline inside 13px running
> text, where a 24px glyph would tower over the line, so they are also drawn at 12px - which only
> stays crisp if they halve exactly. **Draw those two on an even 2px sub-grid**: every edge on an
> even coordinate, so each 2x2 block collapses to one clean pixel at half size. They must also sit
> as an optical match for lowercase x-height, not tower over it.
>
> ### Pairs that currently collide, and must not
>
> At real size these read as the same shape as each other today. Each pair needs a different
> silhouette - not a different interior:
>
> - `sun` / `snow` - both a radial star burst
> - `drop` / `egg` - both a filled oval
> - `goal` / `photo` / `scale` / `calendar` - all "framed box with a mark inside"
> - `heart_full` / `glove` - both a rounded mass with a notch
> - `share` / `plant` - both a stalk rising from a base
> - `caret_up` / `tri_up` and `caret_down` / `tri_down` - these two pairs are *deliberately* two
>   weights of one idea: a light disclosure caret against a solid direction triangle. Keep both, but
>   make the difference decisive rather than marginal.
>
> ### Where the traffic is - get these right first
>
> If you prototype before committing to all 56, prototype these and show them at 24px:
> `close` (38 uses in the app), `chevron` (32, the disclosure affordance on list rows everywhere),
> `check` (18, inline in prose), `arrow_left` (18), `cam` (14), `star` (12, inline in prose), and
> the food glyphs `meat` / `plant` / `grain`, which are the most-seen art in the whole product -
> one sits on every logged food, every day.
>
> The six food glyphs are worn as black ink on **coloured pigment tiles** (`#E08A7A`, `#7FBFA6`,
> `#8FB6E0`, `#F0CE6A`, `#E0B183`, `#D79BC4`), and as neon on near-black after dark. Legibility as a
> silhouette on a mid-tone pigment is the harshest case in the set.
>
> ### The 56 glyphs
>
> **Names are frozen** - the app keys off them, so a rename breaks call sites. Draw all of these and
> nothing else:
>
> *Bottom nav and chrome (6), on screen constantly:* `dash` (Today - an abstract 2x2 panel grid),
> `food` (Food - cutlery), `recipe` (Cook - a cooking pot), `dumbbell` (Train), `goal` (Progress - a
> target), `more` (You - an overflow ellipsis).
>
> *Affordances (10):* `chevron` (disclosure; the code also mirrors and rotates it, so it must
> survive both), `close`, `caret_up`, `caret_down`, `tri_up`, `tri_down`, `check`, `star`, `dot` (a
> status bullet), `square` (a legend swatch).
>
> *Arrows (6):* `arrow_left` (back), `arrow_right` (forward), `arrow_up`, `corner_arrow` (a
> "derived from this" turn-down arrow), `trend_up`, `trend_down` (a line climbing or falling into a
> real arrowhead - today's pair reads as a bare diagonal slash because the head is too small to
> survive, and it sits in the app header where it is seen most).
>
> *Actions (12):* `plus`, `cam` (camera, the app's second-heaviest glyph), `photo` (a still image or
> gallery, and it must not be mistakable for `cam`), `barcode` (today's aliases into mush - fewer,
> fatter bars), `mic`, `share`, `cart` (shopping list), `gear` (settings), `sliders` (filters),
> `calendar`, `edit` (a pencil), `play`.
>
> *Food types (7), the highest-traffic art in the product:* `meat`, `plant`, `drink`, `grain`,
> `sweet`, `egg`, and `dino` - the fallback for a food we could not classify, so it reads as
> "unknown / something else" while still being the app's dinosaur.
>
> *Buddy, game and stats (14):* `trophy`, `glove` (a boxing glove - the buddy fight),
> `heart_full` / `heart_empty` (the bond meter, drawn in a row of up to five, so they must tile
> cleanly with even spacing), `scale` (bathroom scales - weigh-in), `drop` (water), `sun` / `moon`
> (day and night form), `snow` (a streak freeze), `bolt` (energy), `flashlight` (the scanner torch),
> `chat` (feedback), `figure` (a standing human, for the body-fat picker), `lock` (premium-gated).
>
> *One new glyph (1):* `info` - a lowercase i in a box, at affordance weight. It is the last thing
> in the app still rendering as a Unicode character.
>
> ### What to hand back
>
> Three things, and the first is the one that matters:
>
> 1. **A single JSON file** in exactly this shape, because it is what our build consumes directly:
>
>    ```json
>    {
>      "meta": { "grid": 24, "sizes": [24, 48], "colour": "currentColor" },
>      "icons": {
>        "arrow_left": [
>          "........................",
>          "........................"
>        ]
>      }
>    }
>    ```
>
>    56 keys, each an array of **exactly 24 strings of exactly 24 characters**, `#` for ink and `.`
>    for transparent, top to bottom then left to right. No other characters, no trailing spaces.
>
> 2. **Each glyph as a standalone SVG** on a `0 0 24 24` viewBox, `fill="currentColor"`,
>    `shape-rendering="crispEdges"`, one `<rect>` per horizontal run of ink.
>
> 3. **A contact sheet** showing the whole set at 24px and 48px on the paper page `#e7e3da` and on
>    the dark card `#0c0c11`; the six food glyphs on their pigment tiles; and a strip showing
>    `check` and `star` inline in a line of 13px prose at 12px. Put the 24px row first - that is
>    what I will judge it on.
>
> **Before you hand back, verify the geometry rather than eyeballing it.** For every glyph: 24 rows
> of 24 characters; nothing in the outer 2px margin; no lit pixel joined to the shape by a corner
> alone; no 1px feature; symmetric glyphs mirror exactly; ink count inside its class band. Tell me
> which glyphs you had to bend a rule for and why - I would rather know than find it later.

---

## Notes for whoever runs this (not part of the prompt)

- **The measurements quoted are real**, taken from `design-exports/macrosaurus-icons-16.json` on
  2026-08-12: ink coverage 12-142 lit pixels, glyph heights 2-14 rows. The class bands in the prompt
  are those scaled by area to the 24 grid (2.25x). Re-measure before quoting anything different.
- **The ladder change is the expensive half of this.** Landing a 24 grid means:
  - `GRID` in `tests/pixel-icons.test.js` goes 16 to 24, and the "nearly solid" bound with it.
  - Every `width="16"` in `app/src/app.jsx` and `app/src/train.jsx` becomes `24` (roughly 130 call
    sites), the `Icon` wrapper default goes 16 to 24, and `PixelGlyph`'s default with it.
  - `Tick` and `Spark` stay at 12px inline, which is why the prompt demands those two halve cleanly.
  - Then a **layout pass**: bottom nav, list rows, the 34px close buttons and the chip rows were all
    spaced around a 16px glyph. Budget real time for this and screenshot every screen at mobile
    width before shipping - `?demo` on the built `index.html` reaches every screen without Supabase.
- **Landing the art:** drop the returned JSON over `design-exports/macrosaurus-icons-16.json`
  (rename it `-24` and update `tools/gen-px-icons.mjs`, `tests/pixel-icons.test.js` and the app.jsx
  comment), run `node tools/gen-px-icons.mjs`, `node build.mjs`, `npm test`, then
  `node tools/glyph-sheet.mjs` for the review page in both themes.
- **Do not let the names drift.** 56 keys, 55 of them already in the JSON, `info` the only addition.
  `PixelGlyph` falls back to `dino` for an unknown kind, so a typo ships as a dinosaur rather than
  an error.
- Traffic numbers come from counting `<Icon.name` and `kind="name"` across `app/src/app.jsx` and
  `app/src/train.jsx`. `check` and `star` arrive via the `Tick`/`Spark` wrappers and the food glyphs
  via `foodKind()` in `app/engine.js`, so they never appear as literals at a call site.
- Worth adding to the test suite when the art lands, since the prompt now promises it: assert no
  corner-only joins, no 1px features, and exact mirror symmetry for the five mirrored pairs. Cheap
  to write, and it is the only thing that will catch a lopsided glyph in a future redraw.
