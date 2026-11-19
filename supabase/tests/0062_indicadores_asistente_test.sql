begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, email_confirmed_at) values
  ('fc000000-0000-4000-8000-000000000001', 'indicadores-admin@example.com', now()),
  ('fc000000-0000-4000-8000-000000000002', 'indicadores-encargado@example.com', now()),
  ('fc000000-0000-4000-8000-000000000003', 'indicadores-pruebas@example.com', now());
insert into organizations (id, name) values ('fc100000-0000-4000-8000-000000000001', 'Org indicadores');
insert into memberships (org_id, user_id, role, all_locations, assistant_test) values
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'admin', true, false),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'manager', true, false),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000003', 'manager', true, true);

-- Conversación A (encargado): tres aclaraciones seguidas y luego una consulta → bucle, resuelta.
-- Conversación B (encargado): una consulta y acaba en aclaración hace una hora → sin resolver.
-- Conversación C (cuenta en modo pruebas): no cuenta salvo que se pida.
-- Conversación D (encargado): una batería marcada y un registro antiguo sin rastro: no cuentan.
insert into copilot_audit (org_id, user_id, kind, outcome, message_id, detail, created_at) values
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'aclaracion', 'fc300000-0000-4000-8000-000000000001', '{"session_id":"a","message":"traspaso","via":"jev","ms":400}', now() - interval '3 hours'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'aclaracion', null, '{"session_id":"a","message":"a vivero","via":"aclaracion","ms":300}', now() - interval '179 minutes'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'aclaracion', null, '{"session_id":"a","message":"coca","via":"aclaracion","ms":200}', now() - interval '178 minutes'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'borrador', 'fc300000-0000-4000-8000-000000000002', '{"session_id":"a","message":"stock de coca","via":"atajo","ms":100}', now() - interval '177 minutes'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'borrador', 'fc300000-0000-4000-8000-000000000003', '{"session_id":"b","message":"que tal el mes","via":"atajo","ms":900}', now() - interval '61 minutes'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'aclaracion', null, '{"session_id":"b","message":"olvídalo","via":"jev","ms":500}', now() - interval '60 minutes'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000003', 'mensaje', 'aclaracion', 'fc300000-0000-4000-8000-000000000004', '{"session_id":"c","message":"prueba","via":"jev","ms":50}', now() - interval '2 hours'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'aclaracion', 'fc300000-0000-4000-8000-000000000005', '{"session_id":"d","message":"olvídalo","via":"jev","ms":50,"origen":"bateria"}', now() - interval '2 hours'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'mensaje', 'aclaracion', null, '{"session_id":"d","message":"antiguo"}', now() - interval '2 hours');
insert into copilot_drafts (id, user_id, org_id, message_id, draft, status, expires_at) values
  ('fc200000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000002', '{"kind":"merma"}', 'confirmado', now() + interval '1 day'),
  ('fc200000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000003', '{"kind":"merma"}', 'pendiente', now() + interval '1 day'),
  ('fc200000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000003', 'fc100000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000004', '{"kind":"pedido"}', 'pendiente', now() + interval '1 day'),
  ('fc200000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000005', '{"kind":"traspaso"}', 'pendiente', now() + interval '1 day');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"fc000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select copilot_indicators('fc100000-0000-4000-8000-000000000001')$$, '42501', 'forbidden', 'Un encargado no ve los indicadores');

select set_config('request.jwt.claims', '{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temp table r as select copilot_indicators('fc100000-0000-4000-8000-000000000001') as j;
select is((select (j ->> 'mensajes')::int from r), 6, 'Cuenta los mensajes de personas con rastro (sin la cuenta de pruebas, la batería ni lo antiguo)');
select is((select (j ->> 'aclaraciones')::int from r), 4, 'Cuenta las aclaraciones');
select is((select (j ->> 'conversaciones')::int from r), 2, 'Cuenta las conversaciones');
select is((select (j ->> 'con_bucle')::int from r), 1, 'Tres aclaraciones seguidas son un bucle');
select is((select (j ->> 'racha_max')::int from r), 3, 'La racha más larga');
select is((select (j ->> 'sin_resolver')::int from r), 1, 'Acabar en aclaración hace más de 30 minutos es no resolver');
select is((select (j ->> 'cancelaciones')::int from r), 1, '«olvídalo» cuenta como cancelación');
select is((select j -> 'por_via' -> 0 ->> 'via' from r), 'aclaracion', 'Por vía, de más a menos mensajes (a igualdad, por nombre)');
select is((select j -> 'borradores' from r), '[{"tipo": "merma", "preparados": 2, "confirmados": 1}]'::jsonb, 'Borradores preparados y confirmados, sin los de pruebas');
select is((select (copilot_indicators('fc100000-0000-4000-8000-000000000001', 30, true) ->> 'mensajes')::int), 8, 'Con las pruebas y las baterías, si se piden (lo antiguo sin rastro nunca)');
select is((select (copilot_indicators('fc100000-0000-4000-8000-000000000001', 30, true) -> 'borradores' -> 0 ->> 'tipo')), 'merma', 'Con las pruebas, también sus borradores');

select * from finish();
rollback;
