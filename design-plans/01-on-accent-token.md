# Content on accent surfaces uses the `--on-accent` token

Written against: 8be4cf7

## Evidence chain

- Surface: `app/src/app.jsx` — accent-filled controls across FOOD (barcode CTA), COOK (recipe timer, shopping badge, private checkmark), PLAY (item "USE" button), and the offline banner.
- Problem: Foreground text/glyph on `background: var(--accent)` is painted with a raw hardcoded hex instead of the `--on-accent` token, so it does not follow the token when the accent flips from neon green (dark theme) to gold (light theme, `--accent: #F5C518`).
- Design evidence: `app/src/styles.css:20` and `:52` define `--on-accent` (`#05140a` dark / `#1a1a1a` light) as the designated on-accent color; `styles.css:182` remaps `.text-black` → `var(--on-accent)`. Correct exemplar sibling: `app/src/app.jsx:9219` uses `background: 'var(--accent)', color: 'var(--on-accent)'` in the same toolbar as the drifting badge at `:9227`.
- Owner: `app/src/styles.css` token `--on-accent`.
- Scope and affected surfaces: `app/src/app.jsx:6225`, `:8272`, `:8472`, `:9227`, `:9816`, `:3153`.
- Uncertainty: None. `#0d0d0d` (`:6225`) is literally the `--card` value; `#111` and `#fff` are off-palette constants; none equals `--on-accent` in either theme.

## Design decision

Replace every hardcoded on-accent foreground with `var(--on-accent)`. At `:3153` the button also uses `background: var(--pro)` — a macro-semantics token (protein) — for a non-macro primary action; switch it to the accent primary-action pairing (`var(--accent)` + `var(--on-accent)`) so it matches every other primary button. This resolves the root problem (foreground constants that ignore the theme token) rather than each symptom.

## Reuse

- Token: `--on-accent` (`app/src/styles.css:20`, `:52`)
- Token: `--accent` (for the `:3153` background)
- Exemplar: `app/src/app.jsx:9219`

No new primitive required.

## Changes

1. `app/src/app.jsx:6225` (FOOD "Scan a barcode" CTA)
   - Change: `color: '#0d0d0d'` → `color: 'var(--on-accent)'`
   - Preserve: `background: 'var(--accent)'`, layout, handlers.
   - Verify: In light theme the CTA text is `#1a1a1a` (via token), not fixed near-black.
2. `app/src/app.jsx:8272` (COOK recipe timer button)
   - Change: `color: '#111'` → `color: 'var(--on-accent)'`
   - Preserve: `background: 'var(--accent)'`, `.pixel-btn`.
   - Verify: Timer label tracks the token across themes.
3. `app/src/app.jsx:8472` (COOK private checkmark)
   - Change: `color: '#111'` → `color: 'var(--on-accent)'`
   - Preserve: the private/transparent conditional background and border.
   - Verify: The ✓ on the accent chip uses the token when `recipe.private`.
4. `app/src/app.jsx:9227` (COOK shopping-count badge)
   - Change: `color: '#111'` → `color: 'var(--on-accent)'`
   - Preserve: badge position/size.
   - Verify: Matches its toolbar sibling at `:9219`.
5. `app/src/app.jsx:9816` (offline banner Reload button)
   - Change: `color: '#111'` → `color: 'var(--on-accent)'`
   - Preserve: `background: 'var(--accent)'`, `.pixel-btn`.
   - Verify: Reload label tracks the token.
6. `app/src/app.jsx:3153` (PLAY item "USE" button)
   - Change: `background: 'var(--pro)', color: '#fff'` → `background: 'var(--accent)', color: 'var(--on-accent)'`
   - Preserve: handler, `.pixel-btn`, sizing.
   - Verify: In light theme the button is gold with dark text, matching `Btn kind="accent"`.

## Scope

- Inherit: the six controls above.
- Verify: no other `background: 'var(--accent)'` site pairs a raw foreground hex (grep below).
- Exclude: admin badges at `:7447`/`:7544` (`var(--pro)`/`var(--danger)` + `#fff`) — not accent surfaces; `#fff` there is intentional contrast on saturated fills.

## Validation

- Product: Log a barcode, open a recipe timer, view the shopping badge, use a Play item — all in light theme.
- Interface: light theme (`.theme-light`) at mobile width; the six controls above.
- System: confirm no parallel on-accent constant remains.
- Repository: `grep -nE "background: ?'var\(--accent\)', ?color: ?'#" app/src/app.jsx` → no matches after the change.

## Stop conditions

- Stop if a site's background is not actually `var(--accent)` at runtime (e.g. conditional non-accent background) so `--on-accent` would be wrong.

## Design documentation

- After acceptance: none required — this conforms existing surfaces to the documented token; no new decision.
