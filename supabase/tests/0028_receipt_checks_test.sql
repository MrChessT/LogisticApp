begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at) values
  ('f8000000-0000-4000-8000-000000000001', 'recepcion-staff@example.com', now()),
  ('f8000000-0000-4000-8000-000000000002', 'recepcion-manager@example.com', now());
insert into organizations (id, name) values ('f8100000-0000-4000-8000-000000000001', 'Org recepciones');
insert into locations (id, org_id, name) values ('f8200000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'Bar recepciones');
insert into memberships (org_id, user_id, role, all_locations) values
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000001', 'staff', true),
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000002', 'manager', true);
insert into suppliers (id, org_id, name) values ('f8300000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'Proveedor recepciones');
insert into products (id, org_id, name, dimension) values ('f8400000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'Ginebra recepciones', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values
  ('f8500000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000001', 'Caja 6 botellas', 4200, true);
insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at) values
  ('f8300000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000001', 70.20, now() - interval '10 days');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f8000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Recepción suelta: el albarán cobra 71,50 por caja; lo pactado era el último precio (70,20).
insert into goods_receipts (id, org_id, location_id, supplier_id, doc_number)
values ('f8600000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'ALB-45821');
insert into receipt_lines (receipt_id, pack_id, packs_qty, pack_price)
values ('f8600000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000001', 2, 71.50);
select is(
  (select expected_price::text from receipt_lines where receipt_id = 'f8600000-0000-4000-8000-000000000001'),
  '70.2000',
  'the agreed price is the last price before this receipt'
);
select lives_ok($$select post_receipt('f8600000-0000-4000-8000-000000000001')$$, 'the receipt is posted');
select is(
  (select diff_per_pack::text || ' ' || diff_total::text from v_receipt_price_checks where receipt_id = 'f8600000-0000-4000-8000-000000000001'),
  '1.3000 2.6000',
  'the view shows the overcharge per box and in total'
);

-- Recepción de un pedido: lo pactado es el precio del pedido, y la incidencia se guarda.
reset role;
insert into purchase_orders (id, org_id, location_id, supplier_id, status)
values ('f8700000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'sent');
insert into purchase_order_lines (order_id, pack_id, packs_qty, pack_price)
values ('f8700000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000001', 3, 69.00);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f8000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select receive_order('f8700000-0000-4000-8000-000000000001',
    '[{"pack_id":"f8500000-0000-4000-8000-000000000001","packs_qty":2,"pack_price":72,"incident":"roto","incident_note":"  una caja golpeada "}]'::jsonb, 'ALB-46000')$$,
  'staff receives the order with an incident'
);
select is(
  (select expected_price::text || ' ' || incident || ' ' || incident_note from receipt_lines rl join goods_receipts r on r.id = rl.receipt_id where r.order_id = 'f8700000-0000-4000-8000-000000000001'),
  '69.0000 roto una caja golpeada',
  'the agreed price comes from the order and the incident is kept'
);
select throws_ok(
  $$select receive_order('f8700000-0000-4000-8000-000000000001',
    '[{"pack_id":"f8500000-0000-4000-8000-000000000001","packs_qty":1,"pack_price":69,"incident":"perdido"}]'::jsonb)$$,
  '23514', null, 'unknown incidents are rejected'
);

-- Foto del albarán: solo en su carpeta (organización/local/recepción/…).
select lives_ok(
  $$select set_receipt_attachment('f8600000-0000-4000-8000-000000000001',
    'f8100000-0000-4000-8000-000000000001/f8200000-0000-4000-8000-000000000001/f8600000-0000-4000-8000-000000000001/albaran.jpg')$$,
  'the photo is attached in its folder'
);
select is(
  (select attachment_path from goods_receipts where id = 'f8600000-0000-4000-8000-000000000001'),
  'f8100000-0000-4000-8000-000000000001/f8200000-0000-4000-8000-000000000001/f8600000-0000-4000-8000-000000000001/albaran.jpg',
  'the path is stored'
);
select throws_ok(
  $$select set_receipt_attachment('f8600000-0000-4000-8000-000000000001', 'otra-org/otro-local/x/albaran.jpg')$$,
  '22023', 'invalid_path', 'a path outside its folder is rejected'
);

-- Alguien sin acceso al local no puede.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000999","role":"authenticated"}', true);
select throws_ok(
  $$select set_receipt_attachment('f8600000-0000-4000-8000-000000000001', null)$$,
  '42501', 'forbidden', 'outsiders cannot change the photo'
);

reset role;

select * from finish();
rollback;
