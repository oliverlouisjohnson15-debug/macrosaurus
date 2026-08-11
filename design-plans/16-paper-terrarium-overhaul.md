# Paper Terrarium — app-wide design overhaul

Source: Claude Design project `a8a7d227` → `Today Page.dc.html`.
(`support.js` is the dc-runtime, not design content. Nothing to port from it.)

## What the import actually changes

Three things, in descending order of blast radius:

1. **Palette.** Neon-on-black → warm paper. Ink `#241f2e` as the only border/text
   colour, page `#e7e3da`, card `#fffdf7`, inset `#f8f4e8`, empty meter cell
   `#ece7dc`/`#e6e0d3`. Chrome (top bar + bottom nav) purple `#5B4FA6` with dim
   `#cfc7ea` for inactive. Accent gold `#F0B429`. Data set: green `#2E7D6B`
   (energy), red `#C7472F` (protein), blue `#3D6FB4` (carbs/steps), amber
   `#E0A21B` (fats), purple `#5B4FA6` (fibre/streak). Muted type `#7a7264`,
   `#8c8172`.
2. **Type.** Press Start 2P (everything) → **Silkscreen** for display/labels/
   numbers + **IBM Plex Mono** for body prose. This is the biggest readability
   win available: body copy in the import runs 13.5px at 1.55, where the app
   currently squeezes prose to 10-11.5px because Press Start 2P is ~2x wide.
3. **Chrome weight.** 4px borders + 4px hard shadow → **3px outer / 2px inner
   rules + 3px offset shadow**. Meters gain a 20-cell grid overlay
   (`statBar`) rather than gapped pips.

Structurally Today is close to what already ships (buddy leads, hero macro card
with LEFT/EATEN, balance row, Move/Sleep/Ready). Real deltas: the 4-up stat
strip under the terrarium, the fibre|density split row, the quote footer, and a
centre **+ FAB** floating over the bottom nav.

## Why this is not 15,000 lines of work

The app is already token-driven:

- 1231 `var(--token)` usages in `app.jsx`.
- Of 1079 hex literals, ~850 are the eight legacy dark hexes (`#8A8A90` ×612,
  `#1E1E22`, `#262629`, `#0F0F12`, `#4A9EEB`, `#F5C542`, `#161618`, `#ff6b6b`),
  and **611 of the 612 `#8A8A90`s are Tailwind classes**, already remapped to
  tokens by the "palette remap of legacy classes" block in `styles.css`.

So the token layer genuinely controls every screen. The remaining ~230
occurrences across ~145 one-off hexes are inline styles — mostly game/sprite
art, chart series and scene colours — and those are the per-page sweep.

## Phases

### P1 — Foundation (`app/src/styles.css`, one file)
- Rewrite the token block: paper becomes the default theme, night becomes the
  derived variant. Keep every existing token *name* so nothing downstream
  breaks; only the values change. Add the ink/fill split already established
  (`--*-ink` vs `--*`) with contrast re-measured against `#fffdf7`/`#e7e3da`.
- Swap the font stack: `Silkscreen` on `.pf` and the heading remap, `IBM Plex
  Mono` on body. Re-tune the whole `.text-sm`/`.text-base`/`.text-[13px]`…
  size-remap block **upward** — it exists purely to compensate for Press Start
  2P's width and is now over-correcting.
- Re-cut `.pixel-box` (3px), `.pixel-btn` (3px + 3px shadow), `.pip-bar` →
  20-cell grid meter, and the inner-rule weight (2px) used between panel rows.

After P1 alone every screen changes. That is the checkpoint where screenshots
matter most.

### P2 — Today
The 4-up stat strip, fibre|density split, quote footer, LEFT/EATEN tab chrome,
and the nav FAB. Touches `Dashboard` and `BottomNav` in `app.jsx`.

### P3 — Per-surface sweep
Screens with inline colour the token layer cannot reach, in priority order:
Food log · Add-food sheet (food/recent/describe/manual/photo) · Cook (list,
detail, import, fridge, shopping, planner) · Train · Progress/Goals · You +
settings subscreens · Play overlay (buddy, battle, shop, dex) · Weigh-in ·
Check-in · Paywall · Onboarding · Toasts/sheets · Admin (lowest).

### P4 — Build, verify, ship
`node build.mjs` → bump `sw.js` VERSION → push `main`. Tests (`npm test`, 82)
must stay green. Build throws on em dashes — keep the source clean.

## Screenshots needed from Olly

Most screens are behind Supabase auth, so I cannot capture them myself. What I
need, in the order I need it:

**Round 1 (before P3, after P1 lands) — the sweep targets:**
Food log · Add-food sheet · Cook list · Recipe detail · Fridge scan · Train
(dashboard + a session) · Progress/Goals · You/settings · Play (buddy, shop,
battle) · Weigh-in · Check-in · Paywall.

**Round 2 — screens worth a holistic Claude Design pass** (these carry the most
bespoke layout, so a token swap alone will look retrofitted rather than
designed): Add-food sheet, Recipe detail, Train session, Progress/Goals, Play
buddy/shop.
