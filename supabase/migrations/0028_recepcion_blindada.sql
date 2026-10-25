-- Recepción blindada (especificación A, hoja Recepciones): cada línea guarda el precio pactado con el que se
-- compara lo que cobra el albarán, y la incidencia si la hay. La foto del albarán ya tenía su sitio
-- (goods_receipts.attachment_path y el almacén «albaranes» de 0002).
--   precio pactado = el de la línea del pedido (si la recepción viene de un pedido y lo tenía) o, si no,
--                    el último precio de ese proveedor y formato antes de esta recepción.
alter table receipt_lines
  add column expected_price numeric(12, 4) check (expected_price is null or expected_price >= 0),
  add column incident text check (incident is null or incident in ('faltante', 'sobrante', 'roto', 'caducado', 'precio_distinto', 'otro')),
  add column incident_note text check (incident_note is null or char_length(incident_note) <= 200);

-- El precio pactado lo pone la base de datos al insertar la línea (antes de que post_receipt actualice el
-- último precio), para que nadie tenga que acordarse de mandarlo.
create function receipt_line_expected_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r goods_receipts;
begin
  if new.expected_price is not null then
    return new;
  end if;
  select * into r from goods_receipts where id = new.receipt_id;
  if r.order_id is not null then
    select pol.pack_price into new.expected_price
    from purchase_order_lines pol
    where pol.order_id = r.order_id and pol.pack_id = new.pack_id;
  end if;
  if new.expected_price is null and r.supplier_id is not null then
    select sp.last_price into new.expected_price
    from supplier_prices sp
    where sp.supplier_id = r.supplier_id and sp.pack_id = new.pack_id;
  end if;
  return new;
end $$;

create trigger receipt_lines_expected_price
before insert on receipt_lines
for each row execute function receipt_line_expected_price();

-- Diferencias de precio por línea: lo cobrado frente a lo pactado, por formato y en total.
create view v_receipt_price_checks with (security_invoker = true) as
select rl.id as line_id,
       rl.receipt_id,
       r.location_id,
       r.supplier_id,
       r.doc_date,
       rl.pack_id,
       rl.packs_qty,
       rl.pack_price,
       rl.expected_price,
       rl.pack_price - rl.expected_price as diff_per_pack,
       round((rl.pack_price - rl.expected_price) * rl.packs_qty, 4) as diff_total,
       rl.incident,
       rl.incident_note
from receipt_lines rl
join goods_receipts r on r.id = rl.receipt_id;

-- receive_order acepta la incidencia de cada línea: [{"pack_id", "packs_qty", "pack_price", "incident"?, "incident_note"?}].
create or replace function receive_order(
  p_order uuid,
  p_lines jsonb,
  p_doc_number text default null,
  p_doc_date date default current_date,
  p_close boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o purchase_orders;
  v_receipt uuid;
  v_complete boolean;
begin
  select * into o from purchase_orders where id = p_order for update;
  if not found then raise exception 'not_found'; end if;
  if not can_access_location(o.location_id) then raise exception 'forbidden'; end if;
  if o.status not in ('sent', 'partial') then raise exception 'invalid_status'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'empty_receipt'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where coalesce((l->>'packs_qty')::numeric, 0) <= 0 or coalesce((l->>'pack_price')::numeric, -1) < 0
  ) then
    raise exception 'invalid_quantity';
  end if;

  insert into goods_receipts (org_id, location_id, supplier_id, doc_number, doc_date, order_id)
  values (o.org_id, o.location_id, o.supplier_id, nullif(trim(p_doc_number), ''), coalesce(p_doc_date, current_date), p_order)
  returning id into v_receipt;

  insert into receipt_lines (receipt_id, pack_id, packs_qty, pack_price, incident, incident_note)
  select v_receipt, (l->>'pack_id')::uuid, (l->>'packs_qty')::numeric, (l->>'pack_price')::numeric,
         nullif(l->>'incident', ''), nullif(trim(coalesce(l->>'incident_note', '')), '')
  from jsonb_array_elements(p_lines) l;

  -- Misma contabilización que cualquier recepción: movimientos, coste medio y precios.
  perform post_receipt(v_receipt);

  update purchase_order_lines pol
  set received_packs = pol.received_packs + r.qty
  from (
    select (l->>'pack_id')::uuid as pack_id, sum((l->>'packs_qty')::numeric) as qty
    from jsonb_array_elements(p_lines) l group by 1
  ) r
  where pol.order_id = p_order and pol.pack_id = r.pack_id;

  select not exists (select 1 from purchase_order_lines where order_id = p_order and received_packs < packs_qty) into v_complete;
  update purchase_orders
  set status = case when v_complete or p_close then 'received'::order_status else 'partial'::order_status end,
      closed_at = case when v_complete or p_close then now() end
  where id = p_order;
  return v_receipt;
end $$;

-- La foto del albarán se adjunta después de crear la recepción (también cerrada): quien puede ver la
-- recepción puede poner o cambiar su foto; nada más de la cabecera.
create function set_receipt_attachment(p_receipt uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r goods_receipts;
begin
  select * into r from goods_receipts where id = p_receipt;
  if not found then raise exception 'not_found'; end if;
  if not can_access_location(r.location_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Ruta del almacén «albaranes»: organización/local/recepción/fichero.
  if p_path is not null and p_path not like r.org_id::text || '/' || r.location_id::text || '/' || r.id::text || '/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  update goods_receipts set attachment_path = p_path where id = p_receipt;
end $$;

revoke execute on function set_receipt_attachment(uuid, text) from public, anon;
grant execute on function set_receipt_attachment(uuid, text) to authenticated;
grant select on v_receipt_price_checks to authenticated;
