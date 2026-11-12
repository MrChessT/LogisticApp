-- El registro de errores (0043) deja de estar abierto a quien no tiene sesión.
--
-- Regla del proyecto (0030, con test): nadie sin sesión ejecuta funciones de la API. La 0043 la rompía
-- para que se registrasen también los fallos de la pantalla de acceso. Esos errores (y los del servidor,
-- que no llevan sesión) los registra ahora el servidor con su clave de servicio, que nunca sale de él.

revoke execute on function report_app_error(text, text, text, text, jsonb) from anon;
grant execute on function report_app_error(text, text, text, text, jsonb) to authenticated, service_role;
