# Snap a meal, get the app: making the fast paths findable

Prompted by tester feedback (Nov 2026). A busy person who has "never gotten along with calorie
counting apps" liked the art and found the UI friendly, but asked for two things:

1. **A phone app.**
2. **AI calorie estimation from a photo.**

**Macrosaurus already has both.** It installs as a PWA (manifest, service worker, share target,
shortcuts), and the AI estimator takes up to three meal photos. So the tester didn't need new
features. They just never found the ones that exist. This plan is about making them findable,
teaching them by use rather than by a tour, and lowering the effort of logging for people who will
never weigh their pasta. Nothing here is a rewrite.

---

## What the code says today

| Area | State | Where |
|---|---|---|
| Meal photo estimate | Works well: up to 3 photos, voice, a follow-up question, a kcal range, a confidence tag ("Rough guess" / "Fair guess"), and a cross-check against UK tables | `DescribeTab` `app/src/app.jsx:16097`, `AiConfirm` `:15862`, `MealCamera` `:17021` |
| How you reach it | The **+** opens a search sheet. The photo estimator hides behind a chip labelled **Estimate** with a sparkle icon (`:15369`), and inside that it's the "Describe" tab of a `Describe / Label photo / Menu` control (`:15530`). The only camera icon in the sheet scans **labels**, not meals (`:15363`) | `LogSheet` ~`:15460` |
| Install card on Today | **Dead code.** `InstallCard` (`:2258`) is defined, with dismiss and a 14-day re-show, but rendered nowhere. Install shows up only as a row in Account (`InstallMenuRow`, `:2284`, rendered `:19405`) | `app/src/app.jsx` |
| Install wording | "Add to home screen" / "Install app". To most people a home-screen item is a bookmark, not an app | `:2273`, `:2292` |
| Home-screen shortcuts | `Log food`, `Scan barcode`, `Weigh in`. No photo shortcut | `manifest.webmanifest` |
| Share target | Photos shared to the app open in the estimator. Good, but nothing tells anyone it exists | `:23011` |
| Onboarding | The welcome screen says "Log your first meal". The checklist item "Log with a scan, photo or recipe" opens the search sheet, not the camera | `WelcomeCarousel` `:21041`, `hatchTasks` `:13854`, `OnboardingChecklist` `:21068` |
| Free allowance | 10 AI logs a month, shown in the log sheet as "n of 10 free AI logs left" | `FREE_AI_MONTHLY` `:2372`, `aiNote` `:15492` |

---

## What the research says, and what it means here

| Finding | Source | So we… |
|---|---|---|
| Icons need visible text labels. Meaning of an icon is learned, and few icons are universal. In one vendor test, people predicted what a labelled icon did 88% of the time vs 60% for unlabelled | [NN/g, Icon Usability](https://www.nngroup.com/articles/icon-usability/); [NN/g video](https://www.nngroup.com/videos/icon-text-labels/) | Name the action after the user's goal ("Snap a meal"), not the mechanism ("Estimate", ✨). Never let two camera icons mean two different things in one sheet |
| Value has to land in the first session. Tours get dismissed, and contextual prompts triggered by behaviour do better | [Appcues, aha moment](https://www.appcues.com/blog/aha-moment-guide); [Appcues, mobile onboarding](https://www.appcues.com/blog/mobile-onboarding-best-practices) | Teach the photo path by making the **first** onboarding task a photo log, delivered through the buddy (`Dialogue`), not a tooltip tour |
| Ask to install after a real engagement signal, explain the benefit, and on iOS give step-by-step help because there is no native prompt | [web.dev, install strategy](https://web.dev/articles/define-install-strategy); [web.dev, promote install](https://web.dev/articles/promote-install); [Google PWA UX playbook](https://services.google.com/fh/files/misc/pwa_ux_playbook_2020.pdf) | Show the install card **after the first successful log**, framed as "the app" |
| An iOS home-screen web clip has its own storage, so users can be asked to sign in again after installing | [DZone, iOS PWA installation](https://dzone.com/articles/ios-pwa-installation) | Test it. If it happens, warn about it in the iOS steps ("you'll sign in once more") so it doesn't feel broken |
| Photo logging lowers effort, but most people still drop off: 2.58% were still active in a 189k-user photo app cohort. Low-effort methods can also form *weaker* habits than deliberate logging | [Helander et al., JMIR 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4004142); [NYU IFP case study](https://ifp.nyu.edu/2021/journal-article-abstracts/s41347-021-00203-9/) | Making photos easy isn't enough. Pair them with a **cue**: a reminder at a regular meal time, plus the existing streak and buddy |
| Habits form by repeating an action in a stable context (median 66 days, range 18–254). A missed day doesn't matter much, but inconsistency does | [Lally et al., via UCL](https://www.ucl.ac.uk/news/2009/aug/how-long-does-it-take-form-habit); [BPS Research Digest](https://bps.org.uk/research-digest/how-form-habit) | Tie the reminder to a meal the user chooses ("after lunch"), not a generic time |
| Simplified self-monitoring keeps engagement much higher (97% vs 49% of days in one pilot), and weight loss was similar to full tracking in a small RCT. Evidence is mixed: one reduced-*frequency* pilot did worse | [JMIR Formative 2022](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9795401/); [PATH pilot, Nezami 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9469733); [Stanford trial, ongoing](https://clinicaltrials.gov/study/NCT07601061) | Offer an opt-in **Easy mode** that simplifies *what you see*, not *how often you log*: still log every meal, but lead with calories and protein |
| AI photo estimates are fairly accurate on average but can be badly wrong for a single meal, and they **underestimate** large and high-fat plates (about a third low across four apps in one test) | [arXiv 2610.26538](https://arxiv.org/pdf/2610.26538); [ScienceDaily, Jul 2026](https://sciencedaily.com/releases/2026/07/260726015237.htm); [PMC12655113](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12655113/) | Keep the current range, confidence and follow-up question (already good). Add one portion nudge for big and oily plates (Phase 2d) |

---

## Phase 0: Measure first (small, do it with Phase 1)

Add `MTRACK` events so we can see whether this works:

- `log_route` with `{ route: 'search'|'snap'|'describe'|'label'|'barcode'|'quick'|'share'|'shortcut', first: bool }`, fired by `addEntry`/`addEstimateItems` for the route a log came from.
- `install_card` with `{ outcome: 'shown'|'accepted'|'dismissed'|'ios_help', trigger }`.
- `snap_open` with `{ from: 'chip'|'today'|'shortcut'|'checklist'|'buddy' }`.

**Success metrics** (compare 4 weeks before and after):
- % of new accounts whose **first week** includes a photo log.
- Median time from signup to the first photo log.
- Install rate among accounts with ≥1 log.
- Share of accounts logging on ≥4 of their first 7 days.

---

## Phase 1: Name it and put it one tap away (main fix, small)

**1a. Rename the chip.** In `FoodTab` (`:15369`), the sparkle `Estimate` chip becomes **`Snap a meal`** with the
pixel `Icon.cam`. Keep the chip order `Quick add · Snap a meal · Drink`. It must still fit on one
line at 320px: "Snap a meal" is 11 characters, "Estimate" was 8. Check this. If it wraps, shorten
"Quick add" to "Quick".

**1b. Make the two camera icons mean different things.** The camera inside the search field
(`:15363`) scans labels. Give it a **label** glyph instead (a small nutrition-panel mark, new in
`tools/pixel-icons.py`) with `aria-label="Scan a nutrition label"`, so the only camera in the sheet
means "photo of my meal".

**1c. Rename the tabs inside the estimator.** `Describe / Label photo / Menu` (`:15530`) becomes
**`Meal / Label / Menu`**. The meal tab stays the default and its copy is unchanged ("Snap it, type
it or say it…").

**1d. Snap goes straight to the camera.** Tapping `Snap a meal` opens `MealCamera` immediately,
with "Type or say it instead" as the escape, rather than landing on the form. On desktop, or with
no camera, keep today's form. This saves a tap and matches the label.

**1e. Add a home-screen shortcut.** Add `{ "name": "Snap a meal", "url": "/?action=snap" }` to
`manifest.webmanifest` (put it first: Android shows the first ones). Handle `action === 'snap'` in
the launch-intent effect (`:23021`) by opening the log sheet in `describe` mode with the camera
open.

**1f. Today.** Stay within the content budget (DESIGN.md: one hero, one buddy prompt). Don't add a
card. Instead, when a mealtime slot is empty, the buddy's prompt on Today can be "Lunch? Snap it and
I'll work it out", with a ▶ `Snap a meal` answer. This uses the existing `Dialogue` menu, so it adds
no new UI.

## Phase 2: Teach by doing in the first session (small)

**2a. Reorder and retarget the checklist.** In both `hatchTasks` (`:13854`) and
`OnboardingChecklist` (`:21068`), replace "Log a meal" + "Log with a scan, photo or recipe" with:
1. **Snap your next meal** → opens the camera (`?action=snap` path).
2. Log something else (search, barcode or recipe) → the search sheet.

The first item is the aha moment: point, shoot, get a sensible number. The data checks stay the
same (`source === 'ai_estimate'` with photos counts for item 1).

**2b. Welcome copy.** `WelcomeCarousel` incubating line: "Log your first meal and I'll start
growing" becomes "**Snap a photo of your next meal** and I'll start growing. No weighing, no
searching."

**2c. Make the first photo log free.** *Needs a decision (see Open questions).* If the first AI
estimate didn't spend from the 10 free a month, the first-run experience would never say "9 of 10
left", which reads like a meter running. The proxy already knows the user's call count
(`supabase/functions/ai-proxy/index.ts` ~`:180`), so this is a one-line exemption when the count is
0.

**2d. Portion nudge for big and oily plates.** In `AiConfirm`, when the estimate is above ~900 kcal
or fat is above ~45% of energy and `conf !== 'high'`, show the existing follow-up slot (if unused)
as "Big portion? Restaurant plates are often bigger than they look." with `Normal / Large / Huge`.
Reuse `onRefine`. This targets the known underestimation without adding friction to ordinary meals.

## Phase 3: "Get the app" (small)

**3a. Render the install card.** Mount `InstallCard` on Today, **after the first successful log of
the session that follows the user's first log ever** (an engagement signal, per web.dev), and never
in the same session as onboarding. Keep the existing 14-day re-show. Content budget: it takes the
slot of the one secondary card, and is hidden while the onboarding checklist is showing.

**3b. Call it the app.** Title: **"Get the Macrosaurus app"**. Body for iOS: "Full screen, its own
icon, and photo logging one tap from your home screen. No App Store needed, about 30 seconds."
Android: the same, with an `Install` button. Do the same in `InstallMenuRow`: label "Get the app",
desc "Install Macrosaurus on this phone".

**3c. iOS outside Safari.** `isIOSSafari()` currently hides install entirely in Chrome/Firefox/Edge
on iOS. Show the card there too, with one step first: "Open this page in Safari" plus a copy-link
button.

**3d. Sign-in after install.** Test on a real iPhone. If the installed web clip asks people to sign
in again, add step 4 to `IOSInstallSheet`: "Open it and sign in once more. That's it."

**3e. Tell people about sharing to the app.** Once installed, a one-time buddy line: "Tip: share a
food photo from your camera roll straight to me." It's already supported (share target), just
invisible.

## Phase 4: Easy mode for busy people (medium, opt-in)

For people like this tester. A toggle in You → Preferences, and offered once in onboarding as "Keep
it simple?":

- **Today** leads with calories left and protein, and carbs/fat/fibre fold into the detail sheet.
  All macros are still computed and stored. This changes the view, not the data, so turning it off
  loses nothing.
- **The + opens on Snap a meal** (camera first), with search as the escape.
- **One mealtime reminder**, anchored to a meal the user picks ("after dinner"), using the existing
  push plumbing (`:18947`). This is the habit cue from the research.
- The weekly check-in and adaptive targets are **unchanged**: that's where the value is, and the
  coaching works the same off rougher logs.

We don't reduce how often people log. That was the arm that underperformed in the reduced-frequency
pilot.

## Phase 5: The app stores (later; recorded so it isn't forgotten)

The feedback said "a phone app", and for many people that means the store. Cheapest routes once the
loss-leader stage is over:

- **Android, Google Play via a Trusted Web Activity** (Bubblewrap/PWABuilder). It wraps the existing
  PWA, costs a one-off developer registration fee, and needs no second codebase. Do this first.
- **iOS, App Store via a Capacitor shell.** It needs an annual Apple developer membership and enough
  native behaviour to pass review (camera, push and share already exist, which helps). Do this
  second.

Neither blocks Phases 1–4, and both get better once the PWA itself is easy to find.

---

## Order of work

1. Phase 0 events + Phase 1a–1e (one PR: names, icons, shortcut, intent).
2. Phase 2a, 2b, 2d (onboarding + portion nudge).
3. Phase 3a–3c, then 3d after a device test.
4. Phase 1f and 3e (buddy lines).
5. Phase 4, behind a preference.
6. Phase 5 when it makes commercial sense.

## Tests

- `tests/`: a unit test that `?action=snap` resolves to the describe mode with the camera open.
- Checklist: a photo `ai_estimate` entry ticks "Snap your next meal". A barcode log ticks only "Log
  something else".
- Portion nudge: shown at 950 kcal with `conf: 'medium'`, hidden at `conf: 'high'`, hidden when the
  follow-up question was already used.
- Visual check at 320px: the chip row fits on one line, and the label glyph is legible at 24px in
  both themes.

## Open questions (Olly to decide)

1. **First photo log free?** (2c) This costs one AI call per signup but removes the meter from the
   first impression.
2. **Easy mode:** offer it in onboarding, or only in Preferences?
3. **Store timing:** is a one-off Google Play fee acceptable now that Android is the cheap route?
