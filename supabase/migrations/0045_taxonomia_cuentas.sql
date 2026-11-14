-- Taxonomía de cuentas de análisis, paso 1 de la reorganización del catálogo.
-- Crea las cuentas (nivel 1: BEBIDA, COMIDA…) y sus familias (nivel 2) en cada organización.
-- Es aditiva e idempotente: no mueve ni cambia ningún producto ni categoría existente. El reparto de los
-- productos en estas familias se hace después, con la importación del catálogo.

create or replace function taxonomia_cuentas(p_org uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into categories (org_id, parent_id, name, sort_order)
  select p_org, null, c.name, c.ord
  from (values
  ('BEBIDA', 1),
  ('COMIDA', 2),
  ('SUMINISTROS', 3),
  ('MENAJE', 4),
  ('PACKING Y LIMPIEZA', 5),
  ('MANTENIMIENTO', 6),
  ('OFICINA', 7)
  ) as c(name, ord)
  on conflict (org_id, parent_id, name) do nothing;

  insert into categories (org_id, parent_id, name, sort_order)
  select p_org, cuenta.id, f.familia, f.ord
  from (values
  ('BEBIDA', 'Vinos Tintos', 1),
  ('BEBIDA', 'Vinos Blancos', 2),
  ('BEBIDA', 'Vinos Rosados', 3),
  ('BEBIDA', 'Vinos Espumosos', 4),
  ('BEBIDA', 'Cervezas', 5),
  ('BEBIDA', 'Destilados y Licores', 6),
  ('BEBIDA', 'Aguas, Refrescos y Zumos', 7),
  ('BEBIDA', 'Café e Infusiones', 8),
  ('BEBIDA', 'Coctelería (Siropes y Purés)', 9),
  ('BEBIDA', 'Envases Retornables', 10),
  ('COMIDA', 'Carnes', 11),
  ('COMIDA', 'Embutidos y Salazones', 12),
  ('COMIDA', 'Pescados y Mariscos', 13),
  ('COMIDA', 'Verduras y Hortalizas', 14),
  ('COMIDA', 'Frutas', 15),
  ('COMIDA', 'Lácteos y Huevos', 16),
  ('COMIDA', 'Panadería, Harinas y Pasta', 17),
  ('COMIDA', 'Pastelería y Postres', 18),
  ('COMIDA', 'Arroces, Legumbres y Cereales', 19),
  ('COMIDA', 'Frutos Secos y Snacks', 20),
  ('COMIDA', 'Aceites, Grasas y Vinagres', 21),
  ('COMIDA', 'Conservas y Encurtidos', 22),
  ('COMIDA', 'Salsas y Caldos', 23),
  ('COMIDA', 'Especias, Hierbas y Sales', 24),
  ('COMIDA', 'Productos Orientales', 25),
  ('COMIDA', 'Elaborados', 26),
  ('SUMINISTROS', 'Gases, Combustibles y Hielo', 27),
  ('MENAJE', 'Cristalería', 28),
  ('MENAJE', 'Vajilla', 29),
  ('MENAJE', 'Cubertería', 30),
  ('MENAJE', 'Menaje de Sala', 31),
  ('MENAJE', 'Utensilios de Cocina y Bar', 32),
  ('MENAJE', 'Ollas, Sartenes y Recipientes', 33),
  ('PACKING Y LIMPIEZA', 'Productos de Limpieza', 34),
  ('PACKING Y LIMPIEZA', 'Útiles de Limpieza', 35),
  ('PACKING Y LIMPIEZA', 'Papel y Celulosa', 36),
  ('PACKING Y LIMPIEZA', 'Packaging y Desechables', 37),
  ('PACKING Y LIMPIEZA', 'Consumibles de Cocina', 38),
  ('MANTENIMIENTO', 'Mantenimiento y Reparaciones', 39),
  ('OFICINA', 'Papelería e Imprenta', 40)
  ) as f(cuenta, familia, ord)
  join categories cuenta on cuenta.org_id = p_org and cuenta.parent_id is null and cuenta.name = f.cuenta
  on conflict (org_id, parent_id, name) do nothing;
end;
$$;

-- Solo el servidor la llama (con la clave de servicio o la migración): no es una acción de los usuarios.
revoke all on function taxonomia_cuentas(uuid) from public, anon, authenticated;

select taxonomia_cuentas(id) from organizations;
