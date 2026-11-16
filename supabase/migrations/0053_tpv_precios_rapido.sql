-- Escandallos tardaba ~10 s por tpv_sale_prices: con security invoker, la política RLS de sales_lines
-- (un EXISTS que llama a can_manage_sales por cada fila) se evaluaba para las ~40 000 líneas de ventas,
-- y la consulta en sí tardaba 0,6 s. Aquí la función pasa a security definer y comprueba el permiso una
-- sola vez, al principio, con can_manage_sales(p_org). El resultado no cambia para nadie:
--   · quien puede gestionar ventas (y ve costes) recibe los mismos platos y cifras;
--   · el resto recibe una lista vacía, como antes.
-- Sigue siendo de solo lectura y no toca recetas, precios ni ventas.

create or replace function tpv_sale_prices(p_org uuid)
returns table (
  recipe_id uuid, recipe_name text, category text, current_price numeric, vat_rate numeric,
  suggested_price numeric, net_per_portion numeric, portions_sold numeric, days integer, item_name text
)
language sql stable security definer set search_path = public as $$
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
  order by r.sale_price is not null, r.name;
$$;
revoke all on function tpv_sale_prices(uuid) from public, anon;
grant execute on function tpv_sale_prices(uuid) to authenticated;
