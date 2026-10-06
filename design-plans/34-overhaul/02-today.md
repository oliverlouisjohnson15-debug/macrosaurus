# 02 · Today: the buddy, then the plan, and one thing asking

Written against: `c3686f3` · Depends on: `01-foundation.md` (`PageBar`, `PromptSlot`, `CardHead`
for Today's plan)

## Evidence chain

- Surface: the Today tab, `Dashboard` (`app/src/app.jsx:12658`, render from about `:13060`), at
  390×844 in `?demo`, after dismissing the milestone celebration.
- Problems (rendered):
  1. **"Today's plan" starts at ≈1,055px.** Above it, in order: the app header; `PageHeader`
     ("TUESDAY 6 OCTOBER / TODAY"); the free-tier `PremiumNudge` ("Log a meal in one snap",
     ≈165px); the buddy card (title bar, scene, a four-cell `StatusStrip`, the buddy's question
     with two answer buttons, the journey band "1.6 KG DOWN … 0.4 kg to your next milestone",
     a "See your full progress" row, and a "Weekly check-in due / CHECK IN" row).
  2. **The page says its numbers twice.** `StatusStrip` (`:8593`) shows **1101 KCAL LEFT** and
     **56g PROTEIN**. Today's plan shows **1101 KCAL LEFT** and **56G left of 131g**. The strip's
     fallback third cell (fibre) is also on the plan card (`FibreCell`, "FIBRE 10g left"), although
     the comment at `:8618` says fibre is "the one daily figure the macro card below does not already
     carry". Its fourth cell, **13d STREAK**, repeats the "13d" in `MobileHeader` (`:19944`). The
     only figure the strip has that nothing else on the page shows is steps, and the Recovery card
     carries MOVE.
  3. **Three things ask at once** (`00-README` rule 3): the Premium box, the buddy's question, and
     "Weekly check-in due". The buddy card's own comment says "ONE GOLD PER CARD", and two gold
     controls were visible.
  4. **An upsell inside the data card.** For a free user, the plan card's `DensityCell` is an empty
     greyed meter labelled "DENSITY · PREMIUM ›", on the same screen as the top Premium box.
  5. **The journey takes three bands** (journey, "See your full progress", check-in/weigh-in row),
     and the "This cycle" card on Progress repeats all three (see 07).
- Design evidence: `00-README` rules 1–4 and L1/L4/L5 (MacroFactor: one hero, then sections that
  open inward; the check-in is one moment). The `habitatStats` comment (`:12943`): "a second,
  independent set of the same numbers on the same screen is a bug waiting to happen". The two
  sets come from one source, but they still appear twice.
- Owner: `Dashboard`, `BuddyHabitat` (`:8646`), `StatusStrip` (`:8593`), `DensityCell`,
  `PremiumNudge` call sites in `Dashboard` (top `:≈13078`, `free_limit` `:≈13225`),
  `WeekPlanBanner` (`:5759`), `OnboardingChecklist` (`:19992`), `DietBreakCard` (`:7582`).
- Uncertainty: the Today design file (`Today Page.dc.html`, held outside the repo) draws the
  four-cell strip. Removing it is a **deliberate divergence** asked for by the product owner ("much
  sleeker"); record it (see Design documentation). The free-tier upsell's position is decision **D2**.

## Design decision

Today answers **"how am I doing today?"** in one screen. MacroFactor's dashboard leads with one hero
(its "Hat"), and everything else is a section that opens inward. Macrosaurus keeps its buddy as the
lead, because that is the product's identity and a decision already recorded in the code. But the
buddy card goes back to being the buddy, and the plan card is the hero for the numbers:

```
PageBar      TUESDAY 6 OCTOBER
[OnboardingChecklist — first week only, unchanged]
BuddyHabitat CHOMPERS · DAY 21 ................ PECKISH
             scene
             dialogue (one sentence, ≤2 answers)
             ─ journey row:  1.6 KG DOWN · 0.4 to next ›     [CHECK IN] or [WEIGH IN]
Today's plan (hero) — unchanged content, minus the free-tier Density cell
PromptSlot   one of: WeekPlanBanner · DietBreakCard · PremiumNudge
Recovery     (rearrangeable, unchanged)
footer       quote · Rearrange this page
```

## Reuse

- `PageBar`, `PromptSlot` (01), `CardHead`, `Pill`, `Btn` (`:3689`), `PipMeter` (`:4110`),
  `TextBtn`, `PremiumNudge`. The existing `RearrangeLayer` (`:7059`) and `todayOrder` are kept.
- Exemplar for the one-row journey band: the Food log meal-header row (left label, right figure,
  2px top rule), and the existing `week.weighToday` row (`:8873`) for the button placement.

## Changes

1. `Dashboard` — **`PageBar` instead of `PageHeader`** (`:13074`)
   - Change: `<PageBar context={prettyDate(today)} />`.
   - Verify: no "TODAY" title. The date is the first line under the app header.

2. `BuddyHabitat` — **remove `StatusStrip` from the card** (`:≈8775`, `{!incubating && <StatusStrip …/>}`)
   - Change: stop rendering the strip. Leave `StatusStrip` and `habitatStats` defined but unused
     in this commit, with a comment pointing here, so restoring it is one line (the pattern the
     code already uses for `CycleStrip`). Steps stay visible on the Recovery card (MOVE).
   - Preserve: while incubating, the hatch list (unchanged).
   - Verify: "1101" appears exactly once on Today (in the plan hero). "56" appears once. "13d"
     appears only in the app header.

3. `Dashboard` — **one prompt slot** for the interrupting cards
   - Change: remove the standalone renders of `WeekPlanBanner`, the top `PremiumNudge`,
     `DietBreakCard` and the `free_limit` `PremiumNudge`. Render one `PromptSlot` directly after
     the plan block in the `BLOCKS` sequence, so it moves with the plan when rearranged, with
     candidates in this order:
     1. `WeekPlanBanner` — when it has a plan to announce (its existing render condition)
     2. `DietBreakCard` — when a break is active or due (its existing condition)
     3. `PremiumNudge reason="free_limit"` — the existing low-AI-calls condition
     4. `PremiumNudge reason="manual" trackKey="today_top"` — `!isPremium && !eggIncubating`
     Each candidate's `when` is the component's current guard, lifted to the call site. A component
     that returns `null` from its own internal check must have that check exposed as a function,
     because `PromptSlot` cannot know a child rendered nothing.
   - Preserve: `OnboardingChecklist` stays where it is, above the buddy, during the first week.
     It is the page's whole job on those days.
   - **D2 variant:** if the owner wants the upsell first, put candidate 4's render above the
     buddy instead, and only when the slot below has nothing else to show.
   - Verify: in `?demo` (free tier, nothing due) the Premium box appears **below** the plan card,
     and it is the only interrupting card on the page.

4. `BuddyHabitat` — **the journey becomes one row** (the `week` bands, `:≈8815`–`:8885`)
   - Change: replace the journey band, the "See your full progress" button, the "Not weighed in
     yet today" row and the "Weekly check-in due" row with **one** row (`borderTop: 2px solid
     var(--border)`, `px-3 py-2.5`, `flex items-center justify-between gap-3`):
     - Left, a button covering the left side that calls `week.onOpen` (opens Progress): the existing
       headline figure in the pixel face ("1.6 KG DOWN", same value and colour as today), then
       9px muted "· 0.4 to next ›".
     - Right, **at most one** `Btn`: `kind="accent"` "Check in" when `week.due`; else
       `kind="ghost"` "Weigh in" when `week.weighToday && !(msg && msg.weigh)`; else nothing.
     - `week.thin` (the warning line) stays as its own band under the row when present.
   - Preserve: the full road (start ⟶ goal cells, milestones) moves to Progress, which already
     draws it ("To your goal" ladder in `CyclePanel`). Nothing is lost; it is one tap away, as L1
     prescribes.
   - Verify: the buddy card ends in one row. With a check-in due there is exactly one gold control
     on the card. Tapping the left half opens Progress.

5. Today's plan — **remove the free-tier Density cell** (the `FibreCell | DensityCell` row)
   - Change: when `!isPremium`, render `FibreCell` full width and no `DensityCell`. Premium users
     keep the split row unchanged.
   - Verify: no "PREMIUM ›" text inside the plan card for a free user.

6. Footer — keep "Rearrange this page" and the quote. No change.

## Scope

- Inherit: Today in every state: incubating, first week, established, check-in due, diet
  break, over target, premium and free.
- Verify: `RearrangeLayer` still lists Buddy / Today's plan / Recovery and still moves them. The
  prompt slot travels with the plan block.
- Exclude: the buddy scene, sprites, celebrations (milestone, hatch, stage-up), `CarryoverSheet`,
  `BuddyReadinessSheet`, `WeeklyRecapSheet`, and any change to `buddyMessage` / the ask ladder.

## Validation

- Product: on a normal day, someone opening Today sees the buddy, what the buddy wants, and kcal and
  macros left, without scrolling. When a check-in is due, it is the one gold thing on the screen.
- Interface: 390×844 (target: the "Today's plan" title bar's top ≤ 640px CSS). Also 320×640, paper
  and dark, premium and free, incubating, `?demo&rest`, `?demo&quiet`, `?demo&forage`.
- System: `PromptSlot` is the only place `PremiumNudge`, `WeekPlanBanner` and `DietBreakCard` render
  on Today (`grep` in `Dashboard`).
- Repository: `node build.mjs` succeeds; `npm test` → no new failures (the first-week tests in
  `tests/first-week.test.js` touch the journey band; update their selectors, not their meaning).

## Stop conditions

- Stop if `tests/first-week.test.js` asserts on the "See your full progress" or weigh-in row copy in
  a way that encodes product behaviour (not just a selector). Report it rather than rewriting it.
- Stop if `WeekPlanBanner` or `DietBreakCard` has side effects on render (marking something seen).
  Lifting their guard must not change when those effects fire.

## Design documentation

- Record in the design-system memory: "Today drops the habitat's status strip. Its numbers are on
  the plan hero, the header and Recovery. Divergence from `Today Page.dc.html`, 2026-10, owner's
  request (34-overhaul)."
