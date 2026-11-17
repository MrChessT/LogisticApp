begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at) values
  ('fd000000-0000-4000-8000-000000000001', 'cuentas-propietaria@example.com', now()),
  ('fd000000-0000-4000-8000-000000000002', 'cuentas-encargado@example.com', now()),
  ('fd000000-0000-4000-8000-000000000003', 'cuentas-cocinero@example.com', now()),
  ('fd000000-0000-4000-8000-000000000004', 'cuentas-admin@example.com', now());
insert into organizations (id, name) values ('fd100000-0000-4000-8000-000000000001', 'Org cuentas');
insert into locations (id, org_id, name) values ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Cocina cuentas');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'owner', true),
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002', 'manager', false),
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000003', 'staff', false),
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000004', 'admin', true);
insert into membership_locations (org_id, user_id, location_id) values
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002', 'fd200000-0000-4000-8000-000000000001'),
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000003', 'fd200000-0000-4000-8000-000000000001');
insert into categories (id, org_id, parent_id, name, sort_order) values
  ('fd300000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', null, 'Bebida', 1),
  ('fd300000-0000-4000-8000-000000000002', 'fd100000-0000-4000-8000-000000000001', null, 'Comida', 2),
  ('fd300000-0000-4000-8000-000000000003', 'fd100000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000002', 'Carnes', 1);

set local role authenticated;

-- La propietaria reparte cuentas.
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000003', array['fd300000-0000-4000-8000-000000000002']::uuid[])$$, 'La propietaria da Comida al cocinero');
select is((select array_agg(account_id) from membership_accounts where user_id = 'fd000000-0000-4000-8000-000000000003'), array['fd300000-0000-4000-8000-000000000002']::uuid[], 'El cocinero queda solo con Comida');
select lives_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000003', '{}')$$, 'Lista vacía: sin restricción');
select is((select count(*)::int from membership_accounts where user_id = 'fd000000-0000-4000-8000-000000000003'), 0, 'Ya no tiene filas');
select throws_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000003', array['fd300000-0000-4000-8000-000000000003']::uuid[])$$, '22023', 'accounts_invalid', 'Una familia no es una cuenta');
select throws_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000004', array['fd300000-0000-4000-8000-000000000002']::uuid[])$$, '22023', 'accounts_admin', 'A la administración no se le limita');
select lives_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000002', array['fd300000-0000-4000-8000-000000000002']::uuid[])$$, 'El encargado queda con Comida');

-- El encargado de Comida solo reparte Comida, y no deja a nadie sin restricción.
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000003', array['fd300000-0000-4000-8000-000000000001']::uuid[])$$, '42501', 'accounts_forbidden', 'No puede dar Bebida');
select throws_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000003', '{}')$$, '42501', 'accounts_forbidden', 'Ni quitar la restricción');

-- El personal no reparte.
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select team_set_accounts('fd000000-0000-4000-8000-000000000003', '{}')$$, '42501', 'forbidden', 'El personal no se cambia las cuentas');

select * from finish();
rollback;
