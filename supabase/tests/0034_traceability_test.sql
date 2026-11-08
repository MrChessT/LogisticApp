begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, email_confirmed_at) values
  ('fe000000-0000-4000-8000-000000000001', 'traza-encargado@example.com', now()),
  ('fe000000-0000-4000-8000-000000000002', 'traza-camarero@example.com', now());
insert into organizations (id, name) values ('fe100000-0000-4000-8000-000000000001', 'Org traza');
insert into locations (id, org_id, name) values ('fe200000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'Barra traza');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'manager', true),
  ('fe100000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002', 'staff', true);
insert into suppliers (id, org_id, name) values ('fe300000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'Proveedor traza');
insert into categories (id, org_id, name) values
  ('fe400000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'Destilados'),
  ('fe400000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'Licores');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into products (id, org_id, category_id, name, dimension) values
  ('fe500000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'fe400000-0000-4000-8000-000000000001', 'Ron traza', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values
  ('fe600000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000001', 'Caja 6', 4200, true);
insert into supplier_prices (supplier_id, pack_id, last_price) values ('fe300000-0000-4000-8000-000000000001', 'fe600000-0000-4000-8000-000000000001', 84);
update products set name = 'Ron añejo traza', category_id = 'fe400000-0000-4000-8000-000000000002' where id = 'fe500000-0000-4000-8000-000000000001';
update supplier_prices set last_price = 86.5 where pack_id = 'fe600000-0000-4000-8000-000000000001';
update location_products set min_qty = 1400 where product_id = 'fe500000-0000-4000-8000-000000000001';
insert into location_products (location_id, product_id, min_qty) values ('fe200000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000001', 700)
on conflict (location_id, product_id) do update set min_qty = 2100;

select is(
  (select old_value || ' → ' || new_value from catalog_changes where entity_id = 'fe500000-0000-4000-8000-000000000001' and field = 'name'),
  'Ron traza → Ron añejo traza', 'a rename is recorded with old and new value'
);
select is(
  (select old_value || ' → ' || new_value from catalog_changes where entity_id = 'fe500000-0000-4000-8000-000000000001' and field = 'category_id'),
  'Destilados → Licores', 'the family is shown by name'
);
select is(
  (select part || ': ' || old_value || ' → ' || new_value from catalog_changes where entity_id = 'fe500000-0000-4000-8000-000000000001' and field = 'last_price'),
  'Proveedor traza · Caja 6: 84 → 86.5', 'price changes say which supplier and format'
);
select is(
  (select changed_by from catalog_changes where field = 'last_price' and entity_id = 'fe500000-0000-4000-8000-000000000001'),
  'fe000000-0000-4000-8000-000000000001'::uuid, 'and who made them'
);
select is(
  (select count(*)::int from catalog_changes where entity_id = 'fe500000-0000-4000-8000-000000000001' and field = 'alta'),
  4, 'new product, format, price and assortment are recorded as «alta»'
);
select throws_ok($$delete from catalog_changes$$, '42501', null, 'nobody can delete the history');

-- El camarero sin «ve costes» no ve los cambios de precio.
select set_config('request.jwt.claims', '{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::int from catalog_changes where entity_id = 'fe500000-0000-4000-8000-000000000001' and is_cost),
  0, 'price changes are hidden without the costs permission'
);
select ok(
  (select count(*)::int from catalog_changes where entity_id = 'fe500000-0000-4000-8000-000000000001') > 0,
  'but the rest of the history is visible'
);

-- Códigos de documento por organización y año.
select set_config('request.jwt.claims', '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into purchase_orders (org_id, location_id, supplier_id) values
  ('fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000001'),
  ('fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000001', 'fe300000-0000-4000-8000-000000000001');
select is(
  (select string_agg(code, ', ' order by code) from purchase_orders where org_id = 'fe100000-0000-4000-8000-000000000001'),
  'PED-' || extract(year from now() at time zone 'Europe/Madrid') || '-0001, PED-' || extract(year from now() at time zone 'Europe/Madrid') || '-0002',
  'orders get consecutive codes'
);
insert into inventory_counts (org_id, location_id) values ('fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000001');
select matches((select code from inventory_counts where org_id = 'fe100000-0000-4000-8000-000000000001'), '^INV-\d{4}-0001$', 'each document type has its own series');
reset role;
select is((select count(*)::int from purchase_orders where code is null), 0, 'every existing document has a code');

select * from finish();
rollback;
