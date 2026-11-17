begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('fb000000-0000-4000-8000-000000000001', 'alcance-encargada@example.com', now()),
  ('fb000000-0000-4000-8000-000000000002', 'alcance-cocinero@example.com', now());
insert into organizations (id, name) values ('fb100000-0000-4000-8000-000000000001', 'Org alcance');
insert into memberships (org_id, user_id, role, all_locations, can_see_costs) values
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'manager', true, true),
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'staff', true, true);
insert into categories (id, org_id, parent_id, name, sort_order) values
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', null, 'Bebida', 1),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'Vinos Tintos', 1),
  ('fb200000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001', null, 'Comida', 2),
  ('fb200000-0000-4000-8000-000000000004', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000003', 'Carnes', 1);
insert into products (id, org_id, category_id, name, dimension) values
  ('fb300000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000002', 'Tinto alcance', 'count'),
  ('fb300000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000004', 'Solomillo alcance', 'mass');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values
  ('fb400000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'Botella alcance', 1, true),
  ('fb400000-0000-4000-8000-000000000002', 'fb300000-0000-4000-8000-000000000002', 'Kilo alcance', 1000, true);
-- El cocinero solo tiene Comida.
insert into membership_accounts (org_id, user_id, account_id) values
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'fb200000-0000-4000-8000-000000000003');

set local role authenticated;

-- Encargada sin cuentas asignadas: lo ve todo, como antes.
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from products where org_id = 'fb100000-0000-4000-8000-000000000001'), 2, 'Sin cuentas asignadas, todos los productos');
select is((select count(*)::int from categories where org_id = 'fb100000-0000-4000-8000-000000000001'), 4, 'Sin cuentas asignadas, todas las familias');

-- Cocinero con Comida: solo Comida.
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select array_agg(name order by name) from products where org_id = 'fb100000-0000-4000-8000-000000000001'), array['Solomillo alcance'], 'El cocinero solo ve productos de Comida');
select is((select array_agg(name order by name) from categories where org_id = 'fb100000-0000-4000-8000-000000000001'), array['Carnes', 'Comida'], 'Y solo la cuenta Comida y sus familias');
select is((select array_agg(name order by name) from product_packs), array['Kilo alcance'], 'Los formatos de Bebida no aparecen');
select is((select count(*)::int from stock_movements where org_id = 'fb100000-0000-4000-8000-000000000001' and product_id = 'fb300000-0000-4000-8000-000000000001'), 0, 'Ni sus movimientos');
select throws_ok(
  $$ insert into products (org_id, category_id, name, dimension) values ('fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000002', 'Vino colado', 'count') $$,
  '42501', null, 'No puede dar de alta un producto en Bebida');
select ok(account_scope_off() = false, 'La restricción está activa para el cocinero');

select * from finish();
rollback;
