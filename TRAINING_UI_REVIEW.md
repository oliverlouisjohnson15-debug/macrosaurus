# Training: UI review and where the Macrosaurus playfulness could go

Written 2026-08-09, after building the Train tab out.

**Status, updated 2026-08-09 (sw 257-260): everything in this document is now built.** The Part 2
list went in first, then the Part 1 sweep on top of it. See the bottom of the file for what shipped
and the two places the recommendation was deliberately not followed.

---

## Part 1: what the research says, and where we sit against it

The 2026 consensus on mobile UI is **restraint**: calmer screens, one primary action that clearly
wins, secondary options that stay quiet, whitespace used on purpose. Legibility before expression in
type. Micro-interactions that guide rather than perform.

We are broadly in the right place. The specific things that are not.

### 1. Spacing is not on a rhythm (worth fixing, cheap)

The Train source uses **six different vertical gaps in volume**: `mb-1`, `mb-1.5`, `mb-2`, `mb-2.5`,
`mb-3`, `mb-4`, plus `p-2 / p-3 / p-3.5 / p-4`. That is why some cards feel slightly "off" without
anyone being able to say why. Vertical rhythm is the difference between a screen that looks designed
and one that looks assembled.

**Recommendation:** collapse to a four-step scale and use nothing else.
`4px` (inside a control) · `8px` (between related lines) · `16px` (between blocks) · `24px` (between
sections). Everything currently at 1.5, 2.5 and 3.5 rounds to its neighbour.

### 2. The pixel font is being asked to do a job it cannot do

Press Start 2P is roughly **one em per character** and has no true narrow digits. That is precisely
why the weight box clipped "62.5" into "62." earlier today, and why "Summer growth bl…" truncates on
the Train tab. The research line is "legibility first, expression second", and we currently have it
the other way round in a few places.

**Recommendation:** a hard rule, written down.
- Press Start 2P: **labels, headings, and short fixed strings only**. Never a number that varies in
  width, never a name a user typed.
- Everything variable-width uses the body face with `tnum`.
This keeps the whole Game Boy identity while removing the entire class of clipping bug.

### 3. Micro-interactions: the highest-value thing missing

There is **no haptic feedback anywhere in the app**. In a gym app the single best micro-interaction
available is a short buzz when a set is ticked. It confirms the tap without you having to look, which
is exactly the situation: phone on the bench, hand chalky, glancing down between breaths.

**Recommendation, in value order:**
1. `navigator.vibrate(15)` on ticking a set. One line, biggest return in the app.
2. A distinct double-buzz on completing an exercise (we already buzz for the rest timer).
3. A tick that animates in over ~120ms rather than appearing. The set row is the most-touched
   control we have and it currently has no acknowledgement at all.

### 4. Loading and empty states are uneven

There are 17 empty states in Train, which is good, and most offer an action. But loading is plain
text ("Loading blocks…"), and the block library shows nothing at all while it thinks.

**Recommendation:** three or four skeleton rows with the pixel-box outline and no content. Cheap, and
it makes the library feel instant rather than broken on a slow connection.

### 5. Toasts collide with the sticky action bar

I watched "4 new trophies unlocked" render straight over the Finish button during a session.

**Recommendation:** toasts move above `StickyAction` when one is mounted, and suppress non-urgent
toasts entirely while a session is running. Nothing about a trophy is worth interrupting a set.

### 6. Smaller things worth a pass

- The `?` badges are solid accent fill; three in a row on the prescription line is a lot of neon.
  An outlined badge with accent text would sit better.
- White primary buttons carry a scanline texture in the dark theme that costs a little legibility on
  small text. Worth checking against contrast at 12px.
- `Icon.chevron` rotates 90 degrees for open/closed but there is no transition on some instances.

---

## Part 2: the playful side, and one important caution

### Read the evidence before adding more game

This matters, so it goes first. The research on gamified fitness apps finds an **S-shaped curve**:
feature richness helps, then plateaus, then **actively hurts**. And the people it hurts are the ones
with lower confidence, which is exactly who a training feature is hardest for. Two specific findings:

- **Streak anxiety displaces enjoyment.** A streak that starts as motivation becomes an obligation.
- **Badges bolted onto a library can undermine intrinsic motivation** rather than adding to it.

Macrosaurus already runs a buddy, an egg, evolution, Amber currency, a shop, a weekly boss fight,
trophies, badges and a streak. **We are already well up that curve.** So the recommendation is not
"add a training game". It is:

> **Feed training into the systems that already exist. Add no new currency, no new streak, no new
> badge track.**

Everything below follows that rule.

### The good stuff, in order of value

**1. The dino trains with you.** During a session, a small sprite of your buddy does the movement
alongside you in the corner of the exercise card. It squats when you squat, presses when you press.
We already have a sprite pipeline and animation frames. This is pure relatedness, costs no new
mechanic, and is the single most on-brand thing on this list.

**2. A character sheet, from real lifts.** The coverage panel is already a row of bars that look
exactly like RPG stats. Lean all the way in: your buddy has **STR, POWER, ENDURANCE, BALANCE**,
derived deterministically from your actual estimated 1RMs, weekly volume, rep ranges and how evenly
your coverage sits. It is genuinely informative and genuinely playful at the same time, which is the
rare combination worth chasing. Competence, not participation.

**3. A PR is an event.** Right now beating your best is silent. It should be a proper Game Boy
moment: fanfare, the dino flexing, the number stamped. Rare, earned, tied to something real, so it
does not devalue the way a participation badge does.

**4. The rest timer is a character, not a clock.** The dino sits down and gets its breath back while
the timer runs, taps its foot near the end, then springs up at zero. The countdown is already there;
this only changes what fills the space next to it.

**5. Weeks feed the egg, sessions feed the streak.** Training completion should feed the *existing*
egg incubation and the *existing* streak, exactly as steps do. One system, two inputs.

**6. A finished block is a trophy.** The trophy cabinet exists. Completing four weeks is a real
achievement worth one, and it lands maybe every five weeks, which is the right frequency for
something to still feel like something.

### Deliberately not recommended

- **A training streak.** We have one streak. A second one competes with the first, and the research
  on streak anxiety is the clearest negative finding in the whole area.
- **Amber for lifting.** Currency earned two ways gets inflated and stops meaning anything.
- **Framing the deload week as a boss or a reward.** It is the part people skip already; making it
  the "fun" week teaches exactly the wrong lesson about why it is there.
- **Leaderboards or comparing lifts with other people.** The shared block library is social in the
  useful direction, sharing *plans*. Comparing *numbers* with strangers is where fitness apps make
  people feel worse, and it fits neither the buddy nor the British voice.

---

## Suggested order

1. Haptics on set completion. One line, biggest return. (§1.3)
2. The pixel-font rule, and fix the clipping it is causing. (§1.2)
3. Spacing scale. (§1.1)
4. Toasts out of the way of a live session. (§1.5)
5. The dino training alongside you. (§2.1)
6. The character sheet from real lifts. (§2.2)
7. PR moment, rest-timer character, block trophy. (§2.3, 2.4, 2.6)

---

## What shipped (sw 257-260)

### Part 2, the buddy in Train

| § | Recommendation | Where it landed |
|---|---|---|
| 2.1 | The dino trains with you | `LiftBuddy` in `train.jsx`. Squats on a squat, presses on a press, pulls on a row, driven off the set tick rather than a timer so it moves when you move. |
| 2.2 | A character sheet from real lifts | `Training.statSheet` + `StatSheet`. Was already built; now renders the real buddy at its real stage with its cosmetics on. |
| 2.3 | A PR is an event | `PRFlash`. Was already built; same sprite fix. |
| 2.4 | The rest timer is a character | `RestRing`. The buddy sits inside the ring, breathes slowly while there is time, paces in the last ten seconds, springs up at zero. |
| 2.5 | Sessions feed the streak | `trainedDates` in `app.jsx`, mirrored by `activeStreak` in `push-nudge/decide.ts`. One streak, three inputs. |
| 2.6 | A finished block is a trophy | `block_done` in `TROPHIES`, judged on sessions logged rather than the calendar. |

Three things went in that were not on the list, and all three were the same bug: Train did not know
the buddy existed.

- **`Training.trainingSummary`** is the one shape every buddy surface reads training from, wired into
  the chat snapshot, the morning deeper dive and the Today coach line. The chat prompt had always
  promised to answer training questions against a snapshot that carried none.
- **`Game.trainingAsk`** decides whether the buddy has anything to say about lifting, and most days
  it decides no.
- **The block review and coverage advice speak as the buddy.** They used to print under a heading
  reading "Your coach", which is a character this app has nowhere else.

The two "deliberately not recommended" items were honoured: there is still exactly one streak, and
lifting still mints no Amber.

### Part 1, the interface sweep

- **1.1 Spacing.** Every `.5` step in Train is off a 4px grid; all of them rounded to a neighbour.
  Only optical `mt-0.5` nudges and bar heights survive.
- **1.2 The pixel-font rule.** Press Start 2P now carries labels and fixed strings only. Six places
  were setting a name somebody typed, a coach wrote, or the library holds in it (session names,
  movement names, imported plan titles, shared block titles) plus the `Loading 62.5kg` heading that
  was the original bug. Each became a fixed pixel label with the variable text under it in the body
  face, which is the pattern the block review already used.
- **1.3 Micro-interactions.** The single buzz on a set tick was already in. Added the distinct
  double-buzz for finishing a movement, so two different events do not feel identical through a
  pocket.
- **1.4 Loading.** Skeletons were already in on the library; the rest are button-label states on
  user-initiated actions, which is correct and was left alone.
- **1.5 Toasts.** Already handled: a live session suppresses non-urgent toasts and lifts the rest.
  What was still colliding was the rest timer against the Finish button, 74px clearing the button
  but not its padding. Now 96px, and the session's scroll padding grew to clear both.
- **1.6 Smaller things.** The `?` badges are outlined with accent text instead of three solid neon
  fills in a row. Chevron transitions were already in place.

### Added on top, from current mobile guidance rather than from this document

- **Touch targets.** Everything pressed mid-set is a full 44px (WCAG 2.2 SC 2.5.8 sets the floor at
  24; 44 is the usability figure and the right one for chalky hands on a bench). Skip on the rest bar
  was an 8px label with no box at all; the set-type chip was 32 wide; the `?` badge was 20 square.
- **Dialog semantics.** Nine overlays in Train had no `role="dialog"`, no `aria-modal` and no
  accessible name. They do now.
- **The rest timer announces itself.** Finishing was a beep and a colour change, neither of any use
  to a screen reader. An assertive live region announces the transition only, never the count.
