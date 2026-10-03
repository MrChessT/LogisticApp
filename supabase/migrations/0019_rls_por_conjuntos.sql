-- Rendimiento (2): mismos permisos, sin trabajo por fila al leer.
--
-- 1) Las políticas `for all` de escritura (prod_write, pack_write, locprod_write…) también se
--    aplican a las lecturas (Postgres une con OR todas las políticas permisivas del comando). Al
--    llamar a is_manager()/can_access_location() con la columna de cada fila, cada SELECT ejecutaba
--    una subconsulta por fila: 734 productos tardaban ~70 ms en vez de ~1 ms. Ahora cada escritura
--    tiene sus políticas de insert/update/delete y la lectura solo evalúa su política *_select.
-- 2) Las políticas que miraban la cabecera con `exists (... where cab.id = linea.cab_id ...)` se
--    evaluaban fila a fila; ahora comparan con el conjunto de cabeceras visibles, calculado una vez
--    por consulta (`cab_id in (select id from ...)` → hashed SubPlan).
-- La lógica de acceso es idéntica: mismos roles, mismos locales, mismos estados de documento.

-- Conjuntos de acceso por rol -----------------------------------------------------------------

create or replace function my_manager_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid() and role in ('owner', 'admin', 'manager')
$$;

create or replace function my_admin_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid() and role in ('owner', 'admin')
$$;

-- Locales accesibles en organizaciones donde el usuario es responsable:
-- can_access_location(x) and is_manager(location_org(x)).
create or replace function my_managed_location_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select l.id from locations l
  where l.id in (select my_location_ids())
    and l.org_id in (select my_manager_org_ids())
$$;

revoke execute on function my_manager_org_ids(), my_admin_org_ids(), my_managed_location_ids() from public, anon;
grant execute on function my_manager_org_ids(), my_admin_org_ids(), my_managed_location_ids() to authenticated;

-- Tablas de organización ----------------------------------------------------------------------

drop policy if exists cat_write on categories;
create policy cat_insert on categories for insert with check (org_id in (select my_manager_org_ids()));
create policy cat_update on categories for update
  using (org_id in (select my_manager_org_ids())) with check (org_id in (select my_manager_org_ids()));
create policy cat_delete on categories for delete using (org_id in (select my_manager_org_ids()));

drop policy if exists sup_write on suppliers;
create policy sup_insert on suppliers for insert with check (org_id in (select my_manager_org_ids()));
create policy sup_update on suppliers for update
  using (org_id in (select my_manager_org_ids())) with check (org_id in (select my_manager_org_ids()));
create policy sup_delete on suppliers for delete using (org_id in (select my_manager_org_ids()));

drop policy if exists prod_write on products;
create policy prod_insert on products for insert with check (org_id in (select my_manager_org_ids()));
create policy prod_update on products for update
  using (org_id in (select my_manager_org_ids())) with check (org_id in (select my_manager_org_ids()));
create policy prod_delete on products for delete using (org_id in (select my_manager_org_ids()));

drop policy if exists loc_write on locations;
create policy loc_insert on locations for insert with check (org_id in (select my_admin_org_ids()));
create policy loc_update on locations for update
  using (org_id in (select my_admin_org_ids())) with check (org_id in (select my_admin_org_ids()));
create policy loc_delete on locations for delete using (org_id in (select my_admin_org_ids()));

drop policy if exists mem_write on memberships;
create policy mem_insert on memberships for insert with check (org_id in (select my_admin_org_ids()));
create policy mem_update on memberships for update
  using (org_id in (select my_admin_org_ids())) with check (org_id in (select my_admin_org_ids()));
create policy mem_delete on memberships for delete using (org_id in (select my_admin_org_ids()));

drop policy if exists memloc_write on membership_locations;
create policy memloc_insert on membership_locations for insert with check (org_id in (select my_admin_org_ids()));
create policy memloc_update on membership_locations for update
  using (org_id in (select my_admin_org_ids())) with check (org_id in (select my_admin_org_ids()));
create policy memloc_delete on membership_locations for delete using (org_id in (select my_admin_org_ids()));

-- Formatos y precios (dependen del producto / proveedor) -------------------------------------

drop policy if exists pack_select on product_packs;
create policy pack_select on product_packs for select
  using (product_id in (select id from products where org_id in (select my_org_ids())));

drop policy if exists pack_write on product_packs;
create policy pack_insert on product_packs for insert
  with check (product_id in (select id from products where org_id in (select my_manager_org_ids())));
create policy pack_update on product_packs for update
  using (product_id in (select id from products where org_id in (select my_manager_org_ids())))
  with check (product_id in (select id from products where org_id in (select my_manager_org_ids())));
create policy pack_delete on product_packs for delete
  using (product_id in (select id from products where org_id in (select my_manager_org_ids())));

drop policy if exists sprice_select on supplier_prices;
create policy sprice_select on supplier_prices for select
  using (supplier_id in (select id from suppliers where org_id in (select my_org_ids())));

drop policy if exists sprice_write on supplier_prices;
create policy sprice_insert on supplier_prices for insert
  with check (supplier_id in (select id from suppliers where org_id in (select my_manager_org_ids())));
create policy sprice_update on supplier_prices for update
  using (supplier_id in (select id from suppliers where org_id in (select my_manager_org_ids())))
  with check (supplier_id in (select id from suppliers where org_id in (select my_manager_org_ids())));
create policy sprice_delete on supplier_prices for delete
  using (supplier_id in (select id from suppliers where org_id in (select my_manager_org_ids())));

drop policy if exists phist_select on price_history;
create policy phist_select on price_history for select
  using (supplier_id in (select id from suppliers where org_id in (select my_org_ids())));

-- Tablas por local ------------------------------------------------------------------------------

drop policy if exists locprod_write on location_products;
create policy locprod_insert on location_products for insert
  with check (location_id in (select my_managed_location_ids()));
create policy locprod_update on location_products for update
  using (location_id in (select my_managed_location_ids()))
  with check (location_id in (select my_managed_location_ids()));
create policy locprod_delete on location_products for delete
  using (location_id in (select my_managed_location_ids()));

drop policy if exists area_write on storage_areas;
create policy area_insert on storage_areas for insert
  with check (location_id in (select my_managed_location_ids()));
create policy area_update on storage_areas for update
  using (location_id in (select my_managed_location_ids()))
  with check (location_id in (select my_managed_location_ids()));
create policy area_delete on storage_areas for delete
  using (location_id in (select my_managed_location_ids()));

drop policy if exists stock_area_balance_select on stock_area_balances;
create policy stock_area_balance_select on stock_area_balances for select
  using (area_id in (select id from storage_areas where location_id in (select my_location_ids())));

-- Líneas de documentos: mismo estado de la cabecera, comparado contra el conjunto ---------------

drop policy if exists cntl_select on count_lines;
create policy cntl_select on count_lines for select
  using (count_id in (select id from inventory_counts where location_id in (select my_location_ids())));

drop policy if exists cntl_write on count_lines;
create policy cntl_insert on count_lines for insert
  with check (count_id in (select id from inventory_counts
                           where status = 'open' and location_id in (select my_location_ids())));
create policy cntl_update on count_lines for update
  using (count_id in (select id from inventory_counts
                      where status = 'open' and location_id in (select my_location_ids())))
  with check (count_id in (select id from inventory_counts
                           where status = 'open' and location_id in (select my_location_ids())));
create policy cntl_delete on count_lines for delete
  using (count_id in (select id from inventory_counts
                      where status = 'open' and location_id in (select my_location_ids())));

drop policy if exists cntr_select on count_results;
create policy cntr_select on count_results for select
  using (count_id in (select id from inventory_counts where location_id in (select my_location_ids())));

drop policy if exists rcpl_select on receipt_lines;
create policy rcpl_select on receipt_lines for select
  using (receipt_id in (select id from goods_receipts where location_id in (select my_location_ids())));

drop policy if exists rcpl_write on receipt_lines;
create policy rcpl_insert on receipt_lines for insert
  with check (receipt_id in (select id from goods_receipts
                             where status = 'open' and location_id in (select my_location_ids())));
create policy rcpl_update on receipt_lines for update
  using (receipt_id in (select id from goods_receipts
                        where status = 'open' and location_id in (select my_location_ids())))
  with check (receipt_id in (select id from goods_receipts
                             where status = 'open' and location_id in (select my_location_ids())));
create policy rcpl_delete on receipt_lines for delete
  using (receipt_id in (select id from goods_receipts
                        where status = 'open' and location_id in (select my_location_ids())));

drop policy if exists pol_select on purchase_order_lines;
create policy pol_select on purchase_order_lines for select
  using (order_id in (select id from purchase_orders where location_id in (select my_location_ids())));

drop policy if exists pol_write on purchase_order_lines;
create policy pol_insert on purchase_order_lines for insert
  with check (order_id in (select id from purchase_orders
                           where status = 'draft' and location_id in (select my_location_ids())));
create policy pol_update on purchase_order_lines for update
  using (order_id in (select id from purchase_orders
                      where status = 'draft' and location_id in (select my_location_ids())))
  with check (order_id in (select id from purchase_orders
                           where status = 'draft' and location_id in (select my_location_ids())));
create policy pol_delete on purchase_order_lines for delete
  using (order_id in (select id from purchase_orders
                      where status = 'draft' and location_id in (select my_location_ids())));

drop policy if exists trl_select on transfer_lines;
create policy trl_select on transfer_lines for select
  using (transfer_id in (select id from transfers
                         where from_location_id in (select my_location_ids())
                            or to_location_id in (select my_location_ids())));

drop policy if exists trl_write on transfer_lines;
create policy trl_insert on transfer_lines for insert
  with check (transfer_id in (select id from transfers
                              where status = 'draft' and from_location_id in (select my_location_ids())));
create policy trl_update on transfer_lines for update
  using (transfer_id in (select id from transfers
                         where status = 'draft' and from_location_id in (select my_location_ids())))
  with check (transfer_id in (select id from transfers
                              where status = 'draft' and from_location_id in (select my_location_ids())));
create policy trl_delete on transfer_lines for delete
  using (transfer_id in (select id from transfers
                         where status = 'draft' and from_location_id in (select my_location_ids())));

-- Perfiles: los del propio usuario y los de quien comparte organización -----------------------

drop policy if exists profile_select_shared_org on profiles;
create policy profile_select_shared_org on profiles for select
  using (user_id = (select auth.uid())
         or user_id in (select user_id from memberships where org_id in (select my_org_ids())));

-- Búsqueda del catálogo: mismos resultados, agregando formatos, proveedores, locales y stock una
-- sola vez por consulta en vez de con cuatro subconsultas por producto (~2-3x más rápida).

create or replace function catalog_search(
  p_search text default null,
  p_category uuid default null,
  p_supplier uuid default null,
  p_location uuid default null,
  p_dimension text default null,
  p_status text default 'active',     -- active | archived | all
  p_stock text default null,          -- con | sin | bajo
  p_sort text default 'name',         -- name | name_desc | recent | category
  p_no_category boolean default false,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language sql stable security invoker set search_path = public as $$
with words as (
  select array_remove(string_to_array(norm_text(trim(p_search)), ' '), '') as w
),
-- Agregados por producto calculados de una vez (antes: cuatro subconsultas laterales por producto).
pk as (
  select k.product_id,
         count(*) filter (where k.active) as packs,
         (array_agg(k.name order by k.is_purchase_default desc, k.qty_base desc) filter (where k.active))[1] as main_pack,
         (array_agg(jsonb_build_object('name', k.name, 'qty', k.qty_base::text) order by k.qty_base) filter (where k.active and k.is_count_default))[1] as count_pack,
         (array_agg(jsonb_build_object('name', k.name, 'qty', k.qty_base::text) order by k.is_purchase_default desc, k.qty_base desc) filter (where k.active and k.qty_base > 1))[1] as purchase_pack,
         string_agg(k.barcode, ' ') as barcodes
  from product_packs k
  group by k.product_id
),
sup as (
  select k.product_id, array_agg(distinct s.id) as ids, array_agg(distinct s.name) as names
  from product_packs k join supplier_prices sp on sp.pack_id = k.id join suppliers s on s.id = sp.supplier_id
  group by k.product_id
),
loc as (
  select lp.product_id, array_agg(lp.location_id) as ids
  from location_products lp where lp.active
  group by lp.product_id
),
st as (
  select lp.product_id,
         sum(coalesce(b.qty, 0)) as qty,
         bool_or(lp.min_qty > 0 and coalesce(b.qty, 0) < lp.min_qty) as low
  from location_products lp
  left join stock_balances b on b.location_id = lp.location_id and b.product_id = lp.product_id
  where lp.active and (p_location is null or lp.location_id = p_location)
  group by lp.product_id
),
prod as (
  select
    p.id, p.name, p.sku, p.dimension::text as dimension, p.active, p.created_at, p.category_id,
    c.name as category, c.parent_id as category_parent, fam.name as family,
    coalesce(pk.packs, 0) as packs, pk.main_pack, coalesce(pk.barcodes, '') as barcodes,
    pk.count_pack, pk.purchase_pack,
    coalesce(sup.ids, '{}') as supplier_ids, coalesce(sup.names, '{}') as supplier_names,
    coalesce(loc.ids, '{}') as location_ids,
    coalesce(st.qty, 0) as stock_qty,
    coalesce(st.low, false) as low_stock
  from products p
  left join categories c on c.id = p.category_id
  left join categories fam on fam.id = c.parent_id
  left join pk on pk.product_id = p.id
  left join sup on sup.product_id = p.id
  left join loc on loc.product_id = p.id
  left join st on st.product_id = p.id
),
m as (
  select prod.*,
    (cardinality(words.w) = 0 or not exists (
       select 1 from unnest(words.w) x
       where norm_text(prod.name || ' ' || coalesce(prod.sku, '') || ' ' || coalesce(prod.category, '') || ' ' || coalesce(prod.family, '') || ' ' || prod.barcodes) not like '%' || x || '%'
    )) as f_q,
    (case when p_no_category then prod.category_id is null
          else p_category is null or prod.category_id = p_category or prod.category_parent = p_category end) as f_cat,
    (p_supplier is null or p_supplier = any(prod.supplier_ids)) as f_sup,
    (p_location is null or p_location = any(prod.location_ids)) as f_loc,
    (p_dimension is null or prod.dimension = p_dimension) as f_dim,
    (coalesce(p_status, 'active') = 'all' or (coalesce(p_status, 'active') = 'archived') = not prod.active) as f_st,
    (p_stock is null
      or (p_stock = 'con' and prod.stock_qty > 0)
      or (p_stock = 'sin' and prod.stock_qty <= 0)
      or (p_stock = 'bajo' and prod.low_stock)) as f_stk
  from prod, words
),
hit as (
  select * from m where f_q and f_cat and f_sup and f_loc and f_dim and f_st and f_stk
),
page as (
  select * from hit
  order by
    case when p_sort = 'category' then coalesce(family, category, 'zzz') end,
    case when p_sort = 'category' then category end,
    case when p_sort = 'recent' then created_at end desc,
    case when p_sort = 'name_desc' then name end desc,
    name
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
),
-- Productos por categoría sin su propio filtro; una familia cuenta también los de sus tipos.
cat_counts as (
  select category_id, category_parent, count(*) as n from m
  where f_q and f_sup and f_loc and f_dim and f_st and f_stk group by category_id, category_parent
)
select jsonb_build_object(
  'total', (select count(*) from hit),
  'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'sku', sku, 'dimension', dimension, 'active', active,
      'category_id', category_id, 'category', category, 'family', family,
      'packs', packs, 'main_pack', main_pack, 'count_pack', count_pack, 'purchase_pack', purchase_pack,
      'suppliers', to_jsonb(supplier_names), 'locations', cardinality(location_ids),
      'stock_qty', stock_qty::text, 'low_stock', low_stock
    ) order by
      case when p_sort = 'category' then coalesce(family, category, 'zzz') end,
      case when p_sort = 'category' then category end,
      case when p_sort = 'recent' then created_at end desc,
      case when p_sort = 'name_desc' then name end desc,
      name) from page), '[]'::jsonb),
  -- Cada contador aplica todos los filtros menos el suyo: dice cuántos saldrían al elegir esa opción.
  'facets', jsonb_build_object(
    'status', (select jsonb_build_object(
        'all', count(*),
        'active', count(*) filter (where active),
        'archived', count(*) filter (where not active))
      from m where f_q and f_cat and f_sup and f_loc and f_dim and f_stk),
    'stock', (select jsonb_build_object(
        'con', count(*) filter (where stock_qty > 0),
        'sin', count(*) filter (where stock_qty <= 0),
        'bajo', count(*) filter (where low_stock))
      from m where f_q and f_cat and f_sup and f_loc and f_dim and f_st),
    'dimensions', coalesce((select jsonb_object_agg(dimension, n) from (
        select dimension, count(*) as n from m
        where f_q and f_cat and f_sup and f_loc and f_st and f_stk group by dimension) d), '{}'::jsonb),
    -- Familias primero (por su orden) y, debajo de cada una, sus tipos por nombre.
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'parent_id', c.parent_id,
          'count', coalesce((select sum(n) from cat_counts cc where cc.category_id = c.id or cc.category_parent = c.id), 0))
        order by coalesce(par.sort_order, c.sort_order), coalesce(par.name, c.name), c.parent_id nulls first, c.name)
      from categories c left join categories par on par.id = c.parent_id), '[]'::jsonb),
    'uncategorized', (select count(*) from m where category_id is null and f_q and f_sup and f_loc and f_dim and f_st and f_stk),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'count', coalesce(n.n, 0)) order by s.name)
      from suppliers s
      left join (select sid, count(*) as n from m, unnest(m.supplier_ids) sid
                 where f_q and f_cat and f_loc and f_dim and f_st and f_stk group by sid) n on n.sid = s.id
      where s.active), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'count', coalesce(n.n, 0)) order by l.name)
      from locations l
      left join (select lid, count(*) as n from m, unnest(m.location_ids) lid
                 where f_q and f_cat and f_sup and f_dim and f_st and f_stk group by lid) n on n.lid = l.id
      where l.active), '[]'::jsonb)
  )
)
$$;

