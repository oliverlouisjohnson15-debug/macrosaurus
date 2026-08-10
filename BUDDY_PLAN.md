# The buddy does the talking: one voice, at the top of Today

A recommendation, with the evidence behind it. Short version: **do it** — but the
overhaul is smaller than it sounds, because the thing being proposed is already built
and the app is currently working against it.

---

## 1. The problem, stated precisely

Today now nudges from two places with two different sets of rules.

| | `OneThingLine` (new) | `buddyCoach` protein branch (existing) |
|---|---|---|
| Fires when | any protein gap at all | gap ≥ 20g |
| Time gate | none, all day | `hour >= 14` |
| Dismissible | no | yes, `coach_protein`, snoozed 12h |
| Speaks as | the interface | the buddy |
| Position | top of the hero card | below the hero card |

At 09:00, 40g short, nothing logged, these produce: a bar reading **"40g protein to
go"** at the top of the page, and — separately, lower down — the buddy saying
**"Morning. Nothing logged yet, what did you have for breakfast?"**. Two voices, two
different asks, neither aware of the other. That is the overlap you spotted, and it is
worse than cosmetic: they disagree about *when a thing is worth saying*.

## 2. What already exists (this is what changes the answer)

The buddy is not a decoration with a mood. It is already a **message bus with a
documented priority ladder**, and the code says so in its own words at
`app/src/app.jsx:7547`:

> The buddy speaks with one voice in the habitat. buddyMessage picks the single top
> thing to say; here we wire each action string to a handler (the decision stays pure
> and testable in buddyMessage).

What is built:

- **`buddyMessage(db, today, streak)`** — a 7-rung ladder: paused goal → pending plan
  review → weigh-in ask → weekly recap → morning read → lesson → breakout ask →
  ambient coach.
- **`buddyCoach(db, today, streak)`** — rung 7, itself a ~10-rung ladder: streak-save →
  nothing logged → food quality → protein gap → training (5 kinds) → steps →
  engagement → warm streak line.
- **Etiquette machinery** — every ambient line carries a stable key, `nudgesDismissed`
  snoozes it for a per-line TTL, and snoozed lines *fall through to the next rung*
  rather than leaving a blank.
- **A rich render contract** — `BuddyHabitat` already supports a speaker header
  ("Rexy asks" / "Rexy's week" / "Rexy is teaching"), body text, an **inline weigh-in
  input**, a grid of one-tap choices, primary/secondary CTAs, and a dismiss ×.

So "push these things through *buddy says*" is not a new system. It is **routing to the
bus that already exists** and deleting the bypass I added.

### The dead code that proves the intent

`Game.buddyCraving` (`app/game.js:136`) computes exactly the "one open loop" semantic —
first unmet target in priority order, `firstmeal → protein → fibre → fuel`. It is
computed into `bp.craving` in `buddyProfile`, and `CRAVE_LABEL` translates it into
words at `app/src/app.jsx:5240`.

**Neither is rendered anywhere.** `grep` for `.craving` outside its own definition
returns nothing; `CRAVE_LABEL` has zero consumers. The feed loop was designed, built,
commented — and never surfaced. `Game.oneThing` is the same idea rebuilt six months
later with a distance attached, which is why the two collide so exactly.

## 3. Recommendation

**Yes to all three: move the buddy to the top, route the retention pushes through it,
and let it own the day's one open loop.** Specifically:

1. **The buddy leads Today**, directly under the page header, above the macro card.
2. **`OneThingLine` is deleted as a separate block.** The one open loop becomes a new
   rung on `buddyMessage`, rendered in the buddy's existing message slot.
3. **`buddyCoach`'s `coach_log` and `coach_protein` branches are absorbed by it**, so
   there is exactly one owner of "what should you do next about food today".
4. **The meter moves with it** — the pip bar attaches to the buddy's line, not the
   macro card, so the distance is part of what the buddy is saying.

### Why this is better than deduplicating in place

Three signals the app already computes get to line up on one object instead of three:

| Signal | Already exists | Becomes |
|---|---|---|
| `Game.buddyMood` → `peckish` / `thriving` / `stuffed` / `sluggish` | drives a mood word | **the buddy's face** — the loop's state, before you read anything |
| `Game.oneThing` → key + remaining | a separate bar | **the buddy's line** — the instruction |
| `oneThing.pct` | a separate bar | **the meter under the line** — the distance |

That is the mechanism Duolingo uses on its home widget, where Duo's expression shifts
as the day goes on and the lesson is still undone — the character *is* the progress
indicator, so the screen needs one object instead of a character plus a status bar.

## 4. The etiquette problem, which is the real risk

Promoting the buddy to first position makes every one of its habits load-bearing. The
failure mode is Clippy: an assistant whose defining problem was not being wrong but
being *always there*. Three rules, two of which need code:

1. **Silence must be possible.** Today `buddyCoach` always returns something — it falls
   through to `'Good start. Log as you go and I'll keep you on track.'` A block that
   always talks, at the top of the page, becomes wallpaper within a week. **Change:
   let the ladder return null and render the buddy quiet** — sprite, name, mood, no
   line, no CTA.
2. **One line, once.** The existing snooze keys already do this; the new rung needs its
   own key and TTL like every sibling.
3. **Never lead with guilt.** The buddy naps after a lapse (`buddyView`), and its first
   mood on a bad day is `sluggish`. At the bottom of the page that is a detail; at the
   top it is the first thing a returning user sees. The comeback path built last week
   already wakes it the same day — that becomes *required*, not a nicety, and the
   asleep sprite must never be the top-of-page default for someone who just came back.

## 5. What the ladder looks like after

The new rung slots at **7**, not higher. It must not outrank the weigh-in ask (only
honest before breakfast) or a pending plan review (a decision is waiting).

```
1  paused goal            → unchanged
2  pending plan review    → unchanged
2b weigh-in ask           → unchanged  (morning, cadence-aware)
2c weekly recap           → unchanged  (once a week)
3  morning read           → unchanged  (sleep/steps, before 14:00)
4  lesson                 → unchanged  (new users)
6  breakout ask           → unchanged  (overdue check-in)
7  ONE OPEN LOOP          → NEW: Game.oneThing, with the meter
7b remaining coach lines  → training, steps, density, engagement
   (coach_log + coach_protein deleted — rung 7 owns them)
8  nothing to say         → NEW: null, buddy renders quiet
```

## 6. Phasing

Each phase is shippable on its own and reversible.

- **Phase 1 — stop the double voice.** Add the `onething` rung, delete `OneThingLine`
  and the two absorbed `buddyCoach` branches. Today keeps its current block order.
  *This alone fixes what you flagged.*
- **Phase 2 — move the buddy up.** Swap the buddy above the macro card. Pure layout.
- **Phase 3 — silence and face.** Allow a null ladder result; drive the sprite from
  `buddyMood` so the face carries the loop state.
- **Phase 4 — retire the dead craving path.** Delete `buddyCraving`/`CRAVE_LABEL`, or
  re-point `buddyCraving` at `oneThing` so there is one definition of the open loop.

## 7. Decisions I need from you

1. **Does the kcal number stay the hero?** The hero card's own comment says it "leads
   with the one figure people open the app for". Putting the buddy above it demotes
   that figure to second. My recommendation: yes, buddy first — *because* its line is
   now the actionable one and the number is one scroll-inch below. But it is your
   call, and it is the one genuinely contentious part of this.
2. **How chatty at the top?** I recommend the buddy is silent whenever nothing is due,
   which will be most afternoons for a consistent user. The alternative — always a
   warm line — is friendlier on day one and invisible by day thirty.
3. **Does the meter belong to the buddy or stay on the macro card?** I recommend it
   moves, so the buddy's ask carries its own distance. The macro bars are unaffected
   either way.
