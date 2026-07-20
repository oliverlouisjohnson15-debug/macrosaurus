-- Let the finder filter by main ingredient and effort (Quick), the axes that actually discriminate.
drop function if exists public.browse_recipes(numeric, numeric, integer, text, text, text, text);
create or replace function public.browse_recipes(
  p_kcal_max numeric default null, p_min_protein numeric default 0, p_limit integer default 40,
  p_meal text default null, p_cuisine text default null, p_creator text default null, p_search text default null,
  p_main text default null, p_effort text default null
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
    and (p_main    is null or d.main    = p_main)
    and (p_effort  is null or d.effort  = p_effort)
    and (p_creator is null or lower(coalesce(d.source_author,'')) = lower(p_creator))
    and (p_search  is null or d.title ilike '%'||p_search||'%' or coalesce(d.source_author,'') ilike '%'||p_search||'%')
  order by (d.protein / nullif(d.kcal,0)) desc nulls last, votes desc
  limit greatest(1, least(coalesce(p_limit,40), 100));
$function$;
revoke all on function public.browse_recipes(numeric, numeric, integer, text, text, text, text, text, text) from public, anon;
grant execute on function public.browse_recipes(numeric, numeric, integer, text, text, text, text, text, text) to authenticated;
