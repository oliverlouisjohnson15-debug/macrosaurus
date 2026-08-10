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

## 3. And then: never empty at all

With the frame fixed and the buddy on its floor, the empty card is presentable. It is still
the wrong thing to show. The ladder in `buddyMessage` is seven rungs of *requests* — weigh
in, read your week, log a meal, look at the new plan — and it deliberately ended in nothing
when none applied. From `buddyCoach`, before this change:

> SILENCE. This used to fall through to a warm filler line, which was harmless at the bottom
> of Today and is not harmless at the top of it: a block that always talks is one people
> learn to scroll past, and an assistant whose defining problem is being always-there has a
> name.

That reasoning is right and is kept. It just answered a different question than the one the
card asks. Silence is the correct response to *"do not nag"*; it is not a response to *"what
does this card show"*, and the card cannot tell the two apart. What a well-run day actually
produced was a frame with a sprite in it and no words — the reward for finishing, rendered
as the same thing as a bug.

The distinction that does the work is **request vs. statement**. The Clippy and Duo failure
mode is interruption *with a demand attached*; a companion being visibly present is not that.
So the ladder gets an eighth rung, `buddyRest`, which cannot return null:

- **No CTA, no key.** Nothing to obey, and no `×`, because nothing is being asked that could
  be waved away. In the habitat that makes it `bare`, so it gets the blinking `▼` and taps
  through to the Play hub — the affordance the quiet card was missing.
- **No numbers.** The macro card directly below owns the day's figures. What the line carries
  is the part the figures do not: that the day is finished and nothing is owed.
- **Five pools, picked by state**, not one filler line: everything landed, landed with a run
  behind it, landed *and* trained, an open loop the user waved away (say nothing about it),
  and napping. `landed` keys off `Game.oneThing` returning null — the same test the open-loop
  rung uses, so the two can never disagree about what a good day is.
- **Rotated by day-of-year**, seeded not random, so a fortnight of good days is not a
  fortnight of the same sentence and the line does not change under someone mid-glance.

It is the same shape as the food-quality line that already sits higher up the ladder, which
has been doing exactly this on premium accounts all along.

`tests/buddy-rest.test.js` holds it shut: it reads the source and fails if `buddyMessage`
can end on a bare `return null`, if `buddyRest` grows an empty return, or if a pool loses
its lines. That is the rung most likely to be quietly reopened by someone adding a rung
above it.

## Preview

`?demo` for the speaking card, `?demo&rest` for a finished day, `?demo&egg` to walk into
incubation where the hatch list is the dialogue. `?demo&quiet` still renders the blank
fallback, which the ladder itself can no longer reach — it is kept working so that "never
blank" degrades into a tap-through rather than a void if a future rung returns early.
