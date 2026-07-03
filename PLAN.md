# Food Tracking App — Build Plan & Spec

**Version:** 0.5 (draft for review)
**Date:** 2026-07-03
**Owner:** Olly

A **UK-specific** macro tracker for body composition: log weight, food, and macros with a research-backed **high-protein** target for muscle retention, plus **automatic macro adjustments** driven by weekly check-ins. Log food fast — including by **photographing a nutrition label** or **estimating a restaurant meal from photos**.

**Product intent:** Build for Olly first to validate it, but design from day one as a **multi-user product** others can sign up for. That shapes the data model (per-user ownership), auth, and the local-first → cloud path below.

---

## 1. Goals & Guardrails

**Primary goal:** A mobile-friendly web app that helps *you* manage body composition. It sets a smart, high-protein target, learns your real energy expenditure from your results, and makes logging as frictionless as possible.

**Decided constraints:**

- **Platform:** Web app, mobile-first responsive. Runs in any phone/desktop browser.
- **Region:** **UK-only.** Food/energy metric (kcal, grams); **bodyweight defaults to stone/lb** (with a kg toggle), since that's how most UK users weigh themselves. UK/EU food data. No US data sources.
- **Audience:** **Multi-user product.** Personal use first, but every design decision assumes other people will sign up (accounts, per-user data isolation, privacy of uploaded photos).
- **Storage:** **Local-first** to start (single user, on-device, no login) to validate quickly; then Supabase with accounts turns it into a real multi-user product (see §9).
- **Meals:** Default **3 meals/day**, with the ability to add more (or rename them).
- **Protein:** Research-specific, high target for muscle retention (see §3.4 + §4).
- **UX references:** [stndrd.app](https://www.stndrd.app/) — clean, card-based, minimal-tap logging. [MacroFactor](https://macrofactor.com/) — the gold standard for adaptive coaching + fast logging; source of the program-mode, analytics-dashboard, and speed-logging ideas below.

**Deferred to the future (not v1):** food suggestion lists, recipe library / 300+ recipes, meal-idea features, social/community. The architecture leaves room for these but we don't build them now.

---

## 2. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **React + Vite + TypeScript** | Fast dev, easy Supabase path later. |
| Styling | **Tailwind CSS** | Rapid mobile-first UI; matches the clean card/ring aesthetic. |
| Local storage | **IndexedDB via Dexie.js** | Thousands of log rows offline; survives reloads. |
| State | **Zustand** | Lightweight; easy to swap data layer to Supabase. |
| Tracker rings | **SVG progress rings** | "Turn green when in range" macro circles. |
| **Label photo → macros** | Camera capture + **OCR** (Tesseract.js) or a **vision model** call | Snap a UK nutrition label, parse per-100g / per-serving values, pre-fill the food form. Core feature — see §5.2. |
| **AI vision provider** | Pluggable **`VisionProvider`** interface; default to a **free tier** for now | Start free, upgrade later without code changes — see §5.9. |
| Gestures | **framer-motion / @use-gesture** | Swipe-to-delete, swipe-to-duplicate, drag between meals. |
| Backend (Phase 2) | **Supabase** (Postgres + Auth + Storage) | Cloud sync, multi-device, auth. |

### Food data sources (UK-appropriate, free)

- **Open Food Facts** — no API key, global incl. strong **UK/EU** product coverage, standard UK label format (**per 100 g** + per-serving), barcode supported. **Primary** search + barcode source.
- **User label photos** — the OCR/vision path (§5.2) captures anything not in the database, which for UK own-brand/local products is common.
- **Custom foods** — manual entries saved locally, always offline-available.

> USDA / US databases are explicitly **excluded** — wrong region, imperial units, US products.
> All lookups sit behind one `FoodProvider` interface so sources can be swapped without touching the UI.

---

## 3. The Adaptive Adjustment Engine (core differentiator)

Instead of trusting a static formula, the app learns your real energy expenditure from the relationship between **what you ate** and **how your weight actually moved**.

### 3.1 Trend weight (smooth daily noise)

Daily scale weight is noisy. We track a **trend weight** via an exponentially weighted moving average:

```
trend_today = trend_yesterday + α × (scale_weight_today − trend_yesterday)   // α ≈ 0.1
```

All progress decisions use **trend weight**, never a single day.

### 3.2 Estimating true TDEE from results

Over a rolling window (default **14 days**), using linear regression on trend weight vs. time:

```
TDEE ≈ average_daily_calories − (weekly_trend_change_kg × 7700 / 7)
```

- **7,700 kcal ≈ 1 kg** of body mass.
- Example: averaged 2,400 kcal/day, trend fell 0.3 kg/week → TDEE ≈ 2,400 + (0.3 × 7700 / 7) = **2,730 kcal/day**.

Before ~2–4 weeks of data, fall back to a Mifflin–St Jeor estimate (from the user's `profile` — height, age, sex, activity; see §7) and blend the two as real data accumulates.

**Guarding against under-reporting (important).** People routinely under-log intake by ~20–30%. If we treat logged calories as truth, the engine reads "low intake + stable weight" as low TDEE and keeps cutting — a failure mode. Mitigations: (a) the **weight trend is the primary signal**, logged intake secondary; (b) flag an implausibly low estimated expenditure (e.g. below BMR) rather than acting on it; (c) if adherence/logging looks incomplete for the window, defer the adjustment and prompt for a cleaner week.

### 3.3 Weekly check-in adjustment

On each check-in the app:

1. Recomputes estimated TDEE from the last window.
2. Compares your **actual trend change** to your **goal rate** (e.g. −0.5 kg/week cut, +0.2 kg/week lean gain, 0 maintain).
3. Adjusts the **calorie target** to close the gap, capped per week (e.g. ±100–150 kcal) to avoid overcorrection.
4. Recomputes macros — **protein stays anchored** (§3.4); calories move via fat/carbs.
5. Writes a plain-English reason for the change (or no change).
6. Lets you **accept or reject** (illness, travel, bad week).

Guardrail: won't adjust if logging adherence in the window is too low (e.g. <5 logged days) — asks for another week instead.

**Program modes (MacroFactor-inspired) — how much control you want:**
- **Coached:** app sets and updates targets automatically each week.
- **Collaborative:** app recommends, you approve/tweak before it applies (Avatar's accept/reject, but every week).
- **Manual:** you set fixed macros; app still shows your estimated expenditure trend for insight but doesn't change targets.

A "diet style" preset (balanced / higher-carb / lower-carb) sets how non-protein calories split between carbs and fat — protein stays anchored per §3.4.

### 3.4 Macro targets — protein first

Protein is set from **lean mass (preferred) or goal bodyweight**, not total bodyweight, and held roughly constant across calorie adjustments. Fat gets a minimum, carbs fill the rest.

- **Protein target:** because body fat is logged at every check-in (see §7), the app anchors protein to **fat-free mass: 2.3–3.1 g/kg FFM** — the evidence-based range for preserving muscle in a deficit (default ~2.6 g/kg FFM). Anchoring to lean mass (rather than total bodyweight) avoids over-prescribing protein for higher-body-fat users — important now that others will use the app. If FFM is ever unavailable, fall back to ~1.8–2.0 g/kg of **goal** bodyweight. (Rationale + citations in §4.)
- **Fat:** floor ~0.8 g/kg bodyweight, then a share of remaining calories.
- **Carbs:** remainder of the calorie target.
- All targets exposed as **ranges**, not single numbers (see §5.7).

### 3.5 Pure, tested engine

`adjustmentEngine.ts` takes `{ weightHistory, foodLog, goal, settings }` → `{ newTargets, rationale }`. Pure and **unit-tested with fixtures** — it changes your diet, so it must be verified.

---

## 4. Protein Target — the Research

Your instinct is right: for muscle **retention**, especially in a calorie deficit, protein should be well above the general population RDA (0.75–0.8 g/kg). The evidence:

- **Muscle growth plateaus ~1.6 g/kg/day in energy balance.** Morton et al.'s meta-analysis (1,863 participants) found protein above ~1.6 g/kg/day gave no further gains in fat-free mass *when calories are maintained*.
- **In a deficit, you need more to preserve muscle.** Systematic reviews of lean, resistance-trained athletes cutting calories conclude **~2.3–3.1 g/kg of fat-free mass** best retains lean mass — higher when leaner and/or in a steeper deficit.
- **Practical translation:** since the app logs body fat, it works directly in **g/kg of fat-free mass (2.3–3.1)** rather than approximating from total bodyweight. For a lean person this equals ~2.0–2.4 g/kg of total bodyweight; for a higher-body-fat user it's sensibly lower in absolute grams, which is the point — protein tracks the muscle you're protecting, not the fat you're losing.

**App behaviour:** protein target defaults to **~2.6 g/kg fat-free mass** (within the 2.3–3.1 range), adjustable, and is treated as a floor the calorie-adjustment logic won't push you below. Fallback when FFM is missing: ~1.8–2.0 g/kg of goal bodyweight.

*Sources:* Morton et al. meta-analysis (Br J Sports Med); Helms et al. systematic review on protein during caloric restriction in lean resistance-trained athletes; ISSN Position Stand on protein & exercise. Full links in the chat message accompanying this plan.

---

## 5. Feature Specifications (v1)

### 5.1 Food search & add methods
- **Database search** — Open Food Facts (UK/EU), results cached locally.
- **Barcode** — supported via Open Food Facts (nice-to-have, lower priority per your note).
- **Custom add** — manual name + macros, saved to `foods` as `source:'custom'`.
- **Favorites & recent** — quick re-add from starred foods and recent entries (lightweight; not the full "suggestions" feature, which is deferred).

### 5.2 📸 Photograph a nutrition label → auto-log *(headline feature)*
- Take/upload a photo of a UK nutrition label.
- **OCR / vision parse** extracts the standard UK panel: **Energy (kcal), Fat, Carbohydrate, Protein** (and fibre/salt where present), on a **per-100 g** and/or **per-serving** basis.
- App shows a **confirm-and-edit** screen (never logs blindly) pre-filled with parsed values; you set the amount eaten and save.
- Parsed item is saved as a reusable food with `source:'label'` (see §7).
- **Approach (confirmed):** use **both** — on-device Tesseract.js OCR + UK-label parser as the fast/free/private first pass, with a **vision-model call** as fallback for messy or low-confidence labels.

### 5.3 🍽️ Eating out — estimate a restaurant meal from photos *(AI feature)*
For food with no label (restaurants, pubs, takeaways):
- Take a **photo of your plate**, and optionally **add a photo of the menu item** (or type the dish name/description).
- A **vision model** considers **both inputs together** — the plate image for portion/components and the menu text for what the dish actually is — to estimate **kcal + protein/carbs/fat**.
- Returns an estimate **with a confidence level and an editable breakdown**; you adjust and confirm before it logs (estimates are clearly flagged as approximate).
- Optionally save the result as a custom food for next time.
- *Caveat surfaced in-app:* photo-based macro estimates are inherently approximate; the app shows a range and encourages a quick sanity-check, especially for protein (the metric that matters most here).

### 5.4 Copy / paste items & meals
Select one or many entries → copy → paste into another date (or several dates), including "copy whole day." Clones `log_entries` with new date/meal.

### 5.5 Meals — 3 by default, add more
- Day starts with **Breakfast, Lunch, Dinner**.
- **Add meal** (e.g. snacks, pre-workout) and **rename** freely.
- Per-meal macro subtotals.

### 5.6 Intuitive gestures
- **Swipe left** → delete. **Swipe right** → duplicate. **Drag & drop** → move between meals. Tap fallbacks for desktop/accessibility.

### 5.7 Consumed / Remaining toggle + Ranges
- One tap flips every macro between **consumed** and **remaining vs. target**.
- Each macro has a **target range** (e.g. protein 165–180 g); tracker **rings turn green** when the day lands in range, amber when close, red when far. Range width configurable.

### 5.8 🍺 Alcohol logging (Avatar-style split)
Alcohol has **~7 kcal/g** but isn't protein/carb/fat, so it doesn't fit the macro budget on its own. Following Avatar Nutrition's approach, the app lets you **book alcohol calories against carbs and/or fat** so your day still balances:
- Enter the drink and its **calories** (e.g. a pint, a can, a glass of wine) — with common UK presets (pint of lager, spirit + mixer, 175 ml wine, etc.).
- Choose how to allocate those calories: **÷4 counts them as carbs, ÷9 counts them as fat**, or split between the two with a slider.
- Example: a 125 kcal glass of wine → 31 g carbs (÷4), *or* ~14 g fat (÷9), *or* any mix.
- Protein is untouched. The entry is clearly tagged as alcohol so your analytics can show it separately.
- Saved drinks become quick-add favorites.

### 5.9 AI vision provider — pluggable, free to start
The eat-out estimate (§5.3) and messy-label fallback (§5.2) need a vision model, but the app never hard-codes one. All calls go through a single **`VisionProvider`** interface so we can start free and upgrade later with zero UI changes.
- **Default (free, for Olly's testing):** **Google Gemini Flash** free tier — strong image understanding, generous daily limits, free key from Google AI Studio.
- **Free alternates:** Groq (Llama 4 vision), OpenRouter (several free vision models, good for comparing accuracy), Cloudflare Workers AI (edge-friendly).
- **Labels often need no LLM:** Tesseract.js OCR (on-device, free) handles most nutrition panels; **OCR.space** free tier as cloud fallback; vision LLM only for the hardest cases.
- **Upgrade path:** swap the provider to a paid API (e.g. **Claude** vision, per the earlier discussion) when accuracy/volume warrants — one config change.
- **Caveats:** free tiers rate-limit and may change; the key stays **server-side** (local proxy now, Supabase Edge Function later), never in the browser.
- **Does not scale to many users as-is:** a free tier's limit (e.g. Gemini ~1,500 req/day) is **global to your key, shared across all users** — fine for solo testing, but Phase 3 (public sign-ups) needs a metered paid provider, per-user keys, or per-user quotas. Flagged so it's a deliberate choice, not a surprise outage.

---

## 6. Screens (v1)

1. **Today / Diary** — 3 meals (add more), entries, macro rings, consumed/remaining toggle, add button.
2. **Add Food** — search / barcode / **label photo** / **eat-out estimate** / **alcohol** / custom tabs; favorites + recent.
3. **Check-in** — log weight **and body fat %** (both required); trend chart; runs adjustment; accept/reject.
4. **Progress / Analytics** *(MacroFactor-inspired dashboard)* — weight trend line, **estimated expenditure (TDEE) trend over time**, logging **adherence rate**, average calorie/macro intake, and how those relate to your actual rate of weight change. Alcohol shown separately.
5. **Settings** — profile (sex, age, height, activity, goal weight), goal, rate, **program mode** (coached/collaborative/manual), protein target, diet style, range width, **weight-unit toggle (kg ↔ stone/lb — UK default st/lb)**; food/energy stay metric (kcal, g).

---

## 7. Data Model

Local (Dexie/IndexedDB), shaped to map onto Supabase Postgres later. **Every table carries a `user_id`** (a local placeholder now, a real auth ID after §9) so the same schema serves one user offline and many users in the cloud with Row Level Security.

- **`profile`** — `user_id, sex, birth_date (→age), height_cm, activity_level, goal_bodyweight_kg, weight_unit ('kg'|'st_lb'), program_mode ('coached'|'collaborative'|'manual'), diet_style, created_at` — the inputs the Mifflin–St Jeor fallback (§3.2) and protein logic (§3.4) need for a brand-new user.
- **`foods`** — `id, user_id, source ('off'|'custom'|'label'|'ai_estimate'), name, brand, barcode?, serving_size_g, per_100g {kcal, protein, carbs, fat, fibre?, salt?}, estimate_confidence?, is_favorite, created_at`
- **`log_entries`** — `id, user_id, date, meal_id, ref_type ('food'|'alcohol'), ref_id?, quantity_g?, computed_macros {kcal, protein, carbs, fat}, is_alcohol?, alcohol_kcal?, alcohol_split {carb_pct, fat_pct}?, sort_order` — **alcohol entries still contribute their kcal to the day's calorie total** (booked as carb/fat grams), so the engine's `average_daily_calories` stays complete.
- **`meal_templates`** — `id, user_id, name, sort_order` — the user's default meals (seeded with Breakfast/Lunch/Dinner); the day view instantiates these and allows per-day add/rename.
- **`weight_entries`** — `id, user_id, date, scale_weight, trend_weight, **bodyfat** (required at check-in), note`
- **`targets`** — `id, user_id, effective_date, kcal, protein_g, carbs_g, fat_g, ranges {…}, source ('manual'|'adaptive'), rationale`
- **`goals`** — `id, user_id, goal_type ('cut'|'maintain'|'gain'), rate_per_week_kg, protein_g_per_kg_ffm, updated_at`

---

## 8. Phased Roadmap

**Phase 1 — Core local app (build first)**
Diary with 3 meals + add-more, macro rings, consumed/remaining toggle, ranges, custom food add, Open Food Facts search, weight check-in + trend weight, adaptive engine (with tests), high-protein target logic, local IndexedDB persistence.

**Phase 2 — Fast logging (AI vision)**
**Label-photo OCR logging** (OCR + vision fallback), **eat-out plate+menu estimate**, barcode, favorites/recent, copy/paste days, swipe/drag gestures.

**Phase 3 — Multi-user cloud**
Supabase migration: **accounts/auth, per-user data isolation (RLS), multi-device sync, backup**. This is where it becomes a product other people can sign up for. Photo storage + privacy handling for uploaded label/plate images.

**Phase 4 — Polish & future**
PWA install + offline, export/import, onboarding for new users, and *then* the deferred extras. **Future logging speed-ups seen in MacroFactor** to consider: voice logging, recipe import from a URL, smart history, and richer favorites. Deferred extras: suggestions, recipe library.

---

## 9. Local-First → Multi-User Cloud

- All data access behind a **repository interface**; Dexie now, Supabase later, no UI changes.
- §7 shapes mirror Postgres and already carry `user_id`. Migration = create tables + **per-user Row Level Security** (each user sees only their rows), Supabase Auth for sign-up/login, then a one-time local→cloud sync of the first user's data. Conflict rule v1: last-write-wins.
- **Vision/AI features** (label + eat-out) call the model server-side via a Supabase Edge Function once cloud is live — keeps API keys off the client and lets usage be rate-limited/metered per user.
- **Photo privacy:** uploaded label/plate images are processed for macros and not needed long-term; default to discard-after-processing or short retention, per-user, and disclose this. Firms up before public sign-ups open.

---

## 10. Compliance & Data Protection *(before public sign-ups)*

Once other people use the app, it handles UK users' **health data** (weight, body fat, body photos) and gives **diet/calorie guidance** — both carry obligations. Not needed for solo local-first use, but must land before Phase 3 opens sign-ups.

- **Health disclaimer:** the app gives general nutrition guidance, not medical advice; users should consult a professional, with sensible floors (never targets below a safe minimum). Shown at onboarding and in settings (MacroFactor does the same).
- **UK GDPR:** health data is "special category." Needs a lawful basis (explicit consent), a privacy policy, data-minimisation, and user rights — **export** and **delete my account/data**. Build export/delete as first-class features, not afterthoughts.
- **Photo handling:** label/plate images are processed for macros then **discarded by default** (or short, disclosed retention); never used for anything else without separate consent.
- **Data location & security:** Supabase region in the EU/UK; Row Level Security so users only ever see their own rows; secrets server-side only.
- **Minors:** set a minimum age (e.g. 16+) — nutrition-target apps aren't appropriate for children.

## 11. Testing & Verification

- **Unit tests** for `adjustmentEngine` + `trendWeight` across scenarios (steady loss, plateau, noisy week, low-adherence).
- **Label-OCR accuracy check** against a set of real UK labels before shipping §5.2.
- Guardrails: targets never below safe floor; protein floor respected; weekly adjustment capped.
- Manual QA on a real phone browser per screen.

---

## 12. Open Questions for You

1. **Your stats:** rough current weight, height, age, and are you **cutting, maintaining, or lean-gaining** at launch? Sets initial calories + protein grams for the first-run target.
2. **Product scope later:** when it opens to others — is this free, or do you eventually want subscriptions (like stndrd)? Not needed now, but it affects the Phase 3 auth/billing choices.

*Resolved:* label-photo tech = both on-device OCR **and** vision fallback (§5.2). AI vision provider = pluggable, **default to free Gemini Flash**, upgrade later (§5.9). **Body fat is entered at every check-in** (required) — protein anchors to fat-free mass (§3.4).

---

*Next step on approval: scaffold the Phase 1 React/Vite/Tailwind app in this folder — diary + high-protein target + adaptive engine with tests.*
