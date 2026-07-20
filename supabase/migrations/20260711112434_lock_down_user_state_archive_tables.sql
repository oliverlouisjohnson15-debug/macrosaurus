-- Close the RLS hole: user_state_history and user_state_backup were readable/writable by anyone
-- with the anon key. Only the service role (admin tooling) and the archive trigger should touch them.

-- The archive trigger fires on a user's own UPDATE of user_state and writes user_state_history.
-- It must run with definer rights so those writes keep working once RLS is enabled. It only ever
-- touches user_state_history; search_path is pinned to avoid definer search_path hijacking.
create or replace function public.archive_user_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into user_state_history(user_id, data, updated_at)
  values (OLD.user_id, OLD.data, OLD.updated_at);
  delete from user_state_history h
  where h.user_id = OLD.user_id
    and h.id <= coalesce((select id from user_state_history
                          where user_id = OLD.user_id order by id desc offset 50 limit 1), 0);
  return NEW;
end $function$;

-- Enable RLS with NO policies: the service role bypasses RLS, the trigger is now security-definer,
-- and the anon/authenticated roles get no access at all.
alter table public.user_state_history enable row level security;
alter table public.user_state_backup  enable row level security;
