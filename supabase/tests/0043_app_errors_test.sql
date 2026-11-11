begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, email_confirmed_at) values ('fd000000-0000-4000-8000-000000000001', 'errores@example.com', now());
insert into organizations (id, name) values ('fd100000-0000-4000-8000-000000000001', 'Org errores');
insert into memberships (org_id, user_id, role, all_locations) values ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'manager', true);

set local role anon;
select is(report_app_error('client', 'Fallo al pintar', '/productos?buscar=ron'), true, 'La primera vez del día es nueva (también sin sesión)');
select is(report_app_error('client', 'Fallo al pintar', '/productos?buscar=ginebra'), false, 'La misma con otros parámetros solo suma');
select throws_ok($$select report_app_error('otro', 'x')$$, '22023', null, 'Solo orígenes conocidos');
select is((select count(*)::int from app_errors), 0, 'Sin sesión no se lee la tabla (sin políticas)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(report_app_error('server', repeat('x', 900), '/escandallos/fd100000-0000-4000-8000-000000000001'), true, 'Con sesión también');
select is((select count(*)::int from app_errors), 0, 'Ni con sesión se leen (sin políticas)');

reset role;
select results_eq(
  $$select source, count, path, length(message), org_id is not null from app_errors order by id$$,
  $$values ('client', 2, '/productos', 15, false), ('server', 1, '/escandallos/:id', 500, true)$$,
  'Cuenta repeticiones, quita parámetros e identificadores, recorta el mensaje y apunta la organización'
);

select * from finish();
rollback;
