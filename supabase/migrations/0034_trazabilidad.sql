-- Trazabilidad (bloque 1.5).
--   1) Historial de cambios del catálogo: quién cambió qué y cuándo, con el valor anterior y el nuevo, en
--      productos, formatos, precios de proveedor, surtido por local (mínimos, máximos, zona) y proveedores.
--      Lo escriben disparadores (también los cambios de la importación y del asistente); nadie lo edita.
--   2) Códigos legibles de documentos por organización y año: PED-2026-0001 (pedidos), REC- (recepciones),
--      TRA- (traspasos) e INV- (inventarios). Se ponen solos al crear el documento.

-- 1) Historial ---------------------------------------------------------------------------------------------

create table catalog_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  entity text not null check (entity in ('product', 'supplier')),
  entity_id uuid not null,
  part text not null,            -- qué parte: ficha, formato «Caja 6», precio «Proveedor · Caja 6», local «Parador»…
  field text not null,           -- campo cambiado, o «alta» / «baja»
  old_value text,
  new_value text,
  is_cost boolean not null default false,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index catalog_changes_entity on catalog_changes (entity_id, changed_at desc);
create index catalog_changes_org_time on catalog_changes (org_id, changed_at desc);

alter table catalog_changes enable row level security;
create policy catalog_changes_select on catalog_changes for select using (
  org_id in (select my_org_ids()) and (not is_cost or sees_costs(org_id))
);
revoke insert, update, delete on catalog_changes from anon, authenticated;

-- Valor legible de un campo (ids de familia o zona → nombre; días → L, M…).
create or replace function catalog_change_text(p_field text, p_value jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then null
    when p_field = 'category_id' then (select name from categories where id = (p_value #>> '{}')::uuid)
    when p_field = 'default_area_id' then (select name from storage_areas where id = (p_value #>> '{}')::uuid)
    when p_field = 'location_ids' then (select string_agg(l.name, ', ' order by l.name) from locations l where l.id::text in (select jsonb_array_elements_text(p_value)))
    when p_field = 'order_days' then (select string_agg((array['L', 'M', 'X', 'J', 'V', 'S', 'D'])[d::int], ', ' order by d::int) from jsonb_array_elements_text(p_value) d)
    when jsonb_typeof(p_value) = 'boolean' then case when p_value::text = 'true' then 'sí' else 'no' end
    when jsonb_typeof(p_value) = 'number' then trim_scale((p_value #>> '{}')::numeric)::text
    else p_value #>> '{}'
  end
$$;
revoke all on function catalog_change_text(text, jsonb) from public, anon, authenticated;

create or replace function log_catalog_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_org uuid;
  v_entity text := 'product';
  v_id uuid;
  v_part text;
  v_cost boolean := false;
  k text;
  fields text[] := tg_argv;
begin
  case tg_table_name
    when 'products' then
      v_org := (r->>'org_id')::uuid; v_id := (r->>'id')::uuid; v_part := 'Ficha';
    when 'product_packs' then
      select org_id into v_org from products where id = (r->>'product_id')::uuid;
      v_id := (r->>'product_id')::uuid; v_part := 'Formato «' || (r->>'name') || '»';
    when 'supplier_prices' then
      select p.org_id, p.id, s.name || ' · ' || k2.name into v_org, v_id, v_part
      from product_packs k2 join products p on p.id = k2.product_id join suppliers s on s.id = (r->>'supplier_id')::uuid
      where k2.id = (r->>'pack_id')::uuid;
      v_cost := true;
    when 'location_products' then
      select l.org_id, 'Local «' || l.name || '»' into v_org, v_part from locations l where l.id = (r->>'location_id')::uuid;
      v_id := (r->>'product_id')::uuid;
    when 'suppliers' then
      v_org := (r->>'org_id')::uuid; v_entity := 'supplier'; v_id := (r->>'id')::uuid; v_part := 'Ficha';
  end case;
  if v_org is null or v_id is null then return null; end if;

  if tg_op = 'INSERT' then
    insert into catalog_changes (org_id, entity, entity_id, part, field, is_cost) values (v_org, v_entity, v_id, v_part, 'alta', v_cost);
  elsif tg_op = 'DELETE' then
    insert into catalog_changes (org_id, entity, entity_id, part, field, is_cost) values (v_org, v_entity, v_id, v_part, 'baja', v_cost);
  else
    foreach k in array fields loop
      if (o -> k) is distinct from (n -> k) then
        insert into catalog_changes (org_id, entity, entity_id, part, field, old_value, new_value, is_cost)
        values (v_org, v_entity, v_id, v_part, k, catalog_change_text(k, o -> k), catalog_change_text(k, n -> k),
                v_cost or k in ('last_price', 'avg_cost'));
      end if;
    end loop;
  end if;
  return null;
end $$;
revoke all on function log_catalog_change() from public, anon, authenticated;

create trigger products_changes after insert or update or delete on products
  for each row execute function log_catalog_change('name', 'sku', 'category_id', 'dimension', 'vat_rate', 'track_stock', 'active', 'notes');
create trigger product_packs_changes after insert or update or delete on product_packs
  for each row execute function log_catalog_change('name', 'qty_base', 'barcode', 'is_count_default', 'is_purchase_default', 'is_serving', 'active', 'full_weight_g', 'empty_weight_g');
create trigger supplier_prices_changes after insert or update or delete on supplier_prices
  for each row execute function log_catalog_change('last_price', 'supplier_ref');
create trigger location_products_changes after insert or update or delete on location_products
  for each row execute function log_catalog_change('min_qty', 'par_qty', 'default_area_id', 'active');
create trigger suppliers_changes after insert or update or delete on suppliers
  for each row execute function log_catalog_change('name', 'code', 'tax_id', 'email', 'phone', 'contact_name', 'order_days', 'order_cutoff',
                                                    'lead_time_hours', 'min_order', 'payment_terms', 'location_ids', 'active');

-- 2) Códigos de documento --------------------------------------------------------------------------------

create table document_counters (
  org_id uuid not null references organizations(id) on delete cascade,
  prefix text not null,
  year int not null,
  last int not null default 0,
  primary key (org_id, prefix, year)
);
alter table document_counters enable row level security;
revoke all on document_counters from anon, authenticated;

alter table purchase_orders add column code text;
alter table goods_receipts add column code text;
alter table transfers add column code text;
alter table inventory_counts add column code text;

create or replace function next_document_code(p_org uuid, p_prefix text, p_at timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_year int := extract(year from coalesce(p_at, now()) at time zone 'Europe/Madrid');
  v_n int;
begin
  insert into document_counters (org_id, prefix, year, last) values (p_org, p_prefix, v_year, 1)
  on conflict (org_id, prefix, year) do update set last = document_counters.last + 1
  returning last into v_n;
  return p_prefix || '-' || v_year || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke all on function next_document_code(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function set_document_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null then
    new.code := next_document_code(new.org_id, tg_argv[0], now());
  end if;
  return new;
end $$;
revoke all on function set_document_code() from public, anon, authenticated;

-- Los documentos que ya existen reciben su código por orden de creación.
do $$
declare
  t record;
  r record;
begin
  for t in select * from (values ('purchase_orders', 'PED', 'created_at'), ('goods_receipts', 'REC', 'created_at'),
                                 ('transfers', 'TRA', 'created_at'), ('inventory_counts', 'INV', 'started_at')) v(tbl, prefix, col) loop
    for r in execute format('select id, org_id, %I as at from %I where code is null order by %I, id', t.col, t.tbl, t.col) loop
      execute format('update %I set code = $1 where id = $2', t.tbl) using next_document_code(r.org_id, t.prefix, r.at), r.id;
    end loop;
  end loop;
end $$;

create trigger purchase_orders_code before insert on purchase_orders for each row execute function set_document_code('PED');
create trigger goods_receipts_code before insert on goods_receipts for each row execute function set_document_code('REC');
create trigger transfers_code before insert on transfers for each row execute function set_document_code('TRA');
create trigger inventory_counts_code before insert on inventory_counts for each row execute function set_document_code('INV');

create unique index purchase_orders_org_code on purchase_orders (org_id, code);
create unique index goods_receipts_org_code on goods_receipts (org_id, code);
create unique index transfers_org_code on transfers (org_id, code);
create unique index inventory_counts_org_code on inventory_counts (org_id, code);
