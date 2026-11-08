-- Zonas coherentes con el stock del local: la suma de lo que hay en las zonas = el stock del local.
--
-- Hasta ahora un movimiento sin zona (recepciones, consumo, traspasos, ajustes de inventario) cambiaba
-- el stock del local pero no el de ninguna zona, así que «qué hay en la Cámara» no cuadraba con el total.
-- Regla nueva, en el mismo disparador que ya lleva los saldos (antes de guardar el movimiento):
--   · Entra género sin zona → a la zona habitual del producto en el local (location_products) o, si no
--     tiene, al primer almacén del local.
--   · Sale género sin zona → de la zona donde más hay de ese producto (primero las de servicio, que es
--     donde se consume); si no hay en ninguna, de la habitual o del primer almacén.
--   · Un local sin zonas activas sigue funcionando sin zona.
-- Los movimientos con zona (salidas del almacén a barra, aperturas por zona) no cambian.
-- Al final se cuadra una vez lo que ya había: la diferencia de cada producto va a su zona habitual.

create or replace function stock_movement_area(p_location uuid, p_product uuid, p_qty numeric) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    -- Salidas: la zona con más existencias del producto (servicio antes que almacén).
    case when p_qty < 0 then (
      select b.area_id from stock_area_balances b join storage_areas a on a.id = b.area_id
      where a.location_id = p_location and a.active and b.product_id = p_product and b.qty > 0
      order by (a.kind = 'servicio') desc, b.qty desc, a.sort_order
      limit 1)
    end,
    -- Su zona habitual en el local.
    (select lp.default_area_id from location_products lp join storage_areas a on a.id = lp.default_area_id
     where lp.location_id = p_location and lp.product_id = p_product and a.active),
    -- El primer almacén del local (o la primera zona, si no hay almacén).
    (select a.id from storage_areas a where a.location_id = p_location and a.active
     order by (a.kind = 'almacen') desc, a.sort_order, a.name limit 1)
  )
$$;
revoke all on function stock_movement_area(uuid, uuid, numeric) from public, anon, authenticated;

create or replace function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  local_balance stock_balances;
  area_balance stock_area_balances;
  area_location uuid;
begin
  if new.area_id is null then
    new.area_id := stock_movement_area(new.location_id, new.product_id, new.qty);
  end if;

  if new.area_id is not null then
    select location_id into area_location
    from storage_areas
    where id = new.area_id;

    if area_location is null or area_location <> new.location_id then
      raise exception 'cross_location_link';
    end if;
  end if;

  insert into stock_balances (location_id, product_id)
  values (new.location_id, new.product_id)
  on conflict do nothing;

  select * into local_balance
  from stock_balances
  where location_id = new.location_id and product_id = new.product_id
  for update;

  if new.qty > 0 and new.unit_cost is not null then
    if local_balance.qty > 0 then
      local_balance.avg_cost := (local_balance.qty * local_balance.avg_cost + new.qty * new.unit_cost)
        / (local_balance.qty + new.qty);
    else
      local_balance.avg_cost := new.unit_cost;
    end if;
  elsif new.unit_cost is null then
    new.unit_cost := local_balance.avg_cost;
  end if;

  update stock_balances
  set qty = local_balance.qty + new.qty,
      avg_cost = local_balance.avg_cost,
      updated_at = now()
  where location_id = new.location_id and product_id = new.product_id;

  if new.area_id is not null then
    insert into stock_area_balances (area_id, product_id)
    values (new.area_id, new.product_id)
    on conflict do nothing;

    select * into area_balance
    from stock_area_balances
    where area_id = new.area_id and product_id = new.product_id
    for update;

    if new.qty > 0 and new.unit_cost is not null then
      if area_balance.qty > 0 then
        area_balance.avg_cost := (area_balance.qty * area_balance.avg_cost + new.qty * new.unit_cost)
          / (area_balance.qty + new.qty);
      else
        area_balance.avg_cost := new.unit_cost;
      end if;
    elsif area_balance.avg_cost = 0 then
      area_balance.avg_cost := local_balance.avg_cost;
    end if;

    update stock_area_balances
    set qty = area_balance.qty + new.qty,
        avg_cost = area_balance.avg_cost,
        updated_at = now()
    where area_id = new.area_id and product_id = new.product_id;
  end if;

  return new;
end $$;

-- Cuadre único de lo que ya había: lo que el local tiene y ninguna zona recoge va a la zona habitual
-- (o al primer almacén). Los saldos por zona son un resumen de los movimientos, no el registro: el
-- registro (stock_movements) no se toca.
with diff as (
  select b.location_id, b.product_id, b.qty - coalesce(z.qty, 0) as delta, b.avg_cost
  from stock_balances b
  left join (
    select a.location_id, s.product_id, sum(s.qty) as qty
    from stock_area_balances s join storage_areas a on a.id = s.area_id
    group by 1, 2
  ) z on z.location_id = b.location_id and z.product_id = b.product_id
  where abs(b.qty - coalesce(z.qty, 0)) > 0.0001
), target as (
  select d.*, stock_movement_area(d.location_id, d.product_id, 1) as area_id from diff d
)
insert into stock_area_balances (area_id, product_id, qty, avg_cost, updated_at)
select area_id, product_id, delta, avg_cost, now() from target where area_id is not null
on conflict (area_id, product_id) do update
  set qty = stock_area_balances.qty + excluded.qty,
      avg_cost = case when stock_area_balances.avg_cost = 0 then excluded.avg_cost else stock_area_balances.avg_cost end,
      updated_at = now();
