# 35 · Reset — direction C: Handheld

Written 2026-10-08, after A shipped for the foundation and Today (#131, #132). The product owner now
prefers B, but asked to keep the identity: *"we are a GBA / Game Boy Color pixel designed app"*.
They also asked to build with [Impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0), a
design skill for coding agents. C is the proposal that combines both. Mockups are the `C-*.html` files
in `mockups/`, first in the gallery.

Nothing about the IA, the content budget (`01-direction.md` §1–2) or the shipped behaviour changes.
C is a skin, and every screen already built on the shared primitives (`Hero`, `Section`, `Row`,
`Sheet`, `AppBar`) changes by changing those primitives and the tokens.

## What Impeccable brings, and how it is used here

Impeccable is a process plus a detector, not a component library:

1. **`PRODUCT.md` and `DESIGN.md` at the repo root.** These record durable product truth and the
   committed visual world. Every later design command, ours or another agent's, reads them first. C
   becomes `DESIGN.md` (draft below) once approved.
2. **Mode = Operate** (app UI). Its rules are encoded in C: one family for UI text, a fixed type
   scale with a 1.125–1.2 ratio, restrained colour with the accent only for primary actions and
   state, and no display fonts in labels, buttons or data.
3. **The craft floor and its bans.** The relevant ones are no eyebrow kicker above a heading, no hard
   *offset* shadow outside a world that chose it, no monospace as a costume, no 4px coloured side
   stripes, and an 11px floor for functional text.
4. **The detector.** `skill/scripts/impeccable detect <file>` runs 59 deterministic rules with no API
   key, and it ran here. Results:

| Surface | Findings |
|---|---|
| A mockups (shipped style) | 11 on Today alone: 9–10px pixel labels below the 11px floor, and a striped tile |
| B mockups | 1 (the striped buddy tile) |
| **C mockups, all six screens, light + dark** | **0** |
| `app/src/styles.css` today | 3 (bounce easing in three game animations) |

Plan: install the skill into the repo (`npx impeccable install --providers=claude --scope=project`,
or a vendored copy under `.claude/skills/`), commit `PRODUCT.md` and `DESIGN.md`, and run `detect`
on the built `index.html` in CI next to `npm test`. New findings then fail the build the same way a
broken test does.

## The world: a handheld UI, rebuilt with modern restraint

The Game Boy Color and Advance never drew drop shadows, gradients or rounded cards. Their UI was
windows with notched pixel corners on a tiled ground, segmented HP and EXP bars, a dialogue box with
a nameplate and a ▼ to advance, a ▶ cursor in every menu, and four-shade palettes. C takes those
mechanisms and only those:

| Handheld mechanism | Where it appears in C | Implementation |
|---|---|---|
| **Window** with notched corners | the hero, settings groups, the search field, chips, day cells | four axis-aligned 2px rings (`--ring`): the corners stay notched. Never a diagonal offset shadow |
| **HP / EXP bar** | every meter (kcal, macros, block progress) | stepped cells inside a dark pixel frame, two-tone fill (a light top row) |
| **Dialogue box** | the buddy's line on Today | double frame, the buddy's name on the frame as a nameplate, a blinking ▼ (still under reduced motion) |
| **Menu cursor ▶** | the active tab | a 3×5 pixel bitmap (SVG mask) beside the icon, as well as the colour change |
| **A button** | the one primary action per screen, the FAB | gold, with its darker pixel row along the bottom drawn into the fill |
| **Pixel numerals** | figures you track: kcal, the meal totals, kg/week, the buddy's name | Silkscreen, 14px and up. Never on a label, a button or prose |
| **Limited palette** | everything | 4 warm neutrals + gold A-button + purple cursor/links + the macro hues as data |

What C drops from A: the purple bars (purple is now the cursor and link colour), ink title bars,
3px frames on every block, Silkscreen on labels, and the 4px diagonal offset shadow.

What C takes from B: plain rows on the page, IBM Plex Sans for all UI text, sentence case, one
tinted surface per screen, and grouped lists only in settings.

## DESIGN.md (draft, becomes the root file on approval)

```
World: Handheld. A Game Boy Color / Advance UI rebuilt with modern restraint.
Mode: Operate (app). The brand lives in precise details, not decoration.

Type
  UI and prose: IBM Plex Sans 400/500/600/700. Scale 11 · 12 · 13 · 15 · 17 · 24 (px).
  Floor: 11px for anything functional (labels, tabs, meta, buttons).
  Numerals: Silkscreen, 14px and up, for tracked figures and the buddy's name only. Tabular.
  Never: Silkscreen on labels, buttons or sentences. Uppercase eyebrows above headings.

Colour (light "daylight" / dark "backlit")
  Neutrals  bg #f4efe2 / #17141f · surface #fffaf0 / #221e2d · surface-2 #ebe4d3 / #1c1926
            line #d6ccb8 / #3a3550 · frame #2a2433 / #8f84d8
  Text      ink #2a2433 / #f1ecf7 · muted #5f5768 / #aca5b9 (≥ 4.5:1 on every neutral)
  Accent    A-button gold #F0B429 (fill only, text on it is ink) · its pixel row #b8860b
  Cursor    purple #4c4196 / #c2b8f7 (links, active tab, row icons)
  Data      protein #C7472F · carbs #3D6FB4 · fat #E0A21B · energy #2E7D6B (fills)
            and their -ink pairs for text, all ≥ 4.5:1

Shape
  Windows: square corners notched by a 2px ring (box-shadow on four axes, never diagonal).
  One window per screen holds the primary content; everything else is rows between 1px lines.
  Meters: HP bars (2px frame, stepped cells, two-tone fill).

Motion
  150–250 ms, ease-out, state only. The ▼ blink and the buddy's sprite are the only idle motion,
  and both stop under prefers-reduced-motion. No bounce or elastic easing (the detector flags it).

Components
  AppBar (buddy · context · gear) · TabBar (▶ cursor, 11px labels) · Hero (the window)
  Section (13px semibold label over a 2px line) · Row (52px+) · Chip · A-button
  DialogueBox (buddy) · HPMeter · Sheet (window rising from the bottom) · Seg (window segments)
```

## Rollout if approved

1. **C foundation PR:** the tokens and these primitives re-skinned to C: `MobileHeader`, the tab bar
   with the cursor, `Hero`, `Section`, `Row`, `PipMeter` → HP bar, `Sheet`, `Pill`/`Seg`, the chips,
   `Btn`/`SheetBtn`. Today (already on the primitives) becomes C in the same PR. Also the 11px floor
   across the app (the pixel labels that remain become Plex Sans), and bounce easing → ease-out.
   Commit `PRODUCT.md`, `DESIGN.md` and the Impeccable skill, and add `impeccable detect` to CI.
2. Then continue the existing phases (logging, Food, Train, Cook, Progress, You, Play, onboarding)
   directly in C, each measured as before plus a clean detector run.

Nothing here changes what is logged, how targets are calculated, or any game rule.
