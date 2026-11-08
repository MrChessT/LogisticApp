begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, email_confirmed_at) values
  ('ff000000-0000-4000-8000-000000000001', 'escandallo-chef@example.com', now()),
  ('ff000000-0000-4000-8000-000000000002', 'escandallo-camarero@example.com', now());
insert into organizations (id, name) values ('ff100000-0000-4000-8000-000000000001', 'Org escandallos');
insert into memberships (org_id, user_id, role, all_locations) values
  ('ff100000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 'manager', true),
  ('ff100000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000002', 'staff', true);
insert into suppliers (id, org_id, name) values ('ff200000-0000-4000-8000-000000000001', 'ff100000-0000-4000-8000-000000000001', 'Proveedor escandallo');
insert into products (id, org_id, name, dimension) values
  ('ff300000-0000-4000-8000-000000000001', 'ff100000-0000-4000-8000-000000000001', 'Tomate esc', 'mass'),
  ('ff300000-0000-4000-8000-000000000002', 'ff100000-0000-4000-8000-000000000001', 'Aceite esc', 'volume'),
  ('ff300000-0000-4000-8000-000000000003', 'ff100000-0000-4000-8000-000000000001', 'Pan esc', 'count'),
  ('ff300000-0000-4000-8000-000000000004', 'ff100000-0000-4000-8000-000000000001', 'Sal sin precio', 'mass');
insert into product_packs (id, product_id, name, qty_base, is_purchase_default) values
  ('ff400000-0000-4000-8000-000000000001', 'ff300000-0000-4000-8000-000000000001', 'Caja 10 kg', 10000, true),
  ('ff400000-0000-4000-8000-000000000002', 'ff300000-0000-4000-8000-000000000002', 'Garrafa 5 l', 5000, true),
  ('ff400000-0000-4000-8000-000000000003', 'ff300000-0000-4000-8000-000000000003', 'Caja 40', 40, true);
insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at) values
  ('ff200000-0000-4000-8000-000000000001', 'ff400000-0000-4000-8000-000000000001', 20, now()),   -- 2 €/kg
  ('ff200000-0000-4000-8000-000000000001', 'ff400000-0000-4000-8000-000000000002', 40, now()),   -- 8 €/l
  ('ff200000-0000-4000-8000-000000000001', 'ff400000-0000-4000-8000-000000000003', 16, now());   -- 0,40 €/ud
insert into product_allergens values ('ff300000-0000-4000-8000-000000000003', 'gluten');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ff000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Salsa de tomate (elaboración): rinde 800 g. 1 kg de tomate con 20 % de merma + 100 ml de aceite.
insert into recipes (id, org_id, name, kind, yield_qty, yield_unit) values
  ('ff500000-0000-4000-8000-000000000001', 'ff100000-0000-4000-8000-000000000001', 'Salsa de tomate', 'elaboracion', 800, 'g');
insert into recipe_lines (recipe_id, product_id, qty, waste_pct) values
  ('ff500000-0000-4000-8000-000000000001', 'ff300000-0000-4000-8000-000000000001', 1000, 20),
  ('ff500000-0000-4000-8000-000000000001', 'ff300000-0000-4000-8000-000000000002', 100, 0);
-- Tostada (plato, 2 raciones, PVP 6,60 € con 10 % de IVA): 2 panes + 200 g de salsa + sal sin precio.
insert into recipes (id, org_id, name, yield_qty, sale_price, vat_rate, target_food_cost) values
  ('ff500000-0000-4000-8000-000000000002', 'ff100000-0000-4000-8000-000000000001', 'Tostada con tomate', 2, 6.60, 10, 25);
insert into recipe_lines (recipe_id, product_id, sub_recipe_id, qty) values
  ('ff500000-0000-4000-8000-000000000002', 'ff300000-0000-4000-8000-000000000003', null, 2),
  ('ff500000-0000-4000-8000-000000000002', null, 'ff500000-0000-4000-8000-000000000001', 200),
  ('ff500000-0000-4000-8000-000000000002', 'ff300000-0000-4000-8000-000000000004', null, 5);

create temp table rc as select * from recipe_costs('ff100000-0000-4000-8000-000000000001');
-- Salsa: 1000 / 0,8 × 0,002 = 2,50 € + 100 × 0,008 = 0,80 € → 3,30 € por 800 g.
select is((select total_cost from rc where recipe_id = 'ff500000-0000-4000-8000-000000000001'), 3.3000::numeric, 'cleaning waste raises the ingredient cost');
-- Tostada: 2 × 0,40 + 200 g × (3,30 / 800) = 0,80 + 0,825 = 1,625 € → 0,8125 € por ración.
select is((select portion_cost from rc where recipe_id = 'ff500000-0000-4000-8000-000000000002'), 0.8125::numeric, 'sub-recipes are costed per unit of what they yield');
select is((select net_price from rc where recipe_id = 'ff500000-0000-4000-8000-000000000002'), 6.0000::numeric, 'the sale price is taken without VAT');
select is((select food_cost_pct from rc where recipe_id = 'ff500000-0000-4000-8000-000000000002'), 13.5::numeric, 'food cost = portion cost / net price');
select is((select margin from rc where recipe_id = 'ff500000-0000-4000-8000-000000000002'), 5.19::numeric, 'margin per portion');
select is((select recommended_price from rc where recipe_id = 'ff500000-0000-4000-8000-000000000002'), 3.58::numeric, 'recommended price for the target food cost, with VAT');
select is((select missing_prices from rc where recipe_id = 'ff500000-0000-4000-8000-000000000002'), 1, 'ingredients without price are counted');
select is((select allergens from rc where recipe_id = 'ff500000-0000-4000-8000-000000000002'), array['gluten'], 'allergens come from the ingredients');

-- Sin ciclos.
select throws_ok(
  $$insert into recipe_lines (recipe_id, sub_recipe_id, qty) values ('ff500000-0000-4000-8000-000000000001', 'ff500000-0000-4000-8000-000000000002', 1)$$,
  '23514', 'recipe_cycle', 'a recipe cannot contain one that uses it'
);

-- Revisada y luego sube el tomate: avisa del cambio.
select lives_ok($$select mark_recipe_reviewed('ff500000-0000-4000-8000-000000000002')$$, 'a manager marks the recipe as reviewed');
update supplier_prices set last_price = 30 where pack_id = 'ff400000-0000-4000-8000-000000000001';
-- Tomate a 3 €/kg: salsa 4,55 € → tostada 0,80 + 200 × 4,55 / 800 = 1,9375 (antes 1,625): +19,2 %.
select is((select cost_change_pct from recipe_costs('ff100000-0000-4000-8000-000000000001') where recipe_id = 'ff500000-0000-4000-8000-000000000002'), 19.2::numeric, 'a price rise shows how much the recipe changed since review');
select is((select reviewed_cost from recipes where id = 'ff500000-0000-4000-8000-000000000002'), 1.625000::numeric, 'the review cost is stored');

-- El camarero ve recetas y alérgenos, no costes, y no puede tocar el coste de revisión.
select set_config('request.jwt.claims', '{"sub":"ff000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select total_cost from recipe_costs('ff100000-0000-4000-8000-000000000001') where recipe_id = 'ff500000-0000-4000-8000-000000000002'), null, 'staff without the permission gets no costs');
select is((select allergens from recipe_costs('ff100000-0000-4000-8000-000000000001') where recipe_id = 'ff500000-0000-4000-8000-000000000002'), array['gluten'], 'but sees the allergens');

reset role;
select * from finish();
rollback;
