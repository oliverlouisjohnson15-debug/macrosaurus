# 05 · Programme balance: build the V-taper, keep the authors' words

## The review

The four programmes, read the way a classic-physique competitor would read them. That division is
judged on the V-taper: wide side delts, a small waist, full upper chest, and legs that match. Below
are weekly **hard sets** per muscle, counting 1.0 for a primary mover and 0.5 for a secondary, as
`training.js` does. These are the numbers today and after this plan (reproduce them with the script
in Verify).

| | Side delts | Rear delts | Chest | Calves | Forearms | Biceps | Quads | Hamstrings |
|---|---|---|---|---|---|---|---|---|
| Raptor | 5 → **7** | 2.5 → 4.5 | 4 → **6** | 3 | **9.5** → 5.5 | 7 | 5 | 5 |
| T-Rex | 6 → **8** | 3 → 5 | 6 → 7 | 4 | **10.5** → 6.5 | 9 | 8 | 5 |
| Brachio | **3** → **7** | 4 | 8 | **0** → **4** | 3 | 9 | 10 | 5 → 7 |
| Stego | 5 → **7** | 5 → 7 | 8 | 4 | 2 | **11** → 10 | 6 → **8** | 5 |

What's wrong, programme by programme:

- **Every programme**: side delts are near the bottom of the table. For this physique they should be
  near the top.
- **Raptor / T-Rex**: forearms are the most-trained muscle. The shared "Arms and delts" day spends
  three of nine slots on wrist curl, wrist extension and dead hang. Raptor gives chest four sets a
  week and has no fly.
- **Brachio**: no calves at all. No hip hinge (hamstrings only get the lying leg curl). Side delts
  are trained once a week, on arms day.
- **Stego**: biceps outrank chest and quads. Quads get leg extension on Legs 1 only.

## Constraint (owner decision D1)

- Raptor and T-Rex come from the author's spreadsheets and are checked cell by cell by
  `tools/verify-programmes.mjs`. Don't edit their lines.
- Brachio's movements, sets and reps are the author's (provenance comment above `bb5` in
  `app/training.js`). Don't edit them either.
- **Stego is ours** ("Written the house way", comment above `mach5`), so it's edited directly.

## Changes

### 1. Stego, edited in place (`PROGRAMMES` entry `mach5`, `app/training.js`)

| Day | Change | Why |
|---|---|---|
| Pull | Machine preacher curl `sets: 3 → 2` | Biceps 11 → 10, which pays for the two below |
| Pull | **add** `machine_rear_delt` 2 × 8–10, RIR 0/0, 90 s, alts `cable_rear_fly`, `lying_reverse_dumbbell_fly` | Rear delts get direct work |
| Pull | **add** `cable_lateral` 2 × 8–10, RIR 0/0, 90 s, alts `machine_lateral`, `db_lateral` | A second side-delt day |
| Legs 2 | **add** `leg_extension` 2 × 8–10, RIR 0/0, 90 s, after the pendulum squat | Quads 6 → 8 |

Each new line gets a `planNote` in the house voice. Put the side-delt raise **before** the preacher
curl on Pull: a priority muscle goes earlier in the session.

### 2. "Macrosaurus additions" for the three author programmes

- **Engine:** add `var PROGRAMME_ADDITIONS = { mac4: [...], mac5: [...], bb5: [...] }` next to
  `PROGRAMMES`. Each op is one of:
  - `{ day: 'Upper', op: 'add', line: {...} }`
  - `{ day: 'Arms and delts', op: 'replace', exerciseId: 'wrist_curl', line: {...} }`
- Every line an op produces carries `addedBy: 'macrosaurus'` and a `planNote` that starts
  "Not in the original programme:".
- The ops:

| Programme | Day | Op |
|---|---|---|
| Raptor `mac4` | Upper | add `pec_deck` 2 × 8–10 |
| Raptor `mac4` | Arms and delts | replace `wrist_curl` with `machine_rear_delt` 2 × 8–10 |
| Raptor `mac4` | Arms and delts | replace `dumbbell_wrist_extension` with `db_lateral` 2 × 8–10 |
| T-Rex `mac5` | Upper 2 | add `pec_deck` 1 × 8–10 |
| T-Rex `mac5` | Arms and delts | the same two replacements as Raptor |
| Brachio `bb5` | Upper 1, Upper 2 | add `machine_lateral` 2 × 10–12, after the Smith incline |
| Brachio `bb5` | Lower 1, Lower 2 | add `standing_calf` 2 × 8–10, last |
| Brachio `bb5` | Lower 2 | add `rdl` 2 × 6–8, RIR 2/1, 150 s, after the split squat |

- `programmeBlock(key, opts)` (`app/training.js:4499`) gets `opts.additions` (boolean). When true,
  apply the ops to a deep copy of the template before `blockFromTemplate`. Set
  `sourceRef.additions = true`. When the block reruns (`app/src/train-build.jsx:1225`), carry the
  flag through from `block.sourceRef`.
- `programmeSummary` reports both versions, so the card can say "+4 side-delt sets, +4 calf sets".
- **Builder UI:** when the draft came from an author programme (`sourceRef.kind === 'programme'`
  and the key has additions), show a `Row` with a toggle in `BlockBuilder`
  (`app/src/train-build.jsx:987`):
  - title "Macrosaurus additions"
  - sub: the summary, e.g. "+4 side-delt sets, swaps wrist work for delts"
  - default **off**
  - toggling it rebuilds the draft with `programmeBlock(key, { additions })`, keeping the start date
    and name.
- **Session UI:** lines with `addedBy` show a small "added" `Pill` beside the name, so nobody
  mistakes them for the author's.
- `tools/verify-programmes.mjs` keeps checking the **untouched** templates. Add an assertion that
  `PROGRAMME_ADDITIONS` never mutates `PROGRAMMES`.

### 3. Priority muscle (any block, any programme)

A bodybuilder picks a weak point per block and gives it more work, earlier in the session.

- **Engine:** `Training.applyPriority(block, muscle, opts)`. For each session that already trains
  `muscle` as a primary mover, it does two things:
  - Adds one set to the **first** line that trains it as a primary mover.
  - Moves that line to just after the session's first compound, never ahead of it, because the
    heavy opener stays first for safety.
- To keep the session length steady, take one set off the line with the most sets in the session
  that **doesn't** train `muscle` and is an isolation movement. Skip it if that line has only 1 set.
- Lines it changes carry `priority: true`. Store the muscle on `block.priority`.
- Tests: side delts on Stego goes 7 → 10 and session set totals don't change. A muscle the block
  never trains gets an error back.
- **UI:** a `Row` "Priority muscle" in `BlockBuilder` (and on the block review screen for the next
  block, `BlockReviewScreen`, `app/src/train.jsx:385`). It opens a picker of `Training.MUSCLES` with
  "None" first. The sub shows the effect: "+3 side-delt sets, earlier in the session".
- It's reapplied at rerun and `nextBlock` only if the person keeps it. The review screen asks
  "Keep side delts as your priority?".

## Verify

Per-muscle counts (the table's numbers):

```bash
node -e 'const T=require("./app/training.js");for(const p of T.PROGRAMMES){const m={};for(const s of p.template)for(const e of s.exercises){const x=T.byId(e.exerciseId)||{};(x.primary||[]).forEach(k=>m[k]=(m[k]||0)+e.target.sets);(x.secondary||[]).forEach(k=>m[k]=(m[k]||0)+e.target.sets*0.5)}console.log(p.name,m)}'
```

Run the same count over `programmeBlock(key, { additions: true })` week 1 sessions for the "after"
column.

- `tests/training.test.js`:
  - Stego's per-muscle counts match the table.
  - With additions on, Raptor, T-Rex and Brachio match the table.
  - With additions off, every author template is identical to today's (deep-equal against a frozen
    copy).
  - `applyPriority` cases as above.
- `node tools/verify-programmes.mjs` still passes, if the sheets are available locally. If not, say
  so in the PR.
- `tests/render.test.js:77–:89` (programme names and blurbs on Blocks) still pass.
- `?demo`: start Brachio with additions on. Lower 1 ends with Standing calf raise marked "added".
  Start it off: identical to today.
