begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- Nadie sin sesión ejecuta funciones de la API.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  0,
  'anon cannot execute any public function'
);

-- Las funciones de disparador no se llaman por /rpc.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')),
  0,
  'authenticated cannot call trigger functions'
);

-- Las funciones de la app siguen disponibles con sesión.
select ok(has_function_privilege('authenticated', 'close_count(uuid, boolean, boolean, text, text)', 'execute'), 'close_count still works with a session');
select ok(has_function_privilege('authenticated', 'catalog_search(text, uuid, uuid, uuid, text, text, text, text, boolean, integer, integer)', 'execute'), 'catalog_search still works with a session');
select ok(not has_function_privilege('authenticated', 'auth_user_id_by_email(text)', 'execute'), 'auth_user_id_by_email stays server-only');

-- Una función nueva no queda abierta a anon.
create function zz_hardening_probe() returns int language sql as 'select 1';
select ok(not has_function_privilege('anon', 'zz_hardening_probe()', 'execute'), 'new functions are not executable by anon');

-- Los disparadores siguen saltando aunque no se puedan llamar por /rpc.
insert into auth.users (id, email, email_confirmed_at) values ('fa000000-0000-4000-8000-000000000001', 'endurecimiento@example.com', now());
select is(
  (select count(*)::int from profiles where user_id = 'fa000000-0000-4000-8000-000000000001'),
  1,
  'the new-user trigger still creates the profile'
);
select is(norm_text('Ñandú ÁGUILA'), 'nandu aguila', 'norm_text works with a fixed search_path');


-- El consumo por día devuelve una fila por día, aunque haya muchos productos.
insert into organizations (id, name) values ('fa100000-0000-4000-8000-000000000001', 'Org endurecimiento');
insert into locations (id, org_id, name) values ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Local endurecimiento');
insert into products (id, org_id, name, dimension) values
  ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Producto A', 'count'),
  ('fa300000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'Producto B', 'count');
insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost, occurred_at) values
  ('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'opening', 10, 2, now() - interval '3 days'),
  ('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000002', 'opening', 10, 3, now() - interval '3 days'),
  ('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'consumption', -2, null, date_trunc('day', now()) - interval '1 day' + interval '12 hours'),
  ('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000002', 'consumption', -1, null, date_trunc('day', now()) - interval '1 day' + interval '13 hours'),
  ('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000002', 'waste', -1, null, date_trunc('day', now()) - interval '1 day' + interval '14 hours');
select is(
  (select count(*)::int from usage_by_business_day((now() - interval '2 days')::date, 'fa200000-0000-4000-8000-000000000001')),
  1,
  'usage is one row per business day'
);
select is(
  (select value from usage_by_business_day((now() - interval '2 days')::date, 'fa200000-0000-4000-8000-000000000001')),
  -10.00::numeric,
  'the day adds every product and type (2·2 + 1·3 + 1·3)'
);

select * from finish();
rollback;
