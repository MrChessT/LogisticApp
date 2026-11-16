-- Quita los datos de prueba de volumen (generados con la marca «PRUEBA-VOL», «Proveedor prueba», «VOL-», ventas
-- source «volumen»). No toca nada más. Se ejecuta en UNA transacción, con la sustitución de la organización:
--
--   Sustituye :org por el uuid de la organización y ejecútalo en la base de datos de producción (el mismo
--   procedimiento que scripts/ops/aplicar-migracion.sh). Si algo no cuadra, la transacción entera se deshace.
--
-- Por qué hace falta desactivar stock_movements_immutable: el stock solo se cambia con movimientos y estos no se
-- borran en la operativa normal. Los de prueba sí se borran aquí, porque no existen en la realidad del negocio.
-- Después se recalculan los saldos de los productos de prueba (que solo tienen movimientos de prueba).

begin;
alter table stock_movements disable trigger stock_movements_immutable;

-- 1) Ventas de prueba
delete from sales_lines where day_id in (select id from sales_days where org_id = :'org' and source = 'volumen');
delete from sales_days where org_id = :'org' and source = 'volumen';
delete from sales_items where org_id = :'org' and source = 'volumen';

-- 2) Recepciones de prueba (su historial de precios y sus líneas)
delete from price_history where receipt_id in (select id from goods_receipts where org_id = :'org' and doc_number like 'VOL-%');
delete from receipt_lines where receipt_id in (select id from goods_receipts where org_id = :'org' and doc_number like 'VOL-%');
delete from goods_receipts where org_id = :'org' and doc_number like 'VOL-%';

-- 3) Movimientos, saldos y precios de los productos de prueba
delete from stock_movements where org_id = :'org' and product_id in (select id from products where org_id = :'org' and name like 'PRUEBA-VOL %');
delete from stock_area_balances where product_id in (select id from products where org_id = :'org' and name like 'PRUEBA-VOL %');
delete from stock_balances where product_id in (select id from products where org_id = :'org' and name like 'PRUEBA-VOL %');
delete from price_history where pack_id in (select pk.id from product_packs pk join products p on p.id = pk.product_id where p.org_id = :'org' and p.name like 'PRUEBA-VOL %');
delete from supplier_prices where pack_id in (select pk.id from product_packs pk join products p on p.id = pk.product_id where p.org_id = :'org' and p.name like 'PRUEBA-VOL %');
delete from location_products where product_id in (select id from products where org_id = :'org' and name like 'PRUEBA-VOL %');

-- 4) Formatos y productos de prueba; proveedores de prueba si ya no se usan
delete from product_packs where product_id in (select id from products where org_id = :'org' and name like 'PRUEBA-VOL %');
delete from products where org_id = :'org' and name like 'PRUEBA-VOL %';
delete from suppliers s where s.org_id = :'org' and s.name like 'Proveedor prueba %'
  and not exists (select 1 from goods_receipts g where g.supplier_id = s.id)
  and not exists (select 1 from supplier_prices sp where sp.supplier_id = s.id);

alter table stock_movements enable trigger stock_movements_immutable;

-- Comprobación: no debe quedar ninguna fila de prueba.
select
  (select count(*) from products where org_id = :'org' and name like 'PRUEBA-VOL %') as productos_restantes,
  (select count(*) from goods_receipts where org_id = :'org' and doc_number like 'VOL-%') as recepciones_restantes,
  (select count(*) from sales_days where org_id = :'org' and source = 'volumen') as ventas_restantes;
commit;
