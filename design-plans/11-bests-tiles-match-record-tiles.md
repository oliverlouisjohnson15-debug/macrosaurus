# The "Your bests" tiles render as the record tiles they sit beside

Written against: 281b067

## Evidence chain

- Surface: `app/src/app.jsx` — `TrophyCabinet`, reached from PLAY → TROPHY CABINET. Two tile grids stack in one scroll view: "Streak records" (current streak / longest ever) and, directly beneath, "Your bests" (days logged / protein / fibre / perfect days per week).
- Problem: The two grids are the same thing — a record, as a number out of a maximum, in a `pixel-box` on `var(--surface3)` — but the newer grid renders left-aligned with a `--good-ink` numeral while the established one renders centred with a `--fat-ink` numeral. A reader scrolling from one heading to the next sees the same object presented two ways.
- Design evidence: Measured at render (420×900, `?demo`, both themes). Streak tile: `text-align: center`, numeral `rgb(154,91,0)` light / `rgb(255,47,208)` dark — `--fat-ink`. Bests tile: `text-align: start`, numeral `rgb(13,107,100)` light / `rgb(57,255,20)` dark — `--good-ink`. Everything else already matches: both are `pixel-box p-3` with `background: var(--surface3)`, `boxShadow: 'none'`, a 20px `tnum` numeral and a `text-[9px] text-[#8A8A90]` caption. The established tiles are `app/src/app.jsx` `TrophyCabinet`, the "Streak records" grid; the trophy cabinet's identity colour is `--fat-ink`, which the section's own heading glyph also uses (`PixelGlyph kind="trophy" color="var(--fat)"`).
- Owner: `app/src/app.jsx` — `TrophyCabinet`'s tile markup; tokens `--fat-ink` and `--surface3` in `app/src/styles.css`.
- Scope and affected surfaces: `app/src/app.jsx` — the "Your bests" grid only. The streak grid is the exemplar and is not touched.
- Uncertainty: None. Both properties are directly measurable at render in both themes.

## Design decision

Render the bests tiles exactly as the record tiles above them: centred, with the numeral in `var(--fat-ink)`. The cabinet already has one presentation for "a record you have set", and a second grid of records should use it rather than introduce a parallel one. The `/7` denominator stays, because it is what distinguishes a per-week best from the streak counts, which have no maximum.

## Reuse

- `var(--fat-ink)` — the trophy cabinet's numeral colour.
- `var(--surface3)` + `pixel-box` + `boxShadow: 'none'` — already used by both grids.
- Exemplar: `app/src/app.jsx` `TrophyCabinet`, the "Streak records" grid.

## Changes

1. `app/src/app.jsx` — `TrophyCabinet`, the "Your bests" grid
   - Change: add `text-center` to each tile and change the numeral colour from `var(--good-ink)` to `var(--fat-ink)`.
   - Preserve: the zero state keeps `var(--muted)` so an unset best still reads as unset rather than as a gold record; the `/7` denominator and the caption copy stay.
   - Verify: at render both grids report `text-align: center` and the same numeral colour in each theme.

## Scope

- Inherit: PLAY → TROPHY CABINET, both themes.
- Verify: the grid is `grid-cols-2` with four tiles against the streak grid's two; centring is per-tile, so the differing column counts are unaffected.
- Exclude: the badge `Track` rows and the trophy list below, which are a different object (progress toward a tier, not a record) and already have their own presentation.

## Validation

- Product: a user reading the cabinet sees one presentation for records, not two.
- Interface: PLAY → TROPHY CABINET at 420×900 in `.theme-light` and `.theme-dark`; a fresh account with no finished weeks (grid hidden) and an account with weeks logged.
- System: confirm no third record-tile variant was introduced.
- Repository: `npm test` → 739 passing; `node build.mjs` → rebuilds `index.html`.

## Stop conditions

- Stop if the streak grid's own presentation is being changed in the same pass, which would make the exemplar a moving target.

## Design documentation

- After acceptance and validation: none. This conforms a new grid to an existing presentation.
