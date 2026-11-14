-- Retoques de familias de la lista «DRIVE WARRO» (sección productos):
--   · Las cartas pasan a MENAJE › Menaje de Sala.
--   · Pastelería y Postres se traspasa a Panadería, Harinas y Pasta, y la familia se elimina.
--   · Frutos Secos y Snacks pasa a ser Frutos Secos; las aceitunas van a Conservas y Encurtidos.
--   · Se elimina la categoría antigua «Cartas» si ya no tiene productos.
-- Solo mueve productos entre familias existentes y renombra o elimina familias vacías.

create or replace function reorganiza_familias_productos(p_org uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menaje_sala uuid;
  v_panaderia uuid;
  v_pasteleria uuid;
  v_conservas uuid;
  v_frutos uuid;
begin
  select c.id into v_menaje_sala from categories c join categories p on p.id = c.parent_id
    where c.org_id = p_org and p.name = 'MENAJE' and c.name = 'Menaje de Sala';
  select c.id into v_panaderia from categories c join categories p on p.id = c.parent_id
    where c.org_id = p_org and p.name = 'COMIDA' and c.name = 'Panadería, Harinas y Pasta';
  select c.id into v_pasteleria from categories c join categories p on p.id = c.parent_id
    where c.org_id = p_org and p.name = 'COMIDA' and c.name = 'Pastelería y Postres';
  select c.id into v_conservas from categories c join categories p on p.id = c.parent_id
    where c.org_id = p_org and p.name = 'COMIDA' and c.name = 'Conservas y Encurtidos';
  select c.id into v_frutos from categories c join categories p on p.id = c.parent_id
    where c.org_id = p_org and p.name = 'COMIDA' and c.name = 'Frutos Secos y Snacks';

  -- 1) Cartas (productos cuyo nombre empieza por «Carta») a Menaje de Sala.
  if v_menaje_sala is not null then
    update products set category_id = v_menaje_sala
    where org_id = p_org and name ilike 'carta %';
  end if;

  -- 2) Pastelería y Postres a Panadería, Harinas y Pasta; luego se elimina la familia vacía.
  if v_pasteleria is not null and v_panaderia is not null then
    update products set category_id = v_panaderia where category_id = v_pasteleria;
    delete from categories where id = v_pasteleria and not exists (select 1 from products where category_id = v_pasteleria);
  end if;

  -- 3) Aceitunas de Frutos Secos y Snacks a Conservas y Encurtidos; luego Frutos Secos (sin «y Snacks»).
  if v_frutos is not null and v_conservas is not null then
    update products set category_id = v_conservas where category_id = v_frutos and name ilike '%aceitun%';
  end if;
  if v_frutos is not null then
    update categories set name = 'Frutos Secos' where id = v_frutos;
  end if;

  -- 4) La categoría antigua «Cartas» (de Sala y menaje) se elimina si ya no tiene productos.
  delete from categories c
  using categories p
  where c.parent_id = p.id and p.org_id = p_org and p.name = 'Sala y menaje' and c.name = 'Cartas'
    and not exists (select 1 from products pr where pr.category_id = c.id);
end $$;

revoke all on function reorganiza_familias_productos(uuid) from public, anon, authenticated;

select reorganiza_familias_productos(id) from organizations;
