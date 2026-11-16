-- Familias del catálogo: los productos que la importación del Drive dejó en raíces antiguas (Vinos, Destilados,
-- Comida (antigua)…) vuelven a su cuenta de la taxonomía (0045), y se borran las raíces y subfamilias que quedan
-- vacías. Solo cambia category_id y elimina categorías sin productos: no toca stock, precios ni recetas.
--
-- Idempotente: si no hay familias antiguas (o ya se movieron), no hace nada. Si una familia de origen existe
-- pero su destino no, falla y no cambia nada, en vez de dejar productos en una raíz antigua.

create or replace function reordena_familias_catalogo(p_org uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_origen uuid;
  v_destino uuid;
begin
  for m in select * from (values
    ('Aguas', 'Con gas', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Aguas', 'Sin gas', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Café e infusiones', 'Azúcar y endulzantes', 'Bebida', 'Café e Infusiones'),
    ('Café e infusiones', 'Café', 'Bebida', 'Café e Infusiones'),
    ('Café e infusiones', 'Infusiones', 'Bebida', 'Café e Infusiones'),
    ('Café e infusiones', 'Leche', 'Comida', 'Lácteos y Huevos'),
    ('Cervezas', 'Barril', 'Bebida', 'Cervezas'),
    ('Cervezas', 'Botellín y tercio', 'Bebida', 'Cervezas'),
    ('Cocina', 'Ingredientes de escandallo', 'Comida', 'Elaborados'),
    ('Comida (antigua)', 'Aceites y vinagres', 'Comida', 'Aceites, Grasas y Vinagres'),
    ('Comida (antigua)', 'Aceitunas y encurtidos', 'Comida', 'Conservas y Encurtidos'),
    ('Comida (antigua)', 'Carnes', 'Comida', 'Carnes'),
    ('Comida (antigua)', 'Congelados y helados', 'Comida', 'Dulces y Postres'),
    ('Comida (antigua)', 'Despensa', 'Comida', 'Elaborados'),
    ('Comida (antigua)', 'Especias', 'Comida', 'Especias, Hierbas y Sales'),
    ('Comida (antigua)', 'Lácteos, quesos y huevos', 'Comida', 'Lácteos y Huevos'),
    ('Comida (antigua)', 'Pan', 'Comida', 'Panadería, Harinas y Pasta'),
    ('Comida (antigua)', 'Pescado y marisco', 'Comida', 'Pescados y Mariscos'),
    ('Comida (antigua)', 'Repostería y texturizantes', 'Comida', 'Panadería, Harinas y Pasta'),
    ('Comida (antigua)', 'Salsas', 'Comida', 'Salsas y Caldos'),
    ('Comida (antigua)', 'Verduras y hortalizas', 'Comida', 'Verduras y Hortalizas'),
    ('Destilados', 'Brandy', 'Bebida', 'Destilados y Licores'),
    ('Destilados', 'Ginebra', 'Bebida', 'Destilados y Licores'),
    ('Destilados', 'Licores', 'Bebida', 'Destilados y Licores'),
    ('Destilados', 'Ron', 'Bebida', 'Destilados y Licores'),
    ('Destilados', 'Tequila', 'Bebida', 'Destilados y Licores'),
    ('Destilados', 'Vermut', 'Bebida', 'Destilados y Licores'),
    ('Destilados', 'Vodka', 'Bebida', 'Destilados y Licores'),
    ('Destilados', 'Whisky', 'Bebida', 'Destilados y Licores'),
    ('Fruta y guarnición', 'Cítricos', 'Comida', 'Frutas'),
    ('Fruta y guarnición', 'Fruta para bandejas', 'Comida', 'Frutas'),
    ('Fruta y guarnición', 'Frutos rojos', 'Comida', 'Frutas'),
    ('Fruta y guarnición', 'Guarnición', 'Comida', 'Frutas'),
    ('Refrescos y mixers', 'Bebidas vegetales y batidos', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Refrescos y mixers', 'Isotónicas', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Refrescos y mixers', 'Refrescos', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Refrescos y mixers', 'Té frío', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Refrescos y mixers', 'Tónicas', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Sala y menaje', 'Cristalería', 'Menaje', 'Cristalería'),
    ('Sala y menaje', 'Cubertería y utensilios', 'Menaje', 'Cubertería'),
    ('Sala y menaje', 'Vajilla y menaje', 'Menaje', 'Vajilla'),
    ('Snacks y picoteo', 'Dulces', 'Comida', 'Dulces y Postres'),
    ('Snacks y picoteo', 'Frutos secos', 'Comida', 'Frutos Secos'),
    ('Snacks y picoteo', 'Salados', 'Comida', 'Frutos Secos'),
    ('Vinos', 'Blanco', 'Bebida', 'Vinos Blancos'),
    ('Vinos', 'Dulce', 'Bebida', 'Vinos Blancos'),
    ('Vinos', 'Espumoso', 'Bebida', 'Vinos Espumosos'),
    ('Vinos', 'Generoso', 'Bebida', 'Destilados y Licores'),
    ('Vinos', 'Rosado', 'Bebida', 'Vinos Rosados'),
    ('Vinos', 'Tinto', 'Bebida', 'Vinos Tintos'),
    ('Zumos y siropes', 'Zumos', 'Bebida', 'Aguas, Refrescos y Zumos'),
    ('Zumos y siropes', 'Purés y siropes', 'Bebida', 'Coctelería (Siropes y Purés)'),
    ('Zumos y siropes', 'Siropes', 'Bebida', 'Coctelería (Siropes y Purés)')
  ) as t(raiz, familia, cuenta, destino) loop
    select c.id into v_origen from categories c join categories r on r.id = c.parent_id
      where r.org_id = p_org and r.parent_id is null and r.name = m.raiz and c.name = m.familia;
    continue when v_origen is null;

    select d.id into v_destino from categories d join categories cu on cu.id = d.parent_id
      where cu.org_id = p_org and cu.parent_id is null and cu.name = m.cuenta and d.name = m.destino;
    if v_destino is null then
      raise exception 'Falta la familia % › % en la cuenta %', m.cuenta, m.destino, m.cuenta using errcode = 'LA100';
    end if;

    update products set category_id = v_destino where org_id = p_org and category_id = v_origen;
  end loop;

  -- Subfamilias vacías de las raíces antiguas, y después las raíces que quedan vacías.
  delete from categories c
  using categories r
  where c.parent_id = r.id and r.org_id = p_org and r.parent_id is null
    and r.name in ('Aguas', 'Café e infusiones', 'Cervezas', 'Champán', 'Cocina', 'Comida (antigua)', 'Consumibles',
                   'Destilados', 'Energéticas', 'Fruta y guarnición', 'Hielo', 'PEPICO', 'Refrescos y mixers',
                   'Sala y menaje', 'Snacks y picoteo', 'Vinos', 'Zumos y siropes')
    and not exists (select 1 from products p where p.category_id = c.id);

  delete from categories r
  where r.org_id = p_org and r.parent_id is null
    and r.name in ('Aguas', 'Café e infusiones', 'Cervezas', 'Champán', 'Cocina', 'Comida (antigua)', 'Consumibles',
                   'Destilados', 'Energéticas', 'Fruta y guarnición', 'Hielo', 'PEPICO', 'Refrescos y mixers',
                   'Sala y menaje', 'Snacks y picoteo', 'Vinos', 'Zumos y siropes')
    and not exists (select 1 from categories h where h.parent_id = r.id)
    and not exists (select 1 from products p where p.category_id = r.id);
end $$;

revoke all on function reordena_familias_catalogo(uuid) from public, anon, authenticated;

select reordena_familias_catalogo(id) from organizations;
