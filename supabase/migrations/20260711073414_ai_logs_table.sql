-- AI request logs for admin vetting/tuning of the AI features.
-- Stores the prompt, the model's result, metadata, and the (downscaled) input images inline
-- as data URIs. RLS is enabled with NO policies: only the service role (used by the ai-proxy
-- and admin-api edge functions) can read or write; the anon/authenticated keys get nothing.
create table if not exists public.ai_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  created_at    timestamptz not null default now(),
  feature       text not null default 'other',   -- label | meal | coach | other (bodyfat is never logged)
  model         text,
  prompt        text,
  result        text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric,
  image_count   integer not null default 0,
  images        text[],                            -- data URIs; only read by the detail view
  status        text not null default 'ok'         -- ok | error
);

alter table public.ai_logs enable row level security;
-- Intentionally no policies: service-role bypasses RLS; everyone else is denied.

create index if not exists ai_logs_created_idx       on public.ai_logs (created_at desc);
create index if not exists ai_logs_user_created_idx  on public.ai_logs (user_id, created_at desc);
create index if not exists ai_logs_feature_idx       on public.ai_logs (feature);

comment on table public.ai_logs is 'AI proxy request/response logs for admin review. Auto-purged after 30 days. Body-fat photo calls are never logged.';
