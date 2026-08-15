# This week's boss becomes a fight you can actually take

Written against: `be2657fa7150cce376225f4e14eb8f294163fd53`

**This is a behaviour plan, not a copy plan.** It is recorded alongside
`design-plans/24-battle-drop-the-type-triangle.md` and
`design-plans/25-shop-cut-what-the-shop-already-shows.md` because it is the largest single reason the
Battle tab reads as confusing, but the correction is wiring rather than presentation. It carries one
decision that is the product owner's to make — see **Uncertainty**.

## Evidence chain

- Surface: the Play hub's **Battle** tab, `phase === 'select'` — the "This week's boss" panel,
  `app/src/app.jsx:9780-9819`. It is the first and largest panel on the tab.
- Problem: there is no way to fight it. The panel renders a 112px scene, the boss's name, its
  `ATK / DEF / HP`, the week's macro track, and a footer advertising "60 Amber · 25 first time" — and
  ends. Every other panel on the tab ends in a button. A user lands on Battle, reads the screen's
  headline offer, and finds no way to accept it; the two fights they *can* start are below the fold.
- Design evidence — the apparatus for this fight exists and is unreachable:
  - `start(opponent, kind)` (`app/src/app.jsx:9532`) branches on `kind === 'weekly'`
    (`:9533`, `const isBossFight = kind === 'weekly'`). **`start` is called twice in the file** —
    `start(daily, 'daily')` (`:9879`) and `start(rival, 'ladder')` (`:9903`). `'weekly'` is never
    passed.
  - `bossReady` (`:9413`) is computed from `fight.lastBossWeek !== fightWeekKey()` and never read.
  - `boss` (`:9412`) is used only for the panel's decorative sprite, name and stat line.
  - The reward path for a boss win is written and unreachable: `:9657-9659` increments
    `fight.trophies`, stamps `lastBossWeek`, grants the `amber` trophy item and a coin-flip
    `golden_steak`, and mints `Game.AMBER_REWARDS.weekly`.
  - The result rows for a boss win are written and unreachable: `:9559-9562`, "Boss felled" and
    "Trophy · Earned".
  - `git log` shows the panel was rebuilt in `e0679fe` ("The Play overhaul: the boss is your worst
    habit, and today buys the fight") and polished in `be2657f`. The dead `FightCard` component
    (`:9734-9752`), which took an `action` prop and is now rendered nowhere, is the previous screen's
    fight card — the shape the boss button used to live in.
- Second defect on the same panel: the footer (`:9817`) advertises
  `Game.AMBER_REWARDS.weeklyFirst` — "25 first time". No code pays it. The only mint on the boss path
  is `Game.AMBER_REWARDS.weekly` (60) at `:9659`. `weeklyFirst` (`app/game.js:728`) has no other
  reader anywhere in the repository.
- Owner: `app/src/app.jsx` — `FightModal`.
- Scope and affected surfaces: the Battle tab. `FightModal` has one call site (`:8867`).
- Uncertainty: **one decision is required before step 2.** `Game.bossPlan()` returns
  `mult: hit >= WEAKNESS_DAYS ? 1.35 : 1` (`app/game.js:379`) and **nothing reads it** — `start()`
  hard-codes `const mult = 1` (`:9534`). The panel promises the 1.35x in three states (`:9798-9801`)
  and again mid-fight (`:9942`). The recorded intent is that it should be live: `:9422-9424` states
  "Beating the boss and fixing the habit are now the same instruction," and `e0679fe`'s message says
  "today buys the fight." Two resolutions exist and the evidence does not choose between them:
  - **(a) Honour it** — apply `bossPlan.mult` to the buddy's attack on the weekly boss only. Matches
    the recorded intent and makes the macro track consequential. Changes fight balance.
  - **(b) Drop the claim** — remove the 1.35x from `:9798-9801` and `:9942` and let the macro track
    stand as a habit read with no combat effect. Safer, but leaves the panel's boss and its macro
    connected by nothing.

  Do not start step 2 until this is answered. Everything else in this plan is unaffected by it.

## Design decision

Restore the entry point that the Play overhaul dropped: the boss panel gets the same terminal action
every other fight panel on the tab has, gated the same way they are, and its advertised reward is made
to match what the reward path actually pays.

The panel is not the problem — it is the best-built card on the screen. It is missing its last row.

## Reuse

- `start(boss, 'weekly')` (`app/src/app.jsx:9532`) — already written, already branches for this case.
- `Btn kind="accent"` (`app/src/app.jsx:3508`) — the committing tier, Silkscreen and uppercase, as
  used by "Hunt · N Amber" (`:9879`).
- `Game.fightGate` (`app/game.js:406`) — the existing "logged today" gate. **Use `loggedToday`
  directly, not `gate.can`**: `gate` also carries the ladder's *one attempt per day* rule
  (`fight.lastAttemptDate`), which must not apply to the boss. The boss's own once-per-week gate is
  `bossReady`.
- Exemplar for a gated fight panel with a button and a locked message: the Daily hunt panel,
  `app/src/app.jsx:9862-9886` — button when `loggedToday`, a plain line when not, and a bottom band
  when the fight is spent for the period.

No new primitive is required.

## Changes

1. `app/src/app.jsx:9814-9818` — the boss panel's reward footer
   - Change: make the advertised reward match the mint. Either (i) change the footer to
     `{Game.AMBER_REWARDS.weekly} Amber` only, or (ii) pay the first-time bonus in the `isBoss` branch
     at `:9657-9659` by minting a second, separately-keyed ledger entry (e.g.
     `earn('amber:weeklyfirst', Game.AMBER_REWARDS.weeklyFirst, 'First weekly boss')`, which is
     idempotent through `game_awards` exactly as the existing `earn` calls are). Prefer (i) unless the
     first-time bonus is wanted, because it is the smaller change and `weeklyFirst` has never paid out
     to any existing account.
   - Preserve: the footer's "Clears for" / value two-column construction.
   - Verify: the number on the panel equals the Amber a win actually adds to the ledger.

2. `app/src/app.jsx:9814` — the boss panel's action row
   - Change: insert a terminal action above the "Clears for" footer, inside the panel, mirroring the
     Daily hunt panel's three states:
     - `bossReady && loggedToday` → `<Btn kind="accent" className="w-full" onClick={() => start(boss, 'weekly')}>Fight {boss.name}</Btn>`
     - `bossReady && !loggedToday` → the Daily hunt's quiet-line treatment (`:9880`): a centred
       `--muted` line saying the boss is waiting on today's log. Do not scold — the voice is
       adherence-neutral (`design-plans/17-buddy-animation-wiring.md` §2).
     - `!bossReady` → the Daily hunt's bottom-band treatment (`:9885`): a `--surface2` band reading
       that this week's boss is down, back on Monday.
   - Preserve: the panel's existing order — scene, name and stats, sentence, macro track — and the
     "Clears for" footer as the last element.
   - Verify: `start(boss, 'weekly')` sets `isBoss`, so a win reaches `:9657-9659` and the "Boss
     felled" / "Trophy · Earned" rows at `:9559-9562` render for the first time.

3. `app/src/app.jsx:9534` — **only if resolution (a) is chosen**
   - Change: replace `const mult = 1;` with the boss weakness applied to the weekly boss alone —
     `const mult = kind === 'weekly' ? bossPlan.mult : 1;` — and update the Phase 6 comment on that
     line and at `:9398` to say that types are gone but the boss's macro weakness is live.
   - Preserve: type-neutrality for the daily hunt and the ladder. `Game.typeMult` stays out of the
     bout (see `design-plans/24-battle-drop-the-type-triangle.md`).
   - Verify: with `bossPlan.live` true, a weekly-boss bout deals visibly more damage per swing than
     the same stats against a ladder rival; with it false, the two match.
   - If resolution **(b)** is chosen instead: leave `:9534` alone and delete the 1.35x clauses from
     `:9798-9801` and `:9942`, keeping the macro track and its label.

4. `index.html`
   - Change: rebuild with `node build.mjs` and commit the regenerated bundle.
   - Verify: the deployed Battle tab's first panel ends in a control.

## Scope

- Inherit: the Battle tab (`app/src/app.jsx:8867`).
- Verify: `TrophyCabinet` (`:8940`) — a boss win grants the `amber` trophy item, which the cabinet
  lists through `trophyIds` (`:8945`). This is the first time that row can appear; check it renders.
  Also `d.fight.trophies`, incremented at `:9657` and not read anywhere else.
- Exclude: the dead `FightCard` / `StatLine` block (`:9725-9752`) — deleting it is correct but is
  unrelated cleanup, not part of restoring the boss; the inert `stance` and `useSpecial` state
  (`:9525-9526`, never set) and `lastMult` (`:9524`, never read), which are the same kind of leftover;
  the daily hunt and ladder gates, which are correct as they stand.

## Validation

- Product: on a Monday, open Play → Battle with food logged. Fight the boss, win, and confirm the
  Amber added to the ledger equals the panel's advertised figure, a trophy is granted, and the panel
  shows the boss as down for the rest of the week. Return the next day and confirm it is still down.
- Interface: Battle tab at 390px and 320px, both themes, across all three action states above;
  `phase === 'fight'` and `phase === 'done'` for a boss win **and** a boss loss (a loss must cost
  nothing and must not stamp `lastBossWeek` — confirm the reward effect at `:9645` only runs on
  `winner === 'you'`).
- System: confirm the boss uses `loggedToday` and `bossReady`, and has not been routed through
  `gate.can`, which would silently consume or be blocked by the ladder's daily attempt.
- Repository: `npm test` → all suites pass. `node build.mjs` → succeeds.
  `grep -c "start(boss, 'weekly')" app/src/app.jsx` → `1`.

## Stop conditions

- Stop before step 2 until the Uncertainty above is resolved by the product owner.
- Stop if the weekly boss turns out to be reachable by some path not found here — re-check with
  `grep -n "start(" app/src/app.jsx` before writing any code.
- Stop if honouring `bossPlan.mult` makes the boss trivially beatable at low stats; that is a balance
  question, not a wiring one, and it needs its own decision.

## Design documentation

- After acceptance and validation: record in the next handover — "Every fight panel on Battle ends in
  a control. A panel that advertises a reward must be able to pay it, and the advertised figure must
  be the figure the ledger mints."
