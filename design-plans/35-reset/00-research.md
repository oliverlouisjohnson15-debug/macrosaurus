# 35 · Reset — research: how the calm apps do it

Written 2026-10-08 against `fcc5ee8` (main).

## How this was researched

`macrofactor.com`, `macrofactorapp.com`, `help.macrofactorapp.com` and `hevyapp.com` are **blocked by
this environment's egress proxy** (every WebFetch returned `EGRESS_BLOCKED`). Everything below comes
from search-engine result excerpts of those pages, plus App Store listings, support centres and press.
Each claim names its source. Where a source is the vendor's own marketing, it says so. Someone with
open network access should spot-check the MacroFactor items marked ★ before implementation, because
they drive the logging-sheet design.

---

## 1 · MacroFactor

### 1.1 Dashboard: one "hat", then sections that open into inner dashboards
- Release 4.0.0 went "from one dashboard to five": each section that isn't fully shown on the main
  dashboard gets its own **Inner Dashboard**, reached with **See All** beside the section heading. If
  only Calories and Protein are pinned, Carbs and Fat live on the Nutrition inner dashboard.
  [release-4-0-0](https://macrofactor.com/release-4-0-0/)
- Sections are reorderable and every tile can be toggled. Weight and food "habits" sit **side by side**
  to save space. [dashboard-customization](https://macrofactor.com/dashboard-customization/),
  [help: customise](https://help.macrofactorapp.com/en/articles/254-how-to-customize-your-dashboard)
- Customisation lives in **More → Feature Settings → Dashboard**, not on the dashboard itself.
  [help: customise](https://help.macrofactorapp.com/en/articles/254-how-to-customize-your-dashboard)

**Pattern:** the home page shows a small fixed number of summaries. Detail is one tap away on a
dedicated page, never further down the home page. Arrangement controls are off the page.

### 1.2 Strategy: the plan has one home
- The Strategy page "gathers goal setting, programs, and smart dynamic adjustments into one unified
  interface" and shows check-in status. [dashboard-revamp](https://macrofactor.com/dashboard-revamp/)
- A pending check-in shows as **a small alert on the Strategy tab**, not a banner elsewhere.
  Check-in day, new program and silencing modules are buttons in a row under the Strategy header.
  [help: check-ins](https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules),
  [help: check-in day](https://help.macrofactorapp.com/en/articles/124-change-your-check-in-day)

**Pattern:** "the plan" (goal, targets, adjustments, check-ins) is one tab-level destination. Its
alerts are a dot on that destination.

### 1.3 Check-ins: curated coaching modules
- Each check-in includes "curated Coaching Modules that address specific problem areas". **Program
  Update is always last and may be the only module.** Modules can be permanently silenced, and a
  **Fast Check-In** skips all coaching. [help: check-ins](https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules),
  [help: program update](https://help.macrofactorapp.com/en/articles/252-coaching-module-program-update)

**Pattern:** the check-in is a short, paged flow. A quiet week is one screen.

### 1.4 Food logger: Actions Toolbar, Actions Sheet, Plate, Multi-Add ★
- Tapping a tab on the **Actions Toolbar** switches logging mode (search, barcode, AI, quick add…), and
  the **Actions Sheet** above it shows that mode's tools. [new-food-logger](https://macrofactor.com/new-food-logger/)
- **Multi-Add:** a small **+** on each search result puts it on the **Plate** without leaving the
  sheet. A **Minified Plate** stays visible, so a whole meal can be logged without opening the Plate.
  [new-food-logger](https://macrofactor.com/new-food-logger/),
  [help: multi-add](https://help.macrofactorapp.com/en/articles/40-multi-add-foods)
- A **Nutrition Banner** persists while logging. A swipe switches it between "plate totals" and
  "left for the day". [new-food-logger](https://macrofactor.com/new-food-logger/)
- Favourites sit in a **Favourites Bar above Hourly Picks and Latest foods** in search, with their saved
  serving. [favorite-foods](https://macrofactor.com/favorite-foods/). History appears in a "From
  History" group, and the logger suggests foods you usually eat at this hour.
  [help: log food](https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor)
- **Quick Add** lets you enter macros and calories directly, and the help article recommends a custom
  food for anything repeated. [help: quick add](https://help.macrofactorapp.com/en/articles/41-quick-add-calories-and-macros-to-your-food-log)
- MacroFactor logs to a **timeline**, not meal buckets. [timeline](https://macrofactor.com/timeline-based-food-logger/)
  (Macrosaurus keeps meals: decision D1 in `34-overhaul/00-README.md`.)

### 1.5 Shortcuts toolbar
- The toolbar is configurable, with four layouts. One pairs a **search bar with a small barcode
  button**. Another adds a top shortcut. It is set up from the centre **+** → "Configure Shortcuts &
  Toolbar". [help: shortcuts](https://help.macrofactorapp.com/en/articles/112-how-to-configure-your-shortcuts-and-toolbar)
- Long-pressing the app icon offers barcode, food search and weight logging.
  [help: long press](https://help.macrofactorapp.com/en/articles/113-use-long-press-actions-from-your-homescreen)

**Pattern:** the search field and the barcode button are *in the bar itself*. Search is a field you
can type into straight away, not a destination you choose first.

### 1.6 Food Logging Speed Index (vendor-run, self-reported)
- The FLSI counts discrete actions (taps, selections, text entries) for four workflows: **food search,
  multi-add, barcode scan, quick-add**. Lower is better. The 2025 update covered 21 apps.
  [fastest-food-logger-2025](https://macrofactor.com/fastest-food-logger-2025/),
  [fastest-food-logger](https://macrofactor.com/fastest-food-logger/)
- Published per-task counts: MacroFactor **search 10, barcode 5, multi-add 6** against Cronometer's
  17 / 7 / 9 [vs-cronometer](https://macrofactor.com/macrofactor-vs-cronometer/). MacroFactor search
  10 against Cal AI's 19, and **24 vs 45 across all four tests**
  [vs-cal-ai](https://macrofactor.com/macrofactor-vs-cal-ai/). In 2022: barcode Lose It 7, Yazio 8,
  MacroFactor 6. Multi-add Lose It 7, Yazio 9, MacroFactor 6
  [fastest-food-logger](https://macrofactor.com/fastest-food-logger/).
- Caveat: MacroFactor's absolute numbers include steps such as opening the app and choosing a
  serving, so they are **not comparable** to the counts in §6. Only the method carries over.

### 1.7 Workouts dashboard
- The top widget is **Weekly Workouts**: muscles, sets and exercises done against the cycle's targets.
  A swipe shows recent records. Below it, "Insights & Analytics".
  [help: workouts dashboard](https://help.macrofactorapp.com/en/articles/275-getting-to-know-your-workouts-dashboard)
- The program is generated from goal, schedule, equipment and exclusions, and "evolves as you log",
  rather than producing a random session each time.
  [help: program inputs](https://help.macrofactorapp.com/en/articles/370-what-information-does-macrofactor-workouts-use-to-generate-my-program)

---

## 2 · Cronometer, Lose It!, Cal AI, Yazio

- **Cronometer mobile diary = three zones:** scrollable summary banners on top, the diary list, and
  a **bottom console with an add menu**. Which banners show is a Display setting. Meal groups are
  optional. [support: diary overview](https://support.cronometer.com/hc/en-us/articles/360018171731-Diary-Overview),
  [energy summary](https://support.cronometer.com/hc/en-us/articles/360060616191)
- **Lose It!:** "My Day" → Add Food → pick the meal → search. The app keeps a log of foods eaten so
  they can be re-added. Barcode, photo ("Snap It") and voice are premium.
  [App Store](https://apps.apple.com/gb/app/lose-it-calorie-counter/id297368629)
- **Yazio:** "Smart Adding" shows recent and frequent foods **ranked by time and day**. The barcode
  scanner is pitched as the easiest route. Users ask for "remaining" to be shown *while adding food*,
  so it isn't there today. [yazio.com](https://www.yazio.com/en/calorie-counter),
  [feature board](https://yazioen.featureupvote.com/?tag=Diary)
- **Cal AI:** the vendor shows one home screen with daily calories and a scan action. The reviews I
  found don't describe the layout in more detail. [calai.me](https://calai.me/),
  [App Store](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616). By MacroFactor's
  count it needs 1.9× MacroFactor's actions to log ([vs-cal-ai](https://macrofactor.com/macrofactor-vs-cal-ai/)):
  a single big camera button doesn't make every task fast.

**Pattern:** the diary is a plain list under a compact summary. Adding food is a console or sheet
that opens on recents and a search field. "Left today" stays visible while adding.

---

## 3 · Hevy and Strong

- **Hevy has three tabs: Home (social feed), Workout, Profile.** The exercise library and dashboard
  sit inside Profile, so there is no Exercises tab.
  [hevy: profiles](https://www.hevyapp.com/features/user-profiles/),
  [hotelgyms guide](https://HotelGyms.com/blog/how-to-use-the-hevy-app)
- **Workout tab:** "+ Start Empty Workout" at the top, then routines.
  [hevy: empty workout](https://www.hevyapp.com/features/start-empty-workout/)
- **Live session:** timer, sets done and volume in the top bar. Each exercise is a table with a
  **PREVIOUS column**, and tapping it copies the value into the set. Ticking a set starts the rest
  timer. PR banners appear inline.
  [help: previous values](https://help.hevyapp.com/hc/en-us/articles/36011896355479-How-to-Use-Previous-Workout-Values-to-Improve-Performance-in-Hevy),
  [help: log a workout](https://help.hevyapp.com/hc/en-us/articles/35361530647959-How-to-Log-a-Workout-in-the-Hevy-App-Step-by-Step-Guide)
- **Strong** advertises "the simplest interface of any fitness app". Its stats are PRs, progression
  and estimated 1RM. [App Store](https://apps.apple.com/za/app/id464254577). I could not confirm its
  tab list from an indexed source.
- A design survey of workout apps recommends showing a session's purpose, duration, exercise count
  and equipment *before* Start. [screensdesign](https://screensdesign.com/articles/workout-tracker-app-design-examples/)

**Pattern:** training needs three places: *start* (today's session), *the live log*, and *history*
(per exercise inside it). Everything about building the plan lives behind one "routines/program"
entry.

---

## 4 · Apple Health / Fitness, Gentler Streak, Finch

- **Apple Health has two tabs, Summary and Browse.** Summary is a **Pinned** list, then
  Highlights, which "only displays a few highlights at once" plus "Show All Highlights".
  [Apple support](https://support.apple.com/en-ie/HT203037),
  [MacStories](https://www.macstories.net/?p=60534)
- **Apple Fitness Summary:** rings on top, then metric cards that tap through to history. **Trends**
  only appears after enough history and compares 90 days with 365.
  [Apple support](https://support.apple.com/108359), [TapSmart](https://www.tapsmart.com/features/fitness-trackers-roundup/)
- **Gentler Streak's 2025 redesign: four tabs became three.** "Go Gentler" was cut to **a single
  Today's Recommendation**. The "For You" cards are user-chosen, and the **time of day decides which
  card leads** (wellbeing in the morning, logged activity later).
  [BGR](https://bgr.com/tech/gentler-streak-gets-a-major-redesign-focused-on-your-wellbeing/),
  [iThinkDiff](https://www.ithinkdiff.com/entler-streak-ios-26-update-liquid-glass/)
- **Finch:** the dashboard links an **energy bar directly to goal completion**. Critics fault its
  onboarding for offering colours, traits and naming all at once (no progressive disclosure), and
  warn that a pet and currency without a credible care loop feels manipulative.
  [screensdesign](https://screensdesign.com/showcase/finch-self-care-pet),
  [Pratt IxD critique](https://ixd.prattsi.org/2026/02/design-critique-finch-self-care-pet-ios-app/)

**Pattern:** a calm companion has **one** voice-line and **one** recommendation a day, chosen by
context. The pet reflects the habit (energy = goals done) rather than demanding its own chores on
the home screen. Customisation comes later.

---

## 5 · Patterns to adopt (each traced to §1–4)

| # | Pattern | From |
|---|---|---|
| P1 | Tab root = **one hero + ≤3 summary rows**, each tapping into its own page | MF inner dashboards §1.1, Apple Health §4 |
| P2 | **Plan, targets and check-in live in one tab**. An alert is a dot on that tab, not a card elsewhere | MF Strategy §1.2 |
| P3 | **Check-in = short paged flow**. A quiet week is one screen | MF coaching modules §1.3 |
| P4 | **Log sheet opens with the search field focused, a barcode button inside the field, and recents ranked by meal/time below** | MF toolbar §1.5, favourites §1.4, Yazio §2 |
| P5 | **Multi-add:** a "+" on each row adds to a plate shown as a strip at the sheet's foot | MF Plate §1.4 |
| P6 | **"Left today" banner** pinned in the sheet | MF Nutrition Banner §1.4, Yazio users §2 |
| P7 | **Diary = plain list** under a compact summary, no box per meal | Cronometer §2 |
| P8 | **Training: start / live / history**. Building and editing the program sit behind one entry | Hevy §3, MF Workouts §1.7 |
| P9 | **PREVIOUS column**, tap to copy, in the live log | Hevy §3 |
| P10 | **Companion: one line, one recommendation**, chosen by time of day. The pet's state reflects logging | Gentler Streak, Finch §4 |
| P11 | **Settings and arrangement live off the page** (More/You) | MF §1.1, Apple Health §4 |
| P12 | **Count actions per logging task** and treat a regression as a bug | MF FLSI §1.6 |

## 6 · Macrosaurus today, measured the same way

Captured 2026-10-08 in `?demo` at 390×844, paper. Screens are in `before/`. The harness is described
in `01-direction.md` §6.

| Screen | Primary content at | Boxed blocks (outer + nested) | Tappable controls | Help sentences |
|---|---|---|---|---|
| Today | kcal hero **613px** (under buddy card + journey) | 4 + 4 | 12 | 4 |
| Food | first entry **389px** | 5 + 0 | 19 | 0 |
| Cook | first recipe **491px** | 5 + 0 | 12 | 2 |
| Train | next session **316px** | 4 + 0 | 13 | 2 |
| Progress | verdict 150px, page **1,940px** long | 5 + 1 | 16 | 7 |
| You | first row 275px, page **1,466px** long | 7 + 0 | 16 | 1 |
| Play | n/a | 5 + 9 | 19 | 6 |
| Log sheet | search 310px | 5 + 6 | 22 | 6 |

A "block" is anything with a ≥2px frame on all four sides **or** a fill that differs from what's
behind it, at least 120×36. Buttons don't count. Controls under 44px in either dimension, out of the
totals above: Today 8, Food 14, Cook 5, Train 3, Progress 10, You 6, Play 12, Log sheet 14.

Logging actions (tap = 1, typed entry = 1, camera capture = 1, focus on open is free):

| Task | Path today | Actions |
|---|---|---|
| Recent food | + → tap recent row (logs at once, Undo toast) | **2** |
| Search and log | + → type → pick → ADD | **4** |
| Barcode | + → SCAN tab → "Scan a barcode" → capture → ADD | **5** |
| Quick-add (kcal) | + → "Enter it manually" → kcal → NEXT: CHOOSE AMOUNT → ADD | **5** |

Train has **17 internal screens**: home, player, preview, builder, wizard, draft, rerun, blocks, library,
coverage, review, history, exercise, settings, schedule, how and progress (`train-tab.jsx:115–224`).
