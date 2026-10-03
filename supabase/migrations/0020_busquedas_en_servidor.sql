-- Búsquedas en el servidor: la app pide solo lo que va a enseñar.
--
-- Hasta ahora varias pantallas descargaban el catálogo entero (734 productos con sus formatos, ~320 KB)
-- o todo el stock de todos los locales para filtrarlo en el navegador, aunque casi siempre se busca
-- un producto concreto o se mira un local. Estas funciones filtran, ordenan y paginan en Postgres:
--
-- 1) product_lookup(): buscador de productos para los formularios (traspasos, mermas, recepciones,
--    pedidos). Devuelve los N mejores resultados con sus formatos, el último precio (del proveedor
--    elegido si lo hay) y el stock del local. Lo del local va primero.
-- 2) stock_search(): la pantalla de stock por páginas, con los totales del local calculados aquí.
-- 3) v_supplier_summary: cuántos productos y precios tiene cada proveedor y cuándo cambió el último,
--    sin descargar todos sus precios (solo se cargan al abrir un proveedor).
--
-- Todas son security invoker: cada usuario ve exactamente lo que ya veía (mismas políticas RLS).

-- 1. Buscador de productos ---------------------------------------------------------------------

create or replace function product_lookup(
  p_search text default null,
  p_location uuid default null,
  p_supplier uuid default null,
  p_limit int default 20
) returns jsonb
language sql stable security invoker set search_path = public as $$
with words as (
  select array_remove(string_to_array(norm_text(trim(coalesce(p_search, ''))), ' '), '') as w,
         nullif(trim(coalesce(p_search, '')), '') as raw
),
cand as (
  select p.id, p.name, p.dimension::text as dimension, p.base_unit,
         c.name as category, fam.name as family,
         (p_location is not null and exists (
            select 1 from location_products lp
            where lp.product_id = p.id and lp.location_id = p_location and lp.active)) as in_location,
         -- Los que empiezan por lo escrito van antes que los que solo lo contienen.
         (cardinality(words.w) > 0 and norm_text(p.name) like words.w[1] || '%') as prefix
  from products p
  left join categories c on c.id = p.category_id
  left join categories fam on fam.id = c.parent_id
  cross join words
  where p.active
    and (
      cardinality(words.w) = 0
      or not exists (
        select 1 from unnest(words.w) x
        where norm_text(p.name || ' ' || coalesce(p.sku, '') || ' ' || coalesce(c.name, '') || ' ' || coalesce(fam.name, '')) not like '%' || x || '%'
      )
      -- Código de barras escaneado: coincidencia exacta con cualquiera de sus formatos.
      or exists (select 1 from product_packs k where k.product_id = p.id and k.barcode = words.raw)
    )
  order by in_location desc, prefix desc, p.name
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
),
numbered as (
  select cand.*, row_number() over () as ord from cand
)
select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'name', n.name,
    'dimension', n.dimension,
    'base_unit', n.base_unit,
    'category', n.category,
    'family', coalesce(n.family, n.category),
    'in_location', n.in_location,
    'stock', (select b.qty::text from stock_balances b where b.product_id = n.id and b.location_id = p_location),
    'packs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', k.id,
          'name', k.name,
          'qty', k.qty_base::text,
          'count', k.is_count_default,
          'purchase', k.is_purchase_default,
          -- Precio del proveedor elegido; sin proveedor, el más reciente de cualquiera.
          'price', (
            select sp.last_price::text from supplier_prices sp
            where sp.pack_id = k.id and sp.last_price is not null
              and (p_supplier is null or sp.supplier_id = p_supplier)
            order by sp.last_price_at desc nulls last
            limit 1
          )
        ) order by k.qty_base)
      from product_packs k where k.product_id = n.id and k.active), '[]'::jsonb)
  ) order by n.ord), '[]'::jsonb)
from numbered n
$$;

revoke execute on function product_lookup(text, uuid, uuid, int) from public, anon;
grant execute on function product_lookup(text, uuid, uuid, int) to authenticated;

-- 2. Stock por páginas ---------------------------------------------------------------------------

create or replace function stock_search(
  p_location uuid default null,
  p_search text default null,
  p_status text default null,   -- ok | low | critical
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
  where (p_status is null or b.status = p_status)
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
      'attention', count(*) filter (where status <> 'ok'))
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

-- 3. Resumen de proveedores ---------------------------------------------------------------------

create or replace view v_supplier_summary with (security_invoker = true) as
select s.id as supplier_id,
       count(sp.pack_id) as prices,
       count(distinct k.product_id) as products,
       max(sp.last_price_at) as last_price_at
from suppliers s
left join supplier_prices sp on sp.supplier_id = s.id
left join product_packs k on k.id = sp.pack_id
group by s.id;

revoke all on v_supplier_summary from anon;
grant select on v_supplier_summary to authenticated;
