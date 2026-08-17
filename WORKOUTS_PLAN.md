# Macrosaurus Training: plan and recommendations

Status: **plan only**, nothing built. Written 2026-08-09.
Companion docs: `PLAN.md`, `MACRODEX_PLAN.md`, `PRODUCTION-PLAN.md`.

---

## 1. What we are actually building

A training section that does three jobs, in this order of importance:

1. **Log a session fast**, in the gym, one-handed, offline. This is table stakes. If it is
   slower than the notes app we lose regardless of how clever the AI is.
2. **Hold a 4-week block** with real periodisation, so the user is progressing against a plan
   rather than improvising. This is what the plan-generation apps do badly and what coaches
   charge for.
3. **Get a plan in from wherever it already lives**: a saved Instagram reel, a coach's PDF,
   a spreadsheet, a screenshot, or typed by hand.

The wedge nobody else has: **Macrosaurus already knows what they eat, weigh, sleep and how many
steps they take.** Training data closes the loop. See §9, this is the part that matters
commercially.

---

## 2. Competitor read

Researched RepCount, 4WRD, Hevy, Fitbod, Boostcamp, Alpha Progression, Dr. Muscle.

| App | What it is | What it does well | Gap we exploit |
|---|---|---|---|
| **RepCount** | Pure logger, 1m+ downloads, free tier is generous | Pre-fills weights from last session, rest timer, cardio, no ads. Premium = supersets + e1RM/volume/PR graphs | No programming intelligence at all. It records, it does not coach |
| **4WRD** | Literally the 4-week-block idea, shipped | Fresh routine every 4 weeks, tempo guides, rest timers, bolt-on meal planning | Routines are handed down, not built around *your* history or *your* imported plan. Nutrition side is thin |
| **Hevy** | Social logger | Best-in-class logging UX, routine sharing, big free tier | No volume audit, no periodisation engine |
| **Fitbod** | Algorithmic session generator | Picks today's session from equipment + recovery. Paywalled after 3 workouts | Session-by-session, so there is no *block*. Progressive overload is emergent, not planned |
| **Boostcamp** | Library of 11,000+ named programs (5/3/1, nSuns, GZCLP) with auto-progression, free | Enormous free library, custom builder, no routine cap | Programs are static templates. No gap analysis, no import |
| **Alpha Progression** | Hypertrophy specialist | Strongest progression planning + volume-per-muscle awareness of the bunch | Closest competitor conceptually. Weaker on import, no nutrition loop |
| **Dr. Muscle** | AI autoregulation | Adjusts per set from performance | Opaque, expensive, feels like a black box |

**Conclusions to design against:**

- **Logging must be free and uncapped.** RepCount, Hevy and Boostcamp have all made a great
  logger free. Charging for logging reads as mean and kills the funnel. Olly's instinct
  (manual = free) is right and matches the market.
- **The paid thing is the thinking**, not the recording: gap analysis, block generation,
  progression decisions, and import.
- **4WRD proves the 4-week framing sells.** Nobody is doing 4-week blocks *plus* volume
  auditing *plus* import *plus* nutrition. That trio is the product.
- **Boostcamp's free library is a real moat** we should not fight head on. We should not try
  to be a program library. We should be the thing that takes *any* program, from anywhere,
  and audits and progresses it.

---

## 3. Training principles the engine encodes

Drawn from the evidence-based coaching lineage Olly named (JPS Health & Fitness program design,
Ryan Jewers, Jeff Nippard, Eric Helms) plus the RP volume-landmark framework they all share.
These are deliberately **deterministic rules in `training.js`, not things the AI invents.**
The AI proposes exercises; the maths judges them.

### Volume landmarks, per muscle, per week (hard sets)

| Landmark | Meaning | Default range |
|---|---|---|
| MV | maintenance | ~4-6 |
| MEV | minimum that grows | ~8-10 |
| MAV | the productive band we aim at | **10-20** |
| MRV | ceiling, fatigue outruns recovery | ~20-25+, highly individual |

Defaults per muscle, tightened by size and recoverability (side delts and calves tolerate
more, hamstrings and lower back less). These are **starting** numbers, adjusted per user over
blocks by observed performance (§6).

### Fractional set counting

An exercise contributes **1.0 set to its primary movers and 0.5 to its secondary movers.**
Romanian deadlift = 1.0 hamstrings, 0.5 glutes, 0.5 lower back. This is the standard
convention and it is what makes a coverage audit honest: without it, "chest day" looks like it
covers triceps when it does not, and a push/pull split looks like it under-trains delts when it
does not.

### House style: high intensity, lower volume, at least twice a week

Updated 2026-08-17. Olly's own preference, backed by two reference programmes he trains from (a
6-week straight-sets block and a 12-week RIR-based hypertrophy programme, both built around 2-3
hard sets a movement taken to genuine failure rather than 5+ sets stopped short of it) and by the
literature both programmes cite: hypertrophy rises as sets get closer to failure, with most of the
benefit inside 0-3 RIR (Robinson, Vigotsky et al. 2024, *Sports Medicine*, a meta-regression across
55 hypertrophy studies), and training a muscle at least twice a week is the sensible floor the
frequency research converges on (Schoenfeld, Grgic & Krieger 2019, *Sports Medicine*, the
volume-equated follow-up to their 2016 review). `generateBlock` in `training.js` now encodes this
directly rather than leaving it to chance:

- **Frequency is GUARANTEED, not aspirational.** Before any volume top-up runs, every muscle is
  checked against every session in the template; anything trained in fewer than two lands a second
  low-set exercise on a day of a compatible kind (a lower-back movement never gets dropped into an
  "Upper" day, which would also quietly reclassify the split). Splits that used to leave abs,
  obliques, lower back, forearms and front delts to whatever the old MEV gap-filler reached for
  first now always land on two different days.
- **Lower starting volume**: a movement starts a block on 2 working sets, not 3. Total sets still
  build across the block exactly as before; they just start from, and therefore land on, a smaller
  number throughout - because the case both reference programmes make, in their own words, is that
  "your intensity will determine the amount of volume you require... you do NOT need a ton of work
  when training with intent and high intensity."
- **Proximity to failure**: prescribe in RIR, walking 3-2-1-0 across the block so the final
  building week lands at TRUE failure (0 RIR), not a floor of 1. Stopping short of failure every
  week was never "high intensity" in the first place.
- **Rep ranges**: 5-30 all build muscle if effort is matched, but both reference programmes hold
  the majority of their work at 5-10 with long rest even on isolation and unilateral movements
  ("long rest periods are superior to short... this also applies to unilateral training"). Compounds
  stay 6-10, isolation moved from 10-15 to 8-12, isolation rest from 90s to 120s.
- **Exercise selection**: prefer a stable stimulus-to-fatigue ratio, and vary resistance
  profile within a muscle (one lengthened-biased, one shortened-biased, one mid-range) rather
  than three variations of the same curve.
- **Progressive overload, in priority order**: add reps within the prescribed range, then add
  load and reset to the bottom of the range (double progression), then add a set. Only then
  consider changing the exercise.
- **Deload**: week 4 (or week 5 if we run 4 accumulation weeks), roughly half the sets at the
  same load, or same sets at ~60% load.
- **Do not chase volume for its own sake.** If performance is falling week on week, the
  recommendation is to *cut* volume, not add. This is the thing cheap AI planners get wrong
  and the thing that will make our recommendations feel credible.

### Safety guardrails (non-negotiable)

The AI never diagnoses, never programs around an injury as though it were rehab, never
prescribes for under-18s, and always defers to a qualified professional on pain. One
persistent, quiet disclaimer, not a modal on every screen.

---

## 4. The 4-week block

```
Block (4 weeks) -> Week -> Session (day) -> Exercise -> Sets (target + actual)
```

**Default shape (accumulation, recommended):**

| Week | Intent | Volume | Effort |
|---|---|---|---|
| 1 | Introduce | MEV, 2 sets a movement to start | ~3 RIR |
| 2 | Build | +1 set on lagging muscles | ~2 RIR |
| 3 | Push | +1 set again, approaching MAV | ~1 RIR |
| 4 | Peak then deload | Overreach first half, deload second half, or full deload week | true failure (0 RIR), then easy |

Alternative shapes offered: **3 build + 1 deload** (default), **4 build, deload folded into
week 1 of the next block** (for people who hate deload weeks), and **linear strength** (top set
+ back-offs, load-led).

**End of block = the moment of value.** The block review screen is the retention hook:
what went up, what stalled, which muscles were under-covered, tonnage and e1RM deltas, and a
one-tap "build my next block" that carries the wins forward and fixes the gaps. This is the
equivalent of the Weekly Breakthrough for nutrition, and should feel like a payoff, not a report.

---

## 5. How it sits in the app

### Navigation, recommendation

The mobile redesign principle is **four tabs, no more** (see `macrosaurus-mobile-redesign`).
Training is too big to hide, so something has to give.

**Recommended:** `Today · Food · (+) · Train · Progress`, with **Cook folded into Food** as a
segmented control at the top of the Food tab (Log / Cook). Cook is a mode of dealing with food,
not a peer destination, and the Food tab is the natural home for it. The centre `+` becomes a
chooser (Log food / Log workout) rather than going straight to food logging.

Alternatives if that is too disruptive:
- **B:** Train lives under Progress as its own section. Cheapest, but buries a daily-use
  feature behind a weekly-use tab. Not recommended.
- **C:** Accept a fifth tab. Honest, but it breaks the redesign thesis and the bar gets cramped
  at 375px with the centre FAB.

### Screens

- **Train (tab home)** — today's session if one is scheduled, big "Start" button; otherwise the
  current block at a glance (week 2 of 4, three sessions left) and a quick "log a one-off".
- **Session player** — the in-gym screen. Exercise, target sets/reps/RIR, last time's numbers
  pre-filled, big number pads, rest timer, swipe between exercises. Must work offline and
  survive the screen locking. This screen deserves more design attention than any other.
- **Block builder** — the 4-week grid: weeks across, days down. Drag exercises in. Live
  coverage meter down the side.
- **Coverage panel** — the muscle map with weekly sets vs MEV/MAV/MRV per muscle. Deterministic,
  free to view for any plan you built manually; the *recommendations* it generates are Premium.
- **Import** — one sheet: paste a link, upload a file, take a photo, or type it out.
- **Block review** — end-of-block payoff, described above.
- **Exercise detail** — history, e1RM curve, PR list, which muscles it counts toward.

---

## 6. Data model

Lives in the same `db` blob the rest of the app uses, merged by the existing sync logic in
`store.js` (which is merge-based since the July data incident, so array handling needs the same
care, see `macrosaurus-data-incident`).

```js
db.training = {
  blocks: [{
    id, name, goal: 'hypertrophy'|'strength'|'general',
    startISO, weeks: 4, shape: 'build3-deload1',
    daysPerWeek, source: 'manual'|'ai'|'import',
    sourceRef: { kind:'instagram'|'pdf'|'xlsx'|'photo', url, importedISO },
    sessions: [{
      id, week, dayOfWeek, name: 'Upper A', scheduledISO,
      exercises: [{
        id, exerciseId, order, supersetGroup,
        target: { sets, repLow, repHigh, rir, restSec, tempo, loadPct },
        notes,
      }],
    }],
  }],
  logs: [{                        // one per performed session, keyed to a real date
    id, dateISO, blockId, sessionId, startedAt, endedAt, bodyweightKg, rpeSession, notes,
    sets: [{ exerciseId, setIndex, weightKg, reps, rir, type:'work'|'warmup'|'drop', done }],
  }],
  prs: { [exerciseId]: { e1rm, weight, reps, dateISO } },
  prefs: { units:'kg'|'lb', equipment: [...], experience, daysAvailable, sessionMinutes,
           dislikedExercises: [...], injuries: [...] },
  volumeTargets: { [muscle]: { mev, mav, mrv } },   // per-user, tuned over blocks
};
```

**Exercise library** ships as a static JSON asset (like `foods-uk.json`), roughly 250-350
entries: `{ id, name, aliases[], equipment, pattern, primary[], secondary[], unilateral,
resistanceProfile }`. Custom user exercises append to it. This library is the backbone: it is
what makes volume maths deterministic and what import resolves fuzzy names against. **Build
this first, it is the long pole.**

New pure module `app/training.js` (sibling of `engine.js`), fully unit-tested in `tests/`:
volume roll-up, coverage audit, e1RM (Epley), progression decisions, block generation from a
template. **No AI in this module.** Same discipline that caught the three live `foodKind` bugs.

---

## 7. Import

### From social (Instagram, TikTok, YouTube)

**This is largely already built.** `supabase/functions/recipe-extract` is a tested ladder that
pulls caption, description, auto-subtitles, cover image, video frames, and optionally a paid
speech-to-text transcript from exactly these three platforms, with host allow-listing against
SSRF and graceful `ok:false` degradation. A training import reuses it verbatim; the only new
work is a different AI structuring prompt and a resolver that maps extracted exercise names
onto library ids.

Rename it in the plan's head as `media-extract` if we generalise it, but do not refactor the
working thing on day one. Caption extraction remains available through the official APIs; the
existing scrape-with-fallbacks ladder is what already works and should stay.

Realistic expectations to set in the UI: a reel that *says* the workout out loud or shows it on
screen imports well. A reel that is pure vibes and a song does not. The import screen must
always land in an **editable draft**, never straight into a saved plan.

### From files

New action on the same function, or a small `workout-extract` sibling:
- **PDF** — coach's program. Text layer first, render pages to images and use vision if scanned.
- **XLSX / CSV** — the classic coach spreadsheet. Parse to a grid, hand the grid to the AI
  with the *structure preserved* (week columns, exercise rows), which is far more reliable
  than flattening to prose.
- **Images / screenshots** — vision, same path as the existing nutrition-label OCR.
- **Plain paste** — a chunk of text from a DM or a note.

Everything converges on one intermediate shape (the block JSON in §6) which is then shown as an
editable draft with a confidence flag on anything the resolver guessed.

---

## 8. Where AI is used, and where it is not

| Job | Who does it |
|---|---|
| Weekly sets per muscle, coverage vs MEV/MAV/MRV | `training.js`, deterministic |
| e1RM, PRs, tonnage, stall detection | `training.js`, deterministic |
| "Add a set to rear delts next week" progression | `training.js`, deterministic |
| Turning messy caption/PDF/spreadsheet into structured exercises | AI |
| Resolving "RDL" / "stiff leg dl" / "romanians" to a library id | Fuzzy match first, AI only on failure |
| *Which* exercise to suggest for an uncovered muscle | AI, choosing from library candidates the engine has already filtered |
| Writing the block review in the buddy's voice | AI |

The rule: **the AI never returns a number the engine can compute.** It returns choices and
prose. This keeps cost down, keeps it testable, and stops the classic "AI coach that
hallucinates 40 sets of chest" failure.

New `ai-proxy` features to gate, following the existing `featureOf` pattern:
`workout_import`, `block_generate`, `coverage_advice`, `block_review`.

---

## 9. The nutrition loop (this is the differentiator)

None of the competitors can do these, because they do not hold the food data:

- **Training days become high-carb days automatically.** `profile.cycling.highDays` already
  exists. Scheduling a block should offer to set the high days to the training days. This is
  a two-line product idea with an enormous "oh, that's clever" payoff.
- **Protein target sanity-checked against training volume.** Already computing g/kg LBM.
- **Check-in gets a training lane.** The weekly check-in already runs tracking lanes; add
  "sessions completed" and "volume vs plan" alongside weight and steps.
- **Weigh-in trend informs the block.** Stalling lifts on a cut is expected and should be told
  to the user as *expected*, not flagged as failure. On a bulk, stalling lifts means something
  else entirely. The training engine should read `program_mode` and the weight trend.
- **Game layer**: sessions completed feed the egg/streak the way steps do. A completed block is
  a natural trophy. Do not over-build this in v1.

---

## 10. Pricing

**Free**
- Manual block/routine builder, unlimited
- Full session logging, unlimited, offline
- Rest timer, last-time pre-fill, history, PRs, e1RM chart
- The coverage panel as a *read-out* on plans you built yourself

**Premium**
- AI block generation (4-week, periodised, from your history and equipment)
- Import from social, PDF, spreadsheet, photo
- Gap analysis with actual recommendations, and auto-progression week to week
- End-of-block review and next-block carry-forward
- The nutrition loop (carb cycling tied to training days)

This mirrors the food side exactly: logging is free, the thinking is paid. It also means the
free tier is genuinely competitive with RepCount and Hevy, which is what gets people in.

---

## 11. Build order

**P0 — foundations (no UI)**
Exercise library JSON + `app/training.js` + tests. Volume roll-up, fractional sets, e1RM,
coverage audit. Nothing user-visible. Do not skip or shorten this.

**P1 — the logger (free, ships alone and is useful)**
Train tab, session player, manual routine builder, history, PRs. Navigation change from §5.
This alone is a shippable product increment.

**P2 — blocks and progression**
4-week block model, block builder grid, week-to-week progression engine, deload, block review.

**P3 — coverage and AI generation (Premium)**
Coverage panel with recommendations, AI block generation, `ai-proxy` gating, paywall hand-offs.

**P4 — import (Premium)**
Social import on the existing extraction ladder, then PDF, then spreadsheet, then photo.
Editable draft flow with confidence flags.

**P5 — the loop**
Carb cycling on training days, check-in training lane, game hooks.

Each phase follows the house pattern: edit `app/` source, `node build.mjs`, bump the sw
`VERSION`, push `main`, verify live. Slices small enough to revert fast, as with the mobile
redesign.

---

## 12. Open questions

1. **Cardio and non-lifting sessions.** In scope, or lifting only for v1? Recommendation:
   log them, do not program them, and keep them out of the volume maths.
2. **Sharing.** Blocks are inherently shareable and that is free growth (the community cookbook
   pattern already exists). Recommendation: not in v1, but keep the block JSON clean enough
   that sharing is a later feature, not a rewrite.
3. **Apple Watch / wearable session capture.** Google Health is already wired for steps and
   sleep. Out of scope for now.
4. **Copy.** Everything user-facing follows `macrosaurus-copy-rules`: no em dashes, no named
   competitors, human British voice. The coaches named in §3 are internal reference only and
   must not appear in the product as endorsements.

---

Sources consulted: RepCount App Store listing, 4WRD on Google Play, Boostcamp comparison pages,
Fitbod AI fitness app guide, and volume-landmark references (MEV/MAV/MRV, 10-20 sets per muscle
per week).
