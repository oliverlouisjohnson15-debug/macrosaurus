create table if not exists public.food_submissions (
  barcode text not null,
  user_id uuid not null,
  sig text not null,
  kcal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  fiber numeric not null default 0,
  basis text not null default 'per100',
  serving_g numeric not null default 0,
  serving_label text default '',
  name text default '',
  source text default '',
  updated_at timestamptz not null default now(),
  primary key (barcode, user_id)
);
alter table public.food_submissions enable row level security;
drop policy if exists own_submissions_rw on public.food_submissions;
create policy own_submissions_rw on public.food_submissions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Submit/replace this user's correction for a barcode. Coarse signature groups near-identical edits.
create or replace function public.submit_food_correction(
  p_barcode text, p_kcal numeric, p_protein numeric, p_carbs numeric, p_fat numeric, p_fiber numeric,
  p_basis text, p_serving_g numeric, p_serving_label text, p_name text, p_source text
) returns void language plpgsql security definer set search_path = public as $$
declare v_sig text; v_atw numeric;
begin
  if p_barcode is null or length(trim(p_barcode)) = 0 then return; end if;
  v_atw := coalesce(p_protein,0)*4 + coalesce(p_carbs,0)*4 + coalesce(p_fat,0)*9;
  -- ignore obviously broken corrections (calories way off the macros)
  if coalesce(p_kcal,0) <= 0 or (v_atw > 0 and coalesce(p_kcal,0) > v_atw*1.4 + 40) then return; end if;
  v_sig := round(coalesce(p_kcal,0)/5.0)::int || ':' || round(coalesce(p_protein,0))::int || ':' || round(coalesce(p_carbs,0))::int || ':' || round(coalesce(p_fat,0))::int;
  insert into public.food_submissions(barcode, user_id, sig, kcal, protein, carbs, fat, fiber, basis, serving_g, serving_label, name, source, updated_at)
  values (trim(p_barcode), auth.uid(), v_sig, p_kcal, p_protein, p_carbs, p_fat, p_fiber, coalesce(p_basis,'per100'), coalesce(p_serving_g,0), coalesce(p_serving_label,''), coalesce(p_name,''), coalesce(p_source,''), now())
  on conflict (barcode, user_id) do update set
    sig=excluded.sig, kcal=excluded.kcal, protein=excluded.protein, carbs=excluded.carbs, fat=excluded.fat, fiber=excluded.fiber,
    basis=excluded.basis, serving_g=excluded.serving_g, serving_label=excluded.serving_label, name=excluded.name, source=excluded.source, updated_at=now();
end; $$;

-- Consensus for a barcode: the most-voted signature, averaged, with vote count. Aggregate only, no user ids.
create or replace function public.get_community_food(p_barcode text)
returns table(votes int, kcal numeric, protein numeric, carbs numeric, fat numeric, fiber numeric, basis text, serving_g numeric, serving_label text, name text)
language sql security definer set search_path = public as $$
  with top as (
    select sig, count(*)::int as votes from public.food_submissions
    where barcode = trim(p_barcode) group by sig order by count(*) desc, max(updated_at) desc limit 1
  )
  select t.votes,
         round(avg(f.kcal))::numeric, round(avg(f.protein)::numeric,1), round(avg(f.carbs)::numeric,1), round(avg(f.fat)::numeric,1), round(avg(f.fiber)::numeric,1),
         mode() within group (order by f.basis), round(avg(nullif(f.serving_g,0)))::numeric,
         (array_agg(f.serving_label order by f.updated_at desc))[1], (array_agg(f.name order by f.updated_at desc))[1]
  from public.food_submissions f join top t on f.sig = t.sig
  where f.barcode = trim(p_barcode)
  group by t.votes;
$$;

grant execute on function public.submit_food_correction(text,numeric,numeric,numeric,numeric,numeric,text,numeric,text,text,text) to authenticated;
grant execute on function public.get_community_food(text) to authenticated;
