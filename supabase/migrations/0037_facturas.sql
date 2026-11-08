-- Facturas de proveedor y cuadre con los albaranes (bloque 2.1 del plan).
--
--   invoices          La factura del proveedor: número, fecha, vencimiento, base, IVA y total, estado de
--                     pago y el PDF o foto (almacén privado «facturas»). Código FAC-AAAA-0001.
--   invoice_receipts  Qué albaranes (recepciones) cubre. Un albarán solo puede estar en una factura.
--   v_invoices        Cada factura con lo que suman sus albaranes y la diferencia (lo que el proveedor
--                     cobra de más o de menos frente a lo recibido), y si está vencida.
--   v_unbilled_receipts  Albaranes cerrados que aún no están en ninguna factura.
--
-- Solo la ven y la cambian propiedad, administración y encargados con el permiso «ve costes».
-- save_invoice valida y guarda de una vez la cabecera y sus albaranes.

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null,
  code text,
  number text not null check (char_length(btrim(number)) between 1 and 60),
  invoice_date date not null,
  due_date date,
  subtotal numeric(12, 2) not null check (subtotal >= -1000000 and subtotal <= 10000000),
  vat_total numeric(12, 2) not null default 0 check (vat_total >= -1000000 and vat_total <= 10000000),
  total numeric(12, 2) not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'pagada')),
  paid_at date,
  attachment_path text,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (org_id, supplier_id) references suppliers(org_id, id),
  check (abs(total - (subtotal + vat_total)) <= 0.05),
  check (due_date is null or due_date >= invoice_date),
  check ((status = 'pagada') = (paid_at is not null))
);
create unique index invoices_supplier_number on invoices (org_id, supplier_id, lower(btrim(number)));
create unique index invoices_org_code on invoices (org_id, code);
create index invoices_org_due on invoices (org_id, status, due_date);

create table invoice_receipts (
  invoice_id uuid not null references invoices(id) on delete cascade,
  receipt_id uuid not null references goods_receipts(id) on delete restrict,
  primary key (invoice_id, receipt_id),
  unique (receipt_id)
);

create trigger invoices_code before insert on invoices for each row execute function set_document_code('FAC');

-- Quién puede: dirección (propiedad, administración, encargados) con «ve costes».
create or replace function can_manage_invoices(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org in (select my_manager_org_ids()) and sees_costs(p_org)
$$;
revoke all on function can_manage_invoices(uuid) from public, anon;
grant execute on function can_manage_invoices(uuid) to authenticated;

alter table invoices enable row level security;
alter table invoice_receipts enable row level security;
create policy invoices_select on invoices for select using (can_manage_invoices(org_id));
create policy invoices_update on invoices for update using (can_manage_invoices(org_id)) with check (can_manage_invoices(org_id));
create policy invoices_delete on invoices for delete using (can_manage_invoices(org_id) and status = 'pendiente');
create policy invoice_receipts_select on invoice_receipts for select using (invoice_id in (select id from invoices));
-- Altas y enlaces solo por save_invoice (valida proveedor, organización y que el albarán esté libre).

create view v_invoices with (security_invoker = true) as
select i.*,
       s.name as supplier_name,
       coalesce(r.receipts, 0) as receipts,
       coalesce(r.receipts_total, 0) as receipts_total,
       i.subtotal - coalesce(r.receipts_total, 0) as difference,
       i.status = 'pendiente' and i.due_date < current_date as overdue
from invoices i
join suppliers s on s.id = i.supplier_id
left join lateral (
  select count(distinct ir.receipt_id) as receipts, round(sum(rl.packs_qty * rl.pack_price), 2) as receipts_total
  from invoice_receipts ir join receipt_lines rl on rl.receipt_id = ir.receipt_id
  where ir.invoice_id = i.id
) r on true;

create view v_unbilled_receipts with (security_invoker = true) as
select g.id, g.org_id, g.code, g.doc_number, g.doc_date, g.supplier_id, s.name as supplier_name, g.location_id, l.name as location_name,
       round(sum(rl.packs_qty * rl.pack_price), 2) as total
from goods_receipts g
join suppliers s on s.id = g.supplier_id
join locations l on l.id = g.location_id
join receipt_lines rl on rl.receipt_id = g.id
where g.status = 'closed' and can_manage_invoices(g.org_id)
  and not exists (select 1 from invoice_receipts ir where ir.receipt_id = g.id)
group by g.id, s.name, l.name;

grant select on v_invoices, v_unbilled_receipts to authenticated;

-- Guarda una factura (nueva o existente) con sus albaranes.
create or replace function save_invoice(
  p_id uuid, p_org uuid, p_supplier uuid, p_number text, p_date date, p_due date,
  p_subtotal numeric, p_vat numeric, p_total numeric, p_notes text, p_receipts uuid[]
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
  return v_id;
end $$;
revoke all on function save_invoice(uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, text, uuid[]) from public, anon;
grant execute on function save_invoice(uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, text, uuid[]) to authenticated;

-- Archivo de la factura: almacén privado «facturas», ruta organización/factura/fichero.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy invoices_files_read on storage.objects for select using (
  bucket_id = 'facturas' and array_length(storage.foldername(name), 1) >= 2 and can_manage_invoices((storage.foldername(name))[1]::uuid)
);
create policy invoices_files_upload on storage.objects for insert with check (
  bucket_id = 'facturas' and array_length(storage.foldername(name), 1) >= 2 and can_manage_invoices((storage.foldername(name))[1]::uuid)
);
create policy invoices_files_delete on storage.objects for delete using (
  bucket_id = 'facturas' and array_length(storage.foldername(name), 1) >= 2 and can_manage_invoices((storage.foldername(name))[1]::uuid)
);
