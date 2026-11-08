-- Importación de escandallos (recetas y platos) con vista previa exacta, como import_catalog (0031).
--
-- import_recipes(p_org, p_payload, p_apply, p_create_missing):
--   p_payload = {"recipes": [{name, kind, category, yield_qty, yield_unit, lines: [{ingredient, product,
--                dimension, qty, waste, unit_price, allergens}]}]} (las elaboraciones antes que los platos).
--   · Cada ingrediente se casa, por este orden, con: una receta de la organización (también las de este
--     fichero) si rinde en una unidad compatible; un producto con el mismo nombre; un producto con el
--     nombre sin la preparación («Limón (Piel)» → «Limón»).
--   · Si no existe y p_create_missing: se crea el producto (familia «Cocina › Ingredientes de escandallo»,
--     formato Kilo, Litro o Unidad) con el precio del escandallo en el proveedor «Precios de escandallo»,
--     para que el coste salga desde el primer día; el primer albarán real lo sustituye.
--   · Los alérgenos de cada ingrediente se añaden a su producto.
--   · Una receta con el mismo nombre se actualiza (sus ingredientes se sustituyen).
--   Vista previa: hace todo y lo deshace. Con errores no se aplica nada. Solo administración.

-- Búsquedas por nombre normalizado (sin acentos ni mayúsculas): índice para no recorrer el catálogo
-- entero por cada ingrediente (con 400 recetas y 3.700 líneas la importación tardaba un minuto).
create index if not exists products_org_norm_name on products (org_id, norm_text(name));
create index if not exists recipes_org_norm_name on recipes (org_id, norm_text(name));

-- La fecha de la receta ya la pone recipes_touch al editarla; las líneas no la tocan una a una.
create or replace function recipe_lines_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := (select org_id from recipes where id = new.recipe_id);
begin
  if new.product_id is not null and (select org_id from products where id = new.product_id) is distinct from v_org then
    raise exception 'cross_org_ingredient' using errcode = '42501';
  end if;
  if new.sub_recipe_id is not null then
    if (select org_id from recipes where id = new.sub_recipe_id) is distinct from v_org then
      raise exception 'cross_org_ingredient' using errcode = '42501';
    end if;
    if exists (
      with recursive tree(id) as (
        select new.sub_recipe_id
        union
        select l.sub_recipe_id from recipe_lines l join tree t on l.recipe_id = t.id where l.sub_recipe_id is not null
      )
      select 1 from tree where id = new.recipe_id
    ) then
      raise exception 'recipe_cycle' using errcode = '23514', hint = 'Esa elaboración ya usa esta receta: no puede ser ingrediente suyo.';
    end if;
  end if;
  return new;
end $$;

create or replace function import_recipes_run(p_org uuid, p_payload jsonb, p_create_missing boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  l jsonb;
  n int;
  k int;
  v_recipe uuid;
  v_existing boolean;
  v_product uuid;
  v_sub uuid;
  v_sub_unit text;
  v_dim unit_dimension;
  v_line_dim text;
  v_family uuid;
  v_category uuid;
  v_supplier uuid;
  v_pack uuid;
  v_qty numeric;
  v_errors jsonb := '[]';
  v_label text;
  c_recipes_new int := 0; c_recipes_upd int := 0; c_lines int := 0; c_matched int := 0; c_subs int := 0;
  c_products_new int := 0; c_allergens int := 0; v_rc int;
  v_new_products text[] := '{}';
begin
  for r, n in select e, i::int from jsonb_array_elements(coalesce(p_payload->'recipes', '[]')) with ordinality t(e, i) loop
    v_label := r->>'name';
    begin
      select id into v_recipe from recipes where org_id = p_org and norm_text(name) = norm_text(r->>'name') limit 1;
      v_existing := v_recipe is not null;
      if v_existing then
        update recipes set kind = coalesce(r->>'kind', kind), category = coalesce(r->>'category', category),
               yield_qty = coalesce((r->>'yield_qty')::numeric, yield_qty), yield_unit = coalesce(r->>'yield_unit', yield_unit), active = true
        where id = v_recipe;
        delete from recipe_lines where recipe_id = v_recipe;
        c_recipes_upd := c_recipes_upd + 1;
      else
        insert into recipes (org_id, name, kind, category, yield_qty, yield_unit)
        values (p_org, btrim(r->>'name'), coalesce(r->>'kind', 'plato'), r->>'category', coalesce((r->>'yield_qty')::numeric, 1), coalesce(r->>'yield_unit', 'racion'))
        returning id into v_recipe;
        c_recipes_new := c_recipes_new + 1;
      end if;

      for l, k in select e, i::int from jsonb_array_elements(coalesce(r->'lines', '[]')) with ordinality t(e, i) loop
        v_line_dim := l->>'dimension';
        v_qty := (l->>'qty')::numeric;
        v_product := null;
        v_sub := null;
        -- 1) ¿Es otra receta (una elaboración)?
        select id, yield_unit into v_sub, v_sub_unit from recipes
        where org_id = p_org and id <> v_recipe and norm_text(name) in (norm_text(l->>'ingredient'), norm_text(l->>'product'))
        limit 1;
        if v_sub is not null and not (
             (v_sub_unit = 'g' and v_line_dim in ('mass', 'volume')) or (v_sub_unit = 'ml' and v_line_dim in ('mass', 'volume'))
             or (v_sub_unit in ('ud', 'racion') and v_line_dim = 'count')) then
          v_sub := null;
        end if;
        if v_sub is null then
          -- 2) y 3) Producto con el mismo nombre, o con el nombre sin la preparación.
          select id, dimension into v_product, v_dim from products
          where org_id = p_org and norm_text(name) in (norm_text(l->>'ingredient'), norm_text(l->>'product'))
          order by (norm_text(name) = norm_text(l->>'ingredient')) desc, active desc limit 1;
          if v_product is null then
            if not p_create_missing then
              raise exception 'No existe el ingrediente «%» en el catálogo.', l->>'product' using errcode = 'LA100';
            end if;
            -- 4) Se crea con el precio del escandallo.
            select id into v_family from categories where org_id = p_org and parent_id is null and norm_text(name) = 'cocina';
            if v_family is null then
              insert into categories (org_id, name, sort_order) values (p_org, 'Cocina', 50) returning id into v_family;
            end if;
            select id into v_category from categories where org_id = p_org and parent_id = v_family and norm_text(name) = 'ingredientes de escandallo';
            if v_category is null then
              insert into categories (org_id, parent_id, name, sort_order) values (p_org, v_family, 'Ingredientes de escandallo', 99) returning id into v_category;
            end if;
            insert into products (org_id, category_id, name, dimension, vat_rate)
            values (p_org, v_category, btrim(l->>'product'), v_line_dim::unit_dimension, 10)
            returning id, dimension into v_product, v_dim;
            insert into product_packs (product_id, name, qty_base, is_count_default, is_purchase_default)
            values (v_product, case v_line_dim when 'mass' then 'Kilo' when 'volume' then 'Litro' else 'Unidad' end,
                    case v_line_dim when 'count' then 1 else 1000 end, true, true)
            returning id into v_pack;
            if (l->>'unit_price')::numeric > 0 then
              select id into v_supplier from suppliers where org_id = p_org and code = 'ESC';
              if v_supplier is null then
                insert into suppliers (org_id, name, code, notes)
                values (p_org, 'Precios de escandallo', 'ESC', 'Precios tomados de los escandallos importados. Se sustituyen con el primer albarán de cada producto.')
                returning id into v_supplier;
              end if;
              insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at)
              values (v_supplier, v_pack, round((l->>'unit_price')::numeric * case v_line_dim when 'count' then 1 else 1000 end, 4), now());
            end if;
            c_products_new := c_products_new + 1;
            v_new_products := v_new_products || (btrim(l->>'product') || ' (' || case v_line_dim when 'mass' then 'kg' when 'volume' then 'l' else 'ud' end || ')');
          else
            c_matched := c_matched + 1;
          end if;
          if (v_dim = 'count') <> (v_line_dim = 'count') then
            raise exception '«%» se cuenta por unidades en el catálogo y en la receta va por peso o volumen (o al revés).', l->>'product' using errcode = 'LA100';
          end if;
          -- Alérgenos del ingrediente → su producto.
          insert into product_allergens (product_id, allergen)
          select v_product, a from jsonb_array_elements_text(coalesce(l->'allergens', '[]')) a
          on conflict do nothing;
          get diagnostics v_rc = row_count;
          c_allergens := c_allergens + v_rc;
        else
          c_subs := c_subs + 1;
        end if;
        insert into recipe_lines (recipe_id, product_id, sub_recipe_id, qty, waste_pct, sort_order)
        values (v_recipe, v_product, v_sub, v_qty, least(coalesce((l->>'waste')::numeric, 0), 94), c_lines + 1);
        c_lines := c_lines + 1;
      end loop;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', n, 'label', v_label, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'stats', jsonb_build_object('recipes_created', c_recipes_new, 'recipes_updated', c_recipes_upd, 'lines', c_lines,
      'matched', c_matched, 'sub_recipes', c_subs, 'products_created', c_products_new, 'allergens_added', c_allergens),
    'new_products', to_jsonb((select array_agg(x order by x) from (select distinct unnest(v_new_products) x) d)),
    'errors', v_errors);
end $$;
revoke all on function import_recipes_run(uuid, jsonb, boolean) from public, anon, authenticated;

create or replace function import_recipes(p_org uuid, p_payload jsonb, p_apply boolean default false, p_create_missing boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_ok boolean;
begin
  if not is_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload->'recipes') <> 'array' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if jsonb_array_length(p_payload->'recipes') > 3000 then raise exception 'too_many_rows' using errcode = '22023'; end if;
  begin
    v_result := import_recipes_run(p_org, p_payload, p_create_missing);
    v_ok := p_apply and jsonb_array_length(v_result->'errors') = 0;
    if not v_ok then raise exception 'import_rollback' using errcode = 'LA199'; end if;
  exception when sqlstate 'LA199' then
    null;
  end;
  return v_result || jsonb_build_object('applied', v_ok);
end $$;
revoke all on function import_recipes(uuid, jsonb, boolean, boolean) from public, anon;
grant execute on function import_recipes(uuid, jsonb, boolean, boolean) to authenticated;
