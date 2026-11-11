-- Registro de errores de la aplicación (servidor, navegador y asistente).
--
--   app_errors        Un error por día y huella (mismo origen, mensaje y ruta): se cuenta cuántas veces
--                     ocurre en vez de guardar una fila por vez. Sin datos del negocio: mensaje técnico,
--                     ruta sin parámetros y, si hay sesión, quién lo sufrió (para poder ayudarle).
--
--   report_app_error  Lo llama la propia aplicación al capturar un error. Devuelve true si es la primera
--                     vez hoy (entonces la aplicación avisa por el webhook de alertas, si está configurado).
--
-- Nadie lee la tabla desde la app (sin políticas): se consulta con scripts/ops/errores.sh.
-- La función la puede llamar cualquiera (también sin sesión: un fallo en el acceso es un fallo), así que
-- recorta lo que recibe y deja de crear filas nuevas a partir de 300 errores distintos al día.

create table app_errors (
  id bigint generated always as identity primary key,
  day date not null default current_date,
  fingerprint text not null,
  source text not null check (source in ('server', 'client', 'assistant')),
  message text not null,
  path text,
  digest text,
  detail jsonb not null default '{}'::jsonb,
  org_id uuid references organizations(id) on delete set null,
  user_id uuid,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (day, fingerprint)
);
create index app_errors_last_seen on app_errors (last_seen desc);

alter table app_errors enable row level security;

create or replace function report_app_error(p_source text, p_message text, p_path text default null, p_digest text default null, p_detail jsonb default '{}'::jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_message text := left(coalesce(nullif(btrim(p_message), ''), 'Error sin mensaje'), 500);
  -- Ruta sin parámetros ni identificadores: «/api/copiloto/chat», no «/productos?buscar=…».
  v_path text := left(regexp_replace(split_part(coalesce(p_path, ''), '?', 1), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'g'), 200);
  v_fingerprint text;
  v_user uuid := auth.uid();
  v_org uuid;
  v_new boolean;
begin
  if p_source not in ('server', 'client', 'assistant') then
    raise exception 'Origen no válido' using errcode = '22023';
  end if;
  v_fingerprint := md5(p_source || '|' || v_message || '|' || v_path);

  update app_errors set count = count + 1, last_seen = now()
  where day = current_date and fingerprint = v_fingerprint;
  if found then
    return false;
  end if;
  -- Tope diario de errores distintos: un bucle (o alguien de fuera) no llena la tabla.
  if (select count(*) from app_errors where day = current_date) >= 300 then
    return false;
  end if;

  if v_user is not null then
    select m.org_id into v_org from memberships m where m.user_id = v_user limit 1;
  end if;
  insert into app_errors (fingerprint, source, message, path, digest, detail, org_id, user_id)
  values (v_fingerprint, p_source, v_message, nullif(v_path, ''), left(p_digest, 80),
          case when pg_column_size(coalesce(p_detail, '{}'::jsonb)) <= 4000 then coalesce(p_detail, '{}'::jsonb) else '{}'::jsonb end,
          v_org, v_user)
  on conflict (day, fingerprint) do update set count = app_errors.count + 1, last_seen = now()
  returning (count = 1) into v_new;
  return coalesce(v_new, false);
end;
$$;
revoke all on function report_app_error(text, text, text, text, jsonb) from public;
grant execute on function report_app_error(text, text, text, text, jsonb) to anon, authenticated;
