# Buddy animation programme

## STATUS (2026-08-13): batches A, B and C are built and wired

15 animations came back from Claude Design as role-coded grids and are now live in the app at
sw 296. What landed: the forge (`tools/gen-anim.mjs`), 300 generated strips across 20 variants, the
generated manifest replacing the hand-written constants, the `Game.buddyAnim` intent layer with
tests, the reaction queue, and the sprite lab at `?demo&sprites`.

Still open from the sections below: `run`, `lift` and the rest of T3/T4 (never sent to Design), the
seasonal overlays in T5, and the wiring for animations that are generated but not yet triggered
anywhere (`sad`, `wake`, `talk`, `carry`, `blink`, `nod`, `shake`, `tilt`, `point`, `wave`, `yawn` -
the art exists and the lab plays it; only `eat`, `cheer`, `sleep` and `coma` have live triggers).


Companion to `design-exports/macrosaurus-sprite-inventory.pdf` (regenerate with
`tools/mk-sprite-pdf.py`). That PDF is the "what we have"; this is the "what next".

## Where we are

- 12 species x 2 colourways = 24 variants, 341 PNGs, ~1.4 MB.
- 15 strips per complete variant: 10 `base`, 3 `egg`, 2 `ghost`. 24x24 frames, horizontal strip,
  transparent, `frameCount = width / 24`, feet 3px above the frame bottom (egg 4px).
- Male Doux / Mort / Taro / Vita are missing idle, move, dash, hurt, kick, so they are female-only.
- **Already owned and not used: `base/kick`, `base/avoid`, `ghost/idle`, `ghost/move`, and the
  generated `base/coma` (female/doux only).** Free animation, sitting on disk.
- `gen-coma.mjs` proves the multiplier that makes all of this affordable: author **one** 24x24
  role-coded pose (`O` outline, `L`/`S` body, `C` crest, `B`/`b` belly, `E` eye), sample each
  species' own 7-role palette out of its `idle.png`, emit a finished strip. One template becomes
  12 species without a second drawing.

## The cost model (read this before choosing anything)

A new animation is **not** one drawing. Hand-drawn per variant it is 24 strips x 3-6 frames =
70-140 frames. Via the forge it is **one template of 2-6 keyframes**, full stop. So the plan is:
every new animation is authored once as a role-coded template and generated across the pack. The
only things worth hand-drawing per species are the ones where identity actually differs, and there
are none — all 24 share a silhouette.

---

## a) The animation list

Priority tiers. **T1** = build first, each one lands on a screen that already exists.

### T1 — the daily loop (8)

| Animation | Frames | The moment |
|---|---|---|
| `eat` / chew | 4 | You log a meal. The single most-repeated action in the app has no reaction today. |
| `cheer` | 4 | Day landed, protein hit, PB, trophy, streak milestone. One reusable celebration. |
| `talk` | 3 | Mouth flap under every coach line, morning read, lesson, breakout ask. Makes the Clippy layer read as speech instead of a caption. |
| `sleep` / snooze | 4 | Night hours, and the sleep-sync read. Buddy is asleep when you are. |
| `wake` / stretch | 5 | Morning read opens. The one animation people will see most and remember. |
| `sad` / droop | 3 | Lapse, missed check-in, day gone over. Empathy, not scolding — droop, not crying. |
| `coma` (own it properly) | 4 | **Exists** for female/doux. Over on calories. Currently `DAY_FLOURISH.full = null`. |
| `forage-out` / `return` | 4 + 4 | The foraging loop currently teleports. Walk out of frame, come back carrying something. |

### T2 — reaction and character (10)

`blink` (2, the cheapest life there is, layered into idle) · `yawn` (4, low sleep score) ·
`nod` / `shake` (2 each, the yes/no breakout ask) · `tilt` head (2, a question) ·
`point` (3, gesture at the thing it wants you to tap) · `wave` (3, hello, and the first hatch beat) ·
`shiver` (3, cold/dark theme flavour) · `scratch` (4, ambient) · `sniff` (3, ambient, pairs with `scan`) ·
`drink` (3, water logging if it ever lands).

### T3 — activity and fight (9)

`run` (6, step goal push, late-day steps nudge) · `lift` (4, the Training feature has no buddy on it at all) ·
`pushup` (4) · `jump-rope` (4) · `sweat` overlay (2) · `block` (3, fight) · `dodge` (use existing `avoid`) ·
`roar` / taunt (4, fight intro) · `victory` dance (5, fight win — `jump` is a stand-in today).

### T4 — moments and transitions (8)

`grow` pop (4, stage change) · `evolve` flash (5) · `hatch-wave` (first words beat) ·
`trophy` pose (3) · `weigh` step-on-scale (4) · `ghost-in` / `ghost-out` (3 each, we own the ghost body —
use it for the streak-broken state, which currently has no visual at all) · `spawn` / fade-in (3).

### T5 — seasonal and cosmetic (as capacity allows)

Santa hat, pumpkin, birthday cake, sunglasses, rain shelter. These are **overlays on the 24x24 frame**,
not new strips — one overlay template composited over any pose, so they multiply across everything.

### Deliberately not doing

Per-species personality animations (all 24 share a silhouette, so it would be 24 drawings for one idea),
and anything above 6 frames — the strip loader steps whole frames off one CSS keyframe, and long strips
read as video, which fights the Game Boy chrome.

---

## b) How we make them

**Phase 0 — harvest (no art at all).** Wire `kick`, `avoid`, `ghost/*` and `coma` into real moments,
and run `gen-coma.mjs` across the male colourways too. Ships character this week for zero drawing.

**Phase 1 — build the forge.** Generalise `gen-coma.mjs` into `tools/gen-anim.mjs`:
- Input: a template file per animation — a name, an fps hint, and 2-6 role-coded 24x24 keyframe grids
  plus a frame order (`[0,1,2,1]` style holds and ping-pongs, so 3 drawings become a 6-frame loop).
- Output: `sprites/<palette>/<species>/<group>/<anim>.png` for every variant whose palette can be
  sampled, **plus `sprites/manifest.json`** (frame counts, which variants have which strip).
- Guardrails baked in: baseline row locked (feet 3px up) so nothing hovers, transparent margin
  preserved, and a hard fail if a template's frame count changes without the manifest regenerating.

**Phase 2 — author in Claude Design.** Same workflow that produced the 24x24 icon set: Design draws
each keyframe as a pixel grid against the role legend (`O L S C B b E`), we save the grids as JSON,
the forge does colour and packing. Design never has to think about 24 colourways, only about pose.
Send the PDF plus the legend and the `base/idle` frame 0 of Olaf as the canonical rig.

**Phase 3 — batches.** T1 in two batches of four, each batch: author → generate → review in the
sprite lab (below) → wire → ship behind the normal build/test/screenshot guardrails. T2/T3 follow.

**Phase 4 — the artist, later.** When there is capital, a pixel artist redraws the *hero* poses
(idle, eat, cheer, talk, sleep) for a small number of species rather than repainting 341 files. The
forge stays: it is how the rest of the pack keeps up with anything hand-drawn.

## b2) How they get into the app

1. **Kill the hardcoded map.** `SPRITE_FRAMES` and `SPRITE_INCOMPLETE_MALE` in `app/src/app.jsx` are
   hand-maintained truth about files on disk — every new animation is currently a hand edit in two
   places. Replace both with the generated `sprites/manifest.json`, imported at build time.
   `spriteHasAnim` reads it. This is the prerequisite for everything else; do it in Phase 1.

2. **One intent layer, in `game.js`.** Today the decision of what the buddy plays is spread across
   `DAY_FLOURISH`, `buddyStageSprite`, `useIdleFlourish`, `FighterSprite` and `EnemySprite`, each with
   its own fallback. Add a pure `buddyAnim(state)` -> `{group, anim, fps, loop, priority}` next to
   `buddyMessage`, unit-tested the same way. One ranked ladder: one-shot reaction > situation
   flourish > ambient idle. Fallback chain requested -> family (`cheer` -> `jump`) -> `idle`, so a
   missing strip degrades instead of stalling (the current flourish stalls forever if a strip 404s).

3. **A reaction queue, not a flag.** `useIdleFlourish` holds one boolean. Reactions fire from events
   (meal logged, amber found, trophy) and will collide. Promote it to `useBuddyAnim` with a small
   queue: `play('eat')` enqueues, plays once, returns to whatever the intent layer says now. Keeps
   honouring `prefers-reduced-motion`.

4. **Prefetch the buddy's own strips.** A one-shot reaction that has to download misses its moment.
   After mount, warm just the chosen species' strips (~15 files, tens of KB) — not the pack.

5. **Sprite lab.** `?demo&sprites`: every strip for a variant, playing, with an fps slider and a
   species/palette switcher. Reviewing animation from static PNGs is guesswork; this is a half-day
   that pays back on every batch.

6. **Budget.** ~1.4 MB now. Each T1 animation across 12 female species is roughly 40-70 KB total.
   All of T1 lands under ~2 MB. Revisit if T3 goes wide.

7. **Per-batch guardrails** (unchanged): `node build.mjs`, `npm test`, bump `sw.js` VERSION,
   `?demo` screenshot at 390px in both themes.

## Order of work

Phase 0 harvest -> manifest + intent layer + sprite lab (Phase 1) -> T1 batch A (eat, talk, cheer,
sleep) -> T1 batch B (wake, sad, coma, forage) -> T2 -> T3/T4.
