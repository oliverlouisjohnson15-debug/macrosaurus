# Merge days: a 4-day week out of a 5-day block, this week only

Status: **built** (engine, tests, Train tab lever). Decided: a merge applies to ONE week only, and
the next week is the normal plan without anything being undone; merging is repeatable (merge a merge,
merge in any current or future week, split back at any time before the merged session is started).

Shipped as: `Training.mergePlan / mergeSessions / splitSession / mergeSuggestions / weekOverbooked`,
`MergeDaysSheet` + week-card wiring in `app/src/train-tab.jsx`, tests in `tests/merge-days.test.js`.
Not built from §4: drag-one-session-onto-another (dropping on a day still means "move").

---

## 1. The problem, on real data

Olly's live block (PPL Hybrid, started 16 Nov, so 25 Nov is **week 2**):

| Day | Session | State |
|---|---|---|
| Mon | Upper | done |
| Tue | Legs 1 | done |
| Wed | Push | left |
| Thu | Pull | left |
| Fri | Legs 2 | left |

There is time for one more upper session, not two. Today the options are bad ones:

- **Skip Push or Pull.** Chest, delts and triceps (or back and biceps) drop from twice a week to once.
  Nothing records that it was a choice, and `rotationPlan` later reads it as "you skipped N of the
  sessions it was in".
- **Run both back to back.** 33 sets, which is the time you don't have.
- **`setDaysPerWeek(4)`.** Permanent, for every week left, and it drops days off the *end* of the
  week (Legs 2), which is the wrong day.

What's wanted: **one session that has the Upper day's volume, built from the Push and Pull days'
exercises.** Every muscle still gets its second hit this week, and the session is the length of a
normal Upper day.

## 2. The rule: mirror a reference day, slot by slot

Prototyped against the live week-2 data (scratch script, not committed). The result:

```
MERGED: Push + Pull, at Upper's volume (week 2)
 sets  exercise                   where it came from
   2   Smith machine incline press  Push pick, in Upper's incline slot
   2   Flat machine press           Push pick, in Upper's flat-press slot
   2   Lat pulldown                 Pull pick, in Upper's pulldown slot
   2   T-bar row                    Pull pick, in Upper's row slot
   2   Pec deck                     Push pick, in Upper's pec deck slot
   2   Overhead cable extension     Push pick, in Upper's triceps slot
   2   Hammer curl                  Pull pick, in Upper's curl slot
   3   Seated machine lateral       Push pick, in Upper's lateral slot
  ---
  17 sets  (Upper is 17; Push + Pull is 33)
  left out: shoulder press, Atlantis tricep press, preacher curl, Kelso shrug, pullover
```

### How it works

1. **Pick the reference day** (the "volume model"). For the two days being merged, A and B:
   - Candidates are the block's other sessions **in the same week** (so the reference carries this
     week's progressed set counts, not week 1's).
   - Score each one by how well its primary muscles cover A ∪ B (overlap, minus muscles it trains
     that A ∪ B doesn't). Push + Pull → Upper wins clearly; Legs 1 scores ~0.
   - Tie-break on `kind` (`push` + `pull` → `upper`), then nearest earlier in the week.
   - If no candidate clears a threshold (e.g. merging Pull + Legs 2: there's no "pull + legs" day),
     fall back to **§2.3**.

2. **Fill each reference slot with the best Push/Pull exercise.** For each line of the reference, in
   order, take the best unused line from A ∪ B:

   | Score | Match |
   |---|---|
   | 100 | same `exerciseId` |
   | 90 | same base exercise (variant/kit difference) |
   | 80 | `sameJobFor` pair |
   | 40 + … | same lead primary muscle, +10 per shared primary, −8 per extra primary, +15 same pattern |

   The slot takes the **reference's set count** and the **A/B line's everything else** (rep range,
   RIR, rest, tempo, notes, alts, slot pick, `sourceName`), so it logs and progresses exactly like
   the Push/Pull line it came from. A slot nothing in A ∪ B can fill (score < 40) **keeps the
   reference's own exercise**: that's the "where possible".

3. **Fallback when there's no good reference: budgeted greedy.** Per-muscle budget =
   `plannedVolume(A ∪ B) × (typical session sets / (sets A + sets B))`. Interleave A and B's lines
   (A1, B1, A2, B2: antagonist pairs, superset-friendly), give each line
   `min(its sets, remaining budget of its lead muscle)`, and drop lines once the budget is spent.
   Lines are never cut to 1 set when they were written as 2 or more. Drop them instead, since a
   1-set line still costs its warm-ups. (Prototyped; without that rule it produced a 1-set
   pulldown.)

4. **Frequency guard (both modes).** After building, any muscle that A or B trained as a *primary*
   and that now gets **zero primary sets across the whole week** gets its best left-out line added
   back at `min(2, sets)`. This is the "keep as much frequency as possible" promise made explicit.
   (On Olly's week nothing triggers. Traps aren't a separate muscle in the model; shrugs count as
   upper back, which the T-bar row covers.)

5. **Dedupe.** The same exercise on both days (Pec deck, incline here) is one line, never two.

## 3. Data model: one-off, reversible, history-safe

Same philosophy as `setSessionDay`: **this week only**, nothing logged is touchable.

`Training.mergeSessions(block, idA, idB, opts) → { block, session, ref, left, mode }`

- Removes A and B from the week's `sessions` and inserts one merged session:
  ```js
  {
    id: blockId + '_w2m' + n,          // NOT the _w<N>d<N> shape, see below
    week: 2, dayOfWeek: <A's day or chosen>, kind: 'upper', name: 'Push + Pull',
    focus: 'Upper volume, Push & Pull picks',
    merged: { from: [sessionA, sessionB], ref: refSessionId, mode: 'mirror' | 'budget' },
    exercises: [ ...lines, each with a fresh id and `mergedFrom: <original line id>` ],
  }
  ```
- **Refuses** if either session has a log (open or finished), or isn't in the current week.
- `Training.unmergeSession(block, mergedId)` puts `merged.from` back verbatim (refused once the
  merged session has a log). The Undo toast uses this.
- `Training.mergeCandidates(block, logs, todayISO)` returns the best pair(s) among this week's
  unlogged sessions with a preview, so the UI can suggest "Merge Push + Pull" without the user
  choosing.

### Why this shape is safe with what's already there

| Consumer | What happens | Change needed |
|---|---|---|
| `completion` / `blockWeeks` | Week becomes 4 sessions, so **4 of 4 = full week** | none, which is the point |
| `packBlock` | Week shape differs, so pack's own round-trip check bails and stores unpacked | none (verified by reading `packBlock`) |
| `dayKeyOf` / `slotKeyOf` | `_w2m0` doesn't match `_w\d+d\d+`, so it falls back to name/day keys; merged line ids lack `_w<N>` so they won't be swept up by "change this line for the rest of the block" | swap/target editors on a merged session should act **this session only** (pass `fromWeek` past this week, or hide "rest of block") |
| `templateOf` / `setDaysPerWeek` / sharing | Reads week 1. If week 1 was merged it'd lose a day | `templateOf` expands `merged.from` back into A and B |
| `reschedule` / `scheduleOf` | Session lists per week are no longer parallel across weeks | `reschedule` matches by `dayKeyOf` rather than index, or skips merged weeks |
| `rotationPlan` "missed" | Push/Pull ids have no log, so they'd count as skipped | count a session as attended if a merged session lists it in `merged.from` and that one is logged |
| `lastReference` / progression | Keyed by `exerciseId`, so next week's Push sees this week's incline numbers | none |
| `prefillSets` | Uses the line's own target, which is the reference set count | none |
| `restDaysOfWeek` | Thursday becomes a rest day | none, which is correct |

## 4. The lever (UI)

Train tab, this-week card (`train-tab.jsx`, next to the drag-to-move-day code):

1. **Auto-surfaced when it matters.** When `unlogged sessions this week > days left in the week`
   (Wed, 3 left, Wed–Sun has 5 days, so no nudge yet; Fri with 3 left, yes), show a quiet row:
   *"Short on time? Merge Push + Pull into one Upper-sized session."*
2. **Always available** from a session's ⋯ menu: *"Merge with…"*, listing the week's other
   unlogged sessions, best match first, each with a one-line preview ("17 sets · Upper's volume").
3. **Drag a session onto another session** (the drag zone already exists for days). Dropping on a
   card instead of a day asks "Merge Push into Pull?".
4. **Preview sheet before applying:** the table from §2 (exercise, sets, "Push pick / Pull pick /
   kept from Upper"), the totals ("17 sets, about 60 min, vs 33"), and what's left out. Tapping a
   row swaps it for another left-out line covering the same slot.
5. Apply, then toast: *"Push + Pull merged for this week."* **Undo.**
6. Merged session card shows a small "merged" tag. Its ⋯ menu offers **Split back**.

## 5. Build order

1. `mergeSessions` / `unmergeSession` / `mergeCandidates` in `app/training.js`, plus export.
2. Tests in `app/engine.test.cjs`: PPL Hybrid week 2 (fixture = programme block with Upper and
   Legs 1 logged), asserting the §2 table, 17 sets, refusal on logged sessions, unmerge round-trips
   to an identical block, `packBlock`/`unpackBlock` round-trip, `completion` reports 4/4 after
   merged + others logged.
3. The §3 consumer fixes (`templateOf`, `reschedule`, `rotationPlan` missed count, this-session-only
   editing on merged lines).
4. UI: ⋯ "Merge with…" and the preview sheet first, then the auto-nudge, then drag-onto-session.

## 6. Open questions

- **Should it ever do a permanent version?** "Merge Push + Pull for the rest of the block" is easy
  on top of this (apply per week with each week's own Upper as reference), but it overlaps with
  `setDaysPerWeek(4)`. Suggest: this week only for v1.
- **Three into two?** (e.g. only 3 days in a week.) The same function can be applied twice; worth a
  test but not a UI path yet.
- **Reference with optional sets.** Upper's curl and triceps lines are "2-3" (`setsOptional: 1`).
  Proposal: the merged line inherits the reference's `setsOptional` too, so it's "2-3" in the merged
  session as well.
