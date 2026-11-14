begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into organizations (id, name) values ('fd800000-0000-4000-8000-000000000001', 'Org familias');
insert into categories (id, org_id, parent_id, name) values
  ('fd810000-0000-4000-8000-000000000001', 'fd800000-0000-4000-8000-000000000001', null, 'MENAJE'),
  ('fd810000-0000-4000-8000-000000000002', 'fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000001', 'Menaje de Sala'),
  ('fd810000-0000-4000-8000-000000000003', 'fd800000-0000-4000-8000-000000000001', null, 'COMIDA'),
  ('fd810000-0000-4000-8000-000000000004', 'fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000003', 'Panadería, Harinas y Pasta'),
  ('fd810000-0000-4000-8000-000000000005', 'fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000003', 'Pastelería y Postres'),
  ('fd810000-0000-4000-8000-000000000006', 'fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000003', 'Frutos Secos y Snacks'),
  ('fd810000-0000-4000-8000-000000000007', 'fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000003', 'Conservas y Encurtidos');
insert into products (org_id, category_id, name, dimension) values
  ('fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000005', 'Tarta de queso', 'count'),
  ('fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000006', 'Aceitunas verdes', 'count'),
  ('fd800000-0000-4000-8000-000000000001', 'fd810000-0000-4000-8000-000000000004', 'Pan de hogaza', 'count');

select reorganiza_familias_productos('fd800000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from products pr join categories c on c.id = pr.category_id where c.name = 'Pastelería y Postres'),
  0,
  'Pastelería y Postres no conserva productos (se traspasan)'
);
select is(
  (select c.name from products pr join categories c on c.id = pr.category_id where pr.name = 'Aceitunas verdes'),
  'Conservas y Encurtidos',
  'Las aceitunas van a Conservas y Encurtidos'
);

-- Repetir no cambia nada.
select reorganiza_familias_productos('fd800000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from products where org_id = 'fd800000-0000-4000-8000-000000000001'),
  3,
  'Una segunda llamada no crea ni pierde productos'
);

select * from finish();
rollback;
