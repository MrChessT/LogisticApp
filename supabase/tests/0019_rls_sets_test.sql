begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Ninguna tabla tiene ya políticas `for all`: las escrituras no se evalúan al leer.
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relnamespace = 'public'::regnamespace and p.polcmd = '*'
     and c.relname not in ('copilot_profiles', 'copilot_sessions')),
  0,
  'no write policy also applies to reads'
);

-- Una organización con dos locales; un encargado, un empleado del Bar y alguien de otra organización.
insert into auth.users (id, email, email_confirmed_at) values
  ('c1000000-0000-4000-8000-000000000001', 'rls-manager@example.com', now()),
  ('c1000000-0000-4000-8000-000000000002', 'rls-staff@example.com', now()),
  ('c1000000-0000-4000-8000-000000000003', 'rls-outsider@example.com', now());
insert into organizations (id, name) values
  ('c2000000-0000-4000-8000-000000000001', 'Org RLS'),
  ('c2000000-0000-4000-8000-000000000002', 'Otra org RLS');
insert into locations (id, org_id, name) values
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Bar'),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'Terraza');
insert into memberships (org_id, user_id, role, all_locations) values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'manager', true),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'staff', false),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003', 'owner', true);
insert into membership_locations (org_id, user_id, location_id) values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001');
insert into suppliers (id, org_id, name) values ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Proveedor RLS');
insert into products (id, org_id, name, dimension) values ('c5000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Vermut RLS', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_count_default) values
  ('c6000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'Botella 1 l', 1000, true);
insert into supplier_prices (supplier_id, pack_id, last_price) values
  ('c4000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 9);
insert into inventory_counts (id, org_id, location_id) values
  ('c7000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'),
  ('c7000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002');
insert into count_lines (count_id, product_id, qty) values
  ('c7000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 1000),
  ('c7000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000001', 2000);

-- Empleado del Bar: lee el catálogo, solo ve su local y no puede tocar el catálogo.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from products where org_id = 'c2000000-0000-4000-8000-000000000001'), 1, 'staff reads the catalog');
select is((select count(*)::int from product_packs where product_id = 'c5000000-0000-4000-8000-000000000001'), 1, 'staff reads the packs');
select is((select count(*)::int from supplier_prices where pack_id = 'c6000000-0000-4000-8000-000000000001'), 1, 'staff reads the prices');
select is((select count(*)::int from count_lines where product_id = 'c5000000-0000-4000-8000-000000000001'), 1, 'staff only sees count lines of their location');
select throws_ok(
  $$insert into products (org_id, name, dimension) values ('c2000000-0000-4000-8000-000000000001', 'Intruso', 'count')$$,
  '42501', null, 'staff cannot create products'
);
update products set name = 'Cambiado' where id = 'c5000000-0000-4000-8000-000000000001';
update product_packs set name = 'Cambiado' where id = 'c6000000-0000-4000-8000-000000000001';
update supplier_prices set last_price = 1 where pack_id = 'c6000000-0000-4000-8000-000000000001';
reset role;
select is((select name from products where id = 'c5000000-0000-4000-8000-000000000001'), 'Vermut RLS', 'staff cannot rename products');
select is((select name from product_packs where id = 'c6000000-0000-4000-8000-000000000001'), 'Botella 1 l', 'staff cannot change packs');
select is((select last_price::int from supplier_prices where pack_id = 'c6000000-0000-4000-8000-000000000001'), 9, 'staff cannot change prices');

-- Quien es de otra organización no ve nada.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from products where org_id = 'c2000000-0000-4000-8000-000000000001')
  + (select count(*)::int from product_packs where product_id = 'c5000000-0000-4000-8000-000000000001')
  + (select count(*)::int from supplier_prices where pack_id = 'c6000000-0000-4000-8000-000000000001')
  + (select count(*)::int from count_lines where product_id = 'c5000000-0000-4000-8000-000000000001'),
  0,
  'another organization sees nothing'
);

-- Encargado: ve los dos locales y gestiona el catálogo y el surtido.
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from count_lines where product_id = 'c5000000-0000-4000-8000-000000000001'), 2, 'manager sees every location');
update product_packs set name = 'Botella 1 litro' where id = 'c6000000-0000-4000-8000-000000000001';
update supplier_prices set last_price = 10 where pack_id = 'c6000000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into location_products (location_id, product_id, min_qty) values ('c3000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000001', 500)
    on conflict (location_id, product_id) do update set min_qty = excluded.min_qty$$,
  'manager edits the assortment'
);
select lives_ok(
  $$insert into count_lines (count_id, product_id, qty) values ('c7000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000001', 3000)
    on conflict do nothing$$,
  'manager writes count lines of an open count'
);
reset role;
select is((select name from product_packs where id = 'c6000000-0000-4000-8000-000000000001'), 'Botella 1 litro', 'manager renames packs');
select is((select last_price::int from supplier_prices where pack_id = 'c6000000-0000-4000-8000-000000000001'), 10, 'manager changes prices');

-- Un conteo cerrado ya no admite líneas, ni siquiera del encargado.
update inventory_counts set status = 'closed' where id = 'c7000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$insert into count_lines (count_id, product_id, qty) values ('c7000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 1)$$,
  '42501', null, 'a closed count does not accept lines'
);
reset role;

select * from finish();
rollback;
