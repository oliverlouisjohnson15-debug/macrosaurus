# Weekly shape says each thing once, and nothing the strip contradicts

Written against: `2865c21`

## Evidence chain

- Surface: Settings → Weekly shape (`WeeklyShapeScreen`, `app/src/app.jsx`).
- Problem (rendered, 390×844, `?demo`, no trip declared, evening out off): around a single strip
  of day tiles the screen prints five blocks of explanation:
  1. intro: "Shape how your calories sit across the week… **Same weekly total either way.**"
  2. under the presets: the Match-my-training sentence.
  3. above the strip: "Tap a day to make it high, low or normal. **Same weekly total either way.**
     **The greyed days have been eaten: they keep the numbers they ran under**, so nothing you do
     here can move them."
  4. the legend (High / Normal / Low).
  5. under the strip: "**The next seven days, as they actually stand.** **Days you've already eaten
     keep the plan they ran under.**"
  Block 5 contradicts what it captions: the strip shows the days already eaten this cycle as well as
  the days ahead (13 tiles in the capture: six greyed, seven live), not "the next seven days". Its
  second sentence repeats block 3. "Same weekly total either way" appears twice (blocks 1 and 3).
- Design evidence: direct contradiction in user-facing copy within one task (block 5 vs the
  rendered strip), and verbatim duplication of the eaten-days and weekly-total statements.
- Owner: `WeeklyShapeScreen` — the `intro` prop, the tap-instruction `<div>` above the strip
  (`'Tap a day to make it high, low or normal. Same weekly total either way.'`), and the caption
  `<div>` after the strip (the `: 'The next seven days, as they actually stand.'` branch and the
  `Days you've already eaten keep the plan they ran under.` sentence).
- Scope and affected surfaces: `WeeklyShapeScreen` only.
- Uncertainty: none for the no-trip branch. The trip branches of the caption carry distinct content
  (how the trip settles) and stay.

## Design decision

Each idea is stated once, where it is acted on. The intro owns "same weekly total"; the line above
the strip owns "tap a day" and "greyed days are eaten"; the caption under the strip only exists when
it has something of its own to say (a trip, or the plan-change spread).

## Reuse

- Existing copy, de-duplicated; no new strings beyond trimming.
- Caption style unchanged: `text-[11px] text-[#8A8A90] leading-snug`.

## Changes

1. `app/src/app.jsx` — `WeeklyShapeScreen`, tap-instruction `<div>` above the strip
   - Change: `'Tap a day to make it high, low or normal. Same weekly total either way.'` →
     `'Tap a day to make it high, low or normal.'`
   - Preserve: the trip variant (`'Tap a day to make it a big one…'`), the eaten-days sentence, the
     trip sentence.
   - Verify: "Same weekly total either way" appears once on the screen (the intro).
2. `app/src/app.jsx` — `WeeklyShapeScreen`, caption `<div>` after the strip
   - Change: in the no-trip branch render nothing instead of `'The next seven days, as they actually
     stand.'`; remove the always-appended `Days you've already eaten keep the plan they ran under.`;
     keep the `spread` sentence and the trip link. Render the `<div>` only when it has content.
   - Preserve: both trip branches verbatim, the `spread` sentence, the "Change the dates…" button.
   - Verify: with no trip and no spread the strip is followed directly by the legend / next section;
     with a trip the caption reads exactly as before minus the repeated eaten-days sentence.

## Scope

- Inherit: Weekly shape, every state (no trip, upcoming trip, live trip, spread pending).
- Verify: `tests/render.test.js` weekly-shape tests that match on caption text (search for
  "as they actually stand" and "already eaten").
- Exclude: the Evening-out section, preset labels, the carry note logic.

## Validation

- Product: a person reading the screen top to bottom never meets the same sentence twice and never
  reads a caption that disagrees with the tiles above it.
- Interface: no trip; trip upcoming; trip live; a plan change with a `spread`; 390px wide.
- System: no new copy owner; caption style unchanged.
- Repository: `npm test` → all pass (update assertions that matched the removed sentences).

## Stop conditions

- Stop if a test or product note shows the "next seven days" line is meant to describe a different
  strip than the rendered one.

## Design documentation

- None.
