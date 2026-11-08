begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, email_confirmed_at) values
  ('fb000000-0000-4000-8000-000000000001', 'import-admin@example.com', now()),
  ('fb000000-0000-4000-8000-000000000002', 'import-staff@example.com', now());
insert into organizations (id, name) values ('fb100000-0000-4000-8000-000000000001', 'Org importación');
insert into locations (id, org_id, name) values
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'Barra Norte'),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'Cocina Sur');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'admin', true),
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'staff', true);

create temp table payload as select $json${
  "suppliers": [
    {"code": "BEB", "name": "Bebidas Norte", "email": "pedidos@norte.example.com", "order_days": [1, 4], "order_cutoff": "12:00",
     "lead_time_hours": 24, "min_order": 150, "payment_terms": "30 días", "locations": ["barra norte"]}
  ],
  "products": [
    {"sku": "GIN-01", "name": "Ginebra importada 70 cl", "family": "Bebidas", "subfamily": "Destilados", "dimension": "volume", "vat_rate": 21,
     "count_pack": {"name": "Botella 70 cl", "qty": 700}, "purchase_pack": {"name": "Caja 6", "qty": 4200},
     "supplier": "BEB", "price": 72.6, "supplier_ref": "N-889", "full_weight_g": 1180, "empty_weight_g": 520},
    {"name": "Tónica importada", "family": "Bebidas", "subfamily": "Refrescos", "dimension": "count",
     "purchase_pack": {"name": "Caja 24", "qty": 24}, "supplier": "Bebidas Norte", "price": 14.4},
    {"name": "Sin familia", "dimension": "count"}
  ],
  "assortment": [
    {"location": "Barra Norte", "product": "GIN-01", "min": 2, "max": 6, "zone": "Botellero"},
    {"location": "Barra Norte", "product": "tonica importada", "min": 24, "max": 72},
    {"location": "Local que no existe", "product": "GIN-01", "min": 1, "max": 2}
  ]
}$json$::jsonb as p;
grant select, update on payload to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select import_catalog('fb100000-0000-4000-8000-000000000001', (select p from payload))$$,
  '42501', 'forbidden', 'only administrators can import'
);

select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temp table preview as select import_catalog('fb100000-0000-4000-8000-000000000001', (select p from payload)) as r;
select is((select jsonb_array_length(r->'errors') from preview), 2, 'the preview reports the two bad rows');
select is((select r->'errors'->0->>'message' from preview), 'Indica la familia.', 'a new product needs a family');
select is((select (r->'stats'->'products'->>'created')::int from preview), 2, 'the preview counts two new products');
select is((select (r->>'applied')::boolean from preview), false, 'a preview applies nothing');
select is((select count(*)::int from products where org_id = 'fb100000-0000-4000-8000-000000000001'), 0, 'nothing was written');

-- Con errores tampoco se aplica, aunque se pida.
select is((select (import_catalog('fb100000-0000-4000-8000-000000000001', (select p from payload), true)->>'applied')::boolean), false, 'with errors nothing is applied');

-- Sin las filas malas, se aplica.
update payload set p = jsonb_set(jsonb_set(p, '{products}', (p->'products') - 2), '{assortment}', (p->'assortment') - 2);
select is((select (import_catalog('fb100000-0000-4000-8000-000000000001', (select p from payload), true)->>'applied')::boolean), true, 'a clean import is applied');
select is(
  (select s.code || ' ' || array_to_string(s.order_days, ',') || ' ' || cardinality(s.location_ids) from suppliers s where org_id = 'fb100000-0000-4000-8000-000000000001'),
  'BEB 1,4 1', 'the supplier keeps its terms and locations'
);
select is(
  (select string_agg(k.name || ':' || trim_scale(k.qty_base) || ':' || k.is_count_default || ':' || k.is_purchase_default, ' ' order by k.name)
   from product_packs k join products p on p.id = k.product_id where p.sku = 'GIN-01'),
  'Botella 70 cl:700:true:false Caja 6:4200:false:true', 'count and purchase formats with their defaults'
);
select is(
  (select sp.last_price::text || ' ' || sp.supplier_ref from supplier_prices sp join product_packs k on k.id = sp.pack_id where k.name = 'Caja 6'),
  '72.6000 N-889', 'the purchase price is stored on the purchase format'
);
select is(
  (select trim_scale(lp.min_qty)::text || '-' || trim_scale(lp.par_qty)::text || ' ' || a.name
   from location_products lp join products p on p.id = lp.product_id join storage_areas a on a.id = lp.default_area_id where p.sku = 'GIN-01'),
  '1400-4200 Botellero', 'minimum and maximum are counted in bottles and the zone is created'
);
select is(
  (select c.name || ' › ' || s.name from products p join categories s on s.id = p.category_id join categories c on c.id = s.parent_id where p.name = 'Tónica importada'),
  'Bebidas › Refrescos', 'family and subfamily are created'
);

-- Volver a importar lo mismo no cambia nada; una celda vacía no borra.
select is(
  (select import_catalog('fb100000-0000-4000-8000-000000000001', (select p from payload))->'stats'->'products'->>'unchanged'),
  '2', 'importing the same file again changes nothing'
);
create temp table second as select import_catalog('fb100000-0000-4000-8000-000000000001',
  '{"products": [{"sku": "GIN-01", "price": 75}]}'::jsonb, true) as r;
select is(
  (select sp.last_price::text || ' ' || sp.supplier_ref || ' ' || p.name from supplier_prices sp join product_packs k on k.id = sp.pack_id join products p on p.id = k.product_id where p.sku = 'GIN-01'),
  '75.0000 N-889 Ginebra importada 70 cl', 'a partial row only changes what it carries'
);

-- La exportación tiene la misma forma y vuelve a importarse sin cambios.
select is(
  (select import_catalog('fb100000-0000-4000-8000-000000000001', export_catalog('fb100000-0000-4000-8000-000000000001'))->'stats'->'products'->>'unchanged'),
  '2', 'the export imports back unchanged'
);

reset role;
select * from finish();
rollback;
