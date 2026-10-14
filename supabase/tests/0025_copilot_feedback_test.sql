begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- Una organización con administración, encargado, personal y una pantalla; y otra organización aparte.
insert into auth.users (id, email, email_confirmed_at) values
  ('f1000000-0000-4000-8000-000000000001', 'fb-admin@example.com', now()),
  ('f1000000-0000-4000-8000-000000000002', 'fb-manager@example.com', now()),
  ('f1000000-0000-4000-8000-000000000003', 'fb-staff@example.com', now()),
  ('f1000000-0000-4000-8000-000000000004', 'fb-kiosk@example.com', now()),
  ('f1000000-0000-4000-8000-000000000005', 'fb-other@example.com', now());
insert into organizations (id, name) values
  ('f2000000-0000-4000-8000-000000000001', 'Org opiniones'),
  ('f2000000-0000-4000-8000-000000000002', 'Otra org opiniones');
insert into locations (id, org_id, name) values ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Bar');
insert into memberships (org_id, user_id, role, all_locations) values
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'admin', true),
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'manager', false),
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'staff', false),
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004', 'kiosk', false),
  ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000005', 'owner', true);
insert into membership_locations (org_id, user_id, location_id)
select 'f2000000-0000-4000-8000-000000000001', u, 'f3000000-0000-4000-8000-000000000001'
from unnest(array['f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000004']::uuid[]) u;

select is(
  (select count(*)::int from pg_policy where polrelid = 'public.copilot_feedback'::regclass and polcmd <> 'r'),
  0,
  'feedback cannot be written directly'
);

-- El encargado activa el modo pruebas a su personal; el personal no puede.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$select team_set_tester('f1000000-0000-4000-8000-000000000003', true)$$, 'a manager turns on test mode for their staff');
select throws_ok($$select team_set_tester('f1000000-0000-4000-8000-000000000001', true)$$, '42501', 'forbidden', 'a manager cannot touch an admin');
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select team_set_tester('f1000000-0000-4000-8000-000000000003', false)$$, '42501', 'forbidden', 'staff cannot change test mode');

-- El personal reporta: el reporte sabe que estaba en modo pruebas.
select ok(
  copilot_feedback_add('mensaje', 'incorrecto', 'Me dijo 3 cajas y había 2', 'Que mire el último conteo',
                       '[{"role":"user","text":"¿Cuánto Barceló hay?"},{"role":"assistant","text":"3 cajas","flagged":true}]'::jsonb) is not null,
  'staff can report a message'
);
select throws_ok($$select copilot_feedback_add('mensaje', 'incorrecto', 'x')$$, '23514', null, 'an empty comment is rejected');
select throws_ok($$select copilot_feedback_add('mensaje', 'inventada', 'Algo raro pasa')$$, '23514', null, 'an unknown category is rejected');
select is(jsonb_array_length(copilot_feedback_list()), 1, 'staff see their own reports');
select throws_ok($$select copilot_feedback_review(array(select id from copilot_feedback), 'aceptada')$$, '42501', 'forbidden', 'staff cannot review');

-- La pantalla del almacén no puede reportar.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select copilot_feedback_add('conversacion', 'otro', 'Hola qué tal')$$, '42501', 'forbidden', 'a warehouse screen cannot report');

-- El encargado (no es administración) solo ve los suyos: ninguno.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(jsonb_array_length(copilot_feedback_list()), 0, 'a manager does not see other people''s reports');

-- Otra organización no ve nada.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from copilot_feedback), 0, 'another organisation reads nothing');

-- La administración ve y revisa.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select (copilot_feedback_list() -> 0 ->> 'author') || ' · ' || (copilot_feedback_list() -> 0 ->> 'test_mode')),
  'fb-staff · true',
  'the admin sees who reported it and that it was in test mode'
);
select is(copilot_feedback_review(array(select id from copilot_feedback), 'aceptada', 'Revisar el cálculo'), 1, 'the admin accepts a report');
reset role;

select * from finish();
