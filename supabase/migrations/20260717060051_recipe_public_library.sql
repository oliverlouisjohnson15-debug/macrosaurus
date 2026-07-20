-- Shared recipe library. Rows are owned by the submitter and RLS-private (each user sees only their
-- own directly). The cross-user, anonymised, deduped view is exposed only through browse_recipes(),
-- a SECURITY DEFINER function granted to authenticated -- mirroring the food_submissions pattern.
create table if not exists public.recipe_public (
  id uuid primary key default gen_random_uuid(),
  submitter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_url text not null,
  source_platform text,
  title text not null,
  servings int not null default 1,
  ingredients jsonb not null default '[]'::jsonb,  -- array of plain line strings, no user data
  steps jsonb not null default '[]'::jsonb,
  kcal numeric, protein numeric, carbs numeric, fat numeric, fiber numeric,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_url, submitter)
);
alter table public.recipe_public enable row level security;
drop policy if exists own_recipe_public_rw on public.recipe_public;
create policy own_recipe_public_rw on public.recipe_public for all
  using (auth.uid() = submitter) with check (auth.uid() = submitter);

-- Contribute (or update) the caller's copy of a recipe to the shared pool. Only priced, attributable
-- recipes are accepted. Setting p_private true keeps a submitted recipe out of Discover.
create or replace function public.submit_public_recipe(
  p_source_url text, p_source_platform text, p_title text, p_servings int,
  p_ingredients jsonb, p_steps jsonb,
  p_kcal numeric, p_protein numeric, p_carbs numeric, p_fat numeric, p_fiber numeric,
  p_private boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_source_url is null or length(trim(p_source_url)) = 0 then return; end if;
  if coalesce(p_kcal,0) <= 0 then return; end if;
  insert into public.recipe_public(submitter, source_url, source_platform, title, servings, ingredients, steps, kcal, protein, carbs, fat, fiber, is_private, updated_at)
  values (auth.uid(), trim(p_source_url), nullif(p_source_platform,''), coalesce(nullif(p_title,''),'Recipe'), greatest(1, coalesce(p_servings,1)),
          coalesce(p_ingredients,'[]'::jsonb), coalesce(p_steps,'[]'::jsonb), p_kcal, p_protein, p_carbs, p_fat, p_fiber, coalesce(p_private,false), now())
  on conflict (source_url, submitter) do update set
    title=excluded.title, source_platform=excluded.source_platform, servings=excluded.servings,
    ingredients=excluded.ingredients, steps=excluded.steps,
    kcal=excluded.kcal, protein=excluded.protein, carbs=excluded.carbs, fat=excluded.fat, fiber=excluded.fiber,
    is_private=excluded.is_private, updated_at=now();
end; $$;
grant execute on function public.submit_public_recipe(text,text,text,int,jsonb,jsonb,numeric,numeric,numeric,numeric,numeric,boolean) to authenticated;

-- Browse the shared pool: anonymised (no submitter), deduped by source_url, filtered by fit to the
-- caller's remaining macros, ranked by protein density then popularity.
create or replace function public.browse_recipes(
  p_kcal_max numeric default null, p_min_protein numeric default 0, p_limit int default 40
) returns table(source_url text, source_platform text, title text, servings int, ingredients jsonb, steps jsonb,
                kcal numeric, protein numeric, carbs numeric, fat numeric, fiber numeric, votes int)
language sql security definer set search_path = public as $$
  with dedup as (
    select distinct on (source_url) source_url, source_platform, title, servings, ingredients, steps, kcal, protein, carbs, fat, fiber
    from public.recipe_public where is_private = false and kcal > 0
    order by source_url, updated_at desc
  )
  select d.source_url, d.source_platform, d.title, d.servings, d.ingredients, d.steps, d.kcal, d.protein, d.carbs, d.fat, d.fiber,
         (select count(*)::int from public.recipe_public rp where rp.source_url = d.source_url and rp.is_private = false) as votes
  from dedup d
  where (p_kcal_max is null or d.kcal <= p_kcal_max)
    and (coalesce(p_min_protein,0) = 0 or d.protein >= p_min_protein)
  order by (d.protein / nullif(d.kcal,0)) desc nulls last, votes desc
  limit greatest(1, least(coalesce(p_limit,40), 100));
$$;
grant execute on function public.browse_recipes(numeric,numeric,int) to authenticated;
