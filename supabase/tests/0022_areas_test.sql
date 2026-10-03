begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('f1000000-0000-4000-8000-000000000001', 'zonas-manager@example.com', now()),
  ('f1000000-0000-4000-8000-000000000002', 'zonas-staff@example.com', now());
insert into organizations (id, name) values ('f2000000-0000-4000-8000-000000000001', 'Org zonas');
insert into locations (id, org_id, name) values
  ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Bar'),
  ('f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'Terraza');
insert into memberships (org_id, user_id, role, all_locations) values
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'manager', false),
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'staff', false);
insert into membership_locations (org_id, user_id, location_id) values
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000001');

select is(
  (select string_agg(name || ':' || kind, ',' order by sort_order) from storage_areas where location_id = 'f3000000-0000-4000-8000-000000000001'),
  'Almacén:almacen,Barra:servicio',
  'a new location starts with a warehouse and a bar'
);

-- Stock en el almacén del Bar.
insert into products (id, org_id, name, dimension) values ('f5000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Ron zonas', 'volume');
insert into stock_movements (org_id, location_id, product_id, area_id, type, qty, unit_cost)
select 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', a.id, 'opening', 700, 0.02
from storage_areas a where a.location_id = 'f3000000-0000-4000-8000-000000000001' and a.name = 'Almacén';

set local role authenticated;

-- Encargado del Bar: crea, renombra y ordena zonas de su local; no de otro.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$insert into storage_areas (location_id, name, kind, sort_order) values ('f3000000-0000-4000-8000-000000000001', 'Cocina', 'servicio', 3)$$,
  'a manager adds a zone to their location'
);
select throws_ok(
  $$insert into storage_areas (location_id, name, kind) values ('f3000000-0000-4000-8000-000000000002', 'Cocina', 'servicio')$$,
  '42501', null, 'a manager cannot add zones to another location'
);
select throws_ok(
  $$insert into storage_areas (location_id, name, kind) values ('f3000000-0000-4000-8000-000000000001', 'Cámara', 'nevera')$$,
  '23514', null, 'a zone is a warehouse or a service area'
);
select throws_ok(
  $$update storage_areas set active = false where location_id = 'f3000000-0000-4000-8000-000000000001' and name = 'Almacén'$$,
  '23514', 'area_has_stock', 'a zone with stock cannot be archived'
);
select lives_ok(
  $$update storage_areas set active = false where location_id = 'f3000000-0000-4000-8000-000000000001' and name = 'Cocina'$$,
  'an empty zone can be archived'
);
select is(
  (select products::int from v_storage_areas where location_id = 'f3000000-0000-4000-8000-000000000001' and name = 'Almacén'),
  1,
  'the zone list shows what each zone holds'
);

-- Personal: ve las zonas, no las cambia.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$insert into storage_areas (location_id, name, kind) values ('f3000000-0000-4000-8000-000000000001', 'Eventos', 'servicio')$$,
  '42501', null, 'staff cannot add zones'
);
reset role;

select * from finish();
rollback;
