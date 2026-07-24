# Segmented tab bars render square, per the design system

Written against: 8be4cf7

## Evidence chain

- Surface: `app/src/app.jsx` — the ProgressPanel view switch (Graph/Daily/Check-ins) and the RecipeHub segment (Discover/Cookbook).
- Problem: These tab buttons carry an inline `style={{ borderRadius: 2 }}`, rendering 2px-rounded pills while every other segmented tab bar in the app renders square.
- Design evidence: `app/src/styles.css:135` — `.rounded, … .rounded-full { border-radius: 0 !important; }` ("square everything"). The inline `borderRadius: 2` bypasses this rule (it applies to no class), so the 2px reaches the rendered pill. Square exemplars that rely on the rule: `app/src/app.jsx:1236` (Trends tabs), `:3101` (Play sub-tabs), `:5483` (Log-sheet tabs) — all use `rounded-*` classes, neutralized to 0.
- Owner: `app/src/styles.css:135` (square-corner rule).
- Scope and affected surfaces: `app/src/app.jsx:2231`, `:9234`, `:9235`.
- Uncertainty: None. The three inline escapes are the only tab bars with a nonzero radius.

## Design decision

Remove the inline `borderRadius: 2` from the three tab buttons so they inherit the system's square corners. This aligns them with the three square sibling tab bars and the documented rule, eliminating the parallel rounded variant.

## Reuse

- Rule: `app/src/styles.css:135` (square corners)
- Exemplar: `app/src/app.jsx:1236`, `:3101`, `:5483`

No new primitive required.

## Changes

1. `app/src/app.jsx:2231` (ProgressPanel tabs)
   - Change: delete ` style={{ borderRadius: 2 }}` from the mapped `<button>`.
   - Preserve: `flex-1 py-2`, active/inactive `bg-white text-black font-bold` / `text-[#8A8A90]`.
   - Verify: pills render square.
2. `app/src/app.jsx:9234` (RecipeHub "Discover" tab)
   - Change: delete ` style={{ borderRadius: 2 }}`.
   - Preserve: layout, gap, active/inactive treatment.
   - Verify: square.
3. `app/src/app.jsx:9235` (RecipeHub "Cookbook" tab)
   - Change: delete ` style={{ borderRadius: 2 }}`.
   - Preserve: layout and active/inactive treatment.
   - Verify: square.

## Scope

- Inherit: the three tab buttons above.
- Verify: their shared container corners (already square).
- Exclude: `rounded-t-*` bottom-sheet corners (deliberate app-wide mobile-sheet convention, not neutralized by the rule) and game-scene `borderRadius: '50%'` art.

## Validation

- Product: open Progress and the Recipe hub; switch tabs.
- Interface: mobile and desktop; active and inactive states.
- System: confirm no inline `borderRadius` remains on any tab bar.
- Repository: `grep -nE "borderRadius: ?[1-9]" app/src/app.jsx` → only game-art/`50%` decorations remain, no tab bars.

## Stop conditions

- Stop if a product decision explicitly documents rounded segment pills (none found in `styles.css`).

## Design documentation

- After acceptance: none — this conforms to the existing documented rule.
