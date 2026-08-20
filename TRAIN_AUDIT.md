# Train module audit

Written 20 Aug 2026, from three reports on one account:

> Carry on button doesn't work nor does start session
> I left upper 1 during session and it all ended
> can't go to historical session to reopen or edit

All three were real. This is the audit that went after them and then went through the rest of the
module, and everything on it is now fixed. Nothing is listed here that does not have a file and a
line behind it, and nothing is listed as fixed that does not have a test that fails without the fix.

The whole module lives in five sources — `train-core.jsx`, `train-tab.jsx`, `train-session.jsx`,
`train-build.jsx`, `train.jsx` — plus the engine in `app/training.js` and the sync in `app/store.js`.

---

## The three reports

### 1. "Start" and "Carry on with it" did nothing

`TrainTab.startSession` puts a start on hold when more than one gym is saved, because which room you
are standing in decides what gets swapped:

```js
if (gyms.length > 1) { setPendingStart({ ... }); return; }
```

The picker that asks the question was rendered next to the **home** screen only, in the component's
final `return`. Every other screen returns before reaching it. `startSession` is called from the
session preview, the block builder and the gym picker's own callback — so on an account with two
gyms saved, tapping the button that begins a session set a piece of state and drew nothing at all.

"Start" and "Carry on with it" are the same call, which is why both were dead.

**Fixed:** the picker moved into `page()` (`train-tab.jsx`), the wrapper every Train screen already
renders through, so the question is drawn on whatever screen asked it. Accounts with one gym or none
were never affected, which is why it survived: it needs two gyms to reproduce.

### 2. Leaving a session part-way looked like it had ended everything

Two things, on top of each other.

**The log row is written on the first tick.** `SessionPlayer.persist` writes to `training.logs` on
every edit, which is right — nothing ticked is ever lost. But every reader treated *the existence of
a log* as *that session is done*. `Training.completion` mapped `sessionId → log` with no notion of
finished, so the day was ticked off in the week's roll-up, it stopped counting towards "3 sessions
left this week", `next` skipped past it, and the tab's main button offered the following day.

**Switching tabs unmounts the screen.** `{view === 'train' && <TrainTab …/>}` in `app.jsx` throws
away which screen you were on whenever you look at Today or Food, and a reload does the same.

**Fixed:** `endedAt` is written by Finish and by nothing else, so its absence is the signal.
`Training.sessionOpen` owns the rule, `liveLog` and `weekPlan` carry it, and Train home reads
IN PROGRESS · <day>, says "Upper 1 is still open", says how many sets are already saved, keeps the
session in the week's remaining count, and offers *Carry on with Upper 1*. The session itself
survives the screen now — see B below.

### 3. A logged session could only be deleted

History's session cards carried one action: Delete. Underneath, the runner could not have opened an
old one anyway — it found its log by `dateISO === today` and wrote `dateISO: today` unconditionally,
so anything it touched moved to today.

**Fixed:** `SessionPlayer` takes an `openLogId` and edits that log **on its own day** — every write,
every record check and the sign-off read the log's date rather than the clock. The header says
"Editing · five days ago" instead of running a clock on a session that finished last week, Finish
becomes "Save and close", and the buddy's send-off is skipped. History's cards get *Open & edit*
(*Carry on with it* while a session is still open) next to Delete.

---

## Found alongside them

**4. The "Empty session" link was a dead button.** `TrainHome` had `whyEmpty` state, a link that set
it, and nothing that rendered it. Nothing ever set `screen.freeform` either, so the only way to log a
session outside your block — a class, a holiday gym, ten minutes of arms — was unreachable. It now
explains what an empty session is and starts one, through the same gym question a planned session
goes through.

**5. The preview promised to resume a session it would restart.** Any log against a session read as
"carry on", for a session logged three weeks ago that the runner would have started from scratch. The
screen now distinguishes still-open (carry on), today's (open today's session), and done-a-while-ago
(do it again, and it says a new session gets logged against today).

**6. The builder hid the way back in.** `{onStart && !log && …}` removed the per-session start button
the moment there was something to go back into.

**7. A second empty session reopened the first.** Empty sessions were matched on the date alone, so
finishing one at lunchtime and starting another in the evening handed back the lunchtime one.

**8. Dead state in the wizard.** `BlockWizard` carried its own orphaned copy of `whyEmpty`. Removed.

---

## The second pass: everything the first pass listed and left

**A. The engine counted an unfinished session as done.** `weekPlan` knew the difference; the engine
did not, and three readers went through it — the blocks list's "x / y done", the block review's
adherence percentage, and the deload check's "you got to 70% of the sessions". `Training.completion`
now takes the day (and, optionally, the clock) and returns `done` counting only finished sessions,
plus `openBySession` naming the ones still being written. The block builder marks an open day OPEN
rather than giving it the same tick as a finished one.

**B. The Train tab is not a route.** `training.open` is a pointer — session, block, log, day —
written when the runner opens and deleted when it closes, so a tab switch, a reload, an update
landing or the phone reclaiming the PWA puts you back in the session rather than at home. It is
validated before it is trusted: the day has to be today and whatever it points at has to still
exist, so a pointer at a deleted block cannot put the app into a screen it cannot draw. Because it is
cleared on the way out, it can only ever reopen a session somebody was taken out of, never one they
chose to leave.

**C. Two devices in one session lost sets.** `Store.mergeStates` unioned training logs by id and took
the whole row from the higher-`_rev` copy, so a session touched on a phone and on a tab left open at
home kept one device's sets and dropped the other's. Logs now merge **set by set**, keyed on the line
of the plan and the position in it (`itemId` + `setIndex`) — the same pair the runner already writes
for its own regrouping. Same set on both sides: the higher-`_rev` edit wins. Finished on either side:
finished. Tombstones still beat the union, so a deleted session stays deleted.

**D. Finish deleted the sets you had not ticked.** That made a forgotten tick, or an accidental
Finish, unrecoverable. They stay now, unticked: every reader of a log — engine and screens alike —
filters on `done`, and a session can be reopened from History, so an unticked row is a set you can go
back and tick. Nothing ticked at all is still nothing to keep, tombstoned so a sync cannot hand it
back.

**E. A session run twice was represented by whichever log came last in the array.** It is now the one
still open if there is one, and otherwise the most recent.

**F. A session that crossed midnight split in two.** `sessionOpen` carries an open session across the
date line for up to eight hours from `startedAt`, so half past eleven to ten past twelve is one
session, on the night it started, in one log. Only where the caller has a clock: the engine has no
date of its own and takes every one as an argument.

**G. The rest timer died with the screen.** It is a clock, and the whole point of it is that you are
not looking at the phone. It is mirrored into `training.restRun` and picked back up if it belongs to
this session and has not already run out.

---

## Found in the module sweep

**9. Every control on nine Train screens now provably does something.** Two of the faults above —
"Start" and "Empty session" — were the same shape: a real control, in the right place, with the right
words on it, wired to nothing. No render test can see that. `tests/train-buttons.test.js` mounts each
screen, enumerates every control, and presses each on its own fresh copy: a press has to change the
screen, call one of the screen's own callbacks, or write to the store. The only controls allowed to
do nothing are named one by one, per screen, and are all "the tab you are already on".

**10. The block builder threw your edits away without a word.** Everything on that screen is an edit
buffer — sets, movements, name, start date — and none of it is written until the button at the bottom
says so, which is right for a screen where one tap changes twelve weeks. The back arrow discarded the
lot silently. It now asks, in the two shapes that matter: a block that has never been saved is all
unsaved work, and an edited one names what it would lose. Starting a session from the builder saves
first, because the plan on screen is the one you are about to run.

**11. Training settings told every min-max user they had changed all seventeen volume bands.** The
summary line compared the user's bands, read against their style, with the defaults for **no** style.
Min-max lands nowhere near the volume model's numbers by design, so an account that had never touched
a band was told all seventeen were changed — on the line whose whole job is to say "you have not
moved anything". It now compares against the defaults for the style being trained.

**12. The buddy resting inside the rest ring had been left rendered by nothing.** `RestRing` — the
ring with your buddy getting its breath back inside it, pacing in the last ten seconds and up on its
feet when the rest is done — survived the redesign that turned the rest into a bar, but nothing
rendered it. A minute and a half of every set, several times an hour, with the one animation drawn
for exactly that moment sitting in a file. Back in the bar, beside the digits.

**13. A draft day with no movement list took the whole draft screen down.** `day.exercises.map` on
the one screen standing between an AI read of a screenshot and the person looking at it. Guarded.

---

## What was checked and found sound

- **Nothing ticked is ever lost.** `persist` writes on every mutation — sets, notes, set types, added
  movements, swaps.
- **Resuming rebuilds the prescription correctly.** Sets group by `itemId`, so a day that programmes
  the same movement twice comes back as two movements; targets are read off the live plan first and
  the log's `itemTargets` second, which is what makes a mid-session addition and a freeform session
  work on reopening.
- **No state is set but never rendered.** A sweep of all five sources found exactly the two `whyEmpty`
  cases above, and nothing else.
- **No component calls a callback it is not given.** Checked mechanically across every component
  definition and every place it is rendered.
- **Every screen draws on every shape of account.** Fifteen screens against an empty account, a block
  mid-run, a block that has finished, a session in progress, an account carrying two gyms and a draft
  basket, a block that has not started yet, and a free (non-premium) account: 79 renders,
  `tests/train-screens.test.js`.
- **Async paths clear their busy flags** on both the success and the failure side, everywhere in the
  module.
- **No unguarded first-element access** survives: the two the scan found are both provably non-empty.
- **The shipped bundle matches the sources.** `node build.mjs` reproduces the committed `index.html`,
  so none of this was a stale build.
- **1,275 tests pass**, 113 of them written for this audit.

---

## Deliberately not done

- **The dead-control sweep covers the top level of each screen**, not the controls inside sheets,
  pickers and dialogs those controls open. Extending it a level down means driving each sheet open
  first; worth doing, and a bigger job than the sweep itself.
- **Two devices appending a set at the same moment** still collide: both write the same
  `itemId + setIndex`, and the higher-`_rev` copy wins. Genuinely concurrent set-adding on one session
  is rare enough that a per-set id — the proper fix — has not been worth the migration.
- **`TrainSettings` keeps a local mirror of `prefs`** and can go stale against a write made elsewhere
  while it is open. It only reads back what it wrote, so nothing is wrong today; it is a shape that
  will eventually bite.
- **A handful of engine exports are used by neither the app nor the tests.** Dead exports rather than
  dead code — most are constants read internally — but the list is worth a tidy.
