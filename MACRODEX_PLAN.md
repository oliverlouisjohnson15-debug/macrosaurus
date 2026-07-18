# Macrodex — The Game Freak Model

**Status:** design spec for the gamification USP
**Date:** 2026-07-18
**Owner:** Olly
**Premise:** design the buddy system the way Game Freak would if they built a nutrition
app — because they've effectively built this twice already (Pokémon GO, Pokémon Sleep),
so we can copy the real playbook instead of guessing.

> **The one rule that governs everything.** The creature is the emotional avatar of your
> consistency. Every point of growth, every battle resource, every leaderboard place must
> trace back to a behaviour the app already coaches — logging, hitting macros, weighing in.
> We never reward opening the app on a timer. That is the trap Pokémon Pocket falls into,
> and it is the wrong incentive for a health app.

---

## 1. Game Freak has already answered this — twice

We are not theorising. The Pokémon Company shipped a **fitness app** and a **sleep-health
app**, and both are buddy-and-collection loops wrapped around a real-world behaviour.

**Pokémon GO — the fitness one**
- **Buddy system:** choose a buddy, walk it, feed it, play with it, earn affection hearts
  toward Good → Great → Ultra → **Best Buddy**. Neglect makes it *less excited*, never kills it.
- **Adventure Sync:** real steps/distance tracked in the background feed weekly goals.
- **Eggs hatch by walking** 2/5/10 km — a reward gated by *real effort*, not a clock.
- **Field Research:** daily/weekly task stamps ("do X three times") → a reward.
- **Raids / friendship / gifts:** *co-op*, not just competition.

**Pokémon Sleep — the closest analog to us**
- You sleep → your data grows **Snorlax's "Drowsy Power"** → more Pokémon gather to be
  recorded in a **Sleep-Style Dex**. The healthy behaviour *directly* grows your buddy and
  fills your collection.
- You **cook curry and feed** helper Pokémon — a literal nutrition loop.
- Gentle by design: miss a night and nothing dies; research resets weekly.

**The DNA both share (this is the spec's backbone):**
1. The creature is a **companion / research subject, never a Tamagotchi that dies.** Lapses
   cost affection or progress, never guilt you into quitting. *This is the single most
   important rule for a nutrition app* — wellness products that punish churn hard.
2. **Effort is never wasted.** Every walk = candy, every night = drowsy power.
3. **Collection is the north star.** "Complete the dex" outlives any one streak.
4. **Variable reward wrapped around *real* effort** (eggs, encounters), not a slot machine.
5. **Short fresh cycles** — weekly research/leagues mean you are never permanently behind.
6. **Personality-driven nudges** — Gen 2's Pokégear literally *phones you*.

---

## 2. Why Gen 2 (Gold/Silver/Crystal) is the exact right template

Gen 2 introduced the mechanics that map onto eating almost 1:1. This is the era to mine.

| Gen 2 mechanic | Becomes, in Macrosaurus |
|---|---|
| **Friendship → evolution** (Golbat→Crobat; Eevee→Espeon by *day* / Umbreon by *night*) | Your buddy evolves by how well you've **cared for it = eaten**, not by grinding. The emotional core. |
| **Real day/night clock** | Breakfast/lunch/dinner windows; a morning weigh-in; a *day* vs *night* evolution branch based on *when* you consistently hit your macros. |
| **Held items** | Earned gear with passive perks (a protein shaker → +attack in battle). |
| **Breeding / eggs at the Day Care** | Combine two well-raised buddies into a rarer creature. |
| **Berries / apricorns** | The food you log *is* what you feed it (the Pokémon Sleep curry loop). |
| **Shiny + gender (both new in Gen 2)** | Variety and the chase. |

The **friendship-evolution** mechanic is the keystone: *eat well → bond rises → it evolves.*
Build the whole system around it.

---

## 3. The frame: you are a researcher, your buddy is the field

Cast the user as a **researcher documenting prehistoric creatures through how they eat**
(our Professor Oak = the existing coach voice). Logging a meal isn't data entry — it's
*feeding the specimen* and *recording an observation*. This reframing is what turns a chore
into a companion loop, and it costs nothing but copy.

### The connected loop

```
        log a meal  (=feed your buddy + record it)
                 │
                 ▼
   ┌──►  bond & mood rise, needs are met  ──►  it grows, then evolves (friendship gate)
   │             │                                        │
   │             ▼                                        ▼
   │      how you ate today shows                stronger, richer moveset in battle
   │      on its face + meters                          │
   │             │                                        ▼
   │             │                              beat rivals / weekly boss (raid)
   │             ▼                                        │
   └───  it wants feeding tomorrow  ◄────  new creatures, cosmetics, dex progress
             (gentle pull, never guilt)        + a weekly-league leaderboard place
```

Every arrow is a behaviour the coach already wants. The game is a skin over adherence.

---

## 4. The Buddy — a living individual, not a derived sprite

Today the "buddy" is *derived*: a stage sprite computed from streak, so everyone's level-30
is an identical Rexosaur. Promote it to a **first-class, persistent creature you hatch,
name, and raise** — the thing to *get to know*.

### 4.1 Identity
- **Species** from the Macrodex; **a name you give it** (ownership in one tap); **birthdate**
  (drives "42 days together" + anniversary beats); **a personality trait** (Plucky / Steady /
  Greedy / Gentle) that adds flavour and a tiny stat lean so two of the same species differ.

### 4.2 Bond / Friendship — the Tamagotchi core, done the Game Freak way
A 0–100 bond meter (banded into levels):
- **Rises** when you feed it well: logging, each macro hit, a perfect day, a weigh-in.
- **Drifts** gently on neglect — a missed day nudges it down, it *never* crashes to zero.
  (Consistent with the existing streak-freeze forgiveness.)
- **Unlocks at thresholds:** new dialogue, cosmetics, and a small **combat bond bonus** — a
  well-loved buddy fights harder, tying care directly to the fight.

### 4.3 Bond-gated evolution (the keystone, from Gen 2)
Evolution requires **level (cumulative quality days) AND bond** — not raw streak. Care you
can't fake by opening the app. And a **day/night branch**: a buddy that mostly hits its
macros in the morning evolves down one line; an evening eater down another. (Espeon/Umbreon
for dinner timing.)

### 4.4 Mood + needs — visible, topped up by logging (Pokémon Sleep's meters)
Computed from the last ~3 days, shown as expression + small meters:

| Need | Filled by | Reads as |
|---|---|---|
| **Hunger** | logging today | "fed today?" |
| **Nourishment** | macro balance (protein/fibre/cals) | "eating *well*?" |
| **Energy** | consistency / streak | "showing up?" |

Mood is the roll-up: **Thriving → Content → Peckish → Sluggish → Asleep**, driving the sprite's
expression and its one-line dialogue ("Peckish today — where's the protein?"). This is what
makes it feel alive and pulls you back tomorrow — *without* ever shaming you.

### 4.5 The feed loop (Pokémon Sleep's curry, our version)
The **food you log is what you feed it**. Protein and fibre are *nourishing ingredients* that
grow it faster; a balanced day is a "good meal" it visibly enjoys. Logging stops feeling like
accounting and starts feeling like care. This is the loop's beating heart.

### 4.6 Migration — nobody loses anything
Existing accounts get a buddy **seeded** from current streak/stage and `catch_log`: their
most-caught / highest-rarity creature becomes the starter species, birthdate back-dated to
first log, bond seeded from historical adherence. Purely additive to the `db` shape.

---

## 5. Collection — the Macrodex is the north star

Keep the deterministic catch system (the macros you hit decide the creature) as the spine —
it already teaches behaviour better than RNG packs ever could. Layer on Game Freak's
completion pull:
- **Dex completion** as the long-horizon goal that outlives any streak.
- **Monthly "sets"** — lean the existing migratory-monthly creatures into a rotating seasonal
  set, a concrete reason to return *this* month (GO's Community Days / seasons).
- **Shiny + evolution forms** as the chase.

---

## 6. Fight 2.0 — trickier, and your diet is the strategy

Today's battle is passive: stats come from the last 7 days and you watch the bars. Keep the
principle (*your eating is your build*), add **agency + strategy**, and make it a **raid**.

- **Types = macros.** Protein→attack, Carb→speed/initiative, Fat→defence/stamina,
  Fibre→recovery, Balanced→apex (no weakness). A simple matchup triangle gives bosses
  exploitable weaknesses.
- **A moveset** unlocked by evolution + bond; **one-tap agency each round** (pick a move /
  time a charge). A fight still resolves in ~30s, mobile-first.
- **The week is your loadout.** Each protein day → a *Power* charge; each fibre day → a *Heal*;
  a perfect day → a *Special*. A well-eaten week literally arms you better.
- **Boss = weekly raid with conditional weaknesses.** *"GRIMHORN's plates only crack for a
  buddy that hit fibre 4+ days this week."* Phases (enrage below 50%). Each week's boss is a
  targeted nudge toward a specific macro.
- **Losing teaches, never punishes.** A loss reports *which macro to shore up* ("defence low —
  more fibre this week"), turning the fight into a diagnostic that reinforces the coaching.
- **Keep** the ladder, prestige, one-attempt-per-logged-day gating, trophy drops. Balance
  lives in the pure, unit-tested `app/game.js` so it's tunable.

---

## 7. Leaderboards — a weekly league, not an all-time wall

Chosen scope: **global, opt-in, server-validated.** But framed as **Duolingo-style weekly
Leagues** rather than an all-time board — a fresh race every week demoralises far less and
feels more competitive, and it fits the "short fresh cycles" DNA.

- **Boards (several, so more people are "top" at something):** weekly **fight rating**
  (resets weekly), **streak**, **buddy bond/level**, **boss clears / prestige**.
- **Anti-cheat is the crux.** Client-derived stats are trivially spoofed. A **Supabase Edge
  Function (service role) recomputes** streak / level / bond from the user's real `user_state`
  on submit and **rejects client-claimed numbers**. Lower-stakes boards may launch
  client-reported but **clamped** and flagged honestly.
- **Schema:** `leaderboard_entries(user_id PK, display_name, opted_in, streak, buddy_level,
  bond, weekly_rating, boss_clears, prestige, updated_at)`. RLS: owner upserts only their own
  row; **public read only through a `leaderboard_public` view** exposing `display_name` +
  scores for opted-in rows — never email or `user_id`.
- **Privacy (UK-first, GDPR-aligned):** only display name + scores are public; opt-out deletes
  the row; slots into the app's existing export/delete tooling. Rate-limit upserts;
  profanity-filter and length-cap the display name.
- **Later, the higher-retention social move: co-op.** Gifting and small "parties" (Habitica's
  guild boss, GO's raids) add *accountability*, which retains better than pure competition.

---

## 8. Retention model — why each piece earns its place

| Lever | Who proves it | How it shows up here |
|---|---|---|
| One lovable avatar that embodies progress | Finch, Forest, Snorlax, Duo | Your named buddy, its face reflecting how you ate |
| Effort never wasted | GO candy, Sleep drowsy power | Every log feeds + records; catches persist |
| Loss aversion, *softened* | Duolingo streak + freezes | Streak + gentle bond drift, freeze forgiveness |
| Variable reward on real effort | GO eggs/encounters | Catches, eggs, shiny/perfect-day rolls |
| Short fresh cycles | Duolingo Leagues, GO research | Weekly league, weekly boss, weekly breakthrough |
| Personality nudges | Pokégear, Duo notifications | "Your buddy is peckish" — behaviour-triggered, never spammy |
| Gentle tone for health | Finch, Pokémon Sleep | Nothing dies; a lapse is an invitation, not a scolding |
| Co-op > competition for retention | Habitica parties, GO raids | Weekly league now, gifting/parties later |

The through-line, and the thing most fitness apps get wrong: **a companion you nurture, not
a chore that shames you.** Our sleeping/greyed-out buddy already nails that tone — build out
from it.

---

## 9. Data-model deltas (client `db` shape)

Everything additive and backfilled — no destructive migration. The deterministic catch system
stays the collection spine.

| Key | Shape | Notes |
|---|---|---|
| `buddy` | `{ speciesId, name, birthdate, personality, bondXp, level, mood, dayNightLine, cosmetics[], moveIds[] }` | promoted from derived stage; migrated from streak/`catch_log` |
| `fight` (extend) | `+ rating, loadoutCache, bossProgress` | keep `rank/prestige/wins/trophies` |
| `leaderboard` | `{ optedIn, displayName, lastSyncedAt }` | client mirror; **server is source of truth** |
| `settings.leaderboardOptIn` | bool | drives the opt-in UI |

Existing keys (`catch_log`, `game_awards`, `items`, `badges`, `eggs`, `breakthrough`,
`expenditure`, `dex_boost`) are untouched. Game logic (bond curves, mood roll-up, fight
resolution, leaderboard scoring) lives in a **pure, unit-tested `app/game.js`** mirroring
`app/engine.js`, so it's testable and can be reused server-side for anti-cheat.

---

## 10. Phasing (each ships independently; the app stays shippable throughout)

- **Phase 0 — Sprites & foundations. ✅ *(shipped this session)*** Auto light/shade every sprite
  at render time (volume from a top-left light, off the same art); give the four
  template-sharing creatures their own silhouettes. **Next in 0:** promote `buddy` to a
  persistent named entity + migration.
- **Phase 1 — The Bond.** Hatch/name flow, bond + mood + needs meters, the feed loop, buddy
  dialogue, bond-gated evolution (with day/night branch). This is the USP made real.
- **Phase 2 — Fight 2.0.** Types, moveset, one-tap agency, macro loadout, boss
  weaknesses/phases, fight-as-diagnostic. Balance in `app/game.js` with tests.
- **Phase 3 — Collection depth.** Monthly sets, biome-completion rewards, cosmetics earned by
  bond/fights, breeding/eggs.
- **Phase 4 — Weekly League.** Supabase table + view + RLS + edge-function recompute; opt-in
  UI; the boards; anti-cheat + privacy.
- **Phase 5 — Social & polish.** Gifting/parties (co-op accountability), behaviour-triggered
  nudges, shareable buddy/rank cards.

---

## 11. Where the code lives

- **`app/src/app.jsx`** — all UI (buddy screen, fight, dex, league). Sprite auto-shading +
  the four new templates already landed here.
- **New `app/game.js`** — pure, unit-tested module for bond/mood/fight/loadout/score maths.
- **Supabase** — one migration (`leaderboard_entries` + `leaderboard_public` view + RLS) and
  one edge function (validated score recompute).
- **Build** — after `app/src/*` changes, rebuild the root `index.html` bundle (`node build.mjs`)
  and commit it. Zero-build stays intact; sprites remain code, no assets, no IP risk.

---

## 12. Honest risks

- **Fight balance can swing trivial or frustrating** once there's agency. Keep all combat maths
  in `app/game.js` with tests; playtest and tune.
- **Leaderboard trust needs the edge function** — without server recompute the board is
  cosmetic. Budget for it.
- **Bond curve tuning** — too fast and evolution feels cheap; too slow and it feels grindy.
  Tune against real adherence data, gently.
- **Scope is multi-week.** The phasing keeps every phase a shippable increment, not a big bang.
- **Tone discipline.** The moment a mechanic *punishes* (a dead buddy, a shaming nudge), it
  works against the health goal. Hold the "companion, not chore" line in every copy string.

---

## 13. Immediate next step

Phase 1 is the USP. The first build is **promote the buddy to a named, persistent individual
with a bond meter and mood** — hatch-and-name flow, the three need meters wired to logging,
and the feed loop copy. Everything else (bond-gated evolution, Fight 2.0, the league) hangs off
that entity existing. Say the word and I'll spec the `buddy` entity + migration in detail and
start building it.
