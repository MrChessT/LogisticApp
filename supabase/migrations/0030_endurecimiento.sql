-- Endurecimiento tras la revisión de seguridad y rendimiento de Supabase (sin cambios de comportamiento).
--   1) Nadie sin sesión (anon) puede ejecutar funciones de la API; tampoco en las que se creen después.
--   2) Las funciones de disparador no se pueden llamar por /rpc (los disparadores siguen funcionando: el
--      permiso EXECUTE solo se comprueba al crear el disparador, no cada vez que salta).
--   3) Funciones sin search_path fijo.
--   4) Políticas que evaluaban auth.uid() fila a fila: ahora una vez por consulta.
--   5) Índices para las claves ajenas que no tenían.

-- 1 y 2) Permisos de ejecución.
do $$
declare
  f regprocedure;
  is_trigger boolean;
begin
  for f, is_trigger in
    select p.oid::regprocedure, p.prorettype = 'trigger'::regtype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    if is_trigger then
      execute format('revoke execute on function %s from authenticated', f);
    end if;
  end loop;
end $$;

-- Las funciones nuevas: el permiso por defecto a PUBLIC es global (el de esquema solo suma), así que se
-- quita a nivel global; authenticated y service_role lo siguen recibiendo por el de esquema de Supabase.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- 3) search_path fijo (solo usan funciones del catálogo del sistema).
alter function forbid_mutation() set search_path = '';
alter function forbid_copilot_audit_mutation() set search_path = '';
alter function copilot_drafts_guard() set search_path = '';
alter function default_exit_kind() set search_path = '';
alter function norm_text(text) set search_path = '';

-- 4) auth.uid() evaluado una vez por consulta.
alter policy copilot_audit_insert on copilot_audit
  with check (user_id = (select auth.uid()) and is_member(org_id));
alter policy copilot_audit_select on copilot_audit
  using (is_admin(org_id) or user_id = (select auth.uid()));
alter policy copilot_drafts_delete on copilot_drafts
  using (user_id = (select auth.uid()));
alter policy copilot_drafts_insert on copilot_drafts
  with check (user_id = (select auth.uid()) and is_member(org_id));
alter policy copilot_drafts_select on copilot_drafts
  using (user_id = (select auth.uid()));
alter policy copilot_drafts_update on copilot_drafts
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy copilot_profiles_own on copilot_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and org_id in (select my_org_ids()));
alter policy copilot_sessions_own on copilot_sessions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and is_member(org_id));
alter policy profile_update_self on profiles
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 5) Índices de claves ajenas.
create index if not exists area_moves_from_area_idx on area_moves (from_area_id);
create index if not exists area_moves_to_area_idx on area_moves (to_area_id);
create index if not exists area_moves_org_location_idx on area_moves (org_id, location_id);
create index if not exists area_moves_org_product_idx on area_moves (org_id, product_id);
create index if not exists copilot_drafts_org_idx on copilot_drafts (org_id);
create index if not exists copilot_feedback_reviewed_by_idx on copilot_feedback (reviewed_by);
create index if not exists copilot_profiles_user_idx on copilot_profiles (user_id);
create index if not exists copilot_sessions_org_idx on copilot_sessions (org_id);
create index if not exists goods_receipts_org_location_idx on goods_receipts (org_id, location_id);
create index if not exists goods_receipts_org_supplier_idx on goods_receipts (org_id, supplier_id);
create index if not exists inventory_counts_org_location_idx on inventory_counts (org_id, location_id);
create index if not exists membership_locations_org_location_idx on membership_locations (org_id, location_id);
create index if not exists membership_locations_org_user_idx on membership_locations (org_id, user_id);
create index if not exists purchase_orders_org_location_idx on purchase_orders (org_id, location_id);
create index if not exists purchase_orders_org_supplier_idx on purchase_orders (org_id, supplier_id);
create index if not exists stock_movements_org_location_idx on stock_movements (org_id, location_id);
create index if not exists stock_movements_org_product_idx on stock_movements (org_id, product_id);
create index if not exists transfers_org_from_idx on transfers (org_id, from_location_id);
create index if not exists transfers_org_to_idx on transfers (org_id, to_location_id);

-- 6) Consumo por día: una fila por día de negocio. Antes devolvía una por producto, tipo y día, y la API
--    corta en 1000 filas: con un mes de actividad en varios locales el Resumen enseñaba menos consumo.
create or replace function usage_by_business_day(p_since date, p_location uuid default null)
returns table (business_day date, value numeric)
language sql stable security invoker set search_path = public as $$
  select g.business_day, round(sum(g.value), 2)
  from (
    select ((m.occurred_at at time zone l.timezone) - l.day_cutoff::interval)::date as business_day,
           m.qty * m.unit_cost as value
    from stock_movements m
    join locations l on l.id = m.location_id
    where (
        m.type in ('consumption', 'waste')
        or (m.type in ('count_adjustment', 'manual_adjustment') and m.qty < 0)
      )
      and (p_location is null or m.location_id = p_location)
      -- Margen de 2 días para zona horaria y hora de corte; el filtro exacto va después.
      and m.occurred_at >= (p_since - 2)::timestamptz
  ) g
  where g.business_day >= p_since
  group by g.business_day
  order by g.business_day
$$;
