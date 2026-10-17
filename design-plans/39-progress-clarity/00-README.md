# 39 · Progress: easier to read weight and burn

Written against: `08f70a2`

The owner said the Progress page is "overly complex and confusing when trying to look at
expenditure and graph of weight loss or gain over time". These plans cover the two jobs they named.
They are self-contained, so run them in order and read each one fully before you start.

| # | Plan | What changes |
|---|---|---|
| 01 | [01-page-sections.md](01-page-sections.md) | Progress rows regrouped so "What you burn" and "Weigh-ins" sit right under the chart, not 1 of 7 rows under "More" |
| 02 | [02-weight-chart.md](02-weight-chart.md) | The hero and chart: each number said once, every figure labelled, and the chart cut back to weigh-ins, trend, plan and goal |
| 03 | [03-burn-sheet.md](03-burn-sheet.md) | The burn sheet opens on what you burn and how it has moved over time, with the eat-vs-burn breakdown underneath |

Run 01 first because it renames the row that opens 03. Plan 02 doesn't depend on the others.

## Calls the plans make (veto before running)

These go past what the source can prove, so they are listed here for the owner:

1. **The chart drops four layers:** the forecast line with its tinted zone and "now" line, the
   check-in notches, the premium "each week" bars inside the chart, and the gradient fill.
   `weeklyContributions` stays in the code, unused by the chart. If the weekly bars must stay
   because they're a Premium selling point, tell the executor to skip step 02.4c.
2. **The goal ETA lives only in the hero sentence**, not as a date on a projection line.
3. **The burn row and sheet are called "What you burn"** instead of "Energy". This is the card's
   own current title on this route, and the owner's question is about expenditure.
4. **Burn over time becomes a real chart** (the existing `LineChart`, with axis, dates and tap)
   instead of a 40px sparkline with no labels.

## Shared rules for every plan

- Source is `app/src/app.jsx` (one file of about 23k lines; search by function name, because line
  numbers drift). Tokens are in `app/src/styles.css`. `DESIGN.md` is the binding design contract.
- After editing source, rebuild the bundle with `node build.mjs` and commit the regenerated root
  `index.html` along with the source (README, "The root index.html is the built bundle").
- `npm test` must pass. `tests/cycle-strip.test.js` renders `ExpenditureCard` and `Goals`, and
  plan 03 says exactly which assertions change and why.
- Visual check: serve the repo root (e.g. `npx http-server -p 8080` or `python3 -m http.server`),
  open `/?demo` in Playwright Chromium at 390×844 (it's already installed; don't run
  `playwright install`, and use `executablePath: '/opt/pw-browsers/chromium'` if needed), go to
  You → Progress, and take screenshots in paper and dark themes.
- Don't touch `progressVerdict`, `trendRateKgPerWeek`, `burnEstimate`, `energyBalance` or
  anything in `app/engine.js`. These plans change presentation only, never the numbers.
