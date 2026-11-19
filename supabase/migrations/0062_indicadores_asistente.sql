-- Indicadores del asistente (fase 0 del plan de mejora): lo que dice si funciona en uso real, no en la batería.
--
-- copilot_indicators(p_org, p_days, p_include_tests) → jsonb, solo para la administración de la organización.
--   · Aclaraciones: cuántas respuestas son una pregunta de vuelta.
--   · Bucles: conversaciones con 3 o más aclaraciones seguidas, y la racha más larga.
--   · Sin resolver: conversaciones cuya última respuesta fue una aclaración (y hace más de 30 minutos).
--   · Cancelaciones: mensajes que abandonan lo pedido («olvídalo», «cancela», «déjalo»).
--   · Por vía (archivo, atajo, Jev, botón…): mensajes, aclaraciones y latencia p50/p90 (los turnos con rastro).
--   · Borradores por tipo: preparados y confirmados.
-- Solo cuenta los turnos con rastro (detail.via, desde la fase 0): los anteriores no distinguen las baterías del uso
-- real y la auditoría no se puede corregir (es inmutable). La foto anterior está en docs/copiloto/INFORME_ASISTENTE_2026-11.md.
-- Por defecto sin las baterías (detail.origen = 'bateria') ni las cuentas en modo pruebas (memberships.assistant_test).

create or replace function copilot_indicators(p_org uuid, p_days int default 30, p_include_tests boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  result jsonb;
begin
  if not is_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;

  with people as (
    select m.user_id from memberships m
     where m.org_id = p_org and (p_include_tests or not coalesce(m.assistant_test, false))
  ),
  msgs as (
    select a.created_at, a.outcome, a.message_id, a.detail ->> 'session_id' as session_id, a.detail ->> 'via' as via,
           (a.detail ->> 'ms')::int as ms, lower(coalesce(a.detail ->> 'message', '')) as message
      from copilot_audit a
     where a.org_id = p_org and a.kind = 'mensaje' and a.created_at >= since and a.detail ? 'via'
       and a.user_id in (select user_id from people)
       and (p_include_tests or coalesce(a.detail ->> 'origen', '') <> 'bateria')
  ),
  ordered as (
    select m.*,
           row_number() over (partition by session_id order by created_at) as rn,
           row_number() over (partition by session_id, outcome = 'aclaracion' order by created_at) as rk,
           row_number() over (partition by session_id order by created_at desc) as from_end
      from msgs m
     where session_id is not null
  ),
  -- Rachas de aclaraciones seguidas: dentro de una racha, rn − rk no cambia (huecos e islas).
  runs as (
    select session_id, count(*) as n from ordered where outcome = 'aclaracion' group by session_id, rn - rk
  ),
  -- Borradores de los mensajes que cuentan: así tampoco entran los de las baterías.
  drafts as (
    select coalesce(d.draft ->> 'kind', 'otro') as kind, count(*) as prepared, count(*) filter (where d.status = 'confirmado') as confirmed
      from copilot_drafts d
     where d.org_id = p_org and d.message_id in (select message_id from msgs)
     group by 1
  ),
  vias as (
    select via, count(*) as n, count(*) filter (where outcome = 'aclaracion') as clarifications,
           percentile_cont(0.5) within group (order by ms) as p50, percentile_cont(0.9) within group (order by ms) as p90
      from msgs group by 1
  )
  select jsonb_build_object(
    'desde', since,
    'mensajes', (select count(*) from msgs),
    'aclaraciones', (select count(*) from msgs where outcome = 'aclaracion'),
    'conversaciones', (select count(distinct session_id) from msgs),
    'con_bucle', (select count(distinct session_id) from runs where n >= 3),
    'racha_max', coalesce((select max(n) from runs), 0),
    'sin_resolver', (select count(*) from ordered where from_end = 1 and outcome = 'aclaracion' and created_at < now() - interval '30 minutes'),
    'cancelaciones', (select count(*) from msgs where message ~ '^\s*(olvida|olvídalo|olvidalo|cancela|déjalo|dejalo|da igual)'),
    'por_via', coalesce((select jsonb_agg(jsonb_build_object('via', via, 'mensajes', n, 'aclaraciones', clarifications,
                          'p50_ms', round(p50), 'p90_ms', round(p90)) order by n desc, via) from vias), '[]'::jsonb),
    'borradores', coalesce((select jsonb_agg(jsonb_build_object('tipo', kind, 'preparados', prepared, 'confirmados', confirmed)
                          order by prepared desc) from drafts), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function copilot_indicators(uuid, int, boolean) from public, anon;
grant execute on function copilot_indicators(uuid, int, boolean) to authenticated;
