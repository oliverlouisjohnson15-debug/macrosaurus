# The draft screen's note asks the way its two siblings ask

Written against: c0fa09d

## Evidence chain

- Surface: `app/src/train.jsx` — the import journey. `BlockWizard` (`:1700`), `WorkoutImport` (`:3330`) and `BlockDraft` (`:3690`), all reached from the TRAIN tab.
- Problem: the same journey asks for the same thing — a free-text note handed to the model with the plan — on three screens, and the newest one abandons the pattern the other two use.
- Design evidence: `app/src/train.jsx:1771` and `:3394` both render `<Field label="Anything I should know" hint={IMPORT_NOTE_HINT}>` around the textarea, so the label wears `Field`'s own `pf text-[9px] uppercase` muted style and the explanation wears its `text-[12px]` hint style. `app/src/train.jsx:3770` instead hand-rolls a `pf text-[9px] uppercase` heading in `var(--accent-ink)` plus a separate `text-[12px]` paragraph above the textarea, bypassing `Field`. The result is one input in the same task whose label reads at section-heading level and in accent ink while its two siblings read as field labels.
- Owner: `Field` — `app/src/app.jsx:1580`.
- Scope and affected surfaces: `app/src/train.jsx` — the "Anything read wrong?" block inside `BlockDraft`. No other consumer.
- Uncertainty: None. Two of the three sites already establish the pattern, and the third is the most recently added.

## Design decision

Render the draft screen's note input through `Field`, with its heading as `label` and its paragraph as `hint`, matching `:1771` and `:3394`. The Card, the textarea, the Apply button and the result note stay as they are; only the label and explanation move into the shared primitive.

## Reuse

`Field` (`app/src/app.jsx:1580`), already imported into this scope and used twice in this journey.

## Verification

At 390×844 on the draft screen, the note's label computes to the same `font-size` and `color` as the note labels at `:1771` and `:3394`.
