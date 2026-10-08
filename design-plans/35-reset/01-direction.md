# 35 · Reset: direction (full mockup)

Written 2026-10-08 against `main` @ `bcf019b`, after walking the live app in `?demo`, `&onboard`,
`&live` and `&premium`, in both paper and dark. Evidence: `00-research.md`. Visual spec:
`/DESIGN.md` (repo root). Mockups: `mockups-full/index.html` (the gallery). Measurements:
`mockups-full/metrics.md`.

This replaces the earlier A / B / C directions (`mockups/`, kept for reference). The changes from
those: purple chrome stays, paper gets lighter and warmer, Plex Sans is used for all UI text, and the
pixel identity is concentrated in windows, HP meters, the ▶ cursor, pixel numerals, the sprites, and
one game-style dialogue box.

**Approved by the product owner on 2026-10-08, with every decision in §5 accepted** (N3–N8, including removing the settings search). Implementation follows §6.

---

## 1 · Sitemap

### 1.1 What the app has today (walked, then checked against the source)

| Place | Screens, sheets and sub-pages |
|---|---|
| **Chrome** | Top bar: buddy avatar (opens Play), context, gear (opens You). Tabs: Today · Food · + · Train · Progress (Reset 01) |
| **Today** | Hero (kcal left, Details ›) · buddy line with its prompt (weigh-in cadence, check-in due, Premium nudge, evening out) · rows: Training, Weight, Recovery · Day details sheet · Weigh sheet · Weekly recap sheet · Milestone celebration · Talk (buddy chat) · Week plan banner · first-run checklist |
| **+ Log sheet** | Meal picker · tabs **Food / Scan / Estimate / Menu** · Food: search, recents, then "Can't find it?" → *Estimate it instead*, *Enter it manually*, *Log a drink* · Scan: *Scan a barcode*, *Scan the label*, *Estimate it* · Estimate: describe / photo / voice · Menu: a restaurant menu · Manual: 100 g or a serving → *Next: choose amount* · Drink · Food detail / amount · Shared-photo sheet |
| **Food · Diary** | Diary \| Recipes switch · day ‹ › and day picker · day-total panel (4 bars) · a card per meal, with a ≡ menu on every entry and a ⋯ menu per meal (copy, save as meal, move up/down, clear food, delete meal) · Add food · Edit entry · Adjust entry |
| **Food · Recipes (Cook)** | Discover \| Cookbook · Import from video · Build from ingredients · search + filters · "Cook for your gap" carousel · community contributor card · meal plan · shopping list · fridge photo · recipe detail · recipe import |
| **Train** (17 internal screens) | home, player, preview, builder, wizard, draft, rerun, blocks, library, coverage, review, history, exercise, settings, schedule, how, progress (`train-tab.jsx:115–224`) |
| **Progress** | This cycle (verdict + buddy) · to your goal + milestones · trend weight · next check-in · trend chart · energy · Your plan rows: Goal, Calories & macros, Coaching, Weekly shape, What's coming up, Check-ins & weigh-ins · weigh-in log · Check-in flow (coaching modules) |
| **You** | Settings \| Account switch · settings search · Progress & plan (Progress, Fresh start) · Body (Body details, Cycle tracking) · Food (Default meals, Share my recipes) · Reminders · Apps & data (More integrations, Google Health) · Appearance (theme, weight units, height units, Rearrange Today). Account: signed in as, Manage subscription / Start trial, Admin, Invite friends, Replay the intro, Export my data, Sign out, Help & feedback, Legal (Privacy, Terms, Health disclaimer, Credits), Danger zone (Reset data, Delete account) |
| **Play** (a modal) | Buddy \| Battle \| Shop · Talk · Trophies · Dress up · Name your buddy · weekly boss fight · daily hunt · shop stall |
| **Onboarding** | Sign in · "How well do you know macros?" · choose egg (12) · About you (1/4) · How active (2/4) · Goal (3/4) · Starting plan (4/4) · "You're all set" · Today checklist · hatch and name · buddy upgrade (existing accounts) |
| **Anywhere** | Paywall · Feedback sheet · Google Health disclosure · share-kind sheet · update-ready banner · toasts |

### 1.2 The new sitemap

```
Top bar ─ egg logo · context · Chompers walking (→ Play) · gear (→ You)
Tabs ── Today ─── Food ─── [+] ─── Train ─── Progress

Today             Day in detail (sheet) · Weigh-in (sheet) · Recovery · Talk to Chompers
                  one buddy prompt slot: weigh-in / check-in due / Premium / evening
+ Log (sheet)     search (barcode button inside) · chips: Quick add · Estimate · Drink
                  recents for this meal with + · "Added" strip (multi-add) · Food detail / amount · Edit entry
Food              Diary | Cook
  Diary           day ‹ › · one summary line · meals as sections · meal actions (sheet)
  Cook            fits-what's-left hero · your recipes · Meal plan · Shopping list · Discover · What can I make?
                  Recipe detail · Recipe builder · Import (sheet)
Train             home (next session + Start) · this week
  Session         before Start = preview · live · done
  History         Sessions | Lifts · session detail · exercise detail
  Block           weeks · schedule · coverage · change / new block · training settings · how it works (?)
  New block       one short flow (was wizard + draft + builder)
  Exercise picker sheet (was library)
Progress          verdict + trend · Your plan: Goal & strategy · Calories & macros · Check-in · What's coming up
                  More: Energy · Weekly shape · Weigh-ins · Body fat · Check-in flow (3 pages)
You (gear)        Account & Premium · Body details · Cycle tracking · Default meals · Share recipes
                  Reminders · Apps & data · Theme & units (sheet) · Arrange Today · Help · Legal
Play (Chompers)   Buddy | Battle | Shop · Talk · Trophies · Dress up · Milestone · Hatching
Onboarding        Sign in · Hello · Egg · About you · Active · Goal · Plan · All set
```

### 1.3 What moved or merged (nothing is removed outright; asks are flagged ⚑)

| From | To | Why |
|---|---|---|
| Hero "Details ›" + LEFT/EATEN switch | Tap the hero → **Day in detail** sheet | one way to see the day |
| Weekly recap sheet | Page 1 of the **check-in** | the same week, told once |
| Train: player + preview | **Session** (preview is the session before Start) | Hevy's start / live / history (research P8) |
| Train: history + progress + exercise | **History** with Sessions \| Lifts | |
| Train: blocks + schedule + settings + coverage + review + rerun + how | **Block & schedule**, one page; *how* becomes its ? | |
| Train: wizard + draft + builder | **New block** flow | |
| Train: library | **Exercise picker** sheet inside Session and New block | |
| Log sheet: 4 tabs + 3 "can't find it" routes + "Scan a barcode" step | Search with a **barcode button in the field**, plus chips **Quick add · Estimate · Drink** | MacroFactor toolbar (P4) |
| Log sheet: **Menu** tab and **Scan the label** | Inputs inside **Estimate** (describe / photo / menu link) | one AI route |
| Diary: ≡ menu on each entry | Tap the row → **Edit entry** (copy, move, delete) | its actions were already in the edit sheet |
| Diary: day-total panel with 4 bars | One summary line with a thin HP meter | Today owns "left", Food owns "eaten" (§2.7) |
| Cook: Discover \| Cookbook switch, contributor card | Cook root, with **Discover** as a row; contributor level at its foot | |
| Progress plan rows: Goal, Coaching, Check-ins & weigh-ins | **Goal & strategy** page (goal, pace, coaching, diet style, protein, check-in day, weigh-ins); **Fresh start** at its foot | MacroFactor Strategy (P2) |
| You: Settings \| Account switch | One list; **Account & Premium** is its first row | |
| You: theme and units as inline switches | **Theme & units** sheet | |
| You: "Rearrange Today" | "Arrange Today" row in You | |
| Header: "PLAY ›", streak chip, wordmark | Chompers in the bar opens Play; streak is a Play row; the wordmark only appears on sign-in | |
| Milestone confetti modal | **Milestone** screen built on the dialogue pattern | one buddy voice |
| ⚑ **Settings search** | Removed (14 rows left) | needs the owner's yes: it removes a feature |

Not mocked separately because they are plain Sub-screen + Rows pages with nothing new to decide:
Cycle tracking, Google Health detail and disclosure, Legal pages, Feedback sheet, Admin, the
share-kind sheet, the update banner, toasts, and the buddy-upgrade onboarding for existing accounts.

---

## 2 · Per-screen content budget

| # | Rule | Checked by |
|---|---|---|
| 2.1 | **One primary job** per screen (named in each gallery card) | review |
| 2.2 | **One hero** window. Everything else is rows on the page | blocks ≤ 2 on a tab root (hero + dialogue) |
| 2.3 | **≤ 3 secondary sections** of **≤ 4 rows**, then "All …" | review |
| 2.4 | **≤ 1 buddy prompt** per screen, always in the dialogue pattern | `data-buddy` count ≤ 1 |
| 2.5 | **No card inside a card** | nested blocks = 0 |
| 2.6 | **≤ 1 help sentence** at rest (empty states and Progress may use 1) | help count |
| 2.7 | **Each number once per screen**. Today owns *left*, Food owns *eaten by meal*, Progress owns *weight and trend* | review |
| 2.8 | **Every control ≥ 44×44**, type ≥ 11px, body contrast ≥ 4.5:1, no text in a fill colour | audit |
| 2.9 | **No footer furniture** (quotes, "rearrange this page", "more" cards) | review |

Result (390×844, paper; the dark and 320×640 runs pass the same checks). Full table in
`mockups-full/metrics.md`:

| Screen | Primary y | Blocks (nested) | Controls | Help |
|---|---|---|---|---|
| Today | 122 → **67** | 4 (0) → **2 (0)** | 17 → **6** | 2 → **0** |
| Food · Diary | 404 → **288** | 9 → **0** | 30 → **16** | 0 → **0** |
| Food · Cook | 532 → **209** | 5 → **1** | 21 → **14** | 0 → **0** |
| Train | 311 → **123** | 7 → **1** | 22 → **4** | 2 → **0** |
| Progress | 108 → **67** | 8 (1) → **1 (0)** | 24 → **13** | 6 → **0** |
| You | 197 → **64** | 10 → **0** | 26 → **13** | 0 → **0** |
| Play | 415 → **137** | 4 (2) → **1 (0)** | 7 → **7** | 3 → **0** |
| Log sheet | 171 → **120** | 1 → **1** | 10 → **14**¹ | 2 → **0** |

¹ The demo account shows no recents in today's sheet. The new sheet opens with four recents for this
meal, each with a name target and a + target. Without them it has 6 controls.

Every one of the 74 screens × 2 themes × 2 sizes (296 runs) has **0** horizontal scroll, **0** text
under 11px, **0** targets under 44px, **0** contrast failures, **0** text in a fill colour and **0**
nested blocks. Impeccable `detect` reports one rule, `cream-palette`, on every file. The brief keeps
the paper, so that finding stands by design.

---

## 3 · Visual system

See `/DESIGN.md` (repo root). In short:
- **Kept**: the palette (paper made lighter and warmer), purple bars, cream windows, ink frames, the
  gold A button, the macro hues as data, the neon-on-black dark theme, and the sprites.
- **Pixel identity in five places**: notched windows · HP meters · the ▶ cursor · Silkscreen for
  tracked numbers and the buddy's name · the sprites (the egg logo, Chompers walking in the bar,
  the dialogue scene).
- **Calm everywhere else**: Plex Sans at 11px or more, sentence case, rows between hairlines, one
  hero, one gold button.
- **One buddy voice**: a scene, then a wide dialogue box with a tail pointing at him, then answers
  as a ▶ menu.
- **Icons**: one 12-cell pixel family (57 marks), redrawn so the stroke weight is consistent. The
  started set mixed thin diagonals with solid fills.

---

## 4 · Logging actions (one per tap, typed entry or capture; focus on open is free)

| Task | Today (walked in `?demo`) | Actions | New | Actions |
|---|---|---|---|---|
| Recent food | + → tap the recent | **2** | + → the row's + | **2** |
| Search and log | + → type → pick → ADD | **4** | + → type → the result's + | **3** |
| Barcode | + → Scan tab → "Scan a barcode" → capture → ADD | **5** | + → barcode button in the field → capture → Log | **4** |
| Quick add (kcal) | + → "Enter it manually" → kcal → "Next: choose amount" → ADD | **5** | + → Quick add → kcal → Log | **4** |
| Multi-add (3 searched foods) | (+ → type → pick → ADD) × 3 | **12** | + → (type → +) × 3 | **7** |

One rule makes this work: **a row's + logs that food's usual amount at once** (its last amount, or
one serving for a new food), exactly as tapping a recent does today. The sheet stays open, with an
"Added 2 · 640 kcal" strip, Undo and Done. Tapping the row's name still opens the amount screen, so
the 4-step route stays for anyone who wants it. No count goes up.

## 5 · Decisions for the owner

| # | Decision (all approved 2026-10-08) | In the mockup |
|---|---|---|
| N3 | **The sheet stays open after a +**, with an "Added" strip, Undo and Done (multi-add without a plate; the same entries are logged) | shown |
| N4 ⚑ | **Remove the settings search** (removes a feature) | removed in the mockup; kept if you say no |
| N5 | A **search result's +** logs its usual amount without the amount screen (recents already do) | shown (search = 3) |
| N6 | Quick add skips the amount step (one serving; the same entry) | shown |
| N7 | **Menu** and **label scan** become inputs inside Estimate rather than their own tab and row | shown |
| N8 | The paper page goes from `#e7e3da` to `#f6efe0` (the brief asks for light, warm paper) | shown |
| T1 | openGym ideas for Train (`02-opengym.md`): not used; ask before building | — |

Nothing here changes what is logged, how targets are calculated, check-in logic, training logic, or
buddy and game rules.

## 6 · After approval

Implement in usage order on shared primitives: foundation (tokens, `AppBar`, `TabBar`, `Hero`,
`HP`, `Row`, `Section`, `Dialogue`, `Sheet`, `Seg`, `Chip`, `Btn`, `Field`, icons) → Today →
logging → Food (+ Cook) → Train → Progress → You → Play → onboarding. Delete the old primitives
rather than hiding them behind flags. Re-run `tools/audit.mjs` (pointed at the app) and Impeccable
`detect` on each phase. Keep `npm test` green, and say in the commit when a selector changes. Open
one PR per phase.
