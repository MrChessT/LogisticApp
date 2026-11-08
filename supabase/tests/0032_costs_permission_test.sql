begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('fc000000-0000-4000-8000-000000000001', 'costes-encargado@example.com', now()),
  ('fc000000-0000-4000-8000-000000000002', 'costes-camarero@example.com', now());
insert into organizations (id, name) values ('fc100000-0000-4000-8000-000000000001', 'Org costes');
insert into locations (id, org_id, name) values ('fc200000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Barra costes');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'manager', false),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'staff', false);
insert into membership_locations (org_id, user_id, location_id) values
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'fc200000-0000-4000-8000-000000000001');
insert into suppliers (id, org_id, name) values ('fc300000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Proveedor costes');
insert into products (id, org_id, name, dimension) values ('fc400000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Ron costes', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values ('fc500000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001', 'Caja 6', 4200, true);
insert into supplier_prices (supplier_id, pack_id, last_price) values ('fc300000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 84);

set local role authenticated;

-- El camarero no ve precios de compra.
select set_config('request.jwt.claims', '{"sub":"fc000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(sees_costs('fc100000-0000-4000-8000-000000000001'), false, 'staff does not see costs by default');
select is((select count(*)::int from supplier_prices), 0, 'staff cannot read purchase prices');
select is((select count(*)::int from price_history), 0, 'nor their history');
select throws_ok($$select team_set_costs('fc000000-0000-4000-8000-000000000002', true)$$, '42501', 'forbidden', 'staff cannot give themselves the permission');

-- El encargado sí, y se lo puede dar.
select set_config('request.jwt.claims', '{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from supplier_prices), 1, 'a manager reads purchase prices');
select lives_ok($$select team_set_costs('fc000000-0000-4000-8000-000000000002', true)$$, 'a manager can give staff the permission');
select is((select can_see_costs from team_members() where user_id = 'fc000000-0000-4000-8000-000000000002'), true, 'the team list shows it');

select set_config('request.jwt.claims', '{"sub":"fc000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from supplier_prices), 1, 'with the permission, staff reads purchase prices');

reset role;
select * from finish();
rollback;
