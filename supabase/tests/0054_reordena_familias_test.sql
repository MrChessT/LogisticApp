begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into organizations (id, name) values
  ('fe100000-0000-4000-8000-000000000001', 'Org familias'),
  ('fe100000-0000-4000-8000-000000000002', 'Org ajena familias');

-- Taxonomía (0045) y una raíz antigua con un producto dentro.
insert into categories (id, org_id, parent_id, name, sort_order) values
  ('fe200000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', null, 'Bebida', 1),
  ('fe200000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000001', 'Vinos Tintos', 1),
  ('fe200000-0000-4000-8000-000000000003', 'fe100000-0000-4000-8000-000000000001', null, 'Vinos', 99),
  ('fe200000-0000-4000-8000-000000000004', 'fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000003', 'Tinto', 1),
  ('fe200000-0000-4000-8000-000000000005', 'fe100000-0000-4000-8000-000000000002', null, 'Vinos', 99),
  ('fe200000-0000-4000-8000-000000000006', 'fe100000-0000-4000-8000-000000000002', 'fe200000-0000-4000-8000-000000000005', 'Tinto', 1);
insert into products (id, org_id, category_id, name, dimension) values
  ('fe300000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000004', 'Tinto de prueba', 'count'),
  ('fe300000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000002', 'fe200000-0000-4000-8000-000000000006', 'Tinto ajeno', 'count');

select reordena_familias_catalogo('fe100000-0000-4000-8000-000000000001');

select is((select category_id from products where id = 'fe300000-0000-4000-8000-000000000001'), 'fe200000-0000-4000-8000-000000000002'::uuid,
  'El tinto pasa a Bebida › Vinos Tintos');
select ok(not exists (select 1 from categories where id = 'fe200000-0000-4000-8000-000000000003'), 'La raíz «Vinos» vacía se elimina');
select is((select count(*)::int from products where org_id = 'fe100000-0000-4000-8000-000000000001'), 1, 'No se pierde ningún producto');

-- Segunda pasada: no hace nada.
select reordena_familias_catalogo('fe100000-0000-4000-8000-000000000001');
select is((select category_id from products where id = 'fe300000-0000-4000-8000-000000000001'), 'fe200000-0000-4000-8000-000000000002'::uuid,
  'Repetir la migración no cambia nada');

-- Otra organización no se toca.
select ok(exists (select 1 from categories where id = 'fe200000-0000-4000-8000-000000000005'), 'La otra organización conserva su raíz «Vinos»');

select * from finish();
rollback;
