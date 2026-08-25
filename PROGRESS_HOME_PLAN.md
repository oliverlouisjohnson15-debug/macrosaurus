# Today + Progress overhaul: research and plan

Working doc, started 2026-08-25. Companion to the paper-terrarium design system
(see the design-system memory) and `design-plans/`.

## 1. What the good apps actually put on these screens

### MacroFactor (the closest competitor, and the one to beat)

Its dashboard is a stack of widgets in four groups, with a customisable "hat" at the top.

| Widget | What it draws |
|---|---|
| Nutrition & Targets (the hat) | The week as four stacked bars per day: kcal, protein, fat, carbs, against target. Toggles "consumed" vs "remaining". |
| Energy Balance | 30 days of intake plotted against EITHER your targets (a compliance audit) or your expenditure (the actual deficit). |
| Expenditure | The learned burn as a line over time, updated daily from intake vs weight change. |
| Weight Trend | Raw scale weight as a pale line, the smoothed trend as a bold one. |
| Goal Progress | A WATERFALL: week 0 is the size of the whole goal, each week is a bar of what that week contributed (light = toward, dark = away), a grey bar on the right for what is left. Maintenance goals get a dial holding you inside +/- 1.5 lb. |
| Logging Habits | Consistency of nutrition and weight logging over time, editable in place. |
| Scale weight / Body metrics | Today's weight, a 7-day line, 24 tape measurements, progress photos from three angles. |

Their stated hierarchy: the day's targets lead, because that is the in-the-moment
question. Expenditure and weight trend sit high "because users like to keep them
handy". Everything deep lives in an inner dashboard behind the widget. Tone is
explicitly "adherence-neutral", process over short-term failure.

Two ideas worth stealing outright:
- **Energy Balance.** It is the only widget that JOINS what you ate to what you
  weigh. It is also the honest answer to "why am I behind plan", which we
  currently guess at in one line of prose.
- **Goal Progress waterfall.** Distance-to-goal as a HISTORY rather than a single
  meter. A bad week is visible as one dark bar next to nine light ones, which is
  the argument for consistency made in a picture.

One idea worth refusing: **widget customisation**. It is the right answer for an
app that wants to be everyone's; it is the wrong answer for one with a coach's
voice and an opinion.

### Carbon Diet Coach

Four tabs: Diary, Coach, Me, Settings. The weekly check-in is a destination of its
own (the Coach tab), prompted so it cannot be missed, and it is where the numbers
change. "Me" holds body values and weekly-average graphs of calories and macros.
The lesson: the check-in is a first-class place, not a card. We already treat it
as a conversation, which is further along than Carbon; what we lack is Carbon's
"Me" screen, i.e. weekly AVERAGES of intake rather than only per-day figures.

### Happy Scale (and Trendweight)

Pure weight-trend apps, and they are the best in the world at the one thing:
- Moving averages you choose (7 / 30 / 90 / all-time) and COMPARE against each other.
- Projection: what you will weigh on a date you name, or how many weeks to a weight.
- Ten milestones, so a 10 kg goal is ten small wins rather than one distant one.
- The graph colours the last 30 days against where you were 30 days ago.

We already ship milestone celebrations. What we do not ship is the LADDER: the
milestones as a visible set with the next one named.

### MyFitnessPal / Cronometer

The two ends of the density spectrum. MFP's home is calories, macros, log button,
nothing else, and it wins on speed. Cronometer's is a full nutrient panel and it
wins on depth while being widely described as overwhelming. Our density card and
recovery strip put us nearer Cronometer than we probably intend.

## 2. What we have today

**Today** (in render order): header, week-plan banner, onboarding checklist,
premium nudge, buddy habitat (terrarium + kcal left / protein / steps / streak +
the buddy's ask), cycle strip (verdict + trend weight + check-in), Today's plan
(energy band, three macro rows, fibre | density, balance), recovery (move / sleep /
ready), quote.

**Progress**: This cycle (verdict, distance meter, coverage caveat, trend weight,
check-in), Trend weight chart, Daily burn (+ target + macro split + next-check-in
forecast), Lately (protein hit, days logged, steps, density week), Your plan over
time (the coach's changes with reasons), weigh-in log.

## 3. The gap, stated plainly

Things a person wants here that neither screen answers:

1. **"Did I actually eat what I said I would?"** We show today's intake and a
   count of days logged. We never plot intake against target or against burn over
   time. This is MacroFactor's Energy Balance and it is our biggest hole.
2. **"What did each week contribute?"** We have distance-to-goal as one 10-cell
   meter. A history of weekly contributions is both more motivating and more
   diagnostic.
3. **"When do I get there, in dates?"** We say "about 6 weeks". A date, and a
   named next milestone, is what people screenshot.
4. **"What are my averages?"** Weekly average kcal / protein is the number a coach
   reads first. We have no averages screen at all.
5. **"How consistent have I been, over months?"** Lately covers 7/14/30 days as
   tiles. There is no longer view, deliberately (the 84-square grid was removed),
   but the pendulum may have swung too far.
6. **Body composition beyond weight.** Body fat and lean exist in the chart;
   measurements and photos do not.

Things we have that they do not, and which the overhaul must protect:
- The coach's timeline: what changed, when, and WHY, in sentences.
- The buddy, and the check-in as a conversation rather than a form.
- Food quality (density) and the recovery lane (steps, sleep, readiness).

## 4. The proposed split

One rule, applied to every block on both screens:

> **Today answers "what do I do now".**
> **Progress answers "is it working, and why".**

Anything on Today that is not actionable today belongs on Progress. Anything on
Progress that is a to-do belongs on Today.

### Today, after

1. Buddy habitat (unchanged) with the day's four tiles and the ask.
2. **The weekly read**, one row, tappable: verdict, trend weight, check-in when
   due. (This is the cycle strip as it stands. It stays.)
3. Today's plan (unchanged).
4. Recovery (unchanged).

That is: no new blocks on Today. The overhaul on this screen is about what LEAVES
it, and about the strip being the single door into the deeper screen.

### Progress, after: five questions in order

| # | Question | Block | Status |
|---|---|---|---|
| 1 | Where am I? | This cycle: verdict, rate vs target, ETA as a DATE, distance meter, trend weight, check-in | exists, wants the date and the next milestone |
| 2 | How did I get here? | **Goal progress**: weekly contribution bars, milestone ladder | NEW |
| 3 | What is my weight doing? | Trend weight chart | exists, wants comparable averages and a projection line |
| 4 | Did I do the thing? | **Energy balance**: intake vs target vs burn, 30 days, plus weekly averages | NEW, replaces/absorbs part of Lately |
| 5 | What did the coach change? | Daily burn + Your plan over time | exists, wants the burn chart raised |

Consistency (Lately) folds into 4 as the "how many days did this rest on" caption
rather than standing as its own crate, which also fixes the mismatched
denominators it currently prints.

## 5. Decisions (Olly, 2026-08-25)

1. **Today keeps ONE small item**, the weekly read, and it gets reworked. Progress
   is allowed to be a long scroll. No inner dashboards, no widget drill-downs: one
   page, top to bottom, in question order.
2. **No progress photos and no tape measurements.** Not our USP. Weight, trend,
   body fat and lean are the whole of body composition here.
3. **Paywall the new depth.** Energy balance and goal progress go behind Premium,
   alongside food quality. Free keeps the verdict, the trend chart, the burn and
   the coach's timeline, which is already more than most free tiers give.
4. **The buddy narrates Progress the way it narrates Train's progress screen.**
   That construction, from `train.jsx`: `BuddyHead` at 58px leaning over the top
   edge of a tinted panel, the buddy's name and the verdict word on the right, and
   ONE sentence that is the answer with the figures in bold. Evidence goes below
   it, never above. Half the height of a terrarium, and the overlap is what makes
   it read as a character rather than an avatar in a row.

## 6. The build, in slices

**Slice 1: the buddy answers the question.** Progress opens the way Train's
progress screen opens. Kicker becomes the question ("Is the plan working?"), the
verdict moves out of a `CardHead` and into the buddy's mouth, and what is left of
"This cycle" (distance meter, coverage caveat, trend weight, check-in) becomes the
evidence card under it. No new data, all existing figures.

**Slice 2: goal progress.** Weekly contribution bars from week 0 to now, plus the
milestone ladder with the next one named and dated. Premium.

**Slice 3: energy balance.** Intake against target and against burn, 30 days, with
weekly averages. Absorbs the Lately tiles, whose mismatched denominators go away
with them. Premium.

**Slice 4: the trend chart earns its keep.** A projection line to the goal weight
and a date, comparable moving averages, in the manner of Happy Scale.

**Slice 5: Today's weekly read, reworked**, once we know what Progress opens with,
so the strip is a genuine preview of the screen behind it rather than a summary
that happens to overlap.

## Sources

- MacroFactor dashboard help: https://help.macrofactorapp.com/en/articles/22-get-to-know-your-dashboard
- MacroFactor dashboard customisation: https://macrofactor.com/dashboard-customization/
- MacroFactor dashboard revamp rationale: https://macrofactor.com/dashboard-revamp/
- MacroFactor energy balance widget: https://help.macrofactorapp.com/en/articles/224-interpreting-the-energy-balance-widget
- MacroFactor weight trend: https://help.macrofactorapp.com/dashboard/weight_trend
- Carbon weekly check-in: https://help.joincarbon.com/en/articles/6004812-weekly-check-in
- Happy Scale: https://happyscale.com/
