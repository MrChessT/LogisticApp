-- Renombra la categoría de primer nivel «Comida» (la antigua) para que no coincida con la cuenta COMIDA.
-- La importación del catálogo busca la familia por nombre; con dos «Comida» no sabría cuál tomar.
-- Solo cambia el nombre: ningún producto ni categoría se mueve.

create or replace function renombra_comida_antigua(p_org uuid) returns void
language sql
security definer
set search_path = public
as $$
  update categories set name = 'Comida (antigua)'
  where org_id = p_org and parent_id is null and name = 'Comida'
    and not exists (select 1 from categories x where x.org_id = p_org and x.parent_id is null and x.name = 'Comida (antigua)');
$$;

revoke all on function renombra_comida_antigua(uuid) from public, anon, authenticated;

select renombra_comida_antigua(id) from organizations;
