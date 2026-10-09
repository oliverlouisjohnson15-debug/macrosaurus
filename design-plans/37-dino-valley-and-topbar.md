# 37 · Dino Valley + one dino in the top bar

Status: BUILT 2026-10-09 (option A, and the full top-bar repertoire). Design proposed and approved the same day.
Where it lives: `ValleyScene` / `ValleyBuddy` / `BUDDY_SPOT` (app.jsx, above `Dialogue`), `BarBuddy` + `MobileHeader`,
`Game.barAnim` / `Game.barBeat` (game.js, tested), `setBarRest` fed by the Train session, styles under
"DINO VALLEY" and "THE APP-BAR BUDDY" in styles.css. Deviations from the prompt below: the valley is a
plain SVG on the --terra-* tokens rather than a TerrariumCanvas variant (a static scene needs no repaint on
theme flip), and the bar's rest-over wave is the pacer's own pose rather than a queued reaction. Canvas: https://claude.ai/artifact/1wJf84oxaUhMoHYK2Aqeij
(boards: "Now", "A · Dino Valley day/night", "B · Macro garden", "One dino: scroll handoff" (playable),
"Top-bar repertoire").

Two problems on Today:

1. **The scene is bare.** The buddy's line on Today (`BuddyLine` → `Dialogue`, `app/src/app.jsx`)
   stands the dino in `.ms-scene`: an 80px strip with a dashed ground line, two dunes and one cactus,
   drawn on the page colour. It's a floor, not a place, and it's the first thing on the busiest screen.
2. **There are two dinos.** `MobileHeader` always walks the buddy along the app-bar lane, so on Today
   you see the same animal twice, a few pixels apart. The bar dino should exist only when the scene
   dino doesn't.

---

## Handoff prompt (paste this into a new Sonnet session on this repo)

> You're implementing design plan `design-plans/37-dino-valley-and-topbar.md` in the Macrosaurus PWA.
> Read `DESIGN.md` first; it's the house rulebook (paper/dark themes, no gradients or glows, Silkscreen
> only for tracked numbers and the buddy's name, 44px targets, reduced motion respected). All app code
> is in `app/src/app.jsx` (one big file; use grep), styles are in `app/src/styles.css`, and buddy
> decision logic is in `app/game.js`. After editing, run `node build.mjs` to rebuild the root
> `index.html` bundle, then `npm test`. Ship it in three commits, one per part below, each building
> and passing tests on its own. Don't rename or remove existing exports that tests import.
>
> ### Part 1 — Dino Valley: replace the bare scene on Today
>
> Today's buddy line renders `<Dialogue … sprite={<BuddyAvatar … px={3} />}>` from `BuddyLine`.
> `Dialogue` draws `.ms-scene` (80px: two `.ms-dune` SVGs, one `.ms-cactus`, a dashed `.ms-ground`).
> Other screens also use `Dialogue` (check-in, milestone, egg, stage-up, around lines 6660 and
> 12281–12480). **Leave those alone.** Only Today gets the new scene.
>
> 1. Add a `scene` prop to `Dialogue`: `'strip'` (the default, today's markup) or `'valley'`.
>    `BuddyLine` passes `scene="valley"`.
> 2. The valley is a **full-bleed band 138px tall** (it breaks out of the 16px page gutter with a
>    negative margin), with a 2px `--border` rule under it and the dialogue box 16px below. The box's
>    tail (`.ms-tail`) moves so it points at the dino's centre.
> 3. Draw it on the existing `TerrariumCanvas` pipeline instead of new SVG, so bought scenery
>    (`SCENE_ART` via `terraPalette(scene)`) keeps recolouring it and the theme MutationObserver keeps
>    working. Add a `variant` prop to `TerrariumCanvas` (`'desert'` stays the default for the Play hub;
>    `'valley'` is new). The valley's logical grid is **130×46 at S=3**, ground line at row 34. Layers,
>    back to front:
>    - sky `--terra-sky`, then two flat horizon bands, rows 22–34 and 29–34, each one step warmer
>      (new tokens `--terra-haze-1` / `--terra-haze-2`; paper `#fbe7d6` / `#f8dfca`, dark `#0b0b12` /
>      `#101019`). These are flat bands, not a gradient.
>    - sun (day) or crescent moon (night) at x 112–120, y 4–12.
>    - 2–3 pixel clouds, filled `--card` with a 1-row `--terra-faint` underside, drifting slowly
>      (reuse the existing tick).
>    - far mesas (new `--terra-mesa`, paper `#eadfe6`, dark `#101017`) at the left and right edges.
>    - **a volcano** (new `--terra-volcano`, paper `#e0d1dd`, dark `#14141b`), base x 78–106, peak at
>      row 16, with a 4px lava lip in `--terra-red` and three smoke puffs rising from the crater. At night
>      the lava glows brighter and runs down one side.
>    - dunes `--terra-pale`.
>    - ground band rows 34–46 (new `--terra-ground`, paper `#efe6d2`, dark `#0c0c11`), the 1-row
>      `--terra-ink` horizon, two dashed strata lines (`--terra-strata`).
>    - **a buried fossil** in the cross-section directly under the dino: skull, spine and four ribs
>      (`--terra-fossil`, paper `#d6c7a7`). At night it glows faint `--terra-blue` at 45%.
>    - a saguaro (`--good` / `--good-ink`) at x 10–19, a small cactus at x 117, a bone at x 110.
>    - **the nest with the green-spotted eggshell halves** the buddy hatched from, just right of the
>      dino (x 66–77). This is continuity with the egg logo and hatch flow. Hide the nest while the
>      buddy is still an egg.
>    - three ground tufts in the macro fills (protein red, carbs blue, fat gold).
>    - critters: a lizard that scurries back and forth on the ground; by day a pterodactyl that crosses
>      the sky about every 18s; by night twinkling stars, an occasional shooting star, and 2–3 fireflies
>      (`--accent` in dark).
>    - **night only:** a campfire just right of the dino (2-frame flame in `--terra-red`/`--terra-sun`,
>      logs in brown) and a warm 1-row ember strip on the ground under it.
>    Exact pixel coordinates for every element are in the canvas boards `SceneDay.dc.html` and
>    `SceneNight.dc.html` as SVG paths in the same 130×46 space. Port them into `put()`-style row
>    arrays or `fillRect` runs.
> 4. The dino stands in the valley with `BuddyScene`'s existing `plant` / `floor` logic: base px 3,
>    centred at x≈132px, feet sunk 1 row into the ground, contact shadow under it. Keep it a `<button>`
>    that opens Play (`onSpeaker`), and keep the emote box above its head.
> 5. Motion follows the existing rules: everything stops under `prefers-reduced-motion`, and the
>    weather stops when the buddy sleeps (`still`). Use night from `Game.isNight()` / `useNight()` as
>    the other scenes do. While the buddy is `away` (foraging), the valley still renders but without
>    the dino, and footprints lead off the right edge.
> 6. Sizes: the band is 138px against today's 80px, which pushes the fold down by 58px. Check the
>    "kcal left" figure at 375×812 is still above the tab bar in the resting state (see the
>    `StatusStrip` note in `app.jsx` about exactly this). If it isn't, drop the valley to 120px
>    (S stays 3, crop sky rows) rather than shrinking the art.
>
> ### Part 2 — One dino: the top-bar handoff
>
> Rule: **the buddy is in exactly one place at a time.** On Today, while the valley's dino is on
> screen, the app-bar lane is empty. When the dino scrolls out of view, it hops up into the bar. When
> it scrolls back, it drops back down into the valley. On every other tab there's no valley, so the
> dino lives in the bar the way it does now.
>
> 1. Add a tiny module-level store like `BUDDY_REACT` (e.g. `BUDDY_SPOT = { onPage: false, subs: [] }`
>    plus a `useBuddyOnPage()` hook). The valley's dino wrapper registers an `IntersectionObserver`
>    (threshold 0, `rootMargin: '-52px 0px 0px 0px'` so the sticky app bar counts as off-screen) and
>    sets `onPage` true or false. On unmount (tab change) it sets `onPage=false`.
> 2. `MobileHeader` reads it. Phases: `scene` (lane empty) → `toBar` (450ms: `jump` strip at px 2
>    rising from translateY(40px) at the lane's left edge) → `bar` (today's `.ms-walker` pace) →
>    `toScene` (450ms: `jump` strip dropping and fading) → `scene`. In the valley, `toScene` plays
>    `jump` landing from translateY(-60px) with a small dust puff; `toBar` leaves a dust puff where
>    the dino stood. Debounce flips by 150ms so a scroll that bounces at the threshold doesn't
>    ping-pong.
> 3. Keep the bar walker's `aria-label` and Play tap target exactly as they are. When the lane is
>    empty, render nothing focusable in it.
> 4. Reduced motion: no rise or drop animation; swap instantly.
> 5. Desktop (`Sidebar`, ≥1024px) has no app bar, so this doesn't apply there.
> 6. The playable reference is the `TopBar.dc.html` board: scroll its Today feed, switch tabs.
>
> ### Part 3 — The bar dino does more
>
> Today the bar dino only paces. Give it a small repertoire, driven by the same intent layer as the
> valley so the decision stays in one tested place. Add `Game.barAnim(st)` in `app/game.js`, next to
> `buddyAnim`, with unit tests in `tests/game.test.js`. It returns `{ anim, motion, prop }`, where
> `motion` is one of `pace | hold | trot | dash | pacer | none`. Priorities, highest first:
>
> | # | Behaviour | Trigger | Strip(s) | Motion | Extra |
> |---|---|---|---|---|---|
> | 1 | Goal landed | `buddyReact('cheer')` (protein hit, PB, streak, Amber) | `cheer` ×2 | hold at current x | 3 gold pixel sparks blinking around it |
> | 2 | Delivery run | `buddyReact('eat')` / `('carry')` (meal logged) | `carry`, then `eat` once | trot across the lane, eat at the far end | — |
> | 3 | Rest-timer pacer | Train tab with a rest timer running | `move` | `pacer`: x = elapsed / rest × lane width | dotted track along the lane, flag at the right edge, `wave` once at zero |
> | 4 | Bedtime | `Game.isNight()` | `yawn` once, walk to the right end, `sleep` | none once asleep | rising Silkscreen "z" in `--on-header-accent` |
> | 5 | Gone foraging | buddy `away` | none | none | pixel footprints trail off the right edge; tapping them opens Play |
> | 6 | Morning wave | first app open of the calendar day | `wave` once | hold, then pace | — |
> | 7 | Sniff the date | random idle beat on reaching the left end, about 1 in 3 turns | `scan` facing left | hold 1.1s | — |
> | 8 | Beetle chase | random, at most once per session, never in the first 60s | `dash` | dash | a 4×3 pixel beetle runs ahead of it |
> | — | Patrol | default | `move` | pace (today's 9s `.ms-walker`) | — |
>
> - One-shots (1, 2, 6) reuse `BUDDY_REACT`'s subscription. Today it only reaches the terrarium, so
>   make the bar subscribe too, **but only while in the `bar` phase**, so a reaction plays in whichever
>   place the dino is right now and never in both.
> - All strips already exist in `sprites/<palette>/<species>/base/` and in the manifest (`cheer`,
>   `carry`, `eat`, `wave`, `scan`, `dash`, `yawn`, `sleep`, `jump`, `move`). Resolve through
>   `resolveSprite` / `Game.animChain` so a colourway missing a strip falls back cleanly.
> - Converting moving behaviours away from the CSS-only `.ms-walker` keyframes: keep CSS for `pace`.
>   For `trot`, `dash` and `pacer`, set `transform: translateX()` from React state on a rAF or a
>   250ms tick, and read lane width with a ResizeObserver. Flip `scaleX(-1)` by direction.
> - The egg (unhatched) keeps today's slow wobble and none of the above.
> - Everything respects reduced motion: hold in place and play no strips except a static frame.
>
> ### Acceptance
> - On Today at the top of the page there is one dino on screen, in the valley; the bar lane is empty.
>   Scroll until the dino's feet pass under the bar: it hops into the bar within 0.5s. Scroll back:
>   it drops into the valley. No frame shows two dinos or zero dinos (except foraging).
> - Food, Train and Progress tabs: the dino is in the bar, as now.
> - Log a meal from Food: the bar dino does the delivery run. Log a meal from Today with the valley
>   visible: the valley dino eats, and the bar stays empty.
> - Paper and dark themes both match the canvas boards. A bought scene (e.g. Fern Hollow) recolours
>   the valley's sky, dunes and outlines.
> - `prefers-reduced-motion`: there's no animation anywhere, and the handoff swaps instantly.
> - `npm test` passes, with new tests for `Game.barAnim` priorities.

---

## Alternative not chosen: B · Macro garden

Three plants in the ground that grow with today's macros: a red berry bush for protein, blue lupins
for carbs, and a gold sunflower for fat. Each is a seedling at 0% and full height at 100%. It's
charming and data-linked, but it repeats the macro meters directly underneath it, and it makes the
scene about numbers when the buddy's world is meant to be the calm part of the screen. Kept on the
canvas (it has range tweaks) in case you'd rather the scene carry information.
