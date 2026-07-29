# The check-in's answer leads, and its callout matches its siblings

Written against: 43245a3

## Evidence chain

- Surface: `app/src/app.jsx` — `CheckInModal` (`:2189`), form state, opened from Progress → "Check in" and from the buddy's overdue ask.
- Problem: The live outcome preview ("What this check-in will say") is introduced outside the sheet's established callout pattern in two ways. It is the only block in the sheet filled with `var(--surface2)` while every sibling uses `var(--surface3)`, and it sits third in the stack, after a 175px explanatory hero and a 211px chart, so the answer starts at y=578 in a 900px viewport while the sheet scrolls to 1260px.
- Design evidence: Every other block in this sheet renders `className="pixel-box …" style={{ background: 'var(--surface3)', boxShadow: 'none' }}` — the trend-weight hero, the cycle chart, the "read from your averages" block, the estimate block, the new-targets tiles, the plateau block, and the buddy-says callout, which is the same "coloured left border on a note" pattern the preview uses (`borderLeft: '4px solid var(--good)'` on `var(--surface3)`). The result state of this same sheet orders answer before evidence: `result.reason` renders first, then the supporting blocks. Measured at render (420×900, `?demo`): preview background `rgb(236,236,236)`, sibling blocks `rgb(255,255,255)`; preview top 578px; primary action top 1273px.
- Owner: `app/src/app.jsx` `CheckInModal` form state; tokens `--surface3`, `--accent`, `--good`, `--muted` in `app/src/styles.css`.
- Scope and affected surfaces: `app/src/app.jsx` — the preview block and the block order in the form state of `CheckInModal`. No other component renders this preview.
- Uncertainty: None. The fill divergence and the ordering are both directly measurable at render.

## Design decision

Bring the preview into the sheet's callout pattern and let it lead. Fill it with `var(--surface3)` like every sibling, keeping its status-coloured left border as the thing that distinguishes it, and move it directly beneath the hero so the sheet reads answer → evidence → inputs, matching the order the result state already uses. This resolves the root problem — a block introduced without the sheet's existing pattern — rather than adjusting its colour and its position as two unrelated tweaks.

## Reuse

- Token: `--surface3` (sheet block fill), `--accent` / `--good` / `--muted` (existing status colours on the left border)
- Primitive: `.pixel-box` with `boxShadow: 'none'`, the in-sheet block convention
- Exemplar: the buddy-says callout in the same file's result state (`pixel-box p-3 flex items-start gap-2.5`, `background: var(--surface3)`, `borderLeft: '4px solid var(--good)'`)

No new primitive required.

## Changes

1. `app/src/app.jsx` — `CheckInModal`, form state
   - Change: Set the preview block's inline background to `var(--surface3)`. Move the whole `{preview && (() => { … })()}` block so it renders immediately after the trend-weight hero block and before the `{chartDots.length >= 2 && …}` chart block.
   - Preserve: The status-derived left border colour (`--accent` when the targets change, `--good` when on track, `--muted` otherwise), the headline/rate/"nothing is saved yet" copy, and the `.pixel-box` chrome with `boxShadow: 'none'`.
   - Verify: At 420×900 with `?demo`, the preview's computed background is the same value as the hero's, and its bounding-box top is smaller than the chart's.

## Scope

- Inherit: Both weigh cadences (daily and single) and every outcome the preview reports (changed proposal, no change, held, needdata).
- Verify: The result state of the same sheet is unchanged; the chart still renders below with its caption.
- Exclude: The hero copy length, the chart height, and the overall sheet length. Shortening the sheet is a separate decision with more than one valid correction.

## Validation

- Product: Open Progress → Check in with a week of weigh-ins; the outcome is readable before any scrolling and matches the result screen after completing.
- Interface: 420×900 and a narrow 360px width; both cadences; the preview's three status colours; light and dark themes.
- System: Confirm no block in `CheckInModal` uses `var(--surface2)` afterwards, so no parallel callout fill remains.
- Repository: `node build.mjs && npm test` → build succeeds, all tests pass.

## Stop conditions

- Stop if the preview block is found to be rendered by any other surface, which would make `CheckInModal` the wrong owner for the change.

## Design documentation

- After acceptance and validation: none. The change conforms to the existing in-sheet block convention rather than establishing a new one.
