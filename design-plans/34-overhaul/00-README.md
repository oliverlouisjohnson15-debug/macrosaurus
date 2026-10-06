# 34 · The sleek pass: a page-by-page overhaul

Written against: `c3686f3` (main, 2026-10-06). Audited at 390×844 in `?demo`, both themes.

The pixel/paper identity is **not** being replaced. The palette, the two faces, the 3px/2px frames,
`CardHead`, `Sheet`, `SubHeader`, `Pill`/`Seg` and the buddy all stay. What made the app feel
like "a beast" is not the style. It is **accumulation**: every module opens with the same
information, the same prompt appears in two or three places, and each card that was right on its
own pushes the thing the tab is for further down the page.

This folder is a set of self-contained plans. Each can be executed alone, in this order:

| # | Plan | Why this order |
|---|---|---|
| 01 | `01-foundation.md` — page grammar, one prompt slot, one sub-screen bar, the 9px floor | Every page plan below uses it |
| 02 | `02-today.md` | Opened every day, several times |
| 03 | `03-food-log.md` | Opened at every meal |
| 04 | `04-log-and-edit-sheets.md` | The FAB sheet and the edit sheet: the most-used flow in the app |
| 05 | `05-train.md` | Opened every training day |
| 06 | `06-cook.md` | Weekly-ish; worst ratio of chrome to content |
| 07 | `07-progress.md` | Weekly; becomes the one home for "the plan" |
| 08 | `08-you.md` | Occasional; shrinks once 07 lands |

02–08 each say which parts of 01 they depend on. 01 can ship alone and changes every page a
little; it is the plan to do first.

---

## What MacroFactor teaches, and how each lesson is applied

MacroFactor is the reference the product owner asked for. Its own site (macrofactor.com,
help.macrofactorapp.com) is **blocked from the environment these plans were written in**, so
everything below comes from search-indexed excerpts of its release notes and help centre. The
sources are listed at the end. An executor with network access should open them before starting
and record anything that contradicts what is written here.

### L1 · One hero, then sections that open into their own pages
MacroFactor's dashboard has one "Hat" at the top (choose Daily Nutrition, Weekly Nutrition or
Energy Balance). Below it sit sections, each with a "See all" into an **Inner Dashboard**. Anything
not pinned to the main dashboard lives on its inner dashboard, not further down the main page.

**Applied:** every tab gets **one hero** above the fold, and secondary material becomes a one-row
summary that taps through to its own screen. Nothing is added to a tab root without something
leaving it. (01 §A, 02, 03, 06, 07.)

### L2 · Logging is one tap from every primary page, and speed is counted
MacroFactor's Shortcuts Toolbar starts a barcode scan or a search "with exactly one tap from any of
the primary pages". Its **Food Logging Speed Index** counts the discrete actions each common
logging task takes (barcode, search, multi-add, quick-add). By that count, MyFitnessPal takes about
1.5× as many actions.

**Applied:** the FAB stays the one logging entry point. 04 sets an action-count budget for the four
common tasks and makes the sheet say each route once. The count is how the result is verified.

### L3 · The plan lives in one place
MacroFactor's **Strategy** page "houses all functionality related to goal setting, programs, and
smart dynamic adjustments on one page". Settings are under **More**.

**Applied:** Macrosaurus currently splits "the plan" between You → *Your plan* (Goal, Coaching,
Weekly shape, Calories & macros, What's coming up, Check-ins) and the Progress page (verdict, trend,
energy, "Change your goal in Settings"). 07 makes Progress the one home for it, the way Strategy
is. 08 then leaves You as settings and account only.

### L4 · The check-in is a moment, not a banner
MacroFactor's weekly check-in is a curated sequence of **Coaching Modules**: the coach picks which
modules appear for this user at this check-in.

**Applied:** "Check-in due" appears in exactly one place a day (the Today prompt slot, 01 §C). It is
not a band on Today *plus* a row on Progress *plus* the top card on You.

### L5 · Customise rather than accumulate
MacroFactor lets people reorder or toggle sections of the dashboard rather than shipping every
section to everyone. Macrosaurus already has **Rearrange this page** on Today, which is the same
idea. Keep it.

**Applied:** new or niche cards (Recovery, Density, the contributor level) default to a compact
summary or an inner page. They are not full cards on a tab root.

### L6 · Cohesion
MacroFactor's 2025 rebrand redrew its food icons "to be clearer and more consistent". The point
was one visual vocabulary across the ecosystem.

**Applied:** 01 §B–§F remove the places where Macrosaurus speaks two dialects of its own design
system: two sub-screen bars, hand-rolled title bars, legacy segmented controls, and sub-floor type.

---

## Rules every plan follows (the "sleek" contract)

These come from L1–L6 plus the existing design system (`design-plans/16`, `19`, `20` and the
comments on the primitives in `app/src/app.jsx` lines 3689–4010).

1. **Say each number once per screen.** If two cards show "kcal left", one of them loses it.
2. **One hero per tab root, visible without scrolling at 390×844.** Each plan names its hero
   and the pixel budget it has to fit in.
3. **At most one interrupting card per screen.** Upsells, nudges, banners, "due" rows and
   onboarding all share the prompt slot from 01 §C.
4. **The nav bar already says which tab you are on.** A tab root does not repeat it as a 20px
   title (01 §A).
5. **Going *into* something gets `SubHeader`.** Not a floating "‹ Back" link, and not a second
   hand-rolled purple bar (01 §B).
6. **Every panel opens with `CardHead`.** No hand-rolled ink bars (01 §E).
7. **9px is the type floor** (`design-plans/20-ui-review.md` §2.4; `21-icons-handover.md`
   quoting the design-system memory). (01 §D.)
8. **No box soup.** A card inside a card becomes a band (a row with a rule), not a nested
   `pixel-box`. See the `Panel` comment at `app.jsx:3895`.

## Measurements to repeat after each plan

`before/` holds the audit captures from `c3686f3` (390×844 at 2×, `?demo`). `fold-*.png` shows the
first screen exactly as it appears. The full-page captures (`TODAY.png`, `COOK.png` …) are
stitched, so the sticky app header and bottom nav show up partway down the image. That is an
artefact of the capture, not a bug. `LOGSHEET.png` and `EDITENTRY.png` are the two sheets in 04, and
`dark-*.png` is `theme-dark`.

The audit harness lives in the session scratchpad and is not in the repo. Recreating it takes about
thirty lines of Playwright: serve the repo root over http, open `index.html?demo`, dismiss any
celebration ("Nice one"), click each `nav` label, and take a viewport shot plus a `fullPage` shot.

| Page | Measured on `c3686f3` (CSS px from top of page) | Target |
|---|---|---|
| Today | "Today's plan" title bar at **≈1,055px**; above the fold: header, title, Premium upsell, buddy scene, strip, buddy question | plan title bar **≤ 640px** |
| Food | first meal card at **≈465px**; the day's totals drawn as a full hero card that copies Today's, and a meal header that repeats its only entry | first meal **≤ 340px** |
| Cook | first recipe card at **≈740px**, so on an 844px screen it sits under the bottom nav and FAB and is not visible on arrival | first recipe **≤ 480px** |
| Train | next session card at **≈290px** ✓; page tail has 5 separate controls | unchanged hero; tail = one section |
| Progress | reached via a floating "‹ TODAY" text link, not `SubHeader` | `SubHeader`; plan rows on the page |
| You | 6 groups + a card-style Appearance panel; "Your weekly check-in is due" card on top | settings and account only |

---

## Sources (MacroFactor)

- Dashboard revamp and Strategy page: https://macrofactor.com/dashboard-revamp/
- Dashboard customisation ("Hat", inner dashboards): https://macrofactor.com/dashboard-customization/ · https://help.macrofactorapp.com/en/collections/19-dashboard
- Shortcuts / toolbar: https://help.macrofactorapp.com/en/articles/112-how-to-configure-your-shortcuts-and-toolbar · https://macrofactor.com/mm-nov-2025/
- Food logger (Plate, multi-add, search toolbar): https://macrofactor.com/new-food-logger/
- Food Logging Speed Index: https://macrofactor.com/fastest-food-logger/ · https://macrofactor.com/fastest-food-logger-2025/
- Timeline food log: https://macrofactor.com/timeline-based-food-logger/
- Check-ins and coaching modules: https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules
- Rebrand: https://macrofactor.com/new-look/
- Workouts dashboard: https://help.macrofactorapp.com/en/articles/275-getting-to-know-your-workouts-dashboard

## Decisions that belong to the product owner

Every plan works **without** these. Each is flagged where it would apply:

- **D1 · Timeline vs meal buckets.** MacroFactor logs to a timeline, not to Breakfast/Lunch/Dinner.
  These plans **keep meals**: the app's data, copy and buddy are built on them. Recorded so it is
  a decision, not an omission.
- **D2 · The free-tier upsell's position on Today.** The current code puts it first, on purpose
  (`app.jsx` comment above `PremiumNudge` in `Dashboard`). 02 moves it into the shared prompt slot
  at the lowest priority. If the owner wants it first regardless, 02 §3 has the one-line variant.
- **D3 · Moving "Your plan" from You to Progress** (07/08). It changes where things are, not what
  they do. Every sub-screen is reused as it is.
