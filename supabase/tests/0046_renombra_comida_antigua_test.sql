begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into organizations (id, name) values ('fd600000-0000-4000-8000-000000000001', 'Org comida');
insert into categories (org_id, parent_id, name) values ('fd600000-0000-4000-8000-000000000001', null, 'Comida');

select renombra_comida_antigua('fd600000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from categories where org_id = 'fd600000-0000-4000-8000-000000000001' and parent_id is null and name = 'Comida (antigua)'),
  1,
  'La categoría antigua pasa a llamarse «Comida (antigua)»'
);
select is(
  (select count(*)::int from categories where org_id = 'fd600000-0000-4000-8000-000000000001' and parent_id is null and name = 'Comida'),
  0,
  'Ya no queda ninguna «Comida» de primer nivel'
);

-- Repetir no hace nada: la migración puede volver a correr.
select renombra_comida_antigua('fd600000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from categories where org_id = 'fd600000-0000-4000-8000-000000000001'),
  1,
  'Una segunda llamada no cambia ni añade nada'
);

select * from finish();
rollback;
