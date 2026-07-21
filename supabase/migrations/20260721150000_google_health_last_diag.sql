-- Google Health sync diagnostic: the last health-fetch result (per-metric HTTP status, point counts,
-- and the structural SHAPE of the first data point - field names and value TYPES only, never a health
-- value). Lets a future breakage in the HRV / resting HR / SpO2 parsing be inspected server-side
-- without another live guessing round. Written by the google-health-proxy edge function on each sync.
alter table public.google_health_connections add column if not exists last_health_diag jsonb;
