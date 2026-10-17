# The weight hero says each thing once, and the chart draws four things

Written against: `08f70a2`

## Evidence chain

- Surface: the Progress hero. `function ProgressHero` renders the verdict block, a range `Seg` and
  metric `Dropdown`, and `TrendCard` (`bare`), which renders `LineChart`. All three are in
  `app/src/app.jsx`.
- Problem: everything below can be seen in source, top to bottom inside one `Hero`:
  1. **Unlabelled weight.** The 22px figure on the right is
     `fmtWeight(nowKg, unit).replace(/ ?(kg|lb)$/, '')`, so it has no unit and no label. In
     stones it reads `12 st 3.4`, with half a unit left on. The only clue to what it means is the
     word `trend` on a different line (the headline row's right-hand span).
  2. **Range said twice.** `Seg` shows `3M` and the `TrendCard` header immediately below shows
     `past 3 months` (`header={… RANGE_WORDS[range] …}`). `TrendCard`'s own comment says *"The
     range belongs on the footer next to the control that changes it, not in both places."*
  3. **ETA said up to three times.** The sentence says `82.0 kg in about 9 weeks`, the milestone
     ladder's right label says `Next 3.0 kg, about 2 weeks`, and the chart draws a projection line
     ending in a date label.
  4. **Chart layers.** `LineChart` can draw a gradient fill, a raw line, a trend line, weigh-in
     dots, a goal line, a plan line, a forecast tint, a projection line with a date, a "now" line,
     check-in notches and (on Premium) a 74px band of weekly cell bars. The legend explains two of
     these. Line styles also swap at 45 readings: below that the raw line is bold and the trend is
     faint and dashed, and above it the reverse. The hero's rate is read off the trend.
- Design evidence (`DESIGN.md`):
  - Colour: *"No glows, no gradients."* `LineChart` has a `<linearGradient>` area fill.
  - Type: *"Units such as 'kcal', 'g', 'kg' … stay in Plex beside the figure."*
  - Content budget: *"Each number appears once per screen."* *"At most one sentence of help at
    rest."* The chart footer carries `tap a point`.
- Owner: `ProgressHero`, `TrendCard`, `LineChart` in `app/src/app.jsx`.
- Scope and affected surfaces: the Progress hero (weight, body fat and lean tabs). `LineChart` is
  also used by the check-in weigh step (`<LineChart points={chartDots} trend={…} …/>`, which passes
  no `plan`/`project`/`marks`/`weekly`), so only steps 4a and 4e reach it.
- Uncertainty: dropping the forecast, notches and weekly bars is an owner-level call, listed in
  `00-README.md`.

## Design decision

The hero answers "am I on track" in words, and the chart shows the evidence. Each number appears
once with a label. The chart draws weigh-ins, the trend, the plan and the goal, always in the same
styles, and the legend names what is drawn.

## Reuse

- `Hero`, `Seg`, `Dropdown`, `PipMeter`, `fmtWeight`, `kgToStLb`, `fmtWeightDelta`.
- `.num` (Silkscreen, `app/src/styles.css`) for figures. Plex for units and labels.
- Tokens: `--muted`, `--text2`, `--weight`, `--good-ink`.
- Exemplar for a figure with a Plex unit: the rate in the same hero
  (`<span className="num text-[34px]">` + `<span className="text-[13px]">kg a week</span>`).

## Changes

1. `ProgressHero`: label the weight
   - Change: delete the right-hand span of the headline row (`{v ? 'trend' : 'last reading'}`).
     Replace the right-hand `num text-[22px]` figure with a right-aligned stack: a 12px `--muted`
     label (`Trend weight` when `v`, `Last reading` otherwise) above the figure. For kg: `num`
     `text-[22px]` figure `nowKg.toFixed(1)` + Plex 13px `kg`. For `st_lb`: use `kgToStLb(nowKg)`
     and render `num` `{st}` + Plex `st` + `num` `{lb.toFixed(1)}` + Plex `lb`. Keep `–` when
     `nowKg == null`.
   - Preserve: the verdict headline colour (`ink`), the 34px rate, the empty-state sentence.
   - Verify: in kg and st/lb, the figure has a label and its full unit.
2. `ProgressHero`: the range once
   - Change: pass `header={<span className="text-[12px]" style={{ color: 'var(--muted)' }}>Change</span>}`
     to `TrendCard` and delete the `RANGE_WORDS` constant. The delta on the right of that row is
     now read as "change over the selected range", and the range itself is only on the `Seg`.
   - Verify: the words "past 3 months" no longer appear, and switching 1M/3M/6M changes the delta.
3. `ProgressHero`: the ETA once
   - Change: in the milestone ladder's right label, drop the
     `{lad.weeks ? ', about ' + … : ''}` clause so it reads `Next 3.0 kg`.
   - Preserve: the sentence `Plan is −0.5 · 82.0 kg in about 9 weeks` and the ladder cells.
4. `TrendCard` and `LineChart`: cut the chart back
   - a. `LineChart`: delete the `<defs><linearGradient …/></defs>` and the `<polygon points={area} …/>`
     area fill, and remove the now-unused `area` and `gid` constants.
   - b. `TrendCard`: stop passing `project` (pass nothing). This removes the forecast tint, the
     projection line and its date, and the "now" line, all of which are gated on `projWeeks > 0`.
     Leave `LineChart`'s support for the prop in place.
   - c. `TrendCard`: stop passing `weekly`, and remove the `weekly` constant and its
     `weeklyContributions` call there. Don't delete `weeklyContributions`. (Skip this step if the
     owner vetoes, see README.)
   - d. `TrendCard`: stop passing `marks`, and remove the `marks` constant there.
   - e. `LineChart`: one encoding at every density. The trend is always the bold line
     (`strokeWidth 2`, solid, `opacity 1`). With 45 readings or fewer (`!dense`), draw readings as
     the existing dots only, with no raw polyline. When `dense`, keep the raw polyline faint
     (`strokeWidth 1`, `opacity 0.3`) and no dots. If there are fewer than 2 trend points (the
     check-in step can pass `trend={null}`), draw the raw polyline at `strokeWidth 2` as now, so
     the chart is never just dots.
   - f. `TrendCard`, the legend `div` under the chart: replace it with two items that match
     step e: a 4px dot in `color` labelled `weigh-ins` (`readings` on the body fat and lean
     tabs), and a 12×2 solid swatch labelled `trend`. Delete `tap a point`. The goal and plan
     lines already carry inline labels (`goal 82.0`, `plan`) and need no legend entry.
   - Preserve: tap-to-select tooltip, goal line, plan line, date-spaced x axis,
     `WeekdayRhythmNote` (it only appears on the mornings it applies), the empty states, and the
     body-fat Premium tease.
   - Verify: with ~20 readings and with ~120 readings (6M/1Y/All), the trend looks the same and the
     legend matches the drawing.

## Scope

- Inherit: Progress hero on all three metric tabs; the check-in weigh step chart (no gradient,
  trend-solid encoding).
- Verify: the check-in weigh step (`/?demo`, start a check-in) still draws a line with one and
  with many readings.
- Exclude: `progressVerdict`, `trendRateKgPerWeek`, `milestoneLadder`, `weeklyContributions`
  (logic unchanged), `HomeWeightSpark` and the Today band.

## Validation

- Product: someone glancing at Progress can say their trend weight, their weekly rate against
  plan, and when they will reach their goal, and each comes from one place.
- Interface: `/?demo` at 390×844 in paper and dark, with kg and st/lb (You → Settings → units),
  ranges 1M and All, and the weight and body fat tabs if the demo has body fat. Also check a
  fresh account (empty state, "Last reading").
- System: no gradient anywhere in `LineChart` (`grep -n linearGradient app/src/app.jsx` → no
  hits); no new components.
- Repository: `npm test` → all pass. `node build.mjs` → `index.html` regenerated.

## Stop conditions

- Stop if `ProgressHero` or `TrendCard` no longer match the code described here (for example,
  the hero was rebuilt after `08f70a2`).
- Stop and ask if removing `weekly` would remove the last place a Premium feature appears. Search
  for `weeklyContributions(` callers first.

## Design documentation

- After acceptance: add one line to `DESIGN.md` under Components, beside `HP`: "**Chart**:
  weigh-ins as dots, trend as the one solid line, plan and goal as labelled dashed lines. No fill,
  no forecast."
