# The buddy box as a Game Boy dialogue window

Written against: ee9541e. Live mockup: `design-plans/buddy-box-mockup.html` (open it over the repo's
own `styles.css`, so every treatment uses the real tokens, the real `.pixel-box` chrome and a real
sprite frame).

## What the era actually did

Three findings, and they all point the same way.

**1. A dialogue is a WINDOW, not a region.** Game Boy hardware gave you a dedicated
[window layer over the background](https://gbdev.io/pandocs/Graphics.html) — always a rectangle, no
transparency — built from 8×8 tiles. Every textbox, menu and status panel of the era is literally a
framed box drawn on that layer. The look people remember as "Game Boy" is *stacked bordered windows*,
not one card with rules inside it.

**2. The JRPG dialogue box has three fixed parts.** Surveying the convention, a dialogue box is
[a delimited container, a resource identifying the speaker (portrait, name, or a tail), and an
indicator that there is more](https://champicky.com/2020/09/15/dialog-box-in-jrpgs/). Ours has the
container only by implication, identifies the speaker with unframed text, and has no indicator.

**3. The nameplate sits ON the frame.** The speaker's name in a small filled box overlapping the
dialogue window's top-left edge is the single most recognisable dialogue convention of the era.

## What is wrong with the current box

Measured against those three:

| | Convention | Live now |
|---|---|---|
| Container | its own bordered window | a 2px horizontal rule inside the card |
| Speaker | nameplate on the frame, or a portrait | 8px orange text, floating |
| More-indicator | blinking ▼ | none |
| Composition | stacked windows | one flat card |

And the specific thing you noticed: the buddy's screen is 66×70 — a thumbnail. In every game of the
era the character is either the star of a framed screen or a proper portrait beside the text. A
postage stamp beside a paragraph is neither.

## The treatments (see the mockup)

- **A** — current, for comparison.
- **B** — the dialogue becomes its own `pixel-box` window, with a nameplate on its top edge and a
  blinking `▼`. Structure only; the identity block is untouched.
- **C** — portrait beside the text, Link's-Awakening style. Most authentic, most compact.
- **D** — C plus the doubled Pokémon frame.
- **E** — **recommended.** B's structure, the buddy's screen enlarged to 88×92, and the doubled frame
  on both the screen and the dialogue window.

## Why E rather than C or D

C and D are the more authentic layouts and they look the part, but they fold the buddy's name and
mood into a thin header strip. The card has three states, and only one of them has a dialogue:

- **speaking** — C/D look excellent.
- **quiet** — the ladder says nothing (the common state for a consistent user). C/D collapse to a
  header strip and a portrait with a large empty space where the dialogue was.
- **incubating** — the hatch checklist needs the full width.

B/E keep the identity block that already works in all three states and *add* a window when there is
something to say, so the quiet state is unchanged and the speaking state gains a real textbox. E then
spends the space the old divider wasted on making the buddy's screen big enough to look at.

## The one adaptation to make

In a real JRPG the nameplate carries the speaker's name, because otherwise you would not know who is
talking. Here the buddy is right above it, named. So the plate should carry the **kind** instead —
`SAYS` / `ASKS` / `THIS WEEK` / `MORNING READ` / `TEACHING` — which is what the current kicker
already does, minus the redundant name. Otherwise E prints "Chompers" twice, 20px apart.

## Build notes

Everything needed already exists in `app/src/styles.css`:

- `.pixel-box` — 4px border + 4px hard shadow.
- `.blink` (`:268`) — already used by the kcal cursor; drives the `▼`.
- `.buddy-scene` (`:170`) — the terrarium gradient behind the sprite.

One new modifier is required, and it belongs beside the existing `.box-accent` / `.box-good` family:

```css
.pixel-box.box-double { box-shadow: 4px 4px 0 0 var(--shadow),
                        inset 0 0 0 2px var(--card), inset 0 0 0 4px var(--border); }
```

The nameplate is a positioned span on a `position: relative` window; it must not use a remapped text
size, since the type scale forces `line-height: 1.7 !important` (see
`design-plans/13-buddy-kicker-dismiss-alignment.md`).

## Open question

Whether the `▼` is honest. In a JRPG it means "more text follows". Here the messages are complete and
the tap opens the Play hub. Either it becomes a genuine tap-through affordance for the whole window,
or it is dropped. I would keep it only on messages that actually go somewhere.
