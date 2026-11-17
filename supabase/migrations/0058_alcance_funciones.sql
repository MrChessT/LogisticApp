-- Roles, fase 5: el alcance por cuenta de análisis llega a las recetas y a las funciones que leen saltándose las
-- políticas (security definer). Así el asistente y las pantallas que las usan ven lo mismo que en las tablas (0056).
--
-- Recetas: una receta es de las cuentas de sus ingredientes, también los de sus elaboraciones. Se ve si alguno de sus
-- ingredientes es de una cuenta permitida, o si aún no tiene ingredientes. Así el cocinero (Comida) ve sus platos y el
-- de barra (Bebida) sus cócteles.
--
-- Funciones que pasan a filtrar: recipe_costs, sales_report, tpv_sale_prices (por receta), area_moves_list y
-- warehouse_catalog (por producto). En ventas, una línea del TPV sin enlazar no se sabe de qué cuenta es: con cuentas
-- asignadas no se muestra.
-- No se tocan export_catalog (solo la administración, que nunca tiene cuentas limitadas) ni warehouse_context, que
-- solo da el número de salidas pendientes del local, sin productos.
-- Como en la 0056, la condición va dentro de (select …) para que se evalúe una vez por consulta.

create or replace function allowed_recipe_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive tree(root, rid) as (
    select r.id, r.id from recipes r where r.org_id in (select my_org_ids())
    union
    select t.root, l.sub_recipe_id from recipe_lines l join tree t on l.recipe_id = t.rid where l.sub_recipe_id is not null
  )
  select distinct t.root from tree t join recipe_lines l on l.recipe_id = t.rid
  where l.product_id in (select allowed_product_ids())
  union
  select r.id from recipes r
  where r.org_id in (select my_org_ids()) and not exists (select 1 from recipe_lines l where l.recipe_id = r.id)
$$;
revoke all on function allowed_recipe_ids() from public, anon;
grant execute on function allowed_recipe_ids() to authenticated;

create policy recipes_scope_select on recipes as restrictive for select to authenticated
  using ((select account_scope_off()) or id in (select allowed_recipe_ids()));
create policy recipes_scope_update on recipes as restrictive for update to authenticated
  using ((select account_scope_off()) or id in (select allowed_recipe_ids()));
create policy recipes_scope_delete on recipes as restrictive for delete to authenticated
  using ((select account_scope_off()) or id in (select allowed_recipe_ids()));

create or replace function recipe_costs(p_org uuid)
returns table (
  recipe_id uuid, total_cost numeric, unit_cost numeric, portion_cost numeric, net_price numeric,
  food_cost_pct numeric, margin numeric, recommended_price numeric, missing_prices int,
  cost_change_pct numeric, allergens text[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  r recipes;
  c record;
  v_costs boolean := sees_costs(p_org);
  v_portion numeric;
  v_net numeric;
begin
  if p_org not in (select my_org_ids()) then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select * from recipes x where x.org_id = p_org and ((select account_scope_off()) or x.id in (select allowed_recipe_ids())) loop
    select * into c from recipe_total_cost(r.id);
    v_portion := case when r.yield_unit = 'racion' then c.total / r.yield_qty end;
    v_net := case when r.sale_price is not null then round(r.sale_price / (1 + r.vat_rate / 100), 4) end;
    recipe_id := r.id;
    allergens := recipe_allergens(r.id);
    missing_prices := c.missing;
    if v_costs then
      total_cost := round(c.total, 4);
      unit_cost := round(c.total / r.yield_qty, 6);
      portion_cost := round(v_portion, 4);
      net_price := v_net;
      food_cost_pct := case when v_portion is not null and v_net > 0 then round(v_portion / v_net * 100, 1) end;
      margin := case when v_portion is not null and v_net is not null then round(v_net - v_portion, 2) end;
      recommended_price := case when v_portion is not null then round(v_portion / (r.target_food_cost / 100) * (1 + r.vat_rate / 100), 2) end;
      cost_change_pct := case when r.reviewed_cost > 0 then round((c.total - r.reviewed_cost) / r.reviewed_cost * 100, 1) end;
    else
      total_cost := null; unit_cost := null; portion_cost := null; net_price := v_net; food_cost_pct := null;
      margin := null; recommended_price := null; cost_change_pct := null;
    end if;
    return next;
  end loop;
end $$;

create or replace function sales_report(p_org uuid, p_from date, p_to date, p_location uuid DEFAULT NULL::uuid)
 RETURNS TABLE(item_id uuid, code text, name text, link text, link_name text, qty_per_sale numeric, ignored boolean, qty numeric, amount numeric, unit_cost numeric, cost numeric, food_cost_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not can_manage_sales(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with s as (
    select l.item_id, sum(l.qty) qty, sum(l.amount) amount
    from sales_lines l join sales_days d on d.id = l.day_id
    where d.org_id = p_org and d.sale_date between p_from and p_to and (p_location is null or d.location_id = p_location)
    group by l.item_id
  )
  select i.id, i.code, i.name,
         case when i.recipe_id is not null then 'receta' when i.product_id is not null then 'producto' when i.ignored then 'ignorado' else 'sin_enlazar' end,
         coalesce(r.name, p.name), i.qty_per_sale, i.ignored,
         s.qty, round(s.amount, 2), c.cost, round(s.qty * c.cost, 2),
         case when c.cost is not null and s.amount > 0 then round(s.qty * c.cost / s.amount * 100, 1) end
  from s join sales_items i on i.id = s.item_id
  left join recipes r on r.id = i.recipe_id
  left join products p on p.id = i.product_id
  cross join lateral (select sales_item_unit_cost(i.id) cost) c
  -- Con cuentas asignadas, solo lo enlazado a sus recetas o productos; lo sin enlazar no se sabe de qué cuenta es.
  where (select account_scope_off()) or i.recipe_id in (select allowed_recipe_ids()) or i.product_id in (select allowed_product_ids())
  order by s.amount desc;
end $function$;

create or replace function tpv_sale_prices(p_org uuid)
 RETURNS TABLE(recipe_id uuid, recipe_name text, category text, current_price numeric, vat_rate numeric, suggested_price numeric, net_per_portion numeric, portions_sold numeric, days integer, item_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with per_item as (
    select i.recipe_id, i.name as item_name, i.qty_per_sale,
           sum(l.qty) as qty, sum(l.amount) as amount, count(distinct l.day_id)::int as days
    from sales_items i
    join sales_lines l on l.item_id = i.id
    where i.org_id = p_org and i.recipe_id is not null and l.qty > 0 and l.amount > 0
      and can_manage_sales(p_org)
    group by i.id, i.recipe_id, i.name, i.qty_per_sale
  ),
  best as (
    select distinct on (recipe_id) *
    from per_item
    order by recipe_id, qty desc, item_name
  )
  select r.id, r.name, r.category, r.sale_price, r.vat_rate,
         round(b.amount / b.qty / b.qty_per_sale * (1 + r.vat_rate / 100) / 0.05) * 0.05,
         round(b.amount / b.qty / b.qty_per_sale, 4),
         b.qty * b.qty_per_sale, b.days, b.item_name
  from best b
  join recipes r on r.id = b.recipe_id
  where r.org_id = p_org and r.kind = 'plato' and r.active
    and ((select account_scope_off()) or r.id in (select allowed_recipe_ids()))
  order by r.sale_price is not null, r.name;
$function$;

create or replace function area_moves_list(p_location uuid, p_status text DEFAULT 'pending'::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not warehouse_access(p_location) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select m.id, m.kind, m.status, m.qty::text as qty, m.input, m.note, m.created_at, m.decided_at, m.decision_note, m.original,
             m.product_id, p.name as product_name, p.dimension::text as dimension, p.base_unit,
             m.from_area_id, fa.name as from_area, m.to_area_id, ta.name as to_area,
             coalesce(cp.full_name, case when cm.role = 'kiosk' then 'Pantalla' end, 'Alguien') as created_by_name,
             m.created_by = auth.uid() as mine,
             dp.full_name as decided_by_name,
             (select jsonb_agg(jsonb_build_object('name', k.name, 'qty', k.qty_base::text, 'count', k.is_count_default, 'purchase', k.is_purchase_default))
              from product_packs k where k.product_id = m.product_id and k.active) as packs
      from area_moves m
      join products p on p.id = m.product_id
      join storage_areas fa on fa.id = m.from_area_id
      join storage_areas ta on ta.id = m.to_area_id
      left join profiles cp on cp.user_id = m.created_by
      left join memberships cm on cm.user_id = m.created_by and cm.org_id = m.org_id
      left join profiles dp on dp.user_id = m.decided_by
      where m.location_id = p_location
        and ((select account_scope_off()) or m.product_id in (select allowed_product_ids()))
        and ((p_status = 'pending' and m.status = 'pending')
             or (p_status = 'decided' and m.status in ('validated', 'rejected') and m.decided_at > now() - interval '24 hours'))
      order by m.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 300)
    ) x
  ), '[]'::jsonb);
end $function$;

create or replace function warehouse_catalog(p_location uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org uuid;
  w text[] := array_remove(string_to_array(norm_text(trim(coalesce(p_search, ''))), ' '), '');
  raw text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not warehouse_access(p_location) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select l.org_id into org from locations l where l.id = p_location;
  return coalesce((
    with usage as (
      select m.product_id, count(*) as n from area_moves m
      where m.location_id = p_location and m.created_at > now() - interval '30 days' and m.status <> 'cancelled'
      group by m.product_id
    ),
    cand as (
      select p.id, p.name, p.dimension::text as dimension, p.base_unit, coalesce(fam.name, c.name) as family,
             coalesce(u.n, 0) as uses,
             (cardinality(w) > 0 and norm_text(p.name) like w[1] || '%') as prefix,
             exists (select 1 from product_packs k where k.product_id = p.id and k.barcode = raw) as barcode_hit
      from products p
      left join categories c on c.id = p.category_id
      left join categories fam on fam.id = c.parent_id
      left join usage u on u.product_id = p.id
      where p.org_id = org and p.active
        and ((select account_scope_off()) or p.id in (select allowed_product_ids()))
        and (
          (cardinality(w) = 0 and (u.n is not null or exists (select 1 from location_products lp where lp.product_id = p.id and lp.location_id = p_location and lp.active)))
          or (cardinality(w) > 0 and not exists (
                select 1 from unnest(w) x
                where norm_text(p.name || ' ' || coalesce(p.sku, '') || ' ' || coalesce(c.name, '') || ' ' || coalesce(fam.name, '')) not like '%' || x || '%'))
          or exists (select 1 from product_packs k where k.product_id = p.id and k.barcode = raw)
        )
      order by barcode_hit desc, uses desc, prefix desc, p.name
      limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ),
    numbered as (select cand.*, row_number() over () as ord from cand)
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'name', n.name, 'dimension', n.dimension, 'base_unit', n.base_unit, 'family', n.family,
      'uses', n.uses, 'barcode_hit', n.barcode_hit,
      'stock', (select coalesce(sum(b.qty), 0)::text from stock_area_balances b join storage_areas a on a.id = b.area_id
                where b.product_id = n.id and a.location_id = p_location and a.kind = 'almacen'),
      'packs', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'qty', k.qty_base::text,
                                                             'count', k.is_count_default, 'purchase', k.is_purchase_default, 'barcode', k.barcode)
                                          order by k.qty_base)
                         from product_packs k where k.product_id = n.id and k.active), '[]')
    ) order by n.ord)
    from numbered n
  ), '[]'::jsonb);
end $function$;
