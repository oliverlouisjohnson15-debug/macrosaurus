# Train module audit

Written 20 Aug 2026, from three reports on one account:

> Carry on button doesn't work nor does start session
> I left upper 1 during session and it all ended
> can't go to historical session to reopen or edit

All three are real, all three are reproduced below, and all three are fixed in this change. The
audit that went looking for them turned up six more faults in the same corner of the module — the
seam between "a session you are planning", "a session you are in" and "a session you have done" —
and they are listed with the rest.

The rule this list keeps: nothing is on it unless there is a file and a line behind it.

---

## The three reports

### 1. "Start" and "Carry on with it" did nothing — FIXED

`TrainTab.startSession` (`app/src/train-tab.jsx`) puts a start on hold when more than one gym is
saved, because which room you are standing in decides what gets swapped:

```js
if (gyms.length > 1) { setPendingStart({ ... }); return; }
```

The picker that asks the question was rendered next to the **home** screen only, in the component's
final `return`. Every other screen returns before reaching it. `startSession` is called from three
places — the session preview, the block builder, and the gym picker's own callback — so on an
account with two gyms saved, tapping the button that begins a session set a piece of state and drew
nothing at all. Nothing happened, and nothing said why.

"Start" and "Carry on with it" are the same call, which is why both were dead.

**Fix:** the picker moved into `page()` (`train-tab.jsx:60`), the wrapper every Train screen already
renders through, so the question is drawn on whatever screen asked it. Accounts with one gym or none
were never affected, which is why this survived: it needs two gyms to reproduce.

### 2. Leaving a session part-way looked like it had ended everything — FIXED

Two separate things, on top of each other.

**The log row is written on the first tick.** `SessionPlayer.persist` writes to `training.logs` on
every edit, which is right — nothing ticked is ever lost. But every reader treated *the existence of
a log* as *that session is done*. `Training.completion` (`app/training.js:4566`) maps
`sessionId → log` with no notion of finished, `weekPlan` handed that straight to the Train tab, and
so:

- the day was ticked off in the week's roll-up,
- it stopped counting towards "3 sessions left this week",
- `next` (the first session with no log) skipped past it to the following day,
- and the big button on the tab offered that following day instead.

Half of Upper 1 was still saved the whole time. There was simply nothing on screen that led back to
it. "It all ended" is exactly what that looks like.

**Switching tabs unmounts the screen.** `{view === 'train' && <TrainTab …/>}` in `app.jsx` means the
whole Train tab — including which screen you were on — is thrown away when you look at Today or
Food, and rebuilt at home. Combined with the above, going to check a macro and coming back put you
on a home screen that said the session was done.

**Fix:** `endedAt` is written by Finish and by nothing else, so its absence is the signal. `liveLog`
(`train-core.jsx:198`) names it, `weekPlan` carries it per session, and Train home now reads
IN PROGRESS · <day>, says "Upper 1 is still open", says how many sets are already saved, keeps the
session in the week's remaining count, and puts *Carry on with Upper 1* on the primary button.

`endedAt` is only trusted for **today**: logs written before the field existed have none either, and
a session abandoned on Tuesday should read as the work it was rather than reopening itself all week.
Anything older is edited from History, which is now possible — see 3.

### 3. A logged session could only be deleted — FIXED

`TrainHistory`'s session cards carried one action: Delete. There was no way to open a session you
had already done, so a mistyped 100-for-10, a set you forgot to tick, or a session you finished at
home an hour later left you throwing the whole night away and re-entering it.

Underneath, the runner could not have opened one anyway: `SessionPlayer` found its log by
`dateISO === today`, and `persist` wrote `dateISO: today` unconditionally, so anything it touched
moved to today.

**Fix:** `SessionPlayer` takes an `openLogId` (`train-session.jsx:45`) and, when given one, edits
that log on **its own day** — every write, every record check and the sign-off read the log's date
rather than the clock. The header says "Editing · five days ago" instead of running a clock on a
session that finished last week, Finish becomes "Save and close", and the buddy's send-off is
skipped, because congratulating you on a workout from last Tuesday is nonsense. History's cards get
*Open & edit* (*Carry on with it* if the session is still open) next to Delete.

---

## What the audit turned up alongside them

### 4. The "Empty session" link was a dead button — FIXED

`TrainHome` had `const [whyEmpty, setWhyEmpty] = useState(false)`, a link that called
`setWhyEmpty(true)`, and **nothing that rendered it**. Nothing was ever set on `screen.freeform`
either, so the only way to log a session outside your block — a class, a holiday gym, ten minutes of
arms — was unreachable. Same symptom as report 1, different cause. It now explains what an empty
session is and starts one, through the same gym question a planned session goes through.

### 5. The preview promised to resume a session it would restart — FIXED

`SessionPreview` took *any* log against a session as "carry on": the button read **Carry on with
it** and the card said "Opening it again picks up where you left off" — for a session logged three
weeks ago, which the runner would have started from scratch as a new log against today. The screen
now distinguishes still-open (carry on), today's (open today's session, correct or add to it), and
done-a-while-ago (do it again, and it says a new session gets logged against today).

### 6. The builder hid the way back in — FIXED

`BlockBuilder` rendered its per-session start button as `{onStart && !log && …}`. The one screen
that could put you back into a session you had walked out of was the one screen that removed the
button the moment there was something to walk back into.

### 7. A second empty session reopened the first — FIXED

Empty sessions have no plan to be "the same session" as, so the runner matched them on the date
alone. Log some arms at lunchtime, finish it, start something in the evening, and you were handed
the lunchtime session back. Finished empty sessions are no longer resumed; today's *planned* session
still is, because reopening it is editing it rather than starting a second copy.

### 8. Dead state in the wizard — FIXED

`BlockWizard` carried its own orphaned copy of the same `whyEmpty` state, set by nothing and read by
nothing. Removed.

---

## Known, not fixed

These are real and none of them is what the reports were about. In rough order of what I would do
next.

### A. `Training.completion` still counts an unfinished session as done
`weekPlan` now knows the difference, but `completion` itself does not, and three other readers go
through it: the "x / y done" on the blocks list, the block review's completion percentage, and the
deload check's "you got to 70% of the sessions". A session started and abandoned inflates all three.
The engine needs the same `endedAt` awareness the tab now has, and it is an engine change with test
coverage to write, which is why it is not in this change.

### B. The Train tab is not a route
`{view === 'train' && <TrainTab …/>}` throws away which screen you were on whenever you look at
another tab, and a PWA reload does the same. A live session is the one screen in the app that owns
the phone for an hour, and it should survive both. Carrying on is now one tap from home, which takes
the sting out of it, but the right fix is to keep the open session in `db` (or in the URL) and
reopen it on mount.

### C. Two devices in one session lose sets
`Store.mergeStates` unions training logs **by id** and takes the whole row from the higher-`_rev`
copy (`app/store.js:553`, `unionBy` at `:470`). Ticking sets on a phone and a watch-side tab in the
same session means one device's sets are dropped wholesale rather than merged. Sets would need
unioning within a log, keyed on `itemId + setIndex`.

### D. Finish drops unticked sets with no undo
`finish()` keeps only `s.done` rows and, if none survive, deletes and tombstones the log. That is
right for "nothing logged, nothing saved", but there is no way back from an accidental Finish
half-way through a session.

### E. Repeating a session writes a second log against the same `sessionId`
`completion.logBySession` keeps only the last, so the earlier attempt vanishes from the week's view
(it stays in History). Fine in practice today, wrong the moment anything counts sessions per block.

### F. A session that crosses midnight splits in two
Resume matches on the log's date, so starting at 23:50 and carrying on at 00:10 opens a fresh log.
Rare, and the fix (match the open log regardless of date, within some window) risks resurrecting
stale sessions, so it wants deciding rather than patching.

### G. The rest timer does not survive leaving the screen
`rest` is component state. Walk out of the player mid-rest and the countdown is gone. It is a small
thing and an easy one: the timer is an `endsAt` timestamp already.

---

## What was checked and found sound

- **Nothing ticked is ever lost.** `persist` writes on every mutation, including notes, set type
  changes, added movements and swaps.
- **Resuming rebuilds the prescription correctly.** Sets group by `itemId`, so a day that programmes
  the same movement twice comes back as two movements; targets are read off the live plan first and
  the log's `itemTargets` second, which is what makes a mid-session addition and a freeform session
  work on reopening.
- **The rest of the module's state is live.** A sweep for state that is set but never rendered found
  exactly the two `whyEmpty` cases above, and nothing else across all five Train sources.
- **The shipped bundle matches the sources.** `node build.mjs` reproduces the committed `index.html`
  byte for byte, so none of this was a stale build.
- **1,171 tests pass**, including nine new ones covering the faults above. Five of the nine fail on
  the code as it was, which is the point of them.
