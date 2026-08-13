# Where every animation goes

## STATUS: all four batches BUILT (sw 298)

28 of the 30 strips now have a job. The two left are the `ghost` pair, deliberately: `sad` turned out
to be the warmer read for a paused account and shipping both would have been two answers to one
question. Everything in the tables below is live unless it says otherwise.

Two things found while building, both worth keeping in mind:

- **A one-shot reaction could get stuck forever.** The sprite is keyed on the animation NAME, so a
  reaction whose `animationend` is dropped (offscreen element, backgrounded tab) can never replay to
  fire a second one. It held a `nod` indefinitely after answering a question. There is now a watchdog
  timer, and the queue drain is idempotent so the event and the timer cannot consume two reactions
  between them.
- **The `coma` dead spot was real and is fixed** - `stuffed` now reads `dayState === 'full'` rather
  than the mood that was hiding it.


The point of this pass: the buddy currently has one facial expression and four moods. It owns 30
animations. Wiring them is not decoration, it is the difference between a sprite and a character
that appears to notice you.

Two rules run through all of it:

1. **An animation must mean something.** If it fires on a state the user cannot detect, it reads as
   random twitching and makes the buddy feel broken rather than alive. Every row below names the
   signal.
2. **Never animate a judgement.** `sad` on a lapse is empathy; `sad` because you went 80kcal over is
   a telling-off from a cartoon dinosaur. The app's whole voice is adherence-neutral and the
   animation layer has to hold that line too.

## The three channels

The intent layer (`Game.buddyAnim`) already separates these. Everything below slots into one.

- **REST** - plays continuously, one at a time, and IS the current state.
- **FLOURISH** - a one-shot every 7-15s that breaks the idle. Ambient. Never on a non-idle rest.
- **REACTION** - a one-shot fired by an event, outranks everything, returns to rest.

Plus one new channel this plan needs:

- **MICRO** - `blink`, every 3-6s, only while resting on `idle`. Too small to be a flourish and too
  frequent to share the slot; a separate, cheaper timer. This is the single highest
  life-per-line-of-code change on the list.

---

## REST - what the buddy is doing right now

| Animation | Signal | Status |
|---|---|---|
| `sleep` | 22:00-06:00, or the lapse nap | **LIVE** |
| `coma` | over calories today | LIVE, but see the dead spot below |
| `idle` | everything else | LIVE |
| `sad` | account paused, or a genuinely broken streak (not a bad day) | to build |
| `ghost/idle` | account paused for a long stretch - the buddy is not really here | optional, see below |

**The coma dead spot.** `coma` fires on `mood === 'stuffed'`, but `buddyMood` returns `'content'`
first when you are over calories AND hit protein, so a big protein-heavy day gets no animation at
all: `dayState` is `'full'` (which has no flourish) and the rest is `idle`. Drive `coma` off
`dayState === 'full'` instead of the mood. One line, closes a hole that exists today.

**On `ghost`.** We own two ghost strips and have never used them. A paused account is the only state
honest enough for it: the buddy is absent, not sad. Worth a look, but `sad` may be the warmer read
and I would not ship both.

## FLOURISH - ambient, while idling

| Animation | Signal | Status |
|---|---|---|
| `scan` | nothing logged yet - looking for food | LIVE |
| `move` | logged, day still open | LIVE |
| `cheer` | day closed | LIVE |
| `dash` | first day back after a lapse | LIVE |
| `yawn` | morning, and last night's sleep score was low | to build |
| `tilt` | the buddy has asked a yes/no question that is still unanswered | to build |
| `point` | the buddy's message carries an action button | to build |

`tilt` and `point` are the two that will make it feel like it is *talking to you* rather than
performing near you, because they respond to what is on screen a centimetre below the sprite.
Both need `BuddyHabitat` to pass the message kind down into `BuddyScene`, which it does not today.

## MICRO - the cheap life

| Animation | Signal |
|---|---|
| `blink` | every 3-6s while resting on `idle`, jittered so two buddies never blink in step |

Suppressed while asleep, stuffed, or mid-anything-else. Respects `prefers-reduced-motion` like the
rest.

## REACTION - answers to things you just did

| Animation | Fires on | Status |
|---|---|---|
| `eat` | a meal logged for today | **LIVE** |
| `cheer` | daily Amber minted | **LIVE** |
| `cheer` | trophy unlocked, growth-stage milestone, personal best, fight win | to build |
| `nod` | you answer Yes to the buddy's ask; check-in completed; weigh-in saved | to build |
| `shake` | you answer "Not now" / dismiss the ask | to build |
| `wave` | first open of the day; the moment after hatching | to build |
| `wake` | first open after the night window - it gets up as you arrive | to build |
| `carry` | returning from a foraging trip, bag full | to build |
| `talk` | while the buddy's line is being read - see below | to build |

**`talk` is the odd one out** and worth thinking about carefully. It is not really a reaction: it
should play *while the message box below the sprite is showing a fresh line the user has not
acknowledged*, then stop. Done well it turns the coach line into speech. Done badly the buddy flaps
its jaw permanently at a sentence you read ten minutes ago. Suggested rule: play `talk` for the
first ~3 seconds after a new message appears, then settle. It is a reaction with a duration rather
than a loop.

## FIGHT - two we already own and never use

| Animation | Where |
|---|---|
| `kick` | alternate with `bite` on strike, so combat is not one repeated frame |
| `avoid` | the dodge ability already exists in the fight engine and currently has no animation |

Cheapest wins on the whole list: the art is bought, the states already exist in `FightModal`.

---

## Build order

**Batch 1 - the ones with signals that already exist** (no new plumbing, mostly one-liners):
`coma` dead-spot fix, `blink` micro channel, `cheer` on trophy/milestone/PB/fight-win,
`kick` + `avoid` in the fight, `carry` on forage return.

**Batch 2 - conversational** (needs the message kind passed into `BuddyScene`, plus `buddyReact`
calls in the ask handlers): `tilt`, `point`, `nod`, `shake`, `talk`.

**Batch 3 - daily rhythm** (needs a `profile.lastOpenISO` / `lastWakeISO` marker so "first open
today" and "first open after the night" are answerable): `wave`, `wake`, `yawn`.

**Batch 4 - the heavier states** (needs care, this is where the tone risk lives): `sad`, and the
`ghost` question.

## What this leaves unused

`hurt`, `dead`, `jump`, `bite` stay fight-only. `egg/*` stays the hatch. Nothing else is spare -
after batches 1 to 3 every strip we own has a job except the ghost pair, which is deliberate.
