begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('f7000000-0000-4000-8000-000000000001', 'cond-manager@example.com', now()),
  ('f7000000-0000-4000-8000-000000000002', 'cond-staff@example.com', now());
insert into organizations (id, name) values
  ('f7100000-0000-4000-8000-000000000001', 'Org condiciones'),
  ('f7100000-0000-4000-8000-000000000002', 'Otra org');
insert into locations (id, org_id, name) values
  ('f7200000-0000-4000-8000-000000000001', 'f7100000-0000-4000-8000-000000000001', 'Bar condiciones'),
  ('f7200000-0000-4000-8000-000000000002', 'f7100000-0000-4000-8000-000000000002', 'Bar ajeno');
insert into memberships (org_id, user_id, role, all_locations) values
  ('f7100000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'manager', true),
  ('f7100000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000002', 'staff', true);
insert into suppliers (id, org_id, name) values
  ('f7300000-0000-4000-8000-000000000001', 'f7100000-0000-4000-8000-000000000001', 'Distribuciones condiciones');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$update suppliers set code = 'PRV-012', order_days = '{1,4}', order_cutoff = '14:00', lead_time_hours = 48,
      min_order = 150, payment_terms = '30 días, transferencia', location_ids = '{f7200000-0000-4000-8000-000000000001}'
    where id = 'f7300000-0000-4000-8000-000000000001'$$,
  'a manager sets the ordering terms'
);
select is(
  (select array_to_string(order_days, ',') || ' ' || order_cutoff::text || ' ' || lead_time_hours || ' ' || min_order from suppliers where id = 'f7300000-0000-4000-8000-000000000001'),
  '1,4 14:00:00 48 150.00',
  'the terms are stored'
);

select throws_ok(
  $$update suppliers set order_days = '{0,8}' where id = 'f7300000-0000-4000-8000-000000000001'$$,
  '23514', null, 'order days are ISO weekdays'
);
select throws_ok(
  $$update suppliers set min_order = -1 where id = 'f7300000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the minimum order cannot be negative'
);
select throws_ok(
  $$update suppliers set location_ids = '{f7200000-0000-4000-8000-000000000002}' where id = 'f7300000-0000-4000-8000-000000000001'$$,
  '22023', 'invalid_location', 'a supplier cannot serve another organization''s venue'
);
select lives_ok(
  $$update suppliers set location_ids = '{}', order_days = '{}' where id = 'f7300000-0000-4000-8000-000000000001'$$,
  'empty lists are allowed'
);
select is(
  (select coalesce(location_ids::text, 'todos') || ' ' || coalesce(order_days::text, 'cualquier día') from suppliers where id = 'f7300000-0000-4000-8000-000000000001'),
  'todos cualquier día',
  'empty lists mean all venues and any day'
);

-- Personal: no cambia condiciones (RLS de proveedores: encargado o superior).
select set_config('request.jwt.claims', '{"sub":"f7000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
update suppliers set min_order = 1 where id = 'f7300000-0000-4000-8000-000000000001';
reset role;
select is(
  (select min_order from suppliers where id = 'f7300000-0000-4000-8000-000000000001'),
  150.00::numeric(12, 2),
  'staff cannot change the terms'
);

select * from finish();
rollback;
