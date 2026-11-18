-- Editar los ingredientes de un escandallo desde el asistente: añadir uno, quitarlo o cambiar su cantidad.
--
-- edit_recipe_lines(p_recipe, p_changes)  Aplica los cambios en un solo paso (o ninguno, si uno falla).
--   p_changes: [{ "op": "add", "product_id" | "sub_recipe_id", "qty" }, { "op": "remove", "line_id" },
--               { "op": "set", "line_id", "qty" }]. Las cantidades van en unidad base (g, ml, ud) o en la unidad de
--               rendimiento de la elaboración.
-- A diferencia de save_recipe, que sustituye todas las líneas (la pantalla manda la receta entera), aquí solo se
-- toca lo pedido: si mientras tanto alguien ha cambiado o borrado esa línea en Escandallos, se avisa (line_changed)
-- en vez de pisarlo. Permisos: los de siempre (encargados y administración, por RLS); quien no puede, «forbidden».
-- Una elaboración que acabaría dentro de sí misma la frena el disparador de siempre (recipe_cycle).

create or replace function edit_recipe_lines(p_recipe uuid, p_changes jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  c jsonb;
  v_next int;
begin
  if jsonb_typeof(coalesce(p_changes, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  if not exists (select 1 from recipes r where r.id = p_recipe and r.org_id in (select my_manager_org_ids())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(max(sort_order), 0) into v_next from recipe_lines where recipe_id = p_recipe;
  for c in select * from jsonb_array_elements(p_changes) loop
    case c->>'op'
      when 'add' then
        v_next := v_next + 1;
        insert into recipe_lines (recipe_id, product_id, sub_recipe_id, qty, sort_order)
        values (p_recipe, (c->>'product_id')::uuid, (c->>'sub_recipe_id')::uuid, (c->>'qty')::numeric, v_next);
      when 'remove' then
        delete from recipe_lines where id = (c->>'line_id')::uuid and recipe_id = p_recipe;
        if not found then raise exception 'line_changed' using errcode = '40001'; end if;
      when 'set' then
        update recipe_lines set qty = (c->>'qty')::numeric where id = (c->>'line_id')::uuid and recipe_id = p_recipe;
        if not found then raise exception 'line_changed' using errcode = '40001'; end if;
      else
        raise exception 'invalid_changes' using errcode = '22023';
    end case;
  end loop;
  update recipes set updated_at = now() where id = p_recipe;
end $$;
revoke all on function edit_recipe_lines(uuid, jsonb) from public, anon;
grant execute on function edit_recipe_lines(uuid, jsonb) to authenticated;
