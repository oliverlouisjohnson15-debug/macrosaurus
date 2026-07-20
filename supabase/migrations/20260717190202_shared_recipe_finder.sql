-- Enrich the shared recipe pool for a browsable, Mob-style finder: creator credit, thumbnail, taxonomy.
alter table public.recipe_public
  add column if not exists source_author text,
  add column if not exists thumbnail     text,
  add column if not exists meal          text,
  add column if not exists cuisine       text,
  add column if not exists main          text,
  add column if not exists effort        text;

-- browse_recipes: return the new fields and support finder filters (meal / cuisine / creator / free-text).
drop function if exists public.browse_recipes(numeric, numeric, integer);
create or replace function public.browse_recipes(
  p_kcal_max    numeric default null,
  p_min_protein numeric default 0,
  p_limit       integer default 40,
  p_meal        text    default null,
  p_cuisine     text    default null,
  p_creator     text    default null,
  p_search      text    default null
)
returns table(source_url text, source_platform text, source_author text, thumbnail text, title text,
              servings integer, ingredients jsonb, steps jsonb,
              kcal numeric, protein numeric, carbs numeric, fat numeric, fiber numeric,
              meal text, cuisine text, main text, effort text, votes integer)
language sql security definer set search_path to 'public' as $function$
  with dedup as (
    select distinct on (source_url)
      source_url, source_platform, source_author, thumbnail, title, servings, ingredients, steps,
      kcal, protein, carbs, fat, fiber, meal, cuisine, main, effort
    from public.recipe_public
    where is_private = false and kcal > 0
    order by source_url, updated_at desc
  )
  select d.source_url, d.source_platform, d.source_author, d.thumbnail, d.title, d.servings, d.ingredients, d.steps,
         d.kcal, d.protein, d.carbs, d.fat, d.fiber, d.meal, d.cuisine, d.main, d.effort,
         (select count(*)::int from public.recipe_public rp where rp.source_url = d.source_url and rp.is_private = false) as votes
  from dedup d
  where (p_kcal_max is null or d.kcal <= p_kcal_max)
    and (coalesce(p_min_protein,0) = 0 or d.protein >= p_min_protein)
    and (p_meal    is null or d.meal    = p_meal)
    and (p_cuisine is null or d.cuisine = p_cuisine)
    and (p_creator is null or lower(coalesce(d.source_author,'')) = lower(p_creator))
    and (p_search  is null or d.title ilike '%'||p_search||'%' or coalesce(d.source_author,'') ilike '%'||p_search||'%')
  order by (d.protein / nullif(d.kcal,0)) desc nulls last, votes desc
  limit greatest(1, least(coalesce(p_limit,40), 100));
$function$;

-- List the distinct creators in the pool (for the "filter by creator" chips), most recipes first.
create or replace function public.browse_recipe_creators(p_limit integer default 40)
returns table(source_author text, n integer)
language sql security definer set search_path to 'public' as $function$
  select source_author, count(distinct source_url)::int as n
  from public.recipe_public
  where is_private = false and kcal > 0 and coalesce(trim(source_author),'') <> ''
  group by source_author
  order by n desc, source_author asc
  limit greatest(1, least(coalesce(p_limit,40), 100));
$function$;

-- submit_public_recipe: also store creator, thumbnail and taxonomy. New params default to null so
-- any older caller keeps working; the client is updated to pass them.
drop function if exists public.submit_public_recipe(text, text, text, integer, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, boolean);
create or replace function public.submit_public_recipe(
  p_source_url text, p_source_platform text, p_title text, p_servings integer,
  p_ingredients jsonb, p_steps jsonb,
  p_kcal numeric, p_protein numeric, p_carbs numeric, p_fat numeric, p_fiber numeric, p_private boolean,
  p_source_author text default null, p_thumbnail text default null,
  p_meal text default null, p_cuisine text default null, p_main text default null, p_effort text default null
)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_source_url is null or length(trim(p_source_url)) = 0 then return; end if;
  if coalesce(p_kcal,0) <= 0 then return; end if;
  insert into public.recipe_public(submitter, source_url, source_platform, source_author, thumbnail,
    title, servings, ingredients, steps, kcal, protein, carbs, fat, fiber,
    meal, cuisine, main, effort, is_private, updated_at)
  values (auth.uid(), trim(p_source_url), nullif(p_source_platform,''), nullif(trim(coalesce(p_source_author,'')),''), nullif(p_thumbnail,''),
    coalesce(nullif(p_title,''),'Recipe'), greatest(1, coalesce(p_servings,1)),
    coalesce(p_ingredients,'[]'::jsonb), coalesce(p_steps,'[]'::jsonb),
    p_kcal, p_protein, p_carbs, p_fat, p_fiber,
    nullif(p_meal,''), nullif(p_cuisine,''), nullif(p_main,''), nullif(p_effort,''), coalesce(p_private,false), now())
  on conflict (source_url, submitter) do update set
    title=excluded.title, source_platform=excluded.source_platform, source_author=excluded.source_author,
    thumbnail=excluded.thumbnail, servings=excluded.servings, ingredients=excluded.ingredients, steps=excluded.steps,
    kcal=excluded.kcal, protein=excluded.protein, carbs=excluded.carbs, fat=excluded.fat, fiber=excluded.fiber,
    meal=excluded.meal, cuisine=excluded.cuisine, main=excluded.main, effort=excluded.effort,
    is_private=excluded.is_private, updated_at=now();
end; $function$;

-- Keep the original lockdown: these DEFINER functions are for signed-in users only, never anon.
revoke all on function public.browse_recipes(numeric, numeric, integer, text, text, text, text) from public, anon;
revoke all on function public.browse_recipe_creators(integer) from public, anon;
revoke all on function public.submit_public_recipe(text, text, text, integer, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, boolean, text, text, text, text, text, text) from public, anon;
grant execute on function public.browse_recipes(numeric, numeric, integer, text, text, text, text) to authenticated;
grant execute on function public.browse_recipe_creators(integer) to authenticated;
grant execute on function public.submit_public_recipe(text, text, text, integer, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, boolean, text, text, text, text, text, text) to authenticated;
