# Fibre steps down a tier, and the tier is built to hold more

Fibre currently sits with protein, carbs and fat as a fourth macro. It has its own column, its own pip meter and its own colour in every surface. It should stay visible everywhere it is now, but it should read as **one step below** the big three: a goal you glance at, not one you budget against.

This plan does two things:
1. It sets up a **secondary tier** ("Also tracking") with one shared definition and one shared set of components.
2. It moves fibre into that tier on every surface.

Sugar, salt, saturated fat or water can then join the tier with a registry entry plus a data source, without another redesign.

Line numbers are approximate (from `app/src/app.jsx` at the time of writing), so search by **function name**.

Before every commit: `npm test`, then `node build.mjs`, then check Today, the log sheet and an add sheet at 320px and 390px, in light and dark.

---

## The rule: what "secondary" means visually

| | Primary (kcal, P, C, F) | Secondary (fibre, later others) |
|---|---|---|
| Position | its own column/row in the macro grid | one compact line **under** the primary block, after a hairline |
| Meter | 10-cell `PipMeter` | 5-cell `PipMeter small`, or none where space is tight |
| Label | macro ink, 12–13px, weight 600 | `--muted`, 12px, weight 600. Only the *figure* uses the nutrient's ink |
| Figure | `num` face, 16px | body face, 12–13px `tnum` |
| States | `left` / `over` (danger) | `goal`: "`n` g to go" → "hit" (`--good-ink`). `limit`: "`n` g left" → "`n` g over" in `--muted`. **Never** `--danger` |
| In strips | `P32 · C4 · F6` | after a wider gap, muted: `P32 · C4 · F6   Fib 3` |
| In forms | main grid | its own "Optional" row under the main grid |

Every number still appears on every surface it appears on today. Nothing gets hidden behind a tap. Fibre just loses its column, its full meter and its colour weight.

---

## Phase 1: The registry and shared components

### 1a. `SECONDARY` registry (`app/src/app.jsx`, next to `ONE_THING_COLOR` ~L4905)
```js
// Nutrients tracked one tier below the macros. Each one needs: a key on computed_macros, a daily
// target (or null for "show the total only"), and whether going past the target is good or bad.
const SECONDARY = [
  { key: 'fiber', label: 'Fibre', short: 'Fib', unit: 'g', kind: 'goal',
    color: 'var(--fib)', ink: 'var(--fib-ink)',
    target: et => E.fiberTarget(et.eff.kcal).min,
    skip: item => !!item.is_alcohol },
];
const secondaryFor = (et) => SECONDARY.map(n => ({ ...n, tg: et ? n.target(et) : 0 }));
```
- `kind: 'goal'` gives the current fibre behaviour ("to go", "hit", never over). `kind: 'limit'` is there for later sugar/salt/sat fat ("left", "over" in muted, never red).
- The `fibre: { state }` known/est/pending/unknown handling stays fibre-specific for now. Store it as `n.stateOf(entryOrItem)` on the registry entry, pointing at the existing `entryFibreState`, so a later nutrient can opt in.

### 1b. `SecondaryLine({ items, values, add, compact })`
One row per secondary nutrient (only fibre today), drawn as:
```
Fibre   ▮▮▮▯▯   12 of 30 g · 18 g to go
```
- Label `--muted` 12px/600, fixed width 48 (the same as AddImpact's labels so they line up).
- `PipMeter cells={5} small` in `n.color`, with `addValue={add[k]}` when `add` is given (the lighter preview fill already works). `overIsFine` when `kind === 'goal'`.
- Text: right-aligned 12px `tnum`, figure in `n.ink`, the rest in `--text2`. "hit" in `--good-ink`.
- `compact`: drops the meter and the "of N", leaving `Fibre 18 g to go`. This is for the log sheet header and anywhere under 360px wide.
- Optional heading prop `title="Also tracking"` (11px `pf` uppercase muted), only used in the detail sheet.

### 1c. `MacroStrip`: fibre as a trailing secondary
- Keep the `fibre` / `noFibre` props (tests rely on them). Render fibre after a wider separator (`' '`, an en-space, instead of `' · '`), at weight 400, with the number in `--fib-ink` and the `Fib` prefix in `--muted`. The `?`/`~`/`…` states are unchanged.
- Generalise later via `SECONDARY.map`. For this change, fibre is the only entry, so don't over-build it.

### 1d. Tests (`tests/fibre-ui.test.js`, plus a new `tests/secondary.test.js`)
- `SecondaryLine` goal: `9 g to go`, then `hit`, never `over`.
- `SecondaryLine` limit (use a fake registry entry in the test): `over` text present, and **no** `--danger` in the markup.
- `compact` has no "of".
- Existing `MacroStrip` assertions (`Fib 8`, `Fib ?`, `Fib ~4.3`, `Fib …`, `Fib 0`) must still pass unchanged.

---

## Phase 2: Move fibre into the tier, surface by surface

| Surface | Function (approx line) | Today | After |
|---|---|---|---|
| **Today hero** | `TodayHero` (~12795) | 4th column in `grid-cols-4` with a 10-cell meter | `MAC` loses the Fibre entry, and the grid goes back to `grid-cols-3`. Under the grid: hairline, then `<SecondaryLine items={secondaryFor(et)} values={tot} />`. P/C/F columns get wider, which also fixes the "g left" crowding at 320px |
| **Today detail sheet** | `TodayDetailSheet` (~12842) | Fibre `MacroRow` as the 5th macro | Four `MacroRow`s, then `SecondaryLine title="Also tracking"`. Keep the "includes estimated fibre" note as the line's subline |
| **Diary day card** | the `macroRows` IIFE (~14163) | `Fi` as a 4th meter row | Three rows (P/C/F), then `SecondaryLine` (with meter) |
| **Diary entry row** | entry row (~14079) | `6 g fibre` in `--fib-ink` | same text, but in `--muted` with only the number in `--fib-ink`. Keep the ≥ 0.5 g threshold |
| **Log sheet "Left today"** | `LogSheet` (~14973) | 4th column `Fib` with meter and flash | `grid-cols-3` for P/C/F. Under it, `SecondaryLine compact` plus the flash delta inline (`+3 g`) in `--fib-ink` |
| **AddImpact** | `AddImpact` (~4795) | Fibre as the 5th meter row | Four meter rows (kcal/P/C/F), then `SecondaryLine add={add}` (5-cell, preview fill). The "Fibre not known. Premium fills it in" button moves directly under that line, because that is where the `?` now is |
| **Item strips** | `MacroStrip`, `kcalLine`, generic/brand rows (~14818–14853) | `· Fib 3` coloured like a macro | trailing muted `Fib 3` (1c), applied automatically |
| **"Added" strip** | `LogSheet` bottom | `· Fib 9` | via `MacroStrip`, so it's automatic |
| **Quick add form** | `QuickAddTab` (~15034) | Fibre in a 4-wide grid with P/C/F | P/C/F in `grid-cols-3`. Below it, one row: `Field label="Fibre (g)" hint="Optional"` at half width. A blank box still means unknown |
| **Manual / Edit entry forms** | `ManualTab` (~15105), `EditEntryModal` (~14538) | Fibre paired with Calories | Calories keeps its place in the main block. Fibre moves to its own "Optional" row after it |
| **Edit entry heading** | `EditEntryModal` (~14499) | `P · C · F` | unchanged. Fibre is already in AddImpact below it |
| **Status row** | the steps/fibre fallback (~9054) | fibre fills the 3rd cell when no steps | **keep**. It's already only a fallback, which fits secondary status |
| **Progress** | `FibreWeekCard`, `StatTile` "Fibre" (~7235) | its own card and tile | **keep**. Progress is where secondary goals belong. Later, rename the slot "Also tracking" if a second nutrient joins |
| **Buddy / game** | `oneThing`, `dayQuality.fiberHit`, defence stat, Fibre Forest | fibre drives defence and creatures | **no change**. Mechanics are separate from layout |

**Behaviour stays the same:** the fibre target, the Premium estimates and backfill, `fiber_est`/`fiber_pending`, `isQualityDay`, and the paywall all stay as they are. This is a layout and visual-weight change only.

### Copy touch-ups
- Search for "fourth macro", "5th macro", or comments claiming fibre "sits with the macros" (e.g. the `AddImpact` doc comment ~4789, the diary entry comment ~14078) and reword them to "secondary".
- Update `DESIGN.md`: add a short "Secondary tier" section with the table from the top of this plan.

### Tests to update
- `tests/fibre-ui.test.js` "AddImpact says…" should still find `Fib 8` and `9 g to go`. Add an assertion that fibre is **not** drawn with a 10-cell meter (check the pip count in the rendered row, or a `data-tier="secondary"` attribute on `SecondaryLine`'s root, which is the simpler option).
- Search `tests/` for `grid-cols-4` and `Fi` row expectations (`meal-header-macros.test.js`, `log-sheet-left.test.js`, `display.test.js`) and update them to the 3-column layout.

---

## Phase 3 (later, not part of this change): adding the next secondary nutrient

The work per nutrient, so the scope is clear up front:

1. **Data.** Phase 1c of `FIBRE_MACROS_PLAN.md` deliberately stopped asking the AI for `sugars_g`, `salt_g` and `satfat_g`, and Open Food Facts/label extras were deleted. To bring one back you need to:
   - re-add it to `AI_PROMPT` / `LABEL_PROMPT`
   - read it from OFF `nutriments` and CoFID (sugars is already column `f[7]`)
   - store it on `computed_macros` and carry it through `sumMacros` and the scaling helpers (`base`/`total` in `EditEntryModal`, `per100` maths ~10070)
   - give it an "unknown versus 0" flag the same way fibre has one.
2. **Target.** Add an engine helper (e.g. `E.sugarLimit(kcal)` with NHS 30 g free sugars, or `E.saltLimit()` = 6 g), tested.
3. **Registry.** One `SECONDARY` entry with `kind: 'limit'`, colour tokens validated like `--fib`.
4. **Opt-in.** Secondary nutrients beyond fibre should be user-toggled in Settings (`db.settings.secondary = ['fiber', 'sugar']`). Fibre stays on by default, and the others default off, so the tier never grows into a second macro grid. `secondaryFor` filters by that setting.

Water fits the same model (`kind: 'goal'`, no per-food data, a total only), if that's ever wanted.

---

## Suggested commits
1. `Secondary tier: registry, SecondaryLine, quieter fibre in MacroStrip` (Phase 1)
2. `Fibre moves to the secondary tier on Today, diary, log sheet and add sheets` (Phase 2)
3. `DESIGN.md: document the secondary tier` (Phase 2 copy)
