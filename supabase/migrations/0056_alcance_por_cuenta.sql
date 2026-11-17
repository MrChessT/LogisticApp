-- Roles, fase 2: cada persona ve y toca solo los productos de sus cuentas de análisis (docs/roles.md).
--
-- Regla (de la 0055): sin filas en membership_accounts, sin restricción. Así esta migración no cambia nada
-- hasta que a alguien se le asignan cuentas (el cocinero, Comida; oficina, Suministros y Oficina).
--
-- Las políticas son RESTRICTIVAS: se suman con un Y a las que ya había (organización, local, rol), sin tocarlas.
-- Rendimiento: las funciones no reciben argumentos de la fila y van dentro de (select …), así Postgres las evalúa
-- una vez por consulta (InitPlan) y no una por fila. Con la restricción apagada, el OR se resuelve sin calcular
-- la lista de productos. (Una política que llamaba a una función por fila hizo tardar 9 s a Escandallos: 0053.)
--
-- Las funciones security definer que leen datos (warehouse_catalog, area_moves_list, export_catalog,
-- sales_report) no pasan por estas políticas: son de la pantalla de almacén, de la exportación o de ventas, con su
-- propio control. Quedan anotadas en docs/roles.md.

create or replace function account_scope_off() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from membership_accounts where user_id = auth.uid())
$$;

-- Cuentas asignadas y sus familias (las raíces de categoría y sus hijas).
create or replace function allowed_category_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from categories c
  join membership_accounts ma on ma.user_id = auth.uid() and ma.org_id = c.org_id
  where c.id = ma.account_id or c.parent_id = ma.account_id
$$;

create or replace function allowed_product_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from products p where p.category_id in (select allowed_category_ids())
$$;

create or replace function allowed_pack_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select k.id from product_packs k where k.product_id in (select allowed_product_ids())
$$;

revoke all on function account_scope_off() from public, anon;
revoke all on function allowed_category_ids() from public, anon;
revoke all on function allowed_product_ids() from public, anon;
revoke all on function allowed_pack_ids() from public, anon;
grant execute on function account_scope_off() to authenticated;
grant execute on function allowed_category_ids() to authenticated;
grant execute on function allowed_product_ids() to authenticated;
grant execute on function allowed_pack_ids() to authenticated;

-- Una política por operación, nunca «for all»: una de escritura no debe evaluarse al leer (norma de la 0019).
-- Las tablas que la app solo lee (stock, movimientos, historial) cambian por funciones de la base: solo lectura aquí.

create policy categories_scope_select on categories as restrictive for select using ((select account_scope_off()) or id in (select allowed_category_ids()));
create policy categories_scope_insert on categories as restrictive for insert with check ((select account_scope_off()) or id in (select allowed_category_ids()) or parent_id in (select allowed_category_ids()));
create policy categories_scope_update on categories as restrictive for update using ((select account_scope_off()) or id in (select allowed_category_ids())) with check ((select account_scope_off()) or id in (select allowed_category_ids()) or parent_id in (select allowed_category_ids()));
create policy categories_scope_delete on categories as restrictive for delete using ((select account_scope_off()) or id in (select allowed_category_ids()));
create policy products_scope_select on products as restrictive for select using ((select account_scope_off()) or category_id in (select allowed_category_ids()));
create policy products_scope_insert on products as restrictive for insert with check ((select account_scope_off()) or category_id in (select allowed_category_ids()));
create policy products_scope_update on products as restrictive for update using ((select account_scope_off()) or category_id in (select allowed_category_ids())) with check ((select account_scope_off()) or category_id in (select allowed_category_ids()));
create policy products_scope_delete on products as restrictive for delete using ((select account_scope_off()) or category_id in (select allowed_category_ids()));
create policy product_packs_scope_select on product_packs as restrictive for select using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy product_packs_scope_insert on product_packs as restrictive for insert with check ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy product_packs_scope_update on product_packs as restrictive for update using ((select account_scope_off()) or product_id in (select allowed_product_ids())) with check ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy product_packs_scope_delete on product_packs as restrictive for delete using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy location_products_scope_select on location_products as restrictive for select using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy location_products_scope_insert on location_products as restrictive for insert with check ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy location_products_scope_update on location_products as restrictive for update using ((select account_scope_off()) or product_id in (select allowed_product_ids())) with check ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy location_products_scope_delete on location_products as restrictive for delete using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy product_allergens_scope_select on product_allergens as restrictive for select using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy product_allergens_scope_insert on product_allergens as restrictive for insert with check ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy product_allergens_scope_update on product_allergens as restrictive for update using ((select account_scope_off()) or product_id in (select allowed_product_ids())) with check ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy product_allergens_scope_delete on product_allergens as restrictive for delete using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy supplier_item_codes_scope_select on supplier_item_codes as restrictive for select using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy supplier_prices_scope_select on supplier_prices as restrictive for select using ((select account_scope_off()) or pack_id in (select allowed_pack_ids()));
create policy supplier_prices_scope_insert on supplier_prices as restrictive for insert with check ((select account_scope_off()) or pack_id in (select allowed_pack_ids()));
create policy supplier_prices_scope_update on supplier_prices as restrictive for update using ((select account_scope_off()) or pack_id in (select allowed_pack_ids())) with check ((select account_scope_off()) or pack_id in (select allowed_pack_ids()));
create policy supplier_prices_scope_delete on supplier_prices as restrictive for delete using ((select account_scope_off()) or pack_id in (select allowed_pack_ids()));
create policy stock_balances_scope_select on stock_balances as restrictive for select using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy stock_area_balances_scope_select on stock_area_balances as restrictive for select using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy stock_movements_scope_select on stock_movements as restrictive for select using ((select account_scope_off()) or product_id in (select allowed_product_ids()));
create policy price_history_scope_select on price_history as restrictive for select using ((select account_scope_off()) or pack_id in (select allowed_pack_ids()));

-- La 0055 dejó «memacc_write» como «for all»; se sustituye por una política por operación.
drop policy if exists memacc_write on membership_accounts;
create policy memacc_insert on membership_accounts for insert with check (is_admin(org_id));
create policy memacc_update on membership_accounts for update using (is_admin(org_id)) with check (is_admin(org_id));
create policy memacc_delete on membership_accounts for delete using (is_admin(org_id));
