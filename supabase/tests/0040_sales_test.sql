begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, email_confirmed_at) values
  ('fa000000-0000-4000-8000-000000000001', 'ventas-encargada@example.com', now()),
  ('fa000000-0000-4000-8000-000000000002', 'ventas-camarero@example.com', now());
insert into organizations (id, name) values ('fa100000-0000-4000-8000-000000000001', 'Org ventas');
insert into locations (id, org_id, name) values ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Restaurante ventas');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'manager', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'staff', true);
insert into suppliers (id, org_id, name) values ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Proveedor ventas');
insert into products (id, org_id, name, dimension) values
  ('fa400000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Arroz bomba ventas', 'mass'),
  ('fa400000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'Vino ventas', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default, is_count_default) values
  ('fa500000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'Kilo', 1000, true, true),
  ('fa500000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000002', 'Botella', 750, true, true);
insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at) values
  ('fa300000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000001', 4.00, now()),
  ('fa300000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000002', 9.00, now());
-- Arroz para 4 raciones: 400 g a 4 €/kg = 1,60 € → 0,40 € la ración.
insert into recipes (id, org_id, name, kind, yield_qty, yield_unit) values
  ('fa600000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Arroz de la casa', 'plato', 4, 'racion');
insert into recipe_lines (recipe_id, product_id, qty) values
  ('fa600000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 400);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

create temp table lines as select '[
  {"code":"41","name":"ARROZ DE LA CASA","qty":3,"unit":"Pax","amount":45},
  {"code":"91","name":"Vino ventas","qty":2,"unit":"Pax","amount":40},
  {"code":"8","name":"AGUA","qty":5,"unit":"Pax","amount":10}
]'::jsonb j;

-- Vista previa: calcula pero no guarda.
select is(
  (select (import_sales('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', '2026-10-30', j, 'tpv', 'bdp.xlsx', false))->>'total' from lines),
  '95.00', 'the preview totals the day');
select is((select count(*)::int from sales_days), 0, 'and saves nothing');

create temp table res as
select import_sales('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', '2026-10-30', j, 'tpv', 'bdp.xlsx', true) r from lines;
select is((select (r->>'linked_recipes')::int from res), 1, 'a dish is linked to its recipe by name, ignoring case');
select is((select (r->>'linked_products')::int from res), 1, 'a product is linked by name');
select is((select r->'unlinked'->0->>'name' from res), 'AGUA', 'what does not match is listed');
-- 3 raciones a 0,40 € + 2 botellas a 9 € = 19,20 €.
select is((select r->>'theoretical_cost' from res), '19.20', 'the theoretical cost uses the recipe portion and the bottle');
select is((select qty_per_sale::text from sales_items where code = '91'), '750.0000', 'a product sells by its count unit (a bottle)');

-- Una copa: 150 ml de la botella.
select lives_ok($$select link_sales_item((select id from sales_items where code = '91'), null, 'fa400000-0000-4000-8000-000000000002', 150)$$, 'an item can be relinked as a glass');
select lives_ok($$select link_sales_item((select id from sales_items where code = '8'), null, null, null, true)$$, 'and another ignored');
select is(
  (select cost::text from sales_report('fa100000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31') where code = '91'),
  '3.60', 'two glasses of 150 ml at 9 € the bottle cost 3,60 €');
select is(
  (select food_cost_pct::text from sales_report('fa100000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31') where code = '41'),
  '2.7', 'the report gives the food cost of each item');

-- Reimportar el mismo día lo sustituye.
select lives_ok($$select import_sales('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', '2026-10-30', '[{"code":"41","name":"Arroz de la casa","qty":1,"unit":"Pax","amount":15}]', 'tpv', null, true)$$, 'the same day can be imported again');
select is((select count(*)::int from sales_lines), 1, 'and replaces the previous lines');

-- Sin «ve costes», nada.
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select sales_report('fa100000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31')$$,
  '42501', null, 'staff without the cost permission cannot see sales');

select * from finish();
rollback;
