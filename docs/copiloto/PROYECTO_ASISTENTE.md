# Proyecto: asistente de LogisticApp

Documento de traspaso. Describe el asistente como un proyecto propio: qué hace, cómo está hecho, cómo se mide,
qué falla hoy y qué hay que hacer, en orden. Está pensado para que cualquier persona o modelo que lo lea pueda
seguir el trabajo sin preguntar. Lo que no esté aquí, buscarlo en el código y en los documentos enlazados.

El asistente es el producto que más se quiere escalar y vender: debe tratarse como un sistema con capas, cachés,
acceso a datos controlado, habilidades (skills), contexto de sesión y, en el futuro, agentes especializados.

## 0. Encargo para un modelo más potente

Pegar esto al empezar. El documento completo y `roles.md` son la fuente de verdad.

> Trabajas en el repositorio `nexo` (LogisticApp), rama `claude/amazing-hamilton-kx3iae`. Tu tarea es el
> asistente de `src/copiloto`, que se trata como un proyecto propio. Lee en este orden: 1)
> `docs/copiloto/PROYECTO_ASISTENTE.md` (este documento, sobre todo las secciones 2, 3, 6 y 7); 2)
> `docs/roles.md` (alcance = cuenta de análisis × local, perfiles y matriz); 3) `docs/ARQUITECTURA.md`;
> 4) `docs/copiloto/JEV.md` y `docs/copiloto/ESPECIALISTAS.md`. Después, en orden:
>
> 1. **Mantener la batería de producción en 70/70** (sección 7) y añadir un caso por cada fallo que aparezca,
>    en `scripts/ops/bateria-asistente.json`, sin romper los demás. Medir primero: levantar la rama en local
>    contra la base de producción (`npx next dev -p 3100`) y pasar `scripts/ops/bateria-asistente.mjs` con
>    `BATERIA_URL=http://localhost:3100`. Sin pasarla antes y después no se da nada por bueno.
> 2. **Alcance por rol en el asistente** (`roles.md`, fase 5): cada herramienta, lectura o borrador, declara
>    qué cuentas y locales necesita; el asistente solo la ofrece si el alcance de la persona la cubre. Ejemplo:
>    el cocinero pregunta por Bebida y el asistente responde que eso no está en su alcance, sin cifras. Las
>    cifras de cada consulta se filtran por cuenta y local en la base de datos o en el origen de datos, nunca
>    solo en el texto de la respuesta. Antes, la fase 2 (políticas de catálogo, stock y movimientos).
> 3. **Modularizar por especialistas** (`ESPECIALISTAS.md`, pasos 2 a 4) sin cambiar el comportamiento: primero
>    el registro de especialistas, después extraer informes, almacén y catálogo, dividiendo los ficheros mayores
>    de la sección 8.
> 4. **Documentar cada cambio** en el mismo commit, con las decisiones tomadas y lo que queda.
>
> Reglas que no se rompen: las cifras las calcula el código; la IA solo interpreta o redacta; nada se guarda
> sin confirmación de la persona; no se suben datos del negocio ni claves al repositorio; las migraciones se
> aplican solo con `scripts/ops/aplicar-migracion.sh` y con prueba pgTAP; antes de dar algo por terminado,
> `npm run check` y la batería; comentarios en español que expliquen el porqué; ficheros de como máximo 600
> líneas. Si una decisión de negocio no está clara (por ejemplo, qué ve un perfil), no la inventes: pregunta.

## 1. Qué es y para qué sirve

Un asistente de chat para el personal y la gerencia de un grupo de restauración. Responde consultas (stock,
ventas, compras, facturas, informes), prepara acciones (recepciones, traspasos, mermas, altas de productos,
escandallos) como **borradores** que la persona confirma, y explica el negocio con cifras exactas.

Principios:
- **Jev decide, el código calcula, la IA redacta.** Jev es el componente que interpreta la intención y decide si
  actuar, preguntar o no entender. Las cifras salen siempre de funciones del código y de la base de datos.
- **Nada se guarda sin confirmación.** Un borrador es una propuesta revisable.
- **El asistente trabaja con el JWT de la persona.** Ve y puede lo mismo que esa persona en la app.
- **Sin IA, funciona.** La IA de apoyo (redacción, rescate, respuestas generales) es opcional; si falla, el
  asistente responde con sus plantillas.

## 2. Cómo se trabaja aquí

| Qué | Cómo |
|-----|------|
| Instalar | `npm ci` |
| Comprobación completa | `npm run check` (lint, tipos, knip, tamaños, tests, build) |
| Batería determinista (sin claves) | `npm run copiloto:bateria` → 102/102 al cierre de este documento |
| Batería contra una app (producción o local) | `scripts/ops/bateria-asistente.mjs` con `BATERIA_URL`, `BATERIA_EMAIL`, `BATERIA_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Usar solo la cuenta de pruebas. Sale con 1 si algo no cumple |
| Evaluación de Jev | `npm run copiloto:eval`, `copiloto:probe`, `copiloto:conversaciones` (requieren `.env.local` con claves de IA) |
| App en local contra la base de producción | `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (la clave publicable) y `npx next dev -p 3100`. Solo lectura y pruebas; no guardar nada |
| Base de datos de pruebas local | Postgres 16 en `/tmp/pgsock` puerto 5433, base `nexo_test`, usuario `postgres`. Si no responde, arrancar con el usuario dueño del directorio de datos (`runuser -u pgtest -- pg_ctl …`) |

Reglas del repositorio (ver `CLAUDE.md`): ficheros de como máximo 600 líneas (`npm run size`), código sin
muerto (knip limpio), lógica pura en `src/lib` con su test al lado, comentarios en español, documentación en el
mismo cambio. Los datos del negocio, claves y SQL con datos nunca van al repositorio.

## 3. Arquitectura por capas

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Entrada     http.ts (rutas /api/copiloto/*), security/ (auth, rate-limit)   │
├────────────────────────────────────────────────────────────────────────────┤
│ Sesión      agent/session.ts (turnos, aclaraciones pendientes, persistencia)│
│             agent/focus.ts, habits.ts, last-time.ts (contexto de la charla) │
├────────────────────────────────────────────────────────────────────────────┤
│ Comprensión agent/comprehension.ts (seguimientos reescritos por IA)         │
│             agent/clarify-answer.ts (respuestas a aclaraciones)             │
│             entities/* (troceo de cantidades, productos, familias, locales) │
├────────────────────────────────────────────────────────────────────────────┤
│ Vías        agent/preroute.ts → fixed-replies, office-actions, multi-task,  │
│ rápidas     fast-path, shortcuts, tools/info*.ts (gestión)                 │
├────────────────────────────────────────────────────────────────────────────┤
│ Decisión    jev/ : request.ts (prepara), catalog/ (preguntas y criterios),  │
│             interpret/ (lee la intención), gates/ (umbrales: actuar,        │
│             preguntar, no entender). Produce un plan (agent/plans.ts)       │
├────────────────────────────────────────────────────────────────────────────┤
│ Especialist. especialistas/ : registro (manifiestos), mapa (plan →        │
│             especialista, exhaustivo), puerta (permisos de lectura)         │
├────────────────────────────────────────────────────────────────────────────┤
│ Ejecución   agent/loop.ts (orquesta), agent/run-query.ts, tools/ (lecturas),│
│             analytics/ (vistas de informes), drafts/ (borradores y su       │
│             confirmación), skills/ (tareas), agent/recipe-chat.ts,          │
│             agent/product-sheet.ts, agent/supplier-terms.ts                 │
├────────────────────────────────────────────────────────────────────────────┤
│ Datos       supabase/ : client.ts (JWT del usuario), data-source.ts        │
│             (consultas acotadas: keepOnly, short, MAX_IDS_IN_URL=120),      │
│             business-cache.ts, memo-source.ts, info-source.ts, context.ts,  │
│             state.ts, audit-sink.ts                                        │
├────────────────────────────────────────────────────────────────────────────┤
│ Caché       cache/lru.ts (LRU con TTL en memoria; pensada para cambiar a    │
│             Redis manteniendo la interfaz)                                 │
├────────────────────────────────────────────────────────────────────────────┤
│ Respuesta   contract/index.ts (forma de la respuesta), writer/ (plantillas, │
│             prompt, provider, assistant.ts = IA de apoyo, verifier.ts =     │
│             comprueba cada cifra de la IA contra el informe)               │
├────────────────────────────────────────────────────────────────────────────┤
│ Medida      metrics/, audit/, suggestions/engine.ts, eval/ (baterías)      │
└────────────────────────────────────────────────────────────────────────────┘
```

Reglas de dependencia (que se deben cumplir y, cuando sea posible, comprobar): las capas de abajo no importan de
las de arriba; `jev/` no depende de React; `src/copiloto` no depende de componentes de pantalla; las pantallas
usan los mismos datos y funciones de base de datos que el asistente, nunca una copia.

## 4. Flujo de un mensaje

1. **Estado**: botón de seguimiento, formulario enviado, respuesta a una aclaración (con `clarifyId`) o mensaje
   nuevo. El panel del chat (`src/components/copiloto/copiloto.tsx`) envía la aclaración pendiente con su
   identificador y la opción «otra» cuando la persona escribe.
2. **Comprensión**: si el mensaje depende de lo hablado, la IA lo reescribe como petición completa; la reescritura
   se descarta si inventa productos o locales.
3. **Vías rápidas** (`preroute.ts`, en orden): comandos `/…`, órdenes de oficina (varias en una frase, un borrador
   por orden), respuestas ya escritas, temas de gestión claros, vía rápida de stock.
4. **Jev**: interpreta la petición contra el catálogo de preguntas. Si la operación está clara, produce un
   plan; si faltan dos datos o más, un miniformulario; si no entiende, una aclaración. Nunca adivina.
5. **Rescate**: si Jev no entendió un mensaje nuevo, la IA lo reescribe o da una respuesta general marcada como
   tal; la reescritura solo se adopta si ahora Jev la entiende.
6. **Ejecución**: consulta (`run-query.ts` + `tools/`), informe (`analytics/`), tarea (`skills/`) o borrador
   (`drafts/`). Las cifras salen del código.
7. **Respuesta**: plantillas con las cifras exactas; la IA de apoyo solo redacta o resume, y cada número se
   verifica contra el informe (`writer/verifier.ts`).
8. **Confirmación**: un borrador se guarda solo cuando la persona lo confirma (`drafts/confirm.ts`), con las
   mismas funciones de la base de datos que usan las pantallas.

## 5. Subsistemas, uno a uno

**Contexto y sesión** (`agent/session.ts`): turnos, aclaraciones pendientes (`clarifies`, con un máximo), foco
(producto, local o pantalla de la última petición: `focus.ts`), hábitos (`habits.ts`, qué productos y locales
usa cada persona), última vez (`last-time.ts`). La sesión se serializa y se puede restaurar.

**Comprensión** (`agent/comprehension.ts`, `followups.ts`, `free-text.ts`): reescritura de seguimientos y lectura
de respuestas escritas a mano (opción, cantidad, precio, cancelación, cambio de operación).

**Entidades** (`entities/`): troceo de cantidades y unidades (`quantity-parser.ts`: «dos cajas y media», «un
producto» no lleva cantidad), búsqueda de productos y familias (`family.ts`), parseo del catálogo para importar
(`catalog-parser.ts`).

**Jev** (`jev/`): el documento `docs/copiloto/JEV.md` lo explica con detalle. Resumen: `catalog/` define cada
pregunta y sus criterios (cambiar un texto sube `CATALOG_VERSION`), `interpret/` lee la intención con el
contexto, `gates/` aplica los umbrales (actuar, confirmar, preguntar, no entender) y `request.ts` prepara la
llamada. `CATALOGO_JEV.md` describe el catálogo de operaciones.

**Agente** (`agent/loop.ts`, `plans.ts`, `run-query.ts`): el bucle que orquesta un mensaje y decide el plan. Un
«plan» es lo que se ejecutará: consulta, aclaración, borrador, aviso o respuesta general. Hoy es un único agente
con vías especializadas; el paso a especialistas está en `ESPECIALISTAS.md`.

**Herramientas y datos** (`tools/`, `supabase/data-source.ts`, `info-source.ts`, `memo-source.ts`, `context.ts`):
las lecturas pasan por un origen de datos que **acota** las consultas (`keepOnly`, `short`, máximo de identificadores
en la URL, 120) y usa el JWT de la persona. Las cachés de negocio (`business-cache.ts`) y de memoria (`memo-source.ts`)
evitan repetir consultas dentro de una petición o una sesión; revisar antes de ampliarlas, porque un dato de otra
persona no debe quedar en caché compartida.

**Caché** (`cache/lru.ts`): LRU con TTL en memoria. Está pensada para un solo proceso; con varias réplicas hay
que pasar a un almacén compartido manteniendo la misma interfaz (`get`, `set`, `delete`, `size`).

**Habilidades** (`skills/tareas.ts`): tareas de varios pasos (pedidos, traspasos, mermas) que se describen como
una secuencia de pasos con sus comprobaciones. Es el sitio natural para nuevas habilidades: una por fichero, con
su prueba.

**Borradores** (`drafts/`): un constructor por entidad (`builder.ts` general, `catalog-builder.ts` productos,
`recipe-builder.ts` escandallos, `warehouse-move.ts` almacén, `supplier-link-builder.ts` proveedores, etc.),
`schemas.ts` (forma de cada borrador), `store.ts` (dónde se guardan hasta confirmar), `confirm.ts` (la
confirmación). `test-mode.ts` impide escribir en modo pruebas.

**Respuesta** (`contract/index.ts`, `writer/`): `contract` define la forma de cada respuesta (texto, opciones,
borrador, aclaración, informe); `writer/templates.ts` redacta con plantillas; `writer/assistant.ts` es la IA de
apoyo (proveedor en `provider.ts`, prompt en `prompt.ts`); `verifier.ts` comprueba cada cifra.

**Seguridad** (`security/auth.ts`, `rate-limit.ts`): autenticación de la petición (JWT del usuario) y límite de
mensajes por minuto. El asistente no se sirve al kiosco.

**Medida** (`metrics/`, `audit/`, `eval/`, `suggestions/`): métricas de cada petición, auditoría de acciones,
baterías de evaluación (ver sección 6) y sugerencias de siguientes pasos.

## 6. Cómo se mide

| Medida | Qué comprueba | Estado al cierre |
|--------|---------------|------------------|
| `npm run copiloto:bateria` (`eval/bateria.ts`) | troceo de cantidades, búsqueda de productos en el catálogo de prueba, lectura de respuestas escritas | 102/102 |
| `scripts/ops/bateria-asistente.mjs` + `bateria-asistente.json` | conversaciones de varios turnos contra una app real: lo que debe aparecer («espera»), lo que no («no»), si pide aclaración sin necesidad («sinAclarar») | producción 62/67 (línea base); local 61/67 |
| `eval/run-eval.ts`, `probe.ts`, `calibration.ts` | decisiones de Jev con frases etiquetadas (`frases.jsonl`, 220): ¿cuándo dice 0,9 acierta el 90 %? | requiere claves de IA |
| `eval/conversaciones.ts` | conversaciones completas etiquetadas | requiere claves de IA |

Regla: cada fallo que se arregla añade un caso a `bateria-asistente.json`. La batería se pasa antes y después de
cualquier cambio en `src/copiloto/jev/`, `agent/preroute.ts`, comprensión o respuesta.

Nota importante (corregida en el último cambio): la batería de varios turnos manda la respuesta a una
aclaración con su identificador, como el panel del chat. Antes la probaba por un camino que el panel no usa al
escribir, y daba resultados engañosos.

## 7. Estado actual y pendientes

**Batería de producción: 70/70** (era 62/67 al empezar; tres casos nuevos añadidos). En local, contra la base de
producción, 67/70: los tres restantes necesitan la IA de apoyo, que solo funciona en el despliegue.

Lo que se arregló, con la causa real de cada fallo:

| Caso | Causa | Arreglo |
|------|-------|---------|
| «quiero archivar un producto» | «un producto» se leía como cantidad | `entities/quantity-parser.ts`: palabras genéricas («producto», «artículo»…) no son producto |
| «Coca-Cola 20 cl» tras «¿Qué producto quieres archivar?» | la aclaración no se retomaba sin ruta de Jev; la batería además no mandaba el `clarifyId` como el panel | `agent/clarify-answer.ts` y `scripts/ops/bateria-asistente.mjs` |
| «kuanto ron ai en la oliva», «¿cuánta tónica queda?» | desde la taxonomía por cuentas, «Ron» y «Tónicas» ya no son familias | `entities/family.ts` (`nameGroupOf`, grupo por nombre o notas) en la lectura de Jev y en la vía rápida; capa de jerga `entities/jerga.ts` |
| «¿cuánto se gastó de eso la semana pasada?» | el foco no guardaba el titular del grupo y las palabras de la frase rompían el grupo | `Focus.familia` y `nameGroupOf` ignora palabras que no están en ningún producto |
| «el proveedor de … es Bebidas Mar Menor» | los proveedores «Proveedor prueba NN» tapaban al real | `entities/catalog-parser.ts`: «proveedor» es genérica y gana el de más coincidencias |
| FIFO, food cost | dependían de la IA de apoyo | pasan en producción |

Arquitectura ya construida: registro de especialistas, mapa exhaustivo de planes, puerta de permisos y métricas
por especialista (`especialistas/`, ver `ESPECIALISTAS.md`, sección 4).

Pendiente del proyecto, por prioridad:
1. Mover el código a cada especialista: informes, después almacén, después catálogo (dividir `catalog-builder.ts`).
2. Alcance por cuenta de análisis y local (`docs/roles.md`, fases 2 a 5): cuentas en el manifiesto y filtro de cifras en el origen de datos.
3. Evaluación del enrutador con los `ejemplos` del registro y `eval/frases.jsonl`.
4. Caché compartida (sustituir el LRU en memoria cuando haya varias réplicas) y revisión de cachés por persona.
5. La batería de varios turnos es débil para ventas y facturas: comprueba la forma de la respuesta, no las cifras. Añadir comprobaciones de contenido.

## 8. Mapa de ficheros grandes (candidatos a dividir)

| Fichero | Líneas | Qué hacer |
|---------|-------:|-----------|
| `drafts/catalog-builder.ts` | 871 | separar alta, familias, formatos, proveedores, PVP y archivar |
| `tools/tools.ts` | 783 | separar lecturas de stock, cálculo de pedidos y consultas por tipo |
| `agent/loop.ts` | 597 | límite de 600: vigilar; extraer la ejecución de planes |
| `tools/info.ts` | 591 | separar por tema (ventas, proveedores, almacén) |
| `drafts/builder.ts` | 577 | separar borradores por entidad |
| `analytics/analytics.ts` | 552 | una vista por fichero (ya hay carpeta) |
| `contract/index.ts` | 540 | separar tipos de respuesta |
| `drafts/writer-port.ts` | 450 | separar redacción por tipo de borrador |
| `skills/tareas.ts` | 434 | una habilidad por fichero |

## 9. Glosario

- **Jev**: el componente que interpreta la intención y decide actuar, preguntar o no entender.
- **Plan**: lo que se va a ejecutar (consulta, aclaración, borrador, aviso, respuesta general).
- **Borrador**: una acción propuesta, guardada hasta que la persona la confirma.
- **Aclaración**: pregunta del asistente con opciones o texto libre; la respuesta retoma la orden original.
- **Vía rápida / preroute**: atajos que se resuelven sin Jev, en orden fijo.
- **Rescate**: segundo intento con IA cuando Jev no entendió un mensaje nuevo.
- **Cuenta de análisis**: departamento del catálogo (Bebida, Comida, Menaje…); base del alcance por rol.
- **Modo pruebas**: el asistente no escribe en la base de datos; las pruebas y la batería lo usan.

## 10. Trampas conocidas

- La batería de producción prueba la app desplegada; para medir un cambio antes de desplegar, levantar la rama en
  local con `npx next dev -p 3100` y `BATERIA_URL=http://localhost:3100`.
- Las variables `NEXT_PUBLIC_*` no persisten entre comandos de una misma sesión de shell: usar un script que las fije.
- `next dev` regenera `AGENTS.md` y `next-env.d.ts`; restaurarlos antes de commitear.
- Las respuestas generales (`writer/assistant.ts`) dependen de la clave de la IA de apoyo; sin ella, el asistente
  pide aclaración en lugar de responder. Mirar la causa antes de tocar Jev.
- Un cambio en el catálogo de Jev (`jev/catalog/`) sube `CATALOG_VERSION`.
- La base de datos de producción no admite llamar funciones de la app con el rol de la API; para comprobar
  permisos, usar pgTAP en local.
