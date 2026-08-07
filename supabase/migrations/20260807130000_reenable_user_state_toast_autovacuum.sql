-- Re-enable autovacuum on user_state's TOAST table.
--
-- The TOAST table behind user_state.data was carrying autovacuum_enabled=false. Because the state
-- blob is large, every UPDATE writes a whole new TOAST chain and leaves the old one dead -- and with
-- autovacuum switched off, that dead space was never reclaimed or recycled. It reached 666k dead
-- rows against 809 live ones: 1.3 GB of a 1.4 GB database, on a table holding 14 rows.
--
-- This is the setting that let the bloat grow without bound rather than reaching a steady state. The
-- throttling work in the companion migration reduces how much churn is produced; this makes sure the
-- churn that remains is actually recycled.
--
-- The scale factor is deliberately tighter than the 0.2 default: the table has one row per user, so a
-- proportional threshold is nearly zero rows on a small table and lets dead TOAST chains accumulate
-- between runs. 5% plus a flat 100-row floor keeps it vacuuming on churn rather than on row count.
alter table public.user_state set (
  toast.autovacuum_enabled = true,
  toast.autovacuum_vacuum_scale_factor = 0.05,
  toast.autovacuum_vacuum_threshold = 100
);
