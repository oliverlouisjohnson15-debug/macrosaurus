# 30 - First-week user test

Tested 2026-09-12 against `origin/main` @ 610e811 (local worktree `macrosaurus-local`, port 8197).

## How it was run

- A brand-new user, walked through as a person would: `?demo&onboard` (blank account), phone viewport 375x812.
- Persona: female, 29, 165 cm, 72 kg, lightly active, new to tracking, wants to lose fat.
- A week was simulated inside one page load by offsetting `Date` (demo state does not survive a reload).
  Sat 12 Sep to Sat 19 Sep, check-in on day 8.

| Day | What the user did | End of day |
|---|---|---|
| Sat 12 | Setup, porridge, manual wrap, salmon + rice, glass of wine | 242 kcal left, carbs 24 g over |
| Sun 13 | Recents for every meal, weigh-in 71.9 | 385 left |
| Mon 14 | Recents + grilled chicken snack, weigh-in 71.8 | 89 left, protein hit |
| Tue 15 | Breakfast + half a lunch only, no weigh-in, tried AI estimate | 1139 left |
| Wed 16 | Weigh-in 71.6, forgot to log, backfilled on Thu from the Food log | 607 left |
| Thu 17 | Weigh-in 71.7, 1,178 kcal takeaway entered manually | 39 over |
| Fri 18 | Full day, weigh-in 71.4 | 311 left |
| Sat 19 | Check-in with 71.3 | held at 1544 kcal |

**Could not be tested in demo:** anything AI (Estimate, photo, menu, recipe import, fridge), barcode
camera, sign-in/sync, Premium, Google Health, notifications. The egg therefore never hatched, because one
hatch task needs an AI estimate.

---

## Part 1 - Bugs, ranked

### High

**1. Food log keeps yesterday's date after midnight, and meal cards log to it.**
`FoodLog` holds the viewed day in `useState(today)` (`app/src/app.jsx:12959`) and never moves it when the
real day changes. Moving the clock past midnight with the Food tab open and firing `visibilitychange` /
`focus` left the page reading **"Today"** over Saturday's 242 kcal. The meal card's `+ Add food` passes that
stale `date` (`app.jsx:13511`), so someone who leaves the PWA open overnight and logs breakfast from a meal
card files it under yesterday. (The mislabel was observed; the misfiling follows from the code.)
Fix: when the page regains visibility, if the viewed date equalled the old `today`, move it to the new one.

**2. On check-in day, Today says nothing about the check-in.**
Sat 19 Sep, check-in due: no button, banner or line anywhere on Today. The only prompt is the Progress card
inside **You** ("Your weekly check-in is due"). The check-in is the product's core loop; a new user who
never opens You never meets it. MacroFactor-style apps put it in front of you the moment it is due.

**3. From day 2, Today has no way to weigh in (at least while the egg incubates).**
The only weigh control on Today is the checklist's "Add a weigh-in", which is already ticked from setup and
does nothing when tapped. The real route is You, Progress, Weigh in: three taps for a daily action. (The
cycle strip with its Weigh in button, `CycleStrip` at `app.jsx:6843`, did not appear on Today all week.)

### Medium

**4. The egg's progress goes backwards overnight.**
Mon 14 hit protein: egg 4/5. Tue 15 morning: 3/5, "Hit your protein target" unticked. The task reads
today's entries only (`hatchTasks`, `app.jsx:~12488`). Make each staple sticky once done (store a flag).

**5. The egg cannot hatch without an AI estimate.**
Hatch needs "Try a Photo or Describe estimate" (`source === 'ai_estimate' || 'label'`). Free users get 10 a
month, so it is possible, but anyone who does not want AI stays an egg indefinitely, and incubation also
suppresses other Today content. Consider letting any second logging method count (scan, recipe, copy day).

**6. Carb target disagrees between screens: 109 g vs 108 g.**
Setup step 4 and Progress show 109 g, Today and Food show 108 g. `macrosFromKcal` derives carbs from the
unrounded fat and then rounds fat (`app/engine.js:131-132`); the day-target path re-derives carbs from the
rounded fat (`engine.js:853`). Reproduced in Node: `computeInitialTargets` gives carbs 46, `applyKcalDelta(t, 0)`
gives 45. Derive carbs from the rounded fat in `macrosFromKcal` too.

**7. Switching tabs keeps the previous tab's scroll position.**
Train at scrollY 335, tap Cook: Cook opens at 194 (its max), header out of view. `setView`
(`app.jsx:20704`) never resets scroll. Add `window.scrollTo(0, 0)` on a view change.

**8. Branded search fails intermittently with no way to retry.**
"Brands and packets" said "Couldn't search just now. Try again." for 2 of the first 3 searches (porridge,
salmon); the identical URL fetched from the page moments later returned 200 in 0.6 to 1.1 s. It is one
un-retried, un-timed `fetch` to Open Food Facts' legacy `cgi/search.pl` per debounced keystroke
(`app.jsx:13955-13965`). There is no retry button, and that endpoint is rate-limited. Add one automatic
retry, a visible Retry, and ideally a cached server-side proxy.

**9. After the check-in, Progress contradicts itself.**
- The check-in said **-0.7 kg/wk**; seconds later the buddy on Progress says "You are losing **0.5 kg** a
  week" (`app.jsx:6595` reads a different estimate).
- "New cycle, **0 of 1** day logged and **0 of 1** weigh-in" sits directly above "weighed today".
- Before the check-in, "Weekly check-in: Due now" sat alongside "Next weekly check-in: need a bit more data
  to call it", and "Resting on 6 of **14** days" uses a fixed 14-day window (`behaviourStats(db, 14)`,
  `app.jsx:7222`) on an 8-day-old account, so a new user always looks short of data.

### Low

**10. The add sheet reopens on the last tab used** (`LAST_LOG_TAB`, `LogSheet`). After one failed AI try,
every `+ Add food` opened on Estimate with Recents hidden. Default to Food; only remember tabs for the
session, or not at all.

**11. Toasts cover the primary action.** "Trophy unlocked" sat on the welcome screen's LET'S GO; "Added
Chicken salad wrap" sat on the Estimate text box and button. The first log on days 1 and 2 got "Your buddy
found 10 Amber" instead of "Added ... Undo", so that entry had no undo.

**12. The check-in ends with nothing.** Tapping "Nothing special" on step 5 closes the sheet: no summary
of the new week, no toast, and Today does not acknowledge it.

**13. Bad Open Food Facts rows reach the list unflagged.** "kallø Rice Cakes, 1900 kcal / 100 g" (kJ stored
as kcal). The confirm screen does warn, but still offers "ADD 1900 KCAL" and "leaves -1,308 kcal", and the
only fix offered is the AI. Drop or grey out anything over 900 kcal / 100 g at list level.

**14. Chart headline "Weight · past 3 months · 0 kg".** It is the change over the range, but reads as a
weight. Say "no change" or "±0 kg".

**15. Buddy quotes are random** (`DINO_QUOTES`, `app.jsx:4305`): "You can survive a Monday" showed on
Friday and Saturday. "Eat your protein or go extinct" reads as a telling-off on a day you missed it.

---

## Part 2 - UI and flow issues

**Setup**
- Every field on step 1 is pre-filled (Male, 32, 175 cm, 12 st 12 lb) and "Moderately active" is
  pre-selected, so tapping Continue produces a plan for someone who is not you. Start blank or use
  placeholders.
- First screen asks "How well do you know macros?" before saying what the app does.
- Egg picker: the chosen tile gets no highlight; only the big preview changes.
- Pace label "Moderate, some hunger" measures **1.75:1** contrast at 12 px (`rateLabel` colour, `app.jsx:4981`).
- No goal weight, so no "you'll get there around..." date; pace is fixed kg/week rather than % of bodyweight.
- Big pixel digits: "1544" reads as "15TT" (the 4 looks like a T) on the plan card and Today hero.

**Logging**
- Search ranks by shortest name (`searchGenericFoods`, `app.jsx:13912`), so "Rice, white, basmati, **raw**"
  beats "boiled in unsalted water"; cooked rice was 8th to 10th for "white rice", below pudding rice. Rank
  cooked forms of grains, pasta and pulses first, or penalise "raw".
- Generic foods are per 100 g only, no "1 bowl" / "1 fillet" units. Manual entry defaults to per 100 g,
  the wrong default when typing in a whole meal.
- The sheet closes after every item, so a four-item dinner is four trips. Allow "add and keep going".
- The portion screen's Add button sits below the fold, under the AI card.
- Recents show unrounded macros (P7.8 C25.8 F4.8) while the diary shows P8 C26 F5.
- Edit entry still cannot move an entry to another meal (P1 #4 in `20-ui-review.md`, still open).
- Wine's calories are split 50/50 into carbs and fat, which is what turned day 1 to "CARB 24g over" in red.
- The drink sheet opens on Recents, which is always empty for a new user.
- The AI failure message is small amber text at the very bottom of the sheet.

**Elsewhere**
- Progress lives only under You. Weight, trend and the check-in are the product; they are one tab further
  away than Cook or Train.
- Cook for a free user opens on a locked Discover; the free path is a small link. There is no recipe
  builder from ingredients, only AI import or upload.
- Accessibility: the activity options, sheet close buttons, the egg checklist rows and manual-entry macro
  inputs have no accessible names.

---

## Part 3 - What worked well

- **The maths is honest and visible.** "Show me the maths" (Mifflin-St Jeor, -550 kcal, Helms protein) is
  clear and correct.
- **"Adding this leaves 1,361 kcal and 130 g protein"** on the portion screen is excellent.
- **Recents are one tap** and remember the amount; a repeat day took seconds.
- **Weigh sheet**: pre-filled, ±0.1/0.5 nudges, trend comparison, "Skip today". Fast.
- **Backfilling a missed day** from the Food log was easy, and the check-in counted it.
- **The check-in logic is sound.** Typing a weight moved the live trend; the first-cycle hold at -0.7 kg/wk
  was explained in plain English (early loss is water) and matches `earlyAdjust` (`engine.js:1076`).
- **"Your plan over time"** row after the check-in is a good record.
- **The tone on a bad day was right**: after the takeaway, "One good day won't do it. One bad day won't undo it."
- UK alcohol measures (pint, 175 ml, cans) and CoFID generic foods.

---

## Part 4 - Compared with MacroFactor

From what I know of MacroFactor (features can have moved on since).

| Area | MacroFactor | Macrosaurus | Verdict |
|---|---|---|---|
| Setup | Goal weight, rate as % bodyweight, diet style (balanced / low fat / low carb / keto), protein level, coaching style | Sex, age, height, weight, activity, goal, kg/week pace. Coaching style exists but only in Settings | Behind: no goal weight or end date, no diet style or protein choice up front |
| Price | Paid only, trial | Real free tier, Premium £4.99 | **Ahead** |
| Dashboard | Calories/macros, weight trend, expenditure trend, quick weight entry | Buddy, plan card, recovery; weight and check-in absent from Today in week 1 | Behind on the core loop |
| Weekly check-in | Automatic, shown when due, ends with a summary of next week's targets | Conversational, honest adherence question, early-phase water logic, look-ahead question | **Ahead on explanation**, behind on being surfaced and on closure |
| Expenditure | Visible from week 1 as a trend | Range shown, full chart behind Premium | Parity-ish |
| Food search | Large verified database, serving units, results favour what people actually log | CoFID (good) + Open Food Facts (flaky, unverified rows), per 100 g only, raw before cooked | Behind |
| Logging speed | Multi-add, copy/paste, history, timestamps | Recents one-tap, copy day/entry; no multi-add, no timestamps | Behind on multi-item meals |
| AI logging | Describe / photo | Photo + text + voice, UK-grounded against CoFID, menu reader | **Ahead on paper** (untested here) |
| Recipes | Recipe builder from ingredients | Video/Instagram import, community library | Different: stronger discovery, no manual builder |
| Engagement | Deliberately none | Buddy, egg, streaks, Amber, trophies, battles | **Ahead on retention hooks**, but they currently crowd the core loop in week 1 |
| Training | Separate app | Built-in blocks and sessions | **Ahead** |

**The short version:** the maths and the coaching voice are at least as good as MacroFactor's, and
the free tier, training and buddy are real differentiators. The gap is plumbing: MacroFactor makes
"log food, weigh in, check in" frictionless and always in view, while Macrosaurus's first week buries
two of those three behind the You tab and wraps the whole thing in an egg that competes for Today.

---

## Part 5 - Recommendations for a seamless first week, in order

1. **Put the loop on Today.** A compact "weigh in" row every morning until done, and a check-in card on
   check-in day, egg or no egg. (Bugs 2, 3)
2. **Fix the midnight Food log date** (bug 1). It is the one issue here that files data on the wrong day.
3. **Make hatch staples sticky and not AI-only** (bugs 4, 5).
4. **One carb number everywhere** (bug 6) and **one rate everywhere** after the check-in (bug 9).
5. **Close the check-in properly**: a last screen with next week's targets and the next check-in date,
   echoed on Today.
6. **Search quality**: cooked forms first, serving units for common generic foods, retry on Open Food
   Facts, hide impossible rows (bug 8, 13).
7. **Multi-add** in the log sheet, and default it to the Food tab (bug 10).
8. **Setup**: blank fields, add goal weight with a projected date, ask diet style.
9. **Small polish**: reset scroll on tab change, keep toasts off primary buttons, "no change" instead of
   "0 kg", contrast on the pace label, legible hero digits, accessible names.
