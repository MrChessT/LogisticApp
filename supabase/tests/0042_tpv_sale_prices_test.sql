begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, email_confirmed_at) values
  ('fc000000-0000-4000-8000-000000000001', 'pvp-encargada@example.com', now()),
  ('fc000000-0000-4000-8000-000000000002', 'pvp-camarero@example.com', now());
insert into organizations (id, name) values ('fc100000-0000-4000-8000-000000000001', 'Org pvp');
insert into locations (id, org_id, name) values ('fc200000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Restaurante pvp');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'manager', true),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'staff', true);
insert into recipes (id, org_id, name, kind, yield_qty, yield_unit, sale_price, vat_rate) values
  ('fc600000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Arroz pvp', 'plato', 1, 'racion', null, 10),
  ('fc600000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'Tarta pvp', 'plato', 1, 'racion', 6.50, 10),
  ('fc600000-0000-4000-8000-000000000003', 'fc100000-0000-4000-8000-000000000001', 'Sofrito pvp', 'elaboracion', 1000, 'g', null, 10);
insert into sales_items (id, org_id, code, name, recipe_id, qty_per_sale) values
  ('fc700000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'A1', 'ARROZ', 'fc600000-0000-4000-8000-000000000001', 1),
  ('fc700000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'A2', 'MEDIO ARROZ', 'fc600000-0000-4000-8000-000000000001', 0.5),
  ('fc700000-0000-4000-8000-000000000003', 'fc100000-0000-4000-8000-000000000001', 'T1', 'TARTA', 'fc600000-0000-4000-8000-000000000002', 1),
  ('fc700000-0000-4000-8000-000000000004', 'fc100000-0000-4000-8000-000000000001', 'S1', 'SOFRITO', 'fc600000-0000-4000-8000-000000000003', 1);
insert into sales_days (id, org_id, location_id, sale_date) values
  ('fc800000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', '2026-10-30');
-- 10 arroces a 16,3636 € sin IVA (18,00 € con IVA) + 1 invitación a 0 €; 2 medios; 4 tartas a 6,00 € sin IVA.
insert into sales_lines (day_id, item_id, qty, amount) values
  ('fc800000-0000-4000-8000-000000000001', 'fc700000-0000-4000-8000-000000000001', 10, 163.64),
  ('fc800000-0000-4000-8000-000000000001', 'fc700000-0000-4000-8000-000000000001', 1, 0),
  ('fc800000-0000-4000-8000-000000000001', 'fc700000-0000-4000-8000-000000000002', 2, 18.18),
  ('fc800000-0000-4000-8000-000000000001', 'fc700000-0000-4000-8000-000000000003', 4, 24.00),
  ('fc800000-0000-4000-8000-000000000001', 'fc700000-0000-4000-8000-000000000004', 3, 9.00);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from tpv_sale_prices('fc100000-0000-4000-8000-000000000001')), 2, 'Solo platos (no elaboraciones)');
select is((select suggested_price from tpv_sale_prices('fc100000-0000-4000-8000-000000000001') where recipe_name = 'Arroz pvp'), 18.00::numeric,
  'PVP con IVA del artículo más vendido, sin contar invitaciones');
select is((select portions_sold from tpv_sale_prices('fc100000-0000-4000-8000-000000000001') where recipe_name = 'Arroz pvp'), 10::numeric, 'Raciones vendidas del artículo elegido');
select is((select suggested_price from tpv_sale_prices('fc100000-0000-4000-8000-000000000001') where recipe_name = 'Tarta pvp'), 6.60::numeric, 'Redondeo a 5 céntimos');
select is((select recipe_name from tpv_sale_prices('fc100000-0000-4000-8000-000000000001') limit 1), 'Arroz pvp', 'Primero los platos sin PVP');

-- Sin «ve costes» (personal) no hay ventas que leer.
select set_config('request.jwt.claims', '{"sub":"fc000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from tpv_sale_prices('fc100000-0000-4000-8000-000000000001')), 0, 'El personal sin «ve costes» no ve nada');

select * from finish();
rollback;
