# 07 · Progress becomes "the plan": one page for how it's going and what it's set to

Written against: `c3686f3` · Depends on: `01-foundation.md` §3 (Progress gets `SubHeader`). Pairs
with `08-you.md`: ship 07 before or together with 08, never 08 alone. Carries decision **D3**.

## Evidence chain

- Surface: Progress, `Goals` (`app/src/app.jsx:16507`), reached from Today's journey band and from
  the top card on You. Rendered at 390×844 in `?demo`.
- Problems:
  1. **The plan is split across two tabs.** Progress shows the verdict, trend, energy and the target
     ("SO YOUR TARGET IS 2236 kcal a day"), then sends you elsewhere to change it: "**Change your
     goal in Settings**" (`:16588`, `onEditPlan` → `setSettingScreen('goal'); setView('more')`,
     `:22360`). Everything that sets the plan (Goal, Coaching, Weekly shape, Calories & macros,
     What's coming up, Check-ins & weigh-ins) lives in You → *Your plan* (`SettingsOverview`,
     `:18300`–`:18316`). MacroFactor puts this together on one **Strategy** page (`00-README` L3).
  2. **The free-tier Energy card is mostly a placeholder.** About 200px of greyed ghost bars, a
     heading, a paragraph and "Try Premium free ›" sit above the real content (how the burn was
     worked out, and the target). On the same visit, the Today page's prompt slot already offers
     Premium (02).
  3. **Its header is a floating link.** Covered by 01 §3.
- Design evidence: `00-README` L1, L3, rules 1 and 5. The code's own comment above `Goals`:
  "THE ANSWER, THE EVIDENCE AND THE ACTION, in one panel", which is half-true while the action
  for changing the plan lives on another tab.
- Owner: `Goals`, `ExpenditureCard` (its free-tier branch), `SettingsOverview`'s plan rows, the App
  router (`:22360`–`:22361`, `setSettingScreen`), `More` (`:18521`, `initialScreen`).
- Uncertainty: **D3**. This changes where six rows live, not what they open. Every sub-screen is
  reused unchanged.

## Design decision

Progress answers both halves of MacroFactor's Strategy page, **"is it working?"** and **"what is
it set to?"**, in that order:

```
SubHeader  ‹ TODAY            PROGRESS
THIS CYCLE ..................... AHEAD OF PLAN     (CyclePanel, unchanged: verdict, road, trend, check-in)
TREND WEIGHT chart                                  (unchanged)
ENERGY  (premium: unchanged)  (free: one line + Try Premium ›, then the burn and target)
YOUR PLAN                                           ← SettingsGroup, moved from You
  Goal                Fat loss · 0.5 kg/week · target 78.0 kg      ›
  Calories & macros   2236 kcal · set by Macrosaurus               ›
  Coaching            Approve · suggests a change at each check-in ›
  Weekly shape        Even · evening out off                       ›
  What's coming up    Nothing planned, running as normal           ›
  Check-ins & weigh-ins  Check in Sundays · weigh most mornings    ›
Coach timeline · Weigh-in log                        (unchanged)
```

## Reuse

- `SettingsGroup`, `SettingsRow` (`:16912`–`:16927`), the existing sub-screens (`GoalScreen`,
  `MacrosScreen`, `CoachingScreen`, `WeeklyShapeScreen`, `WeekPlansScreen`, `CheckinsScreen`), the
  existing `setSettingScreen` + `setView('more')` route, `TextBtn`.
- **Extract, do not copy:** the six row objects (label, status line, keywords) are built inline in
  `SettingsOverview`. Move them into `function planRows(db)` beside `progressTeaser` (`:18256`),
  and have both `SettingsOverview` (until 08 removes them there) and `Goals` call it, so the status
  lines cannot drift.

## Changes

1. `app/src/app.jsx` — **`planRows(db)`**
   - Change: lift the `weekplans`, `goal`, `coaching`, `weekly`, `checkins` and `macros` row objects
     out of `SettingsOverview` into `planRows(db)`, which returns them in the order shown above. Keep
     `freshstart` in `SettingsOverview` (it is account-level and destructive, so it stays in You).
   - Verify: You's *Your plan* group renders identically before 08 lands.

2. App router — **settings opened from Progress come back to Progress** (`:22360`–`:22361`)
   - Change: add state `settingFrom` (`'goals' | null`). Give `Goals` a new prop
     `onOpenSetting={(key) => { setSettingFrom('goals'); setSettingScreen(key); setView('more'); }}`.
     In `More`, when the initial screen was opened with `settingFrom === 'goals'`, the sub-screen's
     back calls `setView('goals')` (and clears `settingFrom`) instead of returning to the You
     overview, and `SubScreen`'s back label reads "Progress" instead of "You". Thread this as a
     `backTo` prop on `More` → `SubScreen` (`backLabel` already exists on `SubHeader`).
   - Preserve: opening the same screens from You returns to You, as now.
   - Verify: Progress → Goal → back lands on Progress, and the bar says "‹ PROGRESS".
     You → Goal → back lands on You.

3. `Goals` — **the Your plan group** (after `ExpenditureCard`, before `CoachTimeline`)
   - Change: `<SettingsGroup title="Your plan">{planRows(db).map((r, i, a) => <SettingsRow key={r.key} label={r.label} status={r.status} last={i === a.length - 1} onClick={() => onOpenSetting(r.key)} />)}</SettingsGroup>`.
   - Change: remove the "Change your goal in Settings" `TextBtn` (`:16588`). The Goal row replaces
     it. Keep "Set your goal" (`:16571`) for an account with no plan, now pointing at
     `onOpenSetting('goal')`.
   - Verify: no copy on Progress says "in Settings".

4. `ExpenditureCard` — **free tier says it in one line**
   - Change: for `window.MISPREMIUM === false`, replace the ghost chart, heading and paragraph with
     one row: 12.5px "See the deficit you actually ran, day by day" and, right-aligned,
     `<TextBtn onClick={…existing paywall call…}>Try Premium ›</TextBtn>`. Everything after it ("How
     your burn was worked out", the target, the next check-in line) is unchanged.
   - Verify: the free Energy card's first block is one line tall.

## Scope

- Inherit: Progress from Today, from You and from the desktop sidebar. Premium and free. A paused
  plan (`db.paused`). An account with no plan (`!base`).
- Verify: every sub-screen opened from Progress returns there. The hardware back button closes one
  layer (`useBackClose` is registered by `SubScreen` once).
- Exclude: `CyclePanel`'s content, `ProgressPanel`'s chart, `CoachTimeline`, the check-in flow
  itself, and the Fresh start / Reset screens.

## Validation

- Product: someone who checks in and wants to slow the rate does it from Progress, without being
  sent to You and without losing their place.
- Interface: 390×844, 320×640, paper and dark, free and premium, paused, no plan.
- System: `planRows` is the only source of those six status lines (`grep -n "goalStatusLine(" app/src/app.jsx`
  shows one call site, inside `planRows`).
- Repository: `node build.mjs`; `npm test` → no new failures (`tests/checkin-cadence.test.js:86` is
  pre-existing).

## Stop conditions

- Stop if `More`'s `initialScreen` is consumed in a way that cannot tell where it was opened from
  without a broader router change. Then ship changes 1, 3 (with rows that still return to You) and 4,
  and report change 2 as a follow-up.

## Design documentation

- Record: "Progress is the plan's home (status and settings), like MacroFactor's Strategy page. You
  holds personal settings and the account."
