begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Se parte de cero (dentro de la transacción, que se deshace al final).
delete from app_errors;
insert into auth.users (id, email, email_confirmed_at) values ('fd000000-0000-4000-8000-000000000001', 'errores@example.com', now());
insert into organizations (id, name) values ('fd100000-0000-4000-8000-000000000001', 'Org errores');
insert into memberships (org_id, user_id, role, all_locations) values ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'manager', true);

-- Sin sesión no se registra ni se lee nada (regla de la 0030): esos errores los manda el servidor.
set local role anon;
select throws_ok($$select report_app_error('client', 'x')$$, '42501', null, 'Sin sesión no se ejecuta (lo hace el servidor)');
select throws_ok($$select count(*) from app_errors$$, '42501', null, 'Sin sesión no se lee la tabla');

-- El servidor (clave de servicio), sin usuario.
set local role service_role;
select is(report_app_error('client', 'Fallo al pintar', '/productos?buscar=ron'), true, 'La primera vez del día es nueva');
select is(report_app_error('client', 'Fallo al pintar', '/productos?buscar=ginebra'), false, 'La misma con otros parámetros solo suma');
select throws_ok($$select report_app_error('otro', 'x')$$, '22023', null, 'Solo orígenes conocidos');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(report_app_error('server', repeat('x', 900), '/escandallos/fd100000-0000-4000-8000-000000000001'), true, 'Con sesión, a nombre de quien lo sufrió');
select throws_ok($$select count(*) from app_errors$$, '42501', null, 'Con sesión tampoco se lee: no hay permiso de tabla');

reset role;
select results_eq(
  $$select source, count, path, length(message), org_id is not null from app_errors order by id$$,
  $$values ('client', 2, '/productos', 15, false), ('server', 1, '/escandallos/:id', 500, true)$$,
  'Cuenta repeticiones, quita parámetros e identificadores, recorta el mensaje y apunta la organización'
);

select * from finish();
rollback;
