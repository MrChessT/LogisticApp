# Prompt de mejora del asistente, por fases (versión 2)

Encargo para ejecutar la mejora del asistente de LogisticApp por fases, con criterios de aceptación medibles. Parte del
diagnóstico de [INFORME_ASISTENTE_2026-11.md](INFORME_ASISTENTE_2026-11.md); léelo entero antes de empezar, sobre
todo las secciones 5 (reposición), 6 (contraste) y 8 (arquitectura objetivo). Sustituye al encargo anterior de
[PROYECTO_ASISTENTE.md](PROYECTO_ASISTENTE.md).

Hay que resolver dos problemas, en este orden:

1. **El suelo: entender y dialogar.** Hoy la mitad de las respuestas son preguntas de vuelta. Los traspasos acaban en
   aclaración un 81 % de las veces, incluso con la frase completa.
2. **El techo: decidir la logística.** «Qué pido» tiene que devolver la decisión (traspasar antes que comprar, el día
   de pedido correcto, en la caja correcta) y el borrador listo para confirmar, no una lista.

Lo que no cambia: el asistente sigue siendo un **flujo fijo**, no un agente que planifique. El código calcula, las
puertas deciden si se actúa o se pregunta, y nada se guarda sin confirmación.

---

## 0. Cómo trabajar (para todas las fases)

1. **Lee antes de tocar nada:** [docs/ARQUITECTURA.md](../ARQUITECTURA.md), [JEV.md](JEV.md),
   [ESPECIALISTAS.md](ESPECIALISTAS.md), [CONVERSACIONES.md](CONVERSACIONES.md), [EVALUACION.md](EVALUACION.md) y
   [CLAUDE.md](../../CLAUDE.md).
2. **Una fase, una rama y un PR.** La fase 4 puede ir en paralelo a la 1 y la 2: toca otros ficheros
   (`tools/`, `skills/tareas.ts`, `drafts/catalog-builder.ts`). El resto, en orden.
3. **Antes de dar una fase por terminada, pasa todo esto:**
   - `npm run check`: lint, tipos, knip, tamaño de ficheros, tests y build.
   - `scripts/ops/bateria-asistente.json`, antes y después. Cada fallo que arregles añade un caso.
   - `scripts/ops/bateria-ciega.json`, con el juez de la fase 0. **No se ajusta a sus resultados.** Si un caso falla,
     se arregla el sistema, no el caso, y el caso arreglado se copia a la batería normal.
   - La batería de decisiones de la fase 0, desde que exista.
   - Si cambias la base de datos: migración numerada, test pgTAP y `database.types.ts`.
   - Si cambias el catálogo de Jev: sube `CATALOG_VERSION` y mide con Jev real, como fija [JEV.md](JEV.md).
4. **No se declara una mejora sin compararla** con la línea base de la fase 0, con la misma métrica.
5. **Reglas del negocio** (de CLAUDE.md):
   - nada se guarda sin confirmación;
   - cantidades y dinero con `decimal.js`;
   - los permisos los decide la base de datos;
   - `stock_movements` es inmutable.
6. **Sin datos del negocio en el repositorio:** los casos usan nombres genéricos y los datos de prueba son sintéticos.
   Sin claves con `NEXT_PUBLIC_`.
7. **Producción:** solo lectura, con la cuenta en modo pruebas. Las migraciones, solo con
   `scripts/ops/aplicar-migracion.sh`.
8. **Documentación en el mismo PR que el código.** Los planes ya ejecutados van a `docs/historico`.
9. **Idioma:** respuestas y comentarios en español; los comentarios explican el porqué.

---

## Fase 0. Medir de verdad

**Problema.** La batería da 86/86, Jev da 218/220 y la experiencia real es de un 38 % bien. La auditoría no guarda la
respuesta, la vía ni la latencia. Nada mide si la decisión de logística es buena.

**Qué hacer.**

- **Auditoría completa.** Cada turno registra en `copilot_audit`:
  - la respuesta (recortada) y la vía que la produjo (`preroute`, `fast-path`, `office`, `jev`, `interprete`,
    `rescate`…);
  - el especialista y la latencia total y por etapa;
  - si fue una aclaración, y sobre qué campo;
  - si el siguiente mensaje fue una corrección, un «olvídalo» o una repetición.

  Migración numerada, pgTAP y tipos.
- **Indicadores** para la administración, en una pantalla de diagnóstico, sobre los últimos 30 días:
  - porcentaje de aclaraciones, en total y por tema;
  - conversaciones con bucle (3 o más aclaraciones seguidas) y conversaciones sin resolver;
  - borradores preparados y confirmados, por tipo;
  - latencia p50 y p90 por vía.
- **Juez para la prueba ciega.** `scripts/ops/bateria-ciega.json` (24 conversaciones, 78 turnos) se pasa con el
  runner de la batería y se califica con una rúbrica fija (bien, a medias, mal y la causa), escrita en
  [EVALUACION.md](EVALUACION.md). El juez es un modelo y se calibra con al menos 30 turnos calificados a mano.
  Además, 40 turnos nuevos de reserva, que solo se miran al cerrar cada fase.
- **Batería de decisiones**, al lado de la de frases:
  - **Formato.** Datos sintéticos (locales, productos, consumo, mínimos, proveedores con y sin condiciones) que se
    pasan a `computeReorder`, a las tareas y a los constructores de borradores, como el resto de tests de
    `src/copiloto`.
  - **Qué comprueba cada caso:** traspasar antes que comprar; la caja de compra correcta; no pedir a un proveedor que
    hoy no admite pedidos; respetar el pedido mínimo; que lo ya pedido no salga como urgente; ningún borrador sin
    elección cuando falta el origen.
  - **Al empezar,** casi todos estos casos fallan: es la línea base de la fase 4.
- **Línea base publicada** en [EVALUACION.md](EVALUACION.md), con fecha.

**Criterios de aceptación.**

- El 100 % de los turnos nuevos tiene todos los campos de auditoría.
- Los indicadores salen con datos reales.
- Dos pasadas seguidas del juez no varían más de 2 puntos.
- La batería de decisiones existe, se ejecuta en `npm test` y su línea base está documentada.

---

## Fase 1. Un diálogo que avanza

**Problema.**
- El formulario de «me faltan datos» ignora lo que se escribe después.
- Las respuestas libres a una aclaración se acumulan en una frase cada vez más larga: «iniciar traspaso. a comida la
  oliva. traspaso. cocacola».
- El borrador no se puede corregir («mejor que sean 4»).
- Frases completas como «pasa 2 cajas de coca cola del parador al vivero» acaban en aclaración.
- 378 aclaraciones las pide el propio asistente, sin que Jev dude.

**Qué hacer.**

- **Tarea en curso.** La sesión (`agent/session.ts`) guarda la tarea: tipo, campos rellenos, campos que faltan y
  borrador activo. Lo que se escribe después rellena el primer campo que falta. No se concatena con el mensaje
  anterior ni vuelve a empezar.
- **Respuesta libre a una aclaración.** Se intenta casar primero con el campo que falta. Si no casa, se pregunta una
  vez más con opciones. Después se resuelve con lo que haya, o se dice qué falta en una frase.
- **Una aclaración por dato, con la opción recomendada primero.**
  - En un traspaso sin origen, el primer botón es el local que puede ceder sin bajar del objetivo (la lógica de
    `equilibrar`), con el motivo. Los demás locales van después.
  - Sin pulsar, no hay borrador. Recomendar no es actuar.
- **Las frases completas de escritura no se aclaran.** Una frase con operación, producto, cantidad y locales (traspaso,
  merma, recepción) llega al borrador sin preguntar, salvo duda real de producto. «De parador a la oliva» y «a parador
  de vivero» se entienden en cualquier orden.
- **Corregir el borrador activo.** «Mejor que sean 4», «cámbialo a Parador» o «quita la de zero» modifican el borrador
  pendiente y lo vuelven a mostrar. Nunca crean uno nuevo.
- **Nombres exactos.** Un producto del catálogo escrito tal cual («coca cola», «Boj 570 Albariño») no provoca una
  aclaración de producto.
- **Salir.** «Olvídalo», «cancela», «nada» y «no» cierran la tarea en curso sin preguntar.
- **Pedido o traspaso.** «Quiero pedir 3 cocacolas y 3 larios» es un pedido, no un traspaso: pregunta el local una vez,
  o usa el local activo.

**Criterios de aceptación.**

- Prueba ciega sin bucles.
- Uso real tras una semana:
  - aclaraciones como mucho en el 20 % de las respuestas;
  - traspasos y mermas como mucho en el 30 %, desde el 81 % y el 76 % actuales;
  - como mucho un 8 % de conversaciones sin resolver.
- La batería normal tiene al menos 10 casos de corrección de borrador, 10 de traspasos y mermas con la frase completa,
  y 5 de respuesta libre a un formulario. Todos pasan.
- Ningún borrador nace sin elección cuando faltaba un dato de escritura (batería de decisiones).

---

## Fase 2. Consultas que respetan los filtros

**Problema.**
- Casi todas las consultas de `tools/` devuelven el listado general aunque la frase traiga un proveedor, una persona,
  un número, una semana o un local.
- Las preguntas de dos partes se responden a medias.
- Las consultas simples pasarían por el redactor con modelo si se activara.

**Qué hacer.**

- **Filtros declarados.** Cada herramienta de consulta declara qué filtros admite y de qué tipo: proveedor, persona,
  número de documento, desde y hasta, local, zona, categoría, estado. Se rellenan desde la petición, con las fechas de
  `entities/` («la semana pasada», «este mes»).
- **Filtro no admitido, dicho.** Por ejemplo: «En facturas no puedo filtrar por zona; las veo por proveedor o por
  fecha». No se devuelve todo.
- **Documento por número.** «El albarán A-4356» lo busca, o dice que no existe.
- **Preguntas dobles.** Se responden las dos partes, o se dice cuál no se puede responder.
- **Personas.** «¿Qué permisos tiene Luis?» devuelve solo a esa persona.
- **Plantilla en las consultas simples.** `query_stock`, `query_prices` y `query_product` se añaden a `TEMPLATE_ONLY`
  en `writer/writer.ts`, aunque haya un redactor activo. La vía rápida no se alarga.
- **Pruebas:** un test por herramienta y filtro admitido, y un caso de batería por filtro.

**Criterios de aceptación.**

- Ningún filtro pedido se ignora en la prueba ciega.
- Las preguntas dobles se responden enteras en al menos el 90 % de los casos.
- Las consultas simples nunca pasan por el proveedor de texto: lo comprueba un test.

---

## Fase 3. Intérprete con modelo de lenguaje, en sombra

**Problema.** La comprensión se hace con unas 60 expresiones regulares en al menos 27 ficheros, repartidas en hasta
10 vías, más un clasificador de catálogo cerrado. Cada arreglo es otra regla, y la parte larga de lo que dice la gente
nunca se cubre.

**Qué hacer.** No es un agente: no planifica ni encadena herramientas.

- **Una llamada con salida estructurada.** Un modelo de lenguaje rellena la **misma petición tipada** que hoy rellenan
  las reglas y Jev (`jev/request.ts`): intención, operación, productos, cantidades, unidades, locales, filtros y
  periodo. La salida se valida con zod.
- **Candidatos del código.**
  - Para productos, locales, proveedores y personas, el código recupera antes los candidatos dentro del alcance del
    usuario, y el modelo elige entre ellos.
  - Si ninguno encaja, devuelve «ninguno» y se aclara.
- **Cantidades comprobadas.** Una cantidad solo es válida si su número aparece en la frase o en la tarea en curso. Se
  comprueba como en `writer/verifier.ts`.
- **Las puertas no cambian.** La petición pasa por las mismas puertas (`jev/gates`): leer puede ir con lo probable;
  escribir no se adivina.
- **En sombra.**
  - Con `COPILOTO_INTERPRETE=sombra`, el intérprete corre en paralelo y solo registra su petición en la auditoría.
  - Se compara turno a turno con la petición actual, y la prueba ciega se pasa con los dos.
- **Activación por tipos.**
  - Primero las consultas, después las escrituras. Se activa un tipo solo cuando gana en la comparación.
  - La vía rápida sigue delante para lo inequívoco.
- **Retirar reglas.** Cada vía o expresión regular que el intérprete cubre se borra en el mismo PR que lo activa.
  Objetivo: menos de la mitad de las reglas actuales al terminar la fase.
- **Modelo y coste (decidido: gasto medio).**
  - **Modelo:** Claude Sonnet 5.5 (`claude-sonnet-5-5`) por el AI Gateway, con esfuerzo bajo, salida con esquema y la
    parte fija del prompt (reglas, catálogo resumido) en caché.
  - **Respaldo:** Claude Haiku 5.5 (`claude-haiku-5-5`) si falla o se pasa de tiempo. Si los dos fallan, el camino
    actual.
  - **Presupuesto:** objetivo de 1 céntimo por mensaje de media; tope de 3 céntimos.
  - **Auditoría:** coste, modelo y latencia de cada llamada.
  - **Comparación:** si Haiku 5.5 empata con Sonnet en la prueba ciega dentro del margen del juez, se usa Haiku.
    Cuesta unas 20 veces menos.
- **Documentación.** Se precisa en [JEV.md](JEV.md) y en CLAUDE.md que la interpretación puede venir del modelo. La
  regla «Jev decide y el código calcula» no cambia.

**Criterios de aceptación.**

- En sombra: al menos 500 turnos reales o 3 pasadas de la prueba ciega, con la comparación publicada.
- Con el intérprete activo, en la prueba ciega:
  - al menos el 85 % de los turnos, bien;
  - 0 bucles;
  - ninguna cantidad que no esté en la frase.
- Latencia: p90 por debajo de 3 s en consultas no inequívocas. La vía rápida no empeora.
- La batería de escrituras sigue sin ningún borrador equivocado.
- El número de expresiones regulares de comprensión baja al menos a la mitad.

---

## Fase 4. La decisión de reposición (puede ir en paralelo a la 1)

**Problema.**
- «Qué pido» devuelve todo lo que cumple el filtro y deja al encargado planificando.
- Comprar y traspasar son tareas separadas, con horizontes distintos: 7 días en `pedidos` y 3 en `equilibrar`.
- La ficha del proveedor solo se usa para avisar en el borrador (`drafts/catalog-builder.ts:687-712`).
- La cobertura que marca lo urgente no cuenta lo que está en camino (`tools/tools.ts:143`).

**Qué hacer**, todo en código y sin modelo:

0. **Las fuentes de precio no son proveedores.** «Precio de referencia (estimado)» y «Precios de escandallo» sirven
   para valorar, no para pedir, y hoy el borrador elige la primera porque tiene el último precio (ya tiene un pedido de
   168 líneas en producción).
   - Una marca en `suppliers` (migración, pgTAP y tipos) distingue la fuente de precio del proveedor.
   - El borrador, la tarea `pedidos` y la pantalla de Pedidos solo eligen proveedores reales.
   - Sin un proveedor real con precio, la línea va a «sin proveedor».
1. **Cobertura correcta.** En `computeReorder`, la cobertura se calcula sobre lo disponible (stock más lo que está en
   camino), igual que la cantidad. Lo ya pedido no sale como urgente.
2. **Traspasar antes que comprar.** «Qué pido» ejecuta primero la lógica de `equilibrar`. Lo que se cubre con un
   traspaso no entra en el pedido. El primer borrador propuesto es el traspaso. Las dos tareas comparten el mismo
   horizonte.
3. **La ficha del proveedor decide.** Con `nextDelivery` y `minOrderShortfall` de `src/lib/supplier-terms.ts`, que ya
   están probados:
   - el horizonte de cada línea llega hasta la entrega siguiente a la próxima posible, en lugar de 7 días fijos;
   - un proveedor que hoy no admite pedidos no genera borrador: su línea queda en «se pide el jueves»;
   - si no se llega al pedido mínimo, se avisa y se propone juntar con el siguiente.

   Sin condiciones en la ficha (14 de 32 proveedores), se usan 7 días y se dice que faltan las condiciones.
4. **Tarjeta de excepciones.**
   - **Arriba,** solo lo que no llega a la próxima entrega, con su acción: traspaso o pedido.
   - **Debajo,** «y N productos más que conviene reponer» con enlace a Pedidos.
   - **Cada acción,** un botón que deja el borrador. Nada se guarda sin confirmar.
5. **Explicación.**
   - **Con modelo** (si está activo): una frase por excepción, con el verificador de números. Si inventa una cifra,
     se usa la plantilla.
   - **Plantilla de ejemplo:** «Larios en Parador no llega al próximo pedido; Vivero puede ceder sin bajar de su
     objetivo: traspaso, no compra».
6. **Demanda mejor.**
   - **Peso por día de la semana** en la media de 28 días.
   - **Consumo teórico:** si el producto está en escandallos enlazados a ventas, se mezcla el que sale de las ventas.
   - **Perecederos** (marca de categoría o de producto): horizonte corto y tope de lo que se tira.
7. **Sin niveles.** En la base actual ya están completados (informe, sección 3.6). En otra base de datos, o tras el
   reinicio, se propone un mínimo a partir del consumo, como borrador que la persona confirma. La regla del 18/11:
   - mínimo de 4 días de consumo, al menos 1 unidad;
   - objetivo de 8 días, al menos una unidad por encima del mínimo;
   - todo en la unidad de recuento.

**Criterios de aceptación.**

- La batería de decisiones pasa entera:
  - el traspaso va antes que la compra;
  - el día de pedido se respeta;
  - el mínimo se avisa;
  - lo que está en camino cuenta;
  - la caja de compra es la correcta;
  - ningún borrador nace sin elección.
- Turnos hasta un borrador confirmable de «qué pido»: uno.
- Líneas en la primera respuesta: solo las que no llegan a la próxima entrega, más el enlace.
- Un test por cada regla: horizonte por proveedor, día de pedido, mínimo, perecedero y peso por día.

---

## Fase 5. Las funciones que faltan

**Problema.** Peticiones razonables sin camino: crear un proveedor, desarchivar, «quién ha creado este producto», el
teléfono del proveedor, las guías de «cómo se hace…», comparativas (proveedor más barato, mermas por local, stock
parado) y las instrucciones de una receta. Hoy responde «no sé», otra cosa o la lista de capacidades.

**Qué hacer.** Para cada hueco:

- **Si el asistente puede hacerlo:** consulta o borrador con confirmación, con su test y su caso de batería.
- **Si no debe hacerlo** (invitar personas, cambiar permisos): una respuesta que diga dónde se hace, por ejemplo
  «Se hace en Equipo › Invitar persona».
- **Si es una guía:** los pasos, sacados de la ayuda de la app, no datos.
- **Plato o producto con el mismo nombre:** se pregunta una vez y se recuerda en la conversación.

**Criterios de aceptación.**

- Cada hueco tiene su caso en la batería y en la prueba ciega.
- Ninguna de estas peticiones acaba en «fuera de ámbito» o en la lista de capacidades.
- [capacidades.md](capacidades.md) coincide con lo que hace el asistente: lo comprueba un test contra el registro de
  herramientas.

---

## Fase 6. Datos que no engañan

**Problema.**
- Hay cifras imposibles en producción (valoraciones negativas, un food cost del 3 %, productos de prueba) y salen sin
  aviso.
- Hay pocos niveles y condiciones de proveedor.
- La búsqueda de productos es por parecido de letras: «zero» frente a «zero zero».

**Qué hacer.**

- **Validadores de cifras.** Antes de responder se comprueban rangos sensatos: stock negativo, márgenes fuera de rango,
  cantidades muy por encima del histórico. Si una cifra no pasa, se avisa junto a ella con la causa probable.
- **Limpieza.** En la base actual ya se hizo parte (informe, sección 3.6): no queda stock negativo y los niveles y las
  condiciones están completos. Queda un listado de lo pendiente (productos «PRUEBA-VOL», artículos del TPV sin
  enlazar) para el reinicio. Nada se borra desde el asistente.
- **Completar datos con borradores.** El asistente propone condiciones de proveedor (desde las fechas de pedidos y
  recepciones pasadas) y mínimos (desde el consumo). Siempre se confirman.
- **Búsqueda de productos.**
  - Búsqueda semántica con el proveedor de embeddings que se apruebe.
  - Mientras tanto, casos de prueba para los pares conocidos.
  - Con una puntuación baja, hasta tres opciones con el nombre completo. Nunca se elige una en silencio.

**Criterios de aceptación.**

- Ninguna cifra imposible sale sin aviso: se prueba con anomalías sintéticas.
- Producto correcto en primer lugar en al menos el 95 % del conjunto de pares de prueba.
- La cobertura de condiciones de proveedor y de niveles por producto aparece en los indicadores de la fase 0.

---

## Fase 7. El panel y el parte de apertura

**Problema.**
- La lista de capacidades es un muro de texto.
- Aparecen formularios con datos ya escritos.
- Se ven textos internos.
- No hay un momento del día en que el asistente diga qué hacer con la mercancía.

**Qué hacer.**

- **Respuesta corta primero:** la cifra o la decisión, una tabla breve y de 1 a 3 botones, con «ver más».
- **Capacidades** en una tarjeta con tres opciones y un enlace a la ayuda.
- **Sin textos internos.** Una lista de frases prohibidas («Entiendo:», avisos sin motivo) se comprueba en todas las
  respuestas de las baterías.
- **Botones en el borrador:** cambiar cantidad, cambiar local, cancelar.
- **Parte de apertura.**
  - Una vez al día, al abrir el panel: las excepciones de la fase 4, cada una con su botón de borrador.
  - Es la tarea `parte` más la decisión de mercancía. No es un agente que recorra el día.
- **Móvil:** márgenes de 16 px y sin desplazamiento horizontal, revisado con capturas.

**Criterios de aceptación.**

- Ninguna respuesta de las baterías contiene frases prohibidas.
- Uso real, tras la fase:
  - aclaraciones por debajo del 15 %;
  - menos de un 5 % de conversaciones sin resolver;
  - más de la mitad de los borradores confirmados.
- Panel revisado en móvil y escritorio.

---

## Después: aprendizaje continuo

- **Semanal:** las opiniones (`copilot_feedback`) se califican con la rúbrica del juez y pasan a la batería, revisadas
  a mano.
- **Mensual:**
  - un conjunto ciego nuevo de al menos 40 turnos, escrito por alguien que no haya visto el sistema ese mes;
  - un caso nuevo en la batería de decisiones por cada pedido o traspaso que la persona haya corregido antes de
    confirmar.
- **Si un indicador empeora dos meses seguidos,** se arregla antes de añadir funciones.

---

## Qué no hacer

- No convertir el flujo en un agente que planifique o encadene herramientas para una merma o un pedido.
- No dejar que el modelo elija cantidades, plazos ni locales por su cuenta: solo entre candidatos del código o números
  de la frase.
- No ajustar la prueba ciega para subir la nota.
- No añadir otra expresión regular de comprensión desde la fase 3: el objetivo es quitarlas.
- No poner el modelo delante de la pregunta simple: ni el intérprete ni el redactor van antes de la vía rápida.
- No mezclar en un mismo PR el intérprete (fase 3) con arreglos de diálogo o de reposición.
- No montar todavía un almacén compartido para el límite de peticiones: no es lo que hoy frena.
