# Training: UI review and where the Macrosaurus playfulness could go

Written 2026-08-09, after building the Train tab out. Recommendations only, nothing here is built.

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
