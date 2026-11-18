-- Fuentes de precio: «proveedores» que solo guardan un precio para valorar, no alguien a quien se le pide.
--
-- La importación de escandallos (0036) guarda sus precios en el proveedor «Precios de escandallo» (código ESC), y
-- los precios estimados se guardan en «Precio de referencia (estimado)». Como el pedido elige el proveedor por el
-- último precio de cada formato, esas fuentes acababan recibiendo pedidos. Con esta marca, pedir solo mira
-- proveedores reales; valorar el stock y los escandallos sigue usando todos los precios.

alter table suppliers add column if not exists is_price_source boolean not null default false;
comment on column suppliers.is_price_source is
  'Fuente de precio (escandallos importados, precios estimados): sirve para valorar, nunca para pedir.';

-- La fuente que crea la importación de escandallos nace marcada, sin tener que tocar import_recipes.
create or replace function mark_recipe_price_source() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.code = 'ESC' then new.is_price_source := true; end if;
  return new;
end $$;

drop trigger if exists suppliers_price_source on suppliers;
create trigger suppliers_price_source before insert on suppliers
  for each row execute function mark_recipe_price_source();

-- Las que ya existen.
update suppliers set is_price_source = true
 where code = 'ESC' or name ilike 'precio de referencia%' or name ilike '%(estimado)%';
