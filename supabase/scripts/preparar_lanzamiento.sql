-- Preparar el lanzamiento de Parador Eventos: datos limpios y coherentes.
--
-- Qué hace (todo en una transacción: o se aplica entero o no cambia nada):
--   1. Borra las OPERACIONES DE PRUEBA: recepciones, traspasos, inventarios, pedidos, mermas y ajustes
--      hechos mientras se probaba la app, con sus precios de prueba. Conserva la APERTURA de referencia
--      del Vivero («Apertura: catálogo Vivero 55») y recalcula el stock y el coste medio desde ella.
--   2. Arregla el catálogo:
--      · borra productos basura o de demostración sin uso real («y», «Ginebra Nordes», «La Lomba»,
--        «Ron Barcelo», «Patatas fritas», «Estrella Galicia», «Limones» por unidades) y el proveedor de
--        demostración «Distribuidora Central» si se queda sin precios;
--      · la Coca-Cola de demostración pasa a ser la del catálogo (vidrio 20 cl, caja de 24 a 12,96 €);
--      · da de alta lo que el catálogo no pudo crear por choques de nombre o SKU: «Limones» por kilos
--        (FRU-001) y «Heineken barril 30 L» (CER-001), con su precio, mínimos y stock de referencia.
--   3. Restaura los precios del catálogo que las pruebas dejaron mal (Fanta Naranja, Cacique 500, vasos).
--   4. Limpia el surtido creado solo por las pruebas, y las sesiones, borradores y hábitos del asistente.
--   No toca: organización, locales, espacios, usuarios, permisos, proveedores reales ni la auditoría.
--
-- Requisitos: migraciones hasta 0018 aplicadas.
-- Uso: SQL Editor de Supabase, pegar TODO el archivo y ejecutarlo una vez. Repetirlo no rompe nada
-- (vuelve a dejar el mismo estado), pero borraría las operaciones reales hechas entre medias.

begin;

do $$
begin
  if to_regprocedure('catalog_health(uuid)') is null then
    raise exception 'Aplica antes la migración 0018_catalogo_profesional.sql';
  end if;
end $$;

-- 0 · Contexto ------------------------------------------------------------------------------------------

create temp table ctx on commit drop as
select o.id as org_id,
       (select id from locations where org_id = o.id and name = 'Vivero') as vivero
from organizations o where o.name = 'Parador Eventos';

do $$ begin
  if (select count(*) from ctx) <> 1 or (select vivero from ctx) is null then
    raise exception 'No encuentro la organización «Parador Eventos» con el local «Vivero».';
  end if;
end $$;

-- 1 · Operaciones de prueba -----------------------------------------------------------------------------

-- La apertura de referencia se guarda tal cual (mismas cantidades, costes y fecha) para reproducirla.
create temp table apertura on commit drop as
select m.org_id, m.location_id, m.product_id, m.area_id, m.qty, m.unit_cost, m.reason, m.occurred_at
from stock_movements m, ctx
where m.org_id = ctx.org_id and m.type = 'opening' and m.reason = 'Apertura: catálogo Vivero 55';

-- Precios que solo existen por recepciones de prueba (se restauran después los del catálogo).
create temp table recepciones_prueba on commit drop as
select r.id from goods_receipts r, ctx where r.org_id = ctx.org_id;

delete from price_history where receipt_id in (select id from recepciones_prueba);

alter table stock_movements disable trigger stock_movements_immutable;
delete from stock_movements m using ctx where m.org_id = ctx.org_id;
alter table stock_movements enable trigger stock_movements_immutable;

delete from goods_receipts r using ctx where r.org_id = ctx.org_id;          -- y sus líneas
delete from purchase_orders o using ctx where o.org_id = ctx.org_id;         -- y sus líneas
delete from transfers t using ctx where t.org_id = ctx.org_id;               -- y sus líneas
delete from inventory_counts c using ctx where c.org_id = ctx.org_id;        -- líneas y resultados
delete from stock_balances b using locations l, ctx where l.id = b.location_id and l.org_id = ctx.org_id;
delete from stock_area_balances b using storage_areas a, locations l, ctx
  where a.id = b.area_id and l.id = a.location_id and l.org_id = ctx.org_id;

delete from copilot_drafts d using ctx where d.org_id = ctx.org_id;
delete from copilot_sessions s using ctx where s.org_id = ctx.org_id;
delete from copilot_profiles p using ctx where p.org_id = ctx.org_id;

-- 2 · Catálogo ------------------------------------------------------------------------------------------

-- Basura y demostración (ya sin movimientos ni documentos tras el paso 1).
delete from products p using ctx
where p.org_id = ctx.org_id
  and (p.name in ('y', 'Ginebra Nordes', 'La Lomba', 'Ron Barcelo', 'Patatas fritas', 'Estrella Galicia')
       or (p.name = 'Limones' and p.dimension = 'count'));

-- Coca-Cola de demostración → la del catálogo (REF-001: vidrio 20 cl, caja de 24).
update products p
set notes = 'Coca-Cola · Coca-Cola · Vidrio 20 cl · IVA 21 %', vat_rate = 21, active = true
from ctx where p.org_id = ctx.org_id and p.name = 'Coca-Cola';
update product_packs k
set name = 'Botella 20 cl'
from products p, ctx
where k.product_id = p.id and p.org_id = ctx.org_id and p.name = 'Coca-Cola' and k.name = 'Botella 330 ml'
  and not exists (select 1 from product_packs x where x.product_id = p.id and x.name = 'Botella 20 cl');

-- Productos del catálogo que no llegaron a crearse.
create temp table nuevos (sku text, name text, family text, type text, dimension unit_dimension, notes text, vat numeric,
  pack text, pack_qty numeric, supplier text, price numeric, min_qty numeric, par_qty numeric, stock numeric, unit_cost numeric) on commit drop;
insert into nuevos values
  ('FRU-001', 'Limones', 'Fruta y guarnición', 'Cítricos', 'mass', 'Cítricos · Kg · IVA 4 %', 4,
   'Kg', 1000, 'Frutas Hermanos Pérez', 1.85, 3000, 8000, 1600, 0.00185),
  ('CER-001', 'Heineken barril 30 L', 'Cervezas', 'Barril', 'volume', 'Heineken · Barril · Barril 30 L · IVA 21 %', 21,
   'Barril 30 L', 30000, 'Cervezas del Sureste Distribución S.L.', 96, 60000, 180000, 180000, 0.0032);

insert into products (org_id, category_id, name, dimension, sku, notes, vat_rate)
select ctx.org_id,
       coalesce(
         (select t.id from categories t join categories f on f.id = t.parent_id
          where t.org_id = ctx.org_id and f.name = n.family and t.name = n.type),
         (select f.id from categories f where f.org_id = ctx.org_id and f.parent_id is null and f.name = n.family)),
       n.name, n.dimension, n.sku, n.notes, n.vat
from nuevos n, ctx
where not exists (select 1 from products p where p.org_id = ctx.org_id and (p.name = n.name or p.sku = n.sku));

insert into product_packs (product_id, name, qty_base, is_count_default, is_purchase_default)
select p.id, n.pack, n.pack_qty, true, true
from nuevos n join products p on p.name = n.name join ctx on p.org_id = ctx.org_id
on conflict (product_id, name) do nothing;

-- 3 · Precios -------------------------------------------------------------------------------------------

-- Precio del catálogo por formato de compra. Se pisa el que haya (las pruebas dejaron 24 € la caja
-- de Fanta, 28 € la caja de Cacique…) y el disparador deja constancia en el historial.
create temp table precios (product text, pack text, supplier text, price numeric) on commit drop;
insert into precios values
  ('Coca-Cola', 'Caja 24', 'Bebidas Mar Menor S.L.', 12.96),
  ('Fanta Naranja', 'Caja 24', 'Bebidas Mar Menor S.L.', 11.76),
  ('Cacique 500', 'Caja 6', 'Distribuciones Premium Sureste S.L.', 105),
  ('Vasos de tubo desechables 30 cl (paq. 50)', 'Paquete', 'Cash Hostelero Levante', 5.9),
  ('Limones', 'Kg', 'Frutas Hermanos Pérez', 1.85),
  ('Heineken barril 30 L', 'Barril 30 L', 'Cervezas del Sureste Distribución S.L.', 96);

insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at)
select s.id, k.id, x.price, now()
from precios x
join ctx on true
join products p on p.org_id = ctx.org_id and p.name = x.product
join product_packs k on k.product_id = p.id and k.name = x.pack
join suppliers s on s.org_id = ctx.org_id and s.name = x.supplier
on conflict (supplier_id, pack_id) do update set last_price = excluded.last_price, last_price_at = excluded.last_price_at;

-- Precios que solo puso una recepción de prueba con otro proveedor (Cacique a 28 €, vasos a 76 €).
delete from supplier_prices sp
using product_packs k, products p, suppliers s, ctx
where k.id = sp.pack_id and p.id = k.product_id and s.id = sp.supplier_id and p.org_id = ctx.org_id
  and (p.name, s.name) in (('Cacique 500', 'Bebidas Mar Menor S.L.'),
                           ('Vasos de tubo desechables 30 cl (paq. 50)', 'Bebidas Mar Menor S.L.'));

delete from suppliers s using ctx
where s.org_id = ctx.org_id and s.name = 'Distribuidora Central'
  and not exists (select 1 from supplier_prices sp where sp.supplier_id = s.id)
  and not exists (select 1 from purchase_orders o where o.supplier_id = s.id);

-- 4 · Surtido y stock de referencia ---------------------------------------------------------------------

-- Surtido creado solo por las pruebas (sin mínimos) fuera del Vivero.
delete from location_products lp using locations l, ctx
where l.id = lp.location_id and l.org_id = ctx.org_id and lp.location_id <> ctx.vivero
  and lp.min_qty = 0 and lp.par_qty = 0;

-- Mínimos del catálogo en el Vivero para lo dado de alta o corregido aquí (en unidad base).
insert into location_products (location_id, product_id, min_qty, par_qty)
select ctx.vivero, p.id, n.min_qty, n.par_qty
from nuevos n join ctx on true join products p on p.org_id = ctx.org_id and p.name = n.name
on conflict (location_id, product_id) do update set min_qty = excluded.min_qty, par_qty = excluded.par_qty;
insert into location_products (location_id, product_id, min_qty, par_qty)
select ctx.vivero, p.id, 48, 144 from ctx join products p on p.org_id = ctx.org_id and p.name = 'Coca-Cola'
on conflict (location_id, product_id) do update set min_qty = excluded.min_qty, par_qty = excluded.par_qty;

-- La apertura de referencia, de nuevo: el disparador recalcula saldo y coste medio.
insert into stock_movements (org_id, location_id, product_id, area_id, type, qty, unit_cost, reason, occurred_at)
select a.org_id, a.location_id, a.product_id, a.area_id, 'opening', a.qty, a.unit_cost, a.reason, a.occurred_at
from apertura a
where exists (select 1 from products p where p.id = a.product_id)
order by a.occurred_at;

-- Y la de lo que el catálogo no pudo crear (Coca-Cola: 43 ud a 0,54 €; Limones; Heineken barril).
insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost, reason)
select ctx.org_id, ctx.vivero, p.id, 'opening', n.stock, n.unit_cost, 'Apertura: catálogo Vivero 55'
from nuevos n join ctx on true join products p on p.org_id = ctx.org_id and p.name = n.name
where not exists (select 1 from apertura a where a.product_id = p.id);
insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost, reason)
select ctx.org_id, ctx.vivero, p.id, 'opening', 43, 0.54, 'Apertura: catálogo Vivero 55'
from ctx join products p on p.org_id = ctx.org_id and p.name = 'Coca-Cola'
where not exists (select 1 from apertura a where a.product_id = p.id);

-- 5 · Resultado -----------------------------------------------------------------------------------------

do $$
declare
  v_errors int;
begin
  select count(*) into v_errors from catalog_health() where severity = 'error';
  raise notice 'Productos: %, con precio: %, stock negativo: %, errores del catálogo: %',
    (select count(*) from products p, ctx where p.org_id = ctx.org_id and p.active),
    (select count(distinct product_id) from v_product_costs c, ctx where c.org_id = ctx.org_id),
    (select count(*) from stock_balances where qty < 0),
    v_errors;
end $$;

commit;

-- Lo que aún conviene revisar (avisos e información):
select severity, issue, product_name, location_name, detail from catalog_health() order by 1, 2, 3;
