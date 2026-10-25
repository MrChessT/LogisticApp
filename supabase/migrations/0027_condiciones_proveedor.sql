-- Condiciones de pedido de cada proveedor (especificación A, hoja Proveedores): qué días admite pedidos,
-- hasta qué hora, cuánto tarda en servir, el pedido mínimo, las condiciones de pago y a qué locales sirve.
-- Con esto, «Preparar pedidos» y /pedidos calculan la entrega prevista y avisan si no se llega al mínimo.
alter table suppliers
  add column code text check (code is null or char_length(code) between 1 and 20),
  add column contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  -- Días de la semana en que admite pedidos (ISO: 1 lunes … 7 domingo). Vacío o null: cualquier día.
  add column order_days smallint[] check (order_days is null or order_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- Hora límite para que el pedido cuente ese día (hora del local). Null: sin hora límite.
  add column order_cutoff time,
  -- Horas entre el pedido y la entrega (48 = dos días).
  add column lead_time_hours smallint check (lead_time_hours is null or lead_time_hours between 0 and 720),
  add column min_order numeric(12, 2) check (min_order is null or min_order >= 0),
  add column payment_terms text check (payment_terms is null or char_length(payment_terms) <= 200),
  -- Locales a los que sirve. Vacío o null: a todos.
  add column location_ids uuid[];

create unique index suppliers_org_code on suppliers (org_id, lower(code)) where code is not null;

-- Los locales tienen que ser de la misma organización (un array no admite clave ajena).
create function check_supplier_locations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.location_ids is not null and exists (
    select 1 from unnest(new.location_ids) as l(id)
    where not exists (select 1 from locations x where x.id = l.id and x.org_id = new.org_id)
  ) then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  if new.location_ids is not null and cardinality(new.location_ids) = 0 then
    new.location_ids := null;
  end if;
  if new.order_days is not null and cardinality(new.order_days) = 0 then
    new.order_days := null;
  end if;
  return new;
end $$;

create trigger suppliers_check_locations
before insert or update of location_ids, order_days on suppliers
for each row execute function check_supplier_locations();
