# UI review — principles, measurements, and what to do next
2026-08-11. Written after the Paper Terrarium archetype pass, against the build on `buddy-talk`.

This is not a generic heuristics checklist. Everything below is either **measured on the built page**
or **checked against the twelve design files**, and each recommendation says which.

---

## Part 1 — what was measured, and what it found

An instrumented pass over the running app computed every text node's contrast against its actually
painted background, measured every tap target, and counted the type sizes in use. Three defects came
out of it that no amount of side-by-side looking had caught. All three are **already fixed** (commit
`791fe01`) and are recorded here because the method is worth repeating, not because the work is
outstanding.

| Found | Measured | Why it mattered |
|---|---|---|
| Macro figures drawn in the fill colour, not the ink | **2.21:1** for the amber figure on the card (needs 4.5) | The app's own token block sets out the ink/fill rule and provides `--fat-ink`; one component had not followed it — on the most-looked-at number on the most-looked-at screen |
| Bottom navigation set at **7px** | Design set bottoms out at 8px; four files draw this exact label at **9px/0.08em** | The app's primary navigation was the smallest type in the product |
| `prefers-reduced-motion` covered **2 of 26** animations | — | The uncovered ones are exactly the vestibular triggers: full-viewport falling confetti, screen shake, off-screen slide-ins |

Tap targets came back essentially clean — the `.hit` helper that expands a small control's hit area
to 44px without changing what is drawn is doing its job, and comfortably clears WCAG 2.2 SC 2.5.8's
24×24 minimum.

**Keep the harness.** `scratchpad/audit.mjs` is thirty lines and it is the only thing in this project
that can see a contrast failure. Run it after any palette or component change.

---

## Part 2 — the principles that actually bear on this product

### 2.1 The burden problem is *the* problem

The research on this category is blunt. Around **69% of fitness and nutrition apps are abandoned
within 90 days**, rising to ~81% over a year, and cumbersome manual logging is consistently named as
the top driver. One industry analysis puts it at **60% gone within 14 days** and fewer than 15% still
logging consistently at 90 days, with a rough threshold: if logging takes more than about two minutes
a meal, it does not survive a month.

There is a real counter-finding worth knowing, though, because it cuts against the obvious response:
a 2021 comparison of three self-monitoring methods found that participants in the **lower-burden**
conditions had a *harder* time remembering to use their tool. Passive tracking sustained engagement
far longer in raw duration (median ~20 weeks vs ~10 for active food logging), but the act of logging
is part of what builds the habit. So the goal is not "remove the effort" — it is **remove the effort
that teaches you nothing, and keep the effort that is the intervention**.

Macrosaurus is already well-positioned here: photo/describe logging, one-tap re-logging of saved
foods, and a buddy that carries the reminding. The recommendations below are about the remaining
friction, not a rethink.

### 2.2 Progressive disclosure, and its cost

Nielsen's 1995 pattern — defer secondary options to a subsidiary screen so the primary ones get the
attention — is load-bearing throughout this app, and mostly used well: `Collapsible` behind "Numbers
look off?", the check-in's "What I'm reading from", the density explainer.

But it has a cost that is easy to under-price: **a disclosure hides a thing from someone who does not
know to look for it.** This pass moved Session notes *out* from behind a disclosure for exactly that
reason — "what hurt, what to change next week" is the most valuable thing a lifter can leave behind,
and it was small print. That trade should be made deliberately each time, not by default.

### 2.3 Recognition over recall

The app's strongest existing move is that its meters are *countable blocks* rather than smooth fills:
six of ten blocks is read at a glance and needs no number beside it. That is recognition doing the
work of recall, and it is why the cards can carry one number each instead of three. Keep leaning on
it — several recommendations below are applications of the same idea.

### 2.4 The pixel face is a display face, and it has a floor

Bitmap and pixel faces stay sharp at small sizes *when set on the pixel grid*, which is their whole
appeal. But legibility research on screen text is consistent that open counters and a generous
x-height are what carry small sizes, and that body copy wants 11–16px. Silkscreen is a genuine text
face at small sizes in a way Press Start 2P was not — that swap was the single biggest legibility win
of this whole overhaul — but it is still doing chrome, labels and numbers, not prose. The 7px nav
label was the case where that line had been crossed. **9px is the floor. The design set agrees.**

---

## Part 3 — recommendations, ranked

### P1 — do these

**1. Give the FAB a label, or lose it.**
The centre `+` overlaps the nav bar and is the single most-used control in the app, and it says
nothing. Everything else in this nav has a word under it. Cost: one line. Benefit: the primary action
stops being a guess for a first-time user. *(Checked against the design: the design's FAB is also
bare — so this is a recommendation to diverge, deliberately.)*

**2. Put a "logged at" timestamp on diary entries.**
`Sheets.dc.html` shows "Logged 07:42 · saved food" on the edit sheet's meta line. The provenance half
now works; the time does not, because **the schema has no timestamp on a log entry** — only a date.
Adding `at: Date.now()` at the one `log_entries.push` site is cheap and unlocks: the design's meta
line, meal-time patterns, "you usually eat lunch around now" nudges, and honest ordering within a
meal. This is the highest-leverage small schema change available.

**3. Audit the remaining sub-9px type.**
125 uses of `text-[7px]`/`text-[8px]` in `app.jsx`, 14 in `train.jsx`. The nav was the worst but not
the only one: "Growth · Saurling", "Streak 13", "Dino lore", "Play ›" and the day card's PROT/CARB/
FATS labels are all below the design's floor. Most should become 9px; a few can go.

**4. Add the meal chooser to the edit sheet.**
`Sheets.dc.html` draws BRK/LUN/DIN/SNK on the entry sheet and the app has no way to move an entry
between meals from the place you are already looking at it. This was deliberately deferred this pass
as a feature rather than a restyle — it should now be built.

### P2 — worth doing

**5. Make the streak forgiving in the copy, not just the mechanics.**
The app already has streak-freezes, which is the right mechanic. But research on this category
repeatedly finds streaks are a double-edged retention tool: they hold people who are winning and
push out people who slip. The freeze exists; make sure the *language* around a broken streak is the
buddy being kind rather than a number resetting to zero.

**6. One empty state per surface, in the buddy's voice.**
Several screens fall back to a bare card with a sentence. The Blocks screen now has the design's
dashed "nothing here yet" frame; that treatment should propagate. An empty state is the screen a new
user sees *most*, and it is the cheapest place to teach.

**7. Reconsider the theme toggle's home.**
The design draws it as its own button in the header, beside YOU. The app buries it inside the YOU
tab's Appearance panel *and* puts a ☀ glyph inside the YOU button, which reads as a toggle but is a
navigation control. Pick one.

**8. `Seg` on the theme chooser is Silkscreen; the design's is Plex Mono.**
Minor, but it is the one place the settings chooser diverges from `You.dc.html`. Worth settling when
Settings gets its verification pass.

### P3 — think about

**9. The dark theme has had no verification pass at all.**
Every screenshot in this project is the paper theme. Dark is a full second palette with its own
neon-on-black identity, and the audit harness can run against it in one line
(`document.documentElement.classList.add('theme-dark')`). It is very likely there are contrast
failures there — neon on near-black is easy to get wrong in the other direction.

**10. The FAB's 44px minimum is met; the density meter's tap target is not obvious.**
The one sub-24px target the audit found was the "Balance carbs & fat · Adjust ›" row at 19px tall.
It has `.hit`, so it is tappable — but a 19px row that opens a sheet does not *look* tappable.

**11. Consider what happens on a 320px screen.**
Everything here was verified at 390px. The portion control's `52px minmax(0,1fr) 52px` grid and the
four-up stat tiles on Recipe are the two places most likely to break first.

---

## Sources

- [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) — 24×24 CSS px, Level AA, in force under the European Accessibility Act since June 2025
- [When and Why Adults Abandon Lifestyle Behavior and Mental Health Mobile Apps: Scoping Review (JMIR, 2024)](https://www.jmir.org/2024/1/e56897)
- [Is Burden Always Bad? Emerging Low-Burden Approaches to Mobile Dietary Self-monitoring (J. Tech. Behav. Sci., 2021)](https://link.springer.com/article/10.1007/s41347-021-00203-9) — the counter-finding on low-burden tools being easier to forget
- [Why Most Health App Users Churn Within 90 Days (Sahha)](https://sahha.ai/blog/health-app-churn-retention/)
- [Progressive Disclosure — Nielsen Norman Group](https://www.nngroup.com/videos/progressive-disclosure/)
- [prefers-reduced-motion — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) and [Animation and motion — web.dev](https://web.dev/learn/accessibility/motion)
- [Readability — 8th Light](https://8thlight.com/insights/readability) on x-height, counters and the 11–16px body range
