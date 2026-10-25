begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('f6000000-0000-4000-8000-000000000001', 'salidas-staff@example.com', now());
insert into organizations (id, name) values ('f6100000-0000-4000-8000-000000000001', 'Org salidas');
insert into locations (id, org_id, name) values
  ('f6200000-0000-4000-8000-000000000001', 'f6100000-0000-4000-8000-000000000001', 'Bar salidas');
insert into memberships (org_id, user_id, role, all_locations) values
  ('f6100000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', 'staff', true);
insert into products (id, org_id, name, dimension) values
  ('f6300000-0000-4000-8000-000000000001', 'f6100000-0000-4000-8000-000000000001', 'Ginebra salidas', 'volume');

-- Una merma insertada sin tipo (cargas, funciones antiguas) es una pérdida.
insert into stock_movements (org_id, location_id, product_id, type, qty)
values ('f6100000-0000-4000-8000-000000000001', 'f6200000-0000-4000-8000-000000000001', 'f6300000-0000-4000-8000-000000000001', 'waste', -50);
select is(
  (select exit_kind::text from stock_movements where product_id = 'f6300000-0000-4000-8000-000000000001' and type = 'waste'),
  'merma',
  'a waste row without a kind is a loss'
);

select throws_ok(
  $$insert into stock_movements (org_id, location_id, product_id, type, qty, exit_kind)
    values ('f6100000-0000-4000-8000-000000000001', 'f6200000-0000-4000-8000-000000000001', 'f6300000-0000-4000-8000-000000000001', 'opening', 700, 'invitacion')$$,
  '23514',
  null,
  'only waste carries an exit kind'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$select register_movement('f6200000-0000-4000-8000-000000000001', 'f6300000-0000-4000-8000-000000000001', 'waste', 100, 'mesa 4', null, null, 'f6400000-0000-4000-8000-000000000001', 'invitacion')$$,
  'staff registers an invitation'
);
select is(
  (select exit_kind::text || ':' || qty::text || ':' || reason from stock_movements where client_ref = 'f6400000-0000-4000-8000-000000000001'),
  'invitacion:-100.0000:mesa 4',
  'the invitation keeps its kind, negative quantity and reason'
);

select lives_ok(
  $$select register_movement('f6200000-0000-4000-8000-000000000001', 'f6300000-0000-4000-8000-000000000001', 'waste', 30, '  ', null, null, 'f6400000-0000-4000-8000-000000000002')$$,
  'waste without a kind still works'
);
select is(
  (select exit_kind::text || ':' || coalesce(reason, 'sin motivo') from stock_movements where client_ref = 'f6400000-0000-4000-8000-000000000002'),
  'merma:sin motivo',
  'defaults to a loss and drops a blank reason'
);

select throws_ok(
  $$select register_movement('f6200000-0000-4000-8000-000000000001', 'f6300000-0000-4000-8000-000000000001', 'consumption', 30, null, null, null, null, 'evento')$$,
  '22023',
  'exit_kind_only_for_waste',
  'an exit kind on another movement type is rejected'
);

-- Repetir el envío no duplica.
select register_movement('f6200000-0000-4000-8000-000000000001', 'f6300000-0000-4000-8000-000000000001', 'waste', 100, 'mesa 4', null, null, 'f6400000-0000-4000-8000-000000000001', 'invitacion');
select is(
  (select count(*)::int from stock_movements where client_ref = 'f6400000-0000-4000-8000-000000000001'),
  1,
  'a repeated submission is idempotent'
);

reset role;

select * from finish();
rollback;
