-- A second, independent dedupe slot for the late-day "streak at risk" push.
--
-- last_nudge_date caps the ordinary nudge at one per local day. The streak-save fires later in the
-- evening and is the single most valuable thing the buddy can say (a run the user has built is about
-- to break), so it must not be swallowed just because the ordinary nudge already went out at their
-- chosen hour. Giving it its own marker keeps both at one per local day: a user only ever gets two
-- in a day when they were nudged, still logged nothing by the evening, and had a streak to lose.
alter table public.push_subscriptions add column if not exists last_streaksave_date text;
