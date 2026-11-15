-- Retoques de familias de la lista «DRIVE WARRO»:
--   · «Papel y Celulosa» se traspasa a «Packaging y Desechables» y la familia se elimina.
--   · Se crea la familia «Dulces y Postres» en Comida (golosinas, helados…), vacía: los productos los asigna
--     quien lleva el catálogo.
-- Solo mueve productos entre familias existentes y crea o elimina familias; no toca stock ni precios.

create or replace function familias_desechables_dulces(p_org uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_papel uuid;
  v_desechables uuid;
  v_comida uuid;
begin
  select c.id into v_papel from categories c join categories p on p.id = c.parent_id
    where c.org_id = p_org and p.name = 'Packing y limpieza' and c.name = 'Papel y Celulosa';
  select c.id into v_desechables from categories c join categories p on p.id = c.parent_id
    where c.org_id = p_org and p.name = 'Packing y limpieza' and c.name = 'Packaging y Desechables';
  if v_papel is not null and v_desechables is not null then
    update products set category_id = v_desechables where category_id = v_papel;
    delete from categories where id = v_papel and not exists (select 1 from products where category_id = v_papel);
  end if;

  select id into v_comida from categories where org_id = p_org and parent_id is null and name = 'Comida';
  if v_comida is not null and not exists (select 1 from categories where org_id = p_org and parent_id = v_comida and name = 'Dulces y Postres') then
    insert into categories (org_id, parent_id, name) values (p_org, v_comida, 'Dulces y Postres');
  end if;
end $$;

revoke all on function familias_desechables_dulces(uuid) from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select id from organizations loop
    perform familias_desechables_dulces(r.id);
  end loop;
end $$;
