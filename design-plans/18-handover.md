# Handover — Paper Terrarium overhaul, 2026-08-11

Everything is committed to the local branch `buddy-talk`. **Nothing since sw 275 is deployed.**
Olly wants one large deploy once the redesign is finished, and is doing more design work in parallel.

## Read these first

- `design-plans/16-paper-terrarium-overhaul.md` — the palette/type/chrome foundation and why the
  token layer made this tractable.
- `design-plans/17-undesigned-surface-map.md` — every surface that still has no design, by traffic.
- The memory file `macrosaurus-paper-terrarium` — decisions, gotchas, the harness.

## THE ONE RULE THAT MATTERS

**Render the design and diff it against a screenshot of the build. Do not work from reading the
markup.** A whole pass was wasted applying the design's *grammar* to the existing layouts instead of
reproducing its *composition*, and Olly correctly said the result "looks nothing like it".

```
cd <scratchpad> && node rd.mjs        # serves the design folder over http, screenshots one .dc.html
```
It must be http, not file:// — the dc-runtime pulls React from unpkg.
Design sources: `~/Downloads/undefined /` (note the trailing space) and the Claude Design project
`a8a7d227-80b8-4fe5-9193-da459d1a3dbf`.

## State of play

**Built and verified against the rendered design:** Today · Food · Train · Paywall
**Built, NOT verified against the render:** Cook · You · Play · Progress · the Settings archetype
(its sub-header bar has never actually been seen — the capture that was meant to prove it failed to
navigate and showed the You overview instead)

**Not started, in leverage order:**
1. `Sheets.dc.html` — ~20 modals from one implementation. **Do this first.**
2. `Recipe.dc.html` — recipe detail, high traffic, bespoke layout
3. `Session.dc.html` — the live training player, one of a kind
4. `Buddy.dc.html`
5. `Sign In.dc.html` — first impression of the product
6. `Train Subscreens.dc.html`

## Shared pieces already in place — use them, don't reinvent

- `CardHead` (app.jsx) — the filled ink title bar every panel opens with.
- `Pill` — butted-segment lens switch (Left/Eaten, sheet tabs, Discover/Cookbook).
- `Seg` — settings chooser: separate framed buttons with shadows. **Deliberately different from
  `Pill`**; the design uses both shapes for different jobs. Do not merge them.
- `inputCls` + `.field-focus` — the design's field treatment, applied app-wide.
- Tokens: `--cardhead-bg/-text`, `--hero-ring`, `--nav-off`, `--rule`, and the full palette in
  `styles.css`. All six design files use the same vocabulary, so **no new tokens should be needed.**

## Two open questions for Olly

1. **`macrosaurus.com/terms` and `/privacy`** — the Paywall links to both; neither was verified to
   exist. The marketing site is a separate Vercel project, not in this repo.
2. **The terrarium background** (`design_handoff_terrarium_background/desert-background.js`) is
   marked high-fidelity and meant to be ported, but the app has its own renderer driving bought
   skies and the Play hub. Replacing it is a rewrite, not a restyle. Undecided.

## Known issue, not ours

`tests/checkin-cadence.test.js:86` fails ("next check-in is 8 days out"). It arrived with commit
8ac9d26, reproduces on origin/main without any design work, and is already live. 788/789 pass.
It has its own task chip.

## Deploy, when the time comes

`node build.mjs` → bump `VERSION` in `sw.js` → `git push origin buddy-talk:main`.
Rebase onto origin/main first and **rebuild `index.html` from the merged sources** — it is generated,
so a clean auto-merge of it proves nothing. Node lives at `~/.local/node/current/bin` and is not on
the default PATH.
