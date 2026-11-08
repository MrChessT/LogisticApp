-- Datos de demostración para el proyecto de pruebas (y la base local). TODO ES FICTICIO: empresa, locales,
-- proveedores, productos, precios y personas son inventados. Nunca se ejecuta en producción.
--
-- Requisitos: las migraciones aplicadas y los usuarios de demo creados antes (scripts/demo/seed.mjs los crea
-- con la API de administración y luego ejecuta este fichero). Es idempotente por organización: si la
-- organización de demo ya existe, la borra entera y la vuelve a crear.
--
-- Qué deja:
--   · «Grupo Ribera (demo)» con 4 locales: 3 de venta y un obrador que reparte cocina.
--   · Familias y ~70 productos con formatos coherentes (contenido, compra, conteo, servicio, pesos).
--   · 9 proveedores con días de pedido, hora límite, plazo, mínimo y pago, y su precio por formato.
--   · Surtido por local con mínimos y máximos, y zonas de almacén y servicio.
--   · 9 semanas de actividad hecha con las mismas funciones que usa la app: stock inicial, pedidos según
--     condiciones, recepciones (algunas con precio distinto o incidencia), consumo diario, mermas de todos
--     los tipos, traspasos desde el obrador y un inventario cerrado con motivo.
--   · Hoy: un pedido enviado pendiente de recibir, un inventario abierto a medias y salidas de almacén
--     pendientes de validar.
--   · Facturas de proveedor de los meses cerrados (una cobra de más, otra aún no ha llegado).

begin;

select setseed(0.4242);

-- Si ya existe la demo, se borra entera (los movimientos son inmutables: se quita el disparador un momento).
do $$
declare
  v_org uuid := 'd0000000-0000-4000-8000-000000000001';
begin
  if exists (select 1 from organizations where id = v_org) then
    alter table stock_movements disable trigger stock_movements_immutable;
    alter table copilot_audit disable trigger copilot_audit_immutable;
    delete from area_moves where org_id = v_org;
    delete from recipe_lines where recipe_id in (select id from recipes where org_id = v_org);
    delete from recipes where org_id = v_org;
    delete from product_allergens where product_id in (select id from products where org_id = v_org);
    delete from count_results where count_id in (select id from inventory_counts where org_id = v_org);
    delete from count_lines where count_id in (select id from inventory_counts where org_id = v_org);
    delete from stock_movements where org_id = v_org;
    delete from stock_area_balances where area_id in (select a.id from storage_areas a join locations l on l.id = a.location_id where l.org_id = v_org);
    delete from stock_balances where location_id in (select id from locations where org_id = v_org);
    delete from inventory_counts where org_id = v_org;
    delete from transfer_lines where transfer_id in (select id from transfers where org_id = v_org);
    delete from transfers where org_id = v_org;
    delete from invoices where org_id = v_org;
    delete from receipt_lines where receipt_id in (select id from goods_receipts where org_id = v_org);
    delete from goods_receipts where org_id = v_org;
    delete from purchase_order_lines where order_id in (select id from purchase_orders where org_id = v_org);
    delete from purchase_orders where org_id = v_org;
    delete from price_history where supplier_id in (select id from suppliers where org_id = v_org);
    delete from supplier_prices where supplier_id in (select id from suppliers where org_id = v_org);
    delete from location_products where location_id in (select id from locations where org_id = v_org);
    delete from product_packs where product_id in (select id from products where org_id = v_org);
    delete from products where org_id = v_org;
    delete from categories where org_id = v_org;
    delete from suppliers where org_id = v_org;
    delete from copilot_drafts where org_id = v_org;
    delete from copilot_sessions where org_id = v_org;
    delete from copilot_audit where org_id = v_org;
    delete from copilot_profiles where org_id = v_org;
    delete from copilot_feedback where org_id = v_org;
    delete from membership_locations where org_id = v_org;
    delete from memberships where org_id = v_org;
    delete from storage_areas where location_id in (select id from locations where org_id = v_org);
    delete from locations where org_id = v_org;
    delete from organizations where id = v_org;
    alter table stock_movements enable trigger stock_movements_immutable;
    alter table copilot_audit enable trigger copilot_audit_immutable;
  end if;
end $$;

-- Personas de la demo (creadas antes por el script). Si falta alguna, se para aquí.
create temp table demo_people (key text primary key, email text, full_name text, role member_role, all_locations boolean, locs text[], can_validate boolean) on commit drop;
insert into demo_people values
  ('owner',   'demo.propietaria@example.com', 'Lucía Prieto (demo)',  'owner',   true,  null, true),
  ('admin',   'demo.admin@example.com',       'Andrés Molina (demo)', 'admin',   true,  null, true),
  ('mgr_ter', 'demo.encargado@example.com',   'Raúl Ortega (demo)',   'manager', false, array['TER', 'BIS'], true),
  ('mgr_cer', 'demo.encargada@example.com',   'Marta Gil (demo)',     'manager', false, array['CER', 'OBR'], true),
  ('staff',   'demo.camarero@example.com',    'Iván Ruiz (demo)',     'staff',   false, array['TER'], false),
  ('kiosk',   'demo.almacen@example.com',     'Pantalla almacén Terraza (demo)', 'kiosk', false, array['TER'], false);

do $$
declare
  missing text;
begin
  select string_agg(p.email, ', ') into missing
  from demo_people p where not exists (select 1 from auth.users u where lower(u.email) = p.email);
  if missing is not null then
    raise exception 'Faltan usuarios de demo (créalos con scripts/demo/seed.mjs): %', missing;
  end if;
end $$;

create temp table demo_ids (key text primary key, id uuid) on commit drop;
insert into demo_ids select p.key, u.id from demo_people p join auth.users u on lower(u.email) = p.email;

-- Organización y locales.
insert into organizations (id, name, business_type) values ('d0000000-0000-4000-8000-000000000001', 'Grupo Ribera (demo)', 'restaurant');

create temp table demo_loc (code text primary key, id uuid, name text, sells_food boolean, sells_drinks boolean) on commit drop;
insert into demo_loc values
  ('TER', 'd0000000-0000-4000-8000-000000000101', 'Terraza del Puerto', true, true),
  ('BIS', 'd0000000-0000-4000-8000-000000000102', 'Bistró Alameda', true, true),
  ('CER', 'd0000000-0000-4000-8000-000000000103', 'Cervecería La Plaza', false, true),
  ('OBR', 'd0000000-0000-4000-8000-000000000104', 'Obrador Central', true, false);
insert into locations (id, org_id, name, kind)
select id, 'd0000000-0000-4000-8000-000000000001', name, case when code = 'OBR' then 'warehouse' else 'venue' end from demo_loc;

-- Zonas (Almacén y Barra las crea la base de datos al dar de alta el local).
insert into storage_areas (location_id, name, sort_order, kind)
select l.id, z.name, z.sort_order, z.kind
from demo_loc l
cross join (values ('Cámara frigorífica', 3, 'almacen'), ('Congelador', 4, 'almacen'), ('Cocina', 5, 'servicio')) z(name, sort_order, kind)
where l.sells_food
on conflict (location_id, name) do nothing;
insert into storage_areas (location_id, name, sort_order, kind)
select id, 'Bodega de barriles', 3, 'almacen' from demo_loc where code = 'CER'
on conflict (location_id, name) do nothing;
update storage_areas set active = false where name = 'Barra' and location_id = (select id from demo_loc where code = 'OBR');

-- Personas y permisos.
insert into profiles (user_id, full_name)
select i.id, p.full_name from demo_people p join demo_ids i using (key)
on conflict (user_id) do update set full_name = excluded.full_name;
insert into memberships (org_id, user_id, role, all_locations, can_validate)
select 'd0000000-0000-4000-8000-000000000001', i.id, p.role, p.all_locations, p.can_validate
from demo_people p join demo_ids i using (key);
insert into membership_locations (org_id, user_id, location_id)
select 'd0000000-0000-4000-8000-000000000001', i.id, l.id
from demo_people p join demo_ids i using (key) cross join unnest(p.locs) c(code) join demo_loc l on l.code = c.code;

-- Familias.
create temp table demo_cat (code text primary key, parent text, name text, sort_order int, id uuid default gen_random_uuid()) on commit drop;
insert into demo_cat (code, parent, name, sort_order) values
  ('BEB', null, 'Bebidas', 1),
  ('DES', 'BEB', 'Destilados', 1),
  ('VIN', 'BEB', 'Vinos y espumosos', 2),
  ('CERV', 'BEB', 'Cervezas', 3),
  ('REF', 'BEB', 'Refrescos y aguas', 4),
  ('CAF', 'BEB', 'Café e infusiones', 5),
  ('COC', null, 'Cocina', 2),
  ('CAR', 'COC', 'Carnes', 1),
  ('PES', 'COC', 'Pescados y mariscos', 2),
  ('FRU', 'COC', 'Frutas y verduras', 3),
  ('LAC', 'COC', 'Lácteos y huevos', 4),
  ('SEC', 'COC', 'Secos y conservas', 5),
  ('ACE', 'COC', 'Aceites y salsas', 6),
  ('LIM', null, 'Limpieza y menaje', 3);
insert into categories (id, org_id, parent_id, name, sort_order)
select c.id, 'd0000000-0000-4000-8000-000000000001', p.id, c.name, c.sort_order
from demo_cat c left join demo_cat p on p.code = c.parent
order by c.parent nulls first;

-- Proveedores (días ISO: 1 = lunes … 7 = domingo).
create temp table demo_sup (code text primary key, id uuid default gen_random_uuid(), name text, contact text, email text, phone text,
  days smallint[], cutoff time, lead_h smallint, min_order numeric, pay text, locs text[]) on commit drop;
insert into demo_sup (code, name, contact, email, phone, days, cutoff, lead_h, min_order, pay, locs) values
  ('BAH', 'Distribuciones Bahía (demo)', 'Sergio', 'pedidos@bahia.example.com', '+34 600 000 101', array[1, 4]::smallint[], '12:00', 24, 150, 'Transferencia a 30 días', array['TER', 'BIS', 'CER']),
  ('NOR', 'Cervezas del Norte (demo)', 'Ane', 'pedidos@cervezasnorte.example.com', '+34 600 000 102', array[2, 5]::smallint[], '11:00', 24, 200, 'Domiciliación a 15 días', array['TER', 'BIS', 'CER']),
  ('VAL', 'Bodegas Valle Alto (demo)', 'Pilar', 'ventas@vallealto.example.com', '+34 600 000 103', array[3]::smallint[], '13:00', 48, 120, 'Transferencia a 30 días', array['TER', 'BIS', 'CER']),
  ('SER', 'Cárnicas Serrano (demo)', 'Tomás', 'pedidos@carnicasserrano.example.com', '+34 600 000 104', array[1, 3, 5]::smallint[], '18:00', 24, 80, 'Transferencia a 15 días', array['OBR', 'BIS']),
  ('LON', 'Pescados Lonja Sur (demo)', 'Nuria', 'lonja@lonjasur.example.com', '+34 600 000 105', array[1, 2, 3, 4, 5, 6]::smallint[], '20:00', 12, 60, 'Contado', array['OBR', 'TER']),
  ('HUE', 'Huerta Viva (demo)', 'Jaime', 'pedidos@huertaviva.example.com', '+34 600 000 106', array[1, 2, 3, 4, 5, 6]::smallint[], '19:00', 12, 40, 'Transferencia semanal', array['OBR', 'TER', 'BIS']),
  ('PRA', 'Lácteos Prado Verde (demo)', 'Elena', 'pedidos@pradoverde.example.com', '+34 600 000 107', array[2, 5]::smallint[], '12:00', 24, 50, 'Domiciliación a 15 días', array['OBR', 'TER', 'BIS']),
  ('ORI', 'Café Tostado Origen (demo)', 'Diego', 'hola@cafeorigen.example.com', '+34 600 000 108', array[2]::smallint[], '10:00', 48, 60, 'Transferencia a 30 días', array['TER', 'BIS', 'CER']),
  ('HIG', 'Higiene Profesional (demo)', 'Carmen', 'pedidos@higienepro.example.com', '+34 600 000 109', array[3]::smallint[], '12:00', 72, 90, 'Transferencia a 60 días', array['TER', 'BIS', 'CER', 'OBR']);
insert into suppliers (id, org_id, name, code, contact_name, email, phone, order_days, order_cutoff, lead_time_hours, min_order, payment_terms, location_ids)
select s.id, 'd0000000-0000-4000-8000-000000000001', s.name, s.code, s.contact, s.email, s.phone, s.days, s.cutoff, s.lead_h, s.min_order, s.pay,
       array(select l.id from unnest(s.locs) c(code) join demo_loc l on l.code = c.code)
from demo_sup s;

-- Productos. kind decide los formatos; price = precio sin IVA del formato de compra; par = máximo por local
-- (en unidades de conteo); where_ = dónde se vende o se usa.
--   spirit  botella 70 cl (conteo, con pesos) · caja 6 (compra) · combinado 50 ml y chupito 40 ml (servicio)
--   wine    botella 75 cl (conteo, con pesos) · caja 6 (compra) · copa 150 ml (servicio)
--   cava    botella 75 cl (conteo) · caja 6 (compra) · copa 150 ml (servicio)
--   keg     barril 30 l (conteo y compra) · caña 200 ml y jarra 500 ml (servicio)
--   bottle  botellín 33 cl (ud, conteo) · caja 24 (compra)
--   can     lata 33 cl (ud, conteo) · bandeja 24 (compra)
--   water   botella 50 cl (ud, conteo) · pack 24 (compra)
--   coffee  paquete 1 kg (conteo y compra)
--   kg      kg (conteo) · caja de N kg (compra)
--   litre   litro (conteo) · garrafa/pack de N l (compra)
--   unit    unidad (conteo) · caja de N (compra)
create temp table demo_prod (code text primary key, cat text, sup text, name text, kind text, vat numeric, price numeric,
  case_qty numeric, par numeric, where_ text, empty_g numeric, id uuid default gen_random_uuid()) on commit drop;
insert into demo_prod (code, cat, sup, name, kind, vat, price, case_qty, par, where_, empty_g) values
  -- Destilados (precio por caja de 6)
  ('GIN1', 'DES', 'BAH', 'Ginebra London Dry 70 cl', 'spirit', 21, 72.60, 6, 8, 'bar', 520),
  ('GIN2', 'DES', 'BAH', 'Ginebra premium cítrica 70 cl', 'spirit', 21, 141.00, 6, 5, 'bar', 610),
  ('RON1', 'DES', 'BAH', 'Ron añejo 70 cl', 'spirit', 21, 84.00, 6, 6, 'bar', 540),
  ('RON2', 'DES', 'BAH', 'Ron blanco 70 cl', 'spirit', 21, 61.20, 6, 5, 'bar', 500),
  ('WHI1', 'DES', 'BAH', 'Whisky escocés blended 70 cl', 'spirit', 21, 90.00, 6, 6, 'bar', 560),
  ('WHI2', 'DES', 'BAH', 'Whisky bourbon 70 cl', 'spirit', 21, 108.00, 6, 4, 'bar', 580),
  ('VOD1', 'DES', 'BAH', 'Vodka 70 cl', 'spirit', 21, 66.00, 6, 5, 'bar', 510),
  ('TEQ1', 'DES', 'BAH', 'Tequila reposado 70 cl', 'spirit', 21, 117.00, 6, 3, 'bar', 600),
  ('VER1', 'DES', 'BAH', 'Vermut rojo 70 cl', 'spirit', 21, 45.60, 6, 6, 'bar', 530),
  ('LIC1', 'DES', 'BAH', 'Licor de hierbas 70 cl', 'spirit', 21, 57.00, 6, 3, 'bar', 520),
  ('BRA1', 'DES', 'BAH', 'Brandy solera 70 cl', 'spirit', 21, 63.00, 6, 3, 'bar', 560),
  -- Vinos (precio por caja de 6)
  ('VT1', 'VIN', 'VAL', 'Vino tinto crianza 75 cl', 'wine', 21, 41.40, 6, 18, 'bar', 480),
  ('VT2', 'VIN', 'VAL', 'Vino tinto joven 75 cl', 'wine', 21, 24.00, 6, 18, 'bar', 470),
  ('VT3', 'VIN', 'VAL', 'Vino tinto reserva 75 cl', 'wine', 21, 78.00, 6, 8, 'food', 520),
  ('VB1', 'VIN', 'VAL', 'Vino blanco verdejo 75 cl', 'wine', 21, 33.00, 6, 18, 'bar', 460),
  ('VB2', 'VIN', 'VAL', 'Vino blanco albariño 75 cl', 'wine', 21, 57.00, 6, 12, 'bar', 470),
  ('VR1', 'VIN', 'VAL', 'Vino rosado 75 cl', 'wine', 21, 27.00, 6, 8, 'bar', 460),
  ('CAV1', 'VIN', 'VAL', 'Cava brut 75 cl', 'cava', 21, 39.00, 6, 12, 'bar', null),
  -- Cervezas
  ('CB1', 'CERV', 'NOR', 'Cerveza rubia barril 30 l', 'keg', 21, 72.00, 1, 4, 'bar', null),
  ('CB2', 'CERV', 'NOR', 'Cerveza tostada barril 30 l', 'keg', 21, 84.00, 1, 2, 'beer', null),
  ('CE1', 'CERV', 'NOR', 'Cerveza rubia botellín 33 cl', 'bottle', 21, 16.80, 24, 96, 'bar', null),
  ('CE2', 'CERV', 'NOR', 'Cerveza sin alcohol botellín 33 cl', 'bottle', 21, 15.60, 24, 48, 'bar', null),
  ('CE3', 'CERV', 'NOR', 'Cerveza IPA botellín 33 cl', 'bottle', 21, 26.40, 24, 48, 'beer', null),
  -- Refrescos y aguas
  ('RF1', 'REF', 'BAH', 'Refresco de cola lata 33 cl', 'can', 10, 13.20, 24, 96, 'bar', null),
  ('RF2', 'REF', 'BAH', 'Refresco de cola zero lata 33 cl', 'can', 10, 13.20, 24, 72, 'bar', null),
  ('RF3', 'REF', 'BAH', 'Refresco de naranja lata 33 cl', 'can', 10, 12.00, 24, 48, 'bar', null),
  ('RF4', 'REF', 'BAH', 'Tónica 20 cl', 'can', 10, 14.40, 24, 96, 'bar', null),
  ('RF5', 'REF', 'BAH', 'Ginger ale 20 cl', 'can', 10, 15.60, 24, 48, 'bar', null),
  ('AG1', 'REF', 'BAH', 'Agua mineral 50 cl', 'water', 10, 5.76, 24, 96, 'bar', null),
  ('AG2', 'REF', 'BAH', 'Agua con gas 50 cl', 'water', 10, 8.40, 24, 48, 'bar', null),
  -- Café
  ('CAF1', 'CAF', 'ORI', 'Café en grano mezcla 1 kg', 'coffee', 10, 17.50, 1, 8, 'bar', null),
  ('CAF2', 'CAF', 'ORI', 'Café descafeinado en grano 1 kg', 'coffee', 10, 19.80, 1, 3, 'bar', null),
  -- Carnes (precio por caja de N kg)
  ('CA1', 'CAR', 'SER', 'Solomillo de ternera', 'kg', 10, 159.00, 5, 6, 'kitchen', null),
  ('CA2', 'CAR', 'SER', 'Entrecot de vaca', 'kg', 10, 132.50, 5, 8, 'kitchen', null),
  ('CA3', 'CAR', 'SER', 'Pechuga de pollo', 'kg', 10, 34.50, 5, 12, 'kitchen', null),
  ('CA4', 'CAR', 'SER', 'Secreto ibérico', 'kg', 10, 74.00, 5, 6, 'kitchen', null),
  ('CA5', 'CAR', 'SER', 'Carne picada mixta', 'kg', 10, 36.00, 5, 8, 'kitchen', null),
  ('CA6', 'CAR', 'SER', 'Jamón ibérico de cebo loncheado', 'kg', 10, 68.00, 1, 3, 'kitchen', null),
  -- Pescados
  ('PE1', 'PES', 'LON', 'Lubina de ración', 'kg', 10, 49.50, 5, 8, 'kitchen', null),
  ('PE2', 'PES', 'LON', 'Lomo de bacalao desalado', 'kg', 10, 72.00, 5, 6, 'kitchen', null),
  ('PE3', 'PES', 'LON', 'Pulpo cocido', 'kg', 10, 92.50, 5, 5, 'kitchen', null),
  ('PE4', 'PES', 'LON', 'Langostino crudo congelado', 'kg', 10, 62.00, 5, 6, 'kitchen', null),
  ('PE5', 'PES', 'LON', 'Calamar limpio', 'kg', 10, 48.00, 5, 6, 'kitchen', null),
  -- Frutas y verduras
  ('FV1', 'FRU', 'HUE', 'Tomate pera', 'kg', 4, 16.50, 10, 20, 'kitchen', null),
  ('FV2', 'FRU', 'HUE', 'Lechuga romana', 'unit', 4, 9.00, 12, 24, 'kitchen', null),
  ('FV3', 'FRU', 'HUE', 'Cebolla', 'kg', 4, 9.50, 10, 20, 'kitchen', null),
  ('FV4', 'FRU', 'HUE', 'Patata', 'kg', 4, 13.00, 25, 50, 'kitchen', null),
  ('FV5', 'FRU', 'HUE', 'Pimiento rojo', 'kg', 4, 13.00, 5, 10, 'kitchen', null),
  ('FV6', 'FRU', 'HUE', 'Limón', 'kg', 4, 9.00, 5, 10, 'all', null),
  ('FV7', 'FRU', 'HUE', 'Lima', 'kg', 4, 14.00, 5, 6, 'bar', null),
  ('FV8', 'FRU', 'HUE', 'Hierbabuena fresca', 'unit', 4, 6.00, 10, 10, 'bar', null),
  ('FV9', 'FRU', 'HUE', 'Aguacate', 'kg', 4, 22.00, 4, 6, 'kitchen', null),
  -- Lácteos y huevos
  ('LA1', 'LAC', 'PRA', 'Leche entera', 'litre', 4, 6.30, 6, 24, 'all', null),
  ('LA2', 'LAC', 'PRA', 'Nata para cocinar 35 %', 'litre', 10, 22.80, 6, 12, 'kitchen', null),
  ('LA3', 'LAC', 'PRA', 'Mantequilla', 'kg', 10, 38.00, 5, 5, 'kitchen', null),
  ('LA4', 'LAC', 'PRA', 'Huevos camperos', 'unit', 4, 9.90, 30, 90, 'kitchen', null),
  ('LA5', 'LAC', 'PRA', 'Queso manchego curado', 'kg', 10, 46.00, 3, 4, 'kitchen', null),
  ('LA6', 'LAC', 'PRA', 'Leche de avena', 'litre', 10, 12.60, 6, 12, 'bar', null),
  -- Secos y conservas
  ('SE1', 'SEC', 'BAH', 'Arroz bomba', 'kg', 10, 27.00, 5, 15, 'kitchen', null),
  ('SE2', 'SEC', 'BAH', 'Harina de trigo', 'kg', 4, 9.50, 10, 20, 'kitchen', null),
  ('SE3', 'SEC', 'BAH', 'Azúcar blanco', 'kg', 10, 11.00, 10, 10, 'all', null),
  ('SE4', 'SEC', 'BAH', 'Pan rústico precocido', 'unit', 4, 14.40, 40, 80, 'kitchen', null),
  ('SE5', 'SEC', 'BAH', 'Aceitunas manzanilla', 'kg', 10, 18.00, 5, 6, 'bar', null),
  -- Aceites y salsas
  ('AC1', 'ACE', 'BAH', 'Aceite de oliva virgen extra', 'litre', 4, 41.50, 5, 20, 'kitchen', null),
  ('AC2', 'ACE', 'BAH', 'Aceite de girasol alto oleico', 'litre', 10, 14.90, 5, 20, 'kitchen', null),
  ('AC3', 'ACE', 'BAH', 'Vinagre de Jerez', 'litre', 10, 4.20, 1, 3, 'kitchen', null),
  -- Limpieza
  ('LI1', 'LIM', 'HIG', 'Detergente lavavajillas industrial', 'litre', 21, 32.00, 20, 40, 'all', null),
  ('LI2', 'LIM', 'HIG', 'Abrillantador lavavajillas', 'litre', 21, 28.00, 10, 20, 'all', null),
  ('LI3', 'LIM', 'HIG', 'Desengrasante de cocina', 'litre', 21, 18.00, 5, 10, 'all', null),
  ('LI4', 'LIM', 'HIG', 'Papel secamanos', 'unit', 21, 21.00, 6, 12, 'all', null),
  ('LI5', 'LIM', 'HIG', 'Guantes de nitrilo talla M', 'unit', 21, 8.50, 10, 10, 'all', null);

insert into products (id, org_id, category_id, name, dimension, sku, vat_rate)
select p.id, 'd0000000-0000-4000-8000-000000000001', c.id, p.name,
       (case when p.kind in ('spirit', 'wine', 'cava', 'keg', 'litre') then 'volume'
             when p.kind in ('coffee', 'kg') then 'mass' else 'count' end)::unit_dimension,
       'DEMO-' || p.code, p.vat
from demo_prod p join demo_cat c on c.code = p.cat;

-- Formatos: (código de producto, nombre, contenido en unidad base, conteo, compra, servicio, peso lleno, peso vacío).
create temp table demo_pack (prod text, name text, qty_base numeric, is_count boolean, is_purchase boolean, is_serving boolean,
  full_g numeric, empty_g numeric, id uuid default gen_random_uuid()) on commit drop;
insert into demo_pack (prod, name, qty_base, is_count, is_purchase, is_serving, full_g, empty_g)
select p.code, f.name, f.qty, f.is_count, f.is_purchase, f.is_serving, f.full_g, f.empty_g
from demo_prod p
cross join lateral (
  select * from (values
    -- destilados: 700 ml de alcohol pesan unos 665 g
    ('spirit', 'Botella 70 cl', 700::numeric, true, false, false, p.empty_g + 665, p.empty_g),
    ('spirit', 'Caja 6 botellas', 4200, false, true, false, null, null),
    ('spirit', 'Combinado 50 ml', 50, false, false, true, null, null),
    ('spirit', 'Chupito 40 ml', 40, false, false, true, null, null),
    ('wine', 'Botella 75 cl', 750, true, false, false, p.empty_g + 750, p.empty_g),
    ('wine', 'Caja 6 botellas', 4500, false, true, false, null, null),
    ('wine', 'Copa de vino 150 ml', 150, false, false, true, null, null),
    ('cava', 'Botella 75 cl', 750, true, false, false, null, null),
    ('cava', 'Caja 6 botellas', 4500, false, true, false, null, null),
    ('cava', 'Copa de cava 120 ml', 120, false, false, true, null, null),
    ('keg', 'Barril 30 l', 30000, true, true, false, null, null),
    ('keg', 'Caña 200 ml', 200, false, false, true, null, null),
    ('keg', 'Jarra 500 ml', 500, false, false, true, null, null),
    ('bottle', 'Botellín', 1, true, false, false, null, null),
    ('bottle', 'Caja 24 botellines', 24, false, true, false, null, null),
    ('can', 'Unidad', 1, true, false, false, null, null),
    ('can', 'Bandeja 24 unidades', 24, false, true, false, null, null),
    ('water', 'Botella', 1, true, false, false, null, null),
    ('water', 'Pack 24 botellas', 24, false, true, false, null, null),
    ('coffee', 'Paquete 1 kg', 1000, true, true, false, null, null),
    ('kg', 'Kilo', 1000, true, false, false, null, null),
    ('kg', 'Caja ' || trim_scale(p.case_qty)::text || ' kg', p.case_qty * 1000, false, true, false, null, null),
    ('litre', 'Litro', 1000, true, false, false, null, null),
    ('litre', 'Envase ' || trim_scale(p.case_qty)::text || ' l', p.case_qty * 1000, false, true, false, null, null),
    ('unit', 'Unidad', 1, true, false, false, null, null),
    ('unit', 'Caja ' || trim_scale(p.case_qty)::text || ' unidades', p.case_qty, false, true, false, null, null)
  ) v(kind, name, qty, is_count, is_purchase, is_serving, full_g, empty_g)
  where v.kind = p.kind
) f;
-- Un kilo o un litro sueltos no tienen sentido como compra si la caja es de 1: queda solo un formato.
delete from demo_pack d using demo_prod p
where p.code = d.prod and p.case_qty = 1 and p.kind in ('kg', 'litre') and not d.is_count;
update demo_pack d set is_purchase = true from demo_prod p
where p.code = d.prod and p.case_qty = 1 and p.kind in ('kg', 'litre') and d.is_count;

insert into product_packs (id, product_id, name, qty_base, is_count_default, is_purchase_default, is_serving, full_weight_g, empty_weight_g)
select d.id, p.id, d.name, d.qty_base, d.is_count, d.is_purchase, d.is_serving, d.full_g, d.empty_g
from demo_pack d join demo_prod p on p.code = d.prod;

-- Precio de compra por proveedor y formato de compra (30 días antes: lo irán actualizando las recepciones).
insert into supplier_prices (supplier_id, pack_id, supplier_ref, last_price, last_price_at)
select s.id, d.id, s.code || '-' || p.code, p.price, now() - interval '36 days'
from demo_prod p join demo_sup s on s.code = p.sup join demo_pack d on d.prod = p.code and d.is_purchase;

-- Surtido: qué vende o usa cada local. par en unidades de conteo → mínimo = 40 % del máximo.
create temp table demo_lp on commit drop as
select l.code as loc, l.id as location_id, p.code as prod, p.id as product_id,
       p.par * cp.qty_base * case when l.code = 'OBR' then 2.5 when l.code = 'CER' and p.where_ in ('bar', 'beer') then 1.4 else 1 end as par_base
from demo_prod p
join demo_pack cp on cp.prod = p.code and cp.is_count
join demo_loc l on (
     (p.where_ = 'bar' and l.sells_drinks)
  or (p.where_ = 'beer' and l.code in ('CER', 'TER'))
  or (p.where_ = 'food' and l.code in ('BIS', 'TER'))
  or (p.where_ = 'kitchen' and l.sells_food)
  or (p.where_ = 'all'))
join demo_sup s on s.code = p.sup and (l.code = any(s.locs || array['OBR']) or p.cat in ('CAR', 'PES'));
-- La cocina de Terraza y Bistró recibe carnes y pescados del obrador, no del proveedor.
insert into location_products (location_id, product_id, min_qty, par_qty, default_area_id, active)
select lp.location_id, lp.product_id, round(lp.par_base * 0.4), round(lp.par_base),
       (select a.id from storage_areas a where a.location_id = lp.location_id and a.name =
          case when p.cat in ('CAR', 'PES', 'LAC', 'FRU') then 'Cámara frigorífica'
               when p.kind = 'keg' and lp.loc = 'CER' then 'Bodega de barriles'
               else 'Almacén' end), true
from demo_lp lp join demo_prod p on p.code = lp.prod;

-- ---------------------------------------------------------------------------------------------------------
-- Actividad: 63 días hasta ayer, día a día, con las mismas funciones que usa la app. Al terminar cada día se
-- fechan los documentos y movimientos creados ese día (dentro de esta transacción now() no avanza).
-- ---------------------------------------------------------------------------------------------------------
create temp table demo_ctx (key text primary key, val text) on commit drop;

create or replace function pg_temp.demo_act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Fecha lo que se ha creado «ahora» con la hora indicada.
create or replace function pg_temp.demo_stamp(p_at timestamptz) returns void language plpgsql as $$
begin
  update stock_movements set occurred_at = p_at, created_at = p_at
  where org_id = 'd0000000-0000-4000-8000-000000000001' and created_at = now();
  update goods_receipts set created_at = p_at, posted_at = case when posted_at = now() then p_at else posted_at end, doc_date = p_at::date
  where org_id = 'd0000000-0000-4000-8000-000000000001' and created_at = now();
  update purchase_orders set created_at = case when created_at = now() then p_at else created_at end,
         sent_at = case when sent_at = now() then p_at else sent_at end,
         closed_at = case when closed_at = now() then p_at else closed_at end
  where org_id = 'd0000000-0000-4000-8000-000000000001' and now() in (created_at, sent_at, closed_at);
  update transfers set created_at = case when created_at = now() then p_at else created_at end,
         sent_at = case when sent_at = now() then p_at else sent_at end,
         received_at = case when received_at = now() then p_at else received_at end
  where org_id = 'd0000000-0000-4000-8000-000000000001' and now() in (created_at, sent_at, received_at);
  update inventory_counts set started_at = case when started_at = now() then p_at else started_at end,
         closed_at = case when closed_at = now() then p_at else closed_at end
  where org_id = 'd0000000-0000-4000-8000-000000000001' and now() in (started_at, closed_at);
  update price_history set recorded_at = p_at
  where recorded_at = now() and supplier_id in (select id from suppliers where org_id = 'd0000000-0000-4000-8000-000000000001');
  update supplier_prices set last_price_at = p_at
  where last_price_at = now() and supplier_id in (select id from suppliers where org_id = 'd0000000-0000-4000-8000-000000000001');
end $$;

alter table stock_movements disable trigger stock_movements_immutable;

do $$
declare
  v_org constant uuid := 'd0000000-0000-4000-8000-000000000001';
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_day date;
  v_at timestamptz;
  l record;
  r record;
  v_mgr uuid;
  v_order uuid;
  v_lines jsonb;
  v_transfer uuid;
  v_count uuid;
  v_qty numeric;
  v_dow int;
  v_weekend boolean;
  v_bal numeric;
begin
  -- Día -35: stock inicial (entre el 60 % y el 100 % del máximo) al coste del proveedor, en su zona.
  v_at := ((v_today - 63)::timestamp + time '09:00') at time zone 'Europe/Madrid';
  for l in select lp.*, lpr.default_area_id,
                  (sp.last_price / pk.qty_base) as unit_cost
           from demo_lp lp
           join location_products lpr on lpr.location_id = lp.location_id and lpr.product_id = lp.product_id
           join demo_prod p on p.code = lp.prod
           join demo_pack pk on pk.prod = p.code and pk.is_purchase
           join supplier_prices sp on sp.pack_id = pk.id
  loop
    insert into stock_movements (org_id, location_id, product_id, area_id, type, qty, unit_cost, reason, occurred_at, created_by)
    values (v_org, l.location_id, l.product_id, l.default_area_id, 'opening',
            round(l.par_base * (0.6 + random() * 0.4)), round(l.unit_cost, 6), 'stock inicial', v_at,
            (select id from demo_ids where key = 'admin'));
  end loop;
  perform pg_temp.demo_stamp(v_at);

  for v_day in select generate_series(v_today - 62, v_today - 1, interval '1 day')::date loop
    v_dow := extract(isodow from v_day);
    v_weekend := v_dow in (5, 6, 7);

    -- 1) Recepciones de los pedidos enviados que llegan hoy (según el plazo del proveedor).
    for r in
      select o.id, o.location_id, o.supplier_id, s.code as sup
      from purchase_orders o join demo_sup s on s.id = o.supplier_id
      where o.org_id = v_org and o.status = 'sent' and o.expected_date = v_day
    loop
      v_mgr := (select id from demo_ids where key = case when r.location_id in (select id from demo_loc where code in ('TER', 'BIS')) then 'mgr_ter' else 'mgr_cer' end);
      perform pg_temp.demo_act_as(v_mgr);
      -- Casi todo llega bien; de vez en cuando falta algo, viene roto o el albarán cobra otro precio.
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'pack_id', pol.pack_id,
               'packs_qty', case when x.rnd < 0.02 and pol.packs_qty > 1 then pol.packs_qty - 1 else pol.packs_qty end,
               'pack_price', case when x.rnd between 0.02 and 0.05 then round(pol.pack_price * 1.04, 2) else pol.pack_price end,
               'incident', case when x.rnd < 0.02 and pol.packs_qty > 1 then 'faltante'
                                when x.rnd between 0.02 and 0.05 then 'precio_distinto'
                                when x.rnd between 0.05 and 0.06 then 'roto' end,
               'incident_note', case when x.rnd < 0.02 and pol.packs_qty > 1 then 'Falta un bulto, viene en el próximo reparto'
                                     when x.rnd between 0.02 and 0.05 then 'Subida de tarifa no avisada'
                                     when x.rnd between 0.05 and 0.06 then 'Un envase llegó dañado; se aparta para abono' end)))
        into v_lines
      from purchase_order_lines pol cross join lateral (select random() + 0 * pol.packs_qty as rnd) x
      where pol.order_id = r.id;
      set local role authenticated;
      perform receive_order(r.id, v_lines, 'ALB-' || to_char(v_day, 'MMDD') || '-' || upper(r.sup), v_day, true);
      reset role;
    end loop;

    -- 2) Pedidos: cada proveedor, en su día, para los locales donde algo está por debajo del mínimo.
    for r in
      select s.id as supplier_id, s.code, s.lead_h, dl.id as location_id, dl.code as loc
      from demo_sup s join demo_loc dl on dl.code = any(s.locs)
      where v_dow = any(s.days)
    loop
      -- Carnes y pescados de Terraza y Bistró los manda el obrador; no se piden al proveedor.
      continue when r.loc in ('TER', 'BIS') and r.code in ('SER', 'LON');
      if not exists (
        select 1 from demo_lp lp join demo_prod p on p.code = lp.prod and p.sup = r.code
        left join stock_balances b on b.location_id = lp.location_id and b.product_id = lp.product_id
        where lp.location_id = r.location_id and coalesce(b.qty, 0) < lp.par_base * 0.65
      ) then
        continue;
      end if;
      v_mgr := (select id from demo_ids where key = case when r.loc in ('TER', 'BIS') then 'mgr_ter' else 'mgr_cer' end);
      insert into purchase_orders (org_id, location_id, supplier_id, status, created_by, expected_date)
      values (v_org, r.location_id, r.supplier_id, 'draft', v_mgr, v_day + greatest(1, ceil(r.lead_h / 24.0))::int)
      returning id into v_order;
      -- Se pide hasta el máximo lo que está por debajo del 60 % (redondeando a formatos de compra).
      insert into purchase_order_lines (order_id, pack_id, packs_qty, pack_price)
      select v_order, pk.id, greatest(1, ceil((lp.par_base - coalesce(b.qty, 0)) / pk.qty_base)), sp.last_price
      from demo_lp lp
      join demo_prod p on p.code = lp.prod and p.sup = r.code
      join demo_pack pk on pk.prod = p.code and pk.is_purchase
      join supplier_prices sp on sp.pack_id = pk.id
      left join stock_balances b on b.location_id = lp.location_id and b.product_id = lp.product_id
      where lp.location_id = r.location_id and coalesce(b.qty, 0) < lp.par_base * 0.8;
      -- Si no llega al pedido mínimo del proveedor, se sube la cantidad (como haría el encargado).
      select coalesce(sum(packs_qty * pack_price), 0) into v_qty from purchase_order_lines where order_id = v_order;
      if v_qty > 0 and v_qty < (select min_order from demo_sup where code = r.code) then
        update purchase_order_lines
        set packs_qty = packs_qty * ceil((select min_order from demo_sup where code = r.code) / v_qty)
        where order_id = v_order;
      end if;
      perform pg_temp.demo_act_as(v_mgr);
      set local role authenticated;
      perform send_order(v_order);
      reset role;
    end loop;

    -- 3) Traspasos del obrador a las cocinas (lunes y jueves): carnes, pescados y lácteos.
    if v_dow in (1, 4) then
      for l in select * from demo_loc where code in ('TER', 'BIS') loop
        insert into transfers (org_id, from_location_id, to_location_id, status, created_by, note)
        values (v_org, (select id from demo_loc where code = 'OBR'), l.id, 'draft', (select id from demo_ids where key = 'mgr_cer'), 'Reparto de cocina')
        returning id into v_transfer;
        insert into transfer_lines (transfer_id, product_id, qty_sent)
        select v_transfer, lp.product_id, least(round(lp.par_base - coalesce(b.qty, 0)), round(coalesce(ob.qty, 0) * 0.5))
        from demo_lp lp
        join demo_prod p on p.code = lp.prod and p.cat in ('CAR', 'PES')
        left join stock_balances b on b.location_id = lp.location_id and b.product_id = lp.product_id
        left join stock_balances ob on ob.location_id = (select id from demo_loc where code = 'OBR') and ob.product_id = lp.product_id
        where lp.location_id = l.id
          and least(round(lp.par_base - coalesce(b.qty, 0)), round(coalesce(ob.qty, 0) * 0.5)) >= 500;
        if not exists (select 1 from transfer_lines where transfer_id = v_transfer) then
          delete from transfers where id = v_transfer;
          continue;
        end if;
        perform pg_temp.demo_act_as((select id from demo_ids where key = 'mgr_cer'));
        set local role authenticated;
        perform send_transfer(v_transfer);
        reset role;
        perform pg_temp.demo_act_as((select id from demo_ids where key = 'mgr_ter'));
        set local role authenticated;
        perform receive_transfer(v_transfer, null);
        reset role;
      end loop;
    end if;

    perform pg_temp.demo_stamp(((v_day)::timestamp + time '10:30') at time zone 'Europe/Madrid');

    -- 4) Consumo del día (ventas que no se registran una a una): más el fin de semana, nunca por debajo de 0.
    for l in
      select lp.*, p.kind, pk.qty_base as count_qty,
             case when p.cat in ('CAR', 'PES') then 2 else cardinality(s.days) end as deliveries
      from demo_lp lp join demo_prod p on p.code = lp.prod join demo_pack pk on pk.prod = p.code and pk.is_count
      join demo_sup s on s.code = p.sup
      where lp.loc <> 'OBR' and p.cat not in ('LIM')
    loop
      select coalesce(qty, 0) into v_bal from stock_balances where location_id = l.location_id and product_id = l.product_id;
      -- Ritmo de consumo acorde a cada cuánto sirve el proveedor (entre reparto y reparto se gasta ~la mitad).
      v_qty := l.par_base * least(0.3, 0.5 * l.deliveries / 7.0) * (0.6 + random() * 0.8) * case when v_weekend then 1.3 else 0.85 end;
      v_qty := least(round(v_qty), floor(coalesce(v_bal, 0) * 0.9));
      continue when v_qty <= 0;
      insert into stock_movements (org_id, location_id, product_id, type, qty, reason, occurred_at, created_at, created_by)
      values (v_org, l.location_id, l.product_id, 'consumption', -v_qty, 'consumo del día',
              ((v_day)::timestamp + time '23:30') at time zone 'Europe/Madrid', ((v_day)::timestamp + time '23:30') at time zone 'Europe/Madrid',
              (select id from demo_ids where key = 'staff'));
    end loop;
    -- El obrador gasta limpieza y lo que reparte se descuenta con los traspasos.
    for l in select lp.* from demo_lp lp join demo_prod p on p.code = lp.prod where p.cat = 'LIM' loop
      select coalesce(qty, 0) into v_bal from stock_balances where location_id = l.location_id and product_id = l.product_id;
      v_qty := least(round(l.par_base / 20.0 * (0.5 + random())), floor(coalesce(v_bal, 0) * 0.9));
      continue when v_qty <= 0;
      insert into stock_movements (org_id, location_id, product_id, type, qty, reason, occurred_at, created_at, created_by)
      values (v_org, l.location_id, l.product_id, 'consumption', -v_qty, 'consumo del día',
              ((v_day)::timestamp + time '23:30') at time zone 'Europe/Madrid', ((v_day)::timestamp + time '23:30') at time zone 'Europe/Madrid',
              (select id from demo_ids where key = 'staff'));
    end loop;

    -- 5) Salidas que no son venta. Bebida: roturas, invitaciones, personal, catas y eventos, en copas o
    --    chupitos. Cocina: sobre todo género en mal estado o caducado, y la comida del personal, en raciones.
    for l in
      select lp.*, p.kind, p.cat, pk.qty_base as count_qty, srv.qty_base as serving_qty, x.rnd,
             case when p.cat in ('DES', 'VIN', 'CERV', 'REF', 'CAF')
                  then (case when x.rnd < 0.35 then 'merma' when x.rnd < 0.6 then 'invitacion' when x.rnd < 0.75 then 'consumo_personal'
                             when x.rnd < 0.85 then 'degustacion' else 'evento' end)
                  else (case when x.rnd < 0.75 then 'merma' else 'consumo_personal' end) end::exit_kind as kind_
      from demo_lp lp join demo_prod p on p.code = lp.prod
      join demo_pack pk on pk.prod = p.code and pk.is_count
      left join lateral (select qty_base from demo_pack s where s.prod = p.code and s.is_serving order by qty_base desc limit 1) srv on true
      cross join lateral (select random() + 0 * lp.par_base as rnd) x
      where lp.loc <> 'OBR' and p.cat <> 'LIM' and random() < 0.03
    loop
      select coalesce(qty, 0) into v_bal from stock_balances where location_id = l.location_id and product_id = l.product_id;
      v_qty := case
        when l.serving_qty is not null then l.serving_qty * (1 + floor(random() * 3))               -- 1 a 3 copas o cañas
        when l.kind in ('kg', 'litre', 'coffee') then round((l.count_qty * (0.15 + random() * 0.35))::numeric, -1) -- 150 a 500 g o ml
        else 1 + floor(random() * 2) end;                                                              -- 1 o 2 unidades
      v_qty := least(v_qty, floor(coalesce(v_bal, 0) * 0.5));
      continue when v_qty <= 0;
      insert into stock_movements (org_id, location_id, product_id, type, qty, reason, exit_kind, occurred_at, created_at, created_by)
      values (v_org, l.location_id, l.product_id, 'waste', -v_qty,
              case l.kind_
                when 'merma' then case when l.cat in ('DES', 'VIN', 'CERV', 'REF', 'CAF')
                                       then (array['se cayó en barra', 'error de comanda', 'botella rota al reponer', 'devuelto por el cliente'])[1 + floor(random() * 4)::int]
                                       else (array['caducado', 'mal estado', 'se quemó en cocina', 'devuelto por el cliente'])[1 + floor(random() * 4)::int] end
                when 'invitacion' then 'invitación a cliente habitual'
                when 'consumo_personal' then case when l.cat in ('DES', 'VIN', 'CERV', 'REF', 'CAF') then 'bebida del personal' else 'comida del personal' end
                when 'degustacion' then 'cata para carta nueva'
                else 'evento privado' end,
              l.kind_, ((v_day)::timestamp + time '22:00') at time zone 'Europe/Madrid', ((v_day)::timestamp + time '22:00') at time zone 'Europe/Madrid',
              (select id from demo_ids where key = 'staff'));
    end loop;

    -- 6) Inventario de Terraza a mitad del periodo: lo contado se parece a lo esperado, con algún desvío.
    if v_day = v_today - 14 then
      insert into inventory_counts (org_id, location_id, started_by, note)
      values (v_org, (select id from demo_loc where code = 'TER'), (select id from demo_ids where key = 'mgr_ter'), 'Inventario quincenal de barra')
      returning id into v_count;
      insert into count_lines (count_id, product_id, qty, input)
      select v_count, b.product_id,
             greatest(0, round(b.qty * case when random() < 0.15 then 0.9 + random() * 0.08 else 1 end)),
             jsonb_build_object('amount', round(b.qty / pk.qty_base, 2)::text, 'unit', pk.name)
      from stock_balances b
      join demo_lp lp on lp.location_id = b.location_id and lp.product_id = b.product_id
      join demo_prod p on p.code = lp.prod and p.cat in ('DES', 'VIN', 'CERV', 'REF')
      join demo_pack pk on pk.prod = p.code and pk.is_count
      where b.location_id = (select id from demo_loc where code = 'TER');
      perform pg_temp.demo_act_as((select id from demo_ids where key = 'mgr_ter'));
      set local role authenticated;
      perform close_count(v_count, false, false, 'consumo_no_registrado', 'Invitaciones de la boda del sábado sin apuntar');
      reset role;
      perform pg_temp.demo_stamp(((v_day)::timestamp + time '08:00') at time zone 'Europe/Madrid');
    end if;
  end loop;

  -- Hoy: los pedidos que aún no han llegado quedan enviados; inventario abierto en Bistró a medias.
  insert into inventory_counts (org_id, location_id, started_by, note)
  values (v_org, (select id from demo_loc where code = 'BIS'), (select id from demo_ids where key = 'mgr_ter'), 'Inventario mensual')
  returning id into v_count;
  insert into count_lines (count_id, product_id, qty, input)
  select v_count, b.product_id, round(b.qty), jsonb_build_object('amount', round(b.qty / pk.qty_base, 2)::text, 'unit', pk.name)
  from stock_balances b
  join demo_lp lp on lp.location_id = b.location_id and lp.product_id = b.product_id
  join demo_prod p on p.code = lp.prod and p.cat = 'DES'
  join demo_pack pk on pk.prod = p.code and pk.is_count
  where b.location_id = (select id from demo_loc where code = 'BIS');
end $$;

alter table stock_movements enable trigger stock_movements_immutable;

-- Salidas de almacén a barra pendientes de validar en Terraza (las hace la pantalla del almacén).
do $$
declare
  v_ter uuid := (select id from demo_loc where code = 'TER');
  v_from uuid := (select id from storage_areas where location_id = (select id from demo_loc where code = 'TER') and name = 'Almacén');
  v_to uuid := (select id from storage_areas where location_id = (select id from demo_loc where code = 'TER') and name = 'Barra');
  r record;
begin
  perform pg_temp.demo_act_as((select id from demo_ids where key = 'kiosk'));
  for r in
    select p.id as product_id, pk.qty_base, pk.name
    from demo_prod dp join products p on p.id = dp.id
    join demo_pack pk on pk.prod = dp.code and pk.is_count
    join stock_area_balances b on b.product_id = p.id and b.area_id = v_from and b.qty >= pk.qty_base * 2
    where dp.cat = 'DES' order by dp.code limit 3
  loop
    set local role authenticated;
    perform area_move_submit(v_ter, v_from, v_to, r.product_id, r.qty_base * 2,
                             jsonb_build_object('amount', '2', 'unit', r.name), 'salida', gen_random_uuid(), null);
    reset role;
  end loop;
end $$;

-- Alérgenos de los productos y escandallos: 3 elaboraciones base, 8 platos y un combinado.
insert into product_allergens (product_id, allergen)
select p.id, a.allergen from demo_prod p
join (values ('SE2', 'gluten'), ('SE4', 'gluten'), ('CB1', 'gluten'), ('CB2', 'gluten'), ('CE1', 'gluten'), ('CE3', 'gluten'),
             ('LA4', 'huevo'), ('LA1', 'lacteos'), ('LA2', 'lacteos'), ('LA3', 'lacteos'), ('LA5', 'lacteos'),
             ('PE1', 'pescado'), ('PE2', 'pescado'), ('PE4', 'crustaceos'), ('PE3', 'moluscos'), ('PE5', 'moluscos'),
             ('AC3', 'sulfitos'), ('VT1', 'sulfitos'), ('VT2', 'sulfitos'), ('VT3', 'sulfitos'), ('VB1', 'sulfitos'),
             ('VB2', 'sulfitos'), ('VR1', 'sulfitos'), ('CAV1', 'sulfitos')) a(code, allergen) on a.code = p.code;

create temp table demo_recipe (code text primary key, id uuid default gen_random_uuid(), name text, kind text, category text,
  yield_qty numeric, yield_unit text, price numeric, vat numeric, target numeric, steps text) on commit drop;
insert into demo_recipe (code, name, kind, category, yield_qty, yield_unit, price, vat, target, steps) values
  ('SOF', 'Sofrito de tomate', 'elaboracion', 'Bases', 600, 'g', null, 10, 30, 'Pochar la cebolla 15 min, añadir el tomate rallado y reducir a fuego lento 40 min.'),
  ('BEC', 'Bechamel para croquetas', 'elaboracion', 'Bases', 1200, 'g', null, 10, 30, 'Roux de mantequilla y harina 3 min; leche caliente poco a poco hasta espesar.'),
  ('MAY', 'Mayonesa casera', 'elaboracion', 'Salsas', 350, 'g', null, 10, 30, 'Emulsionar huevo, limón y vinagre con el aceite en hilo. Conservar en frío 48 h.'),
  ('CRO', 'Croquetas de jamón (8 uds)', 'plato', 'Entrantes', 8, 'racion', 9.50, 10, 28, null),
  ('BRA', 'Patatas bravas', 'plato', 'Entrantes', 4, 'racion', 6.50, 10, 25, null),
  ('ARR', 'Arroz negro de calamar', 'plato', 'Arroces', 4, 'racion', 18.00, 10, 30, null),
  ('PUL', 'Pulpo a la gallega', 'plato', 'Principales', 2, 'racion', 19.50, 10, 32, null),
  ('LUB', 'Lubina a la plancha con patatas', 'plato', 'Principales', 1, 'racion', 21.00, 10, 32, null),
  ('ENT', 'Entrecot con patatas', 'plato', 'Principales', 1, 'racion', 24.00, 10, 35, null),
  ('ENS', 'Ensalada de aguacate y langostino', 'plato', 'Entrantes', 2, 'racion', 14.00, 10, 30, null),
  ('TOS', 'Tostada de jamón con tomate', 'plato', 'Desayunos', 2, 'racion', 8.00, 10, 30, null),
  ('GIN', 'Gin tonic de la casa', 'plato', 'Barra', 1, 'racion', 9.00, 10, 20, 'Copa balón con hielo, 50 ml de ginebra, tónica fría y piel de lima.');
insert into recipes (id, org_id, name, kind, category, yield_qty, yield_unit, sale_price, vat_rate, target_food_cost, instructions)
select id, 'd0000000-0000-4000-8000-000000000001', name, kind, category, yield_qty, yield_unit, price, vat, target, steps from demo_recipe;

-- (receta, producto o elaboración, cantidad en unidad base o en lo que rinde la elaboración, merma %)
insert into recipe_lines (recipe_id, product_id, sub_recipe_id, qty, waste_pct, sort_order)
select r.id, p.id, s.id, l.qty, l.waste, l.ord
from (values
  ('SOF', 'FV1', null, 1000, 10, 1), ('SOF', 'FV3', null, 300, 10, 2), ('SOF', 'AC1', null, 100, 0, 3),
  ('BEC', 'LA1', null, 1000, 0, 1), ('BEC', 'LA3', null, 80, 0, 2), ('BEC', 'SE2', null, 90, 0, 3),
  ('MAY', 'LA4', null, 2, 0, 1), ('MAY', 'AC2', null, 300, 0, 2), ('MAY', 'FV6', null, 30, 50, 3), ('MAY', 'AC3', null, 10, 0, 4),
  ('CRO', null, 'BEC', 1200, 0, 1), ('CRO', 'CA6', null, 200, 0, 2), ('CRO', 'LA4', null, 3, 0, 3), ('CRO', 'SE4', null, 2, 0, 4), ('CRO', 'AC2', null, 500, 0, 5),
  ('BRA', 'FV4', null, 1200, 15, 1), ('BRA', null, 'SOF', 200, 0, 2), ('BRA', null, 'MAY', 120, 0, 3), ('BRA', 'AC2', null, 300, 0, 4),
  ('ARR', 'SE1', null, 400, 0, 1), ('ARR', 'PE5', null, 600, 10, 2), ('ARR', null, 'SOF', 250, 0, 3), ('ARR', 'AC1', null, 60, 0, 4),
  ('PUL', 'PE3', null, 400, 0, 1), ('PUL', 'FV4', null, 400, 15, 2), ('PUL', 'AC1', null, 30, 0, 3),
  ('LUB', 'PE1', null, 450, 45, 1), ('LUB', 'FV4', null, 200, 15, 2), ('LUB', 'FV2', null, 1, 0, 3), ('LUB', 'AC1', null, 20, 0, 4), ('LUB', 'FV6', null, 30, 50, 5),
  ('ENT', 'CA2', null, 300, 8, 1), ('ENT', 'FV4', null, 250, 15, 2), ('ENT', 'AC2', null, 50, 0, 3),
  ('ENS', 'FV9', null, 300, 30, 1), ('ENS', 'PE4', null, 200, 40, 2), ('ENS', 'FV2', null, 1, 0, 3), ('ENS', 'FV1', null, 200, 10, 4), ('ENS', 'AC1', null, 30, 0, 5), ('ENS', 'AC3', null, 10, 0, 6),
  ('TOS', 'SE4', null, 1, 0, 1), ('TOS', 'FV1', null, 150, 10, 2), ('TOS', 'CA6', null, 60, 0, 3), ('TOS', 'AC1', null, 15, 0, 4),
  ('GIN', 'GIN1', null, 50, 0, 1), ('GIN', 'RF4', null, 1, 0, 2), ('GIN', 'FV7', null, 20, 0, 3)
) l(recipe, product, sub, qty, waste, ord)
join demo_recipe r on r.code = l.recipe
left join demo_prod p on p.code = l.product
left join demo_recipe s on s.code = l.sub;

-- Dos platos revisados hace un mes con un coste algo menor: enseñan el aviso de «coste cambiado».
select set_config('app.recipe_review', 'on', true);
update recipes r set reviewed_cost = round((select t.total from recipe_total_cost(r.id) t) * x.f, 4), reviewed_at = now() - interval '30 days'
from (values ('ARR', 0.88), ('ENS', 0.92)) x(code, f) join demo_recipe d on d.code = x.code
where r.id = d.id;
select set_config('app.recipe_review', '', true);

-- Facturas: cada proveedor factura a fin de mes sus albaranes de ese mes. Los meses ya cerrados están
-- facturados (el más antiguo, pagado); los del mes en curso siguen sin factura. Para que se vea el cuadre,
-- la carne cobra 18 € de más en octubre y la limpieza aún no ha mandado la de octubre.
create temp table demo_inv on commit drop as
select g.supplier_id, s.code as sup, s.payment_terms, (date_trunc('month', g.doc_date) + interval '1 month - 1 day')::date as inv_date,
       array_agg(g.id order by g.doc_date) as receipts, round(sum(t.total), 2) as base
from goods_receipts g
join suppliers s on s.id = g.supplier_id
join lateral (select sum(rl.packs_qty * rl.pack_price) as total from receipt_lines rl where rl.receipt_id = g.id) t on true
where g.org_id = 'd0000000-0000-4000-8000-000000000001' and g.status = 'closed'
  and g.doc_date < date_trunc('month', (now() at time zone 'Europe/Madrid'))::date
group by g.supplier_id, s.code, s.payment_terms, date_trunc('month', g.doc_date);
delete from demo_inv where sup = 'HIG' and inv_date = (select max(inv_date) from demo_inv);
update demo_inv set base = base + 18 where sup = 'SER' and inv_date = (select max(inv_date) from demo_inv);

with ins as (
  insert into invoices (org_id, supplier_id, number, invoice_date, due_date, subtotal, vat_total, total, status, paid_at, created_by)
  select 'd0000000-0000-4000-8000-000000000001', d.supplier_id,
         format('%s-%s', d.sup, to_char(d.inv_date, 'YYYY/MM')),
         d.inv_date, d.inv_date + coalesce(case when d.payment_terms ~* 'contado' then 0 when d.payment_terms ~* 'semanal' then 7
                                              else substring(d.payment_terms from '(\d+) d')::int end, 30),
         d.base, round(d.base * case when d.sup in ('HUE', 'LON', 'PRA') then 0.10 else 0.21 end, 2),
         d.base + round(d.base * case when d.sup in ('HUE', 'LON', 'PRA') then 0.10 else 0.21 end, 2),
         case when d.inv_date < (select max(inv_date) from demo_inv) then 'pagada' else 'pendiente' end,
         case when d.inv_date < (select max(inv_date) from demo_inv) then d.inv_date + 20 end,
         (select id from auth.users where email = 'demo.admin@example.com')
  from demo_inv d
  returning id, supplier_id, invoice_date
)
insert into invoice_receipts (invoice_id, receipt_id)
select ins.id, unnest(d.receipts) from ins join demo_inv d on d.supplier_id = ins.supplier_id and d.inv_date = ins.invoice_date;

-- Comprobaciones de coherencia: si algo no cuadra, no se guarda nada.
do $$
declare
  v_org constant uuid := 'd0000000-0000-4000-8000-000000000001';
  problems text[] := '{}';
  n int;
begin
  select count(*) into n from stock_balances b join locations l on l.id = b.location_id where l.org_id = v_org and b.qty < 0;
  if n > 0 then problems := problems || format('%s saldos negativos', n); end if;
  select count(*) into n from products p where p.org_id = v_org and not exists (select 1 from product_packs k where k.product_id = p.id and k.is_count_default);
  if n > 0 then problems := problems || format('%s productos sin formato de conteo', n); end if;
  select count(*) into n from products p where p.org_id = v_org and not exists (select 1 from product_packs k where k.product_id = p.id and k.is_purchase_default);
  if n > 0 then problems := problems || format('%s productos sin formato de compra', n); end if;
  select count(*) into n from product_packs k join products p on p.id = k.product_id
  where p.org_id = v_org and k.full_weight_g is not null and (k.empty_weight_g is null or k.full_weight_g <= k.empty_weight_g);
  if n > 0 then problems := problems || format('%s pesos incoherentes', n); end if;
  select count(*) into n from stock_balances b join locations l on l.id = b.location_id
  where l.org_id = v_org and abs(b.qty - (select coalesce(sum(m.qty), 0) from stock_movements m where m.location_id = b.location_id and m.product_id = b.product_id)) > 0.001;
  if n > 0 then problems := problems || format('%s saldos que no cuadran con sus movimientos', n); end if;
  select count(*) into n from stock_movements where org_id = v_org and occurred_at > now() + interval '1 minute';
  if n > 0 then problems := problems || format('%s movimientos en el futuro', n); end if;
  select count(*) into n from location_products lp join locations l on l.id = lp.location_id where l.org_id = v_org and lp.par_qty < lp.min_qty;
  if n > 0 then problems := problems || format('%s máximos por debajo del mínimo', n); end if;
  select count(*) into n from purchase_orders where org_id = v_org and status = 'sent' and expected_date < (now() at time zone 'Europe/Madrid')::date;
  if n > 0 then problems := problems || format('%s pedidos atrasados sin recibir', n); end if;
  select count(*) into n from stock_balances b join locations l on l.id = b.location_id
  where l.org_id = v_org and abs(b.qty - coalesce((select sum(s.qty) from stock_area_balances s join storage_areas a on a.id = s.area_id
                                                  where a.location_id = b.location_id and s.product_id = b.product_id), 0)) > 0.0001;
  if n > 0 then problems := problems || format('%s productos cuyas zonas no suman el stock del local', n); end if;
  if cardinality(problems) > 0 then
    raise exception 'Datos de demo incoherentes: %', array_to_string(problems, '; ');
  end if;
end $$;

-- Resumen de lo cargado.
select 'locales' as que, count(*) from locations where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'productos', count(*) from products where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'formatos', count(*) from product_packs k join products p on p.id = k.product_id where p.org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'proveedores', count(*) from suppliers where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'movimientos', count(*) from stock_movements where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'pedidos', count(*) from purchase_orders where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'recepciones', count(*) from goods_receipts where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'traspasos', count(*) from transfers where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'inventarios', count(*) from inventory_counts where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'recetas', count(*) from recipes where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'facturas', count(*) from invoices where org_id = 'd0000000-0000-4000-8000-000000000001';

commit;
