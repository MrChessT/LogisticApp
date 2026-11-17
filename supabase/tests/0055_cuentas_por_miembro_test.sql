begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, email_confirmed_at) values
  ('fa000000-0000-4000-8000-000000000001', 'cuentas-sin-restriccion@example.com', now()),
  ('fa000000-0000-4000-8000-000000000002', 'cuentas-encargado@example.com', now());
insert into organizations (id, name) values ('fa100000-0000-4000-8000-000000000001', 'Org cuentas');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'staff', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'manager', true);
insert into categories (id, org_id, parent_id, name, sort_order) values
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', null, 'Bebida', 1),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'Vinos Tintos', 1),
  ('fa200000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', null, 'Comida', 2),
  ('fa200000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000003', 'Carnes', 1);
insert into products (id, org_id, category_id, name, dimension) values
  ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000002', 'Tinto cuentas', 'count');

select is(account_of('fa200000-0000-4000-8000-000000000002'), 'fa200000-0000-4000-8000-000000000001'::uuid, 'La cuenta de una familia es su raíz');
select is(account_of('fa200000-0000-4000-8000-000000000001'), 'fa200000-0000-4000-8000-000000000001'::uuid, 'Una raíz es su propia cuenta');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(account_allowed('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000002'), 'Sin filas, no hay restricción por cuenta');

-- El encargado solo tiene Comida: no ve Bebida.
reset role;
insert into membership_accounts (org_id, user_id, account_id) values
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select ok(not account_allowed('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000002'), 'Con cuentas asignadas, no ve Bebida');
select ok(account_allowed('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000004'), 'Sí ve Comida › Carnes');
select is((select count(*)::int from products where org_id = 'fa100000-0000-4000-8000-000000000001'), 1, 'Las políticas de productos no cambian: la lectura sigue igual');

select * from finish();
rollback;
