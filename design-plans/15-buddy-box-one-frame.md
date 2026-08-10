# The buddy box, on one frame

Written against: 265e76d. Supersedes the frame decision in
`14-buddy-box-gameboy-window.md`; everything else in that plan stands.

Two faults, reported together, and they turn out to be the same fault seen from either
side of the ladder.

## 1. It did not match the rest of Today

Plan 14 made the dialogue its own `pixel-box box-double` window, on the (correct) reading
that the era stacked bordered windows rather than ruling off regions inside one card. What
that produced in this app, measured at the card's left edge:

| | Buddy card | Every other panel on Today |
|---|---|---|
| Dark rules before the text | 4 | 1 |
| Chrome | 4px border, 8px gutter, 4px border, 2px gap, 2px rule | 4px border |

Three further things followed from the nesting, none of them intended:

- The inner window's `4px 4px` drop shadow was clipped by the card's `overflow-hidden`,
  printing a black slab across the bottom of the box and into the card's own border.
- The `mx-2` gutter let the world's ground band show through on either side of the box, as
  two pale slivers halfway down the card.
- Buttons inside the box became a *third* level of framing: "Most mornings" was a bordered
  box, in a bordered box, in a bordered box.

`.box-double` had exactly one caller in the app. A bespoke frame treatment used in one
place, spending five times the chrome of its neighbours, is a complete account of why the
card read as belonging to a different product.

The era's argument still holds, but it is an argument about *windows*, not about borders,
and the card was already a window. So the dialogue keeps everything that makes it one —
the nameplate hung off its top edge, the advance `▼`, the world above it — and gives up
the frame it was duplicating. It is now a full-bleed region of the same card, hanging from
a single rule of the card's own border weight. That is the same "one object, divided
interior" grammar the macro card below it already uses for Balance and the carryover
footer.

## 2. Empty, it looked broken

The world was staged per state: a high horizon while speaking so the textbox could cover
the ground, a low one when quiet. Staging a set for what is or is not covering it is what
produced the empty case:

- The buddy did not touch its own floor. `spriteBottom` was 24 against a floor at 26, but
  the art leaves 3 transparent rows below the feet, so at `WORLD_PX` the visible feet
  landed ~8px above the horizon and the contact shadow floated in the sky.
- 120px of frame, of which about 40 carried anything: a name, a mood, a small sprite, and
  55px of blank sky.
- Nothing to press and no mark saying the card went anywhere, though it always has.

Three changes, in that order:

- **One frame in every state, 92px.** Arithmetic, not taste: a grown buddy is 21 sprite
  rows above its feet, which at `WORLD_PX * 1.12` is 66px, so a 20px floor puts the tallest
  head at 86 with six to spare. A hardware screen is a fixed rectangle, and the buddy
  growing to fill it is the whole point of `STAGE_PX`.
- **`plant`, on `BuddyScene`.** The caller names the horizon and the buddy stands on it,
  feet on the line at every stage, shadow straddling it. The small character-sheet screens
  keep placing the sprite by eye, because there the buddy is a portrait and not a figure in
  a place.
- **The fourth corner.** Quiet, the bottom-right carries `Play ›` in accent ink — the same
  muted-label / accent-tap-through footer every other card uses, with the two HUD corners
  as the label. Speaking, the box carries its own `▼` or its own buttons, so a second mark
  there would be exactly the noise the `▼` rule in plan 14 exists to prevent.

## Preview

`?demo` for the speaking card, `?demo&quiet` for the empty one (the common state for a
consistent user, and the hardest to reach on purpose while working on it), `?demo&egg` to
walk into incubation, where the hatch list is the dialogue.
