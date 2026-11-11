begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('fb000000-0000-4000-8000-000000000001', 'codigos-cocina@example.com', now()),
  ('fb000000-0000-4000-8000-000000000002', 'codigos-otra@example.com', now());
insert into organizations (id, name) values
  ('fb100000-0000-4000-8000-000000000001', 'Org códigos'),
  ('fb100000-0000-4000-8000-000000000002', 'Otra org códigos');
insert into locations (id, org_id, name) values ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'Cocina códigos');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'staff', true),
  ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000002', 'manager', true);
insert into suppliers (id, org_id, name) values ('fb300000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'Carnicería códigos');
insert into products (id, org_id, name, dimension) values
  ('fb400000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'Costilla códigos', 'mass'),
  ('fb400000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'Producto de otra org', 'mass');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default, is_count_default) values
  ('fb500000-0000-4000-8000-000000000001', 'fb400000-0000-4000-8000-000000000001', 'Kilo', 1000, true, true),
  ('fb500000-0000-4000-8000-000000000002', 'fb400000-0000-4000-8000-000000000002', 'Kilo', 1000, true, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  remember_supplier_codes('fb300000-0000-4000-8000-000000000001', '[
    {"code":"0000000192","description":"COSTILLA DE CERDO","product_id":"fb400000-0000-4000-8000-000000000001","pack_id":"fb500000-0000-4000-8000-000000000001"},
    {"code":"0000000999","product_id":"fb400000-0000-4000-8000-000000000002"},
    {"code":"","product_id":"fb400000-0000-4000-8000-000000000001"}
  ]'::jsonb),
  1,
  'Guarda el código de un producto propio y descarta el de otra organización y el código vacío'
);
select is((select pack_id from supplier_item_codes where code = '0000000192'), 'fb500000-0000-4000-8000-000000000001'::uuid, 'Recuerda el formato');

-- Un formato que no es del producto no se guarda; volver a confirmar actualiza, no duplica.
select is(
  remember_supplier_codes('fb300000-0000-4000-8000-000000000001',
    '[{"code":"0000000192","description":"COSTILLA","product_id":"fb400000-0000-4000-8000-000000000001","pack_id":"fb500000-0000-4000-8000-000000000002"}]'::jsonb),
  1, 'Actualiza el código ya aprendido');
select is((select count(*)::int from supplier_item_codes where code = '0000000192'), 1, 'Sin duplicados');
select is((select pack_id from supplier_item_codes where code = '0000000192'), null, 'Formato ajeno al producto: se descarta');

-- Otra organización ni lee la memoria ni puede escribir en un proveedor que no es suyo.
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from supplier_item_codes), 0, 'Otra organización no ve los códigos');
select throws_ok(
  $$ select remember_supplier_codes('fb300000-0000-4000-8000-000000000001', '[{"code":"x","product_id":"fb400000-0000-4000-8000-000000000002"}]'::jsonb) $$,
  '42501', null, 'No escribe en el proveedor de otra organización');

reset role;
select throws_ok(
  $$ set local role anon; select remember_supplier_codes('fb300000-0000-4000-8000-000000000001', '[]'::jsonb) $$,
  '42501', null, 'Anónimo: sin permiso');

select * from finish();
rollback;
