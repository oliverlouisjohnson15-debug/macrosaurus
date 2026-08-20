# A running session gets one header, not two and a half

Written against: `280c696be1ff1a5910eb77f5abfcb4f5ccb17954`

**This is a presentation plan.** It concerns one surface only: the top of the screen while a session
is being run (`SessionPlayer`). It does not change what the session bar reports, only how many bars
report it.

## Evidence chain

- Surface: the Train session player on mobile, top of screen. Two components stack there:
  - `MobileHeader` — `app/src/app.jsx:17811-17831`, rendered unconditionally at
    `app/src/app.jsx:20029`.
  - the session bar and its spine — `app/src/train-session.jsx:573-640`.
- Problem, measured off the source rather than the screenshot:

  | band | source | height |
  |---|---|---|
  | status bar / safe area | OS | ~47px |
  | `MobileHeader` | `app.jsx:17813` — `py-3` + a 36px box + `border-b-[3px]` | 63px |
  | session bar top row | `train-session.jsx:581` — `pt-2 pb-2` + the 38px **More** button | 54px |
  | spine row | `train-session.jsx:616` — `py-2` + a 3px `borderTop` | ~33px |
  | container bottom rule | `train-session.jsx:580` — `border-b-[3px]` | 3px |

  **~153px of app chrome, ~200px including the status bar** — a quarter of the viewport, on the one
  screen the app itself already declares is a focused mode, before the first set row appears.

- The two bars are not merely tall, they are *the same colour with a gap between them*.
  `MobileHeader` paints `var(--header)`; the session bar paints `var(--header)` too
  (`train-session.jsx:580`). Between them sits the page background, because the session bar is
  `-mx-5` inside the padded page body while the header is full-bleed. Two identical purple bands
  separated by a strip of paper do not read as two levels of hierarchy. They read as a rendering
  fault.

- The app already knows this screen is a focused mode, and already acts on it — for the *bottom* of
  the screen only. `SessionPlayer` calls `onFocusMode(true)` on mount (`train-session.jsx:201-203`),
  and `App` uses it to hide the tab bar: `{!focusMode && <BottomNav … />}` (`app.jsx:20051`, with the
  comment "the session player is a focused mode, so the tab bar and the centre Add button get out of
  the way"). The same reasoning was never applied to the header. The rule exists; it is applied to
  one end of the screen.

- What the top bar is offering mid-set: **MACROSAURUS** (a brand mark), a **33d** streak, **PLAY ›**,
  and **YOU**. Three tap targets, every one of which *abandons the session*. Nothing there is
  reachable-for during a working set, and two of them are one mis-tap from losing your place.

- Duplicated mascot: `MobileHeader` draws a `PixelEgg` (`app.jsx:17816`) and the session bar draws
  `SessionBuddy` (`train-session.jsx:587`) 60px below it. Two dinosaurs, one screen. The buddy in the
  session bar is the one that is doing work — it reacts to the movement pattern you are on.

- Type: the visible strings run `12px` (MACROSAURUS), `9.5px` (session name), `8px` (YOU), `7.5px`
  (elapsed, More) — four sizes of Press Start 2P, all uppercase, all letter-spaced, within 150px of
  each other. Two of them sit **below the 8px floor** that `design-plans/20-ui-review.md` and
  `NavBtn` (`app.jsx:17795`) both establish as the smallest pixel type in the product.

- Two competing progress claims on adjacent rows: `5:54:29 elapsed` in gold
  (`train-session.jsx:595`) and `1 / 8 done` (`train-session.jsx:634`). Elapsed is the more visually
  prominent of the two and the less useful — after five hours it is measuring how long the phone has
  been unlocked, not how the session is going.

## What the comparable apps do

None of them stack a brand bar over a session bar, and the reason is the same in each:

- **RepCount** treats a workout as a task with an end, not a page inside the app: the log screen is
  entered, filled, and closed with **Finish** ([support.repcountapp.com — how to log a
  workout](https://support.repcountapp.com/article/15-how-to-log-a-workout)). Its own pitch is a
  "streamlined interface" that lets you "focus on your lifts rather than data entry"
  ([mwm.ai](https://mwm.ai/apps/repcount-gym-workout-tracker/594982044)) — the chrome it does keep is
  the pre-filled last-session weights and the rest timer, i.e. things you *use* while lifting.
- **Strong** is the extreme of the same idea: "an interface stripped down to essentials — log your
  sets, track your progress, move on" ([RepReturn's
  comparison](https://repreturn.com/strong-app-review/)).
- **Hevy** pushes the session's status *out of the app entirely* rather than up into a second bar —
  the rest timer and current state ride on an iOS Live Activity so you can watch them with the phone
  locked ([hevyapp.com/features/live-activity](https://www.hevyapp.com/features/live-activity/),
  [workout-rest-timer](https://www.hevyapp.com/features/workout-rest-timer/)). The active workout
  owns the screen; nothing sits above it competing for the same band.
- **MacroFactor** is the closest analogue to our header specifically, and it is *one* bar: greeting,
  date, and a single notification control top-right. Its published redesign rationale is literally
  that "redundant buttons were removed … the cleaner layout helps users focus on what matters most"
  ([the revamp writeup](https://dribbble.com/shots/25409665-MacroFactor-Revamp-Nutrition-Tracking-App)),
  and Stronger by Science describe removing unnecessary friction and stress as the thing that "influences
  virtually every design decision"
  ([macrofactor.com](https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/)).
- The 2026 general-mobile line matches: contextual chrome per mode rather than one universal frame —
  Google Maps "stripped to essentials" in navigation mode is the canonical example
  ([designstudiouiux](https://www.designstudiouiux.com/blog/mobile-navigation-ux/),
  [muz.li](https://muz.li/blog/whats-changing-in-mobile-app-design-ui-patterns-that-matter-in-2026/)).

The shared principle: **a timed, one-hour, single-purpose task gets its own chrome, and only its own
chrome.** We have already built the session's own chrome — and left the app's chrome on top of it.

## The recommendation

Three changes, in value order. The first is most of the win and is nearly free.

### 1. Hide `MobileHeader` while a session is running

`app/src/app.jsx:20029`:

```diff
-      <MobileHeader onOpenPlay={() => setDexOpen(true)} onOpenYou={() => setView('more')} streak={appStreak} db={db} />
+      {/* A running session is a focused mode: the tab bar already steps aside for it (below), and
+          the brand bar must too. Its three controls all LEAVE the session, and it paints the same
+          purple as the session bar 60px under it, which read as one broken bar rather than two. */}
+      {!focusMode && <MobileHeader onOpenPlay={() => setDexOpen(true)} onOpenYou={() => setView('more')} streak={appStreak} db={db} />}
```

That is the existing focus-mode rule, applied to the other end of the screen. It removes 63px, the
duplicate purple band, the paper gutter between the two bands, the duplicate dinosaur, and the three
session-abandoning tap targets. `Play` and `You` remain exactly one tap away — via the back arrow the
session bar already has.

~~**Required with it:** the session bar becomes the topmost element, so it must take the safe
area.~~ **Checked when building it, and not required.** `index.html:8-9` declares
`theme-color: #5B4FA6` (and `#4A3F90` after dark), which is the darker purple band behind the status
bar in the report — the OS paints it and the web view begins below it. That is why `MobileHeader`
sits flush at `top-0` today with no inset of its own, and any `sticky top-0` element taking its place
inherits exactly the same behaviour. Adding `env(safe-area-inset-top)` would have opened a gap, not
closed one. Desktop is unaffected by construction: `Sidebar` is `lg:` only and `MobileHeader` is
`lg:hidden`.

### 2. Make the session bar one bar, not two stacked rows with a rule between them

`train-session.jsx:616` opens the spine row with `background: 'var(--card)'` and
`borderTop: '3px solid var(--border)'` — a second surface with its own frame, which is what turns one
header into two. Paint the spine row on `var(--header)` like the row above it and drop the 3px rule.
The spine cells keep their own 2px borders, so they stay legible on purple; `--track` is already the
unfilled colour and reads against it. One purple block, bottom rule at the bottom, ~3px and one
surface change saved — but the perceptual saving is larger than the pixel saving, because the header
stops looking like two things.

### 3. One progress claim, and one fewer type size

- Drop `5:54:29 elapsed` from the always-on line and let the second line be the spine plus
  `1 / 8 done` — the count that actually tracks the session. Elapsed belongs in the **More** sheet,
  or as a small `tnum` figure at the right of the title row where it can't out-shout the spine. A
  clock that has been running five hours is reporting the phone, not the workout.
- With elapsed gone from that slot, the `7.5px` string on the title row goes with it, leaving `9.5px`
  (title) and `7.5px` (More) — and **More** should go to `9px` to match `NavBtn`, putting every
  string on this screen back at or above the app's own 8px pixel-type floor
  (`TRAINING_UI_REVIEW.md` §2: Press Start 2P for short fixed strings only).

### Result

~200px of chrome becomes ~90px including the safe area: one purple block carrying back, buddy,
`UPPER 1 · WEEK 1`, More, and the spine with its count. The first exercise card comes up around 11%
into the viewport instead of 24%.

## Deliberately not recommended

- **Collapse-on-scroll for the session bar.** Standard elsewhere, wrong here: the spine is the one
  thing you glance at between sets, and the session screen is scrolled constantly. A bar that hides
  itself when you scroll is a bar that is missing exactly when it is wanted.
- **Removing the buddy from the session bar.** It is pattern-reactive
  (`train-session.jsx:587`, `1311`) and it is the only place the app's identity appears once
  `MobileHeader` steps aside. One dinosaur is the fix; zero is a different product.
- **A Live Activity / lock-screen surface, Hevy-style.** Correct direction, but we are a PWA and it is
  not available to us on iOS. Noted so it isn't re-litigated.

## Uncertainty

Whether elapsed time should survive on the session screen at all is the product owner's call. It is
prominent gold today (`--on-header-accent`), which is a deliberate choice, not an accident — the bar's
own comment at `train-session.jsx:573-579` names "the clock in gold" as part of the design. This plan
argues it has been outgrown by the spine, which arrived later and reports the same thing better. If
the clock stays, it goes to the right of the title row, not under it.


---

## Shipped

All three, on `claude/mobile-header-ui-redesign-9kii27`. What differs from the plan above:

- **The safe-area inset was not needed** — see the struck-through paragraph under step 1.
- **`past` keeps its line.** Step 3 proposed emptying the second line of the title slot entirely. The
  `Editing · yesterday` string stays, because it is the one thing the title cannot say for itself and
  it is a *fixed short string* rather than a ticking number — which is exactly what
  `TRAINING_UI_REVIEW.md` §2 says the pixel face is for. It went `7.5px → 9px` with everything else.
- **The clock's new home is the More sheet's kicker** rather than a row inside it:
  `Session · 5:54:29 elapsed`, or `Session · editing` on a session being corrected. One tap from the
  header, and it stops competing with the spine.
- **The count took `--nav-off`**, the token that exists for secondary type on the purple bar, now
  that it no longer sits on `--card`.

Test changes, which are the part worth reviewing:

- Four assertions across `train-continuity` and `train-resume` used the word **"elapsed"** as their
  "am I in the session runner?" probe. Three of those were *negative* (`!has('elapsed')`), so
  removing the word from the header would have left them passing vacuously — green while asserting
  nothing. They now go through one named `IN_SESSION` probe. It is deliberately **not** the spine's
  `n / n done`: the Train tab's home draws the same shape for the week, which the first attempt at
  this caught.
- `train-resume`'s "does not run a clock on a session that finished days ago" now **opens the More
  sheet** before asserting, since that is where the clock went.
- New: `a running session asks for the screen, and gives it back` — asserts `SessionPlayer` fires
  `onFocusMode(true)` on mount and `false` on unmount. `App` hangs both the tab bar and now the brand
  header off that one flag, and a signal that stopped *clearing* would strand somebody on a screen
  with no navigation at all. Nothing covered it before.

1280 tests pass. `sw.js` bumped to 345 so the change reaches installed PWAs.


## Verified in a browser

Chromium at 393x852, `?demo`, driven into Lower B's runner. Chrome above the first exercise card,
measured off the live `getBoundingClientRect()`:

| | old | new |
|---|---|---|
| session bar top edge | 87px | **0px** |
| session bar bottom edge (first card starts) | 179px | **81px** |

**179px -> 81px, a 98px saving — 55% of the chrome, and 11.5% of the viewport handed back.**

Running it turned up one thing the estimate and the test suite both missed: with the brand bar gone,
the page wrapper's `pt-6` was left stranded, putting a 24px cream strip along the top edge of the
screen at scroll 0. That 24px IS the "strip of paper" from the evidence chain — it did not go away
when the brand bar did, it just moved to the top. Fixed with `-mt-6` on the sticky container, which
cancels `pt-6` exactly as the existing `-mx-5` cancels the wrapper's `px-5`.

## Found while verifying, NOT fixed here

**The session bar does not actually stick.** At `scrollY: 600` its top edge is at `-163px` — it has
scrolled clean off the screen, despite `sticky top-0`. This reproduces identically on `main`
(`-174px`), so it is **pre-existing and not caused by this change**.

The cause is almost certainly `html, body { overflow-x: hidden }` (`app/src/styles.css:198`): an
ancestor with a clipped overflow is the classic thing that silently turns `position: sticky` into
`position: relative`.

It is worth its own change, because it undoes a good part of the reason this bar exists — the spine
is meant to be the thing you glance at between sets, and today it is only visible if you happen to be
scrolled to the top. It is deliberately out of scope here: the fix is a global change to how the
document handles horizontal overflow, and it could reintroduce sideways scroll anywhere in the app.
That wants its own pass and its own screenshots, not a rider on a chrome change.
