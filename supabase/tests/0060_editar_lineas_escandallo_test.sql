begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('fa000000-0000-4000-8000-000000000001', 'editar-encargado@example.com', now()),
  ('fa000000-0000-4000-8000-000000000002', 'editar-personal@example.com', now());
insert into organizations (id, name) values ('fa100000-0000-4000-8000-000000000001', 'Org editar escandallo');
insert into memberships (org_id, user_id, role, all_locations) values
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'manager', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'staff', true);
insert into products (id, org_id, name, dimension) values
  ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Jamón editar', 'mass'),
  ('fa300000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'Queso editar', 'mass');
insert into recipes (id, org_id, name, kind, yield_qty, yield_unit) values
  ('fa400000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Croquetas editar', 'plato', 1, 'racion'),
  ('fa400000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'Bechamel editar', 'elaboracion', 1000, 'g');
insert into recipe_lines (id, recipe_id, product_id, sub_recipe_id, qty, sort_order) values
  ('fa500000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', null, 100, 1),
  ('fa500000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000002', null, 'fa400000-0000-4000-8000-000000000001', 1, 1);

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"fa000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select edit_recipe_lines('fa400000-0000-4000-8000-000000000001', '[{"op":"remove","line_id":"fa500000-0000-4000-8000-000000000001"}]')$$, '42501', 'forbidden', 'El personal no cambia escandallos');

select set_config('request.jwt.claims', '{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$select edit_recipe_lines('fa400000-0000-4000-8000-000000000001', '[{"op":"set","line_id":"fa500000-0000-4000-8000-000000000001","qty":150},{"op":"add","product_id":"fa300000-0000-4000-8000-000000000002","qty":20}]')$$, 'Cambia el jamón y añade el queso');
select is((select array_agg(p.name || ' ' || l.qty::int order by l.sort_order) from recipe_lines l join products p on p.id = l.product_id where l.recipe_id = 'fa400000-0000-4000-8000-000000000001'),
  array['Jamón editar 150', 'Queso editar 20'], 'Quedan las dos líneas, la nueva al final');
select throws_ok($$select edit_recipe_lines('fa400000-0000-4000-8000-000000000001', '[{"op":"remove","line_id":"fa500000-0000-4000-8000-0000000000ff"}]')$$, '40001', 'line_changed', 'Una línea que ya no está no se pisa');
select is((select count(*)::int from recipe_lines where recipe_id = 'fa400000-0000-4000-8000-000000000001'), 2, 'Y no se cambia nada');
select throws_ok($$select edit_recipe_lines('fa400000-0000-4000-8000-000000000001', '[{"op":"add","sub_recipe_id":"fa400000-0000-4000-8000-000000000002","qty":50}]')$$, '23514', null, 'Una elaboración que usa el plato no puede ser ingrediente suyo');
select lives_ok($$select edit_recipe_lines('fa400000-0000-4000-8000-000000000001', '[{"op":"remove","line_id":"fa500000-0000-4000-8000-000000000001"}]')$$, 'Quita el jamón');
select throws_ok($$select edit_recipe_lines('fa400000-0000-4000-8000-000000000001', '[]')$$, '22023', 'invalid_changes', 'Sin cambios, error');

select * from finish();
rollback;
