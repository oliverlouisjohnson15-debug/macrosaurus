# What is still undesigned

Taken from the code, not from memory. Seven surfaces have a Claude Design file; roughly seventy do
not. This is the map, ordered by how much it would cost to leave each one alone.

## Already designed (done or in progress)

`Today` · `Food` (log + add-food sheet) · `Cook` (home) · `Train` (home) · `You` (overview) ·
`Play` · `Paywall` · plus the Terrarium Background handoff (not yet ported).

---

## TIER 1 — seen daily or weekly, and visibly unredesigned

These sit one tap behind a redesigned page, so the seam is obvious.

**Edit an entry** `EditEntryModal` — opens every time you correct a portion. Probably the
most-opened sheet in the app after the log sheet itself.
**Weigh in** `WeighSheet`, `WeighInEditModal` — the daily/weekly prompt the buddy asks for.
**Weekly check-in** `CheckInModal` — the adaptive engine's main input. Multi-step.
**Portion / plate** `PlateSheet`, `IngredientMacroSheet` — the confirm step after an AI estimate.
**Recipe detail** — the page every Cook tap lands on. Bespoke layout: hero image, ingredients,
method, macros, log/scale controls.
**Live training session** `go('player')` — the screen you hold through a whole workout. The single
most-used screen in Train and the least like anything else in the app.
**Buddy conversation** `BuddyChatModal`, plus `BuddyReadinessSheet` and `WeeklyRecapSheet` —
the morning read and the weekly recap the retention loop depends on.

## TIER 2 — the settings subscreens (11)

All reached from You, all built from the same `Field` / `Seg` / `SettingsRow` primitives, so ONE
design covering the pattern would cover all eleven rather than needing eleven designs:

`goal` · `coaching` · `weekly` (weekly shape) · `checkins` · `macros` · `body` · `cycle` ·
`meals` (default meals) · `share` · `reminders` · `integrations` · `health` (Google Health)
— plus the Account tab (email, password, subscription, export, delete).

**Ask Claude Design for one settings-subscreen archetype**, not twelve pages.

## TIER 3 — Cook and Train subscreens

Cook: `recipe import` · `fridge scan` · `shopping list` · `meal planner`
Train: `blocks` · `history` · `stats` · `library` · `exercise` · `builder` / `wizard` / `draft` /
`preview` / `review` / `rerun` / `coverage` / `how` / `settings`

Train's builder family (wizard, draft, preview, review) is one flow and wants one design.

## TIER 4 — first-run and account entry

`Auth` (sign in / sign up) · `ResetPassword` · `WelcomeCarousel` · `OnboardingChecklist` ·
`EggPicker` / `NameBuddyModal` (hatching) · `IOSInstallSheet` · `InviteSheet`

First impression of the whole product, and currently the least considered.

## TIER 5 — game and moments

`FightModal` · `MacrodexModal` · `BuddyColourModal` · celebration / milestone overlays

## TIER 6 — utility, low traffic

`CopyToModal` · `NameSheet` · `ActionSheet` · `TargetSheet` · `CarryoverSheet` ·
`MetricBreakdownSheet` · `StatSheet` · `BodyFatPicker` · `DensityExplainer` · `GoalEditor` ·
`GymEditor` / `GymPicker` · `RecipeFilterSheet` · `PhotoUpdateSheet` · `FeedbackSheet` ·
`ShareKindSheet` · `FridgePublicSheet` · `AdminPanel` (5 tabs, admin-only — lowest priority in the
app)

---

## The efficient way to commission the rest

Most of these are not individual designs. They are **five archetypes**:

1. **A settings subscreen** (covers Tier 2 entirely, ~12 screens)
2. **A bottom sheet** — header, body, primary action (covers most of Tiers 1 and 6, ~20 surfaces)
3. **A multi-step flow** (check-in, block builder, onboarding — ~10 screens)
4. **A detail page** — hero image, sections, sticky action (recipe detail, exercise, block)
5. **A live session screen** (the training player; genuinely one-of-a-kind)

Get those five right and the whole app follows, the same way the seven page designs let the token
layer and `CardHead` cover every card in the app.
