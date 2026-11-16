-- Guardados que antes iban en varias peticiones sueltas y podían quedarse a medias. Ahora cada uno es una
-- función: o entra entero o no entra nada. Todas corren con los permisos de quien llama (security invoker):
-- las políticas RLS de cada tabla siguen decidiendo, igual que cuando la pantalla escribía directamente.
--
--   save_recipe               Cabecera e ingredientes de una receta. Antes se borraban los ingredientes y luego
--                             se insertaban: si la inserción fallaba, la receta se quedaba sin ellos.
--   register_receipt          Recepción completa (cabecera, líneas y stock). Lleva una clave del intento
--                             (client_key): repetir la llamada devuelve la misma recepción, no crea otra.
--   create_product_with_pack  Producto y su formato de compra a la vez (alta desde un albarán).
--   save_invoice              p_receipts nulo = no tocar los albaranes de la factura (antes los quitaba todos).

create or replace function save_recipe(p_id uuid, p_org uuid, p_recipe jsonb, p_lines jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_lines' using errcode = '22023';
  end if;
  if v_id is null then
    insert into recipes (org_id, name, kind, category, yield_qty, yield_unit, sale_price, vat_rate, target_food_cost, instructions)
    values (p_org, btrim(p_recipe->>'name'), p_recipe->>'kind', nullif(btrim(p_recipe->>'category'), ''),
            (p_recipe->>'yield_qty')::numeric, p_recipe->>'yield_unit', (p_recipe->>'sale_price')::numeric,
            (p_recipe->>'vat_rate')::numeric, (p_recipe->>'target_food_cost')::numeric, nullif(btrim(p_recipe->>'instructions'), ''))
    returning id into v_id;
  else
    update recipes set name = btrim(p_recipe->>'name'), kind = p_recipe->>'kind', category = nullif(btrim(p_recipe->>'category'), ''),
           yield_qty = (p_recipe->>'yield_qty')::numeric, yield_unit = p_recipe->>'yield_unit', sale_price = (p_recipe->>'sale_price')::numeric,
           vat_rate = (p_recipe->>'vat_rate')::numeric, target_food_cost = (p_recipe->>'target_food_cost')::numeric,
           instructions = nullif(btrim(p_recipe->>'instructions'), '')
    where id = v_id and org_id = p_org;
    -- Sin fila: la receta no existe o RLS no deja cambiarla.
    if not found then raise exception 'forbidden' using errcode = '42501'; end if;
    delete from recipe_lines where recipe_id = v_id;
  end if;
  insert into recipe_lines (recipe_id, product_id, sub_recipe_id, qty, waste_pct, sort_order)
  select v_id, (x->>'product_id')::uuid, (x->>'sub_recipe_id')::uuid, (x->>'qty')::numeric, coalesce((x->>'waste_pct')::numeric, 0), ord::int
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(x, ord);
  return v_id;
end $$;
revoke all on function save_recipe(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function save_recipe(uuid, uuid, jsonb, jsonb) to authenticated;

-- Clave del intento de registro: la genera la pantalla al abrir el formulario y no cambia al reintentar.
alter table goods_receipts add column client_key uuid;
create unique index goods_receipts_client_key on goods_receipts (org_id, client_key) where client_key is not null;

create or replace function register_receipt(
  p_key uuid, p_org uuid, p_location uuid, p_supplier uuid, p_doc_number text, p_doc_date date, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if p_key is null then raise exception 'missing_key' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'empty_receipt' using errcode = '22023';
  end if;
  -- El mismo intento ya entró (la respuesta se perdió, doble clic): se devuelve esa recepción.
  select id into v_id from goods_receipts where org_id = p_org and client_key = p_key;
  if found then return v_id; end if;
  begin
    insert into goods_receipts (org_id, location_id, supplier_id, doc_number, doc_date, client_key)
    values (p_org, p_location, p_supplier, nullif(btrim(coalesce(p_doc_number, '')), ''), coalesce(p_doc_date, current_date), p_key)
    returning id into v_id;
  exception when unique_violation then
    -- Dos llamadas a la vez con la misma clave: gana la primera.
    select id into v_id from goods_receipts where org_id = p_org and client_key = p_key;
    if v_id is null then raise; end if;
    return v_id;
  end;
  insert into receipt_lines (receipt_id, pack_id, packs_qty, pack_price, incident)
  select v_id, (x->>'pack_id')::uuid, (x->>'packs_qty')::numeric, (x->>'pack_price')::numeric, nullif(x->>'incident', '')
  from jsonb_array_elements(p_lines) x;
  perform post_receipt(v_id);
  return v_id;
end $$;
revoke all on function register_receipt(uuid, uuid, uuid, uuid, text, date, jsonb) from public, anon;
grant execute on function register_receipt(uuid, uuid, uuid, uuid, text, date, jsonb) to authenticated;

create or replace function create_product_with_pack(
  p_org uuid, p_name text, p_dimension text, p_pack_name text, p_qty_base numeric, p_vat_rate numeric default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_product products;
  v_pack product_packs;
begin
  if p_qty_base is null or p_qty_base <= 0 then raise exception 'invalid_pack' using errcode = '22023'; end if;
  insert into products (org_id, name, dimension, vat_rate)
  values (p_org, btrim(p_name), p_dimension::unit_dimension, coalesce(p_vat_rate, 21))
  returning * into v_product;
  insert into product_packs (product_id, name, qty_base, is_purchase_default, is_count_default)
  values (v_product.id, btrim(p_pack_name), p_qty_base, true, true)
  returning * into v_pack;
  return jsonb_build_object('id', v_product.id, 'name', v_product.name, 'dimension', v_product.dimension, 'base_unit', v_product.base_unit,
                            'pack_id', v_pack.id, 'pack_name', v_pack.name, 'qty_base', v_pack.qty_base);
end $$;
revoke all on function create_product_with_pack(uuid, text, text, text, numeric, numeric) from public, anon;
grant execute on function create_product_with_pack(uuid, text, text, text, numeric, numeric) to authenticated;

create or replace function save_invoice(
  p_id uuid, p_org uuid, p_supplier uuid, p_number text, p_date date, p_due date,
  p_subtotal numeric, p_vat numeric, p_total numeric, p_notes text, p_receipts uuid[],
  p_lines jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_bad int;
begin
  if not can_manage_invoices(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if abs(coalesce(p_total, 0) - (coalesce(p_subtotal, 0) + coalesce(p_vat, 0))) > 0.05 then
    raise exception 'totals_mismatch' using errcode = '22023';
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_lines' using errcode = '22023', hint = 'Las líneas llegan como una lista.';
  end if;
  -- Una factura nueva sin lista de albaranes no cubre ninguno; en una edición, nulo es «no tocarlos».
  if v_id is null and p_receipts is null then p_receipts := '{}'; end if;
  if p_receipts is not null then
    select count(*) into v_bad from goods_receipts g
    where g.id = any(p_receipts)
      and (g.org_id <> p_org or g.supplier_id is distinct from p_supplier or g.status <> 'closed'
           or exists (select 1 from invoice_receipts ir where ir.receipt_id = g.id and ir.invoice_id is distinct from v_id));
    if v_bad > 0 or cardinality(p_receipts) <> (select count(*) from goods_receipts where id = any(p_receipts)) then
      raise exception 'invalid_receipts' using errcode = '22023', hint = 'Los albaranes tienen que ser de ese proveedor, estar cerrados y no estar en otra factura.';
    end if;
  elsif exists (select 1 from invoice_receipts ir join goods_receipts g on g.id = ir.receipt_id where ir.invoice_id = v_id and g.supplier_id is distinct from p_supplier) then
    -- Cambiar de proveedor sin revisar los albaranes dejaría la factura cubriendo albaranes de otro.
    raise exception 'invalid_receipts' using errcode = '22023', hint = 'Al cambiar de proveedor hay que indicar los albaranes.';
  end if;
  if v_id is null then
    insert into invoices (org_id, supplier_id, number, invoice_date, due_date, subtotal, vat_total, total, notes)
    values (p_org, p_supplier, btrim(p_number), p_date, p_due, p_subtotal, p_vat, p_total, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_id;
  else
    update invoices set supplier_id = p_supplier, number = btrim(p_number), invoice_date = p_date, due_date = p_due,
           subtotal = p_subtotal, vat_total = p_vat, total = p_total, notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = v_id and org_id = p_org;
    if not found then raise exception 'not_found'; end if;
  end if;
  if p_receipts is not null then
    delete from invoice_receipts where invoice_id = v_id;
    insert into invoice_receipts (invoice_id, receipt_id) select v_id, unnest(p_receipts);
  end if;
  if p_lines is not null then
    delete from invoice_lines where invoice_id = v_id;
    insert into invoice_lines (invoice_id, position, ref, description, qty, unit, price, discount_pct, vat_pct, amount)
    select v_id, (x->>'position')::int, nullif(btrim(x->>'ref'), ''), btrim(x->>'description'), (x->>'qty')::numeric,
           nullif(btrim(x->>'unit'), ''), (x->>'price')::numeric, (x->>'discount_pct')::numeric, (x->>'vat_pct')::numeric,
           (x->>'amount')::numeric
    from jsonb_array_elements(p_lines) x;
  end if;
  return v_id;
end $$;
