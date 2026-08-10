# The buddy's kicker sits on its text, and the dismiss stops setting the row height

Written against: c5ba7f9

## Evidence chain

- Surface: `app/src/app.jsx` — the message block inside `BuddyHabitat`, rendered on TODAY under the
  buddy's name whenever `buddyMessage` has something to say. The block is a kicker row
  ("CHOMPERS SAYS" / "CHOMPERS ASKS" / "CHOMPERS'S WEEK") above the line the buddy speaks.
- Problem: the kicker floated well above the text it introduces, but only on some messages. Measured
  at 390×844, `?demo`: a message **without** a dismiss ("Chompers asks", the weigh cadence) put 4px
  between the kicker's baseline box and the body text. A message **with** one ("Chompers's week")
  put **32px** — eight times the gap, on the same block, for the same relationship. The row height
  told the story: 12px without the ×, 40px with it.
- Design evidence: the dismiss was `w-11 h-11` — a literal 44×44 box — sharing a `flex items-start`
  row with an 8px `pf` kicker, so the button, not the label, set the row height. `app/src/styles.css`
  already owns the fix and documents it: `.hit` (`:344`) expands a control's tap area to 44px via a
  centred `::after` that "takes no space in layout, so a 16px close glyph stays a 16px close glyph
  and still catches a thumb". Every other `w-11 h-11` close in the app pairs with a `text-lg` or
  `text-2xl` heading, where a 44px row reads as ordinary header padding; this block, at 8px, is the
  only place the ratio breaks.
- Second cause, found while fixing the first: `styles.css` remaps the whole Tailwind type scale with
  `!important` — `.text-\[13px\] { font-size: 11px !important; line-height: 1.7 !important; }` and
  siblings for `text-sm`, `text-base`, `text-\[12px\]`, `text-\[11px\]`, `text-\[10px\]`. So
  `leading-none` on any remapped size is **silently a no-op**, and the × kept a ~19px line box
  whatever size it was set to. Measured: class `text-[13px] leading-none` resolved to
  `font-size: 11px; line-height: 18.7px`.
- Owner: `.hit` and the type-scale block, both `app/src/styles.css`.
- Scope and affected surfaces: `app/src/app.jsx`, the kicker row of the buddy message block. No other
  consumer pairs a 44px control with an 8px label.
- Uncertainty: None. Both gaps and the computed type are measurable at render.

## Design decision

Take the dismiss out of the business of setting the row height, twice over: give it `.hit` so the
44px target lives in a pseudo-element instead of the box, and size the box with `h-3` + flex centring
rather than with type, because the type scale will not let line-height be set from a utility. The row
then measures exactly the height of the kicker beside it, and the block reads the same whether or not
the message can be dismissed.

`items-start` becomes `items-center` so the glyph is optically centred on the kicker rather than
hanging from its top edge.

## Reuse

- `.hit` — `app/src/styles.css:344`, the app's existing touch-target primitive.
- Exemplar: the `hit` usages already in `app/src/app.jsx` (e.g. the welcome screen's Skip control).

## Changes

1. `app/src/app.jsx` — the kicker row in `BuddyHabitat`'s message block
   - Change: row `items-start` → `items-center`; dismiss `w-11 h-11 flex items-center justify-center
     shrink-0 shrink-0 -mt-1 -mr-1 text-base` → `hit shrink-0 h-3 flex items-center justify-center
     text-[13px]` (the duplicated `shrink-0` and the negative margins that were compensating for the
     oversized box both go).
   - Preserve: the 44px tap area, via `.hit`; the dismiss behaviour and its `aria-label`.
   - Verify: at render the row is 12px and the kicker-to-text gap is 4px in both cases, and the
     button's `::after` computes 44×44 while its own box is 7×12.

## Scope

- Inherit: every buddy message on TODAY — say, ask, weigh, recap, read, lesson.
- Verify: the messages that carry no dismiss are unchanged (they already measured 4px).
- Exclude: the other `w-11 h-11` closes across the app. They sit beside `text-lg`/`text-2xl` headings
  where the 44px row is not a misfit, and changing them is a separate decision.

## Validation

- Product: the buddy's kicker reads as the label of the line beneath it, not as a floating heading.
- Interface: TODAY at 390×844, `.theme-light` and `.theme-dark`, a message with a dismiss and one
  without.
- System: confirm `.hit` is reused rather than a second touch-target approach introduced.
- Repository: `npm test` → 740 passing; `node build.mjs` → rebuilds `index.html`.

## Stop conditions

- Stop if the tap area measures under 44px after the change, which would mean `.hit` is not resolving
  and the fix has traded accessibility for spacing.

## Design documentation

- After acceptance and validation: record in the type-scale block of `app/src/styles.css` that the
  remap carries `line-height` with `!important`, so `leading-none` and friends cannot be used to
  tighten a line box and callers must size by the box instead.
