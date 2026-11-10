begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, email_confirmed_at) values
  ('f9000000-0000-4000-8000-000000000001', 'recepcion-cero@example.com', now());
insert into organizations (id, name) values ('f9100000-0000-4000-8000-000000000001', 'Org recepción a cero');
insert into locations (id, org_id, name) values ('f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'Bar a cero');
insert into memberships (org_id, user_id, role, all_locations) values
  ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001', 'manager', true);
insert into suppliers (id, org_id, name) values ('f9300000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'Proveedor a cero');
insert into products (id, org_id, name, dimension) values
  ('f9400000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'Ron a cero', 'volume'),
  ('f9400000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-000000000001', 'Tónica a cero', 'count');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values
  ('f9500000-0000-4000-8000-000000000001', 'f9400000-0000-4000-8000-000000000001', 'Botella 70 cl', 700, true),
  ('f9500000-0000-4000-8000-000000000002', 'f9400000-0000-4000-8000-000000000002', 'Caja 24', 24, true);
insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at) values
  ('f9300000-0000-4000-8000-000000000001', 'f9500000-0000-4000-8000-000000000001', 15.00, now() - interval '10 days');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- El ron llega sin precio (0 €); la tónica, a 12 €.
insert into goods_receipts (id, org_id, location_id, supplier_id, doc_number)
values ('f9600000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'f9300000-0000-4000-8000-000000000001', 'ALB-0');
insert into receipt_lines (receipt_id, pack_id, packs_qty, pack_price) values
  ('f9600000-0000-4000-8000-000000000001', 'f9500000-0000-4000-8000-000000000001', 1, 0),
  ('f9600000-0000-4000-8000-000000000001', 'f9500000-0000-4000-8000-000000000002', 1, 12);
select lives_ok($$select post_receipt('f9600000-0000-4000-8000-000000000001')$$, 'the receipt is posted');

reset role;
select is(
  (select last_price::text from supplier_prices where pack_id = 'f9500000-0000-4000-8000-000000000001'),
  '15.0000',
  'a line at 0 € does not overwrite the supplier price'
);
select is(
  (select count(*)::int from price_history where pack_id = 'f9500000-0000-4000-8000-000000000001' and price = 0),
  0,
  'nor goes to the price history'
);
select is(
  (select last_price::text from supplier_prices where pack_id = 'f9500000-0000-4000-8000-000000000002'),
  '12.0000',
  'a priced line still updates the supplier price'
);

select * from finish();
rollback;
