# Protein boost: a manual "+N g protein" switch that pays for itself out of fat and carbs

One feature, three phases. Ship and test each phase before starting the next.
Line numbers are approximate (taken from `app/engine.js` and `app/src/app.jsx` at the time of writing), so search by **function name**.

Before every commit: `npm test`, then `node build.mjs`, then check the Goals sheet at 320px and 390px, in light and dark.

---

## What it is, in one paragraph

A switch in the protein settings: **Protein boost: Off / +5 / +10 / +15 / +20 g**. It adds that many grams on top of whatever the protein mode already gives (Adaptive or Per kg lean), and **calories stay exactly where they are**. The extra 4 kcal per gram comes out of fat and carbs, shared between them by how much of the day each one holds, with fat never pushed below its floor. Example: someone on 2,000 kcal at 170 P / 65 F / 172 C turns on +10 g and gets **180 P / 63 F / 166 C, still 2,000 kcal** (fibre reserve included). It survives check-ins, cycling and phases, because it lives in the profile and the engine reads it every time it builds macros.

Who it is for: people in a hard deficit (or who just feel better on more protein) who want a bit more without switching to "Exact grams" and losing the adaptive model underneath.

## Why not just use what is there

| Existing option | Why it isn't the answer |
|---|---|
| **Exact grams** mode | Throws away Adaptive / Per kg. The number is frozen and no longer moves with body fat or deficit. A boost is "what the model says, plus a bit". |
| **Per kg slider** | Moves in 0.1 g/kg steps (≈7 g for most people), is not available in Adaptive mode, and isn't how people think ("give me 10 g more"). |
| Any of them via the Goals sheet **Save** | `GoalEditor.apply()` re-anchors the whole plan: new kcal from learned TDEE, resets `last_checkin`, may close a phase. Far too heavy for "a bit more protein". |
| Today, extra protein comes only out of **carbs** | `macrosFromKcal` sets fat from `DIET_STYLE_FAT_PCT` without looking at protein, and carbs take whatever is left. The request is to trim both. |

---

## Phase 1: Engine (`app/engine.js`)

### 1a. Profile field
- `profile.proteinBoostG`: integer, one of `0, 5, 10, 15, 20`. Missing or `0` means off, so every existing profile reads exactly as it does now (no migration).
- Add `PROTEIN_BOOST_STEPS = [0, 5, 10, 15, 20]` and `normProteinBoost(p)`: clamps to `[0, 20]` and rounds to the nearest 5. That way a hand-edited or admin-edited value can't escape.

### 1b. Where the boost applies: `macrosFromKcal(kcal, profile)`
Not in `proteinGrams()`. Putting it there would make carbs absorb all of it, which is the current behaviour the request is trying to change. `proteinGrams` keeps meaning "what the mode says".

After the existing squeeze block, before rounding:

```
boostReq  = normProteinBoost(profile)
if boostReq > 0 and proteinMode(profile) !== 'grams' and !squeezed:
    // cap so protein never passes the manual 4.0 g/kg-lean ceiling
    cap      = proteinManualBounds(profile).max
    boost    = min(boostReq, max(0, cap - protein_g))
    need     = boost * 4                                   // kcal to find
    carbKcal = kcal - protein_g*4 - fat_g*9 - fiberKcal    // what carbs currently hold
    fatKcal  = fat_g * 9
    fatShare = fatKcal / (fatKcal + carbKcal)              // proportional split
    fatRoom  = max(0, (fat_g - FAT_FLOOR_G_PER_KG*weightKg) * 9)
    fromFat  = min(need * fatShare, fatRoom)
    fromCarb = need - fromFat
    if fromCarb > carbKcal: boost shrinks to fit (fromFat + carbKcal) / 4, floored
    protein_g += boost; fat_g -= fromFat / 9
```

Carbs are then derived by the existing "rounded kcal − rounded P − rounded F − fibre reserve" line, so kcal is unchanged by construction. Only carb rounding (≤ 2 kcal) is left over.

Return the result on the target so the UI and check-ins can describe it:
`out.proteinBoost = { requested: boostReq, applied: boost, fat_g: −Δfat, carbs_g: −Δcarbs }` (omitted when off).

Decisions baked in (change here if you disagree):
- **Proportional split, fat floor respected.** On a balanced diet that is roughly ⅓ from fat and ⅔ from carbs. On `lower_carb` more comes from fat, which is what that user would want. Fat stops at the 0.8 g/kg default floor and never at the 0.5 hard minimum, because a boost is optional and must not push anyone into the emergency zone.
- **Ignored in "Exact grams" mode.** The typed number is already the knob, and stacking a boost on a held figure is two controls for one thing. The UI hides the switch in that mode (Phase 2).
- **Skipped when the budget is already squeezed.** The plan is at the safety floor and there's no fat or carb to give. `applied: 0`, and the UI says why.
- **Capped at the manual ceiling (4.0 g/kg lean).** A boost on top of Adaptive's 3.1 band top can legitimately pass 3.1. 4.0 is the same line a typed figure is held to.

### 1c. Everything downstream gets it for free. Verify, don't change
- `computeInitialTargets` → calls `macrosFromKcal` ✔
- Check-ins (`macrosFromKcal(newKcal, profile)` ~L1161, ~L1270) ✔. `proteinClause` will correctly say "protein stays at 180 g" on the next check-in.
- `applyKcalDelta` (cycling / carryover) holds protein and fat from the base and flexes carbs ✔. The low-day `lowFatShare` floor is `base.fat_g / 2`. That's fine, because the base already includes the boost.
- Maintenance preview at `app.jsx` ~L4403 (`goalType: 'maintain'`) ✔ boost carries through, which is what you'd want at maintenance too.

### 1d. Tests (`tests/protein-boost.test.js`, new)
1. Off / missing → `macrosFromKcal` output is byte-identical to today, for all three diet styles.
2. +10 g on a 2,000 kcal balanced cut → `protein_g` +10, `kcal` unchanged, `P*4 + F*9 + C*4 + fibreReserve` within 2 kcal of kcal, fat and carbs both lower.
3. Fat already on the 0.8 g/kg floor → all of it comes from carbs, fat unchanged.
4. Squeezed budget → `applied === 0`, macros identical to unboosted.
5. Exact-grams mode → ignored.
6. Adaptive at band top + 20 g → capped at `proteinManualBounds().max`.
7. Garbage values (`7`, `-5`, `'10'`, `999`) normalise to `5`, `0`, `10`, `20`.
8. `applyKcalDelta` on a boosted base: a high and a low day keep the boosted protein.
9. Existing `tests/adaptive.test.js` squeeze cases still pass untouched.

---

## Phase 2: UI (`app/src/app.jsx`)

### 2a. The control
In `GoalEditor`'s advanced protein `Field` (~L17444), directly under the mode `Seg`, and **only when `proteinMode !== 'grams'`**:

- Row label **"Protein boost"** + a `Seg` of `Off · +5 · +10 · +15 · +20`.
- Live read-out under it, built from `E.macrosFromKcal(cur.kcal, profileWithBoost)` against the current base target (not the re-anchored `preview`), so it shows exactly what will land:
  > **Protein 170 → 180 g** · fat 65 → 63 g · carbs 172 → 166 g · calories stay at 2,000
- If `applied < requested`, one muted line explains why: *"Only +5 g fits: fat is at its floor and carbs are nearly gone."* If it's squeezed: *"Your plan is already at the safety floor, so there's nothing to trade. A boost needs a slightly gentler rate."*
- Hint copy: *"Extra protein on top of your plan. Calories don't change: the extra comes out of fat and carbs. Handy in a hard deficit."*
- **Also update the top label** (`Protein: N g a day`) to show the boosted total with a small `(+10 boost)` suffix, so the number at the top matches the meters.

### 2b. Saving: the light path, not the re-anchor
Add `proteinBoostG` to `g` state and to `planChanged`. Then in `apply()`:

- If the **only** thing that changed is the boost (and the weight box still shows the current weight), skip the re-anchor and call a new helper:

```js
// Change the protein boost without touching calories, the check-in day, the trend or a phase.
function applyProteinBoost(d, boostG, iso) {
  d.profile = Object.assign({}, d.profile, { proteinBoostG: boostG });
  const cur = currentBaseTarget(d, iso);          // whatever the latest d.targets entry in force is
  const nt = Object.assign({}, cur, E.macrosFromKcal(cur.kcal, withActivity(d.profile)));
  nt.id = Store.uid(); nt.effective_date = iso; nt.source = 'protein-boost';
  d.targets = (d.targets || []).concat([nt]);
}
```
  Toast: **"Protein boost on: +10 g, calories unchanged"** / **"Protein boost off"**.
- If anything else changed too, the normal re-anchor runs and picks the boost up through `computeInitialTargets`, so there's nothing extra to do.

(Use whatever helper already resolves the active base target. Grep for how `TodayDetailSheet` / the macro card reads `d.targets` and reuse that. Don't write a second resolver.)

### 2c. Make it visible where people look
- **Macro summary card / protein meter**: a tiny `+10` pill next to the protein target while a boost is on, so people remember it's there. Tapping it opens the Goals sheet with Advanced expanded.
- **Check-in result** (`~L7167`, next to the `squeezed` note): when `newTargets.proteinBoost.applied > 0`, add *"Includes your +10 g protein boost."*
- **AI coach context**: wherever the coach is told the targets and phase (see commit "AI surfaces: coach knows the phase"), add `protein boost +10 g (manual)`. Otherwise it may suggest eating less protein to hit fat/carbs.

### 2d. Copy fix while you're there
The "Exact grams" hint says *"Carbs take the difference, calories don't move."* That stays true for that mode. Leave it.

---

## Phase 3: Admin and reconciliation (lets you switch it on for someone)

Right now an admin can already set it by hand: **Admin → user → Edit data → `profile.proteinBoostG: 10`**. But targets are stored entries (`d.targets`), so nothing would change on their Today screen until their next check-in. Two small additions fix that:

### 3a. Reconcile on load
On app start (next to the other load-time repairs), if `normProteinBoost(profile)` differs from the `proteinBoost.requested` on the active base target (missing counts as 0), run `applyProteinBoost(d, profile.proteinBoostG, today)`. That one rule makes the admin edit, a second device, and an older build's save all converge. Store the `requested` value on every target entry (Phase 1 already does) so the comparison is cheap.

Guard against loops: only reconcile when the numbers differ, and `applyProteinBoost` always writes `requested`, so it fires at most once.

### 3b. Admin user view
In the admin user panel (~L19769, beside the data editor), add a one-line **Protein boost** `Seg` that calls `update_state` with just the profile field patched, and logs `set_protein_boost` in the audit labels (~L19443). That's more pleasant than editing raw JSON, and it's audited.

### 3c. For the account you mentioned
Once Phase 1 and 3a are live: set `profile.proteinBoostG = 10` on that account (via 3b, or Edit data). Their next app open rebuilds today's targets at the same calories with +10 g protein, trimmed from fat and carbs. I haven't looked at that account's data. If they're on **Adaptive**, the deficit term already adds up to +0.40 g/kg lean for an aggressive cut, so check where they actually sit before stacking +10 on top. The research box in the Goals sheet shows the breakdown.

---

## Optional later: a nudge, not an auto-boost
When `proteinDeficitPct(p) >= 0.25`, the boost is off, and the person isn't squeezed, show a one-time dismissible card: *"You're in a steep deficit. A +10 g protein boost helps hold on to muscle, and calories stay the same. [Turn it on] [Not now]"*. Keep it manual: changing someone's macros silently is not this feature's job (same principle as `proteinMode` not auto-migrating people to Adaptive).

## Out of scope
- Per-day boosts (e.g. training days only). Cycling already handles day-to-day energy. Revisit if asked.
- Boosting at the cost of calories (i.e. +40 kcal). The whole point is calories don't move.
- Negative boosts. "Exact grams" covers going lower.
