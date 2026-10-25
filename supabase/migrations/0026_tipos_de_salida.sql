-- Tipo de salida en las mermas (especificación A, hoja Mermas): separar las pérdidas (rotura, caducidad,
-- derrame…) de las acciones comerciales y del consumo interno. Antes todo era `waste` con un motivo libre y
-- las invitaciones contaban como pérdida en los informes.
--   merma             pérdida: rotura, caducidad, derrame, error de servicio, devolución…
--   invitacion        regalado a clientes
--   consumo_personal  consumido por el equipo
--   degustacion       catas y pruebas de producto
--   evento            salida para un evento o acción comercial
create type exit_kind as enum ('merma', 'invitacion', 'consumo_personal', 'degustacion', 'evento');

alter table stock_movements add column exit_kind exit_kind;

-- Las mermas ya registradas se clasifican por su motivo; lo que no se reconoce es pérdida. Es la única
-- corrección de filas existentes: la tabla sigue siendo inmutable para todo lo demás.
alter table stock_movements disable trigger stock_movements_immutable;
update stock_movements
set exit_kind = case
  when reason ~* 'invita' then 'invitacion'
  when reason ~* '(personal|plantilla|empleado|camarer|staff)' then 'consumo_personal'
  when reason ~* '(degusta|cata\M|prueba de producto)' then 'degustacion'
  when reason ~* 'evento' then 'evento'
  else 'merma'
end::exit_kind
where type = 'waste';
alter table stock_movements enable trigger stock_movements_immutable;

-- Una merma apuntada sin tipo (funciones antiguas, cargas) es una pérdida.
create function default_exit_kind() returns trigger
language plpgsql as $$
begin
  if new.type = 'waste' and new.exit_kind is null then
    new.exit_kind := 'merma';
  end if;
  return new;
end $$;

create trigger stock_movements_default_exit_kind
before insert on stock_movements
for each row execute function default_exit_kind();

-- Toda merma lleva su tipo y ningún otro movimiento lo lleva.
alter table stock_movements add constraint stock_movements_exit_kind_check
  check ((type = 'waste') = (exit_kind is not null));

create index stock_movements_waste_kind on stock_movements (location_id, exit_kind, occurred_at desc)
  where type = 'waste';

-- register_movement con el tipo de salida (por defecto, pérdida). Se sustituye la firma anterior para que
-- las llamadas con nombre no sean ambiguas.
drop function register_movement(uuid, uuid, movement_type, numeric, text, uuid, numeric, uuid);

create function register_movement(
  p_location uuid,
  p_product uuid,
  p_type movement_type,
  p_qty numeric,
  p_reason text default null,
  p_area uuid default null,
  p_unit_cost numeric default null,
  p_client_ref uuid default null,
  p_exit_kind exit_kind default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := location_org(p_location);
  v_qty numeric;
  v_id bigint;
begin
  if not can_access_location(p_location) then raise exception 'forbidden'; end if;
  if p_type not in ('waste', 'consumption', 'manual_adjustment', 'opening') then
    raise exception 'type_not_allowed';
  end if;
  if p_type in ('manual_adjustment', 'opening') and not is_manager(v_org) then
    raise exception 'forbidden';
  end if;
  if p_exit_kind is not null and p_type <> 'waste' then
    raise exception 'exit_kind_only_for_waste' using errcode = '22023';
  end if;

  if p_client_ref is not null then
    select id into v_id from stock_movements where client_ref = p_client_ref;
    if found then return v_id; end if;
  end if;

  v_qty := case
    when p_type in ('waste', 'consumption') then -abs(p_qty)
    when p_type = 'opening' then abs(p_qty)
    else p_qty
  end;

  insert into stock_movements
    (org_id, location_id, product_id, area_id, type, qty, unit_cost, reason, client_ref, exit_kind)
  values
    (v_org, p_location, p_product, p_area, p_type, v_qty, p_unit_cost, nullif(trim(coalesce(p_reason, '')), ''), p_client_ref,
     case when p_type = 'waste' then coalesce(p_exit_kind, 'merma') end)
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function register_movement(uuid, uuid, movement_type, numeric, text, uuid, numeric, uuid, exit_kind) from public, anon;
grant execute on function register_movement(uuid, uuid, movement_type, numeric, text, uuid, numeric, uuid, exit_kind) to authenticated;
