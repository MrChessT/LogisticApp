-- Permiso «ve costes» por persona (bloque de roles configurables).
--   · Propiedad, administración y encargados ven costes siempre.
--   · El personal (staff) solo si se le da en Equipo (can_see_costs). La pantalla de almacén, nunca.
--   · En la base de datos: sin el permiso no se leen los precios de compra (supplier_prices,
--     price_history) ni el resumen de proveedores. La app oculta además importes y valoraciones, y el
--     servidor no sirve Informes con importes a quien no lo tiene.

alter table memberships add column if not exists can_see_costs boolean not null default false;

create or replace function sees_costs(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and (m.role in ('owner', 'admin', 'manager') or (m.role = 'staff' and m.can_see_costs))
  )
$$;
revoke all on function sees_costs(uuid) from public, anon;
grant execute on function sees_costs(uuid) to authenticated;

-- Precios de compra: solo quien ve costes.
alter policy sprice_select on supplier_prices using (
  supplier_id in (select s.id from suppliers s where s.org_id in (select my_org_ids()) and sees_costs(s.org_id))
);
alter policy phist_select on price_history using (
  supplier_id in (select s.id from suppliers s where s.org_id in (select my_org_ids()) and sees_costs(s.org_id))
);

-- Equipo: se ve y se cambia como «puede validar» (solo para personal; los demás ya ven costes).
drop function if exists team_members(uuid);
create function team_members(p_org uuid default null)
returns table (
  user_id uuid, full_name text, email text, role member_role, all_locations boolean, location_ids uuid[],
  last_sign_in_at timestamptz, pending boolean, created_at timestamptz, is_self boolean, can_edit boolean,
  can_validate boolean, can_see_costs boolean
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
         m.can_validate,
         m.role in ('owner', 'admin', 'manager') or (m.role = 'staff' and m.can_see_costs)
  from m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.user_id = m.user_id
  where a.role in ('owner', 'admin')
     or m.user_id = a.user_id
     or (m.role in ('manager', 'staff', 'kiosk') and not m.all_locations and m.locs && mine)
  order by array_position(array['owner', 'admin', 'manager', 'staff', 'kiosk']::member_role[], m.role), coalesce(p.full_name, u.email);
end $$;
revoke all on function team_members(uuid) from public, anon;
grant execute on function team_members(uuid) to authenticated;

-- Dar o quitar «ve costes» a una persona del personal: quien puede editarla en Equipo.
create or replace function team_set_costs(p_user uuid, p_value boolean, p_org uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  select * into t from team_members(p_org) x where x.user_id = p_user;
  if t.user_id is null or not t.can_edit then raise exception 'forbidden' using errcode = '42501'; end if;
  if t.role <> 'staff' then raise exception 'only_staff' using errcode = '22023'; end if;
  update memberships set can_see_costs = coalesce(p_value, false)
  where user_id = p_user and org_id = (team_actor(p_org)).org_id;
end $$;
revoke all on function team_set_costs(uuid, boolean, uuid) from public, anon;
grant execute on function team_set_costs(uuid, boolean, uuid) to authenticated;
