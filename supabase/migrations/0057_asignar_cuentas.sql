-- Roles, fase 4: asignar cuentas de análisis desde Equipo.
--
-- team_set_accounts(p_user, p_accounts)  Deja a la persona exactamente con esas cuentas (raíces de categoría de la
--                                         organización). Lista vacía = sin restricción por cuenta (lo ve todo, 0055).
-- Quién puede: el mismo que puede editar a esa persona en Equipo (team_members.can_edit), como team_set_costs.
-- A propietarios y administradores no se les limita: la administración lo ve todo.
-- Quien tiene cuentas asignadas solo puede repartir las suyas, y no puede dejar a nadie sin restricción: si no,
-- un encargado de Comida podría abrir Bebida a su personal, o a sí mismo a través de otro.

create or replace function team_set_accounts(p_user uuid, p_accounts uuid[], p_org uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
  org uuid := (team_actor(p_org)).org_id;
  wanted uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_accounts, '{}')) x), '{}');
  mine uuid[] := coalesce((select array_agg(ma.account_id) from membership_accounts ma where ma.org_id = org and ma.user_id = auth.uid()), '{}');
begin
  select * into t from team_members(p_org) x where x.user_id = p_user;
  if t.user_id is null or not t.can_edit then raise exception 'forbidden' using errcode = '42501'; end if;
  if t.role in ('owner', 'admin') then raise exception 'accounts_admin' using errcode = '22023'; end if;
  if exists (select 1 from unnest(wanted) x where not exists (
    select 1 from categories c where c.id = x and c.org_id = org and c.parent_id is null
  )) then
    raise exception 'accounts_invalid' using errcode = '22023';
  end if;
  if cardinality(mine) > 0 and (cardinality(wanted) = 0 or not wanted <@ mine) then
    raise exception 'accounts_forbidden' using errcode = '42501';
  end if;

  delete from membership_accounts ma where ma.org_id = org and ma.user_id = p_user and not (ma.account_id = any (wanted));
  insert into membership_accounts (org_id, user_id, account_id)
  select org, p_user, x from unnest(wanted) x
  on conflict (user_id, account_id) do nothing;
end $$;
revoke all on function team_set_accounts(uuid, uuid[], uuid) from public, anon;
grant execute on function team_set_accounts(uuid, uuid[], uuid) to authenticated;
