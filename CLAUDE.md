@AGENTS.md

# LogisticApp: normas de trabajo

Lee [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) antes de cambiar la estructura; ahí está el mapa del
código y el recorrido de un mensaje del asistente.

## Antes de dar algo por terminado

- `npm run check` (lint, tipos, knip, tamaño de ficheros, tests y build) tiene que pasar.
- Si tocas el asistente (`src/copiloto/jev/`, `agent/preroute.ts`, comprensión, respuestas): lee
  [docs/copiloto/JEV.md](docs/copiloto/JEV.md) y pasa
  `scripts/ops/bateria-asistente.mjs` antes y después, y añade un caso por cada fallo que arregles. Al cerrar una
  fase del plan de mejora, pasa también la prueba ciega con el juez ([EVALUACION_CIEGA.md](docs/copiloto/EVALUACION_CIEGA.md)).
- Si cambias la base de datos: migración nueva numerada + test pgTAP + tipos en `database.types.ts`.
- Al empezar una sesión de trabajo, mira `bash scripts/ops/errores.sh` por si hay errores nuevos en producción.

## Orden del código

- Un fichero, una responsabilidad. Límite de 600 líneas (`npm run size`). Si un fichero de la lista de
  excepciones de `scripts/check-file-size.mjs` baja, baja también su tope; no se añaden excepciones.
- Lógica pura en `src/lib` (con su test al lado); pantallas en `src/app`; piezas compartidas en
  `src/components`; el motor del asistente en `src/copiloto` (sin React).
- Comentarios en español, que expliquen el porqué o la regla del negocio. No se comenta lo que el código
  ya dice, ni se deja código comentado, ni notas de «antes era así» (para eso está git).
- Sin código muerto: knip debe salir limpio. Lo que no se usa se borra.
- La documentación se cambia en el mismo PR que el código. Los planes ya ejecutados van a `docs/historico`.

## Reglas del negocio que no se rompen

- El stock solo cambia mediante funciones de la base de datos; `stock_movements` es inmutable.
- Cantidades y dinero con `decimal.js` (nunca `number`), en unidad base (ml, g, ud).
- Los permisos los decide la base de datos (RLS), no la pantalla.
- En el asistente, Jev decide y el código calcula; la IA de apoyo solo interpreta o redacta, validada.
  Nada se guarda sin que el usuario lo confirme.

## Datos y seguridad

- No se suben al repositorio datos del negocio (costes, stock, proveedores reales, personas, SQL con
  datos) ni claves. Las claves no llevan `NEXT_PUBLIC_`.
- Producción: las comprobaciones son de solo lectura y con la cuenta en modo pruebas; no se confirman
  borradores. Las migraciones se aplican solo con `scripts/ops/aplicar-migracion.sh`.
