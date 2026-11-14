begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into organizations (id, name) values ('fd500000-0000-4000-8000-000000000001', 'Org taxonomía');

select taxonomia_cuentas('fd500000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from categories where org_id = 'fd500000-0000-4000-8000-000000000001' and parent_id is null),
  7,
  'Siete cuentas de análisis de nivel 1'
);
select is(
  (select count(*)::int from categories c join categories p on p.id = c.parent_id where c.org_id = 'fd500000-0000-4000-8000-000000000001' and p.name = 'BEBIDA'),
  10,
  'BEBIDA tiene sus diez familias'
);

-- 7 cuentas + 40 familias.
select is(
  (select count(*)::int from categories where org_id = 'fd500000-0000-4000-8000-000000000001'),
  47,
  'La primera llamada crea 47 categorías'
);

-- Repetir no duplica nada: la migración puede volver a correr sin efectos.
select taxonomia_cuentas('fd500000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from categories where org_id = 'fd500000-0000-4000-8000-000000000001'),
  47,
  'Una segunda llamada no añade filas'
);

select * from finish();
rollback;
