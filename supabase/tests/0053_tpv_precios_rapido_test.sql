begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, email_confirmed_at) values
  ('fd000000-0000-4000-8000-000000000001', 'tpv-rapido-encargada@example.com', now()),
  ('fd000000-0000-4000-8000-000000000002', 'tpv-rapido-camarero@example.com', now()),
  ('fd000000-0000-4000-8000-000000000003', 'tpv-rapido-otra@example.com', now());
insert into organizations (id, name) values
  ('fd100000-0000-4000-8000-000000000001', 'Org tpv rápido'),
  ('fd100000-0000-4000-8000-000000000002', 'Org ajena tpv');
insert into locations (id, org_id, name) values ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Local tpv rápido');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'manager', true),
  ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002', 'staff', true),
  ('fd100000-0000-4000-8000-000000000002', 'fd000000-0000-4000-8000-000000000003', 'manager', true);
insert into recipes (id, org_id, name, kind, yield_qty, yield_unit, sale_price, vat_rate) values
  ('fd600000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Paella rápida', 'plato', 1, 'racion', null, 10);
insert into sales_items (id, org_id, code, name, recipe_id, qty_per_sale) values
  ('fd700000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'P1', 'PAELLA', 'fd600000-0000-4000-8000-000000000001', 1);
insert into sales_days (id, org_id, location_id, sale_date) values
  ('fd800000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', '2026-11-02');
-- 4 paellas a 11,00 € sin IVA (12,10 € con IVA, redondeado a 12,10 €).
insert into sales_lines (day_id, item_id, qty, amount) values
  ('fd800000-0000-4000-8000-000000000001', 'fd700000-0000-4000-8000-000000000001', 4, 44.00);

set local role authenticated;

-- Encargada (gestiona ventas): ve el PVP sugerido con las mismas cifras de siempre.
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from tpv_sale_prices('fd100000-0000-4000-8000-000000000001')), 1, 'La encargada recibe el plato vendido');
select is((select suggested_price from tpv_sale_prices('fd100000-0000-4000-8000-000000000001')), 12.10::numeric, 'PVP con IVA y redondeo a 5 céntimos');
select is((select portions_sold from tpv_sale_prices('fd100000-0000-4000-8000-000000000001')), 4::numeric, 'Raciones vendidas');

-- Personal sin «ve costes»: lista vacía, aunque la función ya no aplique RLS a las ventas.
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from tpv_sale_prices('fd100000-0000-4000-8000-000000000001')), 0, 'El personal sin permiso no ve nada');

-- Responsable de otra organización: no ve las ventas de esta.
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from tpv_sale_prices('fd100000-0000-4000-8000-000000000001')), 0, 'Otra organización no ve las ventas ajenas');

select * from finish();
rollback;
