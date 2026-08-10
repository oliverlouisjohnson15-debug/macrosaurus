# Retention principles — where Macrosaurus already stands, and what to build

Seven retention principles, scored against the code as it is today. This is a gap
analysis first and a build plan second, because the honest finding is that **four of
the seven are already half-built**, one is **actively contradicted by the Today
screen**, and two need **backend work and a privacy decision** before a line of UI
gets written.

Nothing here is a rewrite. The app already has the hard part: a pure, unit-tested
gamification module (`app/game.js`) with streaks, freezes, a bond meter, evolution,
a spendable currency and a dex. Most of this plan is wiring moments that already
exist to the surfaces that need them.

---

## Scoreboard

| # | Principle | State today | Lift |
|---|---|---|---|
| 1 | Never show a new user a zero | Partly built (egg + checklist) | Small |
| 2 | Make winning feel possible | **Missing entirely** | Large (backend) |
| 3 | Make progress shared | **Missing** (referral graph only) | Large (backend) |
| 4 | Always leave one thing unfinished | **Contradicted** | Medium (design) |
| 5 | Reward the comeback | Built but invisible | Small |
| 6 | Something worth keeping | Built, fires once | Small |
| 7 | Reward getting better | Done in Train, missing in food | Medium |

---

## 1. Never show a new user a zero

**Already there.** A new account picks an egg before it sees a dashboard
(`app/src/app.jsx:14203`), gets a getting-started checklist (`OnboardingChecklist`,
`app/src/app.jsx:12285`), and the egg hatches into a named buddy the moment the four
staples are done (`hatchTasks`, `app/src/app.jsx:7288`). Early accounts also get the
`early_adopter` "Founding Saur" trophy on day one (`app/src/app.jsx:5497`). That is
already better than most apps.

**The zeros that survive.** On first open the user still sees: streak `0`, Amber
balance `0` (`amber_ledger` is `[]`), an empty Macrodex, an empty trophy cabinet
apart from Founding Saur, `records.longestStreak: 0`, and a checklist reading `0/3`.
The egg is a *promise*, not a reward — it is a zero with better art.

**Build.**

- **Welcome stake.** Mint Amber at account creation, idempotent by ledger id
  `amber:welcome`, exactly mirroring the existing `amber:log:<date>` grant at
  `app/src/app.jsx:7245`. The ledger is append-only and merge-safe, so this can never
  double-pay across devices. Add `AMBER_REWARDS.welcome` to `app/game.js:517`.
- **Never an empty dex.** Seed the starter creature (`nugg`, the egg,
  `app/src/app.jsx:4962`) into the dex at signup so the Macrodex opens with one
  resident and a visible "1 of N found" rather than a blank grid.
- **Start the checklist above zero.** Add a pre-ticked `account` row —
  "Created your account ✓" — so the card opens at `1/4`, not `0/3`. This is the
  principle's literal instruction and costs four lines in `OnboardingChecklist`.
- **Day one is a streak of one.** `computeStreak` correctly returns `0` before the
  first log. The *display* should read `Day 1` from the moment a profile exists; the
  underlying number stays honest for every calculation that depends on it.

**Tests:** extend `tests/game.test.js` for the new reward key; `tests/store.test.js`
for the seeded dex surviving a merge.

---

## 2. Make winning feel possible

**Nothing exists.** There is no leaderboard, no league, no cohort — `grep` for
either term returns nothing. The nearest thing is the solo Fight ladder
(`db.fight.rank`, `prestige`) which is a ladder against the game, not against people.

This is the principle that cannot be faked client-side, and the one that needs a
product decision before it needs code.

**The privacy constraint, stated up front.** Macrosaurus holds weight, body fat,
intake and sleep. A leaderboard must never expose any of it. The only thing that may
cross the user boundary is a **derived weekly points score** and a **display name the
user chooses** — and the whole feature must be **opt-in**, off by default. The inputs
for that score already exist and are already computed weekly:
logged days, protein-target days and perfect days (`Game.weeklyLoadout`,
`app/game.js:143`; `Game.weeklyRecap`, `app/game.js:705`).

**Build.**

- **Migration** — `leagues` (id, week_key, tier) and `league_members` (league_id,
  user_id, display_name, points, updated_at). RLS: a member may read only rows whose
  `league_id` matches one of their own memberships; nobody may write `points`
  directly.
- **Edge function** `league` (cron, weekly, alongside the existing `push-nudge` cron
  at `supabase/migrations/20260720174224_push_nudge_cron.sql`) — buckets opted-in
  active users into cohorts of **20–30** by recent activity level, so a new user
  lands with other new users. This is the whole point of the principle: cohorting by
  activity is what makes the top of the table reachable.
- **Score writer** — a `SECURITY DEFINER` RPC the client calls with nothing; the
  function recomputes that user's week from server-side state. The client never
  supplies its own score.
- **Client** — a league table in the Play hub, showing rank, display name and points
  only. Promotion/relegation is optional and can wait for v2.

**Cheaper interim, if the backend is deferred.** Rank the user against **their own
last eight weeks** — "your best week in two months" — using `weeklyRecap` alone, no
backend, no privacy surface. It is not the principle, but it delivers the feeling
(a reachable target) while the real thing is built.

---

## 3. Make progress shared

**A graph exists, but it is not a friendship.** The referral system
(`supabase/functions/referral/index.ts`, `referrals` table) already links two real
accounts and pays both sides. But the link is fire-and-forget: it grants bonus AI
calls and a rare dino once, then nothing persists. There is no friend list, no
shared state, no way for one user's activity to be visible to another.

**Build.**

- **Migration** — `buddies` (a_user, b_user, state: pending/accepted, created_at) with
  both sides required to accept, and `daily_active` (user_id, date, active bool) —
  **a boolean only**, never what was eaten or weighed.
- **RPC** `shared_streak(pair_id)` — runs the *same* streak maths as
  `Game.computeStreak` over the intersection of both users' active days.
- **Client** — surface it in the Play hub next to the personal streak, sourced from
  the referral list so the first shared streak is one tap from an existing invite.
- **Nudge** — extend `supabase/functions/push-nudge` with a pair case: "Sam logged
  today, your shared streak is waiting." The dedupe machinery is already there
  (`20260726181500_push_streaksave_dedupe.sql`).

**The design constraint that matters.** The personal streak already forgives — a
monthly auto-freeze and bridged holiday windows (`computeStreak`, `app/game.js:29`,
and its comment about not paying people to declare holidays). A shared streak must
inherit both. On a health app, a streak that makes someone else lose is a guilt
machine unless it forgives at least as generously as the solo one does. Build the
freeze into the shared streak on day one, not as a patch after the first complaint.

---

## 4. Always leave one thing unfinished

**This is the one the app currently gets backwards.** Today renders, in order: the
kcal hero with four macro bars, a Balance slider, the buddy habitat, and a
Move/Sleep/Ready dial row (`Dashboard`, `app/src/app.jsx:7417` onward). At any moment
several things are partly done and nothing is *the* thing. That is exactly the "ten
metrics" the principle warns about — the Apple Watch answer is three rings and one of
them unclosed.

**The good news: the logic is already written.** `Game.buddyCraving(todayQ)`
(`app/game.js:117`) already returns the single first unmet target in priority order —
`firstmeal` → `protein` → `fibre` → `fuel` — and `null` once the day is genuinely
done. It is currently used only to flavour what the buddy says.

**Build.**

- Promote `buddyCraving` from a speech flavour to **the day's one open loop**. Render
  it as a single line at the top of the hero card with the exact distance to close —
  "38g of protein to go" — using the existing tested meter maths (`E.meterCells`,
  already shared by every bar and dial so they can never disagree).
- **Show nothing when the loop is closed.** The line disappears on a finished day.
  One thing unfinished, or nothing at all — never two.
- Demote the rest. The macro bars and dials stay, but the one-thing line is the only
  element that reads as *outstanding*.
- Feed the same state into the buddy's evening mood so "unfinished" is consistent
  between the number and the character.

This is the highest-value item in the list and it needs no backend, no migration and
no new state — only the discipline to let one metric outrank the others on the
screen.

---

## 5. Reward the comeback

**Fully built, and completely invisible.** `computeStreak` already forgives one
missed day per calendar month automatically, returning the newly frozen dates for the
caller to persist (`app/game.js:29`). The Dashboard persists them silently in a
`useEffect` (`app/src/app.jsx:7260`). The user is rescued and never told. A rescue
nobody notices is not a reward — it is a bug that happens to be nice.

**Build.**

- **Say it out loud.** When `streakInfo.newFrozen` is non-empty, fire the existing
  toast: "Streak freeze used — your 12 days are safe." One line, in the effect that
  already runs.
- **Wake the buddy on return, not three days later.** After a lapse the buddy sleeps
  and needs `WAKE_DAYS = 3` active days to wake (`buddyView`, `app/game.js:52`). A
  returning user therefore logs, and nothing visibly happens, for three days — the
  precise opposite of "make returning feel like a win". Add a comeback path: the
  first active day after a lapse of ≥ N days wakes the buddy immediately and pays a
  comeback Amber bonus.
- **New pure function** `Game.comeback(lastActiveISO, today)` in `app/game.js`,
  returning `{ lapsedDays, wake, bonus }` or `null`, unit-tested alongside the rest.
- **The returning-user line** the principle names — "complete one task today to
  restore your streak" — has a natural home in the buddy's coach line, which already
  has a priority ladder for exactly this kind of ask (`app/game.js:640`).

---

## 6. Give users something worth keeping

**Built once, fires once.** The app already renders a real PNG share card on a canvas
(`renderMilestoneCard`) and shares it through the Web Share API with a download
fallback (`shareMilestone`, `app/src/app.jsx:4937`). It is wired to exactly one
surface: `MilestoneCelebration`, the whole-kilogram goal milestones.

Every other celebration in the app — and there are several, already built, already
with confetti — has no share button.

**Build.** One `shareCard({ kind, ... })` wrapper over the existing renderer, then a
share button on the moments that already exist:

- `StageUpCelebration` (`app/src/app.jsx:6927`) — the buddy grew.
- `WeeklyRecapSheet` (`app/src/app.jsx:6270`) — the week's numbers, the closest thing
  the app has to a Wrapped.
- Trophy unlocks (`TrophyCabinet`, `app/src/app.jsx:5521`).
- Streak milestones at 7 / 30 / 100 days.
- Training PRs — `Training.prKind` already names them ("Best estimated 1RM"),
  `app/training.js:1112`.

This is the cheapest item on the list relative to its payoff: the renderer, the
fallback chain and the analytics hook (`MTRACK('share_milestone')`) are all written.

---

## 7. Reward getting better, not participating

**Train already does this correctly.** `app/training.js:1112` classifies three
distinct kinds of personal record — heaviest weight, best reps at that weight, and
best estimated 1RM — rebuilt from the logs rather than stored, so correcting a
mistyped set cannot leave a phantom PR behind. It even limits itself to one record
per movement per session because "nobody says they set three bench records today".
That is the principle, implemented properly.

**Food rewards showing up.** Amber pays for *logging* (`AMBER_REWARDS.dailyLog`),
streaks count days *attended*, the bond meter rewards consistency. In fairness Amber
is not "meaningless XP" — it buys cosmetics in a real shop (`COSMETICS`,
`app/game.js:539`) — but nothing anywhere celebrates the user getting **better** at
eating.

**Build.** Personal bests for nutrition, in `app/game.js`, from inputs `weeklyRecap`
already computes:

- Best protein week (most days on target).
- Best fibre week.
- Best density-score week (Premium, where the nutrient data exists).
- Longest streak — already stored at `records.longestStreak`, currently shown but
  never celebrated at the moment it is beaten.

Surface them as a **"Your bests"** block in the trophy cabinet, and toast the moment
one falls: *"Best protein week yet — 6 of 7 days."* The principle's test is whether
the user can explain their progress in one sentence, and "I hit protein six days out
of seven, my best yet" passes it in a way "you have 1,240 Amber" never will.

---

## Suggested order

1. **#4, one thing unfinished** — highest impact, no backend, and it fixes a screen
   that currently works against the user's attention.
2. **#5, comeback** — nearly free; the logic is written and only needs to be spoken.
3. **#6, share cards** — nearly free; the renderer exists.
4. **#1, no zeros** — small, self-contained, touches only first-run.
5. **#7, personal bests** — medium, pure logic plus one new block in the cabinet.
6. **#2 and #3, leagues and shared streaks** — together, once the opt-in and display
   name model is settled. They share a migration, an RLS shape and a cron, so
   building them as one piece of work costs materially less than two.

The first five are client-side and `app/game.js` only: pure functions with unit
tests, then wiring, then `node build.mjs` to regenerate the bundled `index.html`.
The last needs a migration, an edge function, and a decision about what a user is
willing to show other people on an app that knows their weight.
