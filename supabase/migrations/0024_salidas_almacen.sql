-- Pantalla de almacén: salidas a barra/cocina apuntadas al momento y validadas después.
--
--  1. Quien saca algo lo apunta (pantalla del almacén o móvil) → queda PENDIENTE en area_moves.
--     El stock no se mueve todavía.
--  2. Una persona autorizada lo valida: encargados del local, administración y el personal marcado con
--     «puede validar». En la pantalla, con su PIN de 6 cifras (5 fallos → bloqueado 15 min); en su
--     móvil, con su propia sesión.
--  3. Al validar se registra un movimiento interno (internal_move) almacén → servicio (o al revés en una
--     devolución). No es consumo: los informes de consumo no lo cuentan; el consumo vendrá de las ventas.
--     Se puede validar tal cual, corregir (cantidad, producto o destino: queda lo original) o rechazar.
--
-- Pantallas (rol kiosk): una cuenta por pantalla, ligada a UN local. No ve nada por las tablas (quedan
-- fuera de my_org_ids / my_location_ids / can_access_location): todo lo hace con las funciones
-- warehouse_* y area_move_*, que solo le dejan apuntar salidas de su local y validarlas con el PIN de
-- una persona autorizada.

-- 1. Pantallas aisladas ----------------------------------------------------------------------------

create or replace function my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid() and role <> 'kiosk'
$$;

create or replace function my_location_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select l.id
  from locations l
  join memberships m on m.org_id = l.org_id and m.user_id = auth.uid()
  where m.role <> 'kiosk'
    and (m.role in ('owner', 'admin')
         or m.all_locations
         or exists (select 1 from membership_locations ml where ml.user_id = m.user_id and ml.location_id = l.id))
$$;

create or replace function can_access_location(p_location uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from my_location_ids() x where x = p_location)
$$;

-- Cada uno lee su propia membresía (la pantalla necesita saber que es pantalla).
drop policy if exists mem_select on memberships;
create policy mem_select on memberships for select
  using (org_id in (select my_org_ids()) or user_id = (select auth.uid()));

-- 2. Quién valida -------------------------------------------------------------------------------------

alter table memberships add column if not exists can_validate boolean not null default false;

-- ¿Puede p_user validar salidas de p_location? Propietario y administrador, sí; encargado, en sus
-- locales; personal, en sus locales si tiene «puede validar». Una pantalla, nunca.
create or replace function can_validate_location(p_user uuid, p_location uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join locations l on l.org_id = m.org_id and l.id = p_location
    where m.user_id = p_user
      and (m.role in ('owner', 'admin')
           or ((m.role = 'manager' or (m.role = 'staff' and m.can_validate))
               and (m.all_locations or exists (select 1 from membership_locations ml where ml.user_id = m.user_id and ml.location_id = l.id))))
  )
$$;

-- PIN de validación: solo su hash (bcrypt). Nadie lo lee: se comprueba dentro de area_moves_decide().
create table if not exists validator_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table validator_pins enable row level security;

create or replace function set_validation_pin(p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or exists (select 1 from memberships where user_id = auth.uid() and role = 'kiosk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'pin_format' using errcode = '22023';
  end if;
  if p_pin ~ '^(.)\1{5}$' or p_pin in ('123456', '654321', '012345', '543210') then
    raise exception 'pin_weak' using errcode = '22023';
  end if;
  insert into validator_pins (user_id, pin_hash) values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();
end $$;

-- 3. La cola ---------------------------------------------------------------------------------------

create table if not exists area_moves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null,
  from_area_id uuid not null references storage_areas(id),
  to_area_id uuid not null references storage_areas(id),
  product_id uuid not null,
  qty numeric(16,4) not null check (qty > 0),
  input jsonb,
  kind text not null default 'salida' check (kind in ('salida', 'devolucion')),
  status text not null default 'pending' check (status in ('pending', 'validated', 'rejected', 'cancelled')),
  note text check (char_length(note) <= 200),
  client_ref uuid unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 200),
  original jsonb,
  foreign key (org_id, location_id) references locations(org_id, id),
  foreign key (org_id, product_id) references products(org_id, id),
  check (from_area_id <> to_area_id)
);

create index if not exists area_moves_pending on area_moves (location_id, created_at desc) where status = 'pending';
create index if not exists area_moves_location_time on area_moves (location_id, created_at desc);
create index if not exists area_moves_product on area_moves (product_id);

alter table area_moves enable row level security;
-- Lectura para quien trabaja en el local (historial, avisos). Escritura solo por las funciones.
drop policy if exists area_moves_select on area_moves;
create policy area_moves_select on area_moves for select using (location_id in (select my_location_ids()));

-- Movimiento interno: entre zonas del mismo local, con cualquier signo.
alter table stock_movements drop constraint if exists stock_movements_check;
alter table stock_movements add constraint stock_movements_check check (
  (type in ('opening', 'purchase', 'transfer_in') and qty > 0)
  or (type in ('consumption', 'waste', 'transfer_out') and qty < 0)
  or type in ('count_adjustment', 'manual_adjustment', 'internal_move')
);

-- 4. Acceso de la pantalla o de quien trabaja en el local -------------------------------------------

-- Pantalla que llama (o nada).
create or replace function kiosk_membership() returns memberships
language sql stable security definer set search_path = public as $$
  select m.* from memberships m where m.user_id = auth.uid() and m.role = 'kiosk' limit 1
$$;

-- Local de la pantalla.
create or replace function kiosk_location() returns uuid
language sql stable security definer set search_path = public as $$
  select ml.location_id from membership_locations ml
  join memberships m on m.org_id = ml.org_id and m.user_id = ml.user_id
  where ml.user_id = auth.uid() and m.role = 'kiosk'
  limit 1
$$;

-- ¿Puede quien llama trabajar en el almacén de p_location? Su pantalla, o quien tiene acceso al local.
create or replace function warehouse_access(p_location uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_location is not null and (p_location = kiosk_location() or p_location in (select my_location_ids()))
$$;

-- Lo que la pantalla (o el móvil) necesita para empezar: local, zonas, si puede validar y pendientes.
create or replace function warehouse_context(p_location uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  kiosk boolean := kiosk_location() is not null;
  loc uuid;
  locs jsonb;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if kiosk then
    loc := kiosk_location();
    locs := (select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name)) from locations l where l.id = loc);
  else
    locs := coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name)
                      from locations l where l.active and l.id in (select my_location_ids())), '[]');
    loc := coalesce(p_location, (locs -> 0 ->> 'id')::uuid);
    if loc is not null and not warehouse_access(loc) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  return jsonb_build_object(
    'kiosk', kiosk,
    'location_id', loc,
    'locations', locs,
    'org_name', (select o.name from organizations o join locations l on l.org_id = o.id where l.id = loc),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind) order by a.kind, a.sort_order, a.name)
                       from storage_areas a where a.location_id = loc and a.active), '[]'),
    'can_validate', not kiosk and can_validate_location(auth.uid(), loc),
    'has_pin', exists (select 1 from validator_pins p where p.user_id = auth.uid()),
    'pending', (select count(*) from area_moves m where m.location_id = loc and m.status = 'pending'),
    'oldest_pending', (select min(m.created_at) from area_moves m where m.location_id = loc and m.status = 'pending')
  );
end $$;

-- Catálogo del almacén: lo más sacado en ese local (30 días) primero; búsqueda por nombre, familia o
-- código de barras. Sin precios. stock = lo que hay en las zonas de almacén del local.
create or replace function warehouse_catalog(p_location uuid, p_search text default null, p_limit int default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
end $$;

-- 5. Apuntar, deshacer y ver la cola --------------------------------------------------------------

-- Apunta una salida (o devolución). Repetir con el mismo client_ref no duplica (envíos sin cobertura).
create or replace function area_move_submit(
  p_location uuid,
  p_from_area uuid,
  p_to_area uuid,
  p_product uuid,
  p_qty numeric,
  p_input jsonb default null,
  p_kind text default 'salida',
  p_client_ref uuid default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
  org uuid;
  from_kind text;
  to_kind text;
  new_id uuid;
begin
  if not warehouse_access(p_location) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_client_ref is not null then
    select id into existing from area_moves where client_ref = p_client_ref;
    if existing is not null then
      return existing;
    end if;
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  select l.org_id into org from locations l where l.id = p_location;
  select a.kind into from_kind from storage_areas a where a.id = p_from_area and a.location_id = p_location and a.active;
  select a.kind into to_kind from storage_areas a where a.id = p_to_area and a.location_id = p_location and a.active;
  if from_kind is null or to_kind is null or p_from_area = p_to_area then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  if (coalesce(p_kind, 'salida') = 'salida' and not (from_kind = 'almacen' and to_kind = 'servicio'))
     or (p_kind = 'devolucion' and not (from_kind = 'servicio' and to_kind = 'almacen')) then
    raise exception 'invalid_area' using errcode = '22023';
  end if;
  if not exists (select 1 from products p where p.id = p_product and p.org_id = org and p.active) then
    raise exception 'invalid_product' using errcode = '22023';
  end if;
  insert into area_moves (org_id, location_id, from_area_id, to_area_id, product_id, qty, input, kind, client_ref, note)
  values (org, p_location, p_from_area, p_to_area, p_product, p_qty, p_input, coalesce(p_kind, 'salida'), p_client_ref, nullif(trim(coalesce(p_note, '')), ''))
  returning id into new_id;
  return new_id;
end $$;

-- Deshacer: quien la apuntó, durante 2 minutos y mientras siga pendiente.
create or replace function area_move_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update area_moves set status = 'cancelled', decided_at = now()
  where id = p_id and status = 'pending' and created_by = auth.uid() and created_at > now() - interval '2 minutes';
  if not found then
    raise exception 'cannot_cancel' using errcode = '42501';
  end if;
end $$;

-- Cola de un local (pendientes) o lo decidido hoy (p_status = 'decided').
create or replace function area_moves_list(p_location uuid, p_status text default 'pending', p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
        and ((p_status = 'pending' and m.status = 'pending')
             or (p_status = 'decided' and m.status in ('validated', 'rejected') and m.decided_at > now() - interval '24 hours'))
      order by m.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 300)
    ) x
  ), '[]'::jsonb);
end $$;

-- Personas que pueden validar en la pantalla (las que tienen PIN), para elegir quién valida.
create or replace function kiosk_validators() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(nullif(trim(p.full_name), ''), split_part(u.email, '@', 1)))
                            order by coalesce(nullif(trim(p.full_name), ''), u.email)), '[]'::jsonb)
  from memberships m
  join validator_pins vp on vp.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  left join profiles p on p.user_id = m.user_id
  where kiosk_location() is not null
    and m.org_id = (kiosk_membership()).org_id
    and can_validate_location(m.user_id, kiosk_location())
$$;

-- 6. Validar ------------------------------------------------------------------------------------------

-- p_decisions: [{"id": …, "action": "validate" | "reject", "qty"?: …, "product_id"?: …, "to_area_id"?: …, "note"?: …}]
-- En la pantalla: p_validator + p_pin. En el móvil: la sesión de quien valida (sin PIN).
-- Un PIN fallado NO lanza error (el intento tiene que quedar contado): devuelve {"ok": false, …}.
create or replace function area_moves_decide(p_decisions jsonb, p_validator uuid default null, p_pin text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  kloc uuid := kiosk_location();
  validator uuid;
  pin validator_pins;
  d jsonb;
  m area_moves;
  final_product uuid;
  final_qty numeric;
  final_to uuid;
  to_kind text;
  ref text;
  validated int := 0;
  rejected int := 0;
  skipped int := 0;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if kloc is not null then
    select * into pin from validator_pins where user_id = p_validator for update;
    if pin.user_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_pin');
    end if;
    if pin.locked_until is not null and pin.locked_until > now() then
      return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', pin.locked_until);
    end if;
    if p_pin is null or extensions.crypt(p_pin, pin.pin_hash) <> pin.pin_hash then
      update validator_pins
      set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
          locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
      where user_id = p_validator
      returning * into pin;
      return jsonb_build_object('ok', false, 'error', case when pin.locked_until is not null then 'locked' else 'pin' end,
                                'attempts_left', 5 - pin.failed_attempts, 'locked_until', pin.locked_until);
    end if;
    update validator_pins set failed_attempts = 0, locked_until = null where user_id = p_validator;
    validator := p_validator;
  else
    validator := auth.uid();
  end if;

  for d in select * from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) loop
    select * into m from area_moves where id = (d ->> 'id')::uuid for update;
    if m.id is null or m.status <> 'pending' then
      skipped := skipped + 1;
      continue;
    end if;
    if (kloc is not null and m.location_id <> kloc) or not can_validate_location(validator, m.location_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    if d ->> 'action' = 'reject' then
      update area_moves set status = 'rejected', decided_by = validator, decided_at = now(),
                            decision_note = nullif(trim(coalesce(d ->> 'note', '')), '')
      where id = m.id;
      rejected := rejected + 1;
      continue;
    elsif coalesce(d ->> 'action', '') <> 'validate' then
      raise exception 'invalid_action' using errcode = '22023';
    end if;

    final_product := coalesce((d ->> 'product_id')::uuid, m.product_id);
    final_qty := coalesce((d ->> 'qty')::numeric, m.qty);
    final_to := coalesce((d ->> 'to_area_id')::uuid, m.to_area_id);
    if final_qty <= 0 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    select a.kind into to_kind from storage_areas a where a.id = final_to and a.location_id = m.location_id and a.active;
    if to_kind is null or final_to = m.from_area_id
       or (m.kind = 'salida' and to_kind <> 'servicio') or (m.kind = 'devolucion' and to_kind <> 'almacen') then
      raise exception 'invalid_area' using errcode = '22023';
    end if;
    if not exists (select 1 from products p where p.id = final_product and p.org_id = m.org_id) then
      raise exception 'invalid_product' using errcode = '22023';
    end if;

    ref := case m.kind when 'salida' then 'Salida de almacén' else 'Devolución a almacén' end;
    insert into stock_movements (org_id, location_id, product_id, area_id, type, qty, reason, ref_table, ref_id, created_by)
    values (m.org_id, m.location_id, final_product, m.from_area_id, 'internal_move', -final_qty, ref, 'area_moves', m.id, validator),
           (m.org_id, m.location_id, final_product, final_to, 'internal_move', final_qty, ref, 'area_moves', m.id, validator);

    update area_moves set
      status = 'validated', decided_by = validator, decided_at = now(),
      decision_note = nullif(trim(coalesce(d ->> 'note', '')), ''),
      original = case when final_product <> m.product_id or final_qty <> m.qty or final_to <> m.to_area_id
                      then jsonb_build_object('product_id', m.product_id, 'qty', m.qty::text, 'to_area_id', m.to_area_id) end,
      product_id = final_product, qty = final_qty, to_area_id = final_to
    where id = m.id;
    validated := validated + 1;
  end loop;

  return jsonb_build_object('ok', true, 'validated', validated, 'rejected', rejected, 'skipped', skipped);
end $$;

-- 7. Equipo: pantallas y «puede validar» ----------------------------------------------------------

create or replace function team_can_manage(actor member_role, target member_role) returns boolean
language sql immutable set search_path = public as $$
  select case actor
    when 'owner' then true
    when 'admin' then target in ('manager', 'staff', 'kiosk')
    when 'manager' then target in ('staff', 'kiosk')
    else false
  end
$$;

create or replace function team_check_assign(p_role member_role, p_all_locations boolean, p_locations uuid[], p_org uuid default null)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  a memberships := team_actor(p_org);
  mine uuid[];
begin
  if a.user_id is null or not team_can_manage(a.role, p_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'kiosk' and (coalesce(p_all_locations, false) or coalesce(cardinality(p_locations), 0) <> 1) then
    raise exception 'kiosk_one_location' using errcode = '22023';
  end if;
  if p_role in ('manager', 'staff', 'kiosk') then
    if not coalesce(p_all_locations, false) and coalesce(cardinality(p_locations), 0) = 0 then
      raise exception 'no_locations' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(coalesce(p_locations, '{}')) x where not exists (select 1 from locations l where l.id = x and l.org_id = a.org_id)) then
      raise exception 'location_forbidden' using errcode = '42501';
    end if;
    if a.role = 'manager' then
      mine := team_actor_locations(a);
      if coalesce(p_all_locations, false) or not (coalesce(p_locations, '{}') <@ mine) then
        raise exception 'location_forbidden' using errcode = '42501';
      end if;
    end if;
  end if;
  return a.org_id;
end $$;

drop function if exists team_members(uuid);
create function team_members(p_org uuid default null)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role member_role,
  all_locations boolean,
  location_ids uuid[],
  last_sign_in_at timestamptz,
  pending boolean,
  created_at timestamptz,
  is_self boolean,
  can_edit boolean,
  can_validate boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  a memberships := team_actor(p_org);
  mine uuid[];
begin
  if a.user_id is null or a.role in ('staff', 'kiosk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  mine := team_actor_locations(a);
  return query
  with m as (
    select m.*,
           coalesce((select array_agg(ml.location_id order by ml.location_id) from membership_locations ml
                     where ml.org_id = m.org_id and ml.user_id = m.user_id), '{}') as locs
    from memberships m
    where m.org_id = a.org_id
  )
  select m.user_id, p.full_name, u.email::text, m.role, m.all_locations, m.locs,
         u.last_sign_in_at, u.last_sign_in_at is null, m.created_at,
         m.user_id = a.user_id,
         m.user_id <> a.user_id and team_can_manage(a.role, m.role)
           and (a.role <> 'manager' or (not m.all_locations and m.locs && mine)),
         m.can_validate
  from m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.user_id = m.user_id
  where a.role in ('owner', 'admin')
     or m.user_id = a.user_id
     or (m.role in ('manager', 'staff', 'kiosk') and not m.all_locations and m.locs && mine)
  order by array_position(array['owner', 'admin', 'manager', 'staff', 'kiosk']::member_role[], m.role), coalesce(p.full_name, u.email);
end $$;

drop function if exists team_set_member(uuid, member_role, boolean, uuid[], text, uuid);
drop function if exists team_set_member(uuid, member_role, boolean, uuid[], text, uuid, boolean);
create function team_set_member(
  p_user uuid,
  p_role member_role,
  p_all_locations boolean default false,
  p_locations uuid[] default '{}',
  p_full_name text default null,
  p_org uuid default null,
  p_can_validate boolean default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  a memberships := team_actor(p_org);
  old memberships;
  mine uuid[];
  old_locs uuid[];
  new_locs uuid[] := coalesce(p_locations, '{}');
  all_locs boolean := coalesce(p_all_locations, false);
begin
  if a.user_id is null or a.role in ('staff', 'kiosk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'self' using errcode = '42501';
  end if;
  if exists (select 1 from memberships m where m.user_id = p_user and m.org_id <> a.org_id) then
    raise exception 'other_org' using errcode = '23505';
  end if;

  select * into old from memberships m where m.org_id = a.org_id and m.user_id = p_user for update;
  old_locs := coalesce((select array_agg(ml.location_id) from membership_locations ml where ml.org_id = a.org_id and ml.user_id = p_user), '{}');

  if old.user_id is not null then
    if not team_can_manage(a.role, old.role) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if (old.role = 'kiosk') <> (p_role = 'kiosk') then
      raise exception 'kiosk_fixed' using errcode = '22023';
    end if;
    if a.role = 'manager' then
      mine := team_actor_locations(a);
      if old.all_locations or not (old_locs && mine) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if p_role <> 'kiosk' then
        new_locs := new_locs || coalesce((select array_agg(x) from unnest(old_locs) x where not (x = any (mine))), '{}');
      end if;
    end if;
    if old.role = 'owner' and p_role <> 'owner'
       and (select count(*) from memberships m where m.org_id = a.org_id and m.role = 'owner') <= 1 then
      raise exception 'last_owner' using errcode = '42501';
    end if;
  end if;

  -- Una pantalla es siempre una cuenta creada como pantalla por el servidor (app_metadata.kiosk, que nadie
  -- puede cambiar desde el navegador). Así nadie convierte la cuenta de una persona en «pantalla» para
  -- conseguir un enlace de entrada a ella, ni una pantalla pasa a ser una persona.
  if (p_role = 'kiosk') <> coalesce((select (u.raw_app_meta_data ->> 'kiosk')::boolean from auth.users u where u.id = p_user), false) then
    raise exception 'kiosk_fixed' using errcode = '22023';
  end if;

  -- Primero sobre quién se actúa; después, qué se le da.
  perform team_check_assign(p_role, p_all_locations, p_locations, a.org_id);

  if p_role in ('owner', 'admin') then
    all_locs := true;
    new_locs := '{}';
  elsif all_locs then
    new_locs := '{}';
  end if;

  insert into memberships (org_id, user_id, role, all_locations, can_validate)
  values (a.org_id, p_user, p_role, all_locs, p_role = 'staff' and coalesce(p_can_validate, false))
  on conflict (org_id, user_id) do update set
    role = excluded.role,
    all_locations = excluded.all_locations,
    can_validate = case when excluded.role = 'staff' then coalesce(p_can_validate, memberships.can_validate) else false end;

  delete from membership_locations ml where ml.org_id = a.org_id and ml.user_id = p_user and not (ml.location_id = any (new_locs));
  insert into membership_locations (org_id, user_id, location_id)
  select distinct a.org_id, p_user, x from unnest(new_locs) x
  on conflict (user_id, location_id) do nothing;

  if nullif(trim(coalesce(p_full_name, '')), '') is not null then
    insert into profiles (user_id, full_name) values (p_user, trim(p_full_name))
    on conflict (user_id) do update set full_name = excluded.full_name;
  end if;
end $$;

-- 8. Permisos ------------------------------------------------------------------------------------------

revoke all on function can_validate_location(uuid, uuid) from public, anon, authenticated;
revoke all on function kiosk_membership() from public, anon, authenticated;
revoke all on function kiosk_location() from public, anon, authenticated;
revoke all on function warehouse_access(uuid) from public, anon, authenticated;
revoke all on function set_validation_pin(text) from public, anon;
revoke all on function warehouse_context(uuid) from public, anon;
revoke all on function warehouse_catalog(uuid, text, int) from public, anon;
revoke all on function area_move_submit(uuid, uuid, uuid, uuid, numeric, jsonb, text, uuid, text) from public, anon;
revoke all on function area_move_cancel(uuid) from public, anon;
revoke all on function area_moves_list(uuid, text, int) from public, anon;
revoke all on function kiosk_validators() from public, anon;
revoke all on function area_moves_decide(jsonb, uuid, text) from public, anon;
revoke all on function team_members(uuid) from public, anon;
revoke all on function team_set_member(uuid, member_role, boolean, uuid[], text, uuid, boolean) from public, anon;

grant execute on function set_validation_pin(text) to authenticated;
grant execute on function warehouse_context(uuid) to authenticated;
grant execute on function warehouse_catalog(uuid, text, int) to authenticated;
grant execute on function area_move_submit(uuid, uuid, uuid, uuid, numeric, jsonb, text, uuid, text) to authenticated;
grant execute on function area_move_cancel(uuid) to authenticated;
grant execute on function area_moves_list(uuid, text, int) to authenticated;
grant execute on function kiosk_validators() to authenticated;
grant execute on function area_moves_decide(jsonb, uuid, text) to authenticated;
grant execute on function team_members(uuid) to authenticated;
grant execute on function team_set_member(uuid, member_role, boolean, uuid[], text, uuid, boolean) to authenticated;
