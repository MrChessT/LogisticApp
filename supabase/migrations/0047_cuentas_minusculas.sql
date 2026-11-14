-- Los departamentos (cuentas de análisis) pasan a «primera en mayúscula y el resto en minúscula», como el resto del catálogo.
-- Solo cambia el nombre de las cuentas de nivel 1: ningún producto ni familia se mueve.

create or replace function cuentas_minusculas(p_org uuid) returns void
language sql
security definer
set search_path = public
as $$
  update categories set name = upper(substr(name, 1, 1)) || lower(substr(name, 2))
  where org_id = p_org and parent_id is null
    and name in ('BEBIDA', 'COMIDA', 'MENAJE', 'PACKING Y LIMPIEZA', 'SUMINISTROS', 'OFICINA', 'MANTENIMIENTO');
$$;

revoke all on function cuentas_minusculas(uuid) from public, anon, authenticated;

select cuentas_minusculas(id) from organizations;
