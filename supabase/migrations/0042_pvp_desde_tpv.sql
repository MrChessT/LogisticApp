-- PVP de los platos según lo que cobra el TPV.
--
-- tpv_sale_prices  Por cada plato enlazado a un artículo del TPV: lo cobrado por ración (importe sin IVA
--                  entre raciones vendidas), pasado a PVP con su IVA y redondeado a 5 céntimos, junto al
--                  PVP que tiene ahora el escandallo. Si varios artículos van al mismo plato (ración y
--                  media ración), cuenta el más vendido. Las invitaciones (importe 0) no cuentan.
--
-- Solo lee: aplicar el PVP es actualizar la receta (lo hace quien puede editar escandallos). Con las
-- reglas de acceso de quien llama (security invoker): sin «ve costes» no hay ventas que leer.

create or replace function tpv_sale_prices(p_org uuid)
returns table (
  recipe_id uuid, recipe_name text, category text, current_price numeric, vat_rate numeric,
  suggested_price numeric, net_per_portion numeric, portions_sold numeric, days integer, item_name text
)
language sql stable security invoker set search_path = public as $$
  with per_item as (
    select i.recipe_id, i.name as item_name, i.qty_per_sale,
           sum(l.qty) as qty, sum(l.amount) as amount, count(distinct l.day_id)::int as days
    from sales_items i
    join sales_lines l on l.item_id = i.id
    where i.org_id = p_org and i.recipe_id is not null and l.qty > 0 and l.amount > 0
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
  order by r.sale_price is not null, r.name;
$$;
revoke all on function tpv_sale_prices(uuid) from public, anon;
grant execute on function tpv_sale_prices(uuid) to authenticated;
