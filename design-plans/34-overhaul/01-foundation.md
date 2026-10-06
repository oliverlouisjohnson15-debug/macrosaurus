# 01 · Foundation: one page grammar for every tab

Written against: `c3686f3`

Part of the 34 overhaul. Read `00-README.md` for the rules and the MacroFactor grounding. This
plan changes **shared primitives only**. Each page plan (02–08) then rearranges its own page on top
of them. Ship this first: it is safe alone and improves every page.

## Evidence chain

- Surface: every tab root and sub-screen in `app/src/app.jsx` and `app/src/train-tab.jsx`, rendered
  at 390×844 in `?demo` (paper and `theme-dark`).
- Problems, each observed on the rendered build and traced to its owner:
  1. **The tab name is said twice.** The active nav label (`BottomNav` → `NavBtn`, `app.jsx:19902`)
     reads TODAY / FOOD / COOK / TRAIN, and each tab root then opens with a 20px pixel-face title
     saying the same: `PageHeader title="Today"` (`:13074`), `"Food log"` (`:13725`), `"Recipes"`
     (`:21381`), Train's hand-rolled `<h1>Train</h1>` (`train-tab.jsx:390`), and `"You"`
     (`:18568`) under a header button labelled YOU. `PageHeader` (`:4005`) costs about 110px
     (9px kicker + `mt-3` + `text-xl` + `mb-6`) before the first content on every tab.
  2. **There are two sub-screen bars.** `SubHeader` (`:3831`) and `SubScreen` (`:16930`) each draw
     the purple back/title bar. They differ in back-label size (9px vs 10px), tracking (0.08em vs
     0.1em) and actions (only `SubHeader` has them). Progress, which you go *into* from Today, has
     neither: it uses a floating "‹ TODAY" text link above a `PageHeader` (`:16524`).
  3. **Interrupting cards stack.** `Dashboard` (`:12658`) can render, above or among its content,
     `WeekPlanBanner`, `OnboardingChecklist`, `PremiumNudge` (top), the buddy's question,
     the check-in row inside `BuddyHabitat`, `DietBreakCard` and a second `PremiumNudge`
     (`free_limit`). In the demo state, three are visible at once (the Premium box, "ASKS: how often
     will you weigh in?", "Weekly check-in due").
  4. **Sub-floor type.** 143 uses of `text-[7px]`/`[8px]`/`[8.5px]` in `app.jsx`, 23 in
     `train-*.jsx`. Two are in the app header itself (`MobileHeader`, `:19936`: "Play ›" at
     `text-[7px]`, "YOU" at `text-[8px]`).
  5. **Hand-rolled title bars.** "Today's plan" (`:13125`) and "Day total" (`:13776`) re-type
     `CardHead`'s markup inline instead of rendering `CardHead` (`:3767`).
  6. **A legacy segmented control.** You's Settings/Account switch (`:18569`), the admin tabs
     (`:18953`) and the switch at `:20324` use `bg-[#1E1E22] p-1 rounded-2xl` with a white active
     chip. CSS shims it into the paper palette (`styles.css:367,452`), but it is a different control
     from the house `Pill` (`:3930`), which "switches a LENS on the same data".
- Design evidence: `00-README.md` rules 3–7; `design-plans/20-ui-review.md` §2.4 ("9px is the
  floor. The design set agrees."); `design-plans/19-handover.md` ("`SubHeader` — the purple
  sub-screen bar … Settings wants it too"); the `Pill` and `Seg` comments in `app.jsx`.
- Owner: `app/src/app.jsx` primitives listed above; `app/src/train-tab.jsx` `TrainHome` header.
- Uncertainty: §C introduces one new primitive (justified there). Everything else reuses
  existing primitives.

## Design decision

Give every page the same skeleton:

```
MobileHeader (unchanged chrome, 9px floor)
├─ tab root:  PageBar  →  one hero  →  sections  →  quiet footer
└─ sub-screen: SubHeader → content
```

- **`PageBar`** replaces `PageHeader` on tab roots: one line carrying the **context** (date,
  block name, "Your food diary") in the 9px label face on the left, and up to three page actions
  on the right. No 20px title, because the nav already says where you are. About 44px instead of 110px.
- **`SubHeader` is the only sub-screen bar.** `SubScreen` renders it.
- **`PromptSlot`** shows at most one interrupting card per page, chosen by priority.
- **`CardHead` everywhere**, the 9px floor everywhere, and `Pill` for every lens switch.

## Reuse

- `CardHead` (`app.jsx:3767`), `SubHeader` (`:3831`), `Pill` (`:3930`), `Seg` (`:3914`),
  `TextBtn` (`:3959`), `PremiumNudge` (`:12476`), tokens `--muted`, `--header`, `--header-text`,
  `--nav-off`, `--cardhead-bg`, `--cardhead-text`, `--surface2`, `--surface3`.
- Exemplar for the page bar's action buttons: the Cook toolbar buttons (`:21384`–`:21392`,
  `pixel-box w-10 h-10`, `background: var(--surface3)`).
- Exemplar for a one-line compact prompt: `CardHead` footer rows in Today's plan (`:13166`ff).

**New primitive: `PromptSlot`.** The existing system has no owner for "which of these may speak
now", so every caller renders its own card and they pile up. It belongs beside `PremiumNudge` in
`app.jsx`. Consumers: `Dashboard` (Today), `FoodLog`, `Recipes`, `ProgressPanel`/Progress,
`SettingsOverview`. Shape:

```jsx
// candidates: [{ key, when: bool, render: () => node }], in priority order.
// Renders the first candidate whose `when` is true, and nothing else.
function PromptSlot({ candidates }) { const c = candidates.find(c => c.when); return c ? c.render() : null; }
```

It decides nothing about content. Each page plan supplies its own ordered list.

## Changes

1. `app/src/app.jsx` — **`PageBar`** (new, beside `PageHeader` at `:4005`)
   - Change: `function PageBar({ context, actions = [] })`. A flex row, `mb-4`, `min-height: 40px`,
     `items-center justify-between`. Left: `context` in `pf text-[9px] uppercase`,
     `color: var(--muted)`, `letterSpacing: 0.14em` (the `SheetLabel` treatment, `:3826`).
     Right: `actions` rendered as the Cook toolbar buttons (`pixel-box w-10 h-10`, `--surface3`,
     `aria-label` required, optional badge). Use it on the tab roots: Today (`:13074`), Food
     (`:13725`), Cook (`:21381` together with its toolbar `:21382`–`:21395`), You (`:18568`), and
     Train (`train-tab.jsx:377`–`:395`: kicker → `context`, the sliders button → one action).
   - Preserve: `PageHeader` stays for Admin (`:18952`, `:19055`) and Meal plan (`:20961`) until
     those are moved to `SubHeader` (Meal plan is a sub-screen of Cook; see 06).
   - Verify: on each tab root the first card's top edge moves up by about 60–70px; no 20px title
     appears on any of the four bottom-nav tabs or on You.

2. `app/src/app.jsx` — **`SubScreen` renders `SubHeader`** (`:16930`)
   - Change: replace the hand-rolled bar (`:16938`–`:16941`) with
     `<SubHeader back={onBack} backLabel="You" title={title} />`. Keep `useBackClose(onBack)` and
     the `intro` line.
   - Preserve: the "one title" decision from `design-plans/32` (the bar is the only place the
     sub-screen is named).
   - Verify: open any You sub-screen (Goal, Reminders). The back label is now 9px/0.08em, identical
     to the Recipe detail bar.

3. `app/src/app.jsx` — **Progress gets `SubHeader`** (`:16524` and the "‹ TODAY" link above it)
   - Change: remove the `lg:hidden` text link (`:16520`) and `PageHeader` (`:16524`). When
     `onBack` is set, render `<SubHeader back={onBack} backLabel={backLabel || 'You'} title="Progress" />`
     first. On desktop (`lg:`), where Progress is a sidebar destination with no `onBack`, use
     `<PageBar context="Progress" />`. The kicker's question ("Is the plan
     working?") is answered by the verdict card directly below it, so it is dropped.
   - Verify: Progress opens with the purple bar flush to the app header, like Recipe.

4. `app/src/app.jsx` — **`PromptSlot`** (new, beside `PremiumNudge` `:12476`)
   - Change: as specified above. No styling of its own.
   - Verify: covered by the page plans that consume it (02 is the first).

5. `app/src/app.jsx` — **`CardHead` for the two hand-rolled bars** (`:13125`, `:13776`)
   - Change: `<CardHead title="Today's plan" right={<Pill …/>} />` and
     `<CardHead title="Day total" right={'of ' + kcal + ' kcal'} />`. `CardHead` puts a non-button
     `right` in a span, and the `Pill` keeps its own colours.
   - Verify: pixel-identical bar height (7px vertical padding, 2px bottom rule) to the Train cards.

6. `app/src/app.jsx` and `app/src/train-*.jsx` — **the 9px floor**
   - Change: every `text-[7px]`, `text-[8px]` and `text-[8.5px]` becomes `text-[9px]`, except where
     the text is inside a fixed-size pixel tile that would overflow at 9px. Check each of those in
     the render and drop the label instead of shrinking it (`20-ui-review.md` P1-3: "Most should
     become 9px; a few can go"). Start with `MobileHeader` (`:19936`).
   - Verify: `grep -cE 'text-\[(7|8|8\.5)px\]' app/src/app.jsx app/src/train-*.jsx` → `0` (or a
     list of named exceptions written into the commit message). The bottom nav and the header still
     fit on one line at 320px wide.

7. `app/src/app.jsx` — **`Pill` replaces the legacy segmented switches** (`:18569`, `:18953`,
   `:20324`)
   - Change: `<Pill value={tab} onChange={setTab} options={[{v:'settings',l:'Settings'},{v:'account',l:'Account'}]} />`,
     inside a `flex` wrapper with `mb-5`. Stretch the segments to full width with a `wide` prop on
     `Pill` (`flex-1` on each button, `flex` instead of `inline-flex`), added only for these callers.
   - Verify: the You switch matches the Discover/Cookbook switch on Cook (one 2px frame, butted
     segments, pixel face).

8. **Sweep: say each number once.** This is a rule, not a code change here. Each page plan applies
   it to its own page.

## Scope

- Inherit: Today, Food, Cook, Train home, You, Progress, every `SubScreen` consumer (14).
- Verify: the desktop `Sidebar` (`:19921`). It does not render `PageHeader`'s title separately, so
  `PageBar` should not change it, but check at ≥1024px.
- Exclude: the live training session (`design-plans/27` owns its header), the Play hub, the sign-in
  and onboarding screens, Admin.

## Validation

- Product: someone opening each tab sees the tab's own content within the first screen, and is
  never told which tab they are on twice.
- Interface: 390×844 and 320×640, paper and dark, every tab root and three `SubScreen`s.
- System: `grep -n "<PageHeader" app/src/app.jsx` → only Admin ×2 and Meal plan (until 06). Exactly
  one implementation of the purple sub-bar (`grep -n "background: 'var(--header)'" app/src/app.jsx`
  shows `SubHeader` and `MobileHeader` only).
- Repository: `node build.mjs` succeeds; `npm test` → same pass count as before
  (`tests/checkin-cadence.test.js:86` is a known pre-existing failure, see `19-handover.md`).

## Stop conditions

- Stop if dropping the tab title breaks the desktop layout's only page heading. Then keep
  `PageHeader` on `lg:` only.
- Stop if a 9px label cannot fit in its tile without changing the tile. List it and move on; do not
  resize the component in this plan.

## Design documentation

- After acceptance: record in the design-system memory and in `design-plans/34-overhaul/00-README.md`
  that tab roots use `PageBar` (context + actions, no title), sub-screens use `SubHeader` only, and
  pages surface interruptions through `PromptSlot`.
