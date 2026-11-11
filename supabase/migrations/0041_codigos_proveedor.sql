-- Memoria de códigos de proveedor para leer albaranes por foto.
--
--   supplier_item_codes  Lo que un proveedor escribe en su albarán (su referencia, o la descripción si no
--                        trae referencia) y a qué producto y formato nuestro corresponde. Se aprende al
--                        registrar una recepción leída de una foto: la siguiente vez la línea sale sola.
--
-- remember_supplier_codes  Guarda o actualiza esa correspondencia (solo productos y formatos de la misma
--                          organización que el proveedor).
--
-- No guarda precios: los lee quien puede registrar recepciones en la organización.

create table supplier_item_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  code text not null check (char_length(btrim(code)) between 1 and 120),
  description text check (description is null or char_length(description) <= 200),
  product_id uuid not null references products(id) on delete cascade,
  pack_id uuid references product_packs(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (org_id, supplier_id, code)
);
create index supplier_item_codes_supplier on supplier_item_codes (supplier_id);

alter table supplier_item_codes enable row level security;
-- Lectura directa; las escrituras van por remember_supplier_codes.
create policy sic_select on supplier_item_codes for select using (org_id in (select my_org_ids()));

create or replace function remember_supplier_codes(p_supplier uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_item jsonb;
  v_code text;
  v_product uuid;
  v_pack uuid;
  v_saved integer := 0;
begin
  select s.org_id into v_org from suppliers s where s.id = p_supplier;
  if v_org is null or v_org not in (select my_org_ids()) then
    raise exception 'Proveedor no encontrado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'Lista de códigos no válida' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_code := btrim(coalesce(v_item->>'code', ''));
    v_product := nullif(v_item->>'product_id', '')::uuid;
    v_pack := nullif(v_item->>'pack_id', '')::uuid;
    continue when v_code = '' or char_length(v_code) > 120 or v_product is null;
    -- El producto y el formato tienen que ser de la organización del proveedor.
    continue when not exists (select 1 from products p where p.id = v_product and p.org_id = v_org);
    if v_pack is not null and not exists (select 1 from product_packs k where k.id = v_pack and k.product_id = v_product) then
      v_pack := null;
    end if;
    insert into supplier_item_codes (org_id, supplier_id, code, description, product_id, pack_id)
    values (v_org, p_supplier, v_code, left(nullif(btrim(v_item->>'description'), ''), 200), v_product, v_pack)
    on conflict (org_id, supplier_id, code) do update
      set description = excluded.description, product_id = excluded.product_id, pack_id = excluded.pack_id, updated_at = now();
    v_saved := v_saved + 1;
  end loop;
  return v_saved;
end;
$$;
revoke all on function remember_supplier_codes(uuid, jsonb) from public, anon;
grant execute on function remember_supplier_codes(uuid, jsonb) to authenticated;
