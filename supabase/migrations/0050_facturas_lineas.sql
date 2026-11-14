-- Líneas de las facturas de proveedor (fase 3 de la lectura de documentos).
--
--   invoice_lines  Cada renglón de la factura tal como lo dice el proveedor: referencia, descripción, cantidad,
--                  unidad, precio, descuento, IVA e importe. Pertenece a su factura y se borra con ella.
--
-- Las líneas las guarda save_invoice (p_lines), en la misma transacción que la cabecera. Si p_lines no llega,
-- las líneas que haya no se tocan. La cantidad × precio (menos descuento) tiene que dar el importe.

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  position int not null check (position > 0),
  ref text check (ref is null or char_length(ref) <= 40),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  qty numeric(12, 3) not null check (qty >= -1000000 and qty <= 1000000),
  unit text check (unit is null or char_length(unit) <= 10),
  price numeric(12, 4) not null check (price >= -1000000 and price <= 1000000),
  discount_pct numeric(5, 2) check (discount_pct is null or discount_pct between 0 and 100),
  vat_pct numeric(5, 2) check (vat_pct is null or vat_pct between 0 and 100),
  amount numeric(12, 2) not null check (amount >= -10000000 and amount <= 10000000),
  unique (invoice_id, position),
  -- Igual tolerancia que el lector: un céntimo, más un 0,05 % del importe (el precio puede traer más decimales).
  check (abs(amount - qty * price * (1 - coalesce(discount_pct, 0) / 100)) <= 0.05 + abs(amount) * 0.0005)
);
create index invoice_lines_invoice on invoice_lines (invoice_id);

alter table invoice_lines enable row level security;
-- Quien ve la factura ve sus líneas (la política de invoices decide). Las escrituras solo por save_invoice.
create policy invoice_lines_select on invoice_lines for select using (invoice_id in (select id from invoices));

drop function save_invoice(uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, text, uuid[]);

create function save_invoice(
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
  select count(*) into v_bad from goods_receipts g
  where g.id = any(coalesce(p_receipts, '{}'))
    and (g.org_id <> p_org or g.supplier_id is distinct from p_supplier or g.status <> 'closed'
         or exists (select 1 from invoice_receipts ir where ir.receipt_id = g.id and ir.invoice_id is distinct from v_id));
  if v_bad > 0 or cardinality(coalesce(p_receipts, '{}')) <> (select count(*) from goods_receipts where id = any(coalesce(p_receipts, '{}'))) then
    raise exception 'invalid_receipts' using errcode = '22023', hint = 'Los albaranes tienen que ser de ese proveedor, estar cerrados y no estar en otra factura.';
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
    delete from invoice_receipts where invoice_id = v_id;
  end if;
  insert into invoice_receipts (invoice_id, receipt_id) select v_id, unnest(coalesce(p_receipts, '{}'));
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
revoke all on function save_invoice(uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, text, uuid[], jsonb) from public, anon;
grant execute on function save_invoice(uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, text, uuid[], jsonb) to authenticated;
