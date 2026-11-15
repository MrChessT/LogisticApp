begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, email_confirmed_at) values
  ('fe500000-0000-4000-8000-000000000001', 'atomico-admin@example.com', now()),
  ('fe500000-0000-4000-8000-000000000002', 'atomico-camarero@example.com', now());
insert into organizations (id, name) values ('fe510000-0000-4000-8000-000000000001', 'Org atomica');
insert into locations (id, org_id, name) values ('fe520000-0000-4000-8000-000000000001', 'fe510000-0000-4000-8000-000000000001', 'Local atomico');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fe510000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000001', 'admin', true),
  ('fe510000-0000-4000-8000-000000000001', 'fe500000-0000-4000-8000-000000000002', 'staff', true);
insert into suppliers (id, org_id, name) values
  ('fe530000-0000-4000-8000-000000000001', 'fe510000-0000-4000-8000-000000000001', 'Proveedor atomico'),
  ('fe530000-0000-4000-8000-000000000002', 'fe510000-0000-4000-8000-000000000001', 'Otro proveedor');
insert into products (id, org_id, name, dimension) values
  ('fe540000-0000-4000-8000-000000000001', 'fe510000-0000-4000-8000-000000000001', 'Harina atomica', 'mass'),
  ('fe540000-0000-4000-8000-000000000002', 'fe510000-0000-4000-8000-000000000001', 'Aceite atomico', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values
  ('fe550000-0000-4000-8000-000000000001', 'fe540000-0000-4000-8000-000000000001', 'Kg', 1000, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fe500000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Recetas ------------------------------------------------------------------------------------------------
create temp table rec as select save_recipe(null, 'fe510000-0000-4000-8000-000000000001',
  '{"name":"Pan atomico","kind":"plato","yield_qty":1,"yield_unit":"racion","vat_rate":10,"target_food_cost":30}'::jsonb,
  '[{"product_id":"fe540000-0000-4000-8000-000000000001","qty":200,"waste_pct":0},{"product_id":"fe540000-0000-4000-8000-000000000002","qty":10,"waste_pct":5}]'::jsonb) as id;
grant select on rec to authenticated;
select is((select count(*)::int from recipe_lines where recipe_id = (select id from rec)), 2, 'la receta se crea con sus ingredientes');

-- Segunda línea no válida (cantidad 0): no se guarda nada y los ingredientes anteriores siguen.
select throws_ok($$select save_recipe((select id from rec), 'fe510000-0000-4000-8000-000000000001',
  '{"name":"Pan cambiado","kind":"plato","yield_qty":1,"yield_unit":"racion","vat_rate":10,"target_food_cost":30}'::jsonb,
  '[{"product_id":"fe540000-0000-4000-8000-000000000001","qty":100},{"product_id":"fe540000-0000-4000-8000-000000000002","qty":0}]'::jsonb)$$,
  '23514', null, 'una línea no válida rechaza el guardado entero');
select is((select count(*)::int from recipe_lines where recipe_id = (select id from rec)), 2, 'los ingredientes anteriores se conservan');
select is((select name from recipes where id = (select id from rec)), 'Pan atomico', 'y la cabecera tampoco cambia');

select save_recipe((select id from rec), 'fe510000-0000-4000-8000-000000000001',
  '{"name":"Pan atomico","kind":"plato","yield_qty":2,"yield_unit":"racion","vat_rate":10,"target_food_cost":30}'::jsonb,
  '[{"product_id":"fe540000-0000-4000-8000-000000000001","qty":300}]'::jsonb);
select is((select count(*)::int || ' ' || max(qty)::text from recipe_lines where recipe_id = (select id from rec)), '1 300.0000', 'un guardado válido reemplaza los ingredientes');

-- Recepciones --------------------------------------------------------------------------------------------
create temp table rcp as select register_receipt('fe560000-0000-4000-8000-0000000000aa', 'fe510000-0000-4000-8000-000000000001',
  'fe520000-0000-4000-8000-000000000001', 'fe530000-0000-4000-8000-000000000001', 'A-1', current_date,
  '[{"pack_id":"fe550000-0000-4000-8000-000000000001","packs_qty":2,"pack_price":3.5}]'::jsonb) as id;
grant select on rcp to authenticated;
select is((select status::text from goods_receipts where id = (select id from rcp)), 'closed', 'la recepción queda registrada y cerrada');
select is((select sum(qty)::int from stock_movements where ref_id = (select id from rcp)), 2000, 'con su stock');
select is(register_receipt('fe560000-0000-4000-8000-0000000000aa', 'fe510000-0000-4000-8000-000000000001',
  'fe520000-0000-4000-8000-000000000001', 'fe530000-0000-4000-8000-000000000001', 'A-1', current_date,
  '[{"pack_id":"fe550000-0000-4000-8000-000000000001","packs_qty":2,"pack_price":3.5}]'::jsonb), (select id from rcp), 'repetir el mismo intento devuelve la misma recepción');
select is((select count(*)::int from stock_movements where ref_table = 'goods_receipts' and org_id = 'fe510000-0000-4000-8000-000000000001'), 1, 'y no duplica el stock');
select throws_ok($$select register_receipt('fe560000-0000-4000-8000-0000000000bb', 'fe510000-0000-4000-8000-000000000001',
  'fe520000-0000-4000-8000-000000000001', null, null, current_date,
  '[{"pack_id":"fe550000-0000-4000-8000-000000000001","packs_qty":1,"pack_price":3},{"pack_id":"fe550000-0000-4000-8000-000000000001","packs_qty":0,"pack_price":3}]'::jsonb)$$,
  '23514', null, 'una línea no válida rechaza la recepción entera');
select is((select count(*)::int from goods_receipts where client_key = 'fe560000-0000-4000-8000-0000000000bb'), 0, 'y no deja una recepción a medias');

-- Producto con formato -----------------------------------------------------------------------------------
select is((create_product_with_pack('fe510000-0000-4000-8000-000000000001', 'Sal atomica', 'mass', 'g', 1, 10)->>'qty_base')::numeric, 1::numeric, 'el producto se crea con su formato');
select throws_ok($$select create_product_with_pack('fe510000-0000-4000-8000-000000000001', 'Azucar atomico', 'mass', 'Kg', 0)$$, '22023', 'invalid_pack', 'sin formato válido no se crea el producto');
select is((select count(*)::int from products where name = 'Azucar atomico'), 0, 'y no queda un producto sin formato');

-- Facturas: nulo no toca los albaranes -------------------------------------------------------------------
create temp table inv as select save_invoice(null, 'fe510000-0000-4000-8000-000000000001', 'fe530000-0000-4000-8000-000000000001', 'F-A1',
  current_date, null, 7, 0, 7, null, array[(select id from rcp)]) as id;
grant select on inv to authenticated;
select save_invoice((select id from inv), 'fe510000-0000-4000-8000-000000000001', 'fe530000-0000-4000-8000-000000000001', 'F-A1', current_date, null, 7, 0, 7, 'nota', null);
select is((select count(*)::int from invoice_receipts where invoice_id = (select id from inv)), 1, 'editar con albaranes nulos los conserva');
select save_invoice((select id from inv), 'fe510000-0000-4000-8000-000000000001', 'fe530000-0000-4000-8000-000000000001', 'F-A1', current_date, null, 7, 0, 7, null, '{}'::uuid[]);
select is((select count(*)::int from invoice_receipts where invoice_id = (select id from inv)), 0, 'una lista vacía sí los quita');

-- El personal no puede guardar recetas.
select set_config('request.jwt.claims', '{"sub":"fe500000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select save_recipe((select id from rec), 'fe510000-0000-4000-8000-000000000001',
  '{"name":"Pan atomico","kind":"plato","yield_qty":1,"yield_unit":"racion","vat_rate":10,"target_food_cost":30}'::jsonb, '[]'::jsonb)$$,
  '42501', null, 'el personal no puede cambiar una receta');

select * from finish();
rollback;
