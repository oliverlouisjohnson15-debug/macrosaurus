# Handover — Paper Terrarium overhaul, 2026-08-11 (second pass)

**DEPLOYED 2026-08-11 as sw 276** (commit 393dac1), verified live on app.macrosaurus.com: the
served bundle is byte-identical to the local build. `buddy-talk` and `main` are level.
Supersedes `18-handover.md`; the parts of that document still worth reading are marked below.

## Read these first

- `design-plans/16-paper-terrarium-overhaul.md` — the palette/type/chrome foundation.
- `design-plans/18-handover.md` — **still current**: THE ONE RULE, the design-source locations, the
  two open questions for Olly, and the deploy recipe.
- The memory file `macrosaurus-paper-terrarium`.

## THE ONE RULE STILL STANDS

**Render the design and diff it against a screenshot of the build. Do not work from reading the
markup.** Every screen below was matched that way.

Harness, rebuilt this session (playwright-core installed in the session scratchpad):
- `rd.mjs <Name> [out.png] [width]` — serve `~/Downloads/undefined /` over http, screenshot one design
- `rdtabs.mjs <Name>` — same, but click through the design's own tab bar and shoot each variant
- `shot*.mjs` — drive the built app in `?demo` and screenshot a named screen
- `smoke.mjs` — walk every tab and sheet, fail on any console or page error

**Build with `node build.mjs`, not esbuild.** build.mjs uses Babel, which rejects a JSX comment in
expression position (`return ( {/* … */} <div>`) that esbuild accepts. That cost three round trips.

## State of play

**Matched against the rendered design:** Today · Food · Train · Paywall · **Sheets · Recipe ·
Session · Buddy · Sign In · Train Subscreens**

**Built, still NOT verified against a render:** Cook · You · Play · Progress · the Settings archetype.
These are the whole of what is left from the original leverage list. Settings is the one worth doing
first — `Settings.dc.html` is the largest design file and its sub-header bar has still never been
seen. `SubHeader` now exists for it.

## What landed this session

- **`Sheet`** + `SheetBox` / `SheetLabel` / `SheetBtn` / `ChoiceRow` in app.jsx, and all ~28 modals
  onto it. The archetype: scrim, panel on the bottom edge, ONE 3px rule along its top, the filled ink
  title bar, a 14px column of 14px-spaced blocks. `pad={false}` hands the body over whole for the two
  that scroll their own regions (log search, chat).
- **`SubHeader`** — the purple sub-screen bar (back / title / actions). Cancels the page shell's own
  `px-5 pt-6` so it reaches the edges. Used by Recipe, History, Stats, Blocks; Settings wants it too.
- Edit entry, weigh in, check-in and the weekly recap rebuilt to the design's own compositions.
- Recipe, the live session, the buddy chat, sign-in and the three Train subscreens.

## Gotchas found the hard way

- `Sheet` arms the back-button layer. A component that also calls `useBackClose` pushes two layers, so
  the hardware back button needs two presses to shut one sheet. Nothing that renders `<Sheet>` should
  call it. Check with:
  `awk '/^function [A-Z]/{f=$2;s=0;b=0} /<Sheet /{s=1} /useBackClose\(onClose\)/{b=NR} /^}/{if(s&&b)print f,b}' app/src/app.jsx`
- A grid track of `1fr` takes its content's intrinsic width as its minimum. The portion control's
  `52px 1fr 52px` shoved the + button off the screen until it became `minmax(0,1fr)`.
- Spreading `{...rest}` after `style={…}` on a component lets a caller's `style={{opacity}}` replace
  the fill wholesale. `SheetBtn` merges instead.

## Not carried over from the designs, deliberately

- **Edit entry's meal chooser (BRK/LUN/DIN/SNK) and "Copy to tomorrow."** Both are real features the
  sheet does not currently have plumbing for, not restyles. Worth doing, but as features.
- **Sign In's Continue-with-Apple / Continue-with-Google.** There is no social auth; drawing the
  buttons would be a promise the screen cannot keep.
- **Session's pause button.** The session clock has no pause concept.

## Known issue, not ours

`tests/checkin-cadence.test.js:86` still fails, exactly as `18-handover.md` describes: it arrived with
8ac9d26, reproduces on origin/main, and is already live. 788/789 pass.

## Deploy, when the time comes

Unchanged — see `18-handover.md`. `node build.mjs` → bump `VERSION` in `sw.js` → rebase onto
origin/main → **rebuild `index.html` from the merged sources** → `git push origin buddy-talk:main`.
