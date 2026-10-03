begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

-- Un local (Bar) con su almacén y su barra, otro local (Terraza), y su gente: encargado, personal con y
-- sin «puede validar», y la pantalla del almacén del Bar.
insert into auth.users (id, email, email_confirmed_at) values
  ('a1000000-0000-4000-8000-000000000001', 'wh-manager@example.com', now()),
  ('a1000000-0000-4000-8000-000000000002', 'wh-staff@example.com', now()),
  ('a1000000-0000-4000-8000-000000000003', 'wh-validator@example.com', now()),
  ('a1000000-0000-4000-8000-000000000004', 'wh-kiosk@example.com', now());
insert into organizations (id, name) values ('a2000000-0000-4000-8000-000000000001', 'Org almacén');
insert into locations (id, org_id, name) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Bar'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Terraza');
insert into memberships (org_id, user_id, role, all_locations, can_validate) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'manager', false, false),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'staff', false, false),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'staff', false, true),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'kiosk', false, false);
insert into membership_locations (org_id, user_id, location_id)
select 'a2000000-0000-4000-8000-000000000001', u, 'a3000000-0000-4000-8000-000000000001'
from unnest(array['a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
                  'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004']::uuid[]) u;
insert into products (id, org_id, name, dimension) values ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Ron almacén', 'volume');
insert into product_packs (product_id, name, qty_base, is_count_default, is_purchase_default, barcode) values
  ('a5000000-0000-4000-8000-000000000001', 'Botella 70 cl', 700, true, false, null),
  ('a5000000-0000-4000-8000-000000000001', 'Caja 6', 4200, false, true, '8400000000099');
insert into stock_movements (org_id, location_id, product_id, area_id, type, qty, unit_cost)
select 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', a.id, 'opening', 4200, 0.02
from storage_areas a where a.location_id = 'a3000000-0000-4000-8000-000000000001' and a.name = 'Almacén';

create temp table ids (k text primary key, v uuid);
insert into ids select 'almacen', id from storage_areas where location_id = 'a3000000-0000-4000-8000-000000000001' and name = 'Almacén';
insert into ids select 'barra', id from storage_areas where location_id = 'a3000000-0000-4000-8000-000000000001' and name = 'Barra';
insert into ids select 'terraza_almacen', id from storage_areas where location_id = 'a3000000-0000-4000-8000-000000000002' and name = 'Almacén';
insert into ids select 'terraza_barra', id from storage_areas where location_id = 'a3000000-0000-4000-8000-000000000002' and name = 'Barra';
grant select on ids to authenticated;

set local role authenticated;

-- La pantalla: no ve nada por las tablas; solo lo que le dan las funciones del almacén.
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::int from products) + (select count(*)::int from stock_balances) + (select count(*)::int from locations) + (select count(*)::int from supplier_prices),
  0,
  'a screen reads nothing directly: no products, stock, locations or prices'
);
select ok(not can_access_location('a3000000-0000-4000-8000-000000000001'), 'a screen cannot use the normal operations (waste, receipts, counts)');
select is((warehouse_context() ->> 'location_id'), 'a3000000-0000-4000-8000-000000000001', 'a screen works on its own location');
select is(jsonb_array_length(warehouse_context() -> 'areas'), 2, 'it sees the warehouse and the bar');
select is((warehouse_catalog('a3000000-0000-4000-8000-000000000001', 'ron') -> 0 ->> 'stock'), '4200.0000', 'the catalogue shows what is in the warehouse');
select ok(not (warehouse_catalog('a3000000-0000-4000-8000-000000000001', 'ron') -> 0 -> 'packs' -> 0 ? 'price'), 'the screen never sees prices');
select is((warehouse_catalog('a3000000-0000-4000-8000-000000000001', '8400000000099') -> 0 ->> 'name'), 'Ron almacén', 'a scanned box finds its product');

-- Apuntar: una caja al bar. Repetir el envío (sin cobertura) no duplica.
select is(
  area_move_submit('a3000000-0000-4000-8000-000000000001', (select v from ids where k = 'almacen'), (select v from ids where k = 'barra'),
                   'a5000000-0000-4000-8000-000000000001', 4200, '{"boxes":"1"}', 'salida', 'a6000000-0000-4000-8000-000000000001'),
  area_move_submit('a3000000-0000-4000-8000-000000000001', (select v from ids where k = 'almacen'), (select v from ids where k = 'barra'),
                   'a5000000-0000-4000-8000-000000000001', 4200, '{"boxes":"1"}', 'salida', 'a6000000-0000-4000-8000-000000000001'),
  'sending the same exit twice records it once'
);
select is(jsonb_array_length(area_moves_list('a3000000-0000-4000-8000-000000000001')), 1, 'it waits in the queue');
reset role;
insert into ids select 'm1', id from area_moves where client_ref = 'a6000000-0000-4000-8000-000000000001';
select is((select qty::text from stock_area_balances where area_id = (select v from ids where k = 'almacen')), '4200.0000', 'a pending exit does not move stock');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$select area_move_submit('a3000000-0000-4000-8000-000000000001', (select v from ids where k = 'barra'), (select v from ids where k = 'almacen'), 'a5000000-0000-4000-8000-000000000001', 700)$$,
  '22023', 'invalid_area', 'an exit goes from a warehouse to a service area'
);
select throws_ok(
  $$select area_move_submit('a3000000-0000-4000-8000-000000000002', (select v from ids where k = 'terraza_almacen'), (select v from ids where k = 'terraza_barra'), 'a5000000-0000-4000-8000-000000000001', 700)$$,
  '42501', 'forbidden', 'a screen cannot log exits for another location'
);
select is(jsonb_array_length(kiosk_validators()), 0, 'nobody can validate on the screen until they set a PIN');
select throws_ok($$select set_validation_pin('482915')$$, '42501', 'forbidden', 'a screen has no PIN');

-- PIN: el encargado, el personal autorizado y el que no lo está.
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select set_validation_pin('111111')$$, '22023', 'pin_weak', 'an obvious PIN is refused');
select throws_ok($$select set_validation_pin('12a456')$$, '22023', 'pin_format', 'a PIN is six digits');
select set_validation_pin('482915');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_validation_pin('730264');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_validation_pin('905183');
reset role;
select ok((select pin_hash not like '%482915%' from validator_pins where user_id = 'a1000000-0000-4000-8000-000000000001'), 'only the PIN hash is stored');
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select string_agg(v ->> 'user_id', ',' order by v ->> 'user_id') from jsonb_array_elements(kiosk_validators()) v),
  'a1000000-0000-4000-8000-000000000001,a1000000-0000-4000-8000-000000000003',
  'the screen offers the manager and the authorised staff, not other staff'
);

-- Validar en la pantalla con PIN: un fallo cuenta y no mueve nada; el correcto valida.
select is(
  area_moves_decide((select jsonb_build_array(jsonb_build_object('id', v, 'action', 'validate')) from ids where k = 'm1'),
                    'a1000000-0000-4000-8000-000000000001', '000000') ->> 'error',
  'pin',
  'a wrong PIN is refused'
);
select throws_ok(
  $$select area_moves_decide((select jsonb_build_array(jsonb_build_object('id', v, 'action', 'validate')) from ids where k = 'm1'),
                             'a1000000-0000-4000-8000-000000000002', '905183')$$,
  '42501', 'forbidden', 'staff without permission cannot validate even with their PIN'
);
select is(
  (area_moves_decide((select jsonb_build_array(jsonb_build_object('id', v, 'action', 'validate')) from ids where k = 'm1'),
                     'a1000000-0000-4000-8000-000000000001', '482915') ->> 'validated')::int,
  1,
  'the right PIN validates the exit'
);
reset role;
select is(
  (select string_agg(a.name || '=' || b.qty::text, ',' order by a.name) from stock_area_balances b join storage_areas a on a.id = b.area_id
   where a.location_id = 'a3000000-0000-4000-8000-000000000001'),
  'Almacén=0.0000,Barra=4200.0000',
  'validated: the box moves from the warehouse to the bar'
);
select is((select qty::text from stock_balances where location_id = 'a3000000-0000-4000-8000-000000000001'), '4200.0000', 'the location total does not change: it is not consumption');
select is((select count(*)::int from stock_movements where type = 'internal_move' and ref_table = 'area_moves' and created_by = 'a1000000-0000-4000-8000-000000000001'), 2, 'two internal movements, signed by whoever validated');

-- Cinco PIN mal seguidos bloquean 15 minutos, aunque luego llegue el bueno.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select area_move_submit('a3000000-0000-4000-8000-000000000001', (select v from ids where k = 'barra'), (select v from ids where k = 'almacen'),
                        'a5000000-0000-4000-8000-000000000001', 700, '{"loose":"1"}', 'devolucion', 'a6000000-0000-4000-8000-000000000002');
reset role;
insert into ids select 'm2', id from area_moves where client_ref = 'a6000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select area_moves_decide('[]', 'a1000000-0000-4000-8000-000000000003', '111112') from generate_series(1, 5);
select is(
  area_moves_decide((select jsonb_build_array(jsonb_build_object('id', v, 'action', 'validate')) from ids where k = 'm2'),
                    'a1000000-0000-4000-8000-000000000003', '730264') ->> 'error',
  'locked',
  'five wrong PINs lock that person for 15 minutes'
);

-- En su móvil (su sesión, sin PIN): el personal autorizado corrige y valida; el que no, no puede.
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select area_moves_decide((select jsonb_build_array(jsonb_build_object('id', v, 'action', 'validate')) from ids where k = 'm2'))$$,
  '42501', 'forbidden', 'staff without permission cannot validate from their phone'
);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (area_moves_decide((select jsonb_build_array(jsonb_build_object('id', v, 'action', 'validate', 'qty', 1400)) from ids where k = 'm2')) ->> 'validated')::int,
  1,
  'authorised staff validate a return from their phone, correcting the quantity'
);
reset role;
select is(
  (select original ->> 'qty' || ' → ' || qty::text from area_moves where client_ref = 'a6000000-0000-4000-8000-000000000002'),
  '700.0000 → 1400.0000',
  'a correction keeps what was logged originally'
);

-- Rechazar no mueve nada; deshacer solo lo propio y durante 2 minutos.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select area_move_submit('a3000000-0000-4000-8000-000000000001', (select v from ids where k = 'almacen'), (select v from ids where k = 'barra'),
                        'a5000000-0000-4000-8000-000000000001', 700, null, 'salida', 'a6000000-0000-4000-8000-000000000003');
reset role;
insert into ids select 'm3', id from area_moves where client_ref = 'a6000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select area_move_cancel((select v from ids where k = 'm3'))$$,
  '42501', 'cannot_cancel', 'only whoever logged it can undo it'
);
select is(
  (area_moves_decide((select jsonb_build_array(jsonb_build_object('id', v, 'action', 'reject', 'note', 'no salió')) from ids where k = 'm3')) ->> 'rejected')::int,
  1,
  'a manager rejects an exit that did not happen'
);
reset role;
select is((select count(*)::int from stock_movements where ref_id = (select id from area_moves where client_ref = 'a6000000-0000-4000-8000-000000000003')), 0, 'a rejected exit moves nothing');

-- Equipo: solo una cuenta creada como pantalla puede ser pantalla; el encargado marca «puede validar».
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('a1000000-0000-4000-8000-000000000005', 'pantalla-x@pantallas.logisticapp.invalid', now(), '{"kiosk": true}'),
  ('a1000000-0000-4000-8000-000000000006', 'someone@example.com', now(), '{}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select team_set_member('a1000000-0000-4000-8000-000000000006', 'kiosk', false, array['a3000000-0000-4000-8000-000000000001']::uuid[], 'Pantalla')$$,
  '22023', 'kiosk_fixed', 'a person''s account cannot be turned into a screen'
);
select lives_ok(
  $$select team_set_member('a1000000-0000-4000-8000-000000000005', 'kiosk', false, array['a3000000-0000-4000-8000-000000000001']::uuid[], 'Pantalla · Bar')$$,
  'a manager adds a screen to their location'
);
select throws_ok(
  $$select team_set_member('a1000000-0000-4000-8000-000000000005', 'staff', false, array['a3000000-0000-4000-8000-000000000001']::uuid[])$$,
  '22023', 'kiosk_fixed', 'a screen cannot become a person'
);
select lives_ok(
  $$select team_set_member('a1000000-0000-4000-8000-000000000002', 'staff', false, array['a3000000-0000-4000-8000-000000000001']::uuid[], null, null, true)$$,
  'a manager lets a staff member validate'
);
reset role;
select is(
  (select can_validate from memberships where user_id = 'a1000000-0000-4000-8000-000000000002'),
  true,
  '«puede validar» is saved for staff'
);

select * from finish();
rollback;
