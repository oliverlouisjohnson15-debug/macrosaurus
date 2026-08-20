# The Train module gets a way to look around

Written against: `b27c447d`

**One plan, four changes, one root cause.** They are written together because they are the same
fault seen from four angles, and fixing any one alone leaves the module still feeling like a maze.
Change 4 carries a decision that is the product owner's to confirm — see **Uncertainty**.

## Evidence chain

- Surface: the Train tab on mobile — `app/src/train-tab.jsx` (the router and home screen),
  `app/src/train-session.jsx` (the session player), `app/src/train-build.jsx` (the builder and the
  day view), `app/src/train-core.jsx` (the shared readers).

- User evidence, from the person who built the app, after the first real gym use:
  1. "I feel stuck in live sessions"
  2. "it's really hard to navigate a week's session to go through over days that week or look into
     next blocks"
  3. "there's tons of buttons and I struggle to find which one and I made the app"

  `TRAIN_MODULE_PLAN.md:175` anticipated exactly this: *"The next honest piece of work is not on a
  list yet: nothing here has been run by a person in a gym."* This is that work.

- **Root cause.** `TrainTab` holds the whole module in a single `screen` state
  (`train-tab.jsx:19`) with sixteen destinations — `home`, `player`, `preview`, `builder`, `wizard`,
  `draft`, `rerun`, `blocks`, `library`, `coverage`, `review`, `history`, `exercise`, `settings`,
  `how`, `stats`. There is no persistent navigation between them: every move is an ad-hoc button on
  the home screen, and `from` props hand-roll a one-deep back stack. The two things a person most
  wants to look at — **a week that is not this week**, and **a session that is currently running** —
  are the two the home screen cannot show.

- **Finding 1 — look-ahead only exists inside the editor.** `TrainHome` computes
  `thisWeek = weekPlan(block, prog.week, t.logs)` (`train-tab.jsx:255`) and offers no week control at
  all. The module's only week-switcher is in `BlockBuilder` (`train-build.jsx:1086-1112`), beside the
  `Starts` date input and the volume editors, reached by `go('blocks')` → `BlockList` →
  `go('builder', {blockId})` (`train-tab.jsx:144-147`). Three taps into an *editing* screen to answer
  "what is on Thursday next week".

  The module already ruled against this. `SessionPreview`'s own header comment
  (`train-build.jsx:1440-1442`) rejects the alternative of making people *"go two hops into the block
  editor, which asks a different question entirely (it edits the four-week programme, not this
  Thursday)."* The day view was built to be the answer; nothing offers it a day outside this week.

- **Finding 2 — a hidden second route to a screen already on the page.** `CardHead` renders its
  `right` slot as an accent button with no verb and no chevron (`app.jsx:3629-3631`). `TrainHome`
  passes it the string `"2 / 4 done"` with `onRight={() => go('blocks')}` (`train-tab.jsx:305`) —
  and a labelled `Blocks` button on the same screen goes to the identical destination
  (`train-tab.jsx:582`). A progress readout is secretly a link, and it is the second link to one
  place. This contradicts the module's own written rule at `train-tab.jsx:235` — *"Every other row in
  this module that opens something carries one [a chevron]. Without it this reads as a panel of facts
  rather than as two things you can tap"* — and its `view ›` exemplar at `train-tab.jsx:535`.

- **Finding 3 — the session's exit is the module's only unlabelled back control.** `SubScreen`
  (`app.jsx:15259-15261`) draws the way back as text naming its destination, `‹ You`, and its comment
  records that this replaced *"a bare '‹ Settings' text link floating above the title — the only
  navigation in the app that had no chrome at all."* The session bar's exit
  (`train-session.jsx:592`) is a bare 16px chevron coloured `var(--nav-off)` — the *inactive*-nav
  colour — with an `aria-label` and no visible text. Since `design-plans/27` hid the brand bar in
  focus mode and `app.jsx:20051` hides the tab bar, it is now the only navigation on the screen.

- **Finding 4 — the app maintains a resume record and then destroys it on the way out.** This is the
  mechanical cause of "stuck", and it is provable:

  - `train-tab.jsx:26-37` writes `tr.open` while `screen.name === 'player'` and, in the same effect,
    `delete tr.open` the moment it is not.
  - `openScreen(db)` (`train-core.jsx:218-233`) reads that record at mount and reopens the player.
  - `TrainTab` is unmounted on every tab switch — `{view === 'train' && <TrainTab/>}`
    (`app.jsx:20040`).

  So while a session is live: tapping **TRAIN** in the tab bar always lands back *inside the player*,
  because the record survives the unmount. Train home is unreachable. And the one control that does
  reach it — the back chevron — **deletes the resume record on the way**, so stepping out to check
  anything is indistinguishable from abandoning the session.

  There is no third option in the code. "Look at something else and come back" is impossible by
  construction, which is precisely what "stuck" describes. `TRAIN_AUDIT.md:40` already fixed the
  data half of this ("Leaving a session part-way looked like it had ended everything"); the
  navigation half was never surfaced.

- Owner: `app/src/train-tab.jsx`, with reuse from `train-build.jsx` and `train-session.jsx`.
- Scope and affected surfaces: `TrainHome`, `TrainTab`'s router and `open` effect, the session bar in
  `SessionPlayer`, the session options `ActionSheet`.
- Uncertainty: Change 4's split between *stepping out* and *ending* — see **Uncertainty** below.

## What the comparable apps do

- **Hevy** keeps a running workout's state reachable from outside the workout screen — the rest timer
  and current state ride an iOS Live Activity, readable with the phone locked
  ([hevyapp.com](https://www.hevyapp.com/features/live-activity/)), and the duration in the workout's
  top-left is itself a control (tap to pause,
  [help.hevyapp.com](https://help.hevyapp.com/hc/en-us/articles/34513981310615-How-to-I-adjust-duration-and-pause-a-workout)).
  A session in progress is a *state the app carries*, not a room you are locked in. We are a PWA and
  cannot have Live Activities on iOS, but the principle transfers: the state belongs on the tab, not
  only inside the player.
- **Hevy** also separates the plan from the log structurally — routines live in folders under the
  Workout tab with a routine planner and calendar, history is its own tab
  ([hevyapp.com/hevy-tutorial](https://www.hevyapp.com/hevy-tutorial/),
  [gym-workout-routines](https://www.hevyapp.com/features/gym-workout-routines/)). Looking ahead
  never means opening an editor.
- **MacroFactor** answers the "too many buttons" problem by surfacing a small fixed set of shortcuts
  above the primary nav and letting the rest fade as you scroll
  ([macrofactor.com/dashboard-customization](https://macrofactor.com/dashboard-customization/)), and
  its redesign rationale is that *"redundant buttons were removed … the cleaner layout helps users
  focus on what matters most"*
  ([the revamp writeup](https://dribbble.com/shots/25409665-MacroFactor-Revamp-Nutrition-Tracking-App)).
  The relevant half for us is *redundant*: Change 2 removes a duplicate route rather than adding a
  customisation surface.
- General mobile guidance puts bottom-nav at three to five destinations and warns that more produces
  exactly the "which button" paralysis reported here
  ([uxdworld](https://uxdworld.com/bottom-tab-bar-navigation-design-best-practices/),
  [designstudiouiux](https://www.designstudiouiux.com/blog/mobile-navigation-ux/)). Train has
  sixteen destinations behind one tab and no persistent way between them.

## Design decision

**The running block and the running session each get one persistent, labelled surface on the Train
tab, and every duplicate or unlabelled route is removed.**

Concretely: the home screen can show *any* week of the running block, not only the current one; a
live session is a state you can step out of and back into without losing it; and the two controls
that lie about where they go are corrected. The whole change is wiring already-built owners to the
home screen — no new primitive is introduced.

## Reuse

- **Week switcher** — the disclosure control at `train-build.jsx:1086-1112`, including
  `weekRangeLabel(startISO, week)` and its deload marking. Exemplar: `train-build.jsx:1086`.
- **Day view** — `SessionPreview` (`train-build.jsx:1452`) already accepts any `session` of any
  `block` and adapts its own CTA (`train-build.jsx:1628-1630`). No change needed to show a
  future week's day; the router path `go('preview', {sessionId, blockId})` already resolves it
  (`train-tab.jsx:96-101`).
- **Week reader** — `weekPlan(block, week, logs)` (`train-core.jsx:183`) is already parameterised by
  week; `TrainHome` simply never passes anything but the current one.
- **Resume record** — `tr.open` (`train-tab.jsx:26-37`) and `openScreen` (`train-core.jsx:218`).
- **Back control** — `SubScreen`'s labelled `‹ <destination>` (`app.jsx:15260`).
- **Meter** — `PipLine` (`app.jsx:3979`), already used by the week band (`train-tab.jsx:~300`).
- **Session options** — the existing `ActionSheet` at `train-session.jsx:1191-1240`.
- `WEEKDAYS` (`train-core.jsx:89`) for day labels.

No new primitive is required. If one appears necessary during implementation, stop — see **Stop
conditions**.

## Changes

### 1. `app/src/train-tab.jsx` — `TrainHome` can show any week of the running block

- **Change:** add `const [weekAt, setWeekAt] = useState(null)` where `null` means "follow the block's
  current week". Derive `const shownWeek = weekAt || prog.week` and compute
  `weekPlan(block, shownWeek, t.logs)` for the card's day list, week meter and set total. Place the
  week switcher from `train-build.jsx:1086-1112` directly under the block card's `CardHead`, above
  the existing week band, using `weekRangeLabel(block.startISO, shownWeek)` so it names *when* as
  well as which. Each day name in the folded list keeps calling `onOpen(session, block)`, which
  already opens `SessionPreview` for any week.
- **Preserve:** the current-week behaviour on arrival (`weekAt === null`), the `Next` / `In progress`
  nested card, the primary `Open …` button, the rest-day, deload and intro banners. All of these are
  computed from `prog.week` and must keep reading `prog.week`, **not** `shownWeek` — they describe
  the week you are *in*, not the week you are *looking at*. Show the `Next` card and the primary
  button only when `shownWeek === prog.week`.
- **Verify:** on a four-week block in week 1, the card opens on week 1; picking Week 3 lists week 3's
  days with its own dates and set count; tapping Thursday opens `SessionPreview` for that day; the
  `Next` card and the start button are absent on week 3 and return on week 1.

### 2. `app/src/train-tab.jsx:305` — the progress readout stops being a link

- **Change:** drop `onRight` from the block card's `CardHead`, leaving
  `right={doneThisWeek + ' / ' + thisWeek.length + ' done'}` as a plain readout.
- **Preserve:** the `Blocks` button at `train-tab.jsx:582` as the single labelled route to the block
  list; the count's text and accent colour.
- **Verify:** the `2 / 4 done` string no longer responds to a tap; `Blocks` still reaches
  `BlockList`; no other control on `TrainHome` calls `go('blocks')`.

### 3. `app/src/train-session.jsx:592` — the session's exit says where it goes

- **Change:** replace the bare chevron with a labelled control in the `SubScreen` manner —
  `‹ Train` — at `pf text-[9px] uppercase`, `letterSpacing: '0.1em'`, keeping
  `color: 'var(--nav-off)'` and the existing `hit` target and `aria-label`.
- **Preserve:** the `useBackClose(onExit)` hardware-back binding (`train-session.jsx:198`); the
  session bar's single-surface layout and safe-area padding from `design-plans/27`; the 9px pixel-type
  floor that plan established for this bar.
- **Verify:** the control reads `‹ Train` on a 393px viewport without pushing the session name into
  truncation; on the narrowest supported width the title truncates before the exit label does.

### 4. `app/src/train-tab.jsx` + `app/src/train-session.jsx` — stepping out is not ending

This is the change that resolves "stuck". Today one control does two jobs; split them.

- **Change, `train-tab.jsx:26-37`:** stop deleting `tr.open` merely because `screen.name` is no
  longer `player`. Keep the record until the session is genuinely finished or discarded. Add an
  explicit `closeSession()` on `TrainTab` that clears it, and pass it to `SessionPlayer` as a new
  `onFinish` prop, distinct from `onExit`.
- **Change, `train-session.jsx`:** `onExit` becomes *step out and keep it open*. The two paths that
  end a session call `onFinish` instead: the sign-off completion (`train-session.jsx:1253`,
  `SessionSignOff`'s `onDone`) and the "nothing logged, so nothing saved" early return
  (`train-session.jsx:537`). The options sheet's last row (`train-session.jsx:1237`) keeps its
  current wording — *"Leave without finishing / Everything ticked is already saved. Come back to it
  later."* — and now tells the truth, because coming back is what will happen.
- **Change, `train-tab.jsx:19`:** `openScreen(db)` currently reopens the player at mount whenever a
  record exists, which is what makes Train home unreachable mid-session. Gate the *automatic* reopen
  on the module not having been left deliberately: keep `tr.open` as the record, and have
  `TrainHome` render a resume banner from it rather than the router forcing the player. Mount lands
  on `home` when a session is open; the banner is the way back in.
- **Change, `train-tab.jsx` `TrainHome`:** add a resume banner at the top of the card stack when
  `openScreen(db)` returns a screen — the session's name, its ticked-set count, and one primary
  control reading `Carry on with <name>` that calls `go('player', …)` with the record's ids. Model it
  on the existing draft-block card (`train-tab.jsx:540-556`), which is the same shape: a thing in
  progress, its state, and the way back into it.
- **Preserve:** every existing persistence guarantee. `tr.open`'s same-day expiry
  (`train-core.jsx:221`) and its orphan checks (`:222-231`) stay exactly as they are — this change
  alters *when the record is cleared*, never what it contains or how it is validated. Ticked sets are
  already saved on every tick and that path is untouched.
- **Verify:** start a session, tick two sets, tap `‹ Train` → Train home shows a resume banner
  naming the session and "2 sets in"; switch to Food and back to Train → still Train home, banner
  still there, *not* forced into the player; tap `Carry on` → the player reopens with both ticks
  intact; finish the session → the banner is gone and `tr.open` is absent from the store.

## Scope

- **Inherit:** `TrainHome` (all block states), the session player, the Train tab's mount behaviour.
- **Verify:** `SessionPreview` reached with a future week's session — its CTA reads
  `Start <name>` and would log against today, which is correct for training out of order but is a
  different act from starting *next week's* session early. Confirm the copy still reads honestly, or
  restrict the CTA to `shownWeek === prog.week`. `BlockBuilder`'s own week picker is untouched and
  must keep working. `RerunScreen`, `BlockReviewScreen` and `CoverageScreen` read `tr.open`
  nowhere and should be unaffected — confirm.
- **Exclude:** the sixteen-screen router itself. Collapsing Train's destinations into a smaller
  persistent structure is the larger remap this plan makes possible, not the one it performs. The
  block wizard, importer, library, coverage and review screens are all out of scope. No change to
  the engine (`app/training.js`) or the sync (`app/store.js`).

## Validation

- **Product:** with a four-week block running, a person can (a) read next Thursday's session without
  entering an editor, (b) leave a half-done session to check a macro and return to it with every tick
  intact, and (c) find the block list without guessing which of two controls leads there.
- **Interface:** `TrainHome` in all four block states — no block, block running, block finished,
  draft present; weeks 1 and 4 of a running block; a session live and not live. Session player at
  393px and at the narrowest supported width, light and dark. Content extremes: a one-day week, a
  six-day week, a block whose name truncates.
- **System:** confirm the week switcher is the control from `train-build.jsx:1086-1112` and not a
  second one; confirm no new shared primitive was introduced; confirm `go('blocks')` has exactly one
  caller in `TrainHome`.
- **Repository:** `npm test` → all tests pass, including `tests/render.test.js`. Add a render test
  asserting that leaving the player leaves `tr.open` present and that finishing clears it; it must
  fail without Change 4.

## Stop conditions

- Stop if Change 4 requires touching how sets are persisted. It must not: the split is about when the
  `open` record is cleared, nothing else.
- Stop if the resume banner cannot be built from the draft-card shape and needs a new primitive.
- Stop if gating the automatic reopen breaks the guarantee from `TRAIN_AUDIT.md:40` that a session
  survives a tab switch or a reload. Surviving is required; *auto-entering* is what is being removed.
- Stop and ask if Changes 1 and 4 together push the block card past roughly one screen height on a
  393px viewport — the card is already the tallest object in the module.

## Uncertainty

**Change 4 carries one product decision.** Today, leaving the player ends the session's resume
record; this plan makes leaving reversible and gives *finishing* the sole right to clear it. That is
the model Hevy uses and the one the reported complaint asks for, and the app already stores
everything it needs for it. But it changes what the back control means, and there is a real cost: a
session left open and never finished will keep offering to resume until the day rolls over
(`train-core.jsx:221`). The alternatives are to expire it sooner, or to prompt on the way out. This
plan assumes same-day expiry is acceptable because it is the rule the store already enforces; if the
owner wants a prompt instead, that is a one-line addition to the exit path and does not change
anything else here.

## Design documentation

- After acceptance and validation, record in `TRAIN_MODULE_PLAN.md` under a new "Found in gym use"
  heading: that leaving the session player no longer clears `tr.open`, that `TrainHome` can display
  any week of the running block, and that `CardHead`'s `right` slot must carry a verb when it is a
  link. The last of these is a rule about a shared component and belongs alongside the chevron rule
  already stated at `train-tab.jsx:235`.
