-- Reading the menu behind a pasted link: what happened, and what we already know.
--
-- Two tables, both written only by the menu-fetch edge function via the service role. RLS is enabled
-- with NO policies on either, so the anon/authenticated keys get nothing: a marketplace's menu is
-- not ours to hand out, and the log carries URLs people pasted, which is their business and not
-- another user's.
--
-- WHY THE LOG EXISTS. This feature succeeds or fails per PLATFORM, and there are hundreds of them.
-- The first real failure was only found because one person reported the same link three times and
-- the diag string was read out of the function logs by hand; that does not scale to "everything on
-- the web". Every attempt now leaves a row saying which host it was, which rung answered, and how
-- many dishes came back, so the question "where are we actually failing?" has an answer that is
-- counted rather than guessed. Effort then goes to the platform with fifty misses instead of the one
-- that happened to get complained about.
--
-- Deliberately NOT logged: the user. A row is about a website, not a person, and the coverage
-- question does not need to know who was hungry. The URL is kept because it is the only way to
-- reproduce a miss.

create table if not exists public.menu_fetch_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  host        text not null,                    -- the host as fetched, www. stripped
  url         text,                             -- the full link, so a miss can be reproduced
  ok          boolean not null default false,
  via         text,                             -- json-ld | embedded-state | graphql | rest | redbox | page-text | pdf | ''
  dish_count  integer not null default 0,
  ms          integer,                          -- how long the whole ladder took
  diag        text                              -- the per-rung trace: what each one saw
);

alter table public.menu_fetch_log enable row level security;
-- Intentionally no policies: service-role bypasses RLS; everyone else is denied.

create index if not exists menu_fetch_log_created_idx on public.menu_fetch_log (created_at desc);
create index if not exists menu_fetch_log_host_idx    on public.menu_fetch_log (host, created_at desc);
create index if not exists menu_fetch_log_miss_idx    on public.menu_fetch_log (ok, created_at desc);

comment on table public.menu_fetch_log is 'One row per menu-fetch attempt: which host, which rung answered, how many dishes. Drives platform coverage work. No user_id by design.';

-- The menu we already read, keyed by the link. A restaurant''s menu does not change between one
-- person opening the app in the car park and the next person opening it at the table, so a menu read
-- once should serve everyone who pastes that link rather than being re-fetched per device. The
-- client keeps its own 24h copy too; this is the shared one behind it, and it also means a site is
-- asked for its menu once rather than once per customer, which is the polite way to do this.
--
-- Misses are cached as well (ok=false with empty text): a site that cannot be read is worth
-- remembering, so the tenth person to paste that link is told instantly instead of waiting twelve
-- seconds for the same no.
create table if not exists public.menu_cache (
  url         text primary key,
  fetched_at  timestamptz not null default now(),
  ok          boolean not null default false,
  place       text,
  via         text,
  dish_count  integer not null default 0,
  menu_text   text
);

alter table public.menu_cache enable row level security;
-- Intentionally no policies: only the menu-fetch function (service role) reads and writes this.

create index if not exists menu_cache_fetched_idx on public.menu_cache (fetched_at desc);

comment on table public.menu_cache is 'Shared menu-per-URL cache behind the per-device one. PDFs are never cached here (megabytes of base64); misses are, so a known-unreadable site answers instantly.';
