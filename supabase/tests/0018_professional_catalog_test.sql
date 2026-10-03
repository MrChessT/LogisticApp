begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, email_confirmed_at) values ('c1000000-0000-4000-8000-000000000001', 'catalogo-test@example.com', now());
insert into organizations (id, name) values ('c2000000-0000-4000-8000-000000000001', 'Org test catálogo');
insert into locations (id, org_id, name) values ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Barra');
insert into memberships (org_id, user_id, role, all_locations) values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'manager', true);
insert into suppliers (id, org_id, name) values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Proveedor A'),
  ('c4000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'Proveedor B');
insert into products (id, org_id, name, dimension, vat_rate) values
  ('c5000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Tónica test', 'count', 21),
  ('c5000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'Ginebra test', 'volume', 21),
  ('c5000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'y', 'count', 21);
insert into product_packs (id, product_id, name, qty_base, is_count_default, is_purchase_default) values
  ('c6000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'Caja 24', 24, false, true),
  ('c6000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000002', 'Botella 70 cl', 700, true, false),
  ('c6000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000002', 'Caja 6', 4200, false, true);
insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at) values
  ('c4000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 12, now()),
  ('c4000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000001', 48, now() - interval '1 day'),
  ('c4000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000003', 72, now());
-- Stock de ginebra valorado al precio de una CAJA por botella (error típico de albarán).
insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost)
values ('c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 'opening', 2100, 72.0 / 700);

-- Costes comparables: por caja, por unidad que se cuenta y con IVA.
select is(
  (select unit_price::text from v_product_costs where pack_id = 'c6000000-0000-4000-8000-000000000003'),
  '12.0000', 'a box of 6 bottles at 72 € costs 12 € per bottle');
select is(
  (select units_per_pack::text from v_product_costs where pack_id = 'c6000000-0000-4000-8000-000000000003'),
  '6.0000', 'a box of 6 × 70 cl holds 6 bottles');
select is(
  (select unit_price::text from v_product_costs where pack_id = 'c6000000-0000-4000-8000-000000000001' and supplier_id = 'c4000000-0000-4000-8000-000000000001'),
  '0.5000', 'a box of 24 at 12 € costs 0.50 € per unit');
select is(
  (select pack_price_with_vat::text from v_product_costs where pack_id = 'c6000000-0000-4000-8000-000000000001' and supplier_id = 'c4000000-0000-4000-8000-000000000001'),
  '14.52', 'the box price with 21 % VAT');

-- Salud del catálogo.
select ok(exists (select 1 from catalog_health() where product_id = 'c5000000-0000-4000-8000-000000000003' and issue = 'nombre_invalido'), 'a one-letter product is flagged');
select ok(exists (select 1 from catalog_health() where product_id = 'c5000000-0000-4000-8000-000000000003' and issue = 'sin_formatos'), 'a product without packs is flagged');
select ok(exists (select 1 from catalog_health() where product_id = 'c5000000-0000-4000-8000-000000000001' and issue = 'precio_dispar'), 'suppliers charging 0.50 € and 2 € per unit are flagged');
select ok(exists (select 1 from catalog_health() where product_id = 'c5000000-0000-4000-8000-000000000002' and issue = 'coste_dispar'), 'stock valued at the price of a box per bottle is flagged');
select ok(not exists (select 1 from catalog_health() where product_id = 'c5000000-0000-4000-8000-000000000002' and issue = 'sin_precio'), 'a product with a price is not flagged as unpriced');

-- Reglas de formatos, desde la app.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$insert into product_packs (product_id, name, qty_base) values ('c5000000-0000-4000-8000-000000000001', 'Caja rara', 24.5)$$,
  'pack_units_not_integer', 'a pack of a counted product holds a whole number of units');
select throws_ok(
  $$update product_packs set qty_base = 12 where id = 'c6000000-0000-4000-8000-000000000001'$$,
  'pack_in_use', 'a pack already used in prices cannot change its size');
select throws_ok(
  $$update products set dimension = 'count' where id = 'c5000000-0000-4000-8000-000000000002'$$,
  'dimension_locked', 'a product with movements cannot change its unit');
select throws_ok(
  $$update supplier_prices set last_price = -1 where pack_id = 'c6000000-0000-4000-8000-000000000003'$$,
  '23514', null, 'prices cannot be negative');
select lives_ok(
  $$insert into product_packs (product_id, name, qty_base) values ('c5000000-0000-4000-8000-000000000001', 'Pack 6', 6)$$,
  'a new whole-unit pack is accepted');

reset role;

select * from finish();
rollback;
