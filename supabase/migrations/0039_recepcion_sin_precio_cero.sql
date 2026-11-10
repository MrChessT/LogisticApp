-- Una línea de recepción a 0 € (sin precio, o mercancía regalada) ya no se guarda como último precio
-- del proveedor ni en el historial: un 0 tapaba el precio bueno y los productos salían valorados a
-- 0 € (pasó en producción con dos recepciones de noviembre). El resto de post_receipt, igual.

create or replace function post_receipt(p_receipt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r goods_receipts;
begin
  select * into r from goods_receipts where id = p_receipt for update;
  if not found then raise exception 'not_found'; end if;
  if not can_access_location(r.location_id) then raise exception 'forbidden'; end if;
  if r.status <> 'open' then raise exception 'invalid_status'; end if;
  if not exists (select 1 from receipt_lines where receipt_id = p_receipt) then
    raise exception 'empty_receipt';
  end if;

  insert into stock_movements (org_id, location_id, product_id, type, qty, unit_cost, ref_table, ref_id)
  select r.org_id, r.location_id, pp.product_id, 'purchase',
         rl.packs_qty * pp.qty_base, rl.pack_price / pp.qty_base,
         'goods_receipts', r.id
  from receipt_lines rl
  join product_packs pp on pp.id = rl.pack_id
  where rl.receipt_id = p_receipt;

  if r.supplier_id is not null then
    insert into supplier_prices (supplier_id, pack_id, last_price, last_price_at)
    select distinct on (pack_id) r.supplier_id, pack_id, pack_price, now()
    from receipt_lines where receipt_id = p_receipt and pack_price > 0
    order by pack_id
    on conflict (supplier_id, pack_id)
    do update set last_price = excluded.last_price, last_price_at = excluded.last_price_at;

    insert into price_history (supplier_id, pack_id, price, receipt_id)
    select r.supplier_id, pack_id, pack_price, r.id
    from receipt_lines where receipt_id = p_receipt and pack_price > 0;
  end if;

  update goods_receipts
  set status = 'closed', posted_by = auth.uid(), posted_at = now()
  where id = p_receipt;
end $$;
