# Jev en el asistente: cómo está montado y cómo se amplía

Guía para trabajar en el asistente sin romperlo. Si cambias algo de lo que aquí se describe, actualiza
este documento en el mismo PR. El registro histórico de mediciones del catálogo está en
[CATALOGO_JEV.md](CATALOGO_JEV.md); lo que el asistente cubre pantalla por pantalla, en
[capacidades.md](capacidades.md).

## Qué es Jev y qué hace aquí

Jev es el modelo de TypeSafe (`@typesafe-ai/sdk`, `systemOne`). No escribe texto: contesta preguntas con
probabilidades calibradas:

| Tipo | Para qué | Devuelve |
| --- | --- | --- |
| `choice` | Elegir entre opciones (intención, operación, local, producto…) | opción, probabilidades, confianza |
| `noul` | ¿Es cierto esto? (¿la cantidad es del artículo?, ¿el borrador encaja?) | probabilidad de «sí» |
| `score` | Puntuar con una escala (urgencia de una sugerencia) | puntuación esperada |

Todas las preguntas de una llamada se contestan en paralelo: **añadir preguntas casi no cambia la
latencia**, así que se agrupan en una llamada. Cada pregunta es atómica (una cosa que una persona
juzgaría en segundos) y se combina en código.

Reparto de papeles (regla del proyecto):

- **Jev decide** qué se quiere y sobre qué (con su probabilidad).
- **El código calcula**: cifras con `decimal.js`, consultas a la base de datos, borradores.
- **La IA de apoyo** (`writer/assistant.ts`) solo reescribe o redacta, y siempre se valida.
- **Nada se guarda** sin que el usuario confirme el borrador. Los permisos los decide la base de datos.

## Mapa de ficheros

```
src/copiloto/
  jev/                      Todo lo de Jev
    client.ts                 Llamada a TypeSafe, caché por (modelo, catálogo, state, preguntas), errores
    catalog/                  Las preguntas. Cambiar un texto sube CATALOG_VERSION
      criteria.ts               Opciones de cada decisión (intents, herramientas, acciones, periodos…)
      labels.ts                 Cómo se enseña en español cada opción
      routing-questions.ts      Llamada nº 1: qué se quiere, sobre qué, dónde, cuándo
      review-questions.ts       Llamada nº 2: coherencia del borrador, urgencias, duplicados, plausibilidad
    gates/                    Umbrales
      thresholds.ts             act / ask por decisión (se pueden ajustar con GATE_<CLAVE>_ACT…)
      policy.ts                 Qué datos pide cada consulta u operación (requerido, opcional, irrelevante)
      gate.ts                   Aplicar un umbral: actuar, confirmar o preguntar
    request.ts                Prepara la llamada nº 1: trozos del mensaje, candidatos de producto, state
    interpret/                Respuestas de Jev → plan
      index.ts                  Fachada: seguridad, borrador pendiente, intención y reparto
      reading.ts                Base común: leer una respuesta, aplicar su umbral, armar aclaraciones
      products.ts               Qué productos (uno, una familia, o preguntar)
      query.ts                  Consultas
      action.ts                 Operaciones de stock (merma, traspaso, recepción, inventario)
      documents.ts              Operaciones de catálogo y sobre documentos existentes
  entities/signals.ts       Señales del texto sin Jev (continúa lo anterior, origen/destino, espacios…)
  agent/
    preroute.ts               Lo que se resuelve sin Jev, en orden de prioridad
    action-form.ts            Miniformulario cuando faltan varios datos
    loop.ts                   Orquesta un mensaje de principio a fin
```

## Recorrido de un mensaje

1. **Estado** (`loop.ts`): botón de seguimiento, formulario enviado, respuesta a una aclaración o mensaje
   nuevo.
2. **Comprensión** (`comprehension.ts`): si el mensaje depende de lo hablado, la IA lo reescribe; se
   descarta si inventa productos o locales.
3. **Sin Jev** (`preroute.ts`), el primero que contesta gana:
   1. comandos `/…`;
   2. órdenes de oficina (pagar factura, apuntar y validar salidas, PVP, condiciones de proveedor,
      categoría y alérgenos de un producto);
   3. respuestas escritas (temas que no lleva, pantallas, consumo, «sí» suelto, datos de ficha, última vez);
   4. temas de gestión dichos claramente y tareas;
   5. vía rápida de stock.
4. **Llamada nº 1** (`request.ts` + `catalog/routing-questions.ts`): intención, segunda lectura de la
   intención (autoconsistencia), herramienta u operación, local, destino, espacio, producto de cada trozo,
   si la cantidad es del artículo, periodo, motivo, seguimiento, inyección…
5. **Interpretación** (`interpret/`): cada decisión pasa su umbral. Por debajo de `ask` se pregunta; entre
   `ask` y `act`, depende del riesgo (leer contesta con lo más probable; escribir prepara el borrador
   marcado «revisar» o pregunta). **Cero adivinanzas en escrituras.**
6. **Aclaración o formulario**: si falta un dato, se pregunta; si la operación está clara y faltan dos o
   más, sale el miniformulario (`action-form.ts`).
7. **Ejecución**: consulta (`run-query.ts`, `tools/`), información de gestión (`tools/info*.ts`), tarea o
   borrador (`drafts/`).
8. **Llamada nº 2** (solo borradores que vienen de Jev): ¿el borrador encaja con lo pedido? En el
   catálogo, además, duplicados, sentido y precio plausible. Las órdenes de oficina no la hacen: se
   reconocen con reglas fijas y el documento sale de la base de datos.
9. **Confirmación** (`drafts/confirm.ts`): con la sesión del usuario y las mismas funciones de la base que
   las pantallas.

## Reglas que no se rompen

- **Cambiar un texto del catálogo sube `CATALOG_VERSION`** (en `catalog/criteria.ts`) y obliga a medir con
  Jev real (`npm run copiloto:eval`). La caché de decisiones se invalida sola.
- **Evidencia literal**: si el mensaje nombra tal cual un local o producto, basta menos seguridad (salvo
  en operaciones críticas, `policy.ts`).
- **Lo que decide el usuario manda**: una opción elegida en una aclaración o en el formulario se fuerza
  como certeza (`overrides`), siempre que siga siendo una opción válida.
- **Un atajo sin Jev solo cuando es inequívoco**: si hay un borrador o una pregunta pendiente, los atajos
  de consulta no actúan (la respuesta puede ser para eso).
- **Lo escrito por la IA vuelve a pasar por Jev** y solo se adopta si ahora se entiende.

## Cómo se amplía

### Una consulta nueva con Jev

1. Opción en `HERRAMIENTAS` (`catalog/criteria.ts`), descrita en inglés y con ejemplos en español entre
   comillas. Sube `CATALOG_VERSION`.
2. Herramienta en `tools/tools.ts` (`ToolName`) y su política en `gates/policy.ts` (qué datos pide).
3. Si se responde con datos de gestión (no de stock), en `INFO_TOOLS` y `tools/info*.ts`.
4. Etiqueta en `catalog/labels.ts`, tests con `FakeJev` y medición con Jev real.

### Una consulta sin Jev (frase inequívoca)

Una regla en `tools/info.ts` (`TOPICS`) o una respuesta en `agent/fixed-replies.ts`. Añade un test que
compruebe también lo que **no** debe entrar («¿qué facturas hay por pagar?» no es «paga la factura»).

### Una operación que interpreta Jev

1. Opción en `ACCIONES` (`criteria.ts`) y su política (`policy.ts`). Sube `CATALOG_VERSION`.
2. Interpretación en `interpret/action.ts` (stock) o `interpret/documents.ts` (catálogo o documentos).
3. Borrador en `drafts/` (tipo en `contract/index.ts`, esquema en `drafts/schemas.ts`).
4. Escritura en `drafts/writer-port.ts` (con la sesión del usuario) y en `dev/fixture-writer.ts`.
5. Confirmación en `drafts/confirm.ts`. Si es una operación de stock con varios datos, añádela al
   formulario (`action-form.ts`).

### Una orden sin Jev (frase inequívoca sobre un documento)

`agent/office-actions.ts` (reconocer la orden, nunca la pregunta) + `drafts/office-builder.ts`
(buscar el documento, preguntar si hay varios, borrador) + escritura y confirmación como arriba. No pide
coherencia a Jev (`needsCoherenceCheck` en `plans.ts`).

### Un umbral

En `gates/thresholds.ts`, con el motivo y la medición en un comentario. Para probar sin desplegar código:
`GATE_<CLAVE>_ACT=0.8` en el entorno.

## Pruebas y medición

| Qué | Cómo | Cuándo |
| --- | --- | --- |
| Tests con Jev simulado | `FakeJev([{ intent: "consultar", herramienta: "query_stock" }, …])`: un guion por llamada | Siempre (`npm run check`) |
| Conversaciones de prueba | `src/copiloto/eval/conversaciones.json` (pasa en `npm test`) | Al cambiar el flujo |
| Evaluación con Jev real | `npm run copiloto:eval` (frases con su respuesta esperada) | Al cambiar el catálogo o umbrales |
| Batería en producción | `scripts/ops/bateria-asistente.mjs` con la cuenta de pruebas | Antes y después de tocar el asistente |
| Producción | `copilot_audit`: resultado de cada mensaje, si fue atajo, decisiones y su puerta | Para decidir qué mejorar |

Consulta útil (solo lectura) para ver dónde se pregunta de más:

```sql
select d->>'id' as decision, d->>'gate' as puerta, count(*)
from copilot_audit a, jsonb_array_elements(a.decisions) d
where a.kind = 'mensaje' and a.outcome = 'aclaracion' and a.created_at > now() - interval '30 days'
  and d->>'gate' <> 'actuar'
group by 1, 2 order by 3 desc;
```

Medición del 13/11/2026 (30 días, incluye baterías de prueba): de los mensajes que pasan por Jev, el 44 %
acababa en una aclaración. Las más frecuentes: intención (143), producto (129), operación (89), consulta
(83) y local/destino (71). El miniformulario junta las de local, destino, producto y cantidad de una
operación clara.
