# The buddy overhaul: one voice, one object, at the top of Today

A researched design for making the buddy the thing that carries Macrosaurus's retention
loop, rather than a mood badge sitting under a bar that says the same thing.

Short version: **the pieces are nearly all built and wired to the wrong things.** The
buddy has ten animation strips and Today uses one. It has a seven-rung message ladder
that nothing on the hero card consults. It has a "craving" concept that computes the
day's open loop and is rendered nowhere. The overhaul is mostly re-pointing what exists
at what it was clearly built for, plus one genuinely new idea: the buddy's *animation*
should express the day's situation instead of the streak's seniority.

---

## Part 1 — What the research says

### 1.1 The reframe that matters most: care, not performance

[Finch](https://medium.com/@deepthi.aipm/ux-teardown-finch-self-care-app-18122357fae7) is
the strongest example of this pattern working in a health context, and the reason it
works is a reframe rather than a mechanic:

> The app flips motivation by making your bird benefit when you take care of yourself,
> so self-care becomes an act of care rather than a performance… There is no penalty for
> an off day, only a small companion glad to see you back.

Macrosaurus is already close. `dayBondPoints` pays the bond when you eat well, the
freeze forgives a miss, and the training line literally says *"No lecture, life
happens."* But the mood copy still leaks performance framing:

| Current mood line | Frame |
|---|---|
| `sluggish`: "A bit low, nothing logged yet." | the buddy is worse off **because of you** |
| `peckish`: "Could do with more protein." | care framing — **this one is right** |
| `stuffed`: "Over the line today, no drama, back at it tomorrow." | forgiving — **right** |

The rule to apply everywhere: **the buddy states its own need; it never reports your
failure.** "I could do with some protein" and "You're 40g short" describe the same
number and are not the same product.

### 1.2 The failure mode, named

[Duo became a symbol of streak anxiety](https://digest.headfoundation.org/2025/09/21/winning-at-what-cost-the-psychology-of-gamification-and-the-fight-for-our-focus/)
through "playful yet persistent notifications with guilt-inducing messages", and the
research on gamified health specifically finds that anxiety mediates the path from
immersion to burnout. [Clippy's problem was never accuracy](https://thejaymo.net/2025/08/12/clippy-a-history/) —
it was etiquette; an assistant that watches and butts in.

Promoting the buddy to the top of Today points both barrels at us. It is the single
biggest risk in this work and the reason for the silence rule in §2.4.

### 1.3 The frame to design against: Self-Determination Theory

SDT gives three needs — **autonomy, competence, relatedness** — and the research is
consistent that streak-and-punishment designs produce *introjected regulation*
(short-term compliance driven by guilt) rather than durable motivation. Usefully, the
three map cleanly onto what this app is trying to do:

| Need | Carried by | State today |
|---|---|---|
| **Relatedness** | the buddy — bond, hearts, evolution, name | strong, but buried below the fold |
| **Competence** | the one open loop, personal bests, "days logged" | built last week, in the wrong place |
| **Autonomy** | dismiss, snooze, silence, no coercion | machinery exists; **silence does not** |

Autonomy is the one actually missing, and it is the one that prevents 1.2.

### 1.4 What makes a character feel alive

The [game-animation literature](https://blog.animationstudies.org/levels-of-agency-in-idle-animations-mapping-inactivity-in-video-games/)
is blunt: idle animation is what conveys lifelikeness, and a character's idle should
express *personality and situation* — Sonic taps his foot and looks annoyed when you
stop playing. The general UI principle is that every action should get an immediate,
visible reaction.

**This is where Macrosaurus is leaving the most on the table.** The sprite pack ships
ten strips per species — `idle, move, dash, jump, scan, bite, kick, avoid, hurt, dead` —
and `useIdleFlourish` already rotates one in every 7–15s with `prefers-reduced-motion`
honoured. But:

```js
const STAGE_FLOURISH = [null, 'jump', 'jump', 'move', 'dash', 'scan'];
```

The flourish is indexed by **buddy stage** — i.e. how long your streak is. A 30-day
buddy scans whether or not you have eaten; a 3-day buddy jumps whether or not it is
starving. **The animation expresses seniority, not situation.** Every other strip
(`bite`, `scan`, `dash`) is reserved for the Fight.

---

## Part 2 — The design

### 2.1 One object, four layers

The buddy card becomes the single carrier of the daily loop. Everything below already
has a computed source in the codebase.

| Layer | Says | Source | Built? |
|---|---|---|---|
| **Face** | how today is going, before you read | day state → animation | strips ship; mapping is new |
| **Line** | the one thing worth doing | `buddyMessage` ladder | built |
| **Meter** | how far off it is | `Game.oneThing().pct` | built last week |
| **Bond** | the relationship you are building | hearts / level / stage | built |

A user glancing without reading gets the state from the face. A user reading one line
gets the instruction. A user who wants the number gets the meter. Nothing repeats.

### 2.2 The face: animation carries the day, not the streak

Replace stage-indexed flourish with **state-indexed** flourish. All strips already exist.

| Day state | Flourish | Why |
|---|---|---|
| Nothing logged yet | `scan` | it is looking for food — the ask, without a word |
| Loop open, part-fed | `idle` + occasional `move` | alive, unbothered, not nagging |
| Loop just closed | `jump` **once**, then calm idle | the reaction to the action (§1.4) |
| Over on calories | slow `idle`, no flourish | "stuffed", already in `buddyMood` |
| Comeback after a lapse | `dash` on first render | glad to see you back (§1.1) |
| Asleep (lapsed, not yet returned) | `idle`, dimmed | never the default after a return |

Keep stage as a *modifier* (bigger sprite, cosmetics), not the driver. `useIdleFlourish`
takes the animation as an argument instead of deriving it from stage — a one-line
signature change plus a mapping table.

### 2.3 The line: rung 7 of the ladder it already has

`buddyMessage` is a seven-rung priority ladder; `buddyCoach` is its ambient rung. The
open loop becomes a rung, and the two branches it duplicates are deleted.

```
1  paused goal            unchanged
2  pending plan review    unchanged
2b weigh-in ask           unchanged   (morning, cadence-aware, answers inline)
2c weekly recap           unchanged   (once a week)
3  morning read           unchanged   (sleep/steps, before 14:00)
4  lesson                 unchanged   (new users)
6  breakout ask           unchanged   (overdue check-in)
7  THE OPEN LOOP          NEW — Game.oneThing, with the meter
7b training / steps / density / engagement    unchanged
8  nothing due            NEW — return null, buddy goes quiet
   (coach_log + coach_protein deleted; rung 7 owns them)
```

Rung 7, **not higher**: the weigh-in is only honest before breakfast, and a pending plan
change is a decision already waiting. Both must outrank a protein gap.

### 2.4 Silence — the rule that makes the rest safe

`buddyCoach` currently cannot say nothing; it falls through to *"Good start. Log as you
go and I'll keep you on track."* At the bottom of the page that is wallpaper. At the top
it is Clippy.

**Change: the ladder may return null, and the card renders quiet** — sprite, name, mood,
bond, no line, no CTA, no dismiss. For a consistent user mid-afternoon with the loop
closed, quiet is the *correct* state and the card becomes a small reward for being done
rather than another thing asking.

This is the autonomy leg of §1.3, and it is what stops the top-of-page buddy becoming
the thing people learn to scroll past.

### 2.5 Voice rules

1. **State a need, never report a failure.** "I could do with 40g more protein" ✓ / "You're 40g short" ✗.
2. **Never imply the user let it down.** Rewrite `sluggish` to sit alongside `peckish`.
3. **Glad to see you back, always.** The comeback path wakes it same-day; the line matches.
4. **One line. One CTA. Always dismissible when it is an ask.**
5. **Silence beats filler.**

### 2.6 Layout

```
Today
  ├── Buddy card          ← moves here (face · line · meter · bond)
  ├── Macro hero          ← kcal number, four bars, balance   (OneThingLine deleted)
  ├── Recovery dials
  └── …
```

The macro card loses only the block I added last week. Its hero number, bars and balance
tool are untouched.

---

## Part 3 — Phasing

Each phase ships and reverts independently.

| Phase | Change | Risk |
|---|---|---|
| **1** | Add rung 7; delete `OneThingLine` + `coach_log`/`coach_protein` | low — *fixes the live double voice on its own* |
| **2** | Allow the ladder to return null; render the quiet card | low |
| **3** | Move the buddy above the macro card | low, but it is the contentious one (§4.1) |
| **4** | State-indexed flourish; `jump` on loop close; `dash` on comeback | medium — most new code, biggest felt difference |
| **5** | Voice pass on `MOOD_META` + coach copy per §2.5 | low |
| **6** | Retire the dead `buddyCraving`/`CRAVE_LABEL`, or re-point them at `oneThing` | low |

Phases 1, 2, 5, 6 are pure consolidation and deletion. Phase 4 is the one that adds
something genuinely new, and it is where the "best in class" feeling actually comes
from — a character that reacts to what you just did.

---

## Part 4 — Decisions I need

1. **Does the kcal number stay the hero?** The hero card's comment says it "leads with
   the one figure people open the app for". Buddy-first demotes it by one card. I
   recommend buddy first, because after this work the buddy's line is the *actionable*
   thing and the number is one scroll-inch below — but this is the genuinely
   contentious call.
2. **Is silence acceptable?** I strongly recommend yes (§2.4). It is the single
   difference between a companion and Clippy. The cost is that a happy, consistent user
   often sees a buddy that says nothing.
3. **How far does the voice pass go?** Minimum is rewriting `sluggish`. Maximum is
   auditing every coach line in `buddyCoach` against §2.5. I recommend the full pass —
   it is copy-only, and it is where the care-vs-performance reframe actually lands.
