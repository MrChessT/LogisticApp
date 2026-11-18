begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into organizations (id, name) values ('fb100000-0000-4000-8000-000000000001', 'Org fuentes de precio');

select has_column('suppliers', 'is_price_source', 'Los proveedores tienen la marca de fuente de precio');
select col_default_is('suppliers', 'is_price_source', 'false', 'Un proveedor nuevo es un proveedor real');

insert into suppliers (id, org_id, name, code) values
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'Precios de escandallo', 'ESC'),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'Distribuidor de prueba', 'DIS');

select ok((select is_price_source from suppliers where id = 'fb200000-0000-4000-8000-000000000001'),
  'La fuente de la importación de escandallos nace marcada');
select ok(not (select is_price_source from suppliers where id = 'fb200000-0000-4000-8000-000000000002'),
  'Un distribuidor no es una fuente de precio');

update suppliers set is_price_source = false where id = 'fb200000-0000-4000-8000-000000000001';
select ok(not (select is_price_source from suppliers where id = 'fb200000-0000-4000-8000-000000000001'),
  'La marca se puede quitar a mano (solo se pone sola al crear)');

select * from finish();
rollback;
