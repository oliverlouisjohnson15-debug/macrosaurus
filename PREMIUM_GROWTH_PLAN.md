# PREMIUM_GROWTH_PLAN.md · Selling Premium after Black Friday

Status: proposal, 2026-11-27. Nothing here is built yet. #178 shipped the doors (app-bar button,
You hero, redesigned sheet); this plan is about giving people a reason to walk through them, every
week of the year, not only during a sale.

## What the data says (Supabase, 27 Nov)

| | |
|---|---|
| Accounts | 35 (32 confirmed) |
| Active in the last 30 days (data changed) | 5 non-admin |
| Paying | 0. Two comp, one cancelled monthly |
| Free users who hit the 10 AI-log limit | 1 in October, 1 in November. Everyone else used 0–3 |
| Accounts only ever active on the day they joined | 12 of 24 non-admin |

Three conclusions:

1. **The biggest leak is not the paywall, it is day 2.** Half of sign-ups never come back after the
   first day. Premium can only be sold to people who stay, so anything that lifts first-week
   retention is also a Premium lever.
2. **Most free users never meet the limit.** Using 3 AI logs a month is nowhere near the 10-log
   limit, so "unlimited AI" is selling an answer to a problem most people never have. They have
   to *experience* Premium before they will want it.
3. **Sign-up is broken for Hotmail/Outlook.** Shauna, Luke and one from 5 Oct never got a
   confirmation email. Fix deliverability before spending effort on email-based conversion.

## The plan, in order

### 1. Reverse trial: every new account starts with 7 days of Premium (no card)

The single change that fixes conclusion 2. Instead of locking the good parts and hoping people
imagine them, new users *have* them for a week, then drop to Free and notice what they lost.

- Evidence: in Elena Verna's experience at Dropbox and elsewhere, reverse trials lifted
  free-to-paid by 10–40% (anecdotal, SaaS). RevenueCat finds trial starts cluster on day 0, and
  people who do not try during onboarding rarely try later. A reverse trial makes everyone try.
- Mechanics: on first setup, write a `subscriptions` row `{ status: 'trialing', plan: 'reverse',
  trial_end: +7d }`. The app already treats `trialing` as Premium. No Stripe involved, no card.
  A daily job (or a check on read) flips it to `free` after `trial_end`.
- Cost: AI spend for new users' first week. It is already capped by `premium_cap_usd` ($3/user/month),
  so the worst case is under $1 per sign-up.
- **UI**
  - Setup's last beat: the buddy says *"You've got Premium for your first week. Snap anything,
    ask me anything."* A gold ★ "Premium · 7 days" chip sits in the app bar where the Premium
    button would be. Tapping it shows what is unlocked and the days left as a pip meter (HP-meter style).
  - Day 5: one PromptRow on Today, "2 days of Premium left".
  - Day 8: **"Your Premium week" recap sheet.** A Dialogue plus a Section of rows built from their
    own week ("You snapped 14 meals · Your block was reviewed · Fibre filled on 31 foods"), then
    what changes now, then the plans. This is the best paywall the app will ever show, because
    every line on it is something they already did.

### 2. Show the Premium output, not a padlock

A lock says "no". A preview says "here's what you'd get". Every Premium feature produces something
the app can partly show:

| Feature | Free sees |
|---|---|
| Block review | The **first** review in full, free. After that, the headline line plus a fade into "Read it back to me · Premium" |
| Deeper dive | The first sentence of the dive, then the rest behind the button |
| Week plan in a sentence | The first one free ("Try it once on us") |
| Fibre on every food | Today's fibre bar shows the unknown part as a hatched segment: "~6 g we can't see" |
| Discover recipes | Already a teaser grid. Keep it, but show real titles and macros |

Rule: one free taste per feature, server-enforced (a `free_tastes` set in `ai_usage`), so the
first experience of each feature is the real one.

### 3. Make the AI allowance visible before it runs out

Today nobody sees the count until they hit the wall.

- **UI:** in the log sheet, beside Snap / Scan / Describe, a 10-pip meter in the app's HP style
  with "7 left this month". It turns warn-amber at 3. At 0 the buttons stay visible but open the
  paywall with reason `free_limit` (headline already written: "You've used your free AI logs").
- At 0, also offer the free route: "Invite a friend for 5 more". The referral system already
  exists and gives 5 AI logs to both people, so a dead end becomes a growth loop.

### 4. Premium as part of the game

The buddy is the emotional heart of the app, and nothing in the game currently marks a supporter
except the "Patron Saur" trophy.

- A **Patron crest** on the buddy's name plate (pixel ★, in `--link`) while subscribed.
- **One exclusive cosmetic a month** for subscribers (a hat, a scarf, a nest skin), shown greyed out
  in the shop for free users with a small "Premium" tag.
- Cosmetics only. The free game must never get worse. That is what keeps this honest, and it is
  what the Premium sheet's "Everything free stays free" line promises.

### 5. Offers after the sale, without being a discount shop

- **Trial-end offer:** for 48 hours after the reverse trial ends, the first year of annual is
  £29.99 instead of £39.99. It is personal and timed, and the countdown is real, so it is not a
  fake-urgency banner. Reuses the Black Friday coupon code path in `billing` with a second coupon.
- **Win-back:** 30 days after a trial ends or a subscription is cancelled, one email and one Today
  card with the same offer. Lifecycle emails already exist (`lifecycle_emails`). Add `trial_ending`,
  `trial_offer` and `winback` kinds, and fix Hotmail deliverability first.
- No permanent sale. A sale that never ends teaches people to wait.

### 6. Measure every door

#178 already sends `paywall_view { reason, source }`. Add `checkout_start { source, plan }` and
`checkout_success { plan }` (the `?sub=success` return), then build one PostHog funnel by
source. Review it fortnightly and remove placements that never convert. That is RevenueCat's
recommended method: show the paywall everywhere it fits, then remove places one at a time.

## What not to do

- **No hard paywall.** RevenueCat's data shows hard paywalls convert about 5× better than freemium,
  but with 3 weekly users and a day-2 leak it would end growth, not monetise it.
- **No interruptions mid-task.** Never show a modal while someone is logging food or mid-session. The one
  exception is something they tapped. The app's PromptSlot rule (one prompt on Today at a time) stays.
- **No making Free worse.** Only add to Premium.

## Suggested build order

| Step | What | Size |
|---|---|---|
| 0 | Fix Hotmail/Outlook confirmation delivery (SPF/DKIM/DMARC on the sending domain) | config |
| 1 | AI allowance meter + "invite a friend" at zero (§3) | small |
| 2 | Reverse trial + Premium-week recap sheet (§1) | medium |
| 3 | First-taste free for block review, week plan, deeper dive (§2) | medium |
| 4 | Trial-end offer + lifecycle emails (§5) | medium |
| 5 | Patron crest + monthly cosmetic (§4) | small–medium |
| 6 | checkout events + PostHog funnel (§6) | small, do alongside 1 |

## Sources

- RevenueCat, paywall placement: https://revenuecat.com/blog/growth/paywall-placement/
- RevenueCat, State of Subscription Apps 2026 (trial timing, hard vs freemium): https://www.revenuecat.com/state-of-subscription-apps-2026/
- RevenueCat, free trial length: https://www.revenuecat.com/blog/growth/free-trial-length
- CXL, reverse trials: https://cxl.com/blog/reverse-trial-strategy
- Amplitude, reverse trials: https://amplitude.com/en-us/blog/reverse-trial
- Airbridge on Adapty's onboarding vs in-app paywall data: https://www.airbridge.io/en/blog/paywall-conversion-structural-decisions
