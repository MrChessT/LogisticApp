-- Escandallos (fase 4 del plan: rendimientos, recetas, escandallos y alérgenos).
--
--   recipes        Platos (rinden N raciones) y elaboraciones (rinden una cantidad en g, ml o ud, o raciones)
--                  con su PVP (con IVA), el IVA y el food cost objetivo.
--   recipe_lines   Cada ingrediente: un producto (cantidad en su unidad base, con merma de limpieza) o una
--                  elaboración (cantidad en la unidad en que rinde). Sin ciclos.
--   product_allergens  Los 14 alérgenos de declaración obligatoria, por producto. Los de la receta salen
--                  solos de sus ingredientes (también de las subrecetas).
--
-- El coste se calcula al vuelo con el último precio de compra (formato de compra; si no, cualquier formato;
-- si no, el coste medio del stock). Al marcar una receta como revisada se guarda su coste: si luego sube un
-- precio, la receta avisa de cuánto ha cambiado. Costes, food cost y márgenes solo para quien ve costes.

create table recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'plato' check (kind in ('plato', 'elaboracion')),
  category text check (category is null or char_length(category) <= 60),
  yield_qty numeric(12, 3) not null default 1 check (yield_qty > 0),
  yield_unit text not null default 'racion' check (yield_unit in ('racion', 'g', 'ml', 'ud')),
  sale_price numeric(10, 2) check (sale_price is null or sale_price >= 0),
  vat_rate numeric(5, 2) not null default 10 check (vat_rate between 0 and 30),
  target_food_cost numeric(5, 2) not null default 30 check (target_food_cost > 0 and target_food_cost < 100),
  instructions text check (instructions is null or char_length(instructions) <= 8000),
  active boolean not null default true,
  reviewed_cost numeric(14, 6),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create table recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  product_id uuid references products(id) on delete restrict,
  sub_recipe_id uuid references recipes(id) on delete restrict,
  qty numeric(14, 4) not null check (qty > 0),
  waste_pct numeric(5, 2) not null default 0 check (waste_pct >= 0 and waste_pct < 95),
  note text check (note is null or char_length(note) <= 200),
  sort_order int not null default 0,
  check ((product_id is null) <> (sub_recipe_id is null)),
  check (sub_recipe_id is null or sub_recipe_id <> recipe_id)
);
create index recipe_lines_recipe on recipe_lines (recipe_id, sort_order);
create index recipe_lines_product on recipe_lines (product_id) where product_id is not null;
create index recipe_lines_sub on recipe_lines (sub_recipe_id) where sub_recipe_id is not null;

create table product_allergens (
  product_id uuid not null references products(id) on delete cascade,
  allergen text not null check (allergen in (
    'gluten', 'crustaceos', 'huevo', 'pescado', 'cacahuete', 'soja', 'lacteos',
    'frutos_cascara', 'apio', 'mostaza', 'sesamo', 'sulfitos', 'altramuces', 'moluscos')),
  primary key (product_id, allergen)
);

-- Permisos: todo el equipo ve recetas y alérgenos (la cocina las usa); las cambian encargados y superiores.
alter table recipes enable row level security;
alter table recipe_lines enable row level security;
alter table product_allergens enable row level security;
create policy recipes_select on recipes for select using (org_id in (select my_org_ids()));
-- Políticas separadas por operación (regla del proyecto: ninguna «for all», que se evaluaría también al leer).
create policy recipes_insert on recipes for insert with check (org_id in (select my_manager_org_ids()));
create policy recipes_update on recipes for update using (org_id in (select my_manager_org_ids())) with check (org_id in (select my_manager_org_ids()));
create policy recipes_delete on recipes for delete using (org_id in (select my_manager_org_ids()));
create policy recipe_lines_select on recipe_lines for select using (recipe_id in (select id from recipes where org_id in (select my_org_ids())));
create policy recipe_lines_insert on recipe_lines for insert with check (recipe_id in (select id from recipes where org_id in (select my_manager_org_ids())));
create policy recipe_lines_update on recipe_lines for update
  using (recipe_id in (select id from recipes where org_id in (select my_manager_org_ids())))
  with check (recipe_id in (select id from recipes where org_id in (select my_manager_org_ids())));
create policy recipe_lines_delete on recipe_lines for delete using (recipe_id in (select id from recipes where org_id in (select my_manager_org_ids())));
create policy product_allergens_select on product_allergens for select using (product_id in (select id from products where org_id in (select my_org_ids())));
create policy product_allergens_insert on product_allergens for insert with check (product_id in (select id from products where org_id in (select my_manager_org_ids())));
create policy product_allergens_delete on product_allergens for delete using (product_id in (select id from products where org_id in (select my_manager_org_ids())));

-- Coherencia: ingredientes y subrecetas de la misma organización, y sin ciclos (A usa B que usa A).
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
  update recipes set updated_at = now() where id = new.recipe_id;
  return new;
end $$;
revoke all on function recipe_lines_guard() from public, anon, authenticated;
create trigger recipe_lines_guard before insert or update on recipe_lines for each row execute function recipe_lines_guard();

-- El coste de revisión solo lo pone mark_recipe_reviewed (que marca la transacción); nadie lo edita a mano.
create or replace function recipes_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if coalesce(current_setting('app.recipe_review', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.reviewed_cost := null;
      new.reviewed_at := null;
    else
      new.reviewed_cost := old.reviewed_cost;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
revoke all on function recipes_touch() from public, anon, authenticated;
create trigger recipes_touch before insert or update on recipes for each row execute function recipes_touch();

-- Coste de un producto por unidad base (g, ml o ud): último precio de compra o coste medio del stock.
create or replace function product_unit_cost(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sp.last_price / k.qty_base from supplier_prices sp join product_packs k on k.id = sp.pack_id
     where k.product_id = p_product and sp.last_price is not null and k.is_purchase_default
     order by sp.last_price_at desc nulls last limit 1),
    (select sp.last_price / k.qty_base from supplier_prices sp join product_packs k on k.id = sp.pack_id
     where k.product_id = p_product and sp.last_price is not null and not k.is_serving
     order by sp.last_price_at desc nulls last limit 1),
    (select sum(b.qty * b.avg_cost) / nullif(sum(b.qty), 0) from stock_balances b where b.product_id = p_product and b.qty > 0 and b.avg_cost > 0)
  )
$$;
revoke all on function product_unit_cost(uuid) from public, anon, authenticated;

-- Coste total de una receta (todo lo que rinde) y cuántos ingredientes no tienen precio. Recursiva.
create or replace function recipe_total_cost(p_recipe uuid, p_depth int default 0, out total numeric, out missing int)
language plpgsql stable security definer set search_path = public as $$
declare
  l record;
  sub record;
  c numeric;
begin
  total := 0;
  missing := 0;
  if p_depth > 12 then
    missing := 1;
    return;
  end if;
  for l in select * from recipe_lines where recipe_id = p_recipe loop
    if l.product_id is not null then
      c := product_unit_cost(l.product_id);
      if c is null then
        missing := missing + 1;
      else
        -- La merma de limpieza encarece lo aprovechable: 1 kg con 20 % de merma cuesta como 1,25 kg.
        total := total + l.qty / (1 - l.waste_pct / 100) * c;
      end if;
    else
      select t.total, t.missing, r.yield_qty into sub from recipe_total_cost(l.sub_recipe_id, p_depth + 1) t, recipes r where r.id = l.sub_recipe_id;
      total := total + l.qty / (1 - l.waste_pct / 100) * sub.total / sub.yield_qty;
      missing := missing + sub.missing;
    end if;
  end loop;
end $$;
revoke all on function recipe_total_cost(uuid, int) from public, anon, authenticated;

-- Alérgenos de una receta: los de sus productos y los de sus subrecetas.
create or replace function recipe_allergens(p_recipe uuid) returns text[]
language sql stable security definer set search_path = public as $$
  with recursive tree(id) as (
    select p_recipe
    union
    select l.sub_recipe_id from recipe_lines l join tree t on l.recipe_id = t.id where l.sub_recipe_id is not null
  )
  select coalesce(array_agg(distinct a.allergen order by a.allergen), '{}')
  from tree t join recipe_lines l on l.recipe_id = t.id join product_allergens a on a.product_id = l.product_id
$$;
revoke all on function recipe_allergens(uuid) from public, anon;
grant execute on function recipe_allergens(uuid) to authenticated;

-- El escandallo de cada receta de la organización. Sin el permiso «ve costes», los importes van vacíos.
create or replace function recipe_costs(p_org uuid)
returns table (
  recipe_id uuid, total_cost numeric, unit_cost numeric, portion_cost numeric, net_price numeric,
  food_cost_pct numeric, margin numeric, recommended_price numeric, missing_prices int,
  cost_change_pct numeric, allergens text[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  r recipes;
  c record;
  v_costs boolean := sees_costs(p_org);
  v_portion numeric;
  v_net numeric;
begin
  if p_org not in (select my_org_ids()) then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select * from recipes where org_id = p_org loop
    select * into c from recipe_total_cost(r.id);
    v_portion := case when r.yield_unit = 'racion' then c.total / r.yield_qty end;
    v_net := case when r.sale_price is not null then round(r.sale_price / (1 + r.vat_rate / 100), 4) end;
    recipe_id := r.id;
    allergens := recipe_allergens(r.id);
    missing_prices := c.missing;
    if v_costs then
      total_cost := round(c.total, 4);
      unit_cost := round(c.total / r.yield_qty, 6);
      portion_cost := round(v_portion, 4);
      net_price := v_net;
      food_cost_pct := case when v_portion is not null and v_net > 0 then round(v_portion / v_net * 100, 1) end;
      margin := case when v_portion is not null and v_net is not null then round(v_net - v_portion, 2) end;
      recommended_price := case when v_portion is not null then round(v_portion / (r.target_food_cost / 100) * (1 + r.vat_rate / 100), 2) end;
      cost_change_pct := case when r.reviewed_cost > 0 then round((c.total - r.reviewed_cost) / r.reviewed_cost * 100, 1) end;
    else
      total_cost := null; unit_cost := null; portion_cost := null; net_price := v_net; food_cost_pct := null;
      margin := null; recommended_price := null; cost_change_pct := null;
    end if;
    return next;
  end loop;
end $$;
revoke all on function recipe_costs(uuid) from public, anon;
grant execute on function recipe_costs(uuid) to authenticated;

-- Coste de cada línea de una receta (para el editor). Sin «ve costes», vacío.
create or replace function recipe_line_costs(p_recipe uuid)
returns table (line_id uuid, unit_cost numeric, line_cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := (select org_id from recipes where id = p_recipe);
begin
  if v_org is null or v_org not in (select my_org_ids()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not sees_costs(v_org) then return; end if;
  return query
  select l.id,
         case when l.product_id is not null then product_unit_cost(l.product_id)
              else (select t.total / r.yield_qty from recipe_total_cost(l.sub_recipe_id) t, recipes r where r.id = l.sub_recipe_id) end,
         round(l.qty / (1 - l.waste_pct / 100) *
           case when l.product_id is not null then product_unit_cost(l.product_id)
                else (select t.total / r.yield_qty from recipe_total_cost(l.sub_recipe_id) t, recipes r where r.id = l.sub_recipe_id) end, 4)
  from recipe_lines l where l.recipe_id = p_recipe;
end $$;
revoke all on function recipe_line_costs(uuid) from public, anon;
grant execute on function recipe_line_costs(uuid) to authenticated;

-- Coste por unidad base de unos productos (para calcular en el editor mientras se escribe).
create or replace function product_unit_costs(p_products uuid[])
returns table (product_id uuid, unit_cost numeric)
language sql stable security definer set search_path = public as $$
  select p.id, product_unit_cost(p.id)
  from products p
  where p.id = any(p_products) and p.org_id in (select my_org_ids()) and sees_costs(p.org_id)
$$;
revoke all on function product_unit_costs(uuid[]) from public, anon;
grant execute on function product_unit_costs(uuid[]) to authenticated;

-- «Revisada»: guarda el coste de hoy para avisar cuando cambie.
create or replace function mark_recipe_reviewed(p_recipe uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := (select org_id from recipes where id = p_recipe);
begin
  if v_org is null or v_org not in (select my_manager_org_ids()) or not sees_costs(v_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform set_config('app.recipe_review', 'on', true);
  update recipes set reviewed_cost = (select total from recipe_total_cost(p_recipe)), reviewed_at = now() where id = p_recipe;
  perform set_config('app.recipe_review', '', true);
end $$;
revoke all on function mark_recipe_reviewed(uuid) from public, anon;
grant execute on function mark_recipe_reviewed(uuid) to authenticated;
