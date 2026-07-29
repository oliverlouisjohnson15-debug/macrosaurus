# The weigh-in input is labelled as an input, not as the figure above it

Written against: 43245a3

## Evidence chain

- Surface: `app/src/app.jsx` — `CheckInModal` (`:2189`), form state, for a profile with `weighCadence: 'single'` (set by answering "Once a week" to the buddy's cadence question).
- Problem: On the single cadence the sheet renders the label "This week's weigh-in" twice for two different things: once as the heading of the computed hero figure, and again ~200px below as the label of the number input ("THIS WEEK'S WEIGH-IN · ALREADY LOGGED"). The reader is given one name for a result and for the field that feeds it.
- Design evidence: Rendered capture at 420px with `weighCadence: 'single'` shows both labels in the same scroll view. The daily cadence has no such collision: its hero reads "This cycle's trend weight" and its field reads "Today's weight". The `Field` primitive (`app/src/app.jsx:1251`) renders its label in the same `pf text-[9px] uppercase text-[#8A8A90]` treatment the hero label uses, so the two read as peers rather than as heading and control.
- Owner: `app/src/app.jsx` — the weight `Field` label expression in `CheckInModal`.
- Scope and affected surfaces: `app/src/app.jsx`, the single-cadence branch of that label only. The daily-cadence label is already distinct and is not touched.
- Uncertainty: None.

## Design decision

Name the input for what it is on the single cadence — the reading you are entering — leaving "This week's weigh-in" to the hero figure it describes. The "· already logged" suffix stays, because it is what tells someone the box is pre-filled from a reading already saved today.

## Reuse

- Primitive: `Field` (`app/src/app.jsx:1251`)
- Exemplar: the daily-cadence branch of the same label expression, where hero and field already carry different names

No new primitive required.

## Changes

1. `app/src/app.jsx` — `CheckInModal`, the weight `Field` label
   - Change: On the single cadence, label the field "Your reading" instead of "This week's weigh-in", keeping the `· already logged` suffix when today's entry exists.
   - Preserve: The daily-cadence label ("Today's weight"), the suffix behaviour, and every hint variant beneath the field.
   - Verify: With `weighCadence: 'single'`, the string "This week's weigh-in" appears exactly once in the sheet.

## Scope

- Inherit: The single weigh cadence in the check-in sheet.
- Verify: The daily cadence is unchanged; the hint copy below the field still reads correctly against the new label.
- Exclude: `WeighSheet` and `WeighInEditModal`, which have no hero figure and therefore no collision.

## Validation

- Product: With a weekly cadence, open the check-in and confirm the hero figure and the input are distinguishable at a glance.
- Interface: 420px and 360px widths, with and without a reading already saved today, both themes.
- System: Confirm no other label in the sheet duplicates a hero heading.
- Repository: `node build.mjs && npm test` → build succeeds, all tests pass.

## Stop conditions

- Stop if the hero label for the single cadence is changed by other work, since the collision this resolves would no longer exist.

## Design documentation

- After acceptance and validation: none.
