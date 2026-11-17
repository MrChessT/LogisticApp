-- Roles: alcance por cuenta de análisis (Bebida, Comida, Menaje…), según la tabla de roles del Drive «DRIVE WARRO».
--
-- membership_accounts  Cuentas de análisis (raíces de categoría) a las que tiene acceso un miembro.
--                      Regla: un miembro SIN filas aquí no tiene restricción por cuenta (es el comportamiento de
--                      hoy). Con filas, solo ve las cuentas listadas. Esta migración no cambia ninguna política
--                      existente: solo deja preparado el alcance; su aplicación en productos, stock y movimientos
--                      va en una migración posterior, con pruebas propias.
--
-- account_of(c)            Cuenta de análisis de una categoría: su raíz (la categoría misma si es raíz).
-- account_allowed(org, c)  true si el usuario puede ver la categoría c según sus cuentas.

create table membership_accounts (
  org_id uuid not null,
  user_id uuid not null,
  account_id uuid not null references categories(id) on delete cascade,
  primary key (user_id, account_id),
  foreign key (org_id, user_id) references memberships(org_id, user_id) on delete cascade
);
create index membership_accounts_org on membership_accounts (org_id);

alter table membership_accounts enable row level security;
create policy memacc_select on membership_accounts for select using (is_member(org_id));
create policy memacc_write on membership_accounts for all using (is_admin(org_id)) with check (is_admin(org_id));

create or replace function account_of(p_category uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.id from categories c join categories r on r.id = c.parent_id where c.id = p_category and r.parent_id is null),
    (select c.id from categories c where c.id = p_category and c.parent_id is null)
  )
$$;

create or replace function account_allowed(p_org uuid, p_category uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from membership_accounts ma where ma.org_id = p_org and ma.user_id = auth.uid()) then true
    else exists (
      select 1 from membership_accounts ma
      where ma.org_id = p_org and ma.user_id = auth.uid() and ma.account_id = account_of(p_category)
    )
  end
$$;

revoke all on function account_of(uuid) from public, anon;
grant execute on function account_of(uuid) to authenticated;
revoke all on function account_allowed(uuid, uuid) from public, anon;
grant execute on function account_allowed(uuid, uuid) to authenticated;
