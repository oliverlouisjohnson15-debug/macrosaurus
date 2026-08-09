# Training v2: gym profiles, a bigger library, and a real logging screen

Status: **plan, awaiting approval.** Nothing below is built except the tab swap.
Companion: `WORKOUTS_PLAN.md` (the original plan and competitor read).

---

## 0. Done already

Train and Cook swapped: the bar is now **Today · Food · (+) · Cook · Train**, in both the mobile
bar and the desktop sidebar.

---

## 1. The "free session" problem (and it is worse than one label)

You are on Premium and the app keeps saying "free". Three separate causes:

| Where | Says | Problem | Fix |
|---|---|---|---|
| Train home | "Free session" | Reads as a tier, means "no plan" | Rename **"Empty session"** |
| Session header | "Free session" | Same | Rename **"Empty session"** |
| Train home footer | "Logging is free and always will be..." | Pricing copy shown to subscribers | Only render for non-Premium |

"Empty session" is the phrase the category has settled on and it says exactly what it is. Cheap fix,
do it first.

---

## 2. Gym profiles, replacing the equipment checkbox grid

Today the block wizard asks you to tick nine equipment boxes. Nobody thinks about their gym that
way. They think "my gym" or "the hotel one".

### Recommendation: named gym profiles, and you pick one when a session starts

Presets, each expanding to equipment plus a **selection bias**, not just availability:

| Profile | Kit | How it programmes |
|---|---|---|
| **Commercial gym** | Everything | Leans on machines and cables where they beat free weights for a target muscle. Stable, easy to load, easy to take near failure alone, which is the current evidence-based preference for hypertrophy work |
| **Bodybuilding gym** | Everything plus specialist plate-loaded kit | As above, but reaches for the specialist machines first (pendulum, hack, seated leg curl) |
| **Home gym** | Dumbbells, bench, pull-up bar, bands | Leans on lengthened-position dumbbell work, because that is what you can load and fail safely on your own. Asks two follow-ups that change everything: **adjustable bench?** and **pull-up bar?** |
| **Minimal / hotel** | Light dumbbells, bodyweight | High-rep and unilateral bias, since load is the constraint |
| **CrossFit box** | Barbell, kettlebells, rig, plyo box, rower/bike | See the honest caveat below |
| **Custom** | The current checkbox grid | Kept, for anyone who wants it |

**Two things this unlocks that the checkbox grid cannot:**

1. **More than one gym.** Save "My gym" and "Parents' house". When you start a session you pick
   where you are, and anything unavailable is offered as a swap on the spot. This is the single
   most-praised thing about Gravl in reviews, and we already have the substitution engine
   (`Training.adoptTemplate`) that makes it work.
2. **Better default exercise choice**, because the profile carries a preference, not just a filter.

### Honest caveat: CrossFit is not real yet

I audited the library. It holds **157 movements**, of which **one is a kettlebell exercise** and
**one is a trap bar exercise**. There are no olympic lifts, no gymnastics, no conditioning
movements. A "CrossFit box" preset today would produce a bodybuilding session with a kettlebell
swing in it, which is worse than not offering it.

So: **either** CrossFit ships alongside the library work in §3, **or** it waits. I would not ship
the label without the movements behind it.

---

## 3. The exercise library: 157 to about 320

The library is the thing everything else stands on, and it is currently too thin to build from.
For comparison, the apps you named carry three to four hundred.

I also found real holes by running the coverage audit against each equipment filter:

- **Bodyweight only** has no primary exercise for **front delts, side delts, rear delts or calves.**
  So a "no kit at all" user cannot be given a complete programme today.
- **Dumbbell only** has none for **lower back or abs.**
- **Kettlebell**: one movement. **Trap bar**: one.

### Priority order

1. **Close the holes above** (pike and handstand press-ups, bodyweight calf raises, dumbbell
   back extensions and weighted ab work). This is not nice-to-have: it is the difference between
   the home-gym profile working and not.
2. **Kettlebells properly** (~12): swings, goblet work, clean, press, snatch, get-up, front-rack squat.
3. **Conditioning and olympic** (~25), if CrossFit ships: clean, power clean, snatch, thruster,
   wall ball, box jump, burpee, muscle-up, double-under, assault bike, ski erg.
   **These carry a `conditioning` flag and stay OUT of the volume maths**, exactly as cardio does.
   Counting a thruster as chest volume would quietly corrupt every audit.
4. **Machine and cable variants** people actually meet (~40): plate-loaded rows, converging presses,
   Smith variants, more cable angles.
5. **Unilateral and stability options** (~20), which the substitution engine needs to give good
   home-gym swaps.

### The bit competitors have and we do not: knowing how to do it

Hevy, 4WRD and Gravl all ship exercise **video**. We cannot, and buying it is out of scope.

**Recommendation:** ship something better suited to us instead. Every exercise gets two lines:
a **setup and execution cue**, and **why it is in your plan** (which muscle, which part of the
strength curve it loads). We already store the resistance profile for every movement, so "this one
is hardest in the stretch, which is where a hamstring responds best" is a fact we hold and nobody
else surfaces. That is on-brand for a science-led app in a way that a stock video is not.

---

## 4. The logging screen: a genuine overhaul

This is the main event and you are right that it is not good enough. What is wrong:

- Every exercise is expanded at once, so a six-movement session is an enormous scroll with no sense
  of where you are.
- No set types. Warm-ups, drop sets and sets to failure all count identically, which makes the
  volume maths less honest than it claims to be.
- No supersets.
- The rest timer is one shared timer, does not notify, and dies when the screen locks.
- No plate calculator, no reordering, no per-exercise notes.

### Recommended shape: focused card with a jump strip

**One exercise fills the screen.** Above it, a compact strip of chips, one per movement, showing
done / current / to-do, tappable to jump anywhere. Below the set table, a persistent "next up" line.

Why this over the alternatives:
- **vs the current long list**: no scroll hunting, no lost place, and the set table finally has room
  to breathe at 375px.
- **vs Hevy's continuous list**: Hevy's works because their rows are dense and their users are
  logging, not following a plan. We are a *plan* app, and a plan has an order. Gravl, which is also
  plan-led, went the same way and reviewers single out that "sessions flow logically" rather than
  being "a scattered list".
- The jump strip is the safety valve: you can still work out of order when the rack is taken, which
  is the objection to any forced-sequence design.

### Everything the screen gains

| Feature | Why | Notes |
|---|---|---|
| **Set types**: normal, warm-up, drop, failure, AMRAP | Honest volume maths | Tap the set number to change it. Warm-ups already excluded from volume; drop and failure sets get recorded and shown in history |
| **Supersets** | Most real programmes have them | Group two or more movements; the timer holds until the round is done, then auto-advances |
| **Plate calculator** | Removes the mental arithmetic under a loaded bar | Inline per barbell exercise, honours your available plates |
| **Reorder and swap** | The rack is taken | Swap already exists; reorder is new |
| **Per-exercise notes** | "Pin 4, seat 2" is the note people actually want | Persists to the next session |
| **Warm-up suggestions** | For compounds, from your working weight | Deterministic, from the engine |
| **Auto-advance** | Finish the last set, go to the next movement | With an undo, never silently |

### The rest timer, properly

- **Per exercise**, defaulting to the block's prescription, editable inline with **-15 / +15**.
- **Starts automatically** when you tick a working set. **Does not start** after a drop set, or
  mid-superset, because the point of both is to keep going.
- **A bottom bar with a countdown ring**, not a card that shoves the list around.
- **Survives the screen locking.** It already stores an end timestamp so the count is right when you
  come back; what is missing is the alert. Plan: a service-worker notification scheduled when the
  page hides, plus sound and vibration while it is visible.
  **Caveat worth stating up front:** background notification timing in an installed PWA is reliable
  on Android and unreliable on iOS. On iOS the count will always be correct on return, but the
  buzz may not fire on time. That is a platform limit, not something I can engineer around.

---

## 5. Grounding it in the science, visibly

The engine already encodes the volume-landmark framework, fractional set counting, RIR-led effort
and double progression. None of that is visible, so the app looks like it is guessing.

Recommendation, in order of value:

1. **Say why, at the point of the decision.** The gap card already says "side delts are short".
   Add the one line that follows: what that costs, and why the suggested movement fixes it.
2. **Surface the resistance profile** on every exercise, in plain words.
3. **One "how this app programmes" screen** in Training settings: the volume bands and where they
   come from, why effort is prescribed in RIR, why the fourth week is lighter.
4. **Cite the principles, not the people.** The evidence base is genuinely shared across the coaches
   you named, and naming individuals in-product reads as an endorsement we have not been given.
   The house copy rules already say no named competitors; same logic applies here.

---

## 6. Suggested order

1. "Empty session" rename plus the Premium copy fix. Minutes.
2. Library expansion, holes first. Nothing else is trustworthy until this is done.
3. Gym profiles, on top of the fuller library.
4. Logging screen overhaul plus the rest timer.
5. Science surfacing.
6. CrossFit, only if you want it, and only with §3.3 shipped.

Open question for you: **CrossFit in or out?** It is roughly a third of the library work and it
pulls the app toward a different sport. Bodybuilding, home and minimal are the profiles your
existing engine actually serves well today.
