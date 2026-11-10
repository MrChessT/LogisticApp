-- Ventas del TPV (exportación diaria del BDP, formato «Ventas» de tSpoonLab) y coste teórico.
--
--   sales_items   Cada artículo del TPV por su código: a qué receta o producto corresponde y cuánto se
--                 gasta por venta (raciones de la receta, o unidades base del producto: una copa de vino
--                 son 150 ml de la botella). Se enlaza una vez y vale para todos los días.
--   sales_days    Un día de ventas de un local (reimportar el mismo día lo sustituye).
--   sales_lines   Lo vendido ese día: artículo, cantidad e importe sin IVA.
--
-- import_sales     Vista previa (sin guardar) o guardado de un día, enlazando solo lo que coincide por nombre.
-- link_sales_item  Enlaza o ignora un artículo.
-- sales_report     Por artículo y periodo: vendido, importe, coste teórico y food cost.
--
-- Por ahora no descuenta stock: es la referencia para comparar con el consumo real de los inventarios.
-- Solo la ven y la cambian propiedad, administración y encargados con el permiso «ve costes».

create table sales_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null default 'tpv' check (source ~ '^[a-z0-9_]{2,20}$'),
  code text not null check (char_length(btrim(code)) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  recipe_id uuid references recipes(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  qty_per_sale numeric(14, 4) not null default 1 check (qty_per_sale > 0 and qty_per_sale <= 1000000),
  ignored boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (org_id, source, code),
  check (recipe_id is null or product_id is null),
  check (not ignored or (recipe_id is null and product_id is null))
);

create table sales_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null,
  sale_date date not null,
  source text not null default 'tpv',
  file_name text check (file_name is null or char_length(file_name) <= 200),
  total_amount numeric(14, 2) not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (org_id, location_id) references locations(org_id, id),
  unique (org_id, location_id, sale_date, source)
);
create index sales_days_org_date on sales_days (org_id, sale_date);

create table sales_lines (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references sales_days(id) on delete cascade,
  item_id uuid not null references sales_items(id) on delete restrict,
  qty numeric(14, 4) not null check (qty >= -100000 and qty <= 100000),
  unit_label text check (unit_label is null or char_length(unit_label) <= 60),
  amount numeric(14, 4) not null check (amount >= -1000000 and amount <= 1000000)
);
create index sales_lines_day on sales_lines (day_id);
create index sales_lines_item on sales_lines (item_id);

create or replace function can_manage_sales(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org in (select my_manager_org_ids()) and sees_costs(p_org)
$$;
revoke all on function can_manage_sales(uuid) from public, anon;
grant execute on function can_manage_sales(uuid) to authenticated;

alter table sales_items enable row level security;
alter table sales_days enable row level security;
alter table sales_lines enable row level security;
-- Lectura directa; las escrituras van por las funciones de abajo.
create policy sales_items_select on sales_items for select using (can_manage_sales(org_id));
create policy sales_days_select on sales_days for select using (can_manage_sales(org_id));
create policy sales_days_delete on sales_days for delete using (can_manage_sales(org_id));
create policy sales_lines_select on sales_lines for select using (
  exists (select 1 from sales_days d where d.id = day_id and can_manage_sales(d.org_id)));

-- Enlace automático de un artículo nuevo: plato (o receta) con el mismo nombre; si no, producto con el
-- mismo nombre, por su unidad de recuento (una botella, una lata).
create or replace function sales_item_autolink(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  i sales_items;
  v_recipe uuid;
  v_product uuid;
  v_qty numeric;
begin
  select * into i from sales_items where id = p_item;
  if i.recipe_id is not null or i.product_id is not null or i.ignored then return; end if;
  select id into v_recipe from recipes
  where org_id = i.org_id and active and norm_text(name) = norm_text(i.name)
  order by (kind = 'plato') desc limit 1;
  if v_recipe is not null then
    update sales_items set recipe_id = v_recipe, qty_per_sale = 1, updated_at = now() where id = p_item;
    return;
  end if;
  select p.id, coalesce((select k.qty_base from product_packs k where k.product_id = p.id and k.is_count_default limit 1), 1)
    into v_product, v_qty
  from products p where p.org_id = i.org_id and p.active and norm_text(p.name) = norm_text(i.name) limit 1;
  if v_product is not null then
    update sales_items set product_id = v_product, qty_per_sale = v_qty, updated_at = now() where id = p_item;
  end if;
end $$;
revoke all on function sales_item_autolink(uuid) from public, anon, authenticated;

-- Coste de una venta del artículo (null si no está enlazado o le faltan precios).
create or replace function sales_item_unit_cost(p_item uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  i sales_items;
  t record;
  r recipes;
begin
  select * into i from sales_items where id = p_item;
  if i.recipe_id is not null then
    select * into r from recipes where id = i.recipe_id;
    select * into t from recipe_total_cost(i.recipe_id);
    if t.missing > 0 or r.yield_qty is null or r.yield_qty <= 0 then return null; end if;
    return round(t.total / r.yield_qty * i.qty_per_sale, 4);
  elsif i.product_id is not null then
    return round(product_unit_cost(i.product_id) * i.qty_per_sale, 4);
  end if;
  return null;
end $$;
revoke all on function sales_item_unit_cost(uuid) from public, anon, authenticated;

-- p_lines: [{ code, name, qty, unit, amount }]. Con p_apply = false no guarda nada (vista previa).
create or replace function import_sales(
  p_org uuid, p_location uuid, p_date date, p_lines jsonb,
  p_source text default 'tpv', p_file text default null, p_apply boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  v_item uuid;
  v_day uuid;
  v_existing boolean;
  v_total numeric := 0;
  v_result jsonb;
begin
  if not can_manage_sales(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from locations where id = p_location and org_id = p_org) then raise exception 'invalid_location' using errcode = '22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) > 5000 then raise exception 'too_many_rows' using errcode = '22023'; end if;
  if p_date > current_date + 1 or p_date < date '2000-01-01' then raise exception 'invalid_date' using errcode = '22023'; end if;

  begin
    v_existing := exists (select 1 from sales_days where org_id = p_org and location_id = p_location and sale_date = p_date and source = p_source);
    delete from sales_days where org_id = p_org and location_id = p_location and sale_date = p_date and source = p_source;
    insert into sales_days (org_id, location_id, sale_date, source, file_name)
    values (p_org, p_location, p_date, p_source, left(p_file, 200)) returning id into v_day;

    for l in select * from jsonb_array_elements(p_lines) loop
      insert into sales_items (org_id, source, code, name)
      values (p_org, p_source, btrim(l->>'code'), btrim(l->>'name'))
      on conflict (org_id, source, code) do update set name = excluded.name
      returning id into v_item;
      perform sales_item_autolink(v_item);
      insert into sales_lines (day_id, item_id, qty, unit_label, amount)
      values (v_day, v_item, (l->>'qty')::numeric, nullif(btrim(l->>'unit'), ''), (l->>'amount')::numeric);
      v_total := v_total + (l->>'amount')::numeric;
    end loop;
    update sales_days set total_amount = round(v_total, 2) where id = v_day;

    select jsonb_build_object(
      'replaced', v_existing,
      'lines', count(*),
      'total', round(v_total, 2),
      'linked_recipes', count(*) filter (where i.recipe_id is not null),
      'linked_products', count(*) filter (where i.product_id is not null),
      'ignored', count(*) filter (where i.ignored),
      'theoretical_cost', round(sum(s.qty * c.cost) filter (where c.cost is not null), 2),
      'costed_amount', round(sum(s.amount) filter (where c.cost is not null), 2),
      'unlinked', coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name, 'qty', s.qty, 'amount', s.amount) order by s.amount desc)
                  filter (where i.recipe_id is null and i.product_id is null and not i.ignored), '[]'),
      'no_cost', coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name)) filter (where (i.recipe_id is not null or i.product_id is not null) and c.cost is null), '[]')
    ) into v_result
    from sales_lines s join sales_items i on i.id = s.item_id
    cross join lateral (select sales_item_unit_cost(i.id) cost) c
    where s.day_id = v_day;

    if not p_apply then raise exception 'preview_rollback' using errcode = 'LA299'; end if;
  exception when sqlstate 'LA299' then
    null;
  end;
  return v_result || jsonb_build_object('applied', p_apply);
end $$;
revoke all on function import_sales(uuid, uuid, date, jsonb, text, text, boolean) from public, anon;
grant execute on function import_sales(uuid, uuid, date, jsonb, text, text, boolean) to authenticated;

create or replace function link_sales_item(p_item uuid, p_recipe uuid, p_product uuid, p_qty numeric, p_ignored boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := (select org_id from sales_items where id = p_item);
begin
  if v_org is null or not can_manage_sales(v_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_recipe is not null and not exists (select 1 from recipes where id = p_recipe and org_id = v_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_product is not null and not exists (select 1 from products where id = p_product and org_id = v_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_ignored and (p_recipe is not null or p_product is not null) then raise exception 'invalid_link' using errcode = '22023'; end if;
  update sales_items
  set recipe_id = p_recipe, product_id = p_product, ignored = coalesce(p_ignored, false),
      qty_per_sale = case when p_recipe is null and p_product is null then 1 else coalesce(p_qty, 1) end,
      updated_at = now()
  where id = p_item;
end $$;
revoke all on function link_sales_item(uuid, uuid, uuid, numeric, boolean) from public, anon;
grant execute on function link_sales_item(uuid, uuid, uuid, numeric, boolean) to authenticated;

-- Por artículo en un periodo (y un local, o todos).
create or replace function sales_report(p_org uuid, p_from date, p_to date, p_location uuid default null)
returns table (
  item_id uuid, code text, name text, link text, link_name text, qty_per_sale numeric, ignored boolean,
  qty numeric, amount numeric, unit_cost numeric, cost numeric, food_cost_pct numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage_sales(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with s as (
    select l.item_id, sum(l.qty) qty, sum(l.amount) amount
    from sales_lines l join sales_days d on d.id = l.day_id
    where d.org_id = p_org and d.sale_date between p_from and p_to and (p_location is null or d.location_id = p_location)
    group by l.item_id
  )
  select i.id, i.code, i.name,
         case when i.recipe_id is not null then 'receta' when i.product_id is not null then 'producto' when i.ignored then 'ignorado' else 'sin_enlazar' end,
         coalesce(r.name, p.name), i.qty_per_sale, i.ignored,
         s.qty, round(s.amount, 2), c.cost, round(s.qty * c.cost, 2),
         case when c.cost is not null and s.amount > 0 then round(s.qty * c.cost / s.amount * 100, 1) end
  from s join sales_items i on i.id = s.item_id
  left join recipes r on r.id = i.recipe_id
  left join products p on p.id = i.product_id
  cross join lateral (select sales_item_unit_cost(i.id) cost) c
  order by s.amount desc;
end $$;
revoke all on function sales_report(uuid, date, date, uuid) from public, anon;
grant execute on function sales_report(uuid, date, date, uuid) to authenticated;
