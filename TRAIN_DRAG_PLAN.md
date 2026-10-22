# Train: drag-and-drop everywhere things get rearranged

Goal: in Train, moving things should feel like picking them up and putting them down, both
**before** a session (the plan) and **during** one (the player). Today every reorder goes through a
menu: open the row's sheet, then tap "Move up" or "Move down" once per step. Moving the last movement
to the top of a six-movement day takes about fifteen taps.

This plan is for an implementer who has not seen the conversation it came from. File and line
references are as of this commit.

---

## 0. What exists today

| Surface | File | How you reorder now | Problems |
|---|---|---|---|
| **Session player** (during) | `app/src/train-session.jsx` `SessionPlayer` | "More" → ActionSheet → *Move earlier* / *Move later* (~L1641) → `move(ii, delta)` (~L717) | Sheet closes after every step (no `keepOpen`). `move()` does **not** drop superset pairs that it breaks, so an A1/A2 pair can end up with another movement between them. It also calls `setFocus(to)`, so moving a queued row takes focus away from the movement you are doing. Rows are keyed by `it.exerciseId + '_' + ii` (~L1097), so React remounts cards on reorder. |
| **Session preview** (before) | `app/src/train-build.jsx` `SessionPreview` (~L1868) | Tap row → ActionSheet → *Move up* / *Move down* with `keepOpen` → `Training.moveExercise` | Menu only. Rows are split into "Main lifts" and "Accessories" (~L2059–2094), so what you see is grouped by role and is **not** the real order. You cannot see an order you are trying to change. |
| **Block builder, open day** | `app/src/train-build.jsx` `BlockBuilder` (~L1667–1730) | **No reorder at all.** Only replace, ×, sets ± | Missing feature. |
| **Home week strip** | `app/src/train-tab.jsx` (~L526–580) | Tap day → SessionPreview → "move ›" → weekday sheet | Three screens to say "legs is Thursday this week". |
| **Schedule days** | `app/src/train-build.jsx` `ScheduleDays` (~L2303) | 7 tap targets per session | Fine as it is. **Leave alone.** |
| **Import draft review** | `app/src/train.jsx` `BlockDraft` (~L2348–2420) | None. Rows can be removed or replaced but not reordered or moved to another day | Imports often put a movement in the wrong order or on the wrong day. |

Engine helpers already in `app/training.js` (~L3767–3870): `sessionItems`, `renumberSession`,
`moveExercise(session, itemId, delta)`, `dropBrokenSupersets`, `toggleSuperset`,
`removeExerciseFromSession`. Slot identity across weeks: `slotKeyOf` / `slotRows` (~L3692–3746).

**There is already a working drag pattern in the app**, so copy it rather than inventing one:
- `app/src/app.jsx` ~L13894–13985: the food diary's drag for logged entries. It has the
  long-press arm (450ms, cancelled by >10px movement), a ghost, a drop target worked out with
  `elementsFromPoint`, auto-scroll near the screen edges, a `touchmove` blocker
  (`passive:false`), and a timestamp guard that ignores the click after a drop. Its comments
  explain why each of those parts is needed. Read them.
- `app/src/app.jsx` ~L7540–7600 (`ArrangeToday`): a simple list reorder that grabs straight away
  from a handle, keeps the live order in a ref, and has "single flight" cleanup.
- `Grip` component (`app.jsx` right after `ArrangeToday`): the six-dot handle. Reuse it.

There is no dnd library, and none should be added. The bundle is concatenated by
`app/src/manifest.json` and run through Babel, so plain React with pointer events is the way to do
it.

---

## 1. Shared building block: `useDragList` (new, in `app/src/train-core.jsx`)

`train-core.jsx` loads before every other train file, so a function declared there is available
to all of them.

### API

```js
const dnd = useDragList({
  ids,                 // current order, array of stable string keys
  onDrop(id, toIndex), // commit: move `id` so it ends up at `toIndex` in the list (0-based, post-removal)
  unitOf,              // optional (id) => groupKey|null - rows sharing a key move together (supersets)
  canDrag,             // optional (id) => bool  (e.g. done rows in the player: false)
  disabled,            // bool - true while any sheet/modal is open
  longPressMs = 350,
});

dnd.order          // ids in PREVIEW order while dragging, else `ids`. Render from this.
dnd.dragging       // id | null
dnd.rowProps(id)   // { ref, 'data-drag-id', onPointerDown (long-press arm), style }
dnd.handleProps(id, label) // for the Grip button: grabs on pointerdown immediately (no hold),
                   // plus onKeyDown ArrowUp/ArrowDown -> onDrop(id, i -/+ 1), aria-label "Reorder <label>"
dnd.justDropped()  // true for 500ms after a drop. Guard row onClick with it.
```

### Behaviour (each point matches something the food diary drag already learned)
- **Two ways to pick a row up.** Hold it anywhere for 350ms, or press the grip handle, which grabs
  straight away. If the pointer moves more than 10px before the hold finishes, cancel it so the page
  can scroll normally.
- Never start a hold when the press lands on `input, textarea, select, [data-no-drag]`. This matters
  most in the player, where the open card is full of inputs.
- Once a drag has started: add a `touchmove` listener with `{passive:false}` that calls
  `preventDefault`, set `document.body.style.touchAction='none'` and `userSelect='none'`, and put
  both back afterwards. Vibrate for 10ms if the device supports it.
- **Preview by live splice** (like `ArrangeToday`): when drag starts, store each row's rect. On
  `pointermove`, find the target index from the pointer's Y against the row midpoints, then splice
  the preview order (held in both a ref and state). The dragged row gets the accent border and a
  `translateX(6px)` "lifted" look, the same as ArrangeToday. A floating ghost is not needed for
  a list.
  - Re-measure rects after every splice, or work from the cached heights plus the new order. Rows
    differ in height (open card vs compact rows), so a fixed row height will not work.
- **Units:** when `unitOf` gives a key, drag the whole run of consecutive rows that share it as one
  block. Targets snap to unit boundaries, so a drop can never land between A1 and A2.
- **Auto-scroll:** `window.scrollBy(0, ±14)` when the pointer is within 140px of the top (the player
  has pinned chrome, see `scrollMarginTop` ~L1104) or 130px of the bottom.
- **Commit on `pointerup`.** On `pointercancel`, commit to the last preview position too, as the
  food diary does. If the order did not change, do nothing.
- Single flight: a new grab ends any drag still in progress. Clean up on unmount.
- Export the index maths as a **pure function**, `dragTargetIndex(y, rects, fromIndex, units)`, so it
  can be unit-tested without layout. jsdom returns zero-size rects.

Optional, only if `useDragList` would otherwise get big: a sibling `useDragToZone` for dropping onto
targets in 2D (the week strip in §5 and cross-day moves in §6). It uses `elementsFromPoint` and
`[data-drop-key]` the way `computeDrop` does in app.jsx. A floating ghost chip makes sense there.

---

## 2. Engine additions (`app/training.js`, exported at ~L7365)

1. **`reorderUnits(list, itemId, toIndex, groupField)`**: a pure function that returns a new array.
   It moves the item, or its whole consecutive superset run when `list[i][groupField]` is set, so
   that it lands at `toIndex`, and clamps the target to a unit boundary. The player passes
   `'superset'` and the block passes `'supersetGroup'`. **One function serves both, so the
   player and the plan cannot disagree.**
2. **`moveExerciseTo(session, itemId, toIndex)`** calls `reorderUnits(sessionItems(session), …,
   'supersetGroup')`, then `renumberSession`, then `dropBrokenSupersets`. Returns true/false like
   `moveExercise`. Re-implement `moveExercise(delta)` on top of it so there is one path, and keep
   its existing tests passing (`tests/training.test.js` ~L3391–3420).
3. **`moveSlotInBlock(block, sessionId, itemId, toIndex, fromWeek)`**: reorders the plan. In the
   tapped session, work out the slot key of the moved row **and** of the row it will sit before
   (or "end"). **Do this before mutating anything.** `slotKeyOf` falls back to `'p:…#order'` for
   rows without a `_wN` id, so changing `order` first would change the keys you are trying to find.
   Then, for every session with the same `dayKeyOf` and `week >= fromWeek`, move the row with that
   key to just before the row with the anchor key, or to the end. Renumber and drop broken
   supersets in each. Return the number of sessions changed. If a week is missing the anchor slot,
   clamp to the same index.
4. A player-side helper (in `train-session.jsx`, or `Training.dropBrokenPairs(list, 'superset')`)
   that clears `superset` on any group whose members are no longer next to each other. The player
   currently has none.

---

## 3. Session player (during a session): `app/src/train-session.jsx`

What it needs to do: *"The squat rack is taken. Let me do leg press now and reshuffle what's left."*

1. **Stable keys.** Give every row a stable key in the `useState` initializer (~L126) and in the
   add and replace paths (`'add_'…`, `replacedRow`). Use `it.id` when there is one, otherwise a
   `_k: trainUid()`. Key rows by it (~L1097). Do not change the `id` that gets persisted, because
   `slotReach` uses it to match rows back to the plan.
2. **Drag in "Up next".** The `queueRows` card (~L1464–1486) becomes a `useDragList` list:
   - Only queued rows can be dragged. Done rows are a receipt and the open card is where you are
     working, so neither moves.
   - Add a `Grip` handle at the right end of each queued header, using `handleProps`. The chevron
     moves just to the left of it, or is dropped on queued rows. A hold anywhere on the header also
     works, and a plain tap still opens the row. Guard that tap with `justDropped()`.
   - `onDrop(key, toQueueIndex)`: map the queue position back to a full-list index (put it before
     the queued row that is now at that position, or after the last queued row), then `mutate(n =>
     …reorderUnits(n, …, 'superset'))` and run the broken-pair helper.
   - `disabled` while `menuOpen`, `swapping`, `targetFor`, `plateFor`, `setupFor`, `unitsFor` or
     the picker is open. All of those hold **indices**, and a reorder underneath them would point
     them at the wrong row.
3. **Focus follows identity, not index.** After any reorder, including the menu path, set `focus`
   to the new index of the row that was open. Fix `move()` (~L717), which currently always moves
   focus to the row that was moved.
4. **"Do this one now"**: a new first-class action, because it is the most common mid-session
   reorder. Put it in the movement's ActionSheet (~L1620) for queued rows, and as a small button
   on each "Up next" row if there is room at 375px (otherwise menu only). It moves the row (with
   its superset unit) to just after the currently open movement and `goTo()`s it. The movement you
   leave keeps its logged sets, and `nextUnfinished` already wraps back to it.
5. **The menu path stays** as the accessible route, with fixes: add `keepOpen: true` to *Move
   earlier* / *Move later*, update `menuOpen` to the moved row's new index so the sheet keeps
   pointing at the same movement, and route both through the same reorder plus broken-pair helper.
6. Persistence needs nothing new. `mutate` already persists. Check that a reload after a drag
   restores the new order.

---

## 4. Session preview (before a session): `SessionPreview` in `app/src/train-build.jsx`

1. **Show the real order.** Replace the Main lifts / Accessories split with **one list in session
   order**. Each row keeps its current look: main lifts use `movementBody`, accessories the compact
   `accessoryRow`. A small "Accessory" tag, or just the compact styling, is enough to tell them
   apart. Without this change, dragging inside a grouped view cannot honestly show where a row will
   end up.
2. Wrap the list in `useDragList` with `unitOf = it => it.supersetGroup`. Each row gets a `Grip`
   handle in place of the chevron, keeps tap-to-open-menu (guarded with `justDropped()`), and
   supports hold-to-drag.
   `onDrop` → `edit(s => Training.moveExerciseTo(s, id, toIndex))`. Say nothing: the change is on
   screen, which is how the builder behaves too.
3. Keep *Move up* / *Move down* in the sheet. Add *Move to top* and *Move to bottom* there as well
   (both `keepOpen`).
4. Change the hint text (~L2110): "Hold and drag to reorder. Tap a movement to replace it, change
   its sets and reps or take it out. …" Keep the rest of the sentence about scope.
5. Undo for remove (`undoRemove`) splices back by index. That is still right after a reorder,
   because it restores to `undo.at`, clamped. Nothing to change.

---

## 5. Week strip, which day (before): `app/src/train-tab.jsx` ~L526

- **Hold a session cell and drag it onto another day's column.** On drop, call
  `trainUpdate(update, tr => Training.setSessionDay(<that week's session>, dow))`. This moves **that
  week only**, which matches the existing "move ›" sheet and the comment on `setSessionDay`.
- Use `useDragToZone` with each column as `data-drop-key={dow}`, a ghost showing the session's short
  name, and the target column highlighted with the accent tint. Rest days are valid drop targets.
- Not draggable: done sessions (logged), and the session in progress.
- Allowed while viewing a future week (`viewingAhead`). It moves that week's copy.
- Dropping on a day that already has a session is allowed, since doubles are supported. Show the
  same "+1" the strip already draws.
- Toast "Legs moved to Thursday this week". If `showToast` supports an action (check how
  `TrainTab` receives it from `app.jsx`; the diary's `toast(msg, 'Undo', fn)` does), offer **Undo**.
- A plain tap still opens the preview. Guard it with `justDropped()`.
- Leave `ScheduleDays` as it is. It answers "which days do I train" for every week, and seven
  buttons per session is already the right control for that.

---

## 6. Block builder and import draft (planning)

### Block builder, open day (`train-build.jsx` ~L1688)
- Add `useDragList` to the `ordered` list, with a Grip at the start of each row (before the code
  letter) so it does not compete with the × at the end.
- `onDrop` → `edit(b => Training.moveSlotInBlock(b, s.id, id, toIndex, prog ? prog.week : null))`.
  This edits the plan, so it applies to this week and every week after it, the same rule
  `replaceItem` follows. It stays in the edit buffer until the page's save button.
- Hint text: "Hold and drag to reorder; it applies to every week from this one."
- Because the screen has no other reorder path, add a keyboard/accessible one through the handle's
  ArrowUp/ArrowDown (from `handleProps`).

### Import draft review (`train.jsx` `BlockDraft` ~L2365)
- Reorder movements within a day: `useDragList` per day, `onDrop` splices
  `d.days[di].exercises` and renumbers `order`.
- **Move a movement to another day.** This is the commonest import fix. Easiest version: add a
  "Move to…" entry that lists the other days (it is the accessible route anyway). If a cross-day
  drag fits cleanly with `useDragToZone` (each day card as `data-drop-key`), add that too.
  Otherwise leave it for later.
- Reorder the days themselves by holding the day card's title row. Keep the name `<input>`
  editable by marking it `data-no-drag`.

---

## 7. Order of work (each step ships on its own)

1. Engine: `reorderUnits`, `moveExerciseTo`, `moveExercise` rebuilt on top of it, `moveSlotInBlock`,
   and the broken-pair helper. Tests first (§8).
2. `useDragList` plus the pure `dragTargetIndex` and its tests.
3. Session player: stable keys, the focus-identity fix, broken-pair fix, `keepOpen`, "Do this one
   now", and drag in Up next. **Most of the value is in this step.**
4. Session preview: flat list and drag.
5. Block builder day drag.
6. Week strip drag between days (`useDragToZone`).
7. Import draft: reorder within a day, "Move to…" another day, reorder days.

---

## 8. Tests and checks

- `npm test` (Node test runner over `tests/*.test.js`). Before pushing, also run `node build.mjs`
  so a Babel or bundle error is caught.
- **Engine** (`tests/training.test.js`, next to the `moveExercise` tests at ~L3391):
  - `reorderUnits` moves a superset pair as one unit, and never splits a pair at the target.
  - `moveExerciseTo` to the first and last position, and with duplicate `order` values.
  - `moveSlotInBlock` reorders every week from `fromWeek`, leaves earlier weeks untouched, works
    for rows with `_wN` ids **and** for imported rows that only have `p:` keys (the
    key-before-mutate trap), and copes with a week that is missing the anchor slot.
- **Hook maths:** test `dragTargetIndex` with made-up rects: rows of mixed heights, unit snapping,
  dragging past either end.
- **UI** (mounted harness in `tests/helpers/app.js`; see `tests/block-tweak-ui.test.js` for how it
  is used). jsdom has no layout, and only clicks reliably reach handlers, so drive the
  **accessible paths**:
  - Player: "Do this one now" moves the row after the open one and opens it. *Move later* keeps
    the sheet open and on the same movement. Breaking an adjacency clears the superset codes.
  - Preview: rows render in true session order (an accessory placed before a main lift appears
    first). *Move to top* works.
  - Builder: reorder applies to the current and later weeks only.
- **Real-device check:** use Playwright with `hasTouch: true` (Chromium is preinstalled at
  `/opt/pw-browsers`). Touch drags need CDP `Input.dispatchTouchEvent`, because
  `page.touchscreen` only taps. Check:
  - a hold on a row does not scroll the page;
  - a quick swipe does scroll it and does not pick the row up;
  - dropping does not open the row's menu;
  - auto-scroll works on a long session;
  - typing in a set input never starts a drag.

---

## 9. Out of scope / later
- Dragging one movement onto another to make a superset. It is appealing, but it is easy to
  trigger by accident and it needs its own drop affordance. For now, keep "Superset with the next".
- Reordering sets within a movement.
- Removing in the builder still edits a single week, while replace and the new reorder edit the
  plan. That inconsistency already exists. Note it and do not fix it here.
