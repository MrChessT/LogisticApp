# Asistente por especialistas

Plan para que el asistente se pueda ampliar sin que crezca un fichero gigante: un especialista por dominio, con
sus herramientas, sus textos y sus pruebas, y un enrutador que decide quién atiende cada mensaje. Los permisos
los aplica el código según el perfil de la persona (ver [../roles.md](../roles.md)).

## 1. Estado actual (auditoría)

Tamaño de `src/copiloto` (sin tests): unas **19.500 líneas**. Los ficheros mayores:

| Fichero | Líneas | Qué mezcla |
|---------|-------:|-----------|
| `drafts/catalog-builder.ts` | 871 | alta de productos, familias, formatos, proveedores y PVP en un solo constructor |
| `tools/tools.ts` | 783 | herramientas de inventario, cálculo de pedidos y lecturas de stock |
| `agent/loop.ts` | 597 | orquestación completa del mensaje |
| `tools/info.ts` | 591 | respuestas de gestión (ventas, proveedores, almacén) |
| `drafts/builder.ts` | 577 | borradores generales |
| `analytics/analytics.ts` | 552 | vistas de informes |
| `contract/index.ts` | 540 | contrato de respuestas |
| `drafts/writer-port.ts` | 450 | redacción de borradores |
| `skills/tareas.ts` | 434 | tareas (pedidos, traspasos, mermas) |

Lo que ya está bien separado: `jev/` (catálogo de preguntas, interpretación, puertas), `agent/preroute.ts`
(vías rápidas en orden), `analytics/` (cada vista de informe), `drafts/` por entidad (`*-builder.ts`).

Lo que no: las herramientas y los borradores están separados **por tipo** (lectura, borrador), así que añadir
un dominio nuevo obliga a tocar cinco o seis sitios. Y los permisos no se aplican por dominio: todo el asistente
puede llamar a cualquier herramienta que el usuario tenga en la base.

## 2. Línea base (antes de cualquier cambio)

Batería contra producción (`scripts/ops/bateria-asistente.mjs`, cuenta de pruebas): **62 de 67** respuestas
correctas. Los cinco fallos, para atacar en este orden:

1. **Archivar un producto sin nombre** («quiero archivar un producto»): debe preguntar «¿Qué producto quieres archivar?».
   Hoy responde «¿A qué producto te refieres con «un producto»?».
2. **Archivar con el nombre escrito** («Coca-Cola 20 cl»): debe ofrecer el borrador con «Revísalo y confírmalo» o
   «No encuentro». Hoy vuelve a preguntar.
3. **Asociar proveedor desde el chat** («el proveedor de Tónica Schweppes 20 cl es Bebidas Mar Menor»): debe
   terminar en borrador con «Revísalo y confírmalo», «ya es proveedor», «No encuentro» o pregunta por el formato.
4. **Seguimiento de stock** («¿cuánto se gastó de eso la semana pasada?»): la respuesta no debe citar
   «N productos» ni «y N más» (lista de más de lo pedido).
5. **Erratas** («kuanto ron ai en la oliva»): debe responder «Stock de ron en La Oliva». Hoy no entiende la frase.

## 3. Diseño objetivo

```
mensaje ──► enrutador (preroute + clasificador de dominio)
              │
              ├─► especialista «almacén»    ─┐
              ├─► especialista «catálogo»   ─┤  cada uno con:
              ├─► especialista «compras»    ─┤  · herramientas de lectura
              ├─► especialista «escandallos»─┤  · borradores (solo se guardan confirmados)
              ├─► especialista «informes»   ─┤  · respuestas (plantillas con cifras del código)
              └─► especialista «equipo»     ─┘  · pruebas propias (casos de la batería)
                              │
                 núcleo compartido: bucle, contrato, seguridad, caché, auditoría
```

Reglas:

- **El especialista declara lo que puede hacer** en un único manifiesto: dominio, perfiles que lo usan,
  herramientas, borradores y casos de prueba. El enrutador solo mira el manifiesto.
- **Los permisos los aplica el código, no el texto del mensaje.** Si el perfil no tiene la cuenta o el
  permiso, la herramienta no se ofrece: el modelo no puede pedirla aunque la nombre.
- **Las cifras siguen saliendo del código**; la IA solo interpreta o redacta, como hoy.
- **Un especialista no importa a otro.** Si dos dominios necesitan lo mismo, va al núcleo.
- **Cada cambio pasa la batería antes y después** y añade un caso por cada fallo que arregle.

El registro, el mapa y la puerta ya existen (sección 4). Lo siguiente es mover el código a cada especialista,
uno cada vez, empezando por el que menos toca: **informes** (ya tiene vistas separadas).

## 4. Lo que ya está construido

`src/copiloto/especialistas/`:

| Fichero | Qué hace |
|---------|----------|
| `registro.ts` | Manifiesto de cada especialista: `id`, `nombre`, `descripcion`, `requiere` (rol mínimo y «ve costes»), `sinPermiso` (texto para quien no cumple) y `ejemplos` (frases reales). Nueve especialistas: almacén, compras, facturas, escandallos, ventas, catálogo, equipo, informes y conversación. |
| `mapa.ts` | `especialistaDe(plan)`: qué especialista atiende cada plan. Los mapas son **exhaustivos por tipo** (herramientas de Jev, temas de información, acciones, órdenes de oficina y tareas): una herramienta nueva sin especialista **no compila**. |
| `puerta.ts` | `fueraDeAlcance(plan, ctx)`: antes de ejecutar una lectura, comprueba el permiso del especialista y, si no se cumple, devuelve un aviso sin cifras. Los borradores siguen comprobando su permiso en su constructor, con el mensaje de la acción. |

En el bucle (`agent/loop.ts`, `execute`): la puerta va antes de ejecutar cualquier plan, y cada mensaje atendido se
cuenta por especialista (`metrics.especialistas`, visible en el resumen de métricas). Las reglas de permiso son
las mismas que las del menú de la app, así que el asistente no ofrece lo que la pantalla esconde.

Pruebas: `especialistas/especialistas.test.ts` (registro, mapa y puerta) y
`__tests__/especialistas-agente.test.ts` (el mismo mensaje de facturas para personal y para un encargado).

### Cómo se añade un especialista

1. Añadir su `id` a `ESPECIALISTAS` y su manifiesto a `REGISTRO` (con `sinPermiso` si tiene requisitos).
2. El compilador marcará en `mapa.ts` qué herramientas, acciones u órdenes hay que asignarle o reasignar.
3. Añadir sus casos a `scripts/ops/bateria-asistente.json` y pasar la batería antes y después.
4. Documentarlo aquí y en `PROYECTO_ASISTENTE.md`.

## 5. Orden de trabajo (lo que queda)

1. ~~Arreglar los fallos de la línea base~~: hecho, 70/70 en producción.
2. ~~Registro de especialistas, mapa exhaustivo, puerta y métricas~~: hecho.
3. **Mover el código a cada especialista**: extraer informes, después almacén, después catálogo (dividiendo
   `catalog-builder.ts`), de modo que cada carpeta tenga sus herramientas, borradores, textos y pruebas.
4. **Alcance por cuenta de análisis y local** (`roles.md`, fase 5): añadir al manifiesto las cuentas que usa
   cada especialista y filtrar las cifras por cuenta y local en el origen de datos.
5. ~~**Evaluación del enrutador**~~: hecho. Cada respuesta lleva su especialista en el evento `decision`, y los
   turnos de `scripts/ops/bateria-asistente.json` con `"especialista"` lo comprueban; la batería imprime
   «Enrutado: X/Y» por especialista. Avisos: por la ruta de su pantalla. Aclaraciones: por la acción o la
   herramienta que Jev ya eligió. Estado: 45/45.

Para cada paso: `npm run check`, batería antes y después, y documento actualizado en el mismo cambio.

## 6. Ideas consideradas

Fuentes consultadas (todas de práctica profesional, no de estudios revisados por pares):

- Enrutamiento por especialista con un clasificador antes del agente general: [Intent Recognition and Auto-Routing in Multi-Agent Systems](https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa). Lo adoptamos: el enrutador ya existe (`preroute.ts`); lo que cambia es que decide por manifiesto.
- Contextos aislados por función de trabajo, no por tipo de capacidad: [Best practices for mastering AI agents, subagents, skills & MCP](https://foojay.io/today/best-practices-for-working-with-ai-agents-subagents-skills-and-mcp/). Lo adoptamos: dominio = función (almacén, compras…).
- Permisos aplicados en código, con mínimo privilegio: [AI Agent Tool Use Best Practices for Practitioners](https://mlflow.org/articles/ai-agent-tool-use-best-practices-for-practitioners/). Lo adoptamos: la herramienta no ofrecida no se puede pedir.
- Un enrutador dedicado es más fiable que dejar que un LLM general detecte la intención: mismas fuentes. Lo adoptamos en parte: el enrutador sigue siendo código y reglas, y la IA solo ayuda en los casos ambiguos (rescate).
- Gobierno del tiempo de ejecución: las capacidades no deben saltarse los permisos por venir de un plugin o un subagente. [Agentao: a policy-governed runtime harness](https://arxiv.org/html/2608.13574v2). Lo adoptamos como principio: no hay herramientas «internas» sin permiso.
- Evaluación del enrutador con frases etiquetadas y medida de aciertos: [Production-Ready LLM Agents: offline evaluation](https://towardsdatascience.com/production-ready-llm-agents-a-comprehensive-framework-for-offline-evaluation/). Lo adoptamos en el paso 5.

Descartado por ahora: un agente general que decide todo (más coste y menos control de permisos), y una base
vectorial para elegir herramientas (con menos de 100 herramientas, un manifiesto explícito es más claro).
