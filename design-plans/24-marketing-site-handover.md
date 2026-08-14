# Handover — macrosaurus.com, brought back in line with the app, 2026-08-14

Branch: `claude/marketing-website-design-r2er3s`. Files touched: `web/index.html`, `web/404.html`,
`web/privacy.html`, `web/terms.html`, new `web/sprites/`.

The marketing site had drifted from the product in two separate ways, and they need naming
separately because only one of them is a design problem.

1. **Visual drift.** The site was still on the pre-overhaul palette and type: a cool grey page
   (`#F0F0F0`), white cards, `#1e1e1e` ink, `#F5C518` gold, `#17A398` teal, Press Start 2P over
   system mono, smooth macro bars, 4–5px shadows. The app moved to Paper Terrarium months ago
   (`16-paper-terrarium-overhaul.md`) — warm paper, cream cards, `#241f2e` ink, `#F0B429` gold,
   Silkscreen + IBM Plex Mono, **segmented pip meters**, 3px shadows — and has a full neon-on-black
   dark theme the site had no answer to at all. Someone who clicked START FREE landed on a
   different-looking product.
2. **Content drift.** Three shipped pillars were missing from the site entirely: **eating out**
   (`app/menu.js`), **training** (`app/training.js`, `app/src/train.jsx`), and **talking to the
   buddy** (`app/talk.js`). The site's own phone mock showed a bottom bar — HOME / FOOD / COOK /
   BUDDY / ME — that the app has not had since Train moved into it.

## What was changed

### Design — the site now runs the app's tokens verbatim

Every colour in `web/index.html` is lifted from `app/src/styles.css`, including the two rules that
document learned the hard way and the site was breaking:

- **Ink is the only border colour, and nothing is rounded.**
- **Gold is a fill, never type.** The old site set `color:var(--gold)` on the recipes kicker, which
  measures 1.83:1 on cream — invisible, not dim. All gold type now uses `--accent-ink` (`#8A6100`).

Also carried over: 3px borders with 3px hard offset shadows (was 4–5px), **pip meters instead of
smooth bars** in the phone mock, ink-filled card title bars, and the terrarium sky the buddy card
gets in the app.

**Dark mode is new.** `prefers-color-scheme: dark` remaps the tokens to the app's dark theme
exactly — black chrome rather than purple, neon green in place of gold, `#2f2f3a` shadows because a
black offset shadow on a near-black page is an invisible shadow. Both `theme-color` metas are set.

**Type.** Silkscreen (inlined woff2, 8.4KB — *smaller* than the Press Start 2P blob it replaces) and
IBM Plex Mono, loaded non-render-blocking with a system-mono fallback. Pixel sizes went up across the
board because Silkscreen's cap height is much smaller than Press Start 2P's at the same px.

**Real sprites, not emoji.** The site used 🦖 and 🥚. It now uses the actual art pack, animated the
way the app animates it — 24px frames stepped at 6fps — in the phone mock, the buddy card, a buddy
speech bubble, the 404, and a twelve-species strip under the feature rows. Assets are copied into
`web/sprites/` (60KB total) because the site is a separate Vercel root from the app.

> One trap worth writing down: frame-stepping with `background-position-x: -300%` **does not work**.
> Percentages there resolve against (box width − image width), which is negative for a 24px window on
> a 72px strip, so the strip walks the wrong way and you get an empty box. Use pixels.

### Content — the site now describes the app that exists

- **New section: Eating out.** Paste the restaurant link or snap the menu; every dish read and
  ranked; Fits / Protein / Lightest; nothing hidden for being too big. The mock mirrors `menu.js`'s
  actual three lenses and its "a dish that does not fit is still an answer" rule.
- **New section: Training.** Gym profiles, set logging, progression, and a session keeping the
  streak alive. Chip says **Free forever**, matching `WORKOUTS_PLAN_V2.md`.
- **Buddy section** now covers talking to it, including the promise that nothing is logged without a
  tap — the strongest trust line in the product and it was nowhere on the site.
- **Phone mock** rebuilt as the current Today screen, bottom bar included: TODAY / FOOD / + / COOK /
  TRAIN.
- **Comparison table**: added menu reading and "gym training in the same app" (against "a second app,
  a second subscription", which is the honest competitor position).
- **Pricing**: free tier now lists training, and the AI allowance is described as **10 AI actions a
  month — photos, menus or recipes**, which is what `FREE_AI_MONTHLY` actually gates. It previously
  said "10 AI logs", which reads as photo-only and undersells it while also being wrong about menus.
- **FAQ + FAQPage JSON-LD**: two new questions (eating out, training), and the existing "how is it
  different" answer rewritten around three differentiators instead of two.
- Hero, ticker, science band, founder note and footer all rewritten to include training and eating
  out. Science band item 04 swapped from "body-fat tracking" to "training counts", since body-fat is
  already covered under Premium and the food/training unity is the newer claim.

### The other pages

`404.html`, `privacy.html` and `terms.html` were on the old palette too. All three now take the same
tokens and dark mode. The 404's emoji dino is a real animated sprite.

## Verified

Rendered in Chromium at 1280 and 390, light and dark: no horizontal overflow at either width, nav
fits without wrapping, comparison table still collapses to per-feature cards on mobile, sprites
animate, reduced-motion still kills every animation.

## For Claude Design — what is left, in priority order

1. **`web/og.png` is stale and I did not touch it.** It is a hand-composited bitmap (see
   `fix-og.mjs`), still on the old grey/`#F5C518`/smooth-bar look, and its strapline sells "AI
   logging" only. It is the single most-seen asset on the site. Needs redrawing on the paper palette
   with pip meters, and a line covering food + eating out + training. Bump the `?v=` on all three
   references when it lands.
2. **The feature-row media are still all built from divs.** They read well as diagrams, but the
   eating-out and training cards especially are the kind of thing real screenshots would sell
   harder. Worth deciding whether this site wants illustrations or product shots — right now it has
   a third thing, which is neither.
3. **The terrarium in the phone mock is a crude approximation** — two blocks for hills, one bar for a
   cactus. The app draws a real one. Either port the app's terrarium markup or drop the scenery and
   keep the sky.
4. **Five feature rows is one or two too many** for a scroll this length. My instinct is to promote
   eating out and the buddy, and demote recipes and logging into a compact grid, but that is a
   composition call rather than a drift fix so I left the existing pattern alone.
5. **No social proof anywhere.** No counts, no testimonials, no screenshots of anyone using it. The
   comparison table is currently doing all of that work on its own.
6. **Sitemap** lists only `/`, `/privacy`, `/terms`. If eating out or training ever get their own
   pages, that is where they go.
