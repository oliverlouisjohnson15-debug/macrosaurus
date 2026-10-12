# 11 · Pay the written-down debts, then split the engine

Do this last. Plans 01–10 all add code to `app/training.js`, and moving it first would conflict with
every one of them.

## A · Debts from `TRAIN_AUDIT.md` "Deliberately not done"

Each is its own small commit, in this order.

1. **`TrainSettings` mirrors `prefs` locally.** `useState(t.prefs)` (`app/src/train.jsx:1089`)
   goes stale when another device or screen writes while it's open.
   - Read `t.prefs` straight from `db` on every render.
   - Writes go through `trainUpdate` with a functional merge (`tr.prefs = Object.assign({}, tr.prefs,
     patch)`), as the session player already does (`train-session.jsx:1600`).
   - Delete the local mirror.
   - Test: open settings, change `restTimer` from a second `update`, and settings shows the new
     value.
2. **Two devices adding a set at once collide.** Sets are matched by `itemId + setIndex`, and the
   higher `_rev` wins (`app/store.js:633–:640`).
   - Give every set an `id` (`'s' + trainUid()`) when it's created in the session.
   - The store merge unions by set `id` when both copies have one, and falls back to
     `itemId + setIndex` otherwise. Old logs are unchanged.
   - Test in `tests/store.test.js`: two copies each add a different set to the same item; after the
     merge both sets are present.
3. **The dead-control sweep only covers each screen's top level** (`tests/train-buttons.test.js`).
   Extend it one level: for each `ActionSheet` / `Sheet` the top level opens, open it and sweep its
   controls. Start with the session `⋯` menu and the swap sheet, since plans 01–03 add rows there.
4. **Unused engine exports.** List the `Training` exports that neither `app/src` nor `tests` reference:

   ```bash
   node -e 'const T=require("./app/training.js");const fs=require("fs"),cp=require("child_process");for(const k of Object.keys(T)){const n=cp.execSync("grep -rlw \""+k+"\" app/src tests tools app/*.js | grep -v app/training.js || true").toString().trim();if(!n)console.log(k)}'
   ```

   Remove each from the export object only. Keep the function if it's used internally.

## B · Split `app/training.js` (6,555 lines)

### Constraints

- `build.mjs` (`:109`, `:166`) inlines `app/training.js` as one `<script>`, which publishes
  `window.Training`.
- 14 tests and tools `require('../app/training.js')`.
- The engine is pure and has no React.

### Shape

- Files: `app/training/*.js`, each a plain script that adds to a shared object. There is no bundler
  in the engine path, and introducing ES modules here would change how `build.mjs` and every test
  load it.
  - `00-core.js`: muscles, landmarks, styles, `round`, `norm`
  - `10-library.js`: exercise table, variations, resolve, brands (plan 02), cues (plan 10)
  - `20-maths.js`: volume, coverage, strength, records (plan 06), load specs (plan 03),
    progression (plan 04)
  - `30-blocks.js`: blocks, stored-small, rotation, rerun, review
  - `40-programmes.js`: `PROGRAMMES`, `PROGRAMME_ADDITIONS`, priority (plan 05)
  - `50-import.js`: spreadsheet, file and history imports (plan 08)
  - `60-gyms.js`: gyms, `applyGym` (plan 01)
  - `90-export.js`: builds the `Training` object and does the `module.exports` / `window` publish
- **`app/training.js` stays** as the entry point. For Node, it concatenates and evaluates the parts
  in filename order, so every existing `require` keeps working. For the browser, `build.mjs`
  concatenates the same files in the same order before `minJs`.
- Move code **without editing it**: one commit per file moved, each passing `npm test`. Use the
  section banners already in the file (`// ---- muscles ----` at `:38` and so on) as the cut lines.

### Verify

- `npm test` passes after every commit.
- `node build.mjs` produces an `index.html` whose `Training` has exactly the same `Object.keys` as
  before the split. Add a test that snapshots the key list.
- The bundled size is within 1% of today's.
