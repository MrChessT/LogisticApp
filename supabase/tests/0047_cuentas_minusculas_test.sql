begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into organizations (id, name) values ('fd700000-0000-4000-8000-000000000001', 'Org minúsculas');
insert into categories (org_id, parent_id, name) values
  ('fd700000-0000-4000-8000-000000000001', null, 'BEBIDA'),
  ('fd700000-0000-4000-8000-000000000001', null, 'PACKING Y LIMPIEZA');

select cuentas_minusculas('fd700000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from categories where org_id = 'fd700000-0000-4000-8000-000000000001' and name = 'Bebida'),
  1,
  'BEBIDA pasa a Bebida'
);
select is(
  (select count(*)::int from categories where org_id = 'fd700000-0000-4000-8000-000000000001' and name = 'Packing y limpieza'),
  1,
  'PACKING Y LIMPIEZA pasa a Packing y limpieza'
);

-- Repetir no cambia nada.
select cuentas_minusculas('fd700000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from categories where org_id = 'fd700000-0000-4000-8000-000000000001' and name in ('Bebida', 'Packing y limpieza')),
  2,
  'Una segunda llamada no cambia nada'
);

select * from finish();
rollback;
