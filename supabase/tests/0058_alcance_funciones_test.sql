begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at) values
  ('fe000000-0000-4000-8000-000000000001', 'funciones-gerente@example.com', now()),
  ('fe000000-0000-4000-8000-000000000002', 'funciones-cocinero@example.com', now()),
  ('fe000000-0000-4000-8000-000000000003', 'funciones-barra@example.com', now());
insert into organizations (id, name) values ('fe100000-0000-4000-8000-000000000001', 'Org funciones');
insert into locations (id, org_id, name) values ('fe500000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'Local funciones');
insert into memberships (org_id, user_id, role, all_locations, can_see_costs) values
  ('fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'manager', true, true),
  ('fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002', 'staff', true, true),
  ('fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000003', 'manager', true, true);
insert into categories (id, org_id, parent_id, name, sort_order) values
  ('fe200000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', null, 'Bebida', 1),
  ('fe200000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', null, 'Comida', 2);
insert into products (id, org_id, category_id, name, dimension) values
  ('fe300000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000001', 'Tinto funciones', 'volume'),
  ('fe300000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000002', 'Solomillo funciones', 'mass');
insert into location_products (location_id, product_id) values
  ('fe500000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000001'),
  ('fe500000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000002');
insert into recipes (id, org_id, name, kind) values
  ('fe400000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'Solomillo al vino', 'plato'),
  ('fe400000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'Sangría', 'plato'),
  ('fe400000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'Plato nuevo', 'plato'),
  ('fe400000-0000-4000-8000-000000000004', 'fe100000-0000-4000-8000-000000000001', 'Salsa de carne', 'elaboracion'),
  ('fe400000-0000-4000-8000-000000000005', 'fe100000-0000-4000-8000-000000000001', 'Plato con salsa', 'plato');
insert into recipe_lines (recipe_id, product_id, sub_recipe_id, qty) values
  ('fe400000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000002', null, 200),
  ('fe400000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000001', null, 50),
  ('fe400000-0000-4000-8000-000000000002', 'fe300000-0000-4000-8000-000000000001', null, 150),
  ('fe400000-0000-4000-8000-000000000004', 'fe300000-0000-4000-8000-000000000002', null, 100),
  ('fe400000-0000-4000-8000-000000000005', null, 'fe400000-0000-4000-8000-000000000004', 1);
insert into sales_items (id, org_id, code, name, recipe_id) values
  ('fe600000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'S1', 'SANGRIA', 'fe400000-0000-4000-8000-000000000002'),
  ('fe600000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'S2', 'SOLOMILLO', 'fe400000-0000-4000-8000-000000000001'),
  ('fe600000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', 'S3', 'SIN ENLAZAR', null);
insert into sales_days (id, org_id, location_id, sale_date) values
  ('fe700000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000001', current_date);
insert into sales_lines (day_id, item_id, qty, amount) values
  ('fe700000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000001', 3, 18),
  ('fe700000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000002', 2, 50),
  ('fe700000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000003', 1, 5);
-- Cocinero: Comida. Encargado de barra: Bebida.
insert into membership_accounts (org_id, user_id, account_id) values
  ('fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002', 'fe200000-0000-4000-8000-000000000002'),
  ('fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000003', 'fe200000-0000-4000-8000-000000000001');

set local role authenticated;

-- Gerente sin cuentas: todo, como antes.
select set_config('request.jwt.claims', '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from recipes where org_id = 'fe100000-0000-4000-8000-000000000001'), 5, 'Sin cuentas, todas las recetas');
select is((select count(*)::int from sales_report('fe100000-0000-4000-8000-000000000001', current_date, current_date)), 3, 'Sin cuentas, todas las ventas');

-- Cocinero (Comida): platos con algún ingrediente de Comida, también a través de una elaboración, y los aún vacíos.
select set_config('request.jwt.claims', '{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select array_agg(name order by name) from recipes where org_id = 'fe100000-0000-4000-8000-000000000001'),
  array['Plato con salsa', 'Plato nuevo', 'Salsa de carne', 'Solomillo al vino'], 'El cocinero ve sus platos, no la sangría');
select is((select count(*)::int from recipe_costs('fe100000-0000-4000-8000-000000000001')), 4, 'Y sus costes, solo de esos');
select is((select count(*)::int from recipe_lines where recipe_id = 'fe400000-0000-4000-8000-000000000002'), 0, 'Las líneas de la sangría no se ven');
select is((select jsonb_agg(x ->> 'name') from jsonb_array_elements(warehouse_catalog('fe500000-0000-4000-8000-000000000001')) x),
  '["Solomillo funciones"]'::jsonb, 'El catálogo del almacén solo ofrece Comida');

-- Encargado de barra (Bebida): sus cócteles y sus ventas; lo sin enlazar no se sabe de quién es.
select set_config('request.jwt.claims', '{"sub":"fe000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select array_agg(name order by name) from recipes where org_id = 'fe100000-0000-4000-8000-000000000001'),
  array['Plato nuevo', 'Sangría', 'Solomillo al vino'], 'Barra ve lo que lleva bebida');
select is((select array_agg(name order by name) from sales_report('fe100000-0000-4000-8000-000000000001', current_date, current_date)),
  array['SANGRIA', 'SOLOMILLO'], 'Ventas de sus recetas, sin lo sin enlazar');
select is((select count(*)::int from tpv_sale_prices('fe100000-0000-4000-8000-000000000001')), 2, 'PVP del TPV, solo de sus platos');
select is((select count(*)::int from (select 1 from recipes where id = 'fe400000-0000-4000-8000-000000000004') x), 0, 'La elaboración solo de Comida no la ve');

select * from finish();
rollback;
