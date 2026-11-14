begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('fc500000-0000-4000-8000-000000000001', 'lineas-admin@example.com', now()),
  ('fc500000-0000-4000-8000-000000000002', 'lineas-camarero@example.com', now());
insert into organizations (id, name) values ('fc510000-0000-4000-8000-000000000001', 'Org lineas');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fc510000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001', 'admin', true),
  ('fc510000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000002', 'staff', true);
insert into suppliers (id, org_id, name) values ('fc530000-0000-4000-8000-000000000001', 'fc510000-0000-4000-8000-000000000001', 'Proveedor lineas');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fc500000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Harina 2 × 3,50 = 7,00 · Aceite 3 × 3,00 con 10 % de descuento = 8,10 → base 15,10.
create temp table inv as select save_invoice(null, 'fc510000-0000-4000-8000-000000000001', 'fc530000-0000-4000-8000-000000000001', 'L-1',
  current_date, null, 15.10, 0, 15.10, null, '{}'::uuid[],
  '[{"position":1,"ref":"A1","description":"Harina","qty":2,"unit":"kg","price":3.5,"discount_pct":null,"vat_pct":21,"amount":7},
    {"position":2,"description":"Aceite","qty":3,"price":3,"discount_pct":10,"amount":8.1}]'::jsonb) as id;
grant select on inv to authenticated;

select is((select count(*)::int from invoice_lines where invoice_id = (select id from inv)), 2, 'las líneas se guardan con la factura');
select is((select ref || ' ' || qty::text || ' ' || unit from invoice_lines where invoice_id = (select id from inv) and position = 1), 'A1 2.000 kg', 'la referencia, cantidad y unidad se guardan');

-- Sin p_lines (una edición de la cabecera) las líneas que hay se conservan.
select save_invoice((select id from inv), 'fc510000-0000-4000-8000-000000000001', 'fc530000-0000-4000-8000-000000000001', 'L-1',
  current_date, null, 15.10, 0, 15.10, 'nota', '{}'::uuid[]);
select is((select count(*)::int from invoice_lines where invoice_id = (select id from inv)), 2, 'editar la cabecera no toca las líneas');

-- Con p_lines se reemplazan.
select save_invoice((select id from inv), 'fc510000-0000-4000-8000-000000000001', 'fc530000-0000-4000-8000-000000000001', 'L-1',
  current_date, null, 7, 0, 7, null, '{}'::uuid[], '[{"position":1,"description":"Harina","qty":2,"price":3.5,"amount":7}]'::jsonb);
select is((select count(*)::int from invoice_lines where invoice_id = (select id from inv)), 1, 'con líneas nuevas se reemplazan las anteriores');

select throws_ok($$select save_invoice(null, 'fc510000-0000-4000-8000-000000000001', 'fc530000-0000-4000-8000-000000000001', 'L-2', current_date, null, 9, 0, 9, null, '{}', '[{"position":1,"description":"Mal","qty":2,"price":3,"amount":9}]'::jsonb)$$,
  '23514', null, 'una línea cuyo importe no es cantidad × precio no se guarda');
select throws_ok($$select save_invoice(null, 'fc510000-0000-4000-8000-000000000001', 'fc530000-0000-4000-8000-000000000001', 'L-3', current_date, null, 9, 0, 9, null, '{}', '{"position":1}'::jsonb)$$,
  '22023', 'invalid_lines', 'las líneas tienen que llegar como lista');

-- El camarero no ve facturas ni sus líneas, y no puede guardarlas.
select set_config('request.jwt.claims', '{"sub":"fc500000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from invoice_lines), 0, 'el personal no ve las líneas de las facturas');
select throws_ok($$select save_invoice((select id from inv), 'fc510000-0000-4000-8000-000000000001', 'fc530000-0000-4000-8000-000000000001', 'L-1', current_date, null, 7, 0, 7, null, '{}', '[]'::jsonb)$$,
  '42501', 'forbidden', 'el personal no puede guardar líneas');

select * from finish();
rollback;
