-- Zonas de cada local: de dónde sale el género (almacén) y a dónde va (barra, cocina…).
--
-- - kind: 'almacen' (se guarda: la pantalla del almacén saca de aquí) o 'servicio' (se usa: barra, cocina,
--   terraza, eventos…). Las salidas del almacén van de una zona 'almacen' a una 'servicio'.
-- - active: una zona se archiva en vez de borrarse; sus movimientos y su historial se conservan.
-- - Todos los locales tienen al menos «Almacén» y «Barra». Las zonas que llegaron del sistema anterior
--   (Bebidas, Comida, Sala, Menaje…) guardan stock: quedan como almacén hasta que se reorganicen.
-- Crear, renombrar, ordenar y archivar zonas lo pueden hacer los encargados de ese local y la
-- administración (políticas area_* de la 0019: my_managed_location_ids).

alter table storage_areas add column if not exists kind text not null default 'almacen';
alter table storage_areas add column if not exists active boolean not null default true;

do $$ begin
  alter table storage_areas add constraint storage_areas_kind check (kind in ('almacen', 'servicio'));
exception when duplicate_object then null; end $$;

-- «Almacen general» pasa a llamarse «Almacén» (si el local no tiene ya una zona con ese nombre).
update storage_areas a set name = 'Almacén'
where a.name = 'Almacen general'
  and not exists (select 1 from storage_areas b where b.location_id = a.location_id and b.name = 'Almacén');

update storage_areas set kind = 'servicio' where name in ('Barra', 'Cocina', 'Terraza');

-- Almacén y Barra en todos los locales (los que se creen después también los tendrán: trigger abajo).
insert into storage_areas (location_id, name, sort_order, kind)
select l.id, 'Almacén', 1, 'almacen' from locations l
where not exists (select 1 from storage_areas a where a.location_id = l.id and a.name = 'Almacén')
on conflict (location_id, name) do nothing;
insert into storage_areas (location_id, name, sort_order, kind)
select l.id, 'Barra', 2, 'servicio' from locations l
where not exists (select 1 from storage_areas a where a.location_id = l.id and a.name = 'Barra')
on conflict (location_id, name) do nothing;

create or replace function create_default_areas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into storage_areas (location_id, name, sort_order, kind) values
    (new.id, 'Almacén', 1, 'almacen'),
    (new.id, 'Barra', 2, 'servicio')
  on conflict (location_id, name) do nothing;
  return new;
end $$;

drop trigger if exists locations_default_areas on locations;
create trigger locations_default_areas after insert on locations
for each row execute function create_default_areas();

revoke all on function create_default_areas() from public, anon, authenticated;

-- Una zona con stock no se archiva: primero hay que moverlo o contarlo a cero.
create or replace function storage_areas_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.active and not new.active
     and exists (select 1 from stock_area_balances b where b.area_id = new.id and b.qty <> 0) then
    raise exception 'area_has_stock' using errcode = '23514';
  end if;
  if new.location_id <> old.location_id then
    raise exception 'area_location_locked' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists storage_areas_guard on storage_areas;
create trigger storage_areas_guard before update on storage_areas
for each row execute function storage_areas_guard();

-- Zonas por local con lo que guardan, para la pantalla de zonas.
create or replace view v_storage_areas with (security_invoker = true) as
select a.id, a.location_id, l.name as location_name, a.name, a.kind, a.active, a.sort_order,
       count(b.product_id) filter (where b.qty <> 0) as products,
       coalesce(round(sum(b.qty * b.avg_cost) filter (where b.qty <> 0), 2), 0) as stock_value
from storage_areas a
join locations l on l.id = a.location_id
left join stock_area_balances b on b.area_id = a.id
group by a.id, l.name;

revoke all on v_storage_areas from anon;
grant select on v_storage_areas to authenticated;
