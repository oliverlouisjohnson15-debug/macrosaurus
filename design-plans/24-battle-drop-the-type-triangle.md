# Battle stops teaching a combat system the fight does not have

Written against: `be2657fa7150cce376225f4e14eb8f294163fd53`

## Evidence chain

- Surface: the Play hub's **Battle** tab — `FightModal` rendered embedded at `app/src/app.jsx:8867`,
  `phase === 'select'` (`app/src/app.jsx:9771-9907`) and `phase === 'fight'` (`:9909-9945`).
- Problem: the screen names a four-way macro type triangle (Power / Guard / Swift / Renew) in four
  separate places and states an explicit damage multiplier — "Your Power beats its Swift, 1.25x." —
  that the combat loop never applies. The bout is hard-coded to be type-neutral. A user who reads the
  screen and plans around it is planning around nothing, and the vocabulary costs roughly forty words
  and a four-cell grid on the most crowded screen in the app.
- Design evidence:
  - `app/src/app.jsx:9397-9398` — "Phase 6: the fighter IS the buddy now… the bout is 'always
    balanced' (no macro type advantages)."
  - `app/src/app.jsx:9534` — `const mult = 1; // always balanced: no macro type advantage (Phase 6)`.
    `mult` is the only channel by which a type could reach `eff.atk` (`:9538`).
  - `app/src/app.jsx:9594-9635` — the combat loop. Damage is
    `max(3, atk.atk - round(def.def / 2) + rnd(7))`, modified only by `rage`, `dodge`, `heal` and a
    spent charge. No type term exists in it.
  - `Game.typeMult` (`app/game.js:260`) reaches the interface through exactly one caller,
    `matchupLine` (`app/src/app.jsx:9476`), which is a display function.
  - `design-plans/20-ui-review.md` §2.3 — countable blocks do the work of recall, which is why "the
    cards can carry one number each instead of three".
- Owner: `app/src/app.jsx` — `TYPE_META` (`:9300`), `TypeChip` (`:9301-9306`), `TypeRow`
  (`:9346-9361`), `matchupLine` (`:9475-9481`), `buddyType` (`:9434`).
- Scope and affected surfaces: the Battle tab only. `FightModal` is rendered in one place
  (`app/src/app.jsx:8867`); its standalone `Sheet` branch (`:9972-9976`) has no other caller.
- Uncertainty: none for the type triangle. The separate **1.35x boss-weakness** bonus is a different
  mechanic with a different resolution and is deliberately left untouched here — see
  `design-plans/26-weekly-boss-entry-point.md`, which owns it. This plan keeps every existing 1.35x
  claim exactly as truthful (or not) as it is today.

## Design decision

Delete the type triangle from the Battle tab. It is presentation for a rule that was removed from the
engine in Phase 6 and never removed from the screen. Where the boss panel currently reaches the macro
*through* a type name ("Guards against everything but Power, and Power is protein"), name the macro
directly instead — the macro is the real thing, the type was only ever a wrapper around it.

This resolves the root problem rather than shortening the sentences: the screen stops carrying a
second, competing model of how a fight is won.

## Reuse

- `CardHead` (`app/src/app.jsx:3576`) — already renders nothing when `right == null`, so dropping a
  panel's status needs no new variant.
- `PlayPanel` (`app/src/app.jsx:9311`) — unchanged.
- `Game.bossPlan().macro` (`app/game.js:367`) — already the source of the macro word used by the day
  track (`app/src/app.jsx:9805`) and the loss CTA (`:9966`).
- Exemplar for an enemy presented by name and stats with no type chip: the boss panel's own header
  row, `app/src/app.jsx:9790-9793`.

No new primitive is required.

## Changes

1. `app/src/app.jsx:9300-9306` — `TYPE_META` and `TypeChip`
   - Change: delete both. They have no consumer once steps 2–8 land.
   - Preserve: `ABIL_LABEL` (`:9270`) directly above.
   - Verify: `grep -n "TYPE_META\|TypeChip" app/src/app.jsx` returns nothing.

2. `app/src/app.jsx:9344-9361` — `TypeRow` and its comment block
   - Change: delete the component and the three comment lines above it ("The four macro types as a
     row, with the one that matters lit…").
   - Preserve: `StatRow` above (`:9329-9343`) and `ChargeTiles` below (`:9362-9388`).
   - Verify: `grep -n "TypeRow" app/src/app.jsx` returns nothing.

3. `app/src/app.jsx:9434` — `const buddyType = Game.typeForName(fighter.name);`
   - Change: delete the line.
   - Preserve: `const amber = …` on the following line.
   - Verify: `grep -n "buddyType" app/src/app.jsx` returns nothing.

4. `app/src/app.jsx:9473-9481` — `matchupLine` and its comment
   - Change: delete the function and the two comment lines above it ("What the matchup means, in a
     sentence…").
   - Preserve: the `fighterLine` block that follows (`:9482-9492`).
   - Verify: `grep -n "matchupLine\|typeMult" app/src/app.jsx` returns nothing.

5. `app/src/app.jsx:9794` — `<TypeRow lit={bossPlan.type} />`
   - Change: delete the line.
   - Preserve: the header row above it (`:9790-9793`) and the prose block below.
   - Verify: the boss panel renders scene → name/stats → sentence → day track → "Clears for" footer.

6. `app/src/app.jsx:9795-9802` — the boss panel's sentence
   - Change: replace the whole `<div className="text-[12px] leading-snug" …>` block's contents with a
     macro-first line that names no type and restates no count the track below already shows:

     ```jsx
     <div className="text-[12px] leading-snug" style={{ color: 'var(--text2)' }}>
       Weak to <b style={{ color: 'var(--accent-ink)' }}>{bossPlan.macro}</b>, the macro you land least often.{' '}
       {bossPlan.live
         ? 'Already taking 1.35x.'
         : bossPlan.daysHit === 0
           ? 'Three ' + bossPlan.macro + ' days this week starts it.'
           : (bossPlan.daysNeeded - bossPlan.daysHit) + ' more and it starts taking 1.35x.'}
     </div>
     ```
   - Preserve: the `--accent-ink` emphasis on the one word that matters, the three-state structure
     (live / none yet / part way), and the 1.35x figure's current truth status — this plan neither
     adds nor removes a claim about the bonus.
   - Verify: at 390px the line wraps to at most two lines in all three states; the word "Power",
     "Guard", "Swift" or "Renew" appears nowhere on the panel.

7. `app/src/app.jsx:9824` — the fighter panel's `right` prop
   - Change: remove `right={(TYPE_META[buddyType] || TYPE_META.balanced)[0]}` from the `PlayPanel`
     call, leaving `title={fighter.name + ' · stage ' + Math.max(1, si)}` and the `footer` prop.
   - Preserve: the title and the "Says" footer.
   - Verify: the panel's ink bar shows the name and stage only. The status was a type derived from a
     hash of the buddy's *name* (`Game.typeForName`, `app/game.js:267`), so renaming the buddy changed
     it and nothing else — do not replace it with a substitute status; the three `StatRow`s below
     already carry every number this panel owns.

8. `app/src/app.jsx:9869-9876` — the Daily hunt enemy row
   - Change: delete `<TypeChip t={daily.type} />` (`:9872`) and the `matchupLine` span (`:9875`). The
     name is then alone on its row, so collapse
     `<div className="flex items-baseline justify-between gap-2">` to a plain
     `<span className="pf text-[13px]" style={{ letterSpacing: '0.04em' }}>{daily.name}</span>`.
   - Preserve: the `ATK / DEF / HP` line (`:9874`) and the sprite box.
   - Verify: the hunt card reads sprite → name → stats → "Hunt · N Amber", with no sentence between
     the stats and the button.

9. `app/src/app.jsx:9941-9943` — the in-fight no-charges line
   - Change: replace the type label with the macro word, leaving the sentence otherwise as-is:
     `No charges today, so this is your week fighting alone.{bossPlan.live ? ' ' + bossPlan.macro + ' still lands 1.35x.' : ''}`
   - Preserve: the conditional — the clause still appears only when `bossPlan.live`.
   - Verify: the command box shows no type vocabulary.

10. `index.html`
    - Change: rebuild with `node build.mjs` and commit the regenerated bundle.
    - Preserve: nothing hand-edited; `index.html` is generated.
    - Verify: `grep -c "Guards against everything but" index.html` → `0`.

## Scope

- Inherit: the Battle tab in the Play hub (`app/src/app.jsx:8867`) — the only consumer.
- Verify: `tests/game.test.js:332-342` and `tests/play-overhaul.test.js:63` assert
  `Game.typeMult`, `Game.FIGHT_TYPES`, `Game.MACRO_TYPE` and `Game.bossWeakness`. **These stay.** The
  engine keeps its type table and its tests; only the interface stops presenting it. Do not delete
  anything in `app/game.js`.
- Exclude: the 1.35x boss-weakness bonus and the missing weekly-boss entry point
  (`design-plans/26-weekly-boss-entry-point.md`); the dead `FightCard` / `StatLine` / `ABIL_LABEL`
  block at `app/src/app.jsx:9725-9752`, which is leftover from the previous Battle screen and is not
  reached by this change; `Game.typeForName`'s other callers, of which there are none.

## Validation

- Product: open Play → Battle on an account with a hatched buddy and food logged today. The screen
  states one model of how a fight is won — your stats, today's charges, the week's macro — and nothing
  it says is contradicted by the bout that follows.
- Interface: Battle tab at 390px and 320px, in both the paper and dark themes, across:
  `phase === 'egg'`; `phase === 'select'` with and without food logged today; `bossPlan` in all three
  states (`daysHit` 0, 1–2, ≥3); daily hunt ready and already cleared; ladder available, used today,
  and cleared to prestige; `phase === 'fight'` with 0 and with 3 charges; `phase === 'done'` on a win
  and a loss.
- System: confirm no substitute status chip has been introduced on any Battle panel, and that the
  macro word reaches the screen only through `bossPlan.macro`.
- Repository: `npm test` → all suites pass, including `tests/game.test.js` and
  `tests/play-overhaul.test.js` unchanged.
  `grep -n "TYPE_META\|TypeChip\|TypeRow\|matchupLine\|buddyType\|typeMult" app/src/app.jsx` → no
  matches.
  `node build.mjs` → succeeds (use `build.mjs`, not esbuild; Babel rejects a JSX comment in expression
  position — see `design-plans/19-handover.md`).

## Stop conditions

- Stop if `app/src/app.jsx:9534` no longer reads `const mult = 1` — if someone has wired the type
  triangle into the bout, this plan's premise is gone and the copy is correct as written.
- Stop if removing `TypeRow` leaves the boss panel visually unbalanced at 390px in a way the day track
  does not absorb; report it rather than inventing a replacement element.
- Stop if scope must widen to `app/game.js`.

## Design documentation

- After acceptance and validation: add to `design-plans/20-ui-review.md` under Part 3, or as a short
  note in the next handover — "The fight is always balanced (Phase 6). The Battle tab must not present
  macro types; the boss's macro is named directly. `Game.typeMult` and `Game.FIGHT_TYPES` remain in the
  engine and under test, but have no interface."
