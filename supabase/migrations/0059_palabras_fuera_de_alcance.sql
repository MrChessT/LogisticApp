-- Roles, fase 5: que el asistente sepa decir «eso no lo ves» en vez de responder otra cosa.
--
-- Con cuentas asignadas, el asistente solo recibe el catálogo permitido (0056). Si el cocinero pregunta por
-- ginebra, no hay nada que se parezca y, sin esta ayuda, contestaba con el stock de todo lo suyo, como si no hubiera
-- nombrado un producto.
--
-- hidden_catalog_words()  Palabras (normalizadas, de 4 letras o más) de los nombres y las familias de los productos
--                          activos que la persona NO ve, con la cuenta a la que pertenecen. Sin cuentas asignadas,
--                          nada. Solo da palabras sueltas y el nombre de la cuenta, ni cifras ni productos enteros.
--                          El asistente quita las que también salen en su propio catálogo.

create or replace function hidden_catalog_words() returns table (word text, account text)
language sql stable security definer set search_path = public as $$
  select distinct on (w) w, coalesce(r.name, c.name)
  from products p
  left join categories c on c.id = p.category_id
  left join categories r on r.id = c.parent_id
  cross join lateral regexp_split_to_table(norm_text(p.name || ' ' || coalesce(c.name, '') || ' ' || coalesce(r.name, '')), '[^a-z0-9]+') w
  where not (select account_scope_off())
    and p.org_id in (select my_org_ids())
    and p.active
    and p.id not in (select allowed_product_ids())
    and length(w) >= 4
    and coalesce(r.name, c.name) is not null
  order by w, coalesce(r.name, c.name)
$$;
revoke all on function hidden_catalog_words() from public, anon;
grant execute on function hidden_catalog_words() to authenticated;
