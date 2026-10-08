# 35 · Reset — what openGym can give Train

Asked 2026-10-08: *can we use https://github.com/alexpcosta/opengym in the Train module to make big
improvements, but keep it in our UI theme?* Read at its `main` HEAD (shallow clone).

## Short answer

**Use its ideas, not its code.** openGym is licensed **AGPL-3.0-or-later** (`LICENSE`, `NOTICE.md`,
`frontend/package.json`). Copying or adapting its source into Macrosaurus would make Macrosaurus a
derivative work under the AGPL. Because Macrosaurus is served over a network, AGPL §13 would then
require offering **the complete source of Macrosaurus** to every user. That includes the nutrition
engine, the buddy game and the Premium features. That's a business decision, not a design one, and
the default answer is no. (This is a reading of the licence, not legal advice.)

Features and behaviours aren't covered by copyright, though. Each feature below can be rebuilt in our
own code, on our own primitives and in our own look, which is the "keep it within our UI theme"
part anyway. Their React components wouldn't fit our design system without a rewrite.

Two of its ingredients are **not** AGPL and can be used directly, from their upstream sources:
- **Muscle map outlines:** [melihcolpan/MuscleMap](https://github.com/melihcolpan/MuscleMap), **MIT**.
  Take them from upstream with its notice, not from openGym's converted copy.
- **Exercise metadata and instruction text:** [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset),
  **MIT**, 1,324 exercises in 10 languages. The **images and GIFs are © Gym visual** and need our own
  licence from gymvisual.com before we ship them.

## What openGym is

A self-hosted gym and body-weight tracker. React 19, Vite, zustand, a Node API and Docker, plus a
Capacitor mobile build. This fork (`alexpcosta`) adds an **AI Coach** on top of
[DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym). The Coach designs plans and proposes
explained, revertible changes, while a deterministic engine owns the session-to-session weights
(`docs/AI_COACH.md`). That split is the same one Macrosaurus already has between `training.js` and
the rerun/review flows.

## Feature gap (openGym README vs Macrosaurus `training.js` / `train-*.jsx`)

| openGym feature | Macrosaurus today | Worth it? | Where it lands in the reset IA | Size |
|---|---|---|---|---|
| **Screen stays awake during a workout** (`lib/wakelock.js`) | none | **Yes.** Cheap, and fixes a real gym annoyance | Session | S |
| **Timed exercises** (planks, hangs, carries) with a work timer separate from rest | reps only | **Yes.** Our plans already include "Dead Hang" with a seconds note | Session | M |
| **Muscle map** (front/back body shaded by work, names muscles not trained) | text coverage screen (`coverage`) | **Yes.** It turns our coverage data into one glanceable picture | History → Lifts, and Block preview | M |
| **Activity heatmap** (year view) | none | Maybe. Pretty, but it duplicates the week strip. Put it in History only | History | S |
| **Import from Strong / Hevy / FitNotes CSV**, plus Apple Health weight | AI import of a plan from a reel/PDF/screenshot. No history import | **Yes.** The biggest switching cost for lifters coming from Hevy/Strong | Block → "Bring your history" | M |
| **Progression rule per routine** (linear, Greyskull LP, double progression, time) with "why this number" | double progression + deload in `training.js`. A target reason exists in places | Partly. Surface the *why* in the session. Adding new rule types is a training-logic change, so ask first | Session (why), Block (rule) | M–L |
| **Estimated 1RM curve per exercise** | e1RM computed | Already there. Give it a chart on the lift detail | History → Lift | S |
| **Effort per set, RIR or RPE** | RIR | RPE as a display option only | Settings | S |
| **Supersets** | yes | n/a | n/a | n/a |
| **Reschedule a day without touching the plan** | "Change days" / schedule | Already there | Block | n/a |
| **Share a plan as a file / PDF** | none | Low priority | Block | S |
| **Push: rest-timer alert with the app closed** | in-app rest timer | Maybe. Needs the push setup checked in `sw.js` | Session | M |
| **Exercise library: 1,324 with animated demos** | 440 exercises, no demo media | Metadata yes (MIT). Media only once licensed | Library picker | M (+ licence) |
| **AI Coach** | already has plan building, rerun, review | No. We have our own | n/a | n/a |

## Recommendation

1. **Don't vendor any openGym code.** If the owner ever wants to, the alternative is to ask the
   copyright holders (Duarte Santos, and the fork author for the Coach) for a separate commercial
   licence.
2. **Rebuild the "Yes" rows clean-room**, from the README's feature descriptions only, after the
   Train presentation collapse in phase 5 (`01-direction.md` §1.3). Each lands in one of the four
   Train places, drawn with the shared `Row` / `Section` / `Hero` primitives in whichever direction
   is picked. For example, the muscle map is ink outlines with macro-hue fills in A, and soft fills
   in B.
3. **Phase 5b, "Train additions"**, as its own PR so it's reviewable apart from the redesign: wake
   lock → timed exercises → muscle map → CSV history import. Timed exercises and history import add
   new data to the training log, so they need the owner's OK before building (**owner decision T1**).
4. **Exercise media:** ask Gym visual for a licence, or keep the library text-only (**owner decision
   T2**).
