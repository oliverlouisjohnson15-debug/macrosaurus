# 31 - First-week fixes: the plan

Source: `30-first-week-test.md` (a simulated new user, setup to first check-in). This plan covers every
finding in that report. Each item names the files it touches and the decision taken where there was a
choice. Nothing here changes the design system; see the `macrosaurus-design-system` rules (button tiers,
ink vs fill, Sheet archetype, no box soup).

Order is by risk to the user's data first, then the core loop, then friction, then polish. Every phase
ends with `node build.mjs`, `npm test`, and a re-run of the first-week harness in the browser.

## Status (2026-09-12)

**All five phases implemented in the `macrosaurus-local` worktree, not yet committed or deployed.**
`npm test` 1446/1446 (9 new tests in `tests/first-week.test.js`). Re-ran the simulated week in the browser
on the new build and confirmed, among others: blank setup fields and named validation, the selected egg
visibly framed, goal-weight projection, carbs identical on setup / Today / Progress, the journey band and
weigh-in row on Today while incubating, the Food log rolling over at midnight, protein staple still ticked
the next day, a branded-packet log hatching the egg with no AI, cooked rice first with a 180 g portion,
"Add and log another" keeping the sheet open, toasts at the top over sheets, meal chips moving an entry,
scroll reset on tab change, the check-in's closing screen, Progress quoting the same -0.7 kg/wk as the
check-in and "Checked in today", "5 of 8 days" on an 8-day account, Cook opening on Cookbook, and a
recipe built from ingredients with no AI.

Found and fixed during verification, beyond the original report:
- The check-in row was still missing on Today in the band's starting state (before the first trend read).
- The edit sheet labelled a portion "G (150 g)" for foods logged in grams.
- "chickpeas" found nothing (the food list writes "chick peas").
- A built recipe was labelled "Link".

---

## Phase 1 - Data and numbers you can trust

| # | Fix | Where | Decision |
|---|---|---|---|
| 1.1 | Food log follows the real day. When the page regains focus or a minute ticks over midnight, a Food log still sitting on the old "today" moves to the new one. A day you paged to on purpose is left alone. | `FoodLog` (app.jsx ~12957) | Only moves if the viewed date equalled the old today. |
| 1.2 | One carb figure everywhere. `macrosFromKcal` derives carbs from the ROUNDED fat, the same rule `applyKcalDelta` uses. | `engine.js` ~131 | Existing stored targets are left as they are; new and retuned targets agree. |
| 1.3 | One rate everywhere. Progress's weekly rate uses the same robust slope over raw readings as the check-in, instead of endpoint-to-endpoint on the lagging EMA trend. | `trendRateKgPerWeek` (app.jsx ~6285) | Theil-Sen over scale readings in the window, falling back to the old method when there are too few. |
| 1.4 | The day you check in reads as "checked in today", not "new cycle, 0 of 1". | `CyclePanel` coverage line | When the cycle start is tomorrow, say so. |
| 1.5 | Behaviour stats and the live burn stop counting days before the account existed. | `behaviourStats`, `ExpenditureCard` window | Window starts at the later of 14 days ago and the account's first entry; captions use the real window. |
| 1.6 | Low-confidence forecast stops contradicting "Due now". | `liveExpenditure` forecast text | "too early to say whether it will move your targets". |

## Phase 2 - The loop lives on Today

| # | Fix | Where | Decision |
|---|---|---|---|
| 2.1 | The journey band (road, check-in due row, "See your full progress") shows while the egg incubates, under the hatch list. | `journeyBand`, `BuddyHabitat` | The egg shares the box; it does not replace the plan. |
| 2.2 | A "Weigh in" row in that band on any day not yet weighed. | `BuddyHabitat` week band | Uses the existing `WeighSheet`; hidden once weighed or on a weekly-cadence account between weigh days. |
| 2.3 | Hatch staples are sticky once done. | `hatchTasks`, `db.onboarding.staples` | Protein hit yesterday stays ticked. |
| 2.4 | Hatching does not require AI. The task becomes "Try another way to log": a barcode or packet, a label, a photo or description, or a recipe. | `hatchTasks` | Sources `off`, `community`, `label`, `ai_estimate`, `recipe` all count. |
| 2.5 | The check-in closes properly: a last beat with next week's calories and macros and the next check-in date, then a toast. | `CheckInModal` 'done' beat | Not counted in "step n of 5". |

## Phase 3 - Logging without friction

| # | Fix | Where | Decision |
|---|---|---|---|
| 3.1 | The add sheet opens on Food, always (unless it was opened for a scan). | `LogSheet` `LAST_LOG_TAB` | Stop remembering the last tab. |
| 3.2 | "Add and log another": a secondary button on the confirm screen that adds and returns to search with the sheet still open. | `ConfirmFood`, `FoodTab`, `ManualTab`, `addEntry` | Ghost tier (Plex, sentence case) under the gold Add. |
| 3.3 | The Add button sits above "Not the right food?", so the primary action is never under the fold behind the AI card. | `ConfirmFood` | Reorder only. |
| 3.4 | Search ranks the cooked form of staples above raw. | `searchGenericFoods` | Penalise ", raw" for grains, pasta, rice, pulses, oats and potatoes unless the query says raw. |
| 3.5 | Typical portions for common generic foods (a bowl of porridge, a portion of rice, a fillet, a breast, an egg, a slice). | new `TYPICAL_PORTIONS` table, `ConfirmFood` via `servingG`/`servingLabel` | Grams stay the default unit; the portion is the default amount. |
| 3.6 | Branded search retries once, shows a Retry button, and drops impossible rows (over 900 kcal or over 105 g of macros per 100 g). | `FoodTab` OFF effect | |
| 3.7 | A row whose numbers do not add up opens with the numbers panel open and a "Log anyway" label. | `ConfirmFood` | |
| 3.8 | Manual entry defaults to "A serving". | `ManualTab` | |
| 3.9 | Recents show whole-gram macros, matching the diary. | `MyRow`, `RecentTab` `Row` | |
| 3.10 | Edit entry can move an entry to another meal. | `EditEntryModal`, `applyEntryPatch` | Meal chips under the name, only in the Food log's edit. |
| 3.11 | The drink sheet opens on New drink when there are no drink recents. | `LogSheet` alcohol effect | |
| 3.12 | The AI error sits directly under the Estimate button. | `DescribeTab` | |
| 3.13 | Drinks are named on the plan card when they push carbs or fat over. | Today plan card | One muted line: "incl. N kcal of drinks, split across carbs and fat". |

## Phase 4 - Setup that fits the person

| # | Fix | Where | Decision |
|---|---|---|---|
| 4.1 | New accounts start with blank body fields and no activity pre-selected; Continue explains what is missing. | setup wizard | Fresh start / edit still pre-fill from the existing profile. |
| 4.2 | One line on the first screen saying what the app is. | `EggPickerOnboarding` | |
| 4.3 | The chosen egg is visibly selected. | `EggPickerOnboarding` | Accent frame + `aria-pressed`. |
| 4.4 | Optional goal weight, and the plan step says roughly when you would reach it. | setup wizard, profile | Uses the field Progress already reads. |
| 4.5 | Diet style (balanced, lower carb, lower fat) on the goal step. | setup wizard | Engine already supports `dietStyle`. |
| 4.6 | Pace label readable (ink tokens, not fills). | `rateLabel` | |

## Phase 5 - Everywhere else

| # | Fix | Where | Decision |
|---|---|---|---|
| 5.1 | Changing tab starts at the top. | `setView` | |
| 5.2 | Toasts never cover a sheet's primary action: while a sheet or the welcome screen is up, the toast shows at the top. | `Toast`, `Sheet`, `WelcomeCarousel` | Body class set by open sheets. |
| 5.3 | The Amber reward waits its turn instead of replacing "Added ... Undo". | `showToast` queue, Dashboard effect | |
| 5.4 | "0 kg" reads "no change". | `TrendCard` | |
| 5.5 | Quotes that do not name a weekday or scold. | `DINO_QUOTES` | |
| 5.6 | Accessible names: sheet close, activity options, egg tiles, manual-entry inputs, checklist rows. | various | |
| 5.7 | Cook opens on Cookbook for free users. | `Recipes` `hubTab` | |
| 5.8 | Build a recipe from ingredients, no AI: title, servings, search the UK food list with grams, save to Cookbook. | new `RecipeBuilder`, `Recipes` | Never shared (no `source_url`); all ingredients priced so no AI re-analysis. |

## Deliberately not in this plan

- **The pixel "4" reading like a "T"** in big Silkscreen figures. That is the typeface's glyph; fixing it
  means a type decision (a different face for hero numbers), which is a design call, not a bug fix.
- **Moving Progress into the tab bar.** Settled in the mobile redesign. Phase 2 puts the loop on Today
  instead, which is what the move would have been for.

## Tests to add

- Engine: carbs derived from rounded fat agree between `computeInitialTargets` and `applyKcalDelta(t, 0)`.
- Search: "white rice" and "rice" rank a boiled form above raw.
- Hatch staples: a protein hit stays ticked the next day; a barcode or recipe entry counts as another way to log.
- Coverage: the day of a check-in reports "checked in today".
- Render: the journey band and its check-in row appear on Today during incubation.
