begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, email_confirmed_at) values
  ('fb500000-0000-4000-8000-000000000001', 'facturas-admin@example.com', now()),
  ('fb500000-0000-4000-8000-000000000002', 'facturas-camarero@example.com', now());
insert into organizations (id, name) values ('fb510000-0000-4000-8000-000000000001', 'Org facturas');
insert into locations (id, org_id, name) values ('fb520000-0000-4000-8000-000000000001', 'fb510000-0000-4000-8000-000000000001', 'Local facturas');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fb510000-0000-4000-8000-000000000001', 'fb500000-0000-4000-8000-000000000001', 'admin', true),
  ('fb510000-0000-4000-8000-000000000001', 'fb500000-0000-4000-8000-000000000002', 'staff', true);
insert into suppliers (id, org_id, name) values
  ('fb530000-0000-4000-8000-000000000001', 'fb510000-0000-4000-8000-000000000001', 'Proveedor A'),
  ('fb530000-0000-4000-8000-000000000002', 'fb510000-0000-4000-8000-000000000001', 'Proveedor B');
insert into products (id, org_id, name, dimension) values ('fb540000-0000-4000-8000-000000000001', 'fb510000-0000-4000-8000-000000000001', 'Ron facturas', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values ('fb550000-0000-4000-8000-000000000001', 'fb540000-0000-4000-8000-000000000001', 'Caja 6', 4200, true);
-- Dos albaranes del proveedor A (100 € y 50 €) y uno del B, cerrados.
insert into goods_receipts (id, org_id, location_id, supplier_id, status) values
  ('fb560000-0000-4000-8000-000000000001', 'fb510000-0000-4000-8000-000000000001', 'fb520000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000001', 'closed'),
  ('fb560000-0000-4000-8000-000000000002', 'fb510000-0000-4000-8000-000000000001', 'fb520000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000001', 'closed'),
  ('fb560000-0000-4000-8000-000000000003', 'fb510000-0000-4000-8000-000000000001', 'fb520000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000002', 'closed');
insert into receipt_lines (receipt_id, pack_id, packs_qty, pack_price) values
  ('fb560000-0000-4000-8000-000000000001', 'fb550000-0000-4000-8000-000000000001', 2, 50),
  ('fb560000-0000-4000-8000-000000000002', 'fb550000-0000-4000-8000-000000000001', 1, 50),
  ('fb560000-0000-4000-8000-000000000003', 'fb550000-0000-4000-8000-000000000001', 1, 80);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fb500000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from v_unbilled_receipts where org_id = 'fb510000-0000-4000-8000-000000000001'), 3, 'closed receipts start unbilled');

-- La factura cobra 152 € de base (2 € más que los albaranes) + 21 % de IVA.
create temp table inv as select save_invoice(null, 'fb510000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000001', 'F-2026/118',
  current_date - 40, current_date - 10, 152, 31.92, 183.92, null,
  array['fb560000-0000-4000-8000-000000000001', 'fb560000-0000-4000-8000-000000000002']::uuid[]) as id;
grant select on inv to authenticated;
select is((select receipts_total::text || ' ' || difference::text from v_invoices where id = (select id from inv)), '150.00 2.00', 'the invoice is matched against its receipts');
select ok((select overdue from v_invoices where id = (select id from inv)), 'an unpaid invoice past its due date is overdue');
select matches((select code from invoices where id = (select id from inv)), '^FAC-\d{4}-0001$', 'invoices get a readable code');
select is((select count(*)::int from v_unbilled_receipts where org_id = 'fb510000-0000-4000-8000-000000000001'), 1, 'its receipts are no longer unbilled');

select throws_ok($$select save_invoice(null, 'fb510000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000001', 'F-2', current_date, null, 10, 2.1, 50, null, '{}')$$,
  '22023', 'totals_mismatch', 'base + VAT must equal the total');
select throws_ok($$select save_invoice(null, 'fb510000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000001', 'F-3', current_date, null, 80, 0, 80, null, array['fb560000-0000-4000-8000-000000000003']::uuid[])$$,
  '22023', 'invalid_receipts', 'a receipt of another supplier cannot go in the invoice');
select throws_ok($$select save_invoice(null, 'fb510000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000001', 'F-4', current_date, null, 100, 0, 100, null, array['fb560000-0000-4000-8000-000000000001']::uuid[])$$,
  '22023', 'invalid_receipts', 'a receipt can only be in one invoice');
select throws_ok($$select save_invoice(null, 'fb510000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000001', 'f-2026/118 ', current_date, null, 1, 0, 1, null, '{}')$$,
  '23505', null, 'the same supplier number cannot be entered twice');

update invoices set status = 'pagada', paid_at = current_date where id = (select id from inv);
select is((select overdue from v_invoices where id = (select id from inv)), false, 'once paid it is no longer overdue');

-- El camarero no ve facturas ni puede crearlas.
select set_config('request.jwt.claims', '{"sub":"fb500000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from v_invoices), 0, 'staff cannot see invoices');
select throws_ok($$select save_invoice(null, 'fb510000-0000-4000-8000-000000000001', 'fb530000-0000-4000-8000-000000000002', 'X', current_date, null, 80, 0, 80, null, '{}')$$,
  '42501', 'forbidden', 'nor create them');

reset role;
select * from finish();
rollback;
