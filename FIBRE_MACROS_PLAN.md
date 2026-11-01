# Drop density, show macros on every add, make fibre count

Three changes, in four phases. Ship and test each phase before starting the next.
Line numbers are approximate (taken from `app/src/app.jsx` at the time of writing), so search by **function name**.

Before every commit: `npm test`, then `node build.mjs`, then check the log sheet at 320px and 390px, in light and dark.

---

## Phase 1: Remove the Density Score completely

**Goal:** no density UI, no density AI calls and no density maths left. Stored data stays readable.

### 1a. Keep `nq.ed`, drop the rest of `nq`
`nq.ed` (kcal per 100 g) is **not** only used by density. The estimate audit uses it (`entryEd`, `ownRefs`, `ownCheck`, `estimateAudit` in `app/engine.js` ~L560–700, `tests/estimate-audit.test.js`). Don't touch any of that.

- Old entries and foods keep their `nq` objects. Don't migrate them. They're harmless.
- From now on, write only the energy density:
  - Add `E.edStamp(kcal, grams)` to the engine. It returns `{ ed: kcal / grams * 100 }` when `grams > 0` and `kcal >= 5`, otherwise `null`. Export it.
  - Everywhere that builds `nq` via `E.ndPer100kcal(...)` should use `E.edStamp(macros.kcal, grams)` instead. That covers ConfirmFood, quickGeneric, the CoFID generic path ~L14700, the AI estimate items ~L3280 and ~L15562, and recipe ingredient adds ~L22807. Grams come from whatever that call site already passes: `basisGrams`, `grams`, `g`.
  - In `entryEd`, also fall back to `serving_g * amount` when `unit === 'serv'`. That way, entries with no `nq` still feed the audit.

### 1b. UI to delete (`app/src/app.jsx`)
| Thing | Approx line | Action |
|---|---|---|
| `QualityBar` | ~4866 | delete. Also remove its use in `MacroSummaryCard` (~5023) and the `nd`/`entries`/`onExplain` props that only fed it |
| `DensityCell` | ~4970 | delete. Remove from `TodayDetailSheet` (~12894) plus the `onExplainDensity` prop and `densityHelp` state (~13607, ~13681) |
| `densityColor`, `TONE_VAR`, `DensityScoreText`, `DensityChip`, `DensityBadge`, `DensityExplainer` | ~15170–15320 | delete |
| `FoodTile` | ~15197 | always use the food-kind colour (`FOOD_TONE[kind]`), neutral only for alcohol. Drop the premium/score branch. Simplify `E.foodTileTone` to match |
| Diary row `<DensityScoreText>` and the "Density" row on the meal/entry sheet | ~14136, ~14166, ~14238 | delete |
| EditEntryModal `<DensityBadge>` | ~14559 | delete |
| `MyRow` `<DensityChip>` | ~14870 | delete (Phase 2 replaces the trailing slot's info) |
| ConfirmFood: `aiExtra`, `explain`, `estimating`, `gaps`, `wantEstimate`, the estimate `useEffect`, `ndExtra`, `<DensityBadge>`, `<DensityExplainer>` | ~15440–15503 | delete (Phase 4 adds the fibre estimate back in this exact spot) |
| `densityCoachLine` + its use | ~2653, ~6815 | delete; let the fallback be `null` |
| Buddy coach density lines (`coach_density_good` / `coach_density_low`) | ~8515–8521 | delete |
| `densityDay`, `isDensityDay` | ~9475–9481 | delete. In `isQualityDay`, replace `isDensityDay(db, date)` with `q.fiberHit && q.kcalIn` (a good fibre day on calories now grows the buddy, which also serves the fibre goal) |
| `densityWeekTrend`, `DensityWeekCard` | ~7037–7090, ~7298 | replace with `FibreWeekCard` (Phase 3) |
| Weekly stats `ndSum/ndDays/density` | ~7230–7248 | replace with `fibreDays` (days `dayQuality(...).fiberHit`) |
| `useNutrientBackfill` + `NQ_BACKFILL_MAX` + where it's called | ~12676–12727 | delete (Phase 4 repurposes the pattern as `useFibreBackfill`) |
| `aiEstimateNutrients`, `mergeNutrients`, `aiEstimateNutrientsBatch` | ~3290–3350 | delete |
| `labelExtras`, `offExtras`, `offWithKind`, `offIsBeverage`, `offIsWater`, `someKnown` | ~15326–15375 | delete, along with every `extra=` prop / `.extra` they feed. Keep `nutrientOr`, because Phase 4 reuses it for fibre |
| Paywall copy | ~22148, ~22153 | replace the density sentence and the "Food quality scoring" bullet with: `['Fibre on every food', 'Missing fibre filled in automatically, so your daily fibre is real']` |
| `styles.css` L43 comment | | edit the comment so it no longer mentions Density Score |

### 1c. AI prompts
- `AI_PROMPT` in `app/src/prompts.jsx` (and the item parse ~L15562, ~L3273 recipe prompt): remove `satfat_g`, `sugars_g`, `salt_g`, `fvl_pct`, `is_drink` from the requested JSON. That cuts output tokens on every estimate. Make `fiber_g` explicitly **required** with this line: *"fiber_g is required for every item: UK AOAC dietary fibre in grams; 0 only for foods that truly have none (meat, fish, eggs, oils, most dairy, spirits)."*
- `LABEL_PROMPT`: stop asking for satfat/sugars/salt. Keep `fiber_g` and make sure it returns `null` when fibre isn't printed (Phase 4 needs "unknown" kept separate from 0).

### 1d. Engine (`app/engine.js`)
Delete `ndClampPct`, `ndBetween`, `ndScore`, `ndBreakdown`, `ndPer100kcal`, `ndDay`, `ndBand`, `ndClampEstimate`, `pendingNqIds`, `nutriScore`, `nsSteps`, `densityScore`, `dsBand`, `dsReasons`, `densityTone`, `nsFromNq`, all `ND_*` constants, and their exports (~L2645). Before deleting each one, grep it in `app/` and `tests/`. **Keep** `fiberTarget`, `fiberReserveKcal`, `meterCells`, `foodKind`, `foodTileTone` (simplified).

### 1e. Proxy (`supabase/functions/ai-proxy/index.ts`)
Remove the `'density'` classification (~L122) and its 402 gate (~L264). Phase 4 adds `'fibre'` in the same two places.

### 1f. Tests
- Delete `tests/nutrient-density.test.js`.
- `tests/display.test.js`: delete the `densityTone`/`dsBand` cases (~L49–95). Update any `foodTileTone` expectations.
- `tests/estimate-audit.test.js`: should pass untouched. If it breaks, the `nq.ed` handling in 1a is wrong.
- Add a test for `E.edStamp` and for the `entryEd` serving fallback.

**Done when:** `grep -rni "density\|nutriScore\|ndDay\|nsFromNq\|DensityChip" app/ supabase/ tests/` only matches recipe protein-density sort helpers (~12613, ~21936, `recipe.js` `proteinDensity`, which aren't this feature, so leave them) and CoFID's energy-density comments.

---

## Phase 2: Show the item's macros, and their effect on the day, on every add

**Goal:** wherever a food is about to be added, you can see (a) that item's kcal/P/C/F/fibre and (b) where the day lands once it's added.

### 2a. Day context carries fibre
`dayContextFor` (~L14666): add `fiber` to `rest` (from `sumMacros`) and to `target` as `E.fiberTarget(et.eff.kcal).min`.

### 2b. New shared component `AddImpact` (replaces `DayImpact`, ~L4791)
```
AddImpact({ add, rest, target, label, verb, fibre })   // fibre = { value, estimated, pending } | undefined
```
Layout (one framed block, `var(--sunk)` background like the log sheet's "Left today" panel):
1. **Item line:** `label` (e.g. "Adding 150 g"), then on the right `num` kcal, then a macro strip `P 32 · C 4 · F 6 · Fibre 3` in the macro ink colours (`--pro-ink`, `--carb-ink`, `--fat-ink`, fibre ink from 3a). Fibre shows as `~3` when estimated, `…` while pending, and `?` (muted) when unknown.
2. **Day after this:** a 5-row grid (kcal, Protein, Carbs, Fat, Fibre). Each row: label | `PipMeter value={rest[k]} addValue={add[k]} target={target[k]} cells={10} small` | right-aligned `"<left after> left"` / `"<n> over"`. `PipMeter` already supports `addValue` (the lighter preview fill), so no meter work is needed. Fibre is `overIsFine` and reads "`n` g to go" / "hit ✓".
3. With no `rest/target` (no targets set yet), render only the item line.

Delete `DayImpact` once every call site is moved over.

### 2c. Call sites (every add path)
| Surface | Change |
|---|---|
| `ConfirmFood` (~L15503) | `<AddImpact add={final} …>`. It goes **above** the "Numbers look off?" collapsible, so the macros are visible without opening anything |
| `EditEntryModal` (~L14560), used for "How much this time?" and editing | swap in `AddImpact`. The heading already shows P/C/F. Add fibre to that heading strip too (`· Fib N`) |
| `AiConfirm` summary box (~L15713) | keep the box. Add `<AddImpact>` under it (needs `dayRest/dayTarget` passed through `DescribeTab`/`PhotoTab`/`MenuTab`, which already receive `day` in most cases; thread it to `AiConfirm`) |
| `QuickAddTab` (~L15055) | live `AddImpact` under the fields, from the typed values (fibre unknown → `?`). Add an optional **Fibre (g)** field next to Fat (grid of 4) |
| `ManualTab` | goes through ConfirmFood, so it's already covered |
| `AlcoholTab` (~L16858) | `AddImpact` with kcal plus the carb/fat split. Hide the fibre row for alcohol |
| Recipe serving log (`logRecipeServing` ~L22862 and the sheet that calls it, plus the ~L14348 / ~L23063 `dayRest=` sites) | swap to `AddImpact` |

### 2d. One-tap adds (the `+` buttons that skip the confirm screen)
- **Rows show their macros before you tap.** `MyRow` sub becomes `last_qty · 420 kcal · P32 C4 F6` (+ `· Fib 3` when known; premium sees `~3` estimates). UK basic foods row: `per 100 g · 165 kcal · P31 C0 F4 · Fib 0`. Brands row: add `· P{n}` at minimum. Use a shared `macroLine(m, { fibre })` helper so the format is the same everywhere. Truncate gracefully at 320px (`truncate` on the sub span).
- **The day panel reacts.** The log sheet's "Left today" panel (~L15000) gets a 4th column **Fibre** (`grid-cols-4`; at <360px fall back to `grid-cols-2`). After a `+` add, flash the delta for ~1.5 s under each column (e.g. `−32` in the macro ink) so the effect on the day is obvious. Track `lastAdd` in `LogSheet` state, set in `addKeep`, and clear it with a timeout.
- **The "Added" strip** at the bottom (~L15100) becomes `Added 3 · 820 kcal · P64 C70 F22 · Fib 9`. Have `added` store each item's full macros, not just kcal.

---

## Phase 3: Fibre as a first-class daily number

### 3a. A real fibre colour
`styles.css`: add `--fib` and `--fib-ink` tokens (a green that clears contrast on paper and dark, validated the same way the other macro tokens are). Point `ONE_THING_COLOR.fibre`, `FibreCell`, `MacroSummaryCard` FIBRE row and `MACRO_KEYS` (~L20745) at `var(--fib)`. Today they borrow `--weight` / `--good`.

### 3b. Today hero
In `TodayHero` (~L12858), add Fibre as a **4th column** in the macro grid: `MAC` gets `['Fibre', tot.fiber, E.fiberTarget(et.eff.kcal).min, 'var(--fib)', 'fib']`, and the grid goes `grid-cols-4 gap-2.5`. Fibre reads `n g to go`, or `hit` in `--good-ink` once you reach the target, never "over" (`overIsFine` on its PipMeter). Check at 320px. If "g left" collides, drop the unit word and keep `g`.

### 3c. Today detail sheet
`TodayDetailSheet`: delete the standalone `FibreCell` block and add `<MacroRow label="Fibre" … color="var(--fib)">` straight after Fat, so it reads as the 5th macro. Note `MacroRow` paints "over" in danger. Add an `overIsFine` prop and pass it for fibre.

### 3d. Diary
- Diary entry rows (~L14100–14140): put fibre in the sub line when `>= 1 g` (`· 6 g fibre`, `~6 g fibre` if `fiber_est`).
- Food log day card `MacroSummaryCard` already has a FIBRE row. Just recolour it (3a).

### 3e. Progress
`FibreWeekCard` replaces `DensityWeekCard` in the same slot (~L7298), with the same layout: 7 day-cells filled by `min(1, fibre/target)` in `--fib`, the headline is "`n`/7 days hit fibre", and the subline is the week's average g vs the target. It shows for free and premium alike. Weekly stats get `fibreDays` (Phase 1 table).

### 3f. Buddy
Already coaches on fibre (`one.key === 'fibre'` ~L8506) and fibre feeds defence and the Fibre Forest creatures. The only change is the `isQualityDay` swap from Phase 1. Optionally add one evening coach line: if `hour >= 17` and fibre is under 50% of target, say "Fibre's at {n} g of {t}. Beans, lentils, oats or a pile of veg would sort it." (snooze key `coach_fibre_low`, 20 h).

---

## Phase 4: Premium only: estimate missing fibre with a cheap model

### 4a. "Unknown" versus 0
Right now every path coerces missing fibre to `0`, so you can't tell "no fibre" apart from "nobody told us". Fix it at the sources:

| Source | Fibre known? |
|---|---|
| CoFID generic | known (keep as is) |
| AI estimate / recipe AI | known (now required by the prompt, Phase 1c) |
| OFF search (~L14828, ~L20996) and barcode (~L16812) | known only if `nutriments.fiber_100g != null`. Otherwise carry `fiberUnknown: true` |
| Label scan | known only if the model returned a number (not `null`) |
| Quick add | unknown unless the new Fibre field was filled |
| ManualTab | blank = unknown, typed `0` = known |
| Saved food / recent | inherit the flag from the stored food |
| Alcohol | never estimated |

Carry the flag on the item handed to `addEntry` / `addMeal` / `addEstimateItems` (`item.fiberUnknown`). In `addEntry` (~L22748), store it on the entry as `fiber_pending: true` **only when** `E.needsFibre(...)` (4b) says so, and copy it onto the saved `food` record.

### 4b. Engine helpers (`app/engine.js`, tested)
- `needsFibre({ kcal, carbs, fiber, fiberUnknown, is_alcohol })` returns true when `fiberUnknown && !is_alcohol && kcal >= 20 && carbs >= 2`. Zero-carb foods (meat, fish, eggs, oils, most cheese) have essentially no fibre, so fill those with `0` for free and never call the model.
- `clampFibre(f, { kcal, grams })`: `null` if not finite or negative. Cap at `kcal * 0.1` (fibre is 2 kcal/g, and above ~20% of energy is implausible outside bran products) and at `grams * 0.45` when grams are known. Round to 0.1.
- `pendingFibreIds(entries, date)`: ids with `fiber_pending`, sorted and joined. This is the effect key, the same trick `pendingNqIds` used.

### 4c. The AI call (`app/src/app.jsx`, next to the other AI helpers)
One function serves both one food and a batch:
```
async function aiEstimateFibre(foods)   // foods: [{ name, grams, macros }]
```
- `model: AI_MODEL_FAST` (`claude-haiku-5-5`), `max_tokens: 40 + 12 * foods.length`.
- Prompt (keep it this short; the proxy classifies by its first words):
  `Estimate the DIETARY FIBRE (UK AOAC, grams) for each UK food below, for the amount given. Reply ONLY with JSON {"f":[number|null,...]} in order; null if too vague to judge.\n1. Baked beans: 200 g, 160 kcal, 9.6 g protein, 25 g carbohydrate, 0.4 g fat\n…`
- Parse with `parseModelJSON`, run each value through `E.clampFibre`, and return an array aligned with the input.
- Cost check: about 120 input + 10 output tokens per food at Haiku prices comes to ~$0.00002 per food. A heavy user logging 15 unknown foods a day spends well under 1p a month. Batches cap at 12 foods per call.

### 4d. When it runs
1. **ConfirmFood (live, before adding):** if `window.MISPREMIUM === true`, the fibre is unknown, and `E.needsFibre` holds, debounce 700 ms and call `aiEstimateFibre([{ name, grams: basisGrams, macros: m }])`. Reuse the exact effect shape that Phase 1 deleted (dead flag, cleanup, keyed on name + macros). While it runs, `AddImpact` shows `Fibre …`. The result fills the fibre as **estimated** (`~3 g`), scales with the amount like any other macro, and is logged with `fiber_est: true` (no `fiber_pending`). Telemetry: `fibre_estimate_failed` / `fibre_estimate_declined`.
   - **Don't change kcal.** UK label kcal already includes fibre energy, and the estimate is informational on that axis. Set the estimated fibre into the macro state *without* going through `setMacro` (which would re-derive kcal through Atwater), and leave `editedNums` alone so an estimate never counts as a user correction or gets submitted to `submit_food_correction`.
2. **Backfill (one-tap adds, saved meals, recipes, menu items):** `useFibreBackfill(db, update, date, isPremium)` mounts where `useNutrientBackfill` was. It's the same shape: gated on `premiumSince`, keyed on `E.pendingFibreIds`, a `tried` ref, one batched call. The patch sets `computed_macros.fiber`, `fiber_est = true` and deletes `fiber_pending`. It also writes the per-unit fibre back onto the matching `db.foods` record (clearing its unknown flag), so that food never costs another call.
3. **Session cache:** a module-level `Map` keyed on `name.toLowerCase() + '|' + round(kcal per gram, 2)` holding fibre per kcal. Check it before any call, which also stops repeat calls while someone tweaks an amount.
4. Free users: no calls. Unknown fibre shows as `?`, and once per sheet a tappable `Fibre ? · Premium fills this in` opens `MPAYWALL({ type: 'fibre' })`. Add a `fibre` entry wherever paywall types are mapped to copy.

### 4e. Proxy (`supabase/functions/ai-proxy/index.ts`)
- `classify`: `if (p.includes('Estimate the DIETARY FIBRE')) return 'fibre';` (signature comment pointing at `aiEstimateFibre`).
- Free tier: 402 `{ type: 'premium_required', feature: 'fibre', message: 'Fibre estimates are a Premium feature.' }`, in the same block where density used to be.
- Premium: treat it exactly as density was treated for fair-use counting. If density was excluded from the monthly call count, exclude fibre too. Background estimates must never eat into a visible allowance.
- Redeploy the function after merging (`supabase functions deploy ai-proxy`).

### 4f. Showing estimates honestly
Everywhere fibre is shown per food, prefix estimated values with `~` and give them a `title="Estimated"`. The day totals don't mark it (a total is a total), but the Today detail sheet's Fibre row gets a muted subline `includes ~n g estimated` when any of today's fibre is estimated.

### 4g. Tests (`tests/fibre.test.js`)
- `needsFibre`: meat (0 carbs) is false, alcohol is false, kcal < 20 is false, beans with unknown fibre is true, known fibre is false.
- `clampFibre`: negative and NaN give null, 200 g at 100 kcal is capped, normal values pass and get rounded.
- `pendingFibreIds`: stable ordering, and only the given date.
- `edStamp` / `entryEd` fallback (from Phase 1).
- Engine `dayContextFor`-style fibre target: `fiberTarget` still clamps 18–38 (add the test if it doesn't exist).

---

## Decisions already made (so you don't need to ask)
- Old `nq` data stays in storage, untouched and unread except for `nq.ed`.
- Estimated fibre never changes kcal and never counts as a user correction.
- Fibre on the day (Today, detail, diary, progress) is free. Per-food **estimates** are premium. Fibre that the source already gives is shown to everyone.
- `isQualityDay` swaps "density day" for "fibre hit and calories in range".

## Suggested commit sequence
1. `Remove the Density Score` (Phase 1)
2. `Show item macros and day impact on every add` (Phase 2)
3. `Make fibre a first-class daily macro` (Phase 3)
4. `Estimate missing fibre for Premium with Haiku` (Phase 4, plus the proxy change and redeploy)
