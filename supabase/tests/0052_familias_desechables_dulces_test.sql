begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into organizations (id, name) values ('ff800000-0000-4000-8000-000000000001', 'Org desechables');
insert into categories (id, org_id, parent_id, name) values
  ('ff810000-0000-4000-8000-000000000001', 'ff800000-0000-4000-8000-000000000001', null, 'Packing y limpieza'),
  ('ff810000-0000-4000-8000-000000000002', 'ff800000-0000-4000-8000-000000000001', 'ff810000-0000-4000-8000-000000000001', 'Papel y Celulosa'),
  ('ff810000-0000-4000-8000-000000000003', 'ff800000-0000-4000-8000-000000000001', 'ff810000-0000-4000-8000-000000000001', 'Packaging y Desechables'),
  ('ff810000-0000-4000-8000-000000000004', 'ff800000-0000-4000-8000-000000000001', null, 'Comida');
insert into products (org_id, category_id, name, dimension) values
  ('ff800000-0000-4000-8000-000000000001', 'ff810000-0000-4000-8000-000000000002', 'Servilletas de prueba', 'count');

select familias_desechables_dulces('ff800000-0000-4000-8000-000000000001');

select is((select c.name from products p join categories c on c.id = p.category_id where p.name = 'Servilletas de prueba'), 'Packaging y Desechables', 'los productos de Papel y Celulosa pasan a Packaging y Desechables');
select is((select count(*)::int from categories where id = 'ff810000-0000-4000-8000-000000000002'), 0, 'la familia Papel y Celulosa se elimina');
select is((select count(*)::int from categories where org_id = 'ff800000-0000-4000-8000-000000000001' and parent_id = 'ff810000-0000-4000-8000-000000000004' and name = 'Dulces y Postres'), 1, 'se crea Dulces y Postres en Comida');

select familias_desechables_dulces('ff800000-0000-4000-8000-000000000001');
select is((select count(*)::int from categories where org_id = 'ff800000-0000-4000-8000-000000000001' and name = 'Dulces y Postres'), 1, 'repetirla no duplica la familia');

select * from finish();
rollback;
