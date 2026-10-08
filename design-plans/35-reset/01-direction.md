# 35 · Reset — direction

Written 2026-10-08 against `fcc5ee8`. Evidence: `00-research.md` (patterns P1–P12, baseline in §6).
Mockups: `mockups/` (open `mockups/index.html`). Train additions inspired by openGym: `02-opengym.md`. **Nothing here is implemented until the product
owner picks A or B and answers §8.**

Pass 34 made each card better and fixed the grammar between them. This pass goes after the *count*:
fewer surfaces, fewer controls and fewer words on every screen, and one visual weight instead of
"every block is a crate".

---

## 1 · Navigation

### 1.1 Bottom tabs (owner decision, N1)

| | Today | Food | **+** | Cook | Train | Progress | Play | You |
|---|---|---|---|---|---|---|---|---|
| **Now** | tab | tab | FAB | tab | tab | via You/Today rows | header logo | header gear |
| **Proposed** | tab | tab (+ Recipes inside) | FAB | → Food | tab | **tab** | buddy on Today + header avatar | header gear |

**Recommendation: Today · Food · + · Train · Progress.**
- **Progress becomes a tab.** It's the plan's home (34/07): goal, targets, check-in and trend.
  MacroFactor gives that page a tab, Strategy, and shows a due check-in as a dot on it (P2). Today
  you get there through You → Progress or a row on Today, two different routes with two different
  back labels.
- **Cook moves inside Food** as a second view: `Diary | Recipes`, a two-segment switch at the top of
  Food. Cook is weekly-ish (34/06), and its job, food you'll eat, is Food's job. Every Cook feature
  (import, build from ingredients, cookbook, discover, meal plan, shopping list, "cook for your gap")
  moves with it unchanged.
- **Play stays one tap away, from the buddy.** Tapping the buddy, on Today or in the header, opens
  Play, as the logo does now. "PLAY ›" and the streak chip leave the header (the streak lives in
  Play).
- **You stays behind the gear** in the header.

Fallback if N1 is declined: keep Today · Food · + · Cook · Train and add a **Progress** row as
Today's first secondary row. Everything else in this document still applies.

### 1.2 Header
One 52px bar (now 63px): **buddy avatar** on the left (opens Play) · **context** in the middle (the
date on Today, the block name on Train, the screen name on a sub-screen) · **gear** on the right
(opens You). It replaces both `MobileHeader`'s wordmark and `PageBar`'s context line. That saves
about 55px on every tab root and drops the wordmark's repetition. On a sub-screen the left slot
becomes `‹ Back`.

### 1.3 Train: 17 screens → 4 places
| Place | Absorbs (current `screen.name`) | Reached from |
|---|---|---|
| **Train home** | home | tab |
| **Session** | preview + player (preview *is* the session before Start: same screen, Start in the footer) | hero, History, Empty session |
| **History** | history + exercise + progress (`Sessions | Lifts` switch; a lift opens its detail) | row on home |
| **Block** | blocks, schedule, settings, coverage, review, rerun, how (sections of one page; *how* becomes the page's `?` sheet) | row on home, context in header |
| *(flows, not places)* | wizard, draft, builder → one **New block** sheet flow. Library → a picker inside builder and session | Block page |

Depth never exceeds two: home → place → (detail or sheet). Train logic is untouched; this changes
which screen each existing component renders into.

### 1.4 You: one list
Groups: **Account** (email, Premium, sign out) · **Body** · **Food** (meals, sharing) · **Reminders
& apps** · **Appearance** (theme, units, *Rearrange Today* moves here from Today's footer). The plan
rows already left for Progress in 34/08. The Settings/Account switch goes, because both fit on one
page, and *Fresh start* moves to the foot of Progress, next to the plan it resets. The settings
**search field** is only needed while the list is long. At ~14 rows it isn't (owner decision, N4).

---

## 2 · The per-screen content budget

These rules hold on every tab root. Sub-screens follow 2.1, 2.4, 2.5 and 2.6.

| # | Rule | Measured as |
|---|---|---|
| 2.1 | **One primary job**, named in §5 for each screen | review |
| 2.2 | **One hero.** It is the only framed or filled surface above the fold | blocks above fold ≤ 1 (+ the prompt) |
| 2.3 | **≤ 3 secondary sections**, each = section header + plain rows. A section shows ≤ 4 rows, then "See all" | review |
| 2.4 | **≤ 1 prompt.** `PromptSlot` stays, but renders a *row*, never a card | review |
| 2.5 | **No card inside a card.** A framed surface holds rows and rules only | nested blocks = 0 |
| 2.6 | **≤ 1 sentence of help** at rest. Explanations move to a `?` sheet or the empty state | help sentences ≤ 1 (Progress ≤ 2) |
| 2.7 | **Each number once per screen, and once across Today/Food.** Today owns *left*, Food owns *eaten per meal*, Progress owns *weight and trend* | review |
| 2.8 | **Every control ≥ 44×44px**, including row chevrons and meal "+" | controls under 44px = 0 |
| 2.9 | **No footer furniture** (quotes, "Rearrange this page", "MORE" card) | review |

### Targets per screen (390×844, `?demo`)

| Screen | Primary content | y ≤ (now) | Blocks ≤ (now) | Controls ≤ (now) | Help ≤ (now) |
|---|---|---|---|---|---|
| Today | kcal-left hero | **140** (613) | **2** (4+4) | **10** (12) | **1** (3) |
| Food · Diary | first entry | **250** (389) | **1** (5) | **14** (19) | **0** (0) |
| Food · Recipes | first recipe | **250** (491) | **2** (5) | **12** (12) | **1** (0) |
| Log sheet (inside the sheet) | search field, focused | **210** (310) | **1** (1+2) | **8** + list rows (10, no recents shown) | **0** (2) |
| Train | next session | **160** (316) | **1** (4) | **10** (13) | **1** (2) |
| Progress | verdict | **140** (150) | **2** (5+1) | **14** (16) | **2** (5) |
| You | first row | **140** (275) | **5** (7) | **16** (16) | **0** (1) |
| Play | buddy | **140** | **2** (4+9) | **10** (17) | **1** (5) |

"Help sentences" counts only real sentences (text ending in . ! ?) of five words or more, outside
buttons. Data lines such as "8 exercises · ~76 min" aren't help. A segmented control isn't a block.
Sheets are measured inside the sheet. The baseline in brackets was re-run with exactly these rules
(`before/*metrics.json`).

At 320×640 the same counts hold. Each y-target scales with the viewport (×0.76), and the hero must
still be fully visible.

**Logging actions** (method in `00-research.md` §6, no count may rise):

| Task | Now | Target | How |
|---|---|---|---|
| Recent food | 2 | **2** | + → tap the row. Unchanged |
| Search and log | 4 | **3** | + → type → tap the row's **+** (logs its remembered serving). Tapping the row itself still opens the amount screen, so the 4-step route stays |
| Barcode | 5 | **4** | + → **barcode button inside the search field** → capture → Add. The Scan tab and its "Scan a barcode" step go |
| Quick-add kcal | 5 | **4** | + → **Quick add** chip → kcal → Log. Quick add is one serving, so the amount step is skipped |

---

## 3 · Visual system

### Keep
- **The palette.** Paper `--bg`, ink `--text`, purple chrome, gold primary, and the macro hues as the
  only data colours. Dark stays neon-on-black.
- **The buddy and its terrarium.** The sprite, its moods, the scene art and the shop all stay. Where
  it appears changes (§5), not what it is.
- **Silkscreen, for three jobs only:** hero numerals (the pixel face for numbers *is* the identity
  people remember), the tab labels, and the buddy's name.
- **IBM Plex Mono for prose** (direction A).
- **One token fix:** `--accent-ink` / `--fat-ink` go from `#8A6100` to `#7a5600`. The old value is
  4.33:1 on the paper page. That was acceptable while it mostly sat on cream cards, but in A rows sit
  on the page itself (5.19:1 after the change).
- **The ink frame and hard shadow, once per screen,** on the hero and on the FAB.

### Drop
- **Ink title bars on every card** (`CardHead` as a filled strip). A section header becomes a plain
  label on the page with a hairline under it.
- **Silkscreen on every label,** including meal names, row titles, buttons, chips and kickers. Those
  move to the body face at weight 600.
- **The 3px frame on every block.** Rows sit directly on the page, separated by hairlines.
- **The per-row ≡ menu on diary entries.** Tap the row to edit. A swipe or long-press gives
  duplicate, move and delete, all of which are already in the edit sheet.
- **Decorative copy:** cave-wall quotes, "ASKS" tags, and kicker-plus-title pairs.

### Two directions

**A · Paper, restrained.** The Paper Terrarium kept and quietened.
- The page is paper. The **hero is the one inked card** (3px frame + 4px ink shadow). Everything
  else is rows on the page with 1px rules at 18% ink.
- Section headers: 9px Silkscreen at 0.14em tracking over a hairline. This is the one other place
  the pixel face survives.
- The purple header bar stays (52px). The bottom bar stays purple with the inked cream FAB.
- Buttons: gold fill + 2px ink frame for the one primary, text buttons for the rest.
- The risk: it still reads as "the pixel app", by design. If the problem is volume rather than
  identity, this is the fix.

**B · Clean base, pixel accents.** A modern, quiet app with the buddy as the pixel element.
- **IBM Plex Sans** for UI and prose (the Mono's sibling, so the family carries over), Plex Sans
  tabular numerals for data, **Silkscreen only on the hero number and the buddy's name**.
- Warm off-white page, white **grouped lists with 14px radius**, no frames, no shadows. The hero is
  the one tinted card.
- No coloured header. The context is a 17px semibold title in a plain bar on the page colour, and
  the bottom bar is the card colour with a purple active state. Purple becomes an accent, not chrome.
- Lists are plain rows on the page with hairlines, the same as A. The exception is You, where white
  grouped lists are the settings convention (5 groups, inside the budget).
- The buddy, its scene and Play keep full pixel art. Against a calm base they read as the game, which
  is the point.
- The risk: it gives up the most distinctive thing about the app's look. It is calmer, but more
  like other trackers.

Both directions use the same IA, budget and content (§1, §2, §5). Only the skin differs, so the pick
is purely about the look.

---

### Mockups against the budget

`mockups/metrics.json`, both directions, paper and dark, at 390×844 and 320×640. Every screen meets
its targets: 0 nested blocks, 0 controls under 44px, no horizontal overflow, and every text token
pair ≥ 4.5:1 in both themes.

| Screen | primary y (A / B) | blocks (A / B) | controls | help |
|---|---|---|---|---|
| Today | 64 / 64 | 1 / 1 | 7 | 1 |
| Food · Diary | 241 / 246 | 0 / 0 | 9 | 0 |
| Log sheet | 209 / 207 | 1 / 0 | 8 + 10 row targets | 0 |
| Train | 118 / 117 | 1 / 1 | 4 | 0 |
| Progress | 64 / 64 | 1 / 1 | 13 | 1 |
| You | 96 / 96 | 0 / 5 | 11 | 0 |

(Control counts exclude the app bar and tab bar on both sides of the comparison.)

---

## 4 · Shared primitives (built first, in `app.jsx` + `styles.css`)

| Primitive | Replaces | Notes |
|---|---|---|
| tokens: `--rule`, `--radius`, `--row-h`, `--face-ui`, `--face-num`, type scale `--t-xs…--t-hero` | ad-hoc `text-[11.5px]`, `#8A8A90` literals | both themes. B adds `--radius: 14px`, A keeps `0` |
| `AppBar` (header: avatar · context · gear / back) | `MobileHeader`, `PageBar`, `SubHeader` | one bar everywhere |
| `Section` (label + optional "See all", hairline) | `CardHead` strips, `SettingsGroup` labels, `SheetLabel` | |
| `Row` (leading icon/sprite, title, detail, trailing value/chevron/toggle, 52px min) | `SettingsRow`, Train "More" rows, diary entries, recents rows | the workhorse |
| `Hero` (the one framed/tinted surface) | `Panel`, `hero-card`, `pixel-box` on page blocks | |
| `Sheet` (grabber, title row, sticky footer) | `Sheet` (kept, restyled) | |
| `Seg` (one segmented control) | `Pill`, `Seg`, LEFT/EATEN, log-sheet tabs | |
| `PromptSlot` → renders a `Row` | `PromptSlot` (kept) | |

`Panel`, `CardHead`, `PageBar`, `PageHeader` and `SubScreen` are **deleted** once their last caller
moves, not left behind flags.

---

## 5 · Screens (what the mockups show)

**Today.** Job: *what's left today, and the one thing to do next.* App bar with the date. **Hero:**
kcal left as a Silkscreen numeral, a 20-cell meter, then P / C / F left as three short meters on one
line. Tapping the hero flips left ⇄ eaten (the LEFT/EATEN switch goes). **The buddy line** sits
under it: 40px sprite, name and mood, and the day's one prompt (the weigh-in question, a check-in
due, the Premium nudge, in `PromptSlot` order). **Section "Today":** three rows, Training (next
session), Weight (trend, rate), Recovery (sleep, readiness). The full terrarium scene and "Your
journey" move to Play and Progress.

**Food · Diary.** Job: *what I ate, by meal.* Day switcher (‹ Thu 8 Oct ›) and `Diary | Recipes`.
One sticky summary line: eaten / target and three macro figures. **Meals are sections, entries are
rows** (name, amount, kcal; macros in small type), and each meal header has a 44px **+**.

**Log sheet.** Job: *find it and log it.* Meal picker and close. A **"left today" banner**. The
**search field, focused**, with the barcode button inside it. **Chips:** Quick add · Estimate · Menu
· Drink (the four tabs become chips that open their tool in place). **"Usual for breakfast"**
recents ranked by meal, each row with a **+**. A multi-add plate strip appears at the foot once
something is on it (owner decision, N3).

**Train.** Job: *start the next session.* Header context = block name. One line of week progress
(Wk 2 of 4 · 7 of 16). **Hero:** next session (name, day, exercises, minutes, the first lift) with
**Start**. **This week:** seven day cells as one row. **Rows:** History · Block & schedule · Empty
session.

**Progress.** Job: *is the plan working?* **Hero:** the verdict ("Ahead of plan", −0.8 vs −0.5 kg a
week) above the trend chart with its range switch. **Section "Plan":** Goal · Calories & macros ·
Next check-in (with "Check in now"). **Section "More":** Energy · Coaching · Weekly shape · Weigh-in
log. Fresh start sits in the foot.

**You.** Job: *change a setting.* Plain grouped rows, values on the right, and no inline segmented
controls: Theme and Units open a small picker sheet.

**Play** (not mocked; follows A/B). The terrarium becomes Play's hero. Buddy · Battle · Shop stays,
and Trophies / Dress up become rows.

---

## 6 · How it is measured

The harness is in `tools/ui-audit/` (committed with the foundation PR). It serves the repo root with
`python3 -m http.server`, opens `index.html?demo` (and `&dark`) at 390×844 and 320×640, dismisses
celebrations, visits every tab, sub-screen and sheet in §5, and writes PNGs plus `metrics.json`. The
metrics are: primary y (a locator per screen), outer and nested blocks, controls, controls under
44px, and help sentences. The same collector runs against the mockups, so the targets are checked
before any code is written (`mockups/metrics.json`). Logging actions are counted by scripted flows,
one action per tap, typed entry or capture.

Contrast: every text/background token pair is checked with a WCAG ratio script in both themes (body
≥ 4.5:1). Gold stays a fill and is never used as text: `--accent-ink` is the text colour. Motion:
buddy idle animation and sheet transitions are disabled under `prefers-reduced-motion`.

---

## 7 · Rollout (after the pick)

One PR per phase. Each screen is its own commit with before/after numbers in the message:
1. **Foundation:** tokens, `AppBar`, `Section`, `Row`, `Hero`, `Seg`, `Sheet` restyle, harness.
2. **Today.**
3. **Logging:** log sheet, edit entry.
4. **Food** (Diary; Recipes if N1 is approved).
5. **Train** (home, then the 4-place collapse).
6. **Cook** (inside Food or as its tab, per N1).
7. **Progress.**
8. **You.**
9. **Play.**
10. **Onboarding.**

`npm test` stays green. When a test asserts on copy or structure that the redesign removes, its
selector is updated and the commit says so.

---

## 8 · Decisions for the product owner

| # | Decision | Default if not answered |
|---|---|---|
| **D-A/B** | Direction A or B | none (blocking) |
| **N1** | Tabs become Today · Food · + · Train · Progress. Cook moves into Food, Progress becomes a tab | keep the current tabs (fallback in §1.1) |
| **N2** | Play is reached from the buddy (Today + header avatar). "PLAY ›" and the streak leave the header | yes, since this only moves things |
| **N3** | Add **multi-add** (a plate strip in the log sheet). New UI, same entries logged | off. The row "+" logs one item |
| **N4** | Remove the **settings search** field (~14 rows left) | keep it |
| **N5** | Search-result **+ logs the remembered serving** without the amount screen | yes. It logs exactly what the amount screen would pre-fill |
| **N6** | Quick add **skips the amount step** (one serving) | yes. Same entry |
| **N7** | The **full terrarium scene leaves Today** for Play. Today keeps a 40px buddy and its line | yes |
| **T1** | Train additions from `02-opengym.md` (timed exercises, history import) add new data to the training log | ask before building |
| **T2** | Exercise demo media: license from Gym visual, or stay text-only | text-only |
| **N8** | **Remove the per-entry ≡ menu** in the diary. Its actions stay in the edit sheet and on long-press | yes |

Nothing in this document changes what is logged, how targets are calculated, the adaptive engine,
check-in logic, training logic, or buddy and game rules.
