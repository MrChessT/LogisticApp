# Informe del asistente · 18 de noviembre de 2026 (versión 2)

Auditoría del asistente de LogisticApp (`src/copiloto` y el panel `src/components/copiloto`): cómo se usa de verdad,
cómo responde a preguntas nuevas, cuánto tarda, cómo está construido y por qué falla.

Esta versión integra una aportación externa sobre la eficiencia del asistente como herramienta de logística. Cada
afirmación de esa aportación se ha contrastado contra el código y los datos de producción (sección 6). El encargo
para ejecutar la mejora está en [PROMPT_MEJORA_ASISTENTE.md](PROMPT_MEJORA_ASISTENTE.md).

Sin datos del negocio: las cifras de la base de datos se dan como recuentos o proporciones, no como importes ni stock.
Las pruebas en producción fueron de solo lectura y no se confirmó ningún borrador.

---

## 1. Resumen

El asistente tiene dos problemas distintos, y conviene no confundirlos.

**A. El suelo: entender y dialogar.** Es lo que hoy se rompe y lo que hace que la gente se rinda.

- En uso real, **la mitad de las respuestas son preguntas de vuelta**. El 18 % de las conversaciones tiene bucles
  (3 o más aclaraciones seguidas; la peor, 20) y el 16 % acaba sin resolverse.
- **Ante preguntas nuevas acierta 4 de cada 10.** Prueba ciega, calificada a mano: 38 % bien, 25 % a medias, 38 % mal.
  La batería oficial da 86/86, y la evaluación de Jev, 218/220. Las dos miden frases conocidas, no la experiencia real.
- **El tema peor resuelto es el traspaso:** unos 73 de cada 90 mensajes de personas acaban en aclaración (81 %). La
  mayoría traen la frase completa: «pasa 2 cajas de coca cola del parador al vivero» duda del producto; «haz un
  traspaso de 10 cajas de heineken a parador de vivero» pregunta el destino.

**B. El techo: decidir la logística.** Es lo que haría que el asistente valga de verdad.

- Preguntar «qué pido» devuelve todo lo que cumple el filtro de reposición, no la decisión.
- Comprar y traspasar van por separado, con horizontes distintos (7 y 3 días).
- La ficha del proveedor solo se usa para avisar en el borrador, no para decidir qué entra hoy ni cuánto.
- Esta parte la trae la aportación, y es correcta en lo esencial.
- Hoy apenas se pregunta: en torno al 3 % de los mensajes de personas son de «pedir o reponer». Es una apuesta de
  producto, no la queja actual.

**La velocidad no es el problema.** Mediana de 0,5 s; el 90 % responde en menos de 1,7 s. Jev, en su llamada principal,
tiene una mediana de 118 ms.

**Recomendación:**

1. Medir de verdad (fase 0).
2. Arreglar el diálogo y los filtros (fases 1 y 2) sin tocar la arquitectura.
3. En paralelo, por ser código puro y aislado: unir comprar y traspasar con la ficha del proveedor (fase 4).
4. Después, sustituir las reglas de texto por un **intérprete con modelo de lenguaje** que rellene la misma petición
   tipada que hoy rellena Jev. Se prueba en sombra, sin tocar el flujo fijo ni las puertas de las escrituras (fase 3).

Esto corrige la versión 1 de este informe, que proponía un agente con herramientas que eligiera él mismo qué hacer.
Lo que falla es entender, no planificar. Un flujo fijo es lo que se puede auditar cuando se escribe stock.

---

## 2. Cómo se ha medido

| Fuente | Qué es | Qué mide |
|---|---|---|
| Auditoría de producción (`copilot_audit`) | 6.322 registros desde el 23/09: tipo de mensaje, resultado y decisiones de Jev | Uso real: aclaraciones, bucles, abandonos y temas |
| Opiniones (`copilot_feedback`) | 20 reportes de personas desde el panel | Qué molesta |
| Borradores (`copilot_drafts`) | 330 borradores: 14 confirmados, el resto pendientes | Si las operaciones llegan a buen puerto |
| Prueba ciega | 24 conversaciones y 78 turnos nuevos, escritos como los escribiría un encargado, sin mirar la batería (`scripts/ops/bateria-ciega.json`). Se pasó en producción, sin confirmar nada. La calificación (64 turnos con contenido) se hizo a mano: el juez automático aún no existe (fase 0) | Calidad ante lo desconocido |
| Batería oficial | 86 casos de `scripts/ops/bateria-asistente.json` | Regresiones y latencia |
| Evaluación de Jev ([EVALUACION.md](EVALUACION.md)) | 220 frases del catálogo | Si Jev clasifica bien sus propias frases |
| Código | Recorrido de un mensaje, reposición, borradores, redactor, sesión, umbrales | Estructura |
| Datos maestros | Proveedores con condiciones, productos con mínimo u objetivo por local | Si la decisión de logística tiene con qué trabajar |

Para separar a las personas de las pruebas se quitaron las cuentas de pruebas y los mensajes idénticos a los de las
baterías. El reparto por temas (sección 3.2) se hizo por palabras clave: es aproximado.

---

## 3. Resultados

### 3.1 Uso real

| Indicador | Valor |
|---|---|
| Conversaciones de personas | 104 (561 mensajes) |
| Respuestas que son una aclaración | **50 %** |
| Consultas respondidas | 18 % |
| Tareas, guías y conversación | 22 % |
| Borradores preparados | 7 % |
| Conversaciones con un bucle (3 o más aclaraciones seguidas) | **18 %** (racha máxima: 20) |
| Conversaciones que acaban en una aclaración sin resolver | **16 %** |
| Borradores confirmados | 14 de 330 (4 %) |

De dónde salen las aclaraciones:
- **378 las pide el propio asistente**, sin que ninguna decisión de Jev dude: el formulario de «me faltan datos»,
  «¿qué operación quieres registrar?» o «¿de cuál de estos productos?».
- **El resto, de dudas de Jev:** intención (70), producto (68), operación (31), local (26), consulta (24), zona (20) y
  coherencia del borrador (16).

El problema está sobre todo en el diseño del diálogo, no en los umbrales.

### 3.2 Por tema (mensajes de personas, aproximado)

| Tema | Mensajes | Acaban en aclaración |
|---|---|---|
| Traspasos | 90 | **73 (81 %)** |
| Stock | 88 | 14 (16 %) |
| Recepciones y albaranes | 28 | 13 (46 %) |
| Mermas | 29 | 22 (76 %) |
| Escandallos y márgenes | 25 | 6 (24 %) |
| Pedir y reponer | 23 | 9 (39 %) |
| Facturas | 12 | 8 (67 %) |
| Otros (saludos, órdenes sueltas, preguntas sin tema claro) | 451 | 196 (43 %) |

**Las escrituras son lo que peor va:**
- traspasos y mermas acaban en aclaración tres de cada cuatro veces;
- las consultas de stock, una de cada seis.

**Los traspasos, en detalle:**
- **Con la frase completa, aun así pregunta:** «pasa 2 cajas de coca cola del parador al vivero» (producto),
  «haz un traspaso de 10 cajas de heineken a parador de vivero» (destino), «quiero hacer un traspaso de parador a la
  oliva de 100 cocacolas» (formulario).
- **Las respuestas se acumulan:** «iniciar traspaso. a comida la oliva. traspaso. cocacola».
- **Le falta un dato de verdad:** «traspaso a vivero», «quiero hacer un traspaso de agua». Es la minoría.

### 3.3 Prueba ciega (64 turnos con contenido)

| Resultado | Turnos | % |
|---|---|---|
| Bien | 24 | 38 % |
| A medias (útil pero incompleto, o con una pregunta innecesaria) | 16 | 25 % |
| Mal (no responde lo pedido, se enreda o da cifras sin sentido) | 24 | 38 % |

| Tema | Resultado | Lo que falla |
|---|---|---|
| Stock (con seguimientos y erratas) | Casi todo bien | Aclaración innecesaria con un nombre exacto («coca cola») |
| Registrar en una frase completa (recepción, merma, inventario, alta, archivar) | Bien | — |
| Registrar por pasos («registra una merma» → «larios» → «2 botellas») | Mal | El formulario ignora lo escrito y vuelve a salir |
| Corregir un borrador («mejor que sean 4») | Mal | No existe |
| Pedidos | A medias | Ignora el proveedor dicho, o elige otro |
| Facturas y albaranes | Mal | Ignora el proveedor, la semana y el número de albarán |
| Gestión (proveedor más barato, mermas por local, stock parado) | Mal | Responde otra cosa o pregunta en genérico |
| Escandallos | Bien | «Peor margen» responde otra cosa; «cómo se hace» no da la ficha del plato |
| Equipo | A medias | «¿Qué permisos tiene Luis?» devuelve la lista de todos |
| Lo que no sabe hacer (proveedor nuevo, desarchivar, teléfono, quién lo creó) | Mal | Aclaración genérica o la lista entera de capacidades |
| «¿Cómo se hace…?» | Mal | Da datos en vez de explicar |
| Charla y fuera de ámbito | Bien | — |

Causas, por frecuencia:

| Causa | Turnos |
|---|---|
| Filtros ignorados | 6 |
| Lo escrito ignorado en un formulario | 4 |
| Falta la función | 4 |
| Aclaración genérica | 3 |
| Datos en vez de una explicación | 2 |
| Cifras imposibles | 2 |
| Segunda pregunta ignorada | 1 |
| Proveedor equivocado | 1 |
| Bucle de aclaración | 1 |
| Otras | 10 |

### 3.4 Latencia

| | Mediana | p90 | Máximo |
|---|---|---|---|
| Batería oficial (86) | 0,45 s | 1,0 s | 3,3 s |
| Prueba ciega (78) | 0,52 s | 1,7 s | 3,1 s |
| Jev, llamada principal (evaluación) | 0,12 s | 0,16 s | 0,45 s |

Lo lento es lo que pasa por la IA de apoyo o por varios pasos, entre 1,5 y 3 s. Un intérprete con modelo de lenguaje
añade una llamada (fase 3): hay que medirla y mantener la vía rápida para lo inequívoco.

### 3.5 Lo que dicen las personas

| Tema | Reportes |
|---|---|
| Bucles y preguntas de más («si le he dado la acción y los datos, no tiene sentido que vuelva a preguntar») | 7 |
| No entiende el producto («puse zero y leyó zero zero») | 3 |
| Formato y exceso de información («respuesta a lo que se pide, no información a mansalva») | 3 |
| Que pueda hacer todo lo de la app | 2 |
| «La IA detecta lo que quieres, pero se interpone Jev» | 1 |
| Traspaso con más cantidad que el stock, sin frenar | 1 |

### 3.6 Datos maestros para decidir la logística

| Dato | Estado | Consecuencia |
|---|---|---|
| Proveedores con días de pedido, hora límite, plazo y mínimo | 18 de 32 (56 %) | Para el resto hace falta un valor por defecto, y decir que falta |
| Producto por local con mínimo y objetivo | 1.079 de 3.484 (31 %) | Para el 69 % la reposición solo puede mirar el consumo, y lo que no tiene consumo apuntado no aparece |
| Stock y consumo | Hay valoraciones en negativo y productos de prueba | Las cifras imposibles salen en las respuestas sin aviso |

Con estos datos, una tarjeta de decisión perfecta en código seguiría proponiendo cosas raras. La calidad de la
decisión depende tanto de estos datos como de la fórmula.

**Completado el 18/11, con autorización expresa, en datos que se reiniciarán:**

- **Condiciones de proveedor: 30 de 32.**
  - «Proveedor prueba 01–08» reciben siempre martes y viernes: se piden lunes y jueves antes de las 12, con 24 h de
    plazo y 100 € de mínimo.
  - Los cuatro sin historial llevan condiciones genéricas: lunes, miércoles y viernes, 12:00, 24 h.
  - Las dos que faltan no son proveedores sino fuentes de precio: «Precio de referencia (estimado)» y «Precios de
    escandallo».
- **Niveles: 3.480 de 3.484 productos por local.** Se calculan desde el consumo de 28 días y se redondean a la unidad
  de recuento.
  - Mínimo: 4 días de consumo (plazo más días entre pedidos), al menos 1 unidad.
  - Objetivo: 8 días, y al menos una unidad por encima del mínimo.
- **Stock negativo: 0.** Había 4 saldos, uno de ellos de −5.594 litros de un tequila. Se llevaron a cero con
  `register_movement` como ajuste manual, con el usuario propietario: el stock solo cambia por funciones de la base de
  datos.

**Fallo encontrado al revisar los pedidos:** «Precio de referencia (estimado)», que no es un proveedor, tiene un pedido
de 168 líneas. El borrador de pedido elige el proveedor por el último precio de cada formato, y esa fuente de precio
gana. Se corrige en la fase 4.

### 3.7 El panel

Bien resuelto:
- la bienvenida con sugerencias según la pantalla;
- las tarjetas de «lo que puedo hacer»;
- el borrador con sus avisos y la confirmación explícita;
- la entrada de archivos (foto, PDF, Excel), voz y comandos `/`.

Lo que estorba:
- **La lista de capacidades** es un muro de texto y sale como respuesta de reserva.
- **El formulario de «me faltan datos»** aparece aunque los datos ya estén escritos.
- **No se puede corregir un borrador hablando.**
- **Se ven textos internos:** «Entiendo: «¿qué pedido quieres consultar?»» y «Revisa el producto: Coca-Cola» sin motivo.

---

## 4. Cómo está construido

El asistente ya es un **flujo fijo**: el camino está escrito en código. No es un agente que elija herramientas en un
bucle. Para escribir stock, es lo correcto, porque se puede auditar.

| Capa | Dónde | Qué resuelve | Qué no debe resolver |
|---|---|---|---|
| Panel | `src/components/copiloto` | Conversación, voz, archivos, tarjeta de borrador | Cifras y permisos |
| Entrada | `entities/jerga.ts`, `agent/document-turn.ts`, `agent/multi-task.ts` | Erratas, archivo leído, varias órdenes en una frase | Decidir |
| Atajos | `agent/preroute.ts`, `agent/office-actions.ts`, `agent/fixed-replies.ts`, `agent/topics.ts`, `agent/fast-path.ts` | Comandos, órdenes de oficina, respuestas fijas, temas por palabras clave, stock rápido. Gana el primero | Lo ambiguo |
| Jev | `src/copiloto/jev` | Una llamada con todas las preguntas del catálogo en paralelo: intención, producto, local… Otra, solo para revisar el borrador | Texto y aritmética |
| Puertas | `jev/gates/policy.ts`, `thresholds.ts` | Leer puede ir con lo probable. Escribir no se adivina: cerrar inventario exige 0,95 | Relajar una escritura crítica |
| Cálculo | `tools/tools.ts`, `skills/tareas.ts`, `drafts/` | Stock, reposición, pedido por proveedor, equilibrar locales, borradores | Interpretar el idioma |
| Redacción | `writer/writer.ts`, `writer/verifier.ts` | Plantilla, o modelo cuyas cifras deben existir en el informe | Inventar un número |
| IA de apoyo | `writer/assistant.ts`, AI Gateway | Preguntas generales de hostelería y reescritura de seguimientos, validadas | Datos del negocio |
| Verdad | Postgres, RLS, funciones de stock | Qué se puede ver y escribir | — |

Lo que hace que falle:

- **La comprensión se hace sumando reglas.** Hay unas 60 expresiones regulares en al menos 27 ficheros, repartidas en
  hasta 10 vías por las que puede pasar un mensaje antes de llegar a Jev, que es un clasificador de catálogo cerrado.
  Cada arreglo añade otra regla («albaranes» frente a «albariño», «Boj 570», «alabran»). Tapa ese caso y deja abiertos
  los parecidos.
- **No hay una tarea en curso.** La sesión (`agent/session.ts`) guarda 6 turnos recortados a 280 caracteres, el foco y
  la aclaración pendiente. No guarda un borrador activo editable ni datos a medio rellenar.
- **Las consultas no extraen filtros.** `tools/info.ts` elige la herramienta por palabras clave y casi nunca filtra.
- **En producción no hay búsqueda semántica ni redacción con modelo** (`WRITER_PROVIDER` y `EMBED_PROVIDER` en `none`,
  `config.ts:76`). Los productos se buscan por parecido de letras.
- **La auditoría no guarda la respuesta, la latencia ni la vía usada**, así que no se puede medir la calidad.

Lo que está bien y se conserva:
- los borradores con confirmación y validación (zod);
- los permisos en la base de datos (RLS, alcance por cuenta y local);
- las cifras con `decimal.js` y el verificador de números del redactor;
- las puertas de Jev para escribir;
- el registro de especialistas, la lectura de archivos y las pruebas.

---

## 5. La reposición hoy (contrastado en el código)

**`computeReorder`** (`tools/tools.ts:95-152`):
- **Media diaria:** salidas de 28 días (consumo, merma y ajustes negativos) entre 28. Los traspasos no cuentan.
- **Disponible:** stock más traspasos en camino más pedidos abiertos.
- **A pedir:** el máximo entre «cubrir el horizonte y quedar en el mínimo» y «llegar al objetivo».
- **Entra en la lista** si está bajo mínimo, o si no cubre el horizonte sin bajar del mínimo. Se ordena por cobertura.
- **Hallazgo nuevo:** la cobertura que ordena la lista y marca lo urgente se calcula con el stock sin lo que está en
  camino (`coverage = qty / avg`, línea 143), mientras que la cantidad sí lo cuenta. Un producto ya pedido puede salir
  como «urgente».

**La tarea `pedidos`** (`skills/tareas.ts:86-157`):
- usa un horizonte de 7 días, agrupa por local y proveedor y redondea a la caja de compra;
- marca como urgente lo que cubre menos de 3 días;
- da un resumen y un botón por local. El botón prepara el borrador con `catalog-builder`, que vuelve a calcular.

**La tarea `equilibrar`** (`skills/tareas.ts:161-262`):
- busca, con un horizonte de 3 días, un local que pueda ceder: por encima del objetivo, del mínimo más una semana o de
  una semana de consumo;
- es otra tarea, con otro horizonte, y el pedido no la tiene en cuenta.

**El borrador de pedido** (`drafts/catalog-builder.ts:587-712`):
- **sí lee la ficha del proveedor**, con `nextDelivery` y `minOrderShortfall` de `src/lib/supplier-terms.ts`, la misma
  lógica que la pantalla de Pedidos;
- pero solo para **avisar**: entrega prevista, «no admite pedidos hoy», «faltan X para el mínimo»;
- el horizonte sigue fijo en 7 días y un proveedor sin pedido hoy entra igual en el borrador.

Lo que falta: horizonte hasta la entrega siguiente, filtro por día de pedido, peso por día de la semana, consumo teórico
desde ventas y escandallo, trato aparte para lo perecedero y una forma de proponer mínimos donde no los hay.

---

## 6. Contraste con la aportación externa

| Afirmación de la aportación | Veredicto | Evidencia | Qué se adopta |
|---|---|---|---|
| El asistente es un flujo fijo, no un agente, y eso es lo correcto para escribir stock | **Correcta** | `agent/loop.ts`, puertas de `policy.ts` | Se adopta. Se retira de este informe el «agente que elige herramientas» |
| No sustituir el flujo por un agente que planifique; si hace falta desambiguar, que el modelo elija entre candidatos ya recuperados | **Correcta, y compatible con los datos** | Los fallos medidos son de comprensión y diálogo, no de planificación | La fase 3 pasa a ser un **intérprete**: el modelo rellena la petición tipada de Jev (`jev/request.ts`) y elige entre candidatos que recupera el código. Las cantidades solo pueden ser números que aparezcan en la frase |
| El cuello de botella es la eficiencia del encargado al decidir, no el precio ni la latencia | **Correcta a medias** | Latencia buena, de acuerdo. Pero el 50 % de aclaraciones y el 81 % en traspasos dicen que hoy lo que frena es entender; «pedir o reponer» es un 3 % de los mensajes | Dos problemas, en este orden: el suelo (entender y dialogar) y el techo (decidir). La decisión de logística es el diferenciador del producto, no la queja actual |
| La evaluación de 218/220 mide el idioma, no la decisión | **Correcta** | [EVALUACION.md](EVALUACION.md). Ni siquiera mide el idioma real: son frases del catálogo, y la prueba ciega da un 38 % | Batería de decisiones (aportación) más batería ciega (este informe), además de las dos que ya hay |
| `computeReorder` funciona como se describe (28 días, en camino, pedidos abiertos, mínimo y objetivo) | **Correcta** | `tools/tools.ts:95-152` | Se añade el fallo de la cobertura sin lo que está en camino (sección 5) |
| `pedidos`: 7 días, urgente bajo 3, por proveedor, caja de compra. `equilibrar`: puede ceder por encima del objetivo o del mínimo más una semana | **Correcta** | `skills/tareas.ts` | Se añade que los horizontes no coinciden (7 y 3 días) |
| `computeReorder` y `pedidos` no usan la ficha del proveedor | **Correcta a medias** | El borrador (`catalog-builder.ts:687-712`) ya la usa con `lib/supplier-terms.ts`, pero solo para avisar | El paso es más barato de lo que parece: la lógica de fechas existe y está probada. Falta usarla para decidir. Solo 18 de 32 proveedores tienen condiciones: hace falta un valor por defecto |
| Equilibrar debería ser el primer paso de pedir | **Correcta** | Dos tareas separadas | Se adopta (fase 4) |
| En un traspaso sin origen, poner primero el local que puede ceder; sin elección no hay borrador | **Correcta, pero es el caso menor** | La mayoría de aclaraciones de traspaso llegan con origen y destino dichos (3.2) | Se adopta dentro de la fase 1, después de que la frase completa funcione |
| Una consulta de stock intenta redactarse con el modelo si el redactor está activo | **Correcta en el código, sin efecto hoy** | `TEMPLATE_ONLY` en `writer.ts:17` no incluye las consultas; en producción el redactor está apagado | Se adopta como regla preventiva (fase 2): las consultas simples, siempre con plantilla |
| El historial es corto: 6 turnos de 280 caracteres | **Correcta** | `session.ts:101,193` | El remedio no es alargar el historial, sino la «tarea en curso» con estado (fase 1) |
| Umbral de 0,95 para cerrar inventario; tope de 40 candidatos en sugerencias | **Correcta** | `thresholds.ts:30`, `suggestions/engine.ts:38` | Sin cambios |
| Jev, mediana de 118 ms | **Correcta** | [EVALUACION.md](EVALUACION.md):5 | — |
| El límite de peticiones en memoria no es el problema de hoy | **Correcta** | — | Se deja para cuando haya varias instancias |
| Referencia a `INFORME_AUDITORIA.md` | **No existe en el repositorio** | — | No se cita |
| Precedentes del mercado (proveedores de software de restauración que exigen aprobación) | **No contrastado** | — | Se toma como contexto, no como evidencia. La regla de confirmar ya es del proyecto |

**Lo que la aportación no cubre y este informe añade:**
- el diálogo que no avanza (formularios, respuestas libres, corrección del borrador);
- las consultas que ignoran filtros;
- las funciones que faltan;
- las cifras imposibles en los datos;
- la poca cobertura de mínimos y condiciones;
- la medición del uso real.

Sin eso, la tarjeta de decisión llegaría a un usuario que ya se ha rendido en el segundo turno.

---

## 7. Causas raíz, por impacto

| # | Causa | Síntomas | Impacto |
|---|---|---|---|
| R1 | Diálogo sin «tarea en curso»: lo escrito no rellena lo pendiente, las respuestas libres no casan con las opciones, el borrador activo no se edita, las frases se encadenan | Bucles, abandono, «mejor que sean 4», traspasos con la frase completa que acaban en aclaración | Muy alto |
| R2 | Comprensión por reglas de texto y un clasificador de catálogo cerrado | Respuestas distintas según cómo se escriba; aclaraciones genéricas; confusiones de producto | Muy alto |
| R3 | Las consultas no extraen filtros (proveedor, fechas, número, persona, local) | «¿Cuánto le debo a Makro?» da el total de todos | Alto |
| R4 | La reposición entrega una lista, no una decisión: comprar y traspasar separados, horizonte fijo, ficha del proveedor solo para avisar, cobertura que no cuenta lo que está en camino | El encargado sigue planificando a mano | Alto (diferenciador) |
| R5 | Medición engañosa: baterías ajustadas, auditoría sin respuesta ni latencia, sin batería de decisiones | Se cree que va bien | Alto (impide mejorar) |
| R6 | Datos maestros incompletos y sucios. Antes del 18/11: 31 % de productos con niveles y 56 % de proveedores con condiciones. Ya completado (3.6), pero sin defensas en el código: fuentes de precio tratadas como proveedores y cifras imposibles sin aviso | Reposición pobre y cifras imposibles sin aviso | Medio |
| R7 | Huecos funcionales: crear proveedor, desarchivar, quién hizo qué, contacto, guías «cómo se hace», comparativas | «No sé», o peor: otra cosa | Medio |
| R8 | Sin búsqueda semántica en producción | «zero» frente a «zero zero» | Medio |
| R9 | Respuestas de reserva malas: lista de capacidades o «fuera de ámbito» | Sensación de que no escucha | Medio |

---

## 8. Arquitectura objetivo

Se mantiene el flujo fijo. Cambia la pieza que entiende y se añade la que decide.

```
Panel ─► Entrada (jerga, archivo leído, TAREA EN CURSO: borrador activo y campos que faltan)
           │
           ▼
     Vía rápida (código): comandos y frases inequívocas, p. ej. «cuántas cocas quedan en el vivero» → stock al instante
           │ si no es inequívoca
           ▼
     Intérprete (modelo de lenguaje, una llamada, salida con esquema)
       · rellena la MISMA petición tipada que hoy rellena Jev (jev/request.ts): intención, operación, productos,
         cantidades, locales, filtros, periodo
       · productos y locales: elige entre candidatos que recupera el código (catálogo, alcance del usuario)
       · cantidades: solo números que aparecen en la frase (se comprueba, como el verificador del redactor)
       · se prueba en sombra frente a las reglas y Jev; se activa por tipo de mensaje cuando gana
           │
           ▼
     Puertas (Jev o umbrales): leer puede ir con lo probable; escribir no se adivina. Sin cambios
           │
           ▼
     Código: consultas con filtros · decisión de reposición (traspasar antes que comprar, día de pedido, entrega,
             mínimo, caja) · borradores · validadores de cifras · RLS
           │
           ▼
     Respuesta: plantilla para las consultas simples; modelo solo para explicar una decisión, con verificador.
                Corta: cifra o decisión, tabla breve y de 1 a 3 botones
```

Principios:

1. **Nada se guarda sin confirmar.**
2. **Las cifras las calcula el código.** El modelo no escribe un número que no venga de una herramienta o de la frase.
3. **Una sola aclaración por dato**, con la opción recomendada primero. Lo que se escriba después rellena el hueco.
4. **Lo que no se puede hacer, se dice**, con el sitio de la app donde se hace.
5. **La pregunta simple sigue siendo instantánea:** ni el intérprete ni el redactor se ponen delante de la vía rápida.
6. **Se mide en ciego y con decisiones**, no solo con frases conocidas.

Encaja con la regla del proyecto: «Jev decide y el código calcula; la IA solo interpreta o redacta, validada». El
intérprete interpreta, sus salidas se validan y las puertas siguen decidiendo. No hace falta cambiar la regla, solo
precisar en [JEV.md](JEV.md) que la interpretación puede venir del modelo.

---

## 9. Decisiones

Tomadas el 18/11:

1. **Gasto medio en el intérprete: Claude Sonnet 5.5** (`claude-sonnet-5-5`), por el AI Gateway.
   - **Por qué este nivel.** A precios actuales (por millón de tokens: Haiku 5.5 a 0,10/0,50 $, Sonnet 5.5 a
     2/10 $ y Opus 5.5 a 4/20 $), un mensaje de unos 3.000 tokens de entrada y 300 de salida cuesta unos
     0,0005 $, 0,009 $ y 0,018 $. Sonnet es el nivel medio.
   - **Coste real.** Con la parte fija del prompt en caché (catálogo resumido, reglas), queda por debajo de un
     céntimo por mensaje. Solo pasa por el intérprete lo que la vía rápida no resuelve.
   - **Configuración.** Esfuerzo bajo, salida con esquema y tope de 1.500 tokens de salida.
   - **Respaldo.** Haiku 5.5 si falla o se pasa de tiempo. Si los dos fallan, el camino actual.
   - **Presupuesto.** Objetivo de 1 céntimo por mensaje de media; tope de 3 céntimos. Se mide en la auditoría
     (fase 0).
2. **Datos maestros:** completados directamente en producción, sin pasar por borradores, porque los datos se
   reiniciarán (sección 3.6). El código de la fase 4 tiene que seguir funcionando cuando falten, con valores por
   defecto y avisos.
3. **Limpieza:** hecha la del stock negativo. Quedan los productos «PRUEBA-VOL», las dos fuentes de precio tratadas
   como proveedores y los artículos del TPV sin enlazar; se pueden limpiar en el reinicio.

Pendiente:

4. **Qué no se hará desde el chat.** Hoy: invitar personas y cambiar permisos.

---

## 10. Plan por fases (resumen)

El detalle, con criterios de aceptación, está en [PROMPT_MEJORA_ASISTENTE.md](PROMPT_MEJORA_ASISTENTE.md).

| Fase | Qué | Criterio de salida |
|---|---|---|
| 0 | Medición: auditoría completa, indicadores, juez y conjunto ciego, y batería de decisiones con datos sintéticos | Línea base repetible |
| 1 | Diálogo: tarea en curso, editar el borrador activo, una aclaración por dato con la opción recomendada, frases completas de escritura sin aclarar | Ciega sin bucles; aclaraciones ≤ 20 %; traspasos y mermas con la frase completa sin aclaración |
| 2 | Consultas con filtros y preguntas dobles; plantilla obligatoria en consultas simples | Ningún filtro ignorado |
| 3 | Intérprete con modelo, en sombra, que rellena la petición tipada | Ciega ≥ 85 % bien; p90 < 3 s; ninguna cantidad inventada |
| 4 | Decisión de reposición: traspasar antes que comprar, horizonte hasta la entrega, día de pedido, mínimo, cobertura correcta, tarjeta de excepciones (puede ir en paralelo a la 1) | Batería de decisiones al 100 %; un turno hasta el borrador |
| 5 | Huecos funcionales | Cada hueco con su prueba |
| 6 | Datos: avisos de cifras imposibles, propuestas de niveles y condiciones, búsqueda semántica | Ninguna cifra imposible sin aviso; producto correcto ≥ 95 % |
| 7 | Panel y parte de apertura | Aclaraciones < 15 %; abandono < 5 %; borradores confirmados > 50 % |
