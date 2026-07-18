# Macrodex 2.0 — Living Buddy, Deeper Fight, Leaderboards

**Status:** design draft for review
**Date:** 2026-07-18
**Owner:** Olly
**Scope:** overhaul the gamification layer from a collect-'em-all dex into a connected
*raise → battle → rank* loop, without breaking the core rule that every reward is
**earned by real behaviour** (logging, hitting macros, weighing in) — never by a timer.

---

## 0. Why this, and the one rule

Macrosaurus already has far more of a game in it than "dinosaur gamification" suggests.
Today's system (in `app/src/app.jsx`) already does:

- **Deterministic daily catches** — *the macros you hit decide which creature you get*
  (`creatureForDay`, `CREATURES`, biomes mapped to macros).
- **Buddy that evolves by streak** and **falls asleep when you lapse** (`BuddyCard`,
  `BUDDY_STAGES`) — proto-Tamagotchi neglect already exists.
- **Macros → combat stats** — `buddyStats()` turns your last 7 days into
  **protein → attack, fibre → defence, consistency → HP**.
- **A real fight** — 10-rung ladder + rotating weekly boss + prestige + trophy drops
  (`FIGHT_LADDER`, `FIGHT_BOSSES`, `FightModal`).

So this is **not a rebuild.** It's *deepen + connect + revamp the art + add a social spine.*

**The one rule that governs every decision below:**

> The creature is the emotional avatar of your consistency. Every point of growth, every
> combat resource, every leaderboard place must trace back to a behaviour the app already
> coaches. We never reward opening the app on a timer — that's the trap Pokémon Pocket
> falls into, and it's the wrong incentive for a health app.

### The connected loop

```
        log food + hit macros
                 │
                 ▼
   ┌──►  your Buddy grows & bonds  ──►  stronger, richer moveset
   │             │                              │
   │             ▼                              ▼
   │      mood/needs reflect              win fights & bosses
   │      how you ate                          │
   │             │                              ▼
   │             │                     climb ladder + leaderboard
   │             ▼                              │
   └───  care loop pulls you back  ◄────  cosmetics / new creatures
             tomorrow                     deepen the collection
```

Each arrow is a behaviour the coach wants anyway. The game is a skin over adherence.

---

## 1. The Buddy — from derived sprite to a living individual

Today the "buddy" is a *derived* thing: a stage sprite computed from streak. Everyone's
level-30 buddy is an identical Rexosaur. That's the biggest missed opportunity — there's
nothing to *get to know*.

**Promote the buddy to a first-class, persistent entity you hatch, name, and raise.**

### 1.1 Identity
- **Species** — drawn from the Macrodex (the creature you bond with becomes your buddy).
- **Name** — you name it at hatch. This alone creates ownership.
- **Birthdate** — the day you started raising it; drives "X days together" and anniversary beats.
- **Personality trait** — one of a small set (e.g. *Plucky, Steady, Greedy, Gentle*). Pure
  flavour + a tiny stat lean (Plucky +atk, Steady +def…) so two buddies of the same species
  still differ.

### 1.2 Bond / Friendship (the Tamagotchi core)
A 0–100 (banded into levels) **bond meter**, the heart of "get to know your dinosaur":
- **Rises** when you feed it well: +logging today, +each macro hit, +a perfect day, +weigh-in.
- **Drifts down slowly** on neglect (a missed day nudges it, it never crashes to zero —
  guilt, not punishment; consistent with the existing streak-freeze forgiveness).
- **Unlocks at thresholds**: new dialogue lines, cosmetics, and a small **combat bond bonus**
  (a well-loved buddy fights harder — ties care directly to the fight).

### 1.3 Mood + needs (visible, top-up-by-logging)
Computed from **recent** eating (last ~3 days), shown as expression + small meters:

| Need | Filled by | Reads as |
|---|---|---|
| **Hunger** | logging today | "fed today?" |
| **Nourishment** | macro balance (protein/fibre/cals) | "eating *well*?" |
| **Energy** | consistency / streak | "showing up?" |

Mood is the roll-up: **Thriving → Content → Peckish → Sluggish → Asleep**. The sprite's
expression frame + idle animation change with mood, and its one-liner dialogue reflects it
("Peckish today — where's the protein?"). This is what makes it feel *alive* and what pulls
you back tomorrow.

### 1.4 Growth vs evolution
- **Level (growth)** — from *cumulative quality days*, not raw streak. This is care you can't
  fake by just opening the app.
- **Evolution** — gates on **level AND bond**, so evolving feels *earned by nurture*, not by
  the calendar. (Today it's streak-only; this is a meaningful upgrade.)

### 1.5 Migration (no user loses anything)
Existing accounts get a buddy **seeded** from their current streak/stage and `catch_log`:
pick their most-caught / highest-rarity creature as the starter species, back-date birthdate
to first log, set bond from historical adherence. Purely additive to the `db` shape.

---

## 2. Sprites — the Pokémon-Red revamp

### 2.1 Why they look samey today (and it's fixable)
Every creature reuses a **shared 12×12 template, recoloured**. `Nugg`/`Dinky`/`Pebble` all
render the `hatch` grid; many reuse `saur`. The palette helper `crC(B, S)` only takes **two**
colours (body + shadow) with a fixed outline/eye. Pokémon Red sprites were ~56×56 with
**unique silhouettes** and a **3–4 shade ramp**. We can hit that vibe in the *same* code-based
pixel system — no image assets, no dependencies, no IP risk, still renders through `Sprite`'s
SVG path.

### 2.2 Engine upgrade (backward-compatible)
1. **Palette ramp.** Extend the palette from body+shadow to a full ramp:
   `outline · deep-shadow · base · light · highlight` + `accent · eye · teeth`. Keep `crC(B,S)`
   working (auto-derive a default ramp) so **existing art keeps rendering** while new art opts
   into the richer palette via a new `crRamp({...})` helper.
2. **Bigger canvas.** Support larger grids (target **~24×24** for featured/buddy/battle views).
   `Sprite` already reads `art` as arrays of equal-width strings and scales by `px` — it just
   needs to stop assuming 12 wide. Grid **thumbnails** render the same art at a smaller `px`.
3. **Unique art per species.** Replace the shared-template approach: each species gets its own
   grid, with base + 2 evolution sprites.
4. **Expression frames.** A couple of variant rows per buddy/battle sprite (blink, happy, hurt)
   so the mood system in §1.3 has something to show.
5. **Shiny** stays — it's already a palette swap (`crShiny`); it becomes a ramp swap.

### 2.3 Roster scale ("a lot more")
Target **~30–40 species across the 7 biomes**, each with 2 evolutions (~90–120 sprite states).
This is real hand-authoring — **phased, and never a blocker**: features ship on a starter set
and the roster fills in behind them.

### 2.4 Approval flow (do this before batch-authoring)
I mock up the **style** in an Artifact first — a few unique, detailed sprites in the upgraded
engine vs the current ones — so you sign off on **canvas size + shade ramp + silhouette
detail** before I grind out the full set. Locking the style once saves re-doing dozens later.

---

## 3. Fight 2.0 — trickier, and your diet is the strategy

Today's battle is passive: stats come from the last 7 days and you watch the bars. Keep the
principle (*your eating is your build*) and add **agency + strategy** on top.

### 3.1 Types (macros become a type triangle)
| Type | Macro | Combat identity |
|---|---|---|
| **Protein** | protein hits | attack |
| **Carb** | carb/energy | speed / initiative |
| **Fat** | healthy fats | defence / stamina |
| **Fibre** | fibre | recovery |
| **Balanced** | perfect days | apex, no weakness |

A simple matchup triangle gives bosses exploitable weaknesses (see §3.4).

### 3.2 A moveset (unlocked by evolution + bond)
Each buddy carries a small set of moves, gained as it evolves and bonds. In battle you get
**one-tap agency each round** (pick a move / time a charge) — fast, mobile-first, a fight still
resolves in under ~30s. This turns "watch the bars" into "make a call".

### 3.3 Macro-fuelled loadout (the week is your kit)
Your **week's eating** becomes your combat resources:
- each **protein day** → a *Power* charge (big hit)
- each **fibre day** → a *Heal*
- a **perfect day** → a *Special*

So a well-eaten week literally arms you better. This is the tightest possible tie between the
tracker and the game.

### 3.4 Boss mechanics (push a specific behaviour each week)
The rotating weekly boss gets **conditional weaknesses + phases**:
- *"GRIMHORN's plates only crack for a buddy that hit fibre 4+ days this week."*
- enrage phase below 50% HP.

This makes each week's boss a **targeted nudge** toward whatever macro the boss demands.

### 3.5 Fight-as-diagnostic (losing teaches)
A loss isn't punitive — it tells you **which macro to shore up**: *"Your defence was low —
more fibre this week."* The battle becomes a readout of your eating, reinforcing the app's
adaptive-coaching story instead of sitting beside it.

### 3.6 Keep what works
Ladder, prestige, weekly boss cadence, one-attempt-per-logged-day gating, and trophy/item
drops all stay. Balance lives in a **pure, unit-tested module** (see §6) so it's tunable.

---

## 4. Leaderboards — global, opt-in, server-validated

Chosen scope: **public global boards, opt-in, with a chosen display name and server-validated
stats.** This is the one piece with real backend + trust cost, so it's designed carefully and
sequenced last.

### 4.1 What ranks (several boards so more people are "top" at something)
- **Streak** (headline)
- **Buddy level / bond**
- **Boss clears / prestige**
- **Weekly fight rating** (resets weekly — a fresh race every week is strong retention)

### 4.2 Anti-cheat is the crux
Client-derived stats are trivially spoofable, so a naive board is decorative at best. The
credible design:
- The server already holds each user's real data in Supabase `user_state` (under RLS).
- A **Supabase Edge Function / Postgres function (service role)** *recomputes* streak / level /
  bond from that stored state on submit and **rejects client-claimed numbers**. The client
  never gets to assert its own score for the headline boards.
- Lower-stakes boards may launch client-reported but **clamped** to plausible ranges and
  flagged as such. Document the tradeoff honestly rather than pretend they're tamper-proof.

### 4.3 Schema (additive, RLS-first)
```
leaderboard_entries
  user_id       uuid  primary key references auth.users
  display_name  text  (opt-in, profanity-filtered, NOT the email)
  opted_in      bool
  streak            int
  buddy_level       int
  bond              int
  boss_clears       int
  prestige          int
  weekly_rating     int
  updated_at    timestamptz
```
RLS:
- owner may `upsert` only **their own** row;
- **public read** exposed *only* through a `leaderboard_public` **view** that selects
  `display_name` + score columns for `opted_in = true` rows — **never** email or `user_id`.

### 4.4 Privacy (UK-first, GDPR-aligned)
Only `display_name` + scores are ever public. Opt-out **deletes the row**. This slots into the
app's existing export/delete tooling and privacy posture. Rate-limit upserts; profanity-filter
and length-cap `display_name`.

---

## 5. Data-model deltas (client `db` shape)

Everything is **additive and backfilled** — no destructive migration. The deterministic catch
system stays the collection spine.

| Key | Shape | Notes |
|---|---|---|
| `buddy` | `{ speciesId, name, birthdate, personality, bondXp, level, mood, cosmetics[], moveIds[] }` | promoted from derived stage; migrated from streak/`catch_log` |
| `fight` (extend) | `+ rating, loadoutCache, bossProgress` | keep `rank/prestige/wins/trophies` |
| `leaderboard` | `{ optedIn, displayName, lastSyncedAt }` | client mirror; **server is source of truth** |
| `settings.leaderboardOptIn` | bool | drives the opt-in UI |

Existing keys (`catch_log`, `game_awards`, `items`, `badges`, `eggs`, `breakthrough`,
`expenditure`, `dex_boost`) are untouched.

---

## 6. Where the code goes

- **`app/src/app.jsx`** — UI (buddy screen, fight UI, dex, leaderboard). Already the single
  source for all UI.
- **New `app/game.js`** — a **pure, unit-tested** module (mirroring the existing `app/engine.js`
  pattern) for bond maths, mood roll-up, fight resolution, loadout derivation, and leaderboard
  score computation. Keeping this pure means fight balance and bond curves are testable via
  `node app/*.test.cjs` and identical client/server-side (§4.2 reuse).
- **Supabase** — one migration for `leaderboard_entries` + `leaderboard_public` view + RLS;
  one edge function for validated score recompute.
- **Build** — after `app/src/*` changes, rebuild the root `index.html` bundle (Tailwind + JSX
  transpile + inline vendors) per the README, and commit it.

---

## 7. Phasing (each phase ships independently; the app stays shippable throughout)

- **Phase 0 — Foundations & style sign-off.** Sprite-engine upgrade (ramp palette + larger
  canvas, backward-compatible) + **style mockup Artifact** for approval. Promote `buddy` to a
  persistent entity with migration. No behaviour change beyond nicer sprites.
- **Phase 1 — The Bond (Tamagotchi).** Hatch/name flow, bond + mood + needs, buddy dialogue,
  care loop wired to logging. Revamp the **starter species** sprites (base + evolutions).
- **Phase 2 — Fight 2.0.** Types, moveset, one-tap agency, macro loadout, boss
  weaknesses/phases, fight-as-diagnostic. Author battle sprites + expression frames. Rebalance
  in `app/game.js` with tests.
- **Phase 3 — Collection depth.** Fill out the expanded roster ("a lot more"), biome-completion
  rewards, cosmetics earned by bond/fights.
- **Phase 4 — Leaderboards.** Supabase table + view + RLS + edge-function recompute; opt-in UI;
  the boards; anti-cheat + privacy.
- **Phase 5 — Retention wiring & polish.** Behaviour-triggered nudges ("your buddy is peckish"),
  seasonal sets, shareable buddy/rank cards.

---

## 8. Honest risks & callouts

- **Art volume is the long pole.** ~30–40 unique species × 3 stages is weeks of hand-pixel work.
  Mitigation: phasing + never blocking a feature on a complete roster; lock the style once (§2.4).
- **Fight balance can swing to trivial or frustrating** once there's agency. Mitigation: keep all
  combat maths in the pure `app/game.js` module with unit tests; playtest and tune.
- **Leaderboard trust needs the edge function** — without server recompute the board is cosmetic.
  Budget for it; don't ship a spoofable headline board and call it competitive.
- **Scope is multi-week.** The phasing is deliberate so every phase is a shippable increment, not
  a big-bang release.
- **Single large file + built bundle.** All UI lands in `app/src/app.jsx`; game logic in the new
  pure module; rebuild `index.html` each change. No framework migration — stay zero-build.

---

## 9. Retention rationale (why this ties into the *wider* app)

- The buddy is the **face of your consistency data** — it makes an abstract number (protein
  adherence) concrete and emotional, which is exactly what drives daily return.
- Every mechanic points back to behaviours the app already coaches: log daily
  (hunger/streak), protein (attack/bond), fibre (defence), balance (evolution/apex). **The game
  never rewards anything the coach wouldn't.**
- The fight doubles as a **diagnostic** of your eating, reinforcing the adaptive-coaching
  narrative rather than sitting beside it.
- Leaderboards add the one lever single-player can't: **social identity + a weekly race**, opt-in
  so it never compromises the privacy-first posture.

---

## 10. Immediate next step

Phase 0's first deliverable is the **sprite style mockup** — a small Artifact showing the
upgraded engine (24×24, full ramp, unique silhouettes) against today's sprites — so the visual
direction is locked before any roster work begins. On approval, proceed to the `buddy` entity +
migration.
