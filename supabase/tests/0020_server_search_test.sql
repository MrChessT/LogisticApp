begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, email_confirmed_at) values
  ('d1000000-0000-4000-8000-000000000001', 'search-staff@example.com', now()),
  ('d1000000-0000-4000-8000-000000000002', 'search-outsider@example.com', now());
insert into organizations (id, name) values
  ('d2000000-0000-4000-8000-000000000001', 'Org búsqueda'),
  ('d2000000-0000-4000-8000-000000000002', 'Otra org búsqueda');
insert into locations (id, org_id, name) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Bar'),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Terraza');
insert into memberships (org_id, user_id, role, all_locations) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'staff', false),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'owner', true);
insert into membership_locations (org_id, user_id, location_id) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001');
insert into suppliers (id, org_id, name) values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Proveedor A'),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Proveedor B');
insert into products (id, org_id, name, dimension) values
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Ginebra Búsqueda', 'volume'),
  ('d5000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Tónica Búsqueda', 'count'),
  ('d5000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'Vermut Busqueda Archivado', 'volume');
update products set active = false where id = 'd5000000-0000-4000-8000-000000000003';
insert into product_packs (id, product_id, name, qty_base, is_count_default, is_purchase_default, barcode) values
  ('d6000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'Botella 70 cl', 700, true, false, null),
  ('d6000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 'Caja 6', 4200, false, true, '8400000000017'),
  ('d6000000-0000-4000-8000-000000000003', 'd5000000-0000-4000-8000-000000000002', 'Caja 24', 24, false, true, null);
insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at) values
  ('d4000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000002', 60, now() - interval '2 days'),
  ('d4000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000002', 66, now());
insert into location_products (location_id, product_id, min_qty) values
  ('d3000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000002', 48),
  ('d3000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 0);
insert into stock_balances (location_id, product_id, qty, avg_cost) values
  ('d3000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 1400, 0.0143),
  ('d3000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000002', 12, 0.5),
  ('d3000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 700, 0.0143);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Buscador de productos
select is(jsonb_array_length(product_lookup('busqueda')), 2, 'search ignores accents and archived products');
select is(product_lookup('gin bus')->0->>'name', 'Ginebra Búsqueda', 'every word must match');
select is(product_lookup('8400000000017')->0->>'name', 'Ginebra Búsqueda', 'a scanned barcode finds its product');
select is(
  product_lookup('busqueda', 'd3000000-0000-4000-8000-000000000001')->0->>'name',
  'Tónica Búsqueda',
  'products of the chosen location come first'
);
select is(
  (select p->>'price' from jsonb_array_elements(product_lookup('ginebra', null, 'd4000000-0000-4000-8000-000000000001')->0->'packs') p where p->>'name' = 'Caja 6'),
  '60.0000',
  'the price is the one of the chosen supplier'
);
select is(
  (select p->>'price' from jsonb_array_elements(product_lookup('ginebra')->0->'packs') p where p->>'name' = 'Caja 6'),
  '66.0000',
  'without supplier, the most recent price'
);
select is(product_lookup('ginebra', 'd3000000-0000-4000-8000-000000000001')->0->>'stock', '1400.0000', 'stock of the chosen location');
select is(jsonb_array_length(product_lookup(null, null, null, 1)), 1, 'the limit is respected');

-- Stock por páginas: el empleado solo ve su local
select is((stock_search()->>'total')::int, 2, 'staff only sees the stock of their location');
select is((stock_search(p_status => 'critical')->>'total')::int, 0, 'nothing is critical');
select is((stock_search(p_status => 'low')->'items'->0->>'product_name'), 'Tónica Búsqueda', 'below minimum is low');
select is((stock_search(p_search => 'tonica')->>'total')::int, 1, 'stock search ignores accents');
select is((stock_search(p_limit => 1)->'summary'->>'rows')::int, 2, 'the summary counts every row, not just the page');

-- Otra organización no ve nada
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  jsonb_array_length(product_lookup('busqueda')) + (stock_search()->>'total')::int
  + (select count(*)::int from v_supplier_summary where supplier_id in ('d4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002')),
  0,
  'another organization sees nothing'
);
reset role;

select * from finish();
rollback;
