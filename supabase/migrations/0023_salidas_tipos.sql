-- Tipos nuevos para la pantalla de almacén (en su propia migración: un valor nuevo de un enum no se
-- puede usar en la misma transacción que lo crea).
--   internal_move  movimiento entre zonas del mismo local (almacén → barra y vuelta). No es consumo.
--   kiosk          cuenta de una pantalla de almacén: solo apunta salidas de su local.
alter type movement_type add value if not exists 'internal_move';
alter type member_role add value if not exists 'kiosk';
