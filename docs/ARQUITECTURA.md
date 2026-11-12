# Arquitectura de LogisticApp

Cómo está montado el proyecto y dónde va cada cosa. Si cambias la estructura, cambia este documento en
el mismo PR.

## En una frase

Una aplicación Next.js (App Router) desplegada en Vercel, con Supabase (Postgres) como base de datos y
autenticación. **Las reglas del negocio y los permisos viven en la base de datos** (RLS y funciones); la
app pinta, calcula con `decimal.js` y escribe solo mediante esas funciones. El asistente decide con
**Jev** (TypeSafe) y una IA de apoyo solo interpreta o redacta, siempre validada.

## Mapa del código

```
src/
  app/                  Pantallas (una carpeta por ruta) y rutas de la API
    api/copiloto/         Asistente: chat (SSE), confirmar, sugerencias, informes, salud
    api/errores/          Recibe los errores del navegador
    api/equipo/           Invitaciones y enlaces de acceso (clave de servicio, solo servidor)
  components/
    copiloto/             Panel del asistente (ver «Panel del asistente»)
    operations/           Recepciones, traspasos, inventarios y mermas (una pantalla, cuatro modos)
    shell/, ui/, charts/, product-picker/   Piezas comunes
  copiloto/             Motor del asistente. Solo servidor, sin React (ver «Asistente»)
  lib/                  Lógica compartida y pura: unidades, formatos, recetas, facturas, lector de
                        albaranes, ingeniería de menú, clientes de Supabase, registro de errores
  instrumentation.ts    Errores del servidor → registro de errores
  proxy.ts              Sesión en cada navegación (Next 16: sustituye a middleware)
supabase/
  migrations/           Esquema, RLS y funciones, numeradas. Fuente de verdad de la base de datos
  tests/                Tests pgTAP de permisos y funciones (los ejecuta el CI)
scripts/
  ops/                  Operación: aplicar una migración, ver errores, batería del asistente
  check-file-size.mjs   Control de tamaño de ficheros (CI)
docs/                   Este documento, el contrato y el catálogo del asistente, histórico
```

## Datos y permisos

- **Multiempresa**: cada tabla lleva `org_id` y sus políticas RLS; un usuario solo ve su organización y,
  si no es administración, solo sus locales (`my_org_ids`, `my_location_ids`).
- **El stock solo cambia mediante funciones** (`register_movement`, `close_count`, `receive_*`…) y
  `stock_movements` es inmutable. Las cantidades se guardan en unidad base (ml, g, ud).
- **Nada de aritmética con `number`** para cantidades o dinero: `decimal.js` en la app, `numeric` en SQL.
- **Migraciones**: un fichero nuevo por cambio, con su test en `supabase/tests`. A producción se aplican
  con `bash scripts/ops/aplicar-migracion.sh supabase/migrations/NNNN_nombre.sql` (una transacción).
- Los tipos de la base (`src/lib/supabase/database.types.ts`) se actualizan a mano junto a la migración.

## Asistente (`src/copiloto`)

Un mensaje recorre este camino (`agent/loop.ts` lo orquesta):

1. **Estado del mensaje**: botón de seguimiento, respuesta a una aclaración (`clarify-answer.ts`) o
   mensaje nuevo.
2. **Seguimiento con contexto** (`comprehension.ts`): si el mensaje depende de lo hablado («¿y sus
   proveedores?»), la IA lo reescribe como petición completa. Se descarta si inventa productos o locales.
3. **Atajos sin Jev**: comandos `/…` (`shortcuts.ts`), respuestas ya escritas (`fixed-replies.ts`: temas
   que no lleva, ir a una pantalla, consumo dicho a mano, «sí» suelto sin nada pendiente, categoría de un
   producto), temas claros de gestión (`tools/info.ts`: ventas, facturas, escandallos…) y la vía rápida
   de stock (`fast-path.ts`).
4. **Jev** (`routing.ts` construye las preguntas, `jev/catalog.ts` las define): devuelve probabilidades.
   `interpret.ts` aplica los umbrales (`gates/`) y produce un **plan** (`plans.ts`) o una aclaración.
   Si no llega al umbral, se pregunta: nunca se adivina.
5. **Rescate**: si Jev no entendió un mensaje nuevo, la IA lo reescribe o da una respuesta general, y
   la reescritura vuelve a pasar por Jev. Solo se adopta si ahora se entiende.
6. **Ejecución**: consulta (`run-query.ts` + `tools/`), información de gestión (`tools/info*.ts`),
   tarea (`skills/tareas.ts`) o borrador (`drafts/`). **Las cifras salen siempre del código.**
7. **Respuesta** (`writer/`): plantillas con las cifras exactas. Un borrador no se guarda hasta que el
   usuario lo confirma (`drafts/confirm.ts`, con las mismas funciones de la base que las pantallas).

Reglas que no se rompen:

- La IA de apoyo (`writer/assistant.ts`, Vercel AI Gateway) **no decide ni da cifras**: reescribe,
  resume informes (cada número se verifica contra el informe) o responde preguntas generales marcadas
  como tales. Si falla o no está, todo funciona igual que sin ella.
- Cambiar un texto de `jev/catalog.ts` sube `CATALOG_VERSION`.
- El asistente trabaja con el JWT del usuario: ve y puede lo mismo que esa persona.
- Solo cambia de pantalla cuando se le pide («llévame a…», `/stock`): `navigate` con `auto`. Si se
  pregunta dónde está algo, deja el enlace.
- Los botones de seguimiento llevan una consulta ya resuelta (`plan`, sin Jev) o una frase completa
  (`say`, que sigue el camino normal como si se hubiera escrito).

### Panel del asistente (`src/components/copiloto`)

| Fichero | Qué es |
| --- | --- |
| `copiloto.tsx` | El panel: conversación, envío (texto, comandos, fotos, voz) y pintado |
| `use-file-drop.ts` | Archivos arrastrados al panel o pegados (Ctrl+V); fotos → `photo.ts`, el resto dice dónde va |
| `chat-model.ts`, `chat-stream.ts` | Mensajes de la conversación y lectura de la respuesta (SSE) |
| `assistant-home.tsx` | Inicio según la pantalla, comandos «/» y guía de `/ayuda` |
| `message-parts.tsx`, `draft-card.tsx` | Texto, tablas y tarjetas de borrador |
| `photo.ts`, `use-voice.ts` | Foto de albarán (se lee en el navegador) y dictado |
| `report-form.tsx`, `quick-actions.tsx` | Reportar una respuesta y menú de funciones |

## Estilos

- `src/app/globals.css`: tokens (colores, tipografía, radios, sombras). Todo color sale de aquí.
- `src/app/theme.css`: la capa visual común (menú lateral en verde de marca, fondo, relieve de tarjetas)
  y el movimiento. Solo se anima `transform` y `opacity`, con duraciones cortas, y con «reducir
  movimiento» del sistema no se anima nada. Un cambio de aspecto general va aquí, no en cada pantalla.
- Cada pantalla y componente tiene su CSS al lado; usa los tokens, no colores sueltos.

## Lector de albaranes

OCR en el navegador (un Web Worker servido desde `/ocr`, generado por `scripts/build-ocr.mjs`; la foto
no sale del dispositivo). `lib/albaran-reader.ts` convierte el texto en líneas comprobando la aritmética
(cantidad × precio = importe; líneas = base; base + IVA = total). `supplier_item_codes` recuerda qué
producto es cada referencia de cada proveedor.

## Errores y alertas

- **Servidor**: `src/instrumentation.ts` (`onRequestError`). **Navegador**: `components/error-reporter.tsx`
  y `app/error.tsx` → `POST /api/errores`. **Asistente**: fallos internos del chat.
- Todo acaba en `lib/report-error.ts` → función `report_app_error` → tabla `app_errors` (un error por
  día y huella, con contador; sin datos del negocio). Con sesión se registra a nombre del usuario; sin
  sesión (acceso, fallos del servidor) con la clave de servicio, porque nadie sin sesión ejecuta
  funciones de la base (regla de la 0030, con test).
- **Aviso**: con la variable `ERROR_WEBHOOK_URL` (Slack, Discord o cualquier URL que acepte `{text}`)
  llega un mensaje la primera vez del día que aparece cada error.
- **Consulta**: `bash scripts/ops/errores.sh [días]`.

## Calidad

`npm run check` hace lo mismo que el CI: lint, tipos, código sin usar (knip), tamaño de ficheros,
tests y build. El CI además levanta la base de datos con todas las migraciones y pasa los tests pgTAP.

- **Tamaño**: ningún fichero nuevo pasa de 600 líneas; los heredados que lo superan están en
  `scripts/check-file-size.mjs` con un tope que solo puede bajar.
- **Asistente**: además de los tests (Jev simulado), `scripts/ops/bateria-asistente.mjs` pasa
  conversaciones reales contra un entorno con una cuenta de pruebas. Hay que pasarla antes y después de
  tocar el enrutado, el catálogo de Jev o la comprensión.

## Despliegue y entornos

- **Producción**: Vercel (funciones en Dublín) + un proyecto de Supabase. Cada fusión en `main` despliega.
- **Local**: `npm run db:start` (Supabase en Docker) y `npm run dev`.
- **Pendiente**: un proyecto de Supabase de pruebas con los previews de Vercel apuntando a él. Hasta
  entonces, producción hace de entorno de pruebas: las comprobaciones allí son de solo lectura y con la
  cuenta en modo pruebas.

## Variables de entorno

| Variable | Para qué |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Base de datos (públicas) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor: invitar al equipo |
| `TYPESAFE_API_KEY` o `AI_GATEWAY_API_KEY` | Jev (en Vercel puede ir por OIDC, sin clave) |
| `ASSIST_ENABLED`, `ASSIST_MODEL` | IA de apoyo: apagarla o cambiar la lista de modelos |
| `ERROR_WEBHOOK_URL` | Aviso de errores nuevos |

Las claves nunca llevan el prefijo `NEXT_PUBLIC_` (salvo las dos públicas de Supabase) ni se suben al repositorio.
