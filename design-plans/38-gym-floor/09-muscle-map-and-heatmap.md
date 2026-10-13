# 09 · A muscle map and a training calendar

## Evidence

- Coverage is computed per muscle (`Training.coverage`, `app/training.js:1388`). It's only drawn as
  text bars (`CoverageBars`, `app/src/train-core.jsx:345`) on `CoverageScreen`
  (`app/src/train.jsx:217`) and in compact form on Train home.
- There are 17 muscles (`Training.MUSCLES`): ch, fd, sd, rd, lt, ub, lb, bi, tr, fa, ab, ob, qu, ha,
  gl, ad, ca.
- `35-reset/02-opengym.md` cleared the outline source: **melihcolpan/MuscleMap, MIT**. Take it from
  upstream with its licence notice, **not** from openGym's AGPL copy.
- There's no calendar of training days. `TrainHistory` (`app/src/train.jsx:854`) is a list.

## Part A · Muscle map (M)

1. **Asset.** Fetch the MIT SVG outlines (front and back) from upstream into
   `app/assets/muscle-map/`. Commit `LICENSE-musclemap.txt` beside them and a line in the app's
   licences screen (search for where other third-party notices are listed). Map each region path to
   our 17 ids in one table, `MUSCLE_REGIONS = { ch: ['chest-left','chest-right'], … }`. Regions with
   no muscle id of ours (neck, tibialis) stay as outline only. Hand-check the mapping and list it in
   the PR.
2. **Component: `MuscleMap({ coverage, view })`** in `app/src/train-core.jsx`.
   - Inline SVG.
   - Fill = coverage band, using the same tokens `CoverageRow` uses: `--good` in range, `--muted2`
     short, `--warn` past recovery, `--track` none.
   - Strokes in `--border`, so it works in paper and dark.
   - Front and back side by side at ≥ 360 px, a `Seg` toggle below that.
   - Tapping a region opens the existing coverage row's explanation (`gapSentence`, `:383`).
   - `aria-label` per region: "{Muscle}: {sets} sets, {band}".
   - No new colours.
3. **Where it shows:**
   - top of `CoverageScreen`, above the bars
   - `BlockPreview` (`app/src/train-build.jsx:93`), so you see the shape of a programme before you
     start it. This works well with plan 05's additions toggle: flip it and watch the delts fill.
   - **not** on Train home, which is already at its content budget (`DESIGN.md`).
4. Test: a render test where every muscle id resolves to at least one region and each band produces
   its token.

## Part B · Training calendar (S)

1. **Engine:** `Training.dayTotals(logs)` returns `{ [dateISO]: { sets, tonnage } }`, pure, tested.
2. **Component:** a 12-week grid at the top of `TrainHistory`. Seven rows, Monday first to match
   `trainingDaysOfWeek`, and one column per week.
   - A cell is `--track` with no session, or `--accent` at three opacities by working-set count
     (1–10, 11–20, 21+).
   - Tapping a cell scrolls the list to that day.
   - A 12-week limit keeps it at phone width with a 16 px gutter. Older history stays in the list
     below.
3. **Not** a year view. `35-reset` noted that it duplicates the week strip.

## Verify

- `npm test`, plus the new render tests.
- `?demo` at 320×640 and 390×844, paper and dark: map legible, no horizontal scroll, calendar fits.
