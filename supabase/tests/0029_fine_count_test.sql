begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, email_confirmed_at) values ('f9000000-0000-4000-8000-000000000001', 'conteo-fino@example.com', now());
insert into organizations (id, name) values ('f9100000-0000-4000-8000-000000000001', 'Org conteo fino');
insert into locations (id, org_id, name) values ('f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'Bar conteo');
insert into memberships (org_id, user_id, role, all_locations) values ('f9100000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001', 'manager', true);
insert into products (id, org_id, name, dimension) values
  ('f9300000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'Ginebra conteo', 'volume');
insert into product_packs (id, product_id, name, qty_base, is_count_default, full_weight_g, empty_weight_g) values
  ('f9400000-0000-4000-8000-000000000001', 'f9300000-0000-4000-8000-000000000001', 'Botella 70 cl', 700, true, 1130, 480);

-- Formatos de servicio: se crean como formato más, pero nunca como formato por defecto.
select lives_ok(
  $$insert into product_packs (product_id, name, qty_base, is_serving) values ('f9300000-0000-4000-8000-000000000001', 'Copa 50 ml', 50, true)$$,
  'a serving format can be added'
);
select throws_ok(
  $$insert into product_packs (product_id, name, qty_base, is_serving, is_purchase_default) values ('f9300000-0000-4000-8000-000000000001', 'Chupito 40 ml', 40, true, true)$$,
  '23514', null, 'a serving format cannot be the purchase format'
);
select is(
  (select count(*)::int from product_packs where product_id = 'f9300000-0000-4000-8000-000000000001' and is_serving),
  1,
  'only the valid serving format exists'
);

-- Inventario: había 3 botellas y se cuentan 1,5 (la media botella se guarda con su entrada).
insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost) values
  ('f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'f9300000-0000-4000-8000-000000000001', 'opening', 2100, 0.02);
insert into inventory_counts (id, org_id, location_id) values ('f9500000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001');
insert into count_lines (count_id, product_id, qty, input) values
  ('f9500000-0000-4000-8000-000000000001', 'f9300000-0000-4000-8000-000000000001', 1050, '{"amount":"1","unit":"Botella 70 cl","open":{"fraction":"0.5"}}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$select close_count('f9500000-0000-4000-8000-000000000001', false, false, 'no_existe')$$,
  '22023', 'invalid_reason', 'an unknown reason is rejected'
);
select lives_ok(
  $$select close_count('f9500000-0000-4000-8000-000000000001', false, false, 'merma_no_registrada', '  se rompió una botella  ')$$,
  'a manager closes the count with a reason'
);
select is(
  (select close_reason || ' / ' || close_note from inventory_counts where id = 'f9500000-0000-4000-8000-000000000001'),
  'merma_no_registrada / se rompió una botella',
  'the reason and the note are kept on the count'
);
select is(
  (select type::text || ' ' || qty::text || ' ' || reason from stock_movements where ref_id = 'f9500000-0000-4000-8000-000000000001'),
  'count_adjustment -1050.0000 ajuste de inventario: merma no registrada',
  'the adjustment carries the reason'
);

-- Sin motivo sigue funcionando como antes (el asistente cierra así).
reset role;
insert into inventory_counts (id, org_id, location_id) values ('f9500000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001');
insert into count_lines (count_id, product_id, qty) values ('f9500000-0000-4000-8000-000000000002', 'f9300000-0000-4000-8000-000000000001', 700);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$select close_count('f9500000-0000-4000-8000-000000000002', false, true)$$, 'closing without a reason still works');
select is(
  (select type::text || ' ' || reason from stock_movements where ref_id = 'f9500000-0000-4000-8000-000000000002'),
  'consumption consumo calculado por inventario',
  'missing stock as consumption keeps its usual reason'
);

reset role;

select * from finish();
rollback;
