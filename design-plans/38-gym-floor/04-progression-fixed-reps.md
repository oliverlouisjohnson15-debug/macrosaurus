# 04 · A fixed rep target still has room to progress

## Evidence

- All 29 of Brachio's lines have `repLow === repHigh` (6–6, 8–8, 10–10). Every other programme
  writes a range.
- `progressExercise`'s min-max branch (`app/training.js:1963–:1986`) has three outcomes:
  - `reps >= repHigh`: add load.
  - `reps >= repLow`: same weight, one more rep.
  - otherwise: 10% off.
- With low = high = 6, the middle outcome can never happen. Six reps adds load. Five reps, one short
  after a jump, drops 10%. So progress runs in a sawtooth: up a notch, miss by one, down 10%. (I
  haven't checked the owner's logs for this pattern; the replay under Verify does.)
- `minmaxPlateau` treats three identical sessions as a stall. Under the sawtooth, a lifter who is
  progressing never repeats, and one who isn't gets sent down instead of being told to swap.
- Brachio's reps are the author's own (see the provenance comment above the `bb5` entry). Changing
  them to ranges would put words in the author's mouth (owner decision D1).

## Design

**The written target stays as written. The engine progresses inside a window.** For min-max
progression only, a fixed target `n` is treated as `n … n+2`.

- At `n+2` or more: add load.
- From `n` to `n+1`: same weight, beat last time by a rep.
- Under `n`: 10% off, as today.

Two reps is the standard double-progression window, and it's the smallest one that leaves a middle
outcome. The person still sees "6 reps". The coach line explains the window.

## Changes

1. **Engine: `function progressionWindow(target)`** in `app/training.js`, next to `progressExercise`.
   It returns `{ low, high, fixed }`: `high = target.repHigh > target.repLow ? target.repHigh :
   target.repLow + 2`, and `fixed = target.repLow === target.repHigh`. Export it.
2. **Use it in the min-max branch** of `progressExercise` (`:1975` and `:1981`), in place of
   `t.repHigh` and `t.repLow`. Leave the non-min-max branch alone. It reads `minReps >= t.repHigh`
   across all sets, which already works with a fixed target.
3. **Reasons say what happened.** When `fixed` and `reps` is between `low` and `high - 1`:
   "The plan says {low}. You got {reps}, so same weight and go for {reps + 1}. At {high} it goes up a
   notch." When `fixed` and load is added: "{reps} on a {low}-rep line is two over. Up a notch."
4. **`prefillSets`** (search for it in `training.js`) uses the same window wherever it compares
   reps to the target, so prefill and progression agree.
5. **Nothing changes in the data.** The block still stores `repLow === repHigh`. The session header
   still shows "6 reps". `TargetSheet` (`app/src/train-build.jsx:2154`) shows the window as a
   13px detail line, "Progresses at 8", but only when `fixed`.

## Verify

- `tests/training.test.js`:
  - fixed 6, got 6 → `reps`, same weight
  - fixed 6, got 8 → `load`
  - fixed 6, got 5 → `lighter`
  - range 6–8, got 8 → `load` (unchanged)
  - every existing progression test passes untouched
- Replay the owner's Brachio T-bar row history through `progressExercise`. Compare old and new
  suggestions in the PR description, as a table.
