-- Opiniones sobre el asistente y modo pruebas.
--
-- 1. Cualquiera del equipo puede reportar qué le ha parecido mal (o qué falta) de una respuesta o de una
--    conversación entera. El reporte guarda una copia de la conversación para entenderlo sin contexto.
-- 2. La administración los revisa: los acepta, los descarta o los marca como hechos.
-- 3. «Modo pruebas» por persona (memberships.assistant_test): lo que confirme en el asistente NO se guarda.
--    Sirve para dejar probar el asistente con datos reales sin tocar el inventario. Solo afecta al
--    asistente: las pantallas de la app guardan igual que siempre.
-- Todo se escribe con funciones que comprueban quién llama; la tabla no admite escrituras directas.

alter table memberships add column if not exists assistant_test boolean not null default false;

create table if not exists copilot_feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  scope text not null check (scope in ('mensaje', 'conversacion')),
  category text not null check (category in ('incorrecto', 'no_entendio', 'falta_funcion', 'mejorar_texto', 'error', 'otro')),
  comment text not null check (char_length(btrim(comment)) between 3 and 2000),
  expected text check (char_length(expected) <= 2000),
  transcript jsonb not null default '[]'::jsonb
    check (jsonb_typeof(transcript) = 'array' and jsonb_array_length(transcript) <= 60 and octet_length(transcript::text) <= 200000),
  page text check (char_length(page) <= 200),
  test_mode boolean not null default false,
  status text not null default 'nueva' check (status in ('nueva', 'aceptada', 'descartada', 'hecha')),
  review_note text check (char_length(review_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists copilot_feedback_org on copilot_feedback (org_id, status, created_at desc);
create index if not exists copilot_feedback_user on copilot_feedback (user_id, created_at desc);

alter table copilot_feedback enable row level security;

-- Lectura: cada uno lo suyo; la administración, todo lo de su organización.
drop policy if exists copilot_feedback_select on copilot_feedback;
create policy copilot_feedback_select on copilot_feedback for select
  using (user_id = (select auth.uid()) or org_id in (select my_admin_org_ids()));

-- Reportar --------------------------------------------------------------------------------------------

create or replace function copilot_feedback_add(
  p_scope text,
  p_category text,
  p_comment text,
  p_expected text default null,
  p_transcript jsonb default '[]'::jsonb,
  p_session uuid default null,
  p_page text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m memberships;
  new_id uuid;
begin
  -- Las pantallas de almacén no usan el asistente.
  select * into m from memberships where user_id = auth.uid() and role <> 'kiosk' order by created_at limit 1;
  if m.user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into copilot_feedback (org_id, user_id, session_id, scope, category, comment, expected, transcript, page, test_mode)
  values (m.org_id, m.user_id, p_session, p_scope, p_category, btrim(p_comment), nullif(btrim(coalesce(p_expected, '')), ''),
          coalesce(p_transcript, '[]'::jsonb), left(p_page, 200), m.assistant_test)
  returning id into new_id;
  return new_id;
end $$;

-- Lista: la administración ve todos los de su organización; el resto, los suyos.
create or replace function copilot_feedback_list(p_status text default null, p_limit int default 200) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select f.id, f.scope, f.category, f.comment, f.expected, f.transcript, f.page, f.test_mode, f.status,
           f.review_note, f.reviewed_at, f.created_at,
           coalesce(nullif(btrim(p.full_name), ''), split_part(u.email, '@', 1), 'Alguien') as author,
           f.user_id = auth.uid() as mine,
           coalesce(nullif(btrim(rp.full_name), ''), split_part(ru.email, '@', 1)) as reviewed_by_name
    from copilot_feedback f
    join auth.users u on u.id = f.user_id
    left join profiles p on p.user_id = f.user_id
    left join auth.users ru on ru.id = f.reviewed_by
    left join profiles rp on rp.user_id = f.reviewed_by
    where (f.user_id = auth.uid() or f.org_id in (select my_admin_org_ids()))
      and (p_status is null or f.status = p_status)
    order by f.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ) x
$$;

-- Revisar: solo la administración. Devuelve cuántos ha cambiado.
create or replace function copilot_feedback_review(p_ids uuid[], p_status text, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  changed int;
begin
  if p_status not in ('nueva', 'aceptada', 'descartada', 'hecha') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update copilot_feedback f
  set status = p_status,
      review_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), f.review_note),
      reviewed_by = case when p_status = 'nueva' then null else auth.uid() end,
      reviewed_at = case when p_status = 'nueva' then null else now() end
  where f.id = any (coalesce(p_ids, '{}'))
    and f.org_id in (select my_admin_org_ids());
  get diagnostics changed = row_count;
  if changed = 0 and coalesce(cardinality(p_ids), 0) > 0 then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return changed;
end $$;

-- Modo pruebas -----------------------------------------------------------------------------------------

-- Quien gestiona a una persona (mismas reglas que Equipo) le activa o quita el modo pruebas. La
-- administración también puede ponérselo a sí misma para probar.
create or replace function team_set_tester(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  a memberships := team_actor(null);
begin
  if a.user_id is null or a.role in ('staff', 'kiosk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (
    (p_user = a.user_id and a.role in ('owner', 'admin'))
    or exists (select 1 from team_members() t where t.user_id = p_user and t.can_edit)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update memberships set assistant_test = coalesce(p_on, false)
  where org_id = a.org_id and user_id = p_user and role <> 'kiosk';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end $$;

revoke all on table copilot_feedback from anon;
revoke insert, update, delete on table copilot_feedback from authenticated;
revoke all on function copilot_feedback_add(text, text, text, text, jsonb, uuid, text) from public, anon;
revoke all on function copilot_feedback_list(text, int) from public, anon;
revoke all on function copilot_feedback_review(uuid[], text, text) from public, anon;
revoke all on function team_set_tester(uuid, boolean) from public, anon;
grant execute on function copilot_feedback_add(text, text, text, text, jsonb, uuid, text) to authenticated;
grant execute on function copilot_feedback_list(text, int) to authenticated;
grant execute on function copilot_feedback_review(uuid[], text, text) to authenticated;
grant execute on function team_set_tester(uuid, boolean) to authenticated;
