begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, email_confirmed_at) values
  ('fa500000-0000-4000-8000-000000000001', 'import-recetas-admin@example.com', now()),
  ('fa500000-0000-4000-8000-000000000002', 'import-recetas-encargado@example.com', now());
insert into organizations (id, name) values ('fa510000-0000-4000-8000-000000000001', 'Org recetas');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fa510000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000001', 'admin', true),
  ('fa510000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000002', 'manager', true);
-- Un producto que ya existe en el catálogo (se casa sin la preparación: «Limón (Zumo)» → «Limón»).
insert into products (id, org_id, name, dimension) values ('fa520000-0000-4000-8000-000000000001', 'fa510000-0000-4000-8000-000000000001', 'Limón', 'mass');

create temp table payload as select $json${"recipes": [
  {"name": "Vinagreta", "kind": "elaboracion", "category": "Salsas", "yield_qty": 500, "yield_unit": "g", "lines": [
    {"ingredient": "Aceite suave", "product": "Aceite suave", "dimension": "volume", "qty": 400, "waste": 0, "unit_price": 0.004, "allergens": []},
    {"ingredient": "Limón (Zumo)", "product": "Limón", "dimension": "mass", "qty": 100, "waste": 50, "unit_price": 0.002, "allergens": []},
    {"ingredient": "Mostaza Dijon", "product": "Mostaza Dijon", "dimension": "mass", "qty": 20, "waste": 0, "unit_price": 0.01, "allergens": ["mostaza"]}]},
  {"name": "Ensalada", "kind": "plato", "category": "Entrantes", "yield_qty": 2, "yield_unit": "racion", "lines": [
    {"ingredient": "Lechuga", "product": "Lechuga", "dimension": "count", "qty": 1, "waste": 0, "unit_price": 0.9, "allergens": []},
    {"ingredient": "Vinagreta", "product": "Vinagreta", "dimension": "mass", "qty": 50, "waste": 0, "unit_price": null, "allergens": []}]}
]}$json$::jsonb as p;
grant select on payload to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa500000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select import_recipes('fa510000-0000-4000-8000-000000000001', (select p from payload))$$, '42501', 'forbidden', 'only administrators import recipes');

select set_config('request.jwt.claims', '{"sub":"fa500000-0000-4000-8000-000000000001","role":"authenticated"}', true);
-- Sin crear ingredientes: los que faltan son errores y no se aplica nada.
select is((select jsonb_array_length(import_recipes('fa510000-0000-4000-8000-000000000001', (select p from payload), true, false)->'errors')), 2, 'without creating, unknown ingredients are errors');
select is((select count(*)::int from recipes where org_id = 'fa510000-0000-4000-8000-000000000001'), 0, 'and nothing is written');

-- Vista previa con creación: cuenta lo que crearía y no escribe.
create temp table preview as select import_recipes('fa510000-0000-4000-8000-000000000001', (select p from payload)) as r;
select is((select (r->'stats'->>'products_created')::int from preview), 3, 'the preview counts the ingredients it would create');
select is((select (r->'stats'->>'sub_recipes')::int from preview), 1, 'and links the dish to the elaboration');
select is((select count(*)::int from products where org_id = 'fa510000-0000-4000-8000-000000000001'), 1, 'a preview writes nothing');

-- Aplicar.
select is((select (import_recipes('fa510000-0000-4000-8000-000000000001', (select p from payload), true)->>'applied')::boolean), true, 'the import is applied');
select is(
  (select string_agg(p.name || ':' || p.dimension || ':' || coalesce(trim_scale(sp.last_price)::text, '-'), ', ' order by p.name)
   from products p left join product_packs k on k.product_id = p.id and k.is_purchase_default left join supplier_prices sp on sp.pack_id = k.id
   where p.org_id = 'fa510000-0000-4000-8000-000000000001'),
  'Aceite suave:volume:4, Lechuga:count:0.9, Limón:mass:-, Mostaza Dijon:mass:10',
  'missing ingredients are created with the escandallo price per kg, l or unit; existing ones are matched'
);
select is((select array_agg(allergen) from product_allergens a join products p on p.id = a.product_id where p.name = 'Mostaza Dijon' and p.org_id = 'fa510000-0000-4000-8000-000000000001'), array['mostaza'], 'allergens go to their product');
-- Vinagreta: 400 ml × 0,004 + 100 g / 0,5 × 0,002 (limón sin precio en el catálogo: no cuenta) + 20 × 0,01 = 1,80 € → por g 0,0036.
-- Ensalada: 0,90 + 50 g × 0,0036 = 1,08 € → 0,54 € por ración.
select is((select portion_cost from recipe_costs('fa510000-0000-4000-8000-000000000001') c join recipes r on r.id = c.recipe_id where r.name = 'Ensalada'), 0.5400::numeric, 'costs flow through the imported elaboration');
select is((select missing_prices from recipe_costs('fa510000-0000-4000-8000-000000000001') c join recipes r on r.id = c.recipe_id where r.name = 'Ensalada'), 1, 'the matched product without price is reported');

-- Volver a importar actualiza, no duplica.
select is((select (import_recipes('fa510000-0000-4000-8000-000000000001', (select p from payload), true)->'stats'->>'recipes_updated')::int), 2, 'importing again updates the same recipes');

reset role;
select * from finish();
rollback;
