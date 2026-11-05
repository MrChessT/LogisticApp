-- Conteo fino e inventario con motivo (especificación A: Formatos e Inventario; Estructura: PROD-01, INV-01).
--   1) Formatos de servicio: copa, chupito, caña… Son la unidad de consumo (la que luego se vinculará con
--      el TPV y la que se usa para apuntar «2 copas» de merma). No se compran ni se cuentan: no pueden ser
--      el formato de compra ni el de conteo por defecto.
--   2) Motivo del ajuste al cerrar un inventario: queda en el inventario y en cada movimiento de ajuste.
--   El pesaje de botellas abiertas usa las columnas que ya había (full_weight_g y empty_weight_g del
--   formato de conteo); la fracción o el peso tecleados se guardan en count_lines.input.
alter table product_packs
  add column is_serving boolean not null default false;

alter table product_packs
  add constraint product_packs_serving_not_default
  check (not (is_serving and (is_count_default or is_purchase_default)));

alter table inventory_counts
  add column close_reason text check (close_reason is null or close_reason in (
    'consumo_no_registrado', 'merma_no_registrada', 'recepcion_no_registrada', 'error_conteo_anterior', 'robo_o_perdida', 'otro'
  )),
  add column close_note text check (close_note is null or char_length(close_note) <= 300);

-- close_count con el motivo. Se sustituye la firma anterior para que las llamadas con nombre no sean
-- ambiguas; sin motivo funciona igual que antes.
drop function close_count(uuid, boolean, boolean);

create function close_count(
  p_count uuid,
  p_zero_uncounted boolean default false,
  p_as_consumption boolean default false,
  p_reason text default null,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  c inventory_counts;
  v_label text;
begin
  select * into c from inventory_counts where id = p_count for update;
  if not found then raise exception 'not_found'; end if;
  if not (can_access_location(c.location_id) and is_manager(c.org_id)) then
    raise exception 'forbidden';
  end if;
  if c.status <> 'open' then raise exception 'invalid_status'; end if;
  if p_reason is not null and p_reason not in (
    'consumo_no_registrado', 'merma_no_registrada', 'recepcion_no_registrada', 'error_conteo_anterior', 'robo_o_perdida', 'otro'
  ) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  v_label := case p_reason
    when 'consumo_no_registrado' then 'ajuste de inventario: consumo no registrado'
    when 'merma_no_registrada' then 'ajuste de inventario: merma no registrada'
    when 'recepcion_no_registrada' then 'ajuste de inventario: recepción no registrada'
    when 'error_conteo_anterior' then 'ajuste de inventario: error en el conteo anterior'
    when 'robo_o_perdida' then 'ajuste de inventario: robo o pérdida sin explicar'
    when 'otro' then 'ajuste de inventario: ' || coalesce(nullif(trim(coalesce(p_note, '')), ''), 'otro motivo')
  end;

  with counted as (
    select product_id, sum(qty) as q
    from count_lines where count_id = p_count
    group by product_id
  ), scope as (
    select product_id from counted
    union
    select lp.product_id from location_products lp
    where p_zero_uncounted and lp.location_id = c.location_id and lp.active
  )
  insert into count_results (count_id, product_id, expected_qty, counted_qty, unit_cost)
  select p_count, s.product_id, coalesce(b.qty, 0), coalesce(ct.q, 0), coalesce(b.avg_cost, 0)
  from scope s
  left join counted ct on ct.product_id = s.product_id
  left join stock_balances b on b.location_id = c.location_id and b.product_id = s.product_id;

  insert into stock_movements (org_id, location_id, product_id, type, qty, reason, ref_table, ref_id)
  select c.org_id, c.location_id, product_id,
         case when p_as_consumption and diff_qty < 0 then 'consumption'::movement_type else 'count_adjustment'::movement_type end,
         diff_qty,
         case when p_as_consumption and diff_qty < 0 then 'consumo calculado por inventario' else v_label end,
         'inventory_counts', p_count
  from count_results
  where count_id = p_count and diff_qty <> 0;

  update inventory_counts
  set status = 'closed', closed_by = auth.uid(), closed_at = now(),
      close_reason = p_reason, close_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_count;
end $$;

revoke execute on function close_count(uuid, boolean, boolean, text, text) from public, anon;
grant execute on function close_count(uuid, boolean, boolean, text, text) to authenticated;
