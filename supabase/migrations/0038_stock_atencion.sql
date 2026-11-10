-- Stock: filtro «bajo mínimo» que incluye lo que está sin stock (el mismo número que el Resumen y el
-- menú), y cuántos productos están a cero en los totales del local.
-- Compatible con lo anterior: mismos parámetros y mismas claves; 'attention' y 'critical' son nuevas.

create or replace function stock_search(
  p_location uuid default null,
  p_search text default null,
  p_status text default null,   -- ok | low | critical | attention (low + critical)
  p_limit int default 100,
  p_offset int default 0
) returns jsonb
language sql stable security invoker set search_path = public as $$
with words as (
  select array_remove(string_to_array(norm_text(trim(coalesce(p_search, ''))), ' '), '') as w
),
base as (
  select v.*,
         case when v.qty < 0 or (v.below_min and v.qty <= 0) then 'critical'
              when v.below_min then 'low'
              else 'ok' end as status
  from v_stock_valuation v
  where p_location is null or v.location_id = p_location
),
hit as (
  select b.* from base b cross join words
  where (p_status is null or b.status = p_status or (p_status = 'attention' and b.status <> 'ok'))
    and (cardinality(words.w) = 0 or not exists (
      select 1 from unnest(words.w) x
      where norm_text(b.product_name || ' ' || coalesce(b.category_name, '') || ' ' || coalesce(b.family_name, '')) not like '%' || x || '%'
    ))
),
page as (
  select * from hit
  order by product_name, product_id, location_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
)
select jsonb_build_object(
  'total', (select count(*) from hit),
  -- Totales del local (o de todos), sin la búsqueda ni el filtro de estado: las tarjetas de arriba.
  'summary', (select jsonb_build_object(
      'rows', count(*),
      'value', coalesce(sum(stock_value), 0)::text,
      'attention', count(*) filter (where status <> 'ok'),
      'critical', count(*) filter (where status = 'critical'))
    from base),
  'items', coalesce((select jsonb_agg(jsonb_build_object(
      'location_id', location_id, 'location_name', location_name,
      'product_id', product_id, 'product_name', product_name,
      'category_name', category_name, 'family_name', family_name,
      'base_unit', base_unit, 'dimension', dimension,
      'qty', qty::text, 'stock_value', stock_value::text, 'min_qty', min_qty::text,
      'count_pack_name', count_pack_name, 'count_pack_qty', count_pack_qty::text,
      'purchase_pack_name', purchase_pack_name, 'purchase_pack_qty', purchase_pack_qty::text,
      'status', status
    ) order by product_name, product_id, location_id) from page), '[]'::jsonb)
)
$$;

revoke execute on function stock_search(uuid, text, text, int, int) from public, anon;
grant execute on function stock_search(uuid, text, text, int, int) to authenticated;
