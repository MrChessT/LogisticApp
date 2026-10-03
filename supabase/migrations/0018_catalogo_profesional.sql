-- Catálogo profesional: índices completos, IVA como dato, formatos coherentes, costes comparables y
-- un chequeo de salud del catálogo. Idempotente: se puede ejecutar más de una vez.
--
-- 1) Índices: todas las claves ajenas que se usan para filtrar, unir o borrar tienen índice, más el
--    historial de un producto en un local y el historial de precios por proveedor y formato.
-- 2) IVA: products.vat_rate (antes solo era texto en las notas: «… · IVA 21 %»). Se rellena desde las
--    notas y, si no lo dicen, por familia (fruta 4 %, agua, zumos, hielo y snacks 10 %, el resto 21 %).
-- 3) Formatos coherentes:
--    · En un producto que se cuenta por unidades, cada formato tiene un número entero de unidades
--      («Caja 24» = 24 ud; no «Caja 24,5»).
--    · Desde la app no se puede cambiar la unidad de medida (ml, g, ud) de un producto que ya tiene
--      movimientos, ni la cantidad de un formato que ya aparece en albaranes, pedidos o precios: los
--      datos guardados pasarían a significar otra cosa. Se crea un formato nuevo y se desactiva el viejo.
--    · Precios nunca negativos; la entrada de un conteo es siempre un objeto.
-- 4) v_product_costs: precio por formato, por unidad que se cuenta (botella, ud) y por unidad base, con
--    y sin IVA, para comparar proveedores y formatos.
-- 5) catalog_health(): lo que hay que arreglar en el catálogo y el stock (sin precio, sin formato de
--    compra, precios o costes que no cuadran, stock negativo, nombres inválidos…).

-- 1 · Índices ------------------------------------------------------------------------------------------

create index if not exists categories_parent on categories(parent_id) where parent_id is not null;
create index if not exists products_category on products(category_id) where category_id is not null;
create index if not exists stock_balances_product on stock_balances(product_id);
create index if not exists stock_movements_area on stock_movements(area_id) where area_id is not null;
-- Historial de un producto en un local (ficha, consumo por producto, informes).
create index if not exists stock_movements_location_product_time on stock_movements(location_id, product_id, occurred_at desc);
create index if not exists count_lines_product on count_lines(product_id);
create index if not exists count_lines_area on count_lines(area_id) where area_id is not null;
create index if not exists count_results_product on count_results(product_id);
create index if not exists goods_receipts_supplier on goods_receipts(supplier_id) where supplier_id is not null;
create index if not exists receipt_lines_pack on receipt_lines(pack_id);
create index if not exists location_products_area on location_products(default_area_id) where default_area_id is not null;
create index if not exists membership_locations_location on membership_locations(location_id);
create index if not exists copilot_audit_user_time on copilot_audit(user_id, created_at desc);
create index if not exists copilot_drafts_expires on copilot_drafts(expires_at);
-- Último precio de un proveedor para un formato; sustituye al índice solo por proveedor.
create index if not exists price_history_supplier_pack_time on price_history(supplier_id, pack_id, recorded_at desc);
drop index if exists price_history_supplier;

-- 2 · IVA ----------------------------------------------------------------------------------------------

alter table products add column if not exists vat_rate numeric(4,2) not null default 21;

do $$ begin
  alter table products add constraint products_vat_rate_check check (vat_rate >= 0 and vat_rate <= 30);
exception when duplicate_object then null; end $$;

comment on column products.vat_rate is 'IVA de compra en %. Los precios de proveedor se guardan sin IVA.';

-- Solo se rellena lo que sigue con el valor por defecto: un IVA cambiado a mano no se pisa.
update products p
set vat_rate = coalesce(
  replace(substring(p.notes from 'IVA ([0-9]+(?:[.,][0-9]+)?) ?%'), ',', '.')::numeric,
  case coalesce(fam.name, c.name)
    when 'Fruta y guarnición' then 4
    when 'Aguas' then 10
    when 'Zumos y siropes' then 10
    when 'Hielo' then 10
    when 'Snacks y picoteo' then 10
    else 21
  end)
from products p2
left join categories c on c.id = p2.category_id
left join categories fam on fam.id = c.parent_id
where p2.id = p.id and p.vat_rate = 21;

-- 3 · Formatos coherentes -----------------------------------------------------------------------------

create or replace function validate_product_pack() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dimension unit_dimension;
begin
  new.name := btrim(new.name);
  if new.name = '' then raise exception 'pack_name_required' using hint = 'El formato necesita un nombre.'; end if;

  select dimension into v_dimension from products where id = new.product_id;
  if v_dimension = 'count' and new.qty_base <> trunc(new.qty_base) then
    raise exception 'pack_units_not_integer'
      using hint = 'En un producto que se cuenta por unidades, un formato tiene un número entero de unidades.';
  end if;

  -- Desde la app (JWT con rol authenticated; el SQL Editor y las migraciones no) no se reinterpreta lo ya registrado con este formato.
  if tg_op = 'UPDATE' and new.qty_base <> old.qty_base and auth.role() = 'authenticated' and (
       exists (select 1 from receipt_lines where pack_id = old.id)
       or exists (select 1 from purchase_order_lines where pack_id = old.id)
       or exists (select 1 from price_history where pack_id = old.id)
     ) then
    raise exception 'pack_in_use'
      using hint = 'Este formato ya aparece en albaranes, pedidos o precios: crea uno nuevo y desactiva este.';
  end if;
  return new;
end $$;

drop trigger if exists product_packs_validate on product_packs;
create trigger product_packs_validate
before insert or update on product_packs
for each row execute function validate_product_pack();

create or replace function guard_product_dimension() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dimension is distinct from old.dimension and auth.role() = 'authenticated'
     and exists (select 1 from stock_movements where product_id = old.id) then
    raise exception 'dimension_locked'
      using hint = 'El producto ya tiene movimientos: su unidad de medida no puede cambiar.';
  end if;
  return new;
end $$;

drop trigger if exists products_guard_dimension on products;
create trigger products_guard_dimension
before update of dimension on products
for each row execute function guard_product_dimension();

do $$ begin
  alter table supplier_prices add constraint supplier_prices_last_price_check check (last_price is null or last_price >= 0) not valid;
exception when duplicate_object then null; end $$;
alter table supplier_prices validate constraint supplier_prices_last_price_check;

do $$ begin
  alter table count_lines add constraint count_lines_input_check check (input is null or jsonb_typeof(input) = 'object') not valid;
exception when duplicate_object then null; end $$;
alter table count_lines validate constraint count_lines_input_check;

comment on column count_lines.input is
  'Lo que se tecleó al contar: {"boxes": n, "box": "Caja 24", "loose": n, "unit": "ud"} o {"amount": n, "unit": "Botella 70 cl"}.';

-- 4 · Costes comparables -------------------------------------------------------------------------------

-- Unidad en que se cuenta cada producto: la unidad suelta (1 ud) si va por unidades; si no, su formato
-- de conteo (botella, barril, kg) y, sin él, la unidad base.
create or replace view v_count_units with (security_invoker = true) as
select
  p.id as product_id,
  case when p.dimension = 'count' then 'ud' else coalesce(cp.name, p.base_unit) end as unit_name,
  case when p.dimension = 'count' then 1 else coalesce(cp.qty_base, 1) end as unit_qty
from products p
left join lateral (
  select k.name, k.qty_base from product_packs k
  where k.product_id = p.id and k.active and k.is_count_default
  limit 1
) cp on true;

create or replace view v_product_costs with (security_invoker = true) as
select
  p.org_id,
  p.id as product_id,
  p.name as product_name,
  p.dimension::text as dimension,
  p.base_unit,
  p.vat_rate,
  s.id as supplier_id,
  s.name as supplier_name,
  k.id as pack_id,
  k.name as pack_name,
  k.qty_base as pack_qty_base,
  k.is_purchase_default,
  cu.unit_name,
  round(k.qty_base / cu.unit_qty, 4) as units_per_pack,
  sp.last_price as pack_price,
  sp.last_price_at,
  round(sp.last_price / (k.qty_base / cu.unit_qty), 4) as unit_price,
  round(sp.last_price / k.qty_base, 6) as base_price,
  round(sp.last_price * (1 + p.vat_rate / 100), 2) as pack_price_with_vat,
  round(sp.last_price / (k.qty_base / cu.unit_qty) * (1 + p.vat_rate / 100), 4) as unit_price_with_vat
from supplier_prices sp
join product_packs k on k.id = sp.pack_id
join products p on p.id = k.product_id
join suppliers s on s.id = sp.supplier_id
join v_count_units cu on cu.product_id = p.id
where sp.last_price is not null;

grant select on v_count_units, v_product_costs to authenticated;

-- 5 · Salud del catálogo -------------------------------------------------------------------------------

-- severity: 'error' (datos que dan cifras falsas), 'aviso' (falta algo para trabajar bien), 'info'.
create or replace function catalog_health(p_location uuid default null)
returns table (
  product_id uuid,
  product_name text,
  family text,
  location_id uuid,
  location_name text,
  issue text,
  severity text,
  detail text
)
language sql stable security invoker set search_path = public as $$
with prod as (
  select p.id, p.org_id, p.name, p.dimension, p.base_unit, p.track_stock,
         coalesce(fam.name, c.name) as family, p.category_id
  from products p
  left join categories c on c.id = p.category_id
  left join categories fam on fam.id = c.parent_id
  where p.active
),
costs as (
  select product_id, min(unit_price) as min_unit, max(unit_price) as max_unit, count(*) as n,
         (array_agg(unit_price order by last_price_at desc nulls last))[1] as last_unit,
         (array_agg(unit_name))[1] as unit_name
  from v_product_costs group by product_id
),
issues as (
  -- Nombres que no son un producto («y», «x»).
  select pr.id, null::uuid as loc, 'nombre_invalido' as issue, 'error' as severity,
         'El nombre es demasiado corto para ser un producto.' as detail
  from prod pr where char_length(regexp_replace(pr.name, '[^[:alnum:]]', '', 'g')) < 3
  union all
  select pr.id, null, 'sin_formatos', 'error', 'No tiene ningún formato activo (botella, caja…): no se puede contar ni pedir.'
  from prod pr where not exists (select 1 from product_packs k where k.product_id = pr.id and k.active)
  union all
  select pr.id, null, 'sin_formato_conteo', 'aviso', 'Se mide en ' || pr.base_unit || ' pero no tiene formato de conteo (botella, barril, kg).'
  from prod pr
  where pr.dimension <> 'count'
    and exists (select 1 from product_packs k where k.product_id = pr.id and k.active)
    and not exists (select 1 from product_packs k where k.product_id = pr.id and k.active and k.is_count_default)
  union all
  select pr.id, null, 'sin_formato_compra', 'aviso', 'No tiene formato de compra por defecto (caja, bandeja…).'
  from prod pr
  where exists (select 1 from product_packs k where k.product_id = pr.id and k.active)
    and not exists (select 1 from product_packs k where k.product_id = pr.id and k.active and k.is_purchase_default)
  union all
  -- Sin precio de proveedor ni coste conocido (un inventario importado con coste ya lo valora).
  select pr.id, null, 'sin_precio', 'aviso', 'No tiene precio de compra ni coste: su stock y su consumo se valoran a 0 €.'
  from prod pr where pr.track_stock and not exists (select 1 from costs c where c.product_id = pr.id)
    and not exists (select 1 from stock_balances b where b.product_id = pr.id and b.avg_cost > 0)
  union all
  select pr.id, null, 'sin_categoria', 'info', 'No tiene categoría.'
  from prod pr where pr.category_id is null
  union all
  select pr.id, null, 'precio_dispar', 'aviso',
         format('Los proveedores cobran entre %s € y %s € por %s.', round(c.min_unit, 2), round(c.max_unit, 2), c.unit_name)
  from prod pr join costs c on c.product_id = pr.id
  where c.n > 1 and c.min_unit > 0 and c.max_unit / c.min_unit > 2
  union all
  -- Coste medio del stock muy lejos del precio de compra: casi siempre un albarán con el precio
  -- de una caja puesto como precio por unidad (o al revés).
  select pr.id, b.location_id, 'coste_dispar', 'error',
         format('El stock está valorado a %s € por %s y el último precio es %s €.',
                round(b.avg_cost * cu.unit_qty, 2), cu.unit_name, round(c.last_unit, 2))
  from prod pr
  join costs c on c.product_id = pr.id
  join v_count_units cu on cu.product_id = pr.id
  join stock_balances b on b.product_id = pr.id
  where b.qty > 0 and b.avg_cost > 0 and c.last_unit > 0
    and (b.avg_cost * cu.unit_qty / c.last_unit > 3 or b.avg_cost * cu.unit_qty / c.last_unit < 1.0 / 3)
  union all
  select pr.id, b.location_id, 'stock_negativo', 'error',
         'El stock es negativo: falta registrar una entrada (recepción, traspaso) o corregir con un inventario.'
  from prod pr join stock_balances b on b.product_id = pr.id
  where b.qty < 0
  union all
  select pr.id, lp.location_id, 'sin_minimo', 'info', 'Sin mínimo ni objetivo en este local: no aparecerá en la reposición.'
  from prod pr join location_products lp on lp.product_id = pr.id
  where lp.active and lp.min_qty = 0 and lp.par_qty = 0 and pr.track_stock
)
select i.id, pr.name, pr.family, i.loc, l.name, i.issue, i.severity, i.detail
from issues i
join prod pr on pr.id = i.id
left join locations l on l.id = i.loc
where p_location is null or i.loc is null or i.loc = p_location
order by case i.severity when 'error' then 0 when 'aviso' then 1 else 2 end, pr.family nulls last, pr.name, l.name
$$;

revoke execute on function catalog_health(uuid) from public, anon;
grant execute on function catalog_health(uuid) to authenticated;
revoke execute on function validate_product_pack(), guard_product_dimension() from public, anon, authenticated;

analyze products, product_packs, supplier_prices, price_history, stock_movements, count_lines;
