# 05 · Train home: the next session, the week, then one list of everything else

Written against: `c3686f3` · Depends on: `01-foundation.md` (`PageBar`). Read
`design-plans/28-train-navigation-remap.md` first. This plan builds on its outcome and does not
reopen it.

## Evidence chain

- Surface: Train home, `TrainHome` (`app/src/train-tab.jsx:288`, render from `:375`), at 390×844 in
  `?demo` with the "Summer growth block" running.
- What already works (keep it): the hero is right. "NEXT UP · Lower B · OPEN LOWER B" sits at ≈290px,
  inside the first screen, with one gold control. The block ladder and the seven-day week are each
  one card with a `CardHead`. This is the module the other tabs should look like.
- Problems (rendered):
  1. **The title is said twice.** The page opens "SUMMER GROWTH BLOCK / **TRAIN**" (a hand-rolled
     header, `:377`–`:395`) under the active nav label TRAIN.
  2. **The week card ends in two footer rows for one thought.** "Change which days you train ›"
     (`:620`) and then "1 session left this week." (`:628`) are two 2px-ruled bands. One is a
     control, one a caption, and both are about this week.
  3. **The tail is five unrelated controls in three shapes.** After the week: a `pixel-box` card
     "Change this block" with a sub-line and chevron (`:681`); a three-column button grid History ·
     Progress · Blocks (`:824`); and a centred pixel-face text link "EMPTY SESSION" (`:836`). On the
     render the grid sits partly under the FAB, and the link is the only centred text control in the
     module.
- Design evidence: `00-README` rules 4–6. L1 (MacroFactor Workouts' dashboard: an overview, then
  sections you dive into). The module's own rule at `train-tab.jsx:235`: rows that open something
  carry a chevron. `SettingsRow` (`app.jsx:16912`), the app's existing list row for "a named
  destination plus one muted line".
- Owner: `TrainHome` in `app/src/train-tab.jsx`.
- Uncertainty: none.

## Design decision

Leave the top half alone. Collapse the bottom half into **one card of rows**, the same object
You already uses for "places you can go". Merge the week's two footers into one.

```
PageBar   SUMMER GROWTH BLOCK                     [⚙]
WEEK 2 OF 4 ladder                                  (unchanged)
NEXT UP · Lower B · ▶ OPEN LOWER B                  (unchanged hero)
THIS WEEK  M T W T F S S                            (unchanged)
  1 session left this week          Change days ›   ← one row
MORE ─────────────────────────────── (CardHead)
  History                         ›
  Progress   Am I getting stronger? ›
  Blocks                          ›
  Change this block   Say what you want different… ›
  Empty session   For a day that is not in the plan ›
```

## Reuse

- `PageBar` (01), `Card`, `CardHead`, `SettingsRow` (`app.jsx:16912`, global in the bundle like
  `Card` and `CardHead`, which this file already uses), `Icon.chevron`, `ConfirmDialog` (the
  existing "Start an empty session?" confirm).

## Changes

1. `TrainHome` — **`PageBar`** (`:377`–`:395`)
   - Change: replace the header block with
     `<PageBar context={block && !blockDone ? block.name : 'Your training'} actions={[{ icon: <Icon.sliders width="24" height="24" />, label: 'Training settings', onClick: () => go('settings') }]} />`.
   - Preserve: the comment's rule that the kicker names the block and the ladder names the week.
   - Verify: no "TRAIN" title. The sliders button is unchanged in place and size (`w-10 h-10`).

2. `TrainHome` week card — **one footer row** (`:620`–`:634`)
   - Change: when `!viewingAhead`, render a single row with a 2px top rule and `px-3 py-2.5`:
     left, the existing sentence ("1 session left this week." / "That is the whole week done." /
     "… is still open.") in `--muted` 12px; right, a button "Change days" plus `Icon.chevron` in
     `--accent-ink` 12px that calls `go('schedule', { blockId: block.id })`.
   - Verify: the week card ends in one band. Tapping "Change days" opens the schedule screen.

3. `TrainHome` tail — **one "More" card** (replaces `:681`–`:692`, `:824`–`:841`)
   - Change: render, only on the screens where these were shown before (keep each control's
     existing condition):
     ```jsx
     <Card className="p-0 mb-4 overflow-hidden">
       <CardHead title="More" />
       <SettingsRow label="History" onClick={() => go('history')} />
       <SettingsRow label="Progress" status="Am I getting stronger?" onClick={() => go('progress')} />
       <SettingsRow label="Blocks" onClick={() => go('blocks')} />
       {/* only while a block runs, as before */}
       <SettingsRow label="Change this block" status="Say what you want different and I will change the weeks you have not trained yet." onClick={() => go('builder', { blockId: block.id, from: 'home', tweak: true })} />
       {/* only when block && !blockDone && onFreeform, as before */}
       <SettingsRow label="Empty session" status="For a day that is not in the plan" onClick={() => setWhyEmpty(true)} last />
     </Card>
     ```
     The last *rendered* row gets `last`.
   - Preserve: the block-finished card and the no-block states (`ProgrammeCards`, the draft card),
     which render above this card as they do now. The `whyEmpty` confirm.
   - Verify: below the week there is exactly one card. Nothing sits under the FAB at the bottom of the
     scroll (the page's `pb-28` still clears it). Each row is ≥ 44px tall.

## Scope

- Inherit: Train home in every state: block running, viewing a week ahead, block finished, no
  block, a draft in progress, a session live (`resume` card).
- Verify: `go('history' | 'progress' | 'blocks' | 'builder' | 'schedule')` all still land, and
  their back controls return to home (plan 28's back stack).
- Exclude: the session player (plan 27), the builder, the blocks list and every other Train
  sub-screen.

## Validation

- Product: on a training day someone opens Train, sees the session to do and taps it. Anything
  else they might want is in one labelled list.
- Interface: 390×844 and 320×640, paper and dark, all the states listed under Scope.
- System: no `grid grid-cols-3` button row remains in `TrainHome`. No centred text-link control.
- Repository: `node build.mjs`; `npm test` → no new failures (`tests/train*.test.js` if present).

## Stop conditions

- Stop if `SettingsRow` is not in scope in `train-tab.jsx` at runtime (the bundle order changed).
  Then copy its markup into a local `TrainRow` with a comment pointing at the original. Do not
  invent a new look.

## Design documentation

- None.
