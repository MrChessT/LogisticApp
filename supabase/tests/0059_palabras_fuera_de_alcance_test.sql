begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into auth.users (id, email, email_confirmed_at) values
  ('ff000000-0000-4000-8000-000000000001', 'palabras-gerente@example.com', now()),
  ('ff000000-0000-4000-8000-000000000002', 'palabras-cocinero@example.com', now());
insert into organizations (id, name) values ('ff100000-0000-4000-8000-000000000001', 'Org palabras');
insert into memberships (org_id, user_id, role, all_locations) values
  ('ff100000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 'manager', true),
  ('ff100000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000002', 'staff', true);
insert into categories (id, org_id, parent_id, name, sort_order) values
  ('ff200000-0000-4000-8000-000000000001', 'ff100000-0000-4000-8000-000000000001', null, 'Bebida', 1),
  ('ff200000-0000-4000-8000-000000000002', 'ff100000-0000-4000-8000-000000000001', 'ff200000-0000-4000-8000-000000000001', 'Ginebra', 1),
  ('ff200000-0000-4000-8000-000000000003', 'ff100000-0000-4000-8000-000000000001', null, 'Comida', 2);
insert into products (org_id, category_id, name, dimension) values
  ('ff100000-0000-4000-8000-000000000001', 'ff200000-0000-4000-8000-000000000002', 'Beefeater 70 cl', 'volume'),
  ('ff100000-0000-4000-8000-000000000001', 'ff200000-0000-4000-8000-000000000003', 'Tomate pera', 'mass');
insert into membership_accounts (org_id, user_id, account_id) values
  ('ff100000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000002', 'ff200000-0000-4000-8000-000000000003');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"ff000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from hidden_catalog_words()), 0, 'Sin cuentas asignadas no hay nada oculto');

select set_config('request.jwt.claims', '{"sub":"ff000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select array_agg(word order by word) from hidden_catalog_words()), array['bebida', 'beefeater', 'ginebra'], 'Palabras de lo que no ve (4 letras o más)');
select is((select distinct account from hidden_catalog_words()), 'Bebida', 'Con su cuenta');

select * from finish();
rollback;
