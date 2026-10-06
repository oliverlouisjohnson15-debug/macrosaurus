# Settings subscreens name themselves once, and reach their first control sooner

Written against: `2865c21`

## Evidence chain

- Surface: every Settings subscreen reached from You → Settings (14 `<SubScreen>` consumers in
  `app/src/app.jsx`: Goal, Coaching, Weekly shape, Check-ins & weigh-ins, Calories & macros, Body
  details, Default meals, Reminders, Fresh start, integrations, Google Health, and siblings). All
  render through one owner, `SubScreen` (`app/src/app.jsx`, `function SubScreen`).
- Problem (rendered, 390×844, paper theme, `?demo`): the top of each subscreen stacks four things
  that all introduce the same screen:
  1. the purple sub-header bar, with the screen name centred (`WEEKLY SHAPE`);
  2. a `SETTINGS` kicker (`pf text-[9px] uppercase`);
  3. the screen name again as a 25px `h1` (`Weekly shape`);
  4. an intro paragraph at `text-base` (16px), three lines on a phone.
  The first control sits at ~270–290 CSS px on every subscreen measured (Goal ~288, Check-ins
  ~288, Weekly shape ~276): about a third of an 844px viewport before anything can be changed.
- User evidence: the owner asked for Settings to be "completely overhauled… much more condensed".
- Design evidence: `SubScreen`'s own comment records the Settings.dc.html decision that the bar
  "carr[ies] the way back on the left and the screen's name in the middle, which is what tells you at
  a glance that you are a level down". The bar is therefore the documented owner of the screen name;
  the `h1` repeats it, and the `SETTINGS` kicker restates the level the bar already conveys.
  Every other piece of body copy on these screens is 11–12px (`Field` hint `text-[12px]`, captions
  `text-[11px]`); the intro is the only 16px paragraph.
- Owner: `SubScreen` in `app/src/app.jsx`.
- Scope and affected surfaces: all `<SubScreen>` consumers; no consumer overrides the header.
- Uncertainty: `Settings.dc.html` is not in the repository, so whether the design also drew an
  in-page title cannot be checked. The plan keeps the documented bar and removes only the repeat.

## Design decision

The sub-header bar is the one place a subscreen is named. Remove the in-page `SETTINGS` kicker and
the 25px `h1` from `SubScreen`, and set the intro at the size the rest of the screen's explanatory
copy uses, so it reads as context rather than as a second heading. Every subscreen gains roughly
100px and starts with its first section.

## Reuse

- `SubScreen` (owner), sub-header bar markup unchanged.
- Intro styling: the same muted explanatory style as `Field`'s hint (`text-[12px] leading-snug`,
  `color: var(--muted)`).
- Exemplar for a screen that leads straight into its first section under a bar:
  `SessionPlayer` after `design-plans/27-session-screen-one-header.md`.

No new primitive.

## Changes

1. `app/src/app.jsx` — `function SubScreen`
   - Change: delete the `Settings` kicker `<div>` and the `<h1>{title}</h1>`. Change the intro
     `<div>` from `text-base mb-5 leading-relaxed` to `text-[12px] mb-4 leading-snug`, keeping
     `color: var(--muted)`.
   - Preserve: the full-bleed purple bar, its `‹ You` back control and centred title; `useBackClose`;
     `fade-in`; the `intro` prop being optional.
   - Verify: on each subscreen the bar is the only place the name appears; the first section label
     sits directly under a one- or two-line intro.

## Scope

- Inherit: all 14 `<SubScreen>` consumers.
- Verify: Account tab and `SettingsOverview` (not `SubScreen`; must be unchanged); any test that
  asserts on the `h1` text of a subscreen (`tests/render.test.js`, search for subscreen titles).
- Exclude: the You/Settings overview layout, the app header, sheets.

## Validation

- Product: open each subscreen from Settings; you always know where you are from the bar, and the
  first control is visible without scrolling on a 390×844 screen.
- Interface: 390×844 and desktop width; paper and dark themes; the longest intro (Goal) wraps to at
  most three short lines.
- System: no subscreen re-adds its own heading; the bar remains the single title owner.
- Repository: `npm test` → all pass (update any assertion that read the removed `h1`).

## Stop conditions

- Stop if `Settings.dc.html` is found and draws an in-page title under the bar: then the duplication
  is the design's, and the change needs the owner's sign-off.

## Design documentation

- After acceptance: record in `design-plans/17-undesigned-surface-map.md` (Tier 2) that the
  settings-subscreen archetype is "bar names the screen; a short muted intro; sections follow".
