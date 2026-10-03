-- Equipo: quién entra, con qué rol y en qué locales.
--
-- Roles (de más a menos):
--   propietario    todo, incluidos otros propietarios y administradores.
--   administrador  ve y gestiona todos los locales; da de alta encargados y personal.
--   encargado      solo ve sus locales; da de alta y gestiona al personal de sus locales.
--   personal       solo ve sus locales; no gestiona equipo.
-- Lo que ve cada uno ya lo decide RLS (my_location_ids): los administradores ven todos los locales, el
-- resto solo los suyos, también en informes y en el asistente.
--
-- Hasta ahora un administrador podía escribir directamente en memberships y, por tanto, ascenderse a
-- propietario o quitar al propietario. Las escrituras directas se cierran: todo cambio de equipo pasa por
-- team_set_member() y team_remove_member(), que comprueban quién hace qué. Nadie cambia su propio acceso y
-- una organización nunca se queda sin propietario.
-- El app supone una organización por usuario (como el resto de pantallas).

-- Escrituras directas cerradas ------------------------------------------------------------------

drop policy if exists mem_insert on memberships;
drop policy if exists mem_update on memberships;
drop policy if exists mem_delete on memberships;
drop policy if exists memloc_insert on membership_locations;
drop policy if exists memloc_update on membership_locations;
drop policy if exists memloc_delete on membership_locations;

-- Reglas -------------------------------------------------------------------------------------------

-- ¿Puede quien tiene el rol `actor` dar o quitar el rol `target`?
create or replace function team_can_manage(actor member_role, target member_role) returns boolean
language sql immutable set search_path = public as $$
  select case actor
    when 'owner' then true
    when 'admin' then target in ('manager', 'staff')
    when 'manager' then target = 'staff'
    else false
  end
$$;

-- Membresía de quien llama: la de p_org o, sin ella, su organización.
create or replace function team_actor(p_org uuid default null) returns memberships
language sql stable security definer set search_path = public as $$
  select m.* from memberships m
  where m.user_id = auth.uid() and (p_org is null or m.org_id = p_org)
  order by m.created_at
  limit 1
$$;

-- Locales en los que manda quien llama (todos si es propietario, administrador o tiene todos los locales).
create or replace function team_actor_locations(a memberships) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(l.id), '{}')
  from locations l
  where l.org_id = a.org_id
    and (a.role in ('owner', 'admin') or a.all_locations
         or exists (select 1 from membership_locations ml where ml.user_id = a.user_id and ml.location_id = l.id))
$$;

-- Comprueba que quien llama puede dar ese rol con esos locales (sin tocar nada). La usa el servidor antes
-- de crear la cuenta de una persona invitada; team_set_member() repite las mismas comprobaciones.
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
  if p_role in ('manager', 'staff') then
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

-- Lectura -----------------------------------------------------------------------------------------

-- Equipo visible para quien llama: propietarios y administradores, toda la organización; un encargado,
-- él mismo y el personal y encargados de sus locales. El personal no gestiona equipo.
create or replace function team_members(p_org uuid default null)
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
  can_edit boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  a memberships := team_actor(p_org);
  mine uuid[];
begin
  if a.user_id is null or a.role = 'staff' then
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
           and (a.role <> 'manager' or (not m.all_locations and m.locs && mine))
  from m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.user_id = m.user_id
  where a.role in ('owner', 'admin')
     or m.user_id = a.user_id
     or (m.role in ('manager', 'staff') and not m.all_locations and m.locs && mine)
  order by array_position(array['owner', 'admin', 'manager', 'staff']::member_role[], m.role), coalesce(p.full_name, u.email);
end $$;

-- Cambios -----------------------------------------------------------------------------------------

-- Da de alta o cambia a una persona: rol, todos los locales o una lista, y su nombre si se indica.
-- Un encargado solo toca los locales que él lleva: los demás locales de esa persona se conservan.
create or replace function team_set_member(
  p_user uuid,
  p_role member_role,
  p_all_locations boolean default false,
  p_locations uuid[] default '{}',
  p_full_name text default null,
  p_org uuid default null
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
  if a.user_id is null or a.role = 'staff' then
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
    if a.role = 'manager' then
      mine := team_actor_locations(a);
      if old.all_locations or not (old_locs && mine) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      -- Lo de otros locales que no lleva este encargado se queda como estaba.
      new_locs := new_locs || coalesce((select array_agg(x) from unnest(old_locs) x where not (x = any (mine))), '{}');
    end if;
    if old.role = 'owner' and p_role <> 'owner'
       and (select count(*) from memberships m where m.org_id = a.org_id and m.role = 'owner') <= 1 then
      raise exception 'last_owner' using errcode = '42501';
    end if;
  end if;

  -- Primero sobre quién se actúa; después, qué se le da.
  perform team_check_assign(p_role, p_all_locations, p_locations, a.org_id);

  if p_role in ('owner', 'admin') then
    all_locs := true;
    new_locs := '{}';
  elsif all_locs then
    new_locs := '{}';
  end if;

  insert into memberships (org_id, user_id, role, all_locations)
  values (a.org_id, p_user, p_role, all_locs)
  on conflict (org_id, user_id) do update set role = excluded.role, all_locations = excluded.all_locations;

  delete from membership_locations ml where ml.org_id = a.org_id and ml.user_id = p_user and not (ml.location_id = any (new_locs));
  insert into membership_locations (org_id, user_id, location_id)
  select distinct a.org_id, p_user, x from unnest(new_locs) x
  on conflict (user_id, location_id) do nothing;

  if nullif(trim(coalesce(p_full_name, '')), '') is not null then
    insert into profiles (user_id, full_name) values (p_user, trim(p_full_name))
    on conflict (user_id) do update set full_name = excluded.full_name;
  end if;
end $$;

-- Quita el acceso. Un encargado solo quita sus locales: si esa persona trabaja también en otros, sigue allí.
create or replace function team_remove_member(p_user uuid, p_org uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  a memberships := team_actor(p_org);
  old memberships;
  mine uuid[];
begin
  if a.user_id is null or a.role = 'staff' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'self' using errcode = '42501';
  end if;
  select * into old from memberships m where m.org_id = a.org_id and m.user_id = p_user for update;
  if old.user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not team_can_manage(a.role, old.role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if old.role = 'owner' and (select count(*) from memberships m where m.org_id = a.org_id and m.role = 'owner') <= 1 then
    raise exception 'last_owner' using errcode = '42501';
  end if;
  if a.role = 'manager' then
    mine := team_actor_locations(a);
    if old.all_locations or not exists (select 1 from membership_locations ml where ml.user_id = p_user and ml.location_id = any (mine)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    delete from membership_locations ml where ml.org_id = a.org_id and ml.user_id = p_user and ml.location_id = any (mine);
    if exists (select 1 from membership_locations ml where ml.org_id = a.org_id and ml.user_id = p_user) then
      return;
    end if;
  end if;
  delete from memberships m where m.org_id = a.org_id and m.user_id = p_user;
end $$;

-- Solo para el servidor (clave de servicio): la cuenta que ya existe con ese email, si la hay.
create or replace function auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1
$$;

revoke all on function team_can_manage(member_role, member_role) from public, anon;
revoke all on function team_actor(uuid) from public, anon, authenticated;
revoke all on function team_actor_locations(memberships) from public, anon, authenticated;
revoke all on function team_check_assign(member_role, boolean, uuid[], uuid) from public, anon;
revoke all on function team_members(uuid) from public, anon;
revoke all on function team_set_member(uuid, member_role, boolean, uuid[], text, uuid) from public, anon;
revoke all on function team_remove_member(uuid, uuid) from public, anon;
revoke all on function auth_user_id_by_email(text) from public, anon, authenticated;

grant execute on function team_can_manage(member_role, member_role) to authenticated;
grant execute on function team_check_assign(member_role, boolean, uuid[], uuid) to authenticated;
grant execute on function team_members(uuid) to authenticated;
grant execute on function team_set_member(uuid, member_role, boolean, uuid[], text, uuid) to authenticated;
grant execute on function team_remove_member(uuid, uuid) to authenticated;
grant execute on function auth_user_id_by_email(text) to service_role;
