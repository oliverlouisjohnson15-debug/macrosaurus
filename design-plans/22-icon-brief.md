# Brief for Claude Design — the Macrosaurus icon set

Paste the block below into Claude Design. Attach `design-exports/icons/macrosaurus-icons.pdf` (or
`index.html`) so it can see what exists today at real size.

Written 2026-08-11, against the Paper Terrarium theme as shipped in sw 276.

---

## The prompt

> **Design a single unified icon set for Macrosaurus, a food-and-training tracker built to look like
> a printed thing rather than a screen.**
>
> **The problem.** The app currently has two icon systems that don't belong together. One is a
> rounded, stroked, 24×24 web-app vector set (19 glyphs). The other is 8×8 pixel art (22 glyphs). The
> design language's first rule is *square everything* — the stylesheet globally forces
> `border-radius: 0` — but CSS can't reach an SVG's `rx` attribute or `strokeLinecap="round"`, so the
> vector icons are the one un-squared thing left in the product. On the Food screen you can see both
> languages at once: a rounded 2×2 grid glyph in the nav, chunky pixel food tiles below it. I need
> one set, in one voice.
>
> **The theme it has to sit in — Paper Terrarium.** Warm paper, one ink, hard offset shadows, square
> everything, countable blocks instead of smooth fills. Page `#e7e3da`, panels printed on cream
> `#fffdf7`, and a single border/ink colour `#241f2e` used for every rule in the design. Gold
> `#F0B429` is the primary action. Chrome is purple `#5B4FA6`. Panels carry a 3px outer frame and 2px
> inner rules, with hard offset shadows in ink — never black. Type is two faces only: IBM Plex Mono
> for prose, Silkscreen (a pixel face) for labels, numbers and chrome. Icons belong with the second.
>
> There is a dark theme, and it is **not** a dimmed version of this — it keeps the app's original
> neon-on-black identity on the same layout: black chrome, neon green `#3DFF62`, card `#0c0c11`. The
> two themes share structure and weight, not a palette. **So every icon must work in both**, which
> leads to the hardest constraint:
>
> **Icons are single-colour masks, not pictures.** Each one renders in `currentColor` and inherits
> its ink from the caller. No fills of their own, no baked outlines, no shading, no second tone.
> This is not a stylistic preference — the palette splits every brand colour into a *fill* (for
> blocks and meters) and an *ink* (for type and line art), because the gold that carries the whole
> theme measures 1.83:1 as type. An icon with a hardcoded colour would break both dark mode and the
> contrast rule.
>
> **Grid and sizes.** Draw on an **8×8 pixel grid** so the art lands on whole pixels at 16, 24 and
> 32px — those are the only three sizes I want to ship. (Today eleven different widths are in use,
> from 12 to 32, which is part of why the current set looks inconsistent. I'm rationalising that as
> part of this work.) 16px is the common case and the one that matters: **every glyph must be judged
> at 16px, not zoomed in.** The existing pixel set went from 6×6 to 8×8 precisely because at 6×6 a
> drumstick, a bread roll and a biscuit all resolved to "filled rounded shape".
>
> **The one decision I want you to settle first.** Before drawing all 41, prototype exactly three —
> `chevron`, `cam` and `recipe` — and show them to me at 16px next to the existing pixel glyphs. Two
> viable routes and I don't know which wins:
>
> 1. **Everything goes to the 8×8 pixel grid.** It's the Game Boy's real tile size, it's what half
>    the set already does, and it's the only option that fully resolves the square-everything
>    tension.
> 2. **Square off the vector set instead** — drop every `rx`, square the line caps, go to a uniform
>    2px stroke, keep the 24×24 box. Much smaller change, still resolves the tension, and keeps
>    hairline glyphs hairline.
>
> The risk with route 1 is `chevron`: it's the disclosure affordance on list rows throughout the app,
> and a chunky 8×8 arrow changes how every one of those rows reads. `cam` and `recipe` are the two
> most detailed glyphs, so they're the honest test of whether 8×8 has enough room. Show me renders,
> not a description — I react to what I can see.
>
> **What to draw.** Once the route is settled:
>
> *Navigation and chrome (6):* dash, food, recipe/cook, dumbbell/train, goal, more
> *Actions (9):* plus, cam, barcode, mic, share, cart, gear, sliders, calendar
> *Affordances (3):* chevron, check, star
> *Food types (6) — the highest-traffic glyphs in the product, one on every logged food, and worn on
> a coloured tile so they must read as a black silhouette on a mid-tone pigment:* meat, plant, drink,
> egg, grain, sweet
> *Buddy and stats (8):* dino, trophy, glove, scale, sun, moon, snow, drop
> *Currently emoji, and I want them absorbed into the set (6):* a camera for the body-fat picker, a
> standing figure, a padlock for locked features, a heart (filled and empty, for the buddy bond), and
> up/down trend arrows.
>
> **Do not draw these** — they exist in the code but are rendered nowhere, and I'm deleting them:
> strategy, compass, and pixel up, down, drop, doc, plate, cup.
>
> **Style reference — look at these, don't copy them.** The silhouette language of Gen 5 Pokémon
> item sprites is the right instinct: a chunky readable shape, generous negative space, no interior
> detail that dies below 24px. Browse them at
> **https://github.com/PokeAPI/sprites/tree/master/sprites/items** (the `gen5/` subfolder is the most
> relevant). Two reasons this is reference only and nothing from it can be used directly: they're
> Nintendo/Game Freak assets in a repo with no open licence, and they're 30×30 multi-colour PNGs with
> baked outlines and shading, where I need single-colour 8×8 masks. Take the *approach* — how a shape
> stays readable when it's tiny — not the rendering.
>
> For structural reference on how a pixel-grid *UI* icon stays legible at small sizes (chevrons,
> camera, calendar), **https://github.com/halfmage/pixelarticons** is the better study, and it's MIT
> licensed, so it's also a legitimate starting point if you'd rather adapt than draw from scratch.
>
> **Hand back:** each glyph as a standalone SVG using `currentColor`, plus a contact sheet showing
> the whole set at 16 / 24 / 32px on both the paper page `#e7e3da` and the dark card `#0c0c11`. If
> you go the pixel route, also give me the 8×8 grids as `#`/`.` text, since that's the form the code
> stores them in.

---

## Notes for whoever runs this (not part of the prompt)

- The three-glyph prototype gate is deliberate and comes from `design-plans/21-icons-handover.md`.
  Don't let it get skipped — it's where the actual design decision lives.
- The food-type glyphs sit on `--food-*` pigment tiles (`#E08A7A`, `#7FBFA6`, `#8FB6E0`, `#F0CE6A`,
  `#E0B183`, `#D79BC4`) on free accounts only; premium tiles carry the Density Score colour instead.
  Either way the glyph is black ink on a light-enough pigment.
- `check` and `star` are used inline in running text via the `Tick`/`Spark` wrappers at 8–13px —
  below the 16px floor this brief sets. Worth deciding whether they get a second, simpler cut for
  inline use or whether the call sites move up to 16.
- Two questions for Olly that predate this brief: pixel vs squared vector (the prompt puts it to
  Design as a prototype), and whether the green egg stays the brand mark.
