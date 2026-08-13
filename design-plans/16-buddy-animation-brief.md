# Claude Design brief — Macrosaurus buddy animations

Paste everything below the line into Claude Design. Attach
`design-exports/macrosaurus-sprite-inventory.pdf`.

---

I need pixel-art keyframes for the animated dinosaur buddy in Macrosaurus, a pixel-art macro
tracker. The attached PDF is the complete existing sprite pack: 12 dinosaur species x 2 colourways,
15 animations each, all 24x24 pixels.

**You are not drawing finished sprites. You are drawing role-coded keyframe grids that my build
script turns into finished sprites in all 12 species' own colours.** So you never pick a colour and
you never draw the same pose twice. Draw the pose once; the script does the rest.

## The rig

Every frame is a 24x24 grid of characters, one character per pixel. `.` is transparent. The seven
role characters are the seven colours every species has:

```
O  outline        the dark keyline around everything
L  body light     the main body colour
S  body shade     the darker body colour, used for the far side / underside
C  crest          the accent stripe on the head and back (this is what differs most per species)
B  belly light    the cream belly
b  belly shade    the darker cream under the belly
E  eye            white
```

That is the whole palette. Do not invent shades, do not use anti-aliasing, do not use a background.

This is the **canonical rig** — Olaf's `base/idle`, frame 0, transcribed exactly. Every pose you draw
must be recognisably this animal:

```
........................
........................
........................
........................
........OOOOOOOOO.......
.......OOCCOSLLLLO......
.......OCCOSLLSSLLO.....
........OCOSEOESLLO.....
.......OCOOSEOELLLO.....
.......OOCOSEEELLLO.....
.......OCCOSLLLLLO......
........OCOSSLOOO.......
........OOSSLLLO........
........OSSbBBBO........
......OOOSSbBBBO........
......OLLSSbBBBO........
......OOSSLLbbLO........
.......OOSLLLLLO........
........OSSOOSLO........
........OSO.OSO.........
........OO..OO..........
........................
........................
........................
```

Read that carefully before drawing anything. Note:

- **It faces RIGHT.** The eye is on the right of the head, the crest runs down the left/back.
- **Big head, tiny body.** The head is rows 4-11; the body, belly and legs are only rows 12-20.
- **Feet land on row 20.** Rows 21, 22 and 23 are always empty — that is the contact line the app
  draws a shadow against. A pose that breaks this floats.
- Occupied area is roughly x 6-18. Keep a margin; do not touch the frame edges.
- No shadow, no ground, no motion lines outside the body. The app draws the scene around it.

## Amplitude — the thing most likely to go wrong

At 24x24 a "big" movement is 2-3 pixels. For reference, in the real pack, consecutive frames differ
by roughly 25-100 pixels out of ~140 drawn pixels: the idle is a 1px settle of the whole body, the
walk swaps the legs and shifts the head 1px. Anything more reads as a glitch, not as motion. When in
doubt, move less and hold longer.

## What to give me back

**One JSON file per animation**, exactly this shape:

```json
{
  "id": "eat",
  "group": "base",
  "fps": 6,
  "loop": true,
  "order": [0, 1, 2, 1],
  "reads_as": "one clear chomp, then back to neutral",
  "props": { "1": "#c86432", "2": "#ffffff" },
  "keyframes": [
    { "id": 0, "grid": ["........................", "... 24 rows of 24 chars ..."] },
    { "id": 1, "grid": ["..."] },
    { "id": 2, "grid": ["..."] }
  ]
}
```

- `order` is the frame sequence played, indexing into `keyframes`. **Use it.** Three drawings with
  `order: [0,1,2,1]` is a four-frame animation, and `[0,0,1,2]` holds the first pose. This is how you
  get smooth results cheaply — draw the fewest distinct poses that tell the story.
- `order` must be **2 to 6 entries**. Never more than 6.
- `props` is only for things that are not part of the dinosaur and therefore have no species colour:
  a piece of food, sleep Z's, sweat, sparkles, a dumbbell. Use digits `1`-`4` in the grid and give me
  a hex for each here. Keep props tiny — a few pixels — and inside the 24x24 frame.
- Every grid must be exactly 24 strings of exactly 24 characters, using only `. O L S C B b E` and
  any prop digits you declared.
- `reads_as` is one line: what a person should understand from it at actual size. I use it to check
  the animation against its purpose.

Do not send me PNGs, sprite sheets, colours per species, or a picked palette. Grids only.

## The animations, in priority order

Start with batch A. Show me batch A before starting batch B.

**Batch A — the daily loop**

1. `eat` — 3 poses, ~6 fps, loop. Head dips, jaw opens, chomps a small food prop, back to neutral.
   This plays every time someone logs a meal, so it must read instantly and never look greedy.
2. `talk` — 2 poses, ~5 fps, loop. Jaw opens and closes. Nothing else moves. This sits under every
   line of coaching text, so it has to be calm enough to run for ten seconds without irritating.
3. `cheer` — 3 poses, ~8 fps, loop. Head up, arms up, small hop — but the feet must return to row 20
   on the final frame. One reusable celebration for streaks, personal bests and trophies.
4. `sleep` — 2 poses, ~2 fps, loop. Curled or head-down, eye closed (replace `E` with `O` or body),
   one or two Z's drifting as a prop. Very slow, very still.

**Batch B — the emotional range**

5. `wake` — 4 poses, ~5 fps, **`loop: false`**. From the `sleep` pose to a full stretch to neutral
   idle. Plays once when the morning read opens, so its last frame must match the idle rig closely.
6. `sad` — 2 poses, ~3 fps, loop. Head and tail droop, eye lowered. This shows after a missed day,
   so it must read as disappointed-with-itself, never as accusing the user or as crying.
7. `coma` — 3 poses, ~3 fps, loop. Flat on its back, over-stuffed belly domed upward, limbs flopped,
   belly rising and falling. Shows when someone has eaten well over their calories, so it has to be
   funny and affectionate rather than a judgement. **Ignore the existing `coma` in the PDF** — that
   one is machine-generated and I want yours instead.
8. `carry` — 2 poses, ~5 fps, loop. The walk pose but holding a full bag or basket prop. Plays when
   the buddy walks back from a foraging trip. (I do not need a walk-off animation; the app slides the
   existing `move` sprite out of frame.)

**Batch C — small life, only after A and B are approved**

`blink` (2 poses, layered into idle), `nod` and `shake` (2 each, for its yes/no questions),
`tilt` (2, a question), `point` (2, gesturing at something on screen), `wave` (3, hello),
`yawn` (3, after a bad night's sleep).

## Constraints worth repeating

- 24x24, feet on row 20, faces right, seven roles plus declared props, `order` 2-6 frames.
- Silhouette continuity: unless the animation is *about* the head or the pose (`coma`, `sleep`), the
  head should stay close to the rig above. People will look at this thing every day; it needs to stay
  the same animal across all sixteen states.
- Every pose must survive being 24 pixels tall on a phone. Squint at it. If you cannot tell `eat`
  from `talk` at that size, redraw.
