# 08 · You: settings and account, in one list style

Written against: `c3686f3` · Depends on: `01-foundation.md` (`PageBar`, `Pill wide`) and
`07-progress.md` (the plan rows must already exist on Progress). Never ship this before 07.

## Evidence chain

- Surface: You, `More` (`app/src/app.jsx:18521`) → `SettingsOverview` (`:18275`) and the Account
  tab (`:18573`ff), at 390×844 in `?demo`.
- Problems (rendered):
  1. **Three ways of drawing a group on one page.** The settings groups are `SettingsGroup` (9px
     label outside, rows inside one `pixel-box`). Appearance is a `Card` with a `CardHead` bar
     (`:18380`). The Account tab is a stack of hand-built `pixel-box p-4` cards whose labels use a
     fourth style, `text-[11px] uppercase tracking-widest` (`:18575`, `:18582`, `:18590`).
  2. **The title is said three times.** The header button says YOU, `PageHeader` says "YOUR PROFILE &
     SETTINGS / YOU", and the switch says Settings / Account (`:18568`–`:18569`). The switch is the
     legacy `rounded-2xl` control (01 §7).
  3. **A row that leads nowhere.** "Google Health · Coming soon" (`:18333`, status
     `!ghConfigured() ? 'Coming soon'`) opens a screen that says the connection is coming soon
     (`:11875`). For a non-admin it is a promise in the settings list, not a setting.
  4. **The check-in is due, again.** The top card reads "PROGRESS / Your weekly check-in is due"
     (`progressTeaser`, `:18263`) on the same day Today's buddy and Progress's own panel ask for it
     (`00-README` L4).
  5. After 07, the **Your plan** group duplicates Progress.
- Design evidence: `00-README` rules 4–6, L3/L4. The `SettingsGroup`/`SettingsRow` pair is the
  house list (Settings.dc.html, per `19-handover.md`).
- Owner: `More`, `SettingsOverview`, `progressTeaser`, the Account tab block.
- Uncertainty: hiding the Google Health row is reversible and changes no behaviour (the screen
  still exists). D3 as in 07.

## Design decision

You is MacroFactor's **More**: personal settings and the account. Each group is drawn one way,
`SettingsGroup`. The plan is on Progress (07). This page just links to it.

```
PageBar   YOUR PROFILE & SETTINGS
[ SETTINGS | ACCOUNT ]                    ← Pill wide
search settings
PROGRESS & PLAN
  Progress   1.6 kg down over the last week     ›    ← a row, not a card
  Fresh start  Draw a line at today…            ›
YOUR BODY · FOOD · REMINDERS · APPS & DATA      (unchanged rows)
APPEARANCE                                       ← SettingsGroup, Seg rows inside
```

## Reuse

- `PageBar`, `Pill wide` (01), `SettingsGroup`, `SettingsRow`, `Field`, `Seg`, `progressTeaser`,
  `planRows` (07).

## Changes

1. `More` — **`PageBar` + `Pill`** (`:18568`–`:18569`)
   - Change: `<PageBar context="Your profile & settings" />` and
     `<div className="mb-5"><Pill wide value={tab} onChange={setTab} options={[{ v: 'settings', l: 'Settings' }, { v: 'account', l: 'Account' }]} /></div>`.
   - Verify: no "YOU" title. The switch matches Cook's Discover/Cookbook.

2. `SettingsOverview` — **"Progress & plan" group replaces the card and the Your plan group**
   - Change: remove the Progress button card (`:18347`–`:18355`) and the `weekplans`, `goal`,
     `coaching`, `weekly`, `checkins` and `macros` rows (now `planRows`, shown on Progress). Add a
     first group `{ title: 'Progress & plan', rows: [ { key: 'progress', label: 'Progress', status: progressTeaser(db) }, freshstart ] }`
     where the `progress` row calls `onOpenProgress`.
   - Keep these rows **searchable from You**. When `q` is set, include `planRows(db)` in the search
     pool so typing "macros" still finds Calories & macros, and opens it from You as today.
   - Change `progressTeaser` (`:18256`): drop the `if (st.due) return 'Your weekly check-in is due';`
     branch, so it falls through to the trend line. Keep "A change is waiting for your say-so". That
     is a decision only the person can make, and Progress is where it is made.
   - Verify: with nothing searched, You shows no Goal, Coaching, Weekly shape, Macros, Coming up or
     Check-ins rows. Searching "goal" finds Goal. Nowhere on You says "check-in is due".

3. `SettingsOverview` — **hide "Google Health" until it can connect** (`:18333`)
   - Change: include the `health` row only when `ghConfigured()`. "More integrations" stays.
   - Verify: the demo account (non-admin) has no "Coming soon" row in Apps & data.

4. `SettingsOverview` — **Appearance as a `SettingsGroup`** (`:18380`–`:18392`)
   - Change: `<SettingsGroup title="Appearance"><div className="p-4 flex flex-col gap-4">…the three existing Field + Seg rows…</div></SettingsGroup>`.
     Drop the `Card`/`CardHead` wrapper.
   - Verify: Appearance's label sits outside its box like every other group's.

5. Account tab — **the same list style** (`:18573`ff)
   - Change: wrap the account blocks in `SettingsGroup`s: "Signed in as" (email), "Plan"
     (Premium / Free: the existing body, buttons unchanged), and the data and danger actions that
     follow under their existing headings. Replace every
     `text-[11px] uppercase tracking-widest` label with the group's title (the 9px `pf` label).
     Inside a group, a block that was its own `pixel-box p-4` becomes `p-4` content with a 2px
     bottom rule between blocks (the `SettingsRow` divider).
   - Preserve: every button, its tier (`START FREE TRIAL` stays accent, `MANAGE SUBSCRIPTION` stays
     ghost), the danger zone's danger tone.
   - Verify: the Account tab has no `tracking-widest` labels and no free-floating `pixel-box` cards.

## Scope

- Inherit: You in free and premium, admin and non-admin, searching and not, both tabs.
- Verify: every sub-screen still opens from its row. Searching finds rows in groups that are
  hidden when not searching.
- Exclude: the sub-screens' contents (32 and 33 already cover two), Admin, support tickets.

## Validation

- Product: someone looking for "units" or "reminders" finds them in one short list. Someone
  looking for their goal is told, by the first row, that it lives with Progress.
- Interface: 390×844, 320×640, paper and dark, free and premium, admin.
- System: `grep -n "tracking-widest" app/src/app.jsx` → no hits in the Account block. One group style
  on the page.
- Repository: `node build.mjs`; `npm test` → no new failures.

## Stop conditions

- Stop if any test or onboarding step deep-links to a You row by its position. Report it.

## Design documentation

- Record with 07: "You = personal settings and account (MacroFactor's More). The plan lives on Progress."

## Status

**Done, 2026-10-06.** You opens with a "Progress & plan" group (Progress, with its teaser line as
the status, and Fresh start). The plan rows show only while searching, so "macros" still finds
Calories & macros. Nothing on You says the check-in is due. Google Health shows only when
`ghConfigured()`. Appearance is a `SettingsGroup`. The Account tab is groups throughout: `MenuRow`
is now a flat row, and a new `MenuList` rules the rows apart. Coloured labels moved to their ink
tokens; gold text on the card had failed contrast.
