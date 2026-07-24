# Toast uses the pixel-box chrome, not a soft-shadow card

Written against: 903b89d (Dashboard mobile deep-dive)

## Evidence chain

- Surface: `app/src/app.jsx` — the global `Toast` (bottom notification), which fires from Dashboard actions ("LOG A MEAL" → `showToast`, check-ins, catch messages) and so appears on the Today screen at mobile width.
- Problem: The toast card used a 1px border + soft blurred drop shadow (`border border-[#262629] … shadow-xl shadow-black/50`), contradicting the design system's "square everything, chunky borders + hard shadow" primitive that every other card/button uses.
- Design evidence: `app/src/styles.css` — `.pixel-box { border: 4px solid var(--border) !important; box-shadow: 4px 4px 0 0 var(--shadow); }` and the "pixel shapes" comment. Sibling exemplar: the catch-reveal notification directly above the toast (`app/src/app.jsx:7843`) uses `pixel-box` with an inline surface background. `Card` (`:878`) is `bg-[#161618] pixel-box`.
- Owner: `.pixel-box` in `app/src/styles.css`.
- Scope and affected surfaces: `app/src/app.jsx:7864` (the `Toast` inner card). Rendered evidence: mobile capture at 390px showed a soft-shadowed rounded card among hard-edged pixel cards.
- Uncertainty: None. Verified at render that the replacement matches the pixel cards.

## Design decision

Replace the toast's soft chrome with `pixel-box` and an inline `var(--surface2)` background, matching the sibling reveal notification and every other card. This removes the lone soft-shadow card so the notification layer reads as part of the pixel system.

## Reuse

- Primitive: `.pixel-box` (`app/src/styles.css`)
- Token: `--surface2`
- Exemplar: `app/src/app.jsx:7843` (catch-reveal notification)

No new primitive required.

## Changes

1. `app/src/app.jsx:7864`
   - Change: `className="bg-[#1E1E22] border border-[#262629] rounded-2xl px-4 py-3 flex items-center gap-4 shadow-xl shadow-black/50 fade-in"` → `className="pixel-box px-4 py-3 flex items-center gap-4 fade-in" style={{ background: 'var(--surface2)' }}`
   - Preserve: `fixed … z-[60]` wrapper, `bottom: 86`, `gap-4`, action buttons, `fade-in`.
   - Verify: toast shows a 4px border + hard offset shadow, like the reveal notification.

## Scope

- Inherit: every toast (log confirmations, catch messages, errors).
- Verify: the catch-reveal notification (`:7843`) already correct — unchanged.
- Exclude: toast position/behavior; only the card chrome changes.

## Validation

- Product: log a meal on Today; observe the confirmation toast.
- Interface: mobile 390px, dark and light theme.
- System: confirm no other notification uses `shadow-xl`/thin border.
- Repository: `grep -n "shadow-xl shadow-black/50" app/src/app.jsx` → no matches.

## Stop conditions

- Stop if the toast intentionally needs elevation distinct from cards (no such decision is documented; the sibling reveal uses pixel-box).

## Design documentation

- After acceptance: none — conforms to the existing pixel primitive.
