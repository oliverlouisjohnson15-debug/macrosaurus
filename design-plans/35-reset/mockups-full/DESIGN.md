# DESIGN.md · Macrosaurus

Status: proposal for review (35-reset, full mockup). When approved, it moves to the repo root, where
Impeccable and every later design pass read it first. The tokens and primitives are in
`system.css`, and the HTML versions of each primitive are in `tools/kit.py`.

## World

A Game Boy Color / GBA game that tracks your food and training. The pixel identity comes from a
few exact details: notched windows, HP meters, a ▶ cursor, pixel numerals for the numbers you track,
and the sprites. It does not come from styling every element. Everything else is calm: plain rows on
warm paper, readable sans text, and one hero per screen.

Mode: Operate (app UI). The brief beats Impeccable's taste rules where they conflict. The one case
today is Impeccable's `cream-palette` flag on the paper page.

## Colour

The palette is unchanged from `app/src/styles.css`. One value changes: the page goes from grey to
paper.

| Token | Paper | Dark | Use |
|---|---|---|---|
| `--page` | `#f6efe0` (was `#e7e3da`) | `#050507` | the page |
| `--card` | `#fffdf7` | `#0c0c11` | windows, sheets, fields |
| `--sunk` | `#efe6d2` | `#14141b` | an inset strip (the "left today" banner, the rest timer) |
| `--ink` | `#241f2e` | `#e8e8ea` | text and every frame |
| `--muted` | `#6b6459` (5.1:1 on paper) | `#8b8b98` (5.8:1) | secondary text |
| `--bar` | `#5B4FA6` | `#000000` | top bar, tab bar |
| `--bar-on` | `#FFD05E` | `#3DFF62` | active tab label on the bar |
| `--gold` | `#F0B429` | `#3DFF62` | the A button and the + only. **Never used as text** |
| `--link` | `#4c4196` | `#3DFF62` | links, row icons, the ▶ cursor |
| macros (fill) | P `#C7472F` · C `#3D6FB4` · F `#E0A21B` · kcal `#2E7D6B` | P `#3DFF62` · C `#35E0E8` · F `#FF4FD0` · kcal `#3DFF62` | meters only |
| macros (text) | P `#A93826` · C `#2F5E9E` · F `#7a5600` · kcal `#1F6153` | same as the fills | numbers and labels |

Rules:
- Paper must read as paper: light and warm, never grey. Dark keeps the app's neon on black. The
  two themes share structure, not palette.
- Gold appears once per screen: the primary action (or the + in the tab bar).
- On paper, text never uses a fill colour (gold, macro hues, bar purple). The audit checks this.
- Body text contrast is at least 4.5:1 on whatever is painted behind it, in both themes.
- No glows, no gradients, and no diagonal offset shadows. The dark hero keeps its neon frame but
  loses the bloom.

## Type

| Role | Face | Size / weight |
|---|---|---|
| UI and prose | IBM Plex Sans | 15/400 body · 13 secondary · 12 meta · 11 tab labels (the floor) |
| Headings | IBM Plex Sans | 15/700 section · 17/600 app bar title · 20/700 sheet title · 24/700 onboarding and step titles |
| Tracked numbers | Silkscreen | 48 hero figure · 22 / 32 large figures · 14–16 inline figures |
| Buddy name | Silkscreen | 13 on the dialogue box |

- Nothing is smaller than 11px.
- Silkscreen is only for numbers you track (kcal, grams, kg, sets, timer, amber) and the buddy's
  name. It is never used for a label, button, unit or sentence. Units such as "kcal", "g", "kg"
  and "min" stay in Plex beside the figure, because Silkscreen capitalises lowercase letters.
- Sentence case everywhere. No uppercase eyebrow above a heading.

## Shape

- **Window**: square corners notched by a 2px ring drawn on four axes (`box-shadow` 0/±2px
  only). That gives the GBC window's missing corner pixel without any diagonal shadow. The **hero**
  window has a 3px ring plus a hairline inner frame. Each screen gets one hero window, plus at most
  one dialogue box.
- **Rows** sit on the page between 1px hairlines. They are at least 56px tall, with a leading
  24px pixel icon in `--link`, a 15/600 title, 13/400 detail, and a trailing value or chevron.
- **Section**: a 15/700 heading over a 2px ink rule, with one optional link on the right ("All
  12"). No title bars and no boxes.
- **No card inside a card.** Scenes, sprites and charts count as art, not cards.

## Components

| Component | What it is | Replaces |
|---|---|---|
| `AppBar` (root) | 52px purple bar. The green-spotted egg logo (44px target) sits at the left with the context beside it (date, block name, "Food", "Progress"). Chompers walks the empty lane and opens Play when tapped. The gear opens You. Before hatching, the egg wobbles in the lane instead | `MobileHeader`'s wordmark, the "PLAY ›" chip, the streak chip |
| `AppBar` (sub) | Back arrow, a 17px title, and one optional action (icon or gold text) | `SubHeader`, `PageBar`, floating "‹ Back" links |
| `TabBar` | Today · Food · **+** · Train · Progress. 11px Plex labels; the active tab gets `--bar-on` plus a pixel ▶ before its label. The + is the gold A button, raised | the 9px Silkscreen tab labels |
| `Hero` | The one window per screen | `Panel`, `hero-card`, `pixel-box` blocks |
| `HP` | A segmented meter: ink frame, real cells (default 20, 10 for macros) with a two-tone fill that has a lighter top row. Fills to the nearest cell | `PipMeter`, the bar charts on Food |
| `Dialogue` | The buddy's one voice. A small scene (ground line, dunes, a cactus) with the sprite standing in it, a "!" / "?" / "♪" emote, and below it a wide window. The window has a pixel speech tail pointing at the sprite, the name in Silkscreen with the mood beside it, a 15px line, and either a ▶ menu of answers or a blinking ▼. The same pattern is used on Today, check-ins, session done, onboarding, Talk, milestones and hatching | the buddy card, the buddy strip, "ASKS" tags, kicker-plus-title pairs |
| `MiniDialogue` | The same box at 48px with a side tail, for the one place a sheet needs the buddy (Premium) | — |
| `Menu` | Rows of answers, each 44px or more. The selected answer shows the ▶ cursor (a 4×7 pixel SVG) | button pairs, choice cards |
| `Row` / `Section` | See Shape | `SettingsRow`, the Train "More" rows, diary entry cards, `CardHead` strips |
| `Sheet` | Rises from the bottom: a 3px ink top edge, a grab handle, a 20px title, a close button, and a sticky footer for the one primary action | `Sheet` (kept, restyled) |
| `Seg` | A window with segments; the active one is filled ink (paper) or neon (dark) | `Pill`, `Seg`, the LEFT/EATEN switch, log-sheet tabs |
| `Chip` | A 44px soft-ring button with an icon, for log routes and filters | — |
| `Btn` | **A**: gold fill with an ink ring, once per screen. **B**: cream with an ink ring. **Text**: `--link`, 44px target | `pixel-btn` variants |
| `Field` | A cream window, 52px tall, focused with a 3px `--cursor` ring. It can hold buttons inside (barcode, mic, camera, import) | the input styles |
| `Banner` | A `--sunk` strip for live context inside a sheet ("Left today", rest timer) | — |

## Icons

One family, `tools/icons.py`: a 12×12 cell grid drawn at 24px (2px cells) or 48px, with a one-cell
outline, square joins and solid fill only for small marks. It has 57 marks, covering navigation,
logging, body and plan, Cook, training, and buddy/Play. The family is drawn for Macrosaurus; its
outline weight follows pixelarticons (MIT) so either can fill a gap. It is rendered as inline SVG
`<symbol>`s with `shape-rendering: crispEdges` and `fill: currentColor`. Every icon sits on a
44px target or beside a label; there are no icon-only actions without an `aria-label`.

## Motion

- Chompers' walk cycle (6 frames, 0.8s) paces the bar lane over 9s and turns at each end.
- The idle, talk and cheer sprites loop in the dialogue scene. The emote bobs and the ▼ blinks.
- State changes take 150–250ms ease-out. No bounce or elastic.
- `prefers-reduced-motion` stops every loop. The sprites hold frame one.

## Content budget (every tab root)

One primary job. One hero. At most 3 secondary sections of at most 4 rows, then "All …". At most one
buddy prompt. At most one sentence of help at rest. No card inside a card. Every control is 44×44
or larger. Each number appears once per screen. See `../01-direction.md` §2.
