begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into organizations (id, name) values ('fd100000-0000-4000-8000-000000000001', 'Org zonas');
-- Al crear el local la base de datos le pone «Almacén» (almacén) y «Barra» (servicio).
insert into locations (id, org_id, name) values ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Local zonas');
insert into storage_areas (id, location_id, name, sort_order, kind) values
  ('fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'Cámara', 3, 'almacen');
insert into products (id, org_id, name, dimension) values
  ('fd400000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Leche zonas', 'volume'),
  ('fd400000-0000-4000-8000-000000000002', 'fd100000-0000-4000-8000-000000000001', 'Agua zonas', 'count');
insert into location_products (location_id, product_id, default_area_id) values
  ('fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001');

create temp view zone_qty as
select a.name, s.product_id, s.qty from stock_area_balances s join storage_areas a on a.id = s.area_id
where a.location_id = 'fd200000-0000-4000-8000-000000000001';

-- Una recepción sin zona entra en la zona habitual del producto…
insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost) values
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'purchase', 6000, 0.001);
select is((select name || ' ' || trim_scale(qty) from zone_qty where product_id = 'fd400000-0000-4000-8000-000000000001'), 'Cámara 6000', 'stock without a zone goes to the usual zone');
select is((select area_id from stock_movements where product_id = 'fd400000-0000-4000-8000-000000000001'),
  'fd300000-0000-4000-8000-000000000001'::uuid, 'and the movement records that zone');

-- … y si no tiene, al primer almacén del local.
insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost) values
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000002', 'purchase', 24, 0.3);
select is((select name || ' ' || trim_scale(qty) from zone_qty where product_id = 'fd400000-0000-4000-8000-000000000002'), 'Almacén 24', 'without a usual zone it goes to the first storeroom');

-- Se sube leche a la barra (movimientos con zona) y el consumo sale de la barra.
insert into stock_movements (org_id, location_id, product_id, area_id, type, qty) values
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 'internal_move', -2000),
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', (select id from storage_areas where location_id = 'fd200000-0000-4000-8000-000000000001' and name = 'Barra'), 'internal_move', 2000);
insert into stock_movements (org_id, location_id, product_id, type, qty) values
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'consumption', -500);
select is(
  (select string_agg(name || ' ' || trim_scale(qty), ', ' order by name) from zone_qty where product_id = 'fd400000-0000-4000-8000-000000000001'),
  'Barra 1500, Cámara 4000', 'consumption without a zone comes out of the service zone that has it'
);

-- Cuando la barra se queda sin nada, sale de donde quede.
insert into stock_movements (org_id, location_id, product_id, type, qty) values
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'waste', -1500),
  ('fd100000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'consumption', -1000);
select is(
  (select string_agg(name || ' ' || trim_scale(qty), ', ' order by name) from zone_qty where product_id = 'fd400000-0000-4000-8000-000000000001'),
  'Barra 0, Cámara 3000', 'then from wherever stock is left'
);

-- Las zonas suman lo mismo que el local.
select is(
  (select count(*)::int from stock_balances b where b.location_id = 'fd200000-0000-4000-8000-000000000001'
     and b.qty <> (select coalesce(sum(qty), 0) from zone_qty z where z.product_id = b.product_id)),
  0, 'zones add up to the location stock'
);
select is(
  (select count(*)::int from stock_balances b
   where abs(b.qty - coalesce((select sum(s.qty) from stock_area_balances s join storage_areas a on a.id = s.area_id
                               where a.location_id = b.location_id and s.product_id = b.product_id), 0)) > 0.0001
     and exists (select 1 from storage_areas a where a.location_id = b.location_id and a.active)),
  0, 'and so does every location that has zones'
);

select * from finish();
rollback;
