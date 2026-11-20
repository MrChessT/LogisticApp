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
    shell/, ui/, charts/, product-picker/   Piezas comunes (charts/: paleta validada de la guía de dataviz)
  copiloto/             Motor del asistente. Solo servidor, sin React (ver «Asistente»)
  lib/                  Lógica compartida y pura: unidades, formatos, recetas, facturas, lector de
                        albaranes, clientes de Supabase, registro de errores
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

Proyecto del asistente, traspaso y encargo para otro modelo: [copiloto/PROYECTO_ASISTENTE.md](copiloto/PROYECTO_ASISTENTE.md). Roles: [roles.md](roles.md). Especialistas: [copiloto/ESPECIALISTAS.md](copiloto/ESPECIALISTAS.md).

Qué consulta y qué hace, pantalla por pantalla: [copiloto/capacidades.md](copiloto/capacidades.md).

Un mensaje recorre este camino (`agent/loop.ts` lo orquesta; el detalle, con cómo ampliar cada parte,
en [copiloto/JEV.md](copiloto/JEV.md)):

1. **Estado del mensaje**: botón de seguimiento, formulario enviado, respuesta a una aclaración
   (`clarify-answer.ts`) o mensaje nuevo. Dos estados más hacen que el diálogo avance:
   - **Operación a medias** (`task-in-progress.ts`): tras el miniformulario, lo escrito («larios», «2 botellas»,
     «en el vivero») rellena lo que falta y se arma la frase completa; «olvídalo» o «no» la dejan.
   - **Corrección del borrador pendiente** (`draft-correction.ts`): «mejor que sean 4», «cámbialo a Parador», «era
     por caducidad» o «quita la de zero» rehacen ese borrador con lo que cambia (Jev vuelve a comprobarlo) y el
     anterior queda descartado; nunca sale uno nuevo suelto.
2. **Seguimiento con contexto** (`comprehension.ts`): si el mensaje depende de lo hablado, la IA lo
   reescribe como petición completa. Se descarta si inventa productos o locales.
3. **Sin Jev** (`preroute.ts`, en orden): preguntas sobre el archivo dado al chat o cargar sus ventas
   (`document-turn.ts`, con lo leído que viaja en `ChatRequest.document`), comandos `/…`, órdenes de oficina (`office-actions.ts`; varias
   órdenes en una frase, un borrador por orden, en `multi-task.ts`),
   respuestas ya escritas (`fixed-replies.ts`), temas de gestión claros (`tools/info.ts`) y vía rápida de
   stock (`fast-path.ts`).
4. **Jev** (`jev/`): `request.ts` prepara la llamada, `catalog/` define las preguntas, `interpret/` aplica
   los umbrales (`gates/`) y produce un **plan** (`agent/plans.ts`) o una aclaración. Si la operación está
   clara pero faltan dos datos o más, un miniformulario (`action-form.ts`). Nunca se adivina.
5. **Rescate**: si Jev no entendió un mensaje nuevo, la IA lo reescribe o da una respuesta general, y la
   reescritura vuelve a pasar por Jev. Solo se adopta si ahora se entiende.
6. **Ejecución**: consulta (`run-query.ts` + `tools/`), información de gestión (`tools/info*.ts`), tarea
   (`skills/tareas.ts`) o borrador (`drafts/`; pasos sueltos en `agent/execute-steps.ts`). **Las cifras salen
   siempre del código.** Las consultas respetan lo que dice el mensaje: periodo natural («este mes» desde el día 1,
   `tools/periods.ts`), número de documento, ventana de vencimiento y proveedor que no existe
   (`tools/text-filters.ts`, usados en `tools/info-invoices.ts`, proveedores y pedidos), familia del gasto, mermas
   por local, persona del equipo, comparar proveedores por precio (`agent/product-facts.ts`), stock parado
   (`skills/stock-parado.ts`) y dos datos de un producto en la misma pregunta (la ficha entera).
   La reposición («preparar pedidos», «equilibrar» y el borrador de pedido sin cantidades) sale de una sola
   decisión, `tools/reorder-plan.ts`: traspasar antes que comprar, pedir a cada proveedor lo que cubre hasta su
   pedido siguiente (días, hora límite y plazo de su ficha, `orderCycle` en `src/lib/supplier-terms.ts`), dejar
   para su día lo del proveedor que hoy no admite pedidos y poner primero lo que se acaba antes de que llegue
   nada. Las fuentes de precio (`suppliers.is_price_source`, 0061) valoran pero nunca reciben pedidos
   (`tools/orderable.ts`). La comprueba la batería de decisiones (`__tests__/bateria-decisiones.test.ts`).
7. **Respuesta** (`writer/`): plantillas con las cifras exactas (las consultas simples —stock, precios y ficha— y
   las correcciones de borrador, siempre con plantilla). Un borrador no se guarda hasta que el
   usuario lo confirma (`drafts/confirm.ts`, con las mismas funciones de la base que las pantallas).
8. **Rastro** (`agent/turn-trace.ts`): cada turno, por cualquier vía (archivo, varias órdenes, atajo, botón, Jev),
   queda en `copilot_audit` con la respuesta, la vía, el plan, el tiempo por etapa y si fue una aclaración o un
   borrador. Las baterías se marcan (`origen: "bateria"`). Con eso, `copilot_indicators` (0062) da los indicadores
   de uso real en la pantalla Opiniones, y la prueba ciega se califica con `scripts/ops/juez-ciega.mjs`
   ([EVALUACION_CIEGA.md](copiloto/EVALUACION_CIEGA.md)).

Reglas que no se rompen:

- La IA de apoyo (`writer/assistant.ts`, Vercel AI Gateway) **no decide ni da cifras**: reescribe,
  resume informes (cada número se verifica contra el informe) o responde preguntas generales marcadas
  como tales. Si falla o no está, todo funciona igual que sin ella.
- Cambiar un texto de `jev/catalog/` sube `CATALOG_VERSION` (en `jev/catalog/criteria.ts`).
- El asistente trabaja con el JWT del usuario: ve y puede lo mismo que esa persona.
- Solo cambia de pantalla cuando se le pide («llévame a…», `/stock`): `navigate` con `auto`. Si se
  pregunta dónde está algo, deja el enlace.
- Los botones de seguimiento llevan una consulta ya resuelta (`plan`, sin Jev) o una frase completa
  (`say`, que sigue el camino normal como si se hubiera escrito).

### Panel del asistente (`src/components/copiloto`)

| Fichero | Qué es |
| --- | --- |
| `copiloto.tsx` | El panel: conversación, envío (texto, comandos, fotos, voz) y pintado |
| `form-card.tsx` | Miniformulario de una operación (varios datos a la vez) |
| `use-file-drop.ts` | Archivos arrastrados al panel o pegados (Ctrl+V); fotos → `photo.ts`; PDF → botón que abre Facturas con el archivo (`src/lib/pending-file.ts`) |
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
