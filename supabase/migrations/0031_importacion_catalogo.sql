-- Importación del catálogo de un cliente (alta de clientes nuevos y cambios masivos desde Excel).
--
-- import_catalog(p_org, p_payload, p_apply):
--   · Recibe proveedores, productos (con familia, formatos, proveedor y precio) y surtido por local
--     (mínimo, máximo y zona), ya leídos de la plantilla por la app.
--   · Hace la importación de verdad dentro de la transacción y, si p_apply es false o hay algún error,
--     la deshace entera: la vista previa es exactamente lo que se aplicaría.
--   · Une por código (proveedor: código; producto: código o SKU) y, si no hay, por nombre sin acentos ni
--     mayúsculas. Una celda vacía no borra nada: deja lo que había.
--   · Solo administración. Una fila con error no se aplica, y si hay errores no se aplica nada.
-- export_catalog(p_org): el catálogo actual con la misma forma, para editarlo en Excel y volver a subirlo.

create or replace function import_catalog_run(p_org uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  n int;
  v_errors jsonb := '[]';
  v_changes jsonb := '[]';
  v_stats jsonb := jsonb_build_object(
    'suppliers', jsonb_build_object('created', 0, 'updated', 0, 'unchanged', 0),
    'products', jsonb_build_object('created', 0, 'updated', 0, 'unchanged', 0),
    'packs', jsonb_build_object('created', 0, 'updated', 0),
    'prices', jsonb_build_object('created', 0, 'updated', 0),
    'assortment', jsonb_build_object('created', 0, 'updated', 0, 'unchanged', 0),
    'categories', jsonb_build_object('created', 0),
    'zones', jsonb_build_object('created', 0));
  v_id uuid;
  v_before text;
  v_after text;
  v_locs uuid[];
  v_missing text;
  v_family uuid;
  v_category uuid;
  v_dimension unit_dimension;
  v_product uuid;
  v_count_pack uuid;
  v_purchase_pack uuid;
  v_supplier uuid;
  v_location uuid;
  v_area uuid;
  v_unit numeric;
  v_created boolean;
  v_label text;
begin
  -- Contadores y registro de cambios (los nombres en castellano los pone la app).
  -- Registro de lo hecho en esta llamada (se borra al terminar la transacción).
  perform set_config('client_min_messages', 'warning', true);
  create temp table if not exists import_log (sheet text, row_no int, action text, label text, detail text) on commit drop;
  truncate import_log;

  -- 1) Proveedores.
  for r, n in select e, i::int from jsonb_array_elements(coalesce(p_payload->'suppliers', '[]')) with ordinality as t(e, i) loop
    begin
      v_label := coalesce(r->>'name', r->>'code', '?');
      if nullif(btrim(r->>'name'), '') is null and nullif(btrim(r->>'code'), '') is null then
        raise exception 'Falta el nombre del proveedor.' using errcode = 'LA100';
      end if;
      v_locs := null;
      if jsonb_typeof(r->'locations') = 'array' then
        select array_agg(l.id), string_agg(x.name, ', ') filter (where l.id is null)
          into v_locs, v_missing
        from jsonb_array_elements_text(r->'locations') x(name)
        left join locations l on l.org_id = p_org and norm_text(l.name) = norm_text(x.name);
        if v_missing is not null then raise exception 'No existe el local: %.', v_missing using errcode = 'LA100'; end if;
      end if;
      select id into v_id from suppliers
      where org_id = p_org and (
        (nullif(btrim(r->>'code'), '') is not null and lower(code) = lower(btrim(r->>'code')))
        or (nullif(btrim(r->>'code'), '') is null and norm_text(name) = norm_text(r->>'name')))
      limit 1;
      if v_id is null and nullif(btrim(r->>'code'), '') is not null and nullif(btrim(r->>'name'), '') is not null then
        -- Código nuevo pero nombre conocido: es el mismo proveedor al que se le pone código.
        select id into v_id from suppliers where org_id = p_org and norm_text(name) = norm_text(r->>'name') and code is null limit 1;
      end if;
      if v_id is null then
        if nullif(btrim(r->>'name'), '') is null then raise exception 'Proveedor nuevo sin nombre.' using errcode = 'LA100'; end if;
        insert into suppliers (org_id, name, code, tax_id, email, phone, contact_name, order_days, order_cutoff,
                               lead_time_hours, min_order, payment_terms, location_ids)
        values (p_org, btrim(r->>'name'), nullif(btrim(r->>'code'), ''), r->>'tax_id', r->>'email', r->>'phone', r->>'contact_name',
                (select array_agg(d::smallint) from jsonb_array_elements_text(r->'order_days') d),
                (r->>'order_cutoff')::time, (r->>'lead_time_hours')::smallint, (r->>'min_order')::numeric,
                r->>'payment_terms', v_locs);
        insert into import_log values ('suppliers', n, 'created', btrim(r->>'name'), null);
      else
        select row(s.*)::text, s.name into v_before, v_label from suppliers s where id = v_id;
        update suppliers set
          name = coalesce(nullif(btrim(r->>'name'), ''), name),
          code = coalesce(nullif(btrim(r->>'code'), ''), code),
          tax_id = coalesce(r->>'tax_id', tax_id),
          email = coalesce(r->>'email', email),
          phone = coalesce(r->>'phone', phone),
          contact_name = coalesce(r->>'contact_name', contact_name),
          order_days = case when jsonb_typeof(r->'order_days') = 'array'
                            then (select array_agg(d::smallint order by d::int) from jsonb_array_elements_text(r->'order_days') d)
                            else order_days end,
          order_cutoff = coalesce((r->>'order_cutoff')::time, order_cutoff),
          lead_time_hours = coalesce((r->>'lead_time_hours')::smallint, lead_time_hours),
          min_order = coalesce((r->>'min_order')::numeric, min_order),
          payment_terms = coalesce(r->>'payment_terms', payment_terms),
          location_ids = case when jsonb_typeof(r->'locations') = 'array' then v_locs else location_ids end,
          active = true
        where id = v_id;
        select row(s.*)::text into v_after from suppliers s where id = v_id;
        insert into import_log values ('suppliers', n, case when v_before is distinct from v_after then 'updated' else 'unchanged' end, v_label, null);
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sheet', 'suppliers', 'row', n, 'label', v_label, 'message', sqlerrm);
    end;
  end loop;

  -- 2) Productos, familias, formatos y precio de compra.
  for r, n in select e, i::int from jsonb_array_elements(coalesce(p_payload->'products', '[]')) with ordinality as t(e, i) loop
    begin
      v_label := coalesce(r->>'name', r->>'sku', '?');
      v_product := null;
      if nullif(btrim(r->>'sku'), '') is not null then
        select id into v_product from products where org_id = p_org and lower(sku) = lower(btrim(r->>'sku'));
      end if;
      if v_product is null and nullif(btrim(r->>'name'), '') is not null then
        select id into v_product from products where org_id = p_org and norm_text(name) = norm_text(r->>'name')
          and (sku is null or nullif(btrim(r->>'sku'), '') is null);
      end if;

      -- Familia y subfamilia (se crean si no existen).
      v_category := null;
      if nullif(btrim(r->>'family'), '') is not null then
        select id into v_family from categories where org_id = p_org and parent_id is null and norm_text(name) = norm_text(r->>'family');
        if v_family is null then
          insert into categories (org_id, name, sort_order) values (p_org, btrim(r->>'family'), 99) returning id into v_family;
          insert into import_log values ('categories', n, 'created', btrim(r->>'family'), null);
        end if;
        v_category := v_family;
        if nullif(btrim(r->>'subfamily'), '') is not null then
          select id into v_category from categories where org_id = p_org and parent_id = v_family and norm_text(name) = norm_text(r->>'subfamily');
          if v_category is null then
            insert into categories (org_id, parent_id, name, sort_order) values (p_org, v_family, btrim(r->>'subfamily'), 99) returning id into v_category;
            insert into import_log values ('categories', n, 'created', btrim(r->>'family') || ' › ' || btrim(r->>'subfamily'), null);
          end if;
        end if;
      end if;

      v_dimension := (r->>'dimension')::unit_dimension;
      v_created := v_product is null;
      if v_created then
        if nullif(btrim(r->>'name'), '') is null then raise exception 'Producto nuevo sin nombre.' using errcode = 'LA100'; end if;
        if v_dimension is null then raise exception 'Indica la medida (unidades, volumen o peso).' using errcode = 'LA100'; end if;
        if v_category is null then raise exception 'Indica la familia.' using errcode = 'LA100'; end if;
        insert into products (org_id, category_id, name, dimension, sku, vat_rate)
        values (p_org, v_category, btrim(r->>'name'), v_dimension, nullif(btrim(r->>'sku'), ''), coalesce((r->>'vat_rate')::numeric, 21))
        returning id into v_product;
        v_before := null;
      else
        select row(p.*)::text || coalesce((select string_agg(row(k.*)::text, '|' order by k.id) from product_packs k where k.product_id = p.id), '')
               || coalesce((select string_agg(row(sp.*)::text, '|' order by sp.supplier_id, sp.pack_id) from supplier_prices sp join product_packs k on k.id = sp.pack_id where k.product_id = p.id), '')
          into v_before from products p where p.id = v_product;
        if v_dimension is not null and v_dimension <> (select dimension from products where id = v_product)
           and exists (select 1 from stock_movements where product_id = v_product) then
          raise exception 'La medida no se puede cambiar: el producto ya tiene movimientos.' using errcode = 'LA100';
        end if;
        update products set
          name = coalesce(nullif(btrim(r->>'name'), ''), name),
          sku = coalesce(nullif(btrim(r->>'sku'), ''), sku),
          category_id = coalesce(v_category, category_id),
          dimension = coalesce(v_dimension, dimension),
          vat_rate = coalesce((r->>'vat_rate')::numeric, vat_rate),
          active = true
        where id = v_product;
      end if;
      select dimension, name into v_dimension, v_label from products where id = v_product;

      -- Formato de conteo (en productos por unidades es opcional: se cuentan en ud).
      v_count_pack := null;
      if r->'count_pack' is not null and jsonb_typeof(r->'count_pack') = 'object' then
        select id into v_count_pack from product_packs where product_id = v_product and norm_text(name) = norm_text(r->'count_pack'->>'name');
        if v_count_pack is null then
          insert into product_packs (product_id, name, qty_base) values (v_product, btrim(r->'count_pack'->>'name'), (r->'count_pack'->>'qty')::numeric)
          returning id into v_count_pack;
          insert into import_log values ('packs', n, 'created', v_label || ' · ' || btrim(r->'count_pack'->>'name'), null);
        elsif (r->'count_pack'->>'qty')::numeric is distinct from (select qty_base from product_packs where id = v_count_pack) then
          update product_packs set qty_base = (r->'count_pack'->>'qty')::numeric where id = v_count_pack;
          insert into import_log values ('packs', n, 'updated', v_label || ' · ' || btrim(r->'count_pack'->>'name'), null);
        end if;
        update product_packs set is_count_default = false where product_id = v_product and is_count_default and id <> v_count_pack;
        update product_packs set is_count_default = true, is_serving = false, active = true where id = v_count_pack and not (is_count_default and active and not is_serving);
      end if;
      if r->>'full_weight_g' is not null or r->>'empty_weight_g' is not null then
        v_count_pack := coalesce(v_count_pack, (select id from product_packs where product_id = v_product and is_count_default));
        if v_count_pack is null then raise exception 'Los pesos van con el formato de conteo: indícalo.' using errcode = 'LA100'; end if;
        update product_packs set full_weight_g = coalesce((r->>'full_weight_g')::numeric, full_weight_g),
                                 empty_weight_g = coalesce((r->>'empty_weight_g')::numeric, empty_weight_g)
        where id = v_count_pack;
      end if;

      -- Formato de compra.
      v_purchase_pack := null;
      if r->'purchase_pack' is not null and jsonb_typeof(r->'purchase_pack') = 'object' then
        select id into v_purchase_pack from product_packs where product_id = v_product and norm_text(name) = norm_text(r->'purchase_pack'->>'name');
        if v_purchase_pack is null then
          insert into product_packs (product_id, name, qty_base) values (v_product, btrim(r->'purchase_pack'->>'name'), (r->'purchase_pack'->>'qty')::numeric)
          returning id into v_purchase_pack;
          insert into import_log values ('packs', n, 'created', v_label || ' · ' || btrim(r->'purchase_pack'->>'name'), null);
        elsif (r->'purchase_pack'->>'qty')::numeric is distinct from (select qty_base from product_packs where id = v_purchase_pack) then
          update product_packs set qty_base = (r->'purchase_pack'->>'qty')::numeric where id = v_purchase_pack;
          insert into import_log values ('packs', n, 'updated', v_label || ' · ' || btrim(r->'purchase_pack'->>'name'), null);
        end if;
        update product_packs set is_purchase_default = false where product_id = v_product and is_purchase_default and id <> v_purchase_pack;
        update product_packs set is_purchase_default = true, is_serving = false, active = true where id = v_purchase_pack and not (is_purchase_default and active and not is_serving);
      end if;
      if v_created and not exists (select 1 from product_packs where product_id = v_product and is_purchase_default) then
        -- Sin formato de compra se compra como se cuenta (o por unidad).
        if v_count_pack is not null then
          update product_packs set is_purchase_default = true where id = v_count_pack;
        elsif v_dimension = 'count' then
          insert into product_packs (product_id, name, qty_base, is_purchase_default) values (v_product, 'Unidad', 1, true);
        else
          raise exception 'Indica el formato de compra o el de conteo.' using errcode = 'LA100';
        end if;
      end if;

      -- Proveedor y precio de compra (del formato de compra).
      if nullif(btrim(r->>'supplier'), '') is not null then
        select id into v_supplier from suppliers
        where org_id = p_org and (lower(code) = lower(btrim(r->>'supplier')) or norm_text(name) = norm_text(r->>'supplier'))
        order by (lower(code) = lower(btrim(r->>'supplier'))) desc nulls last limit 1;
        if v_supplier is null then raise exception 'No existe el proveedor «%».', btrim(r->>'supplier') using errcode = 'LA100'; end if;
        v_purchase_pack := coalesce(v_purchase_pack, (select id from product_packs where product_id = v_product and is_purchase_default));
        insert into supplier_prices (supplier_id, pack_id, supplier_ref, last_price, last_price_at)
        values (v_supplier, v_purchase_pack, r->>'supplier_ref', (r->>'price')::numeric, case when r->>'price' is not null then now() end)
        on conflict (supplier_id, pack_id) do update set
          supplier_ref = coalesce(excluded.supplier_ref, supplier_prices.supplier_ref),
          last_price = coalesce(excluded.last_price, supplier_prices.last_price),
          last_price_at = case when excluded.last_price is distinct from supplier_prices.last_price and excluded.last_price is not null
                               then now() else supplier_prices.last_price_at end;
      elsif r->>'price' is not null then
        -- Precio sin proveedor: se actualiza el del proveedor que ya tiene el formato de compra.
        update supplier_prices sp set last_price = (r->>'price')::numeric,
               last_price_at = case when sp.last_price is distinct from (r->>'price')::numeric then now() else sp.last_price_at end
        where sp.ctid = (select x.ctid from supplier_prices x join product_packs k on k.id = x.pack_id
                         where k.product_id = v_product and k.is_purchase_default order by x.last_price_at desc nulls last limit 1);
        if not found then raise exception 'El precio necesita el proveedor.' using errcode = 'LA100'; end if;
      end if;

      if v_created then
        insert into import_log values ('products', n, 'created', v_label, null);
      else
        select row(p.*)::text || coalesce((select string_agg(row(k.*)::text, '|' order by k.id) from product_packs k where k.product_id = p.id), '')
               || coalesce((select string_agg(row(sp.*)::text, '|' order by sp.supplier_id, sp.pack_id) from supplier_prices sp join product_packs k on k.id = sp.pack_id where k.product_id = p.id), '')
          into v_after from products p where p.id = v_product;
        insert into import_log values ('products', n, case when v_before is distinct from v_after then 'updated' else 'unchanged' end, v_label, null);
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sheet', 'products', 'row', n, 'label', v_label, 'message', sqlerrm);
    end;
  end loop;

  -- 3) Surtido por local: mínimo y máximo (en unidades de conteo) y zona habitual.
  for r, n in select e, i::int from jsonb_array_elements(coalesce(p_payload->'assortment', '[]')) with ordinality as t(e, i) loop
    begin
      v_label := coalesce(r->>'product', '?') || ' · ' || coalesce(r->>'location', '?');
      select id into v_location from locations where org_id = p_org and norm_text(name) = norm_text(r->>'location');
      if v_location is null then raise exception 'No existe el local «%».', r->>'location' using errcode = 'LA100'; end if;
      select id into v_product from products
      where org_id = p_org and (lower(sku) = lower(btrim(r->>'product')) or norm_text(name) = norm_text(r->>'product'))
      order by (lower(sku) = lower(btrim(r->>'product'))) desc nulls last limit 1;
      if v_product is null then raise exception 'No existe el producto «%».', r->>'product' using errcode = 'LA100'; end if;
      if (r->>'min')::numeric > (r->>'max')::numeric then raise exception 'El mínimo es mayor que el máximo.' using errcode = 'LA100'; end if;
      select coalesce((select k.qty_base from product_packs k where k.product_id = p.id and k.is_count_default and k.active),
                      case p.dimension when 'count' then 1 else 1000 end)
        into v_unit from products p where p.id = v_product;
      v_area := null;
      if nullif(btrim(r->>'zone'), '') is not null then
        select id into v_area from storage_areas where location_id = v_location and norm_text(name) = norm_text(r->>'zone');
        if v_area is null then
          insert into storage_areas (location_id, name, sort_order, kind) values (v_location, btrim(r->>'zone'), 50, 'almacen') returning id into v_area;
          insert into import_log values ('zones', n, 'created', btrim(r->>'location') || ' · ' || btrim(r->>'zone'), null);
        end if;
      end if;
      select row(lp.*)::text into v_before from location_products lp where location_id = v_location and product_id = v_product;
      insert into location_products (location_id, product_id, min_qty, par_qty, default_area_id, active)
      values (v_location, v_product, (r->>'min')::numeric * v_unit, (r->>'max')::numeric * v_unit, v_area, true)
      on conflict (location_id, product_id) do update set
        min_qty = coalesce(excluded.min_qty, location_products.min_qty),
        par_qty = coalesce(excluded.par_qty, location_products.par_qty),
        default_area_id = coalesce(excluded.default_area_id, location_products.default_area_id),
        active = true;
      select row(lp.*)::text into v_after from location_products lp where location_id = v_location and product_id = v_product;
      if exists (select 1 from location_products where location_id = v_location and product_id = v_product and par_qty < min_qty) then
        raise exception 'El máximo queda por debajo del mínimo.' using errcode = 'LA100';
      end if;
      insert into import_log values ('assortment', n, case when v_before is null then 'created' when v_before is distinct from v_after then 'updated' else 'unchanged' end, v_label, null);
    exception when others then
      v_errors := v_errors || jsonb_build_object('sheet', 'assortment', 'row', n, 'label', v_label, 'message', sqlerrm);
    end;
  end loop;

  -- Resumen.
  select jsonb_object_agg(sheet, counts) into v_stats from (
    select s.sheet, jsonb_object_agg(a.action, coalesce(c.n, 0)) as counts
    from (values ('suppliers'), ('products'), ('assortment'), ('packs'), ('categories'), ('zones')) s(sheet)
    cross join (values ('created'), ('updated'), ('unchanged')) a(action)
    left join (select sheet, action, count(*) n from import_log group by 1, 2) c on c.sheet = s.sheet and c.action = a.action
    group by s.sheet
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('sheet', sheet, 'row', row_no, 'action', action, 'label', label) order by ord, row_no, sub), '[]')
    into v_changes
  from (
    select l.*,
           case sheet when 'suppliers' then 1 when 'products' then 2 when 'categories' then 2 when 'packs' then 2 else 3 end as ord,
           case sheet when 'categories' then 0 when 'products' then 1 when 'packs' then 2 when 'assortment' then 1 when 'zones' then 0 else 0 end as sub
    from import_log l where action <> 'unchanged'
    order by ord, row_no, sub limit 500
  ) l;
  return jsonb_build_object('stats', v_stats, 'changes', v_changes, 'errors', v_errors);
end $$;

revoke all on function import_catalog_run(uuid, jsonb) from public, anon, authenticated;

create or replace function import_catalog(p_org uuid, p_payload jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_ok boolean;
begin
  if not is_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if coalesce(jsonb_array_length(p_payload->'suppliers'), 0) + coalesce(jsonb_array_length(p_payload->'products'), 0)
     + coalesce(jsonb_array_length(p_payload->'assortment'), 0) > 20000 then
    raise exception 'too_many_rows' using errcode = '22023', hint = 'Como mucho 20.000 filas por importación.';
  end if;
  begin
    v_result := import_catalog_run(p_org, p_payload);
    v_ok := p_apply and jsonb_array_length(v_result->'errors') = 0;
    if not v_ok then
      -- Vista previa (o hay errores): se deshace todo lo hecho dentro de este bloque.
      raise exception 'import_rollback' using errcode = 'LA199';
    end if;
  exception when sqlstate 'LA199' then
    null;
  end;
  return v_result || jsonb_build_object('applied', v_ok);
end $$;

revoke all on function import_catalog(uuid, jsonb, boolean) from public, anon;
grant execute on function import_catalog(uuid, jsonb, boolean) to authenticated;

-- El catálogo actual con la forma de la plantilla (contenidos en la unidad base: ud, ml o g).
create or replace function export_catalog(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_admin(p_org) then null else jsonb_build_object(
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', s.code, 'name', s.name, 'tax_id', s.tax_id, 'email', s.email, 'phone', s.phone, 'contact_name', s.contact_name,
        'order_days', to_jsonb(s.order_days), 'order_cutoff', to_char(s.order_cutoff, 'HH24:MI'), 'lead_time_hours', s.lead_time_hours,
        'min_order', s.min_order, 'payment_terms', s.payment_terms,
        'locations', (select jsonb_agg(l.name order by l.name) from locations l where l.id = any(s.location_ids))) order by s.name)
      from suppliers s where s.org_id = p_org and s.active), '[]'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', p.sku, 'name', p.name, 'family', coalesce(fam.name, c.name), 'subfamily', case when fam.id is not null then c.name end,
        'dimension', p.dimension, 'vat_rate', p.vat_rate,
        'count_pack', case when cp.id is not null then jsonb_build_object('name', cp.name, 'qty', cp.qty_base) end,
        'purchase_pack', case when pp.id is not null then jsonb_build_object('name', pp.name, 'qty', pp.qty_base) end,
        'supplier', coalesce(sup.code, sup.name), 'price', sp.last_price, 'supplier_ref', sp.supplier_ref,
        'full_weight_g', cp.full_weight_g, 'empty_weight_g', cp.empty_weight_g) order by coalesce(fam.name, c.name), c.name, p.name)
      from products p
      left join categories c on c.id = p.category_id
      left join categories fam on fam.id = c.parent_id
      left join product_packs cp on cp.product_id = p.id and cp.is_count_default
      left join product_packs pp on pp.product_id = p.id and pp.is_purchase_default
      left join lateral (select * from supplier_prices x where x.pack_id = pp.id order by x.last_price_at desc nulls last limit 1) sp on true
      left join suppliers sup on sup.id = sp.supplier_id
      where p.org_id = p_org and p.active), '[]'),
    'assortment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'location', l.name, 'product', coalesce(p.sku, p.name),
        'min', round(lp.min_qty / u.unit, 2), 'max', round(lp.par_qty / u.unit, 2), 'zone', a.name) order by l.name, p.name)
      from location_products lp
      join locations l on l.id = lp.location_id
      join products p on p.id = lp.product_id
      left join storage_areas a on a.id = lp.default_area_id
      cross join lateral (select coalesce((select k.qty_base from product_packs k where k.product_id = p.id and k.is_count_default and k.active),
                                          case p.dimension when 'count' then 1 else 1000 end) as unit) u
      where l.org_id = p_org and lp.active and p.active), '[]')
  ) end
$$;

revoke all on function export_catalog(uuid) from public, anon;
grant execute on function export_catalog(uuid) to authenticated;
