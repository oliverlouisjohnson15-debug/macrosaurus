-- Stop the state archive from being the biggest thing in the database.
--
-- user_state.data is one large JSONB blob per user (recipe art is inlined as base64), and the
-- BEFORE UPDATE trigger copied the whole previous blob into user_state_history on EVERY save --
-- including saves that changed nothing. At ~1.5 MB a copy that put 76 MB of history on one account
-- in a single day, and the matching churn on user_state itself left 666k dead TOAST rows behind
-- (1.3 GB of bloat for ~2 MB of live data).
--
-- Two changes, neither of which alters what the app reads or writes:
--   1. The trigger only fires when data actually changed (WHEN clause below).
--   2. A snapshot is taken at most once an hour per user. The 50-row cap is unchanged, so instead of
--      50 near-identical copies spanning a few busy hours, history now covers ~2 days of real edits
--      -- more useful for recovery, and a fraction of the writes.

create or replace function archive_user_state()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Already snapshotted this user within the last hour? Keep the existing one; the row we'd add is a
  -- near-duplicate of it. The live copy in user_state is always the newest state regardless.
  if exists (
    select 1 from user_state_history
    where user_id = OLD.user_id and archived_at > now() - interval '1 hour'
  ) then
    return NEW;
  end if;

  insert into user_state_history(user_id, data, updated_at)
  values (OLD.user_id, OLD.data, OLD.updated_at);
  delete from user_state_history h
  where h.user_id = OLD.user_id
    and h.id <= coalesce((select id from user_state_history
                          where user_id = OLD.user_id order by id desc offset 50 limit 1), 0);
  return NEW;
end $function$;

-- Skip the function entirely for updates that don't touch the blob (a touched updated_at, an admin
-- write that lands the same data). Recreated rather than altered: a trigger's WHEN clause is fixed
-- at creation time.
drop trigger if exists trg_archive_user_state on public.user_state;
create trigger trg_archive_user_state
  before update on public.user_state
  for each row
  when (OLD.data is distinct from NEW.data)
  execute function archive_user_state();

-- Index the throttle's lookup so it stays a cheap probe rather than a scan of a user's history.
create index if not exists user_state_history_user_archived_idx
  on public.user_state_history (user_id, archived_at desc);
