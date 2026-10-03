begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- Una organización con dos locales y su equipo; una persona sin acceso todavía.
insert into auth.users (id, email, email_confirmed_at) values
  ('e1000000-0000-4000-8000-000000000001', 'team-owner@example.com', now()),
  ('e1000000-0000-4000-8000-000000000002', 'team-admin@example.com', now()),
  ('e1000000-0000-4000-8000-000000000003', 'team-manager@example.com', now()),
  ('e1000000-0000-4000-8000-000000000004', 'team-staff@example.com', now()),
  ('e1000000-0000-4000-8000-000000000005', 'team-both@example.com', now()),
  ('e1000000-0000-4000-8000-000000000006', 'team-new@example.com', null),
  ('e1000000-0000-4000-8000-000000000007', 'team-other@example.com', now());
insert into organizations (id, name) values
  ('e2000000-0000-4000-8000-000000000001', 'Org equipo'),
  ('e2000000-0000-4000-8000-000000000002', 'Otra org equipo');
insert into locations (id, org_id, name) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Bar'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Terraza');
insert into memberships (org_id, user_id, role, all_locations) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner', true),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'admin', true),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'manager', false),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'staff', false),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000005', 'staff', false),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000007', 'owner', true);
insert into membership_locations (org_id, user_id, location_id) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000005', 'e3000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000005', 'e3000000-0000-4000-8000-000000000002');

select is(
  (select count(*)::int from pg_policy where polrelid in ('public.memberships'::regclass, 'public.membership_locations'::regclass) and polcmd <> 'r'),
  0,
  'team tables cannot be written directly'
);

set local role authenticated;

-- Administrador: no puede ascenderse escribiendo en la tabla ni tocar al propietario.
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
update memberships set role = 'owner' where user_id = 'e1000000-0000-4000-8000-000000000002';
select is((select role::text from memberships where user_id = 'e1000000-0000-4000-8000-000000000002'), 'admin', 'an admin cannot promote themselves');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000001', 'staff')$$, '42501', 'forbidden', 'an admin cannot demote the owner');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000006', 'admin')$$, '42501', 'forbidden', 'an admin cannot create admins');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000002', 'staff', false, '{e3000000-0000-4000-8000-000000000001}')$$, '42501', 'self', 'nobody changes their own access');
select is((select count(*)::int from team_members()), 5, 'an admin sees the whole team');

-- Encargado del Bar: ve a su gente, da de alta personal solo en su local.
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from team_members()), 3, 'a manager sees themselves and the staff of their locations');
select ok(not exists (select 1 from team_members() where role in ('owner', 'admin')), 'a manager does not see the management');
select lives_ok(
  $$select team_set_member('e1000000-0000-4000-8000-000000000006', 'staff', false, '{e3000000-0000-4000-8000-000000000001}', 'Camarero nuevo')$$,
  'a manager adds staff to their location'
);
select is((select full_name from profiles where user_id = 'e1000000-0000-4000-8000-000000000006'), 'Camarero nuevo', 'the name is saved');
select ok((select pending from team_members() where user_id = 'e1000000-0000-4000-8000-000000000006'), 'someone who never signed in shows as pending');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000006', 'manager', false, '{e3000000-0000-4000-8000-000000000001}')$$, '42501', 'forbidden', 'a manager cannot create managers');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000006', 'staff', false, '{e3000000-0000-4000-8000-000000000002}')$$, '42501', 'location_forbidden', 'a manager cannot give access to another location');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000006', 'staff', true, '{}')$$, '42501', 'location_forbidden', 'a manager cannot give access to every location');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000006', 'staff', false, '{}')$$, '22023', 'no_locations', 'staff needs at least one location');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000007', 'staff', false, '{e3000000-0000-4000-8000-000000000001}')$$, '23505', 'other_org', 'someone from another organization cannot be added');
select lives_ok($$select team_remove_member('e1000000-0000-4000-8000-000000000005')$$, 'a manager removes someone from their location');
reset role;
select is(
  (select array_agg(location_id)::text from membership_locations where user_id = 'e1000000-0000-4000-8000-000000000005'),
  '{e3000000-0000-4000-8000-000000000002}',
  'removing them only takes the manager''s location: they keep the terrace'
);

-- Personal: no gestiona equipo. Nadie desde la app busca cuentas por email.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select * from team_members()$$, '42501', 'forbidden', 'staff cannot see the team');
select throws_ok($$select team_set_member('e1000000-0000-4000-8000-000000000006', 'staff', false, '{e3000000-0000-4000-8000-000000000001}')$$, '42501', 'forbidden', 'staff cannot add people');
select throws_ok($$select auth_user_id_by_email('team-owner@example.com')$$, '42501', null, 'looking up accounts by email is for the server only');

-- Propietario: puede nombrar administradores; un administrador ve todos los locales.
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select team_set_member('e1000000-0000-4000-8000-000000000003', 'admin');
reset role;
select ok(
  (select all_locations and not exists (select 1 from membership_locations ml where ml.user_id = m.user_id) from memberships m where user_id = 'e1000000-0000-4000-8000-000000000003'),
  'an admin always has every location'
);

select * from finish();
rollback;
